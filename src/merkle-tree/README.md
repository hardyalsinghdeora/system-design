# Merkle tree

A fixed-shape Merkle tree over hash-bucketed key ranges, with `diff` that descends only into mismatching subtrees and inclusion proofs (audit paths) that a client can verify against the root alone. Replicas in a leaderless store drift apart (missed writes, lost hints), and comparing every key across the network is too expensive. Exchanging tree hashes top-down finds the differing key ranges in O(depth) comparisons per difference, so anti-entropy repair streams only the buckets that actually differ.

- Concept: [`fundamentals/replication.md`](../../fundamentals/replication.md)
- Problem: [`problems/key-value-store.md`](../../problems/key-value-store.md)
- Run: `npm run demo -- merkle-tree` · `npx vitest run src/merkle-tree`

```ts
const a = MerkleTree.from(replicaAEntries, { depth: 12 });   // 4096 hash-range buckets
const b = MerkleTree.from(replicaBEntries, { depth: 12 });
const { buckets, comparisons } = a.diff(b);                  // e.g. [1873], 25
for (const bucket of buckets) repair(a.bucketEntries(bucket), b.bucketEntries(bucket));

a.set('order:7', 'shipped');                                 // rehashes one path
const proof = a.proof('order:7')!;
verifyProof(a.root, 'order:7', 'shipped', proof);            // true
```

## What the tests prove

- Identical data gives the same root regardless of insertion order; incremental `set`/`delete` matches a rebuild.
- One changed key is found in exactly the right bucket with 2·depth + 1 = 21 comparisons on a 1024-bucket tree, instead of 2047 for a full walk.
- Several differences (changed, deleted and extra keys on either side) are all found, while matching subtrees are skipped.
- Inclusion proofs verify against the root; a forged value, a modified sibling hash, forged bucket entries or a different root all fail.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `from` (build) | O(n log n + B) (hash, then sort each bucket) | O(n + B), B = 2^depth buckets |
| `set` / `delete` | O(depth + bucket size) | O(1) extra |
| `diff`, d differing buckets | O(d · depth) comparisons, 1 when equal | O(depth) recursion |
| `proof` / `verifyProof` | O(depth + bucket size) | O(depth + bucket size) |

## Production notes

- Dynamo and Cassandra use Merkle trees for anti-entropy repair: Cassandra builds a tree per token range during `nodetool repair` (validation compaction) and streams only mismatching ranges. Its trees are built on demand rather than kept up to date on every write.
- Riak's active anti-entropy keeps persistent hash trees on disk and updates them as writes arrive, closer to the incremental `set` here.
- Git, Bitcoin and Certificate Transparency logs use Merkle structures for integrity and inclusion proofs; CT and Bitcoin trees have one leaf per record and an append-only shape, unlike the fixed hash-range buckets used for replica comparison here.
- Real repair exchanges hashes level by level over the network and must handle trees built at slightly different times; this module compares two in-memory trees directly.
- Depth is a trade-off: deeper trees narrow each mismatch to fewer keys but cost more memory and more round trips when many ranges differ.
