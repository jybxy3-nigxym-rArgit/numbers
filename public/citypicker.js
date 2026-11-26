/* City / governorate / village search box. The page still works without this file: the normal list stays as it is. */
(function () {
  'use strict';
  var MARKS = /[ً-ْـ]/g;
  function norm(x) {
    return String(x || '')
      .toLowerCase()
      .replace(MARKS, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/(^|\s)ال(?=\S)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function init(sel) {
    var items = [].slice
      .call(sel.options)
      .filter(function (o) {
        return o.value;
      })
      .map(function (o) {
        var r = o.getAttribute('data-r') || '';
        return { v: o.value, l: o.textContent.trim(), r: r, n: norm(o.textContent), rn: norm(r) };
      });
    var wrap = document.createElement('div');
    wrap.className = 'cp';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.hidden = true;
    sel.tabIndex = -1;

    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'cp-input';
    input.autocomplete = 'off';
    input.dir = 'auto';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = sel.getAttribute('data-ph') || '';
    var label = sel.getAttribute('aria-label');
    if (label) input.setAttribute('aria-label', label);
    if (sel.id) {
      input.id = sel.id + '-cp';
      var lab = document.querySelector('label[for="' + sel.id + '"]');
      if (lab) lab.setAttribute('for', input.id);
    }
    var list = document.createElement('ul');
    list.className = 'cp-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(input);
    wrap.appendChild(list);

    var shown = [];
    var active = -1;

    function find(v) {
      for (var i = 0; i < items.length; i++) if (items[i].v === v) return items[i];
      return null;
    }
    function textOf(it) {
      return it.r ? it.l + ' — ' + it.r : it.l;
    }
    function showChosen() {
      var it = find(sel.value);
      input.value = it ? textOf(it) : '';
    }
    function close() {
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
    }
    function pick(it) {
      sel.value = it.v;
      showChosen();
      close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function paint() {
      list.innerHTML = '';
      shown.forEach(function (it, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        if (i === active) li.className = 'on';
        var b = document.createElement('b');
        b.textContent = it.l;
        li.appendChild(b);
        if (it.r) {
          var s = document.createElement('small');
          s.textContent = it.r;
          li.appendChild(s);
        }
        li.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          pick(it);
        });
        list.appendChild(li);
      });
      if (!shown.length) {
        var none = document.createElement('li');
        none.className = 'cp-none';
        none.textContent = sel.getAttribute('data-none') || '';
        list.appendChild(none);
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function search(raw) {
      var q = norm(raw);
      var out = [];
      if (!q) {
        out = items.slice(0, 8);
      } else {
        var a = [];
        var b = [];
        var c = [];
        items.forEach(function (it) {
          if (it.n.indexOf(q) === 0) a.push(it);
          else if (it.n.indexOf(q) > 0) b.push(it);
          else if (it.rn.indexOf(q) >= 0) c.push(it);
        });
        out = a.concat(b, c).slice(0, 8);
      }
      shown = out;
      active = out.length ? 0 : -1;
      paint();
    }

    input.addEventListener('focus', function () {
      input.select();
      search('');
    });
    input.addEventListener('input', function () {
      if (!input.value.trim() && sel.querySelector('option[value=""]')) sel.value = '';
      search(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        close();
        showChosen();
      }, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.hidden) search(input.value);
        else if (shown.length) active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
        paint();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0 && shown[active]) {
          pick(shown[active]);
          e.preventDefault();
        }
      } else if (e.key === 'Escape') {
        close();
        showChosen();
      }
    });
    showChosen();
  }

  [].slice.call(document.querySelectorAll('select[data-cp]')).forEach(init);
})();
