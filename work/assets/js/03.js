/* v16: robustness helpers shared by every page.
   - __hubFail: a server call failed -> record it in the HUB_Errors tab (at most 5 reports a minute).
   - __hubSlow: a server call is taking long -> say so once, so a button never looks frozen.
   - page script errors are recorded too. Nothing here changes what any page does. */
(function () {
  'use strict';
  var sent = [], SKIP = { hubReportClientError: 1 };
  function report(where, message, detail) {
    try {
      var now = Date.now(); sent = sent.filter(function (t) { return now - t < 60000; });
      if (sent.length >= 5 || !window.google || !google.script || !google.script.run) return;
      sent.push(now);
      google.script.run.withFailureHandler(function () {}).hubReportClientError({ where: String(where).slice(0, 80), message: String(message).slice(0, 800), detail: String(detail || '').slice(0, 1500) });
    } catch (e) {}
  }
  window.__hubFail = function (fn, e) {
    if (SKIP[fn]) return;
    var m = e && e.message ? e.message : String(e);
    report(fn, m, (navigator.onLine === false ? 'offline; ' : '') + location.hash);
  };
  window.__hubSlow = function (fn) {
    return setTimeout(function () { try { if (typeof toast === 'function') toast('Still working on it…'); } catch (e) {} }, 45000);
  };
  window.addEventListener('error', function (ev) {
    if (!ev || !ev.message) return;
    report('script', ev.message, (ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason; report('promise', r && r.message ? r.message : String(r), r && r.stack ? String(r.stack).slice(0, 600) : '');
  });
})();
