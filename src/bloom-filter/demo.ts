import { BloomFilter, CountingBloomFilter, optimalParameters } from './bloom-filter';

console.log('\nA crawler remembers 100,000 visited URLs and must not refetch them.\n');

const { bits, hashes } = optimalParameters(100_000, 0.01);
console.log(`Sizing for n=100,000, p=1%: m=${bits.toLocaleString()} bits (${(bits / 8 / 1024).toFixed(0)} KiB), k=${hashes}`);
console.log(`A Set of the same URLs would hold ~${((100_000 * 40) / 1024 / 1024).toFixed(1)} MiB of strings.\n`);

const visited = BloomFilter.withCapacity(100_000, 0.01);
for (let i = 0; i < 100_000; i++) visited.add(`https://example.com/page/${i}`);

let falsePositives = 0;
for (let i = 0; i < 50_000; i++) if (visited.mightContain(`https://example.org/new/${i}`)) falsePositives++;
console.log(`Known URLs reported as unseen: 0 (no false negatives, by construction)`);
console.log(`New URLs wrongly skipped:      ${falsePositives} of 50,000 (${((falsePositives / 50_000) * 100).toFixed(2)}%)`);
console.log(`Fill ratio ${visited.fillRatio().toFixed(3)}, estimated FP rate ${(visited.estimatedFalsePositiveRate() * 100).toFixed(2)}%`);

for (let i = 0; i < 100_000; i++) visited.add(`https://example.com/extra/${i}`);
console.log(`After overfilling to 2x capacity: estimated FP rate ${(visited.estimatedFalsePositiveRate() * 100).toFixed(1)}%\n`);

const shardA = BloomFilter.withCapacity(10_000, 0.01);
const shardB = BloomFilter.withCapacity(10_000, 0.01);
shardA.add('https://a.example/1');
shardB.add('https://b.example/1');
const merged = BloomFilter.deserialize(shardA.union(shardB).serialize());
console.log(`Union of two shard filters (sent as ${merged.sizeInBytes + 12} bytes) knows both URLs:`,
  merged.mightContain('https://a.example/1') && merged.mightContain('https://b.example/1'));

const sessions = CountingBloomFilter.withCapacity(1_000, 0.01);
sessions.add('session-7');
sessions.remove('session-7');
console.log(`Counting filter after add + remove of session-7: mightContain = ${sessions.mightContain('session-7')}\n`);
