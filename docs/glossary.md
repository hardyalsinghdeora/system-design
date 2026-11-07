# Glossary

Short definitions of the terms used across this repository, A to Z. Where a fundamentals note covers the term, the link points to it. For the interview context of a term, see [`common-deep-dives.md`](./common-deep-dives.md) and [`technology-picker.md`](./technology-picker.md).

## A

- **ACID**: Atomicity, consistency, isolation, durability; the guarantees of a database transaction. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Active-active**: Several regions serve writes at the same time; needs conflict handling or entity ownership. [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md)
- **Active-passive**: One region serves traffic; a standby takes over on failure. [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md)
- **Anti-entropy**: Background comparison of replicas (often with Merkle trees) to repair divergence. [replication](../fundamentals/replication.md)
- **API gateway**: Single entry point that handles routing, auth, rate limits and request shaping for backend services. [api-design](../fundamentals/api-design.md)
- **At-least-once delivery**: Every message is delivered one or more times; consumers must tolerate duplicates. [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md)
- **At-most-once delivery**: Messages are delivered zero or one time; loss is possible, duplicates are not. [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md)
- **Availability zone**: An isolated datacenter (or group) within a region with independent power and networking. [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md)

## B

- **Back-of-the-envelope estimate**: Rough arithmetic on QPS, storage and bandwidth to find the numbers that shape a design. [back-of-envelope](./back-of-envelope.md)
- **Backpressure**: A signal from a slow consumer that makes producers slow down, buffer or drop. [resilience-patterns](../fundamentals/resilience-patterns.md)
- **Batch processing**: Processing a bounded dataset in one job, trading latency for throughput. [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md)
- **Bloom filter**: Bit array plus hash functions answering "definitely not present" or "probably present". [bloom-filters-and-probabilistic](../fundamentals/bloom-filters-and-probabilistic.md), [src/bloom-filter/](../src/bloom-filter/)
- **B-tree**: Balanced on-disk tree with in-place page updates; the default index in relational databases. [storage-engines](../fundamentals/storage-engines.md)
- **Bulkhead**: Isolating resources (thread pools, connections) per dependency so one failure cannot exhaust them all. [resilience-patterns](../fundamentals/resilience-patterns.md)

## C

- **Cache-aside**: The application reads the cache, loads from the database on a miss and populates the cache. [caching-strategies](../fundamentals/caching-strategies.md)
- **CAP theorem**: During a network partition a system must choose between consistency and availability. [cap-and-pacelc](../fundamentals/cap-and-pacelc.md)
- **Change data capture (CDC)**: Streaming a database's committed changes from its log to other systems. [transactional-outbox-and-cdc](../fundamentals/transactional-outbox-and-cdc.md)
- **CDN**: Content delivery network; edge caches that serve static and cacheable content close to users. [cdn-and-blob-storage](../fundamentals/cdn-and-blob-storage.md)
- **Circuit breaker**: Stops calling a failing dependency for a cool-down period, then probes before resuming. [resilience-patterns](../fundamentals/resilience-patterns.md)
- **Compaction**: Merging and rewriting storage files (SSTables) to drop overwritten and deleted entries. [storage-engines](../fundamentals/storage-engines.md), [src/lsm-tree/](../src/lsm-tree/)
- **Consensus**: Agreement among nodes on a value or log order despite failures (Raft, Paxos). [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
- **Consistent hashing**: Mapping keys and nodes onto a ring so adding a node moves only about 1/N of keys. [consistent-hashing](../fundamentals/consistent-hashing.md), [src/consistent-hash-ring/](../src/consistent-hash-ring/)
- **Consumer group**: Set of consumers that share a topic's partitions so each message is processed by one member. [message-queues-and-streams](../fundamentals/message-queues-and-streams.md)
- **Count-min sketch**: Fixed-size table of counters that estimates item frequencies with one-sided error. [bloom-filters-and-probabilistic](../fundamentals/bloom-filters-and-probabilistic.md), [src/count-min-sketch/](../src/count-min-sketch/)
- **CQRS**: Command query responsibility segregation; separate models for writes and reads. [event-driven-architecture](../fundamentals/event-driven-architecture.md)
- **CRDT**: Conflict-free replicated data type; merges concurrent updates deterministically without coordination. [consistency-models](../fundamentals/consistency-models.md)

## D

- **Dead-letter queue (DLQ)**: Queue that receives messages that failed processing after the retry limit. [message-queues-and-streams](../fundamentals/message-queues-and-streams.md)
- **Denormalization**: Storing redundant copies of data to avoid joins on the read path. [choosing-a-database](../fundamentals/choosing-a-database.md)
- **Distributed transaction**: A transaction spanning several databases or services. [distributed-transactions](../fundamentals/distributed-transactions.md)
- **Dual write**: Writing to two systems from application code without atomicity; a common source of inconsistency. [transactional-outbox-and-cdc](../fundamentals/transactional-outbox-and-cdc.md)
- **Durability**: Acknowledged writes survive crashes, usually via a write-ahead log and replication. [storage-engines](../fundamentals/storage-engines.md)

## E

- **Event-driven architecture**: Services communicate by publishing and reacting to events instead of direct calls. [event-driven-architecture](../fundamentals/event-driven-architecture.md)
- **Event sourcing**: Storing the sequence of events as the source of truth and deriving state by replaying them. [event-driven-architecture](../fundamentals/event-driven-architecture.md)
- **Eventual consistency**: Replicas converge if writes stop; reads may be stale in the meantime. [consistency-models](../fundamentals/consistency-models.md)
- **Exactly-once processing**: The effect of each message is applied once; in practice at-least-once delivery plus idempotency. [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md)
- **Expand and contract**: Migration pattern: add the new shape, migrate, then remove the old. [common-deep-dives](./common-deep-dives.md)
- **Exponential backoff**: Retry delays that grow geometrically, usually with jitter. [resilience-patterns](../fundamentals/resilience-patterns.md)

## F

- **Failover**: Promoting a replica or standby when the primary fails. [replication](../fundamentals/replication.md)
- **Fan-out on read / write**: Building a feed when it is read (pull) or copying each post into followers' feeds when it is written (push). [news-feed](../problems/news-feed.md)
- **Fencing token**: Monotonically increasing number issued with a lock; storage rejects writes with an older token. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [src/lease-lock/](../src/lease-lock/)
- **Fixed window counter**: Rate-limiting algorithm counting requests per fixed time window. [rate-limiting](../fundamentals/rate-limiting.md)

## G

- **Geohash**: Encoding of latitude and longitude into a string whose shared prefix means nearby cells. [geospatial-indexing](../fundamentals/geospatial-indexing.md), [src/geohash/](../src/geohash/)
- **Gossip protocol**: Nodes periodically exchange state with random peers so information spreads through the cluster. [replication](../fundamentals/replication.md)
- **GraphQL**: Query language letting clients request exactly the fields they need from one endpoint. [api-design](../fundamentals/api-design.md)
- **gRPC**: RPC framework over HTTP/2 with Protocol Buffers schemas and streaming. [api-design](../fundamentals/api-design.md)

## H

- **Health check**: Periodic probe a load balancer uses to remove unhealthy instances. [load-balancing](../fundamentals/load-balancing.md)
- **Hinted handoff**: A node temporarily stores writes for an unavailable replica and forwards them later. [replication](../fundamentals/replication.md)
- **Horizontal scaling**: Adding machines rather than making one machine bigger. [load-balancing](../fundamentals/load-balancing.md)
- **Hot partition / hot key**: A partition or key receiving disproportionate traffic. [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md)
- **HyperLogLog**: Sketch that estimates distinct counts in kilobytes with about 1-2 % error. [bloom-filters-and-probabilistic](../fundamentals/bloom-filters-and-probabilistic.md), [src/hyperloglog/](../src/hyperloglog/)

## I

- **Idempotency**: Applying an operation more than once has the same effect as applying it once. [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md)
- **Idempotency key**: Client-supplied unique key the server uses to detect and replay a repeated request. [delivery-semantics-and-idempotency](../fundamentals/delivery-semantics-and-idempotency.md), [src/idempotency-store/](../src/idempotency-store/)
- **Inverted index**: Map from term to the list of documents containing it; the core of full-text search. [search-and-indexing](../fundamentals/search-and-indexing.md), [src/inverted-index/](../src/inverted-index/)
- **Isolation level**: How much concurrent transactions can see of each other (read committed, repeatable read, serializable). [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)

## J

- **Jitter**: Randomness added to timers and retries to avoid synchronised load spikes. [resilience-patterns](../fundamentals/resilience-patterns.md)
- **JWT**: JSON Web Token; a signed token carrying claims, verifiable without a database lookup. [security-basics](../fundamentals/security-basics.md)

## K

- **Keyset pagination**: Paging by "rows after this sort key" instead of an offset; one index seek per page. [api-design](../fundamentals/api-design.md)
- **Key-value store**: Database that reads and writes values by key with minimal query features. [choosing-a-database](../fundamentals/choosing-a-database.md), [key-value-store](../problems/key-value-store.md)

## L

- **Lamport clock**: Logical counter that orders events consistently with causality. [consistency-models](../fundamentals/consistency-models.md)
- **Leader election**: Choosing one node to coordinate, usually through consensus or a lease. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
- **Leaky bucket**: Rate-limiting algorithm that drains requests at a constant rate. [rate-limiting](../fundamentals/rate-limiting.md), [src/rate-limiter-algorithms/](../src/rate-limiter-algorithms/)
- **Lease**: A lock with an expiry; the holder must renew it or lose it. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md), [src/lease-lock/](../src/lease-lock/)
- **Linearizability**: Every operation appears to take effect atomically at one point between its start and end. [consistency-models](../fundamentals/consistency-models.md)
- **Load balancer (L4 / L7)**: Distributes connections (L4) or requests (L7) across backends. [load-balancing](../fundamentals/load-balancing.md)
- **Long polling**: The server holds a request open until data is available or a timeout passes. [realtime-communication](../fundamentals/realtime-communication.md)
- **LSM tree**: Log-structured merge tree; buffers writes in memory and flushes sorted files merged by compaction. [storage-engines](../fundamentals/storage-engines.md), [src/lsm-tree/](../src/lsm-tree/)

## M

- **MapReduce**: Batch model of parallel map tasks, a shuffle by key and reduce tasks. [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md)
- **Merkle tree**: Tree of hashes where each parent hashes its children; finds differing ranges quickly. [replication](../fundamentals/replication.md), [src/merkle-tree/](../src/merkle-tree/)
- **Microservices**: Independently deployable services, each owning its data and a bounded business capability. [microservices-and-boundaries](../fundamentals/microservices-and-boundaries.md)
- **mTLS**: Mutual TLS; both client and server present certificates. [security-basics](../fundamentals/security-basics.md)
- **Multi-leader replication**: Several nodes accept writes and replicate to each other; conflicts must be resolved. [replication](../fundamentals/replication.md)
- **MVCC**: Multi-version concurrency control; readers see a snapshot while writers create new versions. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)

## N

- **Network partition**: A failure that splits nodes into groups that cannot communicate. [cap-and-pacelc](../fundamentals/cap-and-pacelc.md)
- **Normalization**: Structuring relational data so each fact is stored once. [choosing-a-database](../fundamentals/choosing-a-database.md)

## O

- **OAuth 2.0**: Authorization framework for delegated access via access tokens. [security-basics](../fundamentals/security-basics.md)
- **Object storage**: Flat namespace of immutable blobs addressed by key, such as S3. [cdn-and-blob-storage](../fundamentals/cdn-and-blob-storage.md), [object-storage](../problems/object-storage.md)
- **Observability**: Ability to understand system behaviour from metrics, logs and traces. [observability](../fundamentals/observability.md)
- **Optimistic concurrency control**: Proceed without locks and check a version at commit; retry on conflict. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Outbox (transactional)**: Write the event to an outbox table in the same transaction as the data; a relay publishes it. [transactional-outbox-and-cdc](../fundamentals/transactional-outbox-and-cdc.md)

## P

- **PACELC**: Extends CAP: if partitioned choose A or C, else choose latency or consistency. [cap-and-pacelc](../fundamentals/cap-and-pacelc.md)
- **Partition key**: Attribute whose hash or range decides which shard holds a record. [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md)
- **Paxos**: Consensus protocol by Lamport; the basis of many coordination services. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
- **Percentile latency (p50, p99)**: The latency below which that fraction of requests complete. [observability](../fundamentals/observability.md)
- **Pessimistic locking**: Take a lock before reading data you intend to change. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Phantom read**: A repeated range query returns new rows inserted by another transaction. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Presigned URL**: Time-limited URL granting direct upload or download to object storage. [cdn-and-blob-storage](../fundamentals/cdn-and-blob-storage.md)
- **Pub/sub**: Publishers send to a topic; every subscriber receives a copy. [message-queues-and-streams](../fundamentals/message-queues-and-streams.md)

## Q

- **Quorum**: Minimum number of replicas (often a majority) that must respond; R + W > N gives overlapping reads and writes. [replication](../fundamentals/replication.md), [src/quorum-kv/](../src/quorum-kv/)
- **Queue**: Buffer where each message is consumed by one worker. [message-queues-and-streams](../fundamentals/message-queues-and-streams.md)

## R

- **Raft**: Consensus protocol built around a leader, terms and a replicated log. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
- **Rate limiting**: Capping how many requests a client can make in a period. [rate-limiting](../fundamentals/rate-limiting.md), [rate-limiter](../problems/rate-limiter.md)
- **Read replica**: Copy of the primary that serves reads, usually with replication lag. [replication](../fundamentals/replication.md)
- **Read-your-writes**: A user always sees their own earlier writes. [consistency-models](../fundamentals/consistency-models.md)
- **Rebalancing**: Moving partitions between nodes when the cluster changes size. [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md)
- **Replication lag**: Delay between a write on the leader and its visibility on a follower. [replication](../fundamentals/replication.md)
- **REST**: Resource-oriented HTTP API style using standard methods and status codes. [api-design](../fundamentals/api-design.md)
- **Reverse proxy**: Server that accepts client requests and forwards them to backends. [load-balancing](../fundamentals/load-balancing.md)
- **RPO / RTO**: Recovery point objective (data you may lose) and recovery time objective (time to restore). [multi-region-and-disaster-recovery](../fundamentals/multi-region-and-disaster-recovery.md)

## S

- **Saga**: Sequence of local transactions with compensating actions instead of one distributed transaction. [distributed-transactions](../fundamentals/distributed-transactions.md)
- **Serializability**: Concurrent transactions produce a result equal to some serial order. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Server-sent events (SSE)**: One-way stream of events from server to client over HTTP. [realtime-communication](../fundamentals/realtime-communication.md)
- **Service discovery**: Mechanism for services to find the current addresses of other services. [microservices-and-boundaries](../fundamentals/microservices-and-boundaries.md)
- **Sharding**: Splitting data across nodes by a partition key. [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md)
- **SLI / SLO / SLA**: Indicator measured, objective targeted, and agreement promised to customers. [observability](../fundamentals/observability.md)
- **Sliding window**: Rate-limiting algorithm counting requests over a rolling period. [rate-limiting](../fundamentals/rate-limiting.md), [src/rate-limiter-algorithms/](../src/rate-limiter-algorithms/)
- **Snapshot isolation**: Each transaction reads a consistent snapshot; write skew remains possible. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)
- **Snowflake ID**: 64-bit id of timestamp, machine id and sequence; roughly time-ordered. [id-generation](../fundamentals/id-generation.md), [src/snowflake-id/](../src/snowflake-id/)
- **Split brain**: Two nodes both act as leader after a partition. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
- **SSTable**: Sorted string table; immutable sorted file of key-value pairs used by LSM trees. [storage-engines](../fundamentals/storage-engines.md)
- **Sticky session**: Load balancer routes a client to the same backend each time. [load-balancing](../fundamentals/load-balancing.md)
- **Stream processing**: Continuous processing of unbounded event streams. [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md)
- **Strong consistency**: Reads reflect all acknowledged writes; often used to mean linearizable. [consistency-models](../fundamentals/consistency-models.md)

## T

- **Tail latency**: The slow end of the latency distribution (p99, p99.9), which dominates fan-out requests. [observability](../fundamentals/observability.md)
- **Thundering herd**: Many clients hit a resource at once, often after a cache expiry or recovery. [caching-strategies](../fundamentals/caching-strategies.md)
- **Timeout**: Upper bound on how long a caller waits; every remote call needs one. [resilience-patterns](../fundamentals/resilience-patterns.md)
- **Timing wheel**: Circular array of buckets for scheduling many timers at O(1) cost. [distributed-job-scheduler](../problems/distributed-job-scheduler.md), [src/timing-wheel/](../src/timing-wheel/)
- **Token bucket**: Rate-limiting algorithm that refills tokens at a fixed rate and allows bursts up to capacity. [rate-limiting](../fundamentals/rate-limiting.md), [src/rate-limiter-algorithms/](../src/rate-limiter-algorithms/)
- **Tombstone**: Marker recording a deletion until compaction removes it. [storage-engines](../fundamentals/storage-engines.md)
- **Tracing (distributed)**: Following one request across services via propagated trace and span ids. [observability](../fundamentals/observability.md)
- **Trie**: Prefix tree; each path from the root spells a prefix. [search-and-indexing](../fundamentals/search-and-indexing.md), [src/trie-autocomplete/](../src/trie-autocomplete/)
- **TTL**: Time to live; expiry after which a cache entry or record is removed. [caching-strategies](../fundamentals/caching-strategies.md)
- **Two-phase commit (2PC)**: Coordinator asks participants to prepare, then commit; blocks if the coordinator fails. [distributed-transactions](../fundamentals/distributed-transactions.md)

## U

- **UUID**: 128-bit identifier; v4 is random, v7 is time-ordered. [id-generation](../fundamentals/id-generation.md)

## V

- **Vector clock**: Per-node counters that detect whether two versions are ordered or concurrent. [consistency-models](../fundamentals/consistency-models.md), [src/vector-clock/](../src/vector-clock/)
- **Vertical scaling**: Moving to a bigger machine; simple, with a hard ceiling.
- **Virtual nodes**: Many ring positions per physical node to even out load in consistent hashing. [consistent-hashing](../fundamentals/consistent-hashing.md)

## W

- **Watermark**: A stream processor's estimate that no events older than time T are still to come. [batch-and-stream-processing](../fundamentals/batch-and-stream-processing.md)
- **WebSocket**: Persistent bidirectional connection upgraded from HTTP. [realtime-communication](../fundamentals/realtime-communication.md)
- **Write amplification**: Bytes written to disk per byte written by the application. [storage-engines](../fundamentals/storage-engines.md)
- **Write-ahead log (WAL)**: Append-only log of changes written before applying them, for crash recovery. [storage-engines](../fundamentals/storage-engines.md)
- **Write-back cache**: Writes go to the cache and are flushed to the database later; fast, can lose data. [caching-strategies](../fundamentals/caching-strategies.md)
- **Write-through cache**: Writes go to cache and database together; reads stay fresh. [caching-strategies](../fundamentals/caching-strategies.md)
- **Write skew**: Two transactions read overlapping data and write disjoint rows, breaking an invariant. [transactions-and-isolation](../fundamentals/transactions-and-isolation.md)

## Z

- **Zipf distribution**: Popularity distribution where a few items take most of the traffic; why hot keys exist. [sharding-and-partitioning](../fundamentals/sharding-and-partitioning.md)
- **ZooKeeper**: Coordination service offering ordered, consistent znodes, watches and ephemeral nodes. [consensus-and-coordination](../fundamentals/consensus-and-coordination.md)
