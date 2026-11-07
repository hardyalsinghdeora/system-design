# HyperLogLog

A HyperLogLog cardinality estimator with precision p (2^p registers), a 64-bit hash taken from MD5 via `node:crypto`, linear counting for small cardinalities, merge (union) and register serialization. Counting distinct users, IPs or ad viewers exactly needs memory proportional to the count; HyperLogLog gives about 0.8 % standard error in 16 KB no matter whether there are a thousand or a billion, and sketches from different shards or hours merge without double counting.

- Concept: [`fundamentals/bloom-filters-and-probabilistic.md`](../../fundamentals/bloom-filters-and-probabilistic.md)
- Problems: [`problems/distributed-counter.md`](../../problems/distributed-counter.md), [`problems/ad-click-aggregation.md`](../../problems/ad-click-aggregation.md)
- Run: `npm run demo -- hyperloglog` · `npx vitest run src/hyperloglog`

```ts
const today = new HyperLogLog({ precision: 14 });   // 16,384 registers, 0.81 % error
today.add('user:42');
today.add('user:42');                               // duplicate: no change
today.count();                                      // ~1
const week = HyperLogLog.union(mon, tue, wed);      // register-wise max
week.count();                                       // distinct across the week
const bytes = today.toBytes();                      // ship to an aggregator
```

## What the tests prove

- 1,000 distinct items (linear counting range) and 100,000 (harmonic-mean range) are both estimated within 3 standard errors at p = 14.
- Re-adding 20,000 items three times changes no register and no estimate.
- The union of two overlapping sketches estimates the true union within 3 standard errors and equals a single sketch fed every item; inputs are unchanged; mismatched precision is rejected.
- Over 12 trials, the RMS error at p = 6 (64 registers) is more than 3x that at p = 12 (4,096 registers), and each stays within 2x of 1.04/√m.
- The sketch is 2^p bytes and round-trips through its registers.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `add` | O(1), one hash | 2^p registers (one byte each here) |
| `count` | O(2^p) | none extra |
| `merge` / `union` | O(2^p) | a copy for `union` |
| `toBytes` / `fromBytes` | O(2^p) | 2^p bytes |

## Production notes

- Redis `PFADD` / `PFCOUNT` / `PFMERGE` use 16,384 registers (p = 14) with 6-bit registers, 12 KB dense, and a sparse encoding for small sets; the documented standard error is 0.81 %, the same figure as here.
- Google's HyperLogLog++ (used by BigQuery's `APPROX_COUNT_DISTINCT` and `HLL_COUNT` functions) adds empirical bias correction for the mid range and a sparse representation; this block uses only the original paper's linear counting switch at 2.5m.
- Presto/Trino `approx_distinct` is HyperLogLog-based with a configurable maximum standard error (2.3 % by default). Apache Druid and many stream processors use the Apache DataSketches HLL implementation.
- Because a 64-bit hash is used, the original paper's large-range correction for 32-bit hashes is not needed.
- HLL answers union but not intersection: |A ∩ B| via inclusion-exclusion has error relative to the union, which is large when the intersection is small. Systems that need intersections use theta sketches.
