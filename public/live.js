/* Live search on the home page: results update while typing. Without this file the form still works with the Search button. */
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
