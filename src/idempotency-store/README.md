# Idempotency store

Idempotency-key handling for POST APIs: a client sends `Idempotency-Key: <uuid>` with a payment or webhook request, and the server guarantees that retries of that request run the side effect at most once. The store keeps a record per key (IN_PROGRESS with a lock lease, then COMPLETED with the response), a fingerprint of the request to reject a key reused for a different payload, and a TTL. Networks lose responses, so clients must retry; without this, a retry after a timeout is a second charge.

- Concept: [`fundamentals/delivery-semantics-and-idempotency.md`](../../fundamentals/delivery-semantics-and-idempotency.md)
- Problems: [`problems/payment-system.md`](../../problems/payment-system.md), [`problems/webhook-delivery-system.md`](../../problems/webhook-delivery-system.md)
- Run: `npm run demo -- idempotency-store` · `npx vitest run src/idempotency-store`

```ts
const store = new InMemoryIdempotencyStore(clock);
const idem = new Idempotency({ store, clock, ttlMs: 24 * 3_600_000, leaseMs: 30_000 });
const req = { method: 'POST', path: '/v1/charges', body: { amount: 500 } };
await idem.withIdempotency('order-42', req, chargeCard);   // 201, outcome 'executed'
await idem.withIdempotency('order-42', req, chargeCard);   // same 201, replayed: true, no second charge
await idem.withIdempotency('order-42', { ...req, body: { amount: 900 } }, chargeCard); // 422
// throw new HandlerError('timeout', 504, true)  -> record removed, retry may run
// throw new HandlerError('declined', 402, false) -> stored and replayed
```

## What the tests prove

- The first call runs the handler and stores a COMPLETED record; a replay returns the stored response and the handler is not called.
- A duplicate that arrives while the first is still running gets 409, even when it races the first insert (the insert is atomic).
- The same key with a different method, path or body gets 422; key order in the JSON body does not change the fingerprint.
- A retryable failure deletes the record so the retry executes; a non-retryable failure is stored and replayed.
- An IN_PROGRESS record is protected until its lease expires, then another worker takes it over; the stalled worker's late write is rejected by the owner-token check.
- After the TTL the key is forgotten and executes again.

## Complexity

| Operation | Time | Space |
|---|---|---|
| `withIdempotency` (store round trips) | 2 on the happy path (claim + complete), 1 on replay | one record per key for the TTL |
| `fingerprint` | O(body size) | O(body size) |
| `InMemoryIdempotencyStore` ops | O(1) | O(keys × response size) |

## Production notes

- **Stripe** accepts an `Idempotency-Key` header on POST requests, saves the status code and body of the first request (including 500 errors) and returns it for retries; keys can be pruned after 24 hours, and reusing a key with different parameters is rejected.
- The IETF draft *The Idempotency-Key HTTP Header Field* specifies 409 Conflict for a request still being processed and 422 Unprocessable Content for a key reused with a different payload, the codes used here.
- **AWS Lambda Powertools** has an idempotency utility backed by DynamoDB with `INPROGRESS`/`COMPLETED` records, an expiry and optional payload hashing; it uses conditional writes as the atomic insert.
- In production the record is usually written in the same database transaction as the business change (the charge row), so "committed" and "recorded" cannot disagree. A separate Redis store, as modelled here, needs the lease to exceed the worst-case handler time and downstream calls to carry their own idempotency key (Stripe-to-card-network) to cover a stalled worker.
