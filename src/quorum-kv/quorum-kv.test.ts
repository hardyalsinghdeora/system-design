import { describe, expect, it } from 'vitest';
import { QuorumKV, compareClocks } from './quorum-kv';

const KEY = 'cart:42';

describe('QuorumKV', () => {
  it('with R + W > N every read sees the latest write, whichever replica was down', () => {
    // Exhaustive over which single replica misses the write and which misses the read. No hints, so overlap alone does it.
    for (const writeDown of [undefined, 'node-1', 'node-2', 'node-3']) {
      for (const readDown of [undefined, 'node-1', 'node-2', 'node-3']) {
        const kv = new QuorumKV({ n: 3, r: 2, w: 2, hintedHandoff: false });
        expect(kv.isStrictQuorum).toBe(true);
        expect(kv.put(KEY, 'v1').ok).toBe(true);
        if (writeDown) kv.markDown(writeDown);
        expect(kv.put(KEY, 'v2').ok).toBe(true);
        if (writeDown) kv.markUp(writeDown);
        if (readDown) kv.markDown(readDown);
        const read = kv.get(KEY);
        expect(read.ok).toBe(true);
        expect(read.values).toEqual(['v2']);
      }
    }
  });

  it('with R + W <= N a read can return a stale value', () => {
    const kv = new QuorumKV({ n: 3, r: 1, w: 1 });
    expect(kv.isStrictQuorum).toBe(false);
    const [a, b, c] = kv.preferenceList(KEY);
    kv.put(KEY, 'v1');
    kv.markDown(b);
    kv.markDown(c);
    const write = kv.put(KEY, 'v2'); // only `a` acknowledges; it also holds the hints
    expect(write).toMatchObject({ ok: true, acks: 1 });
    kv.markDown(a);
    kv.markUp(b);
    kv.markUp(c); // hints cannot be delivered: their holder is down
    expect(kv.get(KEY).values).toEqual(['v1']);
    kv.markUp(a); // the hint holder returns and hands off
    expect(kv.get(KEY).values).toEqual(['v2']);
  });

  it('read repair heals a stale replica that took part in the read', () => {
    const kv = new QuorumKV({ n: 3, r: 3, w: 2, hintedHandoff: false });
    const [, , c] = kv.preferenceList(KEY);
    kv.put(KEY, 'v1');
    kv.markDown(c);
    kv.put(KEY, 'v2');
    kv.markUp(c);
    expect(kv.replicaValues(c, KEY)).toEqual(['v1']);
    const read = kv.get(KEY);
    expect(read.values).toEqual(['v2']);
    expect(read.repaired).toEqual([c]);
    expect(kv.replicaValues(c, KEY)).toEqual(['v2']);
    expect(kv.get(KEY).repaired).toEqual([]);
  });

  it('a write fails when fewer than W home replicas are up (strict quorum)', () => {
    const kv = new QuorumKV({ n: 3, r: 2, w: 2 });
    const [a, b, c] = kv.preferenceList(KEY);
    kv.markDown(b);
    kv.markDown(c);
    const result = kv.put(KEY, 'v1');
    expect(result.ok).toBe(false);
    expect(result.acks).toBe(1);
    expect(kv.replicaValues(a, KEY)).toEqual(['v1']); // not rolled back, as in Dynamo/Cassandra
    expect(kv.get(KEY).ok).toBe(false); // only one replica can answer, R = 2
  });

  it('concurrent writes with the same context become siblings, and a merged write resolves them', () => {
    const kv = new QuorumKV({ n: 3, r: 2, w: 2 });
    const [a, b] = kv.preferenceList(KEY);
    kv.put(KEY, 'milk');
    const { context } = kv.get(KEY);
    const x = kv.put(KEY, 'milk,eggs', { context, coordinator: a });
    const y = kv.put(KEY, 'milk,bread', { context, coordinator: b });
    expect(compareClocks(x.clock, y.clock)).toBe('CONCURRENT');
    const siblings = kv.get(KEY);
    expect(siblings.values).toEqual(['milk,bread', 'milk,eggs']);
    kv.put(KEY, 'milk,bread,eggs', { context: siblings.context });
    expect(kv.get(KEY).values).toEqual(['milk,bread,eggs']);
  });

  it('hinted handoff stores the write on a substitute and delivers it on recovery', () => {
    const kv = new QuorumKV({ nodes: ['n1', 'n2', 'n3', 'n4'], n: 3, r: 2, w: 2 });
    const home = kv.preferenceList(KEY);
    const substitute = ['n1', 'n2', 'n3', 'n4'].find((n) => !home.includes(n))!;
    kv.put(KEY, 'v1');
    kv.markDown(home[2]);
    const write = kv.put(KEY, 'v2');
    expect(write.ok).toBe(true);
    expect(write.hinted).toEqual([{ target: home[2], heldBy: substitute }]);
    expect(kv.pendingHints(substitute)).toBe(1);
    kv.markUp(home[2]);
    expect(kv.pendingHints(substitute)).toBe(0);
    expect(kv.replicaValues(home[2], KEY)).toEqual(['v2']);
    expect(kv.replicaValues(substitute, KEY)).toEqual([]);
  });

  it('sloppy quorum counts the substitute toward W so writes stay available', () => {
    const strict = new QuorumKV({ nodes: ['n1', 'n2', 'n3', 'n4'], n: 3, r: 2, w: 2 });
    const sloppy = new QuorumKV({ nodes: ['n1', 'n2', 'n3', 'n4'], n: 3, r: 2, w: 2, sloppyQuorum: true });
    for (const kv of [strict, sloppy]) {
      const [, b, c] = kv.preferenceList(KEY);
      kv.markDown(b);
      kv.markDown(c);
    }
    expect(strict.put(KEY, 'v1').ok).toBe(false);
    expect(sloppy.put(KEY, 'v1')).toMatchObject({ ok: true, acks: 3 });
  });

  it('rejects impossible configurations', () => {
    expect(() => new QuorumKV({ n: 3, r: 4, w: 1 })).toThrow();
    expect(() => new QuorumKV({ nodes: ['a'], n: 2, r: 1, w: 1 })).toThrow();
  });
});
