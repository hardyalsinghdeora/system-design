# Vector clock

Lamport clocks and vector clocks, plus a three-process message-passing simulation that stamps every event with both. Wall clocks drift, so distributed systems order events logically instead: a Lamport clock gives a total order that never contradicts causality, and a vector clock tells you exactly whether one event happened before another or whether they were concurrent. That second answer is what lets a leaderless store keep conflicting writes as siblings instead of losing one.

- Concept: [`fundamentals/consistency-models.md`](../../fundamentals/consistency-models.md)
- Problems: [`problems/key-value-store.md`](../../problems/key-value-store.md), [`problems/collaborative-editor.md`](../../problems/collaborative-editor.md)
- Run: `npm run demo -- vector-clock` · `npx vitest run src/vector-clock`

```ts
const v1 = new VectorClock().increment('A');      // {A:1}
const atA = v1.increment('A');                     // {A:2}
const atB = v1.increment('B');                     // {A:1, B:1}
atA.compare(atB);                                  // 'CONCURRENT' -> siblings
const fixed = atA.merge(atB).increment('A');       // {A:3, B:1}
fixed.compare(atB);                                // 'AFTER'

const sim = threeProcessScenario();
sim.order('P3.1', 'P2.1');                         // 'CONCURRENT'
```

## What the tests prove

- `compare` matches the full truth table (EQUAL, BEFORE, AFTER, CONCURRENT), with missing entries treated as zero.
- `merge` is commutative, associative and idempotent (checked on 300 seeded random triples) and dominates both inputs.
- Lamport timestamps respect every happens-before pair in the simulation, and receive jumps past the sender.
- The simulation finds exactly the concurrent pairs, including one where the Lamport order (1 < 3) suggests a causality that does not exist.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| Lamport `tick` / `send` / `receive` | O(1) | O(1) per process, one integer per message |
| Vector `increment` | O(n) (copy) | O(n), n = processes with a non-zero entry |
| Vector `merge` / `compare` | O(n) | O(n) |
| `concurrentPairs` over E events | O(E² · n) | O(E²) worst case |

## Production notes

- Amazon's Dynamo (2007 paper) attached vector clocks to values and returned concurrent versions to the client to reconcile; the paper notes clocks were truncated once they exceeded about ten entries.
- Riak used vector clocks and later moved to dotted version vectors, which keep one entry per server rather than per client to avoid sibling explosion.
- Cassandra does not use vector clocks: it resolves conflicts with per-cell timestamps (last write wins), which is simpler but can silently drop concurrent writes.
- Lamport timestamps show up as tie-breakers for total ordering (for example, in some CRDT and replicated-log designs); hybrid logical clocks, used by CockroachDB, combine a physical timestamp with a logical counter to stay close to wall time.
- This module keeps clocks immutable and unbounded; real systems prune or truncate entries and must decide what to do when pruning loses causality information.
