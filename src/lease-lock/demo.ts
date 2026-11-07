import { CoordinationStore, FencedStorage, LeaderElector, LeaseLock } from './lease-lock';

let now = 0;
const clock = () => now;
const store = new CoordinationStore(clock);
const lock = new LeaseLock(store, clock);
const storage = new FencedStorage();
const log = (msg: string) => console.log(`t=${String(now).padStart(5)}ms  ${msg}`);

console.log('\nThe process-pause problem, and how fencing tokens fix it\n');

const a = lock.acquire('invoice-run', 'worker-A', 1000)!;
log(`worker-A acquires the lock, lease until ${a.expiresAt}, fencing token ${a.token}`);
log(`worker-A writes batch 1: ${storage.write('invoices', 'batch-1 by A', a.token).ok ? 'accepted' : 'rejected'}`);
log('worker-A enters a 4 s GC pause...');
now = 4000;
log(`lock holder is now: ${lock.holder('invoice-run')?.owner ?? 'nobody (lease expired)'}`);
const b = lock.acquire('invoice-run', 'worker-B', 1000)!;
log(`worker-B acquires the lock, fencing token ${b.token}`);
log(`worker-B writes batch 1: ${storage.write('invoices', 'batch-1 by B', b.token).ok ? 'accepted' : 'rejected'}`);
now = 4100;
const late = storage.write('invoices', 'batch-2 by A', a.token);
log(`worker-A wakes and writes batch 2: ${late.ok ? 'accepted' : `rejected (${late.reason})`}`);
log(`worker-A tries to renew: ${lock.renew(a, 1000) ? 'ok' : 'refused, it must stop working'}`);
log(`storage holds: "${storage.read('invoices')}"`);

console.log('\nLeader election on the same lease mechanism\n');
const nodes = ['node-1', 'node-2', 'node-3'].map((id) => new LeaderElector(lock, 'scheduler', id, 3000));
now = 10_000;
for (const n of nodes) log(`${n.candidate} campaigns: ${n.campaign() ? 'LEADER' : 'follower'}`);
now = 12_000;
nodes[0].campaign();
log('node-1 renews its lease');
now = 15_500;
log('node-1 crashed at t=12000; its lease ran out at 15000');
for (const n of nodes.slice(1)) log(`${n.candidate} campaigns: ${n.campaign() ? 'LEADER' : 'follower'}`);
const leader = LeaderElector.currentLeader(lock, 'scheduler')!;
log(`current leader ${leader.id}, term (fencing token) ${leader.term}\n`);
