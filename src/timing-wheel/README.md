# Timing wheel

A hierarchical timing wheel for scheduling very many delayed tasks with O(1) schedule and cancel, a binary-heap delay queue to compare it with, and a `DelayedJobQueue` with retry backoff and dead-lettering on top. Brokers and network servers keep a timeout for every in-flight request (millions at once); most are cancelled before they fire, so cheap insert and cancel matter more than exact firing time. The clock is driven by the caller through `advanceTo(timeMs)`; there are no real timers, so every test is deterministic.

- Concept: [`fundamentals/message-queues-and-streams.md`](../../fundamentals/message-queues-and-streams.md)
- Problem: [`problems/distributed-job-scheduler.md`](../../problems/distributed-job-scheduler.md)
- Run: `npm run demo -- timing-wheel` · `npx vitest run src/timing-wheel`

```ts
const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 20 });
const id = wheel.schedule(25, (t) => console.log('fired at', t));
wheel.advanceTo(29);                 // [] (deadline 25 rounds up to the 30 ms tick)
wheel.advanceTo(30);                 // [{ id, deadlineMs: 25, firedAtMs: 30 }]
wheel.cancel(id);                    // false: already fired

const jobs = new DelayedJobQueue({ timer: wheel, handler: (job, attempt) => send(job), maxAttempts: 3 });
jobs.enqueue({ id: 'hook-1', payload: 'order.paid' }, 0);   // retries after 1 s, 2 s, then dead-letters
```

## What the tests prove

- A task fires on the first tick at or after its deadline: never early, at most one tick late.
- Delays far beyond the first level (100,000 ticks on an 8-slot wheel, 6 levels) cascade down and fire at the exact tick.
- Cancel works before and after an entry has cascaded to a finer level.
- 20,000 random tasks fire in deadline order; zero-delay tasks and tasks scheduled from inside a callback fire correctly.
- On a seeded workload of 6,000 schedules with cancels and irregular clock advances, the wheel and the heap fire the same ids in the same order.
- `DelayedJobQueue` retries with 1 s, 2 s backoff, records success, dead-letters after 3 attempts and honours cancel.

## Complexity

n = pending timers, W = wheel size, L = levels ≈ log_W(max delay / tick).

| Operation | Wheel time | Heap time | Space |
|---|---|---|---|
| `schedule` | O(L) worst case, O(1) typical | O(log n) | O(n + L·W) wheel, O(n) heap |
| `cancel` | O(1) | O(1) lazy (entry stays until popped) | |
| `advanceTo` per fired task | O(L) cascades + O(log (L·W)) bucket queue | O(log n) | |

## Production notes

- **Kafka** uses hierarchical timing wheels for its request purgatory (produce acks, fetch waits). Like this implementation, it puts only non-empty buckets in a `DelayQueue` so the clock jumps straight to the next bucket instead of ticking through empty ones; unlike this one, its buckets fire at the bucket start, so a task can fire up to one tick early.
- **Netty's `HashedWheelTimer`** is a single wheel (default 512 ticks of 100 ms): a long timeout stores a remaining-rounds counter instead of moving to an overflow wheel, and a worker thread ticks every slot. Timeouts are approximate by design.
- The **Linux kernel** timer wheel has also used levels; since 4.8 it no longer cascades: long timers stay in coarse buckets and fire with less precision, which is acceptable because most such timers are cancelled.
- The idea comes from Varghese and Lauck, *Hashed and Hierarchical Timing Wheels* (1987). A job scheduler that must survive restarts persists due times in a database and uses an in-memory wheel or heap only for the next window of jobs.
