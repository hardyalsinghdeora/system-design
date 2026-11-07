import { describe, expect, it } from 'vitest';
import { InvertedIndex, intersectSorted, tokenize, unionSorted } from './inverted-index';

function corpus(): InvertedIndex {
  const index = new InvertedIndex();
  index.add('d1', 'The quick brown fox jumps over the lazy dog.');
  index.add('d2', 'A quick brown dog outpaces a quick red fox!');
  index.add('d3', 'Lazy afternoons: the dog sleeps, the cat sleeps.');
  index.add('d4', 'Bank of America opens a new branch in New York.');
  return index;
}

describe('tokenize', () => {
  it('lowercases, strips punctuation and stopwords but keeps original positions', () => {
    expect(tokenize("The Fox's DEN, in 2024!")).toEqual([
      { term: 'foxs', position: 1 },
      { term: 'den', position: 2 },
      { term: '2024', position: 4 },
    ]);
  });
});

describe('InvertedIndex', () => {
  it('stores postings with term frequency and positions', () => {
    const index = corpus();
    expect(index.postingsFor('quick')).toEqual([
      { doc: 0, tf: 1, positions: [1] },
      { doc: 1, tf: 2, positions: [1, 6] },
    ]);
    expect(index.documentFrequency('dog')).toBe(3);
  });

  it('answers boolean AND and OR from sorted postings', () => {
    const index = corpus();
    expect(index.and('quick fox')).toEqual(['d1', 'd2']);
    expect(index.and('lazy dog')).toEqual(['d1', 'd3']);
    expect(index.and('fox cat')).toEqual([]);
    expect(index.and('fox unicorn')).toEqual([]);
    expect(index.or('cat fox')).toEqual(['d1', 'd2', 'd3']);
    expect(index.or('the of')).toEqual([]); // only stopwords
    expect(intersectSorted([1, 3, 5, 7], [3, 4, 5, 8])).toEqual([3, 5]);
    expect(unionSorted([1, 3, 5], [2, 3, 6])).toEqual([1, 2, 3, 5, 6]);
  });

  it('matches phrases by position, including across a removed stopword', () => {
    const index = corpus();
    expect(index.phrase('quick brown')).toEqual(['d1', 'd2']);
    expect(index.phrase('brown fox')).toEqual(['d1']); // d2 has "brown dog"
    expect(index.phrase('lazy dog')).toEqual(['d1']); // d3 has both words, not adjacent
    expect(index.phrase('bank of america')).toEqual(['d4']);
    expect(index.phrase('bank america')).toEqual([]); // the gap matters
    expect(index.phrase('new york')).toEqual(['d4']);
  });

  it('BM25 ranks a document matching a rarer term higher', () => {
    const index = new InvertedIndex();
    index.add('common', 'apple orange');
    index.add('rare', 'apple durian');
    index.add('other1', 'orange juice');
    index.add('other2', 'orange peel');
    const hits = index.search('orange durian');
    expect(hits[0].id).toBe('rare'); // durian df=1 beats orange df=3
    expect(hits.map((h) => h.id)).toContain('common');
  });

  it('BM25 normalises by length and saturates term frequency', () => {
    const index = new InvertedIndex();
    index.add('short', 'durian fruit');
    index.add('long', 'durian fruit tasting notes gathered market stall vendors across town');
    index.add('filler', 'mango lassi recipe');
    const [first, second] = index.search('durian');
    expect(first.id).toBe('short');
    expect(first.score).toBeGreaterThan(second.score);

    const tf = new InvertedIndex();
    tf.add('once', 'cache miss hit rate');
    tf.add('twice', 'cache cache hit rate');
    tf.add('many', 'cache cache cache cache');
    tf.add('none', 'disk read write rate');
    const scores = new Map(tf.search('cache').map((h) => [h.id, h.score]));
    expect(scores.get('twice') as number).toBeGreaterThan(scores.get('once') as number);
    const gain1 = (scores.get('twice') as number) - (scores.get('once') as number);
    expect(gain1).toBeLessThan(scores.get('once') as number); // the second occurrence adds less than the first
  });

  it('AND mode only returns documents with every term', () => {
    const index = corpus();
    expect(index.search('quick fox', { mode: 'and' }).map((h) => h.id).sort()).toEqual(['d1', 'd2']);
    expect(index.search('quick fox', { mode: 'and' })[0].id).toBe('d2'); // "quick" twice in d2
  });

  it('deleting a document removes its postings and updates statistics', () => {
    const index = corpus();
    const avgBefore = index.averageLength;
    expect(index.remove('d2')).toBe(true);
    expect(index.remove('d2')).toBe(false);
    expect(index.documentCount).toBe(3);
    expect(index.postingsFor('quick')).toEqual([{ doc: 0, tf: 1, positions: [1] }]);
    expect(index.postingsFor('outpaces')).toEqual([]);
    expect(index.or('red outpaces')).toEqual([]);
    expect(index.averageLength).not.toBe(avgBefore);
    index.add('d1', 'completely new text'); // re-adding replaces
    expect(index.and('fox')).toEqual([]);
    expect(index.and('completely')).toEqual(['d1']);
    expect(index.documentCount).toBe(3);
  });
});
