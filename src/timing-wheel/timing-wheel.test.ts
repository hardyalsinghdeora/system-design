import { describe, expect, it } from 'vitest';
import { DelayedJobQueue, HeapDelayQueue, HierarchicalTimingWheel, type Timer } from './timing-wheel';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('HierarchicalTimingWheel', () => {
  it('fires a task on the first tick at or after its deadline', () => {
    const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 8 });
    const id = wheel.schedule(25, () => {});
    expect(wheel.advanceTo(29)).toEqual([]);
    expect(wheel.advanceTo(30)).toEqual([{ id, deadlineMs: 25, firedAtMs: 30 }]);
    expect(wheel.pending).toBe(0);
  });

  it('fires zero-delay tasks on the next advance and tasks scheduled from callbacks', () => {
    const wheel = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 4 });
    const seen: string[] = [];
    wheel.schedule(0, () => seen.push('now'));
    wheel.schedule(3, (t) => {
      seen.push(`a@${t}`);
      wheel.schedule(2, (t2) => seen.push(`b@${t2}`));
    });
    wheel.advanceTo(0);
    expect(seen).toEqual(['now']);
    wheel.advanceTo(10);
    expect(seen).toEqual(['now', 'a@3', 'b@5']);
  });

  it('cascades long delays down from overflow wheels to the exact tick', () => {
    const wheel = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 8 });
    const fired: number[] = [];
    for (const delay of [7, 8, 63, 64, 511, 1000, 4096, 100_000]) wheel.schedule(delay, (t) => fired.push(t));
    expect(wheel.levels).toBeGreaterThanOrEqual(6); // 8^6 = 262,144 ticks covers 100,000
    for (const step of [500, 999, 1000, 4095]) wheel.advanceTo(step);
    expect(fired).toEqual([7, 8, 63, 64, 511, 1000]);
    wheel.advanceTo(4096);
    wheel.advanceTo(99_999);
    expect(fired).toEqual([7, 8, 63, 64, 511, 1000, 4096]);
    wheel.advanceTo(100_000);
    expect(fired).toEqual([7, 8, 63, 64, 511, 1000, 4096, 100_000]);
  });

  it('cancel prevents firing, including after a cascade', () => {
    const wheel = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 4 });
    const fired: number[] = [];
    const a = wheel.schedule(5, () => fired.push(5));
    const b = wheel.schedule(200, () => fired.push(200));
    wheel.schedule(201, () => fired.push(201));
    expect(wheel.cancel(a)).toBe(true);
    expect(wheel.cancel(a)).toBe(false);
    wheel.advanceTo(150); // b has cascaded to a finer level by now
    expect(wheel.cancel(b)).toBe(true);
    wheel.advanceTo(300);
    expect(fired).toEqual([201]);
    expect(wheel.pending).toBe(0);
  });

  it('fires many tasks in deadline order', () => {
    const rng = mulberry32(5);
    const wheel = new HierarchicalTimingWheel({ tickMs: 1, wheelSize: 16 });
    for (let i = 0; i < 20_000; i++) wheel.schedule(Math.floor(rng() * 50_000), () => {});
    const fired = wheel.advanceTo(50_000);
    expect(fired).toHaveLength(20_000);
    for (let i = 1; i < fired.length; i++) expect(fired[i].deadlineMs).toBeGreaterThanOrEqual(fired[i - 1].deadlineMs);
    for (const f of fired) expect(f.firedAtMs).toBe(f.deadlineMs);
  });

  it('agrees with a binary-heap delay queue on firing order for a seeded workload', () => {
    const rng = mulberry32(99);
    const wheel = new HierarchicalTimingWheel({ tickMs: 5, wheelSize: 10 });
    const heap = new HeapDelayQueue();
    const timers: Timer[] = [wheel, heap];
    const order: number[][] = [[], []];
    let now = 0;
    for (let round = 0; round < 300; round++) {
      for (let j = 0; j < 20; j++) {
        const delay = Math.floor(rng() ** 3 * 20_000); // mostly short, some very long
        const ids = timers.map((t) => t.schedule(delay, () => {}));
        expect(ids[0]).toBe(ids[1]);
        if (rng() < 0.1) for (const t of timers) t.cancel(ids[0]);
      }
      now += Math.floor(rng() * 200);
      timers.forEach((t, i) => order[i].push(...t.advanceTo(now).map((f) => f.id)));
    }
    now += 30_000;
    timers.forEach((t, i) => order[i].push(...t.advanceTo(now).map((f) => f.id)));
    expect(order[0].length).toBeGreaterThan(5000);
    expect(order[0]).toEqual(order[1]);
  });
});

describe('DelayedJobQueue', () => {
  it('retries failed jobs with exponential backoff and dead-letters after maxAttempts', () => {
    const wheel = new HierarchicalTimingWheel({ tickMs: 100, wheelSize: 10 });
    const failuresLeft = new Map([['flaky', 2], ['broken', 99], ['ok', 0]]);
    const queue = new DelayedJobQueue<string>({
      timer: wheel,
      maxAttempts: 3,
      handler: (job) => {
        const left = failuresLeft.get(job.id) ?? 0;
        failuresLeft.set(job.id, left - 1);
        if (job.id === 'broken') throw new Error('boom');
        return left <= 0;
      },
    });
    for (const id of ['flaky', 'broken', 'ok']) queue.enqueue({ id, payload: `send ${id}` }, 500);
    queue.enqueue({ id: 'cancelled', payload: 'x' }, 500);
    expect(queue.cancel('cancelled')).toBe(true);
    queue.advanceTo(10_000);
    const flaky = queue.log.filter((e) => e.jobId === 'flaky').map((e) => [e.attempt, e.atMs, e.outcome]);
    expect(flaky).toEqual([[1, 500, 'retry-scheduled'], [2, 1500, 'retry-scheduled'], [3, 3500, 'succeeded']]);
    expect(queue.log.find((e) => e.jobId === 'ok')?.outcome).toBe('succeeded');
    expect(queue.deadLetters.map((j) => j.id)).toEqual(['broken']);
    expect(queue.log.some((e) => e.jobId === 'cancelled')).toBe(false);
    expect(queue.pending).toBe(0);
  });
});
