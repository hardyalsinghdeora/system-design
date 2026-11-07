# Back-of-the-envelope cheat sheet

## Powers of two

| Power | Exact | Approx | Bytes |
|---|---|---|---|
| 2^10 | 1,024 | 1 thousand | 1 KB |
| 2^20 | 1,048,576 | 1 million | 1 MB |
| 2^30 | 1,073,741,824 | 1 billion | 1 GB |
| 2^40 | ~1.1 × 10^12 | 1 trillion | 1 TB |
| 2^50 | ~1.1 × 10^15 | 1 quadrillion | 1 PB |

## Latency numbers every engineer should know (2020s hardware)

| Operation | Latency |
|---|---|
| L1 cache reference | 1 ns |
| Branch mispredict | 3 ns |
| L2 cache reference | 4 ns |
| Mutex lock/unlock | 17 ns |
| Main memory reference | 100 ns |
| Compress 1 KB with Snappy | 2 µs |
| Send 2 KB over 10 Gbps network | 2 µs |
| Read 1 MB sequentially from memory | 3 µs |
| SSD random read | 16 µs |
| Read 1 MB sequentially from SSD | 50 µs |
| Round trip within the same datacenter | 500 µs |
| Read 1 MB sequentially from spinning disk | 1 ms |
| Disk seek | 2 ms |
| Round trip India → Singapore | ~35 ms |
| Round trip India → US west coast | ~220 ms |

Take-aways: memory is ~100× faster than SSD, SSD ~20× faster than disk, a cross-region hop costs more than any single disk read, and one datacenter round trip is half a millisecond so chatty service calls add up.

## Availability

| Availability | Downtime per year | Per month |
|---|---|---|
| 99 % | 3.65 days | 7.3 h |
| 99.9 % | 8.77 h | 43.8 min |
| 99.99 % | 52.6 min | 4.4 min |
| 99.999 % | 5.26 min | 26 s |

Serial dependencies multiply: two 99.9 % services in a row give 99.8 %.

## Handy conversions

- 1 day ≈ 86,400 s ≈ 10^5 s (use 10^5 for mental math; the error is 15 %).
- 1 million requests/day ≈ 12 requests/s. 100 million/day ≈ 1,150/s. 1 billion/day ≈ 11,500/s.
- Peak traffic ≈ 2-3× average; plan capacity for peak.
- 1 month ≈ 2.6 million s; 1 year ≈ 31.5 million s.

## Typical sizes

| Item | Size |
|---|---|
| UUID / 64-bit id as text | 36 B / 20 B |
| Short text post | 300 B-1 KB |
| Row with a dozen columns | ~500 B |
| Image thumbnail / photo | 20 KB / 300 KB-2 MB |
| 1 minute of 1080p video | ~50-100 MB raw, 10-20 MB encoded |

## Typical single-node throughput (order of magnitude)

| System | Rough capacity |
|---|---|
| Postgres / MySQL primary | 5-10k simple writes/s, 50k+ reads/s with indexes |
| Redis | 100k+ ops/s per core |
| Kafka broker | 100 MB/s+, hundreds of thousands of msgs/s |
| Node.js service | 10-30k simple req/s per core |
| Nginx / L7 LB | 50-100k req/s per core |

## Worked example: URL shortener

- 100 M new URLs/month → 100 M / 2.6 M s ≈ 40 writes/s. Trivial.
- Read:write 100:1 → 4,000 redirects/s, peak ~10k/s. One Redis node handles it; shard for availability, not throughput.
- Storage: 100 M × 500 B/month = 50 GB/month, 3 TB over 5 years. Postgres is fine; partition by creation month.
- Cache the hot 20 %: 20 M × 500 B = 10 GB. Fits one Redis node.
