import { describe, expect, it } from 'vitest';
import { HyperLogLog } from './hyperloglog';

const fill = (sketch: HyperLogLog, from: number, to: number, prefix = 'user') => {
  for (let i = from; i < to; i++) sketch.add(`${prefix}-${i}`);
  return sketch;
};
const relativeError = (estimate: number, actual: number) => Math.abs(estimate - actual) / actual;

describe('HyperLogLog', () => {
  it('estimates 1,000 distinct items within 3 standard errors (linear counting range)', () => {
    const hll = fill(new HyperLogLog({ precision: 14 }), 0, 1_000);
    expect(hll.details().method).toBe('linear-counting');
    expect(relativeError(hll.count(), 1_000)).toBeLessThan(3 * hll.standardError);
  });

  it('estimates 100,000 distinct items within 3 standard errors', () => {
    const hll = fill(new HyperLogLog({ precision: 14 }), 0, 100_000);
    expect(hll.details().method).toBe('harmonic-mean');
    expect(relativeError(hll.count(), 100_000)).toBeLessThan(3 * hll.standardError);
  });

  it('ignores duplicates: re-adding items never changes the estimate', () => {
    const hll = fill(new HyperLogLog(), 0, 20_000);
    const before = hll.count();
    const registers = hll.toBytes();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 20_000; i++) expect(hll.add(`user-${i}`)).toBe(false);
    }
    expect(hll.count()).toBe(before);
    expect(hll.toBytes()).toEqual(registers);
  });

  it('merges two sketches into an estimate of the union', () => {
    const a = fill(new HyperLogLog(), 0, 60_000);
    const b = fill(new HyperLogLog(), 40_000, 100_000); // 20,000 overlap
    const union = HyperLogLog.union(a, b);
    expect(relativeError(union.count(), 100_000)).toBeLessThan(3 * union.standardError);
    expect(union.count()).toBe(fill(new HyperLogLog(), 0, 100_000).count()); // same as one sketch of everything
    expect(a.count()).toBeLessThan(union.count()); // inputs untouched
    expect(() => a.merge(new HyperLogLog({ precision: 10 }))).toThrow(RangeError);
  });

  it('has error that shrinks with precision as 1.04 / sqrt(2^p)', () => {
    const rms = (precision: number) => {
      let sumSq = 0;
      const trials = 12;
      for (let t = 0; t < trials; t++) {
        const hll = fill(new HyperLogLog({ precision }), 0, 10_000, `trial${t}`);
        sumSq += relativeError(hll.count(), 10_000) ** 2;
      }
      return Math.sqrt(sumSq / trials);
    };
    const coarse = rms(6); // 64 registers: about 13 % expected
    const fine = rms(12); // 4,096 registers: about 1.6 % expected
    expect(new HyperLogLog({ precision: 6 }).standardError).toBeCloseTo(0.13, 5);
    expect(coarse).toBeGreaterThan(3 * fine);
    expect(coarse).toBeLessThan(2 * 0.13);
    expect(fine).toBeLessThan(2 * 0.01625);
  });

  it('uses 2^p bytes and round-trips its registers', () => {
    const hll = fill(new HyperLogLog({ precision: 12 }), 0, 5_000);
    expect(hll.sizeInBytes).toBe(4_096);
    expect(HyperLogLog.fromBytes(hll.toBytes()).count()).toBe(hll.count());
    expect(new HyperLogLog().count()).toBe(0);
    expect(() => new HyperLogLog({ precision: 3 })).toThrow(RangeError);
  });
});
