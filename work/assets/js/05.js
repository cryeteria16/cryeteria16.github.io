(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN = '', DATA = null, TAB = 'released', SHOWN = 100, TIMER = null, CUR = [];
  var FILT = { month: '', building: '', type: '', status: '' };
  var FNAME = { month: 'Month', building: 'Building', type: 'Type', status: 'SAP status' };
  var VIEW = 'pipe', PSEL = -1, PSHOWN = 100, PTIMER = null, PCUR = [];
  var PSORT = { k: 'days', d: -1 };
  var SORT = { released: { k: 'lpoDate', d: -1 }, awaiting: { k: 'days', d: -1 }, check: { k: '', d: 1 } };

  function store(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function mLabel(k) { var m = /^(\d{4})-(\d{2})$/.exec(k); return m ? MON[Number(m[2]) - 1] + ' ' + m[1] : k; }
  function dLabel(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  function activate(el, fn) { el.addEventListener('click', fn); el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }); }

  /* ---- show/hide this page without touching the existing showView() ---- */
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { $('view-wasl').style.display = n.dataset.view === 'wasl' ? '' : 'none'; if (n.dataset.view === 'wasl') opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function opened() {
    if (TOKEN) return;
    TOKEN = load('waslSapToken');
    if (TOKEN) loadData(false); else showLock('');
  }

  /* ---- PIN screen ---- */
  function showLock(msg) {
    TOKEN = ''; store('waslSapToken', null); DATA = null;
    $('wl-main').style.display = 'none'; $('wl-lock').style.display = '';
    $('wl-err').textContent = msg || ''; $('wl-pin').value = '';
    setTimeout(function () { try { $('wl-pin').focus(); } catch (e) {} }, 50);
  }
  function tryPin() {
    var pin = $('wl-pin').value.trim();
    if (pin.length < 4) { $('wl-err').textContent = 'Enter all 4 digits'; return; }
    $('wl-go').disabled = true; $('wl-err').textContent = '';
    google.script.run
      .withSuccessHandler(function (r) {
        $('wl-go').disabled = false;
        if (r && r.ok) { TOKEN = r.token; store('waslSapToken', TOKEN); $('wl-pin').value = ''; loadData(false); }
        else { $('wl-err').textContent = 'Wrong PIN'; $('wl-pin').value = ''; $('wl-pin').focus(); }
      })
      .withFailureHandler(function (e) { $('wl-go').disabled = false; $('wl-err').textContent = 'Could not check the PIN: ' + (e && e.message || e); })
      .waslSapUnlock(pin);
  }
  $('wl-go').addEventListener('click', tryPin);
  $('wl-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryPin(); });
  $('wl-pin').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); if (this.value.length === 4) tryPin(); });
  $('wl-lockbtn').addEventListener('click', function () { showLock(''); });
  $('wl-refresh').addEventListener('click', function () { loadData(true); });

  /* ---- load ---- */
  function loadData(force) {
    $('wl-lock').style.display = 'none'; $('wl-main').style.display = '';
    $('wl-loading').style.display = ''; $('wl-body').style.display = 'none'; $('wl-pipe').style.display = 'none'; $('wl-views').style.display = 'none'; $('wl-error').style.display = 'none';
    google.script.run
      .withSuccessHandler(function (d) { DATA = d; $('wl-loading').style.display = 'none'; render(); })
      .withFailureHandler(function (e) {
        var m = String(e && e.message || e);
        if (m.indexOf('LOCKED') > -1) { showLock('Session ended - enter the PIN again'); return; }
        $('wl-loading').style.display = 'none';
        $('wl-error').style.display = ''; $('wl-error').textContent = 'Could not load: ' + m;
      })
      .waslSapGetDashboard(TOKEN, !!force);
  }

  /* ---- lists + filters ---- */
  function lists() {
    var o = DATA.orders;
    return {
      released: o.filter(function (x) { return x.state === 'matched' && x.hasLpo; }),
      awaiting: DATA.awaiting,
      check: o.filter(function (x) {
        return !(x.state === 'matched' && x.hasLpo && !x.mismatch.length && !x.qtnRepaired) && !(x.state === 'matched' && !x.hasLpo && !x.note);
      })
    };
  }
  var FKEY = {
    month: function (x) { return x.lpoDate ? x.lpoDate.substring(0, 7) : '(none)'; },
    building: function (x) { return x.building || x.loc || '(none)'; },
    type: function (x) { return x.type || '(none)'; },
    status: function (x) { return x.userStatus || '(none)'; }
  };
  function anyFilter() { return !!(FILT.month || FILT.building || FILT.type || FILT.status); }
  function clearFilters() { FILT = { month: '', building: '', type: '', status: '' }; }
  function setFilter(f, k) {
    FILT[f] = FILT[f] === k ? '' : k;
    if (FILT[f]) TAB = 'released';
    SHOWN = 100; refresh();
  }
  function goTab(t, clear, sortKey, sortDir) {
    TAB = t; if (clear) clearFilters();
    if (sortKey !== undefined) SORT[t] = { k: sortKey, d: sortDir };
    SHOWN = 100; refresh();
  }

  var COLS = {
    released: [['LPO', 'lpo'], ['LPO date', 'lpoDate'], ['Quote', 'qtn'], ['Work', 'desc'], ['Building', 'building'], ['Value (excl. VAT)', 'value', 1], ['Tijori date', 'tijoriDate'], ['Days to LPO', 'daysToLpo', 1], ['SAP status', 'userStatus'], ['Order', 'order'], ['Type', 'type'], ['Flags', 'flags']],
    awaiting: [['Quote', 'qtn'], ['Work', 'desc'], ['Building', 'building'], ['Tijori date', 'tijoriDate'], ['Days waiting', 'days', 1], ['Tracker status', 'status'], ['WASL cost', 'waslCost', 1], ['Tracker LPO', 'trackerLpo'], ['Assigned to', 'assignee']],
    check: [['Problem', 'problem'], ['LPO', 'lpo'], ['Quote in SAP', 'qtnRaw'], ['Order', 'order'], ['Type', 'type'], ['Work', 'desc'], ['Value', 'value', 1], ['SAP status', 'userStatus']]
  };
  var DETAIL = {
    released: [['LPO', 'lpo'], ['LPO date', 'lpoDate'], ['WASL order', 'order'], ['Purchase requisition', 'prq'], ['Quote (tracker)', 'qtn'], ['Quote as typed in SAP', 'qtnRaw'], ['Building', 'building'], ['Functional location', 'loc'], ['Tijori upload date', 'tijoriDate'], ['Days Tijori to LPO', 'daysToLpo'], ['LPO value (excl. VAT)', 'value'], ['Confirmed so far', 'confirmed'], ['SAP status code', 'userStatus'], ['SAP system status', 'sysStatus'], ['Tracker works status', 'trackerStatus'], ['Order type', 'type'], ['Work', 'desc'], ['Flags', 'flags']],
    awaiting: [['Quote', 'qtn'], ['Work', 'desc'], ['Building', 'building'], ['Tijori upload date', 'tijoriDate'], ['Days waiting', 'days'], ['Tracker works status', 'status'], ['WASL cost (tracker)', 'waslCost'], ['LPO typed in tracker', 'trackerLpo'], ['Assigned to', 'assignee']],
    check: [['Problem', 'problem'], ['LPO', 'lpo'], ['Quote as typed in SAP', 'qtnRaw'], ['Read as', 'qtn'], ['WASL order', 'order'], ['Purchase requisition', 'prq'], ['Order type', 'type'], ['Functional location', 'loc'], ['LPO value', 'value'], ['SAP status code', 'userStatus'], ['Work', 'desc']]
  };
  var NAMES = { released: 'LPOs released', awaiting: 'Awaiting LPO', check: 'Needs checking' };
  var DATEK = { lpoDate: 1, tijoriDate: 1 }, MONEYK = { value: 1, waslCost: 1, confirmed: 1 };

  function problem(x) { var p = []; if (x.note) p.push(x.note); (x.mismatch || []).forEach(function (m) { p.push(m); }); return p.join('. '); }
  function rowsFor(tab) {
    var L = lists()[tab], q = $('wl-q').value.trim().toLowerCase();
    var rows = L.map(function (x) {
      if (tab === 'check') return Object.assign({}, x, { problem: problem(x) });
      if (tab === 'released') return Object.assign({}, x, { flags: problem(x) });
      return x;
    });
    if (tab === 'released') {
      Object.keys(FILT).forEach(function (f) { if (FILT[f]) rows = rows.filter(function (x) { return FKEY[f](x) === FILT[f]; }); });
    }
    if (q) rows = rows.filter(function (x) { return JSON.stringify(x).toLowerCase().indexOf(q) > -1; });
    var s = SORT[tab];
    if (s && s.k) {
      var num = (COLS[tab].filter(function (c) { return c[1] === s.k; })[0] || [])[2];
      rows.sort(function (a, b) {
        var x = a[s.k], y = b[s.k];
        var ex = (x === null || x === undefined || x === ''), ey = (y === null || y === undefined || y === '');
        if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;            // blanks always last
        return (num ? (x - y) : String(x).localeCompare(String(y), undefined, { numeric: true })) * s.d;
      });
    }
    return rows;
  }

  /* ---- rendering ---- */
  function refresh() { renderKpis(); renderBars(); renderChips(); renderTabs(); renderTable(); }

  function render() {
    var d = DATA, b = d.banner || {};
    $('wl-sub').textContent = 'Tracker and SAP read ' + d.generatedAt + '. Click any tile, stage or bar to filter.';
    var ban = $('wl-banner'), bad = !!b.message;
    ban.className = 'banner wl-banner ' + (bad ? 'banner-err' : 'ok');
    ban.innerHTML = bad
      ? '<b>⚠ ' + esc(b.message) + '</b>' + (b.lastSuccess ? '<span>Showing data from ' + esc(b.lastSuccess) + '.</span>' : '')
      : '<b>✔ SAP data updated ' + esc(b.lastSuccess) + '</b><span>' + esc(b.summary || (b.rows + ' rows')) + '</span>';
    if (d.missingColumns && d.missingColumns.length) { $('wl-error').style.display = ''; $('wl-error').textContent = 'The SAP tab is missing these columns: ' + d.missingColumns.join(', '); }
    $('wl-views').style.display = '';
    $('wl-foot').textContent = 'LPO value = SAP "TotCosPlan" (excl. VAT). Status codes are shown exactly as SAP gives them. Only SAP orders whose QTN matches an approved + Tijori-uploaded tracker work count as released.';
    refresh(); renderPipe(); applyView();
  }

  function renderKpis() {
    var d = DATA, k = d.kpi;
    var tiles = [
      { go: 'released', l: 'LPOs released', n: k.lpos, v: 'AED ' + money(k.value) + ' (excl. VAT)', on: TAB === 'released' && !anyFilter() },
      { go: 'awaiting', l: 'Awaiting LPO', n: k.awaiting, v: k.awaitingRed + ' waiting over ' + d.waitingRedDays + ' days', red: k.awaitingRed > 0, on: TAB === 'awaiting' },
      { go: 'slow', l: 'Avg days: Tijori to LPO', n: k.avgDaysToLpo === null ? '-' : k.avgDaysToLpo, v: 'click: slowest LPOs first', on: TAB === 'released' && SORT.released.k === 'daysToLpo' },
      { go: 'check', l: 'Needs checking', n: k.needsChecking, v: 'bad refs, mismatches, not in tracker', red: k.needsChecking > 0, on: TAB === 'check' },
      { go: 'all', l: 'Approved + in Tijori', n: k.eligibleWorks, v: 'works that can receive an LPO', on: false }
    ];
    $('wl-kpis').innerHTML = tiles.map(function (t) {
      return '<div class="kpi wl-kpi' + (t.red ? ' red' : '') + (t.on ? ' on' : '') + '" data-go="' + t.go + '" role="button" tabindex="0"><div class="kpi-label">' + esc(t.l) + '</div><div class="kpi-num">' + esc(t.n) + '</div><div class="kpi-val">' + esc(t.v) + '</div></div>';
    }).join('');
    $('wl-kpis').querySelectorAll('.wl-kpi').forEach(function (el) {
      activate(el, function () {
        var g = el.dataset.go;
        if (g === 'released' || g === 'all') { SORT.released = { k: 'lpoDate', d: -1 }; goTab('released', true); }
        else if (g === 'slow') { goTab('released', true, 'daysToLpo', -1); }
        else goTab(g, false);
      });
    });
  }

  function bars(id, f, rows, by) {
    var el = $(id);
    if (!rows.length) { el.innerHTML = '<div class="wl-empty">No data</div>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return by === 'value' ? r.v : r.c; })) || 1;
    el.innerHTML = rows.map(function (r) {
      var x = by === 'value' ? r.v : r.c;
      return '<div class="wl-bar' + (FILT[f] === r.k ? ' sel' : '') + '" data-f="' + f + '" data-k="' + esc(r.k) + '" role="button" tabindex="0" title="Click to filter the list"><div class="lb">' + esc(r.l) + '</div><div class="tr"><div class="fl" style="width:' + Math.max(2, Math.round(x / max * 100)) + '%"></div></div><div class="vl">' +
        (by === 'value' ? money(r.v) + ' (' + r.c + ')' : r.c + ' · ' + money(r.v)) + '</div></div>';
    }).join('');
    el.querySelectorAll('.wl-bar').forEach(function (b) { activate(b, function () { setFilter(b.dataset.f, b.dataset.k); }); });
  }
  function renderBars() {
    var d = DATA, m = function (r, lab) { return { k: r.key, l: lab ? lab(r.key) : r.key, c: r.count, v: r.value }; };
    bars('wl-ch-month', 'month', d.byMonth.map(function (r) { return m(r, mLabel); }), 'count');
    bars('wl-ch-bld', 'building', d.byBuilding.slice(0, 10).map(function (r) { return m(r); }), 'value');
    bars('wl-ch-type', 'type', d.byType.map(function (r) { return m(r); }), 'count');
    bars('wl-ch-st', 'status', d.byUserStatus.map(function (r) { return m(r); }), 'count');
  }

  function renderChips() {
    var h = Object.keys(FILT).filter(function (f) { return FILT[f]; }).map(function (f) {
      return '<span class="wl-chip">' + FNAME[f] + ': ' + esc(f === 'month' ? mLabel(FILT[f]) : FILT[f]) + '<button data-x="' + f + '" aria-label="Remove filter">×</button></span>';
    }).join('');
    $('wl-chips').innerHTML = h ? h + '<button class="wl-clear" id="wl-clearall">Clear all</button>' : '';
    $('wl-chips').querySelectorAll('button[data-x]').forEach(function (b) { b.addEventListener('click', function () { FILT[b.dataset.x] = ''; SHOWN = 100; refresh(); }); });
    var c = $('wl-clearall'); if (c) c.addEventListener('click', function () { clearFilters(); SHOWN = 100; refresh(); });
  }

  function renderTabs() {
    var L = lists();
    $('wl-tabs').innerHTML = ['released', 'awaiting', 'check'].map(function (t) {
      return '<button class="wl-tab' + (t === TAB ? ' on' : '') + '" data-t="' + t + '">' + NAMES[t] + '<small>' + L[t].length + '</small></button>';
    }).join('');
    $('wl-tabs').querySelectorAll('.wl-tab').forEach(function (b) { b.addEventListener('click', function () { goTab(b.dataset.t, false); }); });
  }

  function cell(tab, c, x) {
    var key = c[1], v = x[key];
    if (key === 'value' || key === 'waslCost') return '<td class="num">' + (v ? money(v) : '-') + '</td>';
    if (key === 'daysToLpo') return '<td class="num">' + (v === null || v === undefined ? '-' : v) + '</td>';
    if (key === 'days') {
      if (v === null || v === undefined) return '<td class="num">-</td>';
      return '<td class="num"><span class="pill ' + (v > DATA.waitingRedDays ? 'bad' : v > 7 ? 'warn' : 'ok') + '">' + v + ' d</span></td>';
    }
    if (DATEK[key]) return '<td>' + esc(dLabel(v)) + '</td>';
    if (key === 'desc') return '<td class="desc">' + esc(v) + '</td>';
    if (key === 'flags' || key === 'problem') return '<td>' + (v ? '<span class="pill warn" style="white-space:normal;">' + esc(v) + '</span>' : '') + '</td>';
    if (key === 'qtn' && x.qtnRepaired && tab === 'released') return '<td>' + esc(v) + ' <span class="muted">*</span></td>';
    return '<td>' + esc(v) + '</td>';
  }
  function detailHtml(tab, x) {
    return '<div class="wl-dgrid">' + DETAIL[tab].map(function (d) {
      var v = x[d[1]];
      if (v === null || v === undefined || v === '') return '';
      v = DATEK[d[1]] ? dLabel(v) : MONEYK[d[1]] ? 'AED ' + money(v) : v;
      return '<div><span>' + esc(d[0]) + '</span><b>' + esc(v) + '</b></div>';
    }).join('') + '</div>';
  }

  function renderTable() {
    var cols = COLS[TAB], rows = rowsFor(TAB), s = SORT[TAB];
    $('wl-thead').innerHTML = '<tr>' + cols.map(function (c) {
      return '<th data-k="' + c[1] + '" class="' + (c[2] ? 'num ' : '') + (s.k === c[1] ? 'sorted' : '') + '">' + esc(c[0]) + (s.k === c[1] ? (s.d > 0 ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('') + '</tr>';
    $('wl-thead').querySelectorAll('th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k; SORT[TAB] = { k: k, d: SORT[TAB].k === k ? -SORT[TAB].d : 1 }; SHOWN = 100; renderTable();
      });
    });
    var note = (TAB !== 'released' && anyFilter()) ? ' (chart filters apply to the LPOs released list)' : '';
    var tot = rows.reduce(function (t, x) { return t + (TAB === 'awaiting' ? (x.waslCost || 0) : (x.value || 0)); }, 0);
    $('wl-count').textContent = rows.length + ' shown' + (tot ? ' · AED ' + money(tot) : '') + note;
    CUR = rows.slice(0, SHOWN);
    $('wl-tbody').innerHTML = rows.length
      ? CUR.map(function (x, i) { return '<tr class="wl-row" data-i="' + i + '" title="Click for details">' + cols.map(function (c) { return cell(TAB, c, x); }).join('') + '</tr>'; }).join('')
      : '<tr><td colspan="' + cols.length + '" class="wl-empty">Nothing here.</td></tr>';
    $('wl-tbody').querySelectorAll('tr.wl-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var nx = tr.nextElementSibling;
        if (nx && nx.classList.contains('wl-detail')) { nx.remove(); return; }
        var d = document.createElement('tr'); d.className = 'wl-detail';
        d.innerHTML = '<td colspan="' + cols.length + '">' + detailHtml(TAB, CUR[Number(tr.dataset.i)]) + '</td>';
        tr.parentNode.insertBefore(d, tr.nextSibling);
      });
    });
    $('wl-more').style.display = rows.length > SHOWN ? '' : 'none';
  }
  $('wl-q').addEventListener('input', function () { clearTimeout(TIMER); TIMER = setTimeout(function () { SHOWN = 100; renderTable(); }, 200); });
  $('wl-morebtn').addEventListener('click', function () { SHOWN += 200; renderTable(); });

  /* ---- CSV of the list currently shown (respects filters, search and sort) ---- */
  $('wl-csv').addEventListener('click', function () {
    var cols = COLS[TAB], rows = rowsFor(TAB);
    var q = function (v) { v = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [cols.map(function (c) { return q(c[0]); }).join(',')].concat(rows.map(function (x) { return cols.map(function (c) { return q(x[c[1]]); }).join(','); })).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' }));
    a.download = 'WASL_' + NAMES[TAB].replace(/\s+/g, '_') + '_' + (DATA.today || '') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  /* =====================================================================
     PIPELINE VIEW
  ===================================================================== */
  function applyView() {
    $('wl-pipe').style.display = VIEW === 'pipe' ? '' : 'none';
    $('wl-body').style.display = VIEW === 'lpo' ? '' : 'none';
    $('wl-views').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === VIEW); });
  }
  $('wl-views').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { VIEW = b.dataset.v; applyView(); }); });

  var PCOLS = [['Quote', 'qtn'], ['Work', 'desc'], ['Building', 'building'], ['Waiting at', 'stage'], ['Waiting for', 'next'], ['Since', 'since'], ['Days', 'days', 1], ['WASL cost', 'value', 1], ['Assigned to', 'assignee'], ['Flag', 'flag']];

  function renderPipe() {
    var P = DATA.pipeline, T = P.totals, st = P.stages;
    var tiles = [
      { l: 'Active works', n: T.active, v: 'AED ' + money(T.value) + ' (tracker cost)', go: 'all' },
      { l: 'Overdue', n: T.overdue, v: 'AED ' + money(T.overdueValue) + ' waiting too long', red: T.overdue > 0, go: 'over' },
      { l: 'Completed, no LPO', n: T.completedNoLpo, v: 'AED ' + money(T.completedNoLpoValue) + ' at risk', red: T.completedNoLpo > 0, go: 'nolpo' },
      { l: 'Invoiced', n: st[6].count, v: 'AED ' + money(st[6].value), go: 'inv' }
    ];
    $('wlp-kpis').innerHTML = tiles.map(function (t) {
      return '<div class="kpi wl-kpi' + (t.red ? ' red' : '') + '" data-go="' + t.go + '" role="button" tabindex="0"><div class="kpi-label">' + esc(t.l) + '</div><div class="kpi-num">' + esc(t.n) + '</div><div class="kpi-val">' + esc(t.v) + '</div></div>';
    }).join('');
    $('wlp-kpis').querySelectorAll('.wl-kpi').forEach(function (el) {
      activate(el, function () {
        var g = el.dataset.go; PSEL = -1; $('wlp-q').value = '';
        $('wlp-over').checked = (g === 'over');
        if (g === 'nolpo') $('wlp-q').value = 'no LPO';
        PSORT = { k: 'days', d: -1 }; PSHOWN = 100; renderFunnel(); renderPtable();
      });
    });

    renderFunnel(); renderPtable();
    $('wlp-foot').textContent = 'Stages follow the tracker (approval, Tijori, work status, WCR, invoice) and SAP (LPO). "Overdue" = waiting longer than ' +
      st.slice(0, 6).map(function (x) { return x.limit + 'd at "' + x.name + '"'; }).join(', ') + '. Median days = typical time from the previous stage. Cost = tracker "Total WASL Cost".';
  }

  function renderFunnel() {
    var st = DATA.pipeline.stages, max = st[0].count || 1;
    var h = '<div class="wlp-row head"><div>Stage</div><div class="hide-s"></div><div class="n">Works</div><div class="n">AED</div><div class="n hide-s">% of prev</div><div class="n hide-s">Median days</div><div class="n">Waiting here</div></div>';
    st.forEach(function (s, i) {
      h += (i ? '<div class="wlp-arrow">▼</div>' : '') +
        '<div class="wlp-row' + (PSEL === i ? ' sel' : '') + '" data-l="' + i + '" role="button" tabindex="0">' +
        '<div class="nm">' + esc(s.name) + '<small>' + esc(s.next ? 'then: ' + s.next : 'done') + '</small></div>' +
        '<div class="tr"><div class="fl" style="width:' + Math.max(2, Math.round(s.count / max * 100)) + '%"></div></div>' +
        '<div class="n">' + s.count + '</div><div class="n">' + money(s.value) + '</div>' +
        '<div class="n hide-s">' + (s.pct === null ? '-' : s.pct + '%') + '</div>' +
        '<div class="n hide-s">' + (s.medDays === null ? '-' : s.medDays + ' d') + '</div>' +
        '<div class="n">' + (s.limit === null ? '-' : s.waiting + (s.overdue ? ' <span class="pill bad">' + s.overdue + ' overdue</span>' : '')) + '</div></div>';
    });
    $('wlp-funnel').innerHTML = h;
    $('wlp-funnel').querySelectorAll('.wlp-row[data-l]').forEach(function (r) {
      activate(r, function () {
        var l = Number(r.dataset.l); PSEL = PSEL === l ? -1 : l;
        if (PSEL === 6) PSEL = -1;                                  // invoiced works are not "waiting"
        $('wlp-over').checked = false; PSHOWN = 100; renderFunnel(); renderPtable();
      });
    });
  }

  function prowsFor() {
    var rows = DATA.pipeline.waiting.slice(), q = $('wlp-q').value.trim().toLowerCase();
    if (PSEL > -1) rows = rows.filter(function (x) { return x.level === PSEL; });
    if ($('wlp-over').checked) rows = rows.filter(function (x) { return x.over; });
    if (q) rows = rows.filter(function (x) { return JSON.stringify(x).toLowerCase().indexOf(q) > -1; });
    var k = PSORT.k, num = (PCOLS.filter(function (c) { return c[1] === k; })[0] || [])[2];
    rows.sort(function (a, b) {
      var x = a[k], y = b[k], ex = (x === null || x === undefined || x === ''), ey = (y === null || y === undefined || y === '');
      if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
      return (num ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * PSORT.d;
    });
    return rows;
  }

  function renderPtable() {
    var st = DATA.pipeline.stages, rows = prowsFor();
    $('wlp-title').textContent = PSEL > -1 ? 'Waiting at: ' + st[PSEL].name : ($('wlp-over').checked ? 'Overdue works (all stages)' : 'All works still in the pipeline');
    $('wlp-thead').innerHTML = '<tr>' + PCOLS.map(function (c) {
      return '<th data-k="' + c[1] + '" class="' + (c[2] ? 'num ' : '') + (PSORT.k === c[1] ? 'sorted' : '') + '">' + esc(c[0]) + (PSORT.k === c[1] ? (PSORT.d > 0 ? ' ▲' : ' ▼') : '') + '</th>';
    }).join('') + '</tr>';
    $('wlp-thead').querySelectorAll('th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () { var k = th.dataset.k; PSORT = { k: k, d: PSORT.k === k ? -PSORT.d : 1 }; PSHOWN = 100; renderPtable(); });
    });
    var tot = rows.reduce(function (t, x) { return t + (x.value || 0); }, 0);
    $('wlp-count').textContent = rows.length + ' works' + (tot ? ' · AED ' + money(tot) : '');
    PCUR = rows.slice(0, PSHOWN);
    $('wlp-tbody').innerHTML = rows.length ? PCUR.map(function (x) {
      return '<tr>' + PCOLS.map(function (c) {
        var key = c[1], v = x[key];
        if (key === 'days') return '<td class="num">' + (v === null ? '-' : '<span class="pill ' + (x.over ? 'bad' : 'ok') + '">' + v + ' d</span>') + '</td>';
        if (key === 'value') return '<td class="num">' + (v ? money(v) : '-') + '</td>';
        if (key === 'since') return '<td>' + esc(dLabel(v)) + '</td>';
        if (key === 'desc') return '<td class="desc">' + esc(v) + '</td>';
        if (key === 'flag') return '<td>' + (v ? '<span class="pill warn" style="white-space:normal;">' + esc(v) + '</span>' : '') + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + PCOLS.length + '" class="wl-empty">Nothing here - nothing is overdue.</td></tr>';
    $('wlp-more').style.display = rows.length > PSHOWN ? '' : 'none';
  }
  $('wlp-over').addEventListener('change', function () { PSHOWN = 100; renderPtable(); });
  $('wlp-all').addEventListener('click', function () { PSEL = -1; $('wlp-over').checked = false; $('wlp-q').value = ''; PSHOWN = 100; renderFunnel(); renderPtable(); });
  $('wlp-q').addEventListener('input', function () { clearTimeout(PTIMER); PTIMER = setTimeout(function () { PSHOWN = 100; renderPtable(); }, 200); });
  $('wlp-morebtn').addEventListener('click', function () { PSHOWN += 200; renderPtable(); });
  $('wlp-csv').addEventListener('click', function () {
    var rows = prowsFor();
    var q = function (v) { v = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [PCOLS.map(function (c) { return q(c[0]); }).join(',')].concat(rows.map(function (x) { return PCOLS.map(function (c) { return q(x[c[1]]); }).join(','); })).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' }));
    a.download = 'WASL_pipeline_' + (DATA.today || '') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  /* =====================================================================
     PRINTABLE ONE-PAGE SUMMARY  (A4, opens the browser's print dialog - choose "Save as PDF" to keep a copy)
  ===================================================================== */
  (function () {
    var st = document.createElement('style');
    st.textContent =
      '#wl-printarea{display:none;}' +
      '@media print{' +
      '  @page{size:A4 portrait;margin:11mm;}' +
      '  html,body{height:auto !important;overflow:visible !important;background:#fff !important;}' +
      '  body > *:not(#wl-printarea){display:none !important;}' +
      '  #wl-printarea{display:block;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Segoe UI,Arial,sans-serif;color:#0F1824;font-size:10px;line-height:1.35;}' +
      '  #wl-printarea h1{font-size:19px;margin:0;color:#0F2140;}' +
      '  #wl-printarea .pr-sub{color:#64748B;font-size:10px;margin:2px 0 8px;}' +
      '  #wl-printarea .pr-warn{background:#FEE2E2;color:#991B1B;padding:5px 8px;border-radius:5px;margin-bottom:8px;font-weight:700;}' +
      '  #wl-printarea .pr-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px;}' +
      '  #wl-printarea .pr-k{background:#F1F4F9;border-radius:6px;padding:6px 8px;}' +
      '  #wl-printarea .pr-k b{display:block;font-size:17px;color:#0F2140;}' +
      '  #wl-printarea .pr-k.red b{color:#B91C1C;}' +
      '  #wl-printarea .pr-k span{color:#64748B;font-size:8.5px;}' +
      '  #wl-printarea h2{font-size:11px;margin:9px 0 3px;color:#0F2140;border-bottom:1.5px solid #0F2140;padding-bottom:2px;}' +
      '  #wl-printarea table{border-collapse:collapse;width:100%;}' +
      '  #wl-printarea th{font-size:8.5px;color:#64748B;text-align:left;padding:2px 5px;background:#F1F4F9;}' +
      '  #wl-printarea td{padding:2.5px 5px;border-bottom:1px solid #E4E8F0;font-size:9.5px;}' +
      '  #wl-printarea .r{text-align:right;white-space:nowrap;}' +
      '  #wl-printarea .bad{color:#B91C1C;font-weight:700;}' +
      '  #wl-printarea .pr-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;}' +
      '  #wl-printarea .pr-bar{display:grid;grid-template-columns:62px 1fr 62px;gap:5px;align-items:center;margin:1.5px 0;font-size:9px;}' +
      '  #wl-printarea .pr-bar i{display:block;height:7px;background:#2A4A7F;border-radius:4px;}' +
      '  #wl-printarea .pr-foot{margin-top:9px;color:#64748B;font-size:8px;border-top:1px solid #E4E8F0;padding-top:4px;}' +
      '}';
    document.head.appendChild(st);
    var div = document.createElement('div'); div.id = 'wl-printarea'; document.body.appendChild(div);
  })();

  function buildPrint() {
    var d = DATA, k = d.kpi, P = d.pipeline, T = P.totals, b = d.banner || {};
    var cut = function (t, n) { t = String(t || ''); return t.length > n ? t.substring(0, n - 1) + '…' : t; };
    var bars = function (rows, lab, byValue) {
      var max = Math.max.apply(null, rows.map(function (r) { return byValue ? r.value : r.count; }).concat([1]));
      return rows.map(function (r) {
        var x = byValue ? r.value : r.count;
        return '<div class="pr-bar"><span>' + esc(cut(lab(r), 14)) + '</span><i style="width:' + Math.max(2, Math.round(x / max * 100)) + '%"></i><span class="r">' + (byValue ? money(r.value) : r.count) + ' · ' + (byValue ? r.count : money(r.value)) + '</span></div>';
      }).join('') || '<div>No data</div>';
    };
    var kp = function (n, l, sub, red) { return '<div class="pr-k' + (red ? ' red' : '') + '"><b>' + esc(n) + '</b>' + esc(l) + '<br><span>' + esc(sub) + '</span></div>'; };

    var h = '<h1>WASL SAP – summary</h1><div class="pr-sub">Printed ' + esc(d.generatedAt) + ' (Dubai) · SAP data updated ' + esc(b.lastSuccess || 'never') + '</div>';
    if (b.message) h += '<div class="pr-warn">⚠ ' + esc(b.message) + '</div>';
    h += '<div class="pr-kpis">' +
      kp(k.lpos, 'LPOs released', 'AED ' + money(k.value)) +
      kp(k.awaiting, 'Awaiting LPO', k.awaitingRed + ' over ' + d.waitingRedDays + ' days', k.awaitingRed > 0) +
      kp(T.overdue, 'Overdue works', 'AED ' + money(T.overdueValue), T.overdue > 0) +
      kp(T.completedNoLpo, 'Completed, no LPO', 'AED ' + money(T.completedNoLpoValue), T.completedNoLpo > 0) +
      kp(k.avgDaysToLpo === null ? '-' : k.avgDaysToLpo, 'Avg days to LPO', 'Tijori upload → LPO') +
      kp(P.stages[6].count, 'Invoiced', 'AED ' + money(P.stages[6].value)) + '</div>';

    h += '<h2>Works pipeline</h2><table><tr><th>Stage</th><th class="r">Works</th><th class="r">AED (tracker)</th><th class="r">% of previous</th><th class="r">Median days</th><th class="r">Waiting here</th></tr>' +
      P.stages.map(function (s) {
        return '<tr><td>' + esc(s.name) + '</td><td class="r">' + s.count + '</td><td class="r">' + money(s.value) + '</td><td class="r">' + (s.pct === null ? '-' : s.pct + '%') + '</td><td class="r">' + (s.medDays === null ? '-' : s.medDays) + '</td><td class="r' + (s.overdue ? ' bad' : '') + '">' + (s.limit === null ? '-' : s.waiting + (s.overdue ? ' (' + s.overdue + ' overdue)' : '')) + '</td></tr>';
      }).join('') + '</table>';

    h += '<div class="pr-cols"><div><h2>LPOs released per month <span style="font-weight:400;color:#64748B;">(count · AED)</span></h2>' +
      bars(d.byMonth.slice(-8), function (r) { return mLabel(r.key); }, false) + '</div>' +
      '<div><h2>Top buildings by LPO value <span style="font-weight:400;color:#64748B;">(AED · count)</span></h2>' +
      bars(d.byBuilding.slice(0, 7), function (r) { return r.key; }, true) + '</div></div>';

    h += '<h2>Oldest works waiting for an LPO</h2><table><tr><th>Quote</th><th>Work</th><th>Building</th><th>Tijori date</th><th class="r">Days</th></tr>' +
      (d.awaiting.slice(0, 8).map(function (a) {
        return '<tr><td>' + esc(a.qtn) + '</td><td>' + esc(cut(a.desc, 52)) + '</td><td>' + esc(cut(a.building, 18)) + '</td><td>' + esc(dLabel(a.tijoriDate)) + '</td><td class="r' + (a.days > d.waitingRedDays ? ' bad' : '') + '">' + (a.days === null ? '-' : a.days) + '</td></tr>';
      }).join('') || '<tr><td colspan="5">Nothing is waiting for an LPO.</td></tr>') + '</table>';

    var longest = P.waiting.filter(function (x) { return x.over; }).slice(0, 8);
    h += '<h2>Longest overdue works (all stages)</h2><table><tr><th>Quote</th><th>Work</th><th>Waiting at</th><th>Waiting for</th><th class="r">Days</th></tr>' +
      (longest.map(function (x) {
        return '<tr><td>' + esc(x.qtn) + '</td><td>' + esc(cut(x.desc, 40)) + '</td><td>' + esc(x.stage) + '</td><td>' + esc(cut(x.next, 34)) + '</td><td class="r bad">' + x.days + '</td></tr>';
      }).join('') || '<tr><td colspan="5">Nothing is overdue.</td></tr>') + '</table>';

    h += '<div class="pr-foot">LPO value = SAP TotCosPlan (excl. VAT). Pipeline cost = tracker "Total WASL Cost". Only works approved by WASL and uploaded in Tijori can receive an LPO. ' +
      'Overdue = waiting longer than ' + P.stages.slice(0, 6).map(function (x) { return x.limit + 'd at "' + x.name + '"'; }).join(', ') + '. ' +
      k.needsChecking + ' SAP orders need checking (see the dashboard).</div>';
    $('wl-printarea').innerHTML = h;
  }

  $('wl-print').addEventListener('click', function () {
    if (!DATA) return;
    buildPrint();
    setTimeout(function () { try { window.print(); } catch (e) { alert('Press Ctrl+P to print.'); } }, 100);
  });
})();
