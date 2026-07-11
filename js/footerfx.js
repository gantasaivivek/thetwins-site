/* Footer particle field — idle swirl that coalesces into a MEANINGFUL shape
   when a footer link is hovered (the igloo.inc footer move): the five protocol
   emblems + the heart + the twins, not typed glyphs. Particles shift toward
   the twin's signal-gold with speed; the heart alone warms red. A soft glow
   surge marks each morph. */
(function () {
  const canvas = document.getElementById('footerfx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const isMobile = matchMedia('(max-width: 640px)').matches;
  const N = isMobile ? 500 : 1600;

  let W, H, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = canvas.offsetWidth * dpr;
    H = canvas.height = canvas.offsetHeight * dpr;
  }

  /* shared sampler: any white artwork on a 320x200 offscreen → particle targets */
  function sample(off) {
    const img = off.getContext('2d').getImageData(0, 0, 320, 200).data;
    const pts = [];
    for (let y = 0; y < 200; y += 3) {
      for (let x = 0; x < 320; x += 3) {
        if (img[(y * 320 + x) * 4 + 3] > 128) pts.push({ x: (x - 160) / 160, y: (y - 100) / 100 });
      }
    }
    return pts;
  }
  function glyphTargets(glyph) {
    const off = document.createElement('canvas');
    off.width = 320; off.height = 200;
    const o = off.getContext('2d');
    o.fillStyle = '#fff';
    o.font = `500 ${glyph.length > 1 ? 96 : 150}px 'IBM Plex Mono', monospace`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillText(glyph, 160, 105);
    return sample(off);
  }
  function shapeTargets(draw) {
    const off = document.createElement('canvas');
    off.width = 320; off.height = 200;
    const o = off.getContext('2d');
    o.fillStyle = '#fff'; o.strokeStyle = '#fff';
    o.lineCap = 'round'; o.lineJoin = 'round';
    draw(o);
    return sample(off);
  }
  const poly = (o, pts, close = true) => {
    o.beginPath();
    o.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) o.lineTo(pts[i][0], pts[i][1]);
    if (close) o.closePath();
  };

  /* the emblem silhouettes — the same five relics that ring the protocol scene */
  const SHAPES = {
    /* CIPHER lattice — the protocol's woven moat */
    lattice(o) {
      const nodes = [[160, 100]];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        nodes.push([160 + Math.cos(a) * 62, 100 + Math.sin(a) * 62]);
      }
      o.lineWidth = 5;
      for (let i = 1; i <= 6; i++) {
        o.beginPath(); o.moveTo(nodes[0][0], nodes[0][1]); o.lineTo(nodes[i][0], nodes[i][1]); o.stroke();
        const j = i === 6 ? 1 : i + 1;
        o.beginPath(); o.moveTo(nodes[i][0], nodes[i][1]); o.lineTo(nodes[j][0], nodes[j][1]); o.stroke();
      }
      for (const [x, y] of nodes) { o.beginPath(); o.arc(x, y, 9, 0, Math.PI * 2); o.fill(); }
    },
    /* the heart, cut as a gem — the vow */
    heart(o) {
      poly(o, [[160, 155], [104, 96], [112, 68], [136, 56], [160, 74], [184, 56], [208, 68], [216, 96]]);
      o.fill();
    },
    /* the two sovereigns, side by side */
    twins(o) {
      for (const cx of [124, 196]) {
        o.beginPath(); o.arc(cx, 52, 13, 0, Math.PI * 2); o.fill();
        poly(o, [[cx - 20, 72], [cx + 20, 72], [cx + 12, 118], [cx - 12, 118]]);
        o.fill();
        o.fillRect(cx - 11, 118, 9, 40);
        o.fillRect(cx + 2, 118, 9, 40);
      }
    },
    /* CUSTODY key — you alone hold it */
    key(o) {
      o.lineWidth = 13;
      o.beginPath(); o.arc(112, 100, 26, 0, Math.PI * 2); o.stroke();
      o.fillRect(140, 93, 88, 13);
      o.fillRect(192, 106, 11, 20);
      o.fillRect(214, 106, 11, 26);
    },
    /* INTENT dart — signed direction */
    dart(o) {
      o.lineWidth = 4;
      o.beginPath(); o.arc(160, 100, 46, 0, Math.PI * 2); o.stroke();
      poly(o, [[160, 30], [180, 100], [160, 170], [140, 100]]);
      o.fill();
    },
    /* CONTINUITY hourglass — a century held */
    hourglass(o) {
      poly(o, [[118, 48], [202, 48], [164, 100], [156, 100]]); o.fill();
      poly(o, [[118, 160], [202, 160], [164, 108], [156, 108]]); o.fill();
      o.fillRect(110, 40, 100, 8);
      o.fillRect(110, 160, 100, 8);
    },
    /* PRESENCE beacon — a live signal, reaching out */
    beacon(o) {
      o.lineWidth = 7;
      for (const r of [24, 42, 60]) { o.beginPath(); o.arc(160, 100, r, 0, Math.PI * 2); o.stroke(); }
      o.beginPath(); o.arc(160, 100, 10, 0, Math.PI * 2); o.fill();
    }
  };

  const targetSets = {
    /* navigate — the story's own iconography */
    PROTOCOL: shapeTargets(SHAPES.lattice),
    MANIFESTO: shapeTargets(SHAPES.heart),
    'TWIN LINK': shapeTargets(SHAPES.twins),
    /* resources — the remaining relics */
    docs: shapeTargets(SHAPES.key),
    blog: shapeTargets(SHAPES.dart),
    careers: shapeTargets(SHAPES.hourglass),
    email: shapeTargets(SHAPES.beacon),
    /* socials keep their brand marks (glyphs ARE the meaning here) */
    x: glyphTargets('X'), linkedin: glyphTargets('in'), github: glyphTargets('</>'),
    discord: glyphTargets('◆'), youtube: glyphTargets('▶')
  };
  const WARM = new Set(['MANIFESTO']);          // the heart alone warms red

  let P = [];
  function initParticles() {
    P = Array.from({ length: N }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: 0, vy: 0,
      seed: Math.random() * Math.PI * 2,
      ti: (Math.random() * 4096) | 0
    }));
  }

  let mode = null;     // null = idle swirl, else key into targetSets
  document.querySelectorAll('.footer-links a').forEach(a => {
    const key = a.textContent.trim().toUpperCase();
    if (!targetSets[key]) return;
    a.addEventListener('mouseenter', () => { mode = key; });
    a.addEventListener('mouseleave', () => { mode = null; });
  });
  document.querySelectorAll('#footer a[data-link]').forEach(a => {
    const key = a.dataset.link;
    if (!targetSets[key]) return;
    a.addEventListener('mouseenter', () => { mode = key; });
    a.addEventListener('mouseleave', () => { mode = null; });
  });

  let t0 = performance.now();
  let glow = 0, lastMode = null;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!canvas.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;   // offscreen: skip work
    // reduced motion: hold the particle field on one frozen instant
    const dt = REDUCED ? 0 : Math.min((now - t0) / 16.7, 3);
    t0 = now;
    const t = REDUCED ? 0 : now * 0.001;

    /* a morph begins: surge the glow, ping the telemetry chime (sound-gated) */
    if (mode !== lastMode) {
      if (mode && glow < 0.5) { glow = 1; window.SFX?.telemetry?.(); }
      else if (mode) glow = 1;
      lastMode = mode;
    }
    glow *= Math.pow(0.955, dt);

    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.42;
    const scale = Math.min(W, H * 1.6) * 0.28;
    const targets = mode ? targetSets[mode] : null;
    const warm = mode && WARM.has(mode);

    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (targets) {
        const tg = targets[p.ti % targets.length];
        const txp = cx + tg.x * scale;
        const typ = cy + tg.y * scale * 0.62;
        p.vx += (txp - p.x) * 0.012 * dt;
        p.vy += (typ - p.y) * 0.012 * dt;
        p.vx *= 0.86; p.vy *= 0.86;
      } else {
        // idle: a quiet orbital halo — banded rings drifting around the
        // centre (the old figure-eight read as scribbles, not a system)
        const band = 0.55 + 0.45 * Math.sin(p.seed * 7.3);          // ring radius per particle
        const a = t * (0.05 + 0.06 * Math.sin(p.seed * 3.1)) + p.seed * Math.PI * 2;
        const wobble = 1 + 0.05 * Math.sin(t * 0.5 + p.seed * 9.0); // rings breathe
        const txp = cx + Math.cos(a) * W * 0.30 * band * wobble;
        const typ = cy + Math.sin(a) * H * 0.24 * band * wobble;
        p.vx += (txp - p.x) * 0.0018 * dt;
        p.vy += (typ - p.y) * 0.0018 * dt;
        p.vx *= 0.95; p.vy *= 0.95;
      }
      if (p.x === undefined || isNaN(p.x)) { p.x = cx; p.y = cy; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const speed = Math.min(Math.hypot(p.vx, p.vy) / (3 * dpr), 1);
      /* velocity → colour: still = slate, fast = the twin's signal GOLD;
         on the heart, stillness warms to the human red instead */
      let r, g, b;
      if (warm) {
        r = 178 - 92 * speed; g = 66 + 26 * speed; b = 50 + 60 * speed;
      } else {
        r = 108 + 118 * speed; g = 114 + 52 * speed; b = 128 - 52 * speed;
      }
      const alpha = 0.35 + speed * 0.5 + glow * 0.2;
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
      const s = (1 + speed * 1.6) * (1 + glow * 0.7) * dpr;
      ctx.fillRect(p.x, p.y, s, s);
    }

    /* the morph surge — one soft radial flash under the swarm */
    if (glow > 0.03) {
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 1.25);
      const tint = warm ? '255,122,92' : '159,224,255';
      gr.addColorStop(0, `rgba(${tint},${(glow * 0.16).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(159,224,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(cx - scale * 1.25, cy - scale * 1.25, scale * 2.5, scale * 2.5);
    }

    // pedestal rings beneath the swarm
    ctx.strokeStyle = 'rgba(76,79,83,0.18)';
    ctx.lineWidth = dpr;
    for (const r of [0.34, 0.24, 0.13]) {
      ctx.beginPath();
      ctx.ellipse(cx, H * 0.80, W * r, W * r * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  addEventListener('resize', () => { resize(); });
  resize();
  initParticles();
  requestAnimationFrame(frame);

  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawFooter = () => frame(performance.now());
  }
})();
