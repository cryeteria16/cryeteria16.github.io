/* ---------------- "Live" indicators + auto-refresh ----------------
   Every minute: when was the tracker last edited, and when were SAP / D365 last pulled?
   If something is newer than what a dashboard shows, that dashboard reloads by itself
   (not while the work panel is open). Paused while the browser tab is hidden. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = { st: null, err: false, at: { dash: 0, wasl: 0, proc: 0 }, forced: { dash: 0, wasl: 0, proc: 0 }, busy: {}, pills: {}, timer: null, poll: 60 };
  var MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  // "11 Oct 2026, 20:44" (Dubai time, as the server writes it) -> milliseconds
  function parseGen(s) {
    var m = /(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})/.exec(s || '');
    return m && MON[m[2]] !== undefined ? Date.UTC(+m[3], MON[m[2]], +m[1], +m[4] - 4, +m[5]) : 0;
  }
  function t(ms) { return ms ? Date.parse(ms) || 0 : 0; }
  function hhmm(ms) { var d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function rel(iso) {
    var ms = typeof iso === 'number' ? iso : t(iso);
    if (!ms) return 'never';
    var s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    var d = new Date(ms), today = new Date();
    if (d.toDateString() === today.toDateString()) return 'today ' + hhmm(ms);
    var y = new Date(today.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return 'yesterday ' + hhmm(ms);
    return Math.round(s / 86400) + ' days ago';
  }

  // ---- the pills ----
  function makePill(key, host) {
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'live-pill wait';
    b.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span class="lp-txt"><b>Live</b> · connecting...</span>';
    b.addEventListener('click', function () { refreshNow(key); });
    host.insertBefore(b, host.firstChild);
    L.pills[key] = b;
  }
  makePill('dash', document.querySelector('#view-dash .view-actions'));
  makePill('wasl', document.querySelector('#wl-main .view-actions'));
  makePill('proc', $('pq-actions'));

  // ---- when each dashboard got its data ----
  document.addEventListener('vw-dash-loaded', function () {
    L.at.dash = Math.max(parseGen(DASH.generatedAt), L.forced.dash || 0) || Date.now(); L.busy.dash = false; paint();
  });
  document.addEventListener('vw-d365-loaded', function (e) {
    L.at.proc = Math.max(t(e.detail && e.detail.generatedISO), L.forced.proc || 0) || Date.now(); L.busy.proc = false; paint();
  });
  document.addEventListener('vw-d365-failed', function () { L.busy.proc = false; paint(); });
  var wsub = $('wl-sub');
  if (wsub && window.MutationObserver) {
    new MutationObserver(function () {
      var g = parseGen(wsub.textContent);
      if (g) { L.at.wasl = Math.max(g, L.forced.wasl || 0); L.busy.wasl = false; paint(); }
    }).observe(wsub, { childList: true, characterData: true, subtree: true });
  }

  function shown(key) {
    if (key === 'dash') return $('view-dash').style.display !== 'none' && DASH.loaded;
    if (key === 'wasl') return $('view-wasl').style.display !== 'none' && $('wl-main').style.display !== 'none' && $('wl-loading').style.display === 'none';
    if (key === 'proc') return $('view-proc').style.display !== 'none' && $('pq-loading').style.display === 'none';
    return false;
  }
  function drawerOpen() { return $('drawer') && $('drawer').classList.contains('open'); }

  function reload(key) {
    L.busy[key] = true; L.forced[key] = Date.now(); paint();
    if (key === 'dash') { if ($('btn-refresh').disabled) { L.busy.dash = false; return; } $('btn-refresh').click(); }
    if (key === 'wasl') $('wl-refresh').click();
    if (key === 'proc' && window.vwProcReload) window.vwProcReload();
    setTimeout(function () { if (L.busy[key]) { L.busy[key] = false; paint(); } }, 120000);   // never stay "updating" for ever
  }
  function refreshNow(key) { poll(); if (shown(key) && !L.busy[key]) reload(key); }

  // ---- decide what to reload ----
  function decide() {
    var s = L.st; if (!s) return;
    var tracker = t(s.tracker && s.tracker.editedISO), sap = t(s.sap && s.sap.lastISO), d365 = t(s.d365 && s.d365.lastISO);
    var newer = function (key, x) { return x && L.at[key] && x > L.at[key] + 1000; };
    if (shown('dash') && !L.busy.dash && !drawerOpen() && newer('dash', tracker)) { reload('dash'); toast('The tracker changed: dashboard updated'); }
    if (shown('wasl') && !L.busy.wasl && (newer('wasl', sap) || newer('wasl', tracker))) reload('wasl');
    if (shown('proc') && !L.busy.proc && (newer('proc', d365) || newer('proc', tracker))) reload('proc');
  }

  // ---- text on the pills ----
  function set(key, cls, html, title) {
    var b = L.pills[key]; if (!b) return;
    b.className = 'live-pill ' + cls;
    b.querySelector('.lp-txt').innerHTML = html;
    b.title = title + '\nChecks for changes every minute and reloads by itself. Click to check now.';
  }
  function paint() {
    var s = L.st, hidden = document.hidden;
    ['dash', 'wasl', 'proc'].forEach(function (key) {
      if (!L.pills[key]) return;
      if (L.err) return set(key, 'off', '<b>Offline</b> · retrying', 'Could not reach the server.');
      if (!s) return set(key, 'wait', '<b>Live</b> · connecting...', '');
      var tr = s.tracker || {}, trTxt = tr.editedISO ? 'tracker edited ' + rel(tr.editedISO) : 'tracker edit time unknown';
      var cls = hidden ? 'paused' : L.busy[key] ? 'busy' : '';
      var head = hidden ? '<b>Paused</b>' : L.busy[key] ? '<b>Updating...</b>' : '<b>Live</b>';
      if (key === 'dash') {
        set(key, cls, head + ' · ' + trTxt + (L.at.dash ? ' · read ' + hhmm(L.at.dash) : ''),
          'VW_Tracker last edited: ' + (tr.editedDisplay || '-') + '\nDashboard data read from the tracker: ' + (L.at.dash ? new Date(L.at.dash).toLocaleString() : '-'));
      } else if (key === 'wasl') {
        var sp = s.sap || {}, bad = sp.error || sp.stale;
        set(key, hidden ? 'paused' : bad ? 'stale' : cls,
          (hidden ? '<b>Paused</b>' : bad ? '<b>' + (sp.error ? 'SAP update failed' : 'SAP data old') + '</b>' : head) + ' · SAP pulled ' + rel(sp.lastISO) + ' · ' + trTxt,
          'SAP data last pulled from WASL: ' + (sp.lastDisplay || 'never') + (sp.rows ? ' (' + sp.rows + ' rows)' : '') + (sp.error ? '\nLast error: ' + sp.error : '') +
          '\nVW_Tracker last edited: ' + (tr.editedDisplay || '-') + (L.at.wasl ? '\nThis page read SAP + tracker: ' + new Date(L.at.wasl).toLocaleString() : ''));
      } else {
        var d = s.d365 || {}, lists = ['RF', 'PR', 'PO'].filter(function (k) { return d[k] && d[k].iso; });
        var stale = !lists.length || ['RF', 'PR', 'PO'].some(function (k) { return !d[k] || d[k].stale; });
        set(key, hidden ? 'paused' : stale ? 'stale' : cls,
          (hidden ? '<b>Paused</b>' : stale ? '<b>' + (lists.length ? 'D365 data old' : 'No D365 data') + '</b>' : head) + ' · D365 pulled ' + rel(d.lastISO) + ' · ' + trTxt,
          ['RF', 'PR', 'PO'].map(function (k) { var x = d[k] || {}; return k + ': ' + (x.display || 'never') + (x.display ? ' (' + x.rows + ' rows, ' + x.source + ')' : ''); }).join('\n') +
          (d.lastError ? '\nLast PC error: ' + d.lastError : '') + '\nVW_Tracker last edited: ' + (tr.editedDisplay || '-'));
      }
    });
  }

  function poll() {
    if (document.hidden) { paint(); return; }
    google.script.run
      .withSuccessHandler(function (s) {
        L.st = s; L.err = false;
        try { document.dispatchEvent(new CustomEvent('vw-live', { detail: s })); } catch (e) {}   // v36: the "data as of" line listens
        if (s && s.poll && s.poll !== L.poll) { L.poll = s.poll; schedule(); }
        decide(); paint();
      })
      .withFailureHandler(function () { L.err = true; paint(); })
      .hubLiveStatus();
  }
  function schedule() { clearInterval(L.timer); L.timer = setInterval(poll, Math.max(30, L.poll) * 1000); }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); else paint(); });
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) { n.addEventListener('click', function () { setTimeout(poll, 400); }); });
  setInterval(paint, 30000);
  schedule();
  setTimeout(poll, 1500);
})();
