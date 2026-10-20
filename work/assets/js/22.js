/* ---------------- v16: Purchase orders card (Job Documents page). Server: Pos.gs ----------------
   Uploads every chosen PDF one by one (two at a time, files of the same PO one after the other), retries a file up to
   3 times when the connection drops, and is safe to run again: files already filed are recognised and skipped. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('po-card')) return;
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
  var MAX = 18 * 1024 * 1024, LANES = 2;
  var R = null;                     // the current run

  function poKey(name) {
    var a = /PO\d{4}-\d{6,8}/i.exec(name); if (a) return a[0].toUpperCase();
    var w = /(?:^|\D)(2\d{9})(?!\d)/.exec(name); if (w) return w[1];
    return '?' + name;
  }
  function readB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { rej(new Error('Could not read the file from your device.')); };
      fr.readAsDataURL(file);
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function permanent(msg) { return /larger than|arrived empty|Safety stop|not set yet|cannot be opened/i.test(msg); }

  function start(files) {
    if (R && R.active) { note('Still uploading the previous batch. Add these when it finishes.'); return; }
    var items = [];
    Array.prototype.forEach.call(files || [], function (f) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return;
      items.push({ f: f, name: f.name, key: poKey(f.name), st: 'queued', msg: '' });
    });
    if (!items.length) { note('Choose PDF files.'); return; }
    var groups = {}, order = [];
    items.forEach(function (it) { if (!groups[it.key]) { groups[it.key] = []; order.push(it.key); } groups[it.key].push(it); });
    R = { items: items, queue: order.map(function (k) { return groups[k]; }), active: true, n: { filed: 0, already: 0, waiting: 0, failed: 0 } };
    $('po-run').style.display = '';
    render();
    var lanes = []; for (var i = 0; i < Math.min(LANES, R.queue.length); i++) lanes.push(lane());
    Promise.all(lanes).then(function () {
      R.active = false; render();
      note('POs: ' + R.n.filed + ' filed, ' + R.n.already + ' already there, ' + R.n.waiting + ' waiting' + (R.n.failed ? ', ' + R.n.failed + ' failed' : ''));
      loadStatus();
    });
  }
  function lane() {
    var g = R.queue.shift(); if (!g) return Promise.resolve();
    return g.reduce(function (p, it) { return p.then(function () { return one(it); }); }, Promise.resolve()).then(lane);
  }
  function one(it) {
    if (it.f.size > MAX) { it.st = 'failed'; it.msg = 'Larger than 18 MB'; R.n.failed++; render(); return Promise.resolve(); }
    it.st = 'running'; render();
    var tries = 0;
    var go = function () {
      tries++;
      return readB64(it.f).then(function (b64) { return call('posUpload', { name: it.name, b64: b64 }); }).then(function (r) {
        var s = r && r.state;
        if (s === 'filed' || s === 'older') { it.st = 'filed'; R.n.filed++; it.msg = (r.jobs || []).map(function (j) { return j.ref; }).join(', ') + (r.note ? ' · ' + r.note : ''); }
        else if (s === 'already') { it.st = 'already'; R.n.already++; it.msg = (r.jobs || []).map(function (j) { return j.ref; }).join(', '); }
        else { it.st = 'waiting'; R.n.waiting++; it.msg = (r && r.note) || 'Waiting in the Inbox'; }
        render();
      }).catch(function (e) {
        if (tries < 3 && !permanent(e.message)) { it.msg = 'Connection problem, trying again…'; render(); return wait(tries * 3000).then(go); }
        it.st = 'failed'; it.msg = e.message; R.n.failed++; render();
      });
    };
    return go();
  }
  var LABEL = { queued: ['Waiting', 'run'], running: ['Uploading…', 'run'], filed: ['Filed', 'ok'], already: ['Already there', 'ok'], waiting: ['In the Inbox', 'wait'], failed: ['Failed', 'bad'] };
  var drawT = 0;
  function render() {
    if (drawT) return;
    drawT = setTimeout(function () {
      drawT = 0; if (!R) return;
      var done = R.items.filter(function (i) { return i.st !== 'queued' && i.st !== 'running'; }).length, total = R.items.length;
      $('po-fill').style.width = Math.round(done / total * 100) + '%';
      $('po-sum').textContent = (R.active ? 'Uploading ' + Math.min(done + 1, total) + ' of ' + total + ' · ' : 'Done: ' + total + ' file' + (total === 1 ? '' : 's') + ' · ') +
        R.n.filed + ' filed · ' + R.n.already + ' already there · ' + R.n.waiting + ' waiting in the Inbox' + (R.n.failed ? ' · ' + R.n.failed + ' failed' : '');
      var rows = R.items.filter(function (i) { return i.st !== 'queued'; });
      rows.sort(function (a, b) { var o = { failed: 0, running: 1, waiting: 2, filed: 3, already: 4 }; return o[a.st] - o[b.st]; });
      $('po-list').innerHTML = rows.slice(0, 300).map(function (i) {
        var l = LABEL[i.st];
        return '<div class="po-row"><div><div class="n" title="' + esc(i.name) + '">' + esc(i.name) + '</div>' + (i.msg ? '<div class="w">' + esc(i.msg) + '</div>' : '') +
          '</div><span class="po-st ' + l[1] + '">' + l[0] + '</span></div>';
      }).join('');
    }, 120);
  }

  function loadStatus() {
    call('posStatus').then(function (s) {
      if (s.folderUrl) { $('po-folder').href = s.folderUrl; $('po-folder').style.display = ''; }
      $('po-last').textContent = s.lastSweep ? 'Inbox last checked ' + s.lastSweep : '';
      var h = '';
      if (s.error) h += '<div class="muted" style="margin-top:10px;">' + esc(s.error) + '</div>';
      if (s.waiting && s.waiting.length) {
        h += '<details><summary>' + s.waiting.length + ' file' + (s.waiting.length === 1 ? '' : 's') + ' waiting in the Inbox</summary>' +
          s.waiting.map(function (f) { return '<div class="po-row"><div><div class="n"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></div><div class="w">' + esc(f.why) + '</div></div></div>'; }).join('') + '</details>';
      }
      if (s.missing && s.missing.length) {
        h += '<details><summary>' + s.missing.length + ' AGFS PO' + (s.missing.length === 1 ? '' : 's') + ' released in Dynamics without a PDF yet</summary>' +
          s.missing.map(function (m) { return '<div class="po-row"><div><div class="n">' + esc(m.po) + '</div><div class="w">' + esc([m.qtn, m.building, m.rf, m.status].filter(Boolean).join(' · ')) + '</div></div></div>'; }).join('') + '</details>';
      }
      if (!h && !s.error) h = '<div class="muted" style="margin-top:10px;font-size:12.5px;">' + (s.filedCount ? s.filedCount + ' PO files filed. Nothing waiting.' : 'No POs filed yet.') + '</div>';
      $('po-status').innerHTML = h;
    }).catch(function (e) { $('po-status').innerHTML = '<div class="muted" style="margin-top:10px;">' + esc(e.message) + '</div>'; });
  }

  $('po-input').addEventListener('change', function () { start(this.files); this.value = ''; });
  var dz = $('po-drop');
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) start(e.dataTransfer.files); });
  $('po-sweep').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Checking…';
    call('posSweep').then(function (r) {
      note('Inbox: ' + r.filed + ' filed, ' + r.waiting + ' still waiting' + (r.left ? ', ' + r.left + ' left for the next check' : ''));
      loadStatus();
    }).catch(function (e) { note(e.message); }).then(function () { b.disabled = false; b.textContent = 'Check the Inbox'; });
  });
  window.addEventListener('beforeunload', function (e) { if (R && R.active) { e.preventDefault(); e.returnValue = ''; } });
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    n.addEventListener('click', function () { if (n.dataset.view === 'docs') loadStatus(); });
  });
  if (document.getElementById('view-docs') && document.getElementById('view-docs').style.display !== 'none') loadStatus();
})();
