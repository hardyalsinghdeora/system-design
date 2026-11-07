# Trie autocomplete

A query-frequency trie that caches the top-k completions at every node, so `suggest(prefix)` costs one walk down the prefix instead of a scan of the subtree. Counts are kept current on insert and increment, decrements and deletes repair the cache, and queries are normalised (lowercase, trimmed, whitespace collapsed). An uncached DFS mode answers the same queries, which makes the memory-versus-latency trade-off of search-as-you-type easy to measure.

- Concept: [`fundamentals/search-and-indexing.md`](../../fundamentals/search-and-indexing.md)
- Problem: [`problems/search-autocomplete.md`](../../problems/search-autocomplete.md)
- Run: `npm run demo -- trie-autocomplete` · `npx vitest run src/trie-autocomplete`

```ts
const trie = new AutocompleteTrie({ topK: 5 });          // mode: 'cached' (default) or 'dfs'
trie.insert('weather today', 120);
trie.insert('Weather  Radar ', 40);                       // stored as 'weather radar'
trie.suggest('wea');        // [{ query: 'weather today', count: 120 }, { query: 'weather radar', count: 40 }]
trie.increment('weather radar', 200);                     // now ranks first
trie.delete('weather today');                             // takedown; cache repaired, nodes pruned
trie.stats();               // { mode, nodes, queries, cachedEntries }
```

## What the tests prove

- Top-k is ordered by count, ties broken lexicographically, for any prefix including the empty one.
- Normalisation merges `'  New   York '` and `'new york'`; a trailing space in the prefix is kept, so `'new '` does not match `'newark'`.
- An unknown prefix returns `[]`.
- Increments reorder suggestions; decrements surface a query that was not in the old cache; delete prunes empty nodes.
- After 5,000 seeded random inserts, increments and decrements, the cached trie returns exactly what DFS returns.
- The cache answers in prefix-length node visits while DFS visits the whole subtree, at the cost of more cached entries than nodes.

## Complexity

L = prefix or query length, k = cached list size, S = subtree size, A = children per node.

| Operation | Time (cached) | Time (dfs) | Space |
|---|---|---|---|
| `insert` / `increment` | O(L · k) | O(L) | O(L) new nodes |
| `decrement` / `delete` | O(L · A · k log k) | O(L) | frees pruned nodes |
| `suggest(prefix, k)` | O(L + k) | O(L + S log S) | O(k) |
| total memory | O(nodes · k) | O(nodes) | |

## Production notes

- Lucene's completion suggester (used by Elasticsearch's `completion` field) stores weighted suggestions in an FST, a compressed automaton, rather than a pointer trie; top-k by weight is found with a best-first search over that structure.
- At large scale the trie is usually built offline from aggregated query logs (hourly or daily batch jobs), sharded by prefix and served read-only from memory or a key-value store keyed by prefix; live per-keystroke increments, as done here, are too write-heavy for a shared structure.
- Real systems add filtering (blocked terms), personalisation and freshness signals, and clients debounce keystrokes and cache responses per prefix to cut request volume.
