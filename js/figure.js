/* The crystalline twin — a particle-shard human figure.
   Scroll progress (0..1) drives the choreography:
     0.00–0.15  assembled single figure, ambient rotation
     0.15–0.28  the figure splits into two — human and digital twin
     0.40–0.60  authentication scan sweeps the twins
     0.62–0.82  intent bridge ignites between them (amber)
     0.86–1.00  dissolve upward into the starfield
   Exposes window.HERO = { setProgress, arrive } so the scroll system
   (and later, an AI-video layer) can drive it. */
(function () {
  const canvas = document.getElementById('figure');
  const ctx = canvas.getContext('2d');
  const isMobile = matchMedia('(max-width: 640px)').matches;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COUNT = isMobile ? 1100 : 2300;
  const LINK_DIST = 26; // figure-space link threshold for the plexus web

  let W, H, dpr, cx, cy, scale;
  let progress = 0;      // scroll progress 0..1
  let arrival = 0;       // 0 = scattered (pre-loader), 1 = assembled
  let rotY = 0;

  /* ---------- sample a human silhouette ---------- */
  function silhouettePoints() {
    const off = document.createElement('canvas');
    off.width = 200; off.height = 320;
    const o = off.getContext('2d');
    o.fillStyle = '#fff';

    // head
    o.beginPath(); o.arc(100, 42, 26, 0, Math.PI * 2); o.fill();
    // neck
    o.fillRect(90, 64, 20, 16);
    // torso (shoulders tapering to waist)
    o.beginPath();
    o.moveTo(52, 84);
    o.quadraticCurveTo(100, 70, 148, 84);
    o.quadraticCurveTo(142, 150, 128, 178);
    o.lineTo(72, 178);
    o.quadraticCurveTo(58, 150, 52, 84);
    o.fill();
    // arms
    o.beginPath();
    o.moveTo(52, 86); o.quadraticCurveTo(38, 130, 44, 186);
    o.lineTo(58, 188); o.quadraticCurveTo(56, 140, 66, 96); o.fill();
    o.beginPath();
    o.moveTo(148, 86); o.quadraticCurveTo(162, 130, 156, 186);
    o.lineTo(142, 188); o.quadraticCurveTo(144, 140, 134, 96); o.fill();
    // hips + legs
    o.beginPath();
    o.moveTo(72, 178); o.lineTo(128, 178);
    o.lineTo(124, 205); o.lineTo(76, 205); o.fill();
    o.beginPath();
    o.moveTo(76, 205); o.lineTo(97, 205); o.lineTo(94, 296); o.lineTo(80, 296); o.fill();
    o.beginPath();
    o.moveTo(103, 205); o.lineTo(124, 205); o.lineTo(120, 296); o.lineTo(106, 296); o.fill();

    const img = o.getImageData(0, 0, 200, 320).data;
    const inside = (x, y) =>
      x >= 0 && y >= 0 && x < 200 && y < 320 && img[(y * 200 + x) * 4 + 3] > 128;

    // contour pixels give the figure a crisp outline
    const edges = [];
    for (let y = 1; y < 319; y += 2) {
      for (let x = 1; x < 199; x += 2) {
        if (inside(x, y) &&
            (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) {
          edges.push({ x: x - 100, y: y - 160 });
        }
      }
    }

    const pts = [];
    let guard = 0;
    while (pts.length < COUNT && guard < COUNT * 400) {
      guard++;
      const x = Math.random() * 200;
      const y = Math.random() * 320;
      if (inside(x | 0, y | 0)) {
        // center the figure: x in [-100,100], y in [-160,160]
        pts.push({ x: x - 100, y: y - 160 });
      }
    }
    return { pts, edges };
  }

  /* ---------- particles ---------- */
  const P = [];
  function buildParticles() {
    const { pts, edges } = silhouettePoints();
    for (let i = 0; i < COUNT; i++) {
      const twin = i % 2;                       // 0 = human, 1 = digital twin
      // ~30% of particles trace the contour for a crisp silhouette
      const onEdge = edges.length > 0 && i % 10 < 3;
      const src = onEdge
        ? edges[(Math.random() * edges.length) | 0]
        : pts[i % pts.length];
      const jitter = onEdge ? 1.2 : 0;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const R = 420 + Math.random() * 700;      // scatter shell
      P.push({
        bx: src.x + (Math.random() - 0.5) * jitter,
        by: src.y + (Math.random() - 0.5) * jitter,
        bz: (Math.random() - 0.5) * (onEdge ? 16 : 44), // volume depth
        sx: R * Math.sin(ph) * Math.cos(th),
        sy: R * Math.sin(ph) * Math.sin(th) * 0.7 - 120,
        sz: R * Math.cos(ph),
        twin,
        edge: onEdge,
        seed: Math.random() * Math.PI * 2,
        size: onEdge ? 1.1 + Math.random() * 1.2 : 0.8 + Math.random() * 1.7,
        bridge: !onEdge && Math.random() < 0.12, // candidates for the intent bridge
        bt: Math.random()                        // position along the bridge
      });
    }
    // plexus links, precomputed in figure space (per twin)
    const cell = LINK_DIST;
    const grid = new Map();
    P.forEach((p, i) => {
      const k = `${p.twin}|${(p.bx / cell) | 0}|${(p.by / cell) | 0}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const links = [];
    P.forEach((p, i) => {
      const gx = (p.bx / cell) | 0, gy = (p.by / cell) | 0;
      for (let ox = 0; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        if (ox === 0 && oy <= 0) continue;
        const arr = grid.get(`${p.twin}|${gx + ox}|${gy + oy}`) || [];
        for (const j of arr) {
          const q = P[j];
          const d = Math.hypot(p.bx - q.bx, p.by - q.by, p.bz - q.bz);
          if (d < LINK_DIST && links.length < (isMobile ? 900 : 2600) && Math.random() < 0.35) {
            links.push([i, j]);
          }
        }
      }
    });
    return links;
  }
  const LINKS = buildParticles();

  /* ---------- helpers ---------- */
  const clamp01 = t => Math.min(Math.max(t, 0), 1);
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const seg = (p, a, b) => smooth((p - a) / (b - a));
  const lerp = (a, b, t) => a + (b - a) * t;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = canvas.offsetWidth * dpr;
    H = canvas.height = canvas.offsetHeight * dpr;
    cx = W / 2;
    cy = H * 0.54;
    scale = Math.min(W, H * 0.92) / 420;
  }

  /* ---------- render ---------- */
  const proj = new Float32Array(COUNT * 3); // x, y, depthScale per particle
  let t0 = performance.now();

  function frame(now) {
    if (!canvas.isConnected) return;   // world.js removed us — stop the loop
    // reduced motion: scroll choreography stays, ambient turn freezes
    const dt = REDUCED ? 0 : Math.min((now - t0) / 16.7, 3);
    t0 = now;
    const p = progress;

    // choreography weights
    const split = seg(p, 0.15, 0.28);                 // one figure -> twins
    const scanW = seg(p, 0.40, 0.46) * (1 - seg(p, 0.58, 0.64));
    const scanY = lerp(-190, 190, seg(p, 0.42, 0.60)); // sweep top->bottom
    const bridge = seg(p, 0.62, 0.74) * (1 - seg(p, 0.84, 0.92));
    const dissolve = seg(p, 0.86, 1.0);
    const asm = arrival * (1 - dissolve);              // assembled amount

    // scene drifts away from whichever annotation card is on screen
    // (cards 1 & 3 sit left -> scene right; card 2 sits right -> scene left)
    const w1 = seg(p, 0.14, 0.20) * (1 - seg(p, 0.30, 0.36));
    const w2 = seg(p, 0.39, 0.45) * (1 - seg(p, 0.55, 0.61));
    const w3 = seg(p, 0.64, 0.70) * (1 - seg(p, 0.80, 0.86));
    const shift = isMobile ? 0 : 95 * (w1 - w2 + w3);

    rotY += dt * 0.0035 * (1 - split * 0.7);           // ambient turn, calms after split
    const wob = Math.sin(now * 0.0004);

    ctx.clearRect(0, 0, W, H);

    const twinGap = 120 * split;                        // px in figure space
    const cosR = Math.cos(rotY * (1 - split)),          // twins face forward
          sinR = Math.sin(rotY * (1 - split));

    for (let i = 0; i < P.length; i++) {
      const pt = P[i];

      // figure-space base with twin offset (twin B mirrors in x)
      let fx = pt.twin === 1 ? -pt.bx : pt.bx;
      let fy = pt.by;
      let fz = pt.bz;
      const gap = pt.twin === 1 ? twinGap : -twinGap;

      // intent bridge: some particles leave the body and form the link line
      if (pt.bridge && bridge > 0) {
        const bxT = lerp(-twinGap, twinGap, pt.bt);
        const byT = -40 + Math.sin(pt.bt * Math.PI) * -18 + Math.sin(now * 0.002 + pt.seed) * 4;
        fx = lerp(fx, bxT - gap, bridge);
        fy = lerp(fy, byT, bridge);
        fz = lerp(fz, 0, bridge);
      }

      // ambient rotation (single-figure phase rotates the whole body)
      let rx = fx * cosR - fz * sinR;
      let rz = fx * sinR + fz * cosR;
      rx += gap;

      // breathe + shimmer
      const breathe = Math.sin(now * 0.0011 + pt.seed) * 1.6;

      // assembled <-> scattered
      const ax = lerp(pt.sx, rx + breathe * 0.4, asm);
      const ay = lerp(pt.sy, fy + breathe, asm);
      const az = lerp(pt.sz, rz, asm);

      // dissolve drifts upward
      const dy = dissolve * (-260 - 340 * ((pt.seed / Math.PI) % 1));

      // perspective projection
      const zc = 620 / (620 + az * (1 - dissolve * 0.5));
      proj[i * 3] = cx + (ax + wob * 4 + shift) * scale * zc;
      proj[i * 3 + 1] = cy + (ay + dy) * scale * zc;
      proj[i * 3 + 2] = zc;
    }

    // plexus web
    const webAlpha = asm * 0.34 * (1 - split * 0.25);
    if (webAlpha > 0.01) {
      ctx.lineWidth = Math.max(dpr * 0.5, 0.5);
      ctx.strokeStyle = 'rgba(225,230,241,0.5)';
      ctx.beginPath();
      for (const [i, j] of LINKS) {
        const x1 = proj[i * 3], y1 = proj[i * 3 + 1];
        const x2 = proj[j * 3], y2 = proj[j * 3 + 1];
        if (Math.abs(x1 - x2) + Math.abs(y1 - y2) > 60 * dpr) continue;
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.globalAlpha = webAlpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // particles
    for (let i = 0; i < P.length; i++) {
      const pt = P[i];
      const x = proj[i * 3], y = proj[i * 3 + 1], zc = proj[i * 3 + 2];
      let a = (0.28 + 0.62 * ((zc - 0.7) / 0.6)) * (0.25 + 0.75 * arrival);
      if (pt.edge) a = Math.min(1, a * 1.45);
      a *= (1 - dissolve * 0.9);

      // palette: human = frost white, twin = ice blue
      let color = pt.twin === 1 ? '209,227,255' : '236,240,248';

      // authentication scan: particles near the sweep line flare
      if (scanW > 0.01) {
        const d = Math.abs(pt.by - scanY);
        if (d < 26) {
          const f = (1 - d / 26) * scanW;
          a = Math.min(1, a + f * 0.9);
          color = '255,255,255';
        }
      }
      // intent bridge glows amber
      if (pt.bridge && bridge > 0.01) {
        color = '205,160,94';
        a = Math.min(1, a + bridge * 0.5);
      }

      const glint = 0.75 + 0.25 * Math.sin(now * 0.003 + pt.seed * 7);
      ctx.fillStyle = `rgba(${color},${(a * glint).toFixed(3)})`;
      const s = pt.size * dpr * zc;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    // scan line itself
    const sx0 = cx + shift * scale;
    if (scanW > 0.01) {
      const sy = cy + scanY * scale;
      const grad = ctx.createLinearGradient(sx0 - 300 * scale, 0, sx0 + 300 * scale, 0);
      grad.addColorStop(0, 'rgba(181,213,255,0)');
      grad.addColorStop(0.5, `rgba(181,213,255,${0.55 * scanW})`);
      grad.addColorStop(1, 'rgba(181,213,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx0 - 300 * scale, sy - dpr * 0.5, 600 * scale, dpr);
    }

    // ground glow under the figure(s)
    if (asm > 0.01) {
      const gy = cy + 175 * scale;
      const gw = (split > 0 ? 300 : 200) * scale;
      const g = ctx.createRadialGradient(sx0, gy, 0, sx0, gy, gw);
      g.addColorStop(0, `rgba(181,213,255,${0.10 * asm * (1 - dissolve)})`);
      g.addColorStop(1, 'rgba(181,213,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx0, gy, gw, gw * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  /* ---------- public interface ---------- */
  // dev-only (?forcetick): allow forcing a synchronous draw from eval
  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawFigure = () => frame(performance.now());
  }
  window.HERO = {
    setProgress(v) { progress = clamp01(v); },
    // called once when the loader completes: shards fly in and assemble
    arrive(duration = 2.4) {
      if (REDUCED) { arrival = 1; return; }   // no fly-in, assemble instantly
      const obj = { v: arrival };
      if (window.gsap) {
        gsap.to(obj, {
          v: 1, duration, ease: 'power2.inOut',
          onUpdate: () => { arrival = obj.v; }
        });
      } else {
        arrival = 1;
      }
    }
  };
})();
