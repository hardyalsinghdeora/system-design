# Geohash and quadtree

Geohash encoding (encode, decode to a bounding box, the 8 neighbours of a cell), a `ProximityIndex` that answers "k nearest within r metres" by searching one geohash cell and its neighbours, and a bucketed point quadtree with range queries. Both turn a two-dimensional "what is near me?" question into a lookup over a small set of cells instead of a scan of every point, which is the core of any proximity, ride-hailing or delivery-dispatch service.

- Concept: [`fundamentals/geospatial-indexing.md`](../../fundamentals/geospatial-indexing.md)
- Problems: [`problems/proximity-service.md`](../../problems/proximity-service.md), [`problems/ride-hailing.md`](../../problems/ride-hailing.md)
- Run: `npm run demo -- geohash` · `npx vitest run src/geohash`

```ts
encode(57.64911, 10.40744, 11);            // 'u4pruydqqvj'
decode('u4pru');                           // centre plus +-0.022 degree error box
neighbours('gbsuv').n;                     // 'gbsvj'

const index = new ProximityIndex({ precision: 7 });
index.add({ id: 'driver-1', lat: 37.7749, lon: -122.4194 });
index.nearby(37.775, -122.419, 500, 5);    // [{ id: 'driver-1', distanceM: ~37, ... }]

const tree = new QuadTree({ minX: -180, minY: -90, maxX: 180, maxY: 90 }, { capacity: 16 });
tree.insert({ id: 'shop', x: -122.42, y: 37.77 });
tree.queryRange({ minX: -123, minY: 37, maxX: -122, maxY: 38 });
```

## What the tests prove

- `encode(57.64911, 10.40744, 11) === 'u4pruydqqvj'` (the standard reference value).
- Decoding gives a box that contains the original point, and its size matches the bit count for every precision 1-12 (5 characters: +-0.022 degrees).
- Prefixes nest, so a shorter hash is always a prefix of a longer one.
- The 8 neighbours of `gbsuv` match the published values; longitude wraps at +-180 and there is no neighbour beyond a pole.
- `nearby()` returns exactly the brute-force answer on 3,000 seeded points over 60 random queries, while measuring fewer points than a full scan.
- The quadtree keeps every leaf at or below capacity and its range query equals brute force on 4,000 points (half of them clustered).

## Complexity

| Operation | Time | Space |
|---|---|---|
| `encode` / `decode` / `neighbours` | O(p) for p characters | O(1) |
| `ProximityIndex.add` / `remove` | O(p) | O(p) map entries per point |
| `ProximityIndex.nearby` | O(c log c) for c points in the 9 cells | O(c) |
| `QuadTree.insert` | O(depth) | O(1) amortised |
| `QuadTree.queryRange` | O(visited nodes + matches) | O(depth) stack |

## Production notes

- **Redis** `GEOADD` / `GEOSEARCH` store a 52-bit interleaved geohash as the score of a sorted set and search the centre cell plus neighbours, the same scheme as `nearby()` here.
- **Elasticsearch / Lucene** index `geo_point` with BKD trees (a k-d tree variant) rather than geohash prefixes, but still offer geohash grid aggregations for heat maps.
- **MongoDB** `2dsphere` indexes and Google's S2 library use S2 cells (a Hilbert curve on a cube projected onto the sphere), which avoids the large distortion of geohash cells near the poles.
- **Uber** built H3, a hexagonal grid: every neighbour is the same distance away, which suits supply/demand heat maps and surge pricing.
- Geohash cells are fixed-size; a quadtree adapts to density. Real services usually pick a cell level per query radius (as `searchPrecision` does) and keep moving objects (drivers) in an in-memory index updated every few seconds, not in the primary database.
