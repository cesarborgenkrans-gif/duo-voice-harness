/* Momotamu presence: canvas painter extracted from characters/momotamu-presence/woven-rim-v9.html.
   Two images only (frosted glass disc + kiln light). Size-agnostic, draws no text.
   The painter only reads a presence-model snapshot; it never changes app state. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionPresencePainter = api;
})(globalThis, function () {
  'use strict';
  const TAU = Math.PI * 2, GLASS = 367.1 / 1024, SP = 256, REF_R = 367.1 * 420 / 1024;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, ease = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }, easeOut = u => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
  const mixC = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  const COL = { gold: '#a8874a', pearl: '#f4f6f3' };
  const L = { emT: [255, 234, 200], emG: [252, 160, 84], emCore: [255, 150, 80], thG: [255, 206, 150],
    lisT: [150, 204, 186], lisG: [214, 242, 228], mistT: [208, 202, 228], mistG: [255, 244, 232], pale: [226, 234, 231] };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  // Shared, built once per image pair: tintable light sprites and the still-state glass variants.
  function createAssets(disc, kiln) {
    function makeLum() {
      const c = mk(SP, SP), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, SP, SP);
      const sx = 512 - 280, sy = 512 - 280, sw = 560;
      x.filter = 'grayscale(1) contrast(1.7) brightness(0.92)'; x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5;
      x.drawImage(kiln, sx, sy, sw, sw, 0, 0, SP, SP); x.save(); x.translate(0, SP); x.scale(1, -1); x.drawImage(kiln, sx, sy, sw, sw, 0, 0, SP, SP); x.restore();
      x.filter = 'none'; x.globalAlpha = 1; x.globalCompositeOperation = 'multiply';
      const g = x.createRadialGradient(SP / 2, SP / 2, 0, SP / 2, SP / 2, SP / 2); [[0, '#fff'], [.3, '#e6e6e6'], [.55, '#8a8a8a'], [.78, '#262626'], [1, '#000']].forEach(([o, v]) => g.addColorStop(o, v));
      x.fillStyle = g; x.fillRect(0, 0, SP, SP); return c;
    }
    function makeEmber() {
      const c = mk(SP, SP), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, SP, SP);
      x.filter = 'grayscale(1) contrast(1.5) brightness(0.95)'; x.drawImage(kiln, 512 - 190, 650 - 190, 380, 380, 0, 0, SP, SP); x.filter = 'none';
      x.globalCompositeOperation = 'multiply'; const g = x.createRadialGradient(SP / 2, SP * 0.55, 0, SP / 2, SP * 0.55, SP * 0.52);
      [[0, '#fff'], [.3, '#d8d8d8'], [.58, '#6a6a6a'], [.82, '#1c1c1c'], [1, '#000']].forEach(([o, v]) => g.addColorStop(o, v)); x.fillStyle = g; x.fillRect(0, 0, SP, SP); return c;
    }
    const filt = (im, f, wash, wa) => { const c = mk(im.naturalWidth || im.width, im.naturalHeight || im.height), x = c.getContext('2d'); x.filter = f; x.drawImage(im, 0, 0); x.filter = 'none'; if (wash) { x.globalCompositeOperation = 'source-atop'; x.globalAlpha = wa; x.fillStyle = wash; x.fillRect(0, 0, c.width, c.height); } return c; };
    const LUM = makeLum(), LUM_E = makeEmber(), SPR = new Map();
    // glow = lum·c (drawn 'screen'), tint = 1 − lum·(1−c) (drawn 'multiply')
    function spr(c, src) {
      src = src || LUM; const q = c.map(v => Math.max(0, Math.min(255, Math.round(v / 4) * 4))), key = (src === LUM ? '' : 'e') + q.join(','); let s = SPR.get(key); if (s) return s;
      const glow = mk(SP, SP), g = glow.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${q.join(',')})`; g.fillRect(0, 0, SP, SP);
      const inv = mk(SP, SP), i = inv.getContext('2d'); i.drawImage(src, 0, 0); i.globalCompositeOperation = 'multiply'; i.fillStyle = `rgb(${q.map(v => 255 - v).join(',')})`; i.fillRect(0, 0, SP, SP);
      const tint = mk(SP, SP), tx = tint.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, SP, SP); tx.globalCompositeOperation = 'difference'; tx.drawImage(inv, 0, 0);
      s = { glow, tint }; if (SPR.size > 240) SPR.delete(SPR.keys().next().value); SPR.set(key, s); return s;
    }
    [L.lisT, L.lisG, L.mistT, L.mistG, L.pale].forEach(c => spr(c)); [L.emT, L.emG, L.emCore, L.thG].forEach(c => spr(c, LUM_E));
    return { disc, kiln, LUM, LUM_E, spr,
      discPaused: filt(disc, 'grayscale(0.85) brightness(0.97) opacity(0.75)', '#e3e8e8', 0.35),
      discVoiceOff: filt(disc, 'saturate(0.55) opacity(0.9)', '#e3eae9', 0.2) };
  }
  function loadAssets(base) {
    const load = name => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Presence image missing: ' + name)); im.src = base + name + '-1024.webp'; });
    return Promise.all([load('frosted-glass-disc-v5'), load('kiln-light')]).then(([disc, kiln]) => createAssets(disc, kiln));
  }
  function create(canvas, assets) {
    const X = canvas.getContext('2d');
    let W = 0, D = 1, CX = 0, CY = 0, R = 0, S = 0, K = 1, LB = 0, LO = 0, M = null, G = null, LMc = null, LSc = null;
    const SCALED = new Map();
    let s = null;   // current snapshot
    function resize(cssPx, dpr) {
      cssPx = Math.max(24, Math.round(cssPx || 0)); dpr = clamp(+dpr || 1, 1, 2);
      // A small disc is drawn at least 2x and scaled down by the browser, so the rim, glass and light stay crisp on 1x screens.
      if (cssPx < 96) dpr = 2;
      if (cssPx === W && dpr === D) return false;
      W = cssPx; D = dpr; CX = CY = W / 2; R = W * 0.38; S = R / GLASS; K = R / REF_R;
      canvas.width = Math.round(W * D); canvas.height = Math.round(W * D);
      LB = Math.ceil(2 * R) + 6; LO = CX - LB / 2;
      LMc = mk(LB, LB); LSc = mk(LB, LB); M = LMc.getContext('2d'); G = LSc.getContext('2d'); SCALED.clear();
      return true;
    }
    function lightBegin() {
      for (const [c, f] of [[M, '#fff'], [G, '#000']]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.fillStyle = f; c.fillRect(0, 0, LB, LB); c.setTransform(1, 0, 0, 1, -LO, -LO); }
      M.globalCompositeOperation = 'multiply'; G.globalCompositeOperation = 'screen';
    }
    function light(x, y, r, tc, gc, k, o) {
      if (k < 0.004) return; o = o || {}; const mul = o.mul ?? 0.6, scr = o.scr ?? 0.6;
      for (const [c, im, a] of [[M, assets.spr(tc, o.src).tint, mul], [G, assets.spr(gc, o.src).glow, scr]]) {
        const al = Math.min(1, k * a); if (al < 0.004) continue;
        c.save(); c.translate(x, y); if (o.rot) c.rotate(o.rot); if (o.sx || o.sy) c.scale(o.sx || 1, o.sy || 1); c.globalAlpha = al; c.drawImage(im, -r, -r, 2 * r, 2 * r); c.restore();
      }
    }
    const clipDisc = () => { X.save(); X.beginPath(); X.arc(CX, CY, R - 0.5, 0, TAU); X.clip(); };
    const rgrad = (x, y, r0, r1, stops, c) => { const g = (c || X).createRadialGradient(x, y, Math.max(0, r0), x, y, Math.max(0.01, r1)); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
    const annulus = (r0, r1, c) => { c = c || X; c.beginPath(); c.arc(CX, CY, r1, 0, TAU); c.arc(CX, CY, Math.max(0, r0), 0, TAU, true); c.fill('evenodd'); };
    const yOf = hh => CY + R * 0.6 * (1 - ease(hh));
    function falloff() {
      const w = s.w, ws = [[w.idle, [206, 216, 212], 0.0], [w.listen, [128, 176, 164], 0.3], [w.think, [196, 192, 214], 0.32], [w.speak, [226, 216, 206], 0.16]];
      let tw = 0, c = [0, 0, 0], a = 0; for (const [wt, col, al] of ws) { if (wt <= 0) continue; tw += wt; a += wt * al; c = c.map((v, i) => v + wt * col[i]); } if (tw < 0.01) return;
      c = c.map(v => Math.round(v / tw)); a = a * Math.min(1, tw) / tw;
      M.fillStyle = rgrad(CX, CY, R * 0.35, R, [[0, `rgba(${c},0)`], [0.7, `rgba(${c},${0.45 * a})`], [1, `rgba(${c},${a})`]], M); M.fillRect(CX - R, CY - R, 2 * R, 2 * R);
    }
    // idle ember (low) and thinking core (rising) are the same warm light at height h
    function emberLight(rm) {
      const ke = s.w.idle, kt = s.w.think, k = ke + kt; if (k < 0.01) return; const tp = rm ? 0 : s.t;
      const breath = rm ? 1 : 1 + 0.035 * Math.sin(TAU * 0.04 * tp);
      const y = yOf(s.h), u = kt / k, bright = (0.9 + 0.45 * ease(s.h) * u) * breath;
      const top = 0.32 * (1 - 0.6 * ease(s.h)) * k; const lg = M.createLinearGradient(0, CY - R, 0, y);
      lg.addColorStop(0, `rgba(208,214,200,${top})`); lg.addColorStop(1, 'rgba(208,214,200,0)'); M.fillStyle = lg; M.fillRect(CX - R, CY - R, 2 * R, y - CY + R);
      const gc = mixC(L.emG, L.thG, u), cc = mixC(L.emCore, L.thG, u);
      light(CX, y + R * 0.02, R * 1.3, L.emT, gc, k * bright * 0.8, { mul: 0.4, scr: 0.7, sx: 1.35, sy: 1.1 });
      light(CX, y + R * 0.02, R * 0.62, [255, 190, 166], cc, k * bright, { mul: 0.95, scr: 1.0, sx: 1.35, sy: 0.95, src: assets.LUM_E });
      light(CX, y + R * 0.04, R * 0.4, [255, 204, 180], [255, 180, 140], k * bright, { mul: 0.5, scr: 1.0, sx: 1.3 });
    }
    function listenLight(rm) {
      const k = s.w.listen; if (k < 0.01) return;
      const t = s.t, cond = s.cond, ca = s.checkA, cx = CX + Math.cos(ca) * R * 0.52 * cond, cy = CY + Math.sin(ca) * R * 0.52 * cond;
      let arrive = 0; const ps = s.pieces.slice(-18);
      const body = (0.75 + 0.6 * s.micSm + 0.15 * s.mic) * (1 + 0.25 * cond);
      const br = R * (0.82 + 0.14 * s.micSm + 0.04 * s.mic) * (1 - 0.48 * cond);
      for (const p of ps) { const dtp = t - p.t0; if (dtp < 2.8) arrive = Math.max(arrive, (1 - dtp / 2.8) * (0.5 + 0.5 * p.lvl)); }
      light(cx, cy, br, L.lisT, L.lisG, k * (body + (rm ? 0.35 * arrive : 0)), { mul: 1.0, scr: 0.8 });
      for (const p of ps) {
        if (s.checkId && p.id === s.checkId && cond > 0.05) continue;
        const hold = p.pinned ? 1 : Math.max(0, 1 - (t - p.born) / s.windowSeconds), dtp = t - p.t0, travel = rm ? 1 : clamp(dtp / 2.8, 0, 1);
        const rr = R * (1.0 - (1.0 - p.rest) * easeOut(travel)), x = CX + Math.cos(p.land) * rr, y = CY + Math.sin(p.land) * rr;
        if (travel < 1) { const a = (0.6 + 0.5 * p.lvl) * ease(travel / 0.12) * (1 - ease((travel - 0.25) / 0.75));
          light(x, y, R * (0.34 + 0.3 * travel), L.lisT, L.lisG, k * a, { mul: 1.2, scr: 0.55, rot: p.land, sx: 0.7 + 0.3 * travel, sy: 1.15 }); }
        const tr = p.pinned ? 0.3 : 0.14 * hold;
        if (tr > 0.02) light(x, y, R * 0.32, L.lisT, L.lisG, k * tr * ease(travel) * (1 - cond), { mul: 0.8, scr: 0.4 });
        if (p.pinned) light(x, y, R * 0.16, L.lisT, [236, 250, 242], k * 0.6 * ease(travel) * (1 - cond), { mul: 0.35, scr: 0.9 });
      }
    }
    function mistLight(rm) {
      const k = s.w.think; if (k < 0.01) return; const m = s.mist * k, tp = rm ? 0 : s.t;
      M.fillStyle = `rgba(226,224,238,${0.22 * m})`; M.fillRect(CX - R, CY - R, 2 * R, 2 * R);
      const f = [0.06, 0.075, 0.09], yc = yOf(s.h);
      for (let i = 0; i < 3; i++) { const a = TAU * f[i] * tp * 0.6 + i * 2.09, rad = R * (0.3 + 0.08 * Math.sin(TAU * 0.05 * tp + i * 1.7));
        const x = CX + Math.cos(a) * rad, y = yc + Math.sin(a) * rad * 0.7 - R * 0.1, r = R * (0.72 + 0.1 * Math.sin(TAU * 0.055 * tp + i));
        light(x, y, r, i === 1 ? L.mistT : mixC(L.mistT, L.mistG, 0.4), L.mistG, m * (0.8 - 0.15 * i), { mul: 0.7, scr: 0.55, rot: a, sx: 1.15, sy: 0.9 }); }
    }
    // v9: pale lantern yellow (candle light), voice-reactive
    function speakLight(rm) {
      const k = s.w.speak; if (k < 0.01) return; const a = s.tts, y0 = yOf(s.h), bands = s.bands;
      const ap = Math.pow(a, 0.8), ramp = (c0, c1, c2) => ap < 0.5 ? mixC(c0, c1, ap * 2) : mixC(c1, c2, (ap - 0.5) * 2);
      const deep = ramp([248, 226, 184], [246, 212, 150], [246, 206, 138]);
      const core = ramp([250, 232, 190], [252, 226, 160], [252, 228, 156]);
      light(CX, y0, R * (0.6 + 0.3 * a), deep, core, k * (0.5 + 0.9 * a), { mul: 1.0, scr: 0 });
      if (!rm) { for (let i = 0; i < 4; i++) { const b = (bands[2 * i] + bands[2 * i + 1]) / 2, th = i * Math.PI / 2 + Math.PI / 4 + 0.22 * s.ttsPhase;
        const d = R * (0.06 + 0.36 * b); light(CX + Math.cos(th) * d, y0 + Math.sin(th) * d, R * (0.3 + 0.2 * b), deep, core, k * (0.2 + 1.1 * b), { mul: 0.9, scr: 0.35, rot: th, sx: 1.3, sy: 0.85 }); } }
      light(CX, y0, R * (0.32 + 0.22 * a), deep, core, k * (0.3 + 0.75 * a), { mul: 0, scr: 1.0 });
      light(CX, y0, R * 1.25, deep, [255, 242, 200], k * (0.12 + 0.35 * a), { mul: 0, scr: 1.0, sx: 1.1, sy: 1.1 });
      light(CX, y0, R * (0.14 + 0.12 * a), deep, [255, 246, 220], k * (0.15 + 0.85 * a), { mul: 0, scr: 1.0 });
      if (!rm) { for (const p of s.pulses) { const rr = p.r * R, wd = R * (0.16 + 0.08 * p.r), al = k * p.a * Math.pow(1 - p.r / 1.08, 1.2) * 0.5;
        M.fillStyle = rgrad(CX, CY, Math.max(0, rr - wd), rr + wd, [[0, 'rgba(244,220,154,0)'], [.5, `rgba(244,220,154,${0.45 * al})`], [1, 'rgba(244,220,154,0)']], M); annulus(rr - wd, rr + wd, M);
        G.fillStyle = rgrad(CX, CY, Math.max(0, rr - wd), rr + wd, [[0, 'rgba(255,240,196,0)'], [.5, `rgba(255,240,196,${0.4 * al})`], [1, 'rgba(255,240,196,0)']], G); annulus(rr - wd, rr + wd, G); } }
    }
    function scaled(src) { let c = SCALED.get(src); if (!c) { c = mk(Math.round(S * D), Math.round(S * D)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); SCALED.set(src, c); } return c; }
    function img(src, a) { X.globalAlpha = a; X.drawImage(scaled(src), CX - S / 2, CY - S / 2, S, S); X.globalAlpha = 1; }
    function rimFade() {
      const w = s.w, f = 0.92 * Math.min(1, w.idle + w.think + w.speak) + 0.5 * w.listen; if (f < 0.01) return; M.globalCompositeOperation = 'source-over'; G.globalCompositeOperation = 'source-over';
      M.fillStyle = rgrad(CX, CY, R * 0.72, R, [[0, 'rgba(255,255,255,0)'], [1, `rgba(255,255,255,${Math.min(1, f)})`]], M); annulus(R * 0.72, R + 1, M);
      G.fillStyle = rgrad(CX, CY, R * 0.72, R, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${Math.min(1, f)})`]], G); annulus(R * 0.72, R + 1, G);
    }
    function lightEnd() { rimFade(); clipDisc(); X.globalCompositeOperation = 'multiply'; X.drawImage(LMc, LO, LO, LB, LB); X.globalCompositeOperation = 'screen'; X.drawImage(LSc, LO, LO, LB, LB); X.restore(); X.globalCompositeOperation = 'source-over'; X.globalAlpha = 1; }
    // the only gold: a thin arc + point on the rim where the name was heard
    function goldMark(rm) {
      let a = 0, grow = 1, knot = 0; const st = s.state, stT = s.stateT;
      if (st === 'checking') { a = 1; grow = rm ? 1 : ease(stT / 0.35); }
      else if (st === 'invited') { a = 1 - ease((stT - 1.2) / 0.6); knot = rm ? 1 : ease(stT / 0.4); }
      else if (s.release && s.release.t < 0.8 && st === 'listening') { a = 1 - ease(s.release.t / 0.8); }
      if (a <= 0.01) return; const r = R + Math.max(2.5, 7 * K), sp = 0.28 * grow, ang = s.checkA;
      X.lineCap = 'round'; X.globalAlpha = a;
      X.beginPath(); X.arc(CX, CY, r, ang - sp, ang + sp); X.strokeStyle = 'rgba(244,246,243,.9)'; X.lineWidth = Math.max(2, 4.5 * K); X.stroke();
      X.beginPath(); X.arc(CX, CY, r, ang - sp, ang + sp); X.strokeStyle = COL.gold; X.lineWidth = Math.max(1, 1.6 * K); X.stroke();
      const px = CX + Math.cos(ang) * r, py = CY + Math.sin(ang) * r;
      X.beginPath(); X.arc(px, py, Math.max(1.2, 2.6 * K), 0, TAU); X.fillStyle = COL.gold; X.fill();
      if (knot > 0) { X.beginPath(); X.arc(px, py, Math.max(2.2, (5 + 2 * (1 - knot)) * K), 0, TAU); X.strokeStyle = COL.gold; X.lineWidth = Math.max(1, 1.6 * K); X.stroke(); }
      X.globalAlpha = 1;
    }
    function draw(snapshot, options = {}) {
      if (!W) return false;
      s = snapshot; const rm = !!(options.reducedMotion ?? snapshot.reducedMotion), st = s.state;
      X.setTransform(D, 0, 0, D, 0, 0); X.imageSmoothingQuality = 'high';
      X.globalCompositeOperation = 'source-over'; X.globalAlpha = 1; X.clearRect(0, 0, W, W);
      if (st === 'off') { X.beginPath(); X.arc(CX, CY, R, 0, TAU); X.strokeStyle = '#d8d6cf'; X.lineWidth = 1; X.stroke(); return true; }
      if (s.w.speak > 0.01 && s.halo > 0.01 && !s.still) { const hh = s.halo * s.w.speak; X.fillStyle = rgrad(CX, CY, R - 4 * K, R * 1.3, [[0, `rgba(240,214,140,${0.26 * hh})`], [.35, `rgba(246,228,170,${0.12 * hh})`], [1, 'rgba(246,230,184,0)']]); annulus(R - 4 * K, R * 1.3); }
      { const sh = st === 'paused' ? 0.03 : 0.05; X.fillStyle = rgrad(CX, CY, R - 2 * K, R + 12 * K, [[0, `rgba(24,61,67,${sh})`], [1, 'rgba(24,61,67,0)']]); annulus(R - 2 * K, R + 12 * K); }
      img(st === 'paused' ? assets.discPaused : st === 'voiceoff' ? assets.discVoiceOff : assets.disc, 1);
      if (st === 'voiceoff') { const dk = s.drop && s.drop.t < 2.2 ? 0.3 * (1 - s.drop.t / 2.2) : 0;
        lightBegin(); light(CX, CY - R * 0.05, R * 1.05, L.pale, L.pale, 0.45 + dk, { mul: 0.4, scr: 0.5 }); lightEnd(); clipDisc(); img(assets.discVoiceOff, 0.3); X.restore(); }
      else if (!s.still) {
        lightBegin(); falloff(); mistLight(rm); emberLight(rm); listenLight(rm); speakLight(rm); lightEnd();
        clipDisc(); img(assets.disc, 0.3 * (1 - 0.55 * Math.min(1, s.w.idle + s.w.think + s.w.speak))); X.restore();
      }
      goldMark(rm);
      if (st === 'paused') { const bw = Math.max(2, 7 * K), bh = Math.max(8, 32 * K), gap = Math.max(1.5, 4 * K); X.fillStyle = 'rgba(120,124,120,.5)'; X.fillRect(CX - gap - bw, CY - bh / 2, bw, bh); X.fillRect(CX + gap, CY - bh / 2, bw, bh); }
      return true;
    }
    return { resize, draw, get size() { return W; } };
  }
  return Object.freeze({ create, createAssets, loadAssets });
});
