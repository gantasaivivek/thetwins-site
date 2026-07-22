/* THE SOUND WORLD — the descent, heard. Procedural WebAudio layered under
   the narration + score that main.js already conducts: an arctic wind bed
   that hushes as you go under the ice, the heartbeat you can HEAR swell as
   you approach the vault and stand before the heart, the rush of the dive,
   and soft ice-crack accents at the act edges. Everything is synthesized —
   no files, no credits, no network. Starts only on the first user gesture
   (browser autoplay law) and only while the visitor has sound ON via the
   existing HUD toggle (main.js exposes window.__soundOn). Reduced-motion
   visitors keep the calm: no whoosh swells, just the quiet bed. */
(function () {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ctx = null, master = null;
  let bedGain = null, bedFilter = null;
  let hbGain = null, hbOsc = null;
  let whooshGain = null, whooshFilter = null, whooshSrc = null;
  let started = false;
  let P = 0, lastP = 0, vel = 0;
  let lastT = 0, hbPhase = 0;

  function noiseBuffer(seconds, brown) {
    const n = (ctx.sampleRate * seconds) | 0;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  }

  function start() {
    if (started) return;
    started = true;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { return; }
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    /* the wind bed — brown noise through a slow-breathing lowpass */
    const bedSrc = ctx.createBufferSource();
    bedSrc.buffer = noiseBuffer(7, true);
    bedSrc.loop = true;
    bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 420;
    bedGain = ctx.createGain();
    bedGain.gain.value = 0.05;
    bedSrc.connect(bedFilter).connect(bedGain).connect(master);
    bedSrc.start();

    /* the heartbeat — a soft sine thump, driven from tick() so it stays in
       phase with the world's own lub-dub (1.15s cycle) */
    hbOsc = ctx.createOscillator();
    hbOsc.type = 'sine';
    hbOsc.frequency.value = 54;
    hbGain = ctx.createGain();
    hbGain.gain.value = 0;
    hbOsc.connect(hbGain).connect(master);
    hbOsc.start();

    /* the dive rush — white noise through a bandpass, silent until the drop */
    whooshSrc = ctx.createBufferSource();
    whooshSrc.buffer = noiseBuffer(5, false);
    whooshSrc.loop = true;
    whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = 'bandpass';
    whooshFilter.frequency.value = 500;
    whooshFilter.Q.value = 0.8;
    whooshGain = ctx.createGain();
    whooshGain.gain.value = 0;
    whooshSrc.connect(whooshFilter).connect(whooshGain).connect(master);
    whooshSrc.start();

    lastT = ctx.currentTime;
    tick();
  }

  /* one soft crack of ice — an accent at act edges and on the claim */
  function crack(strength) {
    if (!ctx || master.gain.value < 0.01) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.16, false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10 * (strength || 1), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    src.connect(f).connect(g).connect(master);
    src.start(t); src.stop(t + 0.18);
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!ctx) return;
    const t = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0.001, t - lastT));
    lastT = t;

    /* the world speaks only when the visitor asked for sound */
    const on = !!window.__soundOn;
    master.gain.setTargetAtTime(on ? 1 : 0, t, 0.4);
    if (!on) return;

    vel += ((P - lastP) / dt - vel) * Math.min(1, dt * 6);
    lastP = P;

    /* the bed: open wind on the surface, hushed and lower under the ice */
    const under = smooth((P - 0.60) / 0.08);          // 0 surface -> 1 interior
    bedFilter.frequency.setTargetAtTime(420 - under * 250, t, 0.6);
    bedGain.gain.setTargetAtTime(0.05 - under * 0.028, t, 0.8);

    /* the heartbeat swells at the vault's face and stands full in the
       chamber of the heart, easing off as the return rises */
    const nearVault = smooth((P - 0.50) / 0.09) * (1 - smooth((P - 0.615) / 0.02));
    const atHeart = smooth((P - 0.70) / 0.06) * (1 - smooth((P - 0.945) / 0.045));
    const hbAmp = Math.max(nearVault * 0.5, atHeart) * 0.16;
    hbPhase = (hbPhase + dt / 1.15) % 1;
    /* lub at 0, dub at 0.22 — matched to world.js heartbeat() */
    const th1 = Math.exp(-Math.pow((hbPhase - 0.04) / 0.035, 2));
    const th2 = Math.exp(-Math.pow((hbPhase - 0.26) / 0.045, 2)) * 0.7;
    hbGain.gain.setTargetAtTime(hbAmp * (th1 + th2), t, 0.015);

    /* the dive roars with your actual speed through the shaft */
    const inDive = smooth((P - 0.615) / 0.02) * (1 - smooth((P - 0.755) / 0.025));
    const rush = REDUCED ? 0 : Math.min(1, Math.abs(vel) * 9) * inDive;
    whooshGain.gain.setTargetAtTime(rush * 0.11, t, 0.18);
    whooshFilter.frequency.setTargetAtTime(360 + rush * 900, t, 0.25);
  }

  const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

  /* arm on the first gesture — the same gestures that already grant audio */
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
    addEventListener(ev, start, { once: true, passive: true }));

  window.SOUNDWORLD = {
    setProgress(v) { P = Math.min(Math.max(v, 0), 1); },
    crack
  };
})();
