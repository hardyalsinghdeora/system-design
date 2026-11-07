import { describe, expect, it } from 'vitest';
import {
  ClockMovedBackwardsError,
  ClockStalledError,
  DEFAULT_EPOCH,
  SnowflakeGenerator,
  UUID_V7_PATTERN,
  UlidGenerator,
  UuidV7Generator,
  decodeBase62,
  decodeSnowflake,
  decodeUlidTime,
  encodeBase62,
  uuidV7Timestamp,
} from './snowflake-id';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);

/** A clock that advances 1 ms every `callsPerMs` reads. */
const steppingClock = (callsPerMs: number, start = T0) => {
  let calls = 0;
  return () => start + Math.floor(calls++ / callsPerMs);
};

describe('SnowflakeGenerator', () => {
  it('generates strictly increasing ids, and 100,000 of them are unique', () => {
    const gen = new SnowflakeGenerator({ workerId: 7, clock: steppingClock(37) });
    const ids: bigint[] = [];
    for (let i = 0; i < 100_000; i++) ids.push(gen.next());
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(new Set(ids).size).toBe(100_000);
  });

  it('decodes back to timestamp, worker id and sequence', () => {
    const gen = new SnowflakeGenerator({ workerId: 513, clock: () => T0 });
    gen.next();
    const id = gen.next();
    expect(gen.decode(id)).toEqual({ timestamp: T0, workerId: 513, sequence: 1 });
    expect(decodeSnowflake(id, DEFAULT_EPOCH).timestamp).toBe(T0);
    expect(id).toBe((BigInt(T0 - DEFAULT_EPOCH) << 22n) | (513n << 12n) | 1n);
  });

  it('moves to the next millisecond when 4,096 ids are used in one', () => {
    let calls = 0;
    const gen = new SnowflakeGenerator({ workerId: 1, clock: () => (calls++ < 4_100 ? T0 : T0 + 1) });
    const ids = Array.from({ length: 4_097 }, () => gen.next());
    expect(gen.decode(ids[4_095])).toEqual({ timestamp: T0, workerId: 1, sequence: 4_095 });
    expect(gen.decode(ids[4_096])).toEqual({ timestamp: T0 + 1, workerId: 1, sequence: 0 });
    expect(ids[4_096] > ids[4_095]).toBe(true);

    const stuck = new SnowflakeGenerator({ workerId: 1, clock: () => T0, maxWaitAttempts: 10 });
    for (let i = 0; i < 4_096; i++) stuck.next();
    expect(() => stuck.next()).toThrow(ClockStalledError);
  });

  it('refuses to generate when the clock moves backwards', () => {
    let now = T0;
    const gen = new SnowflakeGenerator({ workerId: 3, clock: () => now });
    gen.next();
    now = T0 - 5;
    expect(() => gen.next()).toThrow(ClockMovedBackwardsError);
    now = T0;
    expect(gen.decode(gen.next()).sequence).toBe(1); // recovers once time catches up
    expect(() => new SnowflakeGenerator({ workerId: 1024 })).toThrow(RangeError);
  });

  it('round-trips ids through base62', () => {
    const gen = new SnowflakeGenerator({ workerId: 99, clock: steppingClock(3) });
    for (let i = 0; i < 1_000; i++) {
      const id = gen.next();
      expect(decodeBase62(encodeBase62(id))).toBe(id);
    }
    expect(encodeBase62(0n)).toBe('0');
    expect(encodeBase62((1n << 63n) - 1n)).toHaveLength(11);
    expect(() => decodeBase62('abc-')).toThrow(RangeError);
  });
});

describe('UUIDv7 and ULID', () => {
  it('UUIDv7 matches the RFC 9562 layout and sorts by time', () => {
    const gen = new UuidV7Generator({ clock: steppingClock(1), rng: mulberry32(1) });
    const ids = Array.from({ length: 2_000 }, () => gen.next());
    for (const id of ids) expect(id).toMatch(UUID_V7_PATTERN);
    expect([...ids].sort()).toEqual(ids);
    expect(uuidV7Timestamp(ids[0])).toBe(T0);
    expect(uuidV7Timestamp(ids[1_999])).toBe(T0 + 1_999);
  });

  it('ULIDs sort lexicographically in creation order, even within one millisecond', () => {
    const gen = new UlidGenerator({ clock: steppingClock(10), rng: mulberry32(2) });
    const ids = Array.from({ length: 5_000 }, () => gen.next());
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5_000);
    expect(decodeUlidTime(ids[0])).toBe(T0);
    expect(decodeUlidTime(ids[4_999])).toBe(T0 + 499);
  });
});
