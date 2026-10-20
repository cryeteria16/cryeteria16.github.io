/* ---------------- v35: Job Desk. Every job in one place: tracker work (status, cost, date, waiting, to do), MRI request, RF in Dynamics, PR/PO,
   and what is in the job's Drive folder. Today lives here too (first tab). Click a tile to open the same job panel as on the Dashboard.
   Documents first: attach the AGFS quote, supplier quote and email approval to every WASL-approved job, then raise in MRI and the PC attaches them in the RF.
   Uses existing server functions plus deskDriveScan (Desk.gs, read only) and docsUpload (Docs.gs, Drive only). Writes nothing to VW_Tracker. ---------------- */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('view-desk')) return;
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(fn) {
    var a = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      var t = window.__hubSlow ? window.__hubSlow(fn) : 0;
      var r = google.script.run.withSuccessHandler(function (v) { clearTimeout(t); res(v); }).withFailureHandler(function (e) { clearTimeout(t); if (window.__hubFail) window.__hubFail(fn, e); rej(new Error((e && e.message) || String(e))); });
      r[fn].apply(r, a);
    });
  }
  function note(m) { if (typeof toast === 'function') toast(m); }
  var S = { d: null, m: null, q: null, w: null, tab: 'jobs', chip: 'need', text: '', f: { month: '', building: '', major: '', assignee: '' }, sort: 'prio', rows: [], loading: false, timer: null,
            drive: {}, driveTypes: null, driveErr: '', scanning: false, shown: 60, up: null, busyUp: {} };
  var STEPS = [['docs', 'Documents in Drive', 'WASL-approved, no RF yet, a document is missing'], ['ready', 'Ready to raise', 'All three documents are in Drive'], ['md', 'MRI and Dynamics', 'Raised in MRI or RF in draft'], ['proc', 'Procurement', 'PR and PO in progress']];
  var CHIPS = [['need', 'Needs me'], ['draft', 'Draft RFs'], ['ret', 'Returned / rejected'], ['appr', 'Awaiting approval'], ['tij', 'Tijori uploads'], ['wcr', 'WCRs outstanding'], ['fix', 'Data fixes'], ['done', 'Done'], ['all', 'All jobs']];
  // v37: "Keep the tracker up to date" (was on the Procurement page): VW_Tracker compared with Dynamics
  var TCHIPS = [['tfix', 'Update tracker'], ['tmiss', 'Missing from tracker'], ['twait', 'Not in Dynamics yet'], ['thealth', 'Tracker health']];
  var KEY_DOCS = ['agfs_quote', 'vendor_quote', 'email_approval'];      // what the RF needs
  var SHORT = { agfs_quote: 'AGFS quote', vendor_quote: 'Supplier quote', email_approval: 'Email approval' };

  /* ---- pages: Job Desk shows for "desk" and for "today" (Today is its first tab) ---- */
  var todayEl = $('view-today'), tp = $('jd-today-panel');
  if (todayEl && tp) tp.appendChild(todayEl);
  function showTab(t) {
    S.tab = t; window.__vwDeskTab = t;
    $('jd-refresh').style.display = t === 'today' ? 'none' : '';
    $('jd-today-panel').hidden = t !== 'today'; $('jd-jobs-panel').hidden = t !== 'jobs';
    document.querySelectorAll('#jd-tabs .jd-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    var tv = document.querySelector('.nav-item[data-view="today"]'), dv = document.querySelector('.nav-item[data-view="desk"]');
    if (tv) tv.classList.remove('active'); if (dv) dv.classList.add('active');
    document.dispatchEvent(new Event('vw-desk-tab'));
  }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() {
      var v = n.dataset.view, mine = v === 'desk' || v === 'today';
      $('view-desk').style.display = mine ? '' : 'none';
      if (!mine) return;
      showTab(v === 'today' ? 'today' : 'jobs');
      if (v === 'desk') { if (!S.d && !S.loading) load(false); else poll(0); }
    }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  $('jd-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    var n = document.querySelector('.nav-item[data-view="' + (b.dataset.tab === 'today' ? 'today' : 'desk') + '"]'); if (n) n.click();
  });
  function onJobs() { return $('view-desk').style.display !== 'none' && S.tab === 'jobs' && !document.hidden; }

  function rfNorm(v) { var m = /^R-?(\d{9})$/.exec(String(v || '').toUpperCase().replace(/\s+/g, '')); return m ? 'R-' + m[1] : ''; }
  function isDraft(r) { return r && (r.stage === 'rf_draft' || r.stage === 'rf_returned'); }

  function build() {
    var rfs = (S.d && S.d.rfs) || [], jobs = (S.m && S.m.jobs) || {}, works = (S.w && S.w.works) || [], byRf = {}, usedJob = {}, usedWork = {}, byQtn = {}, rows = [];
    works.forEach(function (w) { if (w.statusKey !== 'cancelled') byQtn[w.qtn] = w; });
    Object.keys(jobs).forEach(function (q) { var j = jobs[q]; if (!j.via && j.status !== 'cancelled' && j.rfNumber) byRf[String(j.rfNumber).toUpperCase()] = j; });
    rfs.forEach(function (r) {
      var j = byRf[String(r.rf || '').toUpperCase()] || (r.qtn && jobs[r.qtn] && !jobs[r.qtn].via && jobs[r.qtn].status !== 'cancelled' ? jobs[r.qtn] : null);
      var q = r.qtn || (j && j.qtn) || '', w = byQtn[q] || null;
      if (j) usedJob[j.key] = 1; if (w) usedWork[w.id] = 1;
      rows.push({ rf: r.rf, r: r, j: j, w: w, qtn: q });
    });
    Object.keys(jobs).forEach(function (q) {
      var j = jobs[q]; if (j.via || j.status === 'cancelled' || usedJob[j.key]) return;
      if (typeof DASH !== 'undefined' && DASH.cancelled && DASH.cancelled[j.qtn]) return;     // the work was cancelled: no row for it
      var w = byQtn[j.qtn] || null; if (w) usedWork[w.id] = 1;
      rows.push({ rf: j.rfNumber || '', r: null, j: j, w: w, qtn: j.qtn });
    });
    works.forEach(function (w) { if (w.statusKey === 'cancelled' || usedWork[w.id]) return; rows.push({ rf: '', r: null, j: null, w: w, qtn: w.qtn }); });
    rows.forEach(function (o) {
      var r = o.r, j = o.j, w = o.w, tags = { all: 1 }, you = false;
      if (r) {
        var k = r.stage;
        if (k === 'rf_draft') tags.draft = 1;
        else if (k === 'rf_returned' || k === 'rf_rejected') tags.ret = 1;
        else if (k === 'rf_review' || k === 'pr_review') tags.appr = 1;
        else if (k === 'done') tags.done = 1;
        else tags.proc = 1;
        if (k === 'rf_draft' || k === 'rf_returned' || k === 'rf_rejected') you = true;
      } else if (j) tags.mri = 1;
      else if (w && w.needsRF) tags.raise = 1;
      if (j && (j.status === 'review' || j.status === 'error') && (!r || j.rfDocs === 'needs you')) you = true;
      if (j && !r && j.status === 'done' && !j.rfNumber) { tags.done = 1; delete tags.mri; }
      if (w) {
        if (w.needsTijori) tags.tij = 1;
        if (typeof PENDING_STAGES !== 'undefined' && PENDING_STAGES.indexOf(w.wcrStage) > -1) tags.wcr = 1;
        if (w.issues && w.issues.length) tags.fix = 1;
        var tf = trackerFix(w.id);
        if (tf.fix.length) tags.tfix = 1;
        if (tf.health.length) tags.thealth = 1;
        if (tf.wait) tags.twait = 1;
      } else if (r && r.stage !== 'closed') tags.tmiss = 1;
      o.tags = tags; o.you = you; if (you) tags.need = 1;
      o.sort = you ? 0 : tags.raise ? 1 : 2;
    });
    rows.sort(function (a, b) {
      if (a.sort !== b.sort) return a.sort - b.sort;
      var da = a.r && a.r.days != null ? a.r.days : (a.w && a.w.rfAge != null ? a.w.rfAge : -1), db = b.r && b.r.days != null ? b.r.days : (b.w && b.w.rfAge != null ? b.w.rfAge : -1);
      return db - da;
    });
    S.rows = rows;
    fillFilters();
  }
  function docState(o) {
    var dr = o.qtn ? S.drive[o.qtn] : null;
    if (!dr) return 'unk';
    if (!dr.folder) return 'missing';
    return KEY_DOCS.some(function (k) { return !(dr.has[k] || []).length; }) ? 'missing' : 'ready';
  }
  function inChip(o, c) {
    if (c === 'docs') return !!o.tags.raise && docState(o) !== 'ready';
    if (c === 'ready') return !!o.tags.raise && docState(o) === 'ready';
    if (c === 'md') return !!(o.tags.mri || o.tags.draft || o.tags.ret);
    return !!o.tags[c];
  }
  function passFilters(o) {
    var f = S.f, w = o.w;
    if (SUP.pick && supOf(o) !== SUP.pick) return false;              // v38: supervisor tab
    if (!(f.month || f.building || f.major || f.assignee)) return true;
    if (!w) return false;
    if (f.month && (f.month === '__none' ? w.monthKey : w.monthKey !== f.month)) return false;
    if (f.building && w.building !== f.building) return false;
    if (f.major && w.major !== f.major) return false;
    if (f.assignee && w.assignee !== f.assignee) return false;
    return true;
  }
  function visible() {
    var t = S.text.toLowerCase();
    var v = S.rows.filter(function (o) {
      if (!inChip(o, S.chip) || !passFilters(o)) return false;
      if (!t) return true;
      var r = o.r || {}, j = o.j || {}, w = o.w || {};
      return [o.rf, o.qtn, r.crm || w.crm, r.desc || w.desc, r.building || w.building, r.vendor || w.supplier, j.poReq, j.message, j.statusText, w.status, w._h].join(' | ').toLowerCase().indexOf(t) > -1;
    });
    if (S.sort !== 'prio') {
      var key = { new: function (o) { return o.w && o.w.dateBasis ? o.w.dateBasis : ''; }, wait: function (o) { return o.w && o.w.actionAge != null ? o.w.actionAge : (o.r && o.r.days != null ? o.r.days : -1); }, cost: function (o) { return o.w && o.w.waslCost ? o.w.waslCost : 0; } }[S.sort];
      v = v.slice().sort(function (a, b) { var x = key(a), y = key(b); return x < y ? 1 : x > y ? -1 : 0; });
    }
    return v;
  }
  function queueOf(rf) { if (!rf) return null; var it = ((S.q && S.q.items) || []).filter(function (i) { return String(i.rf).toUpperCase() === String(rf).toUpperCase(); })[0]; return it || null; }
  function inQueue(rf) { var q = queueOf(rf); return q && (q.status === 'queued' || q.status === 'running'); }
  function notReady(o) { var d = o.r && o.r.docs; return isDraft(o.r) && !(d && (/^Ready/.test(d.state) || d.missing === 'no Buyer')); }

  /* ---- filters (same choices as the Dashboard had) ---- */
  function uniq(a) { return Array.from(new Set(a.filter(Boolean))).sort(function (x, y) { return String(x).localeCompare(String(y)); }); }
  function fillSel(id, first, vals, lab) {
    var el = $(id), cur = el.value;
    el.innerHTML = '<option value="">' + esc(first) + '</option>' + vals.map(function (v) { return '<option value="' + esc(v) + '">' + esc(lab ? lab(v) : v) + '</option>'; }).join('');
    el.value = vals.indexOf(cur) > -1 ? cur : '';
  }
  function fillFilters() {
    var ws = (S.w && S.w.works) || [];
    var months = uniq(ws.map(function (w) { return w.monthKey; })).reverse();
    if (ws.some(function (w) { return !w.monthKey; })) months.push('__none');
    fillSel('jd-f-month', 'All months', months, function (k) { return typeof fmtMonth === 'function' ? fmtMonth(k) : k; });
    fillSel('jd-f-building', 'All buildings', uniq(ws.map(function (w) { return w.building; })));
    fillSel('jd-f-major', 'All categories', uniq(ws.map(function (w) { return w.major; })));
    fillSel('jd-f-assignee', 'Everyone', uniq(ws.map(function (w) { return w.assignee; })));
    S.f.month = $('jd-f-month').value; S.f.building = $('jd-f-building').value; S.f.major = $('jd-f-major').value; S.f.assignee = $('jd-f-assignee').value;
  }

  /* ---- what is in the job's Drive folder ---- */
  function driveHtml(o) {
    if (!o.qtn) return '';
    var dr = S.drive[o.qtn];
    if (!dr) return '<div class="jd-dr"><span class="jd-dl">Drive</span><span class="jd-dim">' + (S.driveErr ? esc(S.driveErr) : 'checking…') + '</span></div>';
    var types = S.driveTypes || [], pills = '', w = o.w || {}, quoteLink = !!(w.pdfUrl || w.wordUrl), up = '';
    if (!dr.folder) pills = '<span class="jd-dim">No folder yet. It is made with the first document you add.</span>';
    else types.forEach(function (t) {
      var f = dr.has[t.k] || [], key = KEY_DOCS.indexOf(t.k) > -1;
      if (!f.length && !key) return;
      var ok = f.length > 0;
      pills += '<span class="jd-doc ' + (ok ? 'ok' : 'miss') + '" title="' + esc(f.length ? f.map(function (x) { return x.name; }).join('\n') : 'Nothing in this folder yet') + '">' + (ok ? '✓' : '✗') + ' ' + esc(t.label) + (f.length > 1 ? ' ×' + f.length : '') + '</span>';
    });
    if (quoteLink && !(dr.has.agfs_quote || []).length) pills += '<span class="jd-doc warn" title="The tracker has a quote link, but the file is not copied into the job folder yet">quote link in tracker only</span>';
    if (!o.r || isDraft(o.r)) {
      KEY_DOCS.forEach(function (k) {
        if ((dr.has && dr.has[k] || []).length) return;
        var busy = S.busyUp[o.qtn + '|' + k];
        up += '<button type="button" class="btn btn-ghost btn-sm" data-a="up" data-t="' + k + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Uploading…' : '+ ' + esc(SHORT[k] || k)) + '</button>';
      });
    }
    return '<div class="jd-dr"><span class="jd-dl">Drive</span>' + pills + (dr.folderUrl ? '<a class="jd-dlink" href="' + esc(dr.folderUrl) + '" target="_blank" rel="noopener">Open folder ↗</a>' : '') + '</div>' + (up ? '<div class="jd-up">' + up + '</div>' : '');
  }
  function wantScan() {
    var seen = {}, need = [];
    visible().slice(0, S.shown).forEach(function (o) { if (o.qtn && !S.drive[o.qtn] && !seen[o.qtn]) { seen[o.qtn] = 1; need.push(o.qtn); } });
    S.rows.forEach(function (o) { if (o.tags.raise && o.qtn && !S.drive[o.qtn] && !seen[o.qtn]) { seen[o.qtn] = 1; need.push(o.qtn); } });
    return need;
  }
  function scanMore() {
    if (S.scanning || !onJobs() || S.driveErr) return;
    var need = wantScan().slice(0, 40);
    if (!need.length) return;
    S.scanning = true;
    call('deskDriveScan', need).then(function (r) {
      S.scanning = false; S.driveTypes = r.types || S.driveTypes;
      if (!r.ok && !Object.keys(r.jobs || {}).length) { S.driveErr = r.error || 'Could not check Drive.'; draw(); return; }
      Object.keys(r.jobs || {}).forEach(function (q) { S.drive[q] = r.jobs[q]; });
      draw();
    }).catch(function (e) { S.scanning = false; S.driveErr = 'Could not check Drive (' + ((e && e.message) || e) + ')'; draw(); });
  }

  function statusChip(w) {
    if (!w || !w.group) return '';
    var meta = typeof STATUS_META !== 'undefined' ? STATUS_META : {}, label = meta[w.group] && w.group !== 'hold' ? w.status : (w.status || 'No status');
    return '<span class="chip s-' + esc(w.group) + '" title="' + esc(label) + '">' + esc(label) + '</span>';
  }
  function rowHtml(o, i) {
    var r = o.r, j = o.j, w = o.w || {}, head = o.rf || o.qtn || '(no number yet)';
    var desc = (r && r.desc) || w.desc || (j && j.message) || '';
    var sub = [o.rf && o.qtn ? o.qtn : '', (r && r.crm) || w.crm ? 'CRM ' + ((r && r.crm) || w.crm) : '', (r && r.building) || w.building, w.apt].filter(Boolean).join(' · ');
    var p = statusChip(o.w);
    if (o.w) {
      var tf = trackerFix(o.w.id), tn = tf.fix.length + tf.health.length;
      if (tn) p += '<span class="jd-pill bad" data-part="fix">Tracker: ' + tn + ' to fix</span>';
    } else if (r && r.stage !== 'closed') p += '<span class="jd-pill bad" data-part="link">Not in the tracker: pick the job</span>';
    if (j) p += '<span data-part="mri" class="jd-pill ' + (j.status === 'error' ? 'bad' : j.status === 'review' ? 'warn' : j.status === 'done' ? 'ok' : '') + '">MRI: ' + esc(j.statusText || j.status) + '</span>';
    if (r) {
      p += '<span data-part="dyn" class="jd-pill ' + (r.over ? 'bad' : r.who === 'you' ? 'warn' : r.stage === 'done' ? 'ok' : '') + '">' + esc(r.stageName) + (r.days != null ? ' · ' + r.days + ' d' : '') + '</span>';
      if (r.who && r.who !== 'you' && r.who !== 'done') p += '<span class="jd-pill">Waiting on ' + esc((((S.d.who || []).filter(function (x) { return x.k === r.who; })[0]) || {}).name || r.who) + '</span>';
      if (r.prs && r.prs.length) p += '<span class="jd-pill">PR ' + esc(r.prs.map(function (x) { return x.n; }).join(', ')) + '</span>';
      if (r.pos && r.pos.length) p += '<span class="jd-pill">PO ' + esc(r.pos.map(function (x) { return x.n; }).join(', ')) + '</span>';
      if (isDraft(r)) {
        var d = r.docs;
        p += d ? '<span data-part="dyn" class="jd-pill ' + (/^Ready/.test(d.state) ? 'ok' : 'warn') + '">' + (/^Ready/.test(d.state) ? 'Attached in Dynamics' : 'In Dynamics: ' + esc((d.missing || d.state || 'not ready').substring(0, 70))) + '</span>' : '<span data-part="dyn" class="jd-pill">Dynamics documents not checked yet</span>';
      }
    } else if (!j && w.needsRF) p += '<span class="jd-pill warn">Approved, no RF yet' + (w.rfAge != null ? ' · ' + w.rfAge + ' d' : '') + '</span>';
    var meta = [], cost = (r && r.amount) || w.waslCost || w.supCost;
    if (cost) meta.push('AED ' + Math.round(cost).toLocaleString('en-US'));
    if (w.dateBasis && typeof fmtDate === 'function') meta.push((w.basisType === 'completion' ? 'Completed ' : 'Quoted ') + fmtDate(w.dateBasis));
    var metaH = meta.length || w.actionAge != null ? '<div class="jd-meta">' + esc(meta.join(' · ')) + (w.actionAge != null && typeof ageChip === 'function' ? (meta.length ? ' · waiting ' : 'Waiting ') + ageChip(w.actionAge) : '') + '</div>' : '';
    var todo = o.w && typeof pills === 'function' ? pills(o.w).replace('class="pills"', 'class="pills jd-todo"') : '';
    var q = queueOf(o.rf), qh = '';
    if (q && q.status !== 'cancelled') {
      var cls = q.status === 'done' ? 'ok' : (q.status === 'error' || q.status === 'skipped') ? 'bad' : '';
      var txt = q.status === 'queued' ? 'Waiting for your PC…' : q.status === 'running' ? (q.step || 'Working') + (q.pct ? ' (' + q.pct + '%)' : '') + '…' : q.status === 'done' ? '✓ ' + (q.result || 'Ready to submit') : '⚠ ' + (q.result || q.message || 'Could not finish');
      qh = '<div class="jd-q ' + cls + '">Dynamics: ' + esc(txt) + '</div>';
    } else if (j && j.message && (j.status === 'error' || j.status === 'review')) qh = '<div class="jd-q ' + (j.status === 'error' ? 'bad' : '') + '">' + esc(j.message) + '</div>';
    var b = '';
    if (notReady(o) && !inQueue(o.rf)) b += '<button type="button" class="btn btn-primary btn-sm" data-a="attach">📎 Attach documents</button>';
    if (j && !o.rf && (j.status === 'review' || j.status === 'error')) b += '<input type="text" data-rfin maxlength="14" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RF number"><button type="button" class="btn btn-primary btn-sm" data-a="setrf">Use this RF</button>';
    if (j && j.status === 'review' && j.rfNumber) b += '<button type="button" class="btn btn-ghost btn-sm" data-a="again">Run Dynamics again</button>';
    if (o.qtn && window.__vwMri && !o.rf && !j) b += '<button type="button" class="btn btn-primary btn-sm" data-a="mri">Raise in MRI</button>';
    else if (o.qtn && window.__vwMri) b += '<button type="button" class="btn btn-ghost btn-sm" data-a="mri">Open in MRI</button>';
    b += '<button type="button" class="btn btn-ghost btn-sm" data-a="open">Open job ›</button>';
    return '<div class="jd-row clk' + (o.you ? ' you' : '') + (r && r.over ? ' late' : '') + '" data-i="' + i + '"' + (o.qtn ? ' data-q="' + esc(o.qtn) + '"' : '') + '><div class="jd-main"><div class="jd-t">' + esc(head) + (desc ? ' <span>' + esc(String(desc).substring(0, 140)) + '</span>' : '') + '</div>' +
      (sub ? '<div class="jd-s">' + esc(sub) + '</div>' : '') + '<div class="jd-p">' + p + '</div>' + metaH + todo + driveHtml(o) + qh + '</div><div class="jd-acts">' + b + '</div></div>';
  }
  function draw() {
    if (!S.d && !S.w) return;
    var act = document.activeElement;
    if (act && act.closest && act.closest('#jd-body') && act.tagName === 'INPUT') return;       // do not wipe what is being typed
    var base = S.rows.filter(passFilters), unk = base.some(function (o) { return o.tags.raise && docState(o) === 'unk'; });
    var pk = SUP.pick; SUP.pick = ''; var noSup = S.rows.filter(passFilters); SUP.pick = pk; drawSup(noSup);
    $('jd-steps').innerHTML = STEPS.map(function (s, k) {
      var n = base.filter(function (o) { return inChip(o, s[0]); }).length;
      return '<button type="button" class="jd-step' + (S.chip === s[0] ? ' on' : '') + '" data-chip="' + s[0] + '"><span class="no">' + (k + 1) + '</span><b>' + esc(s[1]) + '</b><span class="n">' + n + '</span><small>' + esc(s[0] === 'docs' && unk ? 'checking Drive…' : s[2]) + '</small></button>';
    }).join('');
    $('jd-chips').innerHTML = CHIPS.map(function (c) {
      var n = base.filter(function (o) { return inChip(o, c[0]); }).length;
      return '<button type="button" class="jd-chip' + (S.chip === c[0] ? ' on' : '') + '" data-chip="' + c[0] + '">' + c[1] + '<b>' + n + '</b></button>';
    }).join('');
    $('jd-tchips').innerHTML = '<span class="jd-tl">Tracker</span>' + TCHIPS.map(function (c) {
      var n = base.filter(function (o) { return inChip(o, c[0]); }).length;
      return '<button type="button" class="jd-chip' + (S.chip === c[0] ? ' on' : '') + (n && c[0] !== 'twait' ? ' bad' : '') + '" data-chip="' + c[0] + '">' + c[1] + '<b>' + n + '</b></button>';
    }).join('');
    var v = visible();
    $('jd-body').innerHTML = v.length ? v.slice(0, S.shown).map(function (o) { return rowHtml(o, S.rows.indexOf(o)); }).join('') + (v.length > S.shown ? '<p class="view-sub"><button type="button" class="btn btn-ghost btn-sm" id="jd-more">Show more (' + (v.length - S.shown) + ' left)</button></p>' : '')
      : '<div class="loading-box"><span>' + (S.chip === 'need' && !S.text ? 'Nothing is waiting on you. 🎉' : 'Nothing matches.') + '</span></div>';
    var todo = S.rows.filter(function (o) { return notReady(o) && !inQueue(o.rf); }).length;
    $('jd-all').disabled = !todo; $('jd-all').textContent = todo ? 'Attach to ' + todo + ' draft RF' + (todo === 1 ? '' : 's') : 'Attach to all drafts';
    var fr = S.d && S.d.fresh && S.d.fresh.RF; $('jd-sub').textContent = 'Every job from quote to RF, PR and PO in one list. Click a job to open it.' + (fr && fr.display ? ' D365 export: ' + fr.display + (fr.stale ? ' (old: import a fresh one)' : '') + '.' : '');
    var pc = $('jd-pc'), q = S.q, warn = '';
    if (q && q.use) {
      var seen = q.seen && q.seen[q.use], t = function (x) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):?(\d{2})?/.exec(x || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : 0; };
      if (!seen || (t(q.now) - t(seen)) > 6 * 60000) warn = 'The PC that does the Dynamics work (' + esc(q.use) + ') has not been seen for a few minutes. Run <b>Start hub jobs.bat</b> on it, or nothing below will move.';
    }
    pc.style.display = warn ? '' : 'none'; pc.innerHTML = warn;
    paintMach();
    scanMore();
  }
  /* ---- which computer raises MRI WOs and attaches RF documents: the same "Use computer" setting as MRI Work Orders ---- */
  var MACH = { laptop: 'AGI011511', home: 'Muaz-PC' };              // Windows names of the two PCs; blank setting = Home PC
  function machHome() {                                             // a PC that checked in and is not the laptop, if the name differs
    var seen = Object.keys((S.q && S.q.seen) || {}), lap = MACH.laptop.toLowerCase();
    if (seen.some(function (k) { return k.toLowerCase() === MACH.home.toLowerCase(); })) return MACH.home;
    var other = seen.filter(function (k) { return k.toLowerCase() !== lap; }).sort(function (a, b) { return String(S.q.seen[b]).localeCompare(String(S.q.seen[a])); });
    return other[0] || MACH.home;
  }
  function machNow() {
    var u = String((S.q && S.q.use) || '').trim().toLowerCase();
    if (!u) return 'home';
    if (u === MACH.laptop.toLowerCase()) return 'laptop';
    if (u === machHome().toLowerCase() || u === MACH.home.toLowerCase()) return 'home';
    return '';
  }
  function paintMach() {
    var now = machNow(), u = (S.q && S.q.use) || '';
    document.querySelectorAll('#jd-mach [data-mach]').forEach(function (b) { var on = b.dataset.mach === now; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $('jd-mach-s').textContent = now ? '' : 'Now set to ' + u + ' (from MRI Work Orders).';
  }
  $('jd-mach').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mach]'); if (!b || b.disabled || b.dataset.mach === machNow()) return;
    var which = b.dataset.mach, name = which === 'laptop' ? MACH.laptop : machHome(), was = S.q ? S.q.use : undefined;
    S.q = S.q || { items: [] }; S.q.use = name; paintMach();
    var btns = document.querySelectorAll('#jd-mach [data-mach]'); btns.forEach(function (x) { x.disabled = true; });
    call('mriUsePc', name).then(function () {
      btns.forEach(function (x) { x.disabled = false; });
      note('MRI WOs and RF documents now go to the ' + (which === 'laptop' ? 'laptop' : 'home PC') + '. The other one waits.');
      if (window.__vwMriLive && window.__vwMriLive.kick) window.__vwMriLive.kick(200);
      poll(300);
    }).catch(function (er) { btns.forEach(function (x) { x.disabled = false; }); S.q.use = was; paintMach(); note(er.message); });
  });
  paintMach();
  function getWorks(force) {
    return new Promise(function (res, rej) {
      if (typeof DASH === 'undefined' || typeof loadDashboard !== 'function') { res([]); return; }
      if (DASH.loaded && !force) { res(ST.works); return; }
      var tm = 0, clean = function () { document.removeEventListener('vw-dash-loaded', done); document.removeEventListener('vw-dash-failed', failed); clearTimeout(tm); };
      var done = function () { clean(); res(ST.works || []); };
      var failed = function () { clean(); rej(new Error('the works list could not be loaded from the tracker (use Refresh on the Dashboard)')); };
      document.addEventListener('vw-dash-loaded', done);
      document.addEventListener('vw-dash-failed', failed);
      tm = setTimeout(failed, 45000);
      loadDashboard(!!force);
    });
  }
  function load(force) {
    S.loading = true; $('jd-error').style.display = 'none';
    if (!S.d && !S.w) { $('jd-loading').style.display = ''; $('jd-body').style.display = 'none'; }
    if (force) { S.drive = {}; S.driveErr = ''; }
    var safe = function (p, dflt) { return p.catch(function (e) { S.partial = (S.partial ? S.partial + ' · ' : '') + ((e && e.message) || e); return dflt; }); };
    S.partial = '';
    Promise.all([safe(call('d365GetDashboard', !!force), { rfs: [], who: [] }), safe(call('mriList'), { jobs: {} }), safe(call('rfqList'), { items: [] }), safe(getWorks(!!force), [])]).then(function (r) {
      S.d = r[0]; S.m = r[1]; S.q = r[2]; S.w = { works: r[3] }; S.loading = false;
      $('jd-loading').style.display = 'none'; $('jd-body').style.display = '';
      if (S.partial) { $('jd-error').style.display = ''; $('jd-error').textContent = 'Some information could not be loaded: ' + S.partial; }
      build(); draw(); poll(8000);
    });
  }
  /* the tracker was reloaded from the Dashboard's Refresh or the live updater: show the new list too */
  document.addEventListener('vw-dash-loaded', function () { if (S.d && !S.loading) { S.w = { works: ST.works }; build(); draw(); } });
  function poll(delay) {
    clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      if (!onJobs()) return;
      Promise.all([call('rfqList'), call('mriList')]).then(function (r) {
        S.q = r[0]; S.m = r[1]; build(); draw();
        var busy = ((S.q && S.q.items) || []).some(function (i) { return i.status === 'queued' || i.status === 'running'; }) || Object.keys((S.m && S.m.jobs) || {}).some(function (k) { return S.m.jobs[k].status === 'running'; });
        poll(busy ? 5000 : 30000);
      }).catch(function () { poll(30000); });
    }, delay);
  }
  function addQueue(list) {
    if (!list.length) return;
    call('rfqAdd', list).then(function (r) {
      note(r.added ? r.added + ' RF' + (r.added === 1 ? '' : 's') + ' added to the queue' + (r.already ? ' (' + r.already + ' already in it)' : '') : 'Already in the queue');
      return call('rfqList');
    }).then(function (q) { S.q = q; draw(); poll(4000); }).catch(function (e) { note((e && e.message) || String(e)); });
  }
  function titleOf(o) { var r = o.r || {}, w = o.w || {}; return [r.crm || w.crm, r.desc || w.desc].filter(Boolean).join(' - '); }
  /* the same job panel as on the Dashboard (its own code: Approvals, Documents, MRI, Journey ...) */
  function openJob(id) {
    if (typeof ST !== 'undefined' && ST.byId && ST.byId[id]) { openDrawer(id); return; }
    note('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (typeof ST !== 'undefined' && ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded && typeof loadDashboard === 'function') loadDashboard(false);
  }

  /* ---- add a document to the job's Drive folder (the same upload as Job Documents) ---- */
  var fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.multiple = true; fileIn.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.msg,.eml'; fileIn.style.display = 'none'; document.body.appendChild(fileIn);
  var MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  function readB64(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onerror = function () { rej(new Error('Could not read ' + f.name)); };
      fr.onload = function () { res(String(fr.result).split(',')[1] || ''); }; fr.readAsDataURL(f);
    });
  }
  fileIn.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileIn.files || []), u = S.up; fileIn.value = ''; S.up = null;
    if (!files.length || !u) return;
    uploadTo(u, files);
  });
  /* v38: the files go up one by one, each with its own line (Reading, Uploading, In Drive); when Drive is checked again
     the job's missing-document badge turns green, and the notice can open the folder. */
  function typeLabel(k) { var t = (S.driveTypes || []).filter(function (x) { return x.k === k; })[0]; return (t && t.label) || SHORT[k] || k; }
  function uploadTo(u, files) {
    var key = u.qtn + '|' + u.type; S.busyUp[key] = 1; draw();
    var tray = typeof uploadTray === 'function' ? uploadTray(u.qtn + ' · ' + typeLabel(u.type)) : null;
    var chain = Promise.resolve(), ok = 0, bad = '';
    files.forEach(function (f) {
      var line = tray ? tray.add(f.name) : null;
      chain = chain.then(function () { if (line) line.set('Reading', 15); return readB64(f); }).then(function (b64) {
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if (line) line.set('Uploading', 55);
        return call('docsUpload', { qtn: u.qtn, type: u.type, rf: '', detail: '', name: f.name, mime: f.type || MIME[ext] || 'application/octet-stream', b64: b64 });
      }).then(function () { ok++; if (line) line.ok(); }, function (e) { bad = bad || (e && e.message) || String(e); if (line) line.fail((e && e.message) || 'Not uploaded'); });
    });
    chain.then(function () {
        delete S.busyUp[key]; delete S.drive[u.qtn]; if (tray) tray.end();
        return call('deskDriveScan', [u.qtn]).then(function (r) { S.driveTypes = r.types || S.driveTypes; Object.keys(r.jobs || {}).forEach(function (q) { S.drive[q] = r.jobs[q]; }); }).catch(function () {});
      }).then(function () {
        draw();
        var dr = S.drive[u.qtn], url = dr && dr.folderUrl;
        if (ok) toast(ok + ' file' + (ok === 1 ? '' : 's') + ' added to ' + u.qtn + (bad ? ' (' + (files.length - ok) + ' not uploaded)' : ''),
          url ? { actions: [{ label: 'Open folder', run: function () { window.open(url, '_blank', 'noopener'); } }] } : null);
        else note(bad || 'Nothing was uploaded');
        var qs = window.CSS && CSS.escape ? CSS.escape(u.qtn) : u.qtn;
        if (ok) document.querySelectorAll('#jd-body .jd-row[data-q="' + qs + '"] .jd-doc.ok').forEach(function (d) { d.classList.add('jd-pop'); });
      });
  }

  /* ---- v38: drop files from the computer straight onto a job (desktop and iPad). You pick what the file is, then it uploads. ---- */
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') > -1; }
  var dropOn = null;
  function dropRow(e) { var r = e.target.closest && e.target.closest('#jd-body .jd-row[data-q]'); return r && r.dataset.q ? r : null; }
  $('jd-body').addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    var r = dropRow(e); if (!r) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    if (dropOn !== r) { if (dropOn) dropOn.classList.remove('jd-over'); dropOn = r; r.classList.add('jd-over'); }
  });
  $('jd-body').addEventListener('dragleave', function (e) {
    if (dropOn && !dropOn.contains(e.relatedTarget)) { dropOn.classList.remove('jd-over'); dropOn = null; }
  });
  $('jd-body').addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    var r = dropRow(e); if (dropOn) dropOn.classList.remove('jd-over'); dropOn = null;
    if (!r) return;
    e.preventDefault();
    var files = Array.prototype.slice.call(e.dataTransfer.files || []), o = S.rows[Number(r.dataset.i)];
    if (!files.length || !o || !o.qtn) return;
    askType(r, o, files);
  });
  /* stop a file dropped next to a job from opening in the browser instead */
  document.addEventListener('dragover', function (e) { if (!e.defaultPrevented && hasFiles(e) && $('view-desk').style.display !== 'none') e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (e.defaultPrevented || !hasFiles(e) || $('view-desk').style.display === 'none' || dropRow(e)) return;
    e.preventDefault();
    if ($('jd-body').contains(e.target)) note('Drop the file on the job it belongs to.');
  });
  function askType(row, o, files) {
    var old = document.querySelector('.jd-drop-ask'); if (old) old.remove();
    var dr = S.drive[o.qtn] || { has: {} }, types = (S.driveTypes && S.driveTypes.length ? S.driveTypes.map(function (t) { return t.k; }) : KEY_DOCS.slice());
    types.sort(function (a, b) {                                    // what the job is missing first
      var ma = KEY_DOCS.indexOf(a) > -1 && !((dr.has || {})[a] || []).length, mb = KEY_DOCS.indexOf(b) > -1 && !((dr.has || {})[b] || []).length;
      return (mb ? 1 : 0) - (ma ? 1 : 0);
    });
    var box = document.createElement('div'); box.className = 'jd-drop-ask';
    box.innerHTML = '<b>' + esc(files.length === 1 ? files[0].name : files.length + ' files') + '</b><span>What is it? It goes into the Drive folder of ' + esc(o.qtn) + '.</span><div>' +
      types.map(function (k) { var miss = KEY_DOCS.indexOf(k) > -1 && !((dr.has || {})[k] || []).length; return '<button type="button" class="btn btn-sm ' + (miss ? 'btn-primary' : 'btn-ghost') + '" data-k="' + esc(k) + '">' + esc(typeLabel(k)) + '</button>'; }).join('') +
      '<button type="button" class="btn btn-ghost btn-sm" data-k="">Cancel</button></div>';
    box.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('button[data-k]'); if (!b) return;
      box.remove(); if (b.dataset.k) uploadTo({ qtn: o.qtn, type: b.dataset.k }, files);
    });
    row.querySelector('.jd-main').appendChild(box);
    var first = box.querySelector('button'); if (first) first.focus();
  }

  /* ---- v38: on a phone, swipe a job sideways to use its buttons: right = open the job, left = the job's main button
     (Attach documents / Raise in MRI / Open in MRI). Only touch screens at phone size; laptops, desktops and iPads are unchanged. ---- */
  var phoneSwipe = window.matchMedia('(max-width:768px) and (pointer:coarse)');
  function swipeAct(row) {
    var b = row.querySelector('.jd-acts button[data-a="attach"]') || row.querySelector('.jd-acts button[data-a="mri"]');
    return b && !b.disabled ? b : null;
  }
  (function () {
    var sw = null;
    var body = $('jd-body');
    body.addEventListener('touchstart', function (e) {
      if (!phoneSwipe.matches || e.touches.length !== 1) { sw = null; return; }
      if (e.target.closest('button, a, input, select, textarea, .jd-drop-ask')) { sw = null; return; }
      var row = e.target.closest('.jd-row'); if (!row) { sw = null; return; }
      var t = e.touches[0]; sw = { row: row, x: t.clientX, y: t.clientY, dx: 0, on: false, act: swipeAct(row) };
    }, { passive: true });
    body.addEventListener('touchmove', function (e) {
      if (!sw) return;
      var t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }     // scrolling the list
        if (Math.abs(dx) < 12) return;
        sw.on = true; sw.row.classList.add('jd-swiping');
        var u = document.createElement('div'); u.className = 'jd-under';            // sits behind the row; the row slides over it
        u.style.top = sw.row.offsetTop + 'px'; u.style.left = sw.row.offsetLeft + 'px'; u.style.width = sw.row.offsetWidth + 'px'; u.style.height = sw.row.offsetHeight + 'px';
        u.innerHTML = '<span class="r">Open job ›</span><span class="l">' + esc(sw.act ? sw.act.textContent.replace(/^[^A-Za-z]+/, '') : '') + '</span>';
        sw.row.parentNode.insertBefore(u, sw.row); sw.under = u;
      }
      if (dx < 0 && !sw.act) dx = dx / 4;                         // nothing on the left: it only gives a little
      sw.dx = Math.max(-140, Math.min(140, dx));
      sw.row.style.setProperty('--sx', sw.dx + 'px');
      sw.under.className = 'jd-under ' + (sw.dx > 0 ? 'go-r' : 'go-l') + (Math.abs(sw.dx) > 80 ? ' armed' : '');
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    function end() {
      if (!sw) return;
      var s = sw; sw = null;
      if (!s.on) return;
      s.row.classList.remove('jd-swiping'); s.row.style.setProperty('--sx', '0px');
      setTimeout(function () { if (s.under && s.under.parentNode) s.under.parentNode.removeChild(s.under); }, 260);
      s.row.dataset.swiped = '1'; setTimeout(function () { delete s.row.dataset.swiped; }, 400);
      if (s.dx > 80) { var o = S.rows[Number(s.row.dataset.i)]; if (o) openPop(o, ''); }
      else if (s.dx < -80 && s.act) s.act.click();
    }
    body.addEventListener('touchend', end);
    body.addEventListener('touchcancel', end);
  })();

  /* ---- v38: supervisor tabs (Imran, Altaf, Akash, Irfan) above the job list; the highlight slides to the one picked ---- */
  var SUP = { list: null, pick: '' };
  function supOf(o) {
    var b = (o.w && o.w.building) || (o.r && o.r.building) || '', m = /DD\s?(\d{3})/i.exec(String(b)), code = m ? 'DD' + m[1] : '', L = SUP.list || [];
    if (!code || !L.length) return '';
    for (var i = 0; i < L.length - 1; i++) if (L[i].codes.indexOf(code) > -1) return L[i].name;
    return L[L.length - 1].name;
  }
  function drawSup(base) {
    var el = $('jd-sup'); if (!el) return;
    if (!SUP.list || !SUP.list.length) { el.hidden = true; return; }
    el.hidden = false;
    var inC = base.filter(function (o) { return inChip(o, S.chip); });
    var tabs = [['', 'Everyone', inC.length]].concat(SUP.list.map(function (s) { return [s.name, s.name, inC.filter(function (o) { return supOf(o) === s.name; }).length]; }));
    var had = el.querySelector('.jd-sup-ink');
    if (!had || el.querySelectorAll('button').length !== tabs.length) {
      el.innerHTML = '<span class="jd-sup-ink" aria-hidden="true"></span>' + tabs.map(function (t) { return '<button type="button" role="tab" data-sup="' + esc(t[0]) + '">' + esc(t[1]) + '<b></b></button>'; }).join('');
    }
    el.querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', b.dataset.sup === SUP.pick); b.setAttribute('aria-selected', b.dataset.sup === SUP.pick ? 'true' : 'false'); b.querySelector('b').textContent = tabs[i][2]; });
    moveInk(!had);
  }
  function moveInk(jump) {
    var el = $('jd-sup'), on = el && el.querySelector('button.on'), ink = el && el.querySelector('.jd-sup-ink');
    if (!on || !ink || !on.offsetWidth) return;
    if (jump) ink.classList.add('jump');
    ink.style.width = on.offsetWidth + 'px'; ink.style.transform = 'translateX(' + on.offsetLeft + 'px)';
    if (jump) { void ink.offsetWidth; ink.classList.remove('jump'); }
    if (on.offsetLeft < el.scrollLeft || on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, on.offsetLeft - 24), behavior: jump ? 'auto' : 'smooth' });   // phone: keep the picked one in view
  }
  window.addEventListener('resize', function () { moveInk(true); });
  $('jd-sup').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sup]'); if (!b) return;
    SUP.pick = b.dataset.sup; S.shown = 60;
    var body = $('jd-body');
    if (body.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) body.animate([{ opacity: .35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    draw();
  });
  call('phSupervisors').then(function (s) { SUP.list = s || []; if (S.rows.length) draw(); }).catch(function () { SUP.list = []; });

  $('jd-refresh').addEventListener('click', function () { if (S.tab === 'today') { var t = $('td-refresh'); if (t) t.click(); } else load(true); });
  $('jd-q').addEventListener('input', function () { S.text = this.value.trim(); S.shown = 60; draw(); });
  [['jd-f-month', 'month'], ['jd-f-building', 'building'], ['jd-f-major', 'major'], ['jd-f-assignee', 'assignee']].forEach(function (p) {
    $(p[0]).addEventListener('change', function () { S.f[p[1]] = this.value; S.shown = 60; draw(); });
  });
  $('jd-sort').addEventListener('change', function () { S.sort = this.value; S.shown = 60; draw(); });
  function chipClick(e) { var b = e.target.closest('[data-chip]'); if (!b) return; S.chip = b.dataset.chip; S.shown = 60; draw(); }
  $('jd-chips').addEventListener('click', chipClick);
  $('jd-tchips').addEventListener('click', chipClick);
  $('jd-steps').addEventListener('click', chipClick);
  $('jd-rf-go').addEventListener('click', function () {
    var rf = rfNorm($('jd-rf').value); if (!rf) { note('Type the RF number like R-000096843 (R and 9 digits).'); return; }
    var o = S.rows.filter(function (x) { return String(x.rf).toUpperCase() === rf; })[0];
    addQueue([{ rf: rf, title: o ? titleOf(o) : '' }]); $('jd-rf').value = '';
  });
  $('jd-rf').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('jd-rf-go').click(); });
  $('jd-all').addEventListener('click', function () {
    addQueue(S.rows.filter(function (o) { return notReady(o) && !inQueue(o.rf); }).map(function (o) { return { rf: o.rf, title: titleOf(o) }; }));
  });
  $('jd-body').addEventListener('click', function (e) {
    if (e.target.id === 'jd-more') { S.shown += 60; draw(); return; }
    if (e.target.closest('a, input')) return;
    var row = e.target.closest('.jd-row'); if (!row || row.dataset.swiped) return;
    var o = S.rows[Number(row.dataset.i)]; if (!o) return;
    var b = e.target.closest('button[data-a]');
    if (!b) { var pt = e.target.closest('[data-part]'); openPop(o, pt ? pt.dataset.part : ''); return; }   // v37: click anywhere on the tile = the job popup
    var a = b.dataset.a;
    if (a === 'attach') addQueue([{ rf: o.rf, title: titleOf(o) }]);
    else if (a === 'open') openPop(o, '');
    else if (a === 'mri') { if (window.__vwMri) window.__vwMri.open(o.qtn); }
    else if (a === 'up') { S.up = { qtn: o.qtn, type: b.dataset.t }; fileIn.click(); }
    else if (a === 'again' || a === 'setrf') {
      var rf = a === 'again' ? rfNorm(o.j.rfNumber) : rfNorm((row.querySelector('[data-rfin]') || {}).value);
      if (!rf) { note('Type the RF number like R-000096843 (R and 9 digits).'); return; }
      b.disabled = true;
      call('mriSetRf', o.j.key, rf).then(function () { note('RF ' + rf + ': the PC will attach the documents in Dynamics'); return call('mriList'); })
        .then(function (m) { S.m = m; build(); draw(); poll(3000); }).catch(function (er) { b.disabled = false; note((er && er.message) || String(er)); });
    }
  });
  /* ---- v37: what to fix in VW_Tracker for one work (same lists, same "Done" memory as the old Procurement page) ---- */
  function tvDone() { try { return JSON.parse(sessionStorage.getItem('tvDone') || '{}') || {}; } catch (e) { return {}; } }
  function tvSetDone(k) { var d = tvDone(); d[k] = 1; try { sessionStorage.setItem('tvDone', JSON.stringify(d)); } catch (e) {} }
  function trackerFix(id) {
    var out = { fix: [], health: [], wait: null }, d = S.d; if (!d || id == null) return out;
    var done = tvDone();
    (d.rfs || []).forEach(function (r) {
      if (r.trackerId !== id || /cancel/i.test(r.status || '')) return;
      (r.fixes || []).forEach(function (f) {
        var k = id + '|' + f.f + '|' + f.value;
        if (!done[k] && !out.fix.some(function (g) { return g.f === f.f && g.value === f.value; })) out.fix.push({ f: f.f, col: f.col, value: f.value, why: f.why, have: f.have, hint: f.hint, key: k });
      });
    });
    (d.health || []).forEach(function (h) {
      if (h.id !== id) return;
      h.issues.forEach(function (i) { var k = id + '|h|' + i.f + '|' + i.why; if (!done[k]) out.health.push({ f: i.f, col: i.col, why: i.why, key: k }); });
    });
    (d.trackerOnly || []).forEach(function (t) { if (t.id === id) out.wait = t; });
    return out;
  }
  function cellLink(id, f) {
    var t = S.d && S.d.tracker; if (!t || !t.url) return '';
    return t.url + '&range=' + ((t.cols && t.cols[f]) || (t.cols && t.cols.qtn) || 'A') + id;
  }
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dLab(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? Number(m[3]) + ' ' + MONS[Number(m[2]) - 1] + ' ' + m[1] : v; }
  function copyText(text, btn) {
    var ok = function () { var t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = t; }, 1400); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var done = false; try { done = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); if (done) ok(); else note('Copy did not work here: ' + text);
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fallback); return; } } catch (e) {}
    fallback();
  }

  /* ---- v37: the job popup = the job panel (tracker details) with a Job Desk part on top: fixes, Dynamics, MRI, actions ---- */
  var POP = { o: null, part: '' };
  function rowsOfWork(id) { return S.rows.filter(function (x) { return x.w && x.w.id === id; }); }
  function fixHtml(w) {
    var tf = trackerFix(w.id), h = '';
    tf.fix.forEach(function (f) {
      var link = cellLink(w.id, f.f);
      h += '<div class="jdx-fx"><div class="jdx-c">' + esc(f.col) + (f.hint ? ' <span class="jdx-tag">check</span>' : '') + '</div>' +
        '<div class="jdx-v">' + (f.value ? esc(/Date$/.test(f.f) ? dLab(f.value) : f.value) : '<i>' + (f.hint ? 'Your call' : 'Type it in') + '</i>') + '</div>' +
        '<div class="jdx-w">' + esc(f.why) + (f.have && !f.hint ? ' · now: ' + esc(f.have) : '') + '</div><div class="jdx-b">' +
        (f.value ? '<button type="button" class="btn btn-primary btn-sm" data-x="copy" data-v="' + esc(f.value) + '">Copy</button>' : '') +
        (link ? '<a class="btn btn-ghost btn-sm" href="' + esc(link) + '" target="_blank" rel="noopener">Open in tracker</a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-x="done" data-k="' + esc(f.key) + '" title="Hide this until the tracker is read again">✓ Done</button></div></div>';
    });
    tf.health.forEach(function (i) {
      var link = cellLink(w.id, i.f);
      h += '<div class="jdx-fx"><div class="jdx-c">' + esc(i.col) + '</div><div class="jdx-v"><i>Fix in the tracker</i></div><div class="jdx-w">' + esc(i.why) + '</div><div class="jdx-b">' +
        (link ? '<a class="btn btn-ghost btn-sm" href="' + esc(link) + '" target="_blank" rel="noopener">Open in tracker</a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-x="done" data-k="' + esc(i.key) + '">✓ Done</button></div></div>';
    });
    if (tf.wait) h += '<div class="jdx-fx"><div class="jdx-c">RF Reference</div><div class="jdx-v">' + esc(tf.wait.rf) + '</div><div class="jdx-w">This RF is not in the Dynamics export yet: raised today (it comes in tonight), or a typo in the tracker.</div></div>';
    return h;
  }
  function dynHtml(list) {
    var who = function (k) { return ((((S.d && S.d.who) || []).filter(function (x) { return x.k === k; })[0]) || {}).name || k; };
    return list.map(function (o) {
      var r = o.r, q = queueOf(o.rf), d = r.docs;
      var rows = [
        ['Step', esc(r.stageName) + (r.days != null ? ' · ' + r.days + ' days' : '') + (r.over ? ' <span class="jdx-tag bad">late</span>' : '')],
        r.next ? ['Next', esc(r.next) + (r.who && r.who !== 'done' ? ' (' + esc(r.who === 'you' ? 'you' : who(r.who)) + ')' : '')] : null,
        ['RF status', esc(r.status || '')],
        r.prs.length ? ['PR', r.prs.map(function (x) { return esc(x.n) + (x.status ? ' · ' + esc(x.status) : ''); }).join('<br>')] : null,
        r.pos.length ? ['PO', r.pos.map(function (x) { return esc(x.n) + (x.known ? ' · ' + esc([x.approval, x.status].filter(Boolean).join(', ')) : ''); }).join('<br>')] : null,
        r.vendor ? ['Vendor', esc(r.vendor)] : null,
        r.amount ? ['Amount', 'AED ' + Math.round(r.amount).toLocaleString('en-US')] : null,
        isDraft(r) ? ['Documents in Dynamics', d ? (/^Ready/.test(d.state) ? '✓ Attached' : esc(d.missing || d.state || 'not ready')) + (d.at ? ' <small>checked ' + esc(d.at) + '</small>' : '') : 'Not checked yet'] : null,
        q && q.status !== 'cancelled' ? ['Your PC', esc(q.status === 'queued' ? 'Waiting for your PC…' : q.status === 'running' ? (q.step || 'Working') + '…' : q.status === 'done' ? '✓ ' + (q.result || 'Ready to submit') : '⚠ ' + (q.result || q.message || 'Could not finish'))] : null
      ].filter(Boolean);
      return '<div class="jdx-rf"><div class="jdx-rfh"><b>' + esc(o.rf) + '</b>' + (r.desc ? '<span>' + esc(String(r.desc).substring(0, 120)) + '</span>' : '') + '</div>' +
        rows.map(function (x) { return '<div class="jdx-kv"><span>' + x[0] + '</span><div>' + x[1] + '</div></div>'; }).join('') +
        (notReady(o) && !inQueue(o.rf) ? '<div class="jdx-b"><button type="button" class="btn btn-primary btn-sm" data-x="attach" data-rf="' + esc(o.rf) + '">📎 Attach documents</button></div>' : '') + '</div>';
    }).join('');
  }
  function linkHtml(o) {
    return '<div class="jdx-link"><div class="jdx-w">Dynamics has this RF, but no job in VW_Tracker has its RF, CRM, PR or PO number. Pick the quote it belongs to: the hub remembers it (VW_Tracker is not changed) and shows what to add to the tracker.</div>' +
      '<input type="search" id="jdx-q" placeholder="Find the quote: number, CRM, building, work…" autocomplete="off"><div class="jdx-pick" id="jdx-pick"></div></div>';
  }
  function pickDraw() {
    var box = $('jdx-pick'), inp = $('jdx-q'); if (!box || !inp) return;
    var t = inp.value.trim().toLowerCase(), ws = ((S.w && S.w.works) || []).filter(function (w) { return w.statusKey !== 'cancelled'; });
    if (t) ws = ws.filter(function (w) { return [w.qtn, w.crm, w.desc, w.building, w.apt, w.supplier].join(' ').toLowerCase().indexOf(t) > -1; });
    else ws = ws.filter(function (w) { return !w.rf; });
    box.innerHTML = ws.slice(0, 30).map(function (w) {
      return '<button type="button" data-x="link" data-q="' + esc(w.qtn) + '"><b>' + esc(w.qtn) + '</b>' + (w.crm ? ' · CRM ' + esc(w.crm) : '') + '<span>' + esc([w.desc, w.building, w.rf ? 'RF ' + w.rf : ''].filter(Boolean).join(' · ')) + '</span></button>';
    }).join('') || '<div class="jdx-w">No job matches.</div>';
  }
  function actsHtml(o) {
    var b = '', w = o.w;
    if (window.__vwMri && o.qtn) b += '<button type="button" class="btn btn-ghost btn-sm" data-x="mri">' + (o.j || o.rf ? 'Open in MRI' : 'Raise in MRI') + '</button>';
    if (w && window.__vwMarks && w.statusKey === 'awaiting' && !w.qtnEmailDate) b += '<button type="button" class="btn btn-ghost btn-sm" data-x="sent">📨 Quote sent on…</button>';
    if (w && window.__vwMarks && (w.po || (o.r && o.r.pos.length)) && !w.grn) b += '<button type="button" class="btn btn-ghost btn-sm" data-x="grn">✅ GRN released</button>';
    if (o.r && o.r.trackerId != null && o.r.match === 'link') b += '<button type="button" class="btn btn-ghost btn-sm" data-x="unlink" data-rf="' + esc(o.rf) + '">Unlink ' + esc(o.rf) + '</button>';
    return b ? '<div class="jdx-acts">' + b + '</div>' : '';
  }
  function partHtml(o) {
    var h = '', w = o.w;
    if (w) {
      var fx = fixHtml(w);
      if (fx) h += '<div class="jdx-part" data-p="fix"><div class="jdx-t">✏️ Fix in the tracker</div>' + fx + '</div>';
      var rs = rowsOfWork(w.id).filter(function (x) { return x.r; });
      if (rs.length) h += '<div class="jdx-part" data-p="dyn"><div class="jdx-t">📦 Dynamics</div>' + dynHtml(rs) + '</div>';
    } else if (o.r) {
      h += '<div class="jdx-part" data-p="link"><div class="jdx-t">🔗 Which job is this?</div>' + linkHtml(o) + '</div>';
      h += '<div class="jdx-part" data-p="dyn"><div class="jdx-t">📦 Dynamics</div>' + dynHtml([o]) + '</div>';
    }
    if (o.j) h += '<div class="jdx-part" data-p="mri"><div class="jdx-t">🛠️ MRI</div><div class="jdx-kv"><span>Status</span><div>' + esc(o.j.statusText || o.j.status) + '</div></div>' + (o.j.message ? '<div class="jdx-w">' + esc(o.j.message) + '</div>' : '') + '</div>';
    return h + actsHtml(o);
  }
  function mountPart() {
    var body = $('drawer-body'), o = POP.o; if (!body || !o || $('jdx-sec')) return;
    var head = ($('dh-ref').textContent || '').trim();
    if (o.w ? head !== o.w.qtn : head !== o.rf) { POP.o = null; return; }     // the panel was opened for something else
    var sec = document.createElement('div'); sec.className = 'd-sec jdx'; sec.id = 'jdx-sec';
    sec.innerHTML = partHtml(o);
    if (!sec.innerHTML) return;
    var todo = body.querySelector('.todo');
    if (todo && todo.nextSibling) body.insertBefore(sec, todo.nextSibling); else body.insertBefore(sec, body.firstChild);
    pickDraw();
    if (POP.part) { var p = sec.querySelector('[data-p="' + POP.part + '"]') || (POP.part === 'mri' ? $('mri-sec') : null); if (p) setTimeout(function () { p.scrollIntoView({ block: 'start', behavior: 'smooth' }); p.classList.add('jdx-hl'); }, 120); }
  }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () {
    if ($('jdx-sec')) return;
    if (!POP.o && S.d) {                                     // opened from the Dashboard, search, Today...: same part for that work
      var head = ($('dh-ref').textContent || '').trim(), rs = S.rows.filter(function (x) { return x.w && x.w.qtn === head; });
      POP.o = rs.filter(function (x) { return x.r; })[0] || rs[0] || null; POP.part = '';
    }
    if (POP.o) mountPart();
  }).observe($('drawer-body'), { childList: true });
  function openPop(o, part) {
    POP.o = o; POP.part = part || '';
    if (o.w && o.w.id != null) { openJob(o.w.id); return; }
    // an RF with no tracker job: the same panel, filled from Dynamics
    if (!o.r) return;
    $('dh-ref').textContent = o.rf;
    $('dh-sub').textContent = ['Not in VW_Tracker', o.r.stageName].filter(Boolean).join('  ·  ');
    $('drawer-body').innerHTML = '<div class="todo bad"><div class="todo-title">Needs action</div><ul><li>Pick the job this RF belongs to, then add the RF number to that job in the tracker</li></ul></div>';
    $('drawer-body').scrollTop = 0;
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('drawer-scrim').classList.add('open');
  }
  function redrawPart() { var s = $('jdx-sec'); if (s && POP.o) { s.innerHTML = partHtml(POP.o); pickDraw(); } }
  $('drawer-body').addEventListener('input', function (e) { if (e.target.id === 'jdx-q') pickDraw(); });
  $('drawer-body').addEventListener('click', function (e) {
    var b = e.target.closest('#jdx-sec [data-x]'); if (!b || !POP.o) return;
    var o = POP.o, x = b.dataset.x;
    if (x === 'copy') copyText(b.dataset.v, b);
    else if (x === 'done') { tvSetDone(b.dataset.k); build(); draw(); redrawPart(); }
    else if (x === 'attach') { addQueue([{ rf: b.dataset.rf, title: titleOf(o) }]); b.disabled = true; b.textContent = 'Added to the queue'; }
    else if (x === 'mri') { if (window.__vwMri) window.__vwMri.open(o.qtn); }
    else if (x === 'sent' || x === 'grn') window.__vwMarks.ask(o.w.qtn, x, function () { if (o.w && window.__vwMarks.fill) window.__vwMarks.fill(o.w); });
    else if (x === 'link' || x === 'unlink') {
      var rf = o.rf, q = x === 'link' ? b.dataset.q : '';
      b.disabled = true;
      call('hubLinkRf', rf, q, x === 'unlink').then(function () {
        note(x === 'link' ? rf + ' linked to ' + q + '. Add the RF number to that job in the tracker.' : rf + ' unlinked');
        return call('d365GetDashboard', true);
      }).then(function (d) {
        S.d = d; build(); draw();
        var n = S.rows.filter(function (r) { return String(r.rf).toUpperCase() === String(rf).toUpperCase(); })[0];
        if (typeof closeDrawer === 'function') closeDrawer();
        if (n) setTimeout(function () { openPop(n, x === 'link' ? 'fix' : 'link'); }, 250);
      }).catch(function (er) { b.disabled = false; note((er && er.message) || String(er)); });
    }
  });
  $('jd-mri').addEventListener('click', function () { if (window.__vwMriPick) window.__vwMriPick(); else if ($('mrl-raise')) $('mrl-raise').click(); });
  // "D365 steps" elsewhere (Today, Job Journeys) opens the job popup at its Dynamics part
  function openRf(rf) {
    var go = function () {
      var k = String(rf || '').toUpperCase(), o = S.rows.filter(function (r) { return String(r.rf).toUpperCase() === k; })[0];
      if (o) openPop(o, 'dyn'); else note('RF ' + rf + ' is not in the Dynamics export.');
    };
    if (S.d) { go(); return; }
    note('Reading Dynamics…');
    var t = setInterval(function () { if (S.d && !S.loading) { clearInterval(t); go(); } }, 300);
    if (!S.loading) load(false);
    setTimeout(function () { clearInterval(t); }, 60000);
  }
  window.__vwDesk = { openRf: openRf, open: function (o, part) { openPop(o, part); }, go: function (chip) { S.chip = chip; S.text = ''; S.shown = 60; var n = document.querySelector('.nav-item[data-view="desk"]'); if (n) n.click(); setTimeout(draw, 50); } };
  document.addEventListener('visibilitychange', function () { if (onJobs()) poll(0); });
  if ($('view-desk').style.display !== 'none') { showTab('jobs'); load(false); }
})();
