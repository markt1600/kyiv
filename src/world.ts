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

/**
 * Depth for a block's long faces, so it holds up from the pavement: a balcony under some windows (a few glazed in, a few
 * hung with washing), air-conditioning boxes, satellite dishes, a downpipe at each end. `a` runs along the face, `d` is the depth.
 */
function facadeKit(parts: THREE.BufferGeometry[], r: () => number, a: number, d: number, h: number, alongX: boolean, tint: number) {
  const put = (w: number, hh: number, dp: number, along: number, y: number, side: number, hex: number, k = 1) => parts.push(alongX ? bx(w, hh, dp, along, y, side * (d / 2 + dp / 2), hex, false, k) : bx(dp, hh, w, side * (d / 2 + dp / 2), y, along, hex, false, k));
  const floors = Math.floor(h / FLOOR), k0 = Math.ceil((-a / 2 + 1.7) / BAY - 0.5), k1 = Math.floor((a / 2 - 1.7) / BAY - 0.5);
  for (const side of [-1, 1]) {
    for (let f = 1; f < floors; f++) for (let k = k0; k <= k1; k++) {
      const x = (k + 0.5) * BAY, q = r();
      if (q < 0.34) { // balcony slab and parapet, sometimes glazed in, sometimes with washing on the line
        put(2.7, 0.16, 1.0, x, f * FLOOR + 0.32, side, 0x8a867e); put(2.7, 0.9, 0.12, x, f * FLOOR + 0.48, side * (1 + 1.76 / d), [tint, 0x7f8a92, 0x8c7a66, 0x9aa39a][Math.floor(r() * 4)], 0.8);
        if (q < 0.1) put(2.6, 1.3, 0.1, x, f * FLOOR + 1.4, side * (1 + 1.76 / d), 0x2c3a44);
        else if (q < 0.16) put(1.6, 0.7, 0.06, x + 0.3, f * FLOOR + 1.3, side * (1 + 1.5 / d), [0xd8d4c8, 0x8a3028, 0x3a5a8a][Math.floor(r() * 3)]);
      } else if (q < 0.42) put(0.9, 0.6, 0.5, x + 0.9, f * FLOOR + 0.5, side, 0xc8c8c2); // air conditioner
      else if (q < 0.45) put(0.7, 0.7, 0.3, x - 1, f * FLOOR + 2.3, side, 0xd8d8d2);       // satellite dish
    }
    put(0.22, h - 0.5, 0.22, -a / 2 + 0.5, 0.2, side, 0x4a4c4e); put(0.22, h - 0.5, 0.22, a / 2 - 0.5, 0.2, side, 0x4a4c4e); // downpipes
    put(a, 0.7, 0.12, 0, 0, side, 0x55524c); // plinth
  }
}

/** an arched window or doorway set into a wall: dark opening, pale surround, sill. `ax` is the wall's outward normal axis */
function opening(parts: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, hh: number, ax: 'x' | 'z', sgn: number, dark = 0x141a22, frame = 0xf0ece2) {
  const t = 0.16, o = sgn * 0.09;
  const b = (ww: number, h2: number, dx: number, dy: number, hex: number, out: number) => parts.push(ax === 'z' ? bx(ww, h2, t, x + dx, y + dy, z + sgn * out, hex) : bx(t, h2, ww, x + sgn * out, y + dy, z + dx, hex));
  b(w + 0.36, hh + 0.3, 0, -0.1, frame, 0.02); b(w, hh, 0, 0, dark, 0.1); b(w * 0.7, w * 0.3, 0, hh, dark, 0.1); b(w * 0.7 + 0.3, w * 0.3 + 0.16, 0, hh, frame, 0.02); b(w + 0.6, 0.14, 0, -0.2, frame, 0.16);
  void o;
}
/** Close-range detail for everything that is not an apartment block: windows, doors, cornices, steps, bracing, pipes. */
function detailKit(c: Civ, parts: THREE.BufferGeometry[], r: () => number, W: number, L: number, h: number) {
  const STONE = 0xbdb8ac, DARK = 0x141a22;
  switch (c.kind) {
    case 0: { // house: window frames and shutters, a door with a step and a little porch roof, gutter and downpipe, a woodpile
      const sh = [0x3a5a6a, 0x5a3a2a, 0x3c5a3a, 0x6a6a5a][Math.floor(r() * 4)];
      for (const sx of [-1, 1]) { parts.push(bx(1.24, 1.34, 0.06, sx * 1.1, 0.98, 3.0, 0xf0ece2), bx(0.3, 1.1, 0.08, sx * 1.1 - 0.68, 1.1, 3.02, sh), bx(0.3, 1.1, 0.08, sx * 1.1 + 0.68, 1.1, 3.02, sh), bx(1.5, 0.1, 0.24, sx * 1.1, 0.95, 3.06, 0xd8d4c8)); }
      parts.push(bx(1.3, 0.2, 0.8, 3.0, 0, 0, 0x8a867e, false, 1, Math.PI / 2), bx(1.5, 0.12, 1.1, 3.1, 2.1, 0, 0x55504a, false, 1, Math.PI / 2), bx(0.12, 2.8, 0.12, -2.7, 0, 2.9, 0x4a4c4e), bx(5.6, 0.12, 0.16, 0, 2.74, 3.1, 0x4a4c4e),
        bx(1.8, 0.9, 0.7, -2.2, 0, -3.3, 0x6a4a30), bx(0.9, 0.5, 0.9, 2.6, 0, 3.4, 0x3f5a3a));
      break;
    }
    case 3: { // warehouse: ribbed roller door, a strip of high windows, loading dock, roof vents, a stack of pallets
      const hh = h * 0.75;
      for (let i = 0; i < 6; i++) parts.push(bx(W * 0.3, 0.1, 0.06, 0, hh * 0.55 * (i + 0.5) / 6, L / 2 + 0.18, 0x3c4044));
      for (let x = -W / 2 + 1.6; x < W / 2 - 1; x += 2.6) parts.push(bx(1.7, 0.8, 0.1, x, hh * 0.72, -L / 2 - 0.06, 0x2a3640), bx(1.9, 0.1, 0.14, x, hh * 0.72 - 0.1, -L / 2 - 0.08, 0xc8c8c0));
      parts.push(bx(W * 0.42, 0.9, 2.4, 0, 0, L / 2 + 1.2, 0x7c7a74), bx(0.9, 2.1, 0.1, -W * 0.34, 0, L / 2 + 0.06, 0x2a2622), bx(1.4, 1.2, 1.2, W * 0.36, 0, L / 2 + 1, 0x8c7a52), bx(1.4, 0.9, 1.2, W * 0.36 + 0.2, 1.2, L / 2 + 1, 0x7a6a48),
        cyl(0.5, 0.5, 0.9, -W * 0.2, hh + 0.6, 0, 0x8a8e92, 8), cyl(0.5, 0.5, 0.9, W * 0.2, hh + 0.6, 0, 0x8a8e92, 8), bx(0.16, hh, 0.16, -W / 2 - 0.1, 0, L / 2 - 0.4, 0x4a4c4e), bx(0.16, hh, 0.16, W / 2 + 0.1, 0, -L / 2 + 0.4, 0x4a4c4e));
      break;
    }
    case 4: { // church: arched windows down the nave, cornice and plinth, belfry openings, steps and a canopy at the door
      const w = W * 0.7, nl = L * 0.86, wy = h * 0.14;
      for (const sx of [-1, 1]) for (const k of [-0.3, 0, 0.3]) opening(parts, sx * w / 2, wy, k * nl, 1.0, h * 0.16, 'x', sx);
      opening(parts, 0, wy, -nl / 2, 1.2, h * 0.18, 'z', -1);
      parts.push(bx(w + 0.5, 0.4, nl + 0.5, 0, h * 0.45 - 0.4, 0, STONE), bx(w + 0.4, 0.6, nl + 0.4, 0, 0, 0, STONE, false, 0.85), bx(3.9, 0.36, 3.9, 0, h * 0.7 - 0.36, L * 0.36, STONE), bx(3.8, 0.5, 3.8, 0, h * 0.42, L * 0.36, STONE));
      for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1]] as ['x' | 'z', number][]) opening(parts, ax === 'x' ? sg * 1.7 : 0, h * 0.52, L * 0.36 + (ax === 'z' ? sg * 1.7 : 0), 0.9, h * 0.1, ax, sg);
      parts.push(bx(3, 0.3, 1.6, 0, 0, L * 0.36 + 2.6, 0x9a968e), bx(2.4, 0.3, 1, 0, 0.3, L * 0.36 + 2.3, 0x9a968e), bx(2.6, 0.2, 1.4, 0, 3.3, L * 0.36 + 2.2, GREEN));
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; parts.push(bx(0.5, h * 0.16, 0.12, Math.sin(a) * 2.32, h * 0.52, Math.cos(a) * 2.32, DARK, false, 1, a)); }
      break;
    }
    case 5: { // St Sophia: two tiers of arched windows, cornices, a pedimented west door, the bell tower's arcades
      const hw = W * 0.4, hl = L * 0.4;
      for (const sg of [-1, 1]) for (const k of [-0.55, -0.18, 0.18, 0.55]) { opening(parts, sg * hw, 1.6, k * hl, 1.1, 2.6, 'x', sg); opening(parts, sg * hw, 5.8, k * hl, 0.9, 1.6, 'x', sg); opening(parts, k * hw, 1.6, sg * hl, 1.1, 2.6, 'z', sg); opening(parts, k * hw, 5.8, sg * hl, 0.9, 1.6, 'z', sg); }
      parts.push(bx(W * 0.82, 0.3, L * 0.82, 0, 4.9, 0, STONE), bx(W * 0.82, 0.7, L * 0.82, 0, 0, 0, STONE, false, 0.85), bx(4, 0.4, 2, 0, 0, hl + 1.2, 0x9a968e), bx(3.4, 4.4, 0.5, 0, 0, hl + 0.3, WHITE), bx(1.6, 3, 0.2, 0, 0, hl + 0.62, 0x3a2a1e), bx(4, 0.5, 0.9, 0, 4.4, hl + 0.4, GREEN));
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; parts.push(bx(0.55, 2.6, 0.12, Math.sin(a) * 2.76, 15, Math.cos(a) * 2.76, DARK, false, 1, a)); }
      const tx = W * 0.42, tz = L * 0.42;
      for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]] as ['x' | 'z', number][]) { const ox = ax === 'x' ? sg : 0, oz = ax === 'z' ? sg : 0; opening(parts, tx + ox * 1.8, 5, tz + oz * 1.8, 1.0, 3, ax, sg); opening(parts, tx + ox * 1.5, 12.6, tz + oz * 1.5, 1.0, 3.2, ax, sg, DARK, 0xdfe8ee); opening(parts, tx + ox * 1.2, 19, tz + oz * 1.2, 0.8, 2.2, ax, sg); }
      parts.push(bx(4.1, 0.4, 4.1, tx, 10.7, tz, WHITE), bx(3.5, 0.4, 3.5, tx, 17.7, tz, WHITE), bx(2.9, 0.4, 2.9, tx, 22.7, tz, WHITE));
      break;
    }
    case 6: { // Motherland Monument: the museum drum gets doors, ribs and a terrace; the figure gets the folds of her robe
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; parts.push(bx(0.5, 6.4, 0.5, Math.sin(a) * 7.0, 0.2, Math.cos(a) * 7.0, 0x7a7770, false, 1, a), bx(1.5, 3.2, 0.16, Math.sin(a + 0.196) * 6.9, 1.2, Math.cos(a + 0.196) * 6.9, i % 4 ? 0x1c242c : 0x3a2a1e, false, 1, a + 0.196)); }
      parts.push(cyl(8.6, 9, 0.7, 0, 0, 0, 0x8a867e, 18), cyl(7.7, 7.7, 0.5, 0, 7, 0, 0x6f6c66, 18), cyl(5.2, 5.2, 0.4, 0, 20.6, 0, 0x8d8a84, 14));
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, g = new THREE.BoxGeometry(0.3, 19, 0.5); g.translate(0, 9.5, 0); g.rotateX(0.075); g.rotateY(a); g.translate(Math.sin(a) * 2.6, 21.5, Math.cos(a) * 2.6); parts.push(paint(g, 0x9aa0a6, 1, false, 0.04)); }
      parts.push(bx(3.6, 2.2, 2.4, 0, 43, 0, 0xaab0b6), bx(1.5, 1.2, 1.5, 0, 46.6, 0, 0xaab0b6));
      break;
    }
    case 7: { // Independence Monument: stepped base, banded column, capital
      parts.push(cyl(4.6, 5, 0.5, 0, 0, 0, 0xb8b4a8, 16), cyl(3.8, 4.2, 0.5, 0, 0.5, 0, 0xc4c0b4, 16), bx(3.6, 0.4, 3.6, 0, 6.9, 0, STONE), bx(3.5, 0.4, 3.5, 0, 2, 0, STONE), cyl(1.25, 1.25, 0.5, 0, 7.1, 0, GOLD, 12), cyl(1.3, 1, 0.9, 0, 27.2, 0, WHITE, 12));
      for (const y of [11, 15, 19, 23]) parts.push(cyl(1.08, 1.1, 0.3, 0, y, 0, 0xd8d4c8, 12));
      for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]] as ['x' | 'z', number][]) parts.push(ax === 'x' ? bx(0.14, 2.6, 2, sg * 1.66, 3.2, 0, GOLD, false, 0.8) : bx(2, 2.6, 0.14, 0, 3.2, sg * 1.66, GOLD, false, 0.8));
      break;
    }
    case 8: { // TV tower: cross-bracing between the legs, platform rails, dishes and aerials
      for (let lvl = 0; lvl < 5; lvl++) { const y0 = lvl * 9, y1 = y0 + 9, r0 = 6.4 - y0 * 0.131, r1 = 6.4 - y1 * 0.131;
        for (let sd = 0; sd < 4; sd++) { const a = sd * Math.PI / 2, len = Math.hypot(r0 + r1, 9), g = new THREE.BoxGeometry(0.24, len, 0.24); g.rotateZ((sd % 2 ? 1 : -1) * Math.atan2(r0 + r1, 9)); g.translate(0, (y0 + y1) / 2, (r0 + r1) / 2); g.rotateY(a); parts.push(paint(g, lvl % 2 ? 0xb8442e : 0xd8d8d2, 1, false, 0.03));
          const g2 = new THREE.BoxGeometry(r1 * 2, 0.24, 0.24); g2.translate(0, y1, r1); g2.rotateY(a); parts.push(paint(g2, 0xd8d8d2, 1, false, 0.03)); } }
      for (const [y, s2] of [[15.8, 6.6], [31.2, 3.6]]) for (const sg of [-1, 1]) parts.push(bx(s2 * 2, 1, 0.1, 0, y, sg * s2, 0x6a7078), bx(0.1, 1, s2 * 2, sg * s2, y, 0, 0x6a7078));
      parts.push(cyl(1.3, 0.4, 0.5, 2.6, 46, 0, 0xe0e0da, 10), cyl(1.1, 0.3, 0.4, -2.4, 49, 1, 0xe0e0da, 10), cyl(0.9, 0.3, 0.4, 0, 52, -2.2, 0xe0e0da, 10), bx(9, 0.8, 9, 0, 0, 0, 0x7c7a74), bx(4, 3, 5, 9, 0, 3, 0x8a8f94), bx(1, 2, 0.1, 9, 0, 5.56, 0x2a2622));
      break;
    }
    case 9: { // hangar: structural ribs over the vault, tall sliding doors with their tracks, annexe windows, an apron
      for (let x = -W / 2 + 2; x <= W / 2 - 1; x += 4.4) for (let k = 0; k < 8; k++) { const a0 = k / 8 * Math.PI, a1 = (k + 1) / 8 * Math.PI, y0 = Math.sin(a0) * h, z0 = Math.cos(a0) * L * 0.5, y1 = Math.sin(a1) * h, z1 = Math.cos(a1) * L * 0.5, g = new THREE.BoxGeometry(0.4, 0.3, Math.hypot(z1 - z0, y1 - y0) + 0.2); g.rotateX(-Math.atan2(y1 - y0, z1 - z0)); g.translate(x, (y0 + y1) / 2 + 0.12, (z0 + z1) / 2); parts.push(paint(g, 0x6a7074, 1, false, 0.03)); }
      for (let k = -3; k <= 3; k++) parts.push(bx(0.16, h * 0.5, L * 0.1 - 0.2, W / 2 - 0.05, 0, k * L * 0.1, k % 2 ? 0x3a4046 : 0x30363c));
      parts.push(bx(0.3, 0.3, L * 0.74, W / 2 - 0.1, h * 0.5, 0, 0x55585c), bx(W + 14, 0.14, L + 10, 3, 0.02, 0, 0x5c5e60));
      for (let z = L / 2 + 1; z < L / 2 + 9; z += 2.2) parts.push(bx(0.1, 1, 1.2, 3.06, 1.2, z + 0.6, 0x2a3640), bx(0.1, 1, 1.2, -3.06, 1.2, z + 0.6, 0x2a3640));
      break;
    }
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
      const long = W > L; for (let i = -1; i <= 1; i++) parts.push(bx(long ? 2.4 : 1.4, 2.6, long ? 1.4 : 2.4, long ? i * W * 0.3 : W / 2 + 0.6, 0, long ? L / 2 + 0.6 : i * L * 0.3, 0x6a665e),
        bx(long ? 1.3 : 0.2, 2.2, long ? 0.2 : 1.3, long ? i * W * 0.3 : W / 2 + 1.32, 0, long ? L / 2 + 1.32 : i * L * 0.3, 0x2a221c));
      facadeKit(parts, r, long ? W : L, long ? L : W, h, long, tint);
      break;
    }
    case 2: { // tower block
      const tint = [0xc9c9c4, 0xd2cab8, 0xb8c0c4, 0xc7b9a2][Math.floor(r() * 4)], w = Math.min(W, L) - 1;
      parts.push(bx(w, h, w, 0, 0, 0, tint, true), bx(w + 0.6, 0.6, w + 0.6, 0, h, 0, 0x3a3a38), bx(w * 0.35, 2.6, w * 0.35, w * 0.15, h + 0.6, -w * 0.15, 0x5a5a55), cyl(0.08, 0.1, 5, -w * 0.3, h + 0.6, w * 0.3, 0x222222, 4),
        bx(w + 1.2, 3.2, w + 1.2, 0, 0, 0, 0x74706a), bx(1, h * 0.92, 0.5, w / 2 - 2.2, 2, w / 2 + 0.25, tint, false, 0.8), bx(1, h * 0.92, 0.5, -w / 2 + 2.2, 2, w / 2 + 0.25, tint, false, 0.8),
        bx(2.2, 2.6, 0.3, 0, 0, w / 2 + 0.76, 0x2a2622), bx(4, 0.3, 2, 0, 2.9, w / 2 + 1.4, 0x55524c));
      facadeKit(parts, r, w, w, h, true, tint); facadeKit(parts, r, w, w, h, false, tint);
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
  detailKit(c, parts, r, W, L, h);
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
  for (let k = 0; k < 6 + W * L / 20; k++) { // reinforcing bars bent out of broken concrete
    const g = new THREE.CylinderGeometry(0.05, 0.05, 1.5 + r() * 3, 4); g.translate(0, 0.9, 0); g.rotateZ((r() - 0.5) * 1.3); g.rotateX((r() - 0.5) * 1.3); g.translate((r() - 0.5) * W, r() * Math.min(h * 0.3, 6), (r() - 0.5) * L);
    parts.push(paint(g, 0x3a2a20, 1, false, 0.1));
  }
  for (let k = 0; k < 3 + W * L / 60; k++) { // floor slabs that came down whole and lie propped at an angle
    const g = new THREE.BoxGeometry(3 + r() * 4, 0.35, 2.5 + r() * 3); g.rotateZ((r() - 0.5) * 1.1); g.rotateY(r() * 6.28); g.translate((r() - 0.5) * (W + 3), 0.8 + r() * 1.8, (r() - 0.5) * (L + 3));
    parts.push(paint(g, 0x7a766e, 0.4 + r() * 0.3, false, 0.08));
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

/** a civilian (or, lying, anyone who has fallen): rounded limbs, shoulders, a head with hair — a person, not a stack of boxes */
function figure(lying: boolean): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [], SKIN = 0xc8a084, TROUSERS = 0x5a5e6e, SHOE = 0x24201c, HAIR = 0x2c221a;
  const cap = (r: number, len: number, x: number, y: number, z: number, hex: number, rx = 0, rz = 0) => { const g = new THREE.CapsuleGeometry(r, len, 3, 8); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z); P.push(paint(g, hex, 1, false, 0.03)); };
  const sph = (r: number, x: number, y: number, z: number, hex: number, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 10, 8); g.scale(1, sy, sz); g.translate(x, y, z); P.push(paint(g, hex, 1, false, 0.02)); };
  // legs, shoes
  cap(0.22, 1.5, -0.27, 1.15, 0, TROUSERS, lying ? 0.1 : 0); cap(0.22, 1.5, 0.27, 1.15, 0, TROUSERS, lying ? -0.2 : 0, lying ? 0.12 : 0);
  sph(0.26, -0.27, 0.16, 0.12, SHOE, 0.6, 1.5); sph(0.26, 0.27, 0.16, 0.12, SHOE, 0.6, 1.5);
  // coat: hips, chest, shoulders; arms hang (or lie thrown out)
  cap(0.47, 0.7, 0, 2.55, 0, 0xffffff); sph(0.5, 0, 3.2, 0, 0xffffff, 0.8, 0.8); cap(0.5, 0.25, 0, 2.05, 0, 0xe8e8e8);
  cap(0.17, 1.1, -0.68, 2.75, 0, 0xffffff, 0, lying ? 0.9 : 0.1); cap(0.17, 1.1, 0.68, 2.75, lying ? 0.3 : 0, 0xffffff, lying ? -0.5 : 0, lying ? -0.4 : -0.1);
  sph(0.16, lying ? -1.25 : -0.76, lying ? 2.4 : 2.0, 0, SKIN); sph(0.16, lying ? 1.0 : 0.76, lying ? 2.25 : 2.0, lying ? 0.4 : 0, SKIN);
  // neck, head, hair
  cap(0.14, 0.2, 0, 3.72, 0, SKIN); sph(0.33, 0, 4.08, 0.03, SKIN, 1.12, 1); sph(0.34, 0, 4.24, -0.1, HAIR, 0.7, 0.95); sph(0.05, -0.12, 4.12, 0.33, 0x1a1410); sph(0.05, 0.12, 4.12, 0.33, 0x1a1410); sph(0.07, 0, 4.03, 0.35, SKIN, 1.2, 1);
  const g = mergeGeometries(P); g.deleteAttribute('uv');
  if (lying) { g.rotateX(-Math.PI / 2); g.translate(0, 0.3, 1.8); }
  return g;
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
          // plaster and concrete grain: fine speckle plus broad weather staining, never visible squares
          float gr = fract(sin(dot(floor(vWp.xz * 9.0) + floor(vWp.y * 9.0) * 1.7, vec2(12.9898, 78.233))) * 43758.5453);
          float st = sin(vWp.x * 0.37 + sin(vWp.y * 0.9) * 1.3) * sin(vWp.z * 0.41 + vWp.y * 0.23) * 0.5 + 0.5;
          diffuseColor.rgb *= (0.93 + 0.1 * gr) * (0.86 + 0.18 * st);
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
    this.buildProps(scene, map, quality);
    const im = (g: THREE.BufferGeometry, cap: number, mat: THREE.Material) => { const m = new THREE.InstancedMesh(g, mat, cap); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _c.set(0xffffff)); scene.add(m); return m; };
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // the per-person colour dyes only the coat (the parts modelled in white); skin, hair, trousers and shoes keep their own colour
    // and merely darken with it, so a body still decays as a whole
    cloth.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `vColor = color;
        #ifdef USE_INSTANCING_COLOR
        float dye = step(0.88, min(color.r, min(color.g, color.b)));
        float lum = clamp(max(instanceColor.r, max(instanceColor.g, instanceColor.b)) * 1.7, 0.2, 1.0);
        vColor *= mix(vec3(lum), instanceColor.rgb, dye);
        #endif`);
    };
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

  /** street furniture: parked and burnt-out cars, lamp posts along the avenues, anti-tank hedgehogs at the crossings */
  private buildProps(scene: THREE.Scene, map: GameMap, quality: number) {
    const r = mulberry32(map.seed * 7 + 3), n = map.n, mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25, envMapIntensity: 0.9 });
    const tr = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const mk = (parts: THREE.BufferGeometry[], spots: number[][], cols: number[], shadow: boolean) => {
      if (!spots.length) return;
      const g = mergeGeometries(parts); g.deleteAttribute('uv');
      const m = new THREE.InstancedMesh(g, mat, spots.length); m.frustumCulled = false; m.castShadow = shadow && quality >= 1; m.receiveShadow = true;
      const cells = new Int32Array(spots.length), base: THREE.Color[] = [];
      spots.forEach((s, i) => {
        q.setFromAxisAngle(up, s[2]); ps.set(s[0], map.heightAt(s[0], s[1]) - 0.05, s[1]); sc.setScalar(s[3] || 1); tr.compose(ps, q, sc); m.setMatrixAt(i, tr);
        cells[i] = map.cellOf(s[0], s[1]); base.push(new THREE.Color(cols[Math.floor(r() * cols.length)])); m.setColorAt(i, _c.setScalar(0));
      });
      scene.add(m); this.props.push({ m, cells, base });
    };
    const free = (x: number, z: number) => x > 8 && z > 8 && x < map.size - 8 && z < map.size - 8 && map.passAt(x, z) && !map.road[map.cellOf(x, z)];
    // cars: body, glasshouse, wheels. 1 in 5 is a burnt shell
    const W = (x: number, z: number) => { const g = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10); g.rotateZ(Math.PI / 2); g.translate(x, 0.62, z); return paint(g, 0x0c0c0c, 1, false, 0); };
    const car = [bx(3.2, 1.25, 7.4, 0, 0.55, 0, 0xffffff, false, 1), bx(2.9, 1.1, 3.9, 0, 1.75, -0.4, 0x30383e, false, 1), bx(2.7, 0.14, 3.6, 0, 2.85, -0.4, 0xffffff, false, 0.9),
      bx(3.0, 0.3, 0.3, 0, 0.6, 3.75, 0x1a1a1a), bx(3.0, 0.3, 0.3, 0, 0.6, -3.75, 0x1a1a1a), bx(0.7, 0.3, 0.1, -1.1, 1.3, 3.72, 0xd8d4c0), bx(0.7, 0.3, 0.1, 1.1, 1.3, 3.72, 0xd8d4c0), bx(0.7, 0.3, 0.1, -1.1, 1.3, -3.72, 0x7a1810), bx(0.7, 0.3, 0.1, 1.1, 1.3, -3.72, 0x7a1810),
      W(-1.55, 2.3), W(1.55, 2.3), W(-1.55, -2.4), W(1.55, -2.4)];
    const cars: number[][] = [], lamps: number[][] = [], hogs: number[][] = [];
    for (const pts of map.roads) {
      let acc = 0, side = 1;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        for (let t = 0; t < l; t += 6) {
          acc += 6; const x = ax + ux * t, z = az + uz * t, urb = map.urban[map.cellOf(x, z)];
          if (acc % 36 < 6 && urb > 0.2) { side = -side; const lx = x - uz * side * 6.4, lz = z + ux * side * 6.4; if (map.passAt(lx, lz)) lamps.push([lx, lz, Math.atan2(-ux * side, uz * side) + Math.PI / 2, 1]); }
          if (urb > 0.25 && r() < 0.05 * urb + 0.012) { const sd = r() < 0.5 ? 1 : -1, cx = x - uz * sd * 7.6, cz = z + ux * sd * 7.6; if (free(cx, cz)) cars.push([cx, cz, Math.atan2(ux, uz) + (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 0.25, 1]); }
        }
      }
    }
    for (const c of map.civ) if (c.kind === 1 || c.kind === 2 || c.kind === 3) for (let k = 0; k < 2; k++) if (r() < 0.6) { const a = r() * 6.283, d = Math.max(c.fw, c.fh) * 4 + 6 + r() * 5, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d; if (free(x, z)) cars.push([x, z, r() * 6.283, 1]); }
    mk(car, cars, [0xb8bcc0, 0x8c1c18, 0x1f3a66, 0xe6e4dc, 0x3a3d40, 0x6a6f58, 0xc9b27a, 0x141414, 0x141414], true);
    // lamp posts
    mk([cyl(0.16, 0.24, 11, 0, 0, 0, 0x6c7074, 6), bx(3.2, 0.2, 0.24, 1.5, 10.8, 0, 0x6c7074), bx(1.2, 0.26, 0.5, 2.8, 10.6, 0, 0xcfd2d0), cyl(0.4, 0.5, 0.5, 0, 0, 0, 0x5a5d60, 6)], lamps, [0xffffff, 0xd8d8d8], false);
    // hedgehogs: three steel beams welded crosswise, laid in rows across the roads into the city
    const beam = (rx: number, rz: number) => { const g = new THREE.BoxGeometry(0.3, 3.6, 0.3); g.rotateX(rx); g.rotateZ(rz); g.translate(0, 1.15, 0); return paint(g, 0x5a4034, 1, false, 0.12); };
    for (const b of map.bridges) for (const sd of [-1, 1]) { const nx = -b.t[1], nz = b.t[0], cx = b.x + nx * sd * (b.len / 2 + 22), cz = b.z + nz * sd * (b.len / 2 + 22); for (let k = -3; k <= 3; k++) if (k !== 0 && r() < 0.85) { const x = cx + b.t[0] * k * 6.5 + (r() - 0.5) * 3, z = cz + b.t[1] * k * 6.5 + (r() - 0.5) * 3; if (map.passAt(x, z)) hogs.push([x, z, r() * 6.283, 0.9 + r() * 0.3]); } }
    const s0 = map.starts[0];
    for (let k = 0; k < 40; k++) { const a = k / 40 * 6.283, x = s0.x + Math.cos(a) * 132 + (r() - 0.5) * 8, z = s0.z + Math.sin(a) * 132 + (r() - 0.5) * 8; if (r() < 0.6 && free(x, z)) hogs.push([x, z, r() * 6.283, 0.9 + r() * 0.3]); }
    mk([beam(0.95, 0), beam(-0.5, 0.85), beam(-0.5, -0.85)], hogs, [0xffffff, 0xd0b8a8, 0xb89a88], true);
  }
  private lastReveal = 0;
  private props: { m: THREE.InstancedMesh; cells: Int32Array; base: THREE.Color[] }[] = [];
  /** raised in first person so the unexplored distance is dim rather than invisible */
  reveal = 0;
  /** fallen soldiers keep everything they carried: the renderer hands over a full-detail figure for each side, posed on its back */
  private fallen: THREE.InstancedMesh[] = [];
  setFallen(geos: THREE.BufferGeometry[], mat: THREE.Material) {
    for (const g of geos) { const m = new THREE.InstancedMesh(g, mat, 3000); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = this.quality >= 1; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _c.set(0xffffff)); this.scene.add(m); this.fallen.push(m); }
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
    if (this.reveal !== this.lastReveal) { this.lastReveal = this.reveal; this.t = 0; }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.4;
      map.bridges.forEach((b, i) => { const k = b.dead ? 'd' : b.pontoon ? 'p' : 'o'; if (this.bkey[i] !== undefined && this.bkey[i] !== k) this.dropBridge(i); this.bkey[i] = k; });
      map.bridges.forEach((b, i) => { if (!this.bridges[i].visible && (vis[map.cellOf(b.x, b.z)] & 1)) this.bridges[i].visible = true; });
      for (const c of map.civ) { const m = this.meshes[c.id]; if (m && !m.visible && (this.reveal > 0 || vis[map.cellOf(c.x, c.z)] & 1)) m.visible = true; }
      for (const p of this.props) { for (let i = 0; i < p.cells.length; i++) { const v = vis[p.cells[i]]; p.m.setColorAt(i, _c.copy(p.base[i]).multiplyScalar(Math.max(this.reveal, v & 2 ? 1 : v & 1 ? 0.45 : 0))); } if (p.m.instanceColor) p.m.instanceColor.needsUpdate = true; }
    }
    // the dead: fresh, then bloated and darkening, then collapsing into the ground, then bones
    let n = 0, nb = 0; const nf = [0, 0];
    const dayTicks = TICK * YEAR_SECS / 365, snow = game.snow;
    for (const b of game.bodies) {
      if (n >= 3000 || !(vis[map.cellOf(b.x, b.z)] & 1)) continue;
      const age = (game.tick - b.born) / dayTicks;
      let sy = 1, sxz = 1; const col = _c;
      const sol = b.fac < 2 && this.fallen.length === 2;
      if (sol) col.setRGB(1, 1, 1); else if (b.fac < 2) col.copy(UNIFORM[b.fac]); else col.copy(COATS[b.id % COATS.length]);
      if (age > 45) { sy = 0.3; sxz = 0.8; col.setRGB(0.34, 0.31, 0.25); }
      else if (age > 14) { const k = (age - 14) / 31; sy = lerp(0.8, 0.4, k); col.lerp(_c2.setRGB(0.1, 0.085, 0.06), 0.75 + 0.15 * k); }
      else if (age > 3) { const k = (age - 3) / 11; sy = 1 + 0.3 * Math.sin(k * Math.PI); col.lerp(_c2.setRGB(0.2, 0.22, 0.14), k * 0.7); }
      if (snow > 0.05) col.lerp(_c2.setRGB(0.85, 0.87, 0.9), snow * Math.min(0.75, age / 6));
      map.normalAt(b.x, b.z, _nn); _n.set(_nn.x, _nn.y, _nn.z);
      _q.setFromUnitVectors(_y, _n); _q2.setFromAxisAngle(_y, b.rot); _q.multiply(_q2);
      _p.set(b.x, b.y + 0.05, b.z); _s.set(sxz, sy, sxz); _m.compose(_p, _q, _s);
      if (sol) { const im = this.fallen[b.fac]; im.setMatrixAt(nf[b.fac], _m); im.setColorAt(nf[b.fac]++, col); }
      else { this.bodyIM.setMatrixAt(n, _m); this.bodyIM.setColorAt(n, col); n++; }
      if (age < 30) {
        const k = Math.min(1, age / 8), fade = age > 20 ? 1 - (age - 20) / 10 : 1, grow = Math.min(1, 0.35 + (game.tick - b.born) / (TICK * 14));
        _s.setScalar((1.2 + (b.id % 5) * 0.2) * grow * fade); _p.set(b.x + 0.4, b.y + 0.12, b.z + 0.3); _q.setFromUnitVectors(_y, _n); _m.compose(_p, _q, _s);
        this.bloodIM.setMatrixAt(nb, _m); this.bloodIM.setColorAt(nb, col.setRGB(lerp(0.26, 0.07, k), lerp(0.015, 0.025, k), lerp(0.015, 0.02, k)).lerp(_c2.setRGB(0.8, 0.82, 0.85), snow > 0.3 ? Math.min(0.6, age / 10) : 0)); nb++;
      }
    }
    this.fallen.forEach((im, i) => { im.count = nf[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
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
