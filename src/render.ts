// three.js renderer: procedural terrain, instanced procedural unit meshes, particles, beams, fog of war.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DAY_SECS, DEF_LIST, Model, UnitDef } from './defs';
import { World } from './world';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { smooth } from './util';
import { CELL, GameMap, VS } from './map';
import { Game, Team, Unit, Wreck } from './sim';
import { angDiff, clamp, hash2, lerp, vnoise } from './util';
import { makeWater, noiseTexture, normalTexture, Scenery, tile } from './scenery';
import { TICK } from './sim';

// D dark steel, M steel, L light grey, K rubber / gunmetal, P glass, W white, N concrete, O sandbag / canvas, S skin, Y hazard yellow, R warning red, V webbing
const PAL: Record<string, number> = { D: 0x2c2f2a, M: 0x6d716a, L: 0xa4a89f, K: 0x121311, P: 0x1b2833, W: 0xd8d8d0, N: 0x8a8a84, O: 0x93835c, S: 0xc09878, Y: 0xb8912a, R: 0xa03020, V: 0x4c4a36 };
/** per-faction paint: T hull, C camouflage second tone, U uniform, H helmet, G identification marking */
const FACPAL: Record<string, number>[] = [
  { T: 0x5d6546, C: 0x434a32, U: 0x6c7052, H: 0x4e543a, G: 0x2f7de0 },
  { T: 0x47513b, C: 0x30372a, U: 0x4a5640, H: 0x384030, G: 0xd8342a },
];
const PLAIN = 'TCDML';

type GK = 'b' | 't' | 's' | 'p' | 'q' | 'k' | 'l' | 'h';
type Geos = Record<GK, THREE.BufferGeometry | null>;
/** every part group of a model with its pivot */
function partList(def: UnitDef, g: Geos): [THREE.BufferGeometry, number[] | undefined][] {
  const o: [THREE.BufferGeometry, number[] | undefined][] = [], hip = [0, def.model.hip || 0, 0];
  if (g.b) o.push([g.b, undefined]); if (g.t) o.push([g.t, def.model.tp]); if (g.s) o.push([g.s, def.model.sp]);
  const knee = [0, def.model.knee || 0, 0];
  if (g.p) o.push([g.p, hip]); if (g.q) o.push([g.q, hip]); if (g.k) o.push([g.k, knee]); if (g.l) o.push([g.l, knee]); if (g.h) o.push([g.h, [0, def.model.neck || 0, 0]]);
  return o;
}
const geoCache = new Map<string, Geos>();

/** box-projected UVs in model units so the plating texture has a constant scale on every part */
function boxUV(g: THREE.BufferGeometry, off: number) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2), k = 1 / 14;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * k + off; uv[i * 2 + 1] = v * k + off * 1.7;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function buildGeos(model: Model, fac: number): Geos {
  const groups: Record<string, THREE.BufferGeometry[]> = { b: [], t: [], s: [], p: [], q: [], k: [], l: [], h: [] };
  const col = new THREE.Color(), e = new THREE.Euler(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const paint = (g: THREE.BufferGeometry, code: string, pi: number, shade = 1) => {
    let k = 1;
    const fp = FACPAL[fac];
    if (fp[code] !== undefined) { col.setHex(fp[code]); if (code === 'G') k = 1.2; }
    else col.setHex(PAL[code] ?? 0x808080);
    const n = g.attributes.position.count, ca = new Float32Array(n * 3), nrm = g.attributes.normal, ps = g.attributes.position;
    for (let i = 0; i < n; i++) {
      let f = shade;
      if (code === 'P') f *= 0.75 + 0.9 * hash2((i / 4) | 0, pi, 29) * hash2((i / 4) | 0, pi, 31) + nrm.getY(i) * 0.25;
      else if (k === 1) {
        // per-face plate tint, sky-facing surfaces catch more light, and a grounded contact shadow
        f *= 0.93 + 0.14 * hash2(pi, n, 17) + nrm.getY(i) * 0.08;
        if (!model.hip) f *= 0.62 + 0.38 * clamp((ps.getY(i) + 0.5) / 3.5, 0, 1);
      }
      ca[i * 3] = col.r * k * f; ca[i * 3 + 1] = col.g * k * f; ca[i * 3 + 2] = col.b * k * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  };
  let pi = 0;
  for (const p of model.parts) {
    pi++;
    const list: [THREE.BufferGeometry, string, number][] = [];
    if (p.s === 0) {
      const [w, h, l] = p.d;
      const md = Math.min(w, h, l);
      list.push([p.c === 'P' ? new THREE.BoxGeometry(w, h, l, 5, 1, 5) : md >= 1.4 && p.c !== 'K' ? new RoundedBoxGeometry(w, h, l, 1, Math.min(0.5, md * 0.22)) : new THREE.BoxGeometry(w, h, l), p.c, 1]);
      const plain = PLAIN.includes(p.c);
      if (plain && Math.min(w, l) >= 2.2 && h >= 0.7) {
        // greebles: raised deck plate, vents, side hatches, corner bolts
        const r = (k: number) => hash2(pi * 7 + k, Math.round(w * 10 + l * 3), 23), dk = p.c === 'D' ? 'M' : 'D';
        const pl = new THREE.BoxGeometry(w * (0.5 + r(1) * 0.25), 0.16, l * (0.45 + r(2) * 0.3)); pl.translate((r(3) - 0.5) * w * 0.15, h / 2 + 0.08, (r(4) - 0.5) * l * 0.15); list.push([pl, p.c, 0.8]);
        if (w * l > 14) for (let k = 0; k < 3; k++) { const v = new THREE.BoxGeometry(Math.min(1.6, w * 0.18), 0.22, 0.28); v.translate((r(5) - 0.5) * w * 0.4, h / 2 + 0.2, (k - 1) * 0.5 + (r(6) - 0.5) * l * 0.3); list.push([v, 'K', 1]); }
        if (h >= 2 && l >= 3) for (const sx of [-1, 1]) { const ht = new THREE.BoxGeometry(0.14, h * 0.5, l * (0.3 + r(7) * 0.25)); ht.translate(sx * (w / 2 + 0.07), (r(8) - 0.5) * h * 0.2, (r(9) - 0.5) * l * 0.3); list.push([ht, dk, 0.9]); }
        if (h >= 2 && w >= 3) { const ht = new THREE.BoxGeometry(w * (0.3 + r(10) * 0.3), h * 0.45, 0.14); ht.translate((r(11) - 0.5) * w * 0.25, (r(12) - 0.5) * h * 0.2, -(l / 2 + 0.07)); list.push([ht, dk, 0.9]); }
        if (w * l > 40) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const bt = new THREE.CylinderGeometry(0.3, 0.3, 0.3, 6); bt.translate(sx * (w / 2 - 0.7), h / 2 + 0.15, sz * (l / 2 - 0.7)); list.push([bt, 'L', 0.9]); }
        if (w * l > 60 && r(13) > 0.4) { const an = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 4); an.translate((r(14) - 0.5) * w * 0.7, h / 2 + 1.6, (r(15) - 0.5) * l * 0.7); list.push([an, 'L', 1]); }
      }
    } else if (p.s === 1) {
      list.push([new THREE.CylinderGeometry(p.d[0], p.d[1], p.d[2], 12), p.c, 1]);
      if (PLAIN.includes(p.c) && p.d[2] >= 3 && Math.max(p.d[0], p.d[1]) >= 0.5) {
        const rr = (p.d[0] + p.d[1]) / 2 + 0.09; // reinforcing bands
        for (const fy of [-0.3, 0.3]) { const bd = new THREE.CylinderGeometry(rr, rr, Math.min(0.5, p.d[2] * 0.07), 12); bd.translate(0, fy * p.d[2], 0); list.push([bd, p.c === 'D' ? 'M' : 'D', 1]); }
      }
    } else if (p.s === 2) list.push([new THREE.SphereGeometry(p.d[0], 12, 8), p.c, 1]);
    else if (p.s === 4) list.push([new THREE.CapsuleGeometry(p.d[0], p.d[1], 3, 10), p.c, 1]);
    else if (p.s === 5) list.push([new RoundedBoxGeometry(p.d[0], p.d[1], p.d[2], 2, Math.min(p.d[0], p.d[1], p.d[2]) * 0.3), p.c, 1]);
    else if (p.s === 6) list.push([new THREE.SphereGeometry(p.d[0], 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), p.c, 1]);
    else list.push([new THREE.ConeGeometry(p.d[0], p.d[1], 10), p.c, 1]);
    const grp = p.g || 'b';
    const pivY = grp === 't' ? model.tp![1] : grp === 's' ? model.sp![1] : grp === 'b' ? 0 : grp === 'h' ? model.neck! : grp === 'k' || grp === 'l' ? model.knee! : model.hip!;
    const piv = grp === 't' ? model.tp! : grp === 'b' || grp === 's' ? [0, 0, 0] : [0, pivY, 0];
    e.set(p.r ? p.r[0] : 0, p.r ? p.r[1] : 0, p.r ? p.r[2] : 0);
    q.setFromEuler(e); pos.set(p.p[0] - piv[0], p.p[1] - piv[1], p.p[2] - piv[2]);
    m.compose(pos, q, one);
    for (let [g, code, shade] of list) {
      if (g.index) g = g.toNonIndexed();
      g.applyMatrix4(m);
      if (grp !== 'b') g.translate(0, pivY, 0); // shade by true height…
      paint(g, code, pi, shade);
      if (grp !== 'b') g.translate(0, -pivY, 0);
      boxUV(g, hash2(pi, 3, 5));
      groups[grp].push(g);
    }
  }
  const mk = (a: THREE.BufferGeometry[]) => (a.length ? mergeGeometries(a) : null);
  return { b: mk(groups.b), t: mk(groups.t), s: mk(groups.s), p: mk(groups.p), q: mk(groups.q), k: mk(groups.k), l: mk(groups.l), h: mk(groups.h) };
}
function geosFor(def: UnitDef, team: number): Geos {
  const key = def.id + '|' + team;
  let g = geoCache.get(key);
  if (!g) { g = buildGeos(def.model, team); geoCache.set(key, g); }
  return g;
}

let plateCache: { map: THREE.Texture; normal: THREE.Texture } | null = null;
/** Procedural hull plating: panels, grooves, rivets, scratches and grime, plus a matching normal map. */
export function platingTextures() {
  if (plateCache) return plateCache;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const hgt = document.createElement('canvas'); hgt.width = hgt.height = S;
  const x = c.getContext('2d')!, hx = hgt.getContext('2d')!;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, S, S);
  const split = (px: number, py: number, w: number, h: number, d: number) => {
    if (d === 0 || (w < 64 && h < 64) || (d < 4 && rnd() < 0.14)) {
      const v = 214 + rnd() * 34; x.fillStyle = `rgb(${v},${v},${v + 2})`; x.fillRect(px, py, w, h);
      const hv = 118 + rnd() * 26; hx.fillStyle = `rgb(${hv},${hv},${hv})`; hx.fillRect(px, py, w, h);
      x.strokeStyle = 'rgba(0,0,0,0.42)'; x.lineWidth = 1.6; x.strokeRect(px + 0.5, py + 0.5, w, h);
      hx.strokeStyle = '#282828'; hx.lineWidth = 2.2; hx.strokeRect(px + 0.5, py + 0.5, w, h);
      x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px + 3, py + h - 3); x.lineTo(px + 3, py + 3); x.lineTo(px + w - 3, py + 3); x.stroke();
      if (w > 40 && h > 40) for (const [rx, ry] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]]) {
        x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.arc(px + rx, py + ry, 2.2, 0, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(px + rx - 0.6, py + ry - 0.6, 1, 0, 7); x.fill();
        hx.fillStyle = '#d0d0d0'; hx.beginPath(); hx.arc(px + rx, py + ry, 2.4, 0, 7); hx.fill();
      }
      if (rnd() < 0.22 && w > 50 && h > 30) { // vent slats
        for (let i = 0; i < 4; i++) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(px + w * 0.25, py + h * 0.3 + i * 6, w * 0.5, 3); hx.fillStyle = '#303030'; hx.fillRect(px + w * 0.25, py + h * 0.3 + i * 6, w * 0.5, 3); }
      }
      if (rnd() < 0.12) { x.fillStyle = 'rgba(255,190,40,0.35)'; for (let i = 0; i < w; i += 14) x.fillRect(px + i, py + h - 9, 7, 5); } // hazard ticks
      return;
    }
    if (w >= h) { const k = Math.round(w * (0.35 + rnd() * 0.3)); split(px, py, k, h, d - 1); split(px + k, py, w - k, h, d - 1); }
    else { const k = Math.round(h * (0.35 + rnd() * 0.3)); split(px, py, w, k, d - 1); split(px, py + k, w, h - k, d - 1); }
  };
  split(0, 0, S, S, 6);
  for (let i = 0; i < 260; i++) { // scratches and chips
    const sx = rnd() * S, sy = rnd() * S, a = rnd() * 6.28, l = 4 + rnd() * 26;
    x.strokeStyle = rnd() < 0.6 ? `rgba(255,255,255,${0.08 + rnd() * 0.14})` : `rgba(0,0,0,${0.1 + rnd() * 0.15})`; x.lineWidth = 0.6 + rnd();
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke();
  }
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) { // grime and streaks
    const i = (py * S + px) * 4, g = 0.88 + 0.12 * tile(px, py, S, 9, 61) - 0.1 * Math.pow(tile(px, py * 0.25, S, 40, 63), 3);
    d[i] *= g; d[i + 1] *= g; d[i + 2] *= g;
  }
  x.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const hd = hx.getImageData(0, 0, S, S).data;
  const normal = normalTexture(S, (px, py) => hd[(py * S + px) * 4] / 255, 2.4);
  return (plateCache = { map, normal });
}

class Particles {
  max: number; pts: THREE.Points; pos: Float32Array; col: Float32Array; size: Float32Array; seed: Float32Array;
  vel: Float32Array; life: Float32Array; ml: Float32Array; s0: Float32Array; grow: Float32Array; drag: Float32Array; grav: Float32Array; base: Float32Array; ramp: Uint8Array;
  head = 0; mat: THREE.ShaderMaterial; windX = 0; windZ = 0;
  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max); this.seed = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ml = new Float32Array(max);
    this.s0 = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.base = new Float32Array(max * 4); this.ramp = new Uint8Array(max);
    for (let i = 0; i < max; i++) this.seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('pcol', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('pseed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, uLit: { value: additive ? 0 : 1 } },
      vertexShader: `attribute vec4 pcol; attribute float psize; attribute float pseed; varying vec4 vc; varying float vs; uniform float scale;
        void main(){ vc=pcol; vs=pseed; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=min(700.0, psize*scale/max(1.0,-mv.z)); }`,
      fragmentShader: `varying vec4 vc; varying float vs; uniform float uLit;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 uv=gl_PointCoord-0.5; float an=vs*6.283; float c=cos(an), s=sin(an); vec2 r=vec2(uv.x*c-uv.y*s, uv.x*s+uv.y*c);
          float nz=n(r*5.0+vs*37.0)*0.65+n(r*11.0+vs*91.0)*0.35;
          float d=length(uv)+(nz-0.5)*0.24;
          float a=smoothstep(0.5,0.12,d)*vc.a; if(a<0.004) discard;
          vec3 col=vc.rgb*(0.75+0.5*nz);
          col*=mix(1.0, 0.72+0.5*(0.5-gl_PointCoord.y), uLit);
          gl_FragColor=vec4(col,a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 12 : 11;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, a: number, grow = 0, drag = 0, grav = 0, ramp = 0) {
    const i = this.head; this.head = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.ml[i] = life; this.s0[i] = size; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav; this.ramp[i] = ramp;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }
  update(dt: number) {
    const { pos, vel, life, ml, size, col, base, ramp } = this, wx = this.windX * dt, wz = this.windZ * dt;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      const k = Math.max(0, life[i] / ml[i]), dr = 1 - this.drag[i] * dt;
      vel[i * 3] = vel[i * 3] * dr + wx; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - this.grav[i] * dt; vel[i * 3 + 2] = vel[i * 3 + 2] * dr + wz;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = this.s0[i] * (1 + this.grow[i] * (1 - k));
      if (ramp[i]) { // hot white-yellow -> orange -> deep red as it cools
        col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1] * (0.15 + 0.85 * k); col[i * 4 + 2] = base[i * 4 + 2] * k * k;
        col[i * 4 + 3] = base[i * 4 + 3] * Math.min(1, k * 3) * Math.min(1, (1 - k) * 8 + 0.3);
      } else {
        col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1]; col[i * 4 + 2] = base[i * 4 + 2];
        col[i * 4 + 3] = base[i * 4 + 3] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 10 + 0.25);
      }
    }
    const g = this.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.pcol.needsUpdate = true; g.attributes.psize.needsUpdate = true;
  }
}

interface Beam { ax: number; ay: number; az: number; bx: number; by: number; bz: number; life: number; max: number; w: number; c: THREE.Color }
interface Ring { x: number; y: number; z: number; life: number; max: number; size: number }
interface Frame { group: THREE.Group; solid: THREE.MeshStandardMaterial; plane: THREE.Plane; turret: THREE.Object3D | null }

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _m3 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1), _xAxis = new THREE.Vector3(1, 0, 0);

export class Renderer {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null;
  game: Game; map: GameMap; me: Team;
  cam = { x: 0, z: 0, dist: 260, yaw: 0, pitch: 1.0 };
  time = 0; quality: number;
  private sun: THREE.DirectionalLight;
  private unitMat: THREE.MeshStandardMaterial;
  private ims = new Map<string, THREE.InstancedMesh>();
  private frames = new Map<Unit, Frame>();
  private fogTex: THREE.DataTexture; private fogData: Uint8Array; private fogCur: Float32Array;
  private water: THREE.Mesh | null = null; private waterTex: THREE.Texture | null = null; private waterUni: any = null;
  scenery!: Scenery; private terrainCol!: THREE.BufferAttribute; private terrainPos!: THREE.BufferAttribute; private terrainNrm!: THREE.BufferAttribute; private uTime = { value: 0 };
  private lights: { l: THREE.PointLight; life: number; max: number; peak: number }[] = []; private fireLight!: THREE.PointLight;
  private debris!: THREE.InstancedMesh; private dPos = new Float32Array(360 * 3); private dVel = new Float32Array(360 * 3); private dRot = new Float32Array(360 * 4); private dLife = new Float32Array(360); private dSize = new Float32Array(360); private dHead = 0;
  private later: { t: number; fn: () => void }[] = []; shake = 0; private sunDir = new THREE.Vector3(0.55, 0.75, 0.35).normalize();
  private grade: ShaderPass | null = null;
  private sky!: Sky; private skyEnv = new THREE.Scene(); private pmrem!: THREE.PMREMGenerator; private envRT: THREE.WebGLRenderTarget | null = null; private envT = 0; private envEl = 9;
  private skyK = { value: 0.3 }; private skyNight = { value: new THREE.Color(0x05070c) };
  /** planar reflection of the world in the rivers (High quality) */
  private refRT: THREE.WebGLRenderTarget | null = null; private refCam = new THREE.PerspectiveCamera(); private noReflect: THREE.Object3D[] = []; private refM = new THREE.Matrix4();
  /** thermal drone-feed view */
  private skirt!: THREE.Mesh; private skirtCol = new THREE.Color();
  flir = false; private waterDepth: { depth: Uint8Array; dTex: THREE.DataTexture } | null = null; private terrainMatAttr!: THREE.BufferAttribute; private trackDirty = false; private trackT = 0; private pose = new WeakMap<Unit, number>();
  world!: World; private hemi!: THREE.HemisphereLight; night = 0; private rockets: { m: THREE.Mesh; vy: number; t: number; y0: number }[] = [];
  private uSeason = { snow: { value: 0 }, mud: { value: 0 }, dry: { value: 0 } }; private skyDay = new THREE.Color(); private bloomPass: UnrealBloomPass | null = null;
  private plans = new Map<string, THREE.Group>(); private planMat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
  private planWire = new THREE.MeshBasicMaterial({ color: 0xbfeaff, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false, fog: false }); private plate!: { map: THREE.Texture; normal: THREE.Texture }; private cleared = new WeakSet<Unit>();
  fire: Particles; smoke: Particles;
  private beams: Beam[] = []; private beamIM: THREE.InstancedMesh;
  private projIM: THREE.InstancedMesh; private ringIM: THREE.InstancedMesh; private rings: Ring[] = [];
  private selIM: THREE.InstancedMesh; private wreckIM: THREE.InstancedMesh; private spotIM: THREE.InstancedMesh;
  private scorchIM: THREE.InstancedMesh; private scorchN = 0;
  ghost: THREE.Group; private ghostDef: UnitDef | null = null; private ghostMat: THREE.MeshBasicMaterial;
  private rangeRing: THREE.Mesh;
  onEvent: ((e: any, vis: boolean) => void) | null = null;
  private ray = new THREE.Raycaster();

  /** set once at start-up on phones and tablets: lower resolution, fewer particles, smaller shadow map, no MSAA */
  static mobile = false;
  constructor(canvas: HTMLCanvasElement, game: Game, me: Team, quality: number) {
    if (Renderer.mobile) quality = Math.min(quality, 1);
    this.game = game; this.map = game.map; this.me = me; this.quality = quality;
    const map = this.map, bio = map.biome;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 0, powerPreference: 'high-performance' });
    r.setPixelRatio(Renderer.mobile ? Math.min(window.devicePixelRatio, quality >= 1 ? 1.5 : 1.1) : Math.min(window.devicePixelRatio, quality >= 2 ? 2 : 1.25));
    r.shadowMap.enabled = quality >= 1; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 4000);
    this.scene.background = new THREE.Color(bio.sky).multiplyScalar(0.35);
    this.scene.fog = new THREE.Fog(new THREE.Color(bio.sky).multiplyScalar(0.35).getHex(), 500, 3600);
    // physically based sky (Preetham scattering). It is both what you see at the horizon and, pre-filtered into an environment
    // map, the light every surface is lit and reflected by — glass, wet mud, steel and water all mirror the real sky of the hour.
    const pm = this.pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    const mkSky = () => {
      const sk = new Sky(); sk.scale.setScalar(3400); sk.frustumCulled = false; sk.renderOrder = -10;
      return sk;
    };
    this.sky = mkSky();
    const sm = this.sky.material as THREE.ShaderMaterial;
    sm.uniforms.uK = this.skyK; sm.uniforms.uNightCol = this.skyNight;
    sm.fragmentShader = 'uniform float uK; uniform vec3 uNightCol;\n' + sm.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uK + uNightCol, 1.0 );');
    this.scene.add(this.sky);
    const sk2 = new THREE.Mesh(this.sky.geometry, sm); sk2.scale.setScalar(3400); this.skyEnv.add(sk2);
    this.hemi = new THREE.HemisphereLight(bio.sky, 0x30281e, 0.95); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(bio.sun, bio.lava ? 1.6 : 2.4);
    sun.castShadow = quality >= 1; sun.shadow.mapSize.set(Renderer.mobile ? 1024 : quality >= 2 ? 4096 : 2048, Renderer.mobile ? 1024 : quality >= 2 ? 4096 : 2048); sun.shadow.radius = 2.2; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);

    const plate = platingTextures();
    this.unitMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.86, metalness: 0.14, map: plate.map, normalMap: plate.normal, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.5 });
    // matte camouflage and weathering: two scales of object-space noise break every surface into blotches, dust and grime
    const grime = noiseTexture(128, (x, y) => { const v = 255 * (tile(x, y, 128, 5, 171) * 0.6 + tile(x, y, 128, 13, 173) * 0.4), w = 255 * (tile(x, y, 128, 23, 175) * 0.6 + tile(x, y, 128, 51, 177) * 0.4); return [v, w, 0, 255]; });
    this.unitMat.onBeforeCompile = sh => {
      sh.uniforms.uGrime = { value: grime };
      sh.vertexShader = 'varying vec3 vOp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOp = position;');
      sh.fragmentShader = 'varying vec3 vOp; uniform sampler2D uGrime;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float cm = texture2D(uGrime, vOp.xz*0.11 + vOp.y*0.07).r*0.5 + texture2D(uGrime, vOp.zy*0.13 + 0.37).r*0.5;
        float gr = texture2D(uGrime, vOp.xy*0.9 + vOp.z*0.61).g;
        float px = texture2D(uGrime, floor(vOp.xy*5.0)/41.0 + floor(vOp.z*5.0)/29.0).r;
        diffuseColor.rgb *= mix(0.72, 1.12, smoothstep(0.44, 0.56, cm)) * (0.82 + 0.36*gr) * mix(0.86, 1.1, step(0.5, px));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.26, 0.20), (1.0 - smoothstep(0.0, 2.2, vOp.y)) * 0.45 * gr);`);
    };
    this.plate = plate;

    // ── terrain ──
    const hn = map.hn, H = map.heights;
    const pos = new Float32Array(hn * hn * 3), col = new Float32Array(hn * hn * 3), uv = new Float32Array(hn * hn * 2);
    const cl = new THREE.Color(bio.low), cm = new THREE.Color(bio.mid), ch = new THREE.Color(bio.high), cr = new THREE.Color(bio.rock), cs = new THREE.Color(bio.shore), tmp = new THREE.Color();
    const pad = new THREE.Color(0x8a867c), asphalt = new THREE.Color(0x6a6c6e), gravel = new THREE.Color(0x7a7468), paving = new THREE.Color(0x6a675f), woods = new THREE.Color(0x2c4426), hedge = new THREE.Color(0x33502a);
    const FIELDS = [0xa3975a, 0x5e7c3a, 0x55452f, 0x8c8840, 0x6a7f42, 0x7a6a44].map(h => new THREE.Color(h));
    // distance from every vertex to the nearest road
    const rd = new Float32Array(hn * hn).fill(99), aMat = new Float32Array(hn * hn);
    for (const pts of map.roads) for (let s = 0; s < pts.length - 1; s++) {
      const ax = pts[s][0], az = pts[s][1], bx = pts[s + 1][0], bz = pts[s + 1][1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 12) / VS)), i1 = Math.min(hn - 1, Math.ceil((Math.max(ax, bx) + 12) / VS));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 12) / VS)), j1 = Math.min(hn - 1, Math.ceil((Math.max(az, bz) + 12) / VS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const t = clamp(((i * VS - ax) * dx + (j * VS - az) * dz) / l2, 0, 1), d = Math.hypot(i * VS - ax - dx * t, j * VS - az - dz * t);
        if (d < rd[j * hn + i]) rd[j * hn + i] = d;
      }
    }
    const nC = map.n;
    for (let j = 0; j < hn; j++) for (let i = 0; i < hn; i++) {
      const k = j * hn + i, h = H[k], x = i * VS, z = j * VS;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      uv[k * 2] = x / map.size; uv[k * 2 + 1] = z / map.size;
      const hx = H[j * hn + Math.min(hn - 1, i + 1)] - H[j * hn + Math.max(0, i - 1)], hz = H[Math.min(hn - 1, j + 1) * hn + i] - H[Math.max(0, j - 1) * hn + i];
      const slope = Math.hypot(hx, hz) / (2 * VS);
      const t = clamp((h - 12) / 16, 0, 1), nz = vnoise(x * 0.05, z * 0.05, 7) * 0.5 + vnoise(x * 0.4, z * 0.4, 9) * 0.5;
      if (t < 0.5) tmp.copy(cl).lerp(cm, t * 2); else tmp.copy(cm).lerp(ch, (t - 0.5) * 2);
      const ci = Math.min(nC - 1, j >> 1) * nC + Math.min(nC - 1, i >> 1), urb = map.urban[ci], forest = map.forest[ci];
      // the patchwork of fields that surrounds the city
      const fu = (x * 0.88 + z * 0.47) / 118, fv = (-x * 0.47 + z * 0.88) / 72, fid = hash2(Math.floor(fu), Math.floor(fv), 91);
      const fm = (1 - urb) * clamp(1 - forest * 2.5, 0, 1) * smooth(0.4, 0.5, vnoise(x / 240 + 3, z / 240 + 9, 55));
      if (fm > 0.01) {
        const fc = FIELDS[Math.floor(fid * 6) % 6], e = Math.min(fu - Math.floor(fu), 1 - fu + Math.floor(fu)) * 118, e2 = Math.min(fv - Math.floor(fv), 1 - fv + Math.floor(fv)) * 72;
        tmp.lerp(fc, fm * 0.85 * (0.9 + 0.1 * Math.sin(fv * 72 * 1.6)));
        if (Math.min(e, e2) < 3) tmp.lerp(hedge, fm * 0.7);
      }
      tmp.lerp(woods, clamp(forest * 1.1, 0, 0.6));
      tmp.lerp(paving, urb * 0.8 * (0.55 + 0.45 * vnoise(x * 0.13, z * 0.13, 23)));
      { const sh = clamp(1 - (h - map.waterY) / 4, 0, 1); tmp.lerp(cs, sh); }
      tmp.lerp(cr, clamp((slope - 0.42) * 3, 0, 1));
      const r = rd[k];
      if (r < 8) tmp.lerp(gravel, 0.5 * (1 - smooth(3.5, 8, r)));
      void asphalt; aMat[k] = urb * 0.45;
      tmp.multiplyScalar(0.78 + nz * 0.44);
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
    for (const s of map.spots) {
      for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
        const d = Math.max(Math.abs(i), Math.abs(j)); if (d > 4) continue;
        const k = (s.cz * 2 + j) * hn + s.cx * 2 + i; if (k < 0 || k >= hn * hn) continue;
        tmp.setRGB(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]).lerp(pad, d > 3 ? 0.5 : 0.85).multiplyScalar(0.85 + 0.25 * hash2(i + s.cx * 9, j + s.cz * 5, 3));
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b; aMat[k] = 0.6;
      }
    }
    const idx = new Uint32Array((hn - 1) * (hn - 1) * 6); let q = 0;
    for (let j = 0; j < hn - 1; j++) for (let i = 0; i < hn - 1; i++) {
      const a = j * hn + i, b = a + 1, c = a + hn, d = c + 1;
      if ((i + j) & 1) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
      else { idx[q++] = a; idx[q++] = c; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = b; }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); tg.setAttribute('aMat', new THREE.BufferAttribute(aMat, 1));
    tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
    // signed-distance field of the road network: lets the shader draw crisp kerbs and lane markings whatever the mesh resolution
    const RS = 1024, rdf = new Uint8Array(RS * RS).fill(255), rtx = map.size / RS;
    for (const pts of map.roads) for (let s = 0; s < pts.length - 1; s++) {
      const ax = pts[s][0], az = pts[s][1], bx = pts[s + 1][0], bz = pts[s + 1][1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 14) / rtx)), i1 = Math.min(RS - 1, Math.ceil((Math.max(ax, bx) + 14) / rtx));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 14) / rtx)), j1 = Math.min(RS - 1, Math.ceil((Math.max(az, bz) + 14) / rtx));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * rtx, pz = (j + 0.5) * rtx, t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1), d = Math.min(255, Math.hypot(px - ax - dx * t, pz - az - dz * t) * 8);
        if (d < rdf[j * RS + i]) rdf[j * RS + i] = d;
      }
    }
    const roadTex = new THREE.DataTexture(rdf, RS, RS, THREE.RedFormat); roadTex.magFilter = roadTex.minFilter = THREE.LinearFilter; roadTex.needsUpdate = true;
    // hard surfaces: aggregate speckle, patched repairs, cracks, oil
    const hc = document.createElement('canvas'); hc.width = hc.height = 512; const hx2 = hc.getContext('2d')!;
    { let sd = 5; const rn = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      const im = hx2.createImageData(512, 512);
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const sp = hash2(x, y, 41), v = 118 + 60 * (tile(x, y, 512, 9, 141) - 0.5) + 44 * (tile(x, y, 512, 70, 143) - 0.5) + (sp - 0.5) * 70 + (sp > 0.97 ? 50 : 0), i = (y * 512 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
      hx2.putImageData(im, 0, 0);
      for (let k = 0; k < 14; k++) { hx2.fillStyle = `rgba(${rn() < 0.5 ? 40 : 190},${rn() < 0.5 ? 40 : 190},${120},${0.05 + rn() * 0.1})`; hx2.fillRect(rn() * 512, rn() * 512, 30 + rn() * 120, 20 + rn() * 90); }
      for (let k = 0; k < 46; k++) { let x = rn() * 512, y = rn() * 512, a = rn() * 6.283; hx2.strokeStyle = `rgba(12,12,12,${0.35 + rn() * 0.4})`; hx2.lineWidth = 0.6 + rn() * 1.4; hx2.beginPath(); hx2.moveTo(x, y); for (let q = 0; q < 14; q++) { a += (rn() - 0.5) * 1.3; x += Math.cos(a) * (6 + rn() * 12); y += Math.sin(a) * (6 + rn() * 12); hx2.lineTo(x, y); } hx2.stroke(); }
      for (let k = 0; k < 10; k++) { const g = hx2.createRadialGradient(0, 0, 0, 0, 0, 20 + rn() * 26); g.addColorStop(0, 'rgba(8,8,10,0.4)'); g.addColorStop(1, 'rgba(8,8,10,0)'); hx2.save(); hx2.translate(rn() * 512, rn() * 512); hx2.fillStyle = g; hx2.fillRect(-50, -50, 100, 100); hx2.restore(); }
    }
    const hardTex = new THREE.CanvasTexture(hc); hardTex.wrapS = hardTex.wrapT = THREE.RepeatWrapping; hardTex.anisotropy = 8;
    // organic ground: thousands of individual blades, stems, clods and stones rather than smooth noise
    const oc = document.createElement('canvas'); oc.width = oc.height = 512; const ox2 = oc.getContext('2d')!;
    { let sd = 9; const rn = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      const im = ox2.createImageData(512, 512);
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) { const sp = hash2(x, y, 77), v = 150 + 70 * (tile(x, y, 512, 12, 3) - 0.5) + 60 * (tile(x, y, 512, 48, 5) - 0.5) + 40 * (tile(x, y, 512, 160, 6) - 0.5) + (sp - 0.5) * 36, i = (y * 512 + x) * 4; im.data[i] = im.data[i + 1] = v; im.data[i + 2] = v * 0.96; im.data[i + 3] = 255; }
      ox2.putImageData(im, 0, 0);
      for (let k = 0; k < 16000; k++) { const x = rn() * 512, y = rn() * 512, a = -1.57 + (rn() - 0.5) * 1.6, l = 3 + rn() * 9, v = rn() < 0.55 ? 205 + rn() * 50 : 60 + rn() * 70; ox2.strokeStyle = `rgba(${v * 0.96},${v},${v * 0.88},${0.25 + rn() * 0.45})`; ox2.lineWidth = 0.7 + rn() * 0.8; ox2.beginPath(); ox2.moveTo(x, y); ox2.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rn() - 0.5) * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ox2.stroke(); }
      for (let k = 0; k < 500; k++) { const v = 90 + rn() * 130; ox2.fillStyle = `rgba(${v},${v * 0.97},${v * 0.92},0.8)`; ox2.beginPath(); ox2.ellipse(rn() * 512, rn() * 512, 0.8 + rn() * 2.4, 0.6 + rn() * 1.6, rn() * 3, 0, 6.3); ox2.fill(); }
    }
    const organicTex = new THREE.CanvasTexture(oc); organicTex.wrapS = organicTex.wrapT = THREE.RepeatWrapping; organicTex.anisotropy = 8; organicTex.colorSpace = THREE.SRGBColorSpace;
    organicTex.repeat.set(map.size / 26, map.size / 26);
    const detail0 = noiseTexture(512, (x, y) => { const sp = hash2(x, y, 77), v = 105 + 150 * (tile(x, y, 512, 12, 3) * 0.3 + tile(x, y, 512, 48, 5) * 0.3 + tile(x, y, 512, 160, 6) * 0.25 + sp * sp * 0.22) - (sp > 0.985 ? 70 : 0) + (sp < 0.012 ? 60 : 0); return [v, v, v * 0.96, 255]; });
    void detail0; const detail = organicTex;
    this.terrainMatAttr = tg.attributes.aMat as THREE.BufferAttribute;
    this.terrainCol = tg.attributes.color as THREE.BufferAttribute; this.terrainPos = tg.attributes.position as THREE.BufferAttribute; this.terrainNrm = tg.attributes.normal as THREE.BufferAttribute;
    const tnrm = normalTexture(256, (x, y) => tile(x, y, 256, 10, 31) + tile(x, y, 256, 28, 33) * 0.5 + tile(x, y, 256, 70, 35) * 0.25, 5);
    tnrm.repeat.set(map.size / 22, map.size / 22);
    const cloud = noiseTexture(256, (x, y) => {
      const lo = tile(x, y, 256, 4, 41) * 0.6 + tile(x, y, 256, 9, 43) * 0.3 + tile(x, y, 256, 20, 45) * 0.1, hi = tile(x, y, 256, 24, 47) * 0.6 + tile(x, y, 256, 60, 49) * 0.4;
      return [lo * 255, hi * 255, 0, 255];
    });
    const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, normalMap: tnrm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.94, metalness: 0, envMapIntensity: 0.55 });
    tmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime; sh.uniforms.uCloud = { value: cloud }; sh.uniforms.uRoad = { value: roadTex }; sh.uniforms.uHard = { value: hardTex }; sh.uniforms.uSize = { value: map.size };
      sh.uniforms.uSnow = this.uSeason.snow; sh.uniforms.uMud = this.uSeason.mud; sh.uniforms.uDry = this.uSeason.dry;
      sh.vertexShader = 'varying vec2 vWxz; attribute float aMat; varying float vMat;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWxz = position.xz; vMat = aMat;');
      sh.fragmentShader = 'varying vec2 vWxz; varying float vMat; uniform sampler2D uCloud, uRoad, uHard; uniform float uTime, uSnow, uMud, uDry, uSize;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float cl = smoothstep(0.42, 0.68, texture2D(uCloud, vWxz/1100.0 + uTime*vec2(0.0035, 0.002)).r);
        diffuseColor.rgb *= mix(1.0, 0.6, cl);`).replace('#include <color_fragment>', `#include <color_fragment>
        float n1 = texture2D(uCloud, vWxz/41.0).g, n2 = texture2D(uCloud, vWxz/260.0).r, n3 = texture2D(uCloud, vWxz/6.3).g;
        diffuseColor.rgb *= (0.74 + 0.5*n1) * (0.86 + 0.28*n3);
        // paved ground: cracked, patched concrete in the districts; asphalt roads with worn edge lines and centre dashes
        float rdist = texture2D(uRoad, vWxz/uSize).r * 31.875;
        float roadK = 1.0 - smoothstep(3.1, 3.6, rdist), hk = max(vMat, roadK);
        vec3 hard = texture2D(uHard, vWxz/17.0).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*(0.5 + 1.0*hard), vMat*0.75);
        vec3 asph = vec3(0.105, 0.108, 0.112)*(0.55 + 0.9*hard.r)*(0.85 + 0.3*n2);
        float wear = smoothstep(0.3, 0.62, texture2D(uCloud, vWxz/19.0).g);
        float edge = 1.0 - smoothstep(0.09, 0.2, abs(rdist - 2.75));
        float dash = (1.0 - smoothstep(0.09, 0.18, rdist))*step(0.5, fract((vWxz.x + vWxz.y)/7.5));
        asph = mix(asph, vec3(0.42, 0.42, 0.39), max(edge, dash)*wear*0.85);
        asph = mix(asph, diffuseColor.rgb*0.8, (1.0 - smoothstep(2.4, 3.6, rdist))*0.0 + smoothstep(2.9, 3.6, rdist)*0.5*n3);
        diffuseColor.rgb = mix(diffuseColor.rgb, asph, roadK);
        // high summer bleaches the grass; the thaw turns everything off the roads to mud; winter buries it
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.2, 1.05, 0.7), uDry*0.55*(1.0 - hk));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.125, 0.085)*(0.6 + 0.9*n1), uMud*(0.4 + 0.45*n2)*(1.0 - hk));
        float sc = smoothstep(0.78 - uSnow*0.95, 1.0 - uSnow*0.95, n1*0.5 + n2*0.5) * (1.0 - 0.6*hk);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.83, 0.86, 0.91)*(0.86 + 0.2*n3), sc*min(1.0, uSnow*1.4));`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // standing water in the mud and on wet asphalt mirrors the sky; packed snow has a soft sheen
        roughnessFactor = mix(roughnessFactor, 0.78, roadK);
        roughnessFactor = mix(roughnessFactor, 0.22, uMud*smoothstep(0.45, 0.7, n2*0.6 + n1*0.4)*(1.0 - 0.5*hk));
        roughnessFactor = mix(roughnessFactor, 0.6, sc*min(1.0, uSnow*1.4));`);
    };
    const terrain = new THREE.Mesh(tg, tmat);
    terrain.receiveShadow = true; this.scene.add(terrain);
    // skirt
    this.skirtCol.set(bio.mid).multiplyScalar(0.32);
    const skirt = this.skirt = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshBasicMaterial({ color: new THREE.Color(bio.mid).multiplyScalar(0.32) }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(map.size / 2, Math.min(-2, map.waterY - 3), map.size / 2); this.scene.add(skirt);

    // ── fog of war ──
    const n = map.n;
    this.fogData = new Uint8Array(n * n * 4); this.fogCur = new Float32Array(n * n).fill(235);
    this.fogTex = new THREE.DataTexture(this.fogData as any, n, n, THREE.RGBAFormat);
    this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
    const fogMat = new THREE.MeshBasicMaterial({ color: bio.fogCol, alphaMap: this.fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, fog: false });
    const fogMesh = new THREE.Mesh(tg, fogMat); fogMesh.renderOrder = 5; this.scene.add(fogMesh); this.noReflect.push(fogMesh, terrain, skirt);

    // ── water / lava ──
    if (map.waterY > -50) {
      if (bio.lava) {
        const wg = new THREE.PlaneGeometry(map.size, map.size);
        this.waterTex = noiseTexture(256, (x, y) => {
          const v = tile(x, y, 256, 8, 11) * 0.6 + tile(x, y, 256, 32, 13) * 0.4, c = Math.pow(clamp((v - 0.3) * 2, 0, 1), 2);
          return [60 + 195 * c, 10 + 150 * c * c, 4 + 30 * c * c, 255];
        });
        this.waterTex.repeat.set(map.size / 160, map.size / 160); this.waterTex.colorSpace = THREE.SRGBColorSpace;
        const lm = new THREE.MeshBasicMaterial({ map: this.waterTex, fog: false }); lm.color.setScalar(2.4);
        this.water = new THREE.Mesh(wg, lm); this.water.rotation.x = -Math.PI / 2; this.water.position.set(map.size / 2, map.waterY, map.size / 2);
        this.water.renderOrder = 2; this.scene.add(this.water);
        const fuv = new Float32Array(wg.attributes.uv.count * 2);
        for (let i = 0; i < fuv.length / 2; i++) { fuv[i * 2] = wg.attributes.uv.getX(i); fuv[i * 2 + 1] = 1 - wg.attributes.uv.getY(i); }
        const wg2 = wg.clone(); wg2.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
        const wf = new THREE.Mesh(wg2, new THREE.MeshBasicMaterial({ color: bio.fogCol, alphaMap: this.fogTex, transparent: true, depthWrite: false, fog: false }));
        wf.rotation.x = -Math.PI / 2; wf.position.set(map.size / 2, map.waterY + 0.15, map.size / 2); wf.renderOrder = 6; this.scene.add(wf);
      } else {
        const w = makeWater(map, this.fogTex, this.sunDir, bio.sun);
        this.water = w.mesh; this.waterUni = w.uni; this.waterDepth = w; this.scene.add(w.mesh); this.noReflect.push(w.mesh);
        if (quality >= 2) { this.refRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }); w.uni.uRef.value = this.refRT.texture; w.uni.uRefM.value = this.refM; w.uni.uRefOn.value = 1; }
      }
    }

    this.scenery = new Scenery(this.scene, map, Renderer.mobile ? 0 : quality, map.seed);
    this.world = new World(this.scene, map, quality);
    this.skyDay.set(bio.sky);
    // dynamic lights (fixed pool so shaders never recompile)
    for (let i = 0; i < (quality >= 1 ? 3 : 1); i++) {
      const l = new THREE.PointLight(0xffa050, 0, 320, 1.4); this.scene.add(l); this.lights.push({ l, life: 0, max: 1, peak: 0 });
    }
    this.fireLight = new THREE.PointLight(0xff7a28, 0, 260, 1.5); this.scene.add(this.fireLight);
    const dm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.6, flatShading: true }), 360);
    dm.frustumCulled = false; dm.castShadow = true; dm.count = 360; this.debris = dm; this.scene.add(dm);
    _m.makeScale(0, 0, 0); for (let i = 0; i < 360; i++) dm.setMatrixAt(i, _m);

    // ── instanced helpers ──
    const addIM = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order = 0) => {
      const im = new THREE.InstancedMesh(geo, mat, cap); im.frustumCulled = false; im.count = 0; im.renderOrder = order;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(im); return im;
    };
    const ringGeo = new THREE.RingGeometry(0.955, 1, 64); ringGeo.rotateX(-Math.PI / 2);
    this.selIM = addIM(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false }), 600, 8);
    this.selIM.setColorAt(0, _c.set(0xffffff));
    const ring2 = new THREE.RingGeometry(0.7, 1, 40); ring2.rotateX(-Math.PI / 2);
    this.ringIM = addIM(ring2, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 48, 10);
    this.ringIM.setColorAt(0, _c.set(0xffffff));
    const bg = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beamIM = addIM(bg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 400, 10);
    this.beamIM.setColorAt(0, _c.set(0xffffff));
    this.projIM = addIM(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 1200);
    this.projIM.setColorAt(0, _c.set(0xffffff));
    // wrecks
    const wparts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.BoxGeometry(0.3 + hash2(i, 1, 5) * 0.7, 0.2 + hash2(i, 2, 5) * 0.5, 0.3 + hash2(i, 3, 5) * 0.8);
      g.rotateY(hash2(i, 4, 5) * 6); g.rotateZ((hash2(i, 5, 5) - 0.5) * 0.9); g.translate((hash2(i, 6, 5) - 0.5) * 1.3, 0.15, (hash2(i, 7, 5) - 0.5) * 1.3);
      wparts.push(g);
    }
    for (let i = 0; i < wparts.length; i++) { wparts[i] = wparts[i].toNonIndexed(); boxUV(wparts[i], 0.3); }
    this.wreckIM = addIM(mergeGeometries(wparts), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.3, map: plate.map, normalMap: plate.normal }), 1500);
    this.wreckIM.setColorAt(0, _c.set(0xffffff));
    this.wreckIM.castShadow = true; this.wreckIM.receiveShadow = true;
    // unclaimed supply points: pallets, crates and a couple of shipping containers on a gravel pad
    const sparts: THREE.BufferGeometry[] = [];
    const crate = (w: number, h: number, l: number, x: number, z: number, y: number, ry: number, c: number) => {
      const g = new THREE.BoxGeometry(w, h, l).toNonIndexed(); g.rotateY(ry); g.translate(x, y + h / 2, z);
      const n = g.attributes.position.count, ca = new Float32Array(n * 3); _c.setHex(c);
      for (let i = 0; i < n; i++) { const f = 0.8 + 0.3 * hash2(i >> 2, sparts.length, 3); ca[i * 3] = _c.r * f; ca[i * 3 + 1] = _c.g * f; ca[i * 3 + 2] = _c.b * f; }
      g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); g.deleteAttribute('uv'); sparts.push(g);
    };
    crate(2.4, 2.5, 6, -3.4, -1, 0, 0.1, 0x5a4a3c); crate(2.4, 2.5, 6, 3, 2.6, 0, 1.4, 0x3f5a6a); crate(1.6, 1.3, 1.6, 0.5, -3.6, 0, 0.4, 0x8c7a52); crate(1.6, 1.3, 1.6, 2.3, -3.2, 0, 0.1, 0x8c7a52);
    crate(1.5, 1.2, 1.5, 1.4, -3.4, 1.3, 0.7, 0x7a6a48); crate(1.2, 1, 1.8, -1.6, 3.6, 0, 0.9, 0x5c6444); crate(1.2, 1, 1.8, -3.2, 4, 0, 0.3, 0x5c6444); crate(3.2, 0.3, 2.6, 0.2, 0.4, 0, 0.2, 0x6a5a40);
    this.spotIM = addIM(mergeGeometries(sparts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 }), map.spots.length);
    this.spotIM.castShadow = true; this.spotIM.receiveShadow = true;
    this.spotIM.setColorAt(0, _c.set(0xffffff));
    const scTex = noiseTexture(64, (x, y) => { const d = Math.hypot(x - 32, y - 32) / 32; return [0, 0, 0, 255 * clamp(1 - d, 0, 1) ** 1.5 * 0.85]; });
    const sg = new THREE.PlaneGeometry(2, 2); sg.rotateX(-Math.PI / 2);
    this.scorchIM = addIM(sg, new THREE.MeshBasicMaterial({ map: scTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), 700, 3);

    const pk = Renderer.mobile ? 0.45 : 1;
    this.fire = new Particles(Math.round((quality >= 1 ? 9000 : 4000) * pk), true); this.smoke = new Particles(Math.round((quality >= 1 ? 4000 : 1500) * pk), false);
    this.scene.add(this.smoke.pts, this.fire.pts);

    this.ghost = new THREE.Group(); this.ghost.visible = false; this.scene.add(this.ghost);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.45, depthWrite: false });
    const rr = new THREE.RingGeometry(0.992, 1, 96); rr.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(rr, new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.6, depthTest: false, fog: false }));
    this.rangeRing.visible = false; this.rangeRing.renderOrder = 9; this.scene.add(this.rangeRing);

    if (quality >= 1) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Renderer.mobile ? 0 : 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (quality >= 2) {
        // ground-truth ambient occlusion: contact shadows under vehicles, in doorways, between buildings. Foliage cards are left out of it.
        const ao = new GTAOPass(this.scene, this.camera, 4, 4);
        ao.blendIntensity = 0.7; ao.updateGtaoMaterial({ radius: 5.5, distanceExponent: 1.2, thickness: 1.6, scale: 1.15, samples: 12, screenSpaceRadius: false } as any);
        const ov = ao.overrideVisibility.bind(ao), skip = [...this.scenery.foliage, ...this.noReflect.filter(o => o !== terrain), this.sky];
        ao.overrideVisibility = () => { ov(); for (const o of skip) o.visible = false; };
        this.composer.addPass(ao);
      }
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.2, 0.35, 1.0); this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uHeat: { value: 0 }, uT: this.uTime, uCold: this.uSeason.snow, uFlir: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uHeat, uT, uCold, uFlir; varying vec2 vUv;
          void main(){ vec3 c=texture2D(tDiffuse, vUv).rgb; vec2 d=vUv-0.5; float v=smoothstep(0.85, 0.25, length(d*vec2(1.0,0.82)));
            // bleach-bypass war-footage grade: pulled saturation, crushed blacks, a cold cast in winter, film grain
            float l=dot(c, vec3(0.299,0.587,0.114)); c=mix(vec3(l), c, 0.84); c=(c-0.5)*1.12+0.5;
            c*=mix(vec3(1.0), vec3(0.94,0.98,1.05), uCold);
            c*=mix(0.58, 1.0, v); c.r+=uHeat*(1.0-v)*0.12;
            float g=fract(sin(dot(vUv*vec2(1920.0,1080.0)+fract(uT)*71.0, vec2(12.9898,78.233)))*43758.5453);
            c+=(g-0.5)*0.045;
            if (uFlir > 0.5) { // white-hot thermal imager: flattened greys, blooming hot spots, scan lines, sensor noise
              float t=dot(c, vec3(0.3,0.5,0.2)); t=pow(clamp(t*1.15,0.0,1.0), 0.85); t=mix(t*0.55+0.12, 1.0, smoothstep(0.62, 0.95, t));
              t*=0.93+0.07*sin(vUv.y*900.0); t+=(g-0.5)*0.1; c=vec3(t)*vec3(0.94,1.0,0.96)*mix(0.5,1.0,v); }
            gl_FragColor=vec4(max(c,0.0),1.0); }`,
      });
      this.composer.addPass(this.grade);
    }
    this.cam.x = me.startX; this.cam.z = me.startZ;
    this.resize();
  }

  /** the stylised day / night cycle and the season's light */
  private updateEnv(dt: number, paused: boolean) {
    const g = this.game, bio = this.map.biome;
    const dayT = (g.tick / TICK / DAY_SECS + 0.27) % 1, ang = (dayT - 0.25) * 6.283, el = Math.min(1, Math.sin(ang) * 0.8 + 0.42);
    const night = this.night = smooth(0.1, -0.16, el), dayK = clamp(el * 2.6, 0, 1), overcast = Math.max(g.snow * 0.55, g.mud * 0.7);
    if (el > -0.06) { const az = ang * 0.5 + 0.5; this.sunDir.set(Math.cos(az) * 0.8, Math.max(0.14, el * 0.9), Math.sin(az) * 0.8).normalize(); _c.setHex(0xff9450).lerp(_c2.setHex(bio.sun), dayK); this.sun.intensity = (0.5 + 2.0 * dayK) * (1 - 0.4 * overcast); }
    else { this.sunDir.set(-0.35, 0.82, 0.3).normalize(); _c.setHex(0xb4c8ee); this.sun.intensity = 2.1; }
    this.sun.color.copy(_c);
    const sky = _c.copy(this.skyDay).lerp(_c2.setHex(0x8e959b), overcast).lerp(_c2.setHex(0xe09060), (1 - dayK) * (1 - night) * 0.45);
    this.hemi.color.copy(sky).lerp(_c2.setHex(0x8094c0), night); this.hemi.intensity = lerp(0.85, 2.4, night) * (1 - 0.1 * overcast);
    if (this.waterUni) { this.waterUni.uSunDir.value.copy(this.sunDir); this.waterUni.uSky.value.copy(sky).lerp(_c2.setHex(0x0a0e18), night * 0.9); this.waterUni.uSunCol.value.copy(this.sun.color).multiplyScalar(night > 0.5 ? 0.25 : 1); this.waterUni.uIce.value = g.snow; }
    // the sky dome follows the real sun (which may be below the horizon); haze thickens under overcast
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms, az0 = ang * 0.5 + 0.5;
    su.sunPosition.value.set(Math.cos(az0) * 0.8, el * 0.9, Math.sin(az0) * 0.8).normalize();
    su.turbidity.value = lerp(2.6, 16, overcast); su.rayleigh.value = lerp(1.5, 0.5, overcast) + (1 - dayK) * 1.2 * (1 - night);
    su.mieCoefficient.value = 0.004 + 0.03 * overcast; su.mieDirectionalG.value = 0.84;
    this.skyK.value = lerp(0.26, 0.2, overcast) * (1 - night * 0.92); this.skyNight.value.setHex(0x0c1220).multiplyScalar(night);
    this.sky.position.copy(this.camera.position);
    this.envT -= dt;
    if (this.envT <= 0 || Math.abs(el - this.envEl) > 0.05) { // re-filter the sky into the lighting environment as the hour changes
      this.envT = 6; this.envEl = el;
      const rt = this.pmrem.fromScene(this.skyEnv, 0, 1, 6000);
      this.scene.environment = rt.texture; if (this.envRT) this.envRT.dispose(); this.envRT = rt;
    }
    sky.multiplyScalar(lerp(0.62, 0.5, overcast)).lerp(_c2.setHex(0x101826), night);
    (this.scene.background as THREE.Color).copy(sky); (this.scene.fog as THREE.Fog).color.copy(sky);
    this.scene.environmentIntensity = lerp(1.35, 0.8, night);
    (this.skirt.material as THREE.MeshBasicMaterial).color.copy(this.skirtCol).multiplyScalar(lerp(1, 0.06, night) * (0.35 + 0.65 * dayK + 0.65 * night));
    if (this.bloomPass) this.bloomPass.strength = lerp(0.18, 0.28, night);
    this.uSeason.snow.value = g.snow; this.uSeason.mud.value = g.mud; this.uSeason.dry.value = g.dry;
    if (this.grade) this.grade.uniforms.uFlir.value = this.flir ? 1 : 0;
    this.unitMat.emissiveIntensity = this.flir ? 0.75 : 0; // engines and bodies glow in thermal
    void dt; void paused;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
    if (this.refRT) this.refRT.setSize(Math.round(w * 0.6), Math.round(h * 0.6));
    const sc = h * this.renderer.getPixelRatio() / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.fire.mat.uniforms.scale.value = sc; this.smoke.mat.uniforms.scale.value = sc;
  }
  dispose() { this.renderer.dispose(); }

  // ───────────── camera / picking ─────────────
  /** first-person ride-along: the unit whose eyes we are looking through, and how far the viewer has turned their head */
  fp: Unit | null = null; fpLook = { yaw: 0, pitch: 0, fov: 68 }; private fpSaved = { dist: 260, x: 0, z: 0 }; private alpha = 1;
  /** enter (or with null, leave) the first-person view. The unit keeps doing whatever it was ordered to do. */
  setFP(u: Unit | null) {
    if (u === this.fp) return;
    if (u && !this.fp) this.fpSaved = { dist: this.cam.dist, x: this.cam.x, z: this.cam.z };
    if (!u && this.fp) { this.cam.dist = this.fpSaved.dist; this.cam.x = this.fp.x; this.cam.z = this.fp.z; }
    this.fp = u; this.fpLook.yaw = 0; this.fpLook.pitch = 0; this.fpLook.fov = 68;
    this.camera.fov = u ? 68 : 42; this.camera.near = u ? 0.25 : 2; this.resize();
  }
  private updateFP(u: Unit) {
    const d = u.def, a = this.alpha, map = this.map, L = this.fpLook, T = this.time;
    const x = lerp(u.px, u.x, a), z = lerp(u.pz, u.z, a), y = lerp(u.py, u.y, a);
    const hd = u.ph + angDiff(u.ph, u.heading) * a, tu = u.pturret + angDiff(u.pturret, u.turret) * a;
    let ex = x, ey = y, ez = z, yaw = tu, pitch = 0;
    if (d.inf) { // through his eyes: the rifle and his hands are in the bottom of the frame
      const kn = this.pose.get(u) || 0, mv = Math.min(1, u.speed / d.speed);
      ey = y + 4.12 - 0.93 * kn + Math.abs(Math.sin(T * 11 + u.id * 1.7)) * 0.1 * mv; ex += Math.sin(tu) * 0.42; ez += Math.cos(tu) * 0.42; pitch = -0.04;
    } else if (d.cls === 'air') { // from the nose (or the drone's camera), looking down at the ground ahead
      yaw = hd; ex += Math.sin(hd) * d.r * 1.15; ez += Math.cos(hd) * d.r * 1.15; ey = y + (d.hover ? -0.4 : 0.2); pitch = d.kami ? -0.3 : d.hover ? -0.38 : -0.3;
    } else if (d.cls === 'building') { ey = y + d.h + 2.5; ex -= Math.sin(tu) * d.r * 0.5; ez -= Math.cos(tu) * d.r * 0.5; pitch = -0.1; }
    else { // from the commander's hatch, looking along the gun
      const k = Math.min(1, u.speed / (d.speed || 1));
      ey = y + d.h * 1.02 + 1.1 + Math.abs(Math.sin(T * 29 + u.id)) * 0.07 * k; ex -= Math.sin(tu) * d.r * 0.32; ez -= Math.cos(tu) * d.r * 0.32; pitch = -0.07;
    }
    L.pitch = clamp(L.pitch, -1.2, 0.9); L.fov = clamp(L.fov, 22, 90);
    yaw += L.yaw; pitch += L.pitch;
    ey = Math.max(ey, map.groundY(ex, ez) + 0.6);
    const cam = this.camera, cp = Math.cos(pitch);
    if (cam.fov !== L.fov) { cam.fov = L.fov; this.resize(); }
    cam.position.set(ex, ey, ez); cam.up.set(0, 1, 0);
    cam.lookAt(ex + Math.sin(yaw) * cp, ey + Math.sin(pitch), ez + Math.cos(yaw) * cp);
    if (d.cls === 'air' && !d.hover) cam.rotateZ(u.bank * 0.7);
    if (this.shake > 0.01) { const k = this.shake * 0.25; cam.position.x += (Math.random() - 0.5) * k; cam.position.y += (Math.random() - 0.5) * k; cam.position.z += (Math.random() - 0.5) * k; }
    cam.updateMatrixWorld();
    const c = this.cam; c.x = x; c.z = z; c.dist = 90; // sound, weather and effects stay centred on the unit
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.sunDir.x * 700, y + this.sunDir.y * 700, z + this.sunDir.z * 700);
    const sc = this.sun.shadow.camera; sc.left = -200; sc.right = 200; sc.top = 200; sc.bottom = -200; sc.near = 50; sc.far = 1400; sc.updateProjectionMatrix();
    this.sun.castShadow = this.quality >= 1;
  }
  private updateCamera() {
    if (this.fp) { if (this.fp.dead || !this.shown(this.fp)) this.setFP(null); else { this.updateFP(this.fp); return; } }
    const c = this.cam, S = this.map.size;
    c.x = clamp(c.x, 0, S); c.z = clamp(c.z, 0, S); c.dist = clamp(c.dist, 20, 1500); c.pitch = clamp(c.pitch, 0.45, 1.5);
    const ty = this.map.groundY(c.x, c.z);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, ty + sp * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, ty, c.z);
    if (this.shake > 0.01) { const k = this.shake * c.dist * 0.004; this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k; this.camera.position.z += (Math.random() - 0.5) * k; }
    this.camera.updateMatrixWorld();
    const sd = clamp(c.dist * 0.8, 140, 560);
    this.sun.target.position.set(c.x, ty, c.z);
    this.sun.position.set(c.x + this.sunDir.x * 700, ty + this.sunDir.y * 700, c.z + this.sunDir.z * 700);
    const sc = this.sun.shadow.camera; sc.left = -sd; sc.right = sd; sc.top = sd; sc.bottom = -sd; sc.near = 50; sc.far = 1400; sc.updateProjectionMatrix();
    this.sun.castShadow = this.quality >= 1 && c.dist < 800;
  }
  /** screen px → ground point */
  pick(sx: number, sy: number): { x: number; z: number } | null {
    this.ray.setFromCamera(new THREE.Vector2(sx / window.innerWidth * 2 - 1, -(sy / window.innerHeight) * 2 + 1), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, map = this.map;
    if (d.y >= -0.01) return null;
    let t = Math.max(0, (80 - o.y) / d.y), px = 0, pz = 0, prev = t;
    for (let i = 0; i < 600; i++) {
      px = o.x + d.x * t; pz = o.z + d.z * t;
      const y = o.y + d.y * t;
      if (y <= map.groundY(px, pz)) {
        let a = prev, b = t;
        for (let k = 0; k < 8; k++) { const mid = (a + b) / 2; if (o.y + d.y * mid <= map.groundY(o.x + d.x * mid, o.z + d.z * mid)) b = mid; else a = mid; }
        return { x: clamp(o.x + d.x * b, 0, map.size), z: clamp(o.z + d.z * b, 0, map.size) };
      }
      prev = t; t += 3;
    }
    return null;
  }
  project(x: number, y: number, z: number, out: { x: number; y: number; ok: boolean }) {
    _v.set(x, y, z).project(this.camera);
    out.x = (_v.x + 1) / 2 * window.innerWidth; out.y = (1 - _v.y) / 2 * window.innerHeight; out.ok = _v.z < 1 && _v.z > -1;
  }
  /** spectator mode: everything is visible */
  spectate = false;
  shown(u: Unit) {
    if (this.spectate || u.team.ally === this.me.ally) return true;
    if (u.def.cls === 'building') return ((u.seen >> this.me.id) & 1) === 1;
    return (this.me.vis[this.map.cellOf(u.x, u.z)] & 2) !== 0;
  }

  setGhost(def: UnitDef | null, x = 0, z = 0, ok = true, yOff = 0, rot = 0) {
    if (def !== this.ghostDef) {
      this.ghost.clear(); this.ghostDef = def;
      if (def) for (const [geo, piv] of partList(def, geosFor(def, this.me.id))) { const m = new THREE.Mesh(geo, this.ghostMat); if (piv) m.position.fromArray(piv); this.ghost.add(m); }
    }
    this.ghost.visible = !!def; this.rangeRing.visible = false;
    if (def) {
      const y = this.map.groundY(x, z);
      this.ghost.position.set(x, y + 0.3 + yOff, z); this.ghost.rotation.y = rot; this.ghostMat.color.setHex(ok ? 0x40ff80 : 0xff4030);
      const rg = def.jam || (def.weapons[0] && !def.weapons[0].bld ? def.weapons[0].range : 0) || def.radar;
      if (rg) { this.rangeRing.visible = true; this.rangeRing.position.set(x, y + 2, z); this.rangeRing.scale.setScalar(rg); }
    }
  }

  // ───────────── effects ─────────────
  private flash(x: number, y: number, z: number, peak: number, dur: number, color = 0xffa050) {
    let best = this.lights[0], bv = 1e9;
    for (const L of this.lights) { const v = L.life > 0 ? L.peak * L.life / L.max : 0; if (v < bv) { bv = v; best = L; } }
    if (!best || bv > peak) return;
    best.l.position.set(x, y, z); best.l.color.setHex(color); best.life = best.max = dur; best.peak = peak;
  }
  private throwDebris(x: number, y: number, z: number, n: number, size: number, speed: number) {
    for (let k = 0; k < n; k++) {
      const i = this.dHead; this.dHead = (i + 1) % 360;
      const a = Math.random() * 6.283, e = 0.4 + Math.random() * 1.0, v = speed * (0.4 + Math.random() * 0.9);
      this.dPos[i * 3] = x; this.dPos[i * 3 + 1] = y + 1; this.dPos[i * 3 + 2] = z;
      this.dVel[i * 3] = Math.cos(a) * Math.cos(e) * v; this.dVel[i * 3 + 1] = Math.sin(e) * v; this.dVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * v;
      _q.setFromAxisAngle(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * 6);
      this.dRot[i * 4] = _q.x; this.dRot[i * 4 + 1] = _q.y; this.dRot[i * 4 + 2] = _q.z; this.dRot[i * 4 + 3] = _q.w;
      this.dLife[i] = 1e9; this.dSize[i] = size * (0.4 + Math.random() * 0.9);
    }
  }
  private updateDebris(dt: number) {
    const map = this.map, P = this.dPos, V = this.dVel, R = this.dRot;
    for (let i = 0; i < 360; i++) {
      if (this.dLife[i] <= 0) continue;
      const moving = Math.abs(V[i * 3 + 1]) + Math.abs(V[i * 3]) + Math.abs(V[i * 3 + 2]) > 0.5;
      if (moving) {
        V[i * 3 + 1] -= 70 * dt;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        const gy = map.heightAt(P[i * 3], P[i * 3 + 2]) + this.dSize[i] * 0.25;
        if (P[i * 3 + 1] < gy) {
          if (gy < map.waterY) { this.dLife[i] = 0; this.smoke.spawn(P[i * 3], map.waterY + 0.5, P[i * 3 + 2], 0, 9, 0, 0.6, 2.5, 0.9, 0.95, 1, 0.5, 1.5, 1, 20); }
          P[i * 3 + 1] = gy;
          if (Math.abs(V[i * 3 + 1]) > 12) { V[i * 3 + 1] *= -0.32; V[i * 3] *= 0.55; V[i * 3 + 2] *= 0.55; } else { V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0; }
        } else {
          // tumble + smoke trail
          _q.set(R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]); _q2.setFromAxisAngle(_zAxis, dt * 9); _q.multiply(_q2);
          R[i * 4] = _q.x; R[i * 4 + 1] = _q.y; R[i * 4 + 2] = _q.z; R[i * 4 + 3] = _q.w;
          if (Math.random() < 0.35) this.smoke.spawn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, 1, 0, 0.9, 1.4, 0.16, 0.15, 0.14, 0.4, 2, 0.5);
          if (Math.random() < 0.2) this.fire.spawn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, 0, 0, 0.25, 1.6, 3, 1.6, 0.5, 0.8, 0, 0, 0, 1);
        }
      }
      const sc = this.dSize[i] * Math.min(1, this.dLife[i]);
      _q.set(R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]); _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); _v.setScalar(this.dLife[i] > 0 ? sc : 0);
      _m.compose(_p, _q, _v); this.debris.setMatrixAt(i, _m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  private boom(x: number, y: number, z: number, size: number, c = 0xffa040, heavy = false) {
    const f = this.fire, s = this.smoke, q = this.quality >= 1 ? 1 : 0.5, map = this.map;
    const n = Math.min(70, 8 + size * 2.4) * q;
    const wet = map.heightAt(x, z) < map.waterY - 0.5 && y < map.waterY + 6;
    const cd = Math.hypot(x - this.cam.x, z - this.cam.z);
    this.shake = Math.min(3, this.shake + size * size * 0.012 / (1 + cd / (this.cam.dist * 0.5 + 60)));
    this.flash(x, y + 4 + size * 0.3, z, clamp(size * 70, 200, 4200), 0.14 + size * 0.01, wet ? 0xcfe8ff : 0xffa860);
    if (wet) {
      // water plume
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, v = size * (0.3 + Math.random() * 1.2);
        s.spawn(x + Math.cos(a) * size * 0.2, map.waterY + 0.5, z + Math.sin(a) * size * 0.2, Math.cos(a) * v, size * (2.5 + Math.random() * 5), Math.sin(a) * v, 0.8 + Math.random() * 0.8, size * 0.9, 0.9, 0.96, 1, 0.75, 1.4, 0.8, 40);
      }
      for (let i = 0; i < n * 0.5; i++) { const a = Math.random() * 6.283, v = size * (1.5 + Math.random() * 2); s.spawn(x, map.waterY + 0.3, z, Math.cos(a) * v, 1, Math.sin(a) * v, 1.2, size * 1.1, 0.85, 0.93, 1, 0.5, 2.2, 2.2); }
      if (this.rings.length < 40) this.rings.push({ x, y: map.waterY + 0.4, z, life: 0.9, max: 0.9, size: size * 3 });
      return;
    }
    // a real blast: a split-second flash, a small dirty fireball that is gone almost at once, a fountain of thrown earth, then smoke and dust
    // the fire itself stays small however big the blast: the scale of a large explosion is carried by its smoke and thrown earth
    const fs = Math.min(size, 9) * (this.night > 0.5 ? 0.75 : 1);
    f.spawn(x, y + fs * 0.3, z, 0, 0, 0, 0.07, fs * 2.6, 2.4, 1.9, 1.3, 0.8, 0.4);
    for (let i = 0; i < n * 0.4; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.5, v = size * (0.8 + Math.random() * 2.2);
      f.spawn(x, y + 1, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v * 1.1 + size * 0.5, Math.sin(a) * Math.cos(e) * v, 0.22 + Math.random() * 0.3 + size * 0.006, fs * (0.4 + Math.random() * 0.5), 1.7, 0.8, 0.22, 0.55, 0.8, 3.4, -4, 1);
    }
    for (let i = 0; i < n * 0.45; i++) { // sparks and burning fragments
      const a = Math.random() * 6.283, v = size * (3 + Math.random() * 7);
      f.spawn(x, y + 1, z, Math.cos(a) * v, size * (2 + Math.random() * 6), Math.sin(a) * v, 0.5 + Math.random() * 0.9, 0.5 + Math.random() * 0.5, 3, 2, 0.8, 1, 0, 0.7, 65, 1);
    }
    _c.setHex(map.biome.low); const er = _c.r * 0.35 + 0.07, eg = _c.g * 0.3 + 0.06, eb = _c.b * 0.25 + 0.04, sn = this.game.snow;
    for (let i = 0; i < n * 0.6; i++) { // earth thrown up in a cone, falling back
      const a = Math.random() * 6.283, v = size * (0.6 + Math.random() * 1.8), k = 0.7 + Math.random() * 0.6;
      s.spawn(x + Math.cos(a) * size * 0.2, y + 0.5, z + Math.sin(a) * size * 0.2, Math.cos(a) * v, size * (3 + Math.random() * 5.5), Math.sin(a) * v, 0.9 + Math.random() * 0.8, size * (0.3 + Math.random() * 0.4), lerp(er * k, 0.8, sn * 0.6), lerp(eg * k, 0.8, sn * 0.6), lerp(eb * k, 0.82, sn * 0.6), 0.85, 0.8, 0.5, 42);
    }
    for (let i = 0; i < n * 0.7; i++) { // black-grey smoke boiling up and drifting off
      const a = Math.random() * 6.283, v = size * (0.3 + Math.random() * 1.1), g = 0.035 + Math.random() * 0.07;
      s.spawn(x + Math.cos(a) * size * 0.35, y + 1 + Math.random() * size * 0.5, z + Math.sin(a) * size * 0.35, Math.cos(a) * v, size * (0.7 + Math.random() * 1.4), Math.sin(a) * v, 1.8 + Math.random() * 2.4 + size * 0.06, size * 1.3, g, g, g * 1.05, 0.7, 2.2, 1.1, -1.5);
    }
    for (let i = 0; i < n * 0.4; i++) { // dust skirt rolling out along the ground
      const a = Math.random() * 6.283, v = size * (2 + Math.random() * 2.5);
      s.spawn(x, y + 0.6, z, Math.cos(a) * v, 1 + Math.random() * 2, Math.sin(a) * v, 0.9 + Math.random() * 0.7, size * 1.1, _c.r * 0.8 + 0.1, _c.g * 0.8 + 0.1, _c.b * 0.8 + 0.1, 0.3, 2.6, 2.4);
    }
    if (heavy || size > 9) for (let i = 0; i < 14 * q; i++) { // rising column
      const g = 0.04 + Math.random() * 0.06;
      s.spawn(x + (Math.random() - 0.5) * size * 0.4, y + 2, z + (Math.random() - 0.5) * size * 0.4, 0, size * (1.5 + Math.random() * 2.2), 0, 2.5 + Math.random() * 2, size * 1.3, g, g, g, 0.7, 2.6, 0.9, -2);
    }
    if (this.rings.length < 40) this.rings.push({ x, y: y + 0.8, z, life: 0.45, max: 0.45, size: size * 3.4 });
    if (y < map.groundY(x, z) + 8) {
      const i = this.scorchN++ % 700; map.normalAt(x, z, _n);
      _q.setFromUnitVectors(_up, _n); _p.set(x, map.heightAt(x, z) + 0.15, z); _s.setScalar(size * 1.5);
      _m.compose(_p, _q, _s); this.scorchIM.setMatrixAt(i, _m); this.scorchIM.count = Math.min(700, this.scorchN); this.scorchIM.instanceMatrix.needsUpdate = true;
      _s.set(1, 1, 1);
    }
  }
  private consumeEvents() {
    const g = this.game, me = this.me, map = this.map;
    for (const e of g.events) {
      const vis = (me.vis[map.cellOf(e.x, e.z)] & 2) !== 0 || (e.tx !== undefined && (me.vis[map.cellOf(e.tx, e.tz!)] & 2) !== 0);
      if (this.onEvent) this.onEvent(e, vis);
      if (!vis) continue;
      switch (e.t) {
        case 'beam': { // small-arms and autocannon fire: muzzle flash, the odd tracer, dust where it lands
          const heavy = e.size! > 11, dx = e.tx! - e.x, dy = e.ty! - e.y, dz = e.tz! - e.z, len = Math.hypot(dx, dy, dz) || 1, f = this.fire;
          const ux = dx / len, uy = dy / len, uz = dz / len, sz = heavy ? 3.4 : 2.2;
          f.spawn(e.x, e.y, e.z, 0, 0, 0, 0.05, sz * 1.5, 3.6, 2.9, 1.7, 1, 0, 0, 0, 1);
          f.spawn(e.x + ux * sz * 0.35, e.y + uy * sz * 0.35, e.z + uz * sz * 0.35, ux * 30, uy * 30, uz * 30, 0.06, sz, 3.4, 2.3, 0.9, 0.9, 0, 0, 0, 1);
          f.spawn(e.x + ux * sz * 0.8, e.y + uy * sz * 0.8, e.z + uz * sz * 0.8, ux * 50, uy * 50, uz * 50, 0.05, sz * 0.6, 3, 1.7, 0.5, 0.8, 0, 0, 0, 1);
          if (Math.random() < 0.25) this.smoke.spawn(e.x, e.y, e.z, ux * 4, 2, uz * 4, 0.7, 1.3, 0.6, 0.6, 0.58, 0.22, 2, 1.5);
          if (Math.random() < (heavy ? 0.6 : 0.34)) this.beams.push({ ax: e.x + ux * 3, ay: e.y + uy * 3, az: e.z + uz * 3, bx: e.tx!, by: e.ty!, bz: e.tz!, life: 0.07, max: 0.07, w: heavy ? 0.16 : 0.09, c: new THREE.Color(e.c!).multiplyScalar(2.4) });
          if (this.night > 0.3 && Math.random() < 0.3) this.flash(e.x, e.y + 1, e.z, heavy ? 900 : 420, 0.07, 0xffc070);
          if (e.ty! < map.groundY(e.tx!, e.tz!) + 9) {
            _c.setHex(map.biome.low);
            if (Math.random() < 0.5) this.smoke.spawn(e.tx!, e.ty!, e.tz!, (Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5, 0.5 + Math.random() * 0.4, heavy ? 2.2 : 1.3, _c.r * 0.6 + 0.25, _c.g * 0.6 + 0.24, _c.b * 0.6 + 0.2, 0.4, 2.2, 2);
            if (Math.random() < 0.3) f.spawn(e.tx!, e.ty!, e.tz!, (Math.random() - 0.5) * 30, Math.random() * 26, (Math.random() - 0.5) * 30, 0.25, 0.7, 3, 2.2, 1, 1, 0, 1, 60, 1);
          }
          break;
        }
        case 'muzzle': {
          const s = e.size || 1;
          if (e.k === 'launch') { // a cruise missile leaving its canister
            for (let i = 0; i < 40; i++) this.smoke.spawn(e.x + (Math.random() - 0.5) * 8, e.y - 4, e.z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 30, 2 + Math.random() * 9, (Math.random() - 0.5) * 30, 2.5 + Math.random() * 2.5, 9, 0.78, 0.76, 0.72, 0.5, 2.2, 1.4, -0.5);
            this.fire.spawn(e.x, e.y, e.z, 0, 10, 0, 0.3, 26, 3.4, 2.4, 1.2, 1, 0, 0, 0, 1); this.flash(e.x, e.y + 4, e.z, 5000, 0.5); this.shake = Math.min(3, this.shake + 0.5);
            break;
          }
          this.fire.spawn(e.x, e.y, e.z, 0, 0, 0, 0.08, 8 * s, 3.4, 2.6, 1.4, 1, 0, 0, 0, 1);
          if (s >= 1) for (let i = 0; i < 3; i++) { const a = Math.random() * 6.283; this.fire.spawn(e.x, e.y, e.z, Math.cos(a) * 26 * s, 3, Math.sin(a) * 26 * s, 0.07, 3.4 * s, 3.2, 2.2, 0.9, 0.9, 0, 0, 0, 1); }
          for (let i = 0; i < 4 * s; i++) this.smoke.spawn(e.x, e.y, e.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8, 0.8 + Math.random() * 0.5, 2.2 * s, 0.5, 0.49, 0.46, 0.32, 2.4, 1.4);
          if (s >= 1) { // dust kicked off the ground by the blast
            _c.setHex(map.biome.low); const gy = map.groundY(e.x, e.z) + 0.6;
            for (let i = 0; i < 5 * s; i++) { const a = Math.random() * 6.283, v = 8 + Math.random() * 10 * s; this.smoke.spawn(e.x, gy, e.z, Math.cos(a) * v, 0.6, Math.sin(a) * v, 0.9 + Math.random() * 0.6, 2.6 * s, _c.r * 0.6 + 0.26, _c.g * 0.6 + 0.25, _c.b * 0.6 + 0.2, 0.24, 2.6, 2.4); }
          }
          if (s > 1.5) { this.flash(e.x, e.y + 2, e.z, 2600, 0.14); this.shake = Math.min(3, this.shake + 0.25 / (1 + Math.hypot(e.x - this.cam.x, e.z - this.cam.z) / 200)); }
          else if (this.night > 0.3) this.flash(e.x, e.y + 2, e.z, 900, 0.1);
          break;
        }
        case 'boom': this.boom(e.x, e.y, e.z, e.size!, e.c); break;
        case 'die': {
          const u = e.u!, d = u.def, big = !!d.blast && d.blast.r > 60, sz = e.size! * (big ? 5 : 1.6);
          if (d.inf) { // a man goes down: no fireball, just a spray and the dust he falls into
            for (let i = 0; i < 5; i++) this.smoke.spawn(e.x, e.y + 2.4, e.z, (Math.random() - 0.5) * 7, 1 + Math.random() * 4, (Math.random() - 0.5) * 7, 0.45, 1.3, 0.32, 0.04, 0.03, 0.5, 1.4, 2.5, 24);
            _c.setHex(map.biome.low); this.smoke.spawn(e.x, e.y + 0.5, e.z, 0, 1.5, 0, 0.9, 2.6, _c.r * 0.6 + 0.25, _c.g * 0.6 + 0.24, _c.b * 0.6 + 0.2, 0.25, 2, 1.5);
            break;
          }
          this.boom(e.x, e.y + 2, e.z, sz, 0xffa040, big);
          if (d.cls === 'ground' && d.weapons[0] && d.weapons[0].k === 'cannon' && d.weapons[0].dmg >= 90 && d.speed) {
            // ammunition cook-off: the turret is thrown clear and a jet of flame stands out of the hull
            this.throwDebris(e.x, e.y + d.h, e.z, 1, 4.2, 46);
            for (let k = 0; k < 16; k++) this.later.push({ t: 0.15 + k * 0.09, fn: () => {
              for (let i = 0; i < 5; i++) this.fire.spawn(e.x + (Math.random() - 0.5) * 2, e.y + 3, e.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 9, 34 + Math.random() * 30, (Math.random() - 0.5) * 9, 0.45 + Math.random() * 0.3, 4.5, 3.4, 2.2, 0.8, 0.9, 0.6, 0.6, 0, 1);
              this.fire.spawn(e.x, e.y + 4, e.z, (Math.random() - 0.5) * 40, 20 + Math.random() * 40, (Math.random() - 0.5) * 40, 0.9, 0.8, 3.4, 2.6, 1.2, 1, 0, 0.3, 50, 1);
              this.flash(e.x, e.y + 8, e.z, 2600, 0.14);
            } });
          }
          this.throwDebris(e.x, e.y + d.h * 0.4, e.z, Math.min(26, 3 + d.r * 1.4) * (this.quality >= 1 ? 1 : 0.4), Math.min(3.2, 0.7 + d.r * 0.14), 18 + d.r * 2.2 + (big ? 30 : 0));
          if (d.cls === 'building' || big) {
            const k = big ? 7 : 2 + (d.r > 12 ? 2 : 0);
            for (let i = 0; i < k; i++) {
              const ox = (Math.random() - 0.5) * d.r * (big ? 5 : 1.6), oz = (Math.random() - 0.5) * d.r * (big ? 5 : 1.6);
              this.later.push({ t: 0.1 + Math.random() * (big ? 0.9 : 0.6), fn: () => this.boom(e.x + ox, this.map.groundY(e.x + ox, e.z + oz) + 2, e.z + oz, sz * (0.35 + Math.random() * 0.35)) });
            }
          }
          if (d.naval || d.water) for (let i = 0; i < 12; i++) this.smoke.spawn(e.x + (Math.random() - 0.5) * d.r, this.map.waterY + 0.4, e.z + (Math.random() - 0.5) * d.r, 0, 6 + Math.random() * 10, 0, 1.2, d.r * 0.5, 0.9, 0.96, 1, 0.6, 1.6, 0.8, 26);
          break;
        }
        case 'built': {
          _c.setHex(map.biome.low);
          for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283, r = e.u!.def.r; this.smoke.spawn(e.x + Math.cos(a) * r, e.y + 0.6, e.z + Math.sin(a) * r, Math.cos(a) * 6, 1.5, Math.sin(a) * 6, 1.2, 3, _c.r * 0.6 + 0.25, _c.g * 0.6 + 0.24, _c.b * 0.6 + 0.2, 0.25, 2.2, 1.5); }
          break;
        }
        case 'collapse': { // a building comes down in a pall of grey dust
          if (e.k === 'bridge') { // spans dropping into the river
            for (let i = 0; i < 50; i++) { const a = Math.random() * 6.283, r = Math.random() * 50; this.smoke.spawn(e.x + Math.cos(a) * r, map.waterY + 1, e.z + Math.sin(a) * r, Math.cos(a) * 8, 8 + Math.random() * 22, Math.sin(a) * 8, 1.5 + Math.random() * 1.5, 9, 0.88, 0.93, 0.97, 0.7, 1.6, 0.8, 30); }
            this.throwDebris(e.x, e.y + 2, e.z, 24, 2.6, 30); this.shake = Math.min(3, this.shake + 1.5);
            break;
          }
          const c = e.civ!, sz = e.size!, part = e.k === 'part';
          for (let i = 0; i < (part ? 22 : 60); i++) {
            const a = Math.random() * 6.283, r = Math.random() * sz, v = 6 + Math.random() * 16, gcol = 0.4 + Math.random() * 0.14;
            this.smoke.spawn(e.x + Math.cos(a) * r, e.y + Math.random() * Math.min(c.h, 30) * 0.7, e.z + Math.sin(a) * r, Math.cos(a) * v, 1 + Math.random() * 6, Math.sin(a) * v, 3.5 + Math.random() * 4, sz * (0.5 + Math.random() * 0.5), gcol, gcol * 0.96, gcol * 0.9, 0.62, 2.6, 0.8, -0.4);
          }
          this.throwDebris(e.x, e.y + (part ? c.h * 0.5 : 3), e.z, part ? 8 : 22, 2.4, 26);
          this.shake = Math.min(3, this.shake + (part ? 0.4 : 1.4) / (1 + Math.hypot(e.x - this.cam.x, e.z - this.cam.z) / 300));
          break;
        }
        case 'launch': { // an orbital launch from the pad
          const g = mergeGeometries([new THREE.CylinderGeometry(1.5, 1.5, 22, 12).translate(0, 11, 0), new THREE.ConeGeometry(1.5, 5, 12).translate(0, 24.5, 0),
            new THREE.CylinderGeometry(0.9, 1.1, 12, 8).translate(2.3, 6, 0), new THREE.CylinderGeometry(0.9, 1.1, 12, 8).translate(-2.3, 6, 0), new THREE.CylinderGeometry(0.9, 1.1, 12, 8).translate(0, 6, 2.3), new THREE.CylinderGeometry(0.9, 1.1, 12, 8).translate(0, 6, -2.3)]);
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.5, metalness: 0.2 })); m.position.set(e.x, e.y + 2.4, e.z); m.castShadow = true;
          this.scene.add(m); this.rockets.push({ m, vy: 0, t: 0, y0: e.y });
          break;
        }
      }
    }
    g.events.length = 0;
  }

  // ───────────── frame ─────────────
  private im(def: UnitDef, team: number, part: GK, geo: THREE.BufferGeometry): THREE.InstancedMesh {
    const key = def.id + '|' + team + '|' + part;
    let im = this.ims.get(key);
    if (!im || im.count >= im.instanceMatrix.count) {
      const cap = im ? im.instanceMatrix.count * 2 : 24;
      if (im) { this.scene.remove(im); im.dispose(); }
      im = new THREE.InstancedMesh(geo, this.unitMat, cap);
      im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, _c.set(0xffffff)); im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(im); this.ims.set(key, im);
      (im as any)._n = 0;
    }
    return im;
  }

  private frameFor(u: Unit): Frame {
    let f = this.frames.get(u);
    if (!f) {
      const g = geosFor(u.def, u.team.id), group = new THREE.Group();
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.14, map: this.plate.map, normalMap: this.plate.normal, clippingPlanes: [plane] });
      const wire = new THREE.MeshBasicMaterial({ color: 0xc8b070, wireframe: true, transparent: true, opacity: 0.13, depthWrite: false });
      let turret: THREE.Object3D | null = null;
      for (const [geo, piv] of partList(u.def, g)) {
        const o = new THREE.Group(); if (piv) o.position.fromArray(piv);
        o.add(new THREE.Mesh(geo, solid), new THREE.Mesh(geo, wire)); group.add(o); if (geo === g.t) turret = o;
      }
      this.scene.add(group);
      f = { group, solid, plane, turret }; this.frames.set(u, f);
    }
    return f;
  }

  frame(alpha: number, dt: number, selected: Set<Unit>, paused: boolean) {
    const g = this.game, map = this.map, me = this.me;
    this.time += dt;
    this.updateEnv(dt, paused);
    this.alpha = alpha;
    this.updateCamera();
    this.consumeEvents();
    for (const im of this.ims.values()) (im as any)._n = 0;
    let nSel = 0;
    const seenFrames = new Set<Unit>();
    const T = this.time, fireP = this.fire;
    for (const u of g.units) {
      if (u.dead || !this.shown(u)) continue;
      const d = u.def;
      if (d.cls === 'building' && !d.neutral && !d.span && !d.reuse && !this.cleared.has(u)) { this.cleared.add(u); this.scenery.clear(u.cx, u.cz, d.fw, d.fh); }
      const x = lerp(u.px, u.x, alpha), z = lerp(u.pz, u.z, alpha);
      let y = lerp(u.py, u.y, alpha), kn = 0;
      const h = u.ph + angDiff(u.ph, u.heading) * alpha;
      if (!u.built) {
        const f = this.frameFor(u); seenFrames.add(u);
        f.group.position.set(x, y, z); f.group.rotation.y = h;
        f.plane.constant = y + 0.2 + u.progress * d.h * 1.25;
        if (!paused && Math.random() < 0.3) {
          const a = Math.random() * 6.283, r = Math.random() * d.r * 0.8;
          if (Math.random() < 0.4) fireP.spawn(x + Math.cos(a) * r, y + u.progress * d.h * 1.1, z + Math.sin(a) * r, (Math.random() - 0.5) * 12, 4 + Math.random() * 8, (Math.random() - 0.5) * 12, 0.3 + Math.random() * 0.3, 0.6, 3.4, 2.4, 1, 1, 0, 0.5, 50, 1);
        }
      } else {
        if (d.naval) {
          _q.setFromAxisAngle(_yAxis, h); _q2.setFromAxisAngle(_zAxis, Math.sin(T * 1.1 + u.id) * 0.035); _q.multiply(_q2);
          _q2.setFromAxisAngle(_xAxis, Math.sin(T * 0.8 + u.id * 2) * 0.025); _q.multiply(_q2); y += Math.sin(T * 1.3 + u.id) * 0.3;
        } else if (d.cls === 'ground') {
          if (d.bot) {
            // stance: a man who is shooting or being shot at from a standstill drops to one knee
            const want = u.speed < 1 && (u.wt[0] || g.tick - u.lastHit < 100) ? 1 : 0;
            kn = this.pose.get(u) || 0; if (kn !== want) { kn += clamp(want - kn, -dt * 4, dt * 5); this.pose.set(u, kn); }
            if (u.speed > 1) y += Math.abs(Math.sin(T * 11 + u.id * 1.7)) * 0.1;
            y -= 0.93 * kn; _q.setFromAxisAngle(_yAxis, h);
          }
          else {
            map.normalAt(x, z, _n); _q.setFromUnitVectors(_up, _n); _q2.setFromAxisAngle(_yAxis, h); _q.multiply(_q2);
            // running gear: the hull shudders and rocks over the ground, squats under acceleration and kicks back when the main gun fires
            const k = Math.min(1, u.speed / (d.speed || 1)), w0 = d.weapons[0];
            let pitch = 0, roll = 0;
            if (k > 0.05) { pitch = (Math.sin(T * 13 + u.id * 3) * 0.012 + Math.sin(T * 5.3 + u.id) * 0.016) * k; roll = (Math.sin(T * 17 + u.id * 5) * 0.011 + Math.sin(T * 4.1 + u.id * 2) * 0.014) * k; y += Math.abs(Math.sin(T * 29 + u.id)) * 0.07 * k; }
            if (w0 && w0.k === 'cannon' && w0.dmg >= 90) { const since = w0.reload - u.cd[0]; if (since >= 0 && since < 0.45) { const kick = Math.sin(since / 0.45 * Math.PI) * (1 - since / 0.45) * 0.07, rel = u.turret - h; pitch -= Math.cos(rel) * kick; roll += Math.sin(rel) * kick; } }
            if (pitch || roll) { _e.set(pitch, 0, roll); _q2.setFromEuler(_e); _q.multiply(_q2); }
          }
        } else if (d.cls === 'air') {
          _q.setFromAxisAngle(_yAxis, h); _q2.setFromAxisAngle(_zAxis, -u.bank); _q.multiply(_q2);
          if (d.hover) y += Math.sin(T * 2 + u.id) * 0.8;
        } else _q.setFromAxisAngle(_yAxis, h);
        _p.set(x, y, z); _m.compose(_p, _q, _s);
        const geo = geosFor(d, u.team.id);
        // battle damage shows: hulls and walls blacken as they are shot up
        const hpf = u.hp / d.hp, soot = d.inf ? 0.86 + (u.id * 7 % 10) * 0.024 : hpf > 0.75 ? 1 : lerp(0.42, 1, hpf / 0.75);
        if (geo.b) { const im = this.im(d, u.team.id, 'b', geo.b); im.setColorAt((im as any)._n, _c.setScalar(soot)); im.setMatrixAt((im as any)._n++, _m); im.count = (im as any)._n; }
        if (geo.t) {
          const tp = d.model.tp!; let th = u.pturret + angDiff(u.pturret, u.turret) * alpha;
          _p.set(tp[0], tp[1], tp[2]);
          if (d.inf) {
            // a man is never still: he scans his arc, shifts his weight, breathes; running he leans in and his shoulders counter his stride; out in the cold he shivers
            const mv = Math.min(1, u.speed / d.speed * 1.4), idle = !u.wt[0] && mv < 0.1, ph = u.id * 1.7;
            const scan = idle ? Math.sin(T * 0.35 + ph) * 0.45 + Math.sin(T * 0.83 + ph * 2) * 0.2 : 0;
            th += scan * 0.5 + Math.sin(T * 11 + ph) * 0.09 * mv;
            const w0 = d.weapons[0], since = w0 ? w0.reload - u.cd[0] : 9, rec = w0 && w0.k === 'gun' && since >= 0 && since < 0.1 ? (1 - since / 0.1) * 0.07 : 0;
            const lean = mv * 0.2 + (u.wt[0] ? 0.12 : 0) + kn * 0.1 - rec + Math.sin(T * 1.6 + ph) * 0.012, sway = idle ? Math.sin(T * 0.6 + ph) * 0.035 : 0;
            const cold = g.snow > 0.3 && !u.sup ? Math.sin(T * 38 + ph) * 0.012 : 0;
            _q2.setFromAxisAngle(_yAxis, th - h); _e.set(lean, 0, sway + cold); _q3.setFromEuler(_e); _q2.multiply(_q3);
            _p.y += Math.sin(T * 1.6 + ph) * 0.02;
            _m2.compose(_p, _q2, _s); _m2.premultiply(_m);
            if (geo.h && u !== this.fp) { // the head leads the eyes (and is not drawn when we are looking out of it)
              const look = idle ? scan * 0.9 + (Math.sin(T * 0.21 + ph * 3) > 0.86 ? Math.sin(T * 2.2 + ph) * 0.7 : 0) : 0;
              _p.set(0, d.model.neck! - tp[1], 0); _q3.setFromAxisAngle(_yAxis, look); _e.set(idle ? Math.sin(T * 0.4 + ph * 5) * 0.08 : -lean * 0.6, 0, 0); _q4.setFromEuler(_e); _q3.multiply(_q4);
              _m3.compose(_p, _q3, _s); _m3.premultiply(_m2);
              const hm = this.im(d, u.team.id, 'h', geo.h); hm.setColorAt((hm as any)._n, _c.setScalar(soot)); hm.setMatrixAt((hm as any)._n++, _m3); hm.count = (hm as any)._n;
            }
          } else {
            const w0 = d.weapons[0];
            if (w0 && w0.k === 'cannon' && w0.dmg >= 90) { const since = w0.reload - u.cd[0]; if (since >= 0 && since < 0.3) { const rc = (1 - since / 0.3) * 0.7, rel = th - h; _p.x -= Math.sin(rel) * rc; _p.z -= Math.cos(rel) * rc; } }
            _q2.setFromAxisAngle(_yAxis, th - h); _m2.compose(_p, _q2, _s); _m2.premultiply(_m);
          }
          const im = this.im(d, u.team.id, 't', geo.t); im.setColorAt((im as any)._n, _c.setScalar(soot)); im.setMatrixAt((im as any)._n++, _m2); im.count = (im as any)._n;
        }
        if (geo.s) {
          const sp = d.model.sp!, rate = d.wind ? g.wind * 1.5 + 0.1 : d.extract && u.team.lowPower ? 0.2 : 1;
          _q2.setFromAxisAngle(d.model.sa === 'z' ? _zAxis : _yAxis, T * (d.model.ss || 1) * rate + u.id);
          _p.set(sp[0], sp[1], sp[2]); _m2.compose(_p, _q2, _s); _m2.premultiply(_m);
          const im = this.im(d, u.team.id, 's', geo.s); im.setMatrixAt((im as any)._n++, _m2); im.count = (im as any)._n;
        }
        if (geo.p) {
          // gait: each thigh swings from the hip and the knee folds as the leg comes forward; kneeling plants the right knee and props the left foot ahead
          const mv = Math.min(1, u.speed / d.speed * 1.4), ph = T * 11 + u.id * 1.7, hip = d.model.hip!, knee = d.model.knee!;
          for (let sd = 0; sd < 2; sd++) {
            const f = ph + sd * Math.PI;
            const th = lerp(Math.sin(f) * 0.62 * mv + (1 - mv) * Math.sin(T * 0.6 + u.id) * 0.02, sd ? 0.22 : -1.38, kn), kb = lerp(Math.max(0, -Math.cos(f)) * 1.05 * mv + 0.06, sd ? 1.5 : 1.42, kn);
            _p.set(0, hip, 0); _q2.setFromAxisAngle(_xAxis, th); _m2.compose(_p, _q2, _s); _m2.premultiply(_m);
            let im = this.im(d, u.team.id, sd ? 'q' : 'p', sd ? geo.q! : geo.p); im.setColorAt((im as any)._n, _c.setScalar(soot)); im.setMatrixAt((im as any)._n++, _m2); im.count = (im as any)._n;
            _p.set(0, knee - hip, 0); _q2.setFromAxisAngle(_xAxis, kb); _m3.compose(_p, _q2, _s); _m3.premultiply(_m2);
            im = this.im(d, u.team.id, sd ? 'l' : 'k', sd ? geo.l! : geo.k!); im.setColorAt((im as any)._n, _c.setScalar(soot)); im.setMatrixAt((im as any)._n++, _m3); im.count = (im as any)._n;
          }
        }
        if (!paused) {
          // welding sparks where something is being built or repaired
          if (u.nano && u.nanoTick >= g.tick - 2 && Math.random() < 0.5) {
            const n = u.nano, ty = n.y + (n.def ? n.def.h * 0.5 * Math.random() : 1), sy = y + d.h * 0.7;
            const tx = n.x + (Math.random() - 0.5) * (n.def ? n.def.r : 3), tz = n.z + (Math.random() - 0.5) * (n.def ? n.def.r : 3);
            const dd = Math.hypot(tx - x, ty - sy, tz - z) || 1, sp = 90, life = dd / sp;
            if (dd > 0 && sp && life >= 0) fireP.spawn(tx, ty, tz, (Math.random() - 0.5) * 14, 4 + Math.random() * 10, (Math.random() - 0.5) * 14, 0.3 + Math.random() * 0.3, 0.7, 3.4, 2.4, 1, 1, 0, 0.5, 50, 1);
          }
          if (u.hp < d.hp * 0.5) {
            const sev = 1 - u.hp / (d.hp * 0.5), ox = (Math.random() - 0.5) * d.r, oz = (Math.random() - 0.5) * d.r;
            if (Math.random() < 0.1 + sev * 0.2) this.smoke.spawn(x + ox, y + d.h * 0.7, z + oz, (Math.random() - 0.5) * 3, 7 + Math.random() * 4, (Math.random() - 0.5) * 3, 1.6 + Math.random(), 3 + d.r * 0.2, 0.08, 0.08, 0.08, 0.55, 2, 0.4, -1);
            if (sev > 0.3 && Math.random() < sev * 0.35) fireP.spawn(x + ox * 0.7, y + d.h * 0.5, z + oz * 0.7, 0, 8 + Math.random() * 6, 0, 0.4 + Math.random() * 0.3, 2.5 + d.r * 0.25, 2.2, 1.1, 0.3, 0.7, -0.4, 0.5, -5, 1);
          }
          if (d.cls === 'ground' && u.speed > 4) {
            const bx = x - Math.sin(h) * d.r * 0.9, bz = z - Math.cos(h) * d.r * 0.9;
            if (d.naval) {
              if (Math.random() < 0.7) this.smoke.spawn(bx + (Math.random() - 0.5) * d.r * 0.6, map.waterY + 0.25, bz + (Math.random() - 0.5) * d.r * 0.6, (Math.random() - 0.5) * 2, 0.4, (Math.random() - 0.5) * 2, 1.8 + Math.random(), d.r * 0.55, 0.88, 0.95, 1, 0.34, 2.4, 1);
              if (Math.random() < 0.3) this.smoke.spawn(x + Math.sin(h) * d.r, map.waterY + 0.6, z + Math.cos(h) * d.r, Math.cos(h) * 4 * (Math.random() < 0.5 ? 1 : -1), 4, -Math.sin(h) * 4 * (Math.random() < 0.5 ? 1 : -1), 0.6, d.r * 0.3, 0.95, 0.98, 1, 0.5, 1.5, 1, 18);
            } else if (!d.bot) {
              // tracks and tyres chew the ground: dust in summer, clods of mud in the thaw, powder snow in winter, diesel smoke always
              const k = u.speed / d.speed, road = map.road[map.cellOf(x, z)] ? 0.25 : 1, sn = g.snow, mu = g.mud;
              _c.setHex(map.biome.low); const dr = lerp(_c.r * 0.6 + 0.26, 0.9, sn), dg = lerp(_c.g * 0.6 + 0.25, 0.92, sn), db = lerp(_c.b * 0.6 + 0.2, 0.95, sn);
              const sxn = Math.cos(h), szn = -Math.sin(h);
              if (Math.random() < 0.5 * k * road * (1 - mu * 0.7)) { const sd = Math.random() < 0.5 ? 1 : -1; this.smoke.spawn(bx + sxn * sd * d.r * 0.5, y + 0.5, bz + szn * sd * d.r * 0.5, (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3, 1.1 + Math.random() * 0.8, 2 + d.r * 0.3, dr, dg, db, 0.26, 2.8, 1.2); }
              if (!d.wheel && Math.random() < 0.55 * k * road) for (let i = 0; i < 2; i++) { // clods thrown off the tracks
                const sd = Math.random() < 0.5 ? 1 : -1, v = u.speed * (0.3 + Math.random() * 0.5), cc = sn > 0.5 ? 0.8 : 0.09 + Math.random() * 0.06;
                this.smoke.spawn(bx + sxn * sd * d.r * 0.55, y + 0.5, bz + szn * sd * d.r * 0.55, -Math.sin(h) * v + (Math.random() - 0.5) * 5, 5 + Math.random() * 9 * (0.5 + mu), -Math.cos(h) * v + (Math.random() - 0.5) * 5, 0.7 + Math.random() * 0.5, 0.45 + Math.random() * 0.5, cc * 1.25, cc, cc * 0.75, 0.95, 0, 0.2, 34);
              }
              if (Math.random() < 0.16) { const gcol = 0.1 + Math.random() * 0.06; this.smoke.spawn(bx + sxn * d.r * 0.3, y + d.h * 0.45, bz + szn * d.r * 0.3, -Math.sin(h) * 3, 3 + Math.random() * 3, -Math.cos(h) * 3, 1 + Math.random() * 0.8, 1.6, gcol, gcol, gcol, 0.32, 2.4, 0.8, -0.6); }
            }
          }
          if (d.cls === 'air' && !d.kami) {
            // flares punched out when the aircraft is being hit; contrails behind fast jets; rotor wash under helicopters
            if (g.tick - u.lastHit < 70 && Math.random() < 0.3) { const sd = Math.random() < 0.5 ? 1 : -1; fireP.spawn(x, y - 1, z, Math.cos(h) * 22 * sd, -4, -Math.sin(h) * 22 * sd, 1.5, 2.6, 3.6, 3.2, 2.2, 1, 0, 0.5, 16); this.smoke.spawn(x, y - 1, z, Math.cos(h) * 10 * sd, -2, -Math.sin(h) * 10 * sd, 1.6, 1.6, 0.9, 0.9, 0.9, 0.3, 2, 0.6); }
            if (!d.hover && d.speed >= 55 && Math.random() < 0.5) this.smoke.spawn(x - Math.sin(h) * d.r * 1.4, y, z - Math.cos(h) * d.r * 1.4, 0, 0, 0, 2.6, 1.1, 0.95, 0.96, 0.98, 0.2, 1.4, 0);
            if (d.hover && d.r > 3 && Math.random() < 0.5) { const a = Math.random() * 6.283, gy = map.groundY(x, z); _c.setHex(map.biome.low); const sn = g.snow; this.smoke.spawn(x + Math.cos(a) * 5, gy + 0.6, z + Math.sin(a) * 5, Math.cos(a) * 26, 1.5, Math.sin(a) * 26, 0.8 + Math.random() * 0.5, 3.2, lerp(_c.r * 0.6 + 0.26, 0.92, sn), lerp(_c.g * 0.6 + 0.25, 0.94, sn), lerp(_c.b * 0.6 + 0.2, 0.96, sn), 0.2, 2.8, 2.2); }
          }
          if (d.cls === 'ground' && !d.bot && u.speed > 3 && Math.random() < 0.5) {
            // tracks and tyres plough a lasting trail: bare churned earth through snow and across fields
            const hn = map.hn, am = this.terrainMatAttr.array as Float32Array, col = this.terrainCol.array as Float32Array;
            for (const sd of [-1, 1]) {
              const tx = x + Math.cos(h) * sd * d.r * 0.5, tz = z - Math.sin(h) * sd * d.r * 0.5, k = Math.round(tz / VS) * hn + Math.round(tx / VS);
              if (k > 0 && k < am.length && am[k] < 0.8) { am[k] = Math.min(0.8, am[k] + 0.22); col[k * 3] *= 0.93; col[k * 3 + 1] *= 0.92; col[k * 3 + 2] *= 0.91; this.trackDirty = true; }
            }
          }
          if (d.cls === 'air' && !d.hover && d.speed >= 55 && Math.random() < 0.6) fireP.spawn(x - Math.sin(h) * d.r, y, z - Math.cos(h) * d.r, 0, 0, 0, 0.25, 1.6, 2.4, 1.4, 0.5, 0.7);
        }
      }
      if (selected.has(u) && nSel < 600) {
        _q.identity(); _p.set(x, (d.cls === 'air' ? map.groundY(x, z) : y) + 0.6, z); const r = d.r * 1.3; _v.set(r, 1, r);
        _m.compose(_p, _q, _v); this.selIM.setMatrixAt(nSel, _m);
        this.selIM.setColorAt(nSel, _c.setHex(u.team === me ? 0x60ff90 : u.team.ally === me.ally ? 0xffe060 : 0xff5040)); nSel++;
      }
    }
    for (const im of this.ims.values()) { im.count = (im as any)._n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.selIM.count = nSel; this.selIM.instanceMatrix.needsUpdate = true; if (this.selIM.instanceColor) this.selIM.instanceColor.needsUpdate = true;
    // planned structures: translucent outlines for every queued build that has not been started yet
    const want = new Set<string>();
    for (const u of g.units) {
      if (u.team !== me || u.dead || !u.def.bp) continue;
      for (const o of u.orders) {
        if (o.type !== 'build' || o.target || !o.def) continue;
        const key = o.def.id + '|' + o.cx + '|' + o.cz; want.add(key);
        if (this.plans.has(key)) continue;
        const d = o.def, grp = new THREE.Group();
        for (const [ge, piv] of partList(d, geosFor(d, me.id))) {
          const a = new THREE.Mesh(ge, this.planMat), b = new THREE.Mesh(ge, this.planWire);
          if (piv) { a.position.fromArray(piv); b.position.fromArray(piv); }
          a.renderOrder = b.renderOrder = 7; grp.add(a, b);
        }
        const pc = d.reuse ? g.civFor(d, o.cx!, o.cz!) : null;
        grp.position.set(o.x, map.groundY(o.x, o.z) + 0.2 + (pc ? pc.h : 0), o.z); if (d.span) grp.rotation.y = map.bridges[o.cx!].ang;
        this.scene.add(grp); this.plans.set(key, grp);
      }
    }
    for (const [key, grp] of this.plans) if (!want.has(key)) { this.scene.remove(grp); this.plans.delete(key); }
    this.planMat.opacity = 0.26 + 0.08 * Math.sin(T * 3);
    for (const [u, f] of this.frames) if (!seenFrames.has(u)) { this.scene.remove(f.group); f.solid.dispose(); this.frames.delete(u); }

    // wrecks
    let nw = 0;
    for (const w of g.wrecks) {
      if (nw >= 1500 || !(me.vis[map.cellOf(w.x, w.z)] & 1)) continue;
      _q.setFromAxisAngle(_yAxis, w.rot); _p.set(w.x, w.y, w.z); _v.setScalar(w.r * (0.6 + 0.4 * w.metal / w.max));
      const age = (g.tick - w.born) / TICK, rust = Math.min(1, age / 400);
      _m.compose(_p, _q, _v); this.wreckIM.setMatrixAt(nw, _m); this.wreckIM.setColorAt(nw++, _c.setRGB(lerp(0.16, 0.42, rust), lerp(0.15, 0.24, rust), lerp(0.14, 0.15, rust)));
      if (!paused && age < 50 && (me.vis[map.cellOf(w.x, w.z)] & 2)) {
        if (Math.random() < 0.09 * (1 - age / 50)) this.smoke.spawn(w.x, w.y + 1.5, w.z, (Math.random() - 0.5) * 2, 6 + Math.random() * 4, (Math.random() - 0.5) * 2, 2.4 + Math.random() * 1.5, 2.5 + w.r * 0.3, 0.07, 0.07, 0.07, 0.5, 2.4, 0.3, -0.8);
        if (age < 16 && Math.random() < 0.18) fireP.spawn(w.x + (Math.random() - 0.5) * w.r * 0.6, w.y + 1, w.z + (Math.random() - 0.5) * w.r * 0.6, 0, 7 + Math.random() * 5, 0, 0.35 + Math.random() * 0.3, 2 + w.r * 0.25, 2.2, 1.1, 0.3, 0.7, -0.4, 0.5, -5, 1);
      }
    }
    this.wreckIM.count = nw; this.wreckIM.instanceMatrix.needsUpdate = true; if (this.wreckIM.instanceColor) this.wreckIM.instanceColor.needsUpdate = true;
    // ore spots
    let ns = 0;
    for (const s of map.spots) {
      const v = me.vis[map.cellOf(s.x, s.z)];
      if (!(v & 1) || s.taken) continue;
      _q.setFromAxisAngle(_yAxis, s.id); _p.set(s.x, map.heightAt(s.x, s.z), s.z); _v.setScalar(1);
      _m.compose(_p, _q, _v); this.spotIM.setMatrixAt(ns, _m);
      this.spotIM.setColorAt(ns, _c.setScalar(v & 2 ? 1 : 0.35)); ns++;
    }
    this.spotIM.count = ns; this.spotIM.instanceMatrix.needsUpdate = true; if (this.spotIM.instanceColor) this.spotIM.instanceColor.needsUpdate = true;

    // projectiles
    let np = 0;
    for (const p of g.projs) {
      if (np >= 1200) break;
      const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), z = lerp(p.pz, p.z, alpha);
      if (!(me.vis[map.cellOf(x, z)] & 2)) continue;
      const big = p.w.dmg > 250, nade = p.k === 0 && p.w.dmg < 90;
      _q.identity(); _p.set(x, y, z); _v.setScalar(p.k === 1 ? 0.45 : big ? 0.9 : nade ? 0.32 : p.k === 2 ? 1.1 : 0.5);
      _m.compose(_p, _q, _v); this.projIM.setMatrixAt(np, _m);
      if (p.k === 1) _c.setRGB(0.5, 0.5, 0.48); else if (p.k === 0 && !nade) _c.setRGB(2.6, 1.5, 0.6); else _c.setRGB(0.1, 0.1, 0.09);
      this.projIM.setColorAt(np, _c); np++;
      if (!paused) {
        if (p.k === 1) {
          this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.9, 1.5, 0.78, 0.77, 0.74, 0.35, 1.8, 0.5);
          fireP.spawn(x, y, z, 0, 0, 0, 0.1, 2.2, 3.2, 2, 0.8, 0.9);
        } else if (big) fireP.spawn(x, y, z, 0, 0, 0, 0.1, 1.6, 2.6, 1.5, 0.6, 0.5);
      }
    }
    this.projIM.count = np; this.projIM.instanceMatrix.needsUpdate = true; if (this.projIM.instanceColor) this.projIM.instanceColor.needsUpdate = true;

    // beams
    let nb = 0;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.life -= dt;
      if (b.life <= 0) { this.beams.splice(i, 1); continue; }
      if (nb >= 400) continue;
      const dx = b.bx - b.ax, dy = b.by - b.ay, dz = b.bz - b.az, len = Math.hypot(dx, dy, dz) || 1, k = b.life / b.max;
      _n.set(dx / len, dy / len, dz / len); _q.setFromUnitVectors(_up, _n);
      _p.set((b.ax + b.bx) / 2, (b.ay + b.by) / 2, (b.az + b.bz) / 2); _v.set(b.w * k, len, b.w * k);
      _m.compose(_p, _q, _v); this.beamIM.setMatrixAt(nb, _m); this.beamIM.setColorAt(nb, _c.copy(b.c).multiplyScalar(0.3 + 0.7 * k)); nb++;
    }
    this.beamIM.count = nb; this.beamIM.instanceMatrix.needsUpdate = true; if (this.beamIM.instanceColor) this.beamIM.instanceColor.needsUpdate = true;
    // shock rings
    let nr = 0;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.life -= dt;
      if (r.life <= 0) { this.rings.splice(i, 1); continue; }
      const k = 1 - r.life / r.max, sc = r.size * (0.2 + k);
      _q.identity(); _p.set(r.x, r.y, r.z); _v.set(sc, 1, sc); _m.compose(_p, _q, _v);
      this.ringIM.setMatrixAt(nr, _m); this.ringIM.setColorAt(nr, _c.setRGB(0.5, 0.42, 0.32).multiplyScalar((1 - k) * (1 - k) * 0.5)); nr++;
    }
    this.ringIM.count = nr; this.ringIM.instanceMatrix.needsUpdate = true; if (this.ringIM.instanceColor) this.ringIM.instanceColor.needsUpdate = true;

    // ── spreading fires ──
    const burning = g.burning, n = map.n;
    let fx = 0, fy = 0, fz = 0, fn = 0;
    if (burning.length) {
      const prob = Math.min(1, (this.quality >= 1 ? 170 : 50) / burning.length) * Math.min(1, dt * 60);
      for (let k = 0; k < burning.length; k++) {
        const c = burning[k]; if (!(me.vis[c] & 2)) continue;
        const cx = (c % n + 0.5) * CELL, cz = (((c / n) | 0) + 0.5) * CELL;
        if (Math.abs(cx - this.cam.x) + Math.abs(cz - this.cam.z) < 420) { fx += cx; fz += cz; fn++; }
        if (paused || Math.random() > prob) continue;
        const tall = this.scenery.tallAt(c), blk = map.block[c] > 0;
        const x = cx + (Math.random() - 0.5) * CELL * 1.1, z = cz + (Math.random() - 0.5) * CELL * 1.1;
        const y = map.groundY(x, z) + (blk ? 2 + Math.random() * 7 : tall ? Math.random() * 6 : 0.5);
        const sz = (tall ? 8 : blk ? 7 : 5) * (0.7 + Math.random() * 0.7);
        fireP.spawn(x, y, z, (Math.random() - 0.5) * 4, 9 + Math.random() * 10, (Math.random() - 0.5) * 4, 0.4 + Math.random() * 0.4, sz * 0.42, 1.7, 0.6, 0.1, 0.6, -0.6, 0.4, -12, 1);
        if (Math.random() < 0.4) fireP.spawn(x, y + 0.6, z, 0, 5, 0, 0.28, sz * 0.3, 2.6, 1.7, 0.5, 0.5, 0, 0, 0, 1);
        if (Math.random() < 0.45) { const gcol = 0.04 + Math.random() * 0.06; this.smoke.spawn(x, y + 5 + Math.random() * 4, z, 0, 9 + Math.random() * 6, 0, 3.5 + Math.random() * 3, sz * 1.3, gcol, gcol, gcol, 0.5, 2.6, 0.25, -1.2); }
        if (Math.random() < 0.05) fireP.spawn(x, y + 2, z, (Math.random() - 0.5) * 10, 16 + Math.random() * 14, (Math.random() - 0.5) * 10, 1.2 + Math.random(), 0.4, 3.2, 2, 0.7, 1, 0, 0.3, 6, 1);
      }
    }
    if (fn) {
      fx /= fn; fz /= fn; fy = map.groundY(fx, fz) + 14;
      this.fireLight.position.set(fx, fy, fz);
      this.fireLight.intensity = lerp(this.fireLight.intensity, Math.min(1, fn / 6) * 700 * (0.75 + 0.25 * Math.sin(T * 17) * Math.sin(T * 7.3)), 0.2);
    } else this.fireLight.intensity *= 0.9;
    if (g.craters.length) {
      const pos = this.terrainPos, nrm = this.terrainNrm, col = this.terrainCol.array as Float32Array, hn = map.hn, H = map.heights;
      for (const cr of g.craters) {
        const i0 = Math.max(1, Math.floor((cr.x - cr.r) / VS) - 1), i1 = Math.min(hn - 2, Math.ceil((cr.x + cr.r) / VS) + 1);
        const j0 = Math.max(1, Math.floor((cr.z - cr.r) / VS) - 1), j1 = Math.min(hn - 2, Math.ceil((cr.z + cr.r) / VS) + 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * hn + i; pos.setY(k, H[k]);
          if (this.waterDepth) this.waterDepth.depth[k] = clamp((map.waterY - H[k]) / 13, 0, 1) * 255;
          const dx = H[k + 1] - H[k - 1], dz = H[k + hn] - H[k - hn], l = Math.hypot(dx, 2 * VS, dz);
          nrm.setXYZ(k, -dx / l, 2 * VS / l, -dz / l);
          const d = Math.hypot(i * VS - cr.x, j * VS - cr.z) / cr.r;
          if (d < 1) { const w = (1 - d) * 0.8, a = 0.05 + Math.random() * 0.04; col[k * 3] = lerp(col[k * 3], a * 1.2, w); col[k * 3 + 1] = lerp(col[k * 3 + 1], a, w); col[k * 3 + 2] = lerp(col[k * 3 + 2], a * 0.85, w); }
        }
      }
      if (this.waterDepth) this.waterDepth.dTex.needsUpdate = true;
      g.craters.length = 0; pos.needsUpdate = true; nrm.needsUpdate = true; this.terrainCol.needsUpdate = true;
    }
    if (g.burnt.length) {
      const col = this.terrainCol.array as Float32Array, hn = map.hn;
      for (const c of g.burnt) {
        this.scenery.burn(c);
        const cx = c % n, cz = (c / n) | 0;
        for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) {
          const k = ((cz * 2 + j) * hn + cx * 2 + i) * 3, w = i === 1 && j === 1 ? 0.85 : 0.6, a = 0.035 + Math.random() * 0.03;
          col[k] = lerp(col[k], a * 1.15, w); col[k + 1] = lerp(col[k + 1], a, w); col[k + 2] = lerp(col[k + 2], a * 0.9, w);
        }
      }
      g.burnt.length = 0; this.terrainCol.needsUpdate = true;
    }
    for (const L of this.lights) { if (L.life > 0) { L.life -= dt; const k = Math.max(0, L.life / L.max); L.l.intensity = L.peak * k * k; } else L.l.intensity = 0; }
    this.shake *= Math.exp(-dt * 7);
    this.uTime.value = T; if (this.waterUni) this.waterUni.uTime.value = T;
    this.scenery.update(dt, T, me.vis);
    if (this.grade) this.grade.uniforms.uHeat.value = lerp(this.grade.uniforms.uHeat.value, Math.min(1, fn / 30), 0.05);
    if (!paused) {
      for (let i = this.later.length - 1; i >= 0; i--) { const l = this.later[i]; l.t -= dt; if (l.t <= 0) { this.later.splice(i, 1); l.fn(); } }
      this.smoke.windX = Math.sin(g.windDir) * g.wind * 7; this.smoke.windZ = Math.cos(g.windDir) * g.wind * 7;
      this.updateDebris(dt); this.fire.update(dt); this.smoke.update(dt);
    }
    this.trackT -= dt; if (this.trackDirty && this.trackT <= 0) { this.trackDirty = false; this.trackT = 0.4; this.terrainMatAttr.needsUpdate = true; this.terrainCol.needsUpdate = true; }
    for (const c of g.civDirty) this.world.refresh(c);
    g.civDirty.length = 0;
    this.world.update(g, me, dt, T, this.night, paused);
    this.scenery.season(g.snow, g.mud, g.dry, g.doy);
    if (!paused) {
      // snowfall around the camera
      if (g.snow > 0.35) {
        const cnt = (this.quality >= 1 ? 7 : 3) * Math.min(2, dt * 60) * g.snow, span = clamp(this.cam.dist * 1.7, 160, 900);
        for (let i = 0; i < cnt; i++) { const sx = this.cam.x + (Math.random() - 0.5) * span, sz = this.cam.z + (Math.random() - 0.5) * span; this.smoke.spawn(sx, map.groundY(sx, sz) + 12 + Math.random() * this.cam.dist * 0.35, sz, 0, -15 - Math.random() * 6, 0, 3.2, 0.7 + this.cam.dist * 0.0022, 1, 1, 1, 0.8, 0, 0, 0); }
      }
      for (let i = this.rockets.length - 1; i >= 0; i--) {
        const r = this.rockets[i], m = r.m; r.t += dt;
        if (r.t > 1.4) { r.vy += (18 + r.t * 9) * dt; m.position.y += r.vy * dt; if (r.t < 3) this.shake = Math.min(3, this.shake + dt * 2 / (1 + Math.hypot(m.position.x - this.cam.x, m.position.z - this.cam.z) / 400)); }
        const px = m.position.x, py = m.position.y, pz = m.position.z;
        for (let k = 0; k < 3; k++) fireP.spawn(px + (Math.random() - 0.5) * 3, py - 1 - Math.random() * 6, pz + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8, -40 - Math.random() * 30, (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.25, 7, 3.4, 2.4, 1.1, 0.9, 0.4, 0, 0, 1);
        const low = py - r.y0 < 60;
        for (let k = 0; k < 2; k++) { const a = Math.random() * 6.283, v = low ? 20 + Math.random() * 30 : 3; this.smoke.spawn(px, low ? r.y0 + 2 : py - 8, pz, Math.cos(a) * v, low ? 2 + Math.random() * 6 : -10, Math.sin(a) * v, 4 + Math.random() * 3, 11, 0.82, 0.8, 0.77, 0.55, 2.4, 0.8, -0.3); }
        this.flash(px, py - 4, pz, 4200, 0.2, 0xffb070);
        if (py > r.y0 + 1500) { this.scene.remove(m); m.geometry.dispose(); this.rockets.splice(i, 1); }
      }
    }
    // fog texture
    const vis = me.vis, cur = this.fogCur, fd = this.fogData, k = Math.min(1, dt * 6);
    for (let i = 0; i < vis.length; i++) {
      const v = vis[i], target = v & 2 ? 0 : v & 1 ? 118 : 235;
      const c = cur[i] + (target - cur[i]) * k; cur[i] = c; fd[i * 4 + 1] = c;
    }
    this.fogTex.needsUpdate = true;
    if (this.waterTex) { this.waterTex.offset.x = T * 0.006; this.waterTex.offset.y = T * 0.004; }

    if (this.refRT && this.water && !this.flir) {
      // mirror the camera in the water plane and render what the river reflects: bridges, buildings, fires, the sky
      const cam = this.camera, v = this.refCam, wy = map.waterY, rr = this.renderer;
      v.fov = cam.fov; v.aspect = cam.aspect; v.near = cam.near; v.far = cam.far; v.updateProjectionMatrix();
      v.position.set(cam.position.x, 2 * wy - cam.position.y, cam.position.z);
      _v.set(0, 1, 0).applyQuaternion(cam.quaternion); v.up.set(_v.x, -_v.y, _v.z);
      cam.getWorldDirection(_v); v.lookAt(v.position.x + _v.x, v.position.y - _v.y, v.position.z + _v.z); v.updateMatrixWorld();
      this.refM.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
      for (const o of this.noReflect) o.visible = false;
      this.sky.position.copy(v.position); this.sky.updateMatrixWorld();
      const au = rr.shadowMap.autoUpdate; rr.shadowMap.autoUpdate = false;
      rr.setRenderTarget(this.refRT); rr.clear(); rr.render(this.scene, v); rr.setRenderTarget(null);
      rr.shadowMap.autoUpdate = au;
      for (const o of this.noReflect) o.visible = true;
      this.sky.position.copy(cam.position); this.sky.updateMatrixWorld();
    }
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }
}

/** Renders every unit definition to a small icon (data URL) for the build menu. */
export function makeIcons(fac = 0): Record<string, string> {
  const out: Record<string, string> = {};
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 112;
  let r: THREE.WebGLRenderer;
  try { r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return out; }
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 3.2); dl.position.set(3, 6, 4); scene.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const pt = platingTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, map: pt.map, normalMap: pt.normal });
  const grp = new THREE.Group(); scene.add(grp);
  for (const def of DEF_LIST) {
    grp.clear();
    const g = buildGeos(def.model, fac);
    for (const [geo, piv] of partList(def, g)) { const m = new THREE.Mesh(geo, mat); if (piv) m.position.fromArray(piv); grp.add(m); }
    const box = new THREE.Box3().setFromObject(grp), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + sz * 0.9, c.y + sz * 0.8, c.z + sz * 1.25); cam.lookAt(c);
    r.render(scene, cam);
    out[def.id] = canvas.toDataURL('image/png');
    for (const [geo] of partList(def, g)) geo.dispose();
  }
  r.dispose(); r.forceContextLoss();
  return out;
}

export type { Wreck };
