/* The vault film — AI-generated (Higgsfield/Seedance 1080p), scrubbed by
   scroll. The finale dives INSIDE the Centennial Vault: an extreme macro of
   the glacial cube, frost snowflakes etched in the ice, and the crystallized
   heart-gem blazing awake as the whiteout blooms. Frames live in
   assets/video/vault/frame-XXXX.jpg. If missing, VAULTFILM.ready stays false
   and the live WebGL vault carries the beat alone. */
(function () {
  const FRAME_COUNT = 120;               // set by extraction step
  const SRC = i => `assets/video/vault/frame-${String(i + 1).padStart(4, '0')}.jpg`;

  /* the film owns the frame for the finale — it rises after the wide vault
     shot has rested (scroll snap at 0.91), scrubs the gem awake, and hands
     into the whiteout */
  /* THE BREACH — windows in MASTER progress space: the macro zoom into
     the frosted ice owns the vault rest, then hands to the dive film
     (opaque by 0.622) under the breach frost veil */
  const FADE_IN = [0.586, 0.600];
  const FADE_OUT = [0.618, 0.634];
  const SCRUB = [0.586, 0.634];

  /* bright arctic fog — feather the footage into the page, not into black */
  const FOG = '198,204,212';

  const stage = document.getElementById('hero-stage');
  const canvas = document.createElement('canvas');
  canvas.id = 'vaultfilm';
  stage.appendChild(canvas);
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;z-index:3;display:block;pointer-events:none;';
  const ctx = canvas.getContext('2d');

  const frames = new Array(FRAME_COUNT).fill(null);
  let loaded = 0, ready = false, failed = false, booted = false;
  let progress = 0;
  let W, H, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = (stage.offsetWidth || innerWidth) * dpr;
    H = canvas.height = (stage.offsetHeight || innerHeight) * dpr;
  }

  /* decode OFF the main thread and pin a predictable footprint: frames are
     resized at decode to the canvas width (a 375px phone quarters its decoded
     memory vs 120×1440×810 RGBA ≈ 535MB worst-case; desktop keeps full res).
     drawImage accepts ImageBitmap unchanged; the Image() path remains for
     engines without createImageBitmap resize options. */
  function loadImg(i) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { frames[i] = img; loaded++; res(true); };
      img.onerror = () => res(false);
      img.src = SRC(i);
    });
  }
  function load(i) {
    if (window.createImageBitmap) {
      const rw = Math.min(1440, Math.max(720, Math.ceil(W || 1440)));
      return fetch(SRC(i))
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then(b => createImageBitmap(b, { resizeWidth: rw, resizeQuality: 'high' }))
        .then(bm => { frames[i] = bm; loaded++; return true; })
        .catch(() => loadImg(i));
    }
    return loadImg(i);
  }

  /* lazy boot: ~8MB of frames only start downloading once the visitor is
     past the midpoint of the experience (perf budget — never on first load) */
  async function boot() {
    if (booted) return;
    booted = true;
    if (!(await load(0))) { failed = true; return; }
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

    // cover-fit the footage — capping the portrait crop: full cover on a tall
    // screen shows only ~26% of the frame width and loses the cube entirely
    // (the finale must read INSIDE the vault, not "frost texture with a gem").
    // 0.78 keeps the cube readable while filling far more of a phone screen
    // than the old 0.55 band ever did
    const vr = img.width / img.height;
    const cr = W / H;
    let dw, dh;
    if (cr > vr) { dw = W; dh = W / vr; }
    else { dw = Math.min(H * vr, W / 0.78); dh = dw / vr; }
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);

    /* feather: heavy only where the drawn rect leaves the viewport short
       (portrait insets melt into the page fog); over a full-bleed frame it
       is a whisper — a wide 0.9-alpha band reads as a letterbox border */
    const cov = dy <= 1 && dx <= 1;
    const bandV = cov ? H * 0.05 : Math.min(dh, H) * 0.16;
    const bandS = cov ? W * 0.04 : W * 0.10;
    const aE = cov ? 0.0 : 0.9;   // full-bleed frames get NO border wash — it read as an inset patch
    const fTop = Math.max(0, dy), fBot = Math.min(H, dy + dh);
    /* letterboxed (portrait): the void zones above/below the band fill with
       fog at the film's own alpha — the band floats in weather instead of
       hard-seaming against the live scene behind */
    if (!cov) {
      ctx.fillStyle = `rgba(${FOG},0.92)`;
      if (fTop > 0) ctx.fillRect(0, 0, W, fTop);
      if (fBot < H) ctx.fillRect(0, fBot, W, H - fBot);
    }
    const edges = [
      ctx.createLinearGradient(0, fTop, 0, fTop + bandV),
      ctx.createLinearGradient(0, fBot, 0, fBot - bandV),
      ctx.createLinearGradient(0, 0, bandS, 0),
      ctx.createLinearGradient(W, 0, W - bandS, 0)
    ];
    for (const g of edges) {
      g.addColorStop(0, `rgba(${FOG},${aE})`);
      g.addColorStop(1, `rgba(${FOG},0)`);
    }
    ctx.fillStyle = edges[0]; ctx.fillRect(0, fTop, W, bandV);
    ctx.fillStyle = edges[1]; ctx.fillRect(0, fBot - bandV, W, bandV);
    ctx.fillStyle = edges[2]; ctx.fillRect(0, 0, bandS, H);
    ctx.fillStyle = edges[3]; ctx.fillRect(W - bandS, 0, bandS, H);
    ctx.globalAlpha = 1;
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  window.VAULTFILM = {
    get ready() { return ready; },
    get failed() { return failed; },
    setProgress(v) {
      progress = clamp01(v);
      if (!booted && progress > 0.40) boot();
    }
  };
  // dev-only (?forcetick): allow forcing a synchronous draw from eval
  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawVaultFilm = () => frame();
    window.__bootVaultFilm = () => boot();
  }
})();
