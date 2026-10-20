/* ---------------- v38: Drop documents card (Job Documents page). Server: DropBox.gs ----------------
   One box for every job document. Uploads two files at a time, retries a file up to 3 times when the connection drops.
   Files whose job or type is unclear wait in the Drive folder; the card shows one-tap choices for them.
   Also lists the draft RFs with the three PDFs the PC attaches (AGFS quote, supplier quote, e-mail approval). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('dp-card')) return;
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
  var TYPES = [['email_approval', 'Email approval'], ['breakdown', 'Breakdown report'], ['vendor_quote', 'Supplier quote'], ['agfs_quote', 'AGFS quote'],
    ['wasl_approval', 'WASL approval'], ['wcr', 'WCR (completion report)'], ['wcr_photos', 'WCR photos'], ['photos', 'Photos'], ['other', 'Other'], ['po', 'PO (AGFS or WASL)']];
  var DOCS3 = [['agfs_quote', 'AGFS quote'], ['vendor_quote', 'Supplier quote'], ['email_approval', 'Email approval']];
  var R = null, pending = null;
  function readB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { rej(new Error('Could not read the file from your device.')); };
      fr.readAsDataURL(file);
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function permanent(msg) { return /larger than|arrived empty|Unknown document|Safety stop|not set yet|cannot be opened/i.test(msg); }
  function typeOpts(sel, withBlank) {
    return (withBlank ? '<option value="">Pick the type…</option>' : '') + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('');
  }

  // ---------- uploading ----------
  function start(files, forced) {
    if (R && R.active) { note('Still uploading the previous files. Add these when it finishes.'); return; }
    var items = [];
    Array.prototype.forEach.call(files || [], function (f) { items.push({ f: f, name: f.name, st: 'queued', msg: '', forced: forced || null }); });
    if (!items.length) return;
    R = { items: items, queue: items.slice(), active: true, n: { filed: 0, already: 0, waiting: 0, failed: 0 } };
    $('dp-run').style.display = '';
    render();
    var lanes = []; for (var i = 0; i < Math.min(LANES, items.length); i++) lanes.push(lane());
    Promise.all(lanes).then(function () {
      R.active = false; render();
      note('Drop documents: ' + R.n.filed + ' filed, ' + R.n.already + ' already there, ' + R.n.waiting + ' waiting' + (R.n.failed ? ', ' + R.n.failed + ' failed' : ''));
      loadStatus(); if (forced) loadRf();
    });
  }
  function lane() { var it = R.queue.shift(); if (!it) return Promise.resolve(); return one(it).then(lane); }
  function describe(r) {
    var j = (r.jobs || []).map(function (x) { return x.ref; }).join(', ');
    return [j, r.typeLabel ? r.typeLabel + (r.converted ? ' (made into a PDF)' : '') : '', r.note || ''].filter(Boolean).join(' · ');
  }
  function one(it) {
    if (it.f.size > MAX) { it.st = 'failed'; it.msg = 'Larger than 18 MB: save it in the Drive folder "Drop documents" instead.'; R.n.failed++; render(); return Promise.resolve(); }
    it.st = 'running'; render();
    var tries = 0;
    var type = it.forced ? it.forced.type : $('dp-type').value;
    var go = function () {
      tries++;
      return readB64(it.f).then(function (b64) {
        return call('dropUpload', { name: it.name, b64: b64, mime: it.f.type || '', type: type || '', qtn: it.forced ? it.forced.qtn : '' });
      }).then(function (r) {
        var s = r && r.state;
        it.r = r;
        if (s === 'filed') { it.st = 'filed'; R.n.filed++; } else if (s === 'already') { it.st = 'already'; R.n.already++; } else { it.st = 'waiting'; R.n.waiting++; }
        it.msg = s === 'waiting' ? ((r && r.note) || 'Waiting for you to pick, below') : describe(r);
        render();
      }).catch(function (e) {
        if (tries < 3 && !permanent(e.message)) { it.msg = 'Connection problem, trying again…'; render(); return wait(tries * 3000).then(go); }
        it.st = 'failed'; it.msg = e.message; R.n.failed++; render();
      });
    };
    return go();
  }
  var LABEL = { queued: ['Waiting', 'run'], running: ['Filing…', 'run'], filed: ['Filed', 'ok'], already: ['Already there', 'ok'], waiting: ['Pick below', 'wait'], failed: ['Failed', 'bad'] };
  var drawT = 0;
  function render() {
    if (drawT) return;
    drawT = setTimeout(function () {
      drawT = 0; if (!R) return;
      var done = R.items.filter(function (i) { return i.st !== 'queued' && i.st !== 'running'; }).length, total = R.items.length;
      $('dp-fill').style.width = Math.round(done / total * 100) + '%';
      $('dp-sum').textContent = (R.active ? 'Filing ' + Math.min(done + 1, total) + ' of ' + total + ' · ' : 'Done: ' + total + ' file' + (total === 1 ? '' : 's') + ' · ') +
        R.n.filed + ' filed · ' + R.n.already + ' already there · ' + R.n.waiting + ' waiting' + (R.n.failed ? ' · ' + R.n.failed + ' failed' : '');
      var rows = R.items.map(function (it, ix) { return { it: it, ix: ix }; }).filter(function (x) { return x.it.st !== 'queued'; });
      rows.sort(function (a, b) { var o = { failed: 0, running: 1, waiting: 2, filed: 3, already: 4 }; return o[a.it.st] - o[b.it.st]; });
      $('dp-list').innerHTML = rows.slice(0, 300).map(function (x) {
        var i = x.it, l = LABEL[i.st];
        var fix = (i.st === 'filed' && i.r && i.r.type && i.r.type !== 'po' && (i.r.files || []).some(function (f) { return f.state === 'filed'; }))
          ? '<div class="dp-fix"><select data-fix="' + x.ix + '" aria-label="Wrong type? Move it"><option value="">Wrong type? Move it to…</option>' +
            TYPES.filter(function (t) { return t[0] !== 'po' && t[0] !== i.r.type; }).map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</select></div>' : '';
        return '<div class="po-row"><div><div class="n" title="' + esc(i.name) + '">' + esc(i.name) + '</div>' + (i.msg ? '<div class="w">' + esc(i.msg) + '</div>' : '') + fix +
          '</div><span class="po-st ' + l[1] + '">' + l[0] + '</span></div>';
      }).join('');
    }, 120);
  }
  $('dp-list').addEventListener('change', function (e) {
    var s = e.target.closest('select[data-fix]'); if (!s || !s.value || !R) return;
    var it = R.items[+s.getAttribute('data-fix')]; if (!it || !it.r) return;
    var type = s.value; s.disabled = true;
    var ids = (it.r.files || []).filter(function (f) { return f.state === 'filed'; }).map(function (f) { return f.id; });
    ids.reduce(function (p, id) { return p.then(function () { return call('dropRefile', { id: id, type: type }); }); }, Promise.resolve()).then(function (last) {
      it.r.type = type; it.r.typeLabel = last && last.typeLabel; it.msg = describe(it.r) + ' · moved'; render(); note('Moved to ' + (last && last.typeLabel)); loadRf();
    }).catch(function (e2) { note(e2.message); s.disabled = false; });
  });

  // ---------- what is waiting ----------
  function loadStatus() {
    call('dropStatus').then(function (s) {
      if (s.folderUrl) { $('dp-folder').href = s.folderUrl; $('dp-folder').style.display = ''; }
      $('dp-last').textContent = s.lastSweep ? 'Drive folder last checked ' + s.lastSweep : '';
      if (s.jobs && s.jobs.length) $('dp-jobs').innerHTML = s.jobs.map(function (j) { return '<option value="' + esc(j.qtn) + '">' + esc(j.label) + '</option>'; }).join('');
      var h = '';
      if (s.error) h += '<div class="muted" style="margin-top:10px;">' + esc(s.error) + '</div>';
      if (s.waiting && s.waiting.length) {
        h += '<details open><summary>' + s.waiting.length + ' file' + (s.waiting.length === 1 ? '' : 's') + ' waiting for you to pick</summary>' +
          s.waiting.map(function (f) {
            var sel = f.type === 'quote' ? '' : f.type;
            return '<div class="dp-pick" data-id="' + esc(f.id) + '"><div class="n"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></div>' +
              '<div class="w">' + esc(f.why) + '</div>' +
              (f.jobs && f.jobs.length > 1 ? '<div class="dp-cand">' + f.jobs.map(function (q) { return '<button type="button" class="dp-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' : '') +
              '<div class="row"><input type="text" list="dp-jobs" placeholder="CRM, quote ref or RF" value="' + esc(f.jobs && f.jobs.length === 1 ? f.jobs[0] : '') + '" aria-label="Job">' +
              '<select aria-label="Type">' + typeOpts(sel, true) + '</select>' +
              '<button type="button" class="btn btn-primary btn-sm" data-go="1">File it</button></div></div>';
          }).join('') + '</details>';
      }
      if (!h && !s.error) h = '<div class="muted" style="margin-top:10px;font-size:12.5px;">Nothing waiting.</div>';
      $('dp-status').innerHTML = h;
    }).catch(function (e) { $('dp-status').innerHTML = '<div class="muted" style="margin-top:10px;">' + esc(e.message) + '</div>'; });
  }
  $('dp-status').addEventListener('click', function (e) {
    var chip = e.target.closest('.dp-chip[data-q]');
    if (chip) { var box = chip.closest('.dp-pick'); box.querySelector('input').value = chip.getAttribute('data-q'); return; }
    var b = e.target.closest('button[data-go]'); if (!b) return;
    var row = b.closest('.dp-pick'), job = row.querySelector('input').value.trim(), type = row.querySelector('select').value;
    if (!type) { note('Pick what the file is.'); return; }
    b.disabled = true; b.textContent = 'Filing…';
    call('dropResolve', { id: row.getAttribute('data-id'), job: job, type: type }).then(function (r) {
      note(r.state === 'waiting' ? r.note : 'Filed: ' + describe(r));
      loadStatus(); loadRf();
    }).catch(function (e2) { note(e2.message); b.disabled = false; b.textContent = 'File it'; });
  });

  // ---------- draft RFs ----------
  function loadRf() {
    call('dropRfReady').then(function (d) {
      var rows = (d && d.rows) || [];
      if (d && d.error) { $('dp-rf').innerHTML = '<div class="muted" style="margin-top:10px;font-size:12.5px;">' + esc(d.error) + '</div>'; return; }
      if (!rows.length) { $('dp-rf').innerHTML = '<div class="muted" style="margin-top:10px;font-size:12.5px;">No draft RFs in the Dynamics list.</div>'; return; }
      var ready = rows.filter(function (r) { return r.ready; }).length;
      $('dp-rf').innerHTML = '<details' + (ready < rows.length ? ' open' : '') + '><summary>Draft RFs: ' + ready + ' of ' + rows.length + ' have all three PDFs for your PC</summary>' +
        '<div class="muted" style="font-size:12px;margin:6px 0 4px;">Your PC attaches AGFS quote, supplier quote and email approval to each draft RF by itself once all three are here. Tap a red one to add it.</div>' +
        rows.map(function (r) {
          var head = '<div class="t">' + esc(r.rf) + (r.qtn ? ' · ' + esc(r.crm || r.qtn) : '') + '</div>' +
            '<div class="s">' + esc([r.qtn && r.crm ? r.qtn : '', r.building, r.desc].filter(Boolean).join(' · ')) + '</div>';
          if (!r.qtn) return '<div class="dp-rf">' + head + '<div class="pc">Not matched to a job yet: link it to its quote in Job Desk.</div></div>';
          var docs = DOCS3.map(function (t) {
            var n = r.have[t[0]] || 0;
            if (t[0] === 'vendor_quote' && n > 1) return '<span class="dp-doc two" title="The PC needs exactly one: move the extra to 10 Other">' + n + ' supplier quotes</span>';
            return n ? '<span class="dp-doc ok">✓ ' + esc(t[1]) + '</span>' : '<button type="button" class="dp-doc no" data-add="' + esc(t[0]) + '" data-q="' + esc(r.qtn) + '">+ ' + esc(t[1]) + '</button>';
          }).join('');
          var pc = r.pc ? 'PC: ' + [r.pc.state, r.pc.missing, r.pc.at].filter(Boolean).join(' · ') : 'Your PC has not checked this RF yet.';
          if (!r.folder) pc = 'No job folder yet: it is made at the next hourly check (or press "Copy quotes from the tracker"). ' + pc;
          return '<div class="dp-rf' + (r.ready ? ' ready' : '') + '">' + head + '<div class="docs">' + docs + '</div>' +
            (r.folderUrl ? '<div class="pc"><a href="' + esc(r.folderUrl) + '" target="_blank" rel="noopener">Open job folder</a> · ' + esc(pc) + '</div>' : '<div class="pc">' + esc(pc) + '</div>') + '</div>';
        }).join('') +
        '<div class="po-foot"><button type="button" class="btn btn-ghost btn-sm" id="dp-prep">Copy quotes from the tracker</button></div></details>';
    }).catch(function (e) { $('dp-rf').innerHTML = '<div class="muted" style="margin-top:10px;font-size:12.5px;">' + esc(e.message) + '</div>'; });
  }
  $('dp-rf').addEventListener('click', function (e) {
    var add = e.target.closest('button[data-add]');
    if (add) { pending = { qtn: add.getAttribute('data-q'), type: add.getAttribute('data-add') }; $('dp-addinput').click(); return; }
    var prep = e.target.closest('#dp-prep');
    if (prep) {
      prep.disabled = true; prep.textContent = 'Copying…';
      call('dropPrepRfs').then(function (r) {
        note('Job folders made: ' + r.folders + ', quotes copied: ' + r.copied + (r.left ? ', ' + r.left + ' left for the next check' : ''));
        loadRf();
      }).catch(function (e2) { note(e2.message); prep.disabled = false; prep.textContent = 'Copy quotes from the tracker'; });
    }
  });
  $('dp-addinput').addEventListener('change', function () { if (pending) start(this.files, pending); pending = null; this.value = ''; });

  $('dp-input').addEventListener('change', function () { start(this.files); this.value = ''; });
  var dz = $('dp-drop');
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) start(e.dataTransfer.files); });
  $('dp-sweep').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Checking…';
    call('dropSweep').then(function (r) {
      note(r.busy ? 'The folder is being checked right now. Look again in a minute.' : 'Drive folder: ' + r.filed + ' filed, ' + r.waiting + ' waiting' + (r.left ? ', ' + r.left + ' left for the next check' : ''));
      loadStatus(); loadRf();
    }).catch(function (e) { note(e.message); }).then(function () { b.disabled = false; b.textContent = 'Check the Drive folder'; });
  });
  window.addEventListener('beforeunload', function (e) { if (R && R.active) { e.preventDefault(); e.returnValue = ''; } });
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    n.addEventListener('click', function () { if (n.dataset.view === 'docs') { loadStatus(); loadRf(); } });
  });
  if (document.getElementById('view-docs') && document.getElementById('view-docs').style.display !== 'none') { loadStatus(); loadRf(); }
})();
