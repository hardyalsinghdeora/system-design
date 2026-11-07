import { HandlerError, Idempotency, InMemoryIdempotencyStore, type IdempotentResult } from './idempotency-store';

let now = 0;
const clock = (): number => now;
const store = new InMemoryIdempotencyStore(clock);
const idem = new Idempotency({ store, clock, ttlMs: 24 * 3_600_000, leaseMs: 10_000 });

let charges = 0;
const chargeCard = async () => {
  charges++;
  return { status: 201, body: { id: `ch_${charges}`, amount: 500 } };
};
const request = { method: 'POST', path: '/v1/charges', body: { amount: 500, currency: 'usd' } };
const show = (label: string, r: IdempotentResult): void =>
  console.log(`  ${label.padEnd(40)} -> ${r.status} ${r.outcome.padEnd(17)} ${JSON.stringify(r.body)}`);

console.log('\nA client pays with Idempotency-Key "order-42"\n');
show('first attempt', await idem.withIdempotency('order-42', request, chargeCard));
show('retry after a lost response', await idem.withIdempotency('order-42', request, chargeCard));
show('same key, different amount', await idem.withIdempotency('order-42', { ...request, body: { amount: 900 } }, chargeCard));
console.log(`  card charged ${charges} time(s)\n`);

console.log('Concurrent double-click on "order-43"');
let release: () => void = () => {};
const slow = idem.withIdempotency('order-43', request, async () => {
  await new Promise<void>((r) => (release = r));
  return chargeCard();
});
show('second click while first is running', await idem.withIdempotency('order-43', request, chargeCard));
release();
show('first click finishes', await slow);

console.log('\nTransient failure on "order-44" (nothing committed)');
let flaky = true;
const gateway = async () => {
  if (flaky) { flaky = false; throw new HandlerError('gateway timeout', 504, true); }
  return chargeCard();
};
show('attempt 1', await idem.withIdempotency('order-44', request, gateway));
show('attempt 2 (key was released)', await idem.withIdempotency('order-44', request, gateway));

console.log('\nWorker crashes mid-request on "order-45"');
void idem.withIdempotency('order-45', request, () => new Promise(() => {})); // never finishes
await Promise.resolve();
now += 2_000;
show('retry 2 s later (lease held)', await idem.withIdempotency('order-45', request, chargeCard));
now += 11_000;
show('retry after the 10 s lease expired', await idem.withIdempotency('order-45', request, chargeCard));
console.log(`\nTotal charges: ${charges} for 4 orders.\n`);
