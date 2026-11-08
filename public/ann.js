/* Banner: the messages slide up one at a time (the live counter stays). Pauses while the pointer is over it or a finger touches it.
   Without this file the first message is simply shown. */
(function () {
  var bar = document.getElementById('ann');
  if (!bar) return;
  var col = bar.querySelector('.ann-col');
  var timer = 0;
  var items = col.children;
  var n = items.length;
  if (n < 2) return;
  col.appendChild(items[0].cloneNode(true)); // a copy of the first one at the end, so the loop has no jump
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gap = { slow: 7000, mid: 5000, fast: 3500 }[bar.getAttribute('data-speed')] || 7000;
  var i = 0;
  var paused = false;
  function go(k, animate) {
    col.style.transition = animate && !still ? 'transform .55s ease' : 'none';
    col.style.transform = 'translateY(' + -k * items[0].offsetHeight + 'px)';
  }
  function tick() {
    timer = setTimeout(function () {
      if (paused) return tick();
      i++;
      go(i, true);
      if (i === n) {
        setTimeout(function () { i = 0; go(0, false); }, 600);
      }
      tick();
    }, gap);
  }
  bar.addEventListener('mouseenter', function () { paused = true; });
  bar.addEventListener('mouseleave', function () { paused = false; });
  bar.addEventListener('touchstart', function () { paused = true; }, { passive: true });
  bar.addEventListener('touchend', function () { paused = false; }, { passive: true });
  window.addEventListener('resize', function () { go(i % (n + 1), false); });
  tick();
})();
