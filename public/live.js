/* Small helpers: (1) the notice pop-up closes at once, without reloading the page; (2) live search on the home page.
   Without this file everything still works: the notice button is a normal link and the search form has its button. */
(function () {
  var ok = document.querySelector('.popup .btn');
  if (ok) {
    ok.addEventListener('click', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      var pop = ok.closest('.popup');
      if (pop) pop.parentNode.removeChild(pop);
      fetch(ok.getAttribute('href'), { credentials: 'same-origin', redirect: 'manual' }).catch(function () {});
    });
  }
})();
(function () {
  var form = document.querySelector('form.search');
  var box = document.querySelector('section.results');
  if (!form || !box || !window.fetch || !window.DOMParser || !window.URLSearchParams) return;
  var timer;
  var ctl;
  function run() {
    var qs = new URLSearchParams(new FormData(form));
    Array.from(qs.keys()).forEach(function (k) {
      if (!qs.get(k)) qs.delete(k);
    });
    var s = qs.toString();
    if (ctl && ctl.abort) ctl.abort();
    ctl = window.AbortController ? new AbortController() : null;
    fetch(form.action + (s ? '?' + s : ''), { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (h) {
        var n = new DOMParser().parseFromString(h, 'text/html').querySelector('section.results');
        if (!n) return;
        box.innerHTML = n.innerHTML;
        try { history.replaceState(null, '', s ? '?' + s : location.pathname); } catch (e) {}
      })
      .catch(function () {});
  }
  function later() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }
  form.addEventListener('input', later);
  form.addEventListener('change', later);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(timer);
    run();
  });
})();
