import {
  ClockMovedBackwardsError,
  SnowflakeGenerator,
  UlidGenerator,
  UuidV7Generator,
  encodeBase62,
} from './snowflake-id';

let now = Date.UTC(2026, 10, 7, 9, 30, 0);
const clock = () => now;

console.log('\nTwo order-service workers mint ids with no coordination.\n');
const workerA = new SnowflakeGenerator({ workerId: 1, clock });
const workerB = new SnowflakeGenerator({ workerId: 2, clock });
for (const [name, gen] of [['worker 1', workerA], ['worker 2', workerB]] as const) {
  const id = gen.next();
  const parts = gen.decode(id);
  console.log(`${name}: ${id}  base62 ${encodeBase62(id).padEnd(11)}  ms=${parts.timestamp} worker=${parts.workerId} seq=${parts.sequence}`);
}

let reads = 0;
const busy = new SnowflakeGenerator({ workerId: 5, clock: () => (reads++ < 4_200 ? now : now + 1) });
const burst = Array.from({ length: 5_000 }, () => busy.next());
const last = busy.decode(burst[burst.length - 1]);
console.log(`\n5,000 ids requested in one ms: 4,096 fit (12-bit sequence), the rest waited for the next ms (seq ${last.sequence}).`);
console.log(`Unique: ${new Set(burst).size === burst.length}, sorted: ${burst.every((id, i) => i === 0 || id > burst[i - 1])}`);

now -= 3;
try {
  workerA.next();
} catch (err) {
  if (err instanceof ClockMovedBackwardsError) console.log(`\nNTP stepped the clock back 3 ms: ${err.message}`);
}
now += 10;

let seed = 42;
const rng = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
const uuid = new UuidV7Generator({ clock, rng });
const ulid = new UlidGenerator({ clock, rng });
console.log('\nUUIDv7 (128-bit, standard UUID column):', uuid.next());
console.log('ULID   (26 chars, Crockford base32):   ', ulid.next(), '->', ulid.next(), '(same ms: +1)\n');
