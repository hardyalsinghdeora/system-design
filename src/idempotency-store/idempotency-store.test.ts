import { describe, expect, it } from 'vitest';
import { HandlerError, Idempotency, InMemoryIdempotencyStore, fingerprint, type IdempotentRequest, type StoredResponse } from './idempotency-store';

function setup(options: { ttlMs?: number; leaseMs?: number } = {}) {
  let now = 1_000;
  let token = 0;
  const clock = () => now;
  const store = new InMemoryIdempotencyStore(clock);
  const idem = new Idempotency({ store, clock, newToken: () => `t${++token}`, ttlMs: options.ttlMs ?? 60_000, leaseMs: options.leaseMs ?? 5_000 });
  return { store, idem, advance: (ms: number) => (now += ms) };
}

const charge: IdempotentRequest = { method: 'POST', path: '/v1/charges', body: { amount: 500, currency: 'usd' } };

function countingHandler(response: StoredResponse = { status: 201, body: { id: 'ch_1' } }) {
  const calls = { n: 0 };
  return { calls, handler: async () => (calls.n++, response) };
}

describe('Idempotency', () => {
  it('executes the first request and stores the response', async () => {
    const { store, idem } = setup();
    const { calls, handler } = countingHandler();
    const result = await idem.withIdempotency('key-1', charge, handler);
    expect(result).toEqual({ status: 201, body: { id: 'ch_1' }, replayed: false, outcome: 'executed', recorded: true });
    expect(calls.n).toBe(1);
    expect((await store.get('key-1'))?.state).toBe('COMPLETED');
  });

  it('replays the stored response without executing again', async () => {
    const { idem } = setup();
    const { calls, handler } = countingHandler();
    await idem.withIdempotency('key-1', charge, handler);
    const retry = await idem.withIdempotency('key-1', { ...charge, method: 'post', body: { currency: 'usd', amount: 500 } }, handler);
    expect(retry).toMatchObject({ status: 201, body: { id: 'ch_1' }, replayed: true, outcome: 'replayed' });
    expect(calls.n).toBe(1);
  });

  it('returns 409 for a duplicate that arrives while the first is in progress', async () => {
    const { idem } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const first = idem.withIdempotency('key-1', charge, async () => {
      await gate;
      return { status: 201, body: { id: 'ch_1' } };
    });
    const { calls, handler } = countingHandler();
    const duplicate = await idem.withIdempotency('key-1', charge, handler); // races the first insert
    expect(duplicate.status).toBe(409);
    expect(calls.n).toBe(0);
    release();
    expect((await first).status).toBe(201);
    expect((await idem.withIdempotency('key-1', charge, handler)).replayed).toBe(true);
  });

  it('returns 422 when the key is reused with a different payload', async () => {
    const { idem } = setup();
    const { calls, handler } = countingHandler();
    await idem.withIdempotency('key-1', charge, handler);
    const other = await idem.withIdempotency('key-1', { ...charge, body: { amount: 9_900, currency: 'usd' } }, handler);
    expect(other).toMatchObject({ status: 422, outcome: 'payload-mismatch' });
    expect(await idem.withIdempotency('key-1', { ...charge, path: '/v1/refunds' }, handler)).toMatchObject({ status: 422 });
    expect(calls.n).toBe(1);
    expect(fingerprint({ method: 'POST', path: '/a', body: { x: 1, y: [1, 2] } })).toBe(fingerprint({ method: 'post', path: '/a', body: { y: [1, 2], x: 1 } }));
  });

  it('removes the record after a retryable failure so a retry can run', async () => {
    const { store, idem } = setup();
    let calls = 0;
    const flaky = async (): Promise<StoredResponse> => {
      calls++;
      if (calls === 1) throw new HandlerError('card network timeout', 503, true);
      return { status: 201, body: { id: 'ch_2' } };
    };
    expect(await idem.withIdempotency('key-1', charge, flaky)).toMatchObject({ status: 503, outcome: 'retryable-failure' });
    expect(await store.get('key-1')).toBeUndefined();
    expect(await idem.withIdempotency('key-1', charge, flaky)).toMatchObject({ status: 201, outcome: 'executed' });
    expect(calls).toBe(2);
  });

  it('stores a non-retryable failure and replays it', async () => {
    const { idem } = setup();
    let calls = 0;
    const declined = async (): Promise<StoredResponse> => {
      calls++;
      throw new HandlerError('card declined', 402, false);
    };
    expect(await idem.withIdempotency('key-1', charge, declined)).toMatchObject({ status: 402, outcome: 'stored-failure' });
    const again = await idem.withIdempotency('key-1', charge, declined);
    expect(again).toMatchObject({ status: 402, body: { error: 'card declined' }, replayed: true });
    expect(calls).toBe(1);
  });

  it('lets another worker take over an IN_PROGRESS record whose lease expired, and fences the old worker', async () => {
    const { store, idem, advance } = setup({ leaseMs: 5_000 });
    let releaseZombie: () => void = () => {};
    const zombieGate = new Promise<void>((r) => (releaseZombie = r));
    const zombie = idem.withIdempotency('key-1', charge, async () => {
      await zombieGate; // worker stalls (GC pause, crash)
      return { status: 201, body: { id: 'ch_zombie' } };
    });
    await Promise.resolve();
    advance(1_000);
    expect((await idem.withIdempotency('key-1', charge, countingHandler().handler)).status).toBe(409); // lease still valid
    advance(5_000);
    const takeover = await idem.withIdempotency('key-1', charge, async () => ({ status: 201, body: { id: 'ch_new' } }));
    expect(takeover).toMatchObject({ status: 201, outcome: 'taken-over', recorded: true });
    releaseZombie();
    expect(await zombie).toMatchObject({ recorded: false }); // its write is rejected by the owner check
    expect((await store.get('key-1'))?.response?.body).toEqual({ id: 'ch_new' });
  });

  it('forgets a key after its TTL', async () => {
    const { idem, advance } = setup({ ttlMs: 60_000 });
    const { calls, handler } = countingHandler();
    await idem.withIdempotency('key-1', charge, handler);
    advance(59_999);
    expect((await idem.withIdempotency('key-1', charge, handler)).replayed).toBe(true);
    advance(1);
    expect((await idem.withIdempotency('key-1', charge, handler)).outcome).toBe('executed');
    expect(calls.n).toBe(2);
  });
});
