import {
  FixedWindowCounter,
  LeakyBucket,
  SlidingWindowCounter,
  SlidingWindowLog,
  TokenBucket,
  type RateLimiter,
} from './rate-limiter-algorithms';
import { simulateTwoGatewayRace } from './counter-store';

const time = { now: 0 };
const clock = () => time.now;

console.log('\nLimit: 10 requests per second. A client sends 10 at t=900 ms and 10 more at t=1000 ms.\n');

const limiters: Array<[string, RateLimiter]> = [
  ['token bucket (cap 10, 10/s)', new TokenBucket({ capacity: 10, refillPerSecond: 10, clock })],
  ['leaky bucket meter (cap 10, 10/s)', new LeakyBucket({ capacity: 10, leakPerSecond: 10, clock })],
  ['fixed window (10 per 1 s)', new FixedWindowCounter({ limit: 10, windowMs: 1000, clock })],
  ['sliding window log', new SlidingWindowLog({ limit: 10, windowMs: 1000, clock })],
  ['sliding window counter', new SlidingWindowCounter({ limit: 10, windowMs: 1000, clock })],
];

for (const [name, limiter] of limiters) {
  let admitted = 0;
  let firstRetry = 0;
  for (const at of [900, 1000]) {
    time.now = at;
    for (let i = 0; i < 10; i++) {
      const decision = limiter.tryAcquire('client-1');
      if (decision.allowed) admitted++;
      else if (firstRetry === 0) firstRetry = decision.retryAfterMs;
    }
  }
  console.log(`${name.padEnd(36)} admitted ${String(admitted).padStart(2)} of 20, first Retry-After ${firstRetry ? `${firstRetry} ms` : 'never sent'}`);
}
console.log('\nThe fixed window let 20 through in 100 ms: it resets at the boundary.');

console.log('\nTwo gateways share one Redis-like counter (limit 10/min) and interleave 10 requests each:\n');
for (const mode of ['read-modify-write', 'atomic'] as const) {
  const result = simulateTwoGatewayRace({ limit: 10, requestsPerGateway: 10, mode });
  console.log(`${mode.padEnd(18)} admitted ${result.admitted} (limit ${result.limit}); counter ends at ${result.storedCount}`);
}
console.log('\nGET-then-SET lets both gateways see the same count, so increments are lost.');
console.log('A single atomic call (Lua script, or INCR then compare) cannot interleave.\n');
