import { createHash, randomUUID } from 'node:crypto';

/** The parts of a POST request that define "the same request". */
export interface IdempotentRequest {
  method: string;
  path: string;
  body?: unknown;
}

/** What the API sends back, and what gets stored for replays. */
export interface StoredResponse {
  status: number;
  body: unknown;
}

export type RecordState = 'IN_PROGRESS' | 'COMPLETED';

export interface IdempotencyRecord {
  key: string;
  state: RecordState;
  /** sha256 of method, path and canonical body: detects a key reused for a different request. */
  fingerprint: string;
  /** Identifies the worker holding the lock; compare-and-set on it fences out a stale worker. */
  ownerToken: string;
  createdAt: number;
  /** After this the record is gone and the key can be used again (e.g. 24 h). */
  expiresAt: number;
  /** IN_PROGRESS only: after this the worker is presumed dead and another may take over. */
  leaseExpiresAt: number;
  response?: StoredResponse;
}

/**
 * Storage contract. Each method must be atomic in the real backing store:
 * insertIfAbsent is Redis `SET key value NX PX ttl` or a SQL insert against a
 * unique key; replaceIfOwner and deleteIfOwner are conditional writes on
 * ownerToken (a Lua script, a DynamoDB condition expression, `UPDATE ... WHERE owner = ?`).
 */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  insertIfAbsent(record: IdempotencyRecord): Promise<boolean>;
  replaceIfOwner(key: string, expectedOwner: string, next: IdempotencyRecord): Promise<boolean>;
  deleteIfOwner(key: string, expectedOwner: string): Promise<boolean>;
}

/** Single-process store; expired records vanish on read, by the injected clock. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(private readonly clock: () => number = Date.now) {}

  get size(): number {
    return this.records.size;
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const record = this.live(key);
    return record ? { ...record } : undefined;
  }

  async insertIfAbsent(record: IdempotencyRecord): Promise<boolean> {
    if (this.live(record.key)) return false;
    this.records.set(record.key, { ...record });
    return true;
  }

  async replaceIfOwner(key: string, expectedOwner: string, next: IdempotencyRecord): Promise<boolean> {
    const current = this.live(key);
    if (!current || current.ownerToken !== expectedOwner) return false;
    this.records.set(key, { ...next });
    return true;
  }

  async deleteIfOwner(key: string, expectedOwner: string): Promise<boolean> {
    const current = this.live(key);
    if (!current || current.ownerToken !== expectedOwner) return false;
    this.records.delete(key);
    return true;
  }

  private live(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (record && record.expiresAt <= this.clock()) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }
}

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` fingerprint the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Hash of method, path and canonical body. */
export function fingerprint(request: IdempotentRequest): string {
  return createHash('sha256')
    .update(`${request.method.toUpperCase()}\n${request.path}\n${canonicalJson(request.body)}`)
    .digest('hex');
}

/**
 * Thrown by a handler to say how a failure should be remembered. Retryable
 * means "nothing was committed, try again" (e.g. the card network timed out
 * before the charge); non-retryable means "this is the final answer" (e.g.
 * card declined) and the same response is replayed forever.
 */
export class HandlerError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'HandlerError';
  }
}

export type IdempotencyOutcome =
  | 'executed'
  | 'taken-over'
  | 'replayed'
  | 'conflict'
  | 'payload-mismatch'
  | 'retryable-failure'
  | 'stored-failure';

export interface IdempotentResult extends StoredResponse {
  /** True when the response came from the store and the handler did not run. */
  replayed: boolean;
  outcome: IdempotencyOutcome;
  /** False when this worker's lease was lost before it could save its result (it was fenced out). */
  recorded: boolean;
}

export interface IdempotencyOptions {
  store: IdempotencyStore;
  clock?: () => number;
  /** How long a key is remembered. Stripe uses 24 hours. */
  ttlMs?: number;
  /** Lock lease for IN_PROGRESS; must exceed the handler's worst-case duration. */
  leaseMs?: number;
  newToken?: () => string;
  /** Decides whether a thrown error may be retried with the same key. */
  isRetryable?: (error: unknown) => boolean;
}

const defaultIsRetryable = (error: unknown): boolean => (error instanceof HandlerError ? error.retryable : true);

/**
 * Makes a non-idempotent POST safe to retry. The first request with a key
 * claims it (IN_PROGRESS), runs the handler and stores the response
 * (COMPLETED). Later requests with that key get the stored response replayed
 * (no second charge), 409 while the first is still running, or 422 if the
 * key is reused with a different payload. A record whose lease ran out
 * belongs to a crashed worker and may be taken over.
 */
export class Idempotency {
  private readonly store: IdempotencyStore;
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly leaseMs: number;
  private readonly newToken: () => string;
  private readonly isRetryable: (error: unknown) => boolean;

  constructor(options: IdempotencyOptions) {
    this.store = options.store;
    this.clock = options.clock ?? Date.now;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.newToken = options.newToken ?? randomUUID;
    this.isRetryable = options.isRetryable ?? defaultIsRetryable;
  }

  async withIdempotency(
    key: string,
    request: IdempotentRequest,
    handler: () => Promise<StoredResponse>,
  ): Promise<IdempotentResult> {
    const fp = fingerprint(request);
    // A lost race (someone inserted or took over between our read and write) just means: read again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const now = this.clock();
      const existing = await this.store.get(key);
      if (!existing) {
        const claim = this.claim(key, fp, now);
        if (await this.store.insertIfAbsent(claim)) return this.execute(claim, handler, 'executed');
        continue;
      }
      if (existing.fingerprint !== fp) {
        return this.reply(422, 'Idempotency-Key was already used with a different request', 'payload-mismatch');
      }
      if (existing.state === 'COMPLETED' && existing.response) {
        return { ...existing.response, replayed: true, outcome: 'replayed', recorded: true };
      }
      if (existing.leaseExpiresAt > now) {
        return this.reply(409, 'A request with this Idempotency-Key is still in progress', 'conflict');
      }
      const takeover = { ...this.claim(key, fp, now), createdAt: existing.createdAt };
      if (await this.store.replaceIfOwner(key, existing.ownerToken, takeover)) {
        return this.execute(takeover, handler, 'taken-over');
      }
    }
    return this.reply(409, 'Idempotency-Key is under contention', 'conflict');
  }

  private claim(key: string, fp: string, now: number): IdempotencyRecord {
    return {
      key,
      state: 'IN_PROGRESS',
      fingerprint: fp,
      ownerToken: this.newToken(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      leaseExpiresAt: now + this.leaseMs,
    };
  }

  private async execute(
    claim: IdempotencyRecord,
    handler: () => Promise<StoredResponse>,
    outcome: 'executed' | 'taken-over',
  ): Promise<IdempotentResult> {
    let response: StoredResponse;
    let finalOutcome: IdempotencyOutcome = outcome;
    try {
      response = await handler();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof HandlerError ? error.status : 500;
      if (this.isRetryable(error)) {
        // Release the key so the client's retry runs the handler again.
        await this.store.deleteIfOwner(claim.key, claim.ownerToken);
        return { status: status >= 500 ? status : 503, body: { error: message }, replayed: false, outcome: 'retryable-failure', recorded: false };
      }
      response = { status, body: { error: message } };
      finalOutcome = 'stored-failure';
    }
    const done: IdempotencyRecord = {
      ...claim,
      state: 'COMPLETED',
      response,
      expiresAt: this.clock() + this.ttlMs,
      leaseExpiresAt: 0,
    };
    const recorded = await this.store.replaceIfOwner(claim.key, claim.ownerToken, done);
    return { ...response, replayed: false, outcome: finalOutcome, recorded };
  }

  private reply(status: number, error: string, outcome: IdempotencyOutcome): IdempotentResult {
    return { status, body: { error }, replayed: false, outcome, recorded: false };
  }
}
