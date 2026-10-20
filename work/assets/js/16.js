/* ADDED: smooth light/dark change + the small spark on buttons. Everything here is cosmetic and skipped when "reduce motion" is on. */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var btn = document.getElementById('theme-btn');
  if (btn) btn.addEventListener('click', function () {
    if (window.__vwVT) return;                                    // v38: the circle transition already handles it
    var h = document.documentElement; h.classList.add('vw-theming');
    clearTimeout(window.__vwThemeT); window.__vwThemeT = setTimeout(function () { h.classList.remove('vw-theming'); }, 600);
  }, true);
  // soft ripple on primary / ghost buttons
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('.btn:not(:disabled)'); if (!b) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 1.6;
    var d = document.createElement('span');
    d.style.cssText = 'position:absolute;pointer-events:none;border-radius:50%;background:currentColor;opacity:.16;width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px;transform:scale(0);transition:transform .5s ease-out,opacity .6s ease-out;';
    var pos = getComputedStyle(b).position; if (pos === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden'; b.appendChild(d);
    requestAnimationFrame(function () { d.style.transform = 'scale(1)'; d.style.opacity = '0'; });
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 650);
  }, { passive: true });
})();
