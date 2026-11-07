# Inverted index

A tokenizer, an inverted index with positional postings (doc id, term frequency, positions), boolean AND/OR as merges of sorted postings lists, phrase queries by position, BM25 ranking (k1 = 1.2, b = 0.75) and document deletion. This is the data structure inside Lucene, Elasticsearch and every other full-text engine: it turns "which documents contain these words?" from a scan of all text into a handful of list merges.

- Concept: [`fundamentals/search-and-indexing.md`](../../fundamentals/search-and-indexing.md)
- Problem: [`problems/search-autocomplete.md`](../../problems/search-autocomplete.md)
- Run: `npm run demo -- inverted-index` · `npx vitest run src/inverted-index`

```ts
const index = new InvertedIndex();                       // { k1: 1.2, b: 0.75, stopwords }
index.add('d1', 'The quick brown fox jumps over the lazy dog');
index.add('d2', 'A quick brown dog outpaces a quick red fox');
index.and('quick fox');                                  // ['d1', 'd2']
index.or('lazy red');                                    // ['d1', 'd2']
index.phrase('brown fox');                               // ['d1']
index.search('quick fox');                               // [{ id: 'd2', score }, { id: 'd1', score }]
index.remove('d2');                                      // postings and length statistics updated
```

## What the tests prove

- Tokenisation lowercases, strips punctuation and stopwords, and keeps original word positions.
- Postings hold the right term frequencies and positions; AND/OR equal set intersection/union.
- Phrase queries require adjacent positions (`"lazy dog"` does not match a document with the words apart) and respect the gap left by a stopword (`"bank of america"` matches, `"bank america"` does not).
- BM25 ranks a document matching a rare term above one matching a common term, ranks a short document above a long one for the same match, and gives a second occurrence less weight than the first.
- Deleting a document removes its postings and updates document count and average length; re-adding an id replaces it.

## Complexity

T = tokens in a document, P = total postings length of the query terms, q = query terms.

| Operation | Time | Space |
|---|---|---|
| `add` | O(T) | O(T) postings and positions |
| `remove` | O(distinct terms · (log P + P)) splice | frees its postings |
| `and` / `or` | O(P) merges (AND shortest first) | O(result) |
| `phrase` | O(P + positions of candidate docs) | O(positions) |
| `search` (BM25) | O(P + r · q log P + r log r) for r matches | O(r) |

## Production notes

- Lucene (and so Elasticsearch, OpenSearch and Solr) has used BM25 as its default similarity since Lucene 6, with the same `ln(1 + (N - df + 0.5) / (df + 0.5))` idf used here.
- Lucene writes immutable segments and merges them in the background. Deletes are not spliced out: they set a bit in a live-docs bitmap and the postings disappear at the next merge. This in-memory version splices, which is O(P) per term.
- Postings are delta-encoded and bit-packed in blocks with skip data, so AND can jump ahead instead of walking every entry, and top-k retrieval uses WAND/block-max WAND to skip documents that cannot enter the top k.
- A search service shards the index by document (each shard answers the query, a coordinator merges top-k), replicates shards for read throughput, and makes new documents visible on a refresh interval (near-real-time), not instantly.
