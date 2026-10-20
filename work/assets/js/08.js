/* ---------------- Procurement (D365) page ---------------- */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dLabel(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  var GC = { you: '#E31837', manager: '#2563EB', procurement: '#7C3AED', vendor: '#D97706', grn: '#0F766E', done: '#16A34A', other: '#94A3B8' };
  var LIST_NAME = { RF: 'Request form lines', PR: 'Purchase requisitions', PO: 'Purchase orders' };

  var P = { data: null, who: '', stage: '', check: '', late: false, hideDone: true, q: '', sort: { k: 'days', d: -1 }, shown: 100, open: {}, loading: false };
  var LIMIT = {}, STAGE = {};

  /* ---- show/hide like the other added pages (the existing showView() hides everything else) ---- */
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { $('view-proc').style.display = n.dataset.view === 'proc' ? '' : 'none'; if (n.dataset.view === 'proc' && !P.data && !P.loading) load(false); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });

  function load(force) {
    P.loading = true;
    $('pq-error').style.display = 'none';
    if (!P.data) $('pq-loading').style.display = '';
    $('pq-refresh').disabled = true; $('pq-refresh').textContent = '↻ Refreshing...';
    google.script.run
      .withSuccessHandler(function (d) {
        P.loading = false; P.data = d;
        if (force) { TV.done = {}; try { sessionStorage.removeItem('tvDone'); } catch (e) {} }   // v28: a fresh read shows what is still missing
        LIMIT = {}; STAGE = {};
        (d.stages || []).forEach(function (s, i) { LIMIT[s.k] = s.limit; STAGE[s.k] = s; });
        $('pq-loading').style.display = 'none';
        $('pq-refresh').disabled = false; $('pq-refresh').textContent = '↻ Refresh';
        render();
        document.dispatchEvent(new CustomEvent('vw-d365-loaded', { detail: { generatedISO: d.generatedISO } }));
        if (force) toast('Procurement refreshed');
      })
      .withFailureHandler(function (e) {
        P.loading = false;
        $('pq-loading').style.display = 'none';
        $('pq-refresh').disabled = false; $('pq-refresh').textContent = '↻ Refresh';
        $('pq-error').style.display = ''; $('pq-error').textContent = 'Could not load the D365 data: ' + (e && e.message || e);
        document.dispatchEvent(new CustomEvent('vw-d365-failed'));
      })
      .d365GetDashboard(!!force);
  }
  window.vwProcReload = function () { if (!P.loading) load(true); };
  $('pq-refresh').addEventListener('click', function () { load(true); });

  /* ---- rendering ---- */
  function render() {
    var d = P.data;
    var empty = !d.rfs.length && d.missing.indexOf('RF') > -1;
    $('pq-empty').style.display = empty ? '' : 'none';
    $('pq-body').style.display = empty ? 'none' : '';
    $('pq-csv').disabled = empty;
    $('pq-sub').textContent = 'Every RF from request to invoice, and who it is waiting on. D365 lists and tracker read ' + d.generatedAt + '.';
    if (empty) return;
    renderFresh(); renderTv(); renderWho(); renderCheck(); renderTable(); rqDraw(); rqPoll(0);
    $('pq-foot').textContent = 'Waiting = days at the current step (from the D365 history once a change has been seen, otherwise from the RF date). ' +
      'A step turns red after its limit: RF/PR approvals 3 days, PO 5, vendor 30. "Invoiced" means the GRN was released. RF value = sum of the RF lines.';
  }

  function renderFresh() {
    var f = P.data.fresh || {};
    $('pq-fresh').innerHTML = ['RF', 'PR', 'PO'].map(function (k) {
      var x = f[k] || {}, none = !x.display, cls = none ? ' none' : (x.stale ? ' stale' : '');
      var mt = none ? 'Not loaded yet' : x.display + ' · ' + money(x.rows) + ' rows · ' + esc(x.source);
      return '<div class="pq-file' + cls + '"><div class="ic">' + (none ? '!' : x.stale ? '⏱' : '✓') + '</div><div style="min-width:0;"><div class="nm">' +
        LIST_NAME[k] + '</div><div class="mt">' + mt + (x.stale && !none ? ' · out of date' : '') + '</div></div></div>';
    }).join('');
  }

  function ageClass(r) {
    var lim = LIMIT[r.stage];
    if (r.days === null || r.days === undefined || !lim) return 'age-ok';
    return r.days > lim ? 'age-bad' : r.days >= Math.ceil(lim * 0.7) ? 'age-warn' : 'age-ok';
  }

  function renderWho() {
    var d = P.data;
    $('pq-who').innerHTML = d.who.map(function (w) {
      var mine = d.rfs.filter(function (r) { return r.who === w.k; });
      if (!mine.length && (w.k === 'other' || w.k === 'grn')) return '';
      var late = mine.filter(function (r) { return r.over; }).length;
      var steps = d.stages.filter(function (s) { return s.who === w.k; }).map(function (s) {
        var rs = mine.filter(function (r) { return r.stage === s.k; });
        var oldest = rs.reduce(function (m, r) { return r.days !== null && r.days > m ? r.days : m; }, -1);
        var val = rs.reduce(function (a, r) { return a + (r.amount || 0); }, 0);
        var ac = oldest < 0 ? '' : '<span class="age ' + ageClass({ stage: s.k, days: oldest }) + ' sa">oldest ' + oldest + ' d</span>';
        return '<button type="button" class="pq-step' + (rs.length ? '' : ' zero') + (P.stage === s.k ? ' on' : '') + '" data-stage="' + s.k + '"' + (rs.length ? '' : ' disabled') + '>' +
          '<span class="sn">' + esc(s.name) + '</span><span class="sc">' + rs.length + '</span>' +
          '<span class="sv">' + (rs.length ? 'AED ' + money(val) : '-') + '</span>' + (ac || '<span></span>') + '</button>';
      }).join('');
      return '<div class="pq-grp" style="--gc:' + GC[w.k] + '"><div class="pq-ghead"><span>' + esc(w.name) + '</span><b>' + mine.length + '</b></div>' +
        '<div class="pq-gval">AED ' + money(mine.reduce(function (a, r) { return a + (r.amount || 0); }, 0)) + (late ? ' · <b style="color:var(--danger)">' + late + ' late</b>' : '') + '</div>' + steps + '</div>';
    }).join('');
  }

  /* ---- v28: Keep the tracker up to date (VW_Tracker vs Dynamics) ---- */
  var TV = { tab: 'fix', done: {}, more: 0 };
  try { TV.done = JSON.parse(sessionStorage.getItem('tvDone') || '{}') || {}; } catch (e) { TV.done = {}; }
  function tvKey(id, fx) { return id + '|' + fx.f + '|' + fx.value; }
  function tvData() {
    var d = P.data, byWork = {}, order = [], miss = [], ok = {};
    d.rfs.forEach(function (r) {
      if (/cancel/i.test(r.status || '')) return;
      if (!r.trackerId) { if (r.stage !== 'closed') miss.push(r); return; }
      var fx = (r.fixes || []).filter(function (f) { return !TV.done[tvKey(r.trackerId, f)]; });
      if (!fx.length) { if (!byWork[r.trackerId]) ok[r.trackerId] = r; return; }
      delete ok[r.trackerId];
      var w = byWork[r.trackerId];
      if (!w) { w = byWork[r.trackerId] = { id: r.trackerId, qtn: r.qtn, desc: r.desc, building: r.building, crm: r.crm, rfs: [], fixes: [] }; order.push(w); }
      w.rfs.push(r.rf);
      fx.forEach(function (f) { if (!w.fixes.some(function (g) { return g.f === f.f && g.value === f.value; })) w.fixes.push(f); });
    });
    var health = (d.health || []).map(function (h) {
      var is = h.issues.filter(function (i) { return !TV.done[h.id + '|h|' + i.f + '|' + i.why]; });
      return is.length ? { id: h.id, qtn: h.qtn, desc: h.desc, building: h.building, issues: is } : null;
    }).filter(Boolean);
    return { fix: order, miss: miss, wait: d.trackerOnly || [], health: health, ok: Object.keys(ok).map(function (k) { return ok[k]; }) };
  }
  function tvLink(id, f) {
    var t = P.data.tracker; if (!t || !t.url) return '';
    return t.url + '&range=' + ((t.cols && t.cols[f]) || (t.cols && t.cols.qtn) || 'A') + id;
  }
  function tvVal(f, v) { return /Date$/.test(f) ? dLabel(v) || v : v; }
  function renderTv() {
    var box = $('tv-list'); if (!box || !P.data) return;
    var x = tvData(), n = { fix: x.fix.reduce(function (a, w) { return a + w.fixes.length; }, 0), miss: x.miss.length, wait: x.wait.length,
                            health: x.health.reduce(function (a, w) { return a + w.issues.length; }, 0), ok: x.ok.length };
    var tabs = [['fix', 'Update tracker', 'bad'], ['miss', 'Missing from tracker', 'bad'], ['wait', 'Not in Dynamics yet', ''], ['health', 'Tracker health', 'bad'], ['ok', 'Up to date', 'ok']];
    $('tv-tabs').innerHTML = tabs.map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (TV.tab === t[0]) + '" class="tv-tab ' + (n[t[0]] ? t[2] : '') + (TV.tab === t[0] ? ' on' : '') + '" data-tv="' + t[0] + '">' + esc(t[1]) + ' <b>' + n[t[0]] + '</b></button>';
    }).join('');
    var h = '';
    if (TV.tab === 'fix') {
      h = x.fix.length ? x.fix.map(function (w) {
        return '<div class="tv-it"><div class="tv-h"><div><b>' + esc(w.qtn || 'Row ' + w.id) + '</b><span>' + esc([w.desc, w.building].filter(Boolean).join(' · ')) + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-work="' + w.id + '">Open work</button></div>' +
          w.fixes.map(function (f) {
            var link = tvLink(w.id, f.f);
            return '<div class="tv-fx' + (f.hint ? ' hint' : '') + '"><div class="tv-c">' + esc(f.col) + (f.hint ? ' <span class="tv-tag">check</span>' : '') + '</div>' +
              '<div class="tv-v">' + (f.value ? esc(tvVal(f.f, f.value)) : '<span class="tv-none">' + (f.hint ? 'Your call' : 'Type it in') + '</span>') + '</div>' +
              '<div class="tv-w">' + esc(f.why) + (f.have && !f.hint ? ' · now: ' + esc(f.have) : '') + '</div>' +
              '<div class="tv-b">' + (f.value ? '<button type="button" class="btn btn-primary btn-sm" data-tvcopy="' + esc(f.value) + '">Copy</button>' : '') +
              (link ? '<a class="btn btn-ghost btn-sm" href="' + esc(link) + '" target="_blank" rel="noopener">Open in tracker</a>' : '') +
              '<button type="button" class="btn btn-ghost btn-sm" data-tvdone="' + esc(tvKey(w.id, f)) + '" title="Hide this until the tracker is read again">✓ Done</button></div></div>';
          }).join('') + '</div>';
      }).join('') : '<div class="tv-empty">✓ Nothing to update: every RF, PR and PO number in Dynamics is in the tracker.</div>';
    } else if (TV.tab === 'miss') {
      h = x.miss.length ? '<div class="tv-note">Dynamics has these RFs, but no tracker work has their RF, CRM, PR or PO number. Find the work and add the RF number to it.</div>' + x.miss.map(function (r) {
        var refs = [r.prs.map(function (p) { return p.n; }).join(', '), r.pos.map(function (p) { return p.n; }).join(', ')].filter(Boolean).join(' · ');
        return '<div class="tv-it"><div class="tv-h"><div><b class="tv-mono">' + esc(r.rf) + '</b><span>' + esc([r.desc || r.cats, r.crm ? 'CRM ' + r.crm : '', refs, r.stageName].filter(Boolean).join(' · ')) + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-tvcopy="' + esc(r.rf) + '">Copy RF</button></div></div>';
      }).join('') : '<div class="tv-empty">✓ Every RF in Dynamics belongs to a tracker work.</div>';
    } else if (TV.tab === 'health') {
      var list = x.health.slice(0, 40 + TV.more);
      h = x.health.length ? '<div class="tv-note">Gaps and typos inside the tracker itself. Cancelled works are left out.</div>' + list.map(function (w) {
        return '<div class="tv-it"><div class="tv-h"><div><b>' + esc(w.qtn || 'Row ' + w.id) + '</b><span>' + esc(['Row ' + w.id, w.desc, w.building].filter(Boolean).join(' · ')) + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-work="' + w.id + '">Open work</button></div>' +
          w.issues.map(function (i) {
            var link = tvLink(w.id, i.f);
            return '<div class="tv-fx"><div class="tv-c">' + esc(i.col) + '</div><div class="tv-v"><span class="tv-none">Fix in the tracker</span></div><div class="tv-w">' + esc(i.why) + '</div>' +
              '<div class="tv-b">' + (link ? '<a class="btn btn-ghost btn-sm" href="' + esc(link) + '" target="_blank" rel="noopener">Open in tracker</a>' : '') +
              '<button type="button" class="btn btn-ghost btn-sm" data-tvdone="' + esc(w.id + '|h|' + i.f + '|' + i.why) + '" title="Hide this until the tracker is read again">✓ Done</button></div></div>';
          }).join('') + '</div>';
      }).join('') + (x.health.length > list.length ? '<button type="button" class="btn btn-ghost btn-sm tv-more" data-tvmore="1">Show more (' + (x.health.length - list.length) + ' left)</button>' : '')
        : '<div class="tv-empty">✓ No gaps or typos found in the tracker.</div>';
    } else if (TV.tab === 'wait') {
      h = x.wait.length ? '<div class="tv-note">The tracker has an RF number that is not in the Dynamics export yet: an RF raised today (it comes in tonight), or a typo in the tracker.</div>' + x.wait.map(function (w) {
        return '<div class="tv-it"><div class="tv-h"><div><b>' + esc(w.qtn) + '</b><span>' + esc([w.rf, w.desc, w.building].filter(Boolean).join(' · ')) + '</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-work="' + w.id + '">Open work</button></div></div>';
      }).join('') : '<div class="tv-empty">None.</div>';
    } else {
      h = x.ok.length ? '<div class="tv-note">Tracker and Dynamics agree on these works.</div><div class="tv-oks">' + x.ok.map(function (r) {
        return '<button type="button" class="tv-ok" data-work="' + r.trackerId + '"><b>' + esc(r.qtn || r.rf) + '</b> ' + esc(r.rf) + '</button>';
      }).join('') + '</div>' : '<div class="tv-empty">None yet.</div>';
    }
    box.innerHTML = h;
  }
  function tvCopy(text, btn) {
    var ok = function () { var t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = t; }, 1400); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var done = false; try { done = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); if (done) ok(); else toast('Copy did not work here: ' + text);
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, fallback); return; } } catch (e) {}
    fallback();
  }
  $('tv-card').addEventListener('click', function (e) {
    var t = e.target.closest('[data-tv]'); if (t) { TV.tab = t.dataset.tv; TV.more = 0; renderTv(); return; }
    if (e.target.closest('[data-tvmore]')) { TV.more += 40; renderTv(); return; }
    var c = e.target.closest('[data-tvcopy]'); if (c) { tvCopy(c.dataset.tvcopy, c); return; }
    var dn = e.target.closest('[data-tvdone]');
    if (dn) { TV.done[dn.dataset.tvdone] = 1; try { sessionStorage.setItem('tvDone', JSON.stringify(TV.done)); } catch (er) {} renderTv(); return; }
    var w = e.target.closest('[data-work]'); if (w) openWork(w.dataset.work);
  });

  function isNotFound(r) { return r.flags.some(function (f) { return f.indexOf('Not found') === 0; }); }
  function isMismatch(r) { return r.flags.some(function (f) { return f.indexOf('Not found') !== 0; }); }
  function renderCheck() {
    if (!$('pq-check')) return;                              // v28: replaced by the "Keep the tracker up to date" card
    var d = P.data, act = d.rfs.filter(function (r) { return r.stage !== 'closed'; });
    var nf = act.filter(isNotFound).length, mm = act.filter(isMismatch).length, ok = act.filter(function (r) { return r.trackerId && !r.flags.length; }).length;
    var box = function (k, n, label, tone) { return '<button type="button" class="pq-cbox ' + tone + (P.check === k ? ' on' : '') + '" data-check="' + k + '"><b>' + n + '</b><span>' + label + '</span></button>'; };
    var h = box('ok', ok, 'RFs that match the tracker', 'ok') +
            box('mismatch', mm, 'RFs where tracker and D365 disagree (RF, PR or PO number)', mm ? 'bad' : 'ok') +
            box('notfound', nf, 'RFs not found in the tracker (no RF number, CRM, PR or PO match)', nf ? 'bad' : 'ok') +
            box('trackeronly', d.trackerOnly.length, 'Tracker works whose RF is not in the D365 export', d.trackerOnly.length ? 'bad' : 'ok');
    if (P.check === 'trackeronly') {
      h += '<div style="grid-column:1/-1;">' + (d.trackerOnly.length ? '<div class="tbl-wrap"><table class="tbl" style="min-width:700px;"><thead><tr><th>Quote</th><th>Work</th><th>RF in tracker</th><th>PR</th><th>PO</th><th>Status</th></tr></thead><tbody>' +
        d.trackerOnly.map(function (w) { return '<tr data-id="' + w.id + '"><td class="t-ref">' + esc(w.qtn) + '</td><td><div class="t-desc">' + esc(w.desc) + '</div><div class="t-bldg">' + esc(w.building) + '</div></td><td>' + esc(w.rf) + '</td><td>' + esc(w.pr) + '</td><td>' + esc(w.po) + '</td><td>' + esc(w.status) + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="pq-note" style="margin-top:8px;">Usually a typo in the tracker, or an RF under a project that is not in the D365 export filter. Click a row to open the work.</div>' : '<div class="empty-note">None.</div>') + '</div>';
    }
    $('pq-check').innerHTML = h;
  }

  // v27: an RF raised today is in the tracker but not yet in the D365 export (it comes in the evening).
  // When you search, such works are shown under the results so you can still attach the documents.
  function rfNorm(v) { var m = /R?\s*-?\s*0*(\d{5,})/i.exec(String(v || '')); return m ? 'R-' + ('000000000' + m[1]).slice(-9) : ''; }
  function newList() {
    var d = P.data, q = P.q; if (!q || !d || !d.trackerOnly) return [];
    var out = [];
    d.trackerOnly.forEach(function (w) {
      var hay = [w.rf, rfNorm(w.rf), w.qtn, w.crm, w.desc, w.building, w.pr, w.po].join(' | ').toLowerCase();
      if (hay.indexOf(q) < 0) return;
      String(w.rf || '').split(/[,;\/&\n]+|\s+and\s+/i).forEach(function (x) { var rf = rfNorm(x); if (rf && !out.some(function (o) { return o.rf === rf; })) out.push({ rf: rf, w: w }); });
    });
    return out.slice(0, 20);
  }
  function newRows() {
    var l = newList(); if (!l.length) return '';
    return '<tr><td colspan="8" class="pq-new-h">In the tracker, not in the D365 export yet (it comes in tonight)</td></tr>' + l.map(function (o) {
      var w = o.w, sub = [w.crm ? 'CRM ' + w.crm : '', w.qtn, w.building].filter(Boolean).join(' · ');
      return '<tr class="pq-new"><td><div class="pq-ref">' + esc(o.rf) + '</div><div style="margin-top:6px"><button type="button" class="btn btn-primary btn-sm" data-rq="' + esc(o.rf) + '">📎 Attach documents</button></div></td>' +
        '<td colspan="7"><div class="t-desc">' + esc(w.desc || '-') + '</div>' + (sub ? '<div class="t-bldg">' + esc(sub) + '</div>' : '') +
        '<div class="t-sub">' + esc(w.status || '') + (w.id != null ? ' <button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px" data-work="' + esc(w.id) + '">Open the work</button>' : '') + '</div></td></tr>';
    }).join('');
  }
  function rows() {
    var d = P.data, q = P.q;
    var r = d.rfs.filter(function (x) {
      if (P.stage) { if (x.stage !== P.stage) return false; }
      else if (P.who) { if (x.who !== P.who) return false; }
      else if (P.hideDone && (x.who === 'done' || x.stage === 'closed')) return false;
      if (P.check === 'notfound' && !isNotFound(x)) return false;
      if (P.check === 'mismatch' && !isMismatch(x)) return false;
      if (P.check === 'ok' && !(x.trackerId && !x.flags.length)) return false;
      if (P.late && !x.over) return false;
      if (q) {
        var hay = [x.rf, x.desc, x.crm, x.qtn, x.vendor, x.vendorPo, x.status, x.stageName, x.building, x.cats,
          x.prs.map(function (p) { return p.n; }).join(' '), x.pos.map(function (p) { return p.n; }).join(' ')].join(' | ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var s = P.sort;
    r.sort(function (a, b) {
      var x = a[s.k], y = b[s.k];
      var ex = x === null || x === undefined || x === '', ey = y === null || y === undefined || y === '';
      if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * s.d;
    });
    return r;
  }

  // v20: ready to submit? (the PC's RF documents job: three files attached + details filled)
  function docsTag(x) { var h = docsTag0(x); return h ? h.replace('<span class="pq-tag', '<span role="button" tabindex="0" data-rq="' + esc(x.rf) + '" title="Tap to attach the documents to this RF" class="rq-tap pq-tag') : ''; }
  function docsTag0(x) {
    if (x.stage !== 'rf_draft' && x.stage !== 'rf_returned') return '';
    var d = x.docs;
    if (!d) return '<div style="margin-top:4px"><span class="pq-tag" title="The RF documents job on your PC has not looked at this RF yet">Docs not checked</span></div>';
    var miss = String(d.missing || '').split(/;\s*/).filter(Boolean), docs = miss.filter(function (m) { return !/^no (Name|Telephone|Location|Buyer)$/.test(m); });
    var onlyBuyer = miss.length === 1 && miss[0] === 'no Buyer';
    if (/^Ready/.test(d.state) || onlyBuyer) return '<div style="margin-top:4px"><span class="pq-tag ok" title="Checked ' + esc(d.at) + '">✓ ' + (onlyBuyer ? 'Docs in · add Buyer, then submit' : 'Ready to submit') + '</span></div>';
    var short = docs.length ? docs.map(function (m) { return m.replace(/^no /, '').replace(/ attached$/, '').replace(/^Drive: /, 'Drive: '); }).slice(0, 2).join(', ') + (docs.length > 2 ? ' +' + (docs.length - 2) : '') : miss.join(', ');
    return '<div style="margin-top:4px"><span class="pq-tag ' + (d.state === 'Error' ? 'bad' : 'warn') + '" title="' + esc((d.missing || d.msg || '') + ' · checked ' + d.at) + '">' + (d.state === 'Error' ? '⚠ Docs job failed' : 'Missing: ' + esc(short)) + '</span></div>';
  }
  function prTag(p) {
    var s = (p.status || '').toLowerCase();
    var c = /approved|closed/.test(s) ? 'ok' : /review/.test(s) ? 'warn' : /reject|cancel/.test(s) ? 'bad' : '';
    return '<span class="pq-tag ' + c + '" title="' + esc(p.name || '') + '">' + esc(p.n) + (p.status ? ' · ' + esc(p.status) : '') + '</span>';
  }
  function poTag(p) {
    if (!p.known) return '<span class="pq-tag" title="This PO is not in the PO export (other project?)">' + esc(p.n) + ' · ?</span>';
    var s = (p.status || '').toLowerCase(), a = (p.approval || '').toLowerCase();
    var c = /invoiced/.test(s) ? 'ok' : /received/.test(s) ? 'info' : /cancel/.test(s) ? 'bad' : !/confirm|approved/.test(a) ? 'warn' : 'warn';
    var txt = !/confirm|approved/.test(a) ? p.approval : p.status;
    return '<span class="pq-tag ' + c + '">' + esc(p.n) + ' · ' + esc(txt) + '</span>';
  }

  function renderChips() {
    var c = [];
    if (P.stage) c.push(['stage', 'Step: ' + (STAGE[P.stage] || {}).name]);
    else if (P.who) c.push(['who', 'Waiting on: ' + P.who]);
    if (P.check && P.check !== 'trackeronly') c.push(['check', { ok: 'Matches tracker', mismatch: 'Tracker disagrees', notfound: 'Not in tracker' }[P.check]]);
    $('pq-chips').innerHTML = c.map(function (x) { return '<span class="fchip">' + esc(x[1]) + '<button type="button" data-clear="' + x[0] + '" aria-label="Remove filter">×</button></span>'; }).join('') +
      (c.length ? '<button type="button" class="clear-all" data-clear="all">Clear all</button>' : '');
  }

  function renderTable() {
    renderChips();
    var r = rows(), list = r.slice(0, P.shown), d = P.data;
    var title = P.stage ? (STAGE[P.stage] || {}).name : P.who ? 'Waiting on ' + P.who : (P.hideDone ? 'Open RFs' : 'All RFs');
    $('pq-tbl-title').textContent = title;
    $('pq-count').textContent = r.length + ' RF' + (r.length === 1 ? '' : 's') + ' · AED ' + money(r.reduce(function (a, x) { return a + (x.amount || 0); }, 0));
    document.querySelectorAll('#view-proc .pq-tbl th[data-k]').forEach(function (th) { th.classList.toggle('sorted', th.dataset.k === P.sort.k); });
    var extra = newRows();                                     // v27
    if (!list.length && !extra) { $('pq-tbody').innerHTML = '<tr><td colspan="8" class="empty-note">No RFs match.</td></tr>'; $('pq-more').style.display = 'none'; return; }
    if (!list.length) { $('pq-tbody').innerHTML = extra; $('pq-more').style.display = 'none'; return; }
    $('pq-tbody').innerHTML = list.map(function (x) {
      var sub = [x.crm ? 'CRM ' + x.crm : '', x.qtn ? x.qtn : '', x.building].filter(Boolean).join(' · ');
      var h = '<tr class="pq-row' + (x.over ? ' late' : '') + '" data-rf="' + esc(x.rf) + '" tabindex="0">' +
        '<td><div class="pq-ref">' + esc(x.rf) + '</div><div class="t-sub">' + esc(dLabel(x.date)) + (x.status ? ' · RF ' + esc(x.status) : '') + '</div>' + docsTag(x) + '</td>' +
        '<td><div class="t-desc">' + esc(x.desc || x.cats || '-') + '</div>' + (sub ? '<div class="t-bldg">' + esc(sub) + '</div>' : '') +
          (x.flags.length ? '<div class="pq-flag">⚠ ' + esc(x.flags[0]) + (x.flags.length > 1 ? ' (+' + (x.flags.length - 1) + ')' : '') + '</div>' : '') + '</td>' +
        '<td><span class="pq-stage" style="--gc:' + GC[x.who] + '"><i></i>' + esc(x.stageName) + '</span>' + (x.next ? '<div class="pq-next">' + esc(x.next) + '</div>' : '') + '</td>' +
        '<td><div class="pq-chain">' + (x.prs.length ? x.prs.map(prTag).join('') : '<span class="muted">-</span>') + '</div></td>' +
        '<td><div class="pq-chain">' + (x.pos.length ? x.pos.map(poTag).join('') : '<span class="muted">-</span>') + '</div></td>' +
        '<td>' + esc(x.vendorPo || x.vendor || '-') + '</td>' +
        '<td class="num">' + (x.amount ? money(x.amount) : '-') + '</td>' +
        '<td>' + (x.days === null ? '<span class="muted">-</span>' : '<span class="age ' + ageClass(x) + '">' + x.days + (x.days === 1 ? ' day' : ' days') + '</span>') + '</td></tr>';
      if (P.open[x.rf]) h += detail(x);
      return h;
    }).join('') + extra;
    $('pq-more').style.display = r.length > list.length ? '' : 'none';
    $('pq-morebtn').textContent = 'Show more (' + (r.length - list.length) + ' left)';
  }

  function detail(x) {
    var f = [['RF', x.rf], ['RF status', x.status], ['RF date', dLabel(x.date)], ['Current step', x.stageName], ['Next', x.next],
      ['At this step since', dLabel(x.since)], ['Purchase requisitions', x.prs.map(function (p) { return p.n + (p.status ? ' (' + p.status + ')' : ''); }).join(', ') || '-'],
      ['Purchase orders', x.pos.map(function (p) { return p.n + (p.known ? ' (' + p.approval + ', ' + p.status + ')' : ' (not in the PO export)'); }).join(', ') || '-'],
      ['Vendor (RF)', x.vendor || '-'], ['Vendor (PO)', x.vendorPo || '-'], ['RF value (lines)', 'AED ' + money(x.amount) + ' · ' + x.lines + ' line(s)'],
      ['Category', x.cats || '-'], ['Project', x.project || '-'], ['Buyer', x.buyer || '-'], ['CRM', x.crm || '-'],
      ['Tracker work', x.qtn ? x.qtn + (x.building ? ' · ' + x.building : '') + ' (matched by ' + (x.match || '').toUpperCase() + ')' : 'not found']];
    return '<tr class="pq-detail"><td colspan="8"><div class="pq-dgrid">' + f.map(function (p) { return '<div><span>' + esc(p[0]) + '</span><b>' + esc(p[1]) + '</b></div>'; }).join('') + '</div>' +
      (x.flags.length ? '<div class="pq-dflags">' + x.flags.map(function (m) { return '<div>⚠ ' + esc(m) + '</div>'; }).join('') + '</div>' : '') +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
        ((x.stage === 'rf_draft' || x.stage === 'rf_returned') ? '<button type="button" class="btn btn-primary btn-sm" data-rq="' + esc(x.rf) + '">📎 Attach documents</button>' : '') +
        (x.trackerId ? '<button type="button" class="btn btn-ghost btn-sm" data-work="' + x.trackerId + '">Open the work in the tracker</button>' : '') + '</div></td></tr>';
  }

  function openWork(id) {
    id = Number(id);
    if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
    toast('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
  }

  /* ---- events ---- */
  $('pq-who').addEventListener('click', function (e) {
    var b = e.target.closest('[data-stage]'); if (!b || b.disabled) return;
    P.stage = P.stage === b.dataset.stage ? '' : b.dataset.stage; P.who = ''; P.shown = 100;
    renderWho(); renderTable();
  });
  if ($('pq-check')) $('pq-check').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]'); if (tr) { openWork(tr.dataset.id); return; }
    var b = e.target.closest('[data-check]'); if (!b) return;
    P.check = P.check === b.dataset.check ? '' : b.dataset.check; P.shown = 100;
    if (P.check && P.check !== 'trackeronly') { P.hideDone = false; $('pq-hidedone').checked = false; }
    renderCheck(); renderTable();
  });
  $('pq-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-clear]'); if (!b) return;
    var k = b.dataset.clear;
    if (k === 'stage' || k === 'all') { P.stage = ''; P.who = ''; }
    if (k === 'who') P.who = '';
    if (k === 'check' || k === 'all') P.check = '';
    P.shown = 100; renderWho(); renderCheck(); renderTable();
  });
  $('pq-late').addEventListener('change', function () { P.late = this.checked; P.shown = 100; renderTable(); });
  $('pq-hidedone').addEventListener('change', function () { P.hideDone = this.checked; P.shown = 100; renderTable(); });
  var qT = null;
  $('pq-q').addEventListener('input', function () { var v = this.value.trim().toLowerCase(); clearTimeout(qT); qT = setTimeout(function () { P.q = v; P.shown = 100; renderTable(); }, 180); });
  $('pq-morebtn').addEventListener('click', function () { P.shown += 100; renderTable(); });
  document.querySelectorAll('#view-proc .pq-tbl th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.k;
      P.sort = P.sort.k === k ? { k: k, d: -P.sort.d } : { k: k, d: (k === 'days' || k === 'amount') ? -1 : 1 };
      renderTable();
    });
  });
  /* ---- v23: RF documents queue (server: RfDocsQueue.gs; the PC: d365_rf_docs.py --watch) ---- */
  var RQ = { data: null, t: null, busy: false };
  function drafts() { return ((P.data && P.data.rfs) || []).filter(function (x) { return x.stage === 'rf_draft' || x.stage === 'rf_returned'; }); }
  function notReady() { return drafts().filter(function (x) { var d = x.docs; return !(d && (/^Ready/.test(d.state) || d.missing === 'no Buyer')); }); }
  function rqItem(rf) {
    var x = ((P.data && P.data.rfs) || []).filter(function (r) { return r.rf === rf; })[0];
    if (!x) { var o = newList().filter(function (n) { return n.rf === rf; })[0]; x = o ? o.w : {}; }      // v27
    return { rf: rf, title: [x.crm, x.desc].filter(Boolean).join(' - ') };
  }
  function rqAdd(list) {
    if (!list.length) return;
    google.script.run.withSuccessHandler(function (r) {
      toast(r.added ? r.added + ' RF' + (r.added === 1 ? '' : 's') + ' added to the queue' + (r.already ? ' (' + r.already + ' already in it)' : '') : 'Already in the queue');
      rqPoll(100);
    }).withFailureHandler(function (e) { toast(e.message || String(e)); }).rfqAdd(list);
  }
  function ago(s, now) {
    var t = function (x) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):?(\d{2})?/.exec(x || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : 0; };
    var sec = (t(now) - t(s)) / 1000; if (!t(s)) return '';
    return sec < 90 ? 'just now' : sec < 3600 ? Math.round(sec / 60) + ' min ago' : sec < 86400 ? Math.round(sec / 3600) + ' h ago' : Math.round(sec / 86400) + ' days ago';
  }
  function rqDraw() {
    var card = $('rq-card'); if (!card || !P.data) return;
    var n = notReady().length, b = $('rq-all');
    var d = RQ.data, items = d ? d.items : [], waiting = items.filter(function (i) { return i.status === 'queued' || i.status === 'running'; });
    var inQ = {}; waiting.forEach(function (i) { inQ[i.rf] = 1; });
    var todo = notReady().filter(function (x) { return !inQ[x.rf]; }).length;
    b.textContent = todo ? 'Attach documents to ' + todo + ' draft RF' + (todo === 1 ? '' : 's') : (n ? 'All drafts are in the queue' : 'No draft RFs need documents');
    b.disabled = !todo || RQ.busy;
    // which PC
    var pc = 'Attaches AGFS Quote, Vendor Quote and Email Approval to your draft RFs. Never submits.';
    if (d) {
      var names = Object.keys(d.seen || {}), use = d.use || '', last = use ? d.seen[use] : names.map(function (k) { return d.seen[k]; }).sort().pop();
      var on = last && (function () { var a = ago(last, d.now); return /just now|min ago/.test(a) && (parseInt(a, 10) || 0) < 3; })();
      pc = (use ? esc(use) : 'Your PC') + (last ? (on ? ' is ready <i class="rq-dot on"></i>' : ' last checked in ' + esc(ago(last, d.now)) + ' <i class="rq-dot"></i>') : ' has not run the RF job yet <i class="rq-dot"></i>') +
           (on ? '' : '<br><small>It starts by itself when you log in to Windows (Start hub jobs). Queued RFs wait until then.</small>');
    }
    // v25: another PC is running the RF job right now: one tap to send the work there instead
    if (d) {
      var fresh = Object.keys(d.seen || {}).filter(function (k) { var a = ago(d.seen[k], d.now); return k !== (d.use || '') && /just now|min ago/.test(a) && (parseInt(a, 10) || 0) < 3; });
      if (d.use && fresh.length) pc += '<span class="rq-switch">' + fresh.map(function (k) { return '<button type="button" class="btn btn-ghost btn-sm" data-rquse="' + esc(k) + '">Use ' + esc((d.labels && d.labels[k]) || k) + ' instead</button>'; }).join(' ') + '</span>';
    }
    $('rq-pc').innerHTML = pc;
    if (!items.length) { $('rq-list').innerHTML = ''; return; }
    var order = { running: 0, queued: 1, error: 2, skipped: 3, done: 4, cancelled: 5 };
    items = items.slice().sort(function (a, b2) { return (order[a.status] - order[b2.status]) || (a.added < b2.added ? -1 : 1); });
    $('rq-list').innerHTML = '<div class="rq-items">' + items.map(function (i) {
      var cls = i.status === 'done' ? 'ok' : (i.status === 'error' || i.status === 'skipped') ? 'bad' : i.status === 'cancelled' ? 'off' : '';
      var pct = i.status === 'done' ? 100 : i.status === 'queued' ? 0 : i.pct;
      var txt = i.status === 'queued' ? 'Waiting' + (waiting.indexOf(i) > 0 ? ' (' + waiting.indexOf(i) + ' ahead)' : '') :
                i.status === 'running' ? (i.step || 'Working') + '…' :
                i.status === 'done' ? '✓ ' + (i.result || 'Ready to submit') : i.status === 'cancelled' ? 'Taken out' : '⚠ ' + (i.message || i.result || 'Could not finish');
      return '<div class="rq-it ' + cls + '"><div class="rq-h"><b>' + esc(i.rf) + '</b><span>' + esc(i.title) + '</span>' +
        (i.status === 'queued' ? '<button type="button" class="rq-x" data-rqx="' + esc(i.rf) + '" aria-label="Take ' + esc(i.rf) + ' out of the queue">&times;</button>' : '') +
        ((i.status === 'error' || i.status === 'skipped') ? '<button type="button" class="rq-x" data-rqagain="' + esc(i.rf) + '" title="Try again">↻</button>' : '') + '</div>' +
        '<div class="rq-bar"><i style="width:' + pct + '%"></i></div><div class="rq-s">' + esc(txt) + '</div></div>';
    }).join('') + '</div>';
  }
  function rqPoll(delay) {
    clearTimeout(RQ.t);
    RQ.t = setTimeout(function () {
      if ($('view-proc').style.display === 'none' || document.hidden) { rqPoll(15000); return; }
      google.script.run.withSuccessHandler(function (d) {
        var before = RQ.data ? RQ.data.items.filter(function (i) { return i.status === 'done' || i.status === 'skipped'; }).length : null;
        RQ.data = d; rqDraw();
        var active = d.items.some(function (i) { return i.status === 'queued' || i.status === 'running'; });
        var after = d.items.filter(function (i) { return i.status === 'done' || i.status === 'skipped'; }).length;
        if (before !== null && after > before && !P.loading) load(true);          // badges follow the finished RFs
        rqPoll(active ? 4000 : 60000);
      }).withFailureHandler(function () { rqPoll(30000); }).rfqList();
    }, delay || 0);
  }
  $('rq-all').addEventListener('click', function () {
    var inQ = {}; ((RQ.data && RQ.data.items) || []).forEach(function (i) { if (i.status === 'queued' || i.status === 'running') inQ[i.rf] = 1; });
    var list = notReady().filter(function (x) { return !inQ[x.rf]; }).map(function (x) { return rqItem(x.rf); });
    if (!list.length) return;
    if (list.length > 3 && !confirm('Attach the documents to ' + list.length + ' draft RFs?\n\nYour PC does them one by one (about a minute each). It never submits.')) return;
    rqAdd(list);
  });
  $('rq-pc').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rquse]'); if (!b) return;
    var name = b.dataset.rquse; b.disabled = true; b.textContent = 'Switching…';
    google.script.run.withSuccessHandler(function () {
      toast('MRI and RF documents now go to ' + name);
      if (window.__vwMriLive && window.__vwMriLive.kick) window.__vwMriLive.kick(200);
      rqPoll(300);
    }).withFailureHandler(function (er) { b.disabled = false; toast(er.message || String(er)); }).mriUsePc(name);
  });
  $('rq-list').addEventListener('click', function (e) {
    var x = e.target.closest('[data-rqx]');
    if (x) { google.script.run.withSuccessHandler(function () { rqPoll(0); }).withFailureHandler(function (er) { toast(er.message); }).rfqCancel(x.dataset.rqx); return; }
    var a = e.target.closest('[data-rqagain]'); if (a) rqAdd([rqItem(a.dataset.rqagain)]);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && P.data && $('view-proc').style.display !== 'none') rqPoll(0); });

  function toggleRow(tr) { var rf = tr.dataset.rf; P.open[rf] = !P.open[rf]; renderTable(); }
  $('pq-tbody').addEventListener('click', function (e) {
    var rq = e.target.closest('[data-rq]'); if (rq) { e.stopPropagation(); rqAdd([rqItem(rq.dataset.rq)]); return; }
    var w = e.target.closest('[data-work]'); if (w) { openWork(w.dataset.work); return; }
    var tr = e.target.closest('tr.pq-row'); if (tr) toggleRow(tr);
  });
  $('pq-tbody').addEventListener('keydown', function (e) { var tr = e.target.closest('tr.pq-row'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleRow(tr); } });

  $('pq-csv').addEventListener('click', function () {
    var r = rows();
    var head = ['RF', 'RF date', 'RF status', 'Work', 'CRM', 'Quote (tracker)', 'Building', 'Step', 'Waiting on', 'Next', 'Days at step', 'Late', 'PR', 'PO', 'Vendor', 'RF value', 'Flags'];
    var lines = [head].concat(r.map(function (x) {
      return [x.rf, x.date, x.status, x.desc, x.crm, x.qtn, x.building, x.stageName, x.who, x.next, x.days === null ? '' : x.days, x.over ? 'yes' : '',
        x.prs.map(function (p) { return p.n + ' ' + p.status; }).join('; '), x.pos.map(function (p) { return p.n + ' ' + (p.known ? p.approval + '/' + p.status : '?'); }).join('; '),
        x.vendorPo || x.vendor, x.amount, x.flags.join('; ')];
    }));
    var csv = lines.map(function (l) { return l.map(function (v) { v = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'Procurement - ' + (P.data.today || 'today') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });

  /* ---- import the D365 Excel exports ---- */
  var KEY = { RF: 'Request number', PR: 'Purchase requisition', PO: 'Purchase order' };
  var NEED = { RF: ['Request number', 'Status', 'Purchase requisition', 'PO number'], PR: ['Purchase requisition', 'Status'], PO: ['Purchase order', 'Approval status', 'Purchase order status'] };
  var FILES = {};

  function openModal() { FILES = {}; $('pq-files').innerHTML = ''; $('pq-upload').disabled = true; $('pq-upload').textContent = 'Import'; $('pq-modal').classList.add('open'); }
  function closeModal() { $('pq-modal').classList.remove('open'); }
  $('pq-import').addEventListener('click', openModal);
  $('pq-import2').addEventListener('click', openModal);
  $('pq-mclose').addEventListener('click', closeModal);
  $('pq-mcancel').addEventListener('click', closeModal);
  $('pq-modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  $('pq-drop').addEventListener('click', function () { $('pq-file').click(); });
  $('pq-drop').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('pq-file').click(); } });
  $('pq-drop').addEventListener('dragover', function (e) { e.preventDefault(); });
  $('pq-drop').addEventListener('drop', function (e) { e.preventDefault(); readFiles(e.dataTransfer.files); });
  $('pq-file').addEventListener('change', function () { readFiles(this.files); this.value = ''; });

  function cell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) { if (isNaN(v.getTime())) return ''; var p = function (n) { return (n < 10 ? '0' : '') + n; }; return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate()); }
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v).replace(/\s+/g, ' ').trim();
  }
  // Reads the sheet cell by cell. Dates are taken from Excel's own day number (not a JavaScript Date),
  // so they never shift by a day because of time zones.
  function sheetRows(ws) {
    var out = [];
    if (!ws || !ws['!ref']) return out;
    var rg = XLSX.utils.decode_range(ws['!ref']);
    for (var r = rg.s.r; r <= rg.e.r; r++) {
      var row = [];
      for (var c = rg.s.c; c <= rg.e.c; c++) {
        var x = ws[XLSX.utils.encode_cell({ r: r, c: c })], v = '';
        if (x) {
          if (x.t === 'n' && x.z && XLSX.SSF.is_date(x.z)) {
            var p = XLSX.SSF.parse_date_code(x.v), pad = function (n) { return (n < 10 ? '0' : '') + n; };
            v = p ? p.y + '-' + pad(p.m) + '-' + pad(p.d) + ((p.H || p.M) ? ' ' + pad(p.H) + ':' + pad(p.M) : '') : x.v;
          } else v = x.v;
        }
        row.push(v);
      }
      out.push(row);
    }
    return out;
  }
  function parseBook(name, buf) {
    var wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true });
    var aoa = sheetRows(wb.Sheets[wb.SheetNames[0]]);
    var hi = -1, kind = '';
    for (var i = 0; i < Math.min(aoa.length, 10) && hi < 0; i++) {
      var h = aoa[i].map(cell);
      if (h.indexOf('Request number') > -1) { kind = 'RF'; hi = i; }
      else if (h.indexOf('Purchase order') > -1 && h.indexOf('Purchase order status') > -1) { kind = 'PO'; hi = i; }
      else if (h.indexOf('Purchase requisition') > -1 && h.indexOf('Status') > -1) { kind = 'PR'; hi = i; }
    }
    if (hi < 0) return { name: name, err: 'Not one of the three D365 lists (no Request number / Purchase requisition / Purchase order column).' };
    var header = aoa[hi].map(cell);
    while (header.length && header[header.length - 1] === '') header.pop();
    var miss = NEED[kind].filter(function (c) { return header.indexOf(c) < 0; });
    if (miss.length) return { name: name, kind: kind, err: 'Missing column(s): ' + miss.join(', ') };
    var seen = {};
    header = header.map(function (h) { if (seen[h]) { seen[h]++; return h + ' (' + seen[h] + ')'; } seen[h] = 1; return h; });
    var k = header.indexOf(KEY[kind]), n = header.length, rows = [];
    aoa.slice(hi + 1).forEach(function (r) {
      var row = []; for (var j = 0; j < n; j++) row.push(cell(r[j]));
      if (row[k]) rows.push(row);
    });
    if (!rows.length) return { name: name, kind: kind, err: 'No data rows.' };
    var keys = {}; rows.forEach(function (r) { keys[r[k]] = 1; });
    return { name: name, kind: kind, header: header, rows: rows, count: Object.keys(keys).length };
  }
  function readFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    if (!window.XLSX) { toast('The Excel reader did not load. Reload the page.'); return; }
    Promise.all(arr.map(function (f) {
      return f.arrayBuffer().then(function (b) { try { return parseBook(f.name, b); } catch (e) { return { name: f.name, err: 'Could not read: ' + e.message }; } });
    })).then(function (res) {
      res.forEach(function (r) { FILES[r.kind && !r.err ? r.kind : 'bad:' + r.name] = r; });
      paintFiles();
    });
  }
  function paintFiles() {
    var ks = Object.keys(FILES).sort();
    $('pq-files').innerHTML = ks.map(function (k) {
      var f = FILES[k];
      var what = f.err ? esc(f.err) : f.count + ' ' + { RF: 'RFs (' + f.rows.length + ' lines)', PR: 'PRs', PO: 'POs' }[f.kind];
      return '<div class="pq-fileline' + (f.err ? ' bad' : '') + '"><span class="k">' + (f.err ? '✕' : f.kind) + '</span><span class="n" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="s">' + what + '</span></div>';
    }).join('');
    $('pq-upload').disabled = !ks.some(function (k) { return !FILES[k].err; });
  }
  function call(fn, arg) {
    return new Promise(function (res, rej) { var t = window.__hubSlow ? window.__hubSlow(fn) : 0; google.script.run.withSuccessHandler(function (v) { clearTimeout(t); res(v); }).withFailureHandler(function (e) { clearTimeout(t); if (window.__hubFail) window.__hubFail(fn, e); rej(new Error(e && e.message || e)); })[fn](arg); });
  }
  $('pq-upload').addEventListener('click', function () {
    var todo = ['RF', 'PR', 'PO'].filter(function (k) { return FILES[k] && !FILES[k].err; });
    if (!todo.length) return;
    var btn = this; btn.disabled = true; $('pq-mcancel').disabled = true;
    var done = [], CH = 400;
    var next = function (i) {
      if (i >= todo.length) {
        btn.textContent = 'Import'; $('pq-mcancel').disabled = false; closeModal();
        toast('Imported: ' + done.join(', '));
        load(true);
        return;
      }
      var f = FILES[todo[i]], table = [f.header].concat(f.rows), chunks = Math.ceil(table.length / CH);
      var step = function (c) {
        if (c >= chunks) { done.push(LIST_NAME[todo[i]]); next(i + 1); return; }
        btn.textContent = 'Importing ' + todo[i] + '... ' + Math.round(c / chunks * 100) + '%';
        call('d365ImportChunk', { list: todo[i], chunk: c, chunks: chunks, offset: c * CH, totalRows: table.length, rows: table.slice(c * CH, (c + 1) * CH), fileName: f.name })
          .then(function () { step(c + 1); })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Import'; $('pq-mcancel').disabled = false; toast(todo[i] + ' import failed: ' + e.message); });
      };
      step(0);
    };
    next(0);
  });
})();
