# Snowflake, UUIDv7 and ULID ids

A Snowflake generator (41-bit milliseconds since a custom epoch, 10-bit worker id, 12-bit sequence, as BigInt) with bounded waiting when a millisecond's sequence runs out, a `ClockMovedBackwardsError` instead of silently issuing duplicates, `decode()` and base62 helpers; plus RFC 9562 UUIDv7 and monotonic ULID generators. Every service that shards its data needs ids that are unique without a central counter, and ids that sort by creation time keep B-tree inserts at the right edge of the index instead of scattering them like random UUIDv4 keys do.

- Concept: [`fundamentals/id-generation.md`](../../fundamentals/id-generation.md)
- Problem: [`problems/url-shortener.md`](../../problems/url-shortener.md)
- Run: `npm run demo -- snowflake-id` · `npx vitest run src/snowflake-id`

```ts
const ids = new SnowflakeGenerator({ workerId: 17 });   // worker id from config or a lease
const id = ids.next();                                   // 7398246150307845137n
ids.decode(id);                                          // { timestamp, workerId: 17, sequence }
encodeBase62(id);                                        // 'Gxk2Pq81bZd' (short-link friendly)
new UuidV7Generator().next();                            // '019a5d7e-1c2b-7f3a-9e1d-4b6c8a0f2e31'
new UlidGenerator().next();                              // '01JC8Z3K7Q9W4TB2M6XHN5RDFE'
```

## What the tests prove

- 100,000 Snowflake ids from one worker strictly increase and are all unique.
- `decode` recovers timestamp, worker id and sequence, and the bit layout is exactly `ms << 22 | worker << 12 | seq`.
- After 4,096 ids in one millisecond the generator re-reads the clock and continues at sequence 0 in the next one; if the clock never advances it throws `ClockStalledError` after the configured number of reads instead of spinning forever.
- A clock that steps backwards throws `ClockMovedBackwardsError`; generation resumes once time catches up. Worker ids outside 0..1023 are rejected.
- Base62 round-trips every id; a 63-bit id fits in 11 characters.
- UUIDv7 strings match the version-7 / variant-10 layout, sort in time order, and expose their timestamp.
- ULIDs are valid Crockford base32, unique, sort lexicographically in creation order even with 10 ids per millisecond, and decode to the right time.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `SnowflakeGenerator.next` | O(1); bounded clock re-reads on sequence overflow | O(1) per generator; 8-byte ids |
| `decode`, `decodeSnowflake` | O(1) | O(1) |
| `encodeBase62` / `decodeBase62` | O(digits), 11 for 64 bits | O(digits) |
| `UuidV7Generator.next` | O(1) | 16-byte ids (36 chars as text) |
| `UlidGenerator.next` | O(1) | 16-byte ids (26 chars as text) |

## Production notes

- Twitter's original Snowflake (2010) used this 41/10/12 layout with its own epoch and split the 10 bits into datacenter and worker. Discord uses Snowflakes with a 2015 epoch and the 10 bits split into worker and process ids.
- Instagram generated 64-bit ids inside PostgreSQL with 41 bits of time, 13 bits of logical shard id and a 10-bit per-shard sequence, so the shard is recoverable from the id. Sonyflake uses 39 bits of 10 ms units, an 8-bit sequence and a 16-bit machine id, trading throughput per machine for a longer lifetime.
- Worker ids must be unique: real deployments take them from configuration, a ZooKeeper/etcd lease or the pod ordinal. Two workers with the same id produce duplicates.
- The sequence restarts at 0 each millisecond, so at low traffic most ids end in 0; sharding by `id % N` would skew. Hash the id first.
- UUIDv7 is standardised in RFC 9562 (2024) and PostgreSQL 18 ships a built-in `uuidv7()` function. The RFC permits a counter in `rand_a` for monotonicity within a millisecond; this generator uses random bits there.
- The ULID spec asks generators to increment the random part within a millisecond, as done here; with a cryptographic rng instead of the injected one, ids are also hard to guess.
