/* ---------------- ADDED: Job Documents (Google Drive filing) ----------------
   * "Job Documents" page: every work with what is saved in Drive and what is missing.
   * A "Documents" box is added to the bottom of each job's detail panel (drop files there).
   * "Link to job" box on the Breakdown Report page.
   Uses only public things of the page above (ST, toast, openDrawer, loadDashboard) and the server file Docs.gs. */
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
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dShort(t) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] : ''; }

  /* what kind of document is this file? (guessed from the file name; can be changed before saving) */
  function guess(name) {
    var n = String(name || '').toLowerCase();
    if (/\.(jpe?g|png|heic|webp|gif)$/.test(n)) return 'photos';
    if (/grn/.test(n)) return 'grn';
    if (/prepay|advance|proforma|pro-forma/.test(n)) return 'prepayment';
    if (/invoice|\binv[\s_-]?\d/.test(n)) return 'grn';
    if (/vendor|supplier|subcon|vq[\s_-]|quotation from/.test(n)) return 'vendor_quote';
    if (/breakdown/.test(n)) return 'breakdown';
    if (/(wcr|completion).*(photo|picture|pics)|(photo|picture|pics).*(wcr|completion)/.test(n)) return 'wcr_photos';
    if (/wcr|completion/.test(n)) return 'wcr';
    if (/\.(msg|eml)$/.test(n) || /e-?mail|approval email|approved/.test(n)) return 'email_approval';
    if (/wasl/.test(n) && /approv/.test(n)) return 'wasl_approval';
    if (/agfs|\bqtn\b|dd20\d\d/.test(n)) return 'agfs_quote';
    if (/\blpo\b|wasl.*\bpo\b|\bpo\b.*wasl/.test(n)) return 'wasl_po';
    if (/\bpo\b|purchase order|p\.o\./.test(n)) return 'agfs_po';
    if (/\brf\b|r-0000|\bpr\b|purchase/.test(n)) return 'rf_doc';
    if (/quot/.test(n)) return 'vendor_quote';
    return 'other';
  }

  function readB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = function () { rej(new Error('Could not read ' + file.name)); };
      r.onload = function () { var s = String(r.result || ''); res(s.substring(s.indexOf(',') + 1)); };
      r.readAsDataURL(file);
    });
  }
  function mimeOf(file) {
    if (file.type) return file.type;
    if (/\.msg$/i.test(file.name)) return 'application/vnd.ms-outlook';
    if (/\.eml$/i.test(file.name)) return 'message/rfc822';
    return 'application/octet-stream';
  }
  var MAXMB = 18;

  /* ================= the Documents box inside a job's detail panel ================= */
  var S = null;                      // { qtn, data, staged:[], busy }

  function typesOf(scope) { return ((S.data && S.data.types) || []).filter(function (t) { return t.scope === scope; }); }
  function typeByKey(k) { return ((S.data && S.data.types) || []).filter(function (t) { return t.k === k; })[0]; }

  function drawBox() {
    var box = $('vwd-sec'); if (!box || !S) return;
    var d = S.data, h = '<div class="d-title">📁 Documents</div><div class="vwd">';
    if (!d) { box.innerHTML = h + '<div class="dc-msg">Loading...</div></div>'; return; }
    if (d.error) { box.innerHTML = h + '<div class="dc-msg" style="color:var(--danger)">' + esc(d.error) + '</div></div>'; return; }
    if (!d.status.rootSet || !d.status.ok) {
      box.innerHTML = h + '<div class="dc-msg">' + (d.status.rootSet ? esc(d.status.error) + ' ' : '') + 'The main Drive folder is not set up yet.</div>' +
        '<div class="dc-act"><button type="button" class="btn btn-primary btn-sm" id="vwd-setup">Set it up</button></div></div>';
      return;
    }
    var have = {};
    d.files.forEach(function (f) { have[f.k] = (have[f.k] || 0) + 1; });
    h += '<div>' + typesOf('job').map(function (t) {
      var n = have[t.k] || 0, bad = !n && d.missing.indexOf(t.k) > -1;
      return '<span class="dc-pill ' + (n ? '' : (bad ? 'bad' : 'none')) + '">' + (n ? '✓ ' : (bad ? '✗ ' : '')) + esc(t.label) + (n > 1 ? ' ×' + n : '') + '</span>';
    }).join('') + '</div>';
    h += '<div class="dc-files">' + (d.files.length ? d.files.map(function (f) {
      return '<div class="dc-file"><span class="t" title="' + esc(f.type) + '">' + esc(f.type) + (f.rf ? ' · ' + esc(f.rf) : '') + '</span><a href="' + esc(f.url) + '" target="_blank" rel="noopener" title="' + esc(f.name) + '">' + esc(f.name) + '</a><span class="d">' + esc(dShort(f.time)) + '</span></div>';
    }).join('') : '<div class="dc-msg">Nothing saved for this job yet.</div>') + '</div>';
    var upN = UQ.items.filter(function (x) { return x.qtn === S.qtn && (x.state === 'wait' || x.state === 'up'); }).length;   // v31
    if (upN) h += '<div class="dc-msg vwd-up">⬆ Uploading ' + upN + ' file' + (upN > 1 ? 's' : '') + ' in the background. You can close this and keep working.</div>';
    h += '<div class="vwd-quick"><span>Add</span>' + [['agfs_quote', 'AGFS quote'], ['vendor_quote', 'Vendor quote'], ['email_approval', 'Email approval'], ['breakdown', 'Breakdown report']].filter(function (q) { return typeByKey(q[0]); }).map(function (q) {
      return '<button type="button" class="btn btn-ghost btn-sm" data-quick="' + q[0] + '">＋ ' + esc((typeByKey(q[0]) || {}).label || q[1]) + '</button>'; }).join('') + '</div>';
    h += rfLine();
    h += '<div class="dc-drop" id="vwd-drop" tabindex="0" role="button"><b>Drop files here</b> or tap to choose<br><span style="font-size:11.5px">vendor quotes · AGFS quotes · approval emails (.msg / PDF) · reports · RF, PR, PO, prepayment, GRN</span></div>' +
         '<input type="file" id="vwd-file" multiple hidden>';
    if (S.staged.length) {
      h += '<div class="dc-stage">' + S.staged.map(function (s, i) {
        var t = typeByKey(s.type) || {}, isRf = t.scope === 'rf';
        return '<div class="dc-st" data-i="' + i + '"><div class="n">' + esc(s.file.name) + '<small>' + Math.max(1, Math.round(s.file.size / 1024)).toLocaleString('en-US') + ' KB</small></div>' +
          '<div class="r"><select data-f="type">' + (d.types || []).map(function (x) { return '<option value="' + esc(x.k) + '"' + (x.k === s.type ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>' +
          '<input data-f="detail" placeholder="' + (s.type === 'vendor_quote' ? 'Vendor name' : 'Note (optional)') + '" value="' + esc(s.detail) + '">' +
          (isRf ? '<input class="full" data-f="rf" list="vwd-rfs" placeholder="RF number, e.g. R-000093669" value="' + esc(s.rf) + '">' : '') + '</div>' +
          '<div class="s ' + (s.state === 'ok' ? 'ok' : (s.state === 'bad' ? 'bad' : '')) + '">' + esc(s.msg || '') + '</div></div>';
      }).join('') + '<datalist id="vwd-rfs">' + (d.rfs || []).map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>' +
        '<div class="dc-act"><button type="button" class="btn btn-primary btn-sm" id="vwd-save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving...' : 'Save ' + S.staged.length + ' file' + (S.staged.length > 1 ? 's' : '') + ' to Drive') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="vwd-clear"' + (S.busy ? ' disabled' : '') + '>Cancel</button></div>';
    }
    h += '<div class="dc-act">' + (d.folderUrl
        ? '<a class="btn btn-ghost btn-sm" href="' + esc(d.folderUrl) + '" target="_blank" rel="noopener">📂 Open job folder</a>'
        : '<button type="button" class="btn btn-ghost btn-sm" id="vwd-open">📂 Create job folder</button>') + '</div>';
    box.innerHTML = h + '</div>';
  }

  /* v27: "📎 Attach to RF R-... in Dynamics": queues the RF for the PC's RF documents job (same queue as Procurement) */
  function rfNorm(v) { var m = /R?\s*-?\s*0*(\d{5,})/i.exec(String(v || '')); return m ? 'R-' + ('000000000' + m[1]).slice(-9) : ''; }
  function rfsOf(w) {
    var seen = {}, out = [];
    String((w && w.rf) || '').split(/[,;\/&\n]+|\s+and\s+/i).forEach(function (x) { var k = rfNorm(x); if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }
  function rfLine() {
    if (!S || !S.rfs || !S.rfs.length) return '';
    return S.rfs.map(function (rf) {
      var i = (S.rq || {})[rf], txt = '', cls = '', busy = false;
      if (i) {
        busy = i.status === 'queued' || i.status === 'running';
        txt = i.status === 'queued' ? 'Waiting for your PC…' : i.status === 'running' ? (i.step || 'Working') + (i.pct ? ' (' + i.pct + '%)' : '') + '…' :
              i.status === 'done' ? '✓ ' + (i.result || 'Ready to submit') : i.status === 'cancelled' ? '' : '⚠ ' + (i.result || i.message || 'Could not finish');
        cls = i.status === 'done' ? 'ok' : (i.status === 'error' || i.status === 'skipped') ? 'bad' : '';
      }
      if (!txt) txt = 'Your PC attaches AGFS Quote, Vendor Quote and Email Approval and fills your details. It never submits.';
      return '<div class="vwd-rf"><button type="button" class="btn btn-primary btn-sm" data-rfq="' + esc(rf) + '"' + (busy ? ' disabled' : '') + '>📎 ' + (busy ? 'Attaching to ' : 'Attach to ') + esc(rf) + '</button>' +
        '<span class="vwd-rfs ' + cls + '">' + esc(txt) + '</span></div>';
    }).join('');
  }
  function rqLoad(delay) {
    if (!S || !S.rfs || !S.rfs.length) return;
    var q = S.qtn;
    clearTimeout(S.rqT);
    S.rqT = setTimeout(function () {
      if (!S || S.qtn !== q || !$('vwd-sec')) return;
      call('rfqList').then(function (d) {
        if (!S || S.qtn !== q) return;
        var m = {}; ((d && d.items) || []).forEach(function (i) { m[String(i.rf).toUpperCase()] = i; });
        S.rq = m; drawBox();
        var active = S.rfs.some(function (rf) { var i = m[rf]; return i && (i.status === 'queued' || i.status === 'running'); });
        if (active) rqLoad(5000);
      }).catch(function () {});
    }, delay || 0);
  }
  function rqSend(rf) {
    var w = S.work || {};
    S.rq = S.rq || {}; S.rq[rf] = { rf: rf, status: 'queued' }; drawBox();
    call('rfqAdd', [{ rf: rf, title: [w.crm, w.desc].filter(Boolean).join(' - ') }])
      .then(function (r) { note(r && r.added ? rf + ' added to the queue' : rf + ' is already in the queue'); rqLoad(800); })
      .catch(function (e) { delete S.rq[rf]; drawBox(); note(e.message); });
  }

  function loadBox() {
    var q = S.qtn;
    call('docsList', q).then(function (d) { if (S && S.qtn === q) { S.data = d; drawBox(); } })
      .catch(function (e) { if (S && S.qtn === q) { S.data = { error: e.message }; drawBox(); } });
  }

  function stage(files) {
    if (!S || !S.data || !S.data.status || !S.data.status.ok) return;
    Array.prototype.forEach.call(files, function (f) {
      if (f.size > MAXMB * 1048576) { note(f.name + ' is larger than ' + MAXMB + ' MB. Add it from Drive instead.'); return; }
      var inName = /\bR-?\d{6,}\b/i.exec(f.name);
      S.staged.push({ file: f, type: S.next || guess(f.name), detail: '', rf: inName ? inName[0].toUpperCase().replace(/^R(?!-)/, 'R-') : ((S.data.rfs && S.data.rfs.length === 1) ? S.data.rfs[0] : ''), state: '', msg: '' });
    });
    S.next = null;
    drawBox();
  }

  /* v31: files are uploaded in the background (one by one) from a small tray, so you can close the job and keep working */
  var UQ = { items: [], running: false, open: false, hideT: null };
  function saveAll() {
    if (!S) return;
    var list = S.staged.filter(function (s) { return s.state !== 'ok'; });
    for (var i = 0; i < list.length; i++) {
      var t = typeByKey(list[i].type) || {};
      if (t.scope === 'rf' && !String(list[i].rf).trim()) { list[i].state = 'bad'; list[i].msg = 'Enter the RF number for this document.'; drawBox(); return; }
    }
    if (!list.length) return;
    var q = S.qtn;
    list.forEach(function (s) {
      UQ.items.push({ qtn: q, file: s.file, type: s.type, label: (typeByKey(s.type) || {}).label || s.type, rf: s.rf, detail: s.detail, state: 'wait', msg: '' });
    });
    S.staged = [];
    UQ.open = true;                                              // v38: show each file's line while they go up
    drawBox();
    note(list.length + ' file' + (list.length > 1 ? 's' : '') + ' added to the upload tray. You can keep working.');
    uqDraw(); uqPump();
  }
  function uqPump() {
    if (UQ.running) return;
    var it = UQ.items.filter(function (x) { return x.state === 'wait'; })[0];
    if (!it) { uqFinish(); return; }
    UQ.running = true; it.state = 'up'; uqDraw();
    readB64(it.file).then(function (b64) {
      return call('docsUpload', { qtn: it.qtn, type: it.type, rf: it.rf, detail: it.detail, name: it.file.name, mime: mimeOf(it.file), b64: b64 });
    }).then(function (r) {
      it.state = r && r.already ? 'dup' : 'ok';
      it.msg = r && r.already ? 'Already in this job as ' + r.name : 'Saved as ' + (r && r.name || it.file.name);
      it.file = null;                                            // free the memory
    }).catch(function (e) { it.state = 'bad'; it.msg = e.message; })
      .then(function () {
        UQ.running = false;
        window.__vwDocsStale = true;
        var more = UQ.items.some(function (x) { return x.qtn === it.qtn && (x.state === 'wait' || x.state === 'up'); });
        if (!more) uqJobDone(it.qtn);
        uqDraw(); if (S && S.qtn === it.qtn && $('vwd-sec')) drawBox(); uqPump();
      });
  }
  // every file of one job is in: refresh its box if it is open, and remake the Tijori PDF when a key document changed
  function uqJobDone(q) {
    var mine = UQ.items.filter(function (x) { return x.qtn === q && !x.jobDone; });
    mine.forEach(function (x) { x.jobDone = true; });
    if (mine.some(function (x) { return x.state === 'ok' && /^(agfs_quote|breakdown|email_approval|wasl_approval)$/.test(x.type); }) && window.__vwPdfcAuto) window.__vwPdfcAuto(q);
    if (S && S.qtn === q) call('docsList', q).then(function (d) { if (S && S.qtn === q) { S.data = d; drawBox(); } }).catch(function () {});
  }
  function uqFinish() {
    var done = UQ.items.filter(function (x) { return x.state === 'ok' || x.state === 'dup'; }).length, bad = UQ.items.filter(function (x) { return x.state === 'bad'; }).length;
    if (!UQ.items.length) return;
    if (!bad) { clearTimeout(UQ.hideT); UQ.hideT = setTimeout(function () { if (!UQ.running && !UQ.items.some(function (x) { return x.state !== 'ok' && x.state !== 'dup'; })) { UQ.items = []; uqDraw(); } }, 6000); }
    note(bad ? bad + ' file' + (bad > 1 ? 's' : '') + ' could not be saved: see the upload tray' : done + ' file' + (done > 1 ? 's' : '') + ' saved to Drive');
  }
  function uqDraw() {
    var tray = $('uq-tray');
    if (!tray) {
      tray = document.createElement('div'); tray.id = 'uq-tray'; tray.className = 'uq-tray'; tray.setAttribute('role', 'status'); tray.setAttribute('aria-live', 'polite');
      document.body.appendChild(tray);
      tray.addEventListener('click', function (e) {
        var b = e.target.closest('[data-uq]'); if (!b) return;
        var a = b.getAttribute('data-uq');
        if (a === 'toggle') { UQ.open = !UQ.open; uqDraw(); }
        else if (a === 'retry') { UQ.items.forEach(function (x) { if (x.state === 'bad' && x.file) { x.state = 'wait'; x.msg = ''; x.jobDone = false; } }); uqDraw(); uqPump(); }
        else if (a === 'clear') { UQ.items = UQ.items.filter(function (x) { return x.state === 'wait' || x.state === 'up'; }); uqDraw(); }
        else if (a === 'open') { var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return x.qtn === b.getAttribute('data-q'); })[0] : null; if (w && typeof openDrawer === 'function') openDrawer(w.id); }
      });
    }
    var n = UQ.items.length;
    if (!n) { tray.hidden = true; return; }
    var done = UQ.items.filter(function (x) { return x.state === 'ok' || x.state === 'dup'; }).length, bad = UQ.items.filter(function (x) { return x.state === 'bad'; }).length;
    var cur = UQ.items.filter(function (x) { return x.state === 'up'; })[0], busy = UQ.running || UQ.items.some(function (x) { return x.state === 'wait'; });
    var head = busy ? 'Uploading ' + Math.min(done + bad + 1, n) + ' of ' + n + (cur ? ' · ' + cur.qtn : '') : (bad ? bad + ' failed · ' + done + ' saved' : '✓ ' + done + ' saved to Drive');
    var pct = Math.round(100 * (done + bad) / n);
    tray.hidden = false;
    tray.className = 'uq-tray' + (bad && !busy ? ' bad' : '') + (!busy && !bad ? ' ok' : '');
    tray.innerHTML = '<button type="button" class="uq-head" data-uq="toggle" aria-expanded="' + UQ.open + '"><span class="uq-spin' + (busy ? ' on' : '') + '" aria-hidden="true"></span><span class="uq-t">' + esc(head) + '</span><span class="uq-chev" aria-hidden="true">' + (UQ.open ? '▾' : '▴') + '</span></button>' +
      '<div class="uq-bar"><i style="width:' + pct + '%"></i></div>' +
      (UQ.open ? '<div class="uq-list">' + UQ.items.map(function (x) {
        var st = x.state === 'wait' ? 'Waiting' : x.state === 'up' ? 'Uploading…' : x.state === 'bad' ? '⚠ ' + x.msg : (x.state === 'dup' ? '= ' : '✓ ') + x.msg;
        return '<div class="uq-it ' + x.state + '"><button type="button" class="uq-q" data-uq="open" data-q="' + esc(x.qtn) + '">' + esc(x.qtn) + '</button><span class="uq-l">' + esc(x.label) + '</span><span class="uq-s">' + esc(st) + '</span><span class="uq-fb" aria-hidden="true"><i></i></span></div>';
      }).join('') + (busy ? '' : '<div class="uq-act">' + (bad ? '<button type="button" class="btn btn-primary btn-sm" data-uq="retry">Retry failed</button>' : '') + '<button type="button" class="btn btn-ghost btn-sm" data-uq="clear">Clear</button></div>') + '</div>' : '');
  }
  window.addEventListener('beforeunload', function (e) {
    if (UQ.running || UQ.items.some(function (x) { return x.state === 'wait'; })) { e.preventDefault(); e.returnValue = 'Files are still uploading.'; return e.returnValue; }
  });

  function mount() {
    var body = $('drawer-body'); if (!body || $('vwd-sec')) return;
    var qtn = ($('dh-ref').textContent || '').trim();
    var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return x.qtn === qtn; })[0] : null;
    if (!w) { S = null; return; }
    var sec = document.createElement('div');
    sec.className = 'd-sec'; sec.id = 'vwd-sec';
    var last = body.lastElementChild;                                          // keep the "Row n in VW_Tracker" footer last
    if (last && !last.classList.contains('d-sec') && !last.classList.contains('todo')) body.insertBefore(sec, last); else body.appendChild(sec);
    S = { qtn: qtn, data: null, staged: [], busy: false, work: w, rfs: rfsOf(w), rq: null };
    drawBox(); loadBox(); rqLoad(0);
  }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () { if (!$('vwd-sec')) mount(); }).observe($('drawer-body'), { childList: true });

  document.addEventListener('click', function (e) {
    if (!S || !$('vwd-sec') || !$('vwd-sec').contains(e.target)) return;
    var t = e.target;
    if (t.closest('#vwd-setup')) { $('drawer-close').click(); var n = document.querySelector('.nav-item[data-view="docs"]'); if (n) { n.click(); setTimeout(function () { $('dc-settings').style.display = ''; }, 60); } return; }
    var rq = t.closest('[data-rfq]');
    if (rq) { if (!rq.disabled) rqSend(rq.getAttribute('data-rfq')); return; }
    var qk = t.closest('[data-quick]');
    if (qk) { S.next = qk.getAttribute('data-quick'); $('vwd-file').click(); return; }
    if (t.closest('#vwd-drop')) { S.next = null; $('vwd-file').click(); return; }
    if (t.closest('#vwd-clear')) { S.staged = []; drawBox(); return; }
    if (t.closest('#vwd-save')) { saveAll(); return; }
    var op = t.closest('#vwd-open');
    if (op) {
      op.disabled = true; op.textContent = 'Creating folders...';
      var q = S.qtn;
      call('docsOpenJob', q).then(function (r) { window.open(r.url, '_blank'); if (S && S.qtn === q) { loadBox(); } })
        .catch(function (er) { note(er.message); op.disabled = false; op.textContent = '📂 Create job folder'; });
    }
  });
  document.addEventListener('change', function (e) {
    if (!S || !$('vwd-sec') || !$('vwd-sec').contains(e.target)) return;
    if (e.target.id === 'vwd-file') { stage(e.target.files); e.target.value = ''; return; }
    var row = e.target.closest('.dc-st'); if (!row || !e.target.dataset.f) return;
    var s = S.staged[Number(row.dataset.i)]; if (!s) return;
    s[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.f === 'type') drawBox();
  });
  document.addEventListener('input', function (e) {
    if (!S || !$('vwd-sec') || !$('vwd-sec').contains(e.target)) return;
    var row = e.target.closest('.dc-st'); if (!row || !e.target.dataset.f || e.target.tagName !== 'INPUT') return;
    var s = S.staged[Number(row.dataset.i)]; if (s) s[e.target.dataset.f] = e.target.value;
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { var z = e.target.closest && e.target.closest('#vwd-drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  });
  document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('#vwd-drop'); if (z) z.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    var z = e.target.closest && e.target.closest('#vwd-drop');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) stage(e.dataTransfer.files);
  });

  /* ================= Job Documents page ================= */
  var P = { data: null, at: 0, shown: 100, busy: false };

  function showPage(on) { $('view-docs').style.display = on ? '' : 'none'; }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'docs'; showPage(on); if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });

  function opened() {
    if (!P.data || window.__vwDocsStale || Date.now() - P.at > 60000) load(false);
    else render();
  }
  function load(force) {
    $('dc-loading').style.display = ''; $('dc-error').style.display = 'none';
    if (!P.data) $('dc-body').style.display = 'none';
    call('docsOverview').then(function (d) {
      P.data = d; P.at = Date.now(); window.__vwDocsStale = false; $('dc-loading').style.display = 'none';
      if (force) note('Documents refreshed');
      render(); document.dispatchEvent(new Event('vw-docs-loaded'));
    }).catch(function (e) {
      $('dc-loading').style.display = 'none';
      $('dc-error').textContent = 'Could not read the documents list: ' + e.message; $('dc-error').style.display = '';
    });
  }

  function render() {
    var d = P.data; if (!d) return;
    var st = d.status;
    $('dc-prep').disabled = !st.ok;
    $('dc-rootinfo').innerHTML = st.rootSet ? (st.ok ? 'Current main folder: <a href="' + esc(st.rootUrl) + '" target="_blank" rel="noopener">' + esc(st.rootName) + '</a>' : '<span style="color:var(--danger)">' + esc(st.error) + '</span>') : '';
    if (!st.rootSet || !st.ok) {
      $('dc-settings').style.display = '';
      $('dc-body').style.display = 'none';
      return;
    }
    $('dc-body').style.display = '';
    var appr = $('dc-appr').checked, onlyMiss = $('dc-miss').checked, q = $('dc-q').value.trim().toLowerCase();
    var jobTypes = d.types.filter(function (t) { return t.scope === 'job'; });
    var rows = d.rows, withFolder = 0, missingJobs = 0, files = 0;
    rows.forEach(function (r) { if (r.hasFolder) withFolder++; files += r.total; if (r.approved && r.missing.length) missingJobs++; });
    $('dc-kpis').innerHTML =
      '<div class="dc-kpi"><b>' + rows.filter(function (r) { return r.approved; }).length + '</b><span>Works approved by WASL</span></div>' +
      '<div class="dc-kpi"><b>' + withFolder + '</b><span>Works with a Drive folder</span></div>' +
      '<div class="dc-kpi"><b>' + files + '</b><span>Files saved</span></div>' +
      '<div class="dc-kpi ' + (missingJobs ? 'bad' : '') + '"><b>' + missingJobs + '</b><span>Approved works missing a document</span></div>';
    var list = rows.filter(function (r) {
      if (appr && !r.approved) return false;
      if (onlyMiss && !r.missing.length) return false;
      if (q && (r.qtn + ' ' + r.crm + ' ' + r.desc + ' ' + r.building + ' ' + r.rf).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.sort(function (a, b) { return (b.missing.length - a.missing.length) || String(b.qtnDate).localeCompare(String(a.qtnDate)); });
    $('dc-count').textContent = list.length + ' work' + (list.length === 1 ? '' : 's');
    $('dc-tbody').innerHTML = list.slice(0, P.shown).map(function (r) {
      var pills = jobTypes.map(function (t) {
        var n = r.counts[t.k] || 0, bad = r.approved && t.need && !n;
        if (!n && !bad) return '';
        return '<span class="dc-pill ' + (n ? '' : 'bad') + '">' + (n ? '✓ ' : '✗ ') + esc(t.label) + (n > 1 ? ' ×' + n : '') + '</span>';
      }).join('') || '<span class="dc-pill none">nothing yet</span>';
      var rfn = (r.counts.rf_doc || 0) + (r.counts.prepayment || 0) + (r.counts.grn || 0);
      if (rfn) pills += '<span class="dc-pill">✓ RF documents ×' + rfn + '</span>';
      return '<tr class="dc-row" data-id="' + r.id + '"><td class="dc-job"><b>' + esc(r.qtn) + '</b>' + (r.crm ? ' <span class="muted">CRM ' + esc(r.crm) + '</span>' : '') +
        '<small>' + esc(r.desc) + (r.building ? ' · ' + esc(r.building) : '') + '</small></td><td>' + pills + '</td><td class="muted" style="white-space:nowrap">' + esc(r.status) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted" style="text-align:center;padding:24px;">No works match.</td></tr>';
    $('dc-more').style.display = list.length > P.shown ? '' : 'none';
  }

  function openWork(id) {
    id = Number(id);
    if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
    note('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
  }

  $('dc-tbody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) openWork(tr.dataset.id); });
  $('dc-refresh').addEventListener('click', function () { load(true); });
  // v20: duplicate files
  var DUP = null;
  function drawDup() {
    var box = $('dc-duplist'); if (!box) return;
    if (!DUP) { box.innerHTML = ''; return; }
    if (!DUP.groups.length) { box.innerHTML = '<div class="dc-ok" style="margin-top:8px;">No duplicates in ' + DUP.jobs + ' job folders (' + DUP.files + ' files checked).</div>'; return; }
    var n = 0;
    var h = '<div class="dc-help" style="margin-top:8px;">' + DUP.groups.length + ' file' + (DUP.groups.length === 1 ? ' is' : 's are') + ' saved more than once' + (DUP.more ? ' (first 300 shown)' : '') + '. Untick any copy you want to keep.</div><div class="dc-dups">';
    DUP.groups.forEach(function (g) {
      h += '<div class="dc-dupg"><div class="q">' + esc(g.qtn) + '</div><div class="k">Keeps: ' + esc(g.keep.name) + ' <span class="muted">(' + esc(g.keep.folder) + ')</span></div>' +
        g.extra.map(function (x) { n++; return '<label class="x"><input type="checkbox" data-dup="' + esc(x.id) + '" checked> ' + esc(x.name) + ' <span class="muted">(' + esc(x.folder) + ', ' + x.kb + ' KB)</span></label>'; }).join('') + '</div>';
    });
    h += '</div><button type="button" id="dc-dupmove" class="btn btn-primary btn-sm" style="margin-top:10px;">Move ' + n + ' extra cop' + (n === 1 ? 'y' : 'ies') + ' to Duplicates</button>';
    box.innerHTML = h;
  }
  $('dc-dupfind').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Looking through the job folders…';
    google.script.run.withSuccessHandler(function (r) { DUP = r; b.disabled = false; b.textContent = 'Find duplicate files'; drawDup(); })
      .withFailureHandler(function (e) { b.disabled = false; b.textContent = 'Find duplicate files'; toast(e.message); }).docsDuplicates();
  });
  $('dc-duplist').addEventListener('change', function (e) {
    if (!e.target.matches('[data-dup]')) return;
    var n = document.querySelectorAll('#dc-duplist [data-dup]:checked').length, b = $('dc-dupmove');
    if (b) { b.textContent = 'Move ' + n + ' extra cop' + (n === 1 ? 'y' : 'ies') + ' to Duplicates'; b.disabled = !n; }
  });
  $('dc-duplist').addEventListener('click', function (e) {
    var b = e.target.closest('#dc-dupmove'); if (!b) return;
    var ids = Array.prototype.map.call(document.querySelectorAll('#dc-duplist [data-dup]:checked'), function (x) { return x.getAttribute('data-dup'); });
    if (!ids.length) return;
    b.disabled = true; b.textContent = 'Moving…';
    google.script.run.withSuccessHandler(function (r) {
      toast(r.moved + ' moved to Duplicates' + (r.skipped.length ? ', ' + r.skipped.length + ' left where they were' : ''));
      DUP = null; drawDup(); window.__vwDocsStale = true;
      $('dc-duplist').innerHTML = '<div class="dc-ok" style="margin-top:8px;">' + r.moved + ' moved. <a href="' + esc(r.folderUrl) + '" target="_blank" rel="noopener">Open the Duplicates folder</a>' + (r.skipped.length ? '<br>Left in place: ' + esc(r.skipped.slice(0, 5).join('; ')) : '') + '</div>';
    }).withFailureHandler(function (e) { b.disabled = false; toast(e.message); }).docsMoveDuplicates(ids);
  });
  $('dc-gear').addEventListener('click', function () { var s = $('dc-settings'); s.style.display = s.style.display === 'none' ? '' : 'none'; });
  $('dc-q').addEventListener('input', function () { P.shown = 100; render(); });
  $('dc-appr').addEventListener('change', function () { P.shown = 100; render(); });
  $('dc-miss').addEventListener('change', function () { P.shown = 100; render(); });
  $('dc-morebtn').addEventListener('click', function () { P.shown += 100; render(); });

  $('dc-save').addEventListener('click', function () {
    var b = $('dc-save'), v = $('dc-root').value;
    if (!v.trim()) { note('Paste the folder link first'); return; }
    b.disabled = true; b.textContent = 'Checking...';
    call('docsSetRoot', v).then(function () { b.disabled = false; b.textContent = 'Save'; $('dc-root').value = ''; note('Main folder saved'); $('dc-settings').style.display = 'none'; load(false); })
      .catch(function (e) { b.disabled = false; b.textContent = 'Save'; $('dc-error').textContent = e.message; $('dc-error').style.display = ''; });
  });

  $('dc-prep').addEventListener('click', function () {
    if (P.busy) return;
    P.busy = true; var b = $('dc-prep'), made = 0;
    b.disabled = true;
    (function step() {
      b.textContent = '📁 Creating... ' + made + ' done';
      call('docsPrepareFolders', true).then(function (r) {
        made += r.made;
        if (r.left > 0 && r.made > 0) return step();
        P.busy = false; b.disabled = false; b.textContent = '📁 Create folders for approved works';
        note(made ? made + ' folder' + (made === 1 ? '' : 's') + ' created' : 'All approved works already have a folder'); load(false);
      }).catch(function (e) { P.busy = false; b.disabled = false; b.textContent = '📁 Create folders for approved works'; $('dc-error').textContent = e.message; $('dc-error').style.display = ''; });
    })();
  });


  /* ---- monthly report deck ---- */
  function deck(pdf) {
    var b = $(pdf ? 'dc-deckpdf' : 'dc-deck'), old = b.textContent;
    b.disabled = true; b.textContent = pdf ? 'Making the PDF...' : 'Filing...';
    call('docsMonthlyDeck', !!pdf).then(function (r) {
      b.disabled = false; b.textContent = old;
      $('dc-deckinfo').innerHTML = esc(r.deckName) + ' is filed in <a href="' + esc(r.folderUrl) + '" target="_blank" rel="noopener">Monthly Reports</a>.' +
        (r.pdfUrl ? ' PDF copy: <a href="' + esc(r.pdfUrl) + '" target="_blank" rel="noopener">' + esc(r.pdfName) + '</a>' : '');
      $('dc-deckinfo').style.color = '';
      note(pdf ? 'PDF copy saved' : 'Deck filed');
    }).catch(function (e) { b.disabled = false; b.textContent = old; $('dc-deckinfo').textContent = e.message; $('dc-deckinfo').style.color = 'var(--danger)'; });
  }
  $('dc-deck').addEventListener('click', function () { deck(false); });
  $('dc-deckpdf').addEventListener('click', function () { deck(true); });

  /* ================= "Link to job" on the Breakdown Report page ================= */
  var LINKS = null;
  window.__vwDocsLink = function () {
    var f = $('rep-link'); if (!f || !LINKS) return '';
    var v = f.value.trim(); if (!v) return '';
    return LINKS[v.toLowerCase()] || '';
  };
  var linkTried = false;
  function loadLinks() {
    if (linkTried) return; linkTried = true;
    call('docsGetStatus').then(function (st) {
      if (!st.ok) return null;
      return call('docsJobChoices');
    }).then(function (list) {
      if (!list || !list.length) return;
      LINKS = {};
      $('rep-link-list').innerHTML = list.map(function (c) { LINKS[c.qtn.toLowerCase()] = c.qtn; return '<option value="' + esc(c.qtn) + '">' + esc(c.label) + '</option>'; }).join('');
      $('rep-link-wrap').style.display = '';
    }).catch(function () { linkTried = false; });
  }
  document.querySelectorAll('.nav-item[data-view="breakdown"]').forEach(function (n) { n.addEventListener('click', loadLinks); });
})();
