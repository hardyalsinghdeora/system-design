import { MerkleTree, verifyProof } from './merkle-tree';

const depth = 12;
const entries: [string, string][] = Array.from({ length: 100_000 }, (_, i) => [`order:${i}`, `status-${i % 7}`]);

console.log(`\nTwo replicas, 100,000 keys each, Merkle trees of depth ${depth} (${2 ** depth} hash-range buckets)\n`);
const replicaA = MerkleTree.from(entries, { depth });
const replicaB = MerkleTree.from(entries, { depth });
console.log(`root A ${replicaA.root.slice(0, 16)}...  root B ${replicaB.root.slice(0, 16)}...  equal: ${replicaA.root === replicaB.root}`);

replicaB.set('order:31337', 'status-lost-update');
console.log('\nReplica B missed one update to order:31337.');
const one = replicaA.diff(replicaB);
console.log(`diff: buckets ${JSON.stringify(one.buckets)}, ${one.comparisons} hash comparisons (full scan: 100,000 keys)`);
console.log(`bucket ${one.buckets[0]} holds ${replicaA.bucketEntries(one.buckets[0]).length} keys: only those need to be streamed`);

replicaB.delete('order:7');
replicaB.set('order:new', 'status-0');
const many = replicaA.diff(replicaB);
console.log(`\nAfter two more divergences: buckets ${JSON.stringify(many.buckets)}, ${many.comparisons} comparisons`);
console.log(`(a full tree walk would be ${2 ** (depth + 1) - 1} comparisons)`);

const proof = replicaA.proof('order:500')!;
console.log(`\nInclusion proof for order:500: ${proof.entries.length} bucket entries + ${proof.path.length} sibling hashes`);
console.log(`verify with the real value:   ${verifyProof(replicaA.root, 'order:500', 'status-3', proof)}`);
console.log(`verify with a forged value:   ${verifyProof(replicaA.root, 'order:500', 'status-9', proof)}`);
const tampered = { ...proof, path: [{ ...proof.path[0], sibling: '00'.repeat(32) }, ...proof.path.slice(1)] };
console.log(`verify with a tampered path:  ${verifyProof(replicaA.root, 'order:500', 'status-3', tampered)}\n`);
