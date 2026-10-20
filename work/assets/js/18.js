/* ---------------- ADDED: MRI Work Orders page + live progress from the PC (server: MRI.gs mriLive) ----------------
   mri_sync.py sends what its window prints, with a %, to the receiver (MRI_Live tab). This page, the chip in the
   top bar, the "Create in MRI" window and the MRI box in a work's panel all show it. Polls every 3 s while
   something is running and you are looking at it, slower otherwise, and not at all while the tab is hidden. */
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
  function money(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  var M = {
    d: null, at: 0,                // last answer + when it came (client clock)
    have: {}, logs: {}, meta: {},  // log lines per request
    prev: {},                      // status per request at the last answer (for the "it finished" notes)
    open: {},                      // requests whose log is shown on the page
    showAll: false, page: false, timer: null, busy: false, fails: 0, started: false,
    seen: store('mrl-seen-errors') || {}
  };

  /* ---------- time ---------- */
  function ts(s) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN; }
  function secsAgo(s) {                       // both stamps are Dubai time from the server, so no time-zone guessing
    if (!M.d) return NaN;
    var a = ts(s), b = ts(M.d.now); if (isNaN(a) || isNaN(b)) return NaN;
    return Math.max(0, Math.round((b - a) / 1000 + (Date.now() - M.at) / 1000));
  }
  function agoTxt(sec) {
    if (isNaN(sec)) return '';
    if (sec < 10) return 'just now'; if (sec < 60) return sec + ' s ago'; if (sec < 3600) return Math.round(sec / 60) + ' min ago';
    if (sec < 86400) return Math.round(sec / 3600) + ' h ago'; return Math.round(sec / 86400) + ' days ago';
  }

  /* ---------- reading the answer ---------- */
  function jobs() { return (M.d && M.d.jobs) || []; }
  function job(key) { return jobs().filter(function (j) { return j.key === key; })[0] || null; }
  function isActive(j) { return j.status === 'running' || j.status === 'queued'; }
  // the queue: the PC takes waiting requests in the order of their rows in MRI_Jobs, one at a time
  function waiting() { return jobs().filter(function (j) { return j.status === 'queued'; }).sort(function (a, b) { return (a.row || 0) - (b.row || 0); }); }
  function waitingDyn(j) { return j.status === 'running' && j.rfDocs === 'waiting'; }       // handed to Dynamics by RF number: MRI is not busy
  function running() { return jobs().filter(function (j) { return j.status === 'running' && !waitingDyn(j); })[0] || null; }
  function queuePos(j) { var w = waiting(); for (var i = 0; i < w.length; i++) if (w[i].key === j.key) return i + 1; return 0; }
  function nth(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }
  function queueInfo() { return { ready: !!M.d, running: running(), waiting: waiting(), pcOn: pcOnline() }; }
  // the PCs that run mri_sync.py, and the one chosen in the hub to make the WOs ('' = whichever is running)
  function comps() { return (M.d && M.d.computers) || []; }
  function useName() { return (M.d && M.d.use) || ''; }
  function label(name) { var c = comps().filter(function (x) { return x.name.toLowerCase() === String(name).toLowerCase(); })[0]; return c && c.label ? c.label : name; }
  function pcAlive(name) {                    // checked in lately, or busy sending progress on a request
    var c = comps().filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
    var s = c ? secsAgo(c.last) : NaN;
    if (!isNaN(s) && s < 150) return true;
    return jobs().some(function (j) { var x = M.meta[j.key]; if (j.status !== 'running' || !x || String(x.computer).toLowerCase() !== name.toLowerCase()) return false; var a = secsAgo(x.updated); return !isNaN(a) && a < 150; });
  }
  function pcOnline() {
    if (!M.d) return false;
    if (useName()) return pcAlive(useName());
    if (comps().some(function (c) { return pcAlive(c.name); })) return true;
    var s = secsAgo(M.d.lastCheck);
    if (!isNaN(s) && s < 150) return true;
    return jobs().some(function (j) { var x = M.meta[j.key]; if (j.status !== 'running' || !x) return false; var a = secsAgo(x.updated); return !isNaN(a) && a < 150; });
  }
  function ingest(d) {
    M.d = d; M.at = Date.now();
    Object.keys(d.live || {}).forEach(function (k) {
      var x = d.live[k]; M.meta[k] = x;
      if (x.log) {
        if (x.full || !M.logs[k]) M.logs[k] = x.log.slice(); else M.logs[k] = M.logs[k].concat(x.log);
        if (M.logs[k].length > 800) M.logs[k] = M.logs[k].slice(-800);
        M.have[k] = x.last || 0;
      }
    });
    (d.pcs || []).forEach(function (p) {
      M.meta[p.key] = p;
      if (p.log) { M.logs[p.key] = (p.full || !M.logs[p.key] ? [] : M.logs[p.key]).concat(p.log).slice(-60); M.have[p.key] = p.last || 0; }
    });
    // a request that just finished: say so wherever you are in the hub
    var first = !M.started; M.started = true;
    jobs().forEach(function (j) {
      var was = M.prev[j.key]; M.prev[j.key] = j.status;
      if (first || !was || was === j.status) return;
      var name = j.qtn || j.key;
      if (j.status === 'review') note('MRI: PO request ' + (j.poReq || '') + ' for ' + name + ' is ready. Send it to ERP in MRI.');
      else if (j.status === 'done') note('MRI: task ' + (j.taskId || '') + ' made for ' + name + '.');
      else if (j.status === 'error' && /^Stopped by you/.test(j.message || '')) note('MRI: ' + name + ' stopped. Check MRI for anything half-made.');
      else if (j.status === 'error') note('MRI: ' + name + ' could not finish. ' + (j.message || '').substring(0, 120));
      else if (j.status === 'running' && was === 'queued') note('MRI: your PC started ' + name + '.');
      if (['review', 'done', 'error', 'sent', 'cancelled'].indexOf(j.status) > -1 && was && (was === 'running' || was === 'queued')) {
        M.followUp = 2;                                  // the PC's last lines arrive a moment after the result
        if (window.__vwMri && window.__vwMri.reloadIf) window.__vwMri.reloadIf(j.key);   // the "Create in MRI" window, if it shows this one
      }
    });
    // keep asking for the logs of what is running or opened, drop the rest
    Object.keys(M.have).forEach(function (k) {
      var j = job(k);
      if (k.indexOf('_pc_') !== 0 && !(j && isActive(j)) && !M.open[k] && !document.querySelector('[data-mrl="' + cssq(k) + '"]')) delete M.have[k];
    });
  }
  function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ---------- asking the server ---------- */
  function poll() {
    clearTimeout(M.timer);
    if (M.busy) return;
    if (document.hidden) { schedule(); return; }
    M.busy = true;
    var have = {};
    Object.keys(M.have).forEach(function (k) { have[k] = M.have[k]; });
    Object.keys(M.open).forEach(function (k) { if (!(k in have)) have[k] = 0; });
    document.querySelectorAll('[data-mrl]').forEach(function (el) { var k = el.getAttribute('data-mrl'); if (k && !(k in have)) have[k] = 0; });
    call('mriLive', have).then(function (d) {
      M.busy = false; M.fails = 0; ingest(d); paint(); schedule();
    }).catch(function (e) {
      M.busy = false; M.fails++; M.err = e.message; paint(); schedule();
    });
  }
  function schedule() {
    clearTimeout(M.timer);
    var act = jobs().some(isActive);
    var watching = M.page || !!document.querySelector('[data-mrl]');
    var ms = act ? (watching ? 3000 : 12000) : (M.page ? 30000 : 90000);
    if (M.followUp > 0) { M.followUp--; ms = 3000; }
    if (M.fails) ms = Math.min(120000, ms * (1 + M.fails));
    M.timer = setTimeout(poll, ms);
  }
  function kick(delay) { clearTimeout(M.timer); M.timer = setTimeout(poll, delay || 800); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(200); });

  /* ---------- progress + log, used everywhere ---------- */
  function progHtml(j, x) {
    x = x || {};
    var pct = Math.max(0, Math.min(100, Number(x.pct) || 0)), cls = '', step = x.step || '', side = '';
    var age = secsAgo(x.updated), stale = false;
    if (!j) return '';
    if (j.status === 'queued') {
      cls = 'wait'; pct = 0;
      var pos = queuePos(j), run = running();
      step = !pcOnline() ? 'In the queue (' + nth(pos) + '). ' + (useName() ? label(useName()) + ' is' : 'No PC is') + ' running mri_sync.py right now, so nothing moves until you start it' + (useName() ? ' there, or pick the other PC above.' : '.')
        : run ? (pos === 1 ? 'Next in line: starts as soon as ' + (run.qtn || 'the current one') + ' is done' : nth(pos) + ' in line, after ' + (run.qtn || 'the current one') + ' and ' + (pos - 1) + ' more')
        : pos > 1 ? nth(pos) + ' in line' : 'Next: your PC picks it up within 30 seconds';
      side = run ? '' : M.d && M.d.lastCheck ? 'PC last checked in ' + agoTxt(secsAgo(M.d.lastCheck)) : '';
    } else if (j.status === 'running') {
      cls = 'live';
      if (!x.updated) step = step || 'Your PC has started';
      stale = age > 120;
      side = [x.computer, x.updated ? 'updated ' + agoTxt(age) : ''].filter(Boolean).join(' · ');
      if (stale) step = 'No news from the PC for ' + agoTxt(age).replace(' ago', '') + '. It may be waiting for a sign-in, or closed.';
      if (waitingDyn(j)) {                      // only Dynamics is running (the "Hub - RF documents" job); it reports to the request's own row
        age = secsAgo(j.updated); stale = !isNaN(age) && age > 240;
        var dm = /Dynamics (\d+)%/.exec(j.message || ''); pct = dm ? Number(dm[1]) : 2;
        step = stale ? 'No news from Dynamics for ' + agoTxt(age).replace(' ago', '') + '. Is "Hub - RF documents" running on the PC? Run Start hub jobs.bat there, then enter the RF number again.'
          : (j.message || 'Waiting for Dynamics to attach the documents').replace(/^RF \S+:?\s*-?\s*/, '');
        side = ['Dynamics', isNaN(age) ? '' : 'updated ' + agoTxt(age)].filter(Boolean).join(' · ');
        if (!pcOnline()) { stale = true; step = 'Your PC is not running the hub jobs, so Dynamics will not start. ' + (useName() ? label(useName()) + ' last checked in ' + agoTxt(secsAgo((comps().filter(function (c) { return c.name.toLowerCase() === useName().toLowerCase(); })[0] || {}).last)) + '.' : 'Run Start hub jobs.bat on the PC.'); }
      }
    } else if (j.status === 'review' || j.status === 'done' || j.status === 'sent') { cls = 'ok'; pct = 100; step = step || j.statusText; }
    else if (j.status === 'error') { cls = 'bad'; step = x.state === 'stopped' ? 'Stopped' : (step || 'Could not finish'); }
    else return '';
    return '<div class="mrl-barrow"><div class="mrl-bar ' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' +
      (cls === 'wait' ? '' : '<span class="mrl-pct">' + pct + '%</span>') + '</div>' +
      '<div class="mrl-step' + (stale ? ' stale' : '') + '">' + esc(step) + (side ? ' <span>· ' + esc(side) + '</span>' : '') + '</div>';
  }
  function lineHtml(l) {
    var c = l.lv === 'E' ? 'E' : l.lv === 'W' ? 'W' : /^-{5,}/.test(l.m) ? 'sep' : /PO ready for your review|task saved:|PO header saved/.test(l.m) ? 'ok' : '';
    return '<div' + (c ? ' class="' + c + '"' : '') + ' data-n="' + l.n + '"><i>' + esc(l.t) + '</i>' + esc(l.m) + '</div>';
  }
  // fill one [data-mrl] box: progress bar (unless data-mrl-nobar) and the log (unless data-mrl-compact)
  function fillBox(el) {
    var key = el.getAttribute('data-mrl'), j = job(key), x = M.meta[key] || {}, compact = el.hasAttribute('data-mrl-compact');
    if (!el._mrl) {
      el._mrl = { shown: 0 };
      el.innerHTML = (el.hasAttribute('data-mrl-nobar') ? '' : '<div class="mrl-prog"></div>') +
        (compact ? '' : '<div class="mrl-logbar"><button type="button" data-mrl-tog>' + (el.hasAttribute('data-mrl-closed') ? '▸ Show the PC log' : '▾ PC log') + '</button><button type="button" data-mrl-copy>Copy</button></div><div class="mrl-log"' + (el.hasAttribute('data-mrl-closed') ? ' hidden' : '') + '></div>');
    }
    var pg = el.querySelector('.mrl-prog');
    if (pg) { var h = progHtml(j, x); if (pg._h !== h) { pg.innerHTML = h; pg._h = h; } }
    var lg = el.querySelector('.mrl-log');
    if (lg) {
      var lines = M.logs[key] || [];
      if (lines.length && lines[0].n > el._mrl.shown + 1 && el._mrl.shown) { lg.innerHTML = ''; el._mrl.shown = 0; }   // the log was started again
      var add = lines.filter(function (l) { return l.n > el._mrl.shown; });
      if (add.length) {
        var nearEnd = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 40;
        lg.insertAdjacentHTML('beforeend', add.map(lineHtml).join(''));
        el._mrl.shown = add[add.length - 1].n;
        while (lg.childNodes.length > 800) lg.removeChild(lg.firstChild);
        if (nearEnd || !el._mrl.scrolled) { lg.scrollTop = lg.scrollHeight; el._mrl.scrolled = true; }
      }
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-mrl-tog],[data-mrl-copy]'); if (!t) return;
    var box = t.closest('[data-mrl]'), lg = box && box.querySelector('.mrl-log'); if (!lg) return;
    if (t.hasAttribute('data-mrl-tog')) { lg.hidden = !lg.hidden; t.textContent = lg.hidden ? '▸ Show the PC log' : '▾ PC log'; if (!lg.hidden) lg.scrollTop = lg.scrollHeight; }
    else {
      var txt = (M.logs[box.getAttribute('data-mrl')] || []).map(function (l) { return l.t + '  ' + l.m; }).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { note('Log copied'); }, function () { note('Could not copy here: select the text instead.'); });
    }
  });

  /* ---------- the top-bar chip ---------- */
  var chip = document.createElement('button');
  chip.type = 'button'; chip.id = 'mrl-chip'; chip.className = 'mrl-chip'; chip.hidden = true;
  chip.addEventListener('click', goPage);
  (function () { var tb = $('theme-btn'); if (tb && tb.parentNode) tb.parentNode.insertBefore(chip, tb); })();
  function paintChip() {
    var js = jobs(), run = js.filter(function (j) { return j.status === 'running' && !waitingDyn(j); })[0], q = js.filter(function (j) { return j.status === 'queued'; });
    var rev = js.filter(function (j) { return j.status === 'review'; }), err = js.filter(function (j) { return j.status === 'error' && !M.seen[j.key + j.updated]; });
    var cls = '', h = '', w = 0, title = '';
    if (run) {
      var x = M.meta[run.key] || {}; w = Number(x.pct) || 0;
      cls = 'running'; title = (run.qtn || '') + ': ' + (x.step || 'working');
      h = '<span class="ring"></span><span class="t"><b>MRI ' + w + '%</b>' + (q.length ? ' · +' + q.length + '<span class="long"> queued</span>' : '') + '<span class="long"> · ' + esc(x.step || 'working') + '</span></span><span class="mb" style="width:' + w + '%"></span>';
    } else if (err.length) { cls = 'error'; h = '<span class="d"></span><span class="t"><b>MRI</b> · ' + err.length + ' failed</span>'; title = 'Open MRI Work Orders to see what went wrong'; }
    else if (q.length) { cls = 'queued'; h = '<span class="d"></span><span class="t"><b>MRI</b> · ' + q.length + ' waiting<span class="long">' + (pcOnline() ? ' for your PC' : ': PC is off') + '</span></span>'; }
    else if (rev.length) { cls = 'review'; h = '<span class="d"></span><span class="t"><b>MRI</b> · ' + rev.length + '<span class="long"> to send to ERP</span></span>'; title = 'POs saved in MRI, waiting for you to press "Send Purchase Request To ERP"'; }
    chip.hidden = !cls;
    if (cls) { chip.className = 'mrl-chip ' + cls; if (chip._h !== h) { chip.innerHTML = h; chip._h = h; } chip.title = title; chip.setAttribute('aria-label', title || chip.textContent); }
    var n = rev.length + err.length + (run ? 1 : 0) + q.length;
    document.querySelectorAll('[data-tab-badge="mri"]').forEach(function (badge) { badge.textContent = n ? (run ? '●' : n) : ''; badge.hidden = !n; badge.classList.toggle('red', !!err.length); });
  }

  /* ---------- the page ---------- */
  function goPage() { var n = document.querySelector('.nav-item[data-view="mri"]'); if (n) n.click(); }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() {
      var on = n.dataset.view === 'mri';
      $('view-mri').style.display = on ? '' : 'none'; M.page = on;
      if (on) { markErrorsSeen(); kick(50); }
    }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function markErrorsSeen() { jobs().forEach(function (j) { if (j.status === 'error') M.seen[j.key + j.updated] = 1; }); store('mrl-seen-errors', M.seen); }

  var MODE = { both: 'Task + PO', task: 'Task only', po: 'PO only' };
  function cardHtml(j) {
    var title = j.blank ? (j.qtn + ' · no quote') : j.qtn;
    var tags = '<span class="mrl-tag">' + esc(MODE[j.mode] || j.mode || '') + '</span>' + (j.blank && !j.chargeable ? '<span class="mrl-tag nc">Non-chargeable</span>' : '') + (j.blank && j.contract ? '<span class="mrl-tag">' + esc(j.contract) + '</span>' : '');
    var d2 = [j.supplier, j.lines ? j.lines + ' line' + (j.lines === 1 ? '' : 's') + ' · AED ' + money(j.total) : '', j.taskId ? 'Task ' + j.taskId : '', j.poReq ? 'PO request ' + j.poReq : '', j.rfNumber ? 'RF ' + j.rfNumber : ''].filter(Boolean).join(' · ');
    var st = { running: 'Making it in MRI', queued: queuePos(j) ? 'Queue no. ' + queuePos(j) : 'Waiting for PC', review: 'Send to ERP', error: (M.meta[j.key] || {}).state === 'stopped' ? 'Stopped' : 'Failed', sent: 'Sent to ERP', done: j.rfNumber ? (j.rfDocs === 'ready' ? 'Ready to submit' : 'RF raised') : 'Task made', cancelled: 'Cancelled' }[j.status] || j.statusText;
    var h = '<div class="mrl-card st-' + esc(j.status) + '" data-key="' + esc(j.key) + '"><div class="mrl-ch"><div class="mrl-t"><b>' + esc(title) + '</b>' + tags +
      '<div class="mrl-d">' + esc(j.desc || '(no description)') + '</div>' + (d2 ? '<div class="mrl-d2">' + esc(d2) + '</div>' : '') + '</div><span class="mrl-st ' + esc(j.status) + '">' + esc(st) + '</span></div>';
    if (j.status === 'review' && !j.rfNumber) h += '<div class="mrl-msg you">PO request <b>' + esc(j.poReq) + '</b> is saved in MRI. Check it there and press <b>Send Purchase Request To ERP</b>, then tick it off here. If ERP already gave an RF (MRI > the PO > Events tab: "RF created"), type it below.</div>';
    if (j.status === 'error') h += '<div class="mrl-msg err">' + esc(j.message || 'Your PC could not finish.') + '</div>';
    var rfBox = (j.status === 'review' && !j.rfNumber) || (j.status === 'error' && j.poReq && !j.rfNumber);       // ERP failed or did not answer: type the RF, skip MRI
    if (rfBox) h += '<div class="mrl-rf"><label for="rf-' + esc(j.key) + '">RF number from ERP</label><input type="text" id="rf-' + esc(j.key) + '" data-rfin maxlength="14" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="R-000096843" aria-label="RF number"><button type="button" class="btn btn-primary btn-sm" data-mrl-act="rfgo">Run Dynamics for this RF</button></div>';
    if ((rfBox || (j.status === 'review' && j.rfNumber)) && M.d && !pcOnline()) h +='<div class="mrl-msg err">Your PC is not running the hub jobs right now, so nothing will move until you run <b>Start hub jobs.bat</b> on it.</div>';
    if (j.status === 'done' && j.rfNumber) h += '<div class="mrl-msg">' + (j.rfDocs === 'ready' ? 'RF <b>' + esc(j.rfNumber) + '</b> is in Dynamics with its documents attached. Open it there and press <b>Submit</b>.' : 'RF <b>' + esc(j.rfNumber) + '</b> was raised.') + '</div>';
    else if (j.status === 'review' && j.rfNumber) h += '<div class="mrl-msg you">RF <b>' + esc(j.rfNumber) + '</b> was raised, but Dynamics needs you: ' + esc(j.message || 'open the RF in Dynamics.') + '</div>';
    else if (j.status === 'done') h += '<div class="mrl-msg">The task is in MRI. Add its PO when you have the supplier\'s quote.</div>';
    var pics = (M.meta[j.key] || {}).pics || [];
    if (j.status === 'error' && pics.length) h += '<div class="mrl-pics">' + pics.map(function (p, i) { return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">🖼 MRI window ' + (i + 1) + '</a>'; }).join('') + '</div>';
    var live = isActive(j), showLog = live || M.open[j.key];
    if (live) h += '<div data-mrl="' + esc(j.key) + '"' + (j.status === 'queued' ? ' data-mrl-compact' : '') + '></div>';   // waiting ones: no log yet
    else if (showLog) h += '<div data-mrl="' + esc(j.key) + '" data-mrl-nobar></div>';
    var b = [];
    if (j.status === 'running') b.push('<button type="button" class="btn btn-ghost btn-sm" data-mrl-act="stop">Stop</button>');
    if (j.status === 'queued') b.push('<button type="button" class="btn btn-ghost btn-sm" data-mrl-act="cancel">Cancel</button>');
    if (j.status === 'review' && !j.rfNumber) b.push('<button type="button" class="btn btn-primary btn-sm" data-mrl-act="sent">✓ I sent it to ERP</button>');
    if (j.status === 'review' && j.rfNumber) b.push('<button type="button" class="btn btn-primary btn-sm" data-mrl-act="rfgo" data-rf="' + esc(j.rfNumber) + '">Run Dynamics again</button>');
    if (j.status === 'error') b.push('<button type="button" class="btn btn-primary btn-sm" data-mrl-act="retry">Try again</button>');
    if (j.status === 'done' && !j.rfNumber) b.push('<button type="button" class="btn btn-primary btn-sm" data-mrl-act="open">Create the PO</button>');
    b.push('<button type="button" class="btn btn-ghost btn-sm" data-mrl-act="open">' + (j.status === 'error' || j.status === 'queued' ? 'Edit' : 'Details') + '</button>');
    if (!live) b.push('<button type="button" class="btn btn-ghost btn-sm" data-mrl-act="log">' + (M.open[j.key] ? 'Hide log' : 'PC log') + '</button>');
    if (j.rfNumber && window.__vwMriTrk) h += window.__vwMriTrk(j);
    return h + '<div class="mrl-act">' + b.join('') + '</div></div>';
  }
  function group(id, title, sub, list, empty) {
    var el = $(id); if (!el) return;
    if (!list.length && !empty) { if (el._sig !== '') { el.innerHTML = ''; el._sig = ''; } return; }
    var sig = JSON.stringify(list.map(function (j) { return [j.key, j.status, j.message, queuePos(j), j.poReq, j.rfNumber, j.rfDocs, j.trackerDone, !!M.open[j.key], pcOnline(), ((M.meta[j.key] || {}).pics || []).length, (M.meta[j.key] || {}).state === 'stopped']; })) + (id === 'mrl-g-hist' ? M.showAll : '');
    if (el._sig === sig) return;
    el._sig = sig;
    var h = '<div class="mrl-gh">' + esc(title) + (list.length ? '<span class="n">' + list.length + '</span>' : '') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    if (!list.length) h += empty;
    var show = id === 'mrl-g-hist' && !M.showAll ? list.slice(0, 5) : list;
    h += show.map(cardHtml).join('');
    if (show.length < list.length) h += '<button type="button" class="mrl-more" data-mrl-act="all">Show all ' + list.length + '</button>';
    var typed = {}, focusId = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-rfin') ? document.activeElement.id : '';
    el.querySelectorAll('[data-rfin]').forEach(function (i) { if (i.value) typed[i.id] = i.value; });      // keep an RF number that is being typed
    el.innerHTML = h;
    el.querySelectorAll('[data-rfin]').forEach(function (i) { if (typed[i.id]) i.value = typed[i.id]; if (i.id === focusId) i.focus(); });
  }
  function paintPage() {
    if (!$('view-mri')) return;
    if (!M.d) {
      if (M.err && M.fails) { $('mrl-loading').style.display = 'none'; $('mrl-error').style.display = ''; $('mrl-error').textContent = 'Could not read the MRI requests: ' + M.err; }
      return;
    }
    $('mrl-loading').style.display = 'none'; $('mrl-body').style.display = '';
    $('mrl-error').style.display = M.fails ? '' : 'none';
    if (M.fails) $('mrl-error').textContent = 'Lost touch with the hub (' + M.err + '). Retrying...';
    // PC strip: which PC makes the WOs, and is it running?
    var on = pcOnline(), last = M.d.lastCheck, pcs = M.d.pcs || [], p0 = pcs.slice().sort(function (a, b) { return (b.updated || '').localeCompare(a.updated || ''); })[0];
    var warn = [];
    pcs.forEach(function (p) { (M.logs[p.key] || []).forEach(function (l) { if (l.lv === 'E' || l.lv === 'W') warn.push(l); }); });
    var busy = running(), use = useName(), who = use ? label(use) : 'Your PC';
    var cs = comps(), other = use ? cs.filter(function (c) { return c.name.toLowerCase() !== use.toLowerCase() && pcAlive(c.name); })[0] : null;
    var head = on && busy ? '<b>' + esc(who) + ' is busy</b> <span class="sub">· making ' + esc(busy.qtn) + (waiting().length ? ', ' + waiting().length + ' waiting' : '') + '</span>'
      : on ? '<b>' + esc(who) + ' is listening</b>' + (use ? '' : ' <span class="sub">· whichever PC is running takes the next request</span>')
      : use ? '<b>' + esc(who) + ' is not running mri_sync.py</b> <span class="sub">· requests wait for it' + (other ? ', or switch to ' + esc(label(other.name)) + ' below' : '') + '</span>'
      : last ? '<b>No PC is running mri_sync.py</b>' : '<b>No PC has checked in yet</b> <span class="sub">· start mri_sync.py on the PC</span>';
    var ph = '<span class="dot"></span><span class="grow">' + head + (p0 && p0.version ? ' <span class="sub">· mri_sync ' + esc(p0.version) + '</span>' : '') + '</span>' +
      (warn.length ? '<button type="button" class="btn btn-ghost btn-sm" data-mrl-act="pclog">' + (M.open._pc ? 'Hide' : 'PC messages (' + warn.length + ')') + '</button>' : '');
    if (cs.length) {
      ph += '<div class="mrl-pcs" role="radiogroup" aria-label="Which PC makes the MRI WOs"><span class="lbl">Make WOs on</span>' +
        '<button type="button" role="radio" aria-checked="' + !use + '" class="' + (!use ? 'on' : '') + '" data-pc="">Either PC</button>' +
        cs.map(function (c) {
          var sel = use && use.toLowerCase() === c.name.toLowerCase(), alive = pcAlive(c.name);
          return '<button type="button" role="radio" aria-checked="' + !!sel + '" class="' + (sel ? 'on' : '') + '" data-pc="' + esc(c.name) + '" title="' + esc(c.name) + ' · checked in ' + esc(agoTxt(secsAgo(c.last))) + '">' +
            '<i class="' + (alive ? 'up' : '') + '"></i>' + esc(c.label || c.name) + (alive ? '' : '<small>off' + (c.last ? ' · ' + esc(agoTxt(secsAgo(c.last))) : '') + '</small>') + '</button>';
        }).join('') +
        '<button type="button" class="mrl-pcren" data-mrl-act="pcnames">' + (M.open._names ? 'Done' : '✎ Names') + '</button></div>';
      if (M.open._names) ph += '<div class="mrl-pcnames">' + cs.map(function (c) {
        return '<label><span>' + esc(c.name) + '</span><input type="text" maxlength="40" data-pcname="' + esc(c.name) + '" value="' + esc(c.label) + '" placeholder="e.g. Home PC, Work laptop"></label>';
      }).join('') + '<span class="sub">Names show here and in the queue. They are saved for every device you open the hub on.</span></div>';
    }
    if (M.open._pc && p0) ph += '<div class="mrl-pclog"><div data-mrl="' + esc(p0.key) + '" data-mrl-nobar></div></div>';
    var pc = $('mrl-pc');
    pc.className = 'mrl-pc ' + (on ? 'on' : 'off');
    if (pc._h !== ph) { pc.innerHTML = ph; pc._h = ph; }
    var js = jobs();
    var now = (running() ? [running()] : []).concat(js.filter(waitingDyn), waiting());      // Dynamics-only requests run beside MRI, so they are listed too
    var others = js.filter(function (j) { return j.status !== 'cancelled'; }).length;
    group('mrl-g-now', 'Now', now.length > 1 ? 'one at a time, top to bottom' : '', now, others ? '<div class="mrl-empty slim">Nothing running right now.</div>' :
      '<div class="mrl-empty"><b>Nothing running</b>Raise a WO and your PC picks it up within 30 seconds. You can follow every step here.</div>');
    group('mrl-g-you', 'Needs you', 'POs saved in MRI, waiting for "Send Purchase Request To ERP"', js.filter(function (j) { return j.status === 'review'; }));
    group('mrl-g-fail', 'Could not finish', '', js.filter(function (j) { return j.status === 'error'; }));
    group('mrl-g-hist', 'Done', '', js.filter(function (j) { return ['sent', 'done', 'cancelled'].indexOf(j.status) > -1; }));
  }
  function paint() {
    if (M.page && !document.hidden) markErrorsSeen();     // you are looking at them on the page
    paintChip();
    if (M.page || $('mrl-body').style.display === 'none') paintPage();
    document.querySelectorAll('[data-mrl]').forEach(fillBox);
    if (window.__vwMri && window.__vwMri.queueNote) window.__vwMri.queueNote();
  }
  // keep "x s ago" fresh between answers
  setInterval(function () { if (M.d && !document.hidden) { if (M.page && !M.open._names) { $('mrl-pc')._h = null; paintPage(); } document.querySelectorAll('[data-mrl]').forEach(fillBox); } }, 5000);

  /* ---------- buttons ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-mrl-act]'); if (!a) return;
    var act = a.getAttribute('data-mrl-act'), card = a.closest('[data-key]'), key = card && card.getAttribute('data-key'), j = key && job(key);
    if (act === 'all') { M.showAll = true; paintPage(); return; }
    if (act === 'pcnames') {
      if (M.open._names) {                        // Done: save the names that changed
        var saves = [];
        document.querySelectorAll('[data-pcname]').forEach(function (inp) {
          var n = inp.getAttribute('data-pcname'), c = comps().filter(function (x) { return x.name === n; })[0];
          if (c && (c.label || '') !== inp.value.trim()) { c.label = inp.value.trim(); saves.push(call('mriNamePc', n, inp.value.trim())); }
        });
        if (saves.length) Promise.all(saves).then(function () { note('Names saved'); kick(100); }, function (er) { note(er.message); });
      }
      M.open._names = !M.open._names; $('mrl-pc')._h = null; paintPage(); return;
    }
    if (act === 'pclog') { M.open._pc = !M.open._pc; $('mrl-pc')._h = null; paintPage(); document.querySelectorAll('[data-mrl]').forEach(fillBox); return; }
    if (!j) return;
    if (act === 'open') { if (window.__vwMri) window.__vwMri.open(j.qtn); return; }
    if (act === 'log') { M.open[key] = !M.open[key]; if (M.open[key] && !M.logs[key]) M.have[key] = 0; paintPage(); document.querySelectorAll('[data-mrl]').forEach(fillBox); if (M.open[key]) kick(50); return; }
    if ((act === 'stop' || act === 'cancel') && !a.classList.contains('confirm')) {
      a.classList.add('confirm'); a.textContent = act === 'stop' ? 'Tap again to stop' : 'Tap again to cancel';
      setTimeout(function () { if (a.isConnected) { a.classList.remove('confirm'); a.textContent = act === 'stop' ? 'Stop' : 'Cancel'; } }, 4000);
      return;
    }
    if (act === 'rfgo') {                            // RF known (typed from ERP's answer, or the one already on the request): Dynamics only
      var inp = card && card.querySelector('[data-rfin]'), rf = ((inp ? inp.value : a.getAttribute('data-rf')) || '').replace(/\s+/g, '').toUpperCase();
      if (!/^R-?\d{9}$/.test(rf)) { note('Type the RF number like R-000096843 (R and 9 digits).'); if (inp) inp.focus(); return; }
      a.disabled = true;
      call('mriSetRf', key, rf).then(function (r) {
        note(r && r.already ? 'RF ' + r.rf + ' is already waiting for Dynamics' : 'RF ' + (r && r.rf || rf) + ' sent to Dynamics on your PC. Nothing is submitted.');
        kick(100); setTimeout(function () { kick(100); }, 3000);
      }).catch(function (er) { a.disabled = false; note(er.message); });
      return;
    }
    a.disabled = true;
    call('mriSet', key, act).then(function () {
      note({ stop: 'Stopping: your PC drops it at its next step', cancel: 'Cancelled', sent: 'Marked as sent to ERP', retry: 'Sent to your PC again' }[act] || 'Done');
      kick(100);
    }).catch(function (er) { a.disabled = false; note(er.message); });
  });

  document.addEventListener('keydown', function (e) {          // Enter in the RF box = the button next to it
    if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-rfin')) return;
    var b = e.target.parentNode && e.target.parentNode.querySelector('[data-mrl-act="rfgo"]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
  });

  // choosing the PC that makes the WOs
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#mrl-pc [data-pc]'); if (!b || !M.d) return;
    var name = b.getAttribute('data-pc'), was = useName();
    if (name.toLowerCase() === was.toLowerCase()) return;
    var run = running();
    M.d.use = name; $('mrl-pc')._h = null; paintPage();
    call('mriUsePc', name).then(function () {
      note((name ? 'MRI WOs now go to ' + label(name) : 'MRI WOs go to whichever PC is running') + (run ? '. The one running now finishes where it is.' : '.'));
      kick(200);
    }).catch(function (er) { M.d.use = was; $('mrl-pc')._h = null; paintPage(); note(er.message); });
  });

  /* ---------- "Raise MRI WO": pick a quote, or none ---------- */
  function works() { return (typeof ST !== 'undefined' && ST.works) ? ST.works : []; }
  function openPicker() {
    var back = document.createElement('div'); back.className = 'mrl-pick-back';
    back.innerHTML = '<div class="mrl-pick" role="dialog" aria-modal="true" aria-label="Raise MRI WO"><div class="mrl-pick-h"><b>Raise MRI WO</b><button type="button" aria-label="Close" data-x>&times;</button></div>' +
      '<button type="button" class="mrl-blank" data-blank><span class="ic">📝</span><span><b>Without a quote</b>Any contract, chargeable or non-chargeable. You fill in everything.</span></button>' +
      '<input type="search" placeholder="Or find the quote: number, CRM, building, work..." aria-label="Find the quote" autocomplete="off">' +
      '<div class="mrl-pick-l"></div></div>';
    document.body.appendChild(back); document.body.style.overflow = 'hidden';
    var inp = back.querySelector('input'), list = back.querySelector('.mrl-pick-l');
    function close() { back.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    var byQ = {}; jobs().forEach(function (j) { if (!byQ[j.qtn] && j.status !== 'cancelled') byQ[j.qtn] = j; });
    function draw() {
      var q = inp.value.trim().toLowerCase(), ws = works().filter(function (w) { return w.statusKey !== 'cancelled' && w.approvedKey === 'yes'; });
      if (q) ws = ws.filter(function (w) { return [w.qtn, w.crm, w.desc, w.building, w.apt].join(' ').toLowerCase().indexOf(q) > -1; });
      ws.sort(function (a, b) { return ((byQ[a.qtn] ? 1 : 0) - (byQ[b.qtn] ? 1 : 0)) || String(b.qtn).localeCompare(String(a.qtn)); });
      var h = ws.slice(0, 80).map(function (w) {
        var j = byQ[w.qtn];
        return '<button type="button" data-q="' + esc(w.qtn) + '"><span class="s' + (j ? ' on' : '') + '">' + (j ? esc(j.statusText) : 'not in MRI yet') + '</span><b>' + esc(w.qtn) + '</b>' + (w.crm ? 'CRM ' + esc(w.crm) : '') +
          '<span class="x">' + esc(w.desc) + ' · ' + esc(w.building) + '</span></button>';
      }).join('');
      list.innerHTML = h || '<div class="none">' + (works().length ? 'No approved work matches.' : 'The works are still loading. Try again in a moment, or raise one without a quote.') + '</div>';
    }
    draw();
    inp.addEventListener('input', draw);
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-x]')) { close(); return; }
      if (e.target.closest('[data-blank]')) { close(); if (window.__vwMri) window.__vwMri.openBlank(); return; }
      var b = e.target.closest('[data-q]'); if (b) { close(); if (window.__vwMri) window.__vwMri.open(b.getAttribute('data-q')); }
    });
    if (window.innerWidth > 700) inp.focus();
  }
  if ($('mrl-raise')) $('mrl-raise').addEventListener('click', openPicker);
  window.__vwMriPick = openPicker;                        // v37: "Raise MRI WO" on Job Desk

  window.__vwMriLive = { label: label, useName: useName, pcAlive: pcAlive, queueInfo: queueInfo, nth: nth, kick: kick, poll: poll, fill: function () { document.querySelectorAll('[data-mrl]').forEach(fillBox); }, openPicker: openPicker, goPage: goPage, job: job };
  setTimeout(poll, 2500);
})();
