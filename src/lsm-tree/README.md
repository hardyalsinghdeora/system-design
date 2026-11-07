# LSM tree

An in-memory log-structured merge tree: a write-ahead log that is replayed on restart, a sorted memtable, immutable SSTables with a sparse index and a per-table Bloom filter, tombstones for deletes, size-tiered compaction and merged range scans. LSM trees turn random writes into sequential ones, which is why write-heavy stores (Cassandra, RocksDB, LevelDB, HBase) use them; the price is that reads may have to check several tables and that data is rewritten by compaction. This module shows each part of that trade-off and counts the SSTables a read touches.

- Concept: [`fundamentals/storage-engines.md`](../../fundamentals/storage-engines.md)
- Problem: [`problems/key-value-store.md`](../../problems/key-value-store.md)
- Run: `npm run demo -- lsm-tree` · `npx vitest run src/lsm-tree`

```ts
const db = new LSMTree({ memtableLimit: 1000, bloomBitsPerKey: 10, compactionThreshold: 4 });
db.put('user:1', 'alice');                         // WAL append + memtable insert
db.delete('user:2');                               // writes a tombstone
db.get('user:1');                                  // memtable, then SSTables newest first
[...db.scan('user:0', 'user:5')];                  // k-way merge of all sources
const reopened = new LSMTree({ disk: db.disk });   // crash: replay the WAL
db.compact();                                      // merge all tables, drop tombstones
db.stats.sstablesProbed;                           // tables actually searched by get
```

## What the tests prove

- Put, get and delete give the right answer when the latest version is in the memtable, a newer SSTable or an older one.
- After a simulated crash, a new instance built from the same disk replays the WAL and serves every acknowledged write; flushed records are no longer in the WAL.
- Major compaction leaves one table with only the latest value per live key and no tombstones.
- Size-tiered compaction merges four same-tier tables at a time (16 flushes → 5 compactions → one table).
- Tombstones survive a compaction that does not include the oldest table, so a deleted key stays deleted.
- Range scans across memtable, SSTables and a restart match a reference map on 3,000 seeded random operations.
- Bloom filters cut SSTable searches for absent keys by more than 95 %; the filter has no false negatives and under 2.5 % false positives at 10 bits per key.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `put` / `delete` | O(log m) search + O(m) array insert (m = memtable size) | O(1) WAL record |
| `get` | O(log m + T · (k + log(n/i) + i)) worst case; most tables skipped by the filter | O(1) |
| `scan` over r results | O(r · S) for S sources | O(S) cursors (copies ranges here) |
| `flush` | O(m) plus Bloom inserts | O(m) new table |
| compaction of a run | O(total entries · run length) | O(total entries) |
| Bloom filter | O(k) per add or check | about 10 bits per key |

T = SSTables, k = Bloom hashes, i = index interval, n = entries per table.

## Production notes

- LevelDB and RocksDB use a skip-list memtable, a WAL, SSTables with block indexes and per-table Bloom filters, and leveled compaction by default; RocksDB also offers universal (size-tiered) and FIFO compaction.
- Cassandra uses size-tiered compaction by default, with leveled and time-window strategies available; it purges tombstones only after `gc_grace_seconds` so that replicas which missed the delete do not resurrect the data.
- Real engines persist SSTables as files with compressed blocks, fsync the WAL (often in group commits) and compact in background threads; here everything is in memory and compaction runs inline after a flush.
- Size-tiered compaction has lower write amplification but needs up to 2x temporary space and leaves more tables for reads to check; leveled compaction bounds read cost and space at the price of more rewriting.
- This module merges only age-adjacent tables so that "newest table wins" holds. Engines that merge arbitrary tables resolve conflicts by sequence number or timestamp instead.
