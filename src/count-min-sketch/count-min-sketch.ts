import { createHash } from 'node:crypto';

/** Table shape for a count-min sketch. */
export interface SketchDimensions {
  /** Counters per row: ceil(e / epsilon). */
  width: number;
  /** Rows (independent hash functions): ceil(ln(1 / delta)). */
  depth: number;
}

/**
 * The width and depth that guarantee estimate <= true + epsilon * N with probability
 * at least 1 - delta for each item, where N is the total count added.
 */
export function sketchDimensions(epsilon: number, delta: number): SketchDimensions {
  if (!(epsilon > 0 && epsilon < 1)) throw new RangeError('epsilon must be in (0, 1)');
  if (!(delta > 0 && delta < 1)) throw new RangeError('delta must be in (0, 1)');
  return { width: Math.ceil(Math.E / epsilon), depth: Math.ceil(Math.log(1 / delta)) };
}

export interface CountMinSketchOptions {
  epsilon: number;
  delta: number;
  /** Conservative update: raise only the counters that are below the new minimum. */
  conservative?: boolean;
  /** Hash seed. Sketches can only be merged when they share it. */
  seed?: string;
}

/**
 * Count-min sketch: approximate frequency counts for a stream in fixed memory.
 * Each item increments one counter per row; its estimate is the minimum across rows.
 * Collisions only add, so estimates never undercount, and the overcount is bounded
 * by epsilon * N with probability 1 - delta.
 */
export class CountMinSketch {
  readonly width: number;
  readonly depth: number;
  readonly conservative: boolean;
  readonly seed: string;
  private readonly table: Float64Array;
  private total = 0;

  constructor(options: CountMinSketchOptions) {
    const { width, depth } = sketchDimensions(options.epsilon, options.delta);
    this.width = width;
    this.depth = depth;
    this.conservative = options.conservative ?? false;
    this.seed = options.seed ?? 'cms';
    this.table = new Float64Array(width * depth);
  }

  /** Sum of all counts added: the N in the epsilon * N error bound. */
  get totalCount(): number {
    return this.total;
  }

  /** The additive error bound (e / width) * N that holds with probability 1 - delta. */
  get errorBound(): number {
    return (Math.E / this.width) * this.total;
  }

  get sizeInBytes(): number {
    return this.table.byteLength;
  }

  /** Adds `count` occurrences of `item` and returns its new estimate. */
  add(item: string, count = 1): number {
    if (!Number.isFinite(count) || count < 0) throw new RangeError('count must be a non-negative number');
    const cells = this.cells(item);
    this.total += count;
    if (this.conservative) {
      // Only the minimum counter must grow by `count`; others already cover the new total.
      const target = this.minAt(cells) + count;
      for (const c of cells) if (this.table[c] < target) this.table[c] = target;
      return target;
    }
    let min = Infinity;
    for (const c of cells) {
      this.table[c] += count;
      if (this.table[c] < min) min = this.table[c];
    }
    return min;
  }

  /** Upper-bound estimate of how many times `item` was added. Never below the true count. */
  estimate(item: string): number {
    return this.minAt(this.cells(item));
  }

  /**
   * Adds another sketch's counters cell by cell. Exact for standard updates (the sketch
   * is linear); for conservative sketches the result still never underestimates.
   */
  merge(other: CountMinSketch): void {
    if (other.width !== this.width || other.depth !== this.depth || other.seed !== this.seed) {
      throw new RangeError('merge needs sketches with the same width, depth and seed');
    }
    for (let i = 0; i < this.table.length; i++) this.table[i] += other.table[i];
    this.total += other.total;
  }

  /** One flat-array index per row. Double hashing over one MD5 digest: column = (h1 + row * h2) mod width. */
  private cells(item: string): number[] {
    const digest = createHash('md5').update(this.seed).update('\0').update(item).digest();
    const h1 = digest.readUInt32BE(0);
    const h2 = digest.readUInt32BE(4) || 1;
    const cells = new Array<number>(this.depth);
    for (let row = 0; row < this.depth; row++) cells[row] = row * this.width + ((h1 + row * h2) % this.width);
    return cells;
  }

  private minAt(cells: number[]): number {
    let min = Infinity;
    for (const c of cells) if (this.table[c] < min) min = this.table[c];
    return min;
  }
}

/** One entry in a top-k result. */
export interface HeavyHitter {
  item: string;
  estimate: number;
}

/**
 * Streaming top-k: a count-min sketch estimates every item's frequency, and a min-heap
 * of size k keeps the current best candidates. A new item replaces the heap's minimum
 * when its estimate is larger. Memory is the sketch plus k entries, independent of
 * the number of distinct items, which is what makes "trending" feasible at scale.
 */
export class HeavyHitters {
  readonly k: number;
  private readonly sketch: CountMinSketch;
  private readonly heap: HeavyHitter[] = [];
  private readonly position = new Map<string, number>();

  constructor(k: number, sketchOptions: CountMinSketchOptions) {
    if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer');
    this.k = k;
    this.sketch = new CountMinSketch(sketchOptions);
  }

  add(item: string, count = 1): void {
    const estimate = this.sketch.add(item, count);
    const at = this.position.get(item);
    if (at !== undefined) {
      this.heap[at].estimate = estimate;
      this.siftDown(at); // its count grew, so in a min-heap it can only move down
    } else if (this.heap.length < this.k) {
      this.heap.push({ item, estimate });
      this.position.set(item, this.heap.length - 1);
      this.siftUp(this.heap.length - 1);
    } else if (estimate > this.heap[0].estimate) {
      this.position.delete(this.heap[0].item);
      this.heap[0] = { item, estimate };
      this.position.set(item, 0);
      this.siftDown(0);
    }
  }

  /** Frequency estimate for any item, tracked or not. */
  estimate(item: string): number {
    return this.sketch.estimate(item);
  }

  /** The current top k, highest estimate first. */
  top(): HeavyHitter[] {
    return this.heap.map((h) => ({ ...h })).sort((a, b) => b.estimate - a.estimate || a.item.localeCompare(b.item));
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].estimate <= this.heap[i].estimate) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < this.heap.length && this.heap[left].estimate < this.heap[smallest].estimate) smallest = left;
      if (right < this.heap.length && this.heap[right].estimate < this.heap[smallest].estimate) smallest = right;
      if (smallest === i) return;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
    this.position.set(this.heap[a].item, a);
    this.position.set(this.heap[b].item, b);
  }
}
