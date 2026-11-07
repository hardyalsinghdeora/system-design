/**
 * Three ways to mint sortable unique ids without a central database sequence:
 * Twitter-style Snowflake (64-bit integer), UUIDv7 (RFC 9562) and ULID.
 */

/** Milliseconds since the Unix epoch. Injected so tests control time. */
export type Clock = () => number;
/** Uniform random number in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

/** Custom epoch for Snowflake ids: 2020-01-01T00:00:00Z. 41 bits of ms from here last until 2089. */
export const DEFAULT_EPOCH = Date.UTC(2020, 0, 1);

const WORKER_BITS = 10;
const SEQUENCE_BITS = 12;
export const MAX_WORKER_ID = (1 << WORKER_BITS) - 1;
export const MAX_SEQUENCE = (1 << SEQUENCE_BITS) - 1;
export const MAX_TIMESTAMP = 2 ** 41 - 1;

/** Thrown when the clock reports a time before the last id: issuing ids then could duplicate one. */
export class ClockMovedBackwardsError extends Error {
  readonly lastMs: number;
  readonly nowMs: number;

  constructor(lastMs: number, nowMs: number) {
    super(`clock moved backwards by ${lastMs - nowMs} ms; refusing to generate ids`);
    this.name = 'ClockMovedBackwardsError';
    this.lastMs = lastMs;
    this.nowMs = nowMs;
  }
}

/** Thrown when the sequence is exhausted and the clock does not advance within the allowed attempts. */
export class ClockStalledError extends Error {
  constructor(attempts: number) {
    super(`sequence exhausted and the clock did not advance after ${attempts} reads`);
    this.name = 'ClockStalledError';
  }
}

export interface SnowflakeOptions {
  /** 0..1023, unique per running generator (often datacenter id * 32 + process id). */
  workerId: number;
  epoch?: number;
  clock?: Clock;
  /** How many times to re-read the clock when 4,096 ids were used in one ms. Default 1,000,000. */
  maxWaitAttempts?: number;
}

/** The fields packed into a Snowflake id. */
export interface SnowflakeParts {
  /** Unix milliseconds. */
  timestamp: number;
  workerId: number;
  sequence: number;
}

/**
 * Snowflake ids: 1 unused sign bit, 41 bits of milliseconds since a custom epoch,
 * 10 bits of worker id and a 12-bit per-millisecond sequence. Each worker generates
 * ids with no coordination; ids are unique as long as worker ids are, and roughly
 * time-ordered across workers, so they make good primary keys for B-tree indexes.
 */
export class SnowflakeGenerator {
  readonly workerId: number;
  readonly epoch: number;
  private readonly clock: Clock;
  private readonly maxWaitAttempts: number;
  private lastMs = -1;
  private sequence = 0;

  constructor(options: SnowflakeOptions) {
    if (!Number.isInteger(options.workerId) || options.workerId < 0 || options.workerId > MAX_WORKER_ID) {
      throw new RangeError(`workerId must be an integer in 0..${MAX_WORKER_ID}`);
    }
    this.workerId = options.workerId;
    this.epoch = options.epoch ?? DEFAULT_EPOCH;
    this.clock = options.clock ?? Date.now;
    this.maxWaitAttempts = options.maxWaitAttempts ?? 1_000_000;
  }

  next(): bigint {
    let now = this.clock();
    if (now < this.lastMs) throw new ClockMovedBackwardsError(this.lastMs, now);
    if (now === this.lastMs) {
      this.sequence = (this.sequence + 1) & MAX_SEQUENCE;
      if (this.sequence === 0) now = this.waitForNextMs();
    } else {
      this.sequence = 0;
    }
    this.lastMs = now;
    const elapsed = now - this.epoch;
    if (elapsed < 0 || elapsed > MAX_TIMESTAMP) throw new RangeError('clock is outside the 41-bit range of this epoch');
    return (BigInt(elapsed) << 22n) | (BigInt(this.workerId) << 12n) | BigInt(this.sequence);
  }

  decode(id: bigint): SnowflakeParts {
    return decodeSnowflake(id, this.epoch);
  }

  /** All 4,096 ids of this ms are used: re-read the clock (bounded) until it moves on. */
  private waitForNextMs(): number {
    for (let attempt = 0; attempt < this.maxWaitAttempts; attempt++) {
      const now = this.clock();
      if (now > this.lastMs) return now;
      if (now < this.lastMs) throw new ClockMovedBackwardsError(this.lastMs, now);
    }
    throw new ClockStalledError(this.maxWaitAttempts);
  }
}

/** Splits a Snowflake id back into its timestamp, worker id and sequence. */
export function decodeSnowflake(id: bigint, epoch = DEFAULT_EPOCH): SnowflakeParts {
  return {
    timestamp: Number(id >> 22n) + epoch,
    workerId: Number((id >> 12n) & BigInt(MAX_WORKER_ID)),
    sequence: Number(id & BigInt(MAX_SEQUENCE)),
  };
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Base62 text for a non-negative integer: an 11-character, URL-safe form of a 64-bit id. */
export function encodeBase62(value: bigint): string {
  if (value < 0n) throw new RangeError('base62 encodes non-negative integers only');
  if (value === 0n) return '0';
  let out = '';
  for (let v = value; v > 0n; v /= 62n) out = BASE62[Number(v % 62n)] + out;
  return out;
}

export function decodeBase62(text: string): bigint {
  if (text.length === 0) throw new RangeError('empty base62 string');
  let value = 0n;
  for (const ch of text) {
    const digit = BASE62.indexOf(ch);
    if (digit < 0) throw new RangeError(`invalid base62 character "${ch}"`);
    value = value * 62n + BigInt(digit);
  }
  return value;
}

/** `bits` random bits as a BigInt, drawn 16 bits at a time from `rng`. */
function randomBits(rng: Rng, bits: number): bigint {
  let value = 0n;
  for (let remaining = bits; remaining > 0; remaining -= 16) {
    const take = Math.min(16, remaining);
    value = (value << BigInt(take)) | BigInt(Math.floor(rng() * 2 ** take));
  }
  return value;
}

/** Matches a UUID with version 7 and the RFC 9562 variant (10xx). */
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * UUIDv7 (RFC 9562): 48-bit Unix milliseconds, 4-bit version 7, 12 random bits,
 * 2-bit variant 10, 62 random bits. A standard 128-bit UUID that sorts by creation
 * time, so it can replace random UUIDv4 keys without fragmenting B-tree indexes.
 * Ids within the same millisecond are in random order (the RFC's optional counter is omitted).
 */
export class UuidV7Generator {
  private readonly clock: Clock;
  private readonly rng: Rng;

  constructor(options: { clock?: Clock; rng?: Rng } = {}) {
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? Math.random;
  }

  next(): string {
    const ms = this.clock();
    if (!Number.isInteger(ms) || ms < 0 || ms >= 2 ** 48) throw new RangeError('timestamp must fit in 48 bits');
    const value =
      (BigInt(ms) << 80n) | (7n << 76n) | (randomBits(this.rng, 12) << 64n) | (2n << 62n) | randomBits(this.rng, 62);
    const hex = value.toString(16).padStart(32, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/** The Unix milliseconds stored in the first 48 bits of a UUIDv7. */
export function uuidV7Timestamp(uuid: string): number {
  if (!UUID_V7_PATTERN.test(uuid)) throw new RangeError('not a UUIDv7');
  return parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockford(value: bigint, length: number): string {
  let out = '';
  for (let i = 0, v = value; i < length; i++, v >>= 5n) out = CROCKFORD[Number(v & 31n)] + out;
  return out;
}

/**
 * ULID: 48-bit milliseconds (10 chars) then 80 random bits (16 chars) in Crockford
 * base32, 26 characters that sort lexicographically by time. Monotonic: within the
 * same millisecond (or if the clock steps back) the previous random part is
 * incremented, so ids from one generator always sort in creation order.
 */
export class UlidGenerator {
  private readonly clock: Clock;
  private readonly rng: Rng;
  private lastMs = -1;
  private lastRandom = 0n;

  constructor(options: { clock?: Clock; rng?: Rng } = {}) {
    this.clock = options.clock ?? Date.now;
    this.rng = options.rng ?? Math.random;
  }

  next(): string {
    const now = this.clock();
    if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) throw new RangeError('timestamp must fit in 48 bits');
    if (now <= this.lastMs) {
      this.lastRandom += 1n;
      if (this.lastRandom >= 1n << 80n) throw new RangeError('ULID random component overflowed within one millisecond');
    } else {
      this.lastMs = now;
      this.lastRandom = randomBits(this.rng, 80);
    }
    return encodeCrockford(BigInt(this.lastMs), 10) + encodeCrockford(this.lastRandom, 16);
  }
}

/** The Unix milliseconds encoded in a ULID's first 10 characters. */
export function decodeUlidTime(ulid: string): number {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(ulid)) throw new RangeError('not a ULID');
  let ms = 0;
  for (const ch of ulid.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(ch);
  return ms;
}
