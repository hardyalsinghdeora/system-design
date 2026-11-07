import { describe, expect, it } from 'vitest';
import { ProximityIndex, QuadTree, cellSize, decode, encode, haversineMeters, neighbours, type QuadPoint } from './geohash';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('geohash encode/decode', () => {
  it('encodes the classic Jutland example', () => {
    expect(encode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(encode(57.64911, 10.40744, 5)).toBe('u4pru');
  });

  it('decodes to a box that contains the point, within the documented error bounds', () => {
    const cell = decode('u4pruydqqvj');
    expect(Math.abs(cell.lat - 57.64911)).toBeLessThanOrEqual(cell.latError);
    expect(Math.abs(cell.lon - 10.40744)).toBeLessThanOrEqual(cell.lonError);
    expect(decode('u4pru').latError).toBeCloseTo(0.022, 3); // 5 chars: about +-2.4 km
    expect(decode('u4pru').lonError).toBeCloseTo(0.022, 3);
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const lat = rng() * 180 - 90;
      const lon = rng() * 360 - 180;
      for (let p = 1; p <= 12; p++) {
        const d = decode(encode(lat, lon, p));
        expect(lat).toBeGreaterThanOrEqual(d.box.minLat);
        expect(lat).toBeLessThanOrEqual(d.box.maxLat);
        expect(lon).toBeGreaterThanOrEqual(d.box.minLon);
        expect(lon).toBeLessThanOrEqual(d.box.maxLon);
        expect(d.latError * 2).toBeCloseTo(cellSize(p).latDeg, 12);
        expect(d.lonError * 2).toBeCloseTo(cellSize(p).lonDeg, 12);
      }
    }
  });

  it('nests cells: a shorter geohash is a prefix of a longer one', () => {
    const full = encode(37.7749, -122.4194, 12);
    for (let p = 1; p < 12; p++) expect(full.startsWith(encode(37.7749, -122.4194, p))).toBe(true);
  });
});

describe('neighbours', () => {
  it('finds the 8 neighbours of a known cell', () => {
    expect(neighbours('gbsuv')).toEqual({
      n: 'gbsvj', ne: 'gbsvn', e: 'gbsuy', se: 'gbsuw', s: 'gbsut', sw: 'gbsus', w: 'gbsuu', nw: 'gbsvh',
    });
  });

  it('wraps at the antimeridian and stops at the poles', () => {
    expect(neighbours(encode(0, 179.99, 5)).e).toBe(encode(0, -179.99, 5));
    expect(neighbours(encode(0, -179.99, 5)).w).toBe(encode(0, 179.99, 5));
    const top = neighbours(encode(89.99, 0, 4));
    expect(top.n).toBeUndefined();
    expect(top.s).toBeDefined();
  });
});

describe('ProximityIndex', () => {
  const rng = mulberry32(42);
  const points = Array.from({ length: 3000 }, (_, i) => ({
    id: `p${i}`,
    lat: 37.6 + rng() * 0.3,
    lon: -122.6 + rng() * 0.4,
  }));

  it('returns exactly what a brute-force scan returns', () => {
    const index = new ProximityIndex({ precision: 7 });
    for (const p of points) index.add(p);
    let measured = 0;
    for (let i = 0; i < 60; i++) {
      const lat = 37.6 + rng() * 0.3;
      const lon = -122.6 + rng() * 0.4;
      const radius = 100 + rng() * 2000;
      const k = 1 + Math.floor(rng() * 15);
      const expected = points
        .map((p) => ({ ...p, distanceM: haversineMeters(lat, lon, p.lat, p.lon) }))
        .filter((p) => p.distanceM <= radius)
        .sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : 1))
        .slice(0, k)
        .map((p) => p.id);
      expect(index.nearby(lat, lon, radius, k).map((r) => r.id)).toEqual(expected);
      measured += index.lastCandidates;
    }
    expect(measured).toBeLessThan(60 * points.length * 0.25); // the 9-cell search prunes most points
  });

  it('handles moves and removals', () => {
    const index = new ProximityIndex({ precision: 6 });
    index.add({ id: 'cab', lat: 37.7749, lon: -122.4194 });
    expect(index.nearby(37.7749, -122.4194, 100).map((r) => r.id)).toEqual(['cab']);
    index.add({ id: 'cab', lat: 37.8044, lon: -122.2712 }); // drove to Oakland
    expect(index.nearby(37.7749, -122.4194, 100)).toEqual([]);
    expect(index.size).toBe(1);
    expect(index.remove('cab')).toBe(true);
    expect(index.nearby(37.8044, -122.2712, 100)).toEqual([]);
  });
});

describe('QuadTree', () => {
  it('splits full nodes and answers range queries exactly like brute force', () => {
    const rng = mulberry32(3);
    const tree = new QuadTree({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, { capacity: 8 });
    const pts: QuadPoint[] = [];
    for (let i = 0; i < 4000; i++) {
      // half the points in a dense "downtown" corner
      const dense = i % 2 === 0;
      const p = { id: `q${i}`, x: dense ? rng() * 100 : rng() * 1000, y: dense ? rng() * 100 : rng() * 1000 };
      pts.push(p);
      expect(tree.insert(p)).toBe(true);
    }
    expect(tree.insert({ id: 'out', x: 2000, y: 5 })).toBe(false);
    const stats = tree.stats();
    expect(tree.size).toBe(4000);
    expect(stats.maxLeafPoints).toBeLessThanOrEqual(8);
    expect(stats.leaves).toBeGreaterThan(4000 / 8);
    for (let i = 0; i < 100; i++) {
      const x = rng() * 1000, y = rng() * 1000;
      const rect = { minX: x, minY: y, maxX: x + rng() * 200, maxY: y + rng() * 200 };
      const expected = pts.filter((p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY);
      expect(tree.queryRange(rect).map((p) => p.id).sort()).toEqual(expected.map((p) => p.id).sort());
    }
  });
});
