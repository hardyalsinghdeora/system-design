# Bloom filter

A Bloom filter sized from the expected item count and target false-positive rate, using Kirsch-Mitzenmacher double hashing over one MD5 digest and a `Uint8Array` bit array, with serialization and union; plus a counting variant that supports removal. A Bloom filter answers "definitely not in the set" or "maybe in the set" in about 10 bits per item at 1 %, which is why storage engines and crawlers put one in front of anything expensive: a negative answer skips a disk read, a network call or a refetch.

- Concept: [`fundamentals/bloom-filters-and-probabilistic.md`](../../fundamentals/bloom-filters-and-probabilistic.md)
- Problems: [`problems/web-crawler.md`](../../problems/web-crawler.md), [`problems/url-shortener.md`](../../problems/url-shortener.md)
- Run: `npm run demo -- bloom-filter` · `npx vitest run src/bloom-filter`

```ts
const seen = BloomFilter.withCapacity(1_000_000, 0.01);   // m = 9,585,059 bits (1.2 MB), k = 7
seen.add('https://example.com/a');
seen.mightContain('https://example.com/a');              // true, always
seen.mightContain('https://example.com/b');              // false (or true ~1 % of the time)
const bytes = seen.serialize();                          // ship to another worker
const all = BloomFilter.deserialize(bytes).union(other); // same m and k required
const counting = CountingBloomFilter.withCapacity(10_000, 0.01);
counting.add('x'); counting.remove('x');
```

## What the tests prove

- m and k match `m = ceil(-n ln p / (ln 2)^2)` and `k = round(m/n · ln 2)`; 1,000,000 items at 1 % gives 9,585,059 bits and 7 hashes.
- Zero false negatives for 10,000 inserted items.
- With 10,000 items at a 1 % target, the measured false-positive rate on 20,000 non-members is under 2 %, and about half the bits are set (the optimum).
- The filter's own estimate `(fill ratio)^k` matches the target at capacity and rises sharply when overfilled.
- `union` contains both sets and is byte-identical to a filter built from both; serialize/deserialize round-trips exactly.
- The counting filter removes items without false negatives for the others, and refuses to remove items it definitely does not hold.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `add`, `mightContain` | O(k), one hash digest | m bits total (about 1.44 · log2(1/p) bits per item) |
| `fillRatio`, `estimatedFalsePositiveRate` | O(m / 8) | none extra |
| `union`, `serialize`, `deserialize` | O(m / 8) | a copy of the bit array |
| `CountingBloomFilter` add / remove / test | O(k) | m counters (8 bits each here) |

## Production notes

- Cassandra, HBase, LevelDB and RocksDB keep a Bloom filter per SSTable / SST file so a point read skips files that cannot hold the key. RocksDB also offers Ribbon filters, which use less memory for the same false-positive rate.
- Redis Stack (RedisBloom) provides `BF.ADD` / `BF.EXISTS` and scalable Bloom filters that add layers as they fill, instead of the fixed capacity used here.
- Counting Bloom filters come from the Summary Cache paper (Fan et al.), which used 4-bit counters. Where deletion matters, a cuckoo filter is the common modern choice: it supports removal with less memory than counters.
- A filter cannot be resized: once it passes its designed n the false-positive rate climbs quickly, so production systems size for growth or rebuild.
- MD5 is used for spread, not security. An attacker who can choose inputs can craft collisions; systems facing untrusted input use a keyed hash.
