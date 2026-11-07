# Count-min sketch

A count-min sketch sized from epsilon and delta, with optional conservative update and merge, plus `HeavyHitters`, which pairs the sketch with a size-k min-heap for streaming top-k. Exact per-item counts need memory proportional to the number of distinct items; a sketch needs a fixed `e/ε × ln(1/δ)` table and answers "how often has X appeared" with a one-sided error. That trade is what lets a trending-topics or click-aggregation service track millions of keys per window in a few hundred kilobytes.

- Concept: [`fundamentals/bloom-filters-and-probabilistic.md`](../../fundamentals/bloom-filters-and-probabilistic.md)
- Problems: [`problems/top-k-trending.md`](../../problems/top-k-trending.md), [`problems/ad-click-aggregation.md`](../../problems/ad-click-aggregation.md)
- Run: `npm run demo -- count-min-sketch` · `npx vitest run src/count-min-sketch`

```ts
const cms = new CountMinSketch({ epsilon: 0.001, delta: 0.01 }); // 2719 x 5 counters
cms.add('ad:42');
cms.add('ad:7', 3);                      // weighted
cms.estimate('ad:7');                    // >= 3, <= 3 + 0.001 * N with 99 % probability
shardA.merge(shardB);                    // same epsilon, delta and seed

const trending = new HeavyHitters(10, { epsilon: 0.001, delta: 0.01 });
for (const tag of events) trending.add(tag);
trending.top();                          // [{ item, estimate }, ...] highest first
```

## What the tests prove

All on a seeded Zipf(1.1) stream of 100,000 events over 1,000 items:

- Width and depth follow `ceil(e/ε)` and `ceil(ln(1/δ))`.
- No estimate is ever below the true count, with standard or conservative update.
- At most a δ fraction of items exceed the ε·N error bound.
- Conservative update gives an estimate no larger than standard update for every item, and cuts total overcount by more than 20 %.
- Merging two half-stream sketches gives exactly the sketch of the whole stream.
- `HeavyHitters` returns the true top 5 in order, each within ε·N; weighted adds and heap eviction work.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `add`, `estimate` | O(d), one hash digest | w · d counters, w = e/ε, d = ln(1/δ) |
| `merge` | O(w · d) | none extra |
| `HeavyHitters.add` | O(d + log k) | sketch + k heap entries + index map |
| `HeavyHitters.top` | O(k log k) | O(k) |

## Production notes

- Redis Stack (RedisBloom) exposes `CMS.INITBYPROB` (sized by error and probability, as here), `CMS.INCRBY` and `CMS.MERGE`, and a separate `TOPK` structure based on HeavyKeeper rather than a sketch plus heap.
- Spark offers `df.stat.countMinSketch(col, eps, confidence, seed)`, and Twitter's Algebird has a `CMS` monoid plus `TopCMS` for heavy hitters, used in Summingbird-style streaming jobs where sketches from many workers are merged.
- Conservative update is not mergeable in the same exact way, and it does not support negative counts; systems that need deletions use the standard update (or count-mean-min variants).
- Trending systems usually keep one sketch per time bucket and sum or decay recent buckets, so old spikes fall out; this block keeps a single all-time sketch.
- The heap holds estimates from the moment each item was last seen, so with heavy collisions a heap member can be stale. Production top-k often keeps a larger candidate set (for example 10k) and re-ranks.
