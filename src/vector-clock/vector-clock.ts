/**
 * Logical clocks: ordering events without trusting wall clocks.
 *
 * Physical clocks on different machines drift and jump, so "which write came
 * first?" cannot be answered by timestamps alone. Logical clocks answer a
 * narrower, reliable question: could event A have influenced event B?
 */

/** Result of comparing two vector clocks. */
export type Ordering = 'BEFORE' | 'AFTER' | 'EQUAL' | 'CONCURRENT';

/**
 * A Lamport clock: one counter per process.
 *
 * It guarantees that if A happened before B then L(A) < L(B). The converse does
 * not hold, so a Lamport clock gives a total order consistent with causality but
 * cannot tell you whether two events were concurrent. It costs one integer per
 * message, which is why it is used for things like total-order tie-breaking.
 */
export class LamportClock {
  private counter: number;

  constructor(start = 0) {
    this.counter = start;
  }

  /** Current value without advancing. */
  get time(): number {
    return this.counter;
  }

  /** A local event: advance by one and return the event's timestamp. */
  tick(): number {
    this.counter += 1;
    return this.counter;
  }

  /** Sending is an event; the returned timestamp travels with the message. */
  send(): number {
    return this.tick();
  }

  /** On receipt, jump past the sender's timestamp so the receive is ordered after the send. */
  receive(remote: number): number {
    this.counter = Math.max(this.counter, remote) + 1;
    return this.counter;
  }
}

/**
 * An immutable vector clock: one counter per process that has touched the value.
 *
 * Comparing two vectors entry by entry tells you exactly whether one event
 * causally precedes the other or whether they are concurrent. Dynamo-style
 * stores use this to detect conflicting writes (siblings) instead of silently
 * dropping one. Missing entries count as zero; zero entries are not stored.
 */
export class VectorClock {
  private readonly counters: ReadonlyMap<string, number>;

  constructor(entries: Iterable<readonly [string, number]> | Readonly<Record<string, number>> = []) {
    const source: Iterable<readonly [string, number]> =
      Symbol.iterator in entries
        ? (entries as Iterable<readonly [string, number]>)
        : Object.entries(entries as Readonly<Record<string, number>>);
    const map = new Map<string, number>();
    for (const [node, count] of source) {
      if (!Number.isInteger(count) || count < 0) throw new RangeError(`invalid counter ${node}=${count}`);
      if (count > 0) map.set(node, count);
    }
    this.counters = map;
  }

  /** Counter for `node` (0 when absent). */
  get(node: string): number {
    return this.counters.get(node) ?? 0;
  }

  /** Processes with a non-zero counter, sorted. */
  get nodes(): string[] {
    return [...this.counters.keys()].sort();
  }

  /** A new clock with `node`'s counter advanced by one: a local event at `node`. */
  increment(node: string): VectorClock {
    const next = new Map(this.counters);
    next.set(node, this.get(node) + 1);
    return new VectorClock(next);
  }

  /** Pointwise maximum: the smallest clock that dominates both. Commutative, associative, idempotent. */
  merge(other: VectorClock): VectorClock {
    const next = new Map(this.counters);
    for (const [node, count] of other.counters) next.set(node, Math.max(count, this.get(node)));
    return new VectorClock(next);
  }

  /**
   * BEFORE when every entry is <= other's and at least one is smaller;
   * AFTER for the mirror image; EQUAL when identical; CONCURRENT otherwise.
   */
  compare(other: VectorClock): Ordering {
    let less = false;
    let greater = false;
    const all = new Set([...this.counters.keys(), ...other.counters.keys()]);
    for (const node of all) {
      const a = this.get(node);
      const b = other.get(node);
      if (a < b) less = true;
      else if (a > b) greater = true;
      if (less && greater) return 'CONCURRENT';
    }
    if (less) return 'BEFORE';
    if (greater) return 'AFTER';
    return 'EQUAL';
  }

  /** True when this clock causally precedes `other`. */
  happenedBefore(other: VectorClock): boolean {
    return this.compare(other) === 'BEFORE';
  }

  /** True when neither clock precedes the other: the events could not have seen each other. */
  isConcurrentWith(other: VectorClock): boolean {
    return this.compare(other) === 'CONCURRENT';
  }

  equals(other: VectorClock): boolean {
    return this.compare(other) === 'EQUAL';
  }

  toJSON(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const node of this.nodes) out[node] = this.get(node);
    return out;
  }

  toString(): string {
    return `{${this.nodes.map((n) => `${n}:${this.get(n)}`).join(', ')}}`;
  }
}

/** One recorded event in the simulation, stamped with both kinds of clock. */
export interface SimEvent {
  id: string;
  process: string;
  kind: 'local' | 'send' | 'receive';
  label: string;
  lamport: number;
  vector: VectorClock;
}

/** A message in flight: carries the sender's clocks so the receiver can merge them. */
export interface Message {
  from: string;
  to: string;
  sendEventId: string;
  lamport: number;
  vector: VectorClock;
}

interface ProcessState {
  lamport: LamportClock;
  vector: VectorClock;
}

/**
 * A deterministic message-passing simulation between processes.
 *
 * Each process keeps a Lamport clock and a vector clock. Every local, send and
 * receive event is recorded with both stamps so you can check happens-before
 * relations after the fact. Messages are delivered only when you call
 * `receive`, so delivery order (and therefore concurrency) is under your control.
 */
export class Simulation {
  private readonly processes = new Map<string, ProcessState>();
  private readonly log: SimEvent[] = [];

  constructor(processIds: readonly string[]) {
    for (const id of processIds) this.processes.set(id, { lamport: new LamportClock(), vector: new VectorClock() });
  }

  get events(): readonly SimEvent[] {
    return this.log;
  }

  event(id: string): SimEvent {
    const found = this.log.find((e) => e.id === id);
    if (!found) throw new Error(`unknown event ${id}`);
    return found;
  }

  /** A local event (for example, a write to a local replica). */
  local(processId: string, label: string): SimEvent {
    const p = this.state(processId);
    p.vector = p.vector.increment(processId);
    return this.record(processId, 'local', label, p.lamport.tick(), p.vector);
  }

  /** Records a send event and returns the message to deliver later. */
  send(from: string, to: string, label: string): Message {
    this.state(to);
    const p = this.state(from);
    p.vector = p.vector.increment(from);
    const ev = this.record(from, 'send', label, p.lamport.send(), p.vector);
    return { from, to, sendEventId: ev.id, lamport: ev.lamport, vector: ev.vector };
  }

  /** Delivers `message`: merge the sender's vector, then count the receive as a local event. */
  receive(message: Message, label = `recv from ${message.from}`): SimEvent {
    const p = this.state(message.to);
    p.vector = p.vector.merge(message.vector).increment(message.to);
    return this.record(message.to, 'receive', label, p.lamport.receive(message.lamport), p.vector);
  }

  /** Causal relation between two recorded events, from their vector stamps. */
  order(aId: string, bId: string): Ordering {
    return this.event(aId).vector.compare(this.event(bId).vector);
  }

  /** Every unordered pair of events that are concurrent. */
  concurrentPairs(): [SimEvent, SimEvent][] {
    const pairs: [SimEvent, SimEvent][] = [];
    for (let i = 0; i < this.log.length; i++) {
      for (let j = i + 1; j < this.log.length; j++) {
        if (this.log[i].vector.isConcurrentWith(this.log[j].vector)) pairs.push([this.log[i], this.log[j]]);
      }
    }
    return pairs;
  }

  private state(id: string): ProcessState {
    const p = this.processes.get(id);
    if (!p) throw new Error(`unknown process ${id}`);
    return p;
  }

  private record(process: string, kind: SimEvent['kind'], label: string, lamport: number, vector: VectorClock): SimEvent {
    const ev: SimEvent = { id: `${process}.${this.log.filter((e) => e.process === process).length + 1}`, process, kind, label, lamport, vector };
    this.log.push(ev);
    return ev;
  }
}

/**
 * The three-process scenario used by the demo and tests.
 *
 *   P1: a(local)  b(send m1 to P2)                      f(recv m3)
 *   P2:                 c(recv m1)  d(send m2 to P3)
 *   P3: e(local)                                 g(recv m2)  h(send m3 to P1)
 *
 * a -> b -> c -> d -> g -> h -> f is a causal chain; e is concurrent with
 * a, b, c and d because no message carried P3's knowledge out before h.
 */
export function threeProcessScenario(): Simulation {
  const sim = new Simulation(['P1', 'P2', 'P3']);
  sim.local('P1', 'a: write x=1');
  const m1 = sim.send('P1', 'P2', 'b: send x=1');
  sim.local('P3', 'e: write y=7');
  sim.receive(m1, 'c: recv x=1');
  const m2 = sim.send('P2', 'P3', 'd: send x=1');
  sim.receive(m2, 'g: recv x=1');
  const m3 = sim.send('P3', 'P1', 'h: send x=1,y=7');
  sim.receive(m3, 'f: recv x=1,y=7');
  return sim;
}
