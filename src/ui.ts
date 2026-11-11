// HUD, input handling, minimap and 2D overlay.
import { DEFS, LEADERS, nm, TEAM_COLORS, TECH_LIST, TECHS, TechDef, UnitDef } from './defs';
import { CELL } from './map';
import { Game, SUPPLY_R, Team, Unit, Wreck, TICK } from './sim';
import { Renderer } from './render';
import { Audio } from './audio';
import { clamp, fmtTime } from './util';

type Mode = null | 'fight' | 'patrol' | 'guard' | 'repair' | 'reclaim' | 'move';
const $ = (id: string) => document.getElementById(id)!;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export interface UICallbacks { pause(): void; speed(d: number): void }

export class UI {
  game: Game; r: Renderer; me: Team; audio: Audio; icons: Record<string, string>; cb: UICallbacks;
  selected = new Set<Unit>();
  mode: Mode = null; placing: UnitDef | null = null;
  private groups: Unit[][] = [];
  private keys = new Set<string>();
  private mx = 0; private my = 0; private inside = false;
  private drag: { x: number; y: number; on: boolean } | null = null;
  private placeStart: { cx: number; cz: number } | null = null;
  private pan: { x: number; y: number; rot: boolean } | null = null;
  private lastClick = { t: 0, u: null as Unit | null };
  private lastGroupTap = { t: 0, n: -1 };
  private ov: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private mm: HTMLCanvasElement; private mctx: CanvasRenderingContext2D; private mmBase: HTMLCanvasElement; private mmFog: HTMLCanvasElement; private mmFogImg: ImageData;
  private hudT = 0; private mmT = 0; private panelKey = '';
  private pings: { x: number; z: number; t: number; c: string }[] = [];
  private lastAlert = -999;
  private tmp = { x: 0, y: 0, ok: false };
  private disposers: (() => void)[] = [];
  private idleIdx = 0; private heat = 0; private lastCiv = -999; private showSupply = false;

  constructor(game: Game, r: Renderer, me: Team, audio: Audio, icons: Record<string, string>, cb: UICallbacks) {
    this.game = game; this.r = r; this.me = me; this.audio = audio; this.icons = icons; this.cb = cb;
    this.ov = $('overlay') as HTMLCanvasElement; this.ctx = this.ov.getContext('2d')!;
    this.mm = $('minimap') as HTMLCanvasElement; this.mctx = this.mm.getContext('2d')!;
    const n = game.map.n;
    this.mmBase = document.createElement('canvas'); this.mmBase.width = this.mmBase.height = n;
    this.mmFog = document.createElement('canvas'); this.mmFog.width = this.mmFog.height = n;
    this.mmFogImg = this.mmFog.getContext('2d')!.createImageData(n, n);
    this.drawMinimapBase();
    this.bind();
    r.onEvent = (e, vis) => this.onEvent(e, vis);
    this.resize();
  }
  dispose() { for (const d of this.disposers) d(); this.r.onEvent = null; $('info').innerHTML = ''; $('buildgrid').innerHTML = ''; $('orders').innerHTML = ''; $('toasts').innerHTML = ''; }
  resize() { this.ov.width = window.innerWidth; this.ov.height = window.innerHeight; }

  private on<K extends keyof WindowEventMap>(t: EventTarget, ev: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    t.addEventListener(ev, fn as EventListener, opts); this.disposers.push(() => t.removeEventListener(ev, fn as EventListener, opts));
  }

  toast(msg: string, cls = '') {
    const el = document.createElement('div'); el.className = 'toast ' + cls; el.textContent = msg;
    const box = $('toasts'); box.appendChild(el); while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.remove(), 4000);
  }

  private onEvent(e: any, vis: boolean) {
    const c = this.r.cam, a = this.audio;
    const v = vis ? clamp(1.25 - Math.hypot(e.x - c.x, e.z - c.z) / (c.dist * 1.4 + 150), 0, 1) * clamp(600 / c.dist, 0.25, 1) : 0;
    // battle heat drives the score: what you can see counts, your own losses count double
    const own = e.u && e.u.team === this.me;
    if (vis || own) this.heat += (e.t === 'beam' ? 0.12 : e.t === 'muzzle' ? 0.22 : e.t === 'boom' ? 0.25 : e.t === 'die' ? (own ? 2.2 : 1.2) : e.t === 'alert' && own ? (e.u.def.commander ? 6 : 1.5) : 0);
    const me = this.me, fac = me.fac;
    switch (e.t) {
      case 'beam': a.gun(v, e.size > 11); break;
      case 'muzzle': if (e.k === 'cannon') a.cannon(v, e.size > 1.5); else if (e.k === 'launch') { a.boom(Math.max(v, 0.25), 26); } else if (e.k === 'thump') a.thump(v); else a.missile(v); break;
      case 'boom': a.boom(v * 0.8, e.size); break;
      case 'die':
        if (!e.u.def.inf) a.boom(v, e.size * 2);
        if (e.u.team === me && e.u.def.cls === 'building' && e.u.built) this.toast(nm(e.u.def, fac) + ' destroyed', 'bad');
        break;
      case 'built': if (e.u.team === me && (e.u.def.cls === 'building' || e.u.def.tier > 1)) { a.ui('done'); if (e.u.def.tier > 1 || e.u.def.factory || e.u.def.lab) this.toast(nm(e.u.def, fac) + ' complete', 'good'); } break;
      case 'collapse': if (e.k === 'bridge') { a.boom(Math.max(v, 0.3), 40); this.toast(this.game.map.bridges[e.n].name + ' is down — vehicles cannot cross there', 'bad'); this.drawMinimapBase(); break; }
        if (e.k === 'part') { a.boom(v, 16); break; } a.boom(Math.max(v, 0.12), 34); if (v > 0.2 || e.civ.kind >= 4) this.toast(e.civ.name + ' destroyed', 'bad'); break;
      case 'tech':
        if (e.team === me) { a.ui('done'); this.toast((e.tech.sat ? 'In orbit: ' : 'Research complete: ') + e.tech.name.replace('Launch ', ''), 'good'); this.panelKey = ''; }
        else if (e.tech.sat) { a.ui('alert'); this.toast('Enemy satellite in orbit — ' + (e.tech.sat === 1 ? 'your positions are exposed' : 'their artillery is now guided'), 'bad'); }
        break;
      case 'launch': a.boom(Math.max(v, 0.35), 40); break;
      case 'civ':
        if (this.game.tick - this.lastCiv > 12 * TICK) {
          this.lastCiv = this.game.tick;
          if (e.team === me) this.toast('Your fire is killing civilians — backers are pulling support', 'bad');
          else if (fac === 0) this.toast('Civilians are dying under enemy fire', 'bad');
        }
        break;
      case 'season': {
        const tips: Record<string, string> = {
          'Winter': 'Winter. Troops beyond reach of a base freeze; armour bogs down in deep snow.',
          'Spring thaw': 'The thaw. Mud swallows anything that leaves the roads — wheels worst of all.',
          'Spring': 'The ground is drying out.', 'Summer': 'Summer. Dry ground, long reach — and fires spread fast.',
          'Autumn': 'Autumn.', 'Autumn mud': 'Autumn rains. The mud is back; keep to the roads.',
        };
        this.toast(tips[e.k] || e.k, e.k === 'Winter' || e.k.includes('mud') || e.k.includes('thaw') ? 'bad' : ''); a.ui('alert');
        break;
      }
      case 'alert':
        if (e.u.team === this.me && this.game.tick - this.lastAlert > 8 * TICK) {
          const p = this.tmp; this.r.project(e.x, e.y, e.z, p);
          const off = !p.ok || p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight;
          if (off) { this.lastAlert = this.game.tick; a.ui('alert'); this.toast((e.u.def.commander ? LEADERS[fac].toUpperCase() + '’S COMMAND POST' : e.u.def.cls === 'building' ? 'Base' : 'Units') + ' under attack!', 'bad'); }
          this.pings.push({ x: e.x, z: e.z, t: 2.5, c: '#ff4030' });
        }
        break;
    }
  }

  // ───────────── picking ─────────────
  private unitAt(sx: number, sy: number, filter?: (u: Unit) => boolean): Unit | null {
    const p = this.tmp, cam = this.r.camera, f = innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360));
    let best: Unit | null = null, bd = 1e9;
    for (const u of this.game.units) {
      if (u.dead || !this.r.shown(u) || (filter && !filter(u))) continue;
      this.r.project(u.x, u.y + u.def.h * 0.4, u.z, p); if (!p.ok) continue;
      const dist = cam.position.distanceTo({ x: u.x, y: u.y, z: u.z } as any);
      const rad = Math.max(11, u.def.r * f / dist * 1.1), d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rad && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  private wreckAt(sx: number, sy: number): Wreck | null {
    const p = this.tmp; let best: Wreck | null = null, bd = 22;
    for (const w of this.game.wrecks) {
      if (!(this.me.vis[this.game.map.cellOf(w.x, w.z)] & 1)) continue;
      this.r.project(w.x, w.y + 1, w.z, p); if (!p.ok) continue;
      const d = Math.hypot(p.x - sx, p.y - sy); if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  private mine(): Unit[] { const a: Unit[] = []; for (const u of this.selected) if (u.team === this.me && !u.dead) a.push(u); return a; }

  private select(us: Unit[], add: boolean) {
    if (!add) this.selected.clear();
    for (const u of us) this.selected.add(u);
    this.placing = null; this.mode = null; this.panelKey = '';
  }

  // ───────────── input ─────────────
  private bind() {
    const cv = $('gl');
    this.on(cv, 'contextmenu', e => e.preventDefault());
    this.on($('minimap'), 'contextmenu', e => e.preventDefault());
    this.on(window, 'mousemove', (e: MouseEvent) => {
      this.mx = e.clientX; this.my = e.clientY; this.inside = true;
      if (this.pan) {
        const c = this.r.cam, dx = e.clientX - this.pan.x, dy = e.clientY - this.pan.y;
        if (this.pan.rot) { c.yaw -= dx * 0.006; c.pitch += dy * 0.004; }
        else {
          const k = c.dist * 0.0021, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
          c.x -= (dx * cs + dy * sn) * k; c.z -= (-dx * sn + dy * cs) * k;
        }
        this.pan.x = e.clientX; this.pan.y = e.clientY;
      }
      if (this.drag && !this.drag.on && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.on = true;
    });
    this.on(document, 'mouseleave', () => { this.inside = false; });
    this.on(cv, 'mousedown', (e: MouseEvent) => {
      this.audio.init();
      if (e.button === 1) { this.pan = { x: e.clientX, y: e.clientY, rot: e.altKey || e.ctrlKey }; e.preventDefault(); return; }
      if (e.button === 0) {
        if (this.placing) { const c = this.placeCell(e.clientX, e.clientY); if (c) this.placeStart = c; return; }
        if (this.mode) { this.modeClick(e); return; }
        this.drag = { x: e.clientX, y: e.clientY, on: false };
      } else if (e.button === 2) {
        if (this.placing || this.mode) { this.placing = null; this.mode = null; this.panelKey = ''; return; }
        this.rightClick(e.clientX, e.clientY, e.shiftKey);
      }
    });
    this.on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 1) { this.pan = null; return; }
      if (e.button !== 0) return;
      if (this.placing && this.placeStart) { this.commitPlace(e); this.placeStart = null; return; }
      const d = this.drag; this.drag = null; if (!d) return;
      if (d.on) {
        const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
        const p = this.tmp, mob: Unit[] = [], bld: Unit[] = [];
        for (const u of this.game.units) {
          if (u.team !== this.me || u.dead || u.inFactory) continue;
          this.r.project(u.x, u.y + u.def.h * 0.3, u.z, p);
          if (p.ok && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) (u.def.cls === 'building' ? bld : mob).push(u);
        }
        const combat = mob.filter(u => !u.def.bp || u.def.commander);
        this.select(mob.length ? (combat.length && combat.length < mob.length && !e.ctrlKey ? mob : mob) : bld, e.shiftKey);
      } else {
        const u = this.unitAt(e.clientX, e.clientY);
        const now = performance.now();
        if (u && u.team === this.me && this.lastClick.u && this.lastClick.u.def === u.def && now - this.lastClick.t < 350) {
          const p = this.tmp, all: Unit[] = [];
          for (const o of this.game.units) if (o.team === this.me && o.def === u.def && !o.dead) { this.r.project(o.x, o.y, o.z, p); if (p.ok && p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight) all.push(o); }
          this.select(all, e.shiftKey);
        } else if (u) {
          if (e.shiftKey && this.selected.has(u)) { this.selected.delete(u); this.panelKey = ''; } else this.select([u], e.shiftKey && u.team === this.me);
        } else if (!e.shiftKey) this.select([], false);
        this.lastClick = { t: now, u };
      }
    });
    this.on(cv, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      const c = this.r.cam, before = this.r.pick(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0012);
      const nd = clamp(c.dist * k, 50, 1500);
      if (before && e.deltaY < 0) { const f = 1 - nd / c.dist; c.x += (before.x - c.x) * f; c.z += (before.z - c.z) * f; }
      c.dist = nd;
    }, { passive: false });
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.add(k);
      if (e.repeat) return;
      if (k >= '0' && k <= '9') {
        const n = +k;
        if (e.ctrlKey || e.metaKey) { this.groups[n] = this.mine(); e.preventDefault(); this.toast('Group ' + n + ' set'); }
        else if (this.groups[n]) {
          const us = this.groups[n] = this.groups[n].filter(u => !u.dead);
          this.select(us, e.shiftKey);
          const now = performance.now();
          if (us.length && this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400) { let x = 0, z = 0; for (const u of us) { x += u.x; z += u.z; } this.r.cam.x = x / us.length; this.r.cam.z = z / us.length; }
          this.lastGroupTap = { t: now, n };
        }
        return;
      }
      switch (k) {
        case 'a': this.setMode('fight'); break;
        case 'p': this.setMode('patrol'); break;
        case 'g': this.setMode('guard'); break;
        case 'r': this.setMode('repair'); break;
        case 'e': this.setMode('reclaim'); break;
        case 'm': this.setMode('move'); break;
        case 'v': this.showSupply = !this.showSupply; this.toast('Supply range overlay ' + (this.showSupply ? 'on' : 'off')); break;
        case 's': for (const u of this.mine()) { this.game.clearOrders(u); if (u.def.factory) u.queue.length = 0; } this.audio.ui('click'); break;
        case 'h': { const p = this.me.prime; if (p) { this.select([p], false); this.r.cam.x = p.x; this.r.cam.z = p.z; } break; }
        case 'Tab': {
          e.preventDefault();
          const idle = this.game.units.filter(u => u.team === this.me && u.built && u.def.bp && !u.def.factory && !u.orders.length);
          if (idle.length) { const u = idle[this.idleIdx++ % idle.length]; this.select([u], false); this.r.cam.x = u.x; this.r.cam.z = u.z; } else this.toast('No idle builders');
          break;
        }
        case 'Delete': for (const u of this.mine()) if (!u.def.commander) this.game.kill(u, null); this.selected.clear(); this.panelKey = ''; break;
        case 'Escape':
          if (this.placing || this.mode) { this.placing = null; this.mode = null; this.panelKey = ''; } else this.cb.pause();
          break;
        case ' ': e.preventDefault(); this.cb.pause(); break;
        case '+': case '=': this.cb.speed(1); break;
        case '-': case '_': this.cb.speed(-1); break;
      }
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
    this.on(window, 'blur', () => { this.keys.clear(); this.pan = null; this.drag = null; });
    // minimap
    const mmv = (e: MouseEvent) => {
      const b = this.mm.getBoundingClientRect(), S = this.game.map.size;
      return { x: clamp((e.clientX - b.left) / b.width, 0, 1) * S, z: clamp((e.clientY - b.top) / b.height, 0, 1) * S };
    };
    let mmDown = false;
    this.on(this.mm, 'mousedown', (e: MouseEvent) => {
      const p = mmv(e);
      if (e.button === 0) {
        if (this.mode && this.mode !== 'guard' && this.mode !== 'repair' && this.mode !== 'reclaim') { this.game.moveGroup(this.mine(), p.x, p.z, this.mode as any, e.shiftKey); this.mode = null; this.panelKey = ''; }
        else { mmDown = true; this.r.cam.x = p.x; this.r.cam.z = p.z; }
      } else if (e.button === 2) this.groundOrder(p.x, p.z, e.shiftKey);
    });
    this.on(window, 'mousemove', (e: MouseEvent) => { if (mmDown) { const p = mmv(e); this.r.cam.x = p.x; this.r.cam.z = p.z; } });
    this.on(window, 'mouseup', () => { mmDown = false; });
    this.on($('btnPause'), 'click', () => this.cb.pause());
    this.on($('spdUp'), 'click', () => this.cb.speed(1));
    this.on($('spdDown'), 'click', () => this.cb.speed(-1));
  }

  private setMode(m: Mode) {
    if (!this.mine().length) return;
    this.placing = null; this.mode = this.mode === m ? null : m; this.panelKey = ''; this.audio.ui('click');
  }

  private groundOrder(x: number, z: number, shift: boolean) {
    const us = this.mine(); if (!us.length) return;
    let any = false;
    for (const u of us) if (u.def.factory) { u.rally = { x, z }; any = true; }
    const mob = us.filter(u => u.def.cls !== 'building');
    if (mob.length) { this.game.moveGroup(mob, x, z, 'move', shift); any = true; }
    if (any) { this.audio.ui('order'); this.pings.push({ x, z, t: 0.6, c: '#60ff90' }); }
  }

  private rightClick(sx: number, sy: number, shift: boolean) {
    const us = this.mine(); if (!us.length) return;
    const g = this.game, hit = this.unitAt(sx, sy);
    if (hit && hit.team.ally !== this.me.ally) {
      for (const u of us) if (u.def.weapons.length) g.give(u, { type: 'attack', target: hit, x: hit.x, z: hit.z }, shift);
      this.audio.ui('order'); this.pings.push({ x: hit.x, z: hit.z, t: 0.6, c: '#ff5040' }); return;
    }
    if (hit && hit.team === this.me) {
      for (const u of us) {
        if (u === hit || u.def.cls === 'building') continue;
        if (u.def.bp && (!hit.built || hit.hp < hit.def.hp) && !hit.inFactory) g.give(u, { type: 'repair', target: hit, x: hit.x, z: hit.z }, shift);
        else g.give(u, { type: 'guard', target: hit, x: hit.x, z: hit.z }, shift);
      }
      this.audio.ui('order'); this.pings.push({ x: hit.x, z: hit.z, t: 0.6, c: '#ffe060' }); return;
    }
    const w = this.wreckAt(sx, sy);
    if (w && us.some(u => u.def.bp && !u.def.factory)) {
      for (const u of us) if (u.def.bp && !u.def.factory) g.give(u, { type: 'reclaim', wreck: w, x: w.x, z: w.z }, shift);
      this.audio.ui('order'); this.pings.push({ x: w.x, z: w.z, t: 0.6, c: '#c0d0e0' }); return;
    }
    const p = this.r.pick(sx, sy); if (p) this.groundOrder(p.x, p.z, shift);
  }

  private modeClick(e: MouseEvent) {
    const us = this.mine(), g = this.game, m = this.mode, shift = e.shiftKey;
    const p = this.r.pick(e.clientX, e.clientY);
    if (m === 'fight' || m === 'patrol' || m === 'move') {
      const hit = m === 'fight' ? this.unitAt(e.clientX, e.clientY, u => u.team.ally !== this.me.ally) : null;
      if (hit) for (const u of us) { if (u.def.weapons.length) g.give(u, { type: 'attack', target: hit, x: hit.x, z: hit.z }, shift); }
      else if (p) g.moveGroup(us, p.x, p.z, m, shift);
      if (p) this.pings.push({ x: p.x, z: p.z, t: 0.6, c: m === 'move' ? '#60ff90' : '#ff9040' });
    } else if (m === 'guard' || m === 'repair') {
      const hit = this.unitAt(e.clientX, e.clientY, u => u.team.ally === this.me.ally);
      if (hit) for (const u of us) if (u !== hit && u.def.cls !== 'building') {
        if (m === 'repair' && u.def.bp) g.give(u, { type: 'repair', target: hit, x: hit.x, z: hit.z }, shift);
        else if (m === 'guard') g.give(u, { type: 'guard', target: hit, x: hit.x, z: hit.z }, shift);
      }
    } else if (m === 'reclaim' && p) {
      // reclaim everything within a radius of the click
      const ws = g.wrecks.filter(w => Math.hypot(w.x - p.x, w.z - p.z) < 70).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const bs = us.filter(u => u.def.bp && !u.def.factory);
      bs.forEach((u, bi) => ws.forEach((w, i) => g.give(u, { type: 'reclaim', wreck: ws[(i + bi) % ws.length], x: w.x, z: w.z }, shift || i > 0)));
      if (!ws.length) this.toast('No wreckage there');
    }
    this.audio.ui('order');
    if (!shift) { this.mode = null; this.panelKey = ''; }
  }

  /** placeable, and not on top of something already queued */
  private free(def: UnitDef, cx: number, cz: number): boolean {
    if (!this.game.canPlace(def, cx, cz, this.me)) return false;
    const w = def.cls === 'building' ? def.fw : 3, h = def.cls === 'building' ? def.fh : 3;
    if (def.reuse) { for (const u of this.game.units) if (u.team === this.me) for (const o of u.orders) if (o.type === 'build' && !o.target && o.def && o.def.reuse && o.cx === cx && o.cz === cz && o.def !== def) return false; return true; }
    for (const u of this.game.units) {
      if (u.team !== this.me || !u.def.bp) continue;
      for (const o of u.orders) {
        if (o.type !== 'build' || o.target || !o.def) continue;
        if (o.def === def && o.cx === cx && o.cz === cz) continue; // same plan: other builders may join it
        if (o.def.reuse) continue;
        const ow = o.def.cls === 'building' ? o.def.fw : 3, oh = o.def.cls === 'building' ? o.def.fh : 3;
        if (cx < o.cx! + ow && cx + w > o.cx! && cz < o.cz! + oh && cz + h > o.cz!) return false;
      }
    }
    return true;
  }
  private placeCell(sx: number, sy: number): { cx: number; cz: number; ok: boolean } | null {
    const def = this.placing!, p = this.r.pick(sx, sy); if (!p) return null;
    let cx: number, cz: number;
    if (def.reuse) {
      const c = this.game.nearestCiv(def, p.x, p.z, 70);
      if (c) { cx = c.cx; cz = c.cz; } else { cx = Math.floor(p.x / CELL); cz = Math.floor(p.z / CELL); }
    } else if (def.extract) {
      const s = this.game.nearestSpot(p.x, p.z, 60);
      if (s) { cx = s.cx - 1; cz = s.cz - 1; } else { cx = Math.round(p.x / CELL - 1); cz = Math.round(p.z / CELL - 1); }
    } else if (def.cls !== 'building') { cx = Math.floor(p.x / CELL) - 1; cz = Math.floor(p.z / CELL) - 1; }
    else { cx = Math.round(p.x / CELL - def.fw / 2); cz = Math.round(p.z / CELL - def.fh / 2); }
    const explored = (this.me.vis[this.game.map.cellOf((cx + 0.5) * CELL, (cz + 0.5) * CELL)] & 1) !== 0;
    return { cx, cz, ok: explored && this.free(def, cx, cz) };
  }
  private rowCells(a: { cx: number; cz: number }, b: { cx: number; cz: number }, def: UnitDef) {
    const out: { cx: number; cz: number }[] = [];
    const dx = b.cx - a.cx, dz = b.cz - a.cz;
    if (def.extract || def.reuse || def.cls !== 'building' || (Math.abs(dx) < def.fw && Math.abs(dz) < def.fh)) return [b];
    const horiz = Math.abs(dx) >= Math.abs(dz), step = horiz ? def.fw : def.fh, n = Math.floor(Math.abs(horiz ? dx : dz) / step);
    for (let i = 0; i <= Math.min(n, 15); i++) out.push({ cx: a.cx + (horiz ? Math.sign(dx) * i * step : 0), cz: a.cz + (horiz ? 0 : Math.sign(dz) * i * step) });
    return out;
  }
  private commitPlace(e: MouseEvent) {
    const def = this.placing!, end = this.placeCell(e.clientX, e.clientY); if (!end) return;
    const cells = this.rowCells(this.placeStart!, end, def).filter(c => this.free(def, c.cx, c.cz));
    const bs = this.mine().filter(u => u.def.builds.includes(def.id) && !u.def.factory);
    if (!cells.length || !bs.length) { this.audio.ui('error'); return; }
    cells.forEach((c, i) => { for (const u of bs) this.game.giveBuild(u, def, c.cx, c.cz, e.shiftKey || i > 0); });
    this.audio.ui('place');
    if (!e.shiftKey) { this.placing = null; this.panelKey = ''; }
  }

  // ───────────── per-frame ─────────────
  update(dt: number, paused: boolean) {
    const c = this.r.cam, k = this.keys;
    // camera keys + edge scroll
    let dx = 0, dz = 0;
    if (k.has('ArrowLeft')) dx -= 1; if (k.has('ArrowRight')) dx += 1; if (k.has('ArrowUp')) dz -= 1; if (k.has('ArrowDown')) dz += 1;
    if (this.inside && !this.pan && document.hasFocus()) {
      if (this.mx <= 2) dx -= 1; else if (this.mx >= innerWidth - 3) dx += 1;
      if (this.my <= 2) dz -= 1; else if (this.my >= innerHeight - 3) dz += 1;
    }
    if (dx || dz) {
      const sp = c.dist * 1.25 * dt, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      c.x += (dx * cs + dz * sn) * sp; c.z += (-dx * sn + dz * cs) * sp;
    }
    if (k.has('z')) c.yaw += dt * 1.4; if (k.has('x')) c.yaw -= dt * 1.4;
    this.heat *= Math.exp(-dt / 6);
    if (this.audio.music) this.audio.music.intensity = paused ? 0 : 1 - Math.exp(-this.heat / 9);
    // prune selection
    for (const u of this.selected) if (u.dead || !this.r.shown(u)) { this.selected.delete(u); this.panelKey = ''; }
    // placement ghost
    if (this.placing) {
      const pc = this.placeCell(this.mx, this.my), def = this.placing;
      if (pc) {
        let wx = def.cls === 'building' ? (pc.cx + def.fw / 2) * CELL : (pc.cx + 1.5) * CELL, wz = def.cls === 'building' ? (pc.cz + def.fh / 2) * CELL : (pc.cz + 1.5) * CELL, yo = 0;
        const civ = def.reuse ? this.game.civFor(def, pc.cx, pc.cz) : null;
        if (civ) { wx = civ.x; wz = civ.z; yo = civ.h; }
        this.r.setGhost(def, wx, wz, pc.ok, yo);
      } else this.r.setGhost(null);
    } else this.r.setGhost(null);
    $('gl').style.cursor = this.placing ? 'cell' : this.mode ? 'crosshair' : 'default';
    this.drawOverlay(dt);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.2; this.refreshHud(paused); }
    this.mmT -= dt; if (this.mmT <= 0) { this.mmT = 0.1; this.drawMinimap(); }
  }

  private drawOverlay(dt: number) {
    const ctx = this.ctx, g = this.game, me = this.me, r = this.r, p = this.tmp, map = g.map;
    ctx.clearRect(0, 0, this.ov.width, this.ov.height);
    const far = r.cam.dist > 520, W = innerWidth, Hh = innerHeight;
    const shift = this.keys.has('Shift');
    for (const u of g.units) {
      if (u.dead) continue;
      const shown = r.shown(u);
      if (!shown) {
        // radar blip
        if (u.def.cls !== 'building' && (me.vis[map.cellOf(u.x, u.z)] & 4)) {
          r.project(u.x, u.y, u.z, p); if (!p.ok || p.x < 0 || p.y < 0 || p.x > W || p.y > Hh) continue;
          ctx.fillStyle = 'rgba(255,90,70,0.8)'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y); ctx.fill();
        }
        continue;
      }
      const d = u.def, sel = this.selected.has(u);
      if (far && !u.inFactory) {
        r.project(u.x, u.y, u.z, p); if (!p.ok || p.x < -10 || p.y < -10 || p.x > W + 10 || p.y > Hh + 10) continue;
        const s = d.commander ? 7 : d.cls === 'building' ? (d.factory ? 6 : 4) : d.tier > 1 ? 5.5 : 4;
        ctx.fillStyle = hex(TEAM_COLORS[u.team.id]); ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.8)'; ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath();
        if (d.cls === 'building') ctx.rect(p.x - s, p.y - s, s * 2, s * 2);
        else if (d.cls === 'air') { ctx.moveTo(p.x, p.y - s - 1); ctx.lineTo(p.x + s + 1, p.y + s); ctx.lineTo(p.x - s - 1, p.y + s); ctx.closePath(); }
        else if (d.commander) ctx.arc(p.x, p.y, s, 0, 6.283);
        else { ctx.moveTo(p.x, p.y - s - 1); ctx.lineTo(p.x + s + 1, p.y); ctx.lineTo(p.x, p.y + s + 1); ctx.lineTo(p.x - s - 1, p.y); ctx.closePath(); }
        ctx.fill(); ctx.stroke();
        if (d.commander) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
      }
      if (u.team === me && d.cls === 'ground' && !u.sup && g.snow > 0.3 && !u.inFactory) { // out of supply in winter
        r.project(u.x, u.y + d.h + 4, u.z, p);
        if (p.ok) { ctx.strokeStyle = '#9fd4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let k = 0; k < 3; k++) { const a = k * 1.047; ctx.moveTo(p.x - Math.cos(a) * 5, p.y - 9 - Math.sin(a) * 5); ctx.lineTo(p.x + Math.cos(a) * 5, p.y - 9 + Math.sin(a) * 5); } ctx.stroke(); }
      }
      if (sel || u.hp < d.hp - 1 || !u.built) {
        if (!u.built && u.inFactory && !sel && far) continue;
        r.project(u.x, u.y + d.h + 3, u.z, p); if (!p.ok || p.x < 0 || p.y < 0 || p.x > W || p.y > Hh) continue;
        const w = clamp(d.r * 900 / r.cam.dist, 16, 70), x = p.x - w / 2, y = p.y - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - 1, y - 1, w + 2, u.built ? 5 : 9);
        const f = clamp(u.hp / d.hp, 0, 1);
        ctx.fillStyle = f > 0.6 ? '#4fd66a' : f > 0.3 ? '#f0c030' : '#f04a30'; ctx.fillRect(x, y, w * f, 3);
        if (!u.built) { ctx.fillStyle = '#40d0ff'; ctx.fillRect(x, y + 4, w * u.progress, 3); }
      }
      if (sel && u.team === me) {
        if (shift && u.orders.length && this.selected.size <= 40) {
          ctx.strokeStyle = 'rgba(120,255,160,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
          r.project(u.x, u.y, u.z, p); ctx.moveTo(p.x, p.y);
          for (const o of u.orders) {
            const ox = o.target && !o.target.dead ? o.target.x : o.x, oz = o.target && !o.target.dead ? o.target.z : o.z;
            r.project(ox, map.groundY(ox, oz), oz, p); if (!p.ok) break; ctx.lineTo(p.x, p.y);
            ctx.rect(p.x - 3, p.y - 3, 6, 6); ctx.moveTo(p.x, p.y);
          }
          ctx.stroke();
        }
        if (d.factory && u.rally) {
          r.project(u.rally.x, map.groundY(u.rally.x, u.rally.z), u.rally.z, p);
          if (p.ok) { ctx.strokeStyle = '#ffe060'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 18); ctx.stroke(); ctx.fillStyle = '#ffe060'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x + 10, p.y - 14); ctx.lineTo(p.x, p.y - 10); ctx.fill(); }
        }
      }
    }
    // supply reach of every base (V toggles; always shown in winter while troops are selected)
    if (this.showSupply || (g.snow > 0.3 && this.selected.size > 0)) {
      ctx.strokeStyle = 'rgba(150,210,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      for (const u of g.units) {
        if (u.team !== me || u.dead || !u.built || !(u.def.cls === 'building' || u.def.commander)) continue;
        if (Math.hypot(u.x - r.cam.x, u.z - r.cam.z) > r.cam.dist * 2.2 + SUPPLY_R) continue;
        ctx.beginPath(); let first = true;
        for (let k = 0; k <= 32; k++) { const a = k / 32 * 6.283, x = u.x + Math.cos(a) * SUPPLY_R, z = u.z + Math.sin(a) * SUPPLY_R; r.project(x, map.groundY(x, z), z, p); if (!p.ok) { first = true; continue; } if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const pg = this.pings[i]; pg.t -= dt; if (pg.t <= 0) { this.pings.splice(i, 1); continue; }
      r.project(pg.x, map.groundY(pg.x, pg.z), pg.z, p); if (!p.ok) continue;
      const k = (pg.t * 2) % 1; ctx.strokeStyle = pg.c; ctx.globalAlpha = Math.min(1, pg.t * 2); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 6 + (1 - k) * 16, (6 + (1 - k) * 16) * 0.6, 0, 0, 6.283); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // drag line preview for placement
    if (this.placing && this.placeStart) {
      const end = this.placeCell(this.mx, this.my);
      if (end) for (const c of this.rowCells(this.placeStart, end, this.placing)) {
        const def = this.placing, wx = (c.cx + def.fw / 2) * CELL, wz = (c.cz + def.fh / 2) * CELL;
        r.project(wx, map.groundY(wx, wz) + 1, wz, p);
        if (p.ok) { ctx.fillStyle = this.free(def, c.cx, c.cz) ? 'rgba(80,255,140,0.8)' : 'rgba(255,70,50,0.8)'; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); }
      }
    }
    const d = this.drag;
    if (d && d.on) {
      ctx.strokeStyle = '#60ff90'; ctx.fillStyle = 'rgba(96,255,144,0.1)'; ctx.lineWidth = 1;
      ctx.fillRect(d.x, d.y, this.mx - d.x, this.my - d.y); ctx.strokeRect(d.x + 0.5, d.y + 0.5, this.mx - d.x, this.my - d.y);
    }
  }

  private setRes(id: string, val: number, cap: number, inc: number, use: number, stall: boolean) {
    const el = $(id);
    (el.querySelector('.val') as HTMLElement).textContent = Math.floor(val) + ' / ' + Math.floor(cap);
    (el.querySelector('.bar i') as HTMLElement).style.width = clamp(val / Math.max(1, cap) * 100, 0, 100) + '%';
    (el.querySelector('.inc') as HTMLElement).textContent = '+' + (inc < 100 ? inc.toFixed(1) : inc.toFixed(0));
    (el.querySelector('.use') as HTMLElement).textContent = '−' + (use < 100 ? use.toFixed(1) : use.toFixed(0));
    el.classList.toggle('stall', stall);
  }

  private refreshHud(paused: boolean) {
    const me = this.me, g = this.game;
    this.setRes('resM', me.metal, me.stM, me.incM, me.useM, me.metal < 5 && me.useM > me.incM * 0.9 && me.stall < 0.9);
    this.setRes('resE', me.energy, me.stE, me.incE, me.useE, me.lowPower || (me.energy < 20 && me.stall < 0.9));
    $('clock').textContent = g.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' · ' + fmtTime(g.tick / TICK) + (paused ? '  ❚❚' : '');
    const se = $('season'); se.textContent = g.season + (g.snow > 0.3 ? ' ❄' : g.mud > 0.3 ? ' · mud' : ''); se.className = g.snow > 0.3 ? 'cold' : g.mud > 0.3 ? 'mud' : '';
    se.title = g.snow > 0.3 ? 'Deep snow: troops out of reach of a base freeze, vehicles crawl. Roads stay open.' : g.mud > 0.3 ? 'Mud season: everything off-road is slow, wheeled vehicles worst.' : 'Good going.';
    const cv = $('civ'); cv.textContent = 'Civilians ' + g.civAlive + '/' + g.civTotal + (me.condemn ? ' · sanctions −' + Math.round(Math.min(0.4, me.condemn * 0.015) * 100) + '%' : me.fac === 0 ? ' · aid +' + me.aid.toFixed(1) : '');
    cv.className = me.condemn ? 'bad' : '';
    $('wind').textContent = 'Wind ' + Math.round(g.wind * 100) + '%' + (me.sat ? ' · SAT' + (me.sat & 2 ? '+GPS' : '') : '');
    $('modeHint').textContent = this.placing ? (this.placing.reuse ? 'Requisition a building for ' : 'Place ') + nm(this.placing, me.fac) + ' — Shift: multiple · drag: row · right-click: cancel'
      : this.mode ? ({ fight: 'Attack-move', patrol: 'Patrol', guard: 'Guard', repair: 'Repair', reclaim: 'Salvage area', move: 'Move' } as any)[this.mode] + ' — click target' : '';
    this.refreshPanel();
  }

  private refreshPanel() {
    const sel = [...this.selected], mine = sel.filter(u => u.team === this.me);
    const builder = mine.find(u => u.def.builds.length && u.built) || null, fac = this.me.fac, g = this.game;
    const lab = builder ? null : mine.find(u => u.def.lab && u.built) || null;
    const key = this.me.tech.size + '|' + sel.map(u => u.id).join(',') + '|' + (this.placing?.id || '') + '|' + this.mode + '|' + (builder?.repeat ? 1 : 0) + '|' + mine.every(u => u.built);
    const info = $('info'), grid = $('buildgrid'), orders = $('orders'), cmd = $('cmd');
    if (key !== this.panelKey) {
      this.panelKey = key;
      grid.innerHTML = ''; orders.innerHTML = '';
      cmd.classList.toggle('empty', !mine.length);
      if (mine.length) {
        const mob = mine.some(u => u.def.cls !== 'building'), hasBp = mine.some(u => u.def.bp && !u.def.factory);
        const ob = (label: string, key: string, on: boolean, fn: () => void) => {
          const b = document.createElement('button'); b.innerHTML = label.replace(key, '<u>' + key + '</u>'); if (on) b.className = 'on';
          b.onclick = () => { fn(); (b as HTMLElement).blur(); }; orders.appendChild(b);
        };
        if (mob) {
          ob('Move', 'M', this.mode === 'move', () => this.setMode('move')); ob('Attack', 'A', this.mode === 'fight', () => this.setMode('fight'));
          ob('Patrol', 'P', this.mode === 'patrol', () => this.setMode('patrol')); ob('Guard', 'G', this.mode === 'guard', () => this.setMode('guard'));
          if (hasBp) { ob('Repair', 'R', this.mode === 'repair', () => this.setMode('repair')); ob('SalvagE', 'E', this.mode === 'reclaim', () => this.setMode('reclaim')); }
        }
        ob('Stop', 'S', false, () => { for (const u of this.mine()) { this.game.clearOrders(u); if (u.def.factory) u.queue.length = 0; } });
        if (builder && builder.def.factory) ob('Repeat: ' + (builder.repeat ? 'ON' : 'off'), 'R', builder.repeat, () => { const v = !builder.repeat; for (const u of this.mine()) if (u.def.factory) u.repeat = v; this.panelKey = ''; });
        if (builder) for (const id of builder.def.builds) {
          const def = DEFS[id], b = document.createElement('div'), locked = !g.unlocked(this.me, def);
          b.className = 'bbtn' + (this.placing === def ? ' sel' : '') + (locked ? ' locked' : ''); b.dataset.id = id;
          b.innerHTML = `<img src="${this.icons[id] || ''}" draggable="false"><span class="cnt"></span>${locked ? '<span class="lock">🔒</span>' : def.reuse ? '<span class="t2">REQ</span>' : def.tier > 1 ? '<span class="t2">T' + def.tier + '</span>' : ''}<span class="lbl">${nm(def, fac)}</span>`;
          b.onmousedown = e => {
            e.preventDefault(); this.audio.init();
            if (locked) { this.audio.ui('error'); this.toast('Requires research: ' + TECHS[def.req].name, 'bad'); return; }
            if (builder.def.factory) {
              const facs = this.mine().filter(u => u.def === builder.def);
              for (const f of facs) {
                if (e.button === 2) { const i = f.queue.lastIndexOf(def); if (i > 0 || (i === 0 && !f.buildee)) f.queue.splice(i, 1); else if (i === 0 && f.buildee) { this.game.kill(f.buildee, null, true); f.buildee = null; f.queue.shift(); } }
                else for (let i = 0; i < (e.shiftKey ? 5 : 1); i++) f.queue.push(def);
              }
              this.audio.ui('click');
            } else if (e.button === 0) { this.mode = null; this.placing = this.placing === def ? null : def; this.panelKey = ''; this.audio.ui('click'); }
          };
          b.oncontextmenu = e => e.preventDefault();
          b.onmouseenter = () => this.showTip(def, b); b.onmouseleave = () => $('tooltip').classList.add('hidden');
          grid.appendChild(b);
        }
        if (lab) for (const t of TECH_LIST) {
          if (t.at !== lab.def.lab) continue;
          const b = document.createElement('div'), done = this.me.tech.has(t.id), can = g.canResearch(this.me, t);
          b.className = 'bbtn tech' + (done ? ' done' : can ? '' : ' locked'); b.dataset.tech = t.id;
          b.innerHTML = `<span class="tn">${t.name}</span><span class="cnt"></span>${done ? '<span class="lock">✓</span>' : can ? '' : '<span class="lock">🔒</span>'}`;
          b.onmousedown = e => {
            e.preventDefault(); this.audio.init();
            if (e.button === 2) { for (const l of this.mine()) { const i = l.resQ.indexOf(t); if (i >= 0) { l.resQ.splice(i, 1); if (i === 0) l.resP = 0; } } this.audio.ui('click'); return; }
            if (done || !can || g.researching(this.me, t)) { this.audio.ui('error'); if (!done && !can) this.toast('Requires: ' + t.req.filter(r => !this.me.tech.has(r)).map(r => TECHS[r].name).join(', '), 'bad'); return; }
            lab.resQ.push(t); this.audio.ui('click');
          };
          b.oncontextmenu = e => e.preventDefault();
          b.onmouseenter = () => this.showTechTip(t, b); b.onmouseleave = () => $('tooltip').classList.add('hidden');
          grid.appendChild(b);
        }
      }
      $('tooltip').classList.add('hidden');
    }
    // live parts
    if (builder && builder.def.factory) {
      const counts: Record<string, number> = {}; for (const d of builder.queue) counts[d.id] = (counts[d.id] || 0) + 1;
      for (const el of Array.from(grid.children) as HTMLElement[]) (el.querySelector('.cnt') as HTMLElement).textContent = counts[el.dataset.id!] ? '' + counts[el.dataset.id!] : '';
    }
    if (lab) for (const el of Array.from(grid.children) as HTMLElement[]) {
      const t = TECHS[el.dataset.tech!]; let txt = '';
      for (const l of g.units) if (l.team === this.me && !l.dead) { const i = l.resQ.indexOf(t); if (i === 0) txt = Math.floor(l.resP * 100) + '%'; else if (i > 0) txt = 'queued'; }
      (el.querySelector('.cnt') as HTMLElement).textContent = txt; el.classList.toggle('sel', !!txt);
    }
    else for (const el of Array.from(grid.children) as HTMLElement[]) { const d = DEFS[el.dataset.id!]; el.classList.toggle('poor', this.me.metal < d.m * 0.1 && this.me.incM < 1); }
    // info
    if (!sel.length) { if (info.innerHTML) info.innerHTML = ''; return; }
    if (sel.length === 1) {
      const u = sel[0], d = u.def, w = d.weapons[0];
      let st = '';
      if (u.team !== this.me) st += d.neutral ? '<span><b>Right-click with armed units to bring it down</b></span>' : `<span>Owner <b style="color:${hex(TEAM_COLORS[u.team.id])}">enemy</b></span>`;
      if (!u.built) st += `<span>Building <b>${Math.floor(u.progress * 100)}%</b></span>`;
      if (w) st += `<span>Damage <b>${Math.round(d.weapons.reduce((a, x) => a + x.dmg * (x.burst || 1) / x.reload, 0))}/s</b></span><span>Range <b>${w.range}</b></span>`;
      if (d.speed) st += `<span>Speed <b>${d.speed}</b></span>`;
      if (d.bp) st += `<span>Build power <b>${d.bp}</b></span>`;
      if (d.mkE) st += `<span>Power <b>+${d.mkE}</b></span>`;
      if (d.wind) st += `<span>Power <b>+${(d.wind * this.game.wind).toFixed(1)}</b></span>`;
      if (d.extract && u.spot) st += `<span>Supplies <b>+${(u.spot.rich * d.extract).toFixed(1)}</b></span>`;
      if (d.conv) st += `<span>Converts <b>${d.conv} power → 1 supply</b></span>`;
      if (d.jam) st += `<span>Jamming radius <b>${d.jam}</b></span>`;
      if (d.kami) st += `<span>Warhead <b>${d.kami.d}</b></span>`;
      if (u.team === this.me && d.lab) st += u.resQ.length ? `<span>${d.lab === 'pad' ? 'Countdown' : 'Researching'} <b>${u.resQ[0].name} ${Math.floor(u.resP * 100)}%</b></span>` : '<span><b>Idle — choose a programme</b></span>';
      if (u.team === this.me && d.cls === 'ground') { const mob = this.game.mobility(u); if (this.game.freezing(u)) st += '<span style="color:#9fd4ff"><b>Out of supply — freezing</b></span>'; else if (mob < 0.95) st += `<span>Going <b>${Math.round(mob * 100)}%</b></span>`; }
      if (u.team === this.me && d.factory) st += `<span>Queue <b>${u.queue.length}</b></span>` + (u.buildee ? `<span>Now <b>${u.buildee.def.name} ${Math.floor(u.buildee.progress * 100)}%</b></span>` : '');
      if (u.team === this.me && u.orders.length) st += `<span>Order <b>${u.orders[0].type}${u.orders[0].def ? ' ' + nm(u.orders[0].def, fac) : ''}${u.orders.length > 1 ? ' +' + (u.orders.length - 1) : ''}</b></span>`;
      info.innerHTML = `<div class="nm">${d.neutral ? this.game.map.bridges[u.cx].name : nm(d, u.team.fac)}</div><div class="ds">${d.desc}</div><div class="hp"><i style="width:${clamp(u.hp / d.hp * 100, 0, 100)}%"></i></div><div class="st"><span>HP <b>${Math.ceil(u.hp)} / ${d.hp}</b></span>${st}</div>`;
    } else {
      const by = new Map<UnitDef, number>(); for (const u of sel) by.set(u.def, (by.get(u.def) || 0) + 1);
      let h = `<div class="nm">${sel.length} units</div><div class="chips">`;
      for (const [d, n] of by) h += `<span class="chip" data-id="${d.id}"><img src="${this.icons[d.id] || ''}">${n}× ${nm(d, fac)}</span>`;
      info.innerHTML = h + '</div>';
      for (const c of Array.from(info.querySelectorAll('.chip')) as HTMLElement[]) c.onclick = () => this.select(sel.filter(u => u.def.id === c.dataset.id), false);
    }
  }

  private showTip(def: UnitDef, el: HTMLElement) {
    const t = $('tooltip'), w = def.weapons[0];
    t.innerHTML = `<b>${nm(def, this.me.fac)}</b><div class="d">${def.desc}</div><div class="c">Supplies ${def.m} · Power ${def.e}</div>` +
      `<div class="d">HP ${def.hp}${w && w.k !== 'ram' ? ' · ' + Math.round(def.weapons.reduce((a, x) => a + x.dmg * (x.burst || 1) / x.reload, 0)) + ' dmg/s · range ' + w.range : ''}${def.speed ? ' · speed ' + def.speed : ''}</div>` +
      (def.req && !this.me.tech.has(def.req) ? `<div class="c" style="color:#ff8a70">Requires research: ${TECHS[def.req].name}</div>` : '');
    this.placeTip(el);
  }
  private showTechTip(td: TechDef, el: HTMLElement) {
    const need = td.req.filter(r => !this.me.tech.has(r)).map(r => TECHS[r].name);
    $('tooltip').innerHTML = `<b>${td.name}</b><div class="d">${td.desc}</div><div class="c">Supplies ${td.m} · Power ${td.e}</div>` +
      (need.length ? `<div class="c" style="color:#ff8a70">Requires: ${need.join(', ')}</div>` : '') + '<div class="d">Left-click to start · right-click to cancel</div>';
    this.placeTip(el);
  }
  private placeTip(el: HTMLElement) {
    const t = $('tooltip');
    t.classList.remove('hidden');
    const b = el.getBoundingClientRect(), tb = t.getBoundingClientRect();
    t.style.left = clamp(b.left + b.width / 2 - tb.width / 2, 4, innerWidth - tb.width - 4) + 'px'; t.style.top = (b.top - tb.height - 6) + 'px';
  }

  // ───────────── minimap ─────────────
  private drawMinimapBase() {
    const m = this.game.map, n = m.n, ctx = this.mmBase.getContext('2d')!, img = ctx.createImageData(n, n), b = m.biome;
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const lo = rgb(b.low), mi = rgb(b.mid), hi = rgb(b.high), wa = rgb(b.waterCol);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const h = m.heights[(z * 2 + 1) * m.hn + x * 2 + 1], hl = m.heights[(z * 2 + 1) * m.hn + x * 2], hu = m.heights[(z * 2) * m.hn + x * 2 + 1];
      const t = clamp((h - 12) / 16, 0, 1), k = z * n + x; let c: number[];
      if (h < m.waterY) c = wa.map(v => v * 1.5);
      else {
        c = t < 0.5 ? lo.map((v, i) => v + (mi[i] - v) * t * 2) : mi.map((v, i) => v + (hi[i] - v) * (t - 0.5) * 2);
        const f = m.forest[k]; c = c.map((v, i) => v * (1 - f * 0.5) + [30, 52, 30][i] * f * 0.5);
        const u = m.urban[k] * 0.6; c = c.map(v => v * (1 - u) + 112 * u);
        if (m.road[k]) c = [70, 72, 76];
        if (m.civAt[k]) c = [44, 44, 46];
      }
      const sh = clamp(1 + (h - hl + h - hu) * 0.06, 0.6, 1.4), i = k * 4;
      img.data[i] = c[0] * sh; img.data[i + 1] = c[1] * sh; img.data[i + 2] = c[2] * sh; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  private drawMinimap() {
    const g = this.game, m = g.map, n = m.n, ctx = this.mctx, W = this.mm.width, k = W / m.size, me = this.me;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mmBase, 0, 0, W, W);
    if (g.snow > 0.02) { ctx.fillStyle = `rgba(225,232,240,${g.snow * 0.5})`; ctx.fillRect(0, 0, W, W); } else if (g.mud > 0.02) { ctx.fillStyle = `rgba(60,44,26,${g.mud * 0.3})`; ctx.fillRect(0, 0, W, W); }
    ctx.fillStyle = '#1a1a1c'; for (const c of m.civ) if (c.state && (me.vis[m.cellOf(c.x, c.z)] & 1)) ctx.fillRect(c.cx * CELL * k, c.cz * CELL * k, c.fw * CELL * k, c.fh * CELL * k);
    const fd = this.mmFogImg.data, vis = me.vis;
    for (let i = 0; i < n * n; i++) { fd[i * 4 + 3] = vis[i] & 2 ? 0 : vis[i] & 1 ? 110 : 235; }
    this.mmFog.getContext('2d')!.putImageData(this.mmFogImg, 0, 0);
    ctx.drawImage(this.mmFog, 0, 0, W, W);
    for (const s of m.spots) if (!s.taken && (vis[m.cellOf(s.x, s.z)] & 1)) { ctx.fillStyle = '#dfe8f2'; ctx.fillRect(s.x * k - 1, s.z * k - 1, 2, 2); }
    for (const u of g.units) {
      if (u.dead || u.inFactory || u.def.neutral) continue;
      const shown = this.r.shown(u);
      if (!shown && !(u.def.cls !== 'building' && (vis[m.cellOf(u.x, u.z)] & 4))) continue;
      const s = u.def.cls === 'building' ? Math.max(2, u.def.fw * CELL * k) : u.def.commander ? 5 : 3;
      ctx.fillStyle = this.selected.has(u) ? '#ffffff' : shown ? hex(TEAM_COLORS[u.team.id]) : '#ff8070';
      ctx.fillRect(u.x * k - s / 2, u.z * k - s / 2, s, s);
    }
    for (const pg of this.pings) if (pg.c === '#ff4030') { ctx.strokeStyle = pg.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pg.x * k, pg.z * k, 4 + ((pg.t * 2) % 1) * 8, 0, 6.283); ctx.stroke(); }
    // view frustum
    const pts = [[0, 46], [innerWidth, 46], [innerWidth, innerHeight], [0, innerHeight]].map(p => this.r.pick(p[0], p[1]));
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath();
    let first = true;
    for (const p of pts) { if (!p) continue; if (first) { ctx.moveTo(p.x * k, p.z * k); first = false; } else ctx.lineTo(p.x * k, p.z * k); }
    if (!first) { ctx.closePath(); ctx.stroke(); }
  }
}
