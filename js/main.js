/* Scroll choreography, loader, HUD telemetry.
   The scroll IS the timeline: a pinned hero stage scrubs the crystalline
   twin figure through its phases, snapping to rest at each annotation. */
(function () {
  // resilience: if GSAP/ScrollTrigger failed to load, don't throw and take
  // the page down — dismiss the loader, assemble the fallback hero, and let
  // the site work as a plain static scroll (all content is real HTML).
  if (!window.gsap || !window.ScrollTrigger) {
    const l = document.getElementById('loader');
    if (l) l.style.display = 'none';
    const bar = document.getElementById('topbar');
    if (bar) bar.style.opacity = '1';
    try { window.HERO?.arrive?.(0); } catch (_) {}
    console.warn('[main] GSAP unavailable — serving the static fallback layout');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // dev-only (?forcetick): hidden tabs clamp timers to ~1s; without lag
  // smoothing each slow tick advances real elapsed time instead of 33ms
  if (new URLSearchParams(location.search).has('forcetick')) {
    gsap.ticker.lagSmoothing(0);
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------- split hero title into two flanking words + chars ----------
     THE / TWINS become independent spans so CSS can seat them either side
     of the figure; each letter is still a .ch for the stagger reveal. */
  const title = $('#hero-title');
  const __legacyTitleSplit = () => title.textContent
    .split('')
    .map(c => c === ' ' || c === ' '
      ? '<span class="ch">&nbsp;</span>'
      : `<span class="ch">${c}</span>`)
    .join('');
  void __legacyTitleSplit;   // retired: single centred wordmark
  {
    const words = title.textContent.trim().split(/\s+/);
    title.innerHTML = words.map((w, wi) =>
      `<span class="ht-word ht-${wi === 0 ? 'left' : 'right'}">` +
      w.split('').map(c => `<span class="ch">${c}</span>`).join('') +
      '</span>'
    ).join('');
  }

  /* ---------- telemetry type-in for micro labels ---------- */
  function typeIn(el, delay = 0) {
    /* reduced motion: the label simply is — no cursor flicker */
    if (reduced) { el.style.visibility = 'visible'; return; }
    const text = el.textContent;
    el.textContent = '';
    el.style.visibility = 'visible';
    let i = 0;
    const tick = () => {
      if (i <= text.length) {
        el.textContent = text.slice(0, i) + (i < text.length ? '▌' : '');
        i++;
        setTimeout(tick, 18 + Math.random() * 30);
      }
    };
    setTimeout(tick, delay);
  }

  /* ---------- loader ---------- */
  const loader = $('#loader');
  const num = $('#loader-num');
  const fill = $('#loader-fill');
  const statusEl = $('#loader-status');
  const STATUSES = [
    'SENSING A HUMAN PRESENCE',
    'READING A LIVING HEARTBEAT',
    'WAKING THE DIGITAL TWIN',
    'TWIN LINK ESTABLISHED',
    'YOUR TWIN. YOUR RULES.'      // the vow — the last thing read before the world opens
  ];

  const counter = { v: 0 };
  const loadTl = gsap.timeline({ delay: 0.3 });

  loadTl.to(counter, {
    v: 100,
    duration: reduced ? 0.4 : 2.6,
    ease: 'power2.inOut',
    onUpdate() {
      const v = counter.v | 0;
      num.textContent = String(v).padStart(3, '0');
      fill.style.transform = `scaleX(${counter.v / 100})`;
      /* v/21 walks all five lines 0→100 (the old v/34 capped at index 2 and
         the final status never actually displayed) */
      statusEl.textContent = STATUSES[Math.min(4, (v / 21) | 0)];
    }
  })
  .to('.loader-frost', { opacity: 1, duration: 0.5, ease: 'power1.in' }, '-=0.4')
  .to('.loader-inner', { opacity: 0, y: -14, duration: 0.45, ease: 'power2.in' }, '<')
  .to(loader, {
    opacity: 0,
    duration: 0.9,
    ease: 'power2.inOut',
    onStart() {
      window.HERO?.arrive?.(reduced ? 0 : 2.4);
    },
    onComplete() {
      loader.style.display = 'none';
      enterHero();
    }
  });

  /* igloo-style scramble-in — used for the HUD on arrival */
  const SCRAMBLE = '▓▒░<>/\\|=+*#';
  function scrambleIn(el) {
    const target = el.dataset.text || el.textContent;
    el.dataset.text = target;
    /* reduced motion: no glyph flashing — land on the label instantly */
    if (reduced) { el.textContent = target; return; }
    let frame = 0;
    const total = 14;
    const tick = () => {
      frame++;
      const solved = Math.floor((frame / total) * target.length);
      el.textContent = target.slice(0, solved) +
        Array.from({ length: Math.min(8, Math.max(0, target.length - solved)) },
          () => SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]).join('');
      if (frame < total) setTimeout(tick, 30);
      else el.textContent = target;
    };
    tick();
  }

  function enterHero() {
    /* reduced motion: the hero simply is — no slides, no staggers
       (typeIn/scrambleIn carry their own guards) */
    if (reduced) {
      gsap.set('#topbar', { opacity: 1 });
      gsap.set('.hero-title .ch', { yPercent: 0, opacity: 1 });
      gsap.set('.hero-sub', { opacity: 0.92, y: 0 });
      gsap.set('.hero-line', { opacity: 0.68, y: 0 });
      gsap.set('.scroll-cue', { opacity: 0.7 });
      const eb = $('.hero-eyebrow'); if (eb) eb.style.visibility = 'visible';
      return;
    }
    window.__enterWorld = true;   /* the world's entrance descent (world.js) */
    gsap.to('#topbar', { opacity: 1, duration: 1, ease: 'power2.out' });
    /* the HUD scrambles at once on arrival (igloo move) — but NOT the sound
       toggle: it carries live state (SOUND: ON/OFF) and scrambling would cache
       a stale label and fight the user's clicks */
    $$('.topnav a').concat([$('#hud-coords')])
      .filter(Boolean).forEach(scrambleIn);
    gsap.fromTo('.hero-title .ch',
      { yPercent: 110, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 1.1, ease: 'power4.out', stagger: 0.045 });
    gsap.fromTo('.hero-sub, .hero-line',
      { opacity: 0, y: 14 },
      { opacity: keep => keep === 0 ? 0.92 : 0.68, y: 0, duration: 1, ease: 'power2.out', stagger: 0.15, delay: 0.5 });
    gsap.fromTo('.scroll-cue', { opacity: 0 }, { opacity: 0.7, duration: 1, delay: 1.1 });
    typeIn($('.hero-eyebrow'), 300);
    /* once the title has arrived, the film begins to play itself */
    setTimeout(() => window.__startAuto?.(), 2600);
    /* invite sound so the story can be heard (auto-hides after a while) */
    const hint = $('#sound-hint');
    if (hint) { gsap.fromTo(hint, { opacity: 0 }, { opacity: 0.8, duration: 1, delay: 1.6 });
      setTimeout(() => gsap.to(hint, { opacity: 0, duration: 0.8 }), 9000); }
  }

  /* ---------- pinned hero scrub ---------- */
  /* deferred: the HUD/vow boundary trigger is created once the render mode
     is known (world mode hides the reading deck — its boundary is the
     footer; the no-WebGL fallback keeps the deck and bounds at #world) */
  let boundaryMade = false;
  const proxy = { p: 0 };
  const heroCopy = $('#hero-copy');
  const cue = $('#scroll-cue');
  const annos = [$('#anno-1'), $('#anno-2'), $('#anno-3'), $('#anno-4'), $('#anno-5')];
  const hudPct = $('#hud-pct');
  const hudCoords = $('#hud-coords');
  /* THE VOW — the ending title card over the whiteout */
  const vowEl = $('#vow-type');
  const vowWords = $$('#vow-type .vw');
  let vowClock = 0, vowShown = false;
  /* the words land on their OWN clock — scroll stops at the resting end, so
     scroll-driven frames would freeze the line before the first word pops.
     Sound on: keyed to the narrator's actual playhead. Sound off: a 4s read. */
  function vowTick() {
    if (!vowShown) return;
    const live = window.__vowPlayhead?.();
    const t01 = (live !== null && live !== undefined)
      ? live
      : (performance.now() - vowClock) / 4000;
    for (const w of vowWords) w.classList.toggle('on', t01 >= +w.dataset.t);
    if (t01 < 1.5) requestAnimationFrame(vowTick);   // self-stops once the line has fully landed
  }

  // card visibility windows on the master progress line (fallback path).
  // snap points sit at each act's rest: hero, two twins, verified,
  // mid-deconstruction, explore blocks, moat, release.
  const CARDS = [
    { el: annos[0], in: 0.035, hold: 0.09, out: 0.14 },
    { el: annos[1], in: 0.23, hold: 0.27, out: 0.32 },
    { el: annos[2], in: 0.32, hold: 0.36, out: 0.41 },
    { el: annos[3], in: 0.885, hold: 0.91, out: 0.945 },
    { el: annos[4], in: 0.60, hold: 0.70, out: 0.79 }
  ];
  /* THE DESCENT warp: the pin grew from 1080% to 1750%, and the whole
     legacy journey now lives in master P ∈ [0, LEGACY_END] — the same real
     scroll pixels per beat as before, so every proven act plays identically.
     Legacy-authored windows receive p = warpLegacy(P); the new chapters —
     the breach, the dive, the heart cavern, the return — are authored
     directly in master P. */
  const LEGACY_END = 0.615, LEGACY_CAP = 0.955;
  const warpLegacy = P => P <= LEGACY_END ? (P / LEGACY_END) * LEGACY_CAP : LEGACY_CAP;
  window.__warpLegacy = warpLegacy;
  const L = p => p * (LEGACY_END / LEGACY_CAP);        // legacy beat → master P
  // snap rests dwell on each beat: the legacy acts, then the descent's own
  // stations — the throat of the dive, the heart, the specs wall, the seal
  /* 0.705 (not 0.695) — the dive's dwell station must rest on a luminous
     frame, not the darkest one; 0.952 — the investor ask gets its own rest */
  const SNAPS = [0, L(0.09), L(0.27), L(0.36), L(0.53), L(0.70), L(0.91),
                 0.705, 0.80, 0.865, 0.925, 0.952, 1];

  function cardAlpha(p, c) {
    const rise = gsap.utils.clamp(0, 1, (p - c.in) / 0.05);
    const fall = gsap.utils.clamp(0, 1, (c.out - p) / 0.05);
    return Math.min(rise, fall);
  }

  const heroST = ScrollTrigger.create({
    trigger: '#hero-stage',
    start: 'top top',
    // longer pin = more scroll distance per beat = a slower, more
    // deliberate, cinematic descent (nothing rushes between cards)
    end: reduced ? '+=100%' : '+=1750%',
    pin: true,
    scrub: reduced ? true : 1.0,          // tighter tracking — the world follows you directly
    snap: reduced ? false : {
      snapTo: SNAPS,
      duration: { min: 0.6, max: 1.2 },   // settle to rest without lagging
      ease: 'power2.inOut',
      delay: 0.08
    },
    onToggle(self) {
      /* pin released (or re-entered): keep the starfield gate honest even
         when onUpdate stops firing outside the trigger */
      window.__filmPinned = !!(window.WORLD && window.WORLD.ready) && self.isActive;
    },
    onUpdate(self) {
      const P = self.progress;                 // master progress — the whole descent
      const p = warpLegacy(P);                 // legacy-authored beats read this
      /* the narrator: legacy scenes carry the surface acts, the vault line
         holds through the dive + cavern, the vow speaks at the true finale */
      const storyP = P <= LEGACY_END ? p : (P < 0.955 ? 0.94 : Math.min(1.0, P));
      proxy.p = storyP;

      window.SCENE_NARRATE?.(storyP);

      const worldMode = window.WORLD && window.WORLD.ready;
      /* the starfield reads this to skip painting while the opaque film
         fully covers it (the whole pinned journey) */
      window.__filmPinned = !!worldMode && self.isActive;
      /* the mode is settled by the first real scroll: in world mode the
         reading deck lives INSIDE the film, so the page sections yield */
      if (!boundaryMade && (worldMode || P > 0.5)) {
        boundaryMade = true;
        /* REDUCED visitors keep the static reading deck: their pin is a calm
           100% hero, so folding the content into the film would leave them
           with ~60px per beat and no readable sections at all */
        if (worldMode && !reduced) document.body.classList.add('inworld');
        makeBoundary(worldMode && !reduced ? '#footer' : '#world');
        gsap.delayedCall(0, () => ScrollTrigger.refresh());
      }
      if (worldMode) {
        // 3D fog world owns the journey; page stays in the light theme
        window.WORLD.setProgress(P);        // the world warps legacy acts itself
        window.VAULTFILM?.setProgress(P);   // THE BREACH — the zoom into the ice
        window.SEALFILM?.setProgress(p);    // the signature macro film (the vow, struck)
        window.DIVEFILM?.setProgress(P);    // the descent film (master-authored)
        window.CAVERNFILM?.setProgress(P);  // the arrival film (chained from the dive tail)
        window.SOUNDWORLD?.setProgress(P);  // the sound world rides the dive
        window.__scrollP = 0.06;
      } else {
        window.HERO?.setProgress(p);
        window.__scrollP = Math.min(p / 0.5, 1); // sky fully dark by mid-journey
      }

      // hero copy exits FAST as the journey starts — fully gone before the
      // first card appears (p≈0.035), so the giant wordmark never ghosts
      // behind the annotation cards
      const exit = gsap.utils.clamp(0, 1, p / 0.03);
      heroCopy.style.opacity = String(1 - exit);
      heroCopy.style.transform = `translateY(${-exit * 60}px)`;
      cue.style.opacity = String(0.7 * (1 - exit));

      // annotation labels: world.js pins them to the ice blocks in 3D;
      // this fallback path only runs without WebGL
      if (!worldMode) {
        for (const c of CARDS) {
          const a = cardAlpha(p, c);
          c.el.style.visibility = a > 0.01 ? 'visible' : 'hidden';
          c.el.style.opacity = String(a);
          c.el.style.transform = `translate(${innerWidth * 0.08}px, ${innerHeight * 0.55}px)`;
        }
      }

      // HUD telemetry: drifting arctic coordinates, then temporal drift —
      // the finale counts the century the vault must hold (igloo instrument)
      hudPct.textContent = String(Math.round(P * 100)).padStart(3, '0');
      /* the descent falls through the century — the drift begins at the
         vault and counts the hundred years down through the ice */
      const drift = gsap.utils.clamp(0, 1, (P - 0.586) / 0.35);
      if (drift > 0) {
        hudCoords.textContent = `TEMPORAL DRIFT — YEAR ${2026 + Math.round(drift * 100)}`;
      } else {
        const lat = (58.3019 - P * 12.4).toFixed(4);
        const lon = (134.4197 + P * 22.7).toFixed(4);
        hudCoords.textContent = `${lat}° N — ${lon}° W`;
      }

      /* THE VOW — the ending title card. Words land over the white bloom as
         the narrator says them (sound on: keyed to her actual playhead;
         sound off: the same line on a 4s internal read) and hold over the
         final resting frame. Scrubbing back re-arms it. */
      if (vowEl) {
        const inVow = P > 0.974;
        if (inVow && !vowShown) {
          vowShown = true;
          vowClock = performance.now();
          requestAnimationFrame(vowTick);              // the line lands on its own clock
        }
        if (inVow) {
          vowEl.style.visibility = 'visible';
          vowEl.style.opacity = String(gsap.utils.clamp(0, 1, (P - 0.974) / 0.010));
        } else if (vowShown) {
          vowShown = false;                            // stops the ticker
          vowEl.style.opacity = '0';
          vowEl.style.visibility = 'hidden';
          for (const w of vowWords) w.classList.remove('on');   // re-arm for the next pass
        }
      }

      $('#topbar').classList.toggle('scrolled', P > 0.006);
      /* UNDER THE ICE the instrument inverts to ice-light ink — dark slate
         text drowned on the dive's dark frames (still monochrome, still
         the same instrument; igloo's own dark-frame discipline) */
      document.body.classList.toggle('underice', P > 0.60 && P < 0.782);
    }
  });

  /* ---------- guided auto-play ----------
     The film plays itself — it rests on each beat, then glides to the next —
     and the visitor can grab the scroll at any moment to take manual control.
     A HUD control toggles it. Each beat holds ~2s, and if sound is on it waits
     for that scene's narration to finish so every layer is fully explained. */
  const autoBtn = $('#auto-toggle');
  let autoOn = false, autoTween = null, autoTimer = null;

  const heroSpan = () => Math.max(1, heroST.end - heroST.start);
  const pForY = y => (y - heroST.start) / heroSpan();
  const yForP = p => heroST.start + p * heroSpan();

  function setAutoLabel() {
    if (!autoBtn) return;
    autoBtn.textContent = autoOn ? 'AUTOPLAY: ON' : 'AUTOPLAY: OFF';
    autoBtn.setAttribute('aria-pressed', String(autoOn));
  }
  function glideToP(p, dur, done) {
    if (autoTween) autoTween.kill();
    const s = { y: window.scrollY };
    autoTween = gsap.to(s, {
      y: yForP(p), duration: dur, ease: 'power2.inOut',
      onUpdate() { window.scrollTo(0, s.y); },
      onComplete() { autoTween = null; done && done(); }
    });
  }
  function dwellThenNext(first) {
    clearTimeout(autoTimer);
    let dwell = first ? 3400 : 2000;            // the opener lingers a touch longer
    const speaking = soundOn && currentNarr && !currentNarr.paused;
    if (speaking && isFinite(currentNarr.duration)) {
      const remain = (currentNarr.duration - currentNarr.currentTime) * 1000;
      dwell = Math.max(dwell, remain + 700);    // let the scene finish explaining itself
    }
    autoTimer = setTimeout(autoNext, dwell);
  }
  function autoNext() {
    if (!autoOn) return;
    const cur = pForY(window.scrollY);
    const next = SNAPS.find(sn => sn > cur + 0.006);
    if (next === undefined) { stopAuto(); return; }   // reached the end of the film
    glideToP(next, 2.0, () => { if (autoOn) dwellThenNext(); });
  }
  function startAuto(first) {
    if (reduced) return;
    autoOn = true; setAutoLabel();
    dwellThenNext(first);
  }
  function stopAuto() {
    autoOn = false; setAutoLabel();
    if (autoTween) { autoTween.kill(); autoTween = null; }
    clearTimeout(autoTimer);
  }
  // any direct scroll input hands control to the user (this also cancels a
  // nav-anchor glide — the same tween drives both). userMoved keeps the
  // deferred auto-tour kickoff from seizing a visitor who already took over.
  let userMoved = false;
  ['wheel', 'touchstart', 'pointerdown'].forEach(ev =>
    addEventListener(ev, () => {
      userMoved = true;
      if (autoOn) stopAuto();
      else if (autoTween) { autoTween.kill(); autoTween = null; }
    }, { passive: true }));
  addEventListener('keydown', e => {
    if (autoOn && [' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) stopAuto();
  });
  if (autoBtn) {
    autoBtn.addEventListener('click', () => { autoOn ? stopAuto() : startAuto(false); });
    setAutoLabel();
  }
  // expose so the loader can kick the journey off once the hero has settled
  window.__startAuto = () => { if (!userMoved && scrollY < 40) startAuto(true); };

  /* ---------- specs count-up ---------- */
  ScrollTrigger.create({
    trigger: '#specs',
    start: 'top 70%',
    once: true,
    onEnter() {
      typeIn($('.specs-head'));
      $$('.count').forEach((el, i) => {
        const target = +el.dataset.target;
        /* reserve the final width so the gold unit never slides during the
           count (values are authored in markup; tabular-nums holds digits) */
        el.style.minWidth = String(target).length + 'ch';
        el.style.display = 'inline-block';
        if (reduced) { el.textContent = String(target); return; }   // the number simply is
        const o = { v: 0 };
        el.textContent = '0';
        gsap.to(o, {
          v: target,
          duration: 2.1,
          delay: i * 0.12,
          ease: 'power4.out',          // races up, then lands with weight
          onUpdate: () => { el.textContent = String(Math.round(o.v)); },
          onComplete() {
            /* the number seats itself — a breath of cold light on arrival */
            const num = el.closest('.spec-num');
            if (num) gsap.fromTo(num,
              { textShadow: '0 0 26px rgba(181,213,255,0.85)' },
              { textShadow: '0 0 0px rgba(181,213,255,0)', duration: 1.4, ease: 'power2.out', clearProps: 'textShadow' });
          }
        });
      });
      if (reduced) { gsap.set('.spec', { opacity: 1, y: 0 }); return; }
      gsap.fromTo('.spec',
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', stagger: 0.1 });
    }
  });

  /* ---------- investor/pilot deck reveals (world · pilot · investors) ---------- */
  for (const [sel, head, cards] of [
    ['#world', '.world-head', '.being'],
    ['#pilot', '.pilot-head', '.phase'],
    ['#investors', '.inv-head', null]
  ]) {
    ScrollTrigger.create({
      trigger: sel,
      start: 'top 72%',
      once: true,
      onEnter() {
        const headEl = $(head);
        if (headEl) typeIn(headEl);
        const items = cards ? $$(sel + ' ' + cards) : [];
        if (reduced) {
          if (items.length) gsap.set(items, { opacity: 1, y: 0 });
          gsap.set(sel + ' .ladder li, ' + sel + ' .cta-enter, ' + sel + ' .world-lede, ' + sel + ' .pilot-lede, ' + sel + ' .inv-text', { opacity: 1, y: 0 });
          return;
        }
        if (items.length) gsap.fromTo(items,
          { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', stagger: 0.12 });
        const rows = $$(sel + ' .ladder li');
        if (rows.length) gsap.fromTo(rows,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', stagger: 0.05, delay: 0.3 });
      }
    });
  }

  /* ---------- manifesto reveal ---------- */
  ScrollTrigger.create({
    trigger: '#manifesto',
    start: 'top 72%',
    once: true,
    onEnter() {
      typeIn($('.manifesto-eyebrow'));
      if (reduced) {
        gsap.set('.manifesto-text', { opacity: 0.88, y: 0 });
        gsap.set('.manifesto-sig', { opacity: 0.92 });
      } else {
        gsap.fromTo('.manifesto-text',
          { opacity: 0, y: 26 },
          { opacity: 0.88, y: 0, duration: 1.2, ease: 'power2.out' });
        gsap.fromTo('.manifesto-sig',
          { opacity: 0 },
          { opacity: 0.92, duration: 1, delay: 0.5, ease: 'power2.out' });
      }
      $('#manifesto').classList.add('lit');   // the amber phrase draws its underline
    }
  });

  /* ---------- footer reveal — column heads print like telemetry ---------- */
  ScrollTrigger.create({
    trigger: '#footer',
    start: 'top 78%',
    once: true,
    onEnter() { $$('.footer-col-head').forEach(scrambleIn); }
  });

  /* ---------- the instrument yields at the world's edge ----------
     Past the film, the frame telemetry dims out and returns when the
     visitor scrolls back in. In world mode all content lives inside the
     film, so the boundary is the footer; the no-WebGL fallback keeps the
     reading deck and bounds at #world. Created once the mode is known. */
  function makeBoundary(sel) { ScrollTrigger.create({
    trigger: sel,
    start: 'top 88%',
    onEnter() {
      /* the vow title card steps aside as the reading deck arrives (it is
         position:fixed and would otherwise hang over the specs copy) */
      if (vowEl) {
        gsap.killTweensOf(vowEl);
        gsap.to(vowEl, { opacity: 0, duration: 0.35, ease: 'power2.in',
          onComplete: () => { vowEl.style.visibility = 'hidden'; } });
      }
      gsap.to('.hud-coords, .hud-progress, .hud-corner', { opacity: 0, duration: 0.5, ease: 'power2.out' });
      /* live controls quiet down but must stay findable at rest: 0.85 is the
         AA floor over the halo-lit deck (0.22 measured ~1.3:1 — invisible to
         exactly the low-vision users who cannot hover to rescue it) */
      gsap.to('.hud-sound', { opacity: 0.85, duration: 0.5 });
    },
    onLeaveBack() {
      gsap.to('.hud-coords, .hud-progress', { opacity: 0.92, duration: 0.6 });
      /* clearProps hands opacity back to the CSS calc(--pulse) breathing */
      gsap.to('.hud-corner', { opacity: 0.55, duration: 0.6,
        onComplete() { gsap.set('.hud-corner', { clearProps: 'opacity' }); } });
      gsap.to('.hud-sound', { opacity: 0.92, duration: 0.6 });
      /* returning to the film's resting end: the title card comes back
         (progress is pinned at 1 there, so onUpdate can't restore it) */
      if (vowEl && vowShown) {
        gsap.killTweensOf(vowEl);
        vowEl.style.visibility = 'visible';
        gsap.to(vowEl, { opacity: 1, duration: 0.5, ease: 'power2.out' });
      }
    }
  }); }

  /* ---------- cinematic audio: story narration + soft accents (sound toggle) ----
     The scroll IS a guided film. When the visitor turns sound on, a calm
     narrator walks them from the world of the human to the waking of the
     digital twin and everything the protocol protects; a whisper-soft pad
     carries the silence between lines, and each card reveals with a warm
     swell. All opt-in (browsers block audio until this gesture). */
  const soundBtn = $('#sound-toggle');
  let audioCtx = null, windGain = null, soundOn = false;

  /* ---- the score: a slow cinematic progression that evolves as you descend.
     Each chord is a small set of frequencies; pad voices glide between them
     (portamento) as the story crosses acts, so the harmony carries the arc:
     mystery → warmth (the twin wakes) → resolve (control) → the sealed heart
     → a bright, open finale. */
  // warm, consonant, resolved — all major/add9, no bare minor (that read "sad")
  const CHORDS = [
    [ 87.31, 110.00, 130.81, 164.81, 196.00],  // 0 enter   — F maj9   (warm, welcoming, open)
    [130.81, 164.81, 196.00, 246.94, 293.66],  // 1 twin    — C maj9   (bright, hopeful, waking)
    [ 98.00, 123.47, 146.83, 196.00, 220.00],  // 2 control — G add9   (strong, resolved, lifted)
    [ 87.31, 110.00, 130.81, 164.81, 220.00],  // 3 vault   — F maj9   (warm, tender, held)
    [130.81, 164.81, 196.00, 261.63, 329.63]   // 4 finale  — C major  (full, bright resolution)
  ];
  const chordForP = p =>
    p < 0.10 ? 0 : p < 0.36 ? 1 : p < 0.76 ? 2 : p < 0.95 ? 3 : 4;
  let scoreVoices = [], scoreShimmer = [], scoreSub = null, scoreFilter = null;
  let duckGain = null, scoreChordIdx = -1;

  /* the story, one line per beat — voiced by Higgsfield/Seed-Audio (Caspian),
     triggered as the visitor reaches each moment of the journey */
  const NARR_SRC = {
    enter:    'assets/audio/narration/enter.mp3',
    human:    'assets/audio/narration/human.mp3',
    twin:     'assets/audio/narration/twin.mp3',
    verified: 'assets/audio/narration/verified.mp3',
    protocol: 'assets/audio/narration/protocol.mp3',
    vault:    'assets/audio/narration/vault.mp3',
    vow:      'assets/audio/narration/vow.mp3'
  };
  const narrAudio = {};
  let currentNarr = null, currentNarrKey = null;
  function preloadNarration() {
    for (const k in NARR_SRC) {
      const a = new Audio(NARR_SRC[k]);
      a.preload = 'auto'; a.volume = 0.95;
      narrAudio[k] = a;
    }
  }

  /* the story is SCENE-DRIVEN: each scene of the scroll owns the line that
     describes exactly what's on screen. The narrator always speaks the scene
     you're actually viewing — and re-speaks it if you scroll back. */
  const SCENES = [
    { key: 'enter',    a: -1,    b: 0.03 },   // arrival — the world of the human
    { key: 'human',    a: 0.03,  b: 0.15 },   // one figure, the beating heart
    { key: 'twin',     a: 0.15,  b: 0.30 },   // the digital twin wakes beside you
    { key: 'verified', a: 0.30,  b: 0.45 },   // authorized services sign in via the twin
    { key: 'protocol', a: 0.45,  b: 0.82 },   // the five facets orbit the pair
    { key: 'vault',    a: 0.82,  b: 0.955 },  // the heart, sealed in the ice
    { key: 'vow',      a: 0.955, b: 1.01 }    // the whiteout vow
  ];
  const sceneForP = p => (SCENES.find(s => p >= s.a && p < s.b) || SCENES[0]).key;
  let lastSceneKey = null;
  /* duck the score under the voice, swell it back in the pauses (sidechain) */
  function duckScore(amount, ramp) {
    if (!duckGain || !audioCtx) return;
    duckGain.gain.cancelScheduledValues(audioCtx.currentTime);
    duckGain.gain.setTargetAtTime(amount, audioCtx.currentTime, ramp);
  }
  /* speak the line for the scene you're in — one voice at a time; a new scene
     cuts the last so the voice never describes a scene you've already left */
  function narrate(key) {
    if (!soundOn) return;
    const a = narrAudio[key];
    if (!a) return;
    if (currentNarrKey === key && !a.paused) return;   // already speaking this scene
    if (currentNarr && currentNarr !== a) { try { currentNarr.pause(); currentNarr.currentTime = 0; } catch (_) {} }
    currentNarr = a; currentNarrKey = key;
    window.__narrKey = key;                // dev: which scene the voice is on
    duckScore(0.32, 0.25);                 // drop the bed so the voice is clear
    a.onended = () => { if (currentNarr === a) { duckScore(1.0, 1.4); currentNarrKey = null; } };
    try { a.currentTime = 0; a.play().catch(() => {}); } catch (_) {}
  }
  function stopNarration() {
    if (currentNarr) { try { currentNarr.pause(); } catch (_) {} }
    currentNarrKey = null;
    duckScore(1.0, 0.8);
  }
  window.SCENE_NARRATE = p => {           // called each frame from the scroll
    const sc = sceneForP(p);
    if (sc !== lastSceneKey) { lastSceneKey = sc; narrate(sc); }
  };
  /* the vow title card keys its word-pops to the narrator's playhead.
     Returns 0..1 through the line while she's speaking it, else null
     (exposed on window so the scroll driver stays TDZ-safe). */
  window.__vowPlayhead = () => {
    const a = narrAudio.vow;
    if (currentNarrKey === 'vow' && a && !a.paused && isFinite(a.duration) && a.duration > 0) {
      return a.currentTime / a.duration;
    }
    return null;
  };

  /* text-reveal accent — a warm cinematic swell (low tone + a faint
     crystalline octave), soft enough to sit under the narrator's voice */
  function sfxSwell() {
    if (!soundOn || !audioCtx) return;
    const t0 = audioCtx.currentTime + 0.005;
    const o = audioCtx.createOscillator(); o.type = 'sine'; o.frequency.value = 174.6;   // F3
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.018, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    const o2 = audioCtx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 349.2; // F4 shimmer
    const g2 = audioCtx.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.005, t0 + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    o.connect(g).connect(audioCtx.destination);
    o2.connect(g2).connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + 0.55);
    o2.start(t0); o2.stop(t0 + 0.4);
  }
  window.SFX = { telemetry: sfxSwell, narrate };

  let melodyBus = null, melTimer = null;
  function startAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;

    // master: everything → duckGain (lowered under narration) → windGain
    // (toggle master) → a soft limiter → destination. The limiter keeps the
    // produced level glued and prevents any clip as layers stack.
    windGain = audioCtx.createGain(); windGain.gain.value = 0;
    duckGain = audioCtx.createGain(); duckGain.gain.value = 1;
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 24; limiter.ratio.value = 4;
    limiter.attack.value = 0.006; limiter.release.value = 0.28;
    duckGain.connect(windGain).connect(limiter).connect(audioCtx.destination);

    // ---- the space: a long convolver reverb. THIS is what turns "synth" into
    // "score" — a generated exponentially-decaying stereo impulse (~4s hall).
    const reverb = audioCtx.createConvolver();
    {
      const rate = audioCtx.sampleRate, len = Math.floor(rate * 3.4);
      const ir = audioCtx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        // SMOOTH the impulse. A raw white-noise IR makes the reverb tail hiss
        // like wind/sand — and it swells loudest under the bright twin chord,
        // which read as "background wind noise." One-pole-lowpass the noise as
        // we build it so the tail is a soft, warm hall instead of grit.
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += ((Math.random() * 2 - 1) - lp) * 0.18;         // darken the grain
          d[i] = lp * Math.pow(1 - i / len, 3.4);              // cleaner, shorter tail
        }
      }
      reverb.buffer = ir;
    }
    // roll the wet return off on top, so no sandy high end can survive in the
    // tail. Only the reverb wash goes warm — the dry pad/motif keep their bite.
    const wetLP = audioCtx.createBiquadFilter();
    wetLP.type = 'lowpass'; wetLP.frequency.value = 2600; wetLP.Q.value = 0.4;
    const wet = audioCtx.createGain(); wet.gain.value = 0.27;   // just a touch of hall, not echoey
    const dry = audioCtx.createGain(); dry.gain.value = 1.0;
    reverb.connect(wetLP).connect(wet).connect(duckGain);
    dry.connect(duckGain);
    const toBoth = node => { node.connect(dry); node.connect(reverb); };

    // ---- the arctic wind bed — REAL weather, not the old IR hiss: brown
    // noise (deep and soft, no sandy highs) through a slow resonant lowpass,
    // breathing on two incommensurate LFOs so gusts never loop audibly. It
    // sits far beneath the score and ducks under the narration with
    // everything else. The buffer's loop point is crossfaded — no click.
    {
      const rate = audioCtx.sampleRate, len = rate * 8;
      const buf = audioCtx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) { v += ((Math.random() * 2 - 1) - v) * 0.012; d[i] = v * 14; }
      const F = 4096;
      for (let i = 0; i < F; i++) { const t = i / F; d[len - F + i] = d[len - F + i] * (1 - t) + d[i] * t; }
      const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 1.4;
      const bed = audioCtx.createGain(); bed.gain.value = 0;
      src.connect(lp).connect(bed).connect(duckGain);
      src.start(now);
      const l1 = audioCtx.createOscillator(); l1.frequency.value = 0.043;   // gusts lean on the filter
      const l1g = audioCtx.createGain(); l1g.gain.value = 150;
      l1.connect(l1g).connect(lp.frequency); l1.start(now);
      const l2 = audioCtx.createOscillator(); l2.frequency.value = 0.019;   // slower breath on the level
      const l2g = audioCtx.createGain(); l2g.gain.value = 0.010;
      l2.connect(l2g).connect(bed.gain); l2.start(now);
      bed.gain.setTargetAtTime(0.026, now + 2, 6);   // rises out of silence over ~15s
    }

    const chord = CHORDS[0];

    // ---- warm pad: each chord note = 3 detuned oscillators (sine+triangle+a
    // soft saw for body), spread across the stereo field, through a breathing
    // lowpass. Detune + stereo width = a real string-ensemble shimmer.
    scoreFilter = audioCtx.createBiquadFilter();
    scoreFilter.type = 'lowpass'; scoreFilter.frequency.value = 1600; scoreFilter.Q.value = 0.5;
    const padGain = audioCtx.createGain(); padGain.gain.value = 0.085;
    scoreFilter.connect(padGain); toBoth(padGain);
    scoreVoices = chord.map((f, i) => {
      const vGain = audioCtx.createGain(); vGain.gain.value = (i === 0 ? 1.0 : 0.75 / (i + 1)) * 0.5;
      const pan = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
      if (pan) { pan.pan.value = (i - 2) / 3; vGain.connect(pan).connect(scoreFilter); }
      else vGain.connect(scoreFilter);
      const oscs = [
        { type: 'sine', det: 0, g: 1.0 },
        { type: 'triangle', det: -7, g: 0.45 },
        { type: 'sawtooth', det: 6, g: 0.08 }
      ].map(spec => {
        const o = audioCtx.createOscillator(); o.type = spec.type;
        o.frequency.value = f; o.detune.value = spec.det;
        const g = audioCtx.createGain(); g.gain.value = spec.g;
        o.connect(g).connect(vGain); o.start(now);
        return o;
      });
      return { oscs };
    });
    // sub — one octave below the root, dry (reverb on sub muddies)
    scoreSub = audioCtx.createOscillator(); scoreSub.type = 'sine';
    scoreSub.frequency.value = chord[0] / 2;
    const subG = audioCtx.createGain(); subG.gain.value = 0.16;
    scoreSub.connect(subG).connect(dry); scoreSub.start(now);
    // shimmer — high chord tones with slow tremolo, mostly into the reverb
    const shimBus = audioCtx.createGain(); shimBus.gain.value = 0.012;
    shimBus.connect(reverb); shimBus.connect(dry);
    scoreShimmer = [chord[2] * 2, chord[3] * 2, chord[4] * 2].map((f, i) => {
      const o = audioCtx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = audioCtx.createGain(); g.gain.value = 0.5;
      const trem = audioCtx.createOscillator(); trem.type = 'sine';
      trem.frequency.value = 0.05 + i * 0.02;
      const tg = audioCtx.createGain(); tg.gain.value = 0.5;
      trem.connect(tg).connect(g.gain); trem.start(now);
      o.connect(g).connect(shimBus); o.start(now);
      return { o };
    });
    // slow filter drift so the whole bed breathes
    const flt = audioCtx.createOscillator(); const fltG = audioCtx.createGain();
    flt.frequency.value = 0.03; fltG.gain.value = 150;
    flt.connect(fltG).connect(scoreFilter.frequency); flt.start(now);

    // ---- the motif: a sparse felt-piano voice that plays occasional chord
    // tones high up, deep in the reverb. This is what makes it read as MUSIC,
    // a melody breathing over the pad, not a drone.
    melodyBus = audioCtx.createGain(); melodyBus.gain.value = 0.5;
    melodyBus.connect(reverb); melodyBus.connect(dry);
    function playNote(f, vel) {
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = audioCtx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.0;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11 * vel, t + 0.05);   // soft felt attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);        // long, gentle decay
      const g2 = audioCtx.createGain(); g2.gain.value = 0.18; o2.connect(g2).connect(g);   // less tinkle
      o.connect(g).connect(melodyBus);
      o.start(t); o.stop(t + 3.3); o2.start(t); o2.stop(t + 3.3);
    }
    function scheduleMelody() {
      const wait = 3200 + Math.random() * 3600;                    // unhurried
      melTimer = setTimeout(scheduleMelody, wait);
      if (!soundOn) return;
      const c = CHORDS[scoreChordIdx];
      const pool = [c[1], c[2], c[3], c[4], c[2]];                 // warmer mid register
      const f = pool[Math.floor(Math.random() * pool.length)] * (Math.random() < 0.15 ? 2 : 1);
      playNote(f, 0.65 + Math.random() * 0.25);
    }
    scheduleMelody();

    scoreChordIdx = 0;
    /* move the harmony to match where the visitor is in the story */
    window.SCORE = {
      setProgress(p) {
        if (!audioCtx) return;
        const idx = chordForP(p);
        if (idx !== scoreChordIdx) {
          scoreChordIdx = idx;
          const c = CHORDS[idx], t = audioCtx.currentTime, tau = 0.9;
          scoreVoices.forEach((v, i) => v.oscs.forEach(o => o.frequency.setTargetAtTime(c[i], t, tau)));
          scoreSub.frequency.setTargetAtTime(c[0] / 2, t, tau);
          const sh = [c[2] * 2, c[3] * 2, c[4] * 2];
          scoreShimmer.forEach((s, i) => s.o.frequency.setTargetAtTime(sh[i], t, tau));
        }
        // gentle swell into the sealed-heart act, easing back for the finale
        const lift = Math.max(0, Math.min(1, (p - 0.76) / 0.14)) * (1 - Math.max(0, (p - 0.95) / 0.05));
        scoreFilter.frequency.setTargetAtTime(1600 + lift * 500, audioCtx.currentTime, 0.5);
      }
    };

    preloadNarration();
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      if (!audioCtx) startAudio();
      const on = windGain.gain.value < 0.01;
      soundOn = on;
      window.__soundOn = on;               // the sound world (sound.js) follows
      windGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, audioCtx.currentTime + 1.4);
      soundBtn.textContent = on ? 'SOUND: ON' : 'SOUND: OFF';
      soundBtn.setAttribute('aria-pressed', String(on));
      if (on) {
        // start speaking whatever scene the visitor is currently looking at
        lastSceneKey = sceneForP(proxy.p);
        narrate(lastSceneKey);
      } else {
        stopNarration();
      }
    });
  }

  /* ---------- smooth anchor scrolling ----------
     In world mode the reading sections are folded INTO the film, so their
     anchors must fly to the corresponding film beat instead of a hidden
     element (a display:none target reads rect.top 0 and would dump the
     visitor back at the hero). Both destinations are snap stations, so the
     scroll settles exactly on the beat. */
  /* phones have no hover — the facet card must teach the gesture that works
     (world.js expands a facet on first tap, opens it on the second) */
  if (matchMedia('(pointer: coarse)').matches) {
    const fh = $('#facet-hint');
    if (fh) fh.textContent = 'TAP A FACET · TAP AGAIN TO EXPLORE';
  }

  const FILM_ANCHORS = { '#chapters': L(0.27), '#manifesto': 0.80 };
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      const inworld = document.body.classList.contains('inworld');
      if (inworld && (FILM_ANCHORS[href] !== undefined || a.classList.contains('skip-link'))) {
        e.preventDefault();
        try { stopAuto(); } catch (_) { /* not armed yet */ }
        if (a.classList.contains('skip-link')) {
          const y = $('#footer').getBoundingClientRect().top + scrollY;
          window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
        } else if (reduced) {
          window.scrollTo(0, yForP(FILM_ANCHORS[href]));
        } else {
          /* a GSAP glide outruns any in-flight snap tween — a native smooth
             scroll loses that race and dumped the click at the first snap */
          glideToP(FILM_ANCHORS[href], 1.4);
        }
        return;
      }
      const target = $(href);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + scrollY;
      window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
      // keep keyboard focus in sync with the jump (skip link, nav anchors)
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });

  /* ---------- CLAIM YOUR VAULT — seal your name into the platinum ----------
     The signature moment: the visitor's name is struck letter by letter into
     the plinth ring (world.js VAULT.engrave), the OWNER telemetry takes their
     name, and the finale vow addresses them. Persisted — a returning visitor
     finds their vault still theirs. */
  {
    const cta = $('#claim-cta'), modal = $('#claim-modal'),
          nameIn = $('#claim-name'), sealBtn = $('#claim-seal'),
          closeBtn = $('#claim-x'), ownerDd = $('#owner-dd'),
          vtOwner = $('#vt-owner'), vwName = $('#vw-owner-name'),
          errEl = $('#claim-err'), countEl = $('#claim-count');
    /* what the punch can strike — diacritics fold to their base letters
       (JOSÉ -> JOSE, never JOS), then the engravable set applies. The field
       shows exactly what will be struck: the preview IS the truth. */
    const engravable = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 '.\-]/g, '').replace(/\s+/g, ' ');
    const setError = (msg) => {
      if (errEl) errEl.textContent = msg || '';
      if (!nameIn) return;
      if (msg) { nameIn.setAttribute('aria-invalid', 'true'); nameIn.setAttribute('aria-describedby', 'claim-err'); }
      else { nameIn.removeAttribute('aria-invalid'); nameIn.removeAttribute('aria-describedby'); }
    };
    const setCount = () => { if (countEl && nameIn) countEl.textContent = `${nameIn.value.length}/18`; };
    const ownerName = () => {
      try { return localStorage.getItem('twinsVaultOwner'); } catch { return null; }
    };
    const applyOwner = (name) => {
      window.__vaultOwned = true;
      if (ownerDd) ownerDd.textContent = `${name} — SOLE KEY`;
      if (vtOwner && vwName) { vwName.textContent = name + '.'; vtOwner.hidden = false; }
      /* the pill stays on as the owner's quiet re-strike path — a typo'd
         name must never be permanent */
      if (cta) cta.innerHTML = `<span class="claim-dot" aria-hidden="true">◈</span> SEALED FOR ${name}`;
    };
    const stored = ownerName();
    if (stored) {
      applyOwner(stored);
      /* the world may still be booting — engrave as soon as the API exists */
      const arm = () => window.VAULT ? window.VAULT.engrave(stored, true) : setTimeout(arm, 250);
      arm();
    }
    /* the film holds still behind the open dialog — wheel, touch and nav keys
       must not drive the ScrollTrigger pipeline mid-form */
    const blockScroll = (e) => e.preventDefault();
    const NAV_KEYS = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];
    const blockKeys = (e) => {
      if (modal.hidden) return;
      if (NAV_KEYS.includes(e.key) && e.target !== nameIn) e.preventDefault();
    };
    let lastFocus = null;
    const open = () => {
      if (!modal) return;
      lastFocus = document.activeElement;
      const owned = ownerName();
      if (nameIn && owned && !nameIn.value) nameIn.value = owned;
      if (sealBtn) {
        sealBtn.disabled = false;
        sealBtn.classList.remove('sealed');
        sealBtn.textContent = owned ? 'RE-STRIKE' : 'SEAL IT';
      }
      setError('');
      setCount();
      modal.hidden = false;
      /* double rAF: the browser must paint the hidden→flex frame before the
         .open transition can play (transitions retarget, so open/close is
         interruptible by construction) */
      requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('open')));
      try { stopAuto(); } catch (_) { /* autoplay not armed yet */ }
      addEventListener('wheel', blockScroll, { passive: false });
      addEventListener('touchmove', blockScroll, { passive: false });
      document.addEventListener('keydown', blockKeys, true);
      setTimeout(() => nameIn && nameIn.focus(), 240);
    };
    const close = () => {
      if (!modal) return;
      modal.classList.remove('open');
      removeEventListener('wheel', blockScroll);
      removeEventListener('touchmove', blockScroll);
      document.removeEventListener('keydown', blockKeys, true);
      setTimeout(() => {
        modal.hidden = true;
        /* focus returns to where the visitor left the film — the CTA pill
           when nothing better was focused (Safari doesn't focus clicked buttons) */
        const back = (lastFocus && lastFocus !== document.body && document.contains(lastFocus))
          ? lastFocus : cta;
        back && back.focus && back.focus();
      }, 160);   // lands just after the 140ms exit settles
    };
    cta && cta.addEventListener('click', open);
    closeBtn && closeBtn.addEventListener('click', close);
    modal && modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (modal && !modal.hidden && e.key === 'Escape') close();
    });
    /* focus stays inside the dialog while it is open (aria-modal promises
       the rest of the page does not exist — Tab must agree) */
    modal && modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const ring = [closeBtn, nameIn, sealBtn].filter(el => el && !el.disabled);
      if (!ring.length) return;
      const i = ring.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (i <= 0) { e.preventDefault(); ring[ring.length - 1].focus(); }
      } else if (i === -1 || i === ring.length - 1) {
        e.preventDefault(); ring[0].focus();
      }
    });
    /* typing must never scroll the film or trip the autoplay key handler —
       but Escape belongs to the dialog, so it is handled before the wall */
    nameIn && nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      e.stopPropagation();
      if (e.key === 'Enter') sealBtn && sealBtn.click();
    });
    /* live filter: the field always holds the exact engravable strike,
       caret preserved so mid-word edits never jump to the end */
    nameIn && nameIn.addEventListener('input', () => {
      const raw = nameIn.value;
      const clean = engravable(raw).slice(0, 18);
      if (clean !== raw) {
        const at = nameIn.selectionStart || 0;
        const delta = raw.length - clean.length;
        nameIn.value = clean;
        const pos = Math.max(0, at - delta);
        try { nameIn.setSelectionRange(pos, pos); } catch (_) { /* type=text always supports it */ }
      }
      setError('');
      setCount();
    });
    sealBtn && sealBtn.addEventListener('click', () => {
      if (sealBtn.disabled) return;                      // no double strike during the sealed beat
      const name = engravable(nameIn.value || '').trim().slice(0, 18);
      if (!name) {
        setError('ENTER A NAME TO SEAL');                // the message is text; the shake is garnish
        nameIn.classList.add('shake');
        setTimeout(() => nameIn.classList.remove('shake'), 450);
        nameIn.focus();
        return;
      }
      try { localStorage.setItem('twinsVaultOwner', name); } catch (_) { /* private mode */ }
      applyOwner(name);
      /* the sealed beat — one gold breath inside the panel (and the SR
         announcement via the status line), then the world takes over */
      sealBtn.disabled = true;
      sealBtn.classList.add('sealed');
      sealBtn.textContent = 'SEALED ◈';
      if (errEl) errEl.textContent = `SEALED FOR ${name}`;
      setTimeout(() => {
        close();
        window.VAULT && window.VAULT.engrave(name);
        window.SFX && window.SFX.telemetry && window.SFX.telemetry(9);
      }, 500);
    });
  }

  /* ---------- dev-only capture contract (?freeze=<P>) ----------
     Headless screenshots can't drive the scroll pipeline, so this lands the
     whole stack — world, films, plates — at one master P with the page at
     scrollY 0 (the pin transform confuses composite-less captures). Sets
     window.__frozen when the frame is fully staged. Inert without the param. */
  {
    const fz = new URLSearchParams(location.search).get('freeze');
    if (fz !== null) {
      const P = Math.min(1, Math.max(0, parseFloat(fz) || 0));
      const stage = () => {
        if (!(window.WORLD && window.WORLD.ready)) { setTimeout(stage, 200); return; }
        stopAuto();
        const l = document.getElementById('loader');
        if (l) l.style.display = 'none';
        const sh = document.getElementById('sound-hint');
        if (sh) sh.style.display = 'none';   /* froze mid-fade as a ghost in captures */
        /* the hero copy BELONGS to the opening frames — hiding it at P<0.03
           made the captured opening read as a titleless film */
        if (P > 0.03) {
          const hc = document.getElementById('hero-copy');
          if (hc) hc.style.display = 'none';
          const cueEl = document.getElementById('scroll-cue');
          if (cueEl) cueEl.style.display = 'none';
        }
        /* settle a few frames at the hero first — a real visitor always
           enters there, and materials that compile mid-journey on their
           first frame can smear NaN through the bloom chain */
        window.WORLD.setProgress(0.001);
        setTimeout(seat, 900);
      };
      const seat = () => {
        const p = warpLegacy(P);
        /* step through the CAST first (one beat at master 0.09) so the
           twin's materials first-render on the same path a real visitor's
           do — seating a cold session directly at P∈[0.115,0.13] lands the
           twin's first frame at legacy p≈0.19, which deterministically
           poisons its transmission into the black-body mode */
        window.WORLD.setProgress(Math.min(P, 0.067));
        setTimeout(() => {
        window.WORLD.setProgress(P);
        window.WORLD.setProgress = () => {};
        window.VAULTFILM?.setProgress(P);
        window.SEALFILM?.setProgress(p);
        window.DIVEFILM?.setProgress(P);
        window.CAVERNFILM?.setProgress(P);
        const dive = window.DIVEFILM, seal = window.SEALFILM, vault = window.VAULTFILM,
              cavern = window.CAVERNFILM;
        if (dive) dive.setProgress = () => {};
        if (seal) seal.setProgress = () => {};
        if (vault) vault.setProgress = () => {};
        if (cavern) cavern.setProgress = () => {};
        if (P > 0.55 && window.__bootDiveFilm) window.__bootDiveFilm();
        if (P > 0.55 && window.__bootCavernFilm) window.__bootCavernFilm();
        /* the scroll pipeline never runs under freeze, so stage its DOM
           truthfully too: HUD telemetry, topbar state, and the finale vow —
           captures must show what a real scrolling visitor sees */
        hudPct.textContent = String(Math.round(P * 100)).padStart(3, '0');
        const fdrift = gsap.utils.clamp(0, 1, (P - 0.586) / 0.35);
        hudCoords.textContent = fdrift > 0
          ? `TEMPORAL DRIFT — YEAR ${2026 + Math.round(fdrift * 100)}`
          : `${(58.3019 - P * 12.4).toFixed(4)}° N — ${(134.4197 + P * 22.7).toFixed(4)}° W`;
        $('#topbar').classList.toggle('scrolled', P > 0.006);
        document.body.classList.toggle('underice', P > 0.60 && P < 0.782);
        if (vowEl && P > 0.974) {
          vowEl.style.visibility = 'visible';
          vowEl.style.opacity = String(gsap.utils.clamp(0, 1, (P - 0.974) / 0.010));
          for (const w of vowWords) w.classList.add('on');
        }
        /* let the film loaders catch up before declaring the frame staged */
        setTimeout(() => { window.__frozen = true; }, 2500);
        }, 450);   // one settled beat on the cast path before the seat
      };
      setTimeout(stage, 400);
    }
  }
})();
