/** A completion and how often it was searched. */
export interface Suggestion {
  query: string;
  count: number;
}

/**
 * Canonical form of a stored query: lowercase, trimmed, inner whitespace
 * collapsed. "  New   York " and "new york" must count as one query.
 */
export function normalise(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Prefixes keep a trailing space ("new " should not match "newark"), so only the start is trimmed. */
export function normalisePrefix(prefix: string): string {
  return prefix.trimStart().toLowerCase().replace(/\s+/g, ' ');
}

/** Ranking order: higher count first, ties broken lexicographically so results are stable. */
export function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return b.count - a.count || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0);
}

class TrieNode {
  readonly children = new Map<string, TrieNode>();
  /** Frequency of the query ending here; 0 means not a stored query. */
  count = 0;
  /** The full query when count > 0 (saves rebuilding strings during DFS). */
  query = '';
  /** Cached best `topK` completions under this node (cached mode only). */
  top: Suggestion[] = [];
}

export type TrieMode = 'cached' | 'dfs';

export interface AutocompleteTrieOptions {
  /** Completions cached per node. Requests for more fall back to DFS. */
  topK?: number;
  /**
   * 'cached': every node stores its top-k list, so suggest() is O(prefix length)
   * but each write touches every node on the path and memory grows by k entries
   * per node. 'dfs': no cache; suggest() walks the whole subtree under the prefix.
   */
  mode?: TrieMode;
}

export interface TrieStats {
  mode: TrieMode;
  nodes: number;
  queries: number;
  /** Total suggestions held in per-node caches: the memory price of fast reads. */
  cachedEntries: number;
}

/**
 * A query-frequency trie for search autocomplete.
 *
 * In cached mode each node keeps the top-k completions of its subtree. An
 * increment only raises one query's count, so each node on its path can
 * update its list in place (the evicted entry is guaranteed to be k+1th).
 * A decrement can expose an unknown k+1th entry, so the path is rebuilt
 * bottom-up from the children's lists, which are themselves correct.
 */
export class AutocompleteTrie {
  private readonly root = new TrieNode();
  private readonly topK: number;
  readonly mode: TrieMode;
  private queryCount = 0;
  private nodeCount = 1;
  /** Nodes touched by the last suggest() call: the latency side of the trade-off. */
  lastVisited = 0;

  constructor(options: AutocompleteTrieOptions = {}) {
    this.topK = options.topK ?? 5;
    this.mode = options.mode ?? 'cached';
    if (!Number.isInteger(this.topK) || this.topK < 1) throw new RangeError('topK must be a positive integer');
  }

  /** Adds `by` searches of `query` (inserting it if new). Returns the new count. */
  insert(query: string, by = 1): number {
    if (!(by > 0)) throw new RangeError('increment must be positive');
    const q = normalise(query);
    if (q === '') return 0;
    const path: TrieNode[] = [this.root];
    let node = this.root;
    for (const ch of q) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
        this.nodeCount++;
      }
      node = next;
      path.push(node);
    }
    if (node.count === 0) {
      this.queryCount++;
      node.query = q;
    }
    node.count += by;
    if (this.mode === 'cached') {
      const entry = { query: q, count: node.count };
      for (const n of path) this.raise(n, entry);
    }
    return node.count;
  }

  /** Same as insert: one more search of an existing or new query. */
  increment(query: string, by = 1): number {
    return this.insert(query, by);
  }

  /** Lowers a query's count; at zero the query is deleted and empty nodes are pruned. Returns the new count. */
  decrement(query: string, by = 1): number {
    if (!(by > 0)) throw new RangeError('decrement must be positive');
    const q = normalise(query);
    const path: TrieNode[] = [this.root];
    const chars: string[] = [];
    let node: TrieNode | undefined = this.root;
    for (const ch of q) {
      node = node.children.get(ch);
      if (!node) return 0;
      path.push(node);
      chars.push(ch);
    }
    if (q === '' || node.count === 0) return 0;
    node.count = Math.max(0, node.count - by);
    if (node.count === 0) {
      this.queryCount--;
      node.query = '';
      // Prune childless, non-terminal nodes from the leaf upwards.
      for (let i = path.length - 1; i > 0; i--) {
        const n = path[i];
        if (n.count > 0 || n.children.size > 0) break;
        path[i - 1].children.delete(chars[i - 1]);
        this.nodeCount--;
        path.length = i;
      }
    }
    if (this.mode === 'cached') for (let i = path.length - 1; i >= 0; i--) this.rebuild(path[i]);
    return node.count;
  }

  /** Removes a query entirely (e.g. a takedown request). */
  delete(query: string): boolean {
    const count = this.frequency(query);
    if (count === 0) return false;
    this.decrement(query, count);
    return true;
  }

  frequency(query: string): number {
    const node = this.find(normalise(query));
    return node?.count ?? 0;
  }

  /** The k most frequent stored queries starting with `prefix`; [] for an unknown prefix. */
  suggest(prefix: string, k = this.topK): Suggestion[] {
    if (this.mode === 'dfs' || k > this.topK) return this.suggestDfs(prefix, k);
    const p = normalisePrefix(prefix);
    const node = this.find(p);
    this.lastVisited = p.length + 1;
    return node ? node.top.slice(0, k).map((s) => ({ ...s })) : [];
  }

  /** Uncached answer: walk the whole subtree under the prefix and sort. Always correct, cost grows with the subtree. */
  suggestDfs(prefix: string, k = this.topK): Suggestion[] {
    const p = normalisePrefix(prefix);
    const start = this.find(p);
    this.lastVisited = p.length + 1;
    if (!start || k <= 0) return [];
    const found: Suggestion[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop() as TrieNode;
      this.lastVisited++;
      if (node.count > 0) found.push({ query: node.query, count: node.count });
      for (const child of node.children.values()) stack.push(child);
    }
    return found.sort(compareSuggestions).slice(0, k);
  }

  stats(): TrieStats {
    let cachedEntries = 0;
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as TrieNode;
      cachedEntries += node.top.length;
      for (const child of node.children.values()) stack.push(child);
    }
    return { mode: this.mode, nodes: this.nodeCount, queries: this.queryCount, cachedEntries };
  }

  private find(prefix: string): TrieNode | undefined {
    let node: TrieNode | undefined = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return undefined;
    }
    return node;
  }

  /** Increment path: replace the query's entry, re-sort, keep k. O(k) per node. */
  private raise(node: TrieNode, entry: Suggestion): void {
    const top = node.top;
    const existing = top.findIndex((s) => s.query === entry.query);
    if (existing >= 0) top.splice(existing, 1);
    let i = 0;
    while (i < top.length && compareSuggestions(top[i], entry) < 0) i++;
    if (i < this.topK) top.splice(i, 0, { ...entry });
    if (top.length > this.topK) top.length = this.topK;
  }

  /** Decrement path: merge this node's own query with its children's (already correct) lists. */
  private rebuild(node: TrieNode): void {
    const merged: Suggestion[] = node.count > 0 ? [{ query: node.query, count: node.count }] : [];
    for (const child of node.children.values()) merged.push(...child.top);
    node.top = merged.sort(compareSuggestions).slice(0, this.topK);
  }
}
