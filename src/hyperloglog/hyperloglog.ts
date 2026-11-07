import { createHash } from 'node:crypto';

/** A 64-bit hash as an unsigned BigInt. Injectable so tests can pin behaviour. */
export type Hash64 = (item: string) => bigint;

/** First 64 bits of MD5. Good spread is all HyperLogLog needs; it is not a security hash here. */
export const md5Hash64: Hash64 = (item) => createHash('md5').update(item).digest().readBigUInt64BE(0);

const MASK64 = (1n << 64n) - 1n;

/** Bias-correction constant alpha_m from the HyperLogLog paper. */
export function alpha(registerCount: number): number {
  if (registerCount === 16) return 0.673;
  if (registerCount === 32) return 0.697;
  if (registerCount === 64) return 0.709;
  return 0.7213 / (1 + 1.079 / registerCount);
}

/** Leading zero bits of a 64-bit unsigned BigInt (64 for zero). */
function leadingZeros64(x: bigint): number {
  const hi = Number(x >> 32n);
  if (hi !== 0) return Math.clz32(hi);
  return 32 + Math.clz32(Number(x & 0xffffffffn));
}

export interface HyperLogLogOptions {
  /** p: the sketch has 2^p one-byte registers. 4..18; default 14 (16,384 registers, 0.81 % error). */
  precision?: number;
  hash?: Hash64;
}

/** How count() arrived at its answer. */
export interface EstimateDetails {
  /** The harmonic-mean estimate alpha * m^2 / sum(2^-register). */
  raw: number;
  /** The value count() rounds. */
  estimate: number;
  zeroRegisters: number;
  /** Linear counting is used for small cardinalities, where the raw estimate is biased. */
  method: 'linear-counting' | 'harmonic-mean';
}

/**
 * HyperLogLog: estimates the number of distinct items in a stream using 2^p small
 * registers, with standard error 1.04 / sqrt(2^p), whatever the cardinality.
 * Each item's hash picks a register (first p bits) and records the position of the
 * first 1 bit in the rest; long runs of leading zeros are rare, so the maximum seen
 * says how many distinct hashes went by. Re-adding an item changes nothing, and two
 * sketches merge by taking the register-wise maximum.
 */
export class HyperLogLog {
  readonly precision: number;
  readonly registerCount: number;
  private readonly registers: Uint8Array;
  private readonly hash: Hash64;
  private readonly indexShift: bigint;
  private readonly restMask: bigint;

  constructor(options: HyperLogLogOptions = {}) {
    const p = options.precision ?? 14;
    if (!Number.isInteger(p) || p < 4 || p > 18) throw new RangeError('precision must be an integer in 4..18');
    this.precision = p;
    this.registerCount = 2 ** p;
    this.registers = new Uint8Array(this.registerCount);
    this.hash = options.hash ?? md5Hash64;
    this.indexShift = BigInt(64 - p);
    this.restMask = (1n << BigInt(64 - p)) - 1n;
  }

  /** 1.04 / sqrt(m): one standard deviation of the relative error. */
  get standardError(): number {
    return 1.04 / Math.sqrt(this.registerCount);
  }

  /** One byte per register here; Redis packs 6 bits per register. */
  get sizeInBytes(): number {
    return this.registers.length;
  }

  /** Adds an item. Returns true if a register changed (so the estimate may have moved). */
  add(item: string): boolean {
    const h = this.hash(item) & MASK64;
    const index = Number(h >> this.indexShift);
    const rest = h & this.restMask;
    // rest occupies the low 64 - p bits; the rank is the 1-based position of its first 1 bit.
    const rank = leadingZeros64(rest) - this.precision + 1;
    if (rank > this.registers[index]) {
      this.registers[index] = rank;
      return true;
    }
    return false;
  }

  /** Estimated number of distinct items added. */
  count(): number {
    return Math.round(this.details().estimate);
  }

  details(): EstimateDetails {
    const m = this.registerCount;
    let sum = 0;
    let zeroRegisters = 0;
    for (const r of this.registers) {
      sum += 2 ** -r;
      if (r === 0) zeroRegisters++;
    }
    const raw = (alpha(m) * m * m) / sum;
    // Small-range correction: with empty registers left, linear counting is more accurate.
    if (raw <= 2.5 * m && zeroRegisters > 0) {
      return { raw, estimate: m * Math.log(m / zeroRegisters), zeroRegisters, method: 'linear-counting' };
    }
    // No large-range correction: with a 64-bit hash, collisions are negligible far past 10^12.
    return { raw, estimate: raw, zeroRegisters, method: 'harmonic-mean' };
  }

  /** Union in place: register-wise maximum. Both sketches must use the same precision and hash. */
  merge(other: HyperLogLog): void {
    if (other.precision !== this.precision) throw new RangeError('merge needs sketches with the same precision');
    for (let i = 0; i < this.registerCount; i++) {
      if (other.registers[i] > this.registers[i]) this.registers[i] = other.registers[i];
    }
  }

  /** A new sketch for the union of `sketches`, leaving them unchanged. */
  static union(...sketches: HyperLogLog[]): HyperLogLog {
    if (sketches.length === 0) throw new RangeError('union needs at least one sketch');
    const result = sketches[0].clone();
    for (const s of sketches.slice(1)) result.merge(s);
    return result;
  }

  clone(): HyperLogLog {
    const copy = new HyperLogLog({ precision: this.precision, hash: this.hash });
    copy.registers.set(this.registers);
    return copy;
  }

  /** The raw registers, for persisting or shipping a sketch to an aggregator. */
  toBytes(): Uint8Array {
    return this.registers.slice();
  }

  static fromBytes(bytes: Uint8Array, hash: Hash64 = md5Hash64): HyperLogLog {
    const precision = Math.log2(bytes.length);
    const sketch = new HyperLogLog({ precision, hash });
    sketch.registers.set(bytes);
    return sketch;
  }
}
