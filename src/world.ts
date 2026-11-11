// The city and its people: civilian buildings and landmarks, ruins, bridges, civilians, and the dead.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Bridge, CELL, Civ, GameMap } from './map';
import { Game, Team, TICK } from './sim';
import { YEAR_SECS } from './defs';
import { hash2, lerp, mulberry32 } from './util';
import { normalTexture, tile } from './scenery';

const BAY = 3.2, FLOOR = 3.0, TILES = 4;

/** Soviet panel-block facade: 4×4 bays of windows, seams, balconies, water stains and soot. Returns albedo + night-light maps. */
function facadeTextures(broken = false) {
  const S = 512, B = S / TILES;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const e = document.createElement('canvas'); e.width = e.height = S;
  const x = c.getContext('2d')!, ex = e.getContext('2d')!;
  // height (for the normal map) and roughness: glass is recessed and mirror-smooth, concrete is proud and matte
  const hc = document.createElement('canvas'); hc.width = hc.height = S; const rc = document.createElement('canvas'); rc.width = rc.height = S;
  const hx = hc.getContext('2d')!, rx = rc.getContext('2d')!;
  hx.fillStyle = '#c8c8c8'; hx.fillRect(0, 0, S, S); rx.fillStyle = 'rgb(0,232,0)'; rx.fillRect(0, 0, S, S);
  const rnd = mulberry32(4242);
  x.fillStyle = '#d9d6cf'; x.fillRect(0, 0, S, S);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  for (let j = 0; j < TILES; j++) for (let i = 0; i < TILES; i++) {
    const px = i * B, py = j * B;
    const v = 205 + rnd() * 30; x.fillStyle = `rgb(${v},${v - 3},${v - 9})`; x.fillRect(px, py, B, B);
    // panel seams
    x.strokeStyle = 'rgba(40,38,34,0.55)'; x.lineWidth = 2; x.strokeRect(px + 1, py + 1, B - 2, B - 2);
    hx.strokeStyle = '#505050'; hx.lineWidth = 3; hx.strokeRect(px + 1, py + 1, B - 2, B - 2);
    // window
    const wx = px + 34, wy = py + 30, ww = 60, wh = 62;
    x.fillStyle = '#e6e3da'; x.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
    const dark = rnd() < (broken ? 0.75 : 0.2);
    hx.fillStyle = '#e6e6e6'; hx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10); hx.fillStyle = '#5a5a5a'; hx.fillRect(wx, wy, ww, wh); hx.fillStyle = '#d0d0d0'; hx.fillRect(wx + ww / 2 - 2, wy, 4, wh); hx.fillRect(wx, wy + wh * 0.35 - 2, ww, 4);
    rx.fillStyle = broken ? 'rgb(0,200,0)' : `rgb(0,${18 + rnd() * 40},0)`; rx.fillRect(wx, wy, ww, wh);
    x.fillStyle = dark ? '#0d0f12' : `rgb(${38 + rnd() * 30},${48 + rnd() * 30},${58 + rnd() * 34})`; x.fillRect(wx, wy, ww, wh);
    if (!dark && rnd() < 0.5) { x.fillStyle = `rgba(${190 + rnd() * 50},${180 + rnd() * 50},${150 + rnd() * 60},0.55)`; x.fillRect(wx, wy, ww * (0.3 + rnd() * 0.3), wh); } // curtain
    if (rnd() < 0.12) { x.fillStyle = '#8a7a58'; x.fillRect(wx, wy, ww, wh); x.strokeStyle = '#5c4f38'; x.beginPath(); x.moveTo(wx, wy); x.lineTo(wx + ww, wy + wh); x.moveTo(wx + ww, wy); x.lineTo(wx, wy + wh); x.stroke(); } // boarded up
    x.strokeStyle = '#f2f0ea'; x.lineWidth = 3; x.beginPath(); x.moveTo(wx + ww / 2, wy); x.lineTo(wx + ww / 2, wy + wh); x.moveTo(wx, wy + wh * 0.35); x.lineTo(wx + ww, wy + wh * 0.35); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.beginPath(); x.moveTo(wx, wy + wh); x.lineTo(wx + ww * 0.5, wy); x.lineTo(wx + ww * 0.8, wy); x.lineTo(wx + ww * 0.3, wy + wh); x.fill();
    if (broken && rnd() < 0.8) { // blown-out glass: jagged shards left in the frame, soot licking up the wall
      x.fillStyle = '#060607'; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(150,170,180,0.55)';
      for (let k = 0; k < 5; k++) { const ex0 = wx + rnd() * ww, top = rnd() < 0.5; x.beginPath(); x.moveTo(ex0 - 8, top ? wy : wy + wh); x.lineTo(ex0 + 8, top ? wy : wy + wh); x.lineTo(ex0 + (rnd() - 0.5) * 10, top ? wy + 8 + rnd() * 18 : wy + wh - 8 - rnd() * 18); x.fill(); }
      const sg = x.createLinearGradient(0, wy, 0, wy - 34); sg.addColorStop(0, 'rgba(8,7,6,0.75)'); sg.addColorStop(1, 'rgba(8,7,6,0)'); x.fillStyle = sg; x.fillRect(wx - 6, wy - 34, ww + 12, 34);
    }
    // balcony on some bays
    if (rnd() < 0.4) { x.fillStyle = `rgb(${120 + rnd() * 70},${120 + rnd() * 60},${110 + rnd() * 50})`; x.fillRect(wx - 12, wy + wh - 6, ww + 24, 30); hx.fillStyle = '#ffffff'; hx.fillRect(wx - 12, wy + wh - 6, ww + 24, 30); rx.fillStyle = 'rgb(0,215,0)'; rx.fillRect(wx - 12, wy + wh - 6, ww + 24, 30); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; x.strokeRect(wx - 12, wy + wh - 6, ww + 24, 30); }
    // water stains running down from the sill
    for (let k = 0; k < 4; k++) { const sx = wx + rnd() * ww, g = x.createLinearGradient(0, wy + wh, 0, wy + wh + 40); g.addColorStop(0, 'rgba(30,26,20,0.4)'); g.addColorStop(1, 'rgba(30,26,20,0)'); x.fillStyle = g; x.fillRect(sx, wy + wh + (rnd() < 0.5 ? 24 : 2), 2 + rnd() * 5, 40); }
    // a few lit windows: this is a city under blackout
    if (!dark && !broken && rnd() < 0.2) { ex.fillStyle = `rgb(255,${170 + rnd() * 50},${80 + rnd() * 60})`; ex.fillRect(wx + 2, wy + 2, ww - 4, wh - 4); }
  }
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = (py * S + px) * 4, g = 0.74 + 0.3 * tile(px, py, S, 7, 81) - 0.22 * Math.pow(tile(px, py * 0.2, S, 34, 83), 2) + 0.08 * tile(px, py, S, 60, 85);
    d[i] *= g; d[i + 1] *= g * 0.985; d[i + 2] *= g * 0.96;
  }
  x.putImageData(img, 0, 0);
  const mk = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t; };
  const hd = hx.getImageData(0, 0, S, S).data, normal = normalTexture(S, (px, py) => hd[(py * S + px) * 4] / 255, 3.2);
  const rough = mk(rc); rough.colorSpace = THREE.NoColorSpace;
  return { map: mk(c), lit: mk(e), normal, rough };
}

const WALLUV = 0.035;
function paint(g: THREE.BufferGeometry, hex: number, k: number, tiled: boolean, jitter = 0.06) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, nr = g.attributes.normal, n = p.count, col = new Float32Array(n * 3), uv = new Float32Array(n * 2), c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) {
    const f = k * (1 - jitter + hash2(i >> 2, Math.round(p.getY(i)), 7) * jitter * 2) * (0.9 + 0.1 * nr.getY(i));
    col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    if (tiled && Math.abs(nr.getY(i)) < 0.5) { uv[i * 2] = (Math.abs(nr.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i)) / (BAY * TILES); uv[i * 2 + 1] = p.getY(i) / (FLOOR * TILES); }
    else { uv[i * 2] = WALLUV; uv[i * 2 + 1] = WALLUV; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
/** box standing on y0 */
const bx = (w: number, h: number, l: number, x: number, y0: number, z: number, hex: number, tiled = false, k = 1, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, l); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y0 + h / 2, z); return paint(g, hex, k, tiled);
};
const cyl = (rt: number, rb: number, h: number, x: number, y0: number, z: number, hex: number, seg = 12, k = 1) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y0 + h / 2, z); return paint(g, hex, k, false, 0.03);
};
const dome = (r: number, x: number, y0: number, z: number, hex: number, onion = 1.25) => {
  const g = new THREE.SphereGeometry(r, 12, 9); g.scale(1, onion, 1); g.translate(x, y0 + r * onion * 0.8, z);
  const s = new THREE.ConeGeometry(r * 0.28, r * 1.5, 8); s.translate(x, y0 + r * onion * 1.75 + r * 0.5, z);
  const cr = new THREE.BoxGeometry(r * 0.1, r * 0.9, r * 0.1); cr.translate(x, y0 + r * onion * 1.75 + r * 1.5, z);
  const cb = new THREE.BoxGeometry(r * 0.5, r * 0.1, r * 0.1); cb.translate(x, y0 + r * onion * 1.75 + r * 1.6, z);
  return [paint(g, hex, 1.15, false, 0.02), paint(s, hex, 1.15, false, 0.02), paint(cr, hex, 1.2, false, 0), paint(cb, hex, 1.2, false, 0)];
};
const GOLD = 0xd9a520, WHITE = 0xe8e4da, GREEN = 0x3f6b4a;

/**
 * Battle damage on a standing building. Level 1: shell holes punched through the walls, soot above them, glass and masonry at the foot.
 * Level 2: a corner or a whole upper section has come down, the rest is gutted and black.
 */
function scars(c: Civ, parts: THREE.BufferGeometry[], W: number, L: number, h: number, lvl: number) {
  const r = mulberry32(Math.floor(c.seed * 1e6) + 31), n = lvl === 1 ? 2 + Math.floor(W * L / 60) : 5 + Math.floor(W * L / 30);
  const BLACK = 0x070707, SOOT = 0x161412;
  for (let i = 0; i < n; i++) {
    const side = Math.floor(r() * 4), hw = 2 + r() * (lvl === 2 ? 4 : 2.4), hh = 2 + r() * (lvl === 2 ? 5 : 2.6), y = Math.min(h - hh - 0.5, 1 + r() * h * 0.8);
    const along = (r() - 0.5) * ((side < 2 ? W : L) - hw - 1), x = side === 0 ? along : side === 1 ? along : side === 2 ? W / 2 : -W / 2, z = side === 0 ? L / 2 : side === 1 ? -L / 2 : along;
    const zf = side < 2;
    parts.push(bx(zf ? hw : 0.5, hh, zf ? 0.5 : hw, x, y, z, BLACK, false, 1), bx(zf ? hw * 0.6 : 0.56, hh * 0.5, zf ? 0.56 : hw * 0.6, x + (zf ? hw * 0.3 : 0), y + hh * 0.8, z + (zf ? 0 : hw * 0.3), BLACK));
    parts.push(bx(zf ? hw * 1.3 : 0.3, Math.min(h - y - hh, hh * 1.6 + 1), zf ? 0.3 : hw * 1.3, x, y + hh, z, SOOT, false, 1)); // smoke staining above the hole
    const ox = side === 2 ? 2 : side === 3 ? -2 : 0, oz = side === 0 ? 2 : side === 1 ? -2 : 0;
    for (let k = 0; k < 4; k++) { const s = 0.6 + r() * 1.6, g = new THREE.BoxGeometry(s, s * 0.5, s * 0.8); g.rotateY(r() * 6.28); g.translate(x + ox + (r() - 0.5) * hw * 1.5, s * 0.2, z + oz + (r() - 0.5) * hw * 1.5); parts.push(paint(g, 0x6c6860, 0.4 + r() * 0.4, false, 0.1)); }
  }
}

function buildCiv(c: Civ): THREE.BufferGeometry {
  const r = mulberry32(Math.floor(c.seed * 1e6) + 1), W = c.fw * CELL - 2, L = c.fh * CELL - 2;
  const lvl = c.dmg, char = lvl === 2 ? 0.55 : lvl === 1 ? 0.86 : 1;
  // a heavily damaged block has lost its upper storeys on one side
  const h = c.h, cut = lvl === 2 && (c.kind === 1 || c.kind === 2);
  const parts: THREE.BufferGeometry[] = [];
  if (cut) {
    const tint = 0x9a958c, long = W >= L, a = long ? W : L, keep = 0.35 + (c.seed * 7 % 1) * 0.3, lo = h * (0.3 + (c.seed * 13 % 1) * 0.25), sd = c.seed > 0.5 ? 1 : -1;
    const seg = (len: number, off: number, hh: number) => parts.push(long ? bx(len, hh, L, off, 0, 0, tint, true, char) : bx(W, hh, len, 0, 0, off, tint, true, char));
    seg(a * keep, sd * a * (1 - keep) / 2, h); seg(a * (1 - keep), -sd * a * keep / 2, lo);
    // the torn edge: floor slabs and wall stubs stepping down to the collapse
    for (let i = 0; i < 5; i++) { const hh = lo + (h - lo) * (0.15 + r() * 0.7), len = a * 0.05 + r() * a * 0.08, off = sd * (a * (0.5 - keep) - len / 2 - i * a * 0.03); parts.push(long ? bx(len, hh, L * (0.3 + r() * 0.6), off, 0, (r() - 0.5) * L * 0.3, tint, true, char * 0.8) : bx(W * (0.3 + r() * 0.6), hh, len, (r() - 0.5) * W * 0.3, 0, off, tint, true, char * 0.8)); }
    for (let k = 0; k < 16; k++) { const s = 1 + r() * 2.6, g = new THREE.BoxGeometry(s, s * 0.45, s * 0.8); g.rotateY(r() * 6.28); g.rotateZ((r() - 0.5) * 0.8); const o = -sd * a * (0.2 + r() * 0.5); g.translate(long ? o : (r() - 0.5) * (W + 6), lo + r() * 1.5, long ? (r() - 0.5) * (L + 6) : o); parts.push(paint(g, 0x6c6860, 0.3 + r() * 0.4, false, 0.1)); }
    scars(c, parts, W, L, lo, 2);
    return mergeGeometries(parts);
  }
  switch (c.kind) {
    case 0: { // house: plastered walls, pitched roof, fence
      const wall = [0xd8d2c0, 0xc9b79a, 0xbfc7c2, 0xd9c7a8, 0xa9a39a][Math.floor(r() * 5)], roofC = [0x6d3b2e, 0x4a4e52, 0x7a4a34, 0x5a6258][Math.floor(r() * 4)];
      const w = 5.2 + r() * 1, l = 5.6 + r() * 1, wh = 2.8;
      parts.push(bx(w, wh, l, 0, 0, 0, wall), bx(w * 0.62, 0.3, l + 0.6, -w * 0.24, wh + 0.75, 0, roofC, false, 1, 0, 0.62), bx(w * 0.62, 0.3, l + 0.6, w * 0.24, wh + 0.75, 0, roofC, false, 1, 0, -0.62),
        bx(w - 0.2, 1.3, 0.2, 0, wh, l / 2 - 0.1, wall, false, 0.92), bx(w - 0.2, 1.3, 0.2, 0, wh, -l / 2 + 0.1, wall, false, 0.92),
        bx(0.5, 1.6, 0.5, w * 0.2, wh + 1, -l * 0.2, 0x7a4a3a), bx(1, 1.1, 0.1, -w * 0.2, 1.1, l / 2 + 0.03, 0x1c2430), bx(1, 1.1, 0.1, w * 0.2, 1.1, l / 2 + 0.03, 0x1c2430), bx(0.9, 1.9, 0.1, w / 2 + 0.03, 0, 0, 0x3a2e24, false, 1, Math.PI / 2),
        bx(7.4, 0.9, 0.12, 0, 0, 3.7, 0x5b5348), bx(0.12, 0.9, 7.4, -3.7, 0, 0, 0x5b5348));
      break;
    }
    case 1: { // five-to-nine storey slab block
      const tint = [0xcfcac0, 0xbfb7a6, 0xc4c9c9, 0xd0c2a8, 0xb9b3aa][Math.floor(r() * 5)];
      parts.push(bx(W, h, L, 0, 0, 0, tint, true), bx(W + 0.5, 0.5, L + 0.5, 0, h, 0, 0x3a3a38), bx(W * 0.2, 1.6, L * 0.2, W * 0.2, h + 0.5, L * 0.1, 0x55554f));
      const long = W > L; for (let i = -1; i <= 1; i++) parts.push(bx(long ? 2.4 : 1.4, 2.6, long ? 1.4 : 2.4, long ? i * W * 0.3 : W / 2 + 0.6, 0, long ? L / 2 + 0.6 : i * L * 0.3, 0x6a665e));
      break;
    }
    case 2: { // tower block
      const tint = [0xc9c9c4, 0xd2cab8, 0xb8c0c4, 0xc7b9a2][Math.floor(r() * 4)], w = Math.min(W, L) - 1;
      parts.push(bx(w, h, w, 0, 0, 0, tint, true), bx(w + 0.6, 0.6, w + 0.6, 0, h, 0, 0x3a3a38), bx(w * 0.35, 2.6, w * 0.35, w * 0.15, h + 0.6, -w * 0.15, 0x5a5a55), cyl(0.08, 0.1, 5, -w * 0.3, h + 0.6, w * 0.3, 0x222222, 4),
        bx(w + 1.2, 3.2, w + 1.2, 0, 0, 0, 0x74706a), bx(1, h * 0.92, 0.5, w / 2 - 2.2, 2, w / 2 + 0.25, tint, false, 0.8), bx(1, h * 0.92, 0.5, -w / 2 + 2.2, 2, w / 2 + 0.25, tint, false, 0.8));
      break;
    }
    case 3: { // warehouse / workshop
      const wall = [0x8a8f94, 0x7f8478, 0x9a8f80, 0x6f7a84][Math.floor(r() * 4)];
      parts.push(bx(W, h * 0.75, L, 0, 0, 0, wall), bx(W * 0.54, 0.4, L + 0.6, -W * 0.25, h * 0.75 + W * 0.07, 0, 0x4c5054, false, 1, 0, 0.3), bx(W * 0.54, 0.4, L + 0.6, W * 0.25, h * 0.75 + W * 0.07, 0, 0x4c5054, false, 1, 0, -0.3),
        bx(W * 0.3, h * 0.55, 0.2, 0, 0, L / 2 + 0.05, 0x2a2c2e), bx(W, 0.5, 0.15, 0, h * 0.5, L / 2 + 0.06, 0x30343a), bx(W, 0.5, 0.15, 0, h * 0.5, -L / 2 - 0.06, 0x30343a));
      if (r() < 0.6) parts.push(cyl(0.7, 0.9, h * 1.6, W * 0.32, 0, -L * 0.3, 0x8a5a48, 8), cyl(0.75, 0.75, 0.8, W * 0.32, h * 1.5, -L * 0.3, 0xdddddd, 8));
      break;
    }
    case 4: { // parish church / Lavra: white walls, green roof, gold onion domes
      const w = W * 0.7;
      parts.push(bx(w, h * 0.45, L * 0.86, 0, 0, 0, WHITE), bx(w * 0.6, 0.4, L * 0.9, -w * 0.23, h * 0.45 + 1.4, 0, GREEN, false, 1, 0, 0.6), bx(w * 0.6, 0.4, L * 0.9, w * 0.23, h * 0.45 + 1.4, 0, GREEN, false, 1, 0, -0.6),
        cyl(2.2, 2.4, h * 0.3, 0, h * 0.45, 0, WHITE, 10), ...dome(2.7, 0, h * 0.75, 0, GOLD),
        bx(3.4, h * 0.7, 3.4, 0, 0, L * 0.36, WHITE), cyl(1.3, 1.5, 2.4, 0, h * 0.7, L * 0.36, WHITE, 8), ...dome(1.5, 0, h * 0.7 + 2.4, L * 0.36, GOLD),
        bx(1.6, 3, 0.2, 0, 0, L * 0.36 + 1.75, 0x3a2a1e));
      break;
    }
    case 5: { // St Sophia: thirteen domes in the original, five here
      parts.push(bx(W * 0.8, 9, L * 0.8, 0, 0, 0, WHITE), bx(W * 0.84, 0.6, L * 0.84, 0, 9, 0, GREEN), bx(W * 0.5, 4, L * 0.5, 0, 9.6, 0, WHITE), bx(W * 0.54, 0.5, L * 0.54, 0, 13.6, 0, GREEN),
        cyl(2.6, 2.8, 5, 0, 14, 0, WHITE, 12), ...dome(3.2, 0, 19, 0, GOLD));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(cyl(1.5, 1.6, 3.6, sx * W * 0.27, 9.6, sz * L * 0.27, WHITE, 10), ...dome(1.8, sx * W * 0.27, 13.2, sz * L * 0.27, sx * sz > 0 ? GOLD : GREEN));
      // bell tower
      parts.push(bx(3.6, 11, 3.6, W * 0.42, 0, L * 0.42, 0x8fb6c9), bx(3, 7, 3, W * 0.42, 11, L * 0.42, WHITE), bx(2.4, 5, 2.4, W * 0.42, 18, L * 0.42, 0x8fb6c9), ...dome(1.6, W * 0.42, 23, L * 0.42, GOLD));
      break;
    }
    case 6: { // Motherland Monument: stainless-steel figure with sword and shield on a museum plinth
      const ST = 0xaab0b6;
      parts.push(cyl(6, 7.4, 7, 0, 0, 0, 0x8d8a84, 16), cyl(3.4, 5, 14, 0, 7, 0, 0x9a968e, 12),
        cyl(1.7, 3.2, 20, 0, 21, 0, ST, 10), cyl(2.3, 1.8, 8, 0, 39, 0, ST, 10), dome(1.2, 0, 48.6, 0, ST, 1)[0],
        bx(1.1, 13, 1.1, 3.2, 44, 0, ST, false, 1, 0, -0.32), bx(0.34, 11, 1.0, 5.4, 55, 0, ST, false, 1.1), bx(1.8, 0.3, 0.5, 5.4, 55.4, 0, ST),
        bx(1.1, 11, 1.1, -3, 43.5, 0, ST, false, 1, 0, 0.36), bx(0.5, 6.5, 4.2, -5.2, 50, 0, ST, false, 1.05), bx(0.2, 2.4, 2, -5.5, 52, 0, GOLD));
      break;
    }
    case 7: { // Independence Monument on the Maidan
      parts.push(cyl(3, 3.4, 2, 0, 0, 0, 0xcfcac0, 14), bx(3.2, 5, 3.2, 0, 2, 0, WHITE), cyl(0.9, 1.1, 21, 0, 7, 0, WHITE, 12), cyl(1.5, 1, 1.4, 0, 28, 0, GOLD, 10),
        cyl(0.5, 0.9, 3.6, 0, 29.4, 0, GOLD, 8), dome(0.5, 0, 33, 0, GOLD, 1)[0], bx(3.4, 0.2, 0.8, 0, 31.6, 0, GOLD), bx(2.4, 1.6, 0.14, 0, 32.4, -0.3, GOLD));
      break;
    }
    case 8: { // TV tower: steel lattice
      const RD = 0xb8442e, WT = 0xd8d8d2;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const g = new THREE.BoxGeometry(0.7, 46, 0.7); g.translate(0, 23, 0); g.rotateZ(-sx * 0.13); g.rotateX(sz * 0.13); g.translate(sx * 6.4, 0, sz * 6.4); parts.push(paint(g, WT, 1, false));
      }
      parts.push(bx(13, 0.8, 13, 0, 15, 0, RD), bx(7, 1.2, 7, 0, 30, 0, WT), bx(3.6, 3, 3.6, 0, 44, 0, 0x6a7078), cyl(0.9, 1.1, 14, 0, 47, 0, RD, 8), cyl(0.8, 0.9, 12, 0, 61, 0, WT, 8),
        cyl(0.6, 0.8, 12, 0, 73, 0, RD, 8), cyl(0.25, 0.5, 11, 0, 85, 0, WT, 6), bx(0.4, 46, 0.4, 0, 0, 0, 0x55585c));
      break;
    }
    default: { // Antonov hangar
      const g = new THREE.CylinderGeometry(L * 0.5, L * 0.5, W, 16, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.scale(1, h / (L * 0.5), 1);
      parts.push(paint(g, 0x8c9296, 1, false, 0.05), bx(W, 0.6, L, 0, 0, 0, 0x6f7275), bx(0.4, h * 0.9, L * 0.9, -W / 2 + 0.3, 0, 0, 0x7a8084), bx(0.4, h * 0.5, L * 0.7, W / 2 - 0.3, 0, 0, 0x2c3034), bx(6, 3, 10, 0, 0, L / 2 + 5, 0x7d8286));
    }
  }
  if (lvl) {
    for (const g of parts) { const col = g.attributes.color.array as Float32Array; for (let i = 0; i < col.length; i++) col[i] *= char; }
    scars(c, parts, c.kind === 2 ? Math.min(W, L) - 1 : c.kind === 0 ? 5.6 : W * (c.kind >= 4 && c.kind <= 8 ? 0.7 : 1), c.kind === 2 ? Math.min(W, L) - 1 : c.kind === 0 ? 6 : L * (c.kind >= 4 && c.kind <= 8 ? 0.7 : 1), c.kind === 0 ? 2.8 : c.kind === 3 ? h * 0.75 : c.kind === 4 ? h * 0.45 : c.kind === 5 ? 9 : c.kind >= 6 && c.kind <= 8 ? 7 : h, lvl);
  }
  return mergeGeometries(parts);
}

/** what is left after a building collapses: stumps of wall, a rubble mound, charred everything */
function buildRuin(c: Civ): THREE.BufferGeometry {
  const r = mulberry32(Math.floor(c.seed * 1e6) + 9), W = c.fw * CELL - 2, L = c.fh * CELL - 2, h = Math.min(c.h, 34);
  const parts: THREE.BufferGeometry[] = [];
  const tiled = c.kind === 1 || c.kind === 2, col = c.kind === 6 || c.kind === 8 ? 0x6a6e72 : 0x8a857c;
  const nx = Math.max(2, Math.round(W / 5)), nz = Math.max(2, Math.round(L / 5));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
    if (!edge && r() < 0.7) continue;
    const hh = h * (edge ? 0.08 + r() * r() * 0.6 : 0.05 + r() * 0.2), w = W / nx, l = L / nz;
    if (r() < 0.2) continue;
    parts.push(bx(w * (0.5 + r() * 0.5), hh, l * (0.5 + r() * 0.5), -W / 2 + (i + 0.5) * w, 0, -L / 2 + (j + 0.5) * l, col, tiled, 0.3 + r() * 0.35));
  }
  for (let k = 0; k < 10 + W * L / 14; k++) {
    const s = 0.8 + r() * 2.6, g = new THREE.BoxGeometry(s, s * (0.3 + r() * 0.5), s * (0.6 + r() * 0.8));
    g.rotateY(r() * 6.28); g.rotateZ((r() - 0.5) * 0.9); g.translate((r() - 0.5) * (W + 4), r() * Math.min(2.4, h * 0.1), (r() - 0.5) * (L + 4));
    parts.push(paint(g, r() < 0.2 ? 0x4a3a30 : 0x6c6860, 0.35 + r() * 0.4, false, 0.1));
  }
  parts.push(bx(W + 2, 0.5, L + 2, 0, 0, 0, 0x4a4742, false, 0.6));
  return mergeGeometries(parts);
}

/** a bridge along local x; once dead, only the abutments and piers stand and the spans lie broken in the river */
function bridgeGeo(b: Bridge): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [], L = b.len, big = L > 120, r = mulberry32(Math.round(b.x * 7 + b.z));
  const span = (x0: number, x1: number, y: number, tilt: number, k = 1) => {
    const l = x1 - x0, xm = (x0 + x1) / 2;
    P.push(bx(l, 1.1, 24, xm, y - 1.3, 0, 0x4a4b4c, false, k, 0, tilt), bx(l, 0.5, 1.4, xm, y - 0.2, 11.4, 0x8d8b84, false, k, 0, tilt), bx(l, 0.5, 1.4, xm, y - 0.2, -11.4, 0x8d8b84, false, k, 0, tilt));
    if (!tilt) { P.push(bx(l, 0.12, 0.5, xm, y - 0.18, 0, 0xc8c4b0)); for (const s of [-1, 1]) { P.push(bx(l, 0.22, 0.22, xm, y + 1.7, s * 11.6, 0x70767c), bx(l, 0.16, 0.16, xm, y + 1.0, s * 11.6, 0x70767c)); for (let x = x0 + 2; x <= x1 - 1; x += 8) P.push(bx(0.3, 1.5, 0.3, x, y + 0.3, s * 11.6, 0x70767c)); } }
  };
  for (let x = -L / 2 + 14; x <= L / 2 - 10; x += big ? 30 : 22) P.push(bx(4, b.dead ? 9 + r() * 5 : 14, 20, x, -15, 0, 0x7d7a72, false, b.dead ? 0.7 : 1));
  if (!b.dead && b.pontoon) { // a floating military bridge: steel treadway on a row of pontoons, lying between the stumps of the old one
    span(-L / 2, -L / 2 + 12, 0, 0); span(L / 2 - 12, L / 2, 0, 0);
    P.push(bx(L - 22, 0.5, 11, 0, -0.9, 0, 0x4a5238), bx(L - 22, 0.4, 0.5, 0, -0.4, 5.4, 0x39402c), bx(L - 22, 0.4, 0.5, 0, -0.4, -5.4, 0x39402c));
    for (let x = -L / 2 + 14; x <= L / 2 - 14; x += 7.5) P.push(bx(6.2, 1.7, 16, x, -2.7, 0, 0x424a34));
  } else if (!b.dead) {
    span(-L / 2, L / 2, 0, 0);
    if (big) for (const s of [-1, 1]) for (let x = -L / 2 + 14; x < L / 2 - 30; x += 30) { // steel arch spans
      const pt = (k: number) => [x + 15 - Math.cos(k / 6 * Math.PI) * 15, Math.sin(k / 6 * Math.PI) * 7];
      for (let k = 0; k < 6; k++) { const a = pt(k), c = pt(k + 1); P.push(bx(Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.3, 0.6, 0.6, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2, s * 12.2, 0x5c6a72, false, 1, 0, Math.atan2(c[1] - a[1], c[0] - a[0]))); }
      for (let k = 1; k < 6; k++) P.push(bx(0.2, pt(k)[1], 0.2, pt(k)[0], 0.3, s * 12.2, 0x5c6a72));
    }
  } else {
    span(-L / 2, -L / 2 + 12, 0, 0); span(L / 2 - 12, L / 2, 0, 0);
    for (let x = -L / 2 + 14; x < L / 2 - 16; x += 20) span(x, x + 17, -5 - r() * 3, (r() - 0.5) * 0.7, 0.55);
    for (let k = 0; k < 14; k++) { const s = 1.5 + r() * 3, g = new THREE.BoxGeometry(s, s * 0.4, s * 0.8); g.rotateY(r() * 6.28); g.rotateZ((r() - 0.5)); g.translate((r() - 0.5) * (L - 24), -4.5 - r() * 2, (r() - 0.5) * 30); P.push(paint(g, 0x5a5856, 0.4 + r() * 0.3, false, 0.1)); }
  }
  const g = mergeGeometries(P); g.deleteAttribute('uv'); return g;
}

function figure(lying: boolean): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const b = (w: number, h: number, l: number, x: number, y: number, z: number, hex: number, ry = 0) => { const g = new THREE.BoxGeometry(w, h, l); if (ry) g.rotateY(ry); g.translate(x, y, z); P.push(paint(g, hex, 1, false, 0.04)); };
  const SKIN = 0xc8a084;
  if (lying) {
    b(1.3, 0.55, 1.7, 0, 0.3, 0, 0xffffff); b(0.5, 0.42, 1.9, -0.42, 0.24, -1.7, 0xd8d8d8, 0.14); b(0.5, 0.42, 1.9, 0.5, 0.24, -1.65, 0xd8d8d8, -0.3);
    b(0.4, 0.36, 1.4, -1.05, 0.2, 0.5, 0xffffff, 0.9); b(0.4, 0.36, 1.4, 0.95, 0.2, -0.1, 0xffffff, -0.3);
    const hd = new THREE.SphereGeometry(0.4, 8, 6); hd.translate(0.1, 0.36, 1.25); P.push(paint(hd, SKIN, 1, false, 0));
    b(0.5, 0.36, 0.9, -0.42, 0.2, -2.7, 0x333333, 0.14); b(0.5, 0.36, 0.9, 0.8, 0.2, -2.6, 0x333333, -0.3);
  } else {
    b(0.46, 1.9, 0.5, -0.3, 0.95, 0, 0x55555e); b(0.46, 1.9, 0.5, 0.3, 0.95, 0, 0x55555e); b(1.2, 1.7, 0.7, 0, 2.75, 0, 0xffffff);
    b(0.34, 1.5, 0.4, -0.78, 2.7, 0, 0xffffff); b(0.34, 1.5, 0.4, 0.78, 2.7, 0, 0xffffff);
    const hd = new THREE.SphereGeometry(0.38, 8, 6); hd.translate(0, 3.95, 0); P.push(paint(hd, SKIN, 1, false, 0));
    b(0.8, 0.26, 0.8, 0, 4.2, 0, 0x403a34);
  }
  const g = mergeGeometries(P); g.deleteAttribute('uv'); return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _y = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _nn = { x: 0, y: 1, z: 0 };
const UNIFORM = [new THREE.Color(0x70745a), new THREE.Color(0x4a563e)];
const COATS = [0x3a4a6a, 0x7a2f2a, 0x4a4a4a, 0x8a7a5a, 0x2f5a4a, 0xa0a0a8, 0x5a3a5a, 0x1f2a3a].map(h => new THREE.Color(h));

export class World {
  private map: GameMap; private meshes: (THREE.Mesh | null)[] = []; private mat: THREE.MeshStandardMaterial; private ruinMat: THREE.MeshStandardMaterial;
  private scene: THREE.Scene; private bodyIM: THREE.InstancedMesh; private bloodIM: THREE.InstancedMesh; private civIM: THREE.InstancedMesh;
  private uSnow = { value: 0 }; private t = 0; private bkey: string[] = []; private bridges: THREE.Mesh[] = []; private bridgeMat!: THREE.Material; private quality = 0; private hitMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, map: GameMap, quality: number) {
    this.map = map; this.scene = scene;
    const tex = facadeTextures();
    const snowy = (m: THREE.MeshStandardMaterial) => {
      m.onBeforeCompile = sh => {
        sh.uniforms.uSnow = this.uSnow;
        sh.vertexShader = 'varying float vNy; varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vNy = normal.y; vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
        sh.fragmentShader = 'varying float vNy; varying vec3 vWp; uniform float uSnow;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float gr = fract(sin(dot(floor(vWp.xz * 1.7) + floor(vWp.y * 2.3), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= 0.86 + 0.2 * gr;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), uSnow * smoothstep(0.45, 0.9, vNy) * 0.9);`);
      };
      return m;
    };
    this.mat = snowy(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.map, emissiveMap: tex.lit, emissive: 0xffffff, emissiveIntensity: 0, normalMap: tex.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: tex.rough, roughness: 1, metalness: 0, envMapIntensity: 1.1 }));
    const btex = facadeTextures(true);
    this.hitMat = snowy(new THREE.MeshStandardMaterial({ vertexColors: true, map: btex.map, normalMap: btex.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: btex.rough, roughness: 1, metalness: 0, envMapIntensity: 0.6 }));
    this.ruinMat = snowy(new THREE.MeshStandardMaterial({ vertexColors: true, map: btex.map, normalMap: btex.normal, roughness: 1, metalness: 0, envMapIntensity: 0.15 }));
    for (const c of map.civ) {
      const m = new THREE.Mesh(c.state ? buildRuin(c) : buildCiv(c), c.dmg >= 2 ? this.ruinMat : c.dmg === 1 ? this.hitMat : this.mat);
      m.position.set(c.x, map.groundY(c.x, c.z) - 0.3, c.z); m.castShadow = quality >= 1; m.receiveShadow = true; m.visible = false; m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m); this.meshes.push(m);
    }
    // bridges: deck, kerbs, railings, piers
    const bm = snowy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05 }));
    this.bridgeMat = bm; this.quality = quality;
    for (const b of map.bridges) {
      const m = new THREE.Mesh(bridgeGeo(b), bm); m.position.set(b.x, map.waterY + 3.4, b.z); m.rotation.y = b.ang; m.castShadow = quality >= 1; m.receiveShadow = true; m.visible = false; scene.add(m); this.bridges.push(m);
    }
    const im = (g: THREE.BufferGeometry, cap: number, mat: THREE.Material) => { const m = new THREE.InstancedMesh(g, mat, cap); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _c.set(0xffffff)); scene.add(m); return m; };
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.bodyIM = im(figure(true), 3000, cloth); this.bodyIM.receiveShadow = true;
    this.civIM = im(figure(false), 400, cloth); this.civIM.castShadow = quality >= 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d')!;
    const img = cx.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const d = Math.hypot(x - 32, y - 32) / 32 + (tile(x, y, 64, 6, 5) - 0.5) * 0.5, i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = d < 0.75 ? 235 : d < 1 ? 235 * (1 - d) * 4 : 0; }
    cx.putImageData(img, 0, 0);
    const pg = new THREE.PlaneGeometry(2, 2); pg.rotateX(-Math.PI / 2);
    this.bloodIM = im(pg, 3000, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    this.bloodIM.renderOrder = 3;
  }

  /** a bridge has been brought down */
  dropBridge(i: number) { const m = this.bridges[i]; if (!m) return; m.geometry.dispose(); m.geometry = bridgeGeo(this.map.bridges[i]); }
  /** a building's damage level has changed: rebuild it holed, half-collapsed, or as rubble */
  refresh(c: Civ) {
    const m = this.meshes[c.id]; if (!m) return;
    m.geometry.dispose(); m.geometry = c.state ? buildRuin(c) : buildCiv(c); m.material = c.dmg >= 2 ? this.ruinMat : c.dmg === 1 ? this.hitMat : this.mat;
  }

  update(game: Game, me: Team, dt: number, T: number, night: number, paused: boolean) {
    const map = this.map, vis = me.vis;
    this.uSnow.value = game.snow; this.mat.emissiveIntensity = night * 1.5;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.4;
      map.bridges.forEach((b, i) => { const k = b.dead ? 'd' : b.pontoon ? 'p' : 'o'; if (this.bkey[i] !== undefined && this.bkey[i] !== k) this.dropBridge(i); this.bkey[i] = k; });
      map.bridges.forEach((b, i) => { if (!this.bridges[i].visible && (vis[map.cellOf(b.x, b.z)] & 1)) this.bridges[i].visible = true; });
      for (const c of map.civ) { const m = this.meshes[c.id]; if (m && !m.visible && (vis[map.cellOf(c.x, c.z)] & 1)) m.visible = true; }
    }
    // the dead: fresh, then bloated and darkening, then collapsing into the ground, then bones
    let n = 0, nb = 0;
    const dayTicks = TICK * YEAR_SECS / 365, snow = game.snow;
    for (const b of game.bodies) {
      if (n >= 3000 || !(vis[map.cellOf(b.x, b.z)] & 1)) continue;
      const age = (game.tick - b.born) / dayTicks;
      let sy = 1, sxz = 1; const col = _c;
      if (b.fac < 2) col.copy(UNIFORM[b.fac]); else col.copy(COATS[b.id % COATS.length]);
      if (age > 45) { sy = 0.3; sxz = 0.8; col.setRGB(0.34, 0.31, 0.25); }
      else if (age > 14) { const k = (age - 14) / 31; sy = lerp(0.8, 0.4, k); col.lerp(_c2.setRGB(0.1, 0.085, 0.06), 0.75 + 0.15 * k); }
      else if (age > 3) { const k = (age - 3) / 11; sy = 1 + 0.3 * Math.sin(k * Math.PI); col.lerp(_c2.setRGB(0.2, 0.22, 0.14), k * 0.7); }
      if (snow > 0.05) col.lerp(_c2.setRGB(0.85, 0.87, 0.9), snow * Math.min(0.75, age / 6));
      map.normalAt(b.x, b.z, _nn); _n.set(_nn.x, _nn.y, _nn.z);
      _q.setFromUnitVectors(_y, _n); _q2.setFromAxisAngle(_y, b.rot); _q.multiply(_q2);
      _p.set(b.x, b.y + 0.05, b.z); _s.set(sxz, sy, sxz); _m.compose(_p, _q, _s);
      this.bodyIM.setMatrixAt(n, _m); this.bodyIM.setColorAt(n, col); n++;
      if (age < 30) {
        const k = Math.min(1, age / 8), fade = age > 20 ? 1 - (age - 20) / 10 : 1, grow = Math.min(1, 0.35 + (game.tick - b.born) / (TICK * 14));
        _s.setScalar((1.2 + (b.id % 5) * 0.2) * grow * fade); _p.set(b.x + 0.4, b.y + 0.12, b.z + 0.3); _q.setFromUnitVectors(_y, _n); _m.compose(_p, _q, _s);
        this.bloodIM.setMatrixAt(nb, _m); this.bloodIM.setColorAt(nb, col.setRGB(lerp(0.26, 0.07, k), lerp(0.015, 0.025, k), lerp(0.015, 0.02, k)).lerp(_c2.setRGB(0.8, 0.82, 0.85), snow > 0.3 ? Math.min(0.6, age / 10) : 0)); nb++;
      }
    }
    this.bodyIM.count = n; this.bodyIM.instanceMatrix.needsUpdate = true; if (this.bodyIM.instanceColor) this.bodyIM.instanceColor.needsUpdate = true;
    this.bloodIM.count = nb; this.bloodIM.instanceMatrix.needsUpdate = true; if (this.bloodIM.instanceColor) this.bloodIM.instanceColor.needsUpdate = true;
    // the living
    let nc = 0;
    for (const c of game.civilians) {
      if (c.dead || nc >= 400 || !(vis[map.cellOf(c.x, c.z)] & 2)) continue;
      const bob = c.moving && !paused ? Math.abs(Math.sin(T * (c.flee > 0 ? 14 : 7) + c.id)) * 0.25 : 0;
      _q.setFromAxisAngle(_y, c.h); if (c.flee > 0 && c.moving) { _q2.setFromAxisAngle(_x, 0.25); _q.multiply(_q2); }
      _p.set(c.x, map.heightAt(c.x, c.z) + bob, c.z); _s.setScalar(0.92 + (c.id % 7) * 0.025); _m.compose(_p, _q, _s);
      this.civIM.setMatrixAt(nc, _m); this.civIM.setColorAt(nc, COATS[c.id % COATS.length]); nc++;
    }
    this.civIM.count = nc; this.civIM.instanceMatrix.needsUpdate = true; if (this.civIM.instanceColor) this.civIM.instanceColor.needsUpdate = true;
  }
}
const _c2 = new THREE.Color(), _x = new THREE.Vector3(1, 0, 0);
