import { describe, expect, it } from 'vitest';
import { AtomicFixedWindowLimiter, InMemoryCounterStore, simulateTwoGatewayRace } from './counter-store';
import {
  FixedWindowCounter,
  LeakyBucket,
  SlidingWindowCounter,
  SlidingWindowLog,
  TokenBucket,
  type Clock,
  type RateLimiter,
} from './rate-limiter-algorithms';

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

const drain = (limiter: RateLimiter, key = 'k'): number => {
  let n = 0;
  while (limiter.tryAcquire(key).allowed) n++;
  return n;
};

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refills at the configured rate and caps', () => {
    const t = { now: 0 };
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 5, clock: () => t.now });
    expect(drain(bucket)).toBe(10);
    t.now = 1000;
    expect(drain(bucket)).toBe(5);
    t.now = 60_000;
    expect(drain(bucket)).toBe(10); // capped at capacity, not 295 tokens
  });

  it('charges cost, reports remaining and keeps keys independent', () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1, clock: () => 0 });
    expect(bucket.tryAcquire('a', 7)).toEqual({ allowed: true, remaining: 3, retryAfterMs: 0 });
    expect(bucket.tryAcquire('a', 4)).toMatchObject({ allowed: false, remaining: 3, retryAfterMs: 1000 });
    expect(bucket.tryAcquire('b', 10).allowed).toBe(true);
    expect(() => bucket.tryAcquire('a', 11)).toThrow(RangeError);
  });
});

const factories: Array<[string, (clock: Clock) => RateLimiter]> = [
  ['TokenBucket', (clock) => new TokenBucket({ capacity: 10, refillPerSecond: 5, clock })],
  ['LeakyBucket', (clock) => new LeakyBucket({ capacity: 10, leakPerSecond: 5, clock })],
  ['FixedWindowCounter', (clock) => new FixedWindowCounter({ limit: 10, windowMs: 1000, clock })],
  ['SlidingWindowLog', (clock) => new SlidingWindowLog({ limit: 10, windowMs: 1000, clock })],
  ['SlidingWindowCounter', (clock) => new SlidingWindowCounter({ limit: 10, windowMs: 1000, clock })],
];

describe('retryAfterMs', () => {
  it.each(factories)('%s: denied 1 ms before retryAfterMs, allowed exactly at it', (_name, make) => {
    const t = { now: 5_250 };
    const limiter = make(() => t.now);
    for (let i = 0; i < 10; i++) expect(limiter.tryAcquire('k').allowed).toBe(true);
    const decision = limiter.tryAcquire('k');
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    t.now += decision.retryAfterMs - 1;
    expect(limiter.tryAcquire('k').allowed).toBe(false);
    t.now += 1;
    expect(limiter.tryAcquire('k').allowed).toBe(true);
  });
});

describe('window algorithms', () => {
  it('fixed window admits 2x the limit across a boundary (documented weakness); sliding ones do not', () => {
    const t = { now: 0 };
    const clock = () => t.now;
    const burst = (limiter: RateLimiter): number => {
      let admitted = 0;
      for (const at of [999, 1000]) {
        t.now = at;
        for (let i = 0; i < 10; i++) if (limiter.tryAcquire('k').allowed) admitted++;
      }
      return admitted;
    };
    expect(burst(new FixedWindowCounter({ limit: 10, windowMs: 1000, clock }))).toBe(20);
    expect(burst(new SlidingWindowLog({ limit: 10, windowMs: 1000, clock }))).toBe(10);
    expect(burst(new SlidingWindowCounter({ limit: 10, windowMs: 1000, clock }))).toBeLessThanOrEqual(10);
  });

  it('sliding window counter stays within its approximation bound under random traffic', () => {
    const rng = mulberry32(42);
    const t = { now: 0 };
    const limiter = new SlidingWindowCounter({ limit: 100, windowMs: 1000, clock: () => t.now });
    const admitted: number[] = [];
    while (t.now < 30_000) {
      t.now += Math.round(-Math.log(1 - rng()) * 5); // about 200 req/s offered, 2x the limit
      if (limiter.tryAcquire('k').allowed) admitted.push(t.now);
    }
    let maxInWindow = 0;
    for (let hi = 0, lo = 0; hi < admitted.length; hi++) {
      while (admitted[lo] <= admitted[hi] - 1000) lo++;
      maxInWindow = Math.max(maxInWindow, hi - lo + 1);
    }
    expect(maxInWindow).toBeLessThanOrEqual(110); // within 10 % of the limit in every true window
    expect(admitted.length).toBeGreaterThan(0.95 * 100 * 30); // and it does not starve the client
  });

  it('leaky bucket smooths a steady flood into evenly spaced admissions', () => {
    const t = { now: 0 };
    const bucket = new LeakyBucket({ capacity: 3, leakPerSecond: 2, clock: () => t.now });
    const admittedAt: number[] = [];
    for (t.now = 0; t.now <= 5_000; t.now += 50) if (bucket.tryAcquire('k').allowed) admittedAt.push(t.now);
    expect(admittedAt.slice(0, 3)).toEqual([0, 50, 100]); // initial burst up to capacity
    expect(admittedAt[3]).toBe(500); // the bucket held 2.8 units and had to drain to 2
    for (let i = 4; i < admittedAt.length; i++) {
      expect(admittedAt[i] - admittedAt[i - 1]).toBe(500); // then exactly one per 1/rate
    }
    expect(admittedAt.length).toBeGreaterThanOrEqual(12);
    expect(admittedAt.length).toBeLessThanOrEqual(13); // capacity + rate * 5 s
  });
});

describe('distributed limiter over a shared CounterStore', () => {
  it('read-modify-write over-admits when two gateways interleave; atomic increment does not', () => {
    const racy = simulateTwoGatewayRace({ limit: 10, requestsPerGateway: 10, mode: 'read-modify-write' });
    expect(racy.admitted).toBe(20);
    expect(racy.storedCount).toBe(10); // half the increments were lost
    const atomic = simulateTwoGatewayRace({ limit: 10, requestsPerGateway: 10, mode: 'atomic' });
    expect(atomic.admitted).toBe(10);
    expect(atomic.storedCount).toBe(10);
  });

  it('atomic limiter shares one budget across gateways and resets with the window TTL', () => {
    const t = { now: 0 };
    const store = new InMemoryCounterStore(() => t.now);
    const options = { limit: 5, windowMs: 1000, clock: () => t.now };
    const gateways = [new AtomicFixedWindowLimiter(store, options), new AtomicFixedWindowLimiter(store, options)];
    const results = Array.from({ length: 8 }, (_, i) => gateways[i % 2].tryAcquire('u').allowed);
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(store.get('u:0')).toBe(5);
    t.now = 1000;
    expect(store.get('u:0')).toBe(0); // expired by TTL
    expect(gateways[1].tryAcquire('u').allowed).toBe(true);
  });
});
