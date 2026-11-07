# Consistent hash ring

A consistent hash ring with virtual nodes, binary-search lookup and `getNodes(key, n)` for replication preference lists.

- Concept: [`fundamentals/consistent-hashing.md`](../../fundamentals/consistent-hashing.md)
- Run: `npm run demo -- consistent-hash-ring` · `npx vitest run src/consistent-hash-ring`

```ts
const ring = new ConsistentHashRing({ virtualNodes: 150 });
ring.addNode('cache-1');
ring.addNode('cache-2');
ring.getNode('user:42');          // 'cache-2'
ring.getNodes('user:42', 2);      // ['cache-2', 'cache-1']  replica set
ring.removeNode('cache-1');       // only cache-1's keys move
```

The tests check the two properties that matter: load is within ±15 % of uniform with vnodes, and adding one node to four moves about one fifth of the keys and nothing else.
