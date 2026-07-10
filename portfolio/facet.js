/* Facet page micro-interactions: scramble-in title + typed telemetry. */
(function () {
  const SCRAMBLE = '▓▒░<>/\\|=+*#';
  function scrambleIn(el) {
    const target = el.textContent;
    let frame = 0;
    const total = 16;
    const tick = () => {
      frame++;
      const solved = Math.floor((frame / total) * target.length);
      el.textContent = target.slice(0, solved) +
        Array.from({ length: Math.min(8, Math.max(0, target.length - solved)) },
          () => SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]).join('');
      if (frame < total) setTimeout(tick, 32);
      else el.textContent = target;
    };
    tick();
  }
  const h1 = document.querySelector('h1');
  if (h1) scrambleIn(h1);
  document.querySelectorAll('.facet-tel dd').forEach((el, i) => {
    setTimeout(() => scrambleIn(el), 300 + i * 140);
  });
})();
