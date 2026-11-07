/**
 * A leaderless, Dynamo-style replicated key-value store, simulated in memory.
 *
 * Every key lives on N replicas. A write succeeds once W replicas acknowledge
 * it; a read asks R replicas and returns the newest version it sees. When
 * R + W > N, every read quorum overlaps every write quorum, so reads see the
 * latest acknowledged write. Versions carry vector clocks so that concurrent
 * writes are kept as siblings instead of one silently overwriting the other.
 */

/** A vector clock as a plain record: process id -> counter. Missing entries are 0. */
export type Clock = Readonly<Record<string, number>>;

export type Ordering = 'BEFORE' | 'AFTER' | 'EQUAL' | 'CONCURRENT';

/** Pointwise comparison of two vector clocks. */
export function compareClocks(a: Clock, b: Clock): Ordering {
  let less = false;
  let greater = false;
  for (const node of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[node] ?? 0;
    const y = b[node] ?? 0;
    if (x < y) less = true;
    if (x > y) greater = true;
  }
  if (less && greater) return 'CONCURRENT';
  if (less) return 'BEFORE';
  if (greater) return 'AFTER';
  return 'EQUAL';
}

/** Pointwise maximum of vector clocks. */
export function mergeClocks(...clocks: Clock[]): Clock {
  const out: Record<string, number> = {};
  for (const c of clocks) for (const [n, v] of Object.entries(c)) out[n] = Math.max(out[n] ?? 0, v);
  return out;
}

/** A value with the vector clock of the write that produced it. */
export interface Versioned {
  value: string;
  clock: Clock;
}

/**
 * Adds `incoming` to a sibling set: drops versions it supersedes, ignores it if
 * an existing version supersedes or equals it, otherwise keeps it alongside.
 */
export function reconcile(existing: readonly Versioned[], incoming: Versioned): Versioned[] {
  const kept: Versioned[] = [];
  for (const v of existing) {
    const order = compareClocks(incoming.clock, v.clock);
    if (order === 'BEFORE' || order === 'EQUAL') return [...existing];
    if (order === 'CONCURRENT') kept.push(v);
  }
  return [...kept, incoming];
}

interface Hint {
  target: string;
  key: string;
  version: Versioned;
}

/** One storage node. Holds sibling sets per key and hints for peers that were down. */
class Replica {
  up = true;
  readonly data = new Map<string, Versioned[]>();
  readonly hints: Hint[] = [];

  constructor(readonly id: string) {}

  apply(key: string, version: Versioned): void {
    this.data.set(key, reconcile(this.data.get(key) ?? [], version));
  }

  read(key: string): Versioned[] {
    return this.data.get(key) ?? [];
  }
}

export interface QuorumKVOptions {
  /** Cluster members. Defaults to n nodes named node-1..node-n. */
  nodes?: string[];
  /** Replication factor. */
  n: number;
  /** Replicas that must acknowledge a read. */
  r: number;
  /** Replicas that must acknowledge a write. */
  w: number;
  /** Store hints for down replicas and deliver them when they recover. Default true. */
  hintedHandoff?: boolean;
  /** Count hints held by a node outside the preference list toward W (Dynamo's sloppy quorum). Default false. */
  sloppyQuorum?: boolean;
}

export interface PutOptions {
  /** Clock from a previous get: the versions this write supersedes. Defaults to what the coordinator holds. */
  context?: Clock;
  /** Node that coordinates the write and stamps the clock. Defaults to the first up home replica. */
  coordinator?: string;
}

export interface PutResult {
  ok: boolean;
  acks: number;
  clock: Clock;
  /** Down replicas for which a hint was stored, and where. */
  hinted: { target: string; heldBy: string }[];
}

export interface GetResult {
  ok: boolean;
  /** One value normally; several when concurrent writes produced siblings. */
  values: string[];
  /** Merged clock of the returned versions: pass it to put to resolve siblings. */
  context: Clock;
  /** Replicas that answered. */
  respondedBy: string[];
  /** Replicas that were stale and got repaired. */
  repaired: string[];
}

function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * The cluster and its coordinator logic.
 *
 * Placement is a simple ring: a key's preference list is the n nodes starting
 * at hash(key) mod clusterSize. Requests are synchronous and deterministic:
 * reads use the first R up home replicas in preference order, writes go to every
 * up home replica, and node failures are explicit `markDown` / `markUp` calls.
 */
export class QuorumKV {
  readonly n: number;
  readonly r: number;
  readonly w: number;
  private readonly replicas = new Map<string, Replica>();
  private readonly order: string[];
  private readonly hintedHandoff: boolean;
  private readonly sloppyQuorum: boolean;

  constructor(options: QuorumKVOptions) {
    const nodes = options.nodes ?? Array.from({ length: options.n }, (_, i) => `node-${i + 1}`);
    if (options.n < 1 || options.n > nodes.length) throw new RangeError('need 1 <= n <= cluster size');
    if (options.r < 1 || options.r > options.n || options.w < 1 || options.w > options.n) throw new RangeError('need 1 <= r, w <= n');
    this.n = options.n;
    this.r = options.r;
    this.w = options.w;
    this.order = [...nodes];
    for (const id of nodes) this.replicas.set(id, new Replica(id));
    this.hintedHandoff = options.hintedHandoff ?? true;
    this.sloppyQuorum = options.sloppyQuorum ?? false;
  }

  /** True when every read quorum must intersect every write quorum. */
  get isStrictQuorum(): boolean {
    return this.r + this.w > this.n;
  }

  /** The n home replicas for `key`, in preference order. */
  preferenceList(key: string): string[] {
    const start = fnv1a(key) % this.order.length;
    return Array.from({ length: this.n }, (_, i) => this.order[(start + i) % this.order.length]);
  }

  markDown(node: string): void {
    this.replica(node).up = false;
  }

  /** Brings a node back and delivers every hint that can now reach its target. */
  markUp(node: string): void {
    this.replica(node).up = true;
    this.deliverHints();
  }

  isUp(node: string): boolean {
    return this.replica(node).up;
  }

  /** Inspect one replica's copy directly (bypassing quorum), for tests and demos. */
  replicaValues(node: string, key: string): string[] {
    return this.replica(node).read(key).map((v) => v.value);
  }

  /** Number of hints waiting on `node` to be handed off. */
  pendingHints(node: string): number {
    return this.replica(node).hints.length;
  }

  put(key: string, value: string, options: PutOptions = {}): PutResult {
    const home = this.preferenceList(key);
    const coordinatorId = options.coordinator ?? home.find((id) => this.isUp(id));
    if (coordinatorId === undefined || !this.isUp(coordinatorId)) return { ok: false, acks: 0, clock: {}, hinted: [] };
    const coordinator = this.replica(coordinatorId);
    const context = options.context ?? mergeClocks(...coordinator.read(key).map((v) => v.clock));
    const clock = mergeClocks(context, { [coordinatorId]: (context[coordinatorId] ?? 0) + 1 });
    const version: Versioned = { value, clock };
    let acks = 0;
    const hinted: PutResult['hinted'] = [];
    for (const id of home) {
      const target = this.replica(id);
      if (target.up) {
        target.apply(key, version);
        acks += 1;
      } else if (this.hintedHandoff) {
        const substitute = this.order.find((s) => !home.includes(s) && this.isUp(s));
        const holder = this.replica(substitute ?? coordinatorId);
        holder.hints.push({ target: id, key, version });
        hinted.push({ target: id, heldBy: holder.id });
        if (substitute !== undefined && this.sloppyQuorum) acks += 1;
      }
    }
    // Like Dynamo and Cassandra, a failed write is not rolled back: replicas that applied it keep it.
    return { ok: acks >= this.w, acks, clock, hinted };
  }

  get(key: string): GetResult {
    const contacted = this.preferenceList(key).filter((id) => this.isUp(id)).slice(0, this.r);
    if (contacted.length < this.r) return { ok: false, values: [], context: {}, respondedBy: contacted, repaired: [] };
    let merged: Versioned[] = [];
    for (const id of contacted) for (const v of this.replica(id).read(key)) merged = reconcile(merged, v);
    const repaired: string[] = [];
    for (const id of contacted) {
      const replica = this.replica(id);
      const before = replica.read(key);
      for (const v of merged) replica.apply(key, v);
      if (!sameVersions(before, replica.read(key))) repaired.push(id);
    }
    return {
      ok: true,
      values: merged.map((v) => v.value).sort(),
      context: mergeClocks(...merged.map((v) => v.clock)),
      respondedBy: contacted,
      repaired,
    };
  }

  private deliverHints(): void {
    for (const holder of this.replicas.values()) {
      if (!holder.up) continue;
      const remaining: Hint[] = [];
      for (const hint of holder.hints) {
        const target = this.replica(hint.target);
        if (target.up) target.apply(hint.key, hint.version);
        else remaining.push(hint);
      }
      holder.hints.splice(0, holder.hints.length, ...remaining);
    }
  }

  private replica(id: string): Replica {
    const r = this.replicas.get(id);
    if (!r) throw new Error(`unknown node ${id}`);
    return r;
  }
}

function sameVersions(a: readonly Versioned[], b: readonly Versioned[]): boolean {
  return a.length === b.length && a.every((v) => b.some((u) => compareClocks(u.clock, v.clock) === 'EQUAL'));
}
