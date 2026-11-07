# System Design Interview Prep

[![CI](https://github.com/hardyalsinghdeora/system-design/actions/workflows/ci.yml/badge.svg)](https://github.com/hardyalsinghdeora/system-design/actions/workflows/ci.yml)

High-level system design for backend interviews: a framework for the 45-minute round, the fundamentals explained with their trade-offs, classic problems worked end to end, and runnable TypeScript building blocks (consistent hashing, rate limiters, Bloom filters, HyperLogLog, an LSM-tree, quorum replication, fencing-token leases and more) with tests that prove the property each one exists for.

## Quick start

```bash
npm install
npm test                                # runs every building block's tests
npm run typecheck
npm run demo                            # lists the runnable demos
npm run demo -- consistent-hash-ring    # runs one
```

Requires Node.js 20 or newer.

## How to use this repository

1. Read the [interview framework](docs/interview-framework.md) and keep the [back-of-the-envelope cheat sheet](docs/back-of-envelope.md) open.
2. Learn the fundamentals below. Each note ends with the interview questions it answers.
3. Work through the problems. Spend 30 minutes on your own design before reading the write-up.
4. Read the [common deep dives](docs/common-deep-dives.md): the same dozen hard parts come up in almost every round.
5. Run the building blocks to watch the mechanisms behave the way the write-ups claim.

## Problems

Every write-up follows the same shape: requirements, estimation, API, data model, high-level design, deep dives, scaling and operations, a trade-offs table, and the follow-up questions interviewers ask.

<!-- BEGIN:problems -->
### Core infrastructure

| Problem | Difficulty | Core challenges |
|---|---|---|
| [URL Shortener (TinyURL, bit.ly)](problems/url-shortener.md) | Easy | unique key generation, read-heavy caching, redirect latency, abuse |
| [Distributed Rate Limiter](problems/rate-limiter.md) | Medium | atomic counters, sub-5 ms overhead, fail-open policy, multi-region limits |
| [Distributed Key-Value Store (Dynamo, Cassandra, Riak)](problems/key-value-store.md) | Hard | partitioning, tunable consistency, conflict resolution, failure handling |
| [Distributed Cache (Redis Cluster, Memcached)](problems/distributed-cache.md) | Medium | sharding, hot keys, stampedes, cache-DB consistency |
| [Distributed Message Queue (Kafka)](problems/distributed-message-queue.md) | Hard | durable append log, replication, consumer groups, ordering and exactly-once |
| [Distributed Job Scheduler (cron at scale)](problems/distributed-job-scheduler.md) | Medium-Hard | finding due jobs, exactly one scheduler per job, at-least-once execution, cron time zones |
| [Object Storage (Amazon S3)](problems/object-storage.md) | Hard | metadata at scale, durability vs cost, large uploads, listing by prefix |
| [Metrics Monitoring and Alerting System (Prometheus, Datadog)](problems/metrics-monitoring.md) | Hard | write-heavy ingestion, cardinality, compression, reliable alerting |
| [Web Crawler](problems/web-crawler.md) | Medium-Hard | URL frontier, politeness, deduplication, spider traps |
| [Notification System (push, SMS, email, in-app)](problems/notification-system.md) | Medium | multi-channel delivery, retries without duplicates, user preferences, broadcast spikes |
| [Webhook Delivery System (Stripe, GitHub outbound webhooks)](problems/webhook-delivery-system.md) | Medium | at-least-once delivery, slow endpoints, signatures, SSRF |

### Social, media and collaboration

| Problem | Difficulty | Core challenges |
|---|---|---|
| [News Feed (Facebook / Twitter home timeline)](problems/news-feed.md) | Medium-Hard | fan-out cost, celebrity accounts, feed read latency, ranking |
| [Instagram (photo and video sharing)](problems/instagram.md) | Medium | media upload and processing, CDN delivery, ephemeral stories, hot counters |
| [Chat System (WhatsApp / Slack)](problems/chat-system.md) | Hard | persistent connections, per-conversation ordering, offline delivery, multi-device sync |
| [Video Streaming Platform (YouTube / Netflix)](problems/video-streaming.md) | Hard | transcoding throughput, adaptive bitrate, egress cost, edge caching |
| [File Storage and Sync (Dropbox / Google Drive)](problems/file-storage-sync.md) | Hard | chunking and dedup, sync protocol, edit conflicts, metadata consistency |
| [Collaborative Document Editor (Google Docs)](problems/collaborative-editor.md) | Hard | concurrent edits, operation ordering, session routing, offline merge |
| [Search Autocomplete (typeahead)](problems/search-autocomplete.md) | Medium | sub-100 ms latency, top-k per prefix, data pipeline freshness, filtering |
| [Online Judge (LeetCode, Codeforces)](problems/online-judge.md) | Medium to Hard | sandboxing untrusted code, queue-based execution, contest spikes, live leaderboard |

### Commerce and money

| Problem | Difficulty | Core challenges |
|---|---|---|
| [Payment System (Stripe, PayPal pay-in)](problems/payment-system.md) | Hard | exactly-once charging, unknown PSP outcomes, double-entry ledger, reconciliation |
| [Subscription Billing Platform (Stripe Billing, Chargebee)](problems/subscription-billing-platform.md) | Hard | renewal storms, idempotent invoicing, proration, usage metering, dunning |
| [E-commerce Platform (Amazon, Flipkart)](problems/ecommerce-platform.md) | Hard | inventory contention, checkout saga, search freshness, flash-sale oversell |
| [Ticket Booking System (Ticketmaster, BookMyShow)](problems/ticket-booking.md) | Medium-Hard | seat contention, holds with expiry, hot on-sales, bots |
| [Stock Exchange (matching engine)](problems/stock-exchange.md) | Hard | deterministic matching, sequencing, replay and failover, latency |

### Location-based services

| Problem | Difficulty | Core challenges |
|---|---|---|
| [Ride-Hailing Service (Uber, Ola, Lyft)](problems/ride-hailing.md) | Hard | high-rate location writes, nearest-driver search, one driver per trip, real-time push |
| [Food Delivery Platform (Swiggy, Zomato, DoorDash)](problems/food-delivery.md) | Hard | geo discovery, order state across three parties, partner assignment, dinner peaks |
| [Proximity Service (Yelp, "restaurants near me")](problems/proximity-service.md) | Medium | geospatial indexing, boundary cells, read-heavy caching, ranking |
| [Maps and Navigation (Google Maps)](problems/maps-and-navigation.md) | Hard | tile serving at CDN scale, shortest paths on a huge graph, live traffic, rerouting |

### Counting, ranking and analytics

| Problem | Difficulty | Core challenges |
|---|---|---|
| [Distributed Counter (likes, views at scale)](problems/distributed-counter.md) | Medium | hot keys, write amplification, exact vs approximate, unique counts |
| [Real-time Leaderboard](problems/leaderboard.md) | Medium | rank queries at scale, ties, time windows, sharding a global ranking |
| [Top-K Trending (hashtags, songs, searches)](problems/top-k-trending.md) | Medium to Hard | high-cardinality counting, sliding windows, merging partial results, serving precomputed lists |
| [Ad Click Aggregation System](problems/ad-click-aggregation.md) | Hard | exactly-once counts, late events, deduplication, hot keys |
<!-- END:problems -->

## Fundamentals

<!-- BEGIN:fundamentals -->
### Data

| Concept | In one line |
|---|---|
| [CAP and PACELC](fundamentals/cap-and-pacelc.md) | when the network splits a replicated system, each side must either keep answering (and risk stale or conflicting data) or refuse until it can answer correctly; PACELC adds that even on a healthy network, stronger consistency costs latency on every request. |
| [Consistency models](fundamentals/consistency-models.md) | a consistency model is the contract for what a read may return given the writes before it; stronger models are easier to reason about but cost latency and availability, and most user-visible bugs come from missing session guarantees rather than missing linearizability. |
| [Replication](fundamentals/replication.md) | keep copies of the same data on several machines so the system survives node loss and serves more reads, and then decide how the copies agree when writes arrive at different times or different places. |
| [Sharding and partitioning](fundamentals/sharding-and-partitioning.md) | split a dataset that is too big or too busy for one machine into pieces by a key, so each node owns a subset, and pick the key so that load spreads evenly and most queries touch one piece. |
| [Consistent hashing](fundamentals/consistent-hashing.md) | map both nodes and keys onto a ring so that adding or removing a node moves only about 1/N of the keys, instead of nearly all of them. |
| [Choosing a database](fundamentals/choosing-a-database.md) | start from the access patterns (how you read, write, query and grow), pick the simplest store that serves them, and add a specialised store only when a concrete signal says the default no longer fits. |
| [Storage engines](fundamentals/storage-engines.md) | a B-tree updates sorted pages in place and favours reads, an LSM-tree buffers writes in memory and merges sorted files in the background and favours writes, and both rely on a write-ahead log to survive crashes. |
| [Transactions and isolation](fundamentals/transactions-and-isolation.md) | a transaction groups reads and writes so they commit or fail together, and the isolation level decides which interference from concurrent transactions you are protected from; the rest you must handle with locks, constraints or conditional updates. |
| [Caching strategies](fundamentals/caching-strategies.md) | keep copies of hot data closer to the reader so most requests skip the slow path, and decide up front how the copy is filled, how it is kept fresh, and what happens when many requests miss at once. |
| [ID generation](fundamentals/id-generation.md) | pick an id scheme by what you need from it (globally unique, roughly time-sortable, compact, generated without coordination), knowing that random ids scatter B-tree inserts and time-based ids depend on clocks. |
| [Bloom filters and probabilistic data structures](fundamentals/bloom-filters-and-probabilistic.md) | trade a small, bounded error for huge memory savings: a Bloom filter answers "definitely not present" or "probably present", a Count-Min Sketch estimates frequencies, and HyperLogLog counts distinct items in a few kilobytes. |

### Communication and asynchronous work

| Concept | In one line |
|---|---|
| [API design](fundamentals/api-design.md) | model resources and the operations on them so that clients can retry safely, page through large collections, detect conflicting edits and keep working as the API evolves. |
| [Realtime communication](fundamentals/realtime-communication.md) | pick how the server tells a client something changed (polling, long polling, server-sent events, WebSockets or push) by how often updates happen, which direction they flow and how many connections you must hold open. |
| [Message queues and streams](fundamentals/message-queues-and-streams.md) | a queue hands each message to one consumer and forgets it once acknowledged; a log (stream) keeps an ordered, replayable record that many consumer groups read independently at their own offsets. |
| [Delivery semantics and idempotency](fundamentals/delivery-semantics-and-idempotency.md) | networks lose acknowledgements, so a sender must either risk losing a message or risk sending it twice; you get "exactly-once" behaviour by accepting duplicates and making their processing harmless. |
| [Distributed transactions](fundamentals/distributed-transactions.md) | making one business operation atomic across several databases or services is expensive and fragile, so prefer one database per invariant, then sagas with compensations, and use two-phase commit only inside a single trusted system. |
| [Transactional outbox and CDC](fundamentals/transactional-outbox-and-cdc.md) | write the event into the same database transaction as the state change, then publish it from the database to the broker afterwards, so the two can never disagree. |
| [Event-driven architecture](fundamentals/event-driven-architecture.md) | services announce facts that have happened and others react to them, which decouples who produces a change from who cares about it, at the cost of eventual consistency and flows that are harder to see. |
| [Rate limiting](fundamentals/rate-limiting.md) | cap how many requests a client may make in a time period, so one caller cannot exhaust capacity, run up costs or abuse the system, and tell rejected callers when to try again. |
| [Batch and stream processing](fundamentals/batch-and-stream-processing.md) | batch jobs compute over a bounded dataset after the fact, stream jobs compute continuously over unbounded events as they arrive; the hard parts of streaming are time, late data and keeping state correct across failures. |

### Infrastructure and operations

| Concept | In one line |
|---|---|
| [Load balancing](fundamentals/load-balancing.md) | spread requests across a pool of interchangeable servers, stop sending traffic to the unhealthy ones, and make sure the balancer itself is never the single point of failure. |
| [CDN and blob storage](fundamentals/cdn-and-blob-storage.md) | put large, immutable bytes (images, video, uploads, backups) in an object store addressed by bucket and key, and put a CDN in front so most reads are served from an edge cache near the user instead of from the origin. |
| [Consensus and coordination](fundamentals/consensus-and-coordination.md) | consensus lets a group of nodes agree on one value or one ordered log even when some of them crash, as long as a majority is up; coordination services package that agreement as leader election, locks, configuration and membership. |
| [Resilience patterns](fundamentals/resilience-patterns.md) | assume every dependency will be slow or down at some point, and bound the damage with timeouts, careful retries, circuit breakers, bulkheads, load shedding and fallbacks, so one failing part does not take down the whole system. |
| [Observability](fundamentals/observability.md) | emit metrics, logs and traces with shared identifiers so you can tell from the outside whether users are being served well, get paged only when they are not, and find which component is at fault. |
| [Security basics](fundamentals/security-basics.md) | prove who is calling (authentication), check what they may do on every request and every object (authorization), protect data in transit and at rest with managed keys, and keep an audit trail. |
| [Microservices and boundaries](fundamentals/microservices-and-boundaries.md) | split a system into separately deployable services only along business boundaries that change independently, give each service its own data, and accept that every cross-service call and transaction is now a distributed-systems problem. |
| [Search and indexing](fundamentals/search-and-indexing.md) | full-text search inverts documents into a map from each term to the documents that contain it, ranks matches by how well they fit the query (BM25), and runs as a separate, eventually consistent index fed from the source database. |
| [Geospatial indexing](fundamentals/geospatial-indexing.md) | map two-dimensional locations onto one-dimensional cell ids (geohash, S2, H3) or a spatial tree (quadtree, R-tree), so "what is near this point?" becomes a lookup of a few cells instead of a scan of every row. |
| [Multi-region and disaster recovery](fundamentals/multi-region-and-disaster-recovery.md) | run in more than one region for latency, availability or data-residency reasons, decide how much data you can lose (RPO) and how long you can be down (RTO), and practise failing over, because an untested plan usually does not work. |
<!-- END:fundamentals -->

## Runnable building blocks

Small, dependency-free TypeScript implementations of the mechanisms the write-ups rely on. Each folder has the code, tests, a demo and a README.

<!-- BEGIN:blocks -->
| Building block | What it demonstrates | Run |
|---|---|---|
| [Bloom filter](src/bloom-filter/) | A Bloom filter sized from the expected item count and target false-positive rate, using Kirsch-Mitzenmacher double hashing over one MD5 digest and a `Uint8Array` bit array, with serialization and union; plus a counting variant that supports removal. | `npm run demo -- bloom-filter` |
| [Consistent hash ring](src/consistent-hash-ring/) | A consistent hash ring with virtual nodes, binary-search lookup and `getNodes(key, n)` for replication preference lists. | `npm run demo -- consistent-hash-ring` |
| [Count-min sketch](src/count-min-sketch/) | A count-min sketch sized from epsilon and delta, with optional conservative update and merge, plus `HeavyHitters`, which pairs the sketch with a size-k min-heap for streaming top-k. | `npm run demo -- count-min-sketch` |
| [Geohash and quadtree](src/geohash/) | Geohash encoding (encode, decode to a bounding box, the 8 neighbours of a cell), a `ProximityIndex` that answers "k nearest within r metres" by searching one geohash cell and its neighbours, and a bucketed point quadtree with range queries. | `npm run demo -- geohash` |
| [HyperLogLog](src/hyperloglog/) | A HyperLogLog cardinality estimator with precision p (2^p registers), a 64-bit hash taken from MD5 via `node:crypto`, linear counting for small cardinalities, merge (union) and register serialization. | `npm run demo -- hyperloglog` |
| [Idempotency store](src/idempotency-store/) | Idempotency-key handling for POST APIs: a client sends `Idempotency-Key: <uuid>` with a payment or webhook request, and the server guarantees that retries of that request run the side effect at most once. | `npm run demo -- idempotency-store` |
| [Inverted index](src/inverted-index/) | A tokenizer, an inverted index with positional postings (doc id, term frequency, positions), boolean AND/OR as merges of sorted postings lists, phrase queries by position, BM25 ranking (k1 = 1.2, b = 0.75) and document deletion. | `npm run demo -- inverted-index` |
| [Lease lock](src/lease-lock/) | A distributed lock with leases and fencing tokens over a fake etcd-style coordination store, plus leader election built on the same lease. | `npm run demo -- lease-lock` |
| [LSM tree](src/lsm-tree/) | An in-memory log-structured merge tree: a write-ahead log that is replayed on restart, a sorted memtable, immutable SSTables with a sparse index and a per-table Bloom filter, tombstones for deletes, size-tiered compaction and merged range scans. | `npm run demo -- lsm-tree` |
| [Merkle tree](src/merkle-tree/) | A fixed-shape Merkle tree over hash-bucketed key ranges, with `diff` that descends only into mismatching subtrees and inclusion proofs (audit paths) that a client can verify against the root alone. | `npm run demo -- merkle-tree` |
| [Quorum KV](src/quorum-kv/) | A leaderless replicated key-value store in the style of Dynamo, simulated in memory: N replicas per key, configurable R and W, vector-clock versions, read repair, hinted handoff and siblings for concurrent writes. | `npm run demo -- quorum-kv` |
| [Rate limiter algorithms](src/rate-limiter-algorithms/) | Token bucket, leaky bucket (as a meter), fixed window counter, sliding window log and sliding window counter behind one `RateLimiter` interface, plus (in `counter-store.ts`) an in-memory `CounterStore` that stands in for Redis. | `npm run demo -- rate-limiter-algorithms` |
| [Snowflake, UUIDv7 and ULID ids](src/snowflake-id/) | A Snowflake generator (41-bit milliseconds since a custom epoch, 10-bit worker id, 12-bit sequence, as BigInt) with bounded waiting when a millisecond's sequence runs out, a `ClockMovedBackwardsError` instead of silently issuing duplicates, `decode()` and base62 helpers; plus RFC 9562 UUIDv7 and monotonic ULID generators. | `npm run demo -- snowflake-id` |
| [Timing wheel](src/timing-wheel/) | A hierarchical timing wheel for scheduling very many delayed tasks with O(1) schedule and cancel, a binary-heap delay queue to compare it with, and a `DelayedJobQueue` with retry backoff and dead-lettering on top. | `npm run demo -- timing-wheel` |
| [Trie autocomplete](src/trie-autocomplete/) | A query-frequency trie that caches the top-k completions at every node, so `suggest(prefix)` costs one walk down the prefix instead of a scan of the subtree. | `npm run demo -- trie-autocomplete` |
| [Vector clock](src/vector-clock/) | Lamport clocks and vector clocks, plus a three-process message-passing simulation that stamps every event with both. | `npm run demo -- vector-clock` |
<!-- END:blocks -->

## Reference

| Document | Use it for |
|---|---|
| [Interview framework](docs/interview-framework.md) | Pacing a 45-minute round from requirements to wrap-up |
| [Back-of-the-envelope](docs/back-of-envelope.md) | Latency numbers, availability math, throughput rules of thumb |
| [Technology picker](docs/technology-picker.md) | Which database, cache, queue or search engine to name, and why |
| [Common deep dives](docs/common-deep-dives.md) | Hot keys, stampedes, fan-out, double booking, exactly-once effects and more |
| [Glossary](docs/glossary.md) | Definitions of the terms used across the repository |
| [Reading list](docs/reading-list.md) | Books and papers worth the time |

## Repository layout

```
docs/           interview framework and reference sheets
fundamentals/   one concept per file, with trade-offs and interview questions
problems/       one interview problem per file
src/<block>/    runnable building blocks: code, tests, demo, README
scripts/        demo runner
```

Conventions are in [STYLE.md](STYLE.md).

## Companion repositories

- [low-level-design](https://github.com/hardyalsinghdeora/low-level-design): object-oriented design problems with tested TypeScript solutions.
- [design-patterns](https://github.com/hardyalsinghdeora/design-patterns): the 23 GoF patterns plus modern backend patterns, including circuit breaker, outbox, saga, CQRS and event sourcing.

## License

[MIT](LICENSE)
