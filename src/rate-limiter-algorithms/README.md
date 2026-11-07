# Rate limiter algorithms

Token bucket, leaky bucket (as a meter), fixed window counter, sliding window log and sliding window counter behind one `RateLimiter` interface, plus (in `counter-store.ts`) an in-memory `CounterStore` that stands in for Redis. Every limiter in production is one of these five, and the interview question is usually which one you pick and how you keep it correct when many gateways share the counter. The store makes that second question concrete: a deterministic interleaving shows a GET-then-SET limiter admitting twice its limit, and the atomic version admitting exactly the limit.

- Concept: [`fundamentals/rate-limiting.md`](../../fundamentals/rate-limiting.md)
- Problem: [`problems/rate-limiter.md`](../../problems/rate-limiter.md)
- Run: `npm run demo -- rate-limiter-algorithms` · `npx vitest run src/rate-limiter-algorithms`

```ts
const limiter = new TokenBucket({ capacity: 20, refillPerSecond: 5 });
const d = limiter.tryAcquire('api-key:123');      // { allowed, remaining, retryAfterMs }
if (!d.allowed) res.status(429).set('Retry-After', String(Math.ceil(d.retryAfterMs / 1000)));

const store = new InMemoryCounterStore();         // swap for a Redis-backed CounterStore
const shared = new AtomicFixedWindowLimiter(store, { limit: 100, windowMs: 60_000 });
shared.tryAcquire('user:42');                     // one atomic round trip per request
simulateTwoGatewayRace({ limit: 10, requestsPerGateway: 10, mode: 'read-modify-write' }); // admitted: 20
```

## What the tests prove

- Token bucket: bursts up to capacity, refills at exactly the configured rate, never exceeds capacity; cost and per-key isolation work.
- For all five algorithms, `retryAfterMs` is exact: a retry 1 ms early is denied, a retry at that moment is admitted.
- Fixed window admits 20 requests in 2 ms with a limit of 10 across a boundary (the documented weakness); the log admits 10 and the sliding counter at most 10.
- Sliding window counter, under a seeded random flood at 2x the limit, never lets more than 110 % of the limit through in any true sliding window, while still admitting over 95 % of the allowed throughput.
- Leaky bucket turns a steady flood into evenly spaced admissions after the initial burst.
- Two interleaved gateways using read-modify-write admit 20 against a limit of 10 and lose half the increments; the atomic store call admits exactly 10. Window keys expire by TTL.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `TokenBucket.tryAcquire` | O(1) | 2 numbers per key |
| `LeakyBucket.tryAcquire` | O(1) | 2 numbers per key |
| `FixedWindowCounter.tryAcquire` | O(1) | 1 counter per key |
| `SlidingWindowLog.tryAcquire` | O(L) worst case for eviction (L = limit) | up to L timestamps per key |
| `SlidingWindowCounter.tryAcquire` | O(1) | 2 counters per key |
| `AtomicFixedWindowLimiter.tryAcquire` | 1 store round trip | 1 counter per key per window |

## Production notes

- Stripe has described running token buckets in Redis for its API rate limits. AWS API Gateway throttling is specified as a token bucket (rate plus burst).
- NGINX `limit_req` implements the leaky bucket; its `burst` parameter is the bucket size, and without `nodelay` it queues (the queue variant) rather than rejecting as this meter does.
- Cloudflare described using the sliding window counter approximation and measured it as wrong for a tiny fraction of requests in production traffic. The worst case is adversarial: requests bunched at the end of the previous window are under-weighted.
- Envoy's global rate limit service (envoyproxy/ratelimit) uses fixed window counters in Redis keyed by descriptor and window.
- In Redis the atomic step is a Lua script (scripts run atomically) or `INCR` followed by a comparison, with `EXPIRE` set when the key is created. A real deployment also has to decide what to do when Redis is unreachable (fail open is common) and often keeps a local limiter in front of the shared one to cut round trips.
