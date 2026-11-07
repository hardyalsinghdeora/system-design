import { CountMinSketch, HeavyHitters } from './count-min-sketch';

// Deterministic skewed stream: hashtag #r appears with weight 1 / r^1.2.
let seed = 2024;
const rng = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
const tags = Array.from({ length: 5_000 }, (_, i) => `#tag${i + 1}`);
const weights = tags.map((_, r) => 1 / (r + 1) ** 1.2);
const totalWeight = weights.reduce((a, b) => a + b, 0);
const cdf: number[] = [];
let acc = 0;
for (const w of weights) cdf.push((acc += w / totalWeight));
const draw = () => {
  const u = rng();
  let i = 0;
  while (cdf[i] < u && i < cdf.length - 1) i++;
  return tags[i];
};

console.log('\n200,000 hashtag events over 5,000 distinct tags (Zipf-skewed).\n');
const options = { epsilon: 0.01, delta: 0.01 }; // deliberately coarse so the error is visible
const exact = new Map<string, number>();
const sketch = new CountMinSketch(options);
const careful = new CountMinSketch({ ...options, conservative: true });
const trending = new HeavyHitters(5, options);
for (let i = 0; i < 200_000; i++) {
  const tag = draw();
  exact.set(tag, (exact.get(tag) ?? 0) + 1);
  sketch.add(tag);
  careful.add(tag);
  trending.add(tag);
}

console.log(`Sketch: ${sketch.width} x ${sketch.depth} counters = ${(sketch.sizeInBytes / 1024).toFixed(0)} KiB, error bound ${sketch.errorBound.toFixed(0)}`);
console.log('\nTop 5 trending      true   estimate');
for (const { item, estimate } of trending.top()) {
  console.log(`  ${item.padEnd(14)} ${String(exact.get(item)).padStart(7)} ${String(estimate).padStart(10)}`);
}
console.log('\nTail tags              true   standard   conservative');
for (const tag of ['#tag500', '#tag2000', '#tag4999']) {
  const t = exact.get(tag) ?? 0;
  console.log(`  ${tag.padEnd(16)} ${String(t).padStart(8)} ${String(sketch.estimate(tag)).padStart(10)} ${String(careful.estimate(tag)).padStart(14)}`);
}
console.log('\nEstimates never fall below the truth; conservative update overcounts less.\n');
