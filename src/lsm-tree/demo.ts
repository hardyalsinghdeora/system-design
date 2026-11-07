import { LSMTree } from './lsm-tree';

const key = (i: number) => `user:${String(i).padStart(5, '0')}`;
const tables = (db: LSMTree) => db.sstableInfo().map((t) => `#${t.id}(${t.entries}${t.tombstones ? `, ${t.tombstones} tomb` : ''})`).join(' ');

console.log('\nWriting 1,000 keys with a 100-key memtable (size-tiered compaction, threshold 4)\n');
let db = new LSMTree({ memtableLimit: 100, compactionThreshold: 4 });
for (let i = 0; i < 1000; i++) db.put(key(i), `profile-v1-${i}`);
for (let i = 0; i < 50; i++) db.put(key(i), `profile-v2-${i}`);
for (let i = 900; i < 920; i++) db.delete(key(i));
console.log(`flushes=${db.stats.flushes} compactions=${db.stats.compactions} memtable=${db.memtableSize} keys`);
console.log(`SSTables (oldest first): ${tables(db)}`);
console.log(`WAL holds ${db.disk.wal.records.length} records not yet in an SSTable`);

console.log('\nCrash: the memtable is lost; reopen from the WAL and SSTables');
db = new LSMTree({ disk: db.disk, memtableLimit: 100, compactionThreshold: 4 });
console.log(`recovered memtable=${db.memtableSize} keys; ${key(10)} -> ${db.get(key(10))}; ${key(905)} -> ${db.get(key(905))}`);

console.log('\nLooking up 1,000 keys that do not exist:');
for (let i = 0; i < 1000; i++) db.get(`${key(i)}-missing`);
console.log(`SSTables searched: ${db.stats.sstablesProbed}; skipped by range or Bloom filter: ${db.stats.sstablesSkipped}`);
const rebuilt = new LSMTree({ memtableLimit: 100, bloomBitsPerKey: 0, compactionThreshold: 4 });
for (const [k, v] of db.scan()) rebuilt.put(k, v);
rebuilt.flush();
for (let i = 0; i < 1000; i++) rebuilt.get(`${key(i)}-missing`);
console.log(`same data without Bloom filters: ${rebuilt.stats.sstablesProbed} SSTables searched`);

console.log('\nMajor compaction');
db.flush();
db.compact();
console.log(`SSTables: ${tables(db)}; versions and tombstones dropped so far: ${db.stats.entriesDropped}`);

console.log('\nRange scan [user:00895, user:00925):');
const rows = [...db.scan(key(895), key(925))];
console.log(`${rows.length} live keys: ${rows.slice(0, 6).map(([k]) => k).join(', ')}, ... (900-919 were deleted)\n`);
