import { describe, expect, it } from 'vitest';
import { ConsistentHashRing } from './consistent-hash-ring';

const keys = (n: number) => Array.from({ length: n }, (_, i) => `key-${i}`);

describe('ConsistentHashRing', () => {
  it('returns undefined for an empty ring and routes deterministically otherwise', () => {
    const ring = new ConsistentHashRing();
    expect(ring.getNode('a')).toBeUndefined();
    ring.addNode('n1');
    ring.addNode('n2');
    expect(ring.getNode('user:42')).toBe(ring.getNode('user:42'));
    expect(['n1', 'n2']).toContain(ring.getNode('user:42'));
  });

  it('spreads keys roughly evenly with virtual nodes', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 200 });
    for (const n of ['a', 'b', 'c', 'd', 'e']) ring.addNode(n);
    const counts = [...ring.distribution(keys(50_000)).values()];
    const expected = 50_000 / 5;
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
    }
  });

  it('is badly balanced without virtual nodes (why vnodes exist)', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 1 });
    for (const n of ['a', 'b', 'c', 'd', 'e']) ring.addNode(n);
    const counts = [...ring.distribution(keys(50_000)).values()];
    const spread = Math.max(...counts) - Math.min(...counts);
    expect(spread).toBeGreaterThan(50_000 * 0.15);
  });

  it('moves only about 1/N of the keys when a node is added', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 150 });
    for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n);
    const sample = keys(20_000);
    const before = new Map(sample.map((k) => [k, ring.getNode(k)]));
    ring.addNode('e');
    const moved = sample.filter((k) => before.get(k) !== ring.getNode(k)).length;
    const fraction = moved / sample.length;
    expect(fraction).toBeGreaterThan(0.12);
    expect(fraction).toBeLessThan(0.28); // ideal is 1/5 = 0.20
    for (const k of sample) {
      if (before.get(k) !== ring.getNode(k)) expect(ring.getNode(k)).toBe('e');
    }
  });

  it('reassigns only the removed node\'s keys, spread across the others', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 150 });
    for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n);
    const sample = keys(20_000);
    const before = new Map(sample.map((k) => [k, ring.getNode(k)]));
    ring.removeNode('b');
    expect(ring.size).toBe(3);
    const receivers = new Set<string>();
    for (const k of sample) {
      const was = before.get(k);
      const now = ring.getNode(k);
      if (was !== 'b') expect(now).toBe(was);
      else receivers.add(now as string);
    }
    expect(receivers.size).toBe(3);
  });

  it('getNodes returns distinct successors for replication', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 50 });
    for (const n of ['a', 'b', 'c']) ring.addNode(n);
    const replicas = ring.getNodes('order:7', 3);
    expect(new Set(replicas).size).toBe(3);
    expect(replicas[0]).toBe(ring.getNode('order:7'));
    expect(ring.getNodes('order:7', 10)).toHaveLength(3);
    expect(ring.getNodes('order:7', 0)).toEqual([]);
  });

  it('ignores duplicate adds and unknown removes', () => {
    const ring = new ConsistentHashRing({ virtualNodes: 10 });
    ring.addNode('a');
    ring.addNode('a');
    ring.removeNode('zzz');
    expect(ring.size).toBe(1);
    expect(ring.nodeList).toEqual(['a']);
  });
});
