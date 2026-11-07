import { createHash } from 'node:crypto';

/**
 * An in-memory log-structured merge tree (LSM tree).
 *
 * Writes go to an append-only write-ahead log and a sorted in-memory memtable,
 * so every write is sequential. When the memtable fills it is flushed to an
 * immutable sorted table (SSTable). Reads check the memtable, then SSTables
 * from newest to oldest; Bloom filters skip tables that cannot hold the key.
 * Compaction merges tables in the background to drop overwritten values and
 * deleted keys, trading write amplification for read and space efficiency.
 */

/** A key's latest state. `value === null` is a tombstone: the key was deleted. */
export interface Entry {
  key: string;
  value: string | null;
  /** Global sequence number: higher means newer. */
  seq: number;
}

/** One write-ahead log record. */
export interface WalRecord {
  seq: number;
  op: 'put' | 'delete';
  key: string;
  value?: string;
}

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Index of the first entry whose key is >= `key`. */
function lowerBound(entries: readonly { key: string }[], key: string, lo = 0, hi = entries.length): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].key < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The write-ahead log. Every mutation is appended here before it touches the
 * memtable, so a crash loses nothing that was acknowledged. Once the memtable
 * is flushed to an SSTable, the covered records are truncated.
 */
export class WriteAheadLog {
  private log: WalRecord[] = [];

  append(record: WalRecord): void {
    this.log.push({ ...record });
  }

  /** Drops records with seq <= `seq` (they are durable in an SSTable now). */
  truncateThrough(seq: number): void {
    this.log = this.log.filter((r) => r.seq > seq);
  }

  get records(): readonly WalRecord[] {
    return this.log;
  }
}

/**
 * A small Bloom filter: k hash positions per key over m bits.
 * No false negatives; about 1 % false positives at 10 bits per key.
 */
export class BloomFilter {
  private readonly bits: Uint8Array;
  readonly m: number;
  readonly k: number;

  constructor(expectedItems: number, bitsPerKey: number) {
    this.m = Math.max(8, Math.ceil(expectedItems * bitsPerKey));
    this.k = Math.max(1, Math.round(bitsPerKey * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }

  add(key: string): void {
    for (const p of this.positions(key)) this.bits[p >>> 3] |= 1 << (p & 7);
  }

  mightContain(key: string): boolean {
    for (const p of this.positions(key)) if ((this.bits[p >>> 3] & (1 << (p & 7))) === 0) return false;
    return true;
  }

  /** Double hashing (Kirsch-Mitzenmacher): k positions from two 32-bit hashes. */
  private positions(key: string): number[] {
    const digest = createHash('md5').update(key).digest();
    const h1 = digest.readUInt32BE(0);
    const h2 = (digest.readUInt32BE(4) | 1) >>> 0;
    return Array.from({ length: this.k }, (_, i) => (h1 + i * h2) % this.m);
  }
}

/**
 * The memtable: a sorted array with binary search. Lookups are O(log n);
 * inserts shift the array, which is fine at memtable sizes. Production engines
 * use a skip list (LevelDB, RocksDB) for concurrent inserts.
 */
export class Memtable {
  private readonly entries: Entry[] = [];

  get size(): number {
    return this.entries.length;
  }

  put(entry: Entry): void {
    const i = lowerBound(this.entries, entry.key);
    if (this.entries[i]?.key === entry.key) this.entries[i] = entry;
    else this.entries.splice(i, 0, entry);
  }

  get(key: string): Entry | undefined {
    const e = this.entries[lowerBound(this.entries, key)];
    return e?.key === key ? e : undefined;
  }

  /** Sorted entries in [start, end). */
  range(start?: string, end?: string): Entry[] {
    const from = start === undefined ? 0 : lowerBound(this.entries, start);
    const to = end === undefined ? this.entries.length : lowerBound(this.entries, end);
    return this.entries.slice(from, to);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export interface SSTableOptions {
  /** One sparse-index entry every `indexInterval` keys (a "block"). */
  indexInterval: number;
  /** Bloom filter size; 0 disables the filter. */
  bloomBitsPerKey: number;
}

/**
 * An immutable sorted string table. Entries are sorted by key; a sparse index
 * holds every Nth key so a lookup binary-searches the index and then scans one
 * block, which on disk means reading one block instead of the whole file.
 */
export class SSTable {
  readonly entries: readonly Entry[];
  private readonly index: { key: string; offset: number }[] = [];
  private readonly bloom: BloomFilter | undefined;
  readonly minKey: string;
  readonly maxKey: string;
  readonly maxSeq: number;
  readonly tombstones: number;

  constructor(readonly id: number, sorted: readonly Entry[], options: SSTableOptions) {
    if (sorted.length === 0) throw new Error('an SSTable needs at least one entry');
    this.entries = Object.freeze([...sorted]);
    for (let i = 0; i < sorted.length; i += options.indexInterval) this.index.push({ key: sorted[i].key, offset: i });
    if (options.bloomBitsPerKey > 0) {
      this.bloom = new BloomFilter(sorted.length, options.bloomBitsPerKey);
      for (const e of sorted) this.bloom.add(e.key);
    }
    this.minKey = sorted[0].key;
    this.maxKey = sorted[sorted.length - 1].key;
    this.maxSeq = Math.max(...sorted.map((e) => e.seq));
    this.tombstones = sorted.filter((e) => e.value === null).length;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Cheap pre-check: key range and Bloom filter. False means "definitely not here". */
  mayContain(key: string): boolean {
    if (key < this.minKey || key > this.maxKey) return false;
    return this.bloom ? this.bloom.mightContain(key) : true;
  }

  /** Sparse-index lookup: find the block, then scan it. */
  find(key: string): Entry | undefined {
    let lo = 0;
    let hi = this.index.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.index[mid].key <= key) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return undefined;
    const start = this.index[lo - 1].offset;
    const end = lo < this.index.length ? this.index[lo].offset : this.entries.length;
    const i = lowerBound(this.entries, key, start, end);
    return this.entries[i]?.key === key ? this.entries[i] : undefined;
  }

  range(start?: string, end?: string): readonly Entry[] {
    const from = start === undefined ? 0 : lowerBound(this.entries, start);
    const to = end === undefined ? this.entries.length : lowerBound(this.entries, end);
    return this.entries.slice(from, to);
  }
}

/** What survives a crash: the WAL and the SSTables (oldest first). */
export interface Disk {
  wal: WriteAheadLog;
  sstables: SSTable[];
}

export interface LSMTreeOptions {
  /** Reopen existing state: the WAL is replayed into a fresh memtable. */
  disk?: Disk;
  /** Flush when the memtable holds this many keys. Default 64. */
  memtableLimit?: number;
  /** Default 16. */
  indexInterval?: number;
  /** Default 10 (about 1 % false positives). 0 disables Bloom filters. */
  bloomBitsPerKey?: number;
  /** Size-tiered compaction merges a run of this many same-tier tables. Default 4. */
  compactionThreshold?: number;
}

export interface LSMStats {
  /** SSTables whose blocks were actually searched by get. */
  sstablesProbed: number;
  /** SSTables skipped by the key-range or Bloom check. */
  sstablesSkipped: number;
  flushes: number;
  compactions: number;
  /** Shadowed versions and tombstones removed by compaction. */
  entriesDropped: number;
}

/**
 * The LSM key-value store: WAL + memtable + SSTables + size-tiered compaction.
 *
 * Size tiers: a table's tier is floor(log_threshold(size / memtableLimit)).
 * After each flush, any run of `compactionThreshold` adjacent (by age) tables
 * in the same tier is merged. Only adjacent tables are merged so that
 * "newest table wins" stays correct for reads. Tombstones are dropped only
 * when the merge includes the oldest table, since otherwise an older table
 * could still hold the value the tombstone hides.
 */
export class LSMTree {
  private readonly wal: WriteAheadLog;
  private readonly sstables: SSTable[];
  private readonly memtable = new Memtable();
  private readonly opts: Required<Omit<LSMTreeOptions, 'disk'>>;
  private seq: number;
  private nextTableId: number;
  readonly stats: LSMStats = { sstablesProbed: 0, sstablesSkipped: 0, flushes: 0, compactions: 0, entriesDropped: 0 };

  constructor(options: LSMTreeOptions = {}) {
    this.opts = {
      memtableLimit: options.memtableLimit ?? 64,
      indexInterval: options.indexInterval ?? 16,
      bloomBitsPerKey: options.bloomBitsPerKey ?? 10,
      compactionThreshold: options.compactionThreshold ?? 4,
    };
    this.wal = options.disk?.wal ?? new WriteAheadLog();
    this.sstables = options.disk?.sstables ?? [];
    this.seq = Math.max(0, ...this.sstables.map((t) => t.maxSeq), ...this.wal.records.map((r) => r.seq));
    this.nextTableId = Math.max(0, ...this.sstables.map((t) => t.id)) + 1;
    for (const r of this.wal.records) this.memtable.put({ key: r.key, value: r.op === 'put' ? (r.value ?? '') : null, seq: r.seq });
  }

  /** The durable state. Pass it to a new LSMTree to simulate a restart after a crash. */
  get disk(): Disk {
    return { wal: this.wal, sstables: this.sstables };
  }

  get memtableSize(): number {
    return this.memtable.size;
  }

  /** Per-table summary, oldest first. */
  sstableInfo(): { id: number; entries: number; tombstones: number; tier: number }[] {
    return this.sstables.map((t) => ({ id: t.id, entries: t.size, tombstones: t.tombstones, tier: this.tier(t) }));
  }

  put(key: string, value: string): void {
    this.write({ seq: ++this.seq, op: 'put', key, value });
  }

  delete(key: string): void {
    this.write({ seq: ++this.seq, op: 'delete', key });
  }

  get(key: string): string | undefined {
    const mem = this.memtable.get(key);
    if (mem) return mem.value ?? undefined;
    for (let i = this.sstables.length - 1; i >= 0; i--) {
      const table = this.sstables[i];
      if (!table.mayContain(key)) {
        this.stats.sstablesSkipped += 1;
        continue;
      }
      this.stats.sstablesProbed += 1;
      const hit = table.find(key);
      if (hit) return hit.value ?? undefined;
    }
    return undefined;
  }

  /** Live key/value pairs in [start, end), in key order; sources go newest first so the newest version wins. */
  *scan(start?: string, end?: string): Generator<[string, string]> {
    const sources: readonly Entry[][] = [this.memtable.range(start, end), ...[...this.sstables].reverse().map((t) => [...t.range(start, end)])];
    for (const entry of mergeSources(sources)) if (entry.value !== null) yield [entry.key, entry.value];
  }

  /** Writes the memtable to a new SSTable and truncates the WAL. */
  flush(): void {
    if (this.memtable.size === 0) return;
    const table = new SSTable(this.nextTableId++, this.memtable.range(), this.opts);
    this.sstables.push(table);
    this.memtable.clear();
    this.wal.truncateThrough(table.maxSeq);
    this.stats.flushes += 1;
    this.maybeCompact();
  }

  /** Major compaction: merge every SSTable into one and drop all tombstones. */
  compact(): void {
    if (this.sstables.length > 0) this.mergeRun(0, this.sstables.length);
  }

  private write(record: WalRecord): void {
    this.wal.append(record);
    this.memtable.put({ key: record.key, value: record.op === 'put' ? (record.value ?? '') : null, seq: record.seq });
    if (this.memtable.size >= this.opts.memtableLimit) this.flush();
  }

  private tier(table: SSTable): number {
    const ratio = Math.max(1, table.size / this.opts.memtableLimit);
    return Math.floor(Math.log(ratio) / Math.log(this.opts.compactionThreshold) + 1e-9);
  }

  private maybeCompact(): void {
    const t = this.opts.compactionThreshold;
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i + t <= this.sstables.length; i++) {
        const tier = this.tier(this.sstables[i]);
        if (this.sstables.slice(i, i + t).every((s) => this.tier(s) === tier)) {
          this.mergeRun(i, i + t);
          merged = true;
          break;
        }
      }
    }
  }

  /** Merges the adjacent tables [from, to) into one, keeping only the newest version of each key. */
  private mergeRun(from: number, to: number): void {
    const run = this.sstables.slice(from, to);
    const dropTombstones = from === 0;
    const merged: Entry[] = [];
    const total = run.reduce((sum, t) => sum + t.size, 0);
    for (const e of mergeSources([...run].reverse().map((t) => [...t.entries]))) {
      if (e.value === null && dropTombstones) continue;
      merged.push(e);
    }
    this.stats.compactions += 1;
    this.stats.entriesDropped += total - merged.length;
    const replacement = merged.length > 0 ? [new SSTable(this.nextTableId++, merged, this.opts)] : [];
    this.sstables.splice(from, to - from, ...replacement);
  }
}

/** K-way merge of sorted sources (newest first). Emits each key once, from the newest source. */
function* mergeSources(sources: readonly (readonly Entry[])[]): Generator<Entry> {
  const cursors = sources.map(() => 0);
  for (;;) {
    let best = -1;
    for (let s = 0; s < sources.length; s++) {
      const e = sources[s][cursors[s]];
      if (e && (best === -1 || compareKeys(e.key, sources[best][cursors[best]].key) < 0)) best = s;
    }
    if (best === -1) return;
    const winner = sources[best][cursors[best]];
    for (let s = 0; s < sources.length; s++) if (sources[s][cursors[s]]?.key === winner.key) cursors[s] += 1;
    yield winner;
  }
}
