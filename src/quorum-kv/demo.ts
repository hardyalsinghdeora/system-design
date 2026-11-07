import { QuorumKV } from './quorum-kv';

const key = 'cart:42';
const show = (label: string, kv: QuorumKV) => {
  const r = kv.get(key);
  const repaired = r.repaired.length ? `, repaired ${r.repaired.join(',')}` : '';
  console.log(`  ${label.padEnd(44)} -> ${r.ok ? JSON.stringify(r.values) : 'FAILED (not enough replicas)'}${repaired}`);
};

console.log('\n1. N=3, W=1, R=1 (R + W <= N): fast, but reads can be stale');
const weak = new QuorumKV({ n: 3, r: 1, w: 1 });
const [a, b, c] = weak.preferenceList(key);
weak.put(key, 'v1');
weak.markDown(b), weak.markDown(c);
console.log(`  write v2 while ${b},${c} are down: acks=${weak.put(key, 'v2').acks}`);
weak.markDown(a);
weak.markUp(b), weak.markUp(c);
show(`read after ${a} fails and ${b},${c} return`, weak);

console.log('\n2. N=3, W=2, R=2 (R + W > N): quorums overlap');
const strong = new QuorumKV({ n: 3, r: 2, w: 2, hintedHandoff: false });
const [s1, s2, s3] = strong.preferenceList(key);
strong.put(key, 'v1');
strong.markDown(s3);
strong.put(key, 'v2');
strong.markUp(s3);
console.log(`  ${s3} was down for v2 and still holds ${JSON.stringify(strong.replicaValues(s3, key))}`);
strong.markDown(s2);
show(`read via ${s1},${s3}`, strong);
console.log(`  ${s3} after read repair: ${JSON.stringify(strong.replicaValues(s3, key))}`);
strong.markDown(s1);
console.log(`  write with only ${s3} up: ok=${strong.put(key, 'v3').ok} (W=2 not met)`);

console.log('\n3. Concurrent writes become siblings');
const kv = new QuorumKV({ nodes: ['n1', 'n2', 'n3', 'n4'], n: 3, r: 2, w: 2 });
const [h1, h2, h3] = kv.preferenceList(key);
kv.put(key, 'milk');
const ctx = kv.get(key).context;
kv.put(key, 'milk,eggs', { context: ctx, coordinator: h1 });
kv.put(key, 'milk,bread', { context: ctx, coordinator: h2 });
show('two clients wrote from the same version', kv);
kv.put(key, 'milk,bread,eggs', { context: kv.get(key).context });
show('client merges siblings and writes back', kv);

console.log('\n4. Hinted handoff');
kv.markDown(h3);
const w = kv.put(key, 'milk,bread,eggs,tea');
console.log(`  ${h3} down: write ok=${w.ok}, hint held by ${w.hinted.map((h) => h.heldBy).join(',')}`);
kv.markUp(h3);
console.log(`  ${h3} recovers and receives the hint: ${JSON.stringify(kv.replicaValues(h3, key))}\n`);
