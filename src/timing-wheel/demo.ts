import { DelayedJobQueue, HeapDelayQueue, HierarchicalTimingWheel } from './timing-wheel';

console.log('\nRequest timeouts in a broker: tick 1 ms, 20 buckets per level\n');
const wheel = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 20 });
const produceTimeout = wheel.schedule(30_000, () => {});
wheel.schedule(5, (t) => console.log(`  fetch wait expired at ${t} ms`));
wheel.schedule(400, (t) => console.log(`  heartbeat check at ${t} ms`));
wheel.schedule(7_200_000, (t) => console.log(`  session expiry at ${t / 3_600_000} h`));
console.log(`  wheel levels after scheduling a 2 h timer: ${wheel.levels} (20 ms, 400 ms, 8 s, 160 s, 53 min, 17.8 h)`);
wheel.advanceTo(1_000);
wheel.cancel(produceTimeout);
console.log('  produce request acked at 1 s: its 30 s timeout is cancelled in O(1)');
wheel.advanceTo(7_200_000);

const rng = ((s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647))(7);
const big = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 64 });
const heap = new HeapDelayQueue();
const delays = Array.from({ length: 200_000 }, () => Math.floor(rng() * 60_000));
for (const d of delays) {
  big.schedule(d, () => {});
  heap.schedule(d, () => {});
}
console.log(`\n200,000 timers over 60 s: wheel needs ${big.levels} levels of 64 buckets; heap depth is ${Math.ceil(Math.log2(heap.pending))}`);
const a = big.advanceTo(60_000).map((f) => f.id);
const b = heap.advanceTo(60_000).map((f) => f.id);
console.log(`Both fired ${a.length} timers in the same order: ${a.join() === b.join()}`);

console.log('\nWebhook retries on a DelayedJobQueue (backoff 1 s, 2 s, then dead-letter)');
let attempts = 0;
const jobs = new DelayedJobQueue<string>({
  timer: new HierarchicalTimingWheel({ tickMs: 100, wheelSize: 10 }),
  handler: (job) => job.id === 'hook-ok' || ++attempts > 5,
});
jobs.enqueue({ id: 'hook-ok', payload: 'order.paid' }, 0);
jobs.enqueue({ id: 'hook-down', payload: 'order.paid' }, 0);
jobs.advanceTo(10_000);
for (const e of jobs.log) console.log(`  ${String(e.atMs).padStart(5)} ms  ${e.jobId.padEnd(10)} attempt ${e.attempt}: ${e.outcome}`);
console.log(`  dead letters: ${jobs.deadLetters.map((j) => j.id).join(', ')}\n`);
