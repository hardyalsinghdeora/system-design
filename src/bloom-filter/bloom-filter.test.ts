import { describe, expect, it } from 'vitest';
import { BloomFilter, CountingBloomFilter, optimalParameters, theoreticalFalsePositiveRate } from './bloom-filter';

const members = (n: number, prefix = 'url') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe('BloomFilter', () => {
  it('computes m and k from the textbook formulas', () => {
    expect(optimalParameters(1_000_000, 0.01)).toEqual({ bits: 9_585_059, hashes: 7 });
    for (const [n, p] of [[1000, 0.001], [50_000, 0.05], [10_000, 0.01]] as const) {
      const { bits, hashes } = optimalParameters(n, p);
      expect(bits).toBe(Math.ceil((-n * Math.log(p)) / Math.LN2 ** 2));
      expect(hashes).toBe(Math.round((bits / n) * Math.LN2));
      expect(theoreticalFalsePositiveRate(bits, hashes, n)).toBeLessThan(p * 1.1);
    }
    expect(() => optimalParameters(100, 1)).toThrow(RangeError);
  });

  it('has zero false negatives', () => {
    const filter = BloomFilter.withCapacity(10_000, 0.01);
    const items = members(10_000);
    for (const item of items) filter.add(item);
    expect(items.every((item) => filter.mightContain(item))).toBe(true);
  });

  it('keeps the empirical false-positive rate under 2x the target at capacity', () => {
    const filter = BloomFilter.withCapacity(10_000, 0.01);
    for (const item of members(10_000)) filter.add(item);
    const probes = members(20_000, 'other');
    const falsePositives = probes.filter((item) => filter.mightContain(item)).length;
    expect(falsePositives / probes.length).toBeLessThan(0.02);
    expect(filter.fillRatio()).toBeGreaterThan(0.45);
    expect(filter.fillRatio()).toBeLessThan(0.55);
  });

  it('estimates its own false-positive rate, which rises when overfilled', () => {
    const filter = BloomFilter.withCapacity(5_000, 0.01);
    for (const item of members(5_000)) filter.add(item);
    const atCapacity = filter.estimatedFalsePositiveRate();
    expect(atCapacity).toBeGreaterThan(0.005);
    expect(atCapacity).toBeLessThan(0.015);
    for (const item of members(5_000, 'extra')) filter.add(item);
    expect(filter.estimatedFalsePositiveRate()).toBeGreaterThan(atCapacity * 5);
  });

  it('union contains both sets and equals a filter built from both', () => {
    const a = BloomFilter.withCapacity(4_000, 0.01);
    const b = BloomFilter.withCapacity(4_000, 0.01);
    const both = BloomFilter.withCapacity(4_000, 0.01);
    for (const item of members(2_000, 'a')) (a.add(item), both.add(item));
    for (const item of members(2_000, 'b')) (b.add(item), both.add(item));
    const merged = a.union(b);
    expect([...members(2_000, 'a'), ...members(2_000, 'b')].every((item) => merged.mightContain(item))).toBe(true);
    expect(merged.serialize()).toEqual(both.serialize());
    expect(() => a.union(new BloomFilter(1024, 3))).toThrow(RangeError);
  });

  it('round-trips through serialize and deserialize', () => {
    const filter = BloomFilter.withCapacity(1_000, 0.02);
    for (const item of members(1_000)) filter.add(item);
    const copy = BloomFilter.deserialize(filter.serialize());
    expect(copy.bitCount).toBe(filter.bitCount);
    expect(copy.hashCount).toBe(filter.hashCount);
    expect(copy.count).toBe(1_000);
    const probes = [...members(1_000), ...members(1_000, 'other')];
    expect(probes.map((p) => copy.mightContain(p))).toEqual(probes.map((p) => filter.mightContain(p)));
    expect(() => BloomFilter.deserialize(filter.serialize().subarray(0, 20))).toThrow(RangeError);
  });
});

describe('CountingBloomFilter', () => {
  it('removes items without creating false negatives for the rest', () => {
    const filter = CountingBloomFilter.withCapacity(2_000, 0.01);
    const items = members(2_000);
    for (const item of items) filter.add(item);
    const [removed, kept] = [items.slice(0, 1_000), items.slice(1_000)];
    for (const item of removed) expect(filter.remove(item)).toBe(true);
    expect(kept.every((item) => filter.mightContain(item))).toBe(true);
    const stillReported = removed.filter((item) => filter.mightContain(item)).length;
    expect(stillReported / removed.length).toBeLessThan(0.02); // only false positives remain
  });

  it('refuses to remove items it definitely does not hold', () => {
    const filter = CountingBloomFilter.withCapacity(1_000, 0.01);
    for (const item of members(500)) filter.add(item);
    const refused = members(1_000, 'never').filter((item) => !filter.remove(item)).length;
    expect(refused).toBeGreaterThan(980);
  });
});
