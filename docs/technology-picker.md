# Technology picker

Naming a technology is cheap; naming the reason is what scores. For each category below: the common choices, when to pick each, when to avoid it, and one sentence that shows you know the trade-off. Claims are deliberately conservative; quote capacities as orders of magnitude and say "it depends on the workload" when it does.

Rule of thumb: start with the boring default (Postgres, Redis, S3, a managed queue) and add a specialised store only when a requirement forces it. See [`choosing-a-database.md`](../fundamentals/choosing-a-database.md) for the decision process and [`storage-engines.md`](../fundamentals/storage-engines.md) for why the engines behave as they do.

## Relational (OLTP)

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Postgres | You need transactions, joins, constraints and flexible indexes; the default for most product data | Write volume exceeds one primary and the data does not shard cleanly by a tenant or user key | "Postgres until a single primary is the bottleneck; read replicas first, then shard by user id." |
| MySQL (InnoDB) | The team already runs it; large read-replica fleets; mature sharding tooling (Vitess) | You rely on Postgres-specific features (rich index types, extensions) | "Same role as Postgres here; Vitess gives a known path to horizontal sharding." |
| Aurora (Postgres/MySQL compatible) | You want a managed relational store with storage replicated across zones and fast replica failover | You need multi-region writes or want to avoid cloud lock-in | "Still a single writer; Aurora buys durability and fast failover, not write scale-out." |
| Spanner | Global strong consistency and horizontal write scaling with SQL; financial or inventory data across regions | Latency-sensitive single-region workloads where commit-wait and cross-region quorum cost too much; tight budget | "Externally consistent transactions across regions, paid for in commit latency." |
| CockroachDB | Spanner-like distributed SQL without being on Google Cloud; multi-region with Postgres wire protocol | Heavy single-row hot spots or workloads that one Postgres node already handles | "Distributed SQL with serializable isolation by default; expect higher per-write latency than a single node." |

Related: [`transactions-and-isolation.md`](../fundamentals/transactions-and-isolation.md), [`replication.md`](../fundamentals/replication.md), [`sharding-and-partitioning.md`](../fundamentals/sharding-and-partitioning.md).

## Key-value

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| DynamoDB | Access is by known key or key plus sort key; you want managed scaling and predictable single-digit-ms reads | You need ad-hoc queries, joins or many secondary access patterns you cannot predict | "Design the table around the access patterns; partition key spreads load, sort key orders within it." |
| Redis | Sub-millisecond reads, counters, sorted sets for leaderboards, rate limits, locks with leases, ephemeral state | It is the only copy of data you cannot lose; datasets much larger than memory | "Redis as a cache or for data structures; the source of truth lives elsewhere unless we accept losing recent writes." |
| etcd / FoundationDB (as KV) | Small, strongly consistent metadata (etcd) or a transactional ordered KV as a foundation for other systems (FoundationDB) | Bulk application data (etcd is sized for megabytes to a few gigabytes) | "etcd for configuration and coordination, not for user data." |

Related: [`key-value-store.md`](../problems/key-value-store.md), [`distributed-cache.md`](../problems/distributed-cache.md), [`src/quorum-kv/`](../src/quorum-kv/).

## Wide-column

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Cassandra | Very high write throughput, multi-datacenter replication, queries known up front (time series, messages, activity logs) | You need transactions across rows, joins, or frequent updates that create tombstones | "Model one table per query; partition key bounds partition size; tunable consistency with quorum reads and writes." |
| ScyllaDB | Same data model as Cassandra with a C++ engine that targets lower tail latency per node | The team has deep Cassandra operational tooling and no latency problem | "Cassandra-compatible; a choice about operations and cost, not about data model." |
| Bigtable | Google Cloud; huge sparse tables keyed by a row key, analytics or time series with row-key range scans | You need secondary indexes or multi-row transactions | "Row key design is everything: avoid monotonically increasing prefixes or one tablet gets all writes." |
| HBase | Hadoop ecosystem, Bigtable model on HDFS, strong consistency per row | You do not already run Hadoop; small teams | "Bigtable model with HDFS underneath; rarely the choice for a new system today." |

Related: [`chat-system.md`](../problems/chat-system.md), [`src/lsm-tree/`](../src/lsm-tree/).

## Document

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| MongoDB | Records are self-contained documents read and written as a unit; schema varies by record; product catalogs, content | Data is highly relational with many-to-many joins; you need multi-document transactions on the hot path | "Embed what is read together, reference what is shared; shard by a high-cardinality key." |
| DynamoDB / Firestore (document mode) | Managed document store with simple access patterns, mobile sync (Firestore) | Complex queries or aggregation | "Treat it as a key-value store with nested values." |

## Search

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Elasticsearch / OpenSearch | Full-text search, relevance ranking, faceting, log search; near-real-time indexing (refresh interval about a second by default) | It would be the system of record; strict read-after-write consistency is required | "Postgres is the source of truth; changes flow to the index via CDC; search results can lag by seconds." |
| Postgres full-text / trigram | Small to medium corpus, simple search, you want one fewer system | Relevance tuning, many languages, or high query volume | "Start with Postgres full-text; move to a search engine when relevance or scale demands it." |

Related: [`search-and-indexing.md`](../fundamentals/search-and-indexing.md), [`search-autocomplete.md`](../problems/search-autocomplete.md), [`src/inverted-index/`](../src/inverted-index/).

## Caches

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Redis | Shared cache with rich data types, TTLs, replication, optional persistence | You only need a local per-process cache | "Cache-aside with TTL plus jitter; protect the database from stampedes with request coalescing." |
| Memcached | Simple, multi-threaded key-value caching of blobs; easy horizontal scaling | You need data structures, persistence or replication | "Pure cache, nothing else; fine when values are opaque blobs." |
| In-process cache (LRU) | Very hot, small, rarely changing data (config, feature flags) | Data must be consistent across instances | "Local cache in front of Redis for the hottest keys; short TTL bounds staleness." |
| CDN | Static assets, images, video segments, cacheable API responses at the edge | Personalised or rapidly changing responses | "Push bytes to the edge; origin only sees cache misses." |

Related: [`caching-strategies.md`](../fundamentals/caching-strategies.md), [`cdn-and-blob-storage.md`](../fundamentals/cdn-and-blob-storage.md).

## Queues and logs

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Kafka | Durable, replayable, ordered-per-partition event log; many consumers reading the same stream; event sourcing and CDC | You need per-message routing, priorities, or delayed delivery; very low volume where operating it is not worth it | "Order is per partition, so the partition key is the ordering key; consumers track offsets and can replay." |
| RabbitMQ | Task queues with routing (topic, direct, fanout exchanges), per-message acks, priorities | You need long retention and replay by many independent consumers | "A broker for work distribution; messages leave the queue once acked." |
| SQS / SNS | Managed queue (SQS) and pub/sub fan-out (SNS) with no brokers to run; SQS FIFO when order per group matters | You need replay, very high ordered throughput, or cross-cloud portability | "SNS fans out to SQS queues per consumer; standard SQS is at-least-once and unordered, so handlers are idempotent." |
| Pulsar | Log semantics plus queue semantics, tiered storage, many topics, geo-replication built in | The team knows Kafka and has no need for its extra features | "Separates serving brokers from storage (BookKeeper), which eases scaling storage independently." |
| Postgres outbox + poller | Low to moderate event volume where you need the event to commit atomically with the row | Thousands of events per second across many consumers | "Before Kafka: outbox table in the same transaction, a relay publishes it." |

Related: [`message-queues-and-streams.md`](../fundamentals/message-queues-and-streams.md), [`delivery-semantics-and-idempotency.md`](../fundamentals/delivery-semantics-and-idempotency.md), [`transactional-outbox-and-cdc.md`](../fundamentals/transactional-outbox-and-cdc.md), [`distributed-message-queue.md`](../problems/distributed-message-queue.md).

## Stream processors

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Flink | Stateful stream processing with event-time windows, watermarks and checkpointed exactly-once state | Simple per-event transforms a consumer service can do | "Event-time tumbling windows with watermarks; checkpoints make state exactly-once, sinks must be idempotent or transactional." |
| Spark (Structured Streaming / batch) | Batch ETL and large joins; micro-batch streaming where seconds of latency are fine | Millisecond-latency per-event processing | "Spark for the nightly reconciliation batch; Flink or a consumer for the real-time path." |
| Kafka Streams | Stream processing as a library inside a JVM service, input and output both Kafka | Sources and sinks beyond Kafka, or non-JVM teams | "No separate cluster; state stores are backed by changelog topics." |

Related: [`batch-and-stream-processing.md`](../fundamentals/batch-and-stream-processing.md), [`ad-click-aggregation.md`](../problems/ad-click-aggregation.md), [`top-k-trending.md`](../problems/top-k-trending.md).

## OLAP and analytics

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| ClickHouse | Self-hosted columnar analytics, fast aggregations over large append-heavy tables, logs and events | Frequent row updates or deletes; OLTP access by primary key | "Columnar and compressed; great for GROUP BY over billions of rows, poor for point updates." |
| Druid | Real-time ingestion plus sub-second slice-and-dice on time-partitioned event data | Ad-hoc joins across large tables | "Time is the primary partition; rollup at ingest trades detail for speed." |
| Pinot | User-facing analytics with high query concurrency and low latency on fresh data | Small internal dashboards where a warehouse suffices | "Built for many concurrent queries from end users, not just analysts." |
| BigQuery | Serverless warehouse on Google Cloud; ad-hoc SQL over large data, pay per data scanned | Low-latency user-facing queries; high-frequency small queries | "Partition and cluster tables so queries scan less data." |
| Snowflake | Managed warehouse across clouds, separate storage and compute, many teams sharing data | Real-time serving paths | "Warehouse for analysts; not on the request path." |

Related: [`metrics-monitoring.md`](../problems/metrics-monitoring.md).

## Object storage

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| S3 / GCS / Azure Blob | Images, video, backups, logs, data lake files; anything large and immutable | Small records needing low-latency updates or queries | "Clients upload directly with presigned URLs; metadata lives in the database, bytes in S3; a CDN serves reads." |
| MinIO / Ceph | Self-hosted S3-compatible storage on premises | You are on a public cloud with managed storage | "S3 API without the cloud." |

Related: [`cdn-and-blob-storage.md`](../fundamentals/cdn-and-blob-storage.md), [`object-storage.md`](../problems/object-storage.md), [`file-storage-sync.md`](../problems/file-storage-sync.md).

## Coordination

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| ZooKeeper | Leader election, group membership and configuration for systems that already depend on it | New systems with no ZooKeeper dependency (Kafka has moved to KRaft) | "Ephemeral nodes plus watches give membership; use sequence nodes for leader election." |
| etcd | Raft-based strongly consistent KV for config, leases and leader election; Kubernetes control plane | High write volume or large values | "A lease with a TTL plus a fencing token from the revision number." |
| Consul | Service discovery and health checking, plus a consistent KV; multi-datacenter service mesh | You only need leader election and already run etcd | "Service registry with health checks; KV for small config." |

Related: [`consensus-and-coordination.md`](../fundamentals/consensus-and-coordination.md), [`src/lease-lock/`](../src/lease-lock/), [`distributed-job-scheduler.md`](../problems/distributed-job-scheduler.md).

## Time-series

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Prometheus | Pull-based metrics for infrastructure and services, alerting with PromQL | Long-term retention or high-cardinality labels (user id as a label) on its own | "Prometheus for scrape and alert; remote-write to a long-term store such as Thanos, Cortex or Mimir." |
| InfluxDB | Push-based metrics and sensor data with a purpose-built time-series engine | You need relational joins with business data | "Purpose-built TSDB; watch series cardinality." |
| TimescaleDB | Time series in Postgres with hypertables; you want SQL joins with relational data | Very high ingest across huge cardinality where a specialised TSDB is cheaper | "Postgres extension, so one operational stack and full SQL." |

Related: [`metrics-monitoring.md`](../problems/metrics-monitoring.md), [`observability.md`](../fundamentals/observability.md).

## Graph

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| Neo4j | Multi-hop traversals are the main query (fraud rings, recommendations, permissions graphs) | One-hop lookups such as "followers of X", which an adjacency table handles | "Most social graphs at scale are adjacency lists in a sharded KV or SQL store; a graph database earns its place for deep traversals." |
| Adjacency table in SQL / KV | Follow graphs, friend lists, one or two hops | Arbitrary-depth traversal queries | "followers(user_id, follower_id) with an index each way." |

Related: [`news-feed.md`](../problems/news-feed.md), [`instagram.md`](../problems/instagram.md).

## Geospatial (bonus)

| Choice | Pick it when | Avoid it when | What to say in an interview |
|---|---|---|---|
| PostGIS | Geospatial queries with SQL, polygons, moderate update rates | Very high update rates of moving objects | "Static places in PostGIS; moving drivers in an in-memory geohash or H3 index." |
| Redis GEO / in-memory geohash grid | Frequent location updates and nearby queries | Complex shapes or durable history | "Bucket by geohash cell, query the cell plus neighbours." |

Related: [`geospatial-indexing.md`](../fundamentals/geospatial-indexing.md), [`src/geohash/`](../src/geohash/), [`proximity-service.md`](../problems/proximity-service.md), [`ride-hailing.md`](../problems/ride-hailing.md).

## Quick map: requirement to category

| Requirement you hear | Category to reach for | First choice |
|---|---|---|
| "Money moves" or "no double booking" | Relational with transactions | Postgres |
| "Look up by id, billions of rows" | Key-value | DynamoDB or Cassandra |
| "Append-only events, query by entity and time" | Wide-column | Cassandra |
| "Search by text, rank by relevance" | Search engine | Elasticsearch/OpenSearch |
| "Sub-millisecond reads of hot data" | Cache | Redis |
| "Several services react to the same event" | Log | Kafka |
| "Run this later, retry on failure" | Work queue | SQS or RabbitMQ |
| "Counts per minute over a stream" | Stream processor | Flink |
| "Dashboards over months of events" | OLAP | ClickHouse or a warehouse |
| "Store photos and videos" | Object storage | S3 |
| "Exactly one scheduler runs at a time" | Coordination | etcd or ZooKeeper |
| "CPU and latency per host" | Time-series | Prometheus |
| "Friends of friends who bought X" | Graph | Neo4j |

## How to state a choice

A complete technology sentence has four parts:

1. **The requirement** it serves: "redirects need p99 under 50 ms".
2. **The choice**: "Redis in front of Postgres".
3. **The cost**: "cache entries can be stale for up to the TTL".
4. **Why the cost is acceptable**: "a URL mapping never changes after creation, so staleness only matters on delete".

If you cannot fill in part 3, you have not finished thinking about the choice. Interviewers probe exactly there.

## Common mismatches

- Kafka as a task queue with per-message delays and priorities: use a work queue or a scheduler.
- Elasticsearch as the system of record: it is an index; keep the truth in a database.
- Redis as the only copy of balances or orders: persistence options exist but failover can lose acknowledged writes.
- Cassandra for read-modify-write with conditions on every request: lightweight transactions exist but cost several round trips.
- MongoDB chosen "for scale" when the data is relational: the joins move into application code.
- A graph database for one-hop follower lookups: an indexed adjacency table is simpler.

## Default stack for a typical product backend

| Layer | Default | Why |
|---|---|---|
| Edge | CDN plus L7 load balancer | Static and cacheable content never reaches origin; TLS termination in one place |
| Services | Stateless services behind the load balancer, autoscaled | Any instance can serve any request; scale by adding instances |
| Primary data | Postgres (managed), primary plus read replicas | Transactions, constraints, joins and one well-understood failure mode |
| Cache | Redis, cache-aside with TTL | Absorbs the read-heavy hot set |
| Async work | Managed queue (SQS) or Kafka once multiple consumers need the same events | Decouples slow work from the request path; retries with idempotent handlers |
| Events out of the database | Transactional outbox or CDC | No dual-write inconsistency between database and queue |
| Files | S3 with presigned uploads, CDN for reads | Bytes stay out of the database and services |
| Search | Elasticsearch/OpenSearch fed by CDC, only if search is a requirement | Database remains the source of truth |
| Metrics and logs | Prometheus plus a log pipeline, tracing with OpenTelemetry | Enough to see the four golden signals per service |

## Reasons to deviate

| Signal in the requirements | Deviation |
|---|---|
| Writes exceed a single primary even after batching (tens of thousands per second sustained) | Shard Postgres by tenant or user, or move that data to Cassandra/DynamoDB |
| Access is purely by key at very high scale | DynamoDB or Cassandra instead of relational |
| Strong consistency across regions with writes in each region | Spanner or CockroachDB |
| Many consumers must replay the same event history | Kafka instead of a work queue |
| Aggregations over billions of events with second-level freshness | Stream processor plus ClickHouse, Druid or Pinot |
| Deep graph traversals are the main query | A graph database for that workload only |
| Moving objects with frequent location updates | In-memory geospatial index |
| Hard real-time ordering with microsecond budgets (matching engines) | Single-threaded in-memory core with a replicated log, not a database on the hot path; see [`stock-exchange.md`](../problems/stock-exchange.md) |

Say the deviation and the cost together: "Cassandra gives us the write throughput, and we give up joins and transactions, so the booking path stays in Postgres."
