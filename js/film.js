/* The deconstruction film — AI-generated (Higgsfield/Seedance), scrubbed
   by scroll. The crystalline figure breaks apart into floating ice blocks
   across the descent's middle act; frost wipes in world.js mask the
   handoff into and out of the footage (igloo-style transition).
   Frames live in assets/video/decon/frame-XXXX.jpg. If they are missing,
   FILM.ready stays false and the WebGL shard cloud carries the act alone. */
(function () {
  const FRAME_COUNT = 120;               // set by extraction step
  const SRC = i => `assets/video/decon/frame-${String(i + 1).padStart(4, '0')}.jpg`;

  /* the film owns the frame during the deconstruction act */
  const FADE_IN = [0.42, 0.47];
  const FADE_OUT = [0.58, 0.63];
  const SCRUB = [0.44, 0.60];

  /* bright arctic fog — feather the footage into the page, not into black */
  const FOG = '198,204,212';

  const stage = document.getElementById('hero-stage');
  const canvas = document.createElement('canvas');
  canvas.id = 'film';
  stage.appendChild(canvas);
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;z-index:2;display:block;pointer-events:none;';
  const ctx = canvas.getContext('2d');

  const frames = new Array(FRAME_COUNT).fill(null);
  let loaded = 0, ready = false, failed = false;
  let progress = 0;
  let W, H, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = (stage.offsetWidth || innerWidth) * dpr;
    H = canvas.height = (stage.offsetHeight || innerHeight) * dpr;
  }

  function load(i) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { frames[i] = img; loaded++; res(true); };
      img.onerror = () => res(false);
      img.src = SRC(i);
    });
  }

  async function boot() {
    // probe: if the first frame is missing, frames were not generated yet
    if (!(await load(0))) { failed = true; return; }
    // coarse pass (every 8th) so scrubbing works early, then fill in
    const coarse = [], fine = [];
    for (let i = 1; i < FRAME_COUNT; i++) (i % 8 === 0 ? coarse : fine).push(i);
    await Promise.all(coarse.map(load));
    ready = true;
    fine.reduce((p, i) => p.then(() => load(i)), Promise.resolve());
  }

  function nearestFrame(idx) {
    if (frames[idx]) return frames[idx];
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (frames[idx - d]) return frames[idx - d];
      if (frames[idx + d]) return frames[idx + d];
    }
    return null;
  }

  const clamp01 = t => Math.min(Math.max(t, 0), 1);
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const seg = (p, a, b) => smooth((p - a) / (b - a));

  function frame() {
    requestAnimationFrame(frame);
    if (!ready) return;

    const p = progress;
    const alpha = seg(p, FADE_IN[0], FADE_IN[1]) * (1 - seg(p, FADE_OUT[0], FADE_OUT[1]));
    ctx.clearRect(0, 0, W, H);
    if (alpha <= 0.001) return;

    const f = clamp01((p - SCRUB[0]) / (SCRUB[1] - SCRUB[0]));
    const idx = Math.min(FRAME_COUNT - 1, Math.round(f * (FRAME_COUNT - 1)));
    const img = nearestFrame(idx);
    if (!img) return;

    // cover-fit the footage
    const vr = img.width / img.height;
    const cr = W / H;
    let dw, dh;
    if (cr > vr) { dw = W; dh = W / vr; } else { dh = H; dw = H * vr; }
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);

    // feather the edges into the arctic fog
    const edges = [
      ctx.createLinearGradient(0, 0, 0, H * 0.16),
      ctx.createLinearGradient(0, H, 0, H * 0.84),
      ctx.createLinearGradient(0, 0, W * 0.10, 0),
      ctx.createLinearGradient(W, 0, W * 0.90, 0)
    ];
    for (const g of edges) {
      g.addColorStop(0, `rgba(${FOG},0.9)`);
      g.addColorStop(1, `rgba(${FOG},0)`);
    }
    ctx.fillStyle = edges[0]; ctx.fillRect(0, 0, W, H * 0.16);
    ctx.fillStyle = edges[1]; ctx.fillRect(0, H * 0.84, W, H * 0.16);
    ctx.fillStyle = edges[2]; ctx.fillRect(0, 0, W * 0.10, H);
    ctx.fillStyle = edges[3]; ctx.fillRect(W * 0.90, 0, W * 0.10, H);
    ctx.globalAlpha = 1;
  }

  addEventListener('resize', resize);
  resize();
  boot();
  requestAnimationFrame(frame);

  window.FILM = {
    get ready() { return ready; },
    get failed() { return failed; },
    setProgress(v) { progress = clamp01(v); }
  };
  // dev-only (?forcetick): allow forcing a synchronous draw from eval
  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawFilm = () => frame();
  }
})();
