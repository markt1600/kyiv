// Procedural scenery: water shader, vegetation, rocks. All geometry and textures are generated here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BIOMES, CELL, GameMap } from './map';
import { clamp, hash2, lerp, mulberry32, vnoise } from './util';

export function noiseTexture(size: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fn(x, y), i = (y * size + x) * 4;
    img.data[i] = v[0]; img.data[i + 1] = v[1]; img.data[i + 2] = v[2]; img.data[i + 3] = v[3];
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
/** tileable value noise: s = texture size, f = lattice frequency */
export const tile = (x: number, y: number, s: number, f: number, seed: number) => {
  const u = (((x % s) + s) % s) / s * f, v = (((y % s) + s) % s) / s * f;
  const w = (a: number, b: number) => vnoise(((a % f) + f) % f, ((b % f) + f) % f, seed);
  const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(w(ix, iy), w(ix + 1, iy), sx), lerp(w(ix, iy + 1), w(ix + 1, iy + 1), sx), sy);
};
/** tileable normal map from a height function */
export function normalTexture(size: number, hf: (x: number, y: number) => number, strength: number) {
  const hs = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hs[y * size + x] = hf(x, y);
  const at = (x: number, y: number) => hs[((y + size) % size) * size + ((x + size) % size)];
  return noiseTexture(size, (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [128 - dx / l * 127, 128 - dy / l * 127, 128 + 127 / l, 255];
  });
}

// ───────────────────────── water ─────────────────────────
export function makeWater(map: GameMap, fogTex: THREE.Texture, sunDir: THREE.Vector3, sunCol: number) {
  const bio = map.biome, hn = map.hn;
  const depth = new Uint8Array(hn * hn);
  for (let i = 0; i < hn * hn; i++) depth[i] = clamp((map.waterY - map.heights[i]) / 13, 0, 1) * 255;
  const dTex = new THREE.DataTexture(depth, hn, hn, THREE.RedFormat);
  dTex.magFilter = dTex.minFilter = THREE.LinearFilter; dTex.needsUpdate = true;
  const nTex = normalTexture(256, (x, y) => tile(x, y, 256, 5, 21) + tile(x, y, 256, 11, 23) * 0.5 + tile(x, y, 256, 27, 25) * 0.2, 9);
  const sky = new THREE.Color(bio.sky), deep = new THREE.Color(bio.waterCol).multiplyScalar(0.42), shallow = new THREE.Color(bio.waterCol).lerp(new THREE.Color(0x3fc4b4), 0.4);
  const uni = {
    uTime: { value: 0 }, uDepth: { value: dTex }, uFog: { value: fogTex }, uNrm: { value: nTex }, uSize: { value: map.size },
    uShallow: { value: shallow }, uDeep: { value: deep }, uSky: { value: sky }, uSunDir: { value: sunDir.clone().normalize() },
    uSunCol: { value: new THREE.Color(sunCol) }, uFogCol: { value: new THREE.Color(bio.fogCol) }, uIce: { value: 0 },
    uRef: { value: null as THREE.Texture | null }, uRefM: { value: new THREE.Matrix4() }, uRefOn: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime, uSize, uIce, uRefOn; uniform sampler2D uDepth, uFog, uNrm, uRef; uniform mat4 uRefM;
      uniform vec3 uShallow, uDeep, uSky, uSunDir, uSunCol, uFogCol; varying vec3 vW;
      void main(){
        vec2 uv = vW.xz / uSize; vec2 p = vW.xz;
        float depth = texture2D(uDepth, uv).r;
        vec3 n1 = texture2D(uNrm, p/85.0 + uTime*vec2(0.011, 0.007)).xyz*2.0-1.0;
        vec3 n2 = texture2D(uNrm, p/31.0 - uTime*vec2(0.017,-0.012)).xyz*2.0-1.0;
        vec3 n3 = texture2D(uNrm, p/190.0 + uTime*vec2(-0.005,0.004)).xyz*2.0-1.0;
        vec2 nn = n1.xy*0.5 + n2.xy*0.3 + n3.xy*0.5;
        float calm = smoothstep(0.0, 0.25, depth);
        vec3 N = normalize(vec3(nn.x*(0.3+0.6*calm), 1.0, nn.y*(0.3+0.6*calm)));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.025 + 0.975*pow(1.0 - max(dot(N,V),0.0), 5.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.6, depth));
        float caust = pow(clamp(n1.x*n2.y*5.0 + 0.5, 0.0, 1.0), 3.0) * (1.0 - smoothstep(0.02, 0.4, depth));
        body += caust * uSunCol * 0.22;
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uSky*1.15, uSky*0.5, clamp(R.y*1.3, 0.0, 1.0));
        if (uRefOn > 0.5) { vec4 rc = uRefM * vec4(vW, 1.0); vec3 rf = texture2D(uRef, clamp(rc.xy/rc.w + N.xz*0.04, 0.002, 0.998)).rgb; sky = mix(sky, rf, 0.92); }
        float sd = max(dot(R, uSunDir), 0.0);
        float spec = pow(sd, 180.0)*6.0 + pow(sd, 24.0)*0.22;
        body *= 0.82 + 0.36*(nn.x+nn.y+0.5);
        vec3 col = mix(body, sky, clamp(fres*0.85 + uRefOn*0.12, 0.0, 1.0)) + uSunCol*spec;
        // shoreline foam: animated bands that roll toward the beach
        float shore = 1.0 - smoothstep(0.0, 0.1, depth);
        float fn = texture2D(uNrm, p/13.0 + vec2(uTime*0.02, -uTime*0.013)).r;
        float band = sin(depth*150.0 + uTime*1.5 + fn*5.0)*0.5 + 0.5;
        float foam = smoothstep(0.55, 0.95, shore*0.75 + band*shore*0.5 + (fn-0.5)*0.5*shore);
        col = mix(col, vec3(0.92,0.96,1.0), foam*0.8);
        // winter: pack ice drifting on the river, thickest along the banks
        float icen = sin(p.x/31.0 + sin(p.y/23.0)*2.0 + uTime*0.02)*sin(p.y/27.0 + sin(p.x/19.0)*2.0)*0.25 + 0.5 + (texture2D(uNrm, p/90.0).g - 0.5)*0.5;
        float ice = smoothstep(0.86 - uIce*0.5, 0.9 - uIce*0.5, icen + (1.0 - smoothstep(0.0, 0.5, depth))*0.2) * smoothstep(0.25, 0.5, uIce);
        col = mix(col, vec3(0.78, 0.83, 0.88)*(0.8 + 0.3*icen), ice*0.92);
        float alpha = max(max(mix(0.5, 0.97, smoothstep(0.0, 0.32, depth)), max(foam, fres)), ice);
        alpha *= smoothstep(0.0, 0.012, depth);
        float fg = texture2D(uFog, uv).g;
        col = mix(col, uFogCol, fg); alpha = mix(alpha, 1.0, fg*step(0.004, depth));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(map.size, map.size); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(map.size / 2, map.waterY, map.size / 2); mesh.renderOrder = 4;
  return { mesh, uni, depth, dTex };
}

// ───────────────────────── vegetation ─────────────────────────
function colored(g: THREE.BufferGeometry, hex: number, jitter = 0.08, k = 1): THREE.BufferGeometry {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3), pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const j = (1 - jitter + Math.random() * jitter * 2) * k * (0.82 + 0.18 * clamp(pos.getY(i) * 0.2 + 0.5, 0, 1.4));
    a[i * 3] = c.r * j; a[i * 3 + 1] = c.g * j; a[i * 3 + 2] = c.b * j;
  }
  const ng = g.index ? g.toNonIndexed() : g;
  if (g.index) { const m = ng.attributes.position.count, b = new Float32Array(m * 3); const idx = g.index.array; for (let i = 0; i < m; i++) { const s = idx[i]; b[i * 3] = a[s * 3]; b[i * 3 + 1] = a[s * 3 + 1]; b[i * 3 + 2] = a[s * 3 + 2]; } ng.setAttribute('color', new THREE.BufferAttribute(b, 3)); }
  else ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  const uv = new Float32Array(ng.attributes.position.count * 2); for (let i = 0; i < uv.length; i += 2) { uv[i] = SOLID[0]; uv[i + 1] = SOLID[1]; }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return ng;
}
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => { g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); return g; };

function blob(r: number, seed: number): THREE.BufferGeometry {
  // a lumpy, smooth-shaded canopy mass
  const g = new THREE.SphereGeometry(r, 7, 5), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.74 + 0.36 * vnoise(x * 0.9 + seed * 9, y * 0.9 + z * 1.1 + seed, 11) + 0.2 * vnoise(x * 2.6 + seed, z * 2.6 + y * 2.2, 13);
    p.setXYZ(i, x * k, y * k * 0.82, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function skirt(r: number, h: number, seed: number): THREE.BufferGeometry {
  // one drooping tier of conifer boughs with a ragged hem
  const g = new THREE.ConeGeometry(r, h, 9, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rad = Math.hypot(x, z);
    if (rad < 0.01) continue;
    const a = Math.atan2(z, x), j = 0.8 + 0.42 * vnoise(a * 2.9 + seed * 5, y * 1.5 + seed, 19);
    p.setXYZ(i, x * j, y - (rad / r) * h * 0.2 * (0.5 + j * 0.5), z * j);
  }
  g.computeVertexNormals();
  return g;
}
function trunk(r: number, h: number, bend: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.55, r, h, 7, 3), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h + 0.5; p.setX(i, p.getX(i) + Math.sin(y * 2.4) * bend); p.setY(i, p.getY(i) + h / 2); }
  g.computeVertexNormals();
  return g;
}
/** uv of the opaque white patch in the foliage atlas (for trunks, rocks, anything that is not a leaf card) */
const SOLID = [0.97, 0.03];
let foliageTex: THREE.Texture | null = null;
/** Foliage atlas. Left half: a spray of broad leaves. Right half: a pine bough of needles. Alpha varies per leaf so autumn can thin the crown. */
function foliageAtlas() {
  if (foliageTex) return foliageTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!, r = mulberry32(99);
  // twigs first, then leaves over them
  x.strokeStyle = 'rgba(120,100,80,0.95)'; x.lineWidth = 3;
  for (let i = 0; i < 9; i++) { const a = r() * 6.283; x.beginPath(); x.moveTo(128, 256); x.quadraticCurveTo(128 + Math.cos(a) * 60, 256 + Math.sin(a) * 110, 128 + Math.cos(a) * 110, 256 + Math.sin(a) * 220); x.stroke(); }
  for (let i = 0; i < 230; i++) {
    const px = 18 + r() * 220, py = 18 + r() * 476, len = 13 + r() * 13, a = r() * 6.283, g = 150 + r() * 105;
    if (Math.hypot((px - 128) / 128, (py - 256) / 256) > 0.97) continue;
    x.save(); x.translate(px, py); x.rotate(a);
    x.fillStyle = `rgba(${g * (0.72 + r() * 0.25)},${g},${g * (0.5 + r() * 0.3)},${0.5 + r() * 0.5})`;
    x.beginPath(); x.moveTo(-len, 0); x.quadraticCurveTo(0, -len * 0.62, len, 0); x.quadraticCurveTo(0, len * 0.62, -len, 0); x.fill();
    x.strokeStyle = 'rgba(60,80,40,0.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-len, 0); x.lineTo(len, 0); x.stroke();
    x.restore();
  }
  // pine bough: a drooping twig feathered with needles
  const bough = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    x.strokeStyle = 'rgba(110,90,70,1)'; x.lineWidth = 3; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    const n = Math.hypot(x1 - x0, y1 - y0) / 2.2, dx = (x1 - x0) / n, dy = (y1 - y0) / n, l = Math.hypot(dx, dy);
    for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
      const g = 150 + r() * 105, nl = w * (0.5 + r() * 0.6) * (1 - i / n * 0.6), px = x0 + dx * i, py = y0 + dy * i;
      x.strokeStyle = `rgba(${g * 0.7},${g},${g * 0.72},${0.75 + r() * 0.25})`; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (-dy / l * sd + dx / l * 0.7) * nl, py + (dx / l * sd + dy / l * 0.7) * nl); x.stroke();
    }
  };
  bough(376, 500, 376, 14, 30);
  for (let i = 0; i < 9; i++) { const y = 470 - i * 48, sd = i % 2 ? 1 : -1, len = 96 - i * 7; bough(376, y, 376 + sd * len, y - 34 - r() * 20, 22); bough(376, y - 20, 376 - sd * len * 0.8, y - 60 - r() * 20, 20); }
  x.clearRect(480, 480, 32, 32); x.fillStyle = '#fff'; x.fillRect(484, 484, 28, 28);
  const t = foliageTex = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** one textured leaf card. `n` is the shading normal (pointing out of the crown) so a tree lights as a volume rather than as flat cards */
function card(w: number, h: number, pos: number[], rot: number[], pine: boolean, hex: number, k: number, n: number[]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')), new THREE.Vector3(1, 1, 1)));
  const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3), nr = g.attributes.normal, uv = g.attributes.uv, c = new THREE.Color(hex);
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  for (let i = 0; i < cnt; i++) {
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    nr.setXYZ(i, n[0] / nl, n[1] / nl, n[2] / nl);
    uv.setX(i, pine ? 0.5 + uv.getX(i) * 0.47 : uv.getX(i) * 0.5);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function pine(leaf: number, trunkCol: number, _snow = 0): THREE.BufferGeometry {
  const r = mulberry32(7), parts = [colored(trunk(0.42, 10.5, 0.1), trunkCol)];
  const tiers = 7;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), rad = 3.4 - t * 2.5, y = 3 + i * 1.25, nb = i < 4 ? 6 : 5;
    for (let b = 0; b < nb; b++) {
      const a = b / nb * 6.283 + i * 0.7 + r() * 0.4, droop = 0.35 + r() * 0.25 - t * 0.3, len = rad * (0.85 + r() * 0.3);
      // the card lies along the branch: its long axis points outward and sags
      parts.push(card(len * 0.95, len, [Math.sin(a) * len * 0.45, y - Math.sin(droop) * len * 0.3, Math.cos(a) * len * 0.45], [Math.PI / 2 - droop, a, 0], true, leaf, 0.6 + t * 0.5 + r() * 0.15, [Math.sin(a) * 0.6, 1, Math.cos(a) * 0.6]));
    }
  }
  for (let b = 0; b < 3; b++) parts.push(card(1.9, 3.2, [0, 11.2, 0], [0, b * 1.047, 0], true, leaf, 1.15, [Math.sin(b * 1.047), 0.8, Math.cos(b * 1.047)]));
  for (let b = 0; b < 3; b++) parts.push(card(4.2, 5, [0, 6.4, 0], [0, b * 1.047 + 0.5, 0], true, leaf, 0.62, [Math.sin(b * 1.047), 0.6, Math.cos(b * 1.047)])); // inner mass so the trunk is not bare
  return mergeGeometries(parts);
}
function broadleaf(leaf: number, leaf2: number, trunkCol: number): THREE.BufferGeometry {
  const r = mulberry32(11), parts = [
    colored(trunk(0.55, 5.4, 0.25), trunkCol),
    colored(T(new THREE.CylinderGeometry(0.1, 0.2, 3, 5), 1.0, 4.6, 0.2, 0, -0.9), trunkCol),
    colored(T(new THREE.CylinderGeometry(0.1, 0.2, 2.8, 5), -0.9, 4.8, -0.3, 0.3, 0.8), trunkCol),
    colored(T(new THREE.CylinderGeometry(0.08, 0.16, 2.6, 5), 0.1, 6.4, 0.5, -0.5, 0.15), trunkCol),
  ];
  // clumps of the crown: [x, y, z, radius]
  const clumps = [[0, 6.6, 0, 2.7], [1.9, 5.2, 0.7, 1.9], [-1.7, 5.5, -0.9, 1.9], [0.3, 8.3, -0.3, 1.7], [0.7, 5.7, -1.9, 1.6], [-1.1, 7.3, 1.2, 1.6], [-0.4, 5, 1.7, 1.4]];
  for (const [cx, cy, cz, cr] of clumps) {
    const n = Math.round(5 + cr * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * 6.283, s = Math.sqrt(1 - u * u), dx = s * Math.cos(a), dy = u * 0.8 + 0.15, dz = s * Math.sin(a), d = cr * (0.45 + r() * 0.5);
      const px = cx + dx * d, py = cy + dy * d, pz = cz + dz * d, sz = cr * (0.95 + r() * 0.5);
      parts.push(card(sz, sz * 2, [px, py, pz], [(r() - 0.5) * 1.6, r() * 6.283, (r() - 0.5) * 1.2], false, r() < 0.5 ? leaf : leaf2, 0.62 + 0.5 * Math.min(1, Math.max(0, (py - 3.6) / 5)) + r() * 0.12, [px - cx * 0.4, (py - 5.6) * 1.2 + 0.8, pz - cz * 0.4]));
    }
  }
  return mergeGeometries(parts);
}
function cactus(col: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(T(new THREE.CylinderGeometry(0.55, 0.65, 4.6, 6), 0, 2.3, 0), col),
    colored(T(new THREE.SphereGeometry(0.55, 6, 4), 0, 4.6, 0), col),
    colored(T(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 5), 1.2, 2.6, 0, 0, Math.PI / 2), col),
    colored(T(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 5), 1.9, 3.4, 0), col),
    colored(T(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 5), -1.0, 1.9, 0, 0, Math.PI / 2), col),
    colored(T(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 5), -1.55, 2.5, 0), col),
  ]);
}
function bush(col: number, col2: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(T(new THREE.IcosahedronGeometry(1.2, 0), 0, 0.8, 0), col, 0.15),
    colored(T(new THREE.IcosahedronGeometry(0.9, 0), 1.0, 0.6, 0.4), col2, 0.15),
    colored(T(new THREE.IcosahedronGeometry(0.8, 0), -0.8, 0.5, -0.5), col2, 0.15),
  ]);
}
function deadTree(col: number): THREE.BufferGeometry {
  return mergeGeometries([
    colored(T(new THREE.CylinderGeometry(0.2, 0.55, 5.5, 5), 0, 2.75, 0), col),
    colored(T(new THREE.CylinderGeometry(0.1, 0.22, 3, 4), 1.0, 4.6, 0, 0, -0.8), col),
    colored(T(new THREE.CylinderGeometry(0.1, 0.2, 2.6, 4), -0.9, 3.8, 0.2, 0.3, 0.9), col),
    colored(T(new THREE.CylinderGeometry(0.08, 0.16, 2, 4), 0.2, 5.6, -0.6, -0.7, 0.2), col),
  ]);
}
function shard(col: number, glow: number): THREE.BufferGeometry {
  const g2 = colored(T(new THREE.ConeGeometry(0.5, 2.2, 4), 0.9, 1.0, 0.3, 0, -0.35), glow, 0.05, 3.2);
  return mergeGeometries([
    colored(T(new THREE.ConeGeometry(1.1, 5, 5), 0, 2.4, 0, 0.12, 0.1), col, 0.1),
    colored(T(new THREE.ConeGeometry(0.7, 3, 5), -1.0, 1.4, -0.4, 0, 0.4), col, 0.1), g2,
  ]);
}
function rock(col: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1.6, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + 0.5 * vnoise(x * 1.3 + 5, y * 1.3 + z * 1.7, 3);
    p.setXYZ(i, x * k * 1.25, Math.max(-0.4, y * k * 0.75), z * k);
  }
  g.translate(0, 0.4, 0);
  return colored(g, col, 0.12);
}
function tuft(col: number, col2: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, r = 0.25 + (i % 3) * 0.28, h = 1.0 + (i % 4) * 0.35;
    parts.push(colored(T(new THREE.ConeGeometry(0.16, h, 3), Math.cos(a) * r, h / 2, Math.sin(a) * r, Math.sin(a) * 0.3, Math.cos(a) * 0.3), i % 2 ? col : col2, 0.12));
  }
  return mergeGeometries(parts);
}

interface Kind { im: THREE.InstancedMesh; n: number; burns: boolean; tall: boolean }

export class Scenery {
  private kinds: Kind[] = [];
  private kind: Uint8Array; private idx: Int32Array; private cell: Int32Array; private state: Uint8Array; private tint: Float32Array;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array; private sc: Float32Array; private rot: Float32Array;
  private count = 0; private byCell = new Map<number, number[]>();
  private t = 0; private map: GameMap;
  private grassIM!: THREE.InstancedMesh; private gcx = 1e9; private gcz = 1e9; private gSnow = -1; private uGrass = { value: new THREE.Color(0.36, 0.5, 0.2) };
  /** force the next update to recolour everything now */
  refresh() { this.t = 0; }
  /** foliage meshes (left out of ambient occlusion: they are alpha-cut cards) */
  foliage: THREE.Object3D[] = [];
  uTime = { value: 0 }; private uSnow = { value: 0 }; private uBare = { value: 0 };
  /** per-kind seasonal tint (multiplies the foliage colour) */
  private tints = [new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1)];

  constructor(scene: THREE.Scene, map: GameMap, quality: number, seed: number) {
    this.map = map;
    const bi = BIOMES.indexOf(map.biome), n = map.n, rng = mulberry32(seed * 13 + 5);
    const atlas = foliageAtlas();
    const veg = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.3, map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });
    // organic mottling: a 3-axis noise lookup in object space breaks up the flat leaf / bark / stone colours
    const organic = noiseTexture(128, (x, y) => { const v = 255 * (tile(x, y, 128, 7, 71) * 0.55 + tile(x, y, 128, 19, 73) * 0.3 + tile(x, y, 128, 47, 75) * 0.15); return [v, v, v, 255]; });
    const mottle = (sh: any) => {
      sh.uniforms.uOrg = { value: organic };
      sh.vertexShader = 'varying vec3 vOp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOp = position;');
      sh.fragmentShader = 'varying vec3 vOp; uniform sampler2D uOrg;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float og = texture2D(uOrg, vOp.xy*0.31).r*0.4 + texture2D(uOrg, vOp.zy*0.27+0.3).r*0.3 + texture2D(uOrg, vOp.xz*0.9).r*0.3;
        diffuseColor.rgb *= 0.45 + 1.15*og;`);
    };
    veg.onBeforeCompile = sh => {
      mottle(sh);
      sh.uniforms.uTime = this.uTime; sh.uniforms.uSnow = this.uSnow; sh.uniforms.uBare = this.uBare;
      // deciduous leaves (left half of the atlas) thin out through autumn and are gone by winter
      sh.fragmentShader = 'uniform float uSnow, uBare;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n if (vMapUv.x < 0.5) diffuseColor.a -= uBare;').replace('diffuseColor.rgb *= 0.45 + 1.15*og;', 'diffuseColor.rgb *= 0.45 + 1.15*og;\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88) * clamp(max(vColor.r, max(vColor.g, vColor.b)) * 2.0, 0.0, 1.0), uSnow * smoothstep(0.42, 0.8, og + vOp.y*0.035) * 0.62);');
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float swy = max(0.0, transformed.y); float sph = instanceMatrix[3].x*0.13 + instanceMatrix[3].z*0.11;
        transformed.x += sin(uTime*1.7 + sph)*swy*0.024; transformed.z += cos(uTime*1.3 + sph*1.3)*swy*0.016;
        #endif`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.42 });
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
    stone.onBeforeCompile = mottle;
    // per-biome kit: [tree A, tree B, rock, grass]
    let gA: THREE.BufferGeometry, gB: THREE.BufferGeometry, gR: THREE.BufferGeometry, gG: THREE.BufferGeometry | null;
    if (bi === 0) { gA = pine(0x3d7a46, 0x4a3524); gB = broadleaf(0x5e9c3e, 0x477f34, 0x4c3a26); gR = rock(0x7d7a72); gG = tuft(0x55782f, 0x6a8a3a); gG.scale(0.55, 0.5, 0.55); }
    else if (bi === 1) { gA = cactus(0x5d8a4a); gB = bush(0x9a9455, 0x7f8048); gR = rock(0xb07d55); gG = tuft(0xb9a25e, 0xa08a4c); }
    else if (bi === 2) { gA = pine(0x2d5a45, 0x4a3a2c, 1); gB = bush(0xdfe9ef, 0xb8cbd6); gR = rock(0x8b98a4); gG = null; }
    else { gA = deadTree(0x1c1716); gB = shard(0x1a1518, 0xff5a18); gR = rock(0x2c2628); gG = null; }
    const dens = quality === 0 ? 0.5 : 1;
    // plan placement
    const items: number[][] = []; // [kind, cell, x, z, scale]
    for (let cz = 1; cz < n - 1; cz++) for (let cx = 1; cx < n - 1; cx++) {
      const c = cz * n + cx, f = map.forest[c];
      const h = map.heights[(cz * 2 + 1) * map.hn + cx * 2 + 1];
      if (h < map.waterY + 0.8) continue;
      if (f > 0.05) {
        const cnt = (rng() < f * 1.1 * dens ? 1 : 0) + (rng() < f * 0.55 * dens ? 1 : 0);
        for (let k = 0; k < cnt; k++) items.push([rng() < (bi === 0 ? 0.55 : 0.6) ? 0 : 1, c, (cx + rng()) * CELL, (cz + rng()) * CELL, 0.75 + rng() * 0.75]);
      }
      if (gG && quality >= 1 && map.pass[c] && map.fuel[c] > 0.12 && rng() < (quality === 2 ? 0.5 : 0.25)) {
        const m = 1 + ((rng() * 2) | 0);
        for (let k = 0; k < m; k++) items.push([3, c, (cx + rng()) * CELL, (cz + rng()) * CELL, 0.7 + rng() * 0.9]);
      }
      if (rng() < (map.pass[c] ? 0.012 : 0.11) * dens) items.push([2, c, (cx + rng()) * CELL, (cz + rng()) * CELL, map.pass[c] ? 0.35 + rng() * 0.5 : 0.8 + rng() * 1.9]);
    }
    const counts = [0, 0, 0, 0]; for (const it of items) counts[it[0]]++;
    const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material, cnt: number, burns: boolean, tall: boolean, shadow: boolean) => {
      const im = new THREE.InstancedMesh(g || new THREE.BufferGeometry(), mat, Math.max(1, cnt));
      im.count = cnt; im.frustumCulled = false; im.castShadow = shadow && quality >= 2; im.receiveShadow = true;
      if (mat === veg) { im.customDepthMaterial = depth; this.foliage.push(im); }
      if (g && cnt) scene.add(im);
      this.kinds.push({ im, n: 0, burns, tall });
    };
    mk(gA, veg, counts[0], true, true, true); mk(gB, veg, counts[1], true, bi !== 1 && bi !== 2, true); mk(gR, stone, counts[2], false, false, true); mk(gG, veg, counts[3], true, false, false);
    // grass blades: a fan of curved blades painted once, cut out by alpha, crossed in three planes
    const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gx = gc.getContext('2d')!, gr = mulberry32(31);
    for (let i = 0; i < 34; i++) {
      const bx = 8 + gr() * 112, lean = (gr() - 0.5) * 46, hh = 50 + gr() * 74, v = 150 + gr() * 105, w = 2.2 + gr() * 2.6;
      gx.fillStyle = `rgb(${v * 0.92},${v},${v * 0.72})`; gx.beginPath(); gx.moveTo(bx - w, 128); gx.quadraticCurveTo(bx + lean * 0.3, 128 - hh * 0.6, bx + lean, 128 - hh); gx.quadraticCurveTo(bx + lean * 0.5, 128 - hh * 0.5, bx + w, 128); gx.fill();
    }
    const gtex = new THREE.CanvasTexture(gc); gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 4;
    const gparts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) { const pg = new THREE.PlaneGeometry(2.6, 1.9); pg.translate(0, 0.95, 0); pg.rotateY(i * Math.PI / 3); const nr = pg.attributes.normal; for (let v = 0; v < nr.count; v++) nr.setXYZ(v, 0, 1, 0); gparts.push(pg); }
    const gmat = new THREE.MeshStandardMaterial({ map: gtex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 });
    gmat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime; sh.uniforms.uGrass = this.uGrass;
      sh.vertexShader = 'uniform float uTime; varying float vGy;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vGy = position.y;
        #ifdef USE_INSTANCING
        float gph = instanceMatrix[3].x*0.31 + instanceMatrix[3].z*0.27;
        transformed.x += sin(uTime*2.1 + gph)*position.y*0.11; transformed.z += cos(uTime*1.6 + gph*1.3)*position.y*0.08;
        #endif`);
      sh.fragmentShader = 'uniform vec3 uGrass; varying float vGy;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= uGrass * (0.55 + 0.6*vGy);');
    };
    this.grassIM = new THREE.InstancedMesh(mergeGeometries(gparts), gmat, quality >= 1 ? 6500 : 3000);
    this.grassIM.count = 0; this.grassIM.frustumCulled = false; this.grassIM.receiveShadow = true; this.grassIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.grassIM); this.foliage.push(this.grassIM);
    const N = this.count = items.length;
    this.kind = new Uint8Array(N); this.idx = new Int32Array(N); this.cell = new Int32Array(N); this.state = new Uint8Array(N); this.tint = new Float32Array(N);
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N); this.sc = new Float32Array(N); this.rot = new Float32Array(N);
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const [k, c, x, z, s] = items[i], kd = this.kinds[k];
      this.kind[i] = k; this.cell[i] = c; this.idx[i] = kd.n++; this.px[i] = x; this.pz[i] = z; this.py[i] = map.heightAt(x, z) - 0.15; this.sc[i] = s; this.rot[i] = rng() * 6.283;
      this.tint[i] = 0.8 + rng() * 0.4;
      this.place(i, 1, 1);
      kd.im.setColorAt(this.idx[i], col.setScalar(0));
      let l = this.byCell.get(c); if (!l) { l = []; this.byCell.set(c, l); } l.push(i);
    }
    for (const k of this.kinds) { k.im.instanceMatrix.needsUpdate = true; if (k.im.instanceColor) k.im.instanceColor.needsUpdate = true; }
  }

  private place(i: number, sxz: number, sy: number) {
    const m = _m, s = this.sc[i];
    _q.setFromAxisAngle(_y, this.rot[i]); _p.set(this.px[i], this.py[i], this.pz[i]); _s.set(s * sxz, s * sy, s * sxz);
    m.compose(_p, _q, _s); this.kinds[this.kind[i]].im.setMatrixAt(this.idx[i], m);
  }
  /** foliage follows the calendar: fresh green, bleached summer, autumn gold, bare and snow-laden in winter */
  season(snow: number, mud: number, dry: number, doy: number) {
    this.uSnow.value = snow;
    const aut = clamp((doy - 255) / 30, 0, 1) * (1 - clamp((doy - 320) / 20, 0, 1)), bare = Math.max(snow, doy > 320 || doy < 95 ? 1 : 0) * (1 - clamp((doy - 95) / 25, 0, 1) * (doy < 200 ? 1 : 0));
    this.uBare.value = bare * 0.62 + aut * 0.18;
    this.tints[0].setRGB(1, 1, 1).lerp(_c.setRGB(0.85, 0.95, 0.9), snow * 0.5);
    this.tints[1].setRGB(1, 1, 1).lerp(_c.setRGB(2.1, 1.1, 0.3), aut);
    this.tints[2].setRGB(1, 1, 1);
    this.tints[3].setRGB(1, 1, 1).lerp(_c.setRGB(1.5, 1.25, 0.6), Math.max(dry * 0.7, aut)).lerp(_c.setRGB(0.6, 0.5, 0.36), mud * 0.6);
  }
  /** does this cell hold tall vegetation (for bigger flames)? */
  tallAt(c: number): boolean {
    const l = this.byCell.get(c); if (!l) return false;
    for (const i of l) if (this.state[i] === 0 && this.kinds[this.kind[i]].tall) return true;
    return false;
  }
  /** fire has consumed this cell */
  burn(c: number) {
    const l = this.byCell.get(c); if (!l) return;
    for (const i of l) {
      const k = this.kinds[this.kind[i]]; if (!k.burns || this.state[i]) continue;
      if (k.tall) { this.state[i] = 1; this.place(i, 0.45, 0.8); } else { this.state[i] = 2; this.place(i, 0, 0); }
      k.im.instanceMatrix.needsUpdate = true;
    }
    this.t = 0;
  }
  /** remove everything under a new structure */
  clear(cx: number, cz: number, fw: number, fh: number) {
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      const l = this.byCell.get((cz + j) * this.map.n + cx + i); if (!l) continue;
      for (const it of l) if (this.state[it] !== 2) { this.state[it] = 2; this.place(it, 0, 0); this.kinds[this.kind[it]].im.instanceMatrix.needsUpdate = true; }
    }
  }
  /**
   * Real grass underfoot. A patch of alpha-cut blade cards is laid around the camera when it is close to the ground and
   * re-laid as it moves; positions come from a hash of the ground grid, so the same tuft is always in the same place.
   */
  grass(cx: number, cz: number, on: boolean, snow: number, dry: number, mud: number) {
    const im = this.grassIM, map = this.map;
    if (!on) { if (im.count) { im.count = 0; this.gcx = 1e9; } return; }
    this.uGrass.value.setRGB(0.36, 0.5, 0.2).lerp(_c.setRGB(0.62, 0.56, 0.28), Math.max(dry * 0.75, mud * 0.4)).lerp(_c.setRGB(0.3, 0.24, 0.15), mud * 0.5).lerp(_c.setRGB(0.72, 0.7, 0.6), snow * 0.8);
    if (Math.hypot(cx - this.gcx, cz - this.gcz) < 14 && Math.abs(snow - this.gSnow) < 0.1) return;
    this.gcx = cx; this.gcz = cz; this.gSnow = snow;
    const STEP = 1.7, RAD = 64, n = map.n, g0x = Math.floor((cx - RAD) / STEP), g0z = Math.floor((cz - RAD) / STEP), cnt = Math.ceil(RAD * 2 / STEP);
    let k = 0; const cap = im.instanceMatrix.count, short = 1 - 0.65 * snow;
    for (let j = 0; j < cnt && k < cap; j++) for (let i = 0; i < cnt && k < cap; i++) {
      const gx = g0x + i, gz = g0z + j, h = hash2(gx, gz, 211);
      if (h > 0.8) continue;
      const x = (gx + hash2(gx, gz, 213)) * STEP, z = (gz + hash2(gx, gz, 215)) * STEP, d = Math.hypot(x - cx, z - cz);
      if (d > RAD || x < 2 || z < 2 || x > map.size - 2 || z > map.size - 2) continue;
      const c = Math.floor(z / CELL) * n + Math.floor(x / CELL);
      if (map.road[c] || map.block[c] || map.fuel[c] < 0.02 || map.urban[c] > 0.75 && h > 0.2) continue;
      const y = map.heightAt(x, z); if (y < map.waterY + 0.5) continue;
      const sc = (0.6 + h * 1.4) * (1 - 0.5 * map.urban[c]) * (d > RAD - 14 ? (RAD - d) / 14 : 1); // thin out at the rim so the patch has no edge
      _q.setFromAxisAngle(_y, h * 40); _p.set(x, y - 0.05, z); _s.set(sc, sc * short * (0.7 + hash2(gx, gz, 217) * 0.7), sc);
      _m.compose(_p, _q, _s); im.setMatrixAt(k++, _m);
    }
    im.count = k; im.instanceMatrix.needsUpdate = true;
  }
  /** how brightly unexplored / unseen vegetation is drawn (raised in first person so the distance is not black) */
  reveal = 0;
  update(dt: number, time: number, vis: Uint8Array) {
    this.uTime.value = time;
    this.t -= dt; if (this.t > 0) return; this.t = 0.3;
    const col = _c;
    for (let i = 0; i < this.count; i++) {
      const v = vis[this.cell[i]], f = Math.max(this.reveal, v & 2 ? 1 : v & 1 ? 0.4 : 0) * (this.state[i] === 1 ? 0.07 : this.tint[i]);
      this.kinds[this.kind[i]].im.setColorAt(this.idx[i], col.copy(this.tints[this.kind[i]]).multiplyScalar(f));
    }
    for (const k of this.kinds) if (k.im.instanceColor) k.im.instanceColor.needsUpdate = true;
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
