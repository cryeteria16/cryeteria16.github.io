/* ---------------- v36: search box, "data as of" line, quote-sent / GRN marks ----------------
   Reads only: the tracker data the Dashboard already loaded (ST), Dynamics (d365GetDashboard), hubSystemStatus, hubLiveStatus.
   Writes only the hub's own tab HUB_Marks (hubMarkSet, Marks.gs). VW_Tracker is never written. Cancelled works are never shown. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(fn) {
    var a = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      if (typeof google === 'undefined' || !google.script) { rej(new Error('Not connected')); return; }
      var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) { rej(new Error(e && e.message ? e.message : String(e))); });
      r[fn].apply(r, a);
    });
  }
  function note(m) { if (typeof toast === 'function') toast(m); }
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dl(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MONS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  function todayIso() { var d = new Date(Date.now() + 4 * 3600e3); return d.toISOString().slice(0, 10); }   // Dubai
  function works() { return (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (w) { return w.statusKey !== 'cancelled'; }) : []; }
  function ensureWorks(cb) {
    if (typeof DASH !== 'undefined' && DASH.loaded) { cb(); return; }
    var once = function () { document.removeEventListener('vw-dash-loaded', once); cb(); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded && typeof loadDashboard === 'function' && !ensureWorks.asked) { ensureWorks.asked = true; loadDashboard(false); }
  }
  function openWork(id) { if (typeof openDrawer === 'function') openDrawer(Number(id)); }

  /* =================== 1. SEARCH (header) =================== */
  var F = { sup: null, d: null, dAsked: false, sel: 0, hits: [] };
  var hdr = document.querySelector('.app-header');
  var wrap = document.createElement('div'); wrap.className = 'vf-wrap'; wrap.id = 'vf-wrap';
  wrap.innerHTML = '<button type="button" class="vf-icon" id="vf-icon" aria-label="Search">🔍</button>' +
    '<label class="vf-box"><span aria-hidden="true">🔍</span><input id="vf-q" type="search" autocomplete="off" spellcheck="false" placeholder="Find a job: CRM, quote, RF, PR, PO, LPO, MRI…" aria-label="Find a job by any number"><kbd class="vf-k">Ctrl K</kbd></label>' +
    '<div class="vf-pop" id="vf-pop" hidden role="listbox"></div>';
  (function () { var t = $('hdr-title'); if (t && t.parentNode) t.parentNode.insertBefore(wrap, t.nextSibling); })();
  var q = $('vf-q'), pop = $('vf-pop');
  (function () { var k = wrap.querySelector('.vf-k'); if (k && /Mac|iPhone|iPad/.test(navigator.platform || '')) k.textContent = '⌘ K'; })();

  function supOf(building) {
    var m = /DD\s?(\d{3})/i.exec(String(building || '')), code = m ? 'DD' + m[1] : '';
    var list = F.sup || [];
    for (var i = 0; i < list.length - 1; i++) if (list[i].codes.indexOf(code) > -1) return list[i].name;
    return list.length ? list[list.length - 1].name : '';
  }
  function key(s) { return String(s || '').toUpperCase().replace(/[\s\-\/_.]+/g, ''); }
  function stageOf(w, r) {
    if (r && r.stageName) return r.stageName + (r.next ? ' · ' + r.next : '');
    var done = w.statusKey === 'completed' || w.statusKey === 'completed_po';
    if (!done) {
      if (w.approvedKey !== 'yes') return 'Waiting on WASL approval';
      if (!w.rf) return 'Approved, RF to raise';
      if (!w.pr) return 'RF raised, waiting for the PR';
      if (!w.po) return 'PR raised, waiting for the PO';
      return 'PO released, work on';
    }
    if (w.po && !w.grn) return 'Done, GRN to release';
    if (w.wcrStage && w.wcrStage !== 'done' && w.wcrStage !== 'na') return 'Done, WCR to close';
    return 'Done';
  }
  function d365Index() {
    var by = {}, refs = {};
    ((F.d && F.d.rfs) || []).forEach(function (r) {
      if (r.trackerId === null || r.trackerId === undefined) return;
      (by[r.trackerId] = by[r.trackerId] || []).push(r);
      [r.rf].concat((r.prs || []).map(function (p) { return p.n; }), (r.pos || []).map(function (p) { return p.n; })).forEach(function (x) { if (x) refs[key(x)] = { id: r.trackerId, ref: x }; });
    });
    return { by: by, refs: refs };
  }
  var FIELDS = [['qtn', 'Quote'], ['crm', 'CRM'], ['rf', 'RF'], ['pr', 'PR'], ['po', 'PO'], ['lpo', 'WASL LPO'], ['cafmId', 'MRI WO'], ['prq', 'WASL PR'], ['waslOrder', 'WASL order'], ['invoice', 'Invoice'], ['grn', 'GRN']];
  function search(text) {
    var k = key(text), words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (k.length < 3) return [];
    var ix = d365Index(), out = [], seen = {};
    works().forEach(function (w) {
      var hit = '', score = 0;
      for (var i = 0; i < FIELDS.length && !hit; i++) {
        var v = key(w[FIELDS[i][0]]);
        if (v && v.indexOf(k) > -1) { hit = FIELDS[i][1] + ' ' + w[FIELDS[i][0]]; score = v === k ? 100 : 60; }
      }
      if (!hit) {
        var hay = [w.desc, w.building, w.supplier, w.apt].join(' ').toLowerCase();
        if (words.length && words.every(function (x) { return hay.indexOf(x) > -1; })) { hit = ''; score = 20; }
      }
      if (score) { out.push({ w: w, hit: hit, score: score }); seen[w.id] = 1; }
    });
    Object.keys(ix.refs).forEach(function (r) {                 // numbers that only Dynamics knows (an RF / PR / PO missing in the tracker)
      if (r.indexOf(k) < 0) return;
      var x = ix.refs[r], w = (typeof ST !== 'undefined' && ST.byId) ? ST.byId[x.id] : null;
      if (!w || w.statusKey === 'cancelled' || seen[w.id]) return;
      seen[w.id] = 1; out.push({ w: w, hit: 'Dynamics ' + x.ref, score: r === k ? 90 : 50 });
    });
    out.sort(function (a, b) { return b.score - a.score || String(b.w.qtnDate || '').localeCompare(String(a.w.qtnDate || '')); });
    return out.slice(0, 8).map(function (o) { o.rfs = ix.by[o.w.id] || []; return o; });
  }
  /* v38: the part of a number or description that matched the search is highlighted */
  function mark(s, text) {
    s = String(s || ''); var e = esc(s), k = key(text);
    if (!k) return e;
    var ks = '', map = [];                                   // match ignoring spaces / dashes, like search() does
    for (var i = 0; i < s.length; i++) { var c = s[i].toUpperCase(); if (!/[\s\-\/_.]/.test(c)) { ks += c; map.push(i); } }
    var at = ks.indexOf(k);
    if (at < 0) {
      var w = String(text || '').trim().toLowerCase(), j = w.length > 2 ? s.toLowerCase().indexOf(w) : -1;
      return j < 0 ? e : esc(s.slice(0, j)) + '<mark>' + esc(s.slice(j, j + w.length)) + '</mark>' + esc(s.slice(j + w.length));
    }
    var a = map[at], b = map[at + k.length - 1] + 1;
    return esc(s.slice(0, a)) + '<mark>' + esc(s.slice(a, b)) + '</mark>' + esc(s.slice(b));
  }
  function draw() {
    var text = q.value.trim();
    if (key(text).length < 3) { pop.innerHTML = '<div class="vf-empty">Type at least 3 characters of any number (CRM, quote, RF, PR, PO, WASL LPO, MRI work order) or words from the job.</div>'; pop.hidden = false; return; }
    if (typeof DASH !== 'undefined' && !DASH.loaded) { pop.innerHTML = '<div class="vf-empty">Loading the tracker…</div>'; pop.hidden = false; ensureWorks(draw); return; }
    var hits = F.hits = search(text); F.sel = 0;
    if (!hits.length) { pop.innerHTML = '<div class="vf-empty">No open job matches "' + esc(text) + '".' + (F.d ? '' : ' Dynamics numbers are still loading…') + '</div>'; pop.hidden = false; return; }
    var meta = typeof STATUS_META !== 'undefined' ? STATUS_META : {};
    pop.innerHTML = '<div class="vf-h">' + hits.length + ' job' + (hits.length === 1 ? '' : 's') + (F.d ? '' : ' · Dynamics still loading') + '</div>' + hits.map(function (o, i) {
      var w = o.w, r = o.rfs[0], m = meta[w.statusKey] || {}, sup = supOf(w.building);
      return '<button type="button" class="vf-r' + (i === 0 ? ' on' : '') + '" data-i="' + i + '" role="option" style="--d:' + (i * 28) + 'ms"><b>' + mark(w.qtn || 'Work', text) + ' · ' + mark(w.desc, text) + '</b>' +
        '<span class="s">' + esc([w.building, sup ? 'Supervisor ' + sup : '', w.crm ? 'CRM ' + w.crm : ''].filter(Boolean).join(' · ')) + '</span>' +
        '<span class="t"><span class="vf-tag st" style="--c:' + esc(m.color || '#64748B') + '">' + esc(m.label || w.status || 'No status') + '</span>' +
        '<span class="vf-tag">' + esc(stageOf(w, r)) + '</span>' + (o.hit ? '<span class="vf-tag hit">' + mark(o.hit, text) + '</span>' : '') + '</span></button>';
    }).join('');
    pop.hidden = false;
  }
  function pick(i) { var o = F.hits[i]; if (!o) return; close(); openWork(o.w.id); }
  function close() { pop.hidden = true; wrap.classList.remove('open'); }
  function warm() {
    ensureWorks(function () {});
    if (!F.sup) call('phSupervisors').then(function (s) { F.sup = s; }).catch(function () { F.sup = []; });
    if (!F.dAsked) { F.dAsked = true; call('d365GetDashboard', false).then(function (d) { F.d = d; if (!pop.hidden) draw(); }).catch(function () { F.d = { rfs: [] }; }); }
  }
  var qt = null;
  q.addEventListener('focus', function () { warm(); if (q.value.trim()) draw(); });
  q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(draw, 120); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); q.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(F.sel); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!F.hits.length) return;
      F.sel = (F.sel + (e.key === 'ArrowDown' ? 1 : F.hits.length - 1)) % F.hits.length;
      pop.querySelectorAll('.vf-r').forEach(function (b, i) { b.classList.toggle('on', i === F.sel); if (i === F.sel) b.scrollIntoView({ block: 'nearest' }); });
    }
  });
  pop.addEventListener('click', function (e) { var b = e.target.closest('.vf-r'); if (b) pick(Number(b.dataset.i)); });
  $('vf-icon').addEventListener('click', function () { wrap.classList.add('open'); warm(); setTimeout(function () { q.focus(); }, 30); });
  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (window.matchMedia('(max-width:768px)').matches) wrap.classList.add('open'); warm(); q.focus(); }
    // v38: Ctrl+K (Cmd+K on a Mac) opens the same search from anywhere, even while typing elsewhere
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault(); wrap.classList.add('open'); warm(); q.focus(); q.select(); if (q.value.trim()) draw();
    }
  });

  /* =================== 2. "DATA AS OF" line (every page) =================== */
  var R = { sys: null, live: null, at: 0, open: false };
  var bar = document.createElement('div'); bar.className = 'vfr'; bar.id = 'vf-fresh'; bar.hidden = true;
  function place() {                                            // under the title of the page that is open
    var sec = Array.prototype.filter.call(document.querySelectorAll('#content > section'), function (s) { return s.style.display !== 'none'; })[0];
    if (!sec) return;
    var head = sec.querySelector(':scope > .view-header') || sec.querySelector('.view-header');
    if (head && head.nextSibling !== bar) head.parentNode.insertBefore(bar, head.nextSibling);
  }
  function minAgo(iso) { var t = iso ? new Date(iso).getTime() : NaN; return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); }
  function ago(min) { return min === null ? 'never' : min < 2 ? 'just now' : min < 60 ? min + ' min ago' : min < 1440 ? Math.round(min / 60) + ' h ago' : Math.round(min / 1440) + ' days ago'; }
  function paint() {
    var items = [];
    var tr = R.live && R.live.tracker;
    if (tr && tr.editedISO) items.push({ k: 'trk', name: 'Tracker', state: 'ok', short: 'edited ' + ago(minAgo(tr.editedISO)), text: 'VW_Tracker last edited ' + (tr.editedDisplay || ''), detail: '' });
    ((R.sys && R.sys.items) || []).forEach(function (i) {
      var label = { d365: 'Dynamics', sap: 'WASL SAP', mri: 'MRI job', rfd: 'RF docs job' }[i.k] || i.name;
      if (i.k === 'rfd' && i.state !== 'bad') return;             // the PC line already says whether the PC is on
      items.push({ k: i.k, name: label, state: i.state, short: i.short || i.text, text: i.name + ': ' + i.text, detail: i.detail || '' });
    });
    if (!items.length) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<div class="vfr-s"><span class="vfr-l">Data as of</span>' + items.map(function (i) {
      return '<button type="button" class="vfr-i ' + esc(i.state) + '" title="' + esc(i.text + (i.detail ? '\n' + i.detail : '')) + '"><i></i>' + esc(i.name) + ' <b>' + esc(i.short) + '</b>' + (i.state === 'bad' ? ' ⚠' : '') + '</button>';
    }).join('') + '</div><div class="vfr-d"' + (R.open ? '' : ' hidden') + '>' + items.map(function (i) {
      return '<div class="' + esc(i.state) + '"><b>' + esc(i.text) + '</b>' + (i.detail ? '<small>' + esc(i.detail) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
    place();
  }
  bar.addEventListener('click', function (e) { if (e.target.closest('.vfr-i')) { R.open = !R.open; paint(); } });
  function loadSys() {
    if (document.hidden) return;
    R.at = Date.now();
    call('hubSystemStatus').then(function (s) { R.sys = s; paint(); }).catch(function () {});
  }
  document.addEventListener('vw-live', function (e) { R.live = e.detail; paint(); });
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) { n.addEventListener('click', function () { setTimeout(place, 60); setTimeout(place, 600); }); });
  setInterval(function () { if (Date.now() - R.at > 300000) loadSys(); }, 20000);
  setTimeout(loadSys, 2500);

  /* =================== 3. Quote sent / GRN released (the hub's own record) =================== */
  var M = { all: null, busy: null };
  function mkey(qtn) { return String(qtn || '').toUpperCase().replace(/\s+/g, ''); }
  function getAll() { if (M.all) return Promise.resolve(M.all); if (!M.busy) M.busy = call('hubMarksGet').then(function (a) { M.all = a || {}; M.busy = null; return M.all; }, function (e) { M.busy = null; throw e; }); return M.busy; }
  function closeM() { $('vmk-modal').classList.remove('open'); }
  $('vmk-x').addEventListener('click', closeM);
  $('vmk-modal').addEventListener('click', function (e) { if (e.target === this) closeM(); });
  function ask(qtn, kind, done) {
    var m = (M.all && M.all[mkey(qtn)] && M.all[mkey(qtn)][kind]) || {};
    $('vmk-title').textContent = kind === 'sent' ? 'Quote sent to WASL' : 'GRN released';
    $('vmk-body').innerHTML = '<div class="pq-mtext">' + esc(qtn) + (kind === 'sent'
        ? '. The date you e-mailed the quote to WASL. Saved in the hub only: please also fill "QTN Email Date" in the tracker when you can.'
        : '. Saved in the hub only: please also fill "GRN Reference" in the tracker when you can.') + '</div>' +
      '<label>Date<input type="date" id="vmk-date" value="' + esc(m.date || todayIso()) + '" max="' + todayIso() + '"></label>' +
      '<label>' + (kind === 'grn' ? 'GRN number (optional)' : 'Note (optional)') + '<input type="text" id="vmk-note" maxlength="120" value="' + esc(m.note || '') + '" placeholder="' + (kind === 'grn' ? 'e.g. GRN9728-0001234' : 'e.g. sent by Ibad') + '"></label>' +
      '<div class="vmk-acts">' + (m.date ? '<button type="button" class="btn btn-ghost btn-sm" id="vmk-clear">Remove</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" id="vmk-cancel">Cancel</button><button type="button" class="btn btn-primary btn-sm" id="vmk-save">Save</button></div>';
    $('vmk-modal').classList.add('open');
    $('vmk-cancel').onclick = closeM;
    function keep(r) { if (M.all) { if (r && Object.keys(r).length) M.all[mkey(qtn)] = r; else delete M.all[mkey(qtn)]; } }
    function save(clear) {
      var b = $('vmk-save'); b.disabled = true;
      var before = { date: m.date || '', note: m.note || '' };          // v38: what Undo puts back
      call('hubMarkSet', qtn, kind, $('vmk-date').value, $('vmk-note').value, !!clear).then(function (r) {
        keep(r); closeM(); if (done) done(r);
        var label = kind === 'sent' ? 'Quote sent' : 'GRN released';
        var undo = function () {
          call('hubMarkSet', qtn, kind, before.date, before.note, !before.date).then(function (r2) {
            keep(r2); note('Put back: ' + qtn + ' ' + (before.date ? label.toLowerCase() + ' ' + dl(before.date) : 'not marked')); if (done) done(r2);
          }).catch(function (e) { note('Could not undo: ' + e.message); });
        };
        if (typeof toast === 'function') toast((clear ? 'Removed: ' : label + ' saved: ') + qtn, { actions: [{ label: 'Undo', run: undo }] });
      }).catch(function (e) { b.disabled = false; note('Could not save: ' + e.message); });
    }
    $('vmk-save').onclick = function () { save(false); };
    if ($('vmk-clear')) $('vmk-clear').onclick = function () { save(true); };
  }
  function fill(w) {
    var box = $('d-marks'); if (!box) return;
    getAll().then(function (all) {
      if (!$('d-marks') || $('dh-ref').textContent !== (w.qtn || 'Work')) return;
      var m = all[mkey(w.qtn)] || {};
      function row(kind, label, trackerVal, trackerName) {
        var v = trackerVal ? esc(kind === 'sent' ? dl(trackerVal) : trackerVal) + ' <span class="vmk-src">(tracker)</span>'
          : m[kind] ? esc(dl(m[kind].date)) + (m[kind].note ? ' · ' + esc(m[kind].note) : '') + ' <span class="vmk-src">(saved in the hub)</span>'
          : '<span class="muted">Not recorded</span>';
        var btn = trackerVal ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-mk="' + kind + '">' + (m[kind] ? 'Change' : (kind === 'sent' ? '📨 Mark sent' : '✅ Mark GRN released')) + '</button>';
        return '<div class="d-item full"><div class="d-lbl">' + esc(label) + '</div><div class="vmk-row"><div class="d-val">' + v + '</div>' + btn + '</div>' +
          (!trackerVal && m[kind] ? '<div class="vmk-src">Copy it to "' + esc(trackerName) + '" in the tracker when you can.</div>' : '') + '</div>';
      }
      var done = w.statusKey === 'completed' || w.statusKey === 'completed_po';
      box.innerHTML = row('sent', 'Quote e-mailed to WASL', w.qtnEmailDate, 'QTN Email Date') + (done || w.po ? row('grn', 'GRN', w.grn, 'GRN Reference') : '');
    }).catch(function (e) { box.innerHTML = '<div class="d-item full"><div class="d-val muted">Could not read: ' + esc(e.message) + '</div></div>'; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#d-marks [data-mk]'); if (!b) return;
    var qtn = $('dh-ref').textContent, w = works().filter(function (x) { return x.qtn === qtn; })[0];
    if (w) ask(w.qtn, b.dataset.mk, function () { fill(w); });
  });
  window.__vwMarks = { ask: function (qtn, kind, done) { getAll().catch(function () {}).then(function () { ask(qtn, kind, done); }); }, fill: fill };
})();
