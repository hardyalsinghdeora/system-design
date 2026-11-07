import { InvertedIndex } from './inverted-index';

const index = new InvertedIndex();
const docs: [string, string][] = [
  ['post-1', 'How to scale PostgreSQL reads with replicas'],
  ['post-2', 'Scaling writes: sharding PostgreSQL by tenant'],
  ['post-3', 'Redis as a cache in front of PostgreSQL'],
  ['post-4', 'A long guide to caching: cache aside, write through, write behind, and how every cache layer adds staleness to reads'],
  ['post-5', 'Read replicas and replication lag explained'],
];
for (const [id, text] of docs) index.add(id, text);

console.log(`\nIndexed ${index.documentCount} posts, ${index.termCount} distinct terms, average length ${index.averageLength.toFixed(1)} terms\n`);

const postings = index.postingsFor('postgresql').map((p) => `doc${p.doc}@${p.positions.join(',')}`);
console.log(`postings("postgresql") = [${postings.join(' ')}]`);
console.log(`AND  "postgresql replicas" -> ${index.and('postgresql replicas').join(', ')}`);
console.log(`OR   "redis sharding"      -> ${index.or('redis sharding').join(', ')}`);
console.log(`PHRASE "read replicas"     -> ${index.phrase('read replicas').join(', ')}`);
console.log(`PHRASE "cache in front of" -> ${index.phrase('cache in front of').join(', ')}`);

console.log('\nBM25 for "cache postgresql" (k1=1.2, b=0.75):');
for (const hit of index.search('cache postgresql')) console.log(`  ${hit.id}  ${hit.score.toFixed(3)}`);
console.log('post-3 matches both terms; post-4 says "cache" twice but is long, so it is discounted.');

index.remove('post-3');
console.log('\nAfter deleting post-3:');
for (const hit of index.search('cache postgresql')) console.log(`  ${hit.id}  ${hit.score.toFixed(3)}`);
console.log();
