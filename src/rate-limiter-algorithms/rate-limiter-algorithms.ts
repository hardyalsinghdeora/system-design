/**
 * Five classic rate-limiting algorithms behind one interface, plus a simulated
 * shared counter store that shows why a limiter shared by several gateways
 * needs an atomic check-and-increment.
 */

/** Milliseconds since some origin. Injected so tests and demos control time. */
export type Clock = () => number;

/** The answer a limiter gives for one request. */
export interface Decision {
  allowed: boolean;
  /** Units still available after this call, rounded down (an estimate for approximate algorithms). */
  remaining: number;
  /** 0 when allowed; otherwise the wait after which the same request would be admitted. */
  retryAfterMs: number;
}

/** Common interface: one call per request, spending `cost` units (default 1). */
export interface RateLimiter {
  tryAcquire(key: string, cost?: number): Decision;
}

/** Tolerance for floating-point drift in refill and weighting arithmetic. */
const EPS = 1e-9;

// The helpers below are exported for counter-store.ts in this folder, not as public API.

export function checkPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive number`);
}

export function checkCost(cost: number, limit: number): void {
  checkPositive('cost', cost);
  if (cost > limit) throw new RangeError(`cost ${cost} exceeds the limit ${limit} and could never be admitted`);
}

export function allowed(remaining: number): Decision {
  return { allowed: true, remaining: Math.max(0, Math.floor(remaining + EPS)), retryAfterMs: 0 };
}

export function denied(remaining: number, waitMs: number): Decision {
  return {
    allowed: false,
    remaining: Math.max(0, Math.floor(remaining + EPS)),
    retryAfterMs: Math.max(1, Math.ceil(waitMs - EPS)),
  };
}

export interface TokenBucketOptions {
  /** Largest burst allowed. */
  capacity: number;
  /** Sustained rate, tokens per second. */
  refillPerSecond: number;
  clock?: Clock;
}

/**
 * Token bucket: tokens refill continuously up to `capacity`; each request spends `cost`.
 * Allows bursts up to the capacity while holding the long-run rate to `refillPerSecond`,
 * and needs only two numbers per key, which is why API gateways default to it.
 */
export class TokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly clock: Clock;

  constructor(options: TokenBucketOptions) {
    checkPositive('capacity', options.capacity);
    checkPositive('refillPerSecond', options.refillPerSecond);
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.clock = options.clock ?? Date.now;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.capacity);
    const now = this.clock();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens + EPS >= cost) {
      bucket.tokens = Math.max(0, bucket.tokens - cost);
      return allowed(bucket.tokens);
    }
    return denied(bucket.tokens, (cost - bucket.tokens) / this.refillPerMs);
  }
}

export interface LeakyBucketOptions {
  /** How much can be queued (poured in) before requests are rejected. */
  capacity: number;
  /** Constant drain rate, units per second. */
  leakPerSecond: number;
  clock?: Clock;
}

/**
 * Leaky bucket as a meter: each request pours `cost` into a bucket that drains at a
 * constant rate, and a request that would overflow is rejected. With a small capacity
 * it forces admitted requests to be evenly spaced, which smooths load on a backend.
 * The queue variant holds requests and releases them at the drain rate; this meter
 * variant rejects instead, so it needs no timers.
 */
export class LeakyBucket implements RateLimiter {
  private readonly buckets = new Map<string, { level: number; updatedAt: number }>();
  private readonly capacity: number;
  private readonly leakPerMs: number;
  private readonly clock: Clock;

  constructor(options: LeakyBucketOptions) {
    checkPositive('capacity', options.capacity);
    checkPositive('leakPerSecond', options.leakPerSecond);
    this.capacity = options.capacity;
    this.leakPerMs = options.leakPerSecond / 1000;
    this.clock = options.clock ?? Date.now;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.capacity);
    const now = this.clock();
    const bucket = this.buckets.get(key) ?? { level: 0, updatedAt: now };
    bucket.level = Math.max(0, bucket.level - Math.max(0, now - bucket.updatedAt) * this.leakPerMs);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);
    if (bucket.level + cost <= this.capacity + EPS) {
      bucket.level += cost;
      return allowed(this.capacity - bucket.level);
    }
    return denied(this.capacity - bucket.level, (bucket.level + cost - this.capacity) / this.leakPerMs);
  }
}

/** Options shared by the window-based limiters. */
export interface WindowOptions {
  /** Units allowed per window. */
  limit: number;
  windowMs: number;
  clock?: Clock;
}

export function windowStartOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Fixed window counter: one counter per key per aligned window. The cheapest option
 * (one INCR in Redis) but it resets at the boundary, so a client can send `limit` at the
 * end of one window and `limit` at the start of the next: up to 2x the limit in a moment.
 */
export class FixedWindowCounter implements RateLimiter {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(options: WindowOptions) {
    checkPositive('limit', options.limit);
    checkPositive('windowMs', options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.limit);
    const now = this.clock();
    const windowStart = windowStartOf(now, this.windowMs);
    let state = this.windows.get(key);
    if (!state || state.windowStart !== windowStart) {
      state = { windowStart, count: 0 };
      this.windows.set(key, state);
    }
    if (state.count + cost <= this.limit) {
      state.count += cost;
      return allowed(this.limit - state.count);
    }
    return denied(this.limit - state.count, windowStart + this.windowMs - now);
  }
}

/**
 * Sliding window log: keeps the timestamp of every admitted request in the last window.
 * Exact (never more than `limit` in any window of `windowMs`), at the cost of memory
 * proportional to the limit per key.
 */
export class SlidingWindowLog implements RateLimiter {
  private readonly logs = new Map<string, { entries: { at: number; cost: number }[]; used: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(options: WindowOptions) {
    checkPositive('limit', options.limit);
    checkPositive('windowMs', options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.limit);
    const now = this.clock();
    const log = this.logs.get(key) ?? { entries: [], used: 0 };
    this.logs.set(key, log);
    // The window is (now - windowMs, now]: an entry exactly windowMs old has expired.
    while (log.entries.length > 0 && log.entries[0].at <= now - this.windowMs) {
      log.used -= (log.entries.shift() as { cost: number }).cost;
    }
    if (log.used + cost <= this.limit) {
      log.entries.push({ at: now, cost });
      log.used += cost;
      return allowed(this.limit - log.used);
    }
    const needed = log.used + cost - this.limit;
    let freed = 0;
    for (const entry of log.entries) {
      freed += entry.cost;
      if (freed >= needed) return denied(this.limit - log.used, entry.at + this.windowMs - now);
    }
    return denied(this.limit - log.used, this.windowMs);
  }
}

/**
 * Sliding window counter: two counters per key (this window, previous window) and an
 * estimate that weights the previous window by how much of it still overlaps the
 * sliding window. O(1) memory like the fixed window, without the boundary burst.
 * It assumes the previous window's requests were spread evenly, so it is approximate.
 */
export class SlidingWindowCounter implements RateLimiter {
  private readonly windows = new Map<string, { windowStart: number; current: number; previous: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(options: WindowOptions) {
    checkPositive('limit', options.limit);
    checkPositive('windowMs', options.windowMs);
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  /** The weighted count the next decision for `key` would use. */
  estimate(key: string): number {
    const now = this.clock();
    const state = this.roll(key, now);
    return state.previous * (1 - (now - state.windowStart) / this.windowMs) + state.current;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.limit);
    const now = this.clock();
    const state = this.roll(key, now);
    const elapsed = now - state.windowStart;
    const estimate = state.previous * (1 - elapsed / this.windowMs) + state.current;
    if (estimate + cost <= this.limit + EPS) {
      state.current += cost;
      return allowed(this.limit - estimate - cost);
    }
    // Later in this window, once the previous window's weight has decayed enough.
    if (state.current + cost <= this.limit && state.previous > 0) {
      const neededElapsed = this.windowMs * (1 - (this.limit - state.current - cost) / state.previous);
      return denied(this.limit - estimate, neededElapsed - elapsed);
    }
    // Otherwise in the next window, where today's count becomes the decaying previous count.
    const toNext = this.windowMs - elapsed;
    const intoNext = state.current > 0 ? this.windowMs * (1 - (this.limit - cost) / state.current) : 0;
    return denied(this.limit - estimate, toNext + Math.max(0, intoNext));
  }

  private roll(key: string, now: number): { windowStart: number; current: number; previous: number } {
    const windowStart = windowStartOf(now, this.windowMs);
    let state = this.windows.get(key);
    if (!state) {
      state = { windowStart, current: 0, previous: 0 };
      this.windows.set(key, state);
    } else if (state.windowStart !== windowStart) {
      state.previous = windowStart - state.windowStart === this.windowMs ? state.current : 0;
      state.current = 0;
      state.windowStart = windowStart;
    }
    return state;
  }
}
