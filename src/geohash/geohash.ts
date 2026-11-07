const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const DECODE = new Map<string, number>([...BASE32].map((c, i) => [c, i]));
const TO_RAD = Math.PI / 180;

/** Mean Earth radius used by every distance in this module. */
export const EARTH_RADIUS_M = 6_371_000;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface DecodedCell {
  /** Centre of the cell. */
  lat: number;
  lon: number;
  /** Half the cell height/width: the centre is within this of any point that encodes to the cell. */
  latError: number;
  lonError: number;
  box: BoundingBox;
}

/**
 * Encodes a point as a base32 geohash. Each bit halves the remaining range,
 * alternating longitude and latitude, so nearby points share long prefixes:
 * a prefix *is* a rectangular cell, which lets an ordinary string index
 * (B-tree, sorted set, hash map) answer spatial queries.
 */
export function encode(lat: number, lon: number, precision = 12): string {
  if (!(lat >= -90 && lat <= 90)) throw new RangeError(`latitude out of range: ${lat}`);
  if (!(lon >= -180 && lon <= 180)) throw new RangeError(`longitude out of range: ${lon}`);
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) throw new RangeError('precision must be 1..12');
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let out = '';
  let ch = 0;
  let bit = 0;
  let evenBit = true; // even bits are longitude
  while (out.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) { ch = ch * 2 + 1; lonMin = mid; } else { ch *= 2; lonMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = ch * 2 + 1; latMin = mid; } else { ch *= 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

/** The rectangle a geohash names. */
export function decodeBox(hash: string): BoundingBox {
  if (hash.length === 0) throw new RangeError('empty geohash');
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let evenBit = true;
  for (const c of hash.toLowerCase()) {
    const value = DECODE.get(c);
    if (value === undefined) throw new RangeError(`invalid geohash character: ${c}`);
    for (let i = 4; i >= 0; i--) {
      const set = ((value >> i) & 1) === 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (set) lonMin = mid; else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (set) latMin = mid; else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { minLat: latMin, maxLat: latMax, minLon: lonMin, maxLon: lonMax };
}

/** Centre and error bounds of a geohash cell. */
export function decode(hash: string): DecodedCell {
  const box = decodeBox(hash);
  return {
    lat: (box.minLat + box.maxLat) / 2,
    lon: (box.minLon + box.maxLon) / 2,
    latError: (box.maxLat - box.minLat) / 2,
    lonError: (box.maxLon - box.minLon) / 2,
    box,
  };
}

/** Height and width in degrees of every cell at `precision` (5 bits per character, longitude gets the odd bit). */
export function cellSize(precision: number): { latDeg: number; lonDeg: number } {
  const bits = precision * 5;
  return { latDeg: 180 / 2 ** Math.floor(bits / 2), lonDeg: 360 / 2 ** Math.ceil(bits / 2) };
}

/** Cell height and width in metres at a given latitude; width shrinks with cos(lat). */
export function cellSizeMeters(precision: number, lat: number): { heightM: number; widthM: number } {
  const { latDeg, lonDeg } = cellSize(precision);
  return {
    heightM: latDeg * TO_RAD * EARTH_RADIUS_M,
    widthM: lonDeg * TO_RAD * EARTH_RADIUS_M * Math.cos(lat * TO_RAD),
  };
}

export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const OFFSETS: [Direction, number, number][] = [
  ['n', 1, 0], ['ne', 1, 1], ['e', 0, 1], ['se', -1, 1],
  ['s', -1, 0], ['sw', -1, -1], ['w', 0, -1], ['nw', 1, -1],
];

const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * The eight cells around `hash` at the same precision. Needed because two
 * points a metre apart can sit on either side of a cell edge and share no
 * prefix at all; searching the 3x3 block removes that edge effect. Longitude
 * wraps at the antimeridian; there is no cell beyond a pole (undefined).
 */
export function neighbours(hash: string): Record<Direction, string | undefined> {
  const cell = decode(hash);
  const latSpan = cell.latError * 2;
  const lonSpan = cell.lonError * 2;
  const result = {} as Record<Direction, string | undefined>;
  for (const [dir, dLat, dLon] of OFFSETS) {
    const lat = cell.lat + dLat * latSpan;
    result[dir] = lat > 90 || lat < -90 ? undefined : encode(lat, wrapLon(cell.lon + dLon * lonSpan), hash.length);
  }
  return result;
}

/** Great-circle distance on a sphere of radius EARTH_RADIUS_M. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface GeoPoint {
  id: string;
  lat: number;
  lon: number;
}

export interface NearbyResult extends GeoPoint {
  distanceM: number;
}

const byDistanceThenId = (a: NearbyResult, b: NearbyResult): number =>
  a.distanceM - b.distanceM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Buckets points by every geohash prefix up to `precision` and answers
 * "k nearest within r metres" the way a proximity service does: pick the
 * finest prefix length whose cell is at least as large as the search circle,
 * fetch that cell plus its 8 neighbours, then filter and sort by exact
 * haversine distance. Only those 9 buckets are examined, not the whole set.
 */
export class ProximityIndex {
  private readonly precision: number;
  private readonly points = new Map<string, GeoPoint & { hash: string }>();
  /** levels[q] maps a q-character prefix to the ids inside that cell. */
  private readonly levels: Map<string, Set<string>>[] = [];
  /** How many points the last nearby() call measured (for showing the pruning). */
  lastCandidates = 0;

  constructor(options: { precision?: number } = {}) {
    this.precision = options.precision ?? 7;
    if (!Number.isInteger(this.precision) || this.precision < 1 || this.precision > 12) {
      throw new RangeError('precision must be 1..12');
    }
    for (let q = 0; q <= this.precision; q++) this.levels.push(new Map());
  }

  get size(): number {
    return this.points.size;
  }

  /** Adds or moves a point (a driver location update is a remove plus an add). */
  add(point: GeoPoint): void {
    this.remove(point.id);
    const hash = encode(point.lat, point.lon, this.precision);
    this.points.set(point.id, { ...point, hash });
    for (let q = 1; q <= this.precision; q++) {
      const prefix = hash.slice(0, q);
      let ids = this.levels[q].get(prefix);
      if (!ids) this.levels[q].set(prefix, (ids = new Set()));
      ids.add(point.id);
    }
  }

  remove(id: string): boolean {
    const existing = this.points.get(id);
    if (!existing) return false;
    this.points.delete(id);
    for (let q = 1; q <= this.precision; q++) {
      const prefix = existing.hash.slice(0, q);
      const ids = this.levels[q].get(prefix);
      ids?.delete(id);
      if (ids && ids.size === 0) this.levels[q].delete(prefix);
    }
    return true;
  }

  /**
   * Finest prefix length whose cell is at least as tall and wide as the
   * search circle around `lat`, so the 3x3 block is guaranteed to cover it.
   * 0 means no prefix is large enough (huge radius or near a pole): scan all.
   */
  searchPrecision(lat: number, radiusM: number): number {
    const angular = radiusM / EARTH_RADIUS_M;
    const dLatDeg = angular / TO_RAD;
    const sinR = Math.sin(Math.min(angular, Math.PI / 2));
    const cosLat = Math.cos(lat * TO_RAD);
    // Widest longitude extent of a spherical cap of angular radius r centred at lat.
    const dLonDeg = sinR >= cosLat ? 360 : Math.asin(sinR / cosLat) / TO_RAD;
    for (let q = this.precision; q >= 1; q--) {
      const { latDeg, lonDeg } = cellSize(q);
      if (latDeg >= dLatDeg && lonDeg >= dLonDeg) return q;
    }
    return 0;
  }

  /** Up to k points within radiusM of (lat, lon), nearest first (ties by id). */
  nearby(lat: number, lon: number, radiusM: number, k = 10): NearbyResult[] {
    const q = this.searchPrecision(lat, radiusM);
    let candidates: Iterable<string>;
    if (q === 0) {
      candidates = this.points.keys();
    } else {
      const centre = encode(lat, lon, q);
      const cells = new Set([centre, ...Object.values(neighbours(centre))].filter((c): c is string => c !== undefined));
      const ids: string[] = [];
      for (const cell of cells) for (const id of this.levels[q].get(cell) ?? []) ids.push(id);
      candidates = ids;
    }
    const hits: NearbyResult[] = [];
    let measured = 0;
    for (const id of candidates) {
      const p = this.points.get(id);
      if (!p) continue;
      measured++;
      const distanceM = haversineMeters(lat, lon, p.lat, p.lon);
      if (distanceM <= radiusM) hits.push({ id: p.id, lat: p.lat, lon: p.lon, distanceM });
    }
    this.lastCandidates = measured;
    return hits.sort(byDistanceThenId).slice(0, k);
  }
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface QuadPoint {
  id: string;
  x: number;
  y: number;
}

interface QuadNode {
  bounds: Rect;
  depth: number;
  points: QuadPoint[];
  /** [SW, SE, NW, NE], or null for a leaf. */
  children: QuadNode[] | null;
}

const contains = (r: Rect, p: QuadPoint): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
const intersects = (a: Rect, b: Rect): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * A point quadtree with bucket capacity: a leaf holds up to `capacity`
 * points and splits into four quadrants when it overflows. Dense areas
 * (downtown) get deep, small cells; sparse areas (ocean) stay one big leaf.
 * This adaptivity is what fixed-size geohash cells lack.
 */
export class QuadTree {
  private readonly root: QuadNode;
  private readonly capacity: number;
  private readonly maxDepth: number;
  private count = 0;
  /** Nodes touched by the last queryRange() call. */
  lastVisited = 0;

  constructor(bounds: Rect, options: { capacity?: number; maxDepth?: number } = {}) {
    this.capacity = options.capacity ?? 8;
    this.maxDepth = options.maxDepth ?? 20;
    if (this.capacity < 1) throw new RangeError('capacity must be >= 1');
    this.root = { bounds, depth: 0, points: [], children: null };
  }

  get size(): number {
    return this.count;
  }

  /** Inserts a point; returns false if it lies outside the tree's bounds. */
  insert(point: QuadPoint): boolean {
    if (!contains(this.root.bounds, point)) return false;
    let node = this.root;
    while (node.children) node = this.childFor(node, point);
    node.points.push(point);
    this.count++;
    if (node.points.length > this.capacity && node.depth < this.maxDepth) this.split(node);
    return true;
  }

  /** All points inside `rect` (edges inclusive). Skips every subtree whose bounds miss the rectangle. */
  queryRange(rect: Rect): QuadPoint[] {
    const out: QuadPoint[] = [];
    const stack = [this.root];
    this.lastVisited = 0;
    while (stack.length > 0) {
      const node = stack.pop() as QuadNode;
      this.lastVisited++;
      if (!intersects(node.bounds, rect)) continue;
      if (node.children) stack.push(...node.children);
      else for (const p of node.points) if (contains(rect, p)) out.push(p);
    }
    return out;
  }

  stats(): { nodes: number; leaves: number; depth: number; maxLeafPoints: number } {
    let nodes = 0, leaves = 0, depth = 0, maxLeafPoints = 0;
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop() as QuadNode;
      nodes++;
      depth = Math.max(depth, node.depth);
      if (node.children) stack.push(...node.children);
      else {
        leaves++;
        maxLeafPoints = Math.max(maxLeafPoints, node.points.length);
      }
    }
    return { nodes, leaves, depth, maxLeafPoints };
  }

  private childFor(node: QuadNode, p: QuadPoint): QuadNode {
    const { minX, minY, maxX, maxY } = node.bounds;
    const index = (p.x >= (minX + maxX) / 2 ? 1 : 0) + (p.y >= (minY + maxY) / 2 ? 2 : 0);
    return (node.children as QuadNode[])[index];
  }

  private split(node: QuadNode): void {
    const { minX, minY, maxX, maxY } = node.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const depth = node.depth + 1;
    const make = (b: Rect): QuadNode => ({ bounds: b, depth, points: [], children: null });
    node.children = [
      make({ minX, minY, maxX: midX, maxY: midY }),
      make({ minX: midX, minY, maxX, maxY: midY }),
      make({ minX, minY: midY, maxX: midX, maxY }),
      make({ minX: midX, minY: midY, maxX, maxY }),
    ];
    for (const p of node.points) this.childFor(node, p).points.push(p);
    node.points = [];
    for (const child of node.children) {
      if (child.points.length > this.capacity && child.depth < this.maxDepth) this.split(child);
    }
  }
}
