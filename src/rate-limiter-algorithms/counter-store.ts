/**
 * Distributed fixed-window limiting over a shared counter store (Redis in production),
 * and a deterministic race showing why the check and the increment must be one atomic step.
 */
import {
  allowed,
  checkCost,
  denied,
  windowStartOf,
  type Clock,
  type Decision,
  type RateLimiter,
  type WindowOptions,
} from './rate-limiter-algorithms';

/** The subset of Redis a distributed limiter needs, so the race can be shown in memory. */
export interface CounterStore {
  /** GET: the counter's value, 0 when absent or expired. */
  get(key: string): number;
  /** SET key value PX ttlMs. */
  set(key: string, value: number, ttlMs: number): void;
  /**
   * Atomic check-and-increment, what a Redis Lua script does in one round trip:
   * adds `cost` only if the result stays within `limit`; the TTL is set on creation.
   */
  incrementWithinWindow(key: string, cost: number, limit: number, ttlMs: number): { allowed: boolean; count: number };
}

/** A single-threaded in-memory CounterStore with TTLs driven by the injected clock. */
export class InMemoryCounterStore implements CounterStore {
  private readonly entries = new Map<string, { value: number; expiresAt: number }>();
  private readonly clock: Clock;
  /** Round trips served: the atomic path needs one per request, read-modify-write two. */
  operations = 0;

  constructor(clock: Clock = Date.now) {
    this.clock = clock;
  }

  get(key: string): number {
    this.operations++;
    return this.live(key)?.value ?? 0;
  }

  set(key: string, value: number, ttlMs: number): void {
    this.operations++;
    this.entries.set(key, { value, expiresAt: this.clock() + ttlMs });
  }

  incrementWithinWindow(key: string, cost: number, limit: number, ttlMs: number): { allowed: boolean; count: number } {
    this.operations++;
    const entry = this.live(key);
    const count = entry?.value ?? 0;
    if (count + cost > limit) return { allowed: false, count };
    this.entries.set(key, { value: count + cost, expiresAt: entry?.expiresAt ?? this.clock() + ttlMs });
    return { allowed: true, count: count + cost };
  }

  private live(key: string): { value: number; expiresAt: number } | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

/** A read taken by a gateway that has not yet written its decision back. */
export interface PendingCheck {
  windowKey: string;
  observed: number;
  ttlMs: number;
}

/**
 * The buggy distributed fixed window: GET the count, decide locally, SET count + cost.
 * Split into `read` and `commit` so a test can interleave two gateways between them.
 */
export class ReadModifyWriteLimiter implements RateLimiter {
  private readonly store: CounterStore;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(store: CounterStore, options: WindowOptions) {
    this.store = store;
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  read(key: string): PendingCheck {
    const now = this.clock();
    const windowStart = windowStartOf(now, this.windowMs);
    const windowKey = `${key}:${windowStart}`;
    return { windowKey, observed: this.store.get(windowKey), ttlMs: windowStart + this.windowMs - now };
  }

  commit(pending: PendingCheck, cost = 1): Decision {
    checkCost(cost, this.limit);
    if (pending.observed + cost > this.limit) return denied(this.limit - pending.observed, pending.ttlMs);
    this.store.set(pending.windowKey, pending.observed + cost, pending.ttlMs);
    return allowed(this.limit - pending.observed - cost);
  }

  tryAcquire(key: string, cost = 1): Decision {
    return this.commit(this.read(key), cost);
  }
}

/** The correct distributed fixed window: one atomic store call per request. */
export class AtomicFixedWindowLimiter implements RateLimiter {
  private readonly store: CounterStore;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(store: CounterStore, options: WindowOptions) {
    this.store = store;
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock ?? Date.now;
  }

  tryAcquire(key: string, cost = 1): Decision {
    checkCost(cost, this.limit);
    const now = this.clock();
    const windowStart = windowStartOf(now, this.windowMs);
    const ttlMs = windowStart + this.windowMs - now;
    const result = this.store.incrementWithinWindow(`${key}:${windowStart}`, cost, this.limit, ttlMs);
    return result.allowed ? allowed(this.limit - result.count) : denied(this.limit - result.count, ttlMs);
  }
}

export interface RaceResult {
  limit: number;
  admitted: number;
  /** What the shared counter says at the end. */
  storedCount: number;
}

/**
 * Two gateways share one counter and serve `requestsPerGateway` each for the same key.
 * In read-modify-write mode every round is: A reads, B reads, A writes, B writes, so
 * both see the same count and one increment is lost. In atomic mode each request is a
 * single indivisible store call. Deterministic: the interleaving is fixed.
 */
export function simulateTwoGatewayRace(options: {
  limit: number;
  requestsPerGateway: number;
  mode: 'read-modify-write' | 'atomic';
}): RaceResult {
  const clock: Clock = () => 0;
  const store = new InMemoryCounterStore(clock);
  const window: WindowOptions = { limit: options.limit, windowMs: 60_000, clock };
  let admitted = 0;
  if (options.mode === 'atomic') {
    const gateways = [new AtomicFixedWindowLimiter(store, window), new AtomicFixedWindowLimiter(store, window)];
    for (let i = 0; i < options.requestsPerGateway; i++) {
      for (const gateway of gateways) if (gateway.tryAcquire('user-1').allowed) admitted++;
    }
  } else {
    const a = new ReadModifyWriteLimiter(store, window);
    const b = new ReadModifyWriteLimiter(store, window);
    for (let i = 0; i < options.requestsPerGateway; i++) {
      const readA = a.read('user-1');
      const readB = b.read('user-1');
      if (a.commit(readA).allowed) admitted++;
      if (b.commit(readB).allowed) admitted++;
    }
  }
  return { limit: options.limit, admitted, storedCount: store.get('user-1:0') };
}
