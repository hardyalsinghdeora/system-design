import { describe, expect, it } from 'vitest';
import { LamportClock, Simulation, VectorClock, threeProcessScenario } from './vector-clock';

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

const vc = (r: Record<string, number>) => new VectorClock(r);

function randomClock(rng: () => number): VectorClock {
  const out: Record<string, number> = {};
  for (const n of ['a', 'b', 'c', 'd']) if (rng() < 0.7) out[n] = Math.floor(rng() * 5);
  return vc(out);
}

describe('VectorClock', () => {
  it('compare follows the truth table, treating missing entries as zero', () => {
    expect(vc({ a: 1, b: 2 }).compare(vc({ a: 1, b: 2 }))).toBe('EQUAL');
    expect(vc({ a: 1 }).compare(vc({ a: 1, b: 0 }))).toBe('EQUAL');
    expect(vc({ a: 1, b: 1 }).compare(vc({ a: 1, b: 2 }))).toBe('BEFORE');
    expect(vc({ a: 1 }).compare(vc({ a: 1, b: 1 }))).toBe('BEFORE');
    expect(vc({ a: 2, b: 2 }).compare(vc({ a: 1, b: 2 }))).toBe('AFTER');
    expect(vc({ a: 2, b: 1 }).compare(vc({ a: 1, b: 2 }))).toBe('CONCURRENT');
    expect(vc({ a: 1 }).compare(vc({ b: 1 }))).toBe('CONCURRENT');
    expect(vc({}).compare(vc({}))).toBe('EQUAL');
  });

  it('merge is commutative, associative and idempotent', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 300; i++) {
      const [x, y, z] = [randomClock(rng), randomClock(rng), randomClock(rng)];
      expect(x.merge(y).equals(y.merge(x))).toBe(true);
      expect(x.merge(y).merge(z).equals(x.merge(y.merge(z)))).toBe(true);
      expect(x.merge(x).equals(x)).toBe(true);
    }
  });

  it('merge dominates both inputs and increment orders after', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const [x, y] = [randomClock(rng), randomClock(rng)];
      const m = x.merge(y);
      expect(['BEFORE', 'EQUAL']).toContain(x.compare(m));
      expect(['BEFORE', 'EQUAL']).toContain(y.compare(m));
      expect(x.increment('a').compare(x)).toBe('AFTER');
    }
  });

  it('is immutable', () => {
    const base = vc({ a: 1 });
    base.increment('a');
    base.merge(vc({ b: 3 }));
    expect(base.toJSON()).toEqual({ a: 1 });
  });
});

describe('LamportClock', () => {
  it('tick, send and receive advance past what has been seen', () => {
    const p = new LamportClock();
    const q = new LamportClock(10);
    expect(p.tick()).toBe(1);
    const t = p.send();
    expect(t).toBe(2);
    expect(q.receive(t)).toBe(11);
    expect(p.receive(q.send())).toBe(13);
  });
});

describe('three-process simulation', () => {
  it('Lamport timestamps respect every happens-before pair', () => {
    const sim = threeProcessScenario();
    for (const e of sim.events) {
      for (const f of sim.events) {
        if (e.vector.happenedBefore(f.vector)) expect(e.lamport).toBeLessThan(f.lamport);
      }
    }
  });

  it('follows the causal chain through messages', () => {
    const sim = threeProcessScenario();
    // a=P1.1 b=P1.2 c=P2.1 d=P2.2 e=P3.1 g=P3.2 h=P3.3 f=P1.3
    expect(sim.order('P1.1', 'P2.1')).toBe('BEFORE');
    expect(sim.order('P1.1', 'P1.3')).toBe('BEFORE');
    expect(sim.order('P3.1', 'P1.3')).toBe('BEFORE');
    expect(sim.order('P1.3', 'P2.2')).toBe('AFTER');
    expect(sim.event('P1.3').vector.toJSON()).toEqual({ P1: 3, P2: 2, P3: 3 });
  });

  it('detects concurrency that Lamport timestamps hide', () => {
    const sim = threeProcessScenario();
    const concurrent = sim.concurrentPairs().map(([x, y]) => [x.id, y.id].sort().join('|'));
    expect(concurrent.sort()).toEqual(['P1.1|P3.1', 'P1.2|P3.1', 'P2.1|P3.1', 'P2.2|P3.1']);
    // e (P3.1) has Lamport 1, smaller than c (P2.1) = 3, yet e did not happen before c.
    expect(sim.event('P3.1').lamport).toBeLessThan(sim.event('P2.1').lamport);
    expect(sim.order('P3.1', 'P2.1')).toBe('CONCURRENT');
  });

  it('two replicas writing without exchanging messages produce concurrent versions', () => {
    const sim = new Simulation(['A', 'B']);
    const base = sim.local('A', 'write v1');
    sim.receive(sim.send('A', 'B', 'replicate v1'));
    const wa = sim.local('A', 'write v2a');
    const wb = sim.local('B', 'write v2b');
    expect(sim.order(base.id, wa.id)).toBe('BEFORE');
    expect(sim.order(wa.id, wb.id)).toBe('CONCURRENT');
    expect(wa.vector.merge(wb.vector).increment('A').compare(wb.vector)).toBe('AFTER');
  });
});
