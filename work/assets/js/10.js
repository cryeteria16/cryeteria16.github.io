/* ---------------- ADDED: entrance animations + counting numbers ----------------
   Plays when a page is opened, and when fresh data arrives (first load, Refresh, auto-refresh).
   Filter clicks do NOT replay it, so working with the dashboard stays calm.
   Turned off automatically when the computer is set to "reduce motion". */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var $ = function (id) { return document.getElementById(id); };
  var timers = {};

  function stagger(root, sel, max) {
    var els = root.querySelectorAll(sel);
    for (var i = 0; i < els.length && i < (max || 60); i++) els[i].style.setProperty('--i', i);
  }

  // counts a number up from 0 (only plain numbers such as "1,234"; stops if the page redraws it meanwhile)
  function countUp(el) {
    var txt = (el.textContent || '').trim();
    if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(txt)) return;
    var target = Number(txt.replace(/,/g, ''));
    if (!target || target < 2) return;
    var start = null, dur = Math.min(1100, 500 + target * 4), last = '';
    function frame(t) {
      if (last && el.textContent !== last) return;              // redrawn by the page: leave it alone
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
      last = p < 1 ? Math.round(target * e).toLocaleString('en-US') : txt;
      el.textContent = last;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function play(section) {
    if (!section || section.style.display === 'none') return;
    stagger(section, '.act-card');
    stagger(section, '.kpi');
    stagger(section, '.chart-grid > .card');
    stagger(section, '.pq-file');
    stagger(section, '.pq-grp');
    stagger(section, '.pq-cbox');
    stagger(section, '.td-tile'); stagger(section, '.td-grp'); stagger(section, '.dc-kpi');
    stagger(section, '.td-item', 30); stagger(section, '.dc-row', 24);
    stagger(section, '.hb-fill, .wl-bar .fl, .wlp-row .fl', 40);
    stagger(section, '.vb-col', 30);
    var rows = section.querySelectorAll('tbody tr');
    for (var i = 0; i < rows.length && i < 24; i++) { rows[i].classList.add('vw-row'); rows[i].style.setProperty('--i', i); }
    section.classList.remove('vw-enter');
    void section.offsetWidth;                                    // restart the CSS animations
    section.classList.add('vw-enter');
    section.querySelectorAll('.act-num, .kpi-num, .pq-ghead b, .pq-cbox b, .td-tile b, .dc-kpi b').forEach(countUp);
    clearTimeout(timers[section.id]);
    timers[section.id] = setTimeout(function () {
      section.classList.remove('vw-enter');
      section.querySelectorAll('tr.vw-row').forEach(function (r) { r.classList.remove('vw-row'); });
    }, 2200);
  }

  // a page is opened from the menu
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    n.addEventListener('click', function () { setTimeout(function () { play($('view-' + n.dataset.view)); }, 30); });
  });
  // fresh data arrived
  document.addEventListener('vw-dash-loaded', function () { setTimeout(function () { play($('view-dash')); }, 20); });
  document.addEventListener('vw-d365-loaded', function () { setTimeout(function () { play($('view-proc')); }, 20); });
  document.addEventListener('vw-today-loaded', function () { setTimeout(function () { play($('view-today')); }, 20); });
  document.addEventListener('vw-docs-loaded', function () { setTimeout(function () { play($('view-docs')); }, 20); });
  var wsub = $('wl-sub');
  if (wsub && window.MutationObserver) {
    new MutationObserver(function () { if (/read /.test(wsub.textContent)) setTimeout(function () { play($('view-wasl')); }, 20); })
      .observe(wsub, { childList: true, characterData: true, subtree: true });
  }
  // WASL: switching between Pipeline and LPO details
  var views = $('wl-views');
  if (views) views.addEventListener('click', function (e) { if (e.target.closest('button')) setTimeout(function () { play($('view-wasl')); }, 30); });
})();
