/** Common English words that carry little meaning and would bloat every postings list. */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with',
]);

export interface Token {
  term: string;
  /** Position in the original word stream. Stopwords keep their slot, so phrase offsets survive their removal. */
  position: number;
}

/**
 * Splits text into searchable terms: lowercase, apostrophes dropped, every
 * other non-letter/digit is a separator, stopwords removed. Documents and
 * queries must go through the same function or they will not match.
 */
export function tokenize(text: string, stopwords: ReadonlySet<string> = DEFAULT_STOPWORDS): Token[] {
  const words = text.toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  const tokens: Token[] = [];
  words.forEach((term, position) => {
    if (!stopwords.has(term)) tokens.push({ term, position });
  });
  return tokens;
}

/** One document's entry in a term's postings list. */
export interface Posting {
  doc: number;
  tf: number;
  positions: number[];
}

export interface SearchHit {
  id: string;
  score: number;
}

export interface InvertedIndexOptions {
  /** Term-frequency saturation. 1.2 is the usual default (Lucene uses it). */
  k1?: number;
  /** Length normalisation strength: 0 ignores length, 1 fully normalises. */
  b?: number;
  stopwords?: ReadonlySet<string>;
}

interface DocInfo {
  id: string;
  length: number;
  terms: string[];
}

/** Doc ids are assigned in insertion order, so appending keeps every postings list sorted. */
function findPosting(list: readonly Posting[], doc: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].doc === doc) return mid;
    if (list[mid].doc < doc) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Two-pointer intersection of sorted doc lists: O(a + b). */
export function intersectSorted(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return out;
}

/** Two-pointer union of sorted doc lists without duplicates. */
export function unionSorted(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) out.push(a[i++]);
    else if (i >= a.length || b[j] < a[i]) out.push(b[j++]);
    else {
      out.push(a[i]);
      i++;
      j++;
    }
  }
  return out;
}

/**
 * An inverted index: term -> postings (doc, term frequency, positions),
 * the structure behind every full-text search engine. Boolean queries are
 * merges of sorted postings lists, phrase queries check positions, and
 * results are ranked with Okapi BM25.
 */
export class InvertedIndex {
  private readonly postings = new Map<string, Posting[]>();
  private readonly docs = new Map<number, DocInfo>();
  private readonly byId = new Map<string, number>();
  private readonly k1: number;
  private readonly b: number;
  private readonly stopwords: ReadonlySet<string>;
  private nextDoc = 0;
  private totalLength = 0;

  constructor(options: InvertedIndexOptions = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.stopwords = options.stopwords ?? DEFAULT_STOPWORDS;
  }

  get documentCount(): number {
    return this.docs.size;
  }

  get termCount(): number {
    return this.postings.size;
  }

  get averageLength(): number {
    return this.docs.size === 0 ? 0 : this.totalLength / this.docs.size;
  }

  /** Indexes a document; re-adding an id replaces the old version. */
  add(id: string, text: string): void {
    this.remove(id);
    const doc = this.nextDoc++;
    const tokens = tokenize(text, this.stopwords);
    const perTerm = new Map<string, number[]>();
    for (const { term, position } of tokens) {
      const list = perTerm.get(term);
      if (list) list.push(position);
      else perTerm.set(term, [position]);
    }
    for (const [term, positions] of perTerm) {
      let list = this.postings.get(term);
      if (!list) this.postings.set(term, (list = []));
      list.push({ doc, tf: positions.length, positions });
    }
    this.docs.set(doc, { id, length: tokens.length, terms: [...perTerm.keys()] });
    this.byId.set(id, doc);
    this.totalLength += tokens.length;
  }

  /** Deletes a document and its postings. Returns false for an unknown id. */
  remove(id: string): boolean {
    const doc = this.byId.get(id);
    if (doc === undefined) return false;
    const info = this.docs.get(doc) as DocInfo;
    for (const term of info.terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const at = findPosting(list, doc);
      if (at >= 0) list.splice(at, 1);
      if (list.length === 0) this.postings.delete(term);
    }
    this.docs.delete(doc);
    this.byId.delete(id);
    this.totalLength -= info.length;
    return true;
  }

  /** The postings list for one (already normalised) term. */
  postingsFor(term: string): readonly Posting[] {
    return this.postings.get(term) ?? [];
  }

  documentFrequency(term: string): number {
    return this.postingsFor(term).length;
  }

  /** Documents containing every query term. Intersects shortest lists first so intermediate results stay small. */
  and(query: string): string[] {
    return this.toIds(this.matchAll(this.queryTerms(query)));
  }

  /** Documents containing at least one query term. */
  or(query: string): string[] {
    return this.toIds(this.matchAny(this.queryTerms(query)));
  }

  /** Documents containing the query terms at consecutive positions (stopword gaps preserved). */
  phrase(query: string): string[] {
    const tokens = tokenize(query, this.stopwords);
    if (tokens.length === 0) return [];
    const base = tokens[0].position;
    const parts = tokens.map((t) => ({ term: t.term, offset: t.position - base }));
    const result: number[] = [];
    for (const doc of this.matchAll([...new Set(parts.map((p) => p.term))])) {
      const positionsOf = (term: string): number[] => {
        const list = this.postings.get(term) as Posting[];
        return list[findPosting(list, doc)].positions;
      };
      const sets = parts.map((p) => ({ offset: p.offset, positions: new Set(positionsOf(p.term)) }));
      const first = positionsOf(parts[0].term);
      if (first.some((start) => sets.every((s) => s.positions.has(start + s.offset)))) result.push(doc);
    }
    return this.toIds(result);
  }

  /**
   * Ranked retrieval with BM25:
   *   score = sum over terms of idf(t) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avgLen))
   *   idf(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
   * Rare terms weigh more (idf), repeated terms saturate (k1), long documents are discounted (b).
   */
  search(query: string, options: { mode?: 'and' | 'or'; limit?: number } = {}): SearchHit[] {
    const terms = this.queryTerms(query);
    const docs = options.mode === 'and' ? this.matchAll(terms) : this.matchAny(terms);
    const hits = docs.map((doc) => ({ id: (this.docs.get(doc) as DocInfo).id, score: this.score(doc, terms) }));
    hits.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return hits.slice(0, options.limit ?? 10);
  }

  /** BM25 score of one document for already-tokenised query terms. */
  private score(doc: number, terms: string[]): number {
    const info = this.docs.get(doc) as DocInfo;
    const n = this.docs.size;
    const norm = 1 - this.b + this.b * (info.length / (this.averageLength || 1));
    let total = 0;
    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const at = findPosting(list, doc);
      if (at < 0) continue;
      const tf = list[at].tf;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      total += (idf * tf * (this.k1 + 1)) / (tf + this.k1 * norm);
    }
    return total;
  }

  private queryTerms(query: string): string[] {
    return [...new Set(tokenize(query, this.stopwords).map((t) => t.term))];
  }

  private docList(term: string): number[] {
    return this.postingsFor(term).map((p) => p.doc);
  }

  private matchAll(terms: string[]): number[] {
    if (terms.length === 0) return [];
    const lists = terms.map((t) => this.docList(t)).sort((x, y) => x.length - y.length);
    let acc = lists[0];
    for (let i = 1; i < lists.length && acc.length > 0; i++) acc = intersectSorted(acc, lists[i]);
    return acc;
  }

  private matchAny(terms: string[]): number[] {
    let acc: number[] = [];
    for (const t of terms) acc = unionSorted(acc, this.docList(t));
    return acc;
  }

  private toIds(docs: number[]): string[] {
    return docs.map((d) => (this.docs.get(d) as DocInfo).id);
  }
}
