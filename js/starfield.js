/* Starfield + ambient drift backdrop.
   Paints the background gradient each frame, lerped between the silvery
   surface palette and deep space by window.__scrollP (0..1), so the whole
   page "descends" from daylight ice into interstellar dark as you scroll. */
(function () {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');

  const LIGHT_TOP = [0xc9, 0xd0, 0xdf];
  const LIGHT_BOT = [0xa0, 0xa5, 0xb1];
  const DARK_TOP = [0x16, 0x18, 0x1d];
  const DARK_BOT = [0x2b, 0x30, 0x38];

  let w, h, dpr, stars = [], motes = [];
  const isMobile = matchMedia('(max-width: 640px)').matches;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return `rgb(${lerp(c1[0], c2[0], t) | 0},${lerp(c1[1], c2[1], t) | 0},${lerp(c1[2], c2[2], t) | 0})`;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';

    const starCount = isMobile ? 140 : 320;
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.1 + 0.3) * dpr,
      tw: Math.random() * Math.PI * 2,
      ts: 0.4 + Math.random() * 1.2,
      drift: (Math.random() - 0.5) * 0.03 * dpr
    }));

    const moteCount = isMobile ? 24 : 60;
    motes = Array.from({ length: moteCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.6 + 0.6) * dpr,
      vx: (Math.random() - 0.5) * 0.12 * dpr,
      vy: (-0.06 - Math.random() * 0.1) * dpr,
      a: 0.1 + Math.random() * 0.25
    }));
  }

  let t0 = performance.now();
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    /* the opaque WebGL film fully covers this canvas for the entire pinned
       journey — skip ALL painting there (~25% of a mobile GPU frame saved);
       painting resumes the instant the pin releases into the reading deck */
    if (window.__filmPinned) { t0 = now; requestAnimationFrame(frame); return; }
    // reduced motion: sky still responds to scroll, drift/twinkle freeze
    const dt = REDUCED ? 0 : Math.min((now - t0) / 16.7, 3);
    t0 = now;
    const p = Math.min(Math.max(window.__scrollP || 0, 0), 1);

    // background gradient: silvery ice -> deep space
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, mix(LIGHT_TOP, DARK_TOP, p));
    g.addColorStop(1, mix(LIGHT_BOT, DARK_BOT, p));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // stars fade in as the sky darkens
    const starAlpha = Math.max(0, (p - 0.15) / 0.5);
    if (starAlpha > 0) {
      for (const s of stars) {
        s.tw += 0.02 * s.ts * dt;
        s.x += s.drift * dt;
        if (s.x < 0) s.x += w; else if (s.x > w) s.x -= w;
        const twinkle = 0.5 + 0.5 * Math.sin(s.tw);
        ctx.globalAlpha = Math.min(starAlpha, 1) * (0.25 + 0.75 * twinkle);
        ctx.fillStyle = '#e1e6f1';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // frost motes drift always — nothing is ever still
    for (const m of motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w; }
      if (m.x < -10) m.x = w + 10; else if (m.x > w + 10) m.x = -10;
      ctx.globalAlpha = m.a * (0.5 + 0.5 * p) + m.a * 0.4 * (1 - p);
      ctx.fillStyle = p > 0.5 ? '#a7b2d6' : '#ffffff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
  // dev-only (?forcetick): allow forcing a synchronous draw from eval
  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawStars = () => frame(performance.now());
  }
})();
