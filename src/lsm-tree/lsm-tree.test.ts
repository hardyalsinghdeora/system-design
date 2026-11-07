import { describe, expect, it } from 'vitest';
import { BloomFilter, LSMTree } from './lsm-tree';

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

const pad = (i: number) => `key-${String(i).padStart(5, '0')}`;
const NO_AUTO_COMPACTION = 1_000_000;

describe('LSMTree', () => {
  it('get/put/delete work in the memtable and across flushes', () => {
    const db = new LSMTree({ memtableLimit: 4, compactionThreshold: NO_AUTO_COMPACTION });
    db.put('a', '1');
    db.put('b', '2');
    expect(db.get('a')).toBe('1');
    db.flush();
    db.put('a', '1-new'); // newer value in the memtable shadows the SSTable
    db.delete('b'); // tombstone shadows the flushed value
    db.flush();
    expect(db.sstableInfo()).toHaveLength(2);
    expect(db.get('a')).toBe('1-new');
    expect(db.get('b')).toBeUndefined();
    db.put('b', '2-again');
    expect(db.get('b')).toBe('2-again');
    expect(db.get('zzz')).toBeUndefined();
  });

  it('recovers unflushed writes from the WAL after a crash', () => {
    const db = new LSMTree({ memtableLimit: 100, compactionThreshold: NO_AUTO_COMPACTION });
    for (let i = 0; i < 250; i++) db.put(pad(i), `v${i}`);
    db.delete(pad(3));
    db.delete(pad(240));
    expect(db.sstableInfo()).toHaveLength(2);
    expect(db.disk.wal.records).toHaveLength(52); // only what is not yet in an SSTable
    const recovered = new LSMTree({ disk: db.disk, memtableLimit: 100 }); // memtable lost, disk survives
    expect(recovered.memtableSize).toBe(db.memtableSize);
    for (let i = 0; i < 250; i++) expect(recovered.get(pad(i))).toBe(i === 3 || i === 240 ? undefined : `v${i}`);
    recovered.put('after-restart', 'x'); // sequence numbers continue past the recovered ones
    recovered.put(pad(1), 'newest');
    expect(recovered.get(pad(1))).toBe('newest');
  });

  it('major compaction keeps the latest values and removes tombstones', () => {
    const db = new LSMTree({ memtableLimit: 50, compactionThreshold: NO_AUTO_COMPACTION });
    const model = new Map<string, string>();
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 100; i++) {
        if ((i + round) % 5 === 0) {
          db.delete(pad(i));
          model.delete(pad(i));
        } else {
          db.put(pad(i), `r${round}`);
          model.set(pad(i), `r${round}`);
        }
      }
    }
    db.flush();
    expect(db.sstableInfo().length).toBeGreaterThan(10);
    db.compact();
    const [only] = db.sstableInfo();
    expect(db.sstableInfo()).toHaveLength(1);
    expect(only.tombstones).toBe(0);
    expect(only.entries).toBe(model.size);
    expect(db.stats.entriesDropped).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) expect(db.get(pad(i))).toBe(model.get(pad(i)));
  });

  it('size-tiered compaction merges runs of same-tier tables automatically', () => {
    const db = new LSMTree({ memtableLimit: 32, compactionThreshold: 4 });
    for (let i = 0; i < 32 * 16; i++) db.put(pad(i), `v${i}`);
    expect(db.stats.flushes).toBe(16);
    expect(db.stats.compactions).toBe(5); // 4 merges of tier 0, then 1 merge of tier 1
    expect(db.sstableInfo()).toEqual([expect.objectContaining({ entries: 512, tier: 2 })]);
    for (let i = 0; i < 512; i += 37) expect(db.get(pad(i))).toBe(`v${i}`);
  });

  it('keeps tombstones when the merge does not include the oldest table', () => {
    const db = new LSMTree({ memtableLimit: 32, compactionThreshold: 4 });
    for (let i = 0; i < 128; i++) db.put(pad(i), 'old'); // 4 flushes -> one tier-1 table
    expect(db.sstableInfo()).toHaveLength(1);
    db.delete(pad(7));
    for (let i = 1000; i < 1127; i++) db.put(pad(i), 'new'); // 4 more flushes -> merged, not with the oldest
    const tables = db.sstableInfo();
    expect(tables).toHaveLength(2);
    expect(tables[1].tombstones).toBe(1);
    expect(db.get(pad(7))).toBeUndefined();
    db.compact();
    expect(db.sstableInfo()[0].tombstones).toBe(0);
    expect(db.get(pad(7))).toBeUndefined();
  });

  it('range scans merge every source in key order and match a reference map', () => {
    const rng = mulberry32(2024);
    let db = new LSMTree({ memtableLimit: 20, compactionThreshold: 3 });
    const model = new Map<string, string>();
    for (let step = 0; step < 3000; step++) {
      const key = pad(Math.floor(rng() * 400));
      if (rng() < 0.25) {
        db.delete(key);
        model.delete(key);
      } else {
        db.put(key, `s${step}`);
        model.set(key, `s${step}`);
      }
      if (step === 1500) db = new LSMTree({ disk: db.disk, memtableLimit: 20, compactionThreshold: 3 });
    }
    const expected = [...model.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    expect([...db.scan()]).toEqual(expected);
    const [lo, hi] = [pad(100), pad(200)];
    expect([...db.scan(lo, hi)]).toEqual(expected.filter(([k]) => k >= lo && k < hi));
  });

  it('Bloom filters cut SSTable probes for absent keys', () => {
    const build = (bloomBitsPerKey: number) => {
      const db = new LSMTree({ memtableLimit: 100, bloomBitsPerKey, compactionThreshold: NO_AUTO_COMPACTION });
      const rng = mulberry32(9);
      for (let i = 0; i < 1000; i++) db.put(pad(Math.floor(rng() * 90_000)), 'x');
      db.flush();
      return db;
    };
    const withBloom = build(10);
    const without = build(0);
    for (let i = 0; i < 1000; i++) {
      const absent = `${pad(i * 90)}-absent`; // inside every table's key range
      expect(withBloom.get(absent)).toBeUndefined();
      expect(without.get(absent)).toBeUndefined();
    }
    const tables = without.sstableInfo().length;
    expect(without.stats.sstablesProbed).toBeGreaterThan(1000 * (tables - 1));
    expect(withBloom.stats.sstablesProbed).toBeLessThan(without.stats.sstablesProbed * 0.05);
  });
});

describe('BloomFilter', () => {
  it('has no false negatives and about 1 % false positives at 10 bits per key', () => {
    const bloom = new BloomFilter(5000, 10);
    for (let i = 0; i < 5000; i++) bloom.add(`in-${i}`);
    for (let i = 0; i < 5000; i++) expect(bloom.mightContain(`in-${i}`)).toBe(true);
    let falsePositives = 0;
    for (let i = 0; i < 20_000; i++) if (bloom.mightContain(`out-${i}`)) falsePositives += 1;
    expect(falsePositives / 20_000).toBeLessThan(0.025);
  });
});
