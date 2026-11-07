import { describe, expect, it } from 'vitest';
import { CountMinSketch, HeavyHitters, sketchDimensions } from './count-min-sketch';

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

const ITEMS = 1_000;
const N = 100_000;

/** N draws from a Zipf(s = 1.1) distribution over ITEMS items: a few very hot, a long tail. */
function zipfStream(seed: number): string[] {
  const rng = mulberry32(seed);
  const weights = Array.from({ length: ITEMS }, (_, r) => 1 / (r + 1) ** 1.1);
  const total = weights.reduce((a, b) => a + b, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const w of weights) cdf.push((acc += w / total));
  return Array.from({ length: N }, () => {
    const u = rng();
    let lo = 0;
    let hi = ITEMS - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return `item-${lo}`;
  });
}

const stream = zipfStream(7);
const truth = new Map<string, number>();
for (const item of stream) truth.set(item, (truth.get(item) ?? 0) + 1);
const allItems = Array.from({ length: ITEMS }, (_, i) => `item-${i}`);
const trueCount = (item: string) => truth.get(item) ?? 0;

const options = { epsilon: 0.005, delta: 0.01 };
const standard = new CountMinSketch(options);
const conservative = new CountMinSketch({ ...options, conservative: true });
for (const item of stream) {
  standard.add(item);
  conservative.add(item);
}

describe('CountMinSketch', () => {
  it('sizes the table from epsilon and delta', () => {
    expect(sketchDimensions(0.005, 0.01)).toEqual({ width: 544, depth: 5 });
    expect(sketchDimensions(0.001, 0.001)).toEqual({ width: 2719, depth: 7 });
    expect(standard.totalCount).toBe(N);
    expect(standard.sizeInBytes).toBe(544 * 5 * 8);
    expect(() => sketchDimensions(0, 0.01)).toThrow(RangeError);
  });

  it('never underestimates, in either update mode', () => {
    for (const item of allItems) {
      expect(standard.estimate(item)).toBeGreaterThanOrEqual(trueCount(item));
      expect(conservative.estimate(item)).toBeGreaterThanOrEqual(trueCount(item));
    }
  });

  it('keeps the error within epsilon * N for all but a delta fraction of items', () => {
    const bound = options.epsilon * N;
    const violations = allItems.filter((item) => standard.estimate(item) - trueCount(item) > bound).length;
    expect(violations).toBeLessThanOrEqual(options.delta * ITEMS);
    expect(standard.errorBound).toBeLessThanOrEqual(bound);
  });

  it('conservative update is never worse than standard, and better overall', () => {
    let standardError = 0;
    let conservativeError = 0;
    for (const item of allItems) {
      expect(conservative.estimate(item)).toBeLessThanOrEqual(standard.estimate(item));
      standardError += standard.estimate(item) - trueCount(item);
      conservativeError += conservative.estimate(item) - trueCount(item);
    }
    expect(conservativeError).toBeLessThan(standardError * 0.8);
  });

  it('merges shard sketches exactly (the sketch is linear)', () => {
    const a = new CountMinSketch(options);
    const b = new CountMinSketch(options);
    stream.forEach((item, i) => (i % 2 === 0 ? a : b).add(item));
    a.merge(b);
    expect(a.totalCount).toBe(N);
    for (const item of allItems) expect(a.estimate(item)).toBe(standard.estimate(item));
    expect(() => a.merge(new CountMinSketch({ ...options, seed: 'other' }))).toThrow(RangeError);
  });
});

describe('HeavyHitters', () => {
  it('recovers the true top 5 from a skewed stream', () => {
    const topK = new HeavyHitters(5, options);
    for (const item of stream) topK.add(item);
    const expected = [...truth.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([item]) => item);
    const found = topK.top();
    expect(found.map((h) => h.item)).toEqual(expected);
    for (const h of found) {
      expect(h.estimate).toBeGreaterThanOrEqual(trueCount(h.item));
      expect(h.estimate - trueCount(h.item)).toBeLessThanOrEqual(options.epsilon * N);
    }
  });

  it('handles weighted adds and keeps at most k candidates', () => {
    const topK = new HeavyHitters(2, { epsilon: 0.01, delta: 0.01 });
    topK.add('a', 5);
    topK.add('b', 3);
    topK.add('c', 1); // smaller than the heap minimum: ignored
    topK.add('c', 10); // estimate 11 now beats b
    expect(topK.top()).toEqual([
      { item: 'c', estimate: 11 },
      { item: 'a', estimate: 5 },
    ]);
    expect(topK.estimate('b')).toBeGreaterThanOrEqual(3);
  });
});
