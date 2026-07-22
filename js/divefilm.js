/* THE DESCENT — the plunge through the ice, scrubbed by scroll.
   A Higgsfield-chained macro film (fissure keyframe → breach → throat →
   arrival): the camera dives straight down the vault's shaft — crystalline
   walls rushing past, cyan veins streaking, the red ember below growing —
   and bursts into the light of the heart cavern. It bridges the surface
   acts and the live WebGL interior; windows are in MASTER progress space
   (not the legacy warp). Frames live in assets/video/dive/frame-XXXX.jpg.
   If missing, DIVEFILM.ready stays false and the journey frost-blinks
   straight into the cavern. */
(function () {
  const FRAME_COUNT = 121;               // set by extraction step
  const SRC = i => `assets/video/dive/frame-${String(i + 1).padStart(4, '0')}.jpg`;

  /* the breach veil hands in; the cavern's light floods the hand-off out */
  const FADE_IN = [0.598, 0.622];
  const FADE_OUT = [0.752, 0.778];
  const SCRUB = [0.598, 0.775];

  /* bright arctic fog — feather the footage into the page, not into black */
  const FOG = '198,204,212';

  const stage = document.getElementById('hero-stage');
  const canvas = document.createElement('canvas');
  canvas.id = 'divefilm';
  stage.appendChild(canvas);
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;z-index:3;display:block;pointer-events:none;';
  const ctx = canvas.getContext('2d');

  const frames = new Array(FRAME_COUNT).fill(null);
  let loaded = 0, ready = false, failed = false, booted = false;
  let idxS = -1, idxClock = 0;    // low-passed scrub index (jump-cut killer)
  let progress = 0;
  let W, H, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = (stage.offsetWidth || innerWidth) * dpr;
    H = canvas.height = (stage.offsetHeight || innerHeight) * dpr;
  }

  /* decode off the main thread, resized to the canvas width — same policy as
     the seal film (a phone quarters its decoded footprint) */
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

  /* lazy boot once the visitor is approaching the beat (never on first load);
     coarse pass first so scrubbing works early, fine pass fills in behind */
  async function boot() {
    if (booted) return;
    booted = true;
    if (!(await load(0))) { failed = true; return; }
    const coarse = [], fine = [];
    for (let i = 1; i < FRAME_COUNT; i++) (i % 8 === 0 ? coarse : fine).push(i);
    await Promise.all(coarse.map(load));
    ready = true;
    /* nearest-first fine fill: resolve the frames around where the visitor
       actually is, not in file order -- a beat you rest on sharpens first */
    const pending = new Set(fine);
    (async () => {
      while (pending.size) {
        let best = -1, bd = 1e9;
        const at = idxS < 0 ? 0 : idxS;
        for (const i of pending) {
          const d = Math.abs(i - at);
          if (d < bd) { bd = d; best = i; }
        }
        pending.delete(best);
        await load(best);
      }
    })();
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
    const idxT = Math.min(FRAME_COUNT - 1, Math.round(f * (FRAME_COUNT - 1)));
    /* low-pass the drawn index: a wheel flick becomes a beat of fast-motion
       playback instead of a 10-frame jump cut. Big jumps (deep links, snap
       teleports) snap directly -- never play a fast-forward reel. */
    const nowT = performance.now();
    const dtS = Math.min(0.1, (nowT - (idxClock || nowT)) / 1000);
    idxClock = nowT;
    if (idxS < 0 || Math.abs(idxT - idxS) > 30) idxS = idxT;
    else idxS += (idxT - idxS) * Math.min(1, dtS * 14);
    const idx = Math.round(idxS);
    const img = nearestFrame(idx);
    if (!img) return;

    // true cover-fit — the dive is an abstract centered shaft, so a full
    // cover crop is safe on every aspect (the ember stays centered); the old
    // portrait cap letterboxed the plunge into a floating band on phones
    const vr = img.width / img.height;
    const cr = W / H;
    let dw, dh;
    if (cr > vr) { dw = W; dh = W / vr; }
    else { dw = H * vr; dh = H; }
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);

    /* feather: heavy only where the drawn rect leaves the viewport short;
       over a full-bleed frame it is a whisper of atmosphere — the old 16%
       0.9-alpha band read as a white letterbox border on dark frames */
    const cov = dy <= 1 && dx <= 1;
    const bandV = cov ? H * 0.05 : Math.min(dh, H) * 0.16;
    const bandS = cov ? W * 0.04 : W * 0.10;
    const aE = cov ? 0.0 : 0.9;   // full-bleed frames get NO border wash — it read as an inset patch
    const fTop = Math.max(0, dy), fBot = Math.min(H, dy + dh);
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

  window.DIVEFILM = {
    get ready() { return ready; },
    get failed() { return failed; },
    arm() { boot(); },              // velocity lookahead / anchor-glide pre-boot
    setProgress(v) {
      progress = clamp01(v);
      if (!booted && progress > 0.45) boot();
    }
  };
  // dev-only (?forcetick): allow forcing a synchronous draw from eval
  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawDiveFilm = () => frame();
    window.__bootDiveFilm = () => boot();
  }
})();
