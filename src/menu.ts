// Animated title-screen backdrop: Kyiv's skyline at dusk under fire, drawn procedurally on a 2D canvas.
import { mulberry32 } from './util';

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; kind: number }

export class MenuBackdrop {
  private cv: HTMLCanvasElement; private ctx: CanvasRenderingContext2D; private raf = 0; private t = 0; private last = 0;
  private layers: HTMLCanvasElement[] = []; private W = 0; private H = 0; private ps: P[] = [];
  private fires: { x: number; y: number }[] = []; private tracers: { x: number; y: number; a: number; t: number; n: number }[] = [];
  private flashes: { x: number; t: number; s: number }[] = []; private windows: { x: number; y: number; ph: number }[] = [];
  private onResize = () => this.build();

  constructor(cv: HTMLCanvasElement) { this.cv = cv; this.ctx = cv.getContext('2d')!; }

  start() {
    if (this.raf) return;
    this.build(); window.addEventListener('resize', this.onResize);
    this.last = performance.now();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt; this.draw(dt); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; window.removeEventListener('resize', this.onResize); }

  /** pre-render three parallax layers of skyline silhouette */
  private build() {
    const W = this.W = this.cv.width = window.innerWidth, H = this.H = this.cv.height = window.innerHeight;
    const r = mulberry32(2022), hz = H * 0.8; // horizon / river bank line
    this.layers = []; this.fires = []; this.windows = [];
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; this.layers.push(c); return c.getContext('2d')!; };
    const block = (g: CanvasRenderingContext2D, x: number, w: number, h: number, base: number, lit: number) => {
      g.fillRect(x, base - h, w, h + 4);
      if (r() < 0.3) g.fillRect(x + w * 0.3, base - h - 6, w * 0.25, 6);
      if (r() < 0.2) { g.fillRect(x + w * 0.7, base - h - 22, 1.5, 22); }
      if (lit) for (let wy = base - h + 6; wy < base - 6; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (r() < lit) this.windows.push({ x: wx, y: wy, ph: r() * 20 });
    };
    // far: a hazy wall of tower blocks
    let g = mk(); g.fillStyle = '#1b2430';
    for (let x = -20; x < W + 20;) { const w = 18 + r() * 40, h = 30 + r() * r() * H * 0.2; block(g, x, w, h, hz, 0); x += w + r() * 6; }
    // middle: the landmarks
    g = mk(); g.fillStyle = '#10161e';
    for (let x = -20; x < W + 20;) { const w = 26 + r() * 60, h = 40 + r() * r() * H * 0.24; block(g, x, w, h, hz + 8, 0.07); x += w + r() * 14; }
    const s = Math.min(2.1, H / 560);
    const dome = (cx: number, by: number, rad: number) => { g.beginPath(); g.moveTo(cx - rad, by); g.bezierCurveTo(cx - rad * 1.4, by - rad * 1.4, cx - rad * 0.3, by - rad * 1.7, cx, by - rad * 2.5); g.bezierCurveTo(cx + rad * 0.3, by - rad * 1.7, cx + rad * 1.4, by - rad * 1.4, cx + rad, by); g.fill(); g.fillRect(cx - 0.8, by - rad * 3.4, 1.6, rad); g.fillRect(cx - rad * 0.3, by - rad * 3.1, rad * 0.6, 1.4); };
    // Lavra bell tower and domes
    { const x = W * 0.035, b = hz + 8; g.fillRect(x - 9 * s, b - 150 * s, 18 * s, 150 * s); g.fillRect(x - 12 * s, b - 96 * s, 24 * s, 96 * s); dome(x, b - 150 * s, 9 * s); g.fillRect(x + 28 * s, b - 60 * s, 66 * s, 60 * s); dome(x + 44 * s, b - 60 * s, 10 * s); dome(x + 62 * s, b - 66 * s, 13 * s); dome(x + 80 * s, b - 60 * s, 10 * s); }
    // Motherland Monument: figure with raised sword and shield
    { const x = W * 0.125, b = hz + 8; g.beginPath(); g.moveTo(x - 30 * s, b); g.lineTo(x - 18 * s, b - 70 * s); g.lineTo(x + 18 * s, b - 70 * s); g.lineTo(x + 30 * s, b); g.fill();
      g.beginPath(); g.moveTo(x - 11 * s, b - 70 * s); g.lineTo(x - 7 * s, b - 170 * s); g.lineTo(x + 7 * s, b - 170 * s); g.lineTo(x + 11 * s, b - 70 * s); g.fill();
      g.beginPath(); g.arc(x, b - 178 * s, 6 * s, 0, 6.3); g.fill();
      g.save(); g.translate(x + 6 * s, b - 164 * s); g.rotate(-0.3); g.fillRect(0, -52 * s, 5 * s, 52 * s); g.fillRect(1.2 * s, -110 * s, 2.6 * s, 60 * s); g.fillRect(-4 * s, -54 * s, 13 * s, 2.4 * s); g.restore();
      g.save(); g.translate(x - 6 * s, b - 164 * s); g.rotate(0.35); g.fillRect(-5 * s, -46 * s, 5 * s, 46 * s); g.fillRect(-13 * s, -74 * s, 16 * s, 30 * s); g.restore(); }
    // TV tower
    { const x = W * 0.94, b = hz + 8, h = 250 * s; g.beginPath(); g.moveTo(x - 26 * s, b); g.lineTo(x - 3 * s, b - h * 0.5); g.lineTo(x + 3 * s, b - h * 0.5); g.lineTo(x + 26 * s, b); g.lineTo(x + 20 * s, b); g.lineTo(x, b - h * 0.42); g.lineTo(x - 20 * s, b); g.fill(); g.fillRect(x - 2 * s, b - h, 4 * s, h); g.fillRect(x - 9 * s, b - h * 0.52, 18 * s, 6 * s); g.fillRect(x - 6 * s, b - h * 0.7, 12 * s, 4 * s); g.fillRect(x - 0.7, b - h * 1.12, 1.4, h * 0.14); }
    // St Sophia
    { const x = W * 0.865, b = hz + 8; g.fillRect(x - 40 * s, b - 46 * s, 80 * s, 46 * s); dome(x, b - 62 * s, 15 * s); g.fillRect(x - 12 * s, b - 62 * s, 24 * s, 18 * s); dome(x - 26 * s, b - 46 * s, 9 * s); dome(x + 26 * s, b - 46 * s, 9 * s); g.fillRect(x + 54 * s, b - 120 * s, 16 * s, 120 * s); dome(x + 62 * s, b - 120 * s, 8 * s); }
    g.strokeStyle = '#10161e'; g.lineWidth = 3;
    { const x0 = W * 0.3, x1 = W * 0.72, y = hz + 4; g.fillRect(x0, y, x1 - x0, 6); for (let x = x0; x < x1 - 60; x += 110) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 55, y - 58, x + 110, y); g.stroke(); for (let k = 1; k < 6; k++) { const xx = x + k * 110 / 6, yy = y - Math.sin(k / 6 * Math.PI) * 29; g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, yy); g.stroke(); } g.fillRect(x - 5, y, 10, 30); } }
    // near: the broken near bank in the foreground
    g = mk(); g.fillStyle = '#030507';
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) { const ruin = r() < 0.14 ? 10 + r() * 46 : 0; g.lineTo(x, H - 26 + Math.sin(x * 0.012) * 7 - ruin * (r() < 0.5 ? 1 : 0.4)); }
    g.lineTo(W, H); g.fill();
    for (let i = 0; i < 5; i++) this.fires.push({ x: W * (0.08 + r() * 0.84), y: hz + 4 + r() * 12 });
    this.ps = [];
  }

  private draw(dt: number) {
    const g = this.ctx, W = this.W, H = this.H, t = this.t, hz = H * 0.8;
    // sky: night blue falling to a furnace glow at the horizon
    const sky = g.createLinearGradient(0, 0, 0, hz + 20);
    sky.addColorStop(0, '#060a13'); sky.addColorStop(0.4, '#121d2e'); sky.addColorStop(0.72, '#3c2c30'); sky.addColorStop(0.9, '#8a4a22'); sky.addColorStop(1, '#c8641e');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // stars
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 90; i++) { const x = (i * 9973 % 1000) / 1000 * W, y = (i * 7919 % 1000) / 1000 * hz * 0.6, a = 0.25 + 0.3 * Math.sin(t * 1.3 + i); g.globalAlpha = a; g.fillRect(x, y, 1.3, 1.3); }
    g.globalAlpha = 1;
    // distant flashes of impacts
    if (Math.random() < dt * 0.9) this.flashes.push({ x: Math.random() * W, t: 0, s: 60 + Math.random() * 160 });
    g.globalCompositeOperation = 'lighter';
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt; if (f.t > 0.5) { this.flashes.splice(i, 1); continue; }
      const a = (1 - f.t / 0.5) ** 2, gr = g.createRadialGradient(f.x, hz, 0, f.x, hz, f.s * (1 + f.t * 2));
      gr.addColorStop(0, `rgba(255,220,160,${0.8 * a})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(f.x - f.s * 2, hz - f.s * 2, f.s * 4, f.s * 2.4);
    }
    // searchlights
    for (let i = 0; i < 3; i++) {
      const x = W * (0.22 + i * 0.29), a = -1.57 + Math.sin(t * (0.21 + i * 0.07) + i * 2) * 0.7, L = H * 0.95;
      const gr = g.createLinearGradient(x, hz, x + Math.cos(a) * L, hz + Math.sin(a) * L); gr.addColorStop(0, 'rgba(190,210,255,0.16)'); gr.addColorStop(1, 'rgba(190,210,255,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x, hz); g.lineTo(x + Math.cos(a - 0.035) * L, hz + Math.sin(a - 0.035) * L); g.lineTo(x + Math.cos(a + 0.035) * L, hz + Math.sin(a + 0.035) * L); g.fill();
    }
    // anti-aircraft tracer streams
    if (Math.random() < dt * 0.7) this.tracers.push({ x: W * (0.1 + Math.random() * 0.8), y: hz, a: -1.57 + (Math.random() - 0.5) * 1.3, t: 0, n: 6 + Math.floor(Math.random() * 10) });
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]; tr.t += dt; if (tr.t > 2.6) { this.tracers.splice(i, 1); continue; }
      for (let k = 0; k < tr.n; k++) {
        const tt = tr.t - k * 0.09; if (tt < 0 || tt > 1.5) continue;
        const d = tt * H * 0.62, x = tr.x + Math.cos(tr.a) * d, y = tr.y + Math.sin(tr.a) * d + tt * tt * 60, al = 1 - tt / 1.5;
        g.strokeStyle = `rgba(255,${150 + k * 6},70,${al})`; g.lineWidth = 1.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(tr.a) * 12, y - Math.sin(tr.a) * 12); g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
    // skyline, with the far layers drifting a little against each other
    const px = Math.sin(t * 0.05) * 12;
    g.drawImage(this.layers[0], px * 0.3, 0); 
    // horizon glow between the layers
    const gl = g.createLinearGradient(0, hz - 120, 0, hz + 10); gl.addColorStop(0, 'rgba(200,90,30,0)'); gl.addColorStop(1, `rgba(220,110,40,${0.26 + 0.05 * Math.sin(t * 2.1)})`); g.fillStyle = gl; g.fillRect(0, hz - 120, W, 130);
    g.drawImage(this.layers[1], px * 0.6, 0);
    // a few windows still lit, flickering
    for (const w of this.windows) { const a = 0.35 + 0.3 * Math.sin(t * 0.7 + w.ph); if (Math.sin(t * 0.13 + w.ph) < -0.92) continue; g.fillStyle = `rgba(255,196,110,${a})`; g.fillRect(w.x + px * 0.6, w.y, 3, 4); }
    // fires and their smoke
    for (const f of this.fires) {
      if (Math.random() < dt * 14) this.ps.push({ x: f.x + (Math.random() - 0.5) * 14, y: f.y, vx: 8 + Math.random() * 10, vy: -(16 + Math.random() * 22), life: 0, max: 7 + Math.random() * 6, size: 10 + Math.random() * 14, kind: 0 });
      if (Math.random() < dt * 9) this.ps.push({ x: f.x + (Math.random() - 0.5) * 18, y: f.y, vx: (Math.random() - 0.5) * 14, vy: -(30 + Math.random() * 50), life: 0, max: 1.6 + Math.random() * 1.8, size: 1.4, kind: 1 });
      const fl = 0.75 + 0.25 * Math.sin(t * 13 + f.x), gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, 70 * fl);
      gr.addColorStop(0, 'rgba(255,190,90,0.85)'); gr.addColorStop(0.3, 'rgba(255,110,30,0.4)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
      g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(f.x - 80, f.y - 80, 160, 110); g.globalCompositeOperation = 'source-over';
    }
    if (Math.random() < dt * 5) this.ps.push({ x: Math.random() * W, y: H + 5, vx: (Math.random() - 0.5) * 20, vy: -(20 + Math.random() * 40), life: 0, max: 5 + Math.random() * 4, size: 1.6 + Math.random() * 1.4, kind: 2 });
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i]; p.life += dt; if (p.life > p.max) { this.ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; const k = p.life / p.max;
      if (p.kind === 0) { // smoke
        p.vx += 3 * dt; p.size += 9 * dt; const a = Math.min(1, k * 5) * (1 - k) * 0.34;
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); gr.addColorStop(0, `rgba(26,22,22,${a})`); gr.addColorStop(1, 'rgba(26,22,22,0)'); g.fillStyle = gr; g.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      } else { // sparks and embers
        p.vx += Math.sin(t * 3 + p.y * 0.05) * 20 * dt; g.fillStyle = `rgba(255,${150 + 80 * (1 - k)},60,${(1 - k) * (p.kind === 2 ? 0.7 : 1)})`; g.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    if (this.ps.length > 900) this.ps.splice(0, this.ps.length - 900);
    // the river: a dark mirror of the burning bank, broken by ripples
    const ry = hz + 10, rv = g.createLinearGradient(0, ry, 0, H); rv.addColorStop(0, '#5a2f16'); rv.addColorStop(0.25, '#1c1a1e'); rv.addColorStop(1, '#04060a');
    g.fillStyle = rv; g.fillRect(0, ry, W, H - ry);
    g.globalCompositeOperation = 'lighter';
    for (const f of this.fires) for (let k = 0; k < 14; k++) { const y = ry + 6 + k * (H - ry) / 16, w = (30 + k * 7) * (0.7 + 0.3 * Math.sin(t * 2 + k + f.x)), a = 0.2 * (1 - k / 14); g.fillStyle = `rgba(255,130,50,${a})`; g.fillRect(f.x - w / 2 + Math.sin(t * 1.4 + k * 1.7) * 9, y, w, 2); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
    for (let k = 0; k < 26; k++) { const y = ry + 8 + k * k * 0.5 % (H - ry), x = (k * 211 + t * (12 + k)) % (W + 300) - 150; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 90 + k * 5, y); g.stroke(); }
    g.drawImage(this.layers[2], px, 0);
    // vignette
    const vg = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
}
