import { beforeEach, describe, expect, it } from 'vitest';
import { CoordinationStore, FencedStorage, LeaderElector, LeaseLock } from './lease-lock';

let now = 0;
const clock = () => now;
let store: CoordinationStore;
let lock: LeaseLock;

beforeEach(() => {
  now = 0;
  store = new CoordinationStore(clock);
  lock = new LeaseLock(store, clock);
});

describe('CoordinationStore', () => {
  it('compare-and-set succeeds only on the expected revision, and revisions only grow', () => {
    const a = store.compareAndSet('k', 0, 'v1');
    expect(a?.modRevision).toBe(1);
    expect(store.compareAndSet('k', 0, 'v2')).toBeUndefined();
    const b = store.compareAndSet('k', 1, 'v2');
    expect(b?.modRevision).toBe(2);
    expect(b?.createRevision).toBe(1);
    store.compareAndSet('other', 0, 'x');
    expect(store.revision).toBe(3);
  });
});

describe('LeaseLock', () => {
  it('gives mutual exclusion while the lease is valid', () => {
    const a = lock.acquire('job-42', 'A', 1000);
    expect(a).toBeDefined();
    now = 999;
    expect(lock.acquire('job-42', 'B', 1000)).toBeUndefined();
    expect(lock.holder('job-42')?.owner).toBe('A');
  });

  it('lets another client take over after expiry, with a larger fencing token', () => {
    const a = lock.acquire('job-42', 'A', 1000)!;
    now = 1000;
    const b = lock.acquire('job-42', 'B', 1000)!;
    expect(b.owner).toBe('B');
    expect(b.token).toBeGreaterThan(a.token);
    expect(lock.renew(a, 1000)).toBeUndefined();
  });

  it('renew extends the lease and keeps the same token', () => {
    const a = lock.acquire('job-42', 'A', 1000)!;
    now = 800;
    const renewed = lock.renew(a, 1000)!;
    expect(renewed.token).toBe(a.token);
    expect(renewed.expiresAt).toBe(1800);
    now = 1500;
    expect(lock.acquire('job-42', 'B', 1000)).toBeUndefined();
  });

  it('only the owner can release', () => {
    const a = lock.acquire('job-42', 'A', 1000)!;
    expect(lock.release({ ...a, owner: 'B' })).toBe(false);
    expect(lock.release({ ...a, token: a.token + 1 })).toBe(false);
    expect(lock.holder('job-42')?.owner).toBe('A');
    expect(lock.release(a)).toBe(true);
    expect(lock.acquire('job-42', 'B', 1000)?.owner).toBe('B');
  });

  it('a released lease cannot be released again by its stale holder after takeover', () => {
    const a = lock.acquire('job-42', 'A', 1000)!;
    now = 2000;
    lock.acquire('job-42', 'B', 1000);
    expect(lock.release(a)).toBe(false);
    expect(lock.holder('job-42')?.owner).toBe('B');
  });
});

describe('fencing', () => {
  it('rejects the write of a client whose lease expired during a pause', () => {
    const storage = new FencedStorage();
    const a = lock.acquire('report', 'A', 1000)!;
    expect(storage.write('report', 'A: part 1', a.token).ok).toBe(true);
    now = 5000; // A pauses (GC) for 5 s; its lease ends at 1000
    const b = lock.acquire('report', 'B', 1000)!;
    expect(storage.write('report', 'B: full report', b.token).ok).toBe(true);
    const late = storage.write('report', 'A: part 2', a.token); // A wakes up, still thinks it holds the lock
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/stale fencing token/);
    expect(storage.read('report')).toBe('B: full report');
    expect(storage.rejectedWrites).toEqual([{ key: 'report', token: a.token }]);
  });
});

describe('LeaderElector', () => {
  it('fails over when the leader stops renewing, and supports resign', () => {
    const n1 = new LeaderElector(lock, 'scheduler', 'node-1', 3000);
    const n2 = new LeaderElector(lock, 'scheduler', 'node-2', 3000);
    expect(n1.campaign()).toBe(true);
    expect(n2.campaign()).toBe(false);
    now = 2000;
    expect(n1.campaign()).toBe(true); // renew
    now = 4500;
    expect(n2.campaign()).toBe(false); // n1's renewed lease runs to 5000
    const term1 = n1.term!;
    now = 5000; // n1 crashed after its last renewal
    expect(n2.campaign()).toBe(true);
    expect(n1.isLeader()).toBe(false);
    expect(LeaderElector.currentLeader(lock, 'scheduler')).toEqual({ id: 'node-2', term: n2.term });
    expect(n2.term!).toBeGreaterThan(term1);
    expect(n2.resign()).toBe(true);
    expect(n1.campaign()).toBe(true);
    expect(LeaderElector.currentLeader(lock, 'scheduler')?.id).toBe('node-1');
  });
});
