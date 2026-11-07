import { createHash } from 'node:crypto';

/** 32-bit unsigned hash of a string. MD5 is fine here: we need spread, not security. */
export type HashFn = (key: string) => number;

export const md5Hash32: HashFn = (key) => createHash('md5').update(key).digest().readUInt32BE(0);

export interface ConsistentHashRingOptions {
  /** Positions per physical node. 100-200 gives load within a few percent of uniform. */
  virtualNodes?: number;
  hashFn?: HashFn;
}

interface RingEntry<TNode> {
  hash: number;
  node: TNode;
}

/**
 * A consistent hash ring with virtual nodes.
 *
 * Nodes and keys are hashed onto a 2^32 ring; a key belongs to the first node
 * clockwise from its position. Adding or removing one of N nodes moves only
 * about 1/N of the keys. Lookups are O(log V) via binary search over the
 * sorted vnode positions.
 */
export class ConsistentHashRing<TNode extends string = string> {
  private readonly ring: RingEntry<TNode>[] = [];
  private readonly nodes = new Set<TNode>();
  private readonly virtualNodes: number;
  private readonly hashFn: HashFn;

  constructor(options: ConsistentHashRingOptions = {}) {
    this.virtualNodes = options.virtualNodes ?? 150;
    this.hashFn = options.hashFn ?? md5Hash32;
    if (this.virtualNodes < 1) throw new RangeError('virtualNodes must be >= 1');
  }

  get size(): number {
    return this.nodes.size;
  }

  get nodeList(): TNode[] {
    return [...this.nodes].sort();
  }

  addNode(node: TNode): void {
    if (this.nodes.has(node)) return;
    this.nodes.add(node);
    for (let i = 0; i < this.virtualNodes; i++) {
      this.insert({ hash: this.hashFn(`${node}#${i}`), node });
    }
  }

  removeNode(node: TNode): void {
    if (!this.nodes.delete(node)) return;
    let write = 0;
    for (let read = 0; read < this.ring.length; read++) {
      const entry = this.ring[read];
      if (entry.node !== node) this.ring[write++] = entry;
    }
    this.ring.length = write;
  }

  /** The node responsible for `key`, or undefined when the ring is empty. */
  getNode(key: string): TNode | undefined {
    if (this.ring.length === 0) return undefined;
    return this.ring[this.successorIndex(this.hashFn(key))].node;
  }

  /**
   * The next `count` distinct physical nodes clockwise from `key`: the
   * preference list used for replication in Dynamo-style stores.
   */
  getNodes(key: string, count: number): TNode[] {
    if (this.ring.length === 0 || count <= 0) return [];
    const wanted = Math.min(count, this.nodes.size);
    const result: TNode[] = [];
    const seen = new Set<TNode>();
    let index = this.successorIndex(this.hashFn(key));
    while (result.length < wanted) {
      const { node } = this.ring[index];
      if (!seen.has(node)) {
        seen.add(node);
        result.push(node);
      }
      index = (index + 1) % this.ring.length;
    }
    return result;
  }

  /** How many of `keys` land on each node. Useful for checking balance. */
  distribution(keys: Iterable<string>): Map<TNode, number> {
    const counts = new Map<TNode, number>();
    for (const node of this.nodes) counts.set(node, 0);
    for (const key of keys) {
      const node = this.getNode(key);
      if (node !== undefined) counts.set(node, (counts.get(node) ?? 0) + 1);
    }
    return counts;
  }

  /** Index of the first ring entry with hash >= target, wrapping to 0. */
  private successorIndex(target: number): number {
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < target) lo = mid + 1;
      else hi = mid;
    }
    return lo === this.ring.length ? 0 : lo;
  }

  private insert(entry: RingEntry<TNode>): void {
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid].hash < entry.hash) lo = mid + 1;
      else hi = mid;
    }
    this.ring.splice(lo, 0, entry);
  }
}
