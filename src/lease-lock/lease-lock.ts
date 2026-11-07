/**
 * Distributed locks with leases and fencing tokens.
 *
 * A lock in a distributed system must expire, because the holder can crash.
 * Expiry creates a new failure: a holder that pauses (GC, VM migration, network
 * stall) can wake up after its lease ended and still believe it holds the lock.
 * Fencing tokens close that gap: every grant carries a number that only goes
 * up, and the protected resource rejects any write with an older number.
 */

/** Milliseconds since some epoch. Injected so tests control time. */
export type Clock = () => number;

/** A key in the coordination store, with etcd-style revisions. */
export interface StoreEntry {
  key: string;
  value: string;
  /** Revision at which the key was created (stable across updates). */
  createRevision: number;
  /** Revision of the latest update. */
  modRevision: number;
  /** Absolute expiry time, or undefined for no lease. */
  expiresAt?: number;
}

/**
 * A fake linearizable coordination store in the style of etcd or ZooKeeper.
 *
 * One global revision counter increments on every successful write, so
 * revisions are totally ordered across keys. Writes are compare-and-set on the
 * key's modRevision (0 means "must not exist"). Keys may carry a lease; once
 * the clock passes the expiry the key behaves as if deleted.
 */
export class CoordinationStore {
  private readonly data = new Map<string, StoreEntry>();
  private rev = 0;

  constructor(private readonly clock: Clock) {}

  /** The latest revision issued by the store. */
  get revision(): number {
    return this.rev;
  }

  get(key: string): StoreEntry | undefined {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt !== undefined && this.clock() >= entry.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return entry ? { ...entry } : undefined;
  }

  /**
   * Writes `value` only if the key's current modRevision equals `expectedModRevision`
   * (0 for absent). A new key gets createRevision = the new revision; an update keeps it.
   * Returns the new entry, or undefined when the comparison fails.
   */
  compareAndSet(key: string, expectedModRevision: number, value: string, ttlMs?: number): StoreEntry | undefined {
    const current = this.get(key);
    if ((current?.modRevision ?? 0) !== expectedModRevision) return undefined;
    this.rev += 1;
    const entry: StoreEntry = {
      key,
      value,
      createRevision: current?.createRevision ?? this.rev,
      modRevision: this.rev,
      expiresAt: ttlMs === undefined ? undefined : this.clock() + ttlMs,
    };
    this.data.set(key, entry);
    return { ...entry };
  }

  /** Deletes only if modRevision matches. */
  compareAndDelete(key: string, expectedModRevision: number): boolean {
    const current = this.get(key);
    if (!current || current.modRevision !== expectedModRevision) return false;
    this.rev += 1;
    this.data.delete(key);
    return true;
  }
}

/** A granted lock. `token` is the fencing token to send with every protected write. */
export interface Lease {
  resource: string;
  owner: string;
  token: number;
  expiresAt: number;
}

/**
 * A lease-based lock over the coordination store.
 *
 * The fencing token is the lock key's createRevision, exactly as etcd's lock
 * API does: it stays the same while one holder renews, and any later holder
 * gets a strictly larger one because the store's revision only increases.
 */
export class LeaseLock {
  constructor(
    private readonly store: CoordinationStore,
    private readonly clock: Clock,
  ) {}

  /** Tries to take `resource`. Returns the lease, or undefined if someone else holds it. */
  acquire(resource: string, owner: string, ttlMs: number): Lease | undefined {
    if (ttlMs <= 0) throw new RangeError('ttlMs must be > 0');
    if (this.store.get(this.key(resource))) return undefined;
    const entry = this.store.compareAndSet(this.key(resource), 0, owner, ttlMs);
    return entry ? this.toLease(resource, entry) : undefined;
  }

  /** Extends a still-valid lease. Fails if it already expired or was taken over. */
  renew(lease: Lease, ttlMs: number): Lease | undefined {
    const current = this.validEntry(lease);
    if (!current) return undefined;
    const entry = this.store.compareAndSet(this.key(lease.resource), current.modRevision, lease.owner, ttlMs);
    return entry ? this.toLease(lease.resource, entry) : undefined;
  }

  /** Releases the lock. Only the current holder (same owner and token) can release. */
  release(lease: Lease): boolean {
    const current = this.validEntry(lease);
    return current ? this.store.compareAndDelete(this.key(lease.resource), current.modRevision) : false;
  }

  /** The current holder of `resource`, if any. */
  holder(resource: string): Lease | undefined {
    const entry = this.store.get(this.key(resource));
    return entry ? this.toLease(resource, entry) : undefined;
  }

  private validEntry(lease: Lease): StoreEntry | undefined {
    const current = this.store.get(this.key(lease.resource));
    if (!current || current.value !== lease.owner || current.createRevision !== lease.token) return undefined;
    return current;
  }

  private key(resource: string): string {
    return `/locks/${resource}`;
  }

  private toLease(resource: string, entry: StoreEntry): Lease {
    return { resource, owner: entry.value, token: entry.createRevision, expiresAt: entry.expiresAt ?? Infinity };
  }
}

/** Outcome of a write to the fenced storage service. */
export interface WriteResult {
  ok: boolean;
  reason?: string;
}

/**
 * A storage service that enforces fencing.
 *
 * It remembers the highest token it has accepted per resource and rejects any
 * write carrying a smaller one. This check must live in the resource itself:
 * the client cannot do it, because the client is the one that was paused.
 */
export class FencedStorage {
  private readonly values = new Map<string, string>();
  private readonly highestToken = new Map<string, number>();
  private readonly rejected: { key: string; token: number }[] = [];

  write(key: string, value: string, token: number): WriteResult {
    const highest = this.highestToken.get(key) ?? 0;
    if (token < highest) {
      this.rejected.push({ key, token });
      return { ok: false, reason: `stale fencing token ${token} < ${highest}` };
    }
    this.highestToken.set(key, token);
    this.values.set(key, value);
    return { ok: true };
  }

  read(key: string): string | undefined {
    return this.values.get(key);
  }

  get rejectedWrites(): readonly { key: string; token: number }[] {
    return this.rejected;
  }
}

/**
 * Leader election built on a lease, like etcd's election API.
 *
 * Each candidate campaigns by trying to acquire the election lock; the winner
 * must keep renewing before its TTL runs out. If it stops (crash, partition),
 * the lease expires and the next campaign by another candidate wins, with a
 * higher token that downstream systems can use to fence the old leader.
 */
export class LeaderElector {
  private lease: Lease | undefined;

  constructor(
    private readonly lock: LeaseLock,
    private readonly election: string,
    readonly candidate: string,
    private readonly ttlMs: number,
  ) {}

  /** Becomes leader if the seat is free, or renews if already leader. Returns true while leader. */
  campaign(): boolean {
    if (this.lease) {
      this.lease = this.lock.renew(this.lease, this.ttlMs);
      if (this.lease) return true;
    }
    this.lease = this.lock.acquire(this.election, this.candidate, this.ttlMs);
    return this.lease !== undefined;
  }

  /** Steps down voluntarily so another candidate can take over immediately. */
  resign(): boolean {
    if (!this.lease) return false;
    const released = this.lock.release(this.lease);
    this.lease = undefined;
    return released;
  }

  /** Whether this candidate still holds a valid lease (checked against the store). */
  isLeader(): boolean {
    const current = this.lock.holder(this.election);
    return current !== undefined && this.lease !== undefined && current.token === this.lease.token && current.owner === this.candidate;
  }

  /** Fencing token of this candidate's term, if it holds one. */
  get term(): number | undefined {
    return this.isLeader() ? this.lease?.token : undefined;
  }

  /** The current leader as seen by the store. */
  static currentLeader(lock: LeaseLock, election: string): { id: string; term: number } | undefined {
    const h = lock.holder(election);
    return h ? { id: h.owner, term: h.token } : undefined;
  }
}
