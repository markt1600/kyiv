import { clamp, fbm, lerp, mulberry32, smooth, vnoise } from './util';

export const CELL = 8; // world units per pathing / building cell
export const VS = 4;   // heightmap vertex spacing

export interface Spot { id: number; x: number; z: number; cx: number; cz: number; rich: number; taken: any }

export interface Biome {
  name: string; water: number; lava: boolean;
  low: number; mid: number; high: number; rock: number; shore: number;
  waterCol: number; sky: number; sun: number; fogCol: number;
}
/** Kyiv oblast, as it looks in high summer; the renderer shifts this palette with the season */
export const BIOMES: Biome[] = [
  { name: 'Kyiv', water: 0.2, lava: false, low: 0x4f6b34, mid: 0x66783c, high: 0x7f8450, rock: 0x6a6258, shore: 0x8e8660, waterCol: 0x2c4a52, sky: 0xa9bccb, sun: 0xfff0dc, fogCol: 0x07090b },
];

/** A civilian structure. Blocks movement, burns, and collapses into a ruin when it has taken enough punishment. */
export interface Civ {
  id: number; kind: number; x: number; z: number; cx: number; cz: number; fw: number; fh: number; h: number;
  hp: number; max: number; state: number; owner: any; seed: number; name: string;
  /** damage level: 0 intact, 1 holed and scorched, 2 partly collapsed, 3 rubble (state is 1 only for rubble) */
  dmg: number;
}
/** kinds: 0 house, 1 slab apartment block, 2 tower block, 3 industrial shed, 4 church, 5 St Sophia, 6 Motherland Monument, 7 Independence column, 8 TV tower, 9 Antonov hangar */
export const CIV_NAMES = ['House', 'Apartment block', 'Tower block', 'Warehouse', 'Church', 'St Sophia Cathedral', 'Motherland Monument', 'Independence Monument', 'Kyiv TV Tower', 'Antonov Hangar'];
export interface Bridge { x: number; z: number; ang: number; len: number; name: string; dead: boolean; t: number[] }

const AMP = 64;
type Pt = [number, number];
/** distance from p to a polyline, plus the tangent of the nearest segment and the fraction along the whole line */
function polyDist(px: number, pz: number, pts: Pt[], out: { d: number; tx: number; tz: number; side: number }) {
  let bd = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(px - qx, pz - qz);
    if (d < bd) { bd = d; const l = Math.sqrt(l2); out.tx = dx / l; out.tz = dz / l; out.side = (px - ax) * dz - (pz - az) * dx; }
  }
  out.d = bd;
}
/** Chaikin corner cutting so rivers and roads curve */
function smoothLine(pts: Pt[], it = 2): Pt[] {
  for (let k = 0; k < it; k++) {
    const o: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(pts[pts.length - 1]); pts = o;
  }
  return pts;
}

export class GameMap {
  n: number; size: number; hn: number;
  heights!: Float32Array;
  pass!: Uint8Array; block: Uint8Array; region!: Int32Array;
  /** deep-water passability (unused by land forces) and its connected regions */
  passW!: Uint8Array; regionW!: Int32Array; regionWSize: number[] = [];
  /** flammable vegetation per cell (0..1) and tree density used by the renderer */
  fuel!: Float32Array; forest!: Float32Array;
  /** where infantry can go: land, plus any water (they wade and swim, slowly) */
  passF!: Uint8Array;
  /** set by findPath: did the last search reach its goal? */
  found = false;
  /** paved road cells: no mud or snow penalty */
  road!: Uint8Array; roads: Pt[][] = [];
  /** 0 countryside … 1 dense city, for ground textures */
  urban!: Float32Array;
  civ: Civ[] = []; civAt!: Int32Array; bridges: Bridge[] = [];
  /** points of interest where civilians gather */
  districts: { x: number; z: number; r: number; pop: number }[] = [];
  wet = 0;
  waterY = -100;
  spots: Spot[] = [];
  starts: { x: number; z: number }[] = [];
  biome: Biome; seed: number;
  mainRegion = 0;
  // A* scratch
  private g: Float32Array; private par: Int32Array; private mark: Uint32Array; private closed: Uint32Array; private sid = 0;
  private hN: number[] = []; private hF: number[] = [];

  constructor(n: number, seed: number, _biomeIdx = 0, wet = 0) {
    this.wet = wet;
    this.n = n; this.size = n * CELL; this.hn = n * 2 + 1;
    this.biome = BIOMES[0]; this.seed = seed;
    this.block = new Uint8Array(n * n);
    this.g = new Float32Array(n * n); this.par = new Int32Array(n * n);
    this.mark = new Uint32Array(n * n); this.closed = new Uint32Array(n * n);
    for (let attempt = 0; attempt < 12; attempt++) {
      if (this.generate(seed + attempt * 7919)) break;
    }
  }

  /**
   * Kyiv and its north-western approaches, north up. The Dnipro runs down the eastern third with the left-bank
   * estates beyond it; the Irpin river cuts off the north-west, where the invasion force stages at Hostomel.
   */
  private generate(seed: number): boolean {
    const { n, hn, size } = this;
    const rng = mulberry32(seed ^ 0x5bd1e995);
    this.block.fill(0); this.civ = []; this.bridges = []; this.roads = []; this.spots = []; this.districts = [];
    const P = (a: number[][]): Pt[] => a.map(p => [p[0] * size, p[1] * size] as Pt);
    const irpin = smoothLine(P([[-0.02, 0.81], [0.12, 0.7], [0.22, 0.62], [0.3, 0.52], [0.36, 0.44], [0.42, 0.33], [0.46, 0.22], [0.5, 0.1], [0.52, -0.02]]));
    const dnipro = smoothLine(P([[0.66, -0.02], [0.67, 0.12], [0.7, 0.26], [0.735, 0.4], [0.75, 0.52], [0.745, 0.64], [0.72, 0.76], [0.715, 0.88], [0.73, 1.02]]));
    const rivers: { pts: Pt[]; w: (z: number) => number; bank: number }[] = [
      { pts: irpin, w: () => 13, bank: 15 },
      { pts: dnipro, w: z => 40 + 26 * (1 - smooth(0.12, 0.34, z / size)), bank: 20 },
    ];
    const WY = this.waterY = 6;
    const o = { d: 0, tx: 0, tz: 0, side: 0 };
    // bridges: [river, x, z, name] – snapped onto the river centre line
    const bdef: [number, number, number, string][] = [
      [0, 0.12, 0.7, 'Stoyanka bridge'], [0, 0.33, 0.48, 'Irpin bridge'], [0, 0.46, 0.22, 'Demydiv bridge'],
      [1, 0.715, 0.33, 'Pivnichnyi Bridge'], [1, 0.75, 0.55, 'Metro Bridge'], [1, 0.728, 0.73, 'Paton Bridge'],
    ];
    for (const [ri, bx, bz, name] of bdef) {
      const r = rivers[ri]; let best = 1e9, px = 0, pz = 0, tx = 0, tz = 1;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], d = Math.hypot((a[0] + b[0]) / 2 - bx * size, (a[1] + b[1]) / 2 - bz * size);
        if (d < best) { best = d; px = (a[0] + b[0]) / 2; pz = (a[1] + b[1]) / 2; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); tx = (b[0] - a[0]) / l; tz = (b[1] - a[1]) / l; }
      }
      this.bridges.push({ x: px, z: pz, ang: Math.atan2(-tx, -tz), len: (r.w(pz) + r.bank) * 2 + 16, name, dead: false, t: [tx, tz] });
    }
    // heights: gently rolling plain, the high right bank of the Dnipro, then rivers carved in
    const H = new Float32Array(hn * hn);
    for (let j = 0; j < hn; j++) for (let i = 0; i < hn; i++) {
      const x = i * VS, z = j * VS;
      let h = 12 + fbm(x / 300 + 31.7, z / 300 + 12.3, seed, 5) * 15 + fbm(x / 70 + 3.1, z / 70 + 7.7, seed + 5, 3) * 2.2;
      polyDist(x, z, dnipro, o);
      if (o.side < 0) h += 9 * smooth(190, 60, o.d) * smooth(0.25, 0.5, z / size); // Pechersk hills on the west bank
      for (const r of rivers) {
        polyDist(x, z, r.pts, o);
        const w = r.w(z);
        if (o.d < w + r.bank + 30) {
          h = lerp(h, WY + 2.6, 1 - smooth(w + r.bank, w + r.bank + 30, o.d));
          h = lerp(h, WY - 7, 1 - smooth(w, w + r.bank, o.d));
        }
      }
      for (const b of this.bridges) {
        const t = b.t, dx = x - b.x, dz = z - b.z;
        const al = Math.abs(dx * t[0] + dz * t[1]), ac = Math.abs(dx * -t[1] + dz * t[0]);
        if (al < 22 && ac < b.len / 2 + 10) h = lerp(h, WY + 3.2, (1 - smooth(13, 21, al)) * (1 - smooth(b.len / 2, b.len / 2 + 10, ac)));
      }
      H[j * hn + i] = h;
    }
    // start positions: 0 Ukraine (government quarter), 1 Russia (Hostomel)
    const startCells = [[Math.round(n * 0.5), Math.round(n * 0.68)], [Math.round(n * 0.17), Math.round(n * 0.2)]];
    for (const [a, b] of startCells) {
      const sx = a * CELL, sz = b * CELL, R = 150;
      const i0 = Math.max(0, Math.floor((sx - R) / VS)), i1 = Math.min(hn - 1, Math.ceil((sx + R) / VS));
      const j0 = Math.max(0, Math.floor((sz - R) / VS)), j1 = Math.min(hn - 1, Math.ceil((sz + R) / VS));
      const plate = H[Math.round(sz / VS) * hn + Math.round(sx / VS)];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * VS - sx, j * VS - sz);
        const w = 1 - smooth(85, R, d);
        if (w > 0) H[j * hn + i] = lerp(H[j * hn + i], plate, w);
      }
    }
    this.heights = H;
    // passability
    const pass = new Uint8Array(n * n);
    for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) {
      let lo = 1e9, hi = -1e9;
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
        const h = H[(cz * 2 + j) * hn + cx * 2 + i];
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (hi - lo < 5.2 && lo > WY + 0.6) pass[cz * n + cx] = 1;
    }
    this.pass = pass;
    this.passF = new Uint8Array(n * n);
    for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) this.passF[cz * n + cx] = pass[cz * n + cx] || H[(cz * 2 + 1) * hn + cx * 2 + 1] < WY + 2.4 ? 1 : 0;
    const passW = new Uint8Array(n * n);
    for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) {
      let hi = -1e9;
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) hi = Math.max(hi, H[(cz * 2 + j) * hn + cx * 2 + i]);
      if (hi < WY - 2.2) passW[cz * n + cx] = 1;
    }
    this.passW = passW;
    const label = (pass: Uint8Array, sizes: number[]) => {
      const region = new Int32Array(n * n).fill(-1);
      const stack: number[] = [];
      let rid = 0;
      for (let s = 0; s < n * n; s++) {
        if (!pass[s] || region[s] >= 0) continue;
        let cnt = 0; stack.push(s); region[s] = rid;
        while (stack.length) {
          const p = stack.pop()!; cnt++;
          const px = p % n;
          if (px > 0 && pass[p - 1] && region[p - 1] < 0) { region[p - 1] = rid; stack.push(p - 1); }
          if (px < n - 1 && pass[p + 1] && region[p + 1] < 0) { region[p + 1] = rid; stack.push(p + 1); }
          if (p >= n && pass[p - n] && region[p - n] < 0) { region[p - n] = rid; stack.push(p - n); }
          if (p < n * n - n && pass[p + n] && region[p + n] < 0) { region[p + n] = rid; stack.push(p + n); }
        }
        sizes.push(cnt); rid++;
      }
      return region;
    };
    const sizes: number[] = [];
    const region = this.region = label(pass, sizes);
    this.regionWSize = []; this.regionW = label(passW, this.regionWSize);
    const r0 = region[startCells[0][1] * n + startCells[0][0]];
    if (r0 < 0 || region[startCells[1][1] * n + startCells[1][0]] !== r0) return false;
    this.mainRegion = r0;
    this.starts = startCells.map(([a, b]) => ({ x: a * CELL, z: b * CELL }));

    // roads
    const B = this.bridges.map(b => [b.x / size, b.z / size]);
    const roadDefs: number[][][] = [
      [[0, 0.745], B[0], [0.3, 0.695], [0.5, 0.68]],                                  // Zhytomyr highway
      [[0.17, 0.2], [0.24, 0.36], B[1], [0.42, 0.58], [0.5, 0.68]],                   // Hostomel – Bucha – Irpin – Kyiv
      [[0.17, 0.2], [0.34, 0.2], B[2], [0.57, 0.33], [0.575, 0.5], [0.5, 0.68]],      // Demydiv – Obolon
      [[0.24, 0.36], [0.1, 0.5], B[0]],
      [[0.5, 0.68], [0.6, 0.72], B[5], [0.86, 0.7]],                                  // Paton bridge
      [[0.575, 0.5], [0.66, 0.54], B[4], [0.87, 0.52]],                               // Metro bridge
      [[0.57, 0.33], B[3], [0.86, 0.3]],                                              // northern bridge
      [[0.86, 0.1], [0.86, 0.3], [0.87, 0.52], [0.86, 0.7], [0.88, 0.94]],            // left-bank avenue
      [[0.5, 0.68], [0.52, 0.98]],                                                    // Odesa highway
      [[0.5, 0.68], [0.575, 0.615], [0.575, 0.5]],                                    // Khreshchatyk
    ];
    this.road = new Uint8Array(n * n);
    for (const rd of roadDefs) {
      const pts = smoothLine(P(rd), 2); this.roads.push(pts);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), st = Math.ceil(l / 3);
        for (let k = 0; k <= st; k++) {
          const x = a[0] + (b[0] - a[0]) * k / st, z = a[1] + (b[1] - a[1]) * k / st;
          for (const [ox, oz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
            const cx = Math.floor((x + ox) / CELL), cz = Math.floor((z + oz) / CELL);
            if (cx >= 0 && cz >= 0 && cx < n && cz < n) this.road[cz * n + cx] = 1;
          }
        }
      }
    }
    this.placeSpots(rng, startCells);
    this.placeCity(rng, startCells);
    // vegetation: pine woods north-west of the city, parks inside it, almost none on the plain's fields
    this.fuel = new Float32Array(n * n); this.forest = new Float32Array(n * n);
    for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) {
      const i = cz * n + cx, x = cx * CELL, z = cz * CELL;
      const h = H[(cz * 2 + 1) * hn + cx * 2 + 1];
      if (h < WY + 1 || this.block[i] || this.road[i]) continue;
      if (this.bridges.some(b => Math.hypot(b.x - x, b.z - z) < b.len / 2 + 14)) continue;
      let ds = 1e9; for (const s of this.starts) ds = Math.min(ds, Math.hypot(s.x - x, s.z - z));
      const woods = 0.5 - 0.1 * smooth(0.2, 0.6, (x + z) / size / 2 + 0.1) + 0.06 * this.urban[i];
      let f = fbm(x / 150 + 9.1, z / 150 + 3.7, seed + 77, 4);
      f = smooth(woods, woods + 0.12, f) * smooth(70, 150, ds) * (1 - 0.75 * this.urban[i]);
      if (!pass[i]) f *= 0.35;
      for (const s of this.spots) if (Math.abs(s.cx - cx) < 3 && Math.abs(s.cz - cz) < 3) f = 0;
      this.forest[i] = f;
      this.fuel[i] = Math.min(1, 0.26 * (1 - this.urban[i] * 0.7) * (ds < 90 ? 0.5 : 1) + f);
    }
    return this.spots.length >= 20 && this.findPath(this.starts[0].x, this.starts[0].z, this.starts[1].x, this.starts[1].z) !== null;
  }

  private spotOk(cx: number, cz: number, min: number) {
    const n = this.n;
    for (let j = -2; j <= 1; j++) for (let i = -2; i <= 1; i++) {
      const x = cx + i, z = cz + j;
      if (x < 2 || z < 2 || x >= n - 2 || z >= n - 2) return false;
      if (!this.pass[z * n + x] || this.region[z * n + x] !== this.mainRegion || this.road[z * n + x]) return false;
    }
    return this.spots.every(s => Math.hypot(s.cx - cx, s.cz - cz) >= min);
  }
  private placeSpots(rng: () => number, starts: number[][]) {
    const n = this.n;
    const add = (cx: number, cz: number, rich: number, min: number) => {
      if (!this.spotOk(cx, cz, min)) return false;
      this.spots.push({ id: this.spots.length, cx, cz, x: cx * CELL, z: cz * CELL, rich, taken: null }); return true;
    };
    const ring = (c: number[], d0: number, d1: number, cnt: number, rich: number, min: number) => {
      for (let t = 0, k = 0; t < 300 && k < cnt; t++) {
        const a = rng() * Math.PI * 2, d = d0 + rng() * (d1 - d0);
        if (add(Math.round(c[0] + Math.cos(a) * d), Math.round(c[1] + Math.sin(a) * d), rich, min)) k++;
      }
    };
    for (const s of starts) { ring(s, 7, 12, 3, 2, 6); ring(s, 17, 26, 3, 2, 9); }
    // [x, z, count, richness]: staging areas, the city's districts, the left bank, and the contested river line
    const zones = [[0.07, 0.07, 2, 2.2], [0.32, 0.08, 2, 2.2], [0.07, 0.42, 2, 2.2], [0.3, 0.3, 2, 2.2], [0.12, 0.6, 1, 2.2],
      [0.3, 0.78, 1, 2.2], [0.36, 0.92, 1, 2.2], [0.62, 0.9, 1, 2.2], [0.6, 0.16, 1, 2.4], [0.58, 0.42, 1, 2.4], [0.3, 0.62, 1, 2.2],
      [0.86, 0.2, 1, 2.6], [0.9, 0.42, 1, 2.6], [0.84, 0.62, 1, 2.6], [0.9, 0.84, 1, 2.6], [0.43, 0.44, 1, 3.2], [0.2, 0.84, 1, 2.4]];
    for (const [x, z, cnt, rich] of zones) ring([x * n, z * n], 0, 7, cnt, rich, 10);
  }

  private placeCity(rng: () => number, starts: number[][]) {
    const n = this.n, size = this.size;
    this.civAt = new Int32Array(n * n); this.urban = new Float32Array(n * n);
    const free = (cx: number, cz: number, fw: number, fh: number, margin = 1) => {
      for (let j = -margin; j < fh + margin; j++) for (let i = -margin; i < fw + margin; i++) {
        const x = cx + i, z = cz + j;
        if (x < 2 || z < 2 || x >= n - 2 || z >= n - 2) return false;
        const k = z * n + x;
        if (!this.pass[k] || this.block[k] || this.road[k] || this.region[k] !== this.mainRegion) return false;
      }
      for (const s of starts) if (Math.hypot(cx + fw / 2 - s[0], cz + fh / 2 - s[1]) < 16 + Math.max(fw, fh) / 2) return false;
      for (const s of this.spots) if (s.cx >= cx - 3 && s.cx <= cx + fw + 2 && s.cz >= cz - 3 && s.cz <= cz + fh + 2) return false;
      return true;
    };
    const HP = [260, 1500, 2400, 1200, 1400, 3200, 6000, 1200, 2600, 2600];
    const put = (kind: number, cx: number, cz: number, fw: number, fh: number, h: number) => {
      const c: Civ = { id: this.civ.length, kind, cx, cz, fw, fh, h, x: (cx + fw / 2) * CELL, z: (cz + fh / 2) * CELL, hp: HP[kind], max: HP[kind], state: 0, dmg: 0, owner: null, seed: rng(), name: CIV_NAMES[kind] };
      this.civ.push(c);
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) { this.block[(cz + j) * n + cx + i]++; this.civAt[(cz + j) * n + cx + i] = c.id + 1; }
      return c;
    };
    /** put a landmark as close as possible to a normalised position */
    const landmark = (kind: number, x: number, z: number, fw: number, fh: number, h: number) => {
      const bx = Math.round(x * n - fw / 2), bz = Math.round(z * n - fh / 2);
      for (let r = 0; r < 10; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        if (free(bx + i, bz + j, fw, fh, 2)) return put(kind, bx + i, bz + j, fw, fh, h);
      }
      return null;
    };
    landmark(5, 0.552, 0.592, 3, 3, 30);   // St Sophia
    landmark(7, 0.588, 0.628, 1, 1, 34);   // Maidan: Independence Monument
    landmark(6, 0.668, 0.76, 2, 2, 62);    // Motherland Monument on the Pechersk bluff
    landmark(4, 0.672, 0.7, 2, 2, 26);     // Lavra
    landmark(8, 0.462, 0.5, 2, 2, 96);     // TV tower
    landmark(9, 0.1, 0.13, 5, 3, 13);      // Hostomel: the Antonov hangar
    // districts: [x, z, radius (cells), density, weights for house / slab / tower / shed / church, name]
    const D: [number, number, number, number, number[]][] = [
      [0.6, 0.6, 9, 0.62, [0, 5, 3, 0, 0.5]],     // Pechersk / Khreshchatyk
      [0.625, 0.465, 6, 0.6, [2, 4, 1, 1, 0.6]],  // Podil
      [0.6, 0.27, 8, 0.5, [0, 2, 5, 1, 0]],       // Obolon
      [0.37, 0.67, 6, 0.5, [1, 5, 1, 2, 0.2]],    // Sviatoshyn
      [0.44, 0.84, 7, 0.45, [3, 4, 1, 1, 0.2]],   // Holosiiv
      [0.6, 0.85, 5, 0.45, [2, 3, 2, 1, 0]],
      [0.87, 0.25, 8, 0.55, [0, 2, 6, 1, 0]],     // Troieshchyna
      [0.875, 0.6, 9, 0.5, [0, 3, 4, 3, 0.2]],    // Darnytsia
      [0.9, 0.86, 6, 0.4, [5, 2, 0, 1, 0.3]],
      [0.4, 0.53, 5, 0.5, [5, 3, 0, 0, 0.3]],     // Irpin
      [0.23, 0.44, 6, 0.45, [7, 2, 0, 0.5, 0.3]], // Bucha
      [0.29, 0.25, 5, 0.42, [6, 1, 0, 2, 0.2]],   // Hostomel
      [0.07, 0.3, 4, 0.35, [8, 0, 0, 1, 0.3]], [0.36, 0.07, 4, 0.35, [8, 0, 0, 1, 0.3]], [0.2, 0.74, 4, 0.35, [8, 0, 0, 1, 0.3]],
    ];
    for (const [dx, dz, R, dens, wts] of D) {
      const ox = dx * n, oz = dz * n, tot = wts.reduce((a, b) => a + b, 0);
      this.districts.push({ x: dx * size, z: dz * size, r: R * CELL, pop: Math.round(R * dens * 1.6) });
      for (let j = -R - 4; j <= R + 4; j++) for (let i = -R - 4; i <= R + 4; i++) {
        const x = Math.round(ox + i), z = Math.round(oz + j); if (x < 0 || z < 0 || x >= n || z >= n) continue;
        this.urban[z * n + x] = Math.max(this.urban[z * n + x], 1 - smooth(R * 0.7, R + 4, Math.hypot(i, j)));
      }
      const G = 5;
      for (let pass = 0; pass < 3; pass++) for (let lz = -R - 2 + pass * 2; lz <= R + 2; lz += G) for (let lx = -R - 2 + pass; lx <= R + 2; lx += G) {
        if (Math.hypot(lx, lz) > R + 2 || rng() > (pass ? dens * 0.7 : dens + 0.25)) continue;
        let r = rng() * tot, kind = 0; for (let k = 0; k < wts.length; k++) { r -= wts[k]; if (r <= 0) { kind = k; break; } }
        const tries = kind === 0 ? 3 : 1;
        for (let t = 0; t < tries; t++) {
          let fw = 1, fh = 1, h = 5 + rng() * 2;
          if (kind === 1) { if (rng() < 0.5) { fw = 4; fh = 1; } else { fw = 1; fh = 4; } h = 14 + Math.floor(rng() * 3) * 3; }
          else if (kind === 2) { fw = fh = 2; h = 30 + Math.floor(rng() * 5) * 4; }
          else if (kind === 3) { if (rng() < 0.5) { fw = 3; fh = 2; } else { fw = 2; fh = 3; } h = 7 + rng() * 3; }
          else if (kind === 4) { fw = fh = 2; h = 20 + rng() * 4; }
          const cx = Math.round(ox + lx + rng() * Math.max(0, G - 1 - fw)), cz = Math.round(oz + lz + rng() * Math.max(0, G - 1 - fh));
          if (free(cx, cz, fw, fh, 1)) put(kind, cx, cz, fw, fh, h);
        }
      }
    }
  }

  heightAt(x: number, z: number) {
    const hn = this.hn;
    const fx = clamp(x / VS, 0, hn - 1.001), fz = clamp(z / VS, 0, hn - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
    const H = this.heights, i = iz * hn + ix;
    return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + hn] * (1 - tx) + H[i + hn + 1] * tx) * tz;
  }
  groundY(x: number, z: number) { return Math.max(this.heightAt(x, z), this.waterY); }
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }) {
    const d = 3;
    const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z), dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    const l = Math.hypot(dx, 2 * d, dz);
    out.x = -dx / l; out.y = 2 * d / l; out.z = -dz / l;
  }
  inCells(cx: number, cz: number) { return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n; }
  /** nav: false / 0 land vehicles, true / 1 ships, 2 infantry (may wade through water) */
  cellPass(cx: number, cz: number, nav: boolean | number = false) {
    if (cx < 0 || cz < 0 || cx >= this.n || cz >= this.n) return false;
    const i = cz * this.n + cx; return (nav === 2 ? this.passF[i] : nav ? this.passW[i] : this.pass[i]) === 1 && this.block[i] === 0;
  }
  /** bring a bridge down: the crossing becomes open water */
  dropBridge(b: Bridge) {
    if (b.dead) return; b.dead = true;
    const { n, hn } = this, H = this.heights, t = b.t, R = b.len / 2 + 30;
    const i0 = Math.max(1, Math.floor((b.x - R) / VS)), i1 = Math.min(hn - 2, Math.ceil((b.x + R) / VS)), j0 = Math.max(1, Math.floor((b.z - R) / VS)), j1 = Math.min(hn - 2, Math.ceil((b.z + R) / VS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i * VS - b.x, dz = j * VS - b.z, al = Math.abs(dx * t[0] + dz * t[1]), ac = Math.abs(dx * -t[1] + dz * t[0]);
      if (al < 26 && ac < b.len / 2 - 6) H[j * hn + i] = lerp(H[j * hn + i], this.waterY - 6, 1 - smooth(b.len / 2 - 20, b.len / 2 - 6, ac));
    }
    for (let cz = Math.max(1, j0 >> 1); cz <= Math.min(n - 2, j1 >> 1); cz++) for (let cx = Math.max(1, i0 >> 1); cx <= Math.min(n - 2, i1 >> 1); cx++) {
      let lo = 1e9, hi = -1e9;
      for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) { const h = H[(cz * 2 + j) * hn + cx * 2 + i]; if (h < lo) lo = h; if (h > hi) hi = h; }
      const k = cz * n + cx; this.pass[k] = hi - lo < 5.2 && lo > this.waterY + 0.6 ? 1 : 0; this.passF[k] = this.pass[k] || H[(cz * 2 + 1) * hn + cx * 2 + 1] < this.waterY + 2.4 ? 1 : 0; this.road[k] = this.pass[k] ? this.road[k] : 0;
    }
  }
  passAt(x: number, z: number, nav: boolean | number = false) { return this.cellPass(Math.floor(x / CELL), Math.floor(z / CELL), nav); }
  cellOf(x: number, z: number) {
    return clamp(Math.floor(z / CELL), 0, this.n - 1) * this.n + clamp(Math.floor(x / CELL), 0, this.n - 1);
  }

  nearestPass(cx: number, cz: number, maxR: number, nav: boolean | number = false): number {
    const n = this.n;
    if (this.cellPass(cx, cz, nav)) return cz * n + cx;
    let best = -1, bd = 1e9;
    for (let r = 1; r <= maxR; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        if (!this.cellPass(cx + i, cz + j, nav)) continue;
        const d = i * i + j * j;
        if (d < bd) { bd = d; best = (cz + j) * n + cx + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  lineClear(x0: number, z0: number, x1: number, z1: number, nav: boolean | number = false) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const steps = Math.ceil(d / 3), ox = -dz / d * 2.6, oz = dx / d * 2.6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = x0 + dx * t, z = z0 + dz * t;
      if (!this.passAt(x, z, nav) || !this.passAt(x + ox, z + oz, nav) || !this.passAt(x - ox, z - oz, nav)) return false;
    }
    return true;
  }

  private hPush(node: number, f: number) {
    const N = this.hN, Fa = this.hF; let i = N.length; N.push(node); Fa.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1; if (Fa[p] <= f) break;
      N[i] = N[p]; Fa[i] = Fa[p]; i = p;
    }
    N[i] = node; Fa[i] = f;
  }
  private hPop(): number {
    const N = this.hN, Fa = this.hF; const top = N[0];
    const ln = N.pop()!, lf = Fa.pop()!; const len = N.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1; if (c >= len) break;
        if (c + 1 < len && Fa[c + 1] < Fa[c]) c++;
        if (Fa[c] >= lf) break;
        N[i] = N[c]; Fa[i] = Fa[c]; i = c;
      }
      N[i] = ln; Fa[i] = lf;
    }
    return top;
  }

  /** Returns flat [x,z,x,z...] waypoints (excluding start) or null. */
  findPath(sx: number, sz: number, gx: number, gz: number, nav: boolean | number = false): number[] | null {
    const n = this.n;
    if (nav === 2) {
      // infantry keep their feet dry when a crossing is reasonably close; otherwise they wade
      const land = this.findPath(sx, sz, gx, gz, 0);
      if (land && this.found) {
        let l = 0, px = sx, pz = sz; for (let i = 0; i < land.length; i += 2) { l += Math.hypot(land[i] - px, land[i + 1] - pz); px = land[i]; pz = land[i + 1]; }
        if (l < Math.hypot(gx - sx, gz - sz) * 2 + 160) return land;
      }
    }
    this.found = false;
    let sc = this.cellOf(sx, sz), gc = this.cellOf(gx, gz);
    if (!this.cellPass(sc % n, (sc / n) | 0, nav)) { sc = this.nearestPass(sc % n, (sc / n) | 0, 8, nav); if (sc < 0) return null; }
    let exact = true;
    if (!this.cellPass(gc % n, (gc / n) | 0, nav)) { gc = this.nearestPass(gc % n, (gc / n) | 0, nav ? 60 : 30, nav); if (gc < 0) return null; exact = false; }
    const gcx = gc % n, gcz = (gc / n) | 0;
    const fx = exact ? gx : (gcx + 0.5) * CELL, fz = exact ? gz : (gcz + 0.5) * CELL;
    if (sc === gc || this.lineClear(sx, sz, fx, fz, nav)) { this.found = true; return [fx, fz]; }
    const sid = ++this.sid; const g = this.g, par = this.par, mark = this.mark, closed = this.closed;
    this.hN.length = 0; this.hF.length = 0;
    const heur = (i: number) => {
      const dx = Math.abs(i % n - gcx), dz = Math.abs(((i / n) | 0) - gcz);
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    };
    g[sc] = 0; par[sc] = -1; mark[sc] = sid; this.hPush(sc, heur(sc));
    let best = sc, bestH = heur(sc), found = false, exp = 0;
    const pass = nav === 2 ? this.passF : nav ? this.passW : this.pass, block = this.block, land = this.pass;
    while (this.hN.length) {
      const cur = this.hPop();
      if (closed[cur] === sid) continue;
      closed[cur] = sid;
      if (cur === gc) { found = true; break; }
      if (++exp > 40000) break;
      const cx = cur % n, cz = (cur / n) | 0, gcur = g[cur];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const ni = nz * n + nx;
        if (!pass[ni] || block[ni] || closed[ni] === sid) continue;
        if (dx && dz) {
          const a = cz * n + nx, b = nz * n + cx;
          if (!pass[a] || block[a] || !pass[b] || block[b]) continue;
        }
        const ng = gcur + (dx && dz ? 1.4142 : 1) * (nav === 2 && !land[ni] ? 3 : 1);
        if (mark[ni] === sid && g[ni] <= ng) continue;
        g[ni] = ng; par[ni] = cur; mark[ni] = sid;
        const h = heur(ni);
        if (h < bestH) { bestH = h; best = ni; }
        this.hPush(ni, ng + h * 1.05);
      }
    }
    this.found = found;
    let end = found ? gc : best;
    if (end === sc) return null;
    const cells: number[] = [];
    for (let c = end; c !== -1 && c !== sc; c = par[c]) cells.push(c);
    cells.reverse();
    const pts: number[] = [];
    for (const c of cells) pts.push((c % n + 0.5) * CELL, (((c / n) | 0) + 0.5) * CELL);
    if (found) { pts[pts.length - 2] = fx; pts[pts.length - 1] = fz; }
    // string pulling
    const out: number[] = [];
    let ax = sx, az = sz, i = 0; const cnt = pts.length / 2;
    while (i < cnt) {
      let j = Math.min(cnt - 1, i + 48);
      while (j > i && !this.lineClear(ax, az, pts[j * 2], pts[j * 2 + 1], nav)) j--;
      ax = pts[j * 2]; az = pts[j * 2 + 1]; out.push(ax, az); i = j + 1;
    }
    return out;
  }
}
