# Quorum KV

A leaderless replicated key-value store in the style of Dynamo, simulated in memory: N replicas per key, configurable R and W, vector-clock versions, read repair, hinted handoff and siblings for concurrent writes. The interview question "how do you stay available when replicas fail, and what consistency do you get?" comes down to the quorum rule: if R + W > N, every read quorum overlaps every write quorum and sees the latest acknowledged write; if not, you trade that guarantee for latency and availability. This module makes both outcomes reproducible.

- Concepts: [`fundamentals/replication.md`](../../fundamentals/replication.md), [`fundamentals/consistency-models.md`](../../fundamentals/consistency-models.md)
- Problem: [`problems/key-value-store.md`](../../problems/key-value-store.md)
- Run: `npm run demo -- quorum-kv` · `npx vitest run src/quorum-kv`

```ts
const kv = new QuorumKV({ nodes: ['n1', 'n2', 'n3', 'n4'], n: 3, r: 2, w: 2 });
kv.put('cart:42', 'milk');
const { values, context } = kv.get('cart:42');      // ['milk'], clock to write back with
kv.markDown('n2');                                   // writes still succeed with W=2
kv.put('cart:42', 'milk,eggs', { context });         // hint for n2 stored on a substitute
kv.markUp('n2');                                     // hint handed off
kv.get('cart:42').values;                            // ['milk,eggs'] (or siblings if concurrent)
```

## What the tests prove

- With N=3, R=2, W=2 and hinted handoff off, a read returns the latest write for every combination of one replica missing the write and one missing the read.
- With R=1, W=1 a stale read is reproduced deterministically, and it heals once the hint holder returns.
- Read repair rewrites the stale replica that answered the read, and a second read repairs nothing.
- A strict-quorum write fails with fewer than W home replicas up (the partial write is not rolled back), and reads fail with fewer than R.
- Two writes from the same context through different coordinators produce concurrent clocks and are returned as siblings; writing back with the merged context resolves them.
- Hinted handoff stores the write on a node outside the preference list and delivers it on recovery; with `sloppyQuorum` that hint counts toward W.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `put` | O(N · s · c) (N replicas, s siblings, c clock entries) | O(N) copies of the version, plus hints |
| `get` | O(R · s² · c) to reconcile, plus repair writes | O(s) |
| `markUp` (hint delivery) | O(total hints) | O(1) extra |
| `preferenceList` | O(N) | O(N) |

## Production notes

- Amazon's Dynamo (2007 paper) introduced this combination: preference lists on a consistent hash ring, sloppy quorums with hinted handoff, vector clocks and client-side sibling reconciliation. DynamoDB, the AWS service, is a different design based on leader replication per partition.
- Cassandra and ScyllaDB use the same R/W/N tunables (consistency levels such as ONE, QUORUM, ALL) and hinted handoff, but resolve conflicts by per-cell timestamps (last write wins) instead of returning siblings. Cassandra hints do not count toward the consistency level (except `ANY`).
- Riak kept siblings, and replaced plain vector clocks with dotted version vectors to bound sibling growth.
- Read repair here is synchronous and covers only the replicas that answered; real systems also run background anti-entropy with Merkle trees for data that is never read.
- R + W > N is not linearizability: with sloppy quorums, concurrent writes, or a failed write that left a partial copy, reads can still disagree. The simulation is synchronous and has no network partitions between live nodes.
