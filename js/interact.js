/* Micro-interactions — the instrument answers the hand.
   1. Magnetic pull: interactive HUD elements lean gently toward the cursor
      and spring home when it leaves (max ~6px — felt, never seen).
   2. Cursor aura: a fine survey ring drifts after the native cursor and
      opens over anything interactive. The native cursor is never hidden.
   Desktop pointers only; disabled under prefers-reduced-motion. */
(function () {
  if (!window.gsap) return;
  const fine = matchMedia('(pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return;

  /* ---------- magnetic elements ---------- */
  const MAGNETS = document.querySelectorAll(
    '.topnav a, .social, .hud-sound, .hud-auto, .footer-col a, .footer-links a'
  );
  MAGNETS.forEach(el => {
    const toX = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const toY = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const relX = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const relY = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      toX(relX * 5);
      toY(relY * 4);
    });
    el.addEventListener('pointerleave', () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.45)' });
    });
  });

  /* ---------- cursor aura ---------- */
  const ring = document.createElement('div');
  ring.id = 'cursor-ring';
  ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);

  const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3.out' });
  const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3.out' });
  let shown = false;

  addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;   // touch never shows the aura
    if (!shown) { shown = true; gsap.to(ring, { opacity: 1, duration: 0.6 }); }
    rx(e.clientX);
    ry(e.clientY);
  }, { passive: true });
  addEventListener('pointerdown', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    gsap.fromTo(ring, { scale: 0.82 }, { scale: 1, duration: 0.5, ease: 'power2.out' });
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => {
    shown = false;
    gsap.to(ring, { opacity: 0, duration: 0.4 });
  });

  /* the ring opens over anything interactive (event delegation — cheap) */
  const HOT = 'a, button, [role="button"], .app-chip';
  addEventListener('pointerover', e => {
    if (e.target.closest && e.target.closest(HOT)) ring.classList.add('hot');
  }, { passive: true });
  addEventListener('pointerout', e => {
    if (e.target.closest && e.target.closest(HOT)) ring.classList.remove('hot');
  }, { passive: true });
})();
