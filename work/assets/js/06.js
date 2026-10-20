/* ---------------- v38: the new light / dark spreads out in a circle from the switch ----------------
   Uses the browser's own page transition. Registered before every other click handler of the switch, so it can run them
   inside the transition. Browsers without it, and "reduce motion", switch exactly as before. */
(function () {
  'use strict';
  var btn = document.getElementById('theme-btn');
  if (!btn || typeof document.startViewTransition !== 'function') return;
  var busy = false;
  btn.addEventListener('click', function (e) {
    if (busy || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    var r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    var vt;
    try {
      vt = document.startViewTransition(function () { busy = true; window.__vwVT = true; try { btn.click(); } finally { busy = false; window.__vwVT = false; } });
    } catch (er) { busy = true; try { btn.click(); } finally { busy = false; } return; }
    document.documentElement.classList.add('vw-vt');
    vt.ready.then(function () {
      document.documentElement.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + R + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(function () {});
    vt.finished.then(function () { document.documentElement.classList.remove('vw-vt'); }, function () { document.documentElement.classList.remove('vw-vt'); });
  }, true);
})();
