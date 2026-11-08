/* Moving banner: one message at a time crosses the bar (enters from the left, leaves on the right), then the next one comes.
   It pauses while the pointer is over it or a finger touches it. Visitors can close it; it returns only when the messages change.
   Without this file the first message is simply shown. */
(function () {
  var bar = document.getElementById('ann');
  if (!bar) return;
  var v = bar.getAttribute('data-v');
  try {
    if (localStorage.getItem('annx') === v) {
      bar.parentNode.removeChild(bar);
      return;
    }
  } catch (e) {}
  var tr = bar.querySelector('.ann-track');
  var items = Array.prototype.map.call(tr.querySelectorAll('.ann-item'), function (n) { return n.cloneNode(true); });
  var x = bar.querySelector('.ann-x');
  if (x) {
    x.hidden = false;
    x.addEventListener('click', function () {
      try { localStorage.setItem('annx', v); } catch (e) {}
      if (anim && anim.cancel) anim.cancel();
      clearTimeout(timer);
      bar.parentNode.removeChild(bar);
    });
  }
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var speed = { slow: 55, mid: 90, fast: 140 }[bar.getAttribute('data-speed')] || 55;
  if (window.innerWidth < 600) speed *= 0.8;
  var i = 0;
  var anim = null;
  var timer = 0;
  var paused = false;
  function show() {
    tr.innerHTML = '';
    tr.appendChild(items[i % items.length].cloneNode(true));
    i++;
  }
  if (still || !tr.animate) {
    bar.classList.add('ann-static');
    show();
    if (items.length > 1) timer = setInterval(function () { if (!paused) show(); }, 6000);
    bar.addEventListener('mouseenter', function () { paused = true; });
    bar.addEventListener('mouseleave', function () { paused = false; });
    return;
  }
  bar.classList.add('ann-js');
  function run() {
    show();
    var w = tr.offsetWidth;
    var W = bar.offsetWidth;
    anim = tr.animate([{ transform: 'translateX(' + -w + 'px)' }, { transform: 'translateX(' + W + 'px)' }], { duration: ((W + w) / speed) * 1000, easing: 'linear' });
    if (paused) anim.pause();
    anim.onfinish = run;
  }
  function hold(p) {
    paused = p;
    if (!anim) return;
    if (p) anim.pause(); else anim.play();
  }
  bar.addEventListener('mouseenter', function () { hold(true); });
  bar.addEventListener('mouseleave', function () { hold(false); });
  bar.addEventListener('touchstart', function () { hold(true); }, { passive: true });
  bar.addEventListener('touchend', function () { hold(false); }, { passive: true });
  bar.addEventListener('touchcancel', function () { hold(false); }, { passive: true });
  run();
})();
