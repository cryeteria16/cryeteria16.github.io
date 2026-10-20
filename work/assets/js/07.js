/* ---------------- light / dark switch ---------------- */
(function () {
  'use strict';
  var btn = document.getElementById('theme-btn');
  if (!btn) return;
  function cur() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function set(t, onlyShow) {
    document.documentElement.setAttribute('data-theme', t);
    btn.setAttribute('aria-checked', t === 'dark' ? 'true' : 'false');
    btn.title = t === 'dark' ? 'Switch to light' : 'Switch to dark';
    if (!onlyShow) { try { localStorage.setItem('vwTheme', t); } catch (e) {} }   // v15.1: opening the page no longer saves, so "Auto" keeps following the device
  }
  set(cur(), true);
  btn.addEventListener('click', function () { set(cur() === 'dark' ? 'light' : 'dark'); });
})();
