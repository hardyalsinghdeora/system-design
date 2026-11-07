/** Callback run when a timer fires; receives the timer's notion of "now". */
export type TimerTask = (firedAtMs: number) => void;

export interface FiredTask {
  id: number;
  deadlineMs: number;
  firedAtMs: number;
}

/** What both timers offer, so DelayedJobQueue can run on either. */
export interface Timer {
  readonly currentTimeMs: number;
  readonly pending: number;
  schedule(delayMs: number, task: TimerTask): number;
  cancel(id: number): boolean;
  advanceTo(timeMs: number): FiredTask[];
}

/** A plain binary min-heap. Used for the comparison delay queue and for the wheel's bucket queue. */
export class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as T;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

interface Entry {
  id: number;
  seq: number;
  deadlineMs: number;
  /** First tick at or after the deadline: the wheel never fires early, at most one tick late. */
  deadlineTick: number;
  task: TimerTask;
  bucket: Bucket | null;
}

class Bucket {
  /** Start tick of the slot this bucket currently represents; -1 when empty and not queued. */
  expiration = -1;
  readonly entries = new Set<Entry>();
}

const byDeadline = (a: Entry, b: Entry): number => a.deadlineMs - b.deadlineMs || a.seq - b.seq;

/** One level: `size` buckets of `span` ticks each. Its overflow level has buckets `span * size` wide. */
class Wheel {
  readonly interval: number;
  readonly buckets: Bucket[];
  currentTick: number;
  overflow: Wheel | null = null;

  constructor(
    readonly span: number,
    readonly size: number,
    startTick: number,
    private readonly onNewBucket: (bucket: Bucket) => void,
  ) {
    this.interval = span * size;
    this.currentTick = startTick - (startTick % span);
    this.buckets = Array.from({ length: size }, () => new Bucket());
  }

  /** Places the entry on this level or a coarser one. False means it is already due. */
  add(entry: Entry): boolean {
    const t = entry.deadlineTick;
    if (t < this.currentTick + this.span) return false;
    if (t < this.currentTick + this.interval) {
      const virtual = Math.floor(t / this.span);
      const bucket = this.buckets[virtual % this.size];
      bucket.entries.add(entry);
      entry.bucket = bucket;
      const expiration = virtual * this.span;
      if (bucket.expiration !== expiration) {
        bucket.expiration = expiration;
        this.onNewBucket(bucket);
      }
      return true;
    }
    this.overflow ??= new Wheel(this.interval, this.size, this.currentTick, this.onNewBucket);
    return this.overflow.add(entry);
  }

  advance(tick: number): void {
    if (tick >= this.currentTick + this.span) {
      this.currentTick = tick - (tick % this.span);
      this.overflow?.advance(this.currentTick);
    }
  }
}

export interface TimingWheelOptions {
  /** Resolution: tasks fire on the first tick boundary at or after their deadline. */
  tickMs?: number;
  /** Buckets per level. Level n covers tickMs * wheelSize^(n+1). */
  wheelSize?: number;
  startMs?: number;
}

/**
 * A hierarchical timing wheel in the style of Kafka's request purgatory.
 * schedule and cancel are O(1) whatever the number of pending timers, which
 * is why brokers and network stacks with millions of timeouts use it instead
 * of a heap. A task too far out for the first level goes to a coarser
 * overflow level and cascades down as time approaches. Like Kafka, only
 * non-empty buckets are queued (in a small heap keyed by bucket start), so
 * advancing the clock never walks through empty ticks. Time is driven by the
 * caller through advanceTo(); there are no real timers.
 */
export class HierarchicalTimingWheel implements Timer {
  private readonly tickMs: number;
  private readonly root: Wheel;
  private readonly bucketQueue = new MinHeap<Bucket>((a, b) => a.expiration < b.expiration);
  private readonly entries = new Map<number, Entry>();
  private due: Entry[] = [];
  private nowMs: number;
  private nextId = 1;
  private nextSeq = 0;

  constructor(options: TimingWheelOptions = {}) {
    this.tickMs = options.tickMs ?? 1;
    const wheelSize = options.wheelSize ?? 20;
    this.nowMs = options.startMs ?? 0;
    if (!(this.tickMs > 0) || !Number.isInteger(wheelSize) || wheelSize < 2) throw new RangeError('tickMs > 0 and wheelSize >= 2 required');
    this.root = new Wheel(1, wheelSize, Math.floor(this.nowMs / this.tickMs), (b) => this.bucketQueue.push(b));
  }

  get currentTimeMs(): number { return this.nowMs; }
  get pending(): number { return this.entries.size; }

  /** Number of wheel levels created so far (overflow wheels are created lazily). */
  get levels(): number {
    let n = 0;
    for (let w: Wheel | null = this.root; w; w = w.overflow) n++;
    return n;
  }

  schedule(delayMs: number, task: TimerTask): number {
    const deadlineMs = this.nowMs + Math.max(0, delayMs);
    const entry: Entry = {
      id: this.nextId++,
      seq: this.nextSeq++,
      deadlineMs,
      deadlineTick: Math.ceil(deadlineMs / this.tickMs),
      task,
      bucket: null,
    };
    this.entries.set(entry.id, entry);
    if (!this.root.add(entry)) this.due.push(entry);
    return entry.id;
  }

  /** O(1): unlink from its bucket. */
  cancel(id: number): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.bucket?.entries.delete(entry);
    entry.bucket = null;
    this.entries.delete(id);
    this.due = this.due.filter((e) => e !== entry);
    return true;
  }

  /** Moves the clock forward, firing every task whose tick has come, in (deadline, schedule order). */
  advanceTo(timeMs: number): FiredTask[] {
    if (timeMs < this.nowMs) throw new RangeError('time cannot go backwards');
    const targetTick = Math.floor(timeMs / this.tickMs);
    const fired: FiredTask[] = [];
    for (;;) {
      if (this.due.length > 0) {
        this.fireDue(fired);
        continue;
      }
      const next = this.bucketQueue.peek();
      if (!next || next.expiration > targetTick) break;
      const tick = next.expiration;
      this.root.advance(tick);
      this.nowMs = Math.max(this.nowMs, tick * this.tickMs);
      // Flush every bucket that starts at this tick: entries now due fire, the rest cascade to a finer level.
      while (this.bucketQueue.peek()?.expiration === tick) {
        const bucket = this.bucketQueue.pop() as Bucket;
        const moving = [...bucket.entries];
        bucket.entries.clear();
        bucket.expiration = -1;
        for (const entry of moving) {
          entry.bucket = null;
          if (!this.root.add(entry)) this.due.push(entry);
        }
      }
    }
    this.root.advance(targetTick);
    this.nowMs = timeMs;
    return fired;
  }

  private fireDue(fired: FiredTask[]): void {
    const batch = this.due.sort(byDeadline);
    this.due = [];
    for (const entry of batch) {
      if (!this.entries.delete(entry.id)) continue; // cancelled by an earlier task in this batch
      fired.push({ id: entry.id, deadlineMs: entry.deadlineMs, firedAtMs: this.nowMs });
      entry.task(this.nowMs);
    }
  }
}

interface HeapEntry {
  id: number;
  seq: number;
  deadlineMs: number;
  task: TimerTask;
}

/**
 * The textbook alternative (java.util.concurrent.DelayQueue, most language
 * runtimes): a min-heap on deadline. Exact to the millisecond, but schedule
 * is O(log n) and cancel here is lazy (the entry stays in the heap until popped).
 */
export class HeapDelayQueue implements Timer {
  private readonly heap = new MinHeap<HeapEntry>((a, b) => a.deadlineMs < b.deadlineMs || (a.deadlineMs === b.deadlineMs && a.seq < b.seq));
  private readonly live = new Set<number>();
  private nowMs: number;
  private nextId = 1;
  private nextSeq = 0;

  constructor(options: { startMs?: number } = {}) {
    this.nowMs = options.startMs ?? 0;
  }

  get currentTimeMs(): number { return this.nowMs; }
  get pending(): number { return this.live.size; }

  schedule(delayMs: number, task: TimerTask): number {
    const id = this.nextId++;
    this.heap.push({ id, seq: this.nextSeq++, deadlineMs: this.nowMs + Math.max(0, delayMs), task });
    this.live.add(id);
    return id;
  }

  cancel(id: number): boolean {
    return this.live.delete(id);
  }

  advanceTo(timeMs: number): FiredTask[] {
    if (timeMs < this.nowMs) throw new RangeError('time cannot go backwards');
    const fired: FiredTask[] = [];
    for (let top = this.heap.peek(); top && top.deadlineMs <= timeMs; top = this.heap.peek()) {
      this.heap.pop();
      if (!this.live.delete(top.id)) continue;
      this.nowMs = Math.max(this.nowMs, top.deadlineMs);
      fired.push({ id: top.id, deadlineMs: top.deadlineMs, firedAtMs: this.nowMs });
      top.task(this.nowMs);
    }
    this.nowMs = timeMs;
    return fired;
  }
}

export interface Job<T> {
  id: string;
  payload: T;
}

export interface JobEvent {
  jobId: string;
  attempt: number;
  atMs: number;
  outcome: 'succeeded' | 'retry-scheduled' | 'dead-lettered';
}

export interface DelayedJobQueueOptions<T> {
  timer: Timer;
  /** Returns true on success; false or a throw counts as a failed attempt. */
  handler: (job: Job<T>, attempt: number) => boolean;
  maxAttempts?: number;
  /** Delay before attempt n+1 after attempt n failed. Default: 1 s doubling. */
  backoffMs?: (attempt: number) => number;
}

/**
 * Delayed jobs with retry on top of any Timer: run a job after a delay,
 * reschedule it with exponential backoff when it fails, and dead-letter it
 * after maxAttempts. This is the shape of a job scheduler's dispatch loop.
 */
export class DelayedJobQueue<T> {
  readonly log: JobEvent[] = [];
  readonly deadLetters: Job<T>[] = [];
  private readonly timer: Timer;
  private readonly handler: (job: Job<T>, attempt: number) => boolean;
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly timerIds = new Map<string, number>();

  constructor(options: DelayedJobQueueOptions<T>) {
    this.timer = options.timer;
    this.handler = options.handler;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? ((attempt) => 1000 * 2 ** (attempt - 1));
  }

  get pending(): number { return this.timerIds.size; }

  enqueue(job: Job<T>, delayMs: number): void {
    this.cancel(job.id);
    this.arm(job, 1, delayMs);
  }

  cancel(jobId: string): boolean {
    const timerId = this.timerIds.get(jobId);
    if (timerId === undefined) return false;
    this.timerIds.delete(jobId);
    return this.timer.cancel(timerId);
  }

  advanceTo(timeMs: number): void {
    this.timer.advanceTo(timeMs);
  }

  private arm(job: Job<T>, attempt: number, delayMs: number): void {
    const timerId = this.timer.schedule(delayMs, (atMs) => this.run(job, attempt, atMs));
    this.timerIds.set(job.id, timerId);
  }

  private run(job: Job<T>, attempt: number, atMs: number): void {
    this.timerIds.delete(job.id);
    let ok: boolean;
    try {
      ok = this.handler(job, attempt);
    } catch {
      ok = false;
    }
    if (ok) {
      this.log.push({ jobId: job.id, attempt, atMs, outcome: 'succeeded' });
    } else if (attempt >= this.maxAttempts) {
      this.log.push({ jobId: job.id, attempt, atMs, outcome: 'dead-lettered' });
      this.deadLetters.push(job);
    } else {
      this.log.push({ jobId: job.id, attempt, atMs, outcome: 'retry-scheduled' });
      this.arm(job, attempt + 1, this.backoffMs(attempt));
    }
  }
}
