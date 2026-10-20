/* ---------------- v35: Dashboard showpiece (looks only). Reads ST.works after the tracker loads. Writes nothing. ---------------- */
(function () {
  'use strict';
  var host = document.getElementById('dx-show');
  if (!host) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function e(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function aed(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : num(n); }
  function count(el) {
    var to = Number(el.getAttribute('data-to')) || 0, fmt = el.getAttribute('data-fmt');
    var show = function (v) { el.textContent = fmt === 'aed' ? 'AED ' + aed(v) : num(v); };
    if (reduce || to < 2) { show(to); return; }
    var t0 = null, dur = 1300;
    (function f(t) { if (t0 === null) t0 = t; var p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 4); show(to * k); if (p < 1) requestAnimationFrame(f); else show(to); })(performance.now());
  }
  function smooth(pts) {
    if (pts.length < 2) return '';
    var d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2;
      d += ' C' + mx + ',' + a[1] + ' ' + mx + ',' + b[1] + ' ' + b[0] + ',' + b[1];
    }
    return d;
  }
  function render() {
    if (typeof ST === 'undefined' || !ST.works) return;
    var ws = ST.works.filter(function (w) { return w.group !== 'cancelled'; }), n = ws.length;
    if (!n) { host.innerHTML = ''; return; }
    var meta = STATUS_META, order = STATUS_ORDER, cnt = {}, val = 0, hrs = new Date().getHours();
    order.forEach(function (k) { cnt[k] = 0; });
    ws.forEach(function (w) { cnt[w.group] = (cnt[w.group] || 0) + 1; val += w.waslCost || 0; });
    var greet = hrs < 12 ? 'Good morning' : hrs < 18 ? 'Good afternoon' : 'Good evening';

    /* hero */
    var pill = function (k) { return '<div class="dx-pill" style="--c:' + meta[k].color + '"><b class="dx-c" data-to="' + (cnt[k] || 0) + '">0</b><span>' + e(meta[k].label) + '</span></div>'; };
    var hero = '<div class="dx-hero dx-in" style="--s:0"><i class="dx-blob a"></i><i class="dx-blob b"></i><i class="dx-blob c"></i><i class="dx-grid"></i>' +
      '<div class="dx-kick">' + e(greet) + ' · Wasl DD works · ' + e(typeof fmtDate === 'function' && DASH.today ? fmtDate(DASH.today) : '') + '</div>' +
      '<div class="dx-big"><div><div class="n dx-c" data-to="' + n + '">0</div><div class="l">works in the tracker</div></div>' +
      '<div><div class="v dx-c" data-fmt="aed" data-to="' + Math.round(val) + '">0</div><div class="l">total WASL value</div></div></div>' +
      '<div class="dx-pills">' + ['awaiting', 'scheduled', 'inprogress', 'completed', 'completed_po'].map(pill).join('') + '</div></div>';

    /* donut */
    var R = 54, C = 2 * Math.PI * R, off = 0, segs = '', leg = '';
    order.forEach(function (k, i) {
      var c = cnt[k] || 0; if (!c) return;
      var len = c / n * C;
      segs += '<circle class="dx-seg" cx="70" cy="70" r="' + R + '" stroke="' + meta[k].color + '" style="--d:' + (i * 0.12) + 's" stroke-dasharray="' + Math.max(0, len - 2).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"></circle>';
      off += len;
    });
    order.forEach(function (k) { leg += '<div style="--c:' + meta[k].color + '"><i></i>' + e(meta[k].label) + '<b>' + (cnt[k] || 0) + '</b></div>'; });
    var donut = '<div class="dx-card c5 dx-in" style="--s:1"><h3>Works by status</h3><div class="dx-donut"><div style="position:relative;width:176px;height:176px"><svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="' + R + '" fill="none" stroke="var(--bg)" stroke-width="15"></circle>' + segs + '</svg><div class="dx-mid"><div><b class="dx-c" data-to="' + n + '">0</b><span>works</span></div></div></div><div class="dx-leg">' + leg + '</div></div></div>';

    /* works per month */
    var mc = {}; ws.forEach(function (w) { if (w.monthKey) mc[w.monthKey] = (mc[w.monthKey] || 0) + 1; });
    var keys = Object.keys(mc).sort().slice(-12), mx = Math.max.apply(null, keys.map(function (k) { return mc[k]; }).concat([1]));
    var W = 600, H = 190, pl = 20, pr = 20, pt = 28, pb = 28, pts = keys.map(function (k, i) { return [pl + (keys.length < 2 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (keys.length - 1)), pt + (1 - mc[k] / mx) * (H - pt - pb)]; });
    var line = smooth(pts), area = pts.length > 1 ? line + ' L' + pts[pts.length - 1][0] + ',' + (H - pb) + ' L' + pts[0][0] + ',' + (H - pb) + ' Z' : '';
    var svg = '<svg class="dx-area" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Works per month"><defs><linearGradient id="dxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--dxa)" stop-opacity=".42"></stop><stop offset="1" stop-color="var(--dxa)" stop-opacity="0"></stop></linearGradient></defs>' +
      [0.25, 0.5, 0.75].map(function (f) { var y = pt + f * (H - pt - pb); return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="var(--border)" stroke-dasharray="3 5"></line>'; }).join('') +
      (area ? '<path class="dx-fill" d="' + area + '" fill="url(#dxg)"></path>' : '') + (line ? '<path class="dx-line" pathLength="1" d="' + line + '"></path>' : '') +
      pts.map(function (p, i) { return '<circle class="dx-dot" style="--i:' + i + '" cx="' + p[0] + '" cy="' + p[1] + '" r="5"></circle><text class="dx-val" x="' + p[0] + '" y="' + (p[1] - 10) + '">' + mc[keys[i]] + '</text><text class="dx-lbl" x="' + p[0] + '" y="' + (H - 8) + '">' + e(typeof fmtMonthShort === 'function' ? fmtMonthShort(keys[i]) : keys[i]) + '</text>'; }).join('') + '</svg>';
    var months = '<div class="dx-card c7 dx-in" style="--s:2"><h3>Works per month<small>last ' + keys.length + ' months</small></h3><div class="dx-wrap">' + (keys.length ? svg : '<p class="view-sub">No dated works yet.</p>') + '</div></div>';

    /* pipeline */
    var yesK = function (w) { return String(w.approvedKey || '') === 'yes'; };
    var stepsF = [['Quoted', n], ['WASL approved', ws.filter(yesK).length], ['Tijori uploaded', ws.filter(function (w) { return w.tijoriKey === 'yes'; }).length], ['RF raised', ws.filter(function (w) { return !!w.rf; }).length],
      ['PO / LPO in', ws.filter(function (w) { return !!(w.po || w.lpo); }).length], ['Work completed', ws.filter(function (w) { return w.group === 'completed' || w.group === 'completed_po'; }).length],
      ['WCR done', ws.filter(function (w) { return w.wcrStage === 'done'; }).length], ['Invoiced', ws.filter(function (w) { return !!w.invoice; }).length]];
    var fun = '<div class="dx-card c8 dx-in" style="--s:3"><h3>From quote to invoice<small>every step, all months</small></h3><div class="dx-fun">' + stepsF.map(function (s, i) {
      var pc = n ? Math.round(s[1] / n * 100) : 0;
      return '<div class="dx-f"><span class="t">' + e(s[0]) + '</span><span class="bar"><i style="--w:' + Math.max(pc, s[1] ? 2 : 0) + '%;--i:' + i + '"></i></span><span class="v"><span class="dx-c" data-to="' + s[1] + '">0</span><small>' + pc + '%</small></span></div>';
    }).join('') + '</div></div>';

    /* work types */
    var tc = {}; ws.forEach(function (w) { var k = w.minor || 'Uncategorised'; tc[k] = (tc[k] || 0) + 1; });
    var top = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; }).slice(0, 6), tm = Math.max.apply(null, top.map(function (k) { return tc[k]; }).concat([1]));
    var pal = ['#7C3AED', '#2563EB', '#0F766E', '#D97706', '#DB2777', '#0891B2'];
    var types = '<div class="dx-card c4 dx-in" style="--s:4"><h3>Top work types</h3><div class="dx-types">' + top.map(function (k, i) {
      return '<div class="dx-t"><span class="t" title="' + e(k) + '">' + e(k) + '</span><span class="bar"><i style="--w:' + Math.round(tc[k] / tm * 100) + '%;--c:' + pal[i % pal.length] + ';--i:' + i + '"></i></span><span class="n">' + tc[k] + '</span></div>';
    }).join('') + '</div></div>';

    /* needs attention */
    var pend = typeof PENDING_STAGES !== 'undefined' ? PENDING_STAGES : [];
    var att = [['docs', 'RFs to raise', ws.filter(function (w) { return w.needsRF; }).length, 'Approved by WASL, no RF yet', '#7C3AED', 'Open in Job Desk'],
      ['tij', 'Tijori uploads', ws.filter(function (w) { return w.needsTijori; }).length, 'Approved, not uploaded to Tijori', '#2563EB', 'Open in Job Desk'],
      ['wcr', 'WCRs outstanding', ws.filter(function (w) { return pend.indexOf(w.wcrStage) > -1; }).length, 'Completed, WCR not signed and in SAP', '#D97706', 'Open in Job Desk'],
      ['fix', 'Data to fix', ws.filter(function (w) { return w.issues && w.issues.length; }).length, 'Missing status or unreadable dates', '#DB2777', 'Open in Job Desk']];
    var attention = '<div class="dx-card dx-in" style="--s:5"><h3>Needs your attention<small>tap one to work on it in the Job Desk</small></h3><div class="dx-att">' + att.map(function (a) {
      return '<button type="button" class="dx-bub" data-go="' + a[0] + '" style="--c:' + a[4] + '"><div class="n dx-c" data-to="' + a[2] + '">0</div><div class="t">' + e(a[1]) + '</div><div class="d">' + e(a[3]) + '</div><div class="go">' + e(a[5]) + ' →</div></button>';
    }).join('') + '</div></div>';

    /* longest waiting */
    var wait = ws.filter(function (w) { return w.actionAge != null && w.actionAge > 0; }).sort(function (a, b) { return b.actionAge - a.actionAge; }).slice(0, 5);
    var waitH = wait.length ? '<div class="dx-card dx-in" style="--s:6"><h3>Waiting the longest<small>click one to open it</small></h3><div class="dx-wait">' + wait.map(function (w) {
      return '<button type="button" class="dx-w" data-open="' + e(w.id) + '"><span class="m"><b>' + e(w.qtn) + ' · ' + e(w.desc) + '</b><span>' + e(w.building) + (w.crm ? ' · CRM ' + e(w.crm) : '') + '</span></span>' + (typeof ageChip === 'function' ? ageChip(w.actionAge) : '') + '</button>';
    }).join('') + '</div></div>' : '';

    host.innerHTML = hero + '<div class="dx-row">' + donut + months + '</div><div class="dx-row">' + fun + types + '</div>' + attention + waitH;
    host.querySelectorAll('.dx-c').forEach(count);
  }
  host.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-go]');
    if (b) { if (window.__vwDesk) window.__vwDesk.go(b.getAttribute('data-go')); return; }
    var o = ev.target.closest('[data-open]');
    if (o && typeof openDrawer === 'function') openDrawer(isNaN(Number(o.getAttribute('data-open'))) ? o.getAttribute('data-open') : Number(o.getAttribute('data-open')));
  });
  document.addEventListener('vw-dash-loaded', render);
  document.querySelectorAll('.nav-item[data-view="dash"]').forEach(function (n) { n.addEventListener('click', function () { setTimeout(render, 60); }); });
  if (typeof DASH !== 'undefined' && DASH.loaded) render();
})();
