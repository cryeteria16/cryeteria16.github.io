/* ---------------- ADDED: phone tab bar (Today, MRI, Works, Documents, Menu) ---------------- */
(function () {
  'use strict';
  var TABS = [['today', '✅', 'Today'], ['desk', '🧭', 'Jobs'], ['dash', '📊', 'Dashboard'], ['docs', '📁', 'Documents']];
  var bar = document.createElement('nav'); bar.className = 'vw-tabs'; bar.setAttribute('aria-label', 'Main pages');
  bar.innerHTML = TABS.map(function (t) {
    return '<button type="button" data-tab="' + t[0] + '"><span class="i" aria-hidden="true">' + t[1] + '</span>' + t[2] + (t[0] === 'desk' ? '<span class="nav-badge" data-tab-badge="mri" hidden></span>' : '') + '</button>';
  }).join('') + '<button type="button" data-tab="_menu"><span class="i" aria-hidden="true">☰</span>More</button>';
  document.body.appendChild(bar);
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    var v = b.getAttribute('data-tab');
    if (v === '_menu') { var m = document.getElementById('btn-menu'); if (m) m.click(); return; }
    var n = document.querySelector('.nav-item[data-view="' + v + '"]'); if (n) n.click();
    window.scrollTo(0, 0);
  });
  function sync() {
    var a = document.querySelector('.nav-item.active[data-view]'), v = a ? a.getAttribute('data-view') : '';
    if (v === 'desk' && window.__vwDeskTab === 'today') v = 'today';
    var known = TABS.some(function (t) { return t[0] === v; });
    bar.querySelectorAll('[data-tab]').forEach(function (b) { var t = b.getAttribute('data-tab'); b.classList.toggle('on', t === v || (t === '_menu' && !known && !!v)); });
  }
  var sb = document.getElementById('sidebar');
  if (sb && window.MutationObserver) new MutationObserver(sync).observe(sb, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('vw-desk-tab', sync);
  sync();
  // belt and braces for browsers without overflow:clip: put the app frame back if anything scrolls it
  ['appShell'].concat([].slice.call(document.querySelectorAll('.app-body'))).forEach(function (el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.addEventListener('scroll', function () { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });
  });
  window.addEventListener('scroll', function () { if (window.innerWidth > 768 && (window.scrollY || window.scrollX)) window.scrollTo(0, 0); });
})();
