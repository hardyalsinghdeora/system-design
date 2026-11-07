import { describe, expect, it } from 'vitest';
import { AutocompleteTrie, normalise } from './trie-autocomplete';

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

describe('AutocompleteTrie', () => {
  it('returns the top-k by count with ties broken lexicographically', () => {
    const trie = new AutocompleteTrie({ topK: 3 });
    trie.insert('car', 5);
    trie.insert('cat', 9);
    trie.insert('cart', 5);
    trie.insert('care', 5);
    trie.insert('dog', 50);
    expect(trie.suggest('ca')).toEqual([
      { query: 'cat', count: 9 },
      { query: 'car', count: 5 },
      { query: 'care', count: 5 },
    ]);
    expect(trie.suggest('car', 2).map((s) => s.query)).toEqual(['car', 'care']);
    expect(trie.suggest('').map((s) => s.query)).toEqual(['dog', 'cat', 'car']);
  });

  it('normalises case and whitespace', () => {
    const trie = new AutocompleteTrie();
    trie.insert('  New   York ');
    trie.insert('new york');
    trie.insert('NEWARK');
    expect(normalise('  New   York ')).toBe('new york');
    expect(trie.frequency('NEW YORK')).toBe(2);
    expect(trie.suggest('New').map((s) => s.query)).toEqual(['new york', 'newark']);
    expect(trie.suggest('new ').map((s) => s.query)).toEqual(['new york']);
  });

  it('returns [] for an unknown prefix', () => {
    const trie = new AutocompleteTrie();
    trie.insert('apple');
    expect(trie.suggest('banana')).toEqual([]);
    expect(trie.suggestDfs('apples')).toEqual([]);
  });

  it('reorders suggestions as counts increase', () => {
    const trie = new AutocompleteTrie({ topK: 2 });
    trie.insert('weather today', 10);
    trie.insert('weather tomorrow', 8);
    trie.insert('weather radar', 3);
    expect(trie.suggest('weather').map((s) => s.query)).toEqual(['weather today', 'weather tomorrow']);
    trie.increment('weather radar', 20); // a storm is coming
    expect(trie.suggest('weather')).toEqual([
      { query: 'weather radar', count: 23 },
      { query: 'weather today', count: 10 },
    ]);
  });

  it('decrement and delete repair the cache and prune nodes', () => {
    const trie = new AutocompleteTrie({ topK: 2 });
    trie.insert('ab', 9);
    trie.insert('abc', 7);
    trie.insert('abd', 5);
    const before = trie.stats().nodes;
    trie.decrement('ab', 8);
    expect(trie.suggest('a').map((s) => s.query)).toEqual(['abc', 'abd']); // abd was not cached before
    expect(trie.delete('abc')).toBe(true);
    expect(trie.delete('abc')).toBe(false);
    expect(trie.stats().nodes).toBe(before - 1);
    expect(trie.suggest('abc')).toEqual([]);
    expect(trie.suggest('a')).toEqual([{ query: 'abd', count: 5 }, { query: 'ab', count: 1 }]);
    trie.delete('ab');
    trie.delete('abd');
    expect(trie.stats()).toMatchObject({ nodes: 1, queries: 0, cachedEntries: 0 });
  });

  it('cached results equal DFS results after seeded random inserts, increments and decrements', () => {
    const rng = mulberry32(11);
    const cached = new AutocompleteTrie({ topK: 5 });
    const dfs = new AutocompleteTrie({ topK: 5, mode: 'dfs' });
    const letters = 'abcde';
    const randomWord = () => Array.from({ length: 1 + Math.floor(rng() * 6) }, () => letters[Math.floor(rng() * 5)]).join('');
    const words = Array.from({ length: 400 }, randomWord);
    for (let i = 0; i < 5000; i++) {
      const w = words[Math.floor(rng() * words.length)];
      const by = 1 + Math.floor(rng() * 4);
      if (rng() < 0.8) {
        cached.insert(w, by);
        dfs.insert(w, by);
      } else {
        cached.decrement(w, by);
        dfs.decrement(w, by);
      }
      if (i % 50 === 0) {
        const prefix = randomWord().slice(0, 1 + Math.floor(rng() * 3));
        expect(cached.suggest(prefix)).toEqual(dfs.suggest(prefix));
        expect(cached.suggest(prefix)).toEqual(cached.suggestDfs(prefix));
      }
    }
    for (const p of ['', 'a', 'b', 'ab', 'cd', 'eee']) expect(cached.suggest(p)).toEqual(dfs.suggest(p));
    expect(cached.stats().nodes).toBe(dfs.stats().nodes);
  });

  it('trades memory for latency: the cache visits far fewer nodes', () => {
    const cached = new AutocompleteTrie({ topK: 5 });
    const dfs = new AutocompleteTrie({ topK: 5, mode: 'dfs' });
    for (let i = 0; i < 2000; i++) {
      cached.insert(`query ${i}`, (i * 7) % 13 + 1);
      dfs.insert(`query ${i}`, (i * 7) % 13 + 1);
    }
    expect(cached.suggest('q')).toEqual(dfs.suggest('q'));
    cached.suggest('q');
    dfs.suggest('q');
    expect(cached.lastVisited).toBe(2);
    expect(dfs.lastVisited).toBeGreaterThan(2000);
    expect(cached.stats().cachedEntries).toBeGreaterThan(cached.stats().nodes);
    expect(dfs.stats().cachedEntries).toBe(0);
    expect(cached.suggest('q', 10)).toEqual(dfs.suggest('q', 10)); // k above the cache size falls back to DFS
  });
});
