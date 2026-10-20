/* ---------------- ADDED: Tracker updates (server: TrackerFeed.gs) ----------------
   What the team changed in VW_Tracker: a bell in the top bar, a panel with every change (old -> new, who, when),
   a strip on Today, and the history of one work in its side panel. Asks every minute while the hub is visible. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(fn) {
    var a = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      var t = window.__hubSlow ? window.__hubSlow(fn) : 0;
      var r = google.script.run.withSuccessHandler(function (v) { clearTimeout(t); res(v); }).withFailureHandler(function (e) { clearTimeout(t); if (window.__hubFail) window.__hubFail(fn, e); rej(new Error(e && e.message ? e.message : String(e))); });
      r[fn].apply(r, a);
    });
  }
  function note(m) { if (typeof toast === 'function') toast(m); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  var F = { ev: [], last: 0, seen: store('tf-seen'), info: null, filter: 'all', open: false, timer: null, busy: false, first: true, fails: 0, shown: 60 };

  var ICON = { 'new': '🆕', approval: '✅', status: '🔄', tijori: '⬆️', wcr: '📝', refs: '🔗', money: '💰', other: '✏️', removed: '🗑️', bulk: '⚠️' };
  var FILTERS = [['all', 'All'], ['new', 'New quotations'], ['approval', 'Approvals'], ['status', 'Status'], ['refs', 'RF / PR / PO'], ['other', 'Other']];
  var LABEL = { 'Quote Approved from WASL': 'WASL approval', 'AGFS Works Status': 'Status', 'Quote Uploaded in Tijori': 'Tijori', 'Total Supplier Cost': 'Supplier cost', 'Total WASL Cost': 'WASL cost' };

  function who(s) { s = String(s || ''); if (s.indexOf('@') > -1) s = s.split('@')[0].replace(/[._-]+/g, ' '); return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  // "14/10/2026 10:42" (the tracker's own stamp) or "2026-10-14 10:50:12" (when the hub found it) -> sortable + readable
  function parseWhen(e) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(e.at || '');
    if (m) return { day: m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2), time: m[4] ? ('0' + m[4]).slice(-2) + ':' + m[5] : '' };
    m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(e.found || '');
    return m ? { day: m[1], time: m[2], found: true } : { day: '', time: '' };
  }
  function dayName(d) {
    if (!d) return 'Earlier';
    var t = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10), y = new Date(Date.now() + 4 * 3600e3 - 86400e3).toISOString().slice(0, 10);
    if (d === t) return 'Today'; if (d === y) return 'Yesterday';
    var p = d.split('-'); return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + p[0];
  }
  // one card per work per look at the tracker
  function groups(list) {
    var out = [], by = {};
    list.forEach(function (e) {
      var k = e.kind === 'bulk' ? 'bulk' + e.id : e.found + '|' + e.qtn;
      var g = by[k];
      if (!g) { g = by[k] = { key: k, qtn: e.qtn, crm: e.crm, desc: e.desc, building: e.building, by: e.by, items: [], kinds: {}, id: e.id, when: parseWhen(e) }; out.push(g); }
      g.items.push(e); g.kinds[e.kind] = 1; g.id = Math.max(g.id, e.id);
      if (e.by) g.by = e.by;
    });
    out.forEach(function (g) {
      var k = g.kinds;
      g.kind = k['new'] ? 'new' : k.removed ? 'removed' : k.bulk ? 'bulk' : k.approval ? 'approval' : k.status ? 'status' : k.refs ? 'refs' : k.tijori ? 'tijori' : k.wcr ? 'wcr' : k.money ? 'money' : 'other';
    });
    return out.reverse();                       // newest first
  }
  function match(g) {
    var f = F.filter; if (f === 'all') return true;
    if (f === 'other') return !(g.kinds['new'] || g.kinds.approval || g.kinds.status || g.kinds.refs);
    return !!g.kinds[f];
  }
  function unread() { var s = Number(F.seen) || 0; return groups(F.ev).filter(function (g) { return g.id > s; }); }

  function valHtml(e) {
    var col = e.col, now = e.now, cls = /^(yes|approved|done)$/i.test(now) ? 'yes' : /^(no|rejected|cancelled)$/i.test(now) ? 'no' : '';
    return '<span class="c">' + esc(LABEL[col] || col) + '</span><span class="v">' + (e.was ? '<s>' + esc(e.was) + '</s>' : '') + (now ? '<b class="' + cls + '">' + esc(now) + '</b>' : '<i style="color:var(--text-3)">cleared</i>') + '</span>';
  }
  function cardHtml(g, isNew) {
    var title = g.kind === 'new' ? 'New quotation ' + g.qtn : g.kind === 'removed' ? 'Removed ' + g.qtn : g.kind === 'bulk' ? 'Many changes at once' : g.qtn;
    var w = [g.kind === 'new' && g.crm ? 'CRM ' + g.crm : '', g.desc, g.building].filter(Boolean).join(' · ');
    if (g.kind === 'bulk') w = g.desc;
    var ch = g.items.filter(function (e) { return e.col; });
    var meta = [g.by ? who(g.by) : '', g.when.time ? (g.when.found ? 'found ' : '') + g.when.time : ''].filter(Boolean).join(' · ');
    return '<button type="button" class="tf-g' + (isNew ? ' unread' : '') + '" data-q="' + esc(g.kind === 'removed' || g.kind === 'bulk' ? '' : g.qtn) + '">' +
      '<div class="top"><span class="ic" aria-hidden="true">' + (ICON[g.kind] || '✏️') + '</span><span class="tt"><b>' + esc(title) + '</b>' +
      (w ? '<div class="w">' + esc(w) + '</div>' : '') + '</span><span class="meta">' + esc(meta) + '</span></div>' +
      (ch.length ? '<div class="tf-ch">' + ch.slice(0, 8).map(valHtml).join('') + (ch.length > 8 ? '<span class="c"></span><span class="v" style="color:var(--text-3)">+' + (ch.length - 8) + ' more</span>' : '') + '</div>' : '') + '</button>';
  }

  /* ---------- bell + panel ---------- */
  var bell = document.createElement('button');
  bell.type = 'button'; bell.className = 'tf-bell'; bell.id = 'tf-bell'; bell.title = 'Tracker updates: what your team changed in VW_Tracker';
  bell.setAttribute('aria-label', 'Tracker updates');
  bell.innerHTML = '<span aria-hidden="true">🔔</span><span class="n" hidden></span>';
  bell.addEventListener('click', function () { openPanel(); });
  (function () { var tb = $('mrl-chip') || $('theme-btn'); if (tb && tb.parentNode) tb.parentNode.insertBefore(bell, tb); })();

  function openPanel(filter) {
    if (F.open) return;
    F.open = true; F.shown = 60; if (filter) F.filter = filter;
    F.seenAtOpen = Number(F.seen) || 0;
    var scrim = document.createElement('div'); scrim.className = 'tf-scrim';
    var p = document.createElement('div'); p.className = 'tf-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Tracker updates');
    p.innerHTML = '<div class="tf-ph"><div class="r"><b>Tracker updates</b><span><button type="button" class="btn btn-ghost btn-sm" data-tf="read">Mark all read</button> <button type="button" class="x" data-tf="x" aria-label="Close">&times;</button></span></div>' +
      '<div class="sub" id="tf-sub"></div><div class="tf-seg">' + FILTERS.map(function (f) { return '<button type="button" data-f="' + f[0] + '"' + (F.filter === f[0] ? ' class="on"' : '') + '>' + f[1] + '</button>'; }).join('') + '</div></div><div class="tf-list" id="tf-list"></div>';
    document.body.appendChild(scrim); document.body.appendChild(p);
    function close() { scrim.remove(); p.remove(); F.open = false; document.removeEventListener('keydown', key); markRead(); }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    scrim.addEventListener('click', close);
    p.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-tf="x"]')) { close(); return; }
      if (t.closest('[data-tf="read"]')) { markRead(); F.seenAtOpen = Number(F.seen) || 0; paintPanel(); return; }
      if (t.closest('[data-tf="more"]')) { F.shown += 60; paintPanel(); return; }
      var f = t.closest('[data-f]'); if (f) { F.filter = f.getAttribute('data-f'); p.querySelectorAll('[data-f]').forEach(function (b) { b.classList.toggle('on', b === f); }); paintPanel(); return; }
      var g = t.closest('.tf-g'); if (g && g.getAttribute('data-q')) { close(); openWork(g.getAttribute('data-q')); }
    });
    paintPanel();
    poll(true);
  }
  function paintPanel() {
    var list = $('tf-list'); if (!list) return;
    var sub = $('tf-sub'), i = F.info;
    if (sub) sub.innerHTML = i ? (i.since ? 'Watching VW_Tracker since ' + esc(i.since.slice(0, 16)) + '. ' : '') + (i.auto ? 'Checked every 10 minutes, and every minute while the hub is open.' : 'Checked every minute while the hub is open.') +
      (i.trackerUrl ? ' <a href="' + esc(i.trackerUrl) + '" target="_blank" rel="noopener">Open the tracker</a>' : '') + (i.error ? '<br><span style="color:var(--danger)">Last check failed: ' + esc(i.error) + '</span>' : '') : 'Checking the tracker...';
    var gs = groups(F.ev).filter(match), s = F.seenAtOpen || 0;
    if (!gs.length) {
      list.innerHTML = '<div class="tf-empty">' + (F.ev.length ? '<b>Nothing in this filter</b>Try "All".' : i && !i.since ? '<b>Getting ready</b>The hub is taking its first copy of the tracker. Changes show here from then on.' : '<b>No changes yet</b>When your team adds a quotation or changes a cell in VW_Tracker, it shows up here within a minute.') + '</div>';
      return;
    }
    var h = '', day = null;
    gs.slice(0, F.shown).forEach(function (g) {
      var d = dayName(g.when.day); if (d !== day) { h += '<div class="tf-day">' + esc(d) + '</div>'; day = d; }
      h += cardHtml(g, g.id > s);
    });
    if (gs.length > F.shown) h += '<button type="button" class="btn btn-ghost btn-sm tf-more" data-tf="more">Show more</button>';
    list.innerHTML = h;
  }
  function markRead() { F.seen = F.last; store('tf-seen', F.seen); paintBadges(); }
  function openWork(qtn) {
    var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return String(x.qtn).toUpperCase() === String(qtn).toUpperCase(); })[0] : null;
    if (w && typeof openDrawer === 'function' && typeof DASH !== 'undefined' && DASH.loaded) { openDrawer(w.id); return; }
    note('Loading the tracker...');
    var once = function () {
      document.removeEventListener('vw-dash-loaded', once);
      var x = ST.works.filter(function (y) { return String(y.qtn).toUpperCase() === String(qtn).toUpperCase(); })[0];
      if (x) openDrawer(x.id); else note(qtn + ' is not in the tracker any more.');
    };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof loadDashboard === 'function') loadDashboard(true);
  }

  /* ---------- badges: bell + Today strip ---------- */
  function paintBadges() {
    var u = unread(), n = bell.querySelector('.n');
    n.hidden = !u.length; n.textContent = u.length > 99 ? '99+' : u.length;
    bell.title = u.length ? u.length + ' tracker update' + (u.length === 1 ? '' : 's') + ' since you last looked' : 'Tracker updates: what your team changed in VW_Tracker';
    var strip = $('tf-today');
    if (!strip) {
      var today = $('view-today'), hd = today && today.querySelector('.view-header');
      if (hd) { strip = document.createElement('div'); strip.id = 'tf-today'; strip.className = 'tf-strip'; strip.hidden = true; hd.parentNode.insertBefore(strip, hd.nextSibling); strip.addEventListener('click', function () { openPanel('all'); }); }
    }
    if (strip) {
      strip.hidden = !u.length;
      if (u.length) {
        var nw = u.filter(function (g) { return g.kind === 'new'; }).length, ap = u.filter(function (g) { return g.kinds.approval; }).length;
        var bits = [nw ? nw + ' new quotation' + (nw === 1 ? '' : 's') : '', ap ? ap + ' approval change' + (ap === 1 ? '' : 's') : '', (u.length - nw - ap) > 0 ? (u.length - nw - ap) + ' other update' + (u.length - nw - ap === 1 ? '' : 's') : ''].filter(Boolean);
        strip.innerHTML = '<span aria-hidden="true">🔔</span><span class="g"><b>Tracker:</b> ' + esc(bits.join(', ')) + ' since you last looked.</span><button type="button" class="btn btn-ghost btn-sm">See what changed</button>';
      }
    }
  }

  /* ---------- asking the server ---------- */
  function poll(now) {
    clearTimeout(F.timer);
    if (F.busy) return;
    if (document.hidden && !now) { schedule(); return; }
    F.busy = true;
    call('tfFeed', F.last).then(function (d) {
      F.busy = false; F.fails = 0; F.info = d;
      var fresh = d.events || [];
      if (fresh.length) {
        var known = {}; F.ev.forEach(function (e) { known[e.id] = 1; });
        fresh = fresh.filter(function (e) { return !known[e.id]; });
        F.ev = F.ev.concat(fresh).slice(-1500);
      }
      if (F.seen === null) { F.seen = d.last; store('tf-seen', F.seen); }   // first time on this device: start from now
      if (!F.first && fresh.length) {
        var gs = groups(fresh), nw = gs.filter(function (g) { return g.kind === 'new'; });
        note(nw.length === 1 && gs.length === 1 ? 'Tracker: new quotation ' + nw[0].qtn + (nw[0].by ? ' by ' + who(nw[0].by) : '') :
             gs.length === 1 ? 'Tracker: ' + gs[0].qtn + ' updated' + (gs[0].by ? ' by ' + who(gs[0].by) : '') : 'Tracker: ' + gs.length + ' works changed');
        refreshHistory();
      }
      F.first = false; F.last = Math.max(F.last, d.last || 0);
      paintBadges(); if (F.open) paintPanel();
      schedule();
    }).catch(function (e) { F.busy = false; F.fails++; F.info = F.info || { error: e.message }; if (F.open) paintPanel(); schedule(); });
  }
  function schedule() { clearTimeout(F.timer); F.timer = setTimeout(poll, Math.min(600000, 60000 * (1 + F.fails))); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  setTimeout(poll, 4000);

  /* ---------- the history of one work, in its side panel ---------- */
  var H = {};
  function histHtml(d) {
    var ev = (d && d.events) || [];
    var h = '<div class="jx-h">Tracker history <span><button type="button" class="btn btn-ghost btn-sm" data-tf-all>All updates</button></span></div>';
    if (!ev.length) return h + '<div style="font-size:12.5px;color:var(--text-3);margin-top:6px">No changes ' + (d && d.since ? 'since the hub started watching (' + esc(d.since.slice(0, 10)) + ')' : 'recorded yet') + '.</div>';
    var rows = ev.slice(0, 12).map(function (e) {
      var w = parseWhen(e), when = (w.day ? w.day.slice(8, 10) + '/' + w.day.slice(5, 7) : '') + (w.time ? ' ' + w.time : '');
      var t = e.kind === 'new' ? '<b>Added to the tracker</b>' : e.kind === 'removed' ? '<b>Removed from the tracker</b>' :
        esc(LABEL[e.col] || e.col) + ': ' + (e.was ? '<s>' + esc(e.was) + '</s> → ' : '') + '<b>' + esc(e.now || 'cleared') + '</b>';
      return '<span class="d">' + esc(when) + '</span><span class="t">' + t + (e.by ? ' <span style="color:var(--text-3)">· ' + esc(who(e.by)) + '</span>' : '') + '</span>';
    }).join('');
    return h + '<div class="tf-hl">' + rows + '</div>' + (ev.length > 12 ? '<div style="font-size:12px;color:var(--text-3);margin-top:6px">+' + (ev.length - 12) + ' older</div>' : '');
  }
  function mountHist() {
    var body = $('drawer-body'); if (!body || $('tf-sec')) return;
    var qtn = (($('dh-ref') || {}).textContent || '').trim(); if (!qtn || qtn === 'Work') return;
    var sec = document.createElement('div'); sec.className = 'd-sec'; sec.id = 'tf-sec'; sec.dataset.qtn = qtn;
    sec.innerHTML = '<div class="jx-h">Tracker history <small>checking...</small></div>';
    body.appendChild(sec);
    var c = H[qtn];
    if (c && Date.now() - c.at < 60000) { sec.innerHTML = histHtml(c.d); return; }
    call('tfHistory', qtn).then(function (d) { H[qtn] = { d: d, at: Date.now() }; if (sec.dataset.qtn === qtn) sec.innerHTML = histHtml(d); }).catch(function () { sec.remove(); });
  }
  function refreshHistory() { H = {}; var sec = $('tf-sec'); if (sec) { var q = sec.dataset.qtn; sec.remove(); mountHist(); } }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () { if (!$('tf-sec')) setTimeout(mountHist, 50); }).observe($('drawer-body'), { childList: true });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-tf-all]')) { if (typeof closeDrawer === 'function') closeDrawer(); openPanel('all'); } });

  window.__vwTracker = { open: openPanel, poll: poll };
})();
