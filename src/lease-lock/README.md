# Lease lock

A distributed lock with leases and fencing tokens over a fake etcd-style coordination store, plus leader election built on the same lease. Locks in a distributed system must expire because holders crash, but expiry means a paused holder can wake up and act after someone else took over. The fix is a fencing token: a number that grows with every grant, which the protected resource checks and uses to reject writes from the stale holder. This module reproduces that scenario end to end.

- Concept: [`fundamentals/consensus-and-coordination.md`](../../fundamentals/consensus-and-coordination.md)
- Problem: [`problems/distributed-job-scheduler.md`](../../problems/distributed-job-scheduler.md)
- Run: `npm run demo -- lease-lock` · `npx vitest run src/lease-lock`

```ts
const store = new CoordinationStore(clock);
const lock = new LeaseLock(store, clock);
const lease = lock.acquire('invoice-run', 'worker-A', 10_000);  // { token: 1, expiresAt }
storage.write('invoices', data, lease!.token);                   // storage checks the token
lock.renew(lease!, 10_000);                                      // keep it alive while working
lock.release(lease!);                                            // owner only

const elector = new LeaderElector(lock, 'scheduler', 'node-1', 3000);
if (elector.campaign()) runSchedulerLoop(elector.term!);         // call campaign() every ttl/3
```

## What the tests prove

- Compare-and-set succeeds only on the expected revision, and the global revision only increases.
- Mutual exclusion: a second client cannot acquire while the lease is valid.
- Expiry allows takeover, and the new holder's fencing token is strictly larger.
- Renew extends the lease and keeps the token; renewing an expired lease fails.
- Only the owner (same owner and token) can release; a stale holder cannot release its successor's lock.
- The process-pause scenario: A's lease expires during a pause, B acquires and writes, A's late write is rejected by the storage service because its token is stale.
- Leader election fails over after the leader stops renewing, with a higher term; resign hands over immediately.

## Complexity

| Operation | Time | Space |
| --- | --- | --- |
| `acquire` / `renew` / `release` | O(1) store round trip | O(1) per lock |
| `FencedStorage.write` | O(1) | O(1) per protected key (highest token) |
| `LeaderElector.campaign` | O(1) | O(1) |

## Production notes

- etcd's lock and election APIs work this way: a key bound to a lease, the key's create revision serves as an ordering token, and clients must keep the lease alive. ZooKeeper recipes use ephemeral sequential znodes, whose sequence numbers or zxids can serve as fencing tokens.
- Kubernetes leader election (client-go) uses a Lease object updated with optimistic concurrency on its resourceVersion; it does not hand out fencing tokens, so components rely on short lease durations and stepping down on renewal failure.
- Fencing only helps if the resource checks the token. Many storage systems cannot, which is why Martin Kleppmann's critique of Redlock argues that a lock without fencing is only safe for efficiency, not correctness.
- Real stores evaluate expiry on the server with their own clocks and replicate state through Raft or Zab; here expiry is evaluated lazily against the injected clock, and the store is a single in-memory map.
- Clients should treat the lease as ending earlier than the server does (subtract a safety margin for clock drift and network delay) and stop work when a renewal fails.
