/* ibadhasan.com/work: every hub page has its own address (/work/mri/, /work/bills/, ...).
   Opening an address shows that page; moving around inside the site changes the address without reloading,
   and Back / Forward work. The page list is filled in by tools/make-work-site.js. */
(function () {
  'use strict';
  var PAGES = window.__WORK_PAGES || {};          // view -> { slug, title }
  var BASE = '/work/';
  function viewFromPath(p) {
    var slug = p.replace(/^\/work\/?/, '').replace(/\/.*$/, '');
    for (var v in PAGES) if (PAGES[v].slug === slug) return v;
    return '';
  }
  function urlFor(v) { var s = PAGES[v] && PAGES[v].slug; return s ? BASE + s + '/' : BASE; }
  function nav(v) { return document.querySelector('.nav-item[data-view="' + v + '"]'); }
  function titleFor(v) { return (PAGES[v] ? PAGES[v].title + ' · ' : '') + 'Work'; }

  var quiet = false;
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    n.addEventListener('click', function () {
      var v = n.dataset.view;
      document.title = titleFor(v);
      if (quiet) return;
      var u = urlFor(v);
      if (u !== location.pathname) history.pushState({ v: v }, '', u + location.hash);
    });
  });
  window.addEventListener('popstate', function () {
    var v = viewFromPath(location.pathname) || document.documentElement.getAttribute('data-start') || 'dash', n = nav(v);
    if (n) { quiet = true; try { n.click(); } finally { quiet = false; } }
  });

  var start = viewFromPath(location.pathname) || document.documentElement.getAttribute('data-start');
  if (start && start !== 'dash') {
    var n = nav(start);
    if (n) setTimeout(function () { quiet = true; try { n.click(); } finally { quiet = false; } }, 0);
  }
  document.title = titleFor(start || 'dash');
})();
