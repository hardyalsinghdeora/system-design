import { createHash } from 'node:crypto';

/** Size of a Bloom filter: `bits` (m) and number of hash functions (k). */
export interface BloomParameters {
  bits: number;
  hashes: number;
}

/**
 * Optimal m and k for `expectedItems` (n) at `falsePositiveRate` (p):
 * m = ceil(-n ln p / (ln 2)^2), k = round((m / n) ln 2).
 * About 9.6 bits per item buys 1 %, and every further 4.8 bits divides the rate by 10.
 */
export function optimalParameters(expectedItems: number, falsePositiveRate: number): BloomParameters {
  if (!Number.isFinite(expectedItems) || expectedItems <= 0) throw new RangeError('expectedItems must be > 0');
  if (!(falsePositiveRate > 0 && falsePositiveRate < 1)) throw new RangeError('falsePositiveRate must be in (0, 1)');
  const bits = Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2));
  const hashes = Math.max(1, Math.round((bits / expectedItems) * Math.LN2));
  return { bits, hashes };
}

/** Expected false-positive rate (1 - e^(-kn/m))^k after inserting `items` distinct items. */
export function theoreticalFalsePositiveRate(bits: number, hashes: number, items: number): number {
  return (1 - Math.exp((-hashes * items) / bits)) ** hashes;
}

/**
 * The k bit positions for `item`. Kirsch-Mitzenmacher double hashing: one MD5 digest
 * gives h1 and h2, and position i is (h1 + i * h2) mod m. Two hashes simulate k
 * independent ones without losing false-positive accuracy, so k costs one digest.
 */
export function bitPositions(item: string, bits: number, hashes: number): number[] {
  const digest = createHash('md5').update(item).digest();
  const h1 = digest.readUInt32BE(0);
  const h2 = digest.readUInt32BE(4) || 1;
  const positions = new Array<number>(hashes);
  for (let i = 0; i < hashes; i++) positions[i] = (h1 + i * h2) % bits;
  return positions;
}

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, byte) => {
  let count = 0;
  for (let b = byte; b > 0; b >>= 1) count += b & 1;
  return count;
});

const HEADER_BYTES = 12;

/**
 * A Bloom filter: a set that answers "definitely not present" or "maybe present" in
 * m bits, with no false negatives. Used to skip expensive lookups (disk, network,
 * database) for items that were never inserted.
 */
export class BloomFilter {
  readonly bitCount: number;
  readonly hashCount: number;
  private readonly bits: Uint8Array;
  private inserted = 0;

  constructor(bitCount: number, hashCount: number) {
    if (!Number.isInteger(bitCount) || bitCount < 1 || bitCount > 0xffffffff) throw new RangeError('bitCount must be a positive 32-bit integer');
    if (!Number.isInteger(hashCount) || hashCount < 1) throw new RangeError('hashCount must be a positive integer');
    this.bitCount = bitCount;
    this.hashCount = hashCount;
    this.bits = new Uint8Array(Math.ceil(bitCount / 8));
  }

  /** A filter sized for `expectedItems` at `falsePositiveRate`. */
  static withCapacity(expectedItems: number, falsePositiveRate: number): BloomFilter {
    const { bits, hashes } = optimalParameters(expectedItems, falsePositiveRate);
    return new BloomFilter(bits, hashes);
  }

  /** Number of add() calls (duplicates included). */
  get count(): number {
    return this.inserted;
  }

  get sizeInBytes(): number {
    return this.bits.length;
  }

  add(item: string): void {
    for (const p of bitPositions(item, this.bitCount, this.hashCount)) this.bits[p >>> 3] |= 1 << (p & 7);
    this.inserted++;
  }

  /** false means definitely absent; true means present or a false positive. */
  mightContain(item: string): boolean {
    for (const p of bitPositions(item, this.bitCount, this.hashCount)) {
      if ((this.bits[p >>> 3] & (1 << (p & 7))) === 0) return false;
    }
    return true;
  }

  /** Fraction of bits set. Around 0.5 at the designed capacity. */
  fillRatio(): number {
    let set = 0;
    for (const byte of this.bits) set += POPCOUNT[byte];
    return set / this.bitCount;
  }

  /** Current false-positive probability, (fraction of bits set)^k. Rises as the filter overfills. */
  estimatedFalsePositiveRate(): number {
    return this.fillRatio() ** this.hashCount;
  }

  /** Bytes: bitCount, hashCount, count (uint32 big-endian each), then the bit array. */
  serialize(): Uint8Array {
    const out = new Uint8Array(HEADER_BYTES + this.bits.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, this.bitCount);
    view.setUint32(4, this.hashCount);
    view.setUint32(8, this.inserted);
    out.set(this.bits, HEADER_BYTES);
    return out;
  }

  static deserialize(bytes: Uint8Array): BloomFilter {
    if (bytes.length < HEADER_BYTES) throw new RangeError('buffer too short for a Bloom filter header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const filter = new BloomFilter(view.getUint32(0), view.getUint32(4));
    if (bytes.length !== HEADER_BYTES + filter.bits.length) throw new RangeError('buffer length does not match bitCount');
    filter.inserted = view.getUint32(8);
    filter.bits.set(bytes.subarray(HEADER_BYTES));
    return filter;
  }

  /**
   * Bitwise OR of two filters with the same m and k: contains everything either did,
   * and is identical to a filter built from both sets. Lets shards build filters
   * independently and merge them.
   */
  union(other: BloomFilter): BloomFilter {
    if (other.bitCount !== this.bitCount || other.hashCount !== this.hashCount) {
      throw new RangeError('union needs filters with the same bitCount and hashCount');
    }
    const merged = new BloomFilter(this.bitCount, this.hashCount);
    for (let i = 0; i < this.bits.length; i++) merged.bits[i] = this.bits[i] | other.bits[i];
    merged.inserted = this.inserted + other.inserted;
    return merged;
  }
}

/**
 * A Bloom filter with a small counter per position instead of a bit, so items can be
 * removed. Costs 8x the memory here (8-bit counters; 4-bit is the classic choice).
 * Removing an item that was never added can create false negatives, so callers must
 * only remove items they know they inserted. Saturated counters are never decremented.
 */
export class CountingBloomFilter {
  readonly bitCount: number;
  readonly hashCount: number;
  private readonly counters: Uint8Array;

  constructor(bitCount: number, hashCount: number) {
    if (!Number.isInteger(bitCount) || bitCount < 1) throw new RangeError('bitCount must be a positive integer');
    if (!Number.isInteger(hashCount) || hashCount < 1) throw new RangeError('hashCount must be a positive integer');
    this.bitCount = bitCount;
    this.hashCount = hashCount;
    this.counters = new Uint8Array(bitCount);
  }

  static withCapacity(expectedItems: number, falsePositiveRate: number): CountingBloomFilter {
    const { bits, hashes } = optimalParameters(expectedItems, falsePositiveRate);
    return new CountingBloomFilter(bits, hashes);
  }

  add(item: string): void {
    for (const p of bitPositions(item, this.bitCount, this.hashCount)) {
      if (this.counters[p] < 255) this.counters[p]++;
    }
  }

  mightContain(item: string): boolean {
    return bitPositions(item, this.bitCount, this.hashCount).every((p) => this.counters[p] > 0);
  }

  /** Decrements the item's counters. Returns false (and changes nothing) if it is definitely absent. */
  remove(item: string): boolean {
    const positions = bitPositions(item, this.bitCount, this.hashCount);
    if (!positions.every((p) => this.counters[p] > 0)) return false;
    for (const p of positions) if (this.counters[p] < 255) this.counters[p]--;
    return true;
  }
}
