import { HyperLogLog } from './hyperloglog';

console.log('\nCounting unique visitors per day without storing their ids.\n');

const days = [
  { name: 'Monday', from: 0, to: 80_000 },
  { name: 'Tuesday', from: 50_000, to: 140_000 },
  { name: 'Wednesday', from: 120_000, to: 125_000 },
];

const sketches = days.map((day) => {
  const hll = new HyperLogLog({ precision: 14 });
  for (let i = day.from; i < day.to; i++) {
    hll.add(`visitor-${i}`);
    hll.add(`visitor-${i}`); // page reloads: duplicates do not count
  }
  const actual = day.to - day.from;
  const { method } = hll.details();
  const err = ((hll.count() - actual) / actual) * 100;
  console.log(`${day.name.padEnd(10)} actual ${String(actual).padStart(7)}  estimate ${String(hll.count()).padStart(7)}  (${err.toFixed(2)}%, ${method})`);
  return hll;
});

const week = HyperLogLog.union(...sketches);
console.log(`\nUnique across all three days: actual 140000, estimate ${week.count()} (merge = register-wise max)`);
console.log(`Memory: ${week.sizeInBytes.toLocaleString()} bytes per sketch vs ~${((140_000 * 16) / 1024).toFixed(0)} KiB for a set of 16-byte ids`);
console.log(`Standard error at p=14: ${(week.standardError * 100).toFixed(2)}%\n`);

for (const p of [6, 10, 14, 18]) {
  const hll = new HyperLogLog({ precision: p });
  for (let i = 0; i < 200_000; i++) hll.add(`event-${i}`);
  const err = ((hll.count() - 200_000) / 200_000) * 100;
  console.log(`p=${String(p).padEnd(2)} ${String(hll.sizeInBytes).padStart(7)} bytes  estimate of 200,000: ${String(hll.count()).padStart(8)} (${err.toFixed(2)}%, expected +/-${(hll.standardError * 100).toFixed(2)}%)`);
}
console.log('');
