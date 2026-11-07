import { createHash } from 'node:crypto';

/**
 * Merkle trees for anti-entropy: finding what differs between two replicas
 * without shipping the data.
 *
 * Keys are bucketed by hash range into 2^depth leaves. Each leaf hashes the
 * sorted key/value pairs in its bucket; each internal node hashes its two
 * children. Two replicas compare roots first and descend only into subtrees
 * whose hashes differ, so a single divergent key costs O(depth) comparisons
 * instead of a full scan.
 */

/** Hex-encoded SHA-256. Exported so verifiers use the same function. */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 32-bit position of a key on the hash range; the top `depth` bits select its bucket. */
export function keyPosition(key: string): number {
  return createHash('md5').update(key).digest().readUInt32BE(0);
}

const EMPTY_BUCKET = sha256('bucket:');

function leafHash(entries: readonly (readonly [string, string])[]): string {
  return sha256(`bucket:${entries.map(([k, v]) => `${JSON.stringify(k)}=${JSON.stringify(v)}`).join(';')}`);
}

function nodeHash(left: string, right: string): string {
  return sha256(`node:${left}${right}`);
}

/** Result of comparing two trees. */
export interface DiffResult {
  /** Indexes of leaves (hash ranges) whose contents differ. */
  buckets: number[];
  /** Number of node-hash comparisons performed. */
  comparisons: number;
}

/** One step of an audit path: the sibling's hash and which side it sits on. */
export interface ProofStep {
  sibling: string;
  side: 'left' | 'right';
}

/**
 * Proof that a key/value pair is in the tree with a given root.
 * It carries the whole bucket (the leaf's preimage) plus the sibling hashes up to the root.
 */
export interface InclusionProof {
  bucket: number;
  entries: [string, string][];
  path: ProofStep[];
}

export interface MerkleTreeOptions {
  /** Tree depth; the tree has 2^depth buckets. Cassandra's repair trees default to depth 15. */
  depth?: number;
}

/**
 * A fixed-shape Merkle tree over hash-bucketed key ranges.
 *
 * Fixed shape (rather than one leaf per key) means two replicas with different
 * key sets still have comparable trees: bucket i always covers the same slice
 * of the hash space. Nodes live in an implicit heap array: root at 1, children
 * of i at 2i and 2i+1, leaves at 2^depth .. 2^(depth+1)-1.
 */
export class MerkleTree {
  readonly depth: number;
  private readonly bucketData: Map<string, string>[];
  private readonly nodes: string[];

  constructor(options: MerkleTreeOptions = {}) {
    this.depth = options.depth ?? 10;
    if (!Number.isInteger(this.depth) || this.depth < 0 || this.depth > 20) throw new RangeError('depth must be 0..20');
    this.bucketData = Array.from({ length: this.bucketCount }, () => new Map<string, string>());
    this.nodes = new Array<string>(2 * this.bucketCount).fill(EMPTY_BUCKET);
    for (let i = this.bucketCount - 1; i >= 1; i--) this.nodes[i] = nodeHash(this.nodes[2 * i], this.nodes[2 * i + 1]);
  }

  /** Builds a tree from entries in one pass (O(n + buckets)). */
  static from(entries: Iterable<readonly [string, string]>, options: MerkleTreeOptions = {}): MerkleTree {
    const tree = new MerkleTree(options);
    for (const [k, v] of entries) tree.bucketData[tree.bucketOf(k)].set(k, v);
    for (let b = 0; b < tree.bucketCount; b++) tree.nodes[tree.bucketCount + b] = leafHash(tree.sortedEntries(b));
    for (let i = tree.bucketCount - 1; i >= 1; i--) tree.nodes[i] = nodeHash(tree.nodes[2 * i], tree.nodes[2 * i + 1]);
    return tree;
  }

  get bucketCount(): number {
    return 2 ** this.depth;
  }

  get root(): string {
    return this.nodes[1];
  }

  /** Which bucket (hash range) a key falls in. */
  bucketOf(key: string): number {
    return this.depth === 0 ? 0 : keyPosition(key) >>> (32 - this.depth);
  }

  /** Inclusive start and exclusive end of a bucket's slice of the 32-bit hash space. */
  bucketRange(bucket: number): [number, number] {
    const width = 2 ** (32 - this.depth);
    return [bucket * width, (bucket + 1) * width];
  }

  /** Inserts or updates a key and rehashes only its path to the root: O(depth + bucket size). */
  set(key: string, value: string): void {
    const b = this.bucketOf(key);
    this.bucketData[b].set(key, value);
    this.rehashPath(b);
  }

  delete(key: string): boolean {
    const b = this.bucketOf(key);
    const removed = this.bucketData[b].delete(key);
    if (removed) this.rehashPath(b);
    return removed;
  }

  /** Sorted key/value pairs in a bucket: what a replica would stream during repair. */
  bucketEntries(bucket: number): [string, string][] {
    return this.sortedEntries(bucket);
  }

  /**
   * Finds differing buckets by walking both trees from the root and descending
   * only where hashes disagree. Each hash comparison is counted.
   */
  diff(other: MerkleTree): DiffResult {
    if (other.depth !== this.depth) throw new Error('trees must have the same depth to be compared');
    const buckets: number[] = [];
    let comparisons = 0;
    const visit = (index: number): void => {
      comparisons += 1;
      if (this.nodes[index] === other.nodes[index]) return;
      if (index >= this.bucketCount) {
        buckets.push(index - this.bucketCount);
        return;
      }
      visit(2 * index);
      visit(2 * index + 1);
    };
    visit(1);
    return { buckets, comparisons };
  }

  /** Builds an inclusion proof for `key`, or undefined if the key is absent. */
  proof(key: string): InclusionProof | undefined {
    const bucket = this.bucketOf(key);
    if (!this.bucketData[bucket].has(key)) return undefined;
    const path: ProofStep[] = [];
    for (let i = this.bucketCount + bucket; i > 1; i >>>= 1) {
      const isLeft = i % 2 === 0;
      path.push({ sibling: this.nodes[isLeft ? i + 1 : i - 1], side: isLeft ? 'right' : 'left' });
    }
    return { bucket, entries: this.sortedEntries(bucket), path };
  }

  private sortedEntries(bucket: number): [string, string][] {
    return [...this.bucketData[bucket].entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private rehashPath(bucket: number): void {
    let i = this.bucketCount + bucket;
    this.nodes[i] = leafHash(this.sortedEntries(bucket));
    for (i >>>= 1; i >= 1; i >>>= 1) this.nodes[i] = nodeHash(this.nodes[2 * i], this.nodes[2 * i + 1]);
  }
}

/**
 * Checks an inclusion proof against a trusted root hash, without the tree.
 *
 * The verifier recomputes the leaf from the bucket entries, folds in each
 * sibling hash up to the root, and compares. Changing any value, any sibling
 * or the root makes the check fail.
 */
export function verifyProof(root: string, key: string, value: string, proof: InclusionProof): boolean {
  const entry = proof.entries.find(([k]) => k === key);
  if (!entry || entry[1] !== value) return false;
  const sorted = [...proof.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.some(([k], i) => k !== proof.entries[i][0] || (i > 0 && k === sorted[i - 1][0]))) return false;
  const depth = proof.path.length;
  if (depth < 32 && keyPositionBucket(key, depth) !== proof.bucket) return false;
  let hash = leafHash(proof.entries);
  let index = proof.bucket;
  for (const step of proof.path) {
    const expectedSide = index % 2 === 0 ? 'right' : 'left';
    if (step.side !== expectedSide) return false;
    hash = step.side === 'right' ? nodeHash(hash, step.sibling) : nodeHash(step.sibling, hash);
    index >>>= 1;
  }
  return hash === root;
}

function keyPositionBucket(key: string, depth: number): number {
  return depth === 0 ? 0 : keyPosition(key) >>> (32 - depth);
}
