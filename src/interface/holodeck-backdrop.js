/* ============================================================
   DUO VOICE HARNESS — JEV Cybernetic Conduit & Point-Matrix Backdrop
   Stylistically modeled on the JEV 2-Gate RAG Loop visualizer:
   - Deep pitch-black void with sparse silver star/grid points
   - Twin sweeping 3D curved rectangular point-matrix conduits
     rising from bottom-left and bottom-right into a unified
     blazing white/amber cellular central column
   - Warm amber convergence core + thin tilted orbital ring
   - Subtle JEV HUD telemetry (CANDIDATES / CUT / GATES / RETRY /
     RELEVANCE HEURISTIC) & right-edge candidate slots
   ============================================================ */
(() => {
  'use strict';

  const STORAGE_KEY = 'duo-voice-holodeck';

  let canvas = null;
  let ctx = null;
  let enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  let rafId = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let resizeObserver = null;

  const state = {
    time: 0,
    inputLevel: 0,
    inputTarget: 0,
    momoLevel: 0,
    momoTarget: 0,
    viviLevel: 0,
    viviTarget: 0,
    momoSquish: 0,
    viviSquish: 0,
    activeSpeaker: null,
    shockwaves: [],
    halos: [],
    packets: [],
    stars: [],
    telemetry: {
      candidates: 0,
      cut: 0.6,
      gates: 2,
      retry: 0,

      decision: 'IDLE'
    }
  };

  function initStars() {
    state.stars = [];
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 68; i++) {
      state.stars.push({
        u: rand(),
        v: rand(),
        size: rand() > 0.82 ? 1.5 : 1,
        alpha: 0.06 + rand() * 0.2,
        phase: rand() * Math.PI * 2
      });
    }
  }

  function spawnPacket(lane, intensity = 0.5) {
    if (state.packets.length > 90) return;
    state.packets.push({
      lane, // 'left' | 'right' | 'center'
      t: 0,
      speed: 0.009 + Math.random() * 0.011 + intensity * 0.014,
      offset: (Math.random() - 0.5) * 1.6,
      size: 1.6 + Math.random() * 2.2,
      warm: Math.random() > 0.35
    });
  }

  function triggerShockwave(actor) {
    state.shockwaves.push({
      actor: actor || 'center',
      radius: 8,
      maxRadius: Math.max(width, height) * 0.55,
      alpha: 0.9
    });
  }

  function triggerHalo(actor) {
    state.halos.push({
      actor: actor || 'momotamu',
      progress: 0,
      alpha: 0.85
    });
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  // Parametric centerline & half-width for the twin JEV conduits merging into the central spine.
  // s in [0, 1]: 0 = bottom outer entry, 0.56 = convergence neck, 1.0 = top of central column.
  function conduitFrame(side, s, cx, cy, w, h) {
    const dir = side === 'left' ? -1 : 1;
    const neckS = 0.56;
    const neckY = h * 0.48;
    if (s <= neckS) {
      const u = s / neckS; // 0..1 from bottom corner to convergence neck
      const ease = u * u * (3 - 2 * u);
      const startX = cx + dir * Math.min(w * 0.38, 340);
      const startY = h * 1.04;
      // Smooth S-curve sweeping inward and upward
      const x = startX + (cx - startX) * Math.pow(ease, 1.15);
      const y = startY + (neckY - startY) * (0.18 * u + 0.82 * ease);
      const halfW = (18 + (1 - u) * 16) * Math.min(1.15, Math.max(0.72, w / 900));
      const depth = 9 + (1 - u) * 7;
      return { x, y, halfW, depth, merged: 0, u };
    }
    const v = (s - neckS) / (1 - neckS); // 0..1 from neck to top of central column
    const topY = -h * 0.04;
    const x = cx + dir * (1 - v) * 2.5;
    const y = neckY + (topY - neckY) * v;
    const halfW = (21 - v * 3) * Math.min(1.15, Math.max(0.75, w / 900));
    const depth = 11;
    return { x, y, halfW, depth, merged: 1, u: v };
  }

  function drawPointMatrixConduits(cx, cy, energy) {
    const steps = 38;
    const cols = 5;

    // 1. Subtle structural wireframe ribs along both conduits
    for (const side of ['left', 'right']) {
      ctx.strokeStyle = 'rgba(175, 190, 215, 0.09)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i <= steps; i += 2) {
        const s = i / steps;
        if (side === 'right' && s > 0.58) continue; // Shared central spine
        const f = conduitFrame(side, s, cx, cy, width, height);
        ctx.beginPath();
        ctx.moveTo(f.x - f.halfW, f.y);
        ctx.lineTo(f.x + f.halfW, f.y);
        ctx.lineTo(f.x + f.halfW * 0.72, f.y - f.depth);
        ctx.lineTo(f.x - f.halfW * 0.72, f.y - f.depth);
        ctx.lineTo(f.x - f.halfW, f.y);
        ctx.stroke();
      }

      // Outer longitudinal rail lines
      for (const rail of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const s = i / steps;
          if (side === 'right' && s > 0.6) break;
          const f = conduitFrame(side, s, cx, cy, width, height);
          const rx = f.x + rail * f.halfW;
          const ry = f.y;
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.strokeStyle = 'rgba(210, 220, 238, 0.13)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 2. Glowing cellular blocks inside the upper converged spine (s >= 0.54)
    const spineStart = Math.floor(steps * 0.52);
    for (let i = spineStart; i <= steps; i++) {
      const s = i / steps;
      const v = (s - 0.52) / 0.48; // 0 at convergence neck -> 1 at top
      const f = conduitFrame('left', s, cx, cy, width, height);
      const cellRows = 4;
      const cellW = (f.halfW * 1.75) / cellRows;
      const cellH = Math.max(3.5, (height * 0.52) / (steps - spineStart + 2));

      for (let c = 0; c < cellRows; c++) {
        const wave = Math.sin(state.time * 3.2 - i * 0.45 + c * 1.3);
        const lit = 0.42 + 0.38 * wave + energy * 0.45;
        if (lit < 0.25) continue;
        const bx = f.x - f.halfW * 0.88 + c * cellW;
        const by = f.y - cellH * 0.5;
        const alpha = Math.min(0.92, lit * (0.45 + 0.5 * Math.sin(v * Math.PI)));
        // Core cells are intense warm ivory-white; edge cells are warm amber-gold
        const isCore = c === 1 || c === 2;
        ctx.fillStyle = isCore
          ? `rgba(255, 250, 232, ${alpha.toFixed(3)})`
          : `rgba(255, 198, 112, ${(alpha * 0.78).toFixed(3)})`;
        ctx.fillRect(bx + 0.6, by + 0.6, Math.max(1.5, cellW - 1.2), Math.max(1.5, cellH - 1.2));
      }
    }

    // 3. Crisp point-matrix dots across both sweeping conduits & spine
    for (const side of ['left', 'right']) {
      const sideEnergy = side === 'left' ? state.momoLevel : state.viviLevel;
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        if (side === 'right' && s > 0.56) continue;
        const f = conduitFrame(side, s, cx, cy, width, height);
        const isSpine = s > 0.52;
        for (let c = -cols; c <= cols; c++) {
          const frac = c / cols;
          const px = f.x + frac * f.halfW;
          const py = f.y - (1 - Math.abs(frac)) * f.depth * 0.55;
          const pulse = Math.sin(state.time * 2.6 - s * 11 + c * 0.7);
          const baseAlpha = isSpine ? 0.78 : 0.34 + s * 0.32;
          const alpha = Math.min(1, baseAlpha + pulse * 0.14 + sideEnergy * 0.5 + energy * 0.25);
          const dotSize = isSpine ? 1.7 : 1.25;
          ctx.fillStyle = isSpine
            ? `rgba(255, 248, 224, ${alpha.toFixed(3)})`
            : `rgba(226, 234, 248, ${alpha.toFixed(3)})`;
          ctx.fillRect(px - dotSize * 0.5, py - dotSize * 0.5, dotSize, dotSize);
        }
      }
    }
  }

  function drawConvergenceCore(cx, cy, energy) {
    const neckY = height * 0.48;

    // Soft radial bloom behind the convergence neck and upper column
    const bloomR = Math.min(width, height) * (0.34 + energy * 0.12);
    const bloom = ctx.createRadialGradient(cx, neckY - height * 0.08, 2, cx, neckY - height * 0.08, bloomR);
    bloom.addColorStop(0, `rgba(255, 225, 160, ${(0.26 + energy * 0.24).toFixed(3)})`);
    bloom.addColorStop(0.45, `rgba(255, 165, 72, ${(0.09 + energy * 0.1).toFixed(3)})`);
    bloom.addColorStop(1, 'rgba(5, 6, 8, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    // Thin tilted horizontal orbital ring at the convergence neck (exact JEV motif)
    const ringRx = Math.min(width * 0.065, 46) * (1 + energy * 0.08);
    const ringRy = ringRx * 0.32;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, neckY + 4, ringRx, ringRy, -0.08, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 214, 148, ${(0.46 + energy * 0.3).toFixed(3)})`;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // Orbiting telemetry node on the ring
    const orbAngle = state.time * 1.45;
    const ox = cx + Math.cos(orbAngle) * ringRx;
    const oy = neckY + 4 + Math.sin(orbAngle) * ringRy;
    ctx.beginPath();
    ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 246, 218, 0.92)';
    ctx.fill();
    ctx.restore();

    // Glowing warm-amber focal sphere at the junction
    const coreR = 5.5 + energy * 4.5;
    const coreGrad = ctx.createRadialGradient(cx, neckY, 0.5, cx, neckY, coreR * 2.6);
    coreGrad.addColorStop(0, 'rgba(255, 252, 238, 0.98)');
    coreGrad.addColorStop(0.35, 'rgba(255, 174, 66, 0.88)');
    coreGrad.addColorStop(1, 'rgba(255, 132, 36, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, neckY, coreR * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPackets(cx, cy) {
    for (let i = state.packets.length - 1; i >= 0; i--) {
      const p = state.packets[i];
      p.t += p.speed;
      if (p.t >= 1) {
        state.packets.splice(i, 1);
        continue;
      }
      const side = p.lane === 'right' ? 'right' : 'left';
      const f = conduitFrame(side, p.t, cx, cy, width, height);
      const px = f.x + p.offset * f.halfW * 0.45;
      const py = f.y;
      const alpha = Math.sin(p.t * Math.PI) * 0.95;
      ctx.fillStyle = p.warm || p.t > 0.52
        ? `rgba(255, 232, 168, ${alpha.toFixed(3)})`
        : `rgba(240, 246, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(px - p.size * 0.5, py - p.size * 0.5, p.size, p.size * 1.35);
    }
  }

  function drawCharacterPedestals(cy) {
    const momoX = width * 0.31;
    const viviX = width * 0.69;
    const floorY = height - 16;

    // Subtle grounded rings beneath Momotamu and Vivi
    for (const [x, level, squish] of [
      [momoX, state.momoLevel, state.momoSquish],
      [viviX, state.viviLevel, state.viviSquish]
    ]) {
      const rx = 44 + level * 22 + Math.abs(squish) * 260;
      const ry = 8 + level * 4;
      ctx.beginPath();
      ctx.ellipse(x, floorY, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 214, 148, ${(0.18 + level * 0.45).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Backchannel nod halos
    for (let i = state.halos.length - 1; i >= 0; i--) {
      const h = state.halos[i];
      h.progress += 0.035;
      h.alpha *= 0.93;
      if (h.alpha < 0.02 || h.progress >= 1) {
        state.halos.splice(i, 1);
        continue;
      }
      const hx = h.actor === 'vivi' ? viviX : momoX;
      ctx.beginPath();
      ctx.ellipse(hx, floorY, 34 + h.progress * 52, 8 + h.progress * 12, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 230, 175, ${h.alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Barge-in interrupt shockwaves
    for (let i = state.shockwaves.length - 1; i >= 0; i--) {
      const sw = state.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * 0.11 + 3.2;
      sw.alpha *= 0.91;
      if (sw.alpha < 0.02 || sw.radius >= sw.maxRadius) {
        state.shockwaves.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(width * 0.5, cy, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 186, 92, ${sw.alpha.toFixed(3)})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }

  function drawJevTelemetry(energy) {
    // Right-edge candidate slot wireframes (as seen in the JEV reference image)
    const slotCount = 5;
    const slotW = Math.min(54, width * 0.07);
    const slotH = Math.min(18, height * 0.09);
    const rightX = width - slotW - 14;
    for (let i = 0; i < slotCount; i++) {
      const sy = 26 + i * (slotH + 5);
      if (sy + slotH > height - 28) break;
      const scoreEntry = state.telemetry.candidateScores?.[i];
      const slotScore = typeof scoreEntry==='number'?scoreEntry:scoreEntry?Number(scoreEntry.score)||0:0;
      const passedCut = slotScore >= (Number(state.telemetry.cut) || 0.6);
      const activeSlot = scoreEntry != null && passedCut;
      if (scoreEntry && slotScore > 0.04) {
        const fillW = Math.max(2, Math.min(slotW - 2, (slotW - 2) * slotScore));
        ctx.fillStyle = passedCut
          ? `rgba(255, 198, 108, ${(0.22 + slotScore * 0.28).toFixed(3)})`
          : 'rgba(160, 178, 208, 0.12)';
        ctx.fillRect(rightX + 1, sy + 1, fillW, slotH - 2);
      }
      ctx.strokeStyle = activeSlot
        ? `rgba(255, 214, 145, ${(0.36 + energy * 0.35).toFixed(3)})`
        : 'rgba(190, 204, 228, 0.12)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(rightX, sy);
      ctx.lineTo(rightX + slotW, sy);
      ctx.lineTo(rightX + slotW, sy + slotH);
      ctx.lineTo(rightX, sy + slotH);
      ctx.lineTo(rightX, sy);
      ctx.stroke();
    }

    if (typeof ctx.fillText !== 'function') return;
    ctx.save();
    ctx.font = '600 9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(214, 222, 236, 0.42)';
    const t = state.telemetry;
    ctx.fillText(`CANDIDATES  ${t.candidates}`, 14, 18);
    ctx.fillText(`CUT         ${Number(t.cut).toFixed(1)}`, 14, 30);
    ctx.fillText(`GATES       ${t.gates}`, 14, 42);

    const rightLabelX = Math.max(140, width - 155);
    ctx.fillText(`RETRY             ${t.retry}`, rightLabelX, 18);
    ctx.fillStyle = 'rgba(255, 214, 145, 0.58)';
    ctx.fillText('RELEVANCE ONLY', rightLabelX, 30);
    ctx.restore();
  }

  function render() {
    if (!enabled || !ctx || !width || !height) return;
    state.time += 0.016;

    state.inputLevel += (state.inputTarget - state.inputLevel) * 0.18;
    state.momoLevel += (state.momoTarget - state.momoLevel) * 0.18;
    state.viviLevel += (state.viviTarget - state.viviLevel) * 0.18;
    state.inputTarget *= 0.92;
    state.momoTarget *= 0.94;
    state.viviTarget *= 0.94;

    const totalEnergy = Math.min(1, (state.momoLevel + state.viviLevel + state.inputLevel) * 1.7);

    if (state.momoLevel > 0.02 && Math.random() < 0.55) spawnPacket('left', state.momoLevel);
    if (state.viviLevel > 0.02 && Math.random() < 0.55) spawnPacket('right', state.viviLevel);
    if (state.inputLevel > 0.02 && Math.random() < 0.45) {
      spawnPacket(Math.random() > 0.5 ? 'left' : 'right', state.inputLevel);
    }
    if (Math.random() < 0.18) {
      spawnPacket(Math.random() > 0.5 ? 'left' : 'right', 0.15);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Pitch-black JEV void background
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, width, height);

    // 2. Sparse point-field stars
    for (const st of state.stars) {
      const a = st.alpha + 0.05 * Math.sin(state.time * 1.7 + st.phase);
      ctx.fillStyle = `rgba(225, 232, 246, ${Math.max(0.03, a).toFixed(3)})`;
      ctx.fillRect(st.u * width, st.v * height, st.size, st.size);
    }

    const cx = width * 0.5;
    const cy = height * 0.52;

    // 3. Twin curved 3D point-matrix conduits & glowing white/amber central spine
    drawPointMatrixConduits(cx, cy, totalEnergy);

    // 4. Flowing data packets
    drawPackets(cx, cy);

    // 5. Central convergence amber orb + tilted orbital ring
    drawConvergenceCore(cx, cy, totalEnergy);

    // 6. Grounded character rings, nod halos & interrupt shockwaves
    drawCharacterPedestals(cy);

    // 7. Subtle JEV HUD telemetry & right-edge candidate slots
    drawJevTelemetry(totalEnergy);

    ctx.restore();
    rafId = requestAnimationFrame(render);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    if (enabled && canvas) {
      canvas.style.display = 'block';
      canvas.closest?.('.stage')?.setAttribute('data-holodeck', 'on');
      rafId = requestAnimationFrame(render);
    } else if (canvas) {
      canvas.style.display = 'none';
      canvas.closest?.('.stage')?.setAttribute('data-holodeck', 'off');
    }
  }

  const signals = {
    lifecycle(name, detail = {}) {
      if (name === 'speaking') {
        state.activeSpeaker = detail.actor || 'momotamu';
        spawnPacket(state.activeSpeaker === 'vivi' ? 'right' : 'left', 0.65);
      } else if (name === 'stop' || name === 'error') {
        if (detail.manual || detail.interrupted) {
          triggerShockwave(state.activeSpeaker || 'center');
        }
        state.activeSpeaker = null;
      } else if (name === 'completion' || name === 'idle') {
        state.activeSpeaker = null;
      }
    },
    audio(name, { source, actor = 'momotamu', rms = 0 } = {}) {
      const val = Math.min(1, Math.max(0, Number(rms) || 0) * 3.2);
      if (name === 'level') {
        if (source === 'input') {
          state.inputTarget = Math.max(state.inputTarget, val);
        } else if (actor === 'vivi') {
          state.viviTarget = Math.max(state.viviTarget, val);
        } else {
          state.momoTarget = Math.max(state.momoTarget, val);
        }
      } else if (name === 'end') {
        if (source === 'input') state.inputTarget = 0;
        else if (actor === 'vivi') state.viviTarget = 0;
        else state.momoTarget = 0;
      } else if (name === 'backchannel') {
        triggerHalo(actor);
      }
    },
    squish(actor, value) {
      if (actor === 'vivi') state.viviSquish = Number(value) || 0;
      else state.momoSquish = Number(value) || 0;
    },
    cancel(actor) {
      triggerShockwave(actor || 'center');
    },
    gate(result = {}) {
      if (Number.isFinite(result.candidates)) state.telemetry.candidates = result.candidates;
      if (Number.isFinite(result.cut)) state.telemetry.cut = result.cut;
      if (Number.isFinite(result.gates)) state.telemetry.gates = result.gates;
      if (Number.isFinite(result.retries)) state.telemetry.retry = result.retries;
      if (result.decision) state.telemetry.decision = result.decision;
      if (Array.isArray(result.candidateScores)) state.telemetry.candidateScores = result.candidateScores;
      spawnPacket('left', 0.8);
      spawnPacket('right', 0.8);
    },
    route(detail = {}) {
      const target = detail.speaker === 'vivi' ? 'vivi' : 'momotamu';
      state.activeSpeaker = target;
      state.telemetry.routedSpeaker = target;
      spawnPacket(target === 'vivi' ? 'right' : 'left', 0.9);
      triggerHalo(target);
    }
  };

  function init(canvasEl) {
    canvas = canvasEl;
    if (!canvas) return false;
    ctx = canvas.getContext('2d');
    initStars();
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(canvas);
    }
    startLoop();
    return true;
  }

  function setEnabled(val) {
    enabled = !!val;
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch {}
    startLoop();
    return enabled;
  }

  window.DiscussionHolodeck = {
    init,
    setEnabled,
    get enabled() { return enabled; },
    signals
  };
})();
