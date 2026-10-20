/* ibadhasan.com/work: stands in for Google's google.script.run, so the hub's pages work outside Apps Script.
   Each call goes to api.ibadhasan.com/work/call with the Lair sign-in; the helper passes it to the backup
   Apps Script (WorkCopy.gs doPost), which runs the same server function the hub would. */
(function () {
  'use strict';
  if (window.google && google.script && google.script.run) return;   // the page test brings its own
  var API = 'https://api.ibadhasan.com/work/call';
  function token() { try { return localStorage.getItem('lair.session') || ''; } catch (e) { return ''; } }
  function signIn() { try { localStorage.removeItem('lair.session'); } catch (e) {} location.replace('/lair?next=' + encodeURIComponent(location.pathname + location.search)); }
  if (!token()) { signIn(); return; }

  function call(fn, args, ok, fail, user) {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify({ fn: fn, args: args }) })
      .then(function (r) {
        if (r.status === 401) { signIn(); throw new Error('Please sign in again.'); }
        return r.json().catch(function () { throw new Error('The work hub did not answer (' + r.status + ').'); }).then(function (j) {
          if (!r.ok || !j.ok) throw new Error(j.error || ('The work hub did not answer (' + r.status + ').'));
          return j.value;
        });
      }, function () { throw new Error(navigator.onLine === false ? 'No internet connection.' : 'Could not reach the work hub.'); })
      .then(function (v) { if (ok) ok(v, user); }, function (e) { if (fail) fail(e, user); else console.error(fn + ': ' + e.message); });
  }

  function runner(ok, fail, user) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (f) { return runner(f, fail, user); };
      if (k === 'withFailureHandler') return function (f) { return runner(ok, f, user); };
      if (k === 'withUserObject') return function (o) { return runner(ok, fail, o); };
      if (typeof k !== 'string' || k === 'then') return undefined;
      return function () { call(k, Array.prototype.slice.call(arguments), ok, fail, user); };
    } });
  }

  window.google = window.google || {};
  google.script = {
    run: runner(),
    url: { getLocation: function (cb) {
      var q = new URLSearchParams(location.search), one = {}, all = {};
      q.forEach(function (v, k) { if (!(k in one)) one[k] = v; (all[k] = all[k] || []).push(v); });
      cb({ parameter: one, parameters: all, hash: location.hash.replace(/^#/, '') });
    } },
    host: { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } },
    history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} }
  };
})();
