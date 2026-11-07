import { ConsistentHashRing } from './consistent-hash-ring';

const keys = Array.from({ length: 100_000 }, (_, i) => `session:${i}`);

function show(label: string, ring: ConsistentHashRing): void {
  const dist = ring.distribution(keys);
  const parts = [...dist.entries()].sort().map(([n, c]) => `${n}=${((c / keys.length) * 100).toFixed(1)}%`);
  console.log(`${label.padEnd(34)} ${parts.join('  ')}`);
}

console.log('\n100,000 keys over cache nodes\n');

const naive = new ConsistentHashRing({ virtualNodes: 1 });
for (const n of ['cache-1', 'cache-2', 'cache-3', 'cache-4']) naive.addNode(n);
show('1 vnode per node (uneven):', naive);

const ring = new ConsistentHashRing({ virtualNodes: 150 });
for (const n of ['cache-1', 'cache-2', 'cache-3', 'cache-4']) ring.addNode(n);
show('150 vnodes per node (balanced):', ring);

const before = new Map(keys.map((k) => [k, ring.getNode(k)]));
ring.addNode('cache-5');
const moved = keys.filter((k) => before.get(k) !== ring.getNode(k)).length;
show('after adding cache-5:', ring);
console.log(`\nKeys that moved: ${moved} of ${keys.length} (${((moved / keys.length) * 100).toFixed(1)}%, ideal 20%)`);
console.log(`With hash(key) mod N, about ${(80).toFixed(0)}% would have moved.\n`);

console.log('Replica set for "session:42":', ring.getNodes('session:42', 3).join(' -> '), '\n');
