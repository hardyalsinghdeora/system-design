import { ProximityIndex, QuadTree, cellSizeMeters, encode, neighbours } from './geohash';

let seed = 2024;
const rng = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const rider = { lat: 37.7749, lon: -122.4194 }; // San Francisco
console.log('\nGeohash of a rider in San Francisco at increasing precision\n');
for (const p of [4, 5, 6, 7]) {
  const { heightM, widthM } = cellSizeMeters(p, rider.lat);
  console.log(`  precision ${p}: ${encode(rider.lat, rider.lon, p).padEnd(8)} cell ~${(widthM / 1000).toFixed(2)} x ${(heightM / 1000).toFixed(2)} km`);
}
const cell = encode(rider.lat, rider.lon, 6);
console.log(`\nNeighbours of ${cell}:`, Object.values(neighbours(cell)).join(' '));

const index = new ProximityIndex({ precision: 7 });
const tree = new QuadTree({ minX: -122.6, minY: 37.6, maxX: -122.2, maxY: 37.9 }, { capacity: 16 });
for (let i = 0; i < 20_000; i++) {
  const downtown = i % 3 === 0;
  const lat = downtown ? 37.77 + rng() * 0.02 : 37.6 + rng() * 0.3;
  const lon = downtown ? -122.43 + rng() * 0.03 : -122.6 + rng() * 0.4;
  index.add({ id: `driver-${i}`, lat, lon });
  tree.insert({ id: `driver-${i}`, x: lon, y: lat });
}

const nearest = index.nearby(rider.lat, rider.lon, 500, 5);
console.log(`\n5 nearest of ${index.size} drivers within 500 m (prefix length ${index.searchPrecision(rider.lat, 500)}):`);
for (const d of nearest) console.log(`  ${d.id.padEnd(13)} ${d.distanceM.toFixed(0).padStart(4)} m`);
console.log(`Measured ${index.lastCandidates} candidates from 9 cells instead of ${index.size}.`);

const s = tree.stats();
console.log(`\nQuadtree (capacity 16): ${s.nodes} nodes, ${s.leaves} leaves, depth ${s.depth}; dense areas split deeper.`);
const box = { minX: rider.lon - 0.005, minY: rider.lat - 0.005, maxX: rider.lon + 0.005, maxY: rider.lat + 0.005 };
const inBox = tree.queryRange(box);
console.log(`Range query around the rider: ${inBox.length} drivers, ${tree.lastVisited} of ${s.nodes} nodes visited.\n`);
