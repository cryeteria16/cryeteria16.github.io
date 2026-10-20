/* ---------------- ADDED: Job Journeys page + the journey in each work's side panel ----------------
   Uses only public things of the page above (ST, DASH, toast, openDrawer, loadDashboard) and the server file Journey.gs. */
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
  function dShort(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + (m[1] !== String(new Date().getFullYear()) ? ' ' + m[1] : '') : ''; }
  function dd(n) { return n === null || n === undefined ? '' : n + (n === 1 ? ' day' : ' days'); }
  var WHO = { you: 'you', manager: 'the manager', procurement: 'procurement', vendor: 'the vendor', WASL: 'WASL', other: 'someone else', grn: 'you' };

  var J = { data: null, at: 0, loading: null, byQtn: {}, stop: -1, holdOnly: false, q: '', sort: 'late', limit: 60 };
  try { var ss = localStorage.getItem('vwJxSort'); if (ss) J.sort = ss; } catch (e) {}

  function fetchData(force) {
    if (J.loading) return J.loading;
    J.loading = call('journeyGet', !!force).then(function (d) {
      J.data = d; J.at = Date.now(); J.byQtn = {};
      d.jobs.forEach(function (j) { J.byQtn[j.qtn] = j; });
      J.loading = null; return d;
    }, function (e) { J.loading = null; throw e; });
    return J.loading;
  }
  window.__vwJourney = { get: function (qtn) { return J.byQtn[qtn] || null; }, refresh: function () { return fetchData(true); } };

  function openWork(id) {
    id = Number(id); if (!id) return;
    if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
    note('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
  }
  function openProc(rf) {
    if (window.__vwDesk && window.__vwDesk.openRf) { window.__vwDesk.openRf(rf); return; }      // v37: the job popup's Dynamics part
    var n = document.querySelector('.nav-item[data-view="proc"]'); if (n) n.click();
    if (typeof closeDrawer === 'function') { try { closeDrawer(); } catch (e) {} }
    setTimeout(function () { var q = $('pq-q'); if (q) { q.value = rf || ''; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 800);
  }

  function mini(j) {
    var h = '', n = j.stops.length;
    j.stops.forEach(function (s, i) {
      var cls = s.s === 'c' ? 'c ' + j.sev : s.s;
      h += '<span class="s ' + cls + '" title="' + esc(J.data.stops[i].name) + '"></span>';
      if (i < n - 1) h += '<span class="l' + (s.s === 'd' && (j.stops[i + 1].s === 'd' || j.stops[i + 1].s === 'c' || j.stops[i + 1].s === 'n') ? ' d' : '') + '"></span>';
    });
    return '<div class="jx-mini">' + h + '</div>';
  }
  function chip(j) {
    var stop = J.data.stops[j.cur].name;
    if (j.hold) return '<span class="jx-chip hold">On hold at ' + esc(stop) + '</span>';
    return '<span class="jx-chip ' + (j.sev === 'late' ? 'late' : '') + '">' + (j.sev === 'late' ? 'Stuck at ' : 'At ') + esc(stop) + (j.days !== null && j.days !== undefined ? ' · ' + dd(j.days) : '') + '</span>';
  }

  /* ---------- page ---------- */
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'journey'; $('view-journey').style.display = on ? '' : 'none'; if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function opened() { $('jx-sort').value = J.sort; if (!J.data || Date.now() - J.at > 60000) load(false); else render(); }
  function load(force) {
    if (!J.data) { $('jx-loading').style.display = ''; $('jx-body').style.display = 'none'; }
    $('jx-error').style.display = 'none';
    fetchData(force).then(function () {
      $('jx-loading').style.display = 'none'; $('jx-body').style.display = '';
      render(); if (force) note('Refreshed');
      document.dispatchEvent(new Event('vw-journey-loaded'));
    }).catch(function (e) {
      $('jx-loading').style.display = 'none';
      $('jx-error').textContent = 'Could not trace the jobs: ' + e.message; $('jx-error').style.display = '';
    });
  }

  function render() {
    var d = J.data; if (!d) return;
    $('jx-sub').textContent = d.open + ' open jobs, ' + d.lateJobs + ' waiting longer than normal' + (d.hold ? ', ' + d.hold + ' on hold' : '') + '.' + (d.hasD365 ? '' : ' D365 data is missing, so RF / PR / PO come from the tracker only.');
    var mx = Math.max.apply(null, d.counts.concat([1])), worst = -1, wv = 0;
    d.late.forEach(function (v, i) { if (v > wv) { wv = v; worst = i; } });
    var bars = '';
    d.stops.forEach(function (s, i) {
      var c = d.counts[i], l = d.late[i];
      bars += '<button type="button" class="jx-bar' + (i === worst ? ' hot' : '') + (J.stop === i ? ' on' : '') + '" data-i="' + i + '" title="' + esc(s.name + ': ' + c + ' jobs here, ' + l + ' longer than normal' + (s.usual !== null ? ' · usually takes ' + dd(s.usual) : '')) + '">' +
        '<b>' + c + '</b><div class="jx-col" style="height:' + Math.max(3, c / mx * 100) + '%"><i style="height:' + (c ? l / c * 100 : 0) + '%"></i></div><span>' + esc(s.name) + '</span></button>';
    });
    if (d.hold) bars = bars;   // on hold is offered as a filter link below
    $('jx-bars').innerHTML = bars;

    var list = d.jobs.filter(function (j) { return !j.closed; });
    if (J.holdOnly) list = list.filter(function (j) { return j.hold; });
    else if (J.stop > -1) list = list.filter(function (j) { return j.cur === J.stop && !j.hold; });
    if (J.q) list = list.filter(function (j) { return (j.qtn + ' ' + j.crm + ' ' + j.desc + ' ' + j.building + ' ' + j.apt + ' ' + j.rf).toLowerCase().indexOf(J.q) > -1; });
    var rank = { late: 0, now: 1, hold: 2 };
    list.sort(function (a, b) {
      if (J.sort === 'stuck') return (b.days || -1) - (a.days || -1);
      if (J.sort === 'new') return a.qtn < b.qtn ? 1 : -1;
      if (J.sort === 'bld') return (a.building || '~').localeCompare(b.building || '~') || (rank[a.sev] - rank[b.sev]);
      return (rank[a.sev] - rank[b.sev]) || ((b.days || -1) - (a.days || -1));
    });
    $('jx-count').textContent = list.length + (list.length === 1 ? ' job' : ' jobs');
    var f = $('jx-filter');
    if (J.stop > -1 || J.holdOnly) { f.innerHTML = 'Showing jobs ' + (J.holdOnly ? 'on hold' : 'at <b>' + esc(d.stops[J.stop].name) + '</b>') + ' <button type="button" class="btn btn-ghost btn-sm" data-a="clear">Show all</button>'; f.style.display = ''; }
    else if (d.hold) { f.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-a="hold">Show the ' + d.hold + ' on hold</button>'; f.style.display = ''; }
    else f.style.display = 'none';

    var h = '';
    list.slice(0, J.limit).forEach(function (j) {
      h += '<div class="jx-row" data-id="' + j.id + '" tabindex="0"><div class="jx-t"><b>' + esc(j.qtn) + (j.crm ? ' · CRM ' + esc(j.crm) : '') + '</b><div>' + esc([j.desc, j.building, j.apt].filter(Boolean).join(' · ')) + '</div></div>' + mini(j) + chip(j) + '</div>';
    });
    if (!list.length) h = '<div class="jx-empty">No jobs match.</div>';
    if (list.length > J.limit) h += '<div style="padding:10px 6px"><button type="button" class="btn btn-ghost btn-sm" data-a="more">Show all ' + list.length + '</button></div>';
    $('jx-list').innerHTML = h;
  }

  $('jx-bars').addEventListener('click', function (e) {
    var b = e.target.closest('.jx-bar'); if (!b) return;
    var i = Number(b.dataset.i); J.holdOnly = false; J.stop = J.stop === i ? -1 : i; J.limit = 60; render();
  });
  $('jx-body').addEventListener('click', function (e) {
    var a = e.target.closest('[data-a]');
    if (a) { if (a.dataset.a === 'clear') { J.stop = -1; J.holdOnly = false; } else if (a.dataset.a === 'hold') { J.holdOnly = true; J.stop = -1; } else if (a.dataset.a === 'more') J.limit = 100000; render(); return; }
    var r = e.target.closest('.jx-row'); if (r) openWork(r.dataset.id);
  });
  $('jx-list').addEventListener('keydown', function (e) { var r = e.target.closest('.jx-row'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openWork(r.dataset.id); } });
  $('jx-q').addEventListener('input', function () { J.q = this.value.trim().toLowerCase(); J.limit = 60; render(); });
  $('jx-sort').addEventListener('change', function () { J.sort = this.value; try { localStorage.setItem('vwJxSort', J.sort); } catch (e) {} render(); });
  $('jx-refresh').addEventListener('click', function () { load(true); });

  /* ---------- the journey inside a work's side panel ---------- */
  function boxHtml(j) {
    var d = J.data, done = 0, total = 0, slow = null;
    j.stops.forEach(function (s, i) {
      if (s.s !== 'n') total++;
      if (s.s === 'd') done++;
      if (s.took !== null && s.took !== undefined && (!slow || s.took > slow.t)) slow = { t: s.took, n: d.stops[i].name };
    });
    if (j.cur > -1 && j.days !== null && (!slow || j.days > slow.t)) slow = { t: j.days, n: d.stops[j.cur].name, now: true };
    var sum = '<div class="jx-sum"><div><b>' + done + '</b>of ' + total + ' stops done</div>' +
      (slow ? '<div><b>' + slow.t + 'd</b>' + (slow.now ? 'at ' : 'for ') + esc(slow.n) + ' (slowest)</div>' : '') +
      (j.closed ? '<div><b>✓</b>finished</div>' : (j.left !== null && j.left !== undefined ? '<div><b>~' + j.left + 'd</b>usually left</div>' : '')) + '</div>';
    var h = '';
    j.stops.forEach(function (s, i) {
      var cls = s.s + (s.s === 'c' ? ' ' + j.sev : ''), name = d.stops[i].name;
      var sub = s.s === 'n' ? 'Not needed' : (s.ref || '');
      if (s.s === 'c') sub = '';
      h += '<div class="jx-st ' + cls + '"><span class="jx-dot">' + (s.s === 'd' ? '✓' : '') + '</span><div><div class="nm">' + esc(name) + (s.took !== null && s.took !== undefined ? ' <span class="gap">· took ' + dd(s.took) + '</span>' : '') + '</div>' + (sub ? '<div class="sb">' + esc(sub) + '</div>' : '');
      if (s.s === 'c') {
        var line = j.days !== null && j.days !== undefined ? 'Here for ' + dd(j.days) + (j.normal ? ' (normal: ' + j.normal + ')' : '') + '. ' : '';
        h += '<div class="jx-here">' + esc(line + j.note + (j.who && !j.hold ? '. Waiting on ' + (WHO[j.who] || j.who) + '.' : '')).replace(/\.\./g, '.') + '</div>';
        if (j.rf && ['rf', 'pr', 'po', 'inv'].indexOf(s.k) > -1) h += '<div class="jx-btns"><button type="button" class="btn btn-ghost btn-sm" data-jx="proc" data-rf="' + esc(j.rf) + '">D365 steps</button></div>';
      }
      h += '</div><div class="dt">' + esc(dShort(s.date)) + '</div></div>';
    });
    return '<div class="jx-h" style="margin-bottom:2px">Job journey <small>' + (j.age !== null ? dd(j.age) + ' since the quote' : '') + '</small></div>' + sum + '<div class="jx-v">' + h + '</div>';
  }
  function mount() {
    var body = $('drawer-body'); if (!body || $('jx-sec')) return;
    var qtn = ($('dh-ref').textContent || '').trim(); if (!qtn) return;
    var sec = document.createElement('div'); sec.className = 'd-sec'; sec.id = 'jx-sec'; sec.dataset.qtn = qtn;
    body.insertBefore(sec, body.firstChild);
    function draw() {
      if (sec.dataset.qtn !== ($('dh-ref').textContent || '').trim()) return;
      var j = J.byQtn[qtn];
      if (j) sec.innerHTML = boxHtml(j);
      else if (J.data) sec.style.display = 'none';
    }
    if (J.data && Date.now() - J.at < 300000) draw();
    else { sec.innerHTML = '<div class="jx-h">Job journey <small>tracing...</small></div>'; fetchData(false).then(draw).catch(function () { sec.style.display = 'none'; }); }
  }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () { if (!$('jx-sec')) mount(); }).observe($('drawer-body'), { childList: true });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-jx="proc"]'); if (b) openProc(b.dataset.rf);
  });
})();
