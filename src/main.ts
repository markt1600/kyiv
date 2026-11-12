import { Game, DT, TICK, Team } from './sim';
import { AI, DIFFICULTY_NAMES } from './ai';
import { Renderer, makeIcons } from './render';
import { UI } from './ui';
import { Audio } from './audio';
import { DEFS, LEADERS, START_DATES, TEAM_COLORS, TEAM_NAMES } from './defs';
import { fmtTime } from './util';
import { MenuBackdrop } from './menu';

const $ = (id: string) => document.getElementById(id)!;
const audio = new Audio();
const backdrop = new MenuBackdrop($('menuBg') as HTMLCanvasElement);
backdrop.start();
const iconSets: (Record<string, string> | null)[] = [null, null];

// phones and tablets get the touch interface and lighter defaults automatically
const TOUCH = (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && window.matchMedia('(pointer: coarse)').matches;
const PHONE = TOUCH && Math.min(window.screen.width, window.screen.height) < 600;
const MOBILE = TOUCH || new URLSearchParams(location.search).has('mobile');
if (MOBILE) { document.body.classList.add('mobile'); if (PHONE) document.body.classList.add('phone'); Renderer.mobile = true; }
const opts = { side: 0, diff: 1, size: MOBILE ? 0 : 1, date: 0, auto: 0, gfx: PHONE ? 0 : MOBILE ? 1 : 2, seed: Math.floor(Math.random() * 99999) };
try { Object.assign(opts, JSON.parse(localStorage.getItem((MOBILE ? 'kyiv-opts-m' : 'kyiv-opts')) || '{}'), { seed: opts.seed }); } catch { /* ignore */ }

function seg(id: string, labels: string[], key: keyof typeof opts) {
  const el = $(id); el.innerHTML = '';
  labels.forEach((l, i) => {
    const b = document.createElement('button'); b.textContent = l; if (opts[key] === i) b.className = 'on';
    b.onclick = () => { opts[key] = i; seg(id, labels, key); refreshAuto(); audio.init(); applyVol(); audio.music?.start(); audio.ui('click'); };
    el.appendChild(b);
  });
}
seg('optDiff', DIFFICULTY_NAMES, 'diff');
seg('optAuto', ['Off', 'On'], 'auto');
/** auto-build is a learning aid: offered on Easy and Medium only */
function refreshAuto() { const ok = opts.diff <= 1; $('optAutoRow').classList.toggle('off', !ok); $('optAutoNote').textContent = ok ? 'Builds your base in the recommended order. Toggle it any time in battle.' : 'Available on Easy and Medium.'; }
refreshAuto();
const sideEls = Array.from(document.querySelectorAll('#optSide .side')) as HTMLElement[];
const setSide = (i: number) => { opts.side = i; sideEls.forEach((el, k) => el.classList.toggle('on', k === i)); document.body.dataset.side = '' + i; };
sideEls.forEach((el, i) => { el.onclick = () => { setSide(i); audio.init(); applyVol(); audio.music?.start(); audio.ui('click'); }; });
setSide(opts.side ? 1 : 0);
seg('optSize', ['Small', 'Medium', 'Large'], 'size');
seg('optDate', START_DATES.map(d => d[0]), 'date');
if (MOBILE) opts.gfx = Math.min(opts.gfx, 1);
seg('optGfx', MOBILE ? ['Low', 'Medium'] : ['Low', 'Medium', 'High'], 'gfx');
// every battle gets a fresh random seed; `?seed=N` in the address pins one for reproducing a game
const fixedSeed = parseInt(new URLSearchParams(location.search).get('seed') || '', 10);

const vol = { music: 0.42, sfx: 0.5 };
try { Object.assign(vol, JSON.parse(localStorage.getItem('kyiv-vol') || '{}')); } catch { /* ignore */ }
function applyVol() { audio.setVolume(vol.sfx); audio.music?.setVolume(vol.music); }
for (const k of ['music', 'sfx'] as const) {
  const el = $('vol' + k) as HTMLInputElement; el.value = '' + Math.round(vol[k] * 100);
  el.oninput = () => { vol[k] = +el.value / 100; applyVol(); try { localStorage.setItem('kyiv-vol', JSON.stringify(vol)); } catch { /* ignore */ } };
}
interface Session { game: Game; r: Renderer; ui: UI; ais: AI[]; me: Team; raf: number; paused: boolean; speed: number; ended: boolean; auto: boolean; helper: AI }
let S: Session | null = null;
const SPEEDS = [0.5, 1, 1.5, 2, 3, 4, 5];

// ───────────── title screen: a live AI-vs-AI battle behind the menu, with a roaming camera ─────────────
interface Attract { game: Game; r: Renderer | null; ais: AI[]; raf: number; hot: { x: number; z: number; t: number }[]; tx: number; tz: number; cut: number; quiet: number }
let A: Attract | null = null;
const STILLS = ['winter', 'district', 'bridge', 'night', 'air', 'flir'];
let stillT = 0;
function slideshow() {
  const layers = Array.from(document.querySelectorAll('#stills .still')) as HTMLElement[], ok: string[] = [];
  let i = 0, k = 0;
  const next = () => { if (!ok.length) return; const el = layers[k % 2], other = layers[(k + 1) % 2]; el.classList.remove('on'); void el.offsetWidth; el.style.backgroundImage = `url(${ok[i % ok.length]})`; el.classList.add('on'); other.classList.remove('on'); i++; k++; };
  STILLS.forEach(n => { const im = new Image(); im.onload = () => { ok.push(im.src); if (ok.length === 1) { next(); stillT = window.setInterval(next, 7000); } }; im.src = `intro/${n}.jpg`; });
}
slideshow();
function stopAttract() {
  const a = A; if (!a) return; A = null;
  cancelAnimationFrame(a.raf); $('menu').classList.remove('live');
  if (a.r) { a.r.dispose(); const old = $('gl'), nw = document.createElement('canvas'); nw.id = 'gl'; old.replaceWith(nw); }
}
function startAttract() {
  if (A || S || MOBILE) return; // on battery the title screen shows the montage only
  let game: Game;
  try { game = new Game({ n: 128, seed: Math.floor(Math.random() * 99999), start: 1, players: [{ ai: true, level: 2, ally: 0 }, { ai: true, level: 2, ally: 1 }] }); } catch { return; }
  const a: Attract = { game, r: null, ais: game.teams.map(t => new AI(game, t)), raf: 0, hot: [], tx: 0, tz: 0, cut: 0, quiet: 0 };
  A = a;
  const me = game.teams[0], uv = (game as any).updateVision.bind(game);
  (game as any).updateVision = () => { uv(); me.vis.fill(7); };
  // let the war get under way before the cameras roll, in slices so the menu stays responsive
  let left = 10800; // …and so that it is mid-morning when they do
  const t0 = performance.now();
  const ff = () => {
    if (A !== a) return;
    for (let i = 0; i < 300 && left > 0 && !game.over; i++, left--) { for (const ai of a.ais) ai.update(); game.step(); }
    game.events.length = 0;
    if (left > 0 && !game.over) { setTimeout(ff, 0); return; }
    if (game.over) { A = null; setTimeout(startAttract, 200); return; }
    let r: Renderer;
    try { r = new Renderer($('gl') as HTMLCanvasElement, game, me, Math.min(1, opts.gfx)); } catch { A = null; return; }
    a.r = r; r.spectate = true; r.cam.dist = 150; r.cam.pitch = 0.52;
    r.onEvent = e => { if (e.t === 'boom' || e.t === 'die' || e.t === 'muzzle' || e.t === 'beam') { a.hot.push({ x: e.x, z: e.z, t: performance.now() }); if (a.hot.length > 240) a.hot.shift(); } };
    const none = new Set<any>();
    let last = performance.now(), acc = 0, shown = false;
    const loop = (now: number) => {
      if (A !== a) return;
      a.raf = requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
      acc += dt; let n = 0;
      while (acc >= DT && n < 4) { for (const ai of a.ais) ai.update(); game.step(); acc -= DT; n++; }
      if (acc > DT) acc = 0;
      // the director: stay on the fighting; cut to wherever it has moved, or to an army on the march when it is quiet
      while (a.hot.length && now - a.hot[0].t > 7000) a.hot.shift();
      a.cut -= dt;
      const near = a.hot.filter(h => Math.hypot(h.x - a.tx, h.z - a.tz) < 150).length;
      a.quiet = near > 2 ? 0 : a.quiet + dt;
      if (a.cut <= 0 || a.quiet > 4) {
        let best: { x: number; z: number } | null = null, bs = 2;
        for (let i = a.hot.length - 1; i >= 0; i -= 3) { const h = a.hot[i]; let s = 0; for (const o of a.hot) if (Math.abs(o.x - h.x) < 90 && Math.abs(o.z - h.z) < 90) s++; if (Math.hypot(h.x - a.tx, h.z - a.tz) < 120) s *= 0.5; if (s > bs) { bs = s; best = h; } }
        if (!best) { const us = game.units.filter(u => !u.dead && u.built && !u.def.neutral && u.def.cls === 'ground' && u.speed > 2); const u = us[Math.floor(Math.random() * us.length)] || game.teams[Math.floor(Math.random() * 2)].prime; if (u) best = u; }
        if (best) {
          const jump = Math.hypot(best.x - a.tx, best.z - a.tz) > 160; a.tx = best.x; a.tz = best.z;
          if (jump) { r.cam.x = a.tx; r.cam.z = a.tz; r.cam.yaw = Math.random() * 6.283; r.cam.dist = 95 + Math.random() * 110; r.cam.pitch = 0.47 + Math.random() * 0.2; }
        }
        a.cut = 9 + Math.random() * 5; a.quiet = 0;
      }
      const c = r.cam; c.x += (a.tx - c.x) * Math.min(1, dt * 0.5); c.z += (a.tz - c.z) * Math.min(1, dt * 0.5); c.yaw += dt * 0.035; c.dist = Math.max(70, c.dist - dt * 1.6);
      r.frame(acc / DT, dt, none, false);
      if (!shown && now - t0 > 6500) { shown = true; $('menu').classList.add('live'); setTimeout(() => { if (A === a) { backdrop.stop(); clearInterval(stillT); } }, 2200); }
      if (game.over) { stopAttract(); backdrop.start(); setTimeout(startAttract, 1500); }
    };
    a.raf = requestAnimationFrame(loop);
  };
  setTimeout(ff, 400);
}
startAttract();

function start() {
  stopAttract();
  if (MOBILE) { // take the whole screen, in landscape, where the browser allows it
    try { const p = document.documentElement.requestFullscreen?.(); if (p) p.then(() => (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => { /* not supported */ })).catch(() => { /* refused */ }); } catch { /* ignore */ }
  }
  audio.init(); applyVol(); audio.music?.stop(); audio.music?.start();
  const seed = (fixedSeed > 0 ? fixedSeed : Math.floor(Math.random() * 99999) + 1) >>> 0;
  try { localStorage.setItem((MOBILE ? 'kyiv-opts-m' : 'kyiv-opts'), JSON.stringify(opts)); } catch { /* ignore */ }
  const side = opts.side ? 1 : 0;
  const players = [0, 1].map(i => ({ ai: i !== side, level: opts.diff, ally: i }));
  const game = new Game({ n: [128, 152, 184][opts.size], seed, start: opts.date, players });
  const me = game.teams[side];
  const icons = iconSets[side] || (iconSets[side] = makeIcons(side));
  $('leader').textContent = TEAM_NAMES[side] + ' · ' + LEADERS[side]; $('leader').className = side ? 'ru' : 'ua';
  const canvas = $('gl') as HTMLCanvasElement;
  const r = new Renderer(canvas, game, me, opts.gfx);
  const ses: Session = { game, r, ui: null as any, ais: game.teams.filter(t => t.ai).map(t => new AI(game, t)), me, raf: 0, paused: false, speed: 1, ended: false, auto: !!opts.auto && opts.diff <= 1, helper: null as any };
  // the build assistant: the same planner the AI uses, driving only this side's construction, engineers and research
  ses.helper = new AI(game, me); ses.helper.assist = true;
  setAuto(ses, ses.auto, true);
  ses.ui = new UI(game, r, me, audio, icons, {
    pause: () => { if (ses.ended && !$('end').classList.contains('hidden')) return; if (!$('guide').classList.contains('hidden')) return; ses.paused = !ses.paused; $('pause').classList.toggle('hidden', !ses.paused); },
    speed: d => { ses.speed = Math.max(0, Math.min(SPEEDS.length - 1, ses.speed + d)); $('spdVal').textContent = SPEEDS[ses.speed] + '×'; },
  });
  $('spdVal').textContent = '1×';
  S = ses;
  // start with the command post selected, so its build menu is the first thing on screen
  if (me.prime) { ses.ui.selected.add(me.prime); ses.ui.panelKey = ''; }
  let seenGuide = false; try { seenGuide = localStorage.getItem('kyiv-guide') === 'off'; } catch { /* ignore */ }
  if (!seenGuide) showGuide(ses);
  backdrop.stop();
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden');
  ses.ui.toast(side ? 'Hostomel. Your columns are staged north-west of the Irpin. Take Kyiv.' : 'Kyiv. The invasion has begun. Hold the capital.');
  ses.ui.toast(`${START_DATES[opts.date][0]} · ${DIFFICULTY_NAMES[opts.diff]} · seed ${seed}`);
  (window as any).__S = ses; (window as any).__DEFS = DEFS;
  let last = performance.now(), acc = 0;
  const loop = (now: number) => {
    ses.raf = requestAnimationFrame(loop);
    if (PHONE && now - last < 30) return; // 30 fps is plenty on a phone and halves the heat
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (!ses.paused) {
      acc += dt * SPEEDS[ses.speed];
      let n = 0;
      while (acc >= DT && n < 12) { for (const a of ses.ais) a.update(); if (ses.auto) ses.helper.update(); game.step(); acc -= DT; n++; }
      if (acc > DT) acc = 0;
    }
    ses.ui.update(dt, ses.paused);
    r.frame(ses.paused ? 1 : acc / DT, dt, ses.ui.selected, ses.paused);
    if (!ses.ended && (game.over || me.dead)) { ses.ended = true; setTimeout(() => showEnd(ses), 2500); }
  };
  ses.raf = requestAnimationFrame(loop);
}

/** switch the build assistant on or off (Easy and Medium only) */
function setAuto(ses: Session, on: boolean, quiet = false) {
  const ok = ses.game.teams.some(t => t.ai && t.level <= 1);
  ses.auto = on && ok;
  const b = $('btnAuto'); b.classList.toggle('hidden', !ok); b.classList.toggle('on', ses.auto); b.textContent = 'Auto-build ' + (ses.auto ? 'ON' : 'off');
  if (!quiet && ses.ui) ses.ui.toast(ses.auto ? 'Auto-build on: idle builders follow the opening orders; research and engineers are queued for you' : 'Auto-build off: construction is yours');
}
$('btnAuto').onclick = () => { if (S) { setAuto(S, !S.auto); ($('btnAuto') as HTMLElement).blur(); } };

/** the opening-orders card: pauses the battle until it is dismissed */
function showGuide(ses: Session) {
  const side = ses.me.fac;
  $('guideTitle').textContent = side ? 'Take Kyiv — build while your column holds the line' : 'Hold Kyiv — build before their armour arrives';
  $('guideSide').innerHTML = side
    ? '<b>Russia:</b> you start with tanks and infantry already forward. Use them to screen your base and scout the Irpin bridges, but do not throw them away before your factories are running. Every crossing is a chokepoint: bring artillery before you force one.'
    : '<b>Ukraine:</b> their armoured column comes down the roads from the north-west within minutes. Keep your Javelin teams between it and your base, add an MG bunker on that side early, and remember your aid income lasts only while the city’s civilians do.';
  $('guideAuto').textContent = ses.auto ? 'Auto-build is ON: your idle builders will follow this order by themselves, and research and engineers are queued for you. You raise and command the army. Switch it off any time with the Auto-build button at the top.' : $('btnAuto').classList.contains('hidden') ? '' : 'Want it done for you while you learn? Press the Auto-build button at the top.';
  ses.paused = true; $('guide').classList.remove('hidden'); $('pause').classList.add('hidden');
}
$('btnGuide').onclick = () => {
  if (($('guideHide') as HTMLInputElement).checked) { try { localStorage.setItem('kyiv-guide', 'off'); } catch { /* ignore */ } }
  $('guide').classList.add('hidden'); if (S) S.paused = false;
};
$('btnShowGuide').onclick = () => { if (S) showGuide(S); };

function showEnd(ses: Session) {
  if (S !== ses) return;
  audio.music?.finale(!ses.me.dead);
  const g = ses.game, won = !ses.me.dead;
  $('endTitle').textContent = won ? (ses.me.fac ? 'KYIV HAS FALLEN' : 'KYIV STANDS') : (ses.me.fac ? 'THE INVASION HAS FAILED' : 'KYIV HAS FALLEN');
  ($('endTitle') as HTMLElement).style.color = won ? '#6fe08a' : '#ff6a50';
  let h = `<p>${g.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} · ${fmtTime(g.tick / TICK)} played · ${g.bodies.length} dead on the field · ${g.map.civ.filter(c => c.state).length} buildings destroyed</p><table><tr><th>Side</th><th>Built</th><th>Kills</th><th>Lost</th><th>Supplies</th><th>Civilians killed</th></tr>`;
  for (const t of g.teams) h += `<tr><td style="color:#${TEAM_COLORS[t.id].toString(16).padStart(6, '0')}">${TEAM_NAMES[t.id]}${t.ai ? ' (' + DIFFICULTY_NAMES[t.level] + ')' : ' (you)'}</td><td>${t.stats.built}</td><td>${t.stats.kills}</td><td>${t.stats.lost}</td><td>${Math.round(t.stats.metal)}</td><td>${t.condemn}</td></tr>`;
  $('endStats').innerHTML = h + '</table>';
  $('btnWatch').classList.toggle('hidden', g.over);
  $('end').classList.remove('hidden');
}

function quit() {
  if (!S) return;
  cancelAnimationFrame(S.raf); S.ui.dispose(); S.r.dispose(); S = null;
  audio.music?.stop(); audio.music?.start(); backdrop.start();
  setTimeout(startAttract, 50);
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('guide').classList.add('hidden'); $('end').classList.add('hidden'); $('menu').classList.remove('hidden');
  const c = ($('overlay') as HTMLCanvasElement); c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  // fresh GL canvas for the next battle
  const old = $('gl'), nw = document.createElement('canvas'); nw.id = 'gl'; old.replaceWith(nw);
}

$('btnStart').onclick = start;
// a backgrounded tab should not keep fighting (or draining the battery)
document.addEventListener('visibilitychange', () => { if (document.hidden && S && !S.paused && !S.ended) { S.paused = true; $('pause').classList.remove('hidden'); } });
$('btnResume').onclick = () => { if (S) { S.paused = false; $('pause').classList.add('hidden'); } };
$('btnQuit').onclick = quit;
$('btnAgain').onclick = quit;
$('btnWatch').onclick = () => $('end').classList.add('hidden');
window.addEventListener('resize', () => { if (S) { S.r.resize(); S.ui.resize(); } else if (A && A.r) A.r.resize(); });
window.addEventListener('beforeunload', e => { if (S && !S.ended) { e.preventDefault(); } });
