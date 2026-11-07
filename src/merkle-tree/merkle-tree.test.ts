import { describe, expect, it } from 'vitest';
import { MerkleTree, verifyProof } from './merkle-tree';

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

const data = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [`user:${i}`, `v${i}`]);

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('MerkleTree', () => {
  it('identical data gives the same root regardless of insertion order', () => {
    const entries = data(2000);
    const a = MerkleTree.from(entries, { depth: 8 });
    const b = MerkleTree.from(shuffled(entries, mulberry32(1)), { depth: 8 });
    expect(a.root).toBe(b.root);
    expect(a.diff(b)).toEqual({ buckets: [], comparisons: 1 });
  });

  it('incremental set/delete matches a rebuild from scratch', () => {
    const tree = new MerkleTree({ depth: 6 });
    for (const [k, v] of data(300)) tree.set(k, v);
    tree.set('user:5', 'changed');
    tree.delete('user:6');
    const expected = data(300).filter(([k]) => k !== 'user:6').map(([k, v]): [string, string] => [k, k === 'user:5' ? 'changed' : v]);
    expect(tree.root).toBe(MerkleTree.from(expected, { depth: 6 }).root);
  });

  it('finds one changed key in exactly its bucket with 2*depth+1 comparisons', () => {
    const depth = 10;
    const replicaA = MerkleTree.from(data(10_000), { depth });
    const replicaB = MerkleTree.from(data(10_000), { depth });
    replicaB.set('user:4242', 'stale');
    const result = replicaA.diff(replicaB);
    expect(result.buckets).toEqual([replicaA.bucketOf('user:4242')]);
    expect(result.comparisons).toBe(2 * depth + 1); // O(log buckets), not 2^(depth+1)-1 = 2047
    const [lo, hi] = replicaA.bucketRange(result.buckets[0]);
    expect(hi - lo).toBe(2 ** 22);
    expect(replicaB.bucketEntries(result.buckets[0]).some(([k]) => k === 'user:4242')).toBe(true);
  });

  it('detects missing keys and several differences while skipping matching subtrees', () => {
    const depth = 10;
    const a = MerkleTree.from(data(5000), { depth });
    const b = MerkleTree.from(data(5000), { depth });
    const changed = ['user:1', 'user:2000', 'user:3999'];
    b.set(changed[0], 'x');
    b.delete(changed[1]);
    b.set('user:new', 'only on b');
    a.set(changed[2], 'y');
    const expected = [...new Set([...changed, 'user:new'].map((k) => a.bucketOf(k)))].sort((x, y) => x - y);
    const result = a.diff(b);
    expect([...result.buckets].sort((x, y) => x - y)).toEqual(expected);
    expect(result.comparisons).toBeLessThanOrEqual(expected.length * (2 * depth + 1));
    expect(result.comparisons).toBeLessThan(2 ** (depth + 1) - 1);
  });

  it('refuses to compare trees of different depth', () => {
    expect(() => new MerkleTree({ depth: 3 }).diff(new MerkleTree({ depth: 4 }))).toThrow();
  });
});

describe('inclusion proofs', () => {
  const tree = MerkleTree.from(data(1000), { depth: 7 });

  it('verifies a present key against the root, with one sibling per level', () => {
    const proof = tree.proof('user:77')!;
    expect(proof.path).toHaveLength(7);
    expect(verifyProof(tree.root, 'user:77', 'v77', proof)).toBe(true);
    expect(tree.proof('user:does-not-exist')).toBeUndefined();
  });

  it('fails when the value, a sibling, the entries or the root are tampered with', () => {
    const proof = tree.proof('user:77')!;
    expect(verifyProof(tree.root, 'user:77', 'forged', proof)).toBe(false);
    const badSibling = { ...proof, path: proof.path.map((s, i) => (i === 3 ? { ...s, sibling: s.sibling.replace(/^./, (c) => (c === '0' ? '1' : '0')) } : s)) };
    expect(verifyProof(tree.root, 'user:77', 'v77', badSibling)).toBe(false);
    const forgedEntries = { ...proof, entries: proof.entries.map(([k, v]): [string, string] => [k, k === 'user:77' ? 'forged' : v]) };
    expect(verifyProof(tree.root, 'user:77', 'forged', forgedEntries)).toBe(false);
    const other = MerkleTree.from(data(999), { depth: 7 });
    expect(verifyProof(other.root, 'user:77', 'v77', proof)).toBe(false);
  });
});
