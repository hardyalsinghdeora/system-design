import { LamportClock, VectorClock, threeProcessScenario } from './vector-clock';

console.log('\nThree processes exchange messages: m1 P1->P2, m2 P2->P3, m3 P3->P1\n');

const sim = threeProcessScenario();
console.log('event  process  lamport  vector              label');
for (const e of sim.events) {
  console.log(`${e.id.padEnd(6)} ${e.process.padEnd(8)} ${String(e.lamport).padEnd(8)} ${e.vector.toString().padEnd(19)} ${e.label}`);
}

console.log('\nHappens-before, read from the vectors:');
for (const [a, b] of [['P1.1', 'P2.1'], ['P3.1', 'P1.3'], ['P3.1', 'P2.1'], ['P2.2', 'P3.1']]) {
  console.log(`  ${a} vs ${b}: ${sim.order(a, b)}`);
}

const e = sim.event('P3.1');
const c = sim.event('P2.1');
console.log(`\nLamport says ${e.id}=${e.lamport} < ${c.id}=${c.lamport}, but the vectors say they are ${sim.order(e.id, c.id)}.`);
console.log('Lamport gives a total order consistent with causality; only vectors detect concurrency.');

console.log('\nConflict detection in a replicated store:');
const v1 = new VectorClock().increment('A');
const fromA = v1.increment('A');
const fromB = v1.increment('B');
console.log(`  v1=${v1}  write at A=${fromA}  write at B=${fromB}  -> ${fromA.compare(fromB)} (keep both as siblings)`);
const resolved = fromA.merge(fromB).increment('A');
console.log(`  client merges and writes ${resolved}: ${resolved.compare(fromA)} A's, ${resolved.compare(fromB)} B's`);

const lamport = new LamportClock();
lamport.tick();
console.log(`\nA Lamport clock that received timestamp 41 jumps to ${lamport.receive(41)}.\n`);
