/* THE FALL — the entrance, played by time (not scrubbed by scroll).
   A Higgsfield ascent generated FROM the loader poster and extracted in
   REVERSE, so the descent provably lands on the very frame the loader has
   been holding: white sun-glare → burst over the range → plunge to the
   plain → the crystalline figure, hand on heart — then the canvas lifts
   and the live world owns the lens unchanged. Frames live in
   assets/video/entry/frame-XXXX.jpg (already reversed at extraction).
   If they are not loaded by loader-end, ENTRYFILM.ready stays false and
   main.js falls back to the live entrance descent (world.js) untouched. */
(function () {
  const FRAME_COUNT = 121;               // set by extraction step
  const SRC = i => `assets/video/entry/frame-${String(i + 1).padStart(4, '0')}.jpg`;
  const DURATION = 4.6;                  // seconds; scroll fast-forwards it

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FZ = new URLSearchParams(location.search).has('freeze');
  if (REDUCED || FZ) { window.ENTRYFILM = { ready: false, play() {}, skip() {} }; return; }

  const stage = document.getElementById('hero-stage');
  const canvas = document.createElement('canvas');
  canvas.id = 'entryfilm';
  stage.appendChild(canvas);
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;z-index:6;display:block;pointer-events:none;';
  const ctx = canvas.getContext('2d');

  const frames = new Array(FRAME_COUNT).fill(null);
  let loaded = 0, ready = false, playing = false, done = false;
  let t0 = 0, speed = 1, alpha = 1;
  let W, H, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = (stage.offsetWidth || innerWidth) * dpr;
    H = canvas.height = (stage.offsetHeight || innerHeight) * dpr;
  }

  function load(i) {
    const rw = Math.min(1440, Math.max(720, Math.ceil(W || 1440)));
    const fall = () => new Promise(res => {
      const img = new Image();
      img.onload = () => { frames[i] = img; loaded++; res(true); };
      img.onerror = () => res(false);
      img.src = SRC(i);
    });
    if (!window.createImageBitmap) return fall();
    return fetch(SRC(i))
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(b => createImageBitmap(b, { resizeWidth: rw, resizeQuality: 'high' }))
      .then(bm => { frames[i] = bm; loaded++; return true; })
      .catch(fall);
  }

  /* eager boot — the film must be armed before the loader lifts. The
     landing frames load FIRST (a slow connection that only half-arrives
     still lands cleanly; ready needs the full reel). */
  (async () => {
    resize();
    const order = [];
    for (let i = FRAME_COUNT - 1; i >= 0; i--) order.push(i);
    const results = await Promise.all(order.map(load));
    ready = results.every(Boolean);
  })();

  function nearestFrame(idx) {
    if (frames[idx]) return frames[idx];
    for (let d = 1; d < FRAME_COUNT; d++) {
      if (frames[idx - d]) return frames[idx - d];
      if (frames[idx + d]) return frames[idx + d];
    }
    return null;
  }

  const easeOut = t => 1 - Math.pow(1 - t, 3);   // fast fall, decelerated landing

  function draw(idx, a) {
    ctx.clearRect(0, 0, W, H);
    const img = nearestFrame(idx);
    if (!img) return;
    const vr = img.width / img.height, cr = W / H;
    let dw, dh;
    if (cr > vr) { dw = W; dh = W / vr; } else { dw = H * vr; dh = H; }
    ctx.globalAlpha = a;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.globalAlpha = 1;
  }

  let tAcc = 0, lastT = 0;
  function frame(now) {
    if (done) return;
    requestAnimationFrame(frame);
    if (!playing) return;
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    tAcc += dt * speed;
    const t = Math.min(1, tAcc / DURATION);
    const idx = Math.min(FRAME_COUNT - 1, Math.round(easeOut(t) * (FRAME_COUNT - 1)));
    if (t >= 1) {
      /* landed on the poster frame — lift the canvas, the live world is
         already holding the same composition beneath */
      alpha -= dt * 2.2;
      if (alpha <= 0) { done = true; canvas.remove(); return; }
    }
    draw(idx, Math.max(0, Math.min(1, alpha)));
  }

  addEventListener('resize', resize);

  window.ENTRYFILM = {
    get ready() { return ready; },
    get playing() { return playing && !done; },
    play() {
      if (playing || done || !ready) return false;
      playing = true; lastT = performance.now();
      requestAnimationFrame(frame);
      return true;
    },
    /* a scroll during the fall completes it fast instead of fighting it —
       the same ratchet grammar as the live descent */
    skip() { if (playing && !done) speed = Math.max(speed, 5); }
  };
})();
