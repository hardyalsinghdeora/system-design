# How to run a 45-minute system design interview

The interviewer is not grading the final diagram. They are grading whether you can take a vague prompt, carve it into requirements, make trade-offs out loud, and go deep where it matters. This framework keeps you on time.

| Minute | Step | Output |
|---|---|---|
| 0-5 | **Requirements** | 3-5 functional requirements, 3-4 non-functional, explicit out-of-scope list |
| 5-10 | **Estimation** | Users, QPS (read/write), storage, bandwidth; one or two numbers that change the design |
| 10-15 | **API and data model** | Core endpoints with request/response, main tables or documents, keys and indexes |
| 15-25 | **High-level design** | Boxes and arrows that satisfy every functional requirement; walk one request end to end |
| 25-40 | **Deep dives** | 2-3 hardest parts: the bottleneck, the consistency problem, the hot path |
| 40-45 | **Wrap-up** | Failure modes, monitoring, what you would do with more time |

## 1. Requirements (5 min)

Ask, do not assume. Then write the list down where the interviewer can see it.

- **Functional**: what the user can do. "Shorten a URL, redirect, optional custom alias, expiry."
- **Non-functional**: scale, latency, availability vs. consistency, durability, security. Put numbers on them: "p99 redirect under 50 ms", "99.99% available".
- **Out of scope**: say it explicitly ("no analytics dashboard today"). It buys time and shows control.

## 2. Back-of-the-envelope estimation (5 min)

See [`back-of-envelope.md`](./back-of-envelope.md) for the numbers to memorise. Only compute what changes the design:

- Writes/sec and reads/sec (and the read:write ratio).
- Storage per year (rows × bytes × retention).
- Peak = 2-3× average. Cache size = hot 20 % of the working set.

Say what the number implies: "1,000 writes/s fits one Postgres primary; 100k reads/s means a cache in front".

## 3. API and data model (5 min)

- REST or gRPC endpoints with the fields that matter. Mark idempotent operations and where the idempotency key lives.
- Entities, their keys, the one or two indexes the hot queries need.
- Choose the store with a reason: relational for transactions and joins, wide-column for write-heavy time series, document for flexible schemas, key-value for lookups by key.

## 4. High-level design (10 min)

Draw: clients → load balancer → stateless services → cache → database, plus queues for anything asynchronous. Then **walk one request through it**. Every functional requirement should map to a path in the diagram.

## 5. Deep dives (15 min)

Pick the parts the interviewer leans into. Typical candidates:

- The write path under contention (ticket booking, inventory, counters).
- The read path at scale (fan-out, caching, CDN, pagination).
- Data partitioning and the hot-key problem.
- Consistency: what can be stale, what cannot, and how you enforce the latter.
- Asynchronous work: queues, retries, idempotency, dead letters, exactly-once myths.
- The single point of failure you drew, and how it fails over.

For each: name the problem, give two options, pick one with a reason.

## 6. Wrap-up (5 min)

- What breaks first as load grows 10×, and what you would change.
- Monitoring: the three metrics you would alert on.
- Security and abuse: rate limits, auth, input validation.

## Phrases that signal seniority

- "The trade-off here is X for Y; given the requirement Z, I would take X."
- "This is eventually consistent, which is fine because the user cannot observe the lag here, but the payment path must be strongly consistent."
- "Before I add Kafka, the simpler option is a Postgres outbox table and a poller; it holds to about N events/sec."
- "This box is a single point of failure; here is how it fails over."

## Mistakes that cost the most

- Jumping to the diagram without requirements.
- Adding technology without a reason ("we'll use Kafka and Cassandra").
- Never going deep: a wide, shallow design reads as junior.
- Ignoring the interviewer's hints. When they ask "what if two users book the same seat", that is the deep dive they want.
