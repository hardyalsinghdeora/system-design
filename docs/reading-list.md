# Reading list

What to read, why it matters and which notes or problems in this repository it supports. Links are given only where the address is stable and well known; otherwise search by title and authors.

## Books

| Book | Why it matters | Supports |
|---|---|---|
| *Designing Data-Intensive Applications*, Martin Kleppmann | The best single book on replication, partitioning, transactions, consistency and stream processing; explains why systems behave as they do | [replication](../fundamentals/replication.md), [transactions-and-isolation](../fundamentals/transactions-and-isolation.md), [consistency-models](../fundamentals/consistency-models.md), [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md) |
| *System Design Interview, Volume 1*, Alex Xu | Worked interview problems in the shape interviewers expect; good for pacing and coverage | [url-shortener](../problems/url-shortener.md), [rate-limiter](../problems/rate-limiter.md), [news-feed](../problems/news-feed.md), [chat-system](../problems/chat-system.md), [web-crawler](../problems/web-crawler.md) |
| *System Design Interview, Volume 2*, Alex Xu and Sahn Lam | Harder problems: proximity, maps, payments, exchanges, metrics | [proximity-service](../problems/proximity-service.md), [payment-system](../problems/payment-system.md), [stock-exchange](../problems/stock-exchange.md), [ad-click-aggregation](../problems/ad-click-aggregation.md) |
| *Database Internals*, Alex Petrov | Storage engines (B-trees, LSM trees) and distributed systems algorithms in depth | [storage-engines](../fundamentals/storage-engines.md), [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [src/lsm-tree/](../src/lsm-tree/) |
| *Release It!*, Michael Nygard | Stability patterns from production failures: timeouts, circuit breakers, bulkheads | [resilience-patterns](../fundamentals/resilience-patterns.md), [rate-limiting](../fundamentals/rate-limiting.md) |
| *Site Reliability Engineering*, Google (Beyer, Jones, Petoff, Murphy, eds.) | SLOs, error budgets, monitoring, load shedding and incident practice | [observability](../fundamentals/observability.md), [metrics-monitoring](../problems/metrics-monitoring.md), [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md) |
| *Building Microservices*, Sam Newman | How to draw service boundaries and what distribution costs | [microservices-and-boundaries](../fundamentals/microservices-and-boundaries.md), [event-driven-architecture](../fundamentals/event-driven-architecture.md), [distributed-transactions](../fundamentals/distributed-transactions.md) |

Order if time is short: Kleppmann first, then Xu volume 1 for interview shape, then the rest by weak area.

## Foundational papers

| Paper | Why it matters | Supports |
|---|---|---|
| [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf), DeCandia et al., SOSP 2007 | Consistent hashing, sloppy quorums, hinted handoff, vector clocks and Merkle-tree anti-entropy in one design | [key-value-store](../problems/key-value-store.md), [consistent-hashing](../fundamentals/consistent-hashing.md), [replication](../fundamentals/replication.md), [src/quorum-kv/](../src/quorum-kv/), [src/merkle-tree/](../src/merkle-tree/) |
| *Bigtable: A Distributed Storage System for Structured Data*, Chang, Dean, Ghemawat et al., OSDI 2006 | The wide-column model, tablets, memtables and SSTables | [storage-engines](../fundamentals/storage-engines.md), [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md), [src/lsm-tree/](../src/lsm-tree/) |
| *The Google File System*, Ghemawat, Gobioff and Leung, SOSP 2003 | Single-master metadata with chunked, replicated data; the template for large-file storage | [object-storage](../problems/object-storage.md), [file-storage-sync](../problems/file-storage-sync.md), [cdn-and-blob-storage](../fundamentals/cdn-and-blob-storage.md) |
| *MapReduce: Simplified Data Processing on Large Clusters*, Dean and Ghemawat, OSDI 2004 | Map, shuffle, reduce, and fault tolerance by re-execution | [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md), [web-crawler](../problems/web-crawler.md) |
| *Spanner: Google's Globally-Distributed Database*, Corbett et al., OSDI 2012 | Externally consistent transactions across regions using TrueTime and commit wait | [distributed-transactions](../fundamentals/distributed-transactions.md), [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md), [consistency-models](../fundamentals/consistency-models.md) |
| *The Chubby Lock Service for Loosely-Coupled Distributed Systems*, Mike Burrows, OSDI 2006 | Coarse-grained locks, leases and sequencers (fencing) built on Paxos | [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [src/lease-lock/](../src/lease-lock/), [distributed-job-scheduler](../problems/distributed-job-scheduler.md) |
| [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf), Ongaro and Ousterhout, USENIX ATC 2014 | Leader election, log replication and safety explained clearly enough to implement | [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [replication](../fundamentals/replication.md), [distributed-message-queue](../problems/distributed-message-queue.md) |
| *Kafka: a Distributed Messaging System for Log Processing*, Kreps, Narkhede and Rao, NetDB 2011 | The partitioned append-only log with consumer-managed offsets | [message-queues-and-streams](../fundamentals/message-queues-and-streams.md), [distributed-message-queue](../problems/distributed-message-queue.md), [event-driven-architecture](../fundamentals/event-driven-architecture.md) |
| *Cassandra: A Decentralized Structured Storage System*, Lakshman and Malik | Dynamo-style distribution combined with the Bigtable data model | [key-value-store](../problems/key-value-store.md), [chat-system](../problems/chat-system.md), [replication](../fundamentals/replication.md) |
| *Time, Clocks, and the Ordering of Events in a Distributed System*, Leslie Lamport, Communications of the ACM, 1978 | Happened-before, logical clocks and why wall clocks cannot order events | [consistency-models](../fundamentals/consistency-models.md), [id-generation](../fundamentals/id-generation.md), [src/vector-clock/](../src/vector-clock/) |
| *Harvest, Yield, and Scalable Tolerant Systems*, Fox and Brewer, HotOS 1999 | Degrade by returning partial answers (harvest) rather than failing requests (yield); an early framing of CAP trade-offs | [cap-and-pacelc](../fundamentals/cap-and-pacelc.md), [resilience-patterns](../fundamentals/resilience-patterns.md) |
| *The Tail at Scale*, Dean and Barroso, Communications of the ACM, 2013 | Why p99 latency dominates fan-out requests, and hedged and tied requests as fixes | [observability](../fundamentals/observability.md), [resilience-patterns](../fundamentals/resilience-patterns.md), [search-autocomplete](../problems/search-autocomplete.md) |

How to read a paper for interviews: the abstract, the design section and the evaluation's main claim. Note the one mechanism you would reuse (for Dynamo, sloppy quorum plus hinted handoff) and the trade-off it made.

## Further papers

Read these after the list above, when a problem leans on the topic.

| Paper | Why it matters | Supports |
|---|---|---|
| *Paxos Made Simple*, Leslie Lamport, 2001 | The short, readable statement of Paxos; useful context for why Raft was written | [consensus-and-coordination](../fundamentals/consensus-and-coordination.md) |
| *ZooKeeper: Wait-free Coordination for Internet-scale Systems*, Hunt, Konar, Junqueira and Reed, USENIX ATC 2010 | Coordination primitives (znodes, watches, ephemeral nodes) clients compose into locks and elections | [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [distributed-job-scheduler](../problems/distributed-job-scheduler.md) |
| *CAP Twelve Years Later: How the "Rules" Have Changed*, Eric Brewer, IEEE Computer, 2012 | The author of CAP on what the theorem does and does not say | [cap-and-pacelc](../fundamentals/cap-and-pacelc.md) |
| *Consistency Tradeoffs in Modern Distributed Database System Design*, Daniel Abadi, IEEE Computer, 2012 | Introduces PACELC: the latency versus consistency choice when there is no partition | [cap-and-pacelc](../fundamentals/cap-and-pacelc.md), [consistency-models](../fundamentals/consistency-models.md) |
| *Linearizability: A Correctness Condition for Concurrent Objects*, Herlihy and Wing, 1990 | The formal definition behind "strong consistency" | [consistency-models](../fundamentals/consistency-models.md) |
| *HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm*, Flajolet, Fusy, Gandouet and Meunier, 2007 | Distinct counting in kilobytes with a known error bound | [bloom-filters-and-probabilistic](../fundamentals/bloom-filters-and-probabilistic.md), [src/hyperloglog/](../src/hyperloglog/) |
| *Space/Time Trade-offs in Hash Coding with Allowable Errors*, Burton Bloom, 1970 | The original Bloom filter | [bloom-filters-and-probabilistic](../fundamentals/bloom-filters-and-probabilistic.md), [src/bloom-filter/](../src/bloom-filter/) |
| *Consistent Hashing and Random Trees*, Karger et al., STOC 1997 | The origin of consistent hashing, motivated by web caching | [consistent-hashing](../fundamentals/consistent-hashing.md), [src/consistent-hash-ring/](../src/consistent-hash-ring/) |
| *The Log-Structured Merge-Tree (LSM-Tree)*, O'Neil, Cheng, Gawlick and O'Neil, 1996 | The write-optimised structure under Cassandra, RocksDB and Bigtable | [storage-engines](../fundamentals/storage-engines.md), [src/lsm-tree/](../src/lsm-tree/) |
| *Sagas*, Garcia-Molina and Salem, SIGMOD 1987 | Long-lived transactions as steps with compensations | [distributed-transactions](../fundamentals/distributed-transactions.md), [ecommerce-platform](../problems/ecommerce-platform.md) |

## By weak area

If an interviewer's follow-up keeps catching you on one topic, read the matching entry first.

| Weak area | Read | Then practise |
|---|---|---|
| Consistency and isolation vocabulary | Kleppmann on transactions and consistency; Herlihy and Wing | [ticket-booking](../problems/ticket-booking.md) |
| Partitioning and hot keys | Kleppmann on partitioning; Dynamo | [distributed-counter](../problems/distributed-counter.md), [top-k-trending](../problems/top-k-trending.md) |
| Consensus and leader election | Raft; Chubby; ZooKeeper | [distributed-job-scheduler](../problems/distributed-job-scheduler.md) |
| Storage engines | Database Internals part one; the LSM-tree paper; Bigtable | [key-value-store](../problems/key-value-store.md) |
| Queues and streams | Kafka paper; Kleppmann on stream processing | [distributed-message-queue](../problems/distributed-message-queue.md), [webhook-delivery-system](../problems/webhook-delivery-system.md) |
| Reliability and failure handling | Release It!; The Tail at Scale; SRE book | [notification-system](../problems/notification-system.md) |
| Global systems | Spanner; Brewer on CAP; Abadi on PACELC | [payment-system](../problems/payment-system.md), [chat-system](../problems/chat-system.md) |
| Probabilistic structures | Bloom; HyperLogLog | [web-crawler](../problems/web-crawler.md), [ad-click-aggregation](../problems/ad-click-aggregation.md) |

## Engineering blogs

Company engineering blogs are the best source of how designs change under real load. Read them in general terms, looking for:

| Look for | Why | Supports |
|---|---|---|
| Migration stories (one database to another, monolith to services) | Show expand-and-contract and dual-write pitfalls in practice | [common-deep-dives](./common-deep-dives.md), [transactional-outbox-and-cdc](../fundamentals/transactional-outbox-and-cdc.md) |
| Postmortems and incident reviews | Show real failure modes: retry storms, cache stampedes, split brain | [resilience-patterns](../fundamentals/resilience-patterns.md), [consensus-and-coordination](../fundamentals/consensus-and-coordination.md) |
| Feed, timeline and messaging architecture posts | Fan-out choices, hot keys and storage for chat history | [news-feed](../problems/news-feed.md), [chat-system](../problems/chat-system.md), [instagram](../problems/instagram.md) |
| Payments and ledger posts | Idempotency keys, double-entry ledgers, reconciliation | [payment-system](../problems/payment-system.md), [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md) |
| Video and CDN posts | Encoding ladders, adaptive bitrate, edge caching | [video-streaming](../problems/video-streaming.md), [cdn-and-blob-storage](../fundamentals/cdn-and-blob-storage.md) |
| Dispatch and geospatial posts | Location indexing, matching and real-time updates | [ride-hailing](../problems/ride-hailing.md), [geospatial-indexing](../fundamentals/geospatial-indexing.md) |
| Metrics and observability platform posts | High-cardinality storage, downsampling, alerting pipelines | [metrics-monitoring](../problems/metrics-monitoring.md), [observability](../fundamentals/observability.md) |

Treat blog numbers as one company's workload, not a benchmark. Quote them as "one large company reported" and only when you remember them well.

## A four-week plan

| Week | Read | Practise |
|---|---|---|
| 1 | Kleppmann chapters on storage, replication and partitioning; Dynamo | [key-value-store](../problems/key-value-store.md), [url-shortener](../problems/url-shortener.md) |
| 2 | Kleppmann on transactions and consistency; Raft; Chubby | [ticket-booking](../problems/ticket-booking.md), [distributed-job-scheduler](../problems/distributed-job-scheduler.md) |
| 3 | Kleppmann on stream processing; Kafka paper; MapReduce | [ad-click-aggregation](../problems/ad-click-aggregation.md), [news-feed](../problems/news-feed.md) |
| 4 | Release It! stability patterns; The Tail at Scale; SRE chapters on SLOs | [payment-system](../problems/payment-system.md), [chat-system](../problems/chat-system.md) |

Each week, run one problem end to end with [`interview-framework.md`](./interview-framework.md) and check estimates with [`back-of-envelope.md`](./back-of-envelope.md).
