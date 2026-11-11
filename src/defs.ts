// Unit / structure / technology definitions and procedural model recipes.
// Everything in the game is data-driven from this file.

export interface WeaponDef {
  /** gun: hitscan tracer fire | cannon: shell | missile: guided | bomb: free-fall | launch: spawns a one-way munition unit | ram: kamikaze seeker */
  k: 'gun' | 'cannon' | 'missile' | 'bomb' | 'launch' | 'ram';
  range: number; min?: number; reload: number; dmg: number;
  splash?: number; speed?: number;
  tg: number; // 1 ground, 2 air, 3 both
  color: number;
  burst?: number; gap?: number; spread?: number; eShot?: number;
  free?: boolean; // does not need turret alignment
  arc?: number; turn?: number;
  spawn?: string; // launch: unit id to spawn
  bld?: boolean;  // only engages structures that have been spotted (strategic weapons)
}
/** s: 0 box [w,h,l] | 1 cylinder [rTop,rBot,h] | 2 sphere [r] | 3 cone [r,h] | 4 capsule [r,len] | 5 rounded box [w,h,l] | 6 dome [r] */
export interface Part { s: number; d: number[]; p: number[]; r?: number[]; c: string; g?: string }
/** part groups: b body, t turret, s spinner, p / q left / right thigh (swing about the hip), k / l left / right shin (bend at the knee, carried by the thigh), h head (turns on the neck, carried by the turret group) */
export interface Model { parts: Part[]; tp?: number[]; sp?: number[]; sa?: 'y' | 'z'; ss?: number; hip?: number; knee?: number; neck?: number }

export interface UnitDef {
  id: string; name: string; names?: [string, string]; desc: string; tier: number;
  cls: 'building' | 'ground' | 'air';
  hp: number; m: number; e: number; work: number;
  speed: number; turn: number; r: number; h: number;
  fw: number; fh: number;
  sight: number; radar: number;
  bp: number; buildRange: number; builds: string[]; factory: boolean;
  mkM: number; mkE: number; useE: number; stM: number; stE: number;
  extract: number; wind: number; conv: number;
  weapons: WeaponDef[];
  alt: number; hover: boolean;
  blast: { r: number; d: number } | null;
  commander: boolean; bot: boolean; noChase: boolean; naval: boolean; water: boolean;
  /** infantry: leaves a body instead of a wreck */
  inf: boolean;
  /** required technology id */
  req: string;
  /** research facility: 'lab' researches technologies, 'pad' launches satellites */
  lab: '' | 'lab' | 'pad';
  /** one-way attack munition: detonates on its target. b: prefers structures */
  kami: { r: number; d: number; b?: boolean; v?: boolean } | null;
  /** susceptibility to electronic warfare (fraction of hp lost per second inside a jammer's bubble) */
  ew: number;
  /** electronic warfare radius */
  jam: number;
  /** requisition: civilian building kinds this can be set up in (it sits on the roof instead of being built) */
  reuse: number[] | null;
  /** faction that fields this (-1 both, 0 Ukraine, 1 Russia) */
  fac: number;
  /** built across a destroyed bridge to reopen the crossing */
  span: boolean;
  /** belongs to nobody: never auto-targeted, damaged by everyone (bridges) */
  neutral: boolean;
  /** wheeled: bogs down badly off-road in mud */
  wheel: boolean;
  model: Model;
}

export interface TechDef { id: string; name: string; desc: string; m: number; e: number; work: number; req: string[]; at: 'lab' | 'pad'; sat?: number; fac?: number }

const H = Math.PI / 2;
const B = (w: number, h: number, l: number, x: number, y: number, z: number, c: string, g?: string, r?: number[]): Part =>
  ({ s: 0, d: [w, h, l], p: [x, y, z], c, g, r });
const C = (rt: number, rb: number, h: number, x: number, y: number, z: number, c: string, g?: string, r?: number[]): Part =>
  ({ s: 1, d: [rt, rb, h], p: [x, y, z], c, g, r });
const S = (r: number, x: number, y: number, z: number, c: string, g?: string): Part =>
  ({ s: 2, d: [r], p: [x, y, z], c, g });
const K = (r: number, h: number, x: number, y: number, z: number, c: string, g?: string, rot?: number[]): Part =>
  ({ s: 3, d: [r, h], p: [x, y, z], c, g, r: rot });
/** barrel pointing forward (+z) starting at z */
const BR = (rad: number, len: number, x: number, y: number, z: number, c = 'K', g = 't'): Part =>
  C(rad, rad, len, x, y, z + len / 2, c, g, [H, 0, 0]);
/** tube along z centred at z */
const TZ = (rad: number, len: number, x: number, y: number, z: number, c: string, g?: string): Part => C(rad, rad, len, x, y, z, c, g, [H, 0, 0]);
const tracks = (w: number, l: number, h = 1.6): Part[] => [
  B(1.5, h, l, -w / 2, h / 2, 0, 'K'), B(1.5, h, l, w / 2, h / 2, 0, 'K'),
  B(1.7, 0.35, l * 0.96, -w / 2, h + 0.1, 0, 'C'), B(1.7, 0.35, l * 0.96, w / 2, h + 0.1, 0, 'C'),
];
const wheels = (hw: number, zs: number[], r = 1.05, w = 0.9): Part[] => {
  const o: Part[] = [];
  for (const z of zs) for (const sx of [-1, 1]) { o.push(C(r, r, w, sx * hw, r, z, 'K', undefined, [0, 0, H])); o.push(C(r * 0.45, r * 0.45, w + 0.08, sx * hw, r, z, 'D', undefined, [0, 0, H])); }
  return o;
};
const pad = (w: number, l: number, hh = 0.6): Part[] => [B(w, hh, l, 0, hh / 2, 0, 'N')];
/** ring of sandbags (four low walls) */
const bags = (w: number, l: number, h = 1.6, y = 0): Part[] => [
  B(w, h, 1.2, 0, y + h / 2, -l / 2, 'O'), B(w, h, 1.2, 0, y + h / 2, l / 2, 'O'), B(1.2, h, l, -w / 2, y + h / 2, 0, 'O'), B(1.2, h, l, w / 2, y + h / 2, 0, 'O'),
];
// ── the infantryman ──
// Built to human proportions (about 4.6 units tall): rounded limbs jointed at hip, knee and neck, a face under the helmet rim,
// plate carrier with magazine pouches and radio, assault pack, knee pads, gloves, and a rifle held at the low ready.
const CP = (r: number, len: number, x: number, y: number, z: number, c: string, g?: string, rot?: number[]): Part => ({ s: 4, d: [r, len], p: [x, y, z], c, g, r: rot });
const RB = (w: number, h: number, l: number, x: number, y: number, z: number, c: string, g?: string, rot?: number[]): Part => ({ s: 5, d: [w, h, l], p: [x, y, z], c, g, r: rot });
const DM = (r: number, x: number, y: number, z: number, c: string, g?: string): Part => ({ s: 6, d: [r], p: [x, y, z], c, g });
const HIP = 2.15, KNEE = 1.15, NECK = 3.7;
const leg = (sx: number, thigh: string, shin: string): Part[] => [
  CP(0.27, 0.62, sx, 1.66, 0, 'U', thigh), RB(0.2, 0.42, 0.34, sx + Math.sign(sx) * 0.27, 1.62, 0.02, 'U', thigh), // thigh and cargo pocket
  CP(0.21, 0.56, sx, 0.74, -0.02, 'U', shin), RB(0.44, 0.36, 0.2, sx, 1.14, 0.22, 'D', shin),                      // shin and knee pad
  RB(0.44, 0.5, 0.52, sx, 0.27, 0, 'K', shin), RB(0.42, 0.28, 0.5, sx, 0.15, 0.36, 'K', shin), B(0.46, 0.08, 0.92, sx, 0.04, 0.16, 'K', shin), // boot, toe cap, sole
];
const RIFLE: Part[] = [
  B(0.12, 0.2, 0.86, 0.3, 3.0, 0.82, 'K', 't'), B(0.13, 0.17, 0.52, 0.3, 3.0, 1.5, 'O', 't'), BR(0.045, 0.62, 0.3, 3.03, 1.74), TZ(0.035, 0.5, 0.3, 3.1, 1.56, 'K', 't'),
  TZ(0.065, 0.16, 0.3, 3.03, 2.42, 'K', 't'), B(0.03, 0.12, 0.03, 0.3, 3.13, 2.26, 'K', 't'),
  B(0.1, 0.5, 0.2, 0.3, 2.7, 1.02, 'O', 't', [0.38, 0, 0]), B(0.1, 0.3, 0.14, 0.3, 2.8, 0.56, 'K', 't', [-0.25, 0, 0]),
  B(0.1, 0.2, 0.62, 0.3, 3.02, 0.1, 'K', 't'), B(0.11, 0.28, 0.12, 0.3, 2.98, -0.2, 'K', 't'), B(0.1, 0.13, 0.32, 0.3, 3.18, 0.82, 'K', 't'), B(0.06, 0.06, 0.2, 0.3, 3.15, 0.5, 'K', 't'),
];
const trooper = (extra: Part[] = [], helmet = 'H', rifle = true): Part[] => [
  ...leg(-0.3, 'p', 'k'), ...leg(0.3, 'q', 'l'),
  // pelvis, belt kit
  RB(1.04, 0.52, 0.62, 0, 2.22, 0, 'U', 't'), B(1.1, 0.16, 0.68, 0, 2.44, 0, 'V', 't'), RB(0.26, 0.4, 0.3, -0.62, 2.3, -0.1, 'V', 't'), RB(0.22, 0.44, 0.26, 0.63, 2.24, 0.06, 'K', 't'), RB(0.5, 0.36, 0.26, 0, 2.3, -0.42, 'V', 't'),
  // torso
  RB(0.98, 0.66, 0.56, 0, 2.76, 0, 'U', 't'), RB(1.2, 0.84, 0.66, 0, 3.26, 0, 'U', 't'), S(0.28, -0.66, 3.5, 0, 'U', 't'), S(0.28, 0.66, 3.5, 0, 'U', 't'),
  // plate carrier: front and back plates, cummerbund, shoulder straps
  RB(0.94, 0.98, 0.22, 0, 3.12, 0.36, 'V', 't'), RB(0.94, 1.0, 0.2, 0, 3.14, -0.36, 'V', 't'), B(0.16, 0.5, 0.64, -0.58, 2.9, 0, 'V', 't'), B(0.16, 0.5, 0.64, 0.58, 2.9, 0, 'V', 't'),
  B(0.22, 0.1, 0.74, -0.36, 3.66, 0, 'V', 't'), B(0.22, 0.1, 0.74, 0.36, 3.66, 0, 'V', 't'),
  // three rifle magazines, a radio, a tourniquet, a grenade
  RB(0.26, 0.42, 0.18, -0.3, 2.9, 0.54, 'V', 't'), RB(0.26, 0.42, 0.18, 0, 2.9, 0.54, 'V', 't'), RB(0.26, 0.42, 0.18, 0.3, 2.9, 0.54, 'V', 't'),
  B(0.18, 0.1, 0.1, -0.3, 3.14, 0.54, 'K', 't'), B(0.18, 0.1, 0.1, 0, 3.14, 0.54, 'K', 't'), B(0.18, 0.1, 0.1, 0.3, 3.14, 0.54, 'K', 't'),
  RB(0.26, 0.4, 0.16, -0.3, 3.4, 0.5, 'D', 't'), C(0.02, 0.025, 1.0, -0.4, 4.08, -0.3, 'K', 't'), B(0.3, 0.1, 0.08, 0.26, 3.46, 0.5, 'R', 't'), S(0.11, 0.5, 2.62, 0.4, 'D', 't'),
  // assault pack with a bedroll
  RB(0.82, 0.92, 0.42, 0, 3.08, -0.68, 'V', 't'), RB(0.5, 0.4, 0.2, 0, 2.94, -0.94, 'V', 't'), C(0.17, 0.17, 0.86, 0, 3.66, -0.66, 'D', 't', [0, 0, H]),
  // arms: support hand forward on the handguard, firing hand at the grip
  CP(0.2, 0.44, -0.72, 3.2, 0.28, 'U', 't', [-0.95, 0, -0.1]), CP(0.17, 0.46, -0.5, 3.02, 0.94, 'U', 't', [-1.5, 0.75, 0]), S(0.17, -0.2, 3.0, 1.34, 'K', 't'),
  CP(0.2, 0.44, 0.74, 3.16, 0.12, 'U', 't', [-0.45, 0, 0.1]), CP(0.17, 0.42, 0.6, 2.9, 0.44, 'U', 't', [-1.25, -0.5, 0]), S(0.17, 0.34, 2.86, 0.62, 'K', 't'),
  RB(0.46, 0.2, 0.46, -0.72, 3.3, 0.22, 'G', 't', [-0.95, 0, -0.1]), RB(0.3, 0.24, 0.04, 0.66, 3.4, 0.24, 'G', 't'),
  // head: neck, skull, jaw, nose, eyes, ears, then the helmet with cover, rim, goggles, NVG mount and chin strap
  C(0.16, 0.18, 0.3, 0, 3.76, 0, 'S', 'h'), S(0.33, 0, 4.1, 0, 'S', 'h'), RB(0.46, 0.34, 0.5, 0, 3.94, 0.04, 'S', 'h'), B(0.1, 0.16, 0.12, 0, 4.02, 0.33, 'S', 'h'),
  B(0.09, 0.045, 0.04, -0.12, 4.1, 0.3, 'K', 'h'), B(0.09, 0.045, 0.04, 0.12, 4.1, 0.3, 'K', 'h'), B(0.2, 0.03, 0.04, 0, 3.9, 0.3, 'R', 'h'), B(0.06, 0.14, 0.1, -0.34, 4.04, 0, 'S', 'h'), B(0.06, 0.14, 0.1, 0.34, 4.04, 0, 'S', 'h'),
  DM(0.45, 0, 4.16, -0.02, helmet, 'h'), C(0.46, 0.46, 0.08, 0, 4.18, -0.02, helmet, 'h'), RB(0.84, 0.26, 0.4, 0, 4.06, -0.26, helmet, 'h'), B(0.5, 0.05, 0.14, 0, 4.2, 0.44, helmet, 'h'),
  RB(0.5, 0.15, 0.1, 0, 4.4, 0.36, 'K', 'h'), B(0.92, 0.05, 0.9, 0, 4.34, -0.02, 'V', 'h', [0, 0.785, 0]), B(0.14, 0.12, 0.12, 0, 4.3, 0.44, 'K', 'h'),
  B(0.04, 0.34, 0.06, -0.32, 3.98, 0.12, 'K', 'h'), B(0.04, 0.34, 0.06, 0.32, 3.98, 0.12, 'K', 'h'), B(0.5, 0.05, 0.08, 0, 3.8, 0.2, 'K', 'h'),
  ...(rifle ? RIFLE : []), ...extra,
];

const base = {
  tier: 1, speed: 0, turn: 0, r: 4, h: 5, fw: 1, fh: 1, sight: 150, radar: 0, bp: 0, buildRange: 42,
  builds: [] as string[], factory: false, mkM: 0, mkE: 0, useE: 0, stM: 0, stE: 0, extract: 0, wind: 0, conv: 0,
  weapons: [] as WeaponDef[], alt: 0, hover: false, blast: null, commander: false, bot: false, noChase: false, naval: false, water: false,
  inf: false, req: '', lab: '' as const, kami: null, ew: 0, jam: 0, wheel: false, reuse: null, neutral: false, span: false, fac: -1,
};
export const DEFS: Record<string, UnitDef> = {};
export const DEF_LIST: UnitDef[] = [];
function U(d: Partial<UnitDef> & { id: string; name: string; desc: string; cls: UnitDef['cls']; hp: number; m: number; e: number; work: number; model: Model }) {
  const def = { ...base, ...d } as UnitDef;
  if (def.cls === 'building') { def.r = Math.max(def.fw, def.fh) * 4; }
  DEFS[def.id] = def; DEF_LIST.push(def);
}
/** faction-specific display name (0 Ukraine, 1 Russia) */
export const nm = (d: UnitDef, fac: number) => (d.names ? d.names[fac] : d.name);

const HQ_BUILD = ['depot', 'gen', 'wind', 'estore', 'mstore', 'barracks', 'motorpool', 'airfield', 'lab', 'bunker', 'aagun', 'radar', 'c_camp', 'c_drone', 'c_post'];
const ENG_BUILD = ['depot', 'railhub', 'gen', 'wind', 'plant', 'estore', 'mstore', 'converter', 'barracks', 'motorpool', 'airfield', 'dronehub', 'heavy', 'lab',
  'bunker', 'howitzer', 'aagun', 'sam', 'radar', 'ew', 'strike', 'pad', 'pontoon', 'c_camp', 'c_drone', 'c_post'];

// tracer / shell tints
const TR = 0xffd9a0, SHELL = 0xffb060, SAMC = 0xfff0c0;

// ───────────────────────── Command ─────────────────────────
U({
  id: 'hq', wheel: true, name: 'Zelensky', names: ['Zelensky — Command Post', 'Putin — Command Post'],
  desc: 'The president’s mobile command post. Directs construction of your base. If it is lost, the war is lost.', cls: 'ground',
  hp: 6500, m: 2500, e: 25000, work: 20000, speed: 13, turn: 2.2, r: 5.6, h: 7.5, sight: 220,
  bp: 30, buildRange: 58, builds: HQ_BUILD, mkM: 1.5, mkE: 30, stM: 1000, stE: 1000,
  commander: true, noChase: true, blast: { r: 34, d: 300 },
  weapons: [{ k: 'gun', range: 140, reload: 0.22, dmg: 16, tg: 3, color: TR }],
  model: {
    tp: [0, 5.7, 2], sp: [-1.2, 6.2, -3], sa: 'y', ss: 1.2,
    parts: [
      ...wheels(2.75, [-3.9, -1.3, 1.3, 3.9], 1.15),
      B(5, 2.3, 11.4, 0, 2.7, 0, 'T'), B(5, 1.4, 2.6, 0, 3.3, 5.3, 'C', undefined, [0.55, 0, 0]), B(4.6, 1.7, 6.6, 0, 4.7, -1.8, 'T'),
      B(4.2, 0.6, 0.2, 0, 4.2, 4.3, 'P'), B(0.12, 0.9, 1.7, -2.52, 3.2, 0.4, 'G'), B(0.12, 0.9, 1.7, 2.52, 3.2, 0.4, 'G'),
      C(0.05, 0.07, 5.5, 1.9, 8.2, -4.6, 'K'), C(0.05, 0.07, 4.2, -1.9, 7.6, -4.6, 'K'), C(0.05, 0.07, 3.4, 1.9, 7.2, 0.6, 'K'),
      B(1.6, 0.5, 1.2, 1.4, 5.8, -3.4, 'D'),
      C(0.9, 0.2, 0.5, 0, 0.3, 0, 'L', 's', [0.5, 0, 0]), C(0.12, 0.12, 0.7, 0, -0.2, 0, 'D', 's'),
      B(1.1, 0.7, 1.3, 0, 5.9, 2, 'D', 't'), BR(0.12, 2.2, 0, 6, 2.4), B(0.5, 0.5, 0.6, 0.7, 6, 2, 'K', 't'),
    ],
  },
});

// ───────────────────────── Economy ─────────────────────────
U({
  id: 'depot', name: 'Logistics Hub', desc: 'Draws supplies from a rail spur or warehouse district.', cls: 'building',
  hp: 420, m: 50, e: 500, work: 240, fw: 2, fh: 2, h: 8, extract: 1, useE: 3, sight: 90,
  model: {
    sp: [-3.4, 8, -2], sa: 'y', ss: 0.5,
    parts: [...pad(15, 15), B(7, 4.4, 9, -3.2, 2.8, 2.2, 'M'), B(7.4, 0.5, 9.4, -3.2, 5.2, 2.2, 'D'),
      B(2.4, 2.4, 6, 4.4, 1.8, -3, 'T'), B(2.4, 2.4, 6, 4.4, 1.8, 3.4, 'C'), B(2.4, 2.4, 6, 4.4, 4.2, 0.4, 'D'), B(2.4, 2.4, 6, 1.6, 1.8, -4.4, 'M', undefined, [0, H, 0]),
      C(0.35, 0.45, 7.4, -3.4, 4.3, -2, 'L'), B(0.5, 0.5, 8, 0, 0, 2.4, 'L', 's'), B(0.9, 0.9, 1.4, 0, 0, -1.6, 'D', 's'), B(0.1, 2, 0.1, 0, -1, 5.6, 'K', 's')],
  },
});
U({
  id: 'gen', name: 'Diesel Generator', desc: 'Steady power. +20', cls: 'building',
  hp: 380, m: 150, e: 0, work: 420, fw: 2, fh: 2, h: 5, mkE: 20, sight: 90,
  model: {
    parts: [...pad(15, 15), B(3.4, 3.2, 9, -3.6, 2.2, 0, 'T'), B(3.4, 3.2, 9, 1, 2.2, 0, 'C'),
      C(0.3, 0.3, 2.2, -3.6, 4.8, -3, 'K'), C(0.3, 0.3, 2.2, 1, 4.8, -3, 'K'), B(2.8, 0.2, 2.4, -3.6, 3.9, 2.4, 'K'), B(2.8, 0.2, 2.4, 1, 3.9, 2.4, 'K'),
      TZ(1.5, 8, 5, 2.2, 0, 'L'), B(0.5, 1.4, 0.5, 5, 0.7, -3, 'D'), B(0.5, 1.4, 0.5, 5, 0.7, 3, 'D'), B(1, 1.6, 1.2, 5, 4.2, 0, 'D')],
  },
});
U({
  id: 'wind', name: 'Wind Turbine', desc: 'Cheap, variable power. +0–25', cls: 'building',
  hp: 210, m: 40, e: 180, work: 210, h: 15, wind: 25, sight: 90,
  model: {
    sp: [0, 13, 1.4], sa: 'z', ss: 5,
    parts: [C(2.4, 3, 0.8, 0, 0.4, 0, 'N'), C(0.5, 0.9, 12.4, 0, 6.8, 0, 'W'), B(1.4, 1.4, 3.2, 0, 13, 0, 'W'),
      B(0.8, 6.5, 0.2, 0, 3.25, 0, 'W', 's'), B(0.8, 6.5, 0.2, -2.815, -1.625, 0, 'W', 's', [0, 0, 2.094]), B(0.8, 6.5, 0.2, 2.815, -1.625, 0, 'W', 's', [0, 0, -2.094]),
      S(0.7, 0, 13, 1.6, 'L')],
  },
});
U({
  id: 'estore', name: 'Substation', desc: 'Stores 6000 power.', cls: 'building',
  hp: 1200, m: 170, e: 1700, work: 500, fw: 2, fh: 2, h: 8, stE: 6000, sight: 90,
  model: { parts: [...pad(15, 15), B(4, 4.4, 5, -3.6, 2.8, -3, 'M'), B(4, 4.4, 5, 3.6, 2.8, -3, 'M'), B(4.4, 0.8, 5.4, -3.6, 4.2, -3, 'D'), B(4.4, 0.8, 5.4, 3.6, 4.2, -3, 'D'),
    C(0.25, 0.35, 2.4, -4.6, 6.2, -3, 'L'), C(0.25, 0.35, 2.4, -2.6, 6.2, -3, 'L'), C(0.25, 0.35, 2.4, 4.6, 6.2, -3, 'L'), C(0.25, 0.35, 2.4, 2.6, 6.2, -3, 'L'),
    B(0.4, 7, 0.4, -5, 4, 4, 'L'), B(0.4, 7, 0.4, 5, 4, 4, 'L'), B(11, 0.4, 0.4, 0, 7.2, 4, 'L'), B(11, 0.3, 0.3, 0, 5.4, 4, 'L'), B(3, 2.6, 3, 0, 1.9, 3.4, 'T')] },
});
U({
  id: 'mstore', name: 'Warehouse', desc: 'Stores 3000 supplies.', cls: 'building',
  hp: 1500, m: 320, e: 600, work: 500, fw: 2, fh: 2, h: 7, stM: 3000, sight: 90,
  model: { parts: [...pad(15, 15), B(12.4, 4.6, 13, 0, 2.9, 0, 'M'), B(7.2, 0.5, 13.6, -3.1, 6, 0, 'D', undefined, [0, 0, 0.42]), B(7.2, 0.5, 13.6, 3.1, 6, 0, 'D', undefined, [0, 0, -0.42]),
    B(4.4, 3.6, 0.2, 0, 2.4, 6.55, 'K'), B(1.6, 1.4, 1.6, 4.4, 1.3, 7, 'O'), B(1.6, 1.4, 1.6, -4.6, 1.3, 7, 'T')] },
});
U({
  id: 'converter', name: 'Munitions Works', desc: 'Converts 70 power into 1 supply.', cls: 'building',
  hp: 260, m: 1, e: 1200, work: 350, fw: 2, fh: 2, h: 9, conv: 70, sight: 90,
  model: { parts: [...pad(15, 15), B(9, 4, 11, -1.6, 2.6, 0, 'N'), B(9.4, 0.5, 11.4, -1.6, 4.8, 0, 'D'), B(9, 1.2, 3, -1.6, 5.4, -2.5, 'N'), B(9, 1.2, 3, -1.6, 5.4, 2.5, 'N'),
    C(0.7, 0.9, 9, 4.8, 5, -4, 'L'), C(0.75, 0.75, 0.8, 4.8, 8.6, -4, 'R'), B(2.4, 2.4, 4, 4.8, 1.8, 2.6, 'T')] },
});
U({
  id: 'plant', name: 'Thermal Power Plant', desc: 'Massive power output. +600. Burns violently when hit.', cls: 'building', tier: 2, req: 't_rail',
  hp: 4200, m: 3500, e: 20000, work: 7500, fw: 4, fh: 3, h: 16, mkE: 600, stE: 2000, sight: 110, blast: { r: 90, d: 900 },
  model: { parts: [...pad(31, 23, 0.8), B(13, 10, 15, -7.5, 5.8, -1, 'N'), B(13.4, 0.8, 15.4, -7.5, 11.2, -1, 'D'), B(12, 2, 5, -7.5, 12.2, -1, 'M'),
    C(3.6, 5.4, 12, 5, 6.8, -4.6, 'N'), C(3.6, 5.4, 12, 5, 6.8, 5.4, 'N'), C(3.7, 3.7, 0.5, 5, 12.6, -4.6, 'L'), C(3.7, 3.7, 0.5, 5, 12.6, 5.4, 'L'),
    C(0.9, 1.4, 22, 12.6, 11.8, 0, 'W'), C(1.0, 1.0, 2, 12.6, 20, 0, 'R'), C(1.15, 1.15, 2, 12.6, 15, 0, 'R'),
    B(3, 5, 9, -1, 3.3, 7, 'M'), B(1, 1, 12, -3, 8, 8.4, 'K', undefined, [0, 0.9, 0.35])] },
});
U({
  id: 'railhub', name: 'Rail Terminal', desc: 'Quadruple supply flow. Can replace a Logistics Hub.', cls: 'building', tier: 2, req: 't_rail',
  hp: 1600, m: 600, e: 8000, work: 3000, fw: 2, fh: 2, h: 11, extract: 4, useE: 20, sight: 100,
  model: {
    sp: [0, 9.6, 0], sa: 'y', ss: 0.35,
    parts: [...pad(15.6, 15.6), B(0.3, 0.3, 15.6, -5.4, 0.8, 0, 'K'), B(0.3, 0.3, 15.6, -3.8, 0.8, 0, 'K'), B(0.3, 0.3, 15.6, 3.8, 0.8, 0, 'K'), B(0.3, 0.3, 15.6, 5.4, 0.8, 0, 'K'),
      B(2.6, 3, 6.4, -4.6, 2.6, -3.6, 'C'), B(2.6, 3, 6.4, -4.6, 2.6, 3.6, 'T'), B(2.6, 2.6, 6.4, 4.6, 2.4, 2, 'M'), TZ(1.3, 6, 4.6, 2.4, -4.4, 'L'),
      B(0.8, 9, 0.8, -6.6, 5, 0, 'Y'), B(0.8, 9, 0.8, 6.6, 5, 0, 'Y'), B(14, 0.9, 1.2, 0, 9.6, 0, 'Y'),
      B(1.6, 1.2, 1.6, 2, -0.9, 0, 'D', 's'), B(0.1, 3, 0.1, 2, -2.6, 0, 'K', 's'), B(2.2, 2.2, 5, 2, -5, 0, 'T', 's')],
  },
});

// ───────────────────────── Production ─────────────────────────
const yard = (w: number, c: string): Part[] => {
  const e = w / 2 - 2.5;
  return [B(w, 0.6, w, 0, 0.3, 0, 'N'), B(w - 12, 0.14, w - 6, 0, 0.67, 0, 'D'),
    B(5, 8, w - 2, -e, 4.6, 0, c), B(5, 8, w - 2, e, 4.6, 0, c), B(w - 2, 8, 5, 0, 4.6, -e, c),
    B(5.6, 0.7, w - 1.4, -e, 8.9, 0, 'D'), B(5.6, 0.7, w - 1.4, e, 8.9, 0, 'D'), B(w - 1.4, 0.7, 5.6, 0, 8.9, -e, 'D'),
    B(w - 9, 0.5, w - 12, 0, 9.6, -2, 'M'),
    B(1, 0.16, w - 4, -e + 3, 0.72, 0, 'W'), B(1, 0.16, w - 4, e - 3, 0.72, 0, 'W')];
};
U({
  id: 'barracks', name: 'Barracks', desc: 'Trains infantry: riflemen, anti-tank, air-defence and mortar teams, engineers.', cls: 'building',
  hp: 2400, m: 560, e: 1000, work: 1200, fw: 5, fh: 5, h: 9, bp: 20, factory: true, sight: 110,
  builds: ['engineer', 'rifle', 'atgm', 'manpad', 'mortar'],
  model: { parts: [B(39, 0.4, 39, 0, 0.2, 0, 'D'),
    B(9, 3, 14, -13, 1.9, -8, 'T'), B(5.6, 0.4, 14.4, -15.3, 4.3, -8, 'C', undefined, [0, 0, 0.6]), B(5.6, 0.4, 14.4, -10.7, 4.3, -8, 'C', undefined, [0, 0, -0.6]),
    B(9, 3, 14, 13, 1.9, -8, 'T'), B(5.6, 0.4, 14.4, 10.7, 4.3, -8, 'C', undefined, [0, 0, 0.6]), B(5.6, 0.4, 14.4, 15.3, 4.3, -8, 'C', undefined, [0, 0, -0.6]),
    B(14, 3.4, 8, 0, 2.1, -14.5, 'T'), B(14.4, 0.4, 5, 0, 4.9, -16.4, 'C', undefined, [-0.6, 0, 0]), B(14.4, 0.4, 5, 0, 4.9, -12.6, 'C', undefined, [0.6, 0, 0]),
    B(1.2, 1.8, 30, -18.6, 1.1, 2, 'O'), B(1.2, 1.8, 30, 18.6, 1.1, 2, 'O'), B(12, 1.8, 1.2, -12.6, 1.1, 17.6, 'O'), B(12, 1.8, 1.2, 12.6, 1.1, 17.6, 'O'),
    C(0.12, 0.16, 9, -6.4, 4.7, 16, 'L'), B(0.1, 1.5, 2.4, -6.4, 8.3, 17.3, 'G'),
    B(2, 1.2, 2, 6, 0.8, 10, 'O'), B(2.4, 1.4, 1.4, 8.4, 0.9, 10, 'T'), B(1.4, 5, 1.4, 16.6, 2.7, 15.6, 'M'), B(2.6, 1.6, 2.6, 16.6, 5.9, 15.6, 'D')] },
});
U({
  id: 'motorpool', name: 'Motor Pool', desc: 'Fields vehicles: scout cars, IFVs, tanks, artillery and mobile air defence.', cls: 'building',
  hp: 3000, m: 680, e: 1300, work: 1400, fw: 5, fh: 5, h: 11, bp: 20, factory: true, sight: 110,
  builds: ['dozer', 'scout', 'ifv', 'tank', 'spg', 'caesar', 'spaa'],
  model: { parts: [...yard(39, 'N'), B(6, 2.4, 6, 12, 11, -14, 'M'), C(0.5, 0.5, 4, 14, 13.6, -16, 'K'), TZ(1.6, 7, -15.4, 2.2, 12, 'L'), B(0.12, 1.4, 2.2, -19.56, 6, 8, 'G')] },
});
U({
  id: 'airfield', name: 'Airfield', desc: 'Operates drones, helicopters and jets.', cls: 'building',
  hp: 2300, m: 800, e: 1600, work: 1600, fw: 5, fh: 5, h: 10, bp: 20, factory: true, sight: 130,
  builds: ['recon', 'tb2', 'heli', 'fighter', 'cas', 'f16'],
  model: {
    sp: [-15, 13.4, -15], sa: 'y', ss: 1.6,
    parts: [B(39, 0.5, 39, 0, 0.25, 0, 'D'), B(12, 0.1, 38, 3, 0.56, 0, 'K'),
      B(0.6, 0.06, 5, 3, 0.63, -14, 'W'), B(0.6, 0.06, 5, 3, 0.63, -5, 'W'), B(0.6, 0.06, 5, 3, 0.63, 4, 'W'), B(0.6, 0.06, 5, 3, 0.63, 13, 'W'),
      B(5, 10, 5, -15, 5.4, -15, 'N'), B(6.6, 2.4, 6.6, -15, 11.4, -15, 'P'), B(7, 0.5, 7, -15, 12.8, -15, 'D'),
      B(4.4, 1.6, 0.4, 0, 0.8, 0, 'L', 's'), B(0.5, 1.2, 0.5, 0, -0.2, 0, 'M', 's'),
      B(9, 5, 14, -13.4, 3, 6, 'T'), B(9.4, 1.6, 14.4, -13.4, 6.2, 6, 'C'), B(7, 4.2, 0.3, -13.4, 2.6, 13.1, 'K'),
      B(3, 2, 6, 15.5, 1.5, -14, 'M'), TZ(1.3, 6, 15.5, 1.9, 6, 'L'), B(0.12, 1.4, 2.2, -17.56, 7, -15, 'G')],
  },
});
U({
  id: 'dronehub', name: 'Drone Workshop', desc: 'Assembles FPV drones, long-range strike drones and jet UCAVs.', cls: 'building', req: 't_fpv',
  hp: 1700, m: 520, e: 2600, work: 1500, fw: 4, fh: 4, h: 9, bp: 22, factory: true, sight: 120,
  builds: ['fpv', 'sting', 'lancet', 'loiter', 'ucav'],
  model: {
    sp: [9, 9.5, -10], sa: 'y', ss: 0.8,
    parts: [B(31, 0.5, 31, 0, 0.25, 0, 'D'), B(2.6, 2.8, 12, -11, 1.9, -6, 'T'), B(2.6, 2.8, 12, -7.6, 1.9, -6, 'C'), B(2.6, 2.8, 12, -9.3, 4.7, -6, 'D'),
      B(12, 4.4, 9, 6, 2.7, -9.5, 'N'), B(12.4, 0.5, 9.4, 6, 5.1, -9.5, 'D'), C(0.14, 0.2, 5, 9, 7.5, -10, 'L'),
      B(2.2, 1.4, 0.3, 0, 0.6, 0, 'L', 's'), B(0.3, 0.3, 1, 0, 0.6, 0.5, 'K', 's'),
      B(1, 0.5, 10, -4, 1.7, 7, 'M', undefined, [-0.22, 0, 0]), B(1, 0.5, 10, 0, 1.7, 7, 'M', undefined, [-0.22, 0, 0]), B(0.5, 2.4, 0.5, -4, 1.6, 10.6, 'D'), B(0.5, 2.4, 0.5, 0, 1.6, 10.6, 'D'),
      B(3, 1.6, 3, 8, 1.3, 6, 'O'), B(3, 1.2, 2, 11.6, 1.1, 7, 'T'), B(0.12, 1.4, 2.2, 12.06, 3, -9.5, 'G')],
  },
});
U({
  id: 'heavy', name: 'Armour Depot', names: ['Armour Depot', 'Tank Plant'], desc: 'Fields modern heavy armour and rocket artillery.', cls: 'building', tier: 2, req: 't_armor',
  hp: 5000, m: 2600, e: 6000, work: 4200, fw: 6, fh: 6, h: 14, bp: 40, factory: true, sight: 120,
  builds: ['mbt', 'hifv', 'mlrs', 'tos'],
  model: { parts: [...yard(47, 'N'), C(1.2, 1.6, 9, -19, 13.6, -19, 'L'), C(1.2, 1.6, 9, 19, 13.6, -19, 'L'), C(1.3, 1.3, 1, -19, 17, -19, 'R'), C(1.3, 1.3, 1, 19, 17, -19, 'R'),
    B(0.8, 12, 0.8, -15, 6.6, 20, 'Y'), B(0.8, 12, 0.8, 15, 6.6, 20, 'Y'), B(31, 1.2, 1.4, 0, 12.6, 20, 'Y'), B(2.4, 2, 2.4, 5, 11, 20, 'D'), B(0.12, 1.4, 2.2, -23.56, 6, 10, 'G')] },
});
U({
  id: 'lab', name: 'Design Bureau', names: ['Brave1 Tech Cluster', 'Rostec Design Bureau'], desc: 'Researches military technology. Select it to choose a programme.', cls: 'building',
  hp: 1500, m: 420, e: 3500, work: 1500, fw: 3, fh: 3, h: 12, bp: 20, lab: 'lab', sight: 110, useE: 10,
  model: {
    sp: [5.6, 12.6, -5.6], sa: 'y', ss: 0.9,
    parts: [...pad(23, 23), B(14, 9, 12, -2.4, 5.1, -2.6, 'N'), B(14.2, 1.2, 12.2, -2.4, 3.4, -2.6, 'P'), B(14.2, 1.2, 12.2, -2.4, 6.2, -2.6, 'P'), B(14.4, 0.6, 12.4, -2.4, 9.9, -2.6, 'D'),
      B(6, 4, 8, 7.4, 2.6, 4.6, 'M'), B(6.2, 0.4, 8.2, 7.4, 4.8, 4.6, 'D'), C(0.2, 0.3, 3, 5.6, 11.4, -5.6, 'L'),
      C(1.6, 0.3, 0.9, 0, 0.3, 0, 'W', 's', [0.9, 0, 0]), C(0.1, 0.1, 1.2, 0, 0.3, 0.6, 'K', 's', [0.9, 0, 0]),
      S(1.6, -6, 11.2, -5, 'W'), B(4, 0.2, 4, -2, 0.75, 7.6, 'W'), B(0.12, 1.4, 2.2, -9.46, 7.8, -2.6, 'G')],
  },
});

// ───────────────────────── Defences ─────────────────────────
U({
  id: 'bunker', name: 'MG Bunker', desc: 'Sandbagged heavy machine-gun nest. Anti-ground.', cls: 'building',
  hp: 1150, m: 250, e: 2200, work: 900, h: 5, sight: 215,
  weapons: [{ k: 'gun', range: 195, reload: 0.14, dmg: 8.5, tg: 1, color: TR }],
  model: { tp: [0, 2.6, 0], parts: [...bags(7.6, 7.6, 2.2), B(6.4, 0.5, 6.4, 0, 0.25, 0, 'D'), B(8, 0.7, 4, 0, 3.6, -2, 'O'), TZ(0.35, 8, -2.4, 4.1, -2, 'D'), TZ(0.35, 8, 0, 4.1, -2, 'D'), TZ(0.35, 8, 2.4, 4.1, -2, 'D'),
    B(1, 0.9, 1.4, 0, 2.9, 0.4, 'D', 't'), BR(0.13, 3.2, 0, 3, 1), B(0.7, 0.7, 0.8, 0.8, 2.8, 0.4, 'K', 't'), C(0.3, 0.6, 1.6, 0, 1.6, 0, 'K', 't')] },
});
U({
  id: 'howitzer', name: 'M777 Battery', names: ['M777 Battery', 'Msta-B Battery'], desc: 'Dug-in 152/155 mm howitzer. Long range, cannot hit close targets.', cls: 'building',
  hp: 2600, m: 800, e: 6000, work: 2600, fw: 2, fh: 2, h: 7, sight: 260,
  weapons: [{ k: 'cannon', range: 330, min: 60, reload: 3.2, dmg: 400, splash: 34, speed: 200, arc: 0.3, spread: 0.035, tg: 1, color: SHELL, turn: 1.3 }],
  model: { tp: [0, 2.6, 0], parts: [B(15, 0.4, 15, 0, 0.2, 0, 'D'), B(15, 1.8, 1.4, 0, 0.9, 7, 'O'), B(1.4, 1.8, 10, -7, 0.9, 2.6, 'O'), B(1.4, 1.8, 10, 7, 0.9, 2.6, 'O'),
    B(1.6, 1.2, 1.6, -5, 0.8, -5.4, 'T'), B(1.6, 1.2, 1.6, -3.2, 0.8, -5.4, 'T'), B(1.6, 1.2, 1.6, -4.1, 2, -5.4, 'C'),
    C(1.1, 1.1, 0.7, -1.6, 1.1, 0, 'K', 't', [0, 0, H]), C(1.1, 1.1, 0.7, 1.6, 1.1, 0, 'K', 't', [0, 0, H]), B(2.6, 1.3, 3, 0, 2.2, 0, 'T', 't'),
    B(0.5, 0.5, 6, -1.4, 0.7, -3.4, 'T', 't', [0.12, -0.3, 0]), B(0.5, 0.5, 6, 1.4, 0.7, -3.4, 'T', 't', [0.12, 0.3, 0]),
    C(0.3, 0.38, 9.6, 0, 4.9, 4.1, 'T', 't', [1.18, 0, 0]), C(0.5, 0.5, 1, 0, 6.6, 8.2, 'D', 't', [1.18, 0, 0]), B(2.2, 1.6, 0.3, 0, 3.2, 1.4, 'C', 't', [-0.3, 0, 0])] },
});
U({
  id: 'aagun', name: 'ZU-23-2', desc: 'Twin 23 mm anti-aircraft gun. Shreds drones and helicopters.', cls: 'building',
  hp: 850, m: 180, e: 1800, work: 700, h: 5, sight: 290,
  weapons: [{ k: 'gun', range: 265, reload: 0.15, dmg: 14, tg: 2, color: 0xffe0b0, free: true }],
  model: { tp: [0, 2.2, 0], parts: [...bags(7.4, 7.4, 1.5), B(6, 0.4, 6, 0, 0.2, 0, 'D'), C(1.4, 1.8, 1, 0, 0.9, 0, 'T'),
    B(2.6, 1.3, 2.2, 0, 2.3, -0.2, 'T', 't'), C(0.11, 0.11, 5, -0.5, 4, 1.7, 'K', 't', [0.9, 0, 0]), C(0.11, 0.11, 5, 0.5, 4, 1.7, 'K', 't', [0.9, 0, 0]),
    B(0.7, 0.9, 1.2, -1.5, 2.5, 0, 'D', 't'), B(0.7, 0.9, 1.2, 1.5, 2.5, 0, 'D', 't'), B(0.9, 1.3, 0.2, 0, 3.4, -1.2, 'C', 't')] },
});
U({
  id: 'radar', name: 'Radar Station', desc: 'Detects distant units on the minimap.', cls: 'building',
  hp: 200, m: 60, e: 600, work: 280, h: 14, radar: 560, useE: 8, sight: 70,
  model: { sp: [0, 11.6, 0], sa: 'y', ss: 1.4, parts: [C(2.6, 3.2, 0.8, 0, 0.4, 0, 'N'), B(2.6, 2.6, 2.6, 0, 2, 0, 'T'), C(0.35, 0.6, 8, 0, 7.2, 0, 'M'),
    B(8, 3.2, 0.3, 0, 1.2, 0, 'M', 's'), B(8.4, 0.2, 0.5, 0, 2.9, 0, 'D', 's'), B(8.4, 0.2, 0.5, 0, -0.5, 0, 'D', 's'), B(0.8, 0.8, 1.6, 0, 0.4, -0.8, 'D', 's')] },
});
U({
  id: 'sam', name: 'Patriot Battery', names: ['Patriot Battery', 'S-400 Triumf'], desc: 'Long-range air defence. Intercepts aircraft, drones and cruise missiles.', cls: 'building', tier: 2, req: 't_iads',
  hp: 1900, m: 900, e: 9000, work: 3200, fw: 2, fh: 2, h: 11, sight: 240, radar: 620, useE: 30,
  weapons: [{ k: 'missile', range: 590, reload: 2.4, dmg: 420, speed: 540, tg: 2, color: SAMC, free: true }],
  model: {
    tp: [-3.4, 3, 0], sp: [4.4, 7.4, -3.6], sa: 'y', ss: 1.1,
    parts: [B(15.4, 0.4, 15.4, 0, 0.2, 0, 'D'), ...wheels(-3.4 + 1.6, [-4.4, 4.4], 1), ...wheels(-3.4 - 1.6, [-4.4, 4.4], 1).slice(0, 0),
      B(3.4, 1.4, 12, -3.4, 2, 0, 'T'), B(3.2, 2.2, 2.6, -3.4, 3.6, 5.4, 'C'), B(3, 0.9, 0.2, -3.4, 4, 6.75, 'P'),
      B(3.4, 3.2, 7.4, 0, 3.6, -1.6, 'T', 't', [-0.95, 0, 0]), B(1.4, 1.4, 0.3, -0.85, 6.3, 0.2, 'D', 't', [-0.95, 0, 0]), B(1.4, 1.4, 0.3, 0.85, 6.3, 0.2, 'D', 't', [-0.95, 0, 0]),
      B(1.4, 1.4, 0.3, -0.85, 7.4, -1.3, 'D', 't', [-0.95, 0, 0]), B(1.4, 1.4, 0.3, 0.85, 7.4, -1.3, 'D', 't', [-0.95, 0, 0]),
      B(3.4, 2.6, 6, 4.4, 1.9, -3.6, 'C'), C(0.4, 0.5, 3, 4.4, 4.8, -3.6, 'M'), B(5, 4.4, 0.5, 0, 1.6, 0, 'T', 's', [-0.25, 0, 0]), B(4.4, 3.8, 0.2, 0, 1.6, 0.36, 'D', 's', [-0.25, 0, 0]),
      B(2.6, 2.4, 3.6, 4.4, 1.7, 4.6, 'M'), B(0.12, 1.2, 2, -5.16, 2.2, -1, 'G')],
  },
});
U({
  id: 'ew', name: 'EW Station', names: ['Bukovel-AD EW Station', 'Krasukha-4 EW Station'], desc: 'Jams drone control links. Enemy drones inside its bubble lose control and crash.', cls: 'building', tier: 2, req: 't_ew',
  hp: 800, m: 380, e: 5000, work: 1800, fw: 2, fh: 2, h: 13, sight: 150, useE: 40, jam: 290,
  model: {
    sp: [0, 11.4, -2], sa: 'y', ss: 0.6,
    parts: [B(15.4, 0.4, 15.4, 0, 0.2, 0, 'D'), ...wheels(1.7, [-4.2, 0, 4.4], 1), B(3.6, 1.2, 12.4, 0, 1.9, 0, 'T'), B(3.4, 2.2, 2.6, 0, 3.5, 5.2, 'C'), B(3.2, 0.9, 0.2, 0, 3.9, 6.55, 'P'),
      B(3.6, 3, 7, 0, 4, -2.2, 'T'), C(0.3, 0.45, 6, 0, 8.4, -2, 'M'),
      B(5.6, 2.2, 0.4, 0, 0, 0, 'D', 's'), C(1.3, 0.3, 0.7, -2, 1.9, 0, 'L', 's', [H, 0, 0]), C(1.3, 0.3, 0.7, 2, 1.9, 0, 'L', 's', [H, 0, 0]), B(0.2, 3.4, 0.2, 0, 1.6, 0, 'K', 's'),
      C(0.06, 0.08, 6, 5.6, 3.2, 5.6, 'K'), C(0.06, 0.08, 6, -5.6, 3.2, -5.6, 'K'), ...bags(15, 15, 1.2).slice(0, 1)],
  },
});
U({
  id: 'strike', name: 'Neptune Launcher', names: ['Neptune Launcher', 'Iskander-K Launcher'], desc: 'Cruise-missile battery. Strikes spotted structures anywhere on the map. Missiles can be shot down.', cls: 'building', tier: 2, req: 't_strike',
  hp: 2600, m: 2600, e: 22000, work: 7000, fw: 3, fh: 3, h: 12, sight: 180,
  weapons: [{ k: 'launch', spawn: 'cruise', range: 2400, min: 240, reload: 30, dmg: 1500, splash: 58, tg: 1, color: SHELL, eShot: 2500, bld: true, turn: 0.8 }],
  model: { tp: [0, 3.2, -1], parts: [B(23, 0.4, 23, 0, 0.2, 0, 'D'), B(23, 2, 1.6, 0, 1, -10.8, 'O'), B(1.6, 2, 16, -10.8, 1, -3, 'O'), B(1.6, 2, 16, 10.8, 1, -3, 'O'),
    ...wheels(1.9, [-6, -3.4, 3.4, 6], 1.15), B(4, 1.5, 15.4, 0, 2.3, 0, 'T'), B(3.8, 2.3, 3, 0, 4, 6.4, 'C'), B(3.6, 0.9, 0.2, 0, 4.4, 7.95, 'P'),
    B(3.6, 2.8, 9.6, 0, 4.2, -1, 'T', 't', [-0.62, 0, 0]), C(0.75, 0.75, 0.3, -0.9, 7.2, 2.6, 'R', 't', [H - 0.62, 0, 0]), C(0.75, 0.75, 0.3, 0.9, 7.2, 2.6, 'R', 't', [H - 0.62, 0, 0]),
    B(0.5, 3, 0.5, -1.2, 1.9, -3, 'M', 't'), B(0.5, 3, 0.5, 1.2, 1.9, -3, 'M', 't'), B(0.12, 1.2, 2, 2.06, 2.5, 1, 'G')] },
});
U({
  id: 'pad', name: 'Launch Complex', names: ['Launch Complex', 'Plesetsk Launch Complex'], desc: 'Orbital launch site. Select it to send reconnaissance and guidance satellites into orbit.', cls: 'building', tier: 3, req: 't_space',
  hp: 3400, m: 3000, e: 24000, work: 8000, fw: 5, fh: 5, h: 34, bp: 30, lab: 'pad', sight: 140, useE: 30,
  model: { parts: [B(39, 0.8, 39, 0, 0.4, 0, 'N'), C(7, 7.6, 1.4, 0, 1.5, 0, 'N'), C(4, 4, 0.3, 0, 2.3, 0, 'K'), B(8, 0.2, 16, 0, 0.9, 11, 'K'),
    B(3, 30, 3, -8, 15.8, 0, 'M'), B(3.4, 0.6, 3.4, -8, 8, 0, 'R'), B(3.4, 0.6, 3.4, -8, 16, 0, 'R'), B(3.4, 0.6, 3.4, -8, 24, 0, 'R'), B(5, 0.8, 1.2, -5, 22, 0, 'M'), B(5, 0.8, 1.2, -5, 12, 0, 'M'),
    C(0.1, 0.14, 8, -8, 34.8, 0, 'K'), C(0.14, 0.3, 26, 9, 13.8, 9, 'L'), C(0.14, 0.3, 26, 9, 13.8, -9, 'L'),
    B(9, 5, 7, 13, 3.3, -13.6, 'N'), B(9.2, 1, 7.2, 13, 4, -13.6, 'P'), TZ(2.4, 9, -13.6, 3.2, -12, 'W'), TZ(2.4, 9, -13.6, 3.2, 12, 'W'), S(2.2, 14, 8.6, -14, 'W'), B(0.12, 1.4, 2.2, 8.46, 4, -13.6, 'G')] },
});

// ───────────────────────── Requisitioned civilian buildings ─────────────────────────
// Quick and cheap to set up inside an existing building, but weaker, slower and more limited than purpose-built bases.
const roof = (extra: Part[]): Part[] => [B(5, 1.2, 0.9, 0, 0.6, 2.4, 'O'), B(0.9, 1.2, 4, -2.4, 0.6, 0.4, 'O'), B(0.9, 1.2, 4, 2.4, 0.6, 0.4, 'O'),
  C(0.07, 0.1, 6, -2.2, 3, -2, 'L'), B(0.08, 1.3, 2.2, -2.2, 5.3, -0.9, 'G'), ...extra];
U({
  id: 'c_camp', name: 'Requisitioned Base Camp', desc: 'Garrison an apartment block. Trains infantry slowly and shelters troops through winter. Fragile; lost if the building falls.', cls: 'building', reuse: [1, 2],
  hp: 800, m: 130, e: 400, work: 320, h: 6, bp: 9, factory: true, sight: 150, builds: ['rifle', 'atgm', 'manpad', 'mortar'],
  model: { parts: roof([B(2.6, 1.6, 2.2, 0.4, 0.8, -1.2, 'T'), B(1.9, 0.3, 2.4, -0.3, 1.9, -1.2, 'C', undefined, [0, 0, 0.5]), B(1.9, 0.3, 2.4, 1.1, 1.9, -1.2, 'C', undefined, [0, 0, -0.5])]) },
});
U({
  id: 'c_drone', name: 'Garage Drone Workshop', desc: 'A volunteer workshop in a warehouse or tower block. Assembles FPV drones only, and slowly.', cls: 'building', reuse: [1, 2, 3], req: 't_fpv',
  hp: 600, m: 160, e: 900, work: 420, h: 6, bp: 9, factory: true, sight: 150, builds: ['fpv'],
  model: { sp: [1.6, 3.4, -1.4], sa: 'y', ss: 0.9, parts: roof([B(2.4, 1.4, 2.4, 1.2, 0.7, -1.2, 'M'), C(0.08, 0.1, 2.6, 1.6, 2.1, -1.4, 'L'), B(1.6, 0.9, 0.2, 0, 0.3, 0, 'L', 's'), B(1.2, 0.2, 1.2, -1, 0.3, 0.4, 'K')]) },
});
U({
  id: 'c_post', name: 'Observation Post', desc: 'Spotters on a rooftop. Wide view and short-range radar from any tall building.', cls: 'building', reuse: [1, 2, 4, 8],
  hp: 450, m: 60, e: 300, work: 200, h: 6, sight: 330, radar: 380,
  model: { sp: [1.4, 3, -1.2], sa: 'y', ss: 1.3, parts: roof([C(0.1, 0.14, 2.6, 1.4, 1.5, -1.2, 'M'), B(2.2, 1, 0.2, 0, 0.2, 0, 'M', 's'), B(0.6, 0.6, 0.9, 0.4, 0.9, 1.6, 'K')]) },
});

U({
  id: 'bridge', name: 'Bridge', desc: 'A river crossing. If it is brought down, vehicles cannot cross here; infantry can still wade the river, slowly.', cls: 'building', neutral: true,
  hp: 5200, m: 0, e: 0, work: 1, fw: 3, fh: 3, h: 3, sight: 1,
  model: { parts: [] },
});

U({
  id: 'pontoon', name: 'Pontoon Bridge', names: ['PMP Pontoon Bridge', 'PMP Pontoon Bridge'], desc: 'Floating military bridge laid where a bridge has been destroyed. Reopens the crossing to vehicles. Weaker than the original.', cls: 'building', span: true, tier: 2, req: 't_bridge',
  hp: 2600, m: 520, e: 3000, work: 2200, fw: 3, fh: 3, h: 3, sight: 60,
  model: { parts: [B(64, 0.5, 9, 0, 0.9, 0, 'T'), B(64, 0.3, 0.5, 0, 1.4, 4.4, 'C'), B(64, 0.3, 0.5, 0, 1.4, -4.4, 'C'),
    ...[-28, -20, -12, -4, 4, 12, 20, 28].map(x => B(6.4, 1.3, 13, x, 0, 0, 'C'))] },
});

// ───────────────────────── Infantry ─────────────────────────
U({
  id: 'engineer', name: 'Engineer', names: ['Sapper', 'Combat Engineer'], desc: 'Builds and repairs every structure, salvages wrecks.', cls: 'ground', inf: true,
  hp: 240, m: 95, e: 1200, work: 560, speed: 14, turn: 5, r: 1.7, h: 4.6, bp: 9, builds: ENG_BUILD, bot: true, sight: 160,
  model: { tp: [0, HIP, 0], hip: HIP, knee: KNEE, neck: NECK, parts: trooper([C(0.07, 0.07, 2.6, 0.5, 3.5, -0.95, 'O', 't'), B(0.5, 0.6, 0.1, 0.5, 4.9, -0.95, 'M', 't'), B(0.5, 0.5, 0.9, 0.5, 2.5, 0.8, 'Y', 't')], 'H', false) },
});
U({
  id: 'rifle', name: 'Rifleman', names: ['Territorial Defence', 'Motor Rifleman'], desc: 'Basic infantry. Cheap, numerous, effective against other infantry.', cls: 'ground', inf: true,
  hp: 210, m: 34, e: 380, work: 170, speed: 16, turn: 5.5, r: 1.6, h: 4.6, bot: true, sight: 185,
  weapons: [{ k: 'gun', range: 118, reload: 0.5, dmg: 9, tg: 1, color: TR },
    { k: 'cannon', range: 62, min: 14, reload: 8, dmg: 70, splash: 14, speed: 62, arc: 0.5, spread: 0.07, tg: 1, color: 0x50543c, free: true }],
  model: { tp: [0, HIP, 0], hip: HIP, knee: KNEE, neck: NECK, parts: trooper() },
});
U({
  id: 'atgm', name: 'Javelin Team', names: ['Javelin Team', 'Kornet Team'], desc: 'Anti-tank guided missile. Devastating against armour, slow to reload.', cls: 'ground', inf: true,
  hp: 200, m: 85, e: 950, work: 400, speed: 13.5, turn: 4.5, r: 1.6, h: 4.6, bot: true, sight: 200,
  weapons: [{ k: 'missile', range: 215, min: 20, reload: 4.2, dmg: 190, splash: 7, speed: 170, tg: 1, color: 0xffa060, free: true }],
  model: { tp: [0, HIP, 0], hip: HIP, knee: KNEE, neck: NECK, parts: trooper([TZ(0.3, 2.8, 0.75, 3.55, 0.2, 'T', 't'), TZ(0.42, 0.5, 0.75, 3.55, 1.5, 'K', 't'), TZ(0.42, 0.5, 0.75, 3.55, -1.1, 'K', 't'), B(0.4, 0.5, 0.5, 0.75, 3.1, 0.6, 'D', 't')], 'H', false) },
});
U({
  id: 'manpad', name: 'Stinger Team', names: ['Stinger Team', 'Igla Team'], desc: 'Shoulder-fired anti-aircraft missile.', cls: 'ground', inf: true,
  hp: 200, m: 80, e: 1000, work: 400, speed: 15, turn: 4.5, r: 1.6, h: 4.6, bot: true, sight: 250,
  weapons: [{ k: 'missile', range: 250, reload: 1.9, dmg: 95, speed: 300, tg: 2, color: SAMC, free: true }],
  model: { tp: [0, HIP, 0], hip: HIP, knee: KNEE, neck: NECK, parts: trooper([C(0.22, 0.22, 3.2, 0.75, 3.9, 0.3, 'C', 't', [1.1, 0, 0]), C(0.34, 0.34, 0.4, 0.75, 4.55, 1.55, 'K', 't', [1.1, 0, 0]), B(0.4, 0.6, 0.5, 0.75, 3.3, 0.7, 'D', 't')], 'H', false) },
});
U({
  id: 'mortar', name: 'Mortar Team', desc: 'Lobs 82 mm bombs over cover. Good against infantry and bunkers.', cls: 'ground', inf: true,
  hp: 200, m: 75, e: 800, work: 360, speed: 13, turn: 4.5, r: 1.7, h: 4.6, bot: true, sight: 190,
  weapons: [{ k: 'cannon', range: 240, min: 45, reload: 2.8, dmg: 78, splash: 17, speed: 120, arc: 0.45, spread: 0.05, tg: 1, color: SHELL, free: true }],
  model: { tp: [0, HIP, 0], hip: HIP, knee: KNEE, neck: NECK, parts: trooper([C(0.2, 0.24, 2.6, 0, 1.3, 1.5, 'D', 't', [0.6, 0, 0]), C(0.7, 0.7, 0.15, 0, 0.1, 0.8, 'K', 't'), B(0.08, 1.6, 0.08, -0.4, 0.8, 2, 'K', 't', [0, 0, 0.3]), B(0.08, 1.6, 0.08, 0.4, 0.8, 2, 'K', 't', [0, 0, -0.3])]) },
});

// ───────────────────────── Vehicles ─────────────────────────
U({
  id: 'dozer', name: 'IMR Engineering Vehicle', names: ['BAT-2 Engineering Vehicle', 'IMR-2 Engineering Vehicle'], desc: 'Armoured engineering vehicle. Builds faster than sappers.', cls: 'ground',
  hp: 900, m: 150, e: 1900, work: 850, speed: 16, turn: 2.2, r: 4.4, h: 6.5, bp: 15, builds: ENG_BUILD, sight: 160,
  model: { tp: [0, 3.6, -1], parts: [...tracks(6, 9.6), B(5.2, 1.9, 9, 0, 2.5, 0, 'T'), B(4, 2, 3.4, 0, 4.3, 1.6, 'C'), B(3.6, 0.8, 0.2, 0, 4.7, 3.35, 'P'),
    B(7.4, 2.6, 0.5, 0, 1.6, 5.8, 'M', undefined, [-0.2, 0, 0]), B(0.5, 0.6, 2.4, -2.4, 1.6, 4.9, 'D'), B(0.5, 0.6, 2.4, 2.4, 1.6, 4.9, 'D'),
    C(1.2, 1.4, 0.9, 0, 3.9, -1, 'D', 't'), B(0.7, 0.7, 6, 0, 5.5, 0.9, 'Y', 't', [-0.55, 0, 0]), B(0.9, 1, 1.2, 0, 7.2, 3.4, 'K', 't')] },
});
U({
  id: 'scout', wheel: true, name: 'Kozak-2', names: ['Kozak-2', 'Tigr-M'], desc: 'Fast armoured scout car with a machine gun.', cls: 'ground',
  hp: 300, m: 45, e: 480, work: 190, speed: 42, turn: 3.2, r: 3, h: 4.4, sight: 250,
  weapons: [{ k: 'gun', range: 115, reload: 0.2, dmg: 4.5, tg: 1, color: TR }],
  model: { tp: [0, 3.9, -0.6], parts: [...wheels(1.7, [-2.2, 2.2], 0.95, 0.8), B(3.4, 1.5, 6.6, 0, 1.9, 0, 'T'), B(3.3, 1.3, 3.4, 0, 3.2, -0.6, 'T'), B(3.3, 1.1, 1.4, 0, 3.0, 1.5, 'P', undefined, [0.5, 0, 0]),
    B(3.2, 0.5, 1.8, 0, 2.6, 2.5, 'C'), B(0.1, 0.6, 1.2, -1.72, 2.2, -0.5, 'G'), B(0.1, 0.6, 1.2, 1.72, 2.2, -0.5, 'G'),
    C(0.6, 0.6, 0.3, 0, 3.95, -0.6, 'D', 't'), BR(0.09, 1.9, 0, 4.4, -0.4), B(0.5, 0.6, 0.2, 0, 4.4, -0.3, 'D', 't')] },
});
U({
  id: 'ifv', name: 'BMP-2', names: ['BMP-2', 'BMP-3'], desc: 'Infantry fighting vehicle. 30 mm autocannon engages ground and low-flying targets.', cls: 'ground',
  hp: 950, m: 125, e: 1250, work: 500, speed: 21, turn: 2.6, r: 4.2, h: 5.2, sight: 190,
  weapons: [{ k: 'gun', range: 145, reload: 0.28, dmg: 13, tg: 3, color: 0xffc890, turn: 3.4 }],
  model: { tp: [0, 3.3, 0], parts: [...tracks(5.8, 9.8, 1.5), B(5, 1.4, 9.6, 0, 2.2, 0, 'T'), B(5, 0.9, 3.4, 0, 2.5, 3.6, 'C', undefined, [0.38, 0, 0]), B(4.4, 0.4, 3, 0, 3.05, -3, 'C'),
    B(0.1, 0.7, 1.4, -2.52, 2.3, -1, 'G'), B(0.1, 0.7, 1.4, 2.52, 2.3, -1, 'G'),
    C(1.5, 1.9, 1.1, 0, 3.6, 0, 'T', 't'), BR(0.13, 4.6, 0, 3.7, 1.2), B(0.5, 0.5, 1.2, 1, 4.3, 0, 'D', 't'), TZ(0.2, 1.4, -1.2, 4.3, 0.4, 'D', 't')] },
});
U({
  id: 'tank', name: 'T-64BV', names: ['T-64BV', 'T-72B3'], desc: 'Main battle tank. 125 mm gun and reactive armour.', cls: 'ground',
  hp: 1550, m: 190, e: 1800, work: 700, speed: 18, turn: 2, r: 4.7, h: 5.4, sight: 185,
  weapons: [{ k: 'cannon', range: 142, reload: 1.9, dmg: 132, splash: 13, speed: 260, spread: 0.022, tg: 1, color: SHELL, turn: 2.6 }],
  model: { tp: [0, 3.3, 0.2], parts: [...tracks(6.6, 10.8, 1.6), B(5.6, 1.4, 10.4, 0, 2.3, 0, 'T'), B(5.6, 0.8, 3.2, 0, 2.7, 4.1, 'C', undefined, [0.42, 0, 0]),
    B(2, 0.8, 2, -1.6, 3.2, -4, 'D'), TZ(0.5, 3, 1.9, 3.3, -4.6, 'C'), TZ(0.5, 3, -1.9, 3.3, -4.6, 'C'), B(0.1, 0.7, 1.4, -2.82, 2.4, 1, 'G'), B(0.1, 0.7, 1.4, 2.82, 2.4, 1, 'G'),
    C(2.2, 2.9, 1.2, 0, 3.7, 0.2, 'T', 't'), B(3.4, 0.9, 1.3, 0, 3.7, 2.1, 'C', 't', [0.2, 0, 0]), B(1.1, 0.9, 2.4, -2.3, 3.7, 0.6, 'C', 't'), B(1.1, 0.9, 2.4, 2.3, 3.7, 0.6, 'C', 't'),
    BR(0.26, 7.6, 0, 3.8, 2.6, 'D'), TZ(0.4, 1.2, 0, 3.8, 6.4, 'D', 't'), C(0.5, 0.5, 0.4, -0.8, 4.5, -0.3, 'D', 't'), BR(0.08, 1.6, -0.8, 4.9, -0.2), B(2, 0.8, 1.4, 0, 3.9, -2.5, 'D', 't')] },
});
U({
  id: 'spg', name: '2S1 Gvozdika', names: ['2S1 Gvozdika', '2S19 Msta-S'], desc: 'Self-propelled howitzer. Outranges bunkers, helpless up close.', cls: 'ground',
  hp: 560, m: 170, e: 2200, work: 800, speed: 13, turn: 1.8, r: 4.5, h: 6.4, sight: 170,
  weapons: [{ k: 'cannon', range: 345, min: 90, reload: 4.5, dmg: 205, splash: 32, speed: 160, arc: 0.36, spread: 0.05, tg: 1, color: SHELL, turn: 1.6 }],
  model: { tp: [0, 3.3, -1.4], parts: [...tracks(6.2, 10.4, 1.5), B(5.2, 1.5, 10, 0, 2.3, 0, 'T'), B(5.2, 0.9, 3, 0, 2.6, 3.9, 'C', undefined, [0.4, 0, 0]),
    B(0.1, 0.7, 1.4, -2.62, 2.4, 2, 'G'), B(0.1, 0.7, 1.4, 2.62, 2.4, 2, 'G'),
    B(4.6, 2.3, 5.4, 0, 4.3, -1.4, 'T', 't'), B(4.2, 0.4, 4.8, 0, 5.6, -1.4, 'C', 't'), C(0.24, 0.3, 8.4, 0, 6.2, 3.6, 'D', 't', [1.12, 0, 0]), C(0.42, 0.42, 1, 0, 7.9, 7.2, 'D', 't', [1.12, 0, 0])] },
});
U({
  id: 'spaa', name: 'Gepard', names: ['Gepard', 'Pantsir-S1'], desc: 'Mobile anti-aircraft gun. Escorts armour against drones and helicopters.', cls: 'ground',
  hp: 720, m: 150, e: 1700, work: 620, speed: 18, turn: 2.2, r: 4.4, h: 7, sight: 280,
  weapons: [{ k: 'gun', range: 240, reload: 0.16, dmg: 13, tg: 2, color: 0xffe0b0, free: true }],
  model: { tp: [0, 3.3, -0.4], sp: [0, 6.8, -1.9], sa: 'y', ss: 2.4, parts: [...tracks(6.2, 10.2, 1.5), B(5.2, 1.5, 9.8, 0, 2.3, 0, 'T'), B(5.2, 0.9, 3, 0, 2.6, 3.8, 'C', undefined, [0.4, 0, 0]),
    B(0.1, 0.7, 1.4, -2.62, 2.4, 2, 'G'), B(0.1, 0.7, 1.4, 2.62, 2.4, 2, 'G'),
    B(3.4, 2.2, 4.4, 0, 4.3, -0.4, 'T', 't'), B(0.8, 1.2, 2.6, -2.1, 4.4, 0, 'C', 't'), B(0.8, 1.2, 2.6, 2.1, 4.4, 0, 'C', 't'),
    C(0.1, 0.1, 4.4, -2.1, 5.8, 2.2, 'K', 't', [1.0, 0, 0]), C(0.1, 0.1, 4.4, 2.1, 5.8, 2.2, 'K', 't', [1.0, 0, 0]), C(0.9, 0.9, 0.3, 0, 5.2, 1.9, 'D', 't', [H, 0, 0]),
    B(2.6, 1, 0.3, 0, 0.3, 0, 'D', 's'), B(0.3, 0.9, 0.3, 0, -0.4, 0, 'D', 's')] },
});

// ───────────────────────── Aircraft ─────────────────────────
const wing = (span: number, chord: number, y: number, z: number, c: string): Part[] => [
  B(span, 0.22, chord, 0, y, z, c), B(span * 0.4, 0.26, chord * 1.3, 0, y, z + 0.3, c)];
U({
  id: 'recon', name: 'Leleka-100', names: ['Leleka-100', 'Orlan-10'], desc: 'Unarmed reconnaissance drone with a wide field of view. Spots targets for artillery.', cls: 'air',
  hp: 110, m: 40, e: 1100, work: 260, speed: 52, turn: 1.9, r: 2.8, h: 1.6, alt: 62, sight: 340, ew: 0.3,
  model: { sp: [0, 0, 2.6], sa: 'z', ss: 30, parts: [TZ(0.42, 4.6, 0, 0, 0, 'L'), ...wing(7.6, 1.1, 0.4, 0.3, 'L'), B(2.6, 0.16, 0.8, 0, 0.3, -2.3, 'L'), B(0.16, 1.1, 0.9, 0, 0.8, -2.3, 'L'),
    S(0.36, 0, -0.5, 1, 'K'), B(1.9, 0.1, 0.22, 0, 0, 0, 'K', 's')] },
});
U({
  id: 'tb2', name: 'Bayraktar TB2', names: ['Bayraktar TB2', 'Orion'], desc: 'Armed drone. Loiters over the battlefield firing guided micro-munitions.', cls: 'air',
  hp: 260, m: 110, e: 2800, work: 640, speed: 46, turn: 1.6, r: 3.8, h: 2, alt: 64, sight: 280, ew: 0.1,
  weapons: [{ k: 'missile', range: 165, reload: 3.4, dmg: 150, splash: 9, speed: 240, tg: 1, color: 0xffa060, free: true }],
  model: { sp: [0, 0.1, -3.5], sa: 'z', ss: 28, parts: [TZ(0.6, 6.4, 0, 0, 0, 'L'), K(0.6, 1.6, 0, 0, 4, 'L', undefined, [H, 0, 0]), ...wing(13, 1.3, 0.2, -0.2, 'L'),
    B(0.16, 2.2, 0.9, -1.1, -0.7, -3, 'L', undefined, [0, 0, 0.6]), B(0.16, 2.2, 0.9, 1.1, -0.7, -3, 'L', undefined, [0, 0, -0.6]), S(0.5, 0, -0.6, 2.4, 'K'),
    TZ(0.16, 1.5, -2.6, -0.3, 0, 'D'), TZ(0.16, 1.5, 2.6, -0.3, 0, 'D'), B(2.2, 0.1, 0.26, 0, 0, 0, 'K', 's')] },
});
U({
  id: 'heli', name: 'Mi-24', names: ['Mi-24P', 'Ka-52 Alligator'], desc: 'Attack helicopter. Hovers and rakes ground forces with rockets.', cls: 'air',
  hp: 1050, m: 300, e: 5600, work: 1600, speed: 40, turn: 2.6, r: 5, h: 3, alt: 40, hover: true, sight: 230,
  weapons: [{ k: 'missile', range: 142, reload: 0.5, dmg: 36, splash: 6, speed: 240, tg: 1, color: 0xffa060, free: true }],
  model: {
    sp: [0, 2.5, -0.4], sa: 'y', ss: 26,
    parts: [B(2.4, 2.4, 8, 0, 0, 0, 'T'), K(1.25, 2.8, 0, -0.2, 5.3, 'T', undefined, [H, 0, 0]), S(0.95, 0, 0.7, 3.4, 'P'), S(0.9, 0, 0.3, 4.6, 'P'),
      B(0.8, 0.9, 6.4, 0, 0.5, -6.8, 'C'), B(0.24, 2.6, 1.5, 0, 1.6, -9.6, 'T'), B(0.1, 2.2, 0.3, 0.3, 1.9, -9.6, 'K'),
      B(7.4, 0.3, 1.8, 0, -0.5, 0.2, 'C'), TZ(0.5, 2.6, -3.2, -1.1, 0.5, 'D'), TZ(0.5, 2.6, 3.2, -1.1, 0.5, 'D'), TZ(0.3, 2, -2, -1, 0.6, 'D'), TZ(0.3, 2, 2, -1, 0.6, 'D'),
      TZ(0.55, 2.6, -1, 1.5, -0.6, 'D'), TZ(0.55, 2.6, 1, 1.5, -0.6, 'D'), C(0.3, 0.3, 1.2, 0, 1.9, -0.4, 'M'), B(0.1, 0.5, 1.2, -1.22, 0.2, -2, 'G'), B(0.1, 0.5, 1.2, 1.22, 0.2, -2, 'G'),
      B(14, 0.1, 0.5, 0, 0, 0, 'K', 's'), B(0.5, 0.1, 14, 0, 0, 0, 'K', 's')],
  },
});
const jet = (c: string, twin: boolean): Part[] => [
  TZ(0.9, 9, 0, 0, -0.4, c), K(0.9, 3.4, 0, 0, 5.8, 'L', undefined, [H, 0, 0]), S(0.75, 0, 0.75, 2.6, 'P'),
  B(9.6, 0.24, 3.6, 0, 0, -1.2, c, undefined, [0, 0, 0]), B(5, 0.26, 2.4, 0, 0, 1.4, 'C'), B(4.6, 0.2, 1.6, 0, 0, -5, c),
  ...(twin ? [B(0.2, 2.2, 2, -1.2, 1.1, -4.4, 'C', undefined, [0, 0, 0.2]), B(0.2, 2.2, 2, 1.2, 1.1, -4.4, 'C', undefined, [0, 0, -0.2])] : [B(0.22, 2.6, 2.4, 0, 1.3, -4.4, 'C')]),
  TZ(0.6, 0.5, twin ? -0.6 : 0, 0, -5.1, 'K'), ...(twin ? [TZ(0.6, 0.5, 0.6, 0, -5.1, 'K')] : []),
  B(0.1, 0.5, 1.4, -0.92, 0, -2, 'G'), B(0.1, 0.5, 1.4, 0.92, 0, -2, 'G'),
];
U({
  id: 'fighter', name: 'MiG-29', names: ['MiG-29', 'Su-35S'], desc: 'Air-superiority fighter. Hunts aircraft, helicopters and drones.', cls: 'air',
  hp: 330, m: 110, e: 2900, work: 680, speed: 82, turn: 2.1, r: 4, h: 2, alt: 72, sight: 260,
  weapons: [{ k: 'missile', range: 190, reload: 1.1, dmg: 62, speed: 360, tg: 2, color: SAMC, free: true }],
  model: { parts: [...jet('M', true), TZ(0.14, 2.2, -4.5, 0, -1, 'W'), TZ(0.14, 2.2, 4.5, 0, -1, 'W')] },
});
U({
  id: 'cas', name: 'Su-25', names: ['Su-25', 'Su-34'], desc: 'Strike jet. Drops sticks of bombs on ground targets.', cls: 'air',
  hp: 640, m: 160, e: 4000, work: 900, speed: 58, turn: 1.3, r: 5, h: 2.4, alt: 68, sight: 210, noChase: true,
  weapons: [{ k: 'bomb', range: 78, reload: 6, dmg: 150, splash: 30, burst: 5, gap: 0.12, tg: 1, color: 0x55585a, free: true }],
  model: { parts: [...jet('T', false), B(13, 0.26, 2.6, 0, 0.1, 0.2, 'T'), TZ(0.75, 3.4, -1.5, -0.1, -2.4, 'C'), TZ(0.75, 3.4, 1.5, -0.1, -2.4, 'C'),
    TZ(0.3, 1.8, -3, -0.5, 0.4, 'D'), TZ(0.3, 1.8, 3, -0.5, 0.4, 'D'), TZ(0.3, 1.8, -4.6, -0.5, 0.4, 'D'), TZ(0.3, 1.8, 4.6, -0.5, 0.4, 'D')] },
});

// ───────────────────────── Drones and missiles ─────────────────────────
U({
  id: 'fpv', name: 'FPV Drone', desc: 'First-person-view kamikaze quadcopter with an RPG warhead. Cheap tank killer; vulnerable to jamming.', cls: 'air', req: 't_fpv',
  hp: 34, m: 26, e: 420, work: 150, speed: 50, turn: 4.5, r: 1.5, h: 1, alt: 15, hover: true, sight: 170, ew: 0.9,
  kami: { r: 9, d: 330 },
  weapons: [{ k: 'ram', range: 190, reload: 1, dmg: 330, splash: 9, tg: 1, color: SHELL, free: true }],
  model: { parts: [B(0.7, 0.4, 1.3, 0, 0, 0, 'K'), B(3, 0.12, 0.2, 0, 0.1, 0, 'K', undefined, [0, 0.785, 0]), B(3, 0.12, 0.2, 0, 0.1, 0, 'K', undefined, [0, -0.785, 0]),
    C(0.62, 0.62, 0.05, -1.06, 0.26, 1.06, 'D'), C(0.62, 0.62, 0.05, 1.06, 0.26, 1.06, 'D'), C(0.62, 0.62, 0.05, -1.06, 0.26, -1.06, 'D'), C(0.62, 0.62, 0.05, 1.06, 0.26, -1.06, 'D'),
    TZ(0.17, 1.5, 0, -0.42, 0.3, 'T'), K(0.24, 0.6, 0, -0.42, 1.3, 'T', undefined, [H, 0, 0]), B(0.3, 0.3, 0.3, 0, 0.3, 0.5, 'R')] },
});
U({
  id: 'loiter', name: 'Liutyi', names: ['An-196 Liutyi', 'Geran-2'], desc: 'Long-range one-way attack drone. Slow, loud and cheap; seeks out structures.', cls: 'air', req: 't_loiter',
  hp: 150, m: 95, e: 2400, work: 520, speed: 36, turn: 1.3, r: 3.4, h: 1.6, alt: 46, sight: 200, ew: 0.07,
  kami: { r: 36, d: 760, b: true },
  weapons: [{ k: 'ram', range: 230, reload: 1, dmg: 760, splash: 36, tg: 1, color: SHELL, free: true }],
  model: { sp: [0, 0, -2.5], sa: 'z', ss: 34, parts: [TZ(0.55, 4.6, 0, 0, 0.4, 'D'), K(0.55, 1.5, 0, 0, 3.4, 'D', undefined, [H, 0, 0]),
    B(4.4, 0.2, 3.4, -1.8, 0, -0.8, 'D', undefined, [0, 0.5, 0]), B(4.4, 0.2, 3.4, 1.8, 0, -0.8, 'D', undefined, [0, -0.5, 0]),
    B(0.16, 1.2, 1.2, -3.6, 0, -1.9, 'D'), B(0.16, 1.2, 1.2, 3.6, 0, -1.9, 'D'), B(1.7, 0.1, 0.22, 0, 0, 0, 'K', 's')] },
});
U({
  id: 'ucav', name: 'Kizilelma', names: ['Bayraktar Kizilelma', 'S-70 Okhotnik'], desc: 'Supersonic stealth combat drone. Outruns interceptors and strikes with heavy guided bombs.', cls: 'air', tier: 3, req: 't_ucav',
  hp: 620, m: 520, e: 9500, work: 2400, speed: 132, turn: 1.9, r: 4.6, h: 1.8, alt: 78, sight: 280, ew: 0.02,
  weapons: [{ k: 'missile', range: 210, reload: 2.2, dmg: 330, splash: 20, speed: 420, tg: 3, color: 0xffa060, free: true }],
  model: { parts: [B(7.4, 0.5, 7.4, 0, 0, -1, 'D', undefined, [0, 0.785, 0]), B(3, 0.9, 8, 0, 0.15, 0.6, 'D'), K(1.3, 3.6, 0, 0.1, 6, 'D', undefined, [H, 0, 0]),
    B(1.8, 0.5, 2.6, 0, 0.7, 1.4, 'K'), B(0.2, 1.3, 1.6, -1.5, 0.7, -4.6, 'D', undefined, [0, 0, 0.5]), B(0.2, 1.3, 1.6, 1.5, 0.7, -4.6, 'D', undefined, [0, 0, -0.5]),
    TZ(0.7, 0.5, 0, 0.1, -3.6, 'K'), B(0.9, 0.05, 1.2, -2.4, 0.28, -1.6, 'G'), B(0.9, 0.05, 1.2, 2.4, 0.28, -1.6, 'G')] },
});
U({
  id: 'cruise', name: 'Neptune', names: ['R-360 Neptune', 'Iskander-K'], desc: 'Cruise missile in flight.', cls: 'air', tier: 3,
  hp: 210, m: 0, e: 0, work: 1, speed: 150, turn: 1.5, r: 2.6, h: 1.2, alt: 70, sight: 60,
  kami: { r: 58, d: 1500, b: true },
  model: { parts: [TZ(0.5, 6.4, 0, 0, 0, 'L'), K(0.5, 1.6, 0, 0, 4, 'D', undefined, [H, 0, 0]), B(4.2, 0.12, 1, 0, 0, 0.2, 'L'),
    B(1.8, 0.1, 0.7, 0, 0, -2.9, 'L'), B(0.1, 1.8, 0.7, 0, 0, -2.9, 'L'), TZ(0.42, 0.4, 0, 0, -3.3, 'K')] },
});

// ───────────────────────── Heavy armour ─────────────────────────
U({
  id: 'mbt', name: 'Leopard 2A6', names: ['Leopard 2A6', 'T-90M Proryv'], desc: 'Modern main battle tank. Heavy armour and a stabilised long gun.', cls: 'ground', tier: 2,
  hp: 5200, m: 760, e: 8400, work: 3000, speed: 15.5, turn: 1.6, r: 6, h: 6.4, sight: 210,
  weapons: [{ k: 'cannon', range: 178, reload: 2.2, dmg: 400, splash: 20, speed: 300, spread: 0.014, tg: 1, color: SHELL, turn: 2.2 },
    { k: 'gun', range: 130, reload: 0.2, dmg: 6, tg: 3, color: TR, free: true }],
  model: { tp: [0, 3.9, 0], parts: [...tracks(8, 13.6, 2), B(6.8, 1.7, 13, 0, 2.8, 0, 'T'), B(6.8, 1, 3.6, 0, 3.2, 5.4, 'C', undefined, [0.4, 0, 0]),
    B(1.9, 0.8, 13.2, -4, 2.3, 0, 'C'), B(1.9, 0.8, 13.2, 4, 2.3, 0, 'C'), B(0.1, 0.8, 1.6, -4.98, 2.4, 2, 'G'), B(0.1, 0.8, 1.6, 4.98, 2.4, 2, 'G'),
    B(5.4, 1.9, 6.6, 0, 4.7, -0.6, 'T', 't'), B(2.2, 1.7, 3, -1.9, 4.6, 3.2, 'C', 't', [0, 0.3, 0]), B(2.2, 1.7, 3, 1.9, 4.6, 3.2, 'C', 't', [0, -0.3, 0]),
    BR(0.3, 10, 0, 4.7, 3.2, 'D'), TZ(0.44, 1.6, 0, 4.7, 8.8, 'D', 't'), B(5, 1.2, 1.6, 0, 4.6, -4.6, 'D', 't'),
    C(0.6, 0.6, 0.5, 1.3, 5.9, -0.6, 'D', 't'), BR(0.09, 1.8, 1.3, 6.3, -0.4), B(1, 0.7, 1, -1.5, 6, 0.4, 'D', 't')] },
});
U({
  id: 'hifv', name: 'M2A2 Bradley', names: ['M2A2 Bradley', 'BMPT Terminator'], desc: 'Heavy fire-support vehicle. Autocannon and anti-tank missiles.', cls: 'ground', tier: 2,
  hp: 2800, m: 460, e: 6000, work: 2200, speed: 18, turn: 2.4, r: 5, h: 6.6, sight: 215,
  weapons: [{ k: 'gun', range: 158, reload: 0.22, dmg: 24, tg: 3, color: 0xffc890, turn: 3.2 },
    { k: 'missile', range: 220, min: 30, reload: 5.5, dmg: 260, splash: 8, speed: 190, tg: 1, color: 0xffa060, free: true }],
  model: { tp: [0, 4.2, -0.4], parts: [...tracks(7, 11.6, 1.9), B(6, 2, 11.2, 0, 3, 0, 'T'), B(6, 1.2, 3.4, 0, 3.3, 4.4, 'C', undefined, [0.45, 0, 0]),
    B(1.8, 1, 11.4, -3.5, 2.5, 0, 'C'), B(1.8, 1, 11.4, 3.5, 2.5, 0, 'C'), B(0.1, 0.8, 1.6, -4.42, 2.6, 0, 'G'), B(0.1, 0.8, 1.6, 4.42, 2.6, 0, 'G'),
    B(3.6, 1.7, 4.2, 0, 5, -0.4, 'T', 't'), BR(0.15, 5.4, 0.3, 5.1, 1.6), B(0.9, 1.3, 2.4, -2.3, 5.3, -0.2, 'C', 't'), B(0.7, 0.9, 0.2, -2.3, 5.3, 1.05, 'K', 't'),
    B(1, 0.7, 1, 1, 6.2, -1, 'D', 't')] },
});
U({
  id: 'mlrs', wheel: true, name: 'M142 HIMARS', names: ['M142 HIMARS', 'BM-27 Uragan'], desc: 'Rocket artillery. Saturates an area from far beyond the front line.', cls: 'ground', tier: 2,
  hp: 1100, m: 700, e: 10000, work: 3000, speed: 19, turn: 1.7, r: 5.2, h: 7.6, sight: 190,
  weapons: [{ k: 'missile', range: 450, min: 110, reload: 9, dmg: 150, splash: 30, burst: 6, gap: 0.2, speed: 200, tg: 1, color: 0xffa060, free: true }],
  model: { tp: [0, 4.2, -2.2], parts: [...wheels(2.3, [-4.2, -1.6, 4], 1.25, 1), B(4.4, 1.2, 12.6, 0, 2.6, 0, 'D'), B(4.6, 2.6, 3.4, 0, 4.2, 4.4, 'T'), B(4.4, 1, 0.2, 0, 4.8, 6.15, 'P'),
    B(0.1, 0.8, 1.4, -2.32, 3.6, 4.4, 'G'), B(0.1, 0.8, 1.4, 2.32, 3.6, 4.4, 'G'),
    B(4.2, 2.6, 6.8, 0, 6, -2.2, 'T', 't', [-0.5, 0, 0]),
    B(1.1, 1, 0.2, -1.3, 8.2, 0.4, 'K', 't', [-0.5, 0, 0]), B(1.1, 1, 0.2, 0, 8.2, 0.4, 'K', 't', [-0.5, 0, 0]), B(1.1, 1, 0.2, 1.3, 8.2, 0.4, 'K', 't', [-0.5, 0, 0]),
    B(1.1, 1, 0.2, -1.3, 7.1, 1, 'K', 't', [-0.5, 0, 0]), B(1.1, 1, 0.2, 0, 7.1, 1, 'K', 't', [-0.5, 0, 0]), B(1.1, 1, 0.2, 1.3, 7.1, 1, 'K', 't', [-0.5, 0, 0]),
    B(1.6, 1.4, 1.6, 0, 4, -2.2, 'D', 't')] },
});

// ───────────────────────── Faction-exclusive advanced weapons ─────────────────────────
// Ukraine fields precise, mobile Western systems and improvised interceptors; Russia fields mass, thermobarics and hypersonics.
U({
  id: 'caesar', name: 'CAESAR', desc: 'Truck-mounted 155 mm howitzer. Very long range, accurate, fast on roads — and thin-skinned.', cls: 'ground', fac: 0, tier: 2, req: 't_west', wheel: true,
  hp: 520, m: 330, e: 4200, work: 1300, speed: 27, turn: 2, r: 4.8, h: 6.6, sight: 190,
  weapons: [{ k: 'cannon', range: 440, min: 100, reload: 3, dmg: 240, splash: 30, speed: 210, arc: 0.34, spread: 0.02, tg: 1, color: SHELL, turn: 1.8 }],
  model: { tp: [0, 3.6, -3], parts: [...wheels(2.2, [-4.4, -1.8, 4.2], 1.2, 1), B(4.2, 1.1, 12.4, 0, 2.5, 0, 'D'), B(4.4, 2.6, 3.4, 0, 4.1, 4.4, 'T'), B(4.2, 1, 0.2, 0, 4.7, 6.15, 'P'),
    B(0.1, 0.8, 1.4, -2.22, 3.6, 4.4, 'G'), B(0.1, 0.8, 1.4, 2.22, 3.6, 4.4, 'G'), B(3.4, 1.6, 3.6, 0, 3.9, -3, 'T', 't'), C(0.26, 0.32, 10.4, 0, 6.6, 1.4, 'D', 't', [1.15, 0, 0]), C(0.44, 0.44, 1, 0, 8.7, 6, 'D', 't', [1.15, 0, 0]),
    B(0.6, 0.5, 4, -1.9, 1.6, -5.4, 'D', 't', [0.3, 0.3, 0]), B(0.6, 0.5, 4, 1.9, 1.6, -5.4, 'D', 't', [0.3, -0.3, 0])] },
});
U({
  id: 'f16', name: 'F-16AM', desc: 'Multirole fighter. Shoots down aircraft and missiles and drops guided bombs on ground targets.', cls: 'air', fac: 0, tier: 2, req: 't_west',
  hp: 460, m: 330, e: 6800, work: 1700, speed: 90, turn: 2.2, r: 4.2, h: 2, alt: 74, sight: 280,
  weapons: [{ k: 'missile', range: 215, reload: 1.1, dmg: 84, speed: 400, tg: 2, color: SAMC, free: true },
    { k: 'missile', range: 175, reload: 5, dmg: 320, splash: 22, speed: 260, tg: 1, color: 0xffa060, free: true }],
  model: { parts: [...jet('L', false), B(3, 0.2, 5, 0, 0.05, 1.2, 'L'), TZ(0.14, 2.4, -4.6, 0, -1, 'W'), TZ(0.14, 2.4, 4.6, 0, -1, 'W'), TZ(0.34, 2.4, -2.4, -0.45, -0.4, 'D'), TZ(0.34, 2.4, 2.4, -0.45, -0.4, 'D'), TZ(0.5, 3.4, 0, -0.75, -0.4, 'M')] },
});
U({
  id: 'sting', name: 'Sting Interceptor', desc: 'Cheap interceptor drone that rams enemy drones, helicopters and cruise missiles out of the sky.', cls: 'air', fac: 0, req: 't_ew',
  hp: 40, m: 30, e: 500, work: 170, speed: 96, turn: 4.2, r: 1.4, h: 1, alt: 30, hover: true, sight: 240, ew: 0.3,
  kami: { r: 10, d: 230 },
  weapons: [{ k: 'ram', range: 300, reload: 1, dmg: 230, splash: 10, tg: 2, color: SHELL, free: true }],
  model: { parts: [C(0.3, 0.42, 1.6, 0, 0.4, 0, 'L'), S(0.3, 0, 1.2, 0, 'K'), B(2.4, 0.1, 0.18, 0, 0, 0, 'K', undefined, [0, 0.785, 0]), B(2.4, 0.1, 0.18, 0, 0, 0, 'K', undefined, [0, -0.785, 0]),
    C(0.5, 0.5, 0.05, -0.85, 0.16, 0.85, 'D'), C(0.5, 0.5, 0.05, 0.85, 0.16, 0.85, 'D'), C(0.5, 0.5, 0.05, -0.85, 0.16, -0.85, 'D'), C(0.5, 0.5, 0.05, 0.85, 0.16, -0.85, 'D')] },
});
U({
  id: 'tos', name: 'TOS-1A Solntsepyok', desc: 'Thermobaric rocket launcher on a tank hull. Short range; turns a whole block into fire.', cls: 'ground', fac: 1, tier: 2, req: 't_heavy',
  hp: 2400, m: 620, e: 8600, work: 2600, speed: 15, turn: 1.7, r: 5.2, h: 7.4, sight: 200,
  weapons: [{ k: 'missile', range: 215, min: 60, reload: 11, dmg: 150, splash: 36, burst: 8, gap: 0.16, speed: 190, tg: 1, color: 0xff8040, free: true }],
  model: { tp: [0, 3.6, -0.4], parts: [...tracks(6.8, 11.4, 1.7), B(5.8, 1.5, 11, 0, 2.4, 0, 'T'), B(5.8, 0.9, 3.2, 0, 2.8, 4.4, 'C', undefined, [0.42, 0, 0]),
    B(0.1, 0.8, 1.5, -2.92, 2.5, 1, 'G'), B(0.1, 0.8, 1.5, 2.92, 2.5, 1, 'G'), C(1.8, 2.2, 0.9, 0, 3.7, -0.4, 'D', 't'),
    B(5, 3, 6.4, 0, 6, -0.6, 'T', 't', [-0.32, 0, 0]),
    ...[-1.8, -0.6, 0.6, 1.8].flatMap(x => [B(1, 0.9, 0.2, x, 7.9, 2.2, 'K', 't', [-0.32, 0, 0]), B(1, 0.9, 0.2, x, 6.8, 2.56, 'K', 't', [-0.32, 0, 0]), B(1, 0.9, 0.2, x, 5.7, 2.92, 'K', 't', [-0.32, 0, 0])])] },
});
U({
  id: 'lancet', name: 'Lancet-3', desc: 'Loitering munition that hunts vehicles and guns. Fast, precise, hard to jam.', cls: 'air', fac: 1, req: 't_loiter',
  hp: 60, m: 70, e: 1500, work: 330, speed: 64, turn: 2.4, r: 2.2, h: 1.2, alt: 40, sight: 260, ew: 0.05,
  kami: { r: 11, d: 560, v: true },
  weapons: [{ k: 'ram', range: 260, reload: 1, dmg: 560, splash: 11, tg: 1, color: SHELL, free: true }],
  model: { sp: [0, 0, -2], sa: 'z', ss: 34, parts: [TZ(0.3, 3.6, 0, 0, 0, 'L'), K(0.3, 0.9, 0, 0, 2.2, 'K', undefined, [H, 0, 0]),
    B(2.6, 0.08, 0.5, 0, 0, 0.9, 'L', undefined, [0, 0, 0.785]), B(2.6, 0.08, 0.5, 0, 0, 0.9, 'L', undefined, [0, 0, -0.785]),
    B(1.6, 0.08, 0.4, 0, 0, -1.2, 'L', undefined, [0, 0, 0.785]), B(1.6, 0.08, 0.4, 0, 0, -1.2, 'L', undefined, [0, 0, -0.785]), B(1.2, 0.08, 0.16, 0, 0, 0, 'K', 's')] },
});
U({
  id: 'hyper', name: 'Kinzhal', names: ['Kinzhal', 'Kh-47M2 Kinzhal'], desc: 'Hypersonic missile in flight. Only the best air defence has a chance against it.', cls: 'air', tier: 3, fac: 1,
  hp: 900, m: 0, e: 0, work: 1, speed: 380, turn: 1.6, r: 2.8, h: 1.2, alt: 150, sight: 60,
  kami: { r: 62, d: 2100, b: true },
  model: { parts: [TZ(0.6, 7.4, 0, 0, 0, 'M'), K(0.6, 2.6, 0, 0, 5, 'D', undefined, [H, 0, 0]), B(2.4, 0.12, 1.4, 0, 0, -3, 'M'), B(0.12, 2.4, 1.4, 0, 0, -3, 'M'), TZ(0.5, 0.4, 0, 0, -3.9, 'K')] },
});

// ───────────────────────── Technology ladder ─────────────────────────
export const TECHS: Record<string, TechDef> = {};
export const TECH_LIST: TechDef[] = [];
const T = (id: string, name: string, desc: string, m: number, e: number, work: number, req: string[] = [], at: 'lab' | 'pad' = 'lab', sat = 0) => {
  const t: TechDef = { id, name, desc, m, e, work, req, at, sat }; TECHS[id] = t; TECH_LIST.push(t); return t;
};
T('t_fpv', 'FPV Drone Warfare', 'Unlocks the Drone Workshop and FPV kamikaze drones.', 350, 4000, 1400);
T('t_rail', 'Rail Logistics', 'Unlocks Rail Terminals (4× supplies) and the Thermal Power Plant.', 500, 5000, 1800);
T('t_armor', 'Modern Armour', 'Unlocks the Armour Depot: modern tanks, heavy IFVs and rocket artillery.', 600, 6000, 2200);
T('t_bridge', 'Military Bridging', 'Engineers can lay a pontoon bridge where a bridge has been destroyed, reopening the crossing to vehicles.', 400, 4000, 1500);
T('t_iads', 'Integrated Air Defence', 'Unlocks long-range SAM batteries that intercept aircraft, drones and missiles.', 800, 9000, 2800);
T('t_ew', 'Electronic Warfare', 'Unlocks EW Stations that jam enemy drones out of the sky.', 500, 7000, 2200, ['t_fpv']);
T('t_loiter', 'Long-Range Strike Drones', 'Unlocks one-way attack drones that hunt structures deep behind the front.', 700, 9000, 2800, ['t_fpv']);
T('t_strike', 'Precision Strike', 'Unlocks cruise-missile launchers with map-wide reach.', 1500, 18000, 4500, ['t_armor']);
T('t_ucav', 'Supersonic Combat Drones', 'Unlocks jet-powered supersonic UCAVs.', 2200, 26000, 6000, ['t_loiter', 't_iads']);
T('t_space', 'Space Programme', 'Unlocks the Launch Complex for orbital launches.', 3000, 34000, 7500, ['t_strike', 't_ucav']);
T('t_west', 'Western Arms Packages', 'Ukraine only. Unlocks the CAESAR truck howitzer and the F-16 multirole fighter.', 1200, 14000, 3600, ['t_armor']).fac = 0;
T('t_heavy', 'Thermobaric & Hypersonic Arms', 'Russia only. Unlocks the TOS-1A thermobaric launcher and arms cruise-missile batteries with Kinzhal hypersonic missiles.', 1200, 14000, 3600, ['t_armor']).fac = 1;
T('sat_recon', 'Launch Recon Satellite', 'Orbital imaging: the whole map is revealed on radar and every enemy structure is spotted.', 2500, 30000, 6500, [], 'pad', 1);
T('sat_gps', 'Launch Guidance Satellite', 'Satellite navigation: artillery and rocket dispersion is cut by 60%.', 3000, 36000, 7500, ['sat_recon'], 'pad', 2);

export const TEAM_COLORS = [0x2f7de0, 0xd8342a, 0x9a9a92];
export const TEAM_NAMES = ['Ukraine', 'Russia'];
export const LEADERS = ['Zelensky', 'Putin'];
/** the calendar: one year passes in YEAR_SECS of play, so a long war runs through every season */
export const YEAR_SECS = 1920;
/** stylised day / night cycle length in seconds */
export const DAY_SECS = 320;
/** start dates offered in the menu: [label, month (0-11), day, year] */
export const START_DATES: [string, number, number, number][] = [['24 Feb 2022', 1, 24, 2022], ['Summer 2023', 5, 10, 2023], ['Winter 2023', 11, 16, 2023]];
