  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const isMobile = () => window.matchMedia('(max-width:768px)').matches;

  /* v38: notices stack (newest at the bottom), show a timer bar and can carry a next step:
     toast('Saved')  or  toast('Saved', { actions: [{ label: 'Undo', run: fn }], ms: 6000 }).
     The same text twice in a row restarts the first notice instead of adding another. Hovering a notice pauses it. */
  const TOASTS = [];
  function toastStack() {
    let s = $('toast-stack');
    if (!s) { s = document.createElement('div'); s.id = 'toast-stack'; s.className = 'tst-stack'; s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite'); document.body.appendChild(s); }
    return s;
  }
  function toastGone(t) {
    const i = TOASTS.indexOf(t); if (i > -1) TOASTS.splice(i, 1);
    clearTimeout(t.timer); t.el.classList.add('out');
    setTimeout(() => { if (t.el.parentNode) t.el.parentNode.removeChild(t.el); }, 260);
  }
  function toastArm(t) {
    clearTimeout(t.timer); t.left = t.ms; t.from = Date.now();
    const bar = t.el.querySelector('.tst-bar');
    if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = 'tst-bar ' + t.ms + 'ms linear forwards'; }
    t.timer = setTimeout(() => toastGone(t), t.ms);
  }
  function toast(msg, opt) {
    opt = opt || {};
    const acts = (opt.actions || []).filter(a => a && a.label && typeof a.run === 'function');
    const text = String(msg == null ? '' : msg), last = TOASTS[TOASTS.length - 1];
    if (last && last.text === text && !acts.length && !last.acts.length) { toastArm(last); return last; }
    const el = document.createElement('div');
    el.className = 'tst' + (opt.kind ? ' ' + opt.kind : '');
    el.innerHTML = '<span class="tst-m"></span>' + acts.map((a, i) => '<button type="button" class="tst-a" data-i="' + i + '">' + esc(a.label) + '</button>').join('') +
      '<button type="button" class="tst-x" aria-label="Close">×</button><span class="tst-bar"></span>';
    el.querySelector('.tst-m').textContent = text;
    const t = { el, text, acts, ms: opt.ms || (acts.length ? 6500 : 2800), timer: null };
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('tst-x')) { toastGone(t); return; }
      const a = acts[Number(b.dataset.i)]; if (!a) return;
      toastGone(t); try { a.run(); } catch (er) { console.error(er); }
    });
    el.addEventListener('mouseenter', () => { clearTimeout(t.timer); el.classList.add('hold'); });
    el.addEventListener('mouseleave', () => { el.classList.remove('hold'); toastArm(t); });
    toastStack().appendChild(el); TOASTS.push(t);
    while (TOASTS.length > 3) toastGone(TOASTS[0]);
    toastArm(t);
    return t;
  }

  /* v38: one line per file while files go up to Drive: Reading, Uploading, In Drive (or what went wrong).
     const u = uploadTray('DD2026/08/00048'); const f = u.add(file.name); f.set('Uploading', 60); f.ok(); f.fail('Too big'); u.end(); */
  function uploadTray(title) {
    let p = $('upl-tray');
    if (!p) { p = document.createElement('div'); p.id = 'upl-tray'; p.className = 'upl-tray'; p.setAttribute('aria-live', 'polite'); document.body.appendChild(p); }
    clearTimeout(p._hide); p.classList.remove('out');
    const box = document.createElement('div'); box.className = 'upl-job';
    box.innerHTML = '<div class="upl-h"><b></b><span></span></div>';
    box.querySelector('b').textContent = title || 'Uploading';
    p.appendChild(box);
    const items = [];
    const count = () => { const ok = items.filter(i => i.state === 'ok').length; box.querySelector('.upl-h span').textContent = ok + ' of ' + items.length + ' in Drive'; };
    return {
      add(name) {
        const el = document.createElement('div'); el.className = 'upl-f';
        el.innerHTML = '<span class="upl-n"></span><span class="upl-s">Waiting</span><span class="upl-t"><i></i></span>';
        el.querySelector('.upl-n').textContent = name; box.appendChild(el);
        const it = { state: 'wait',
          set(stage, pct) { el.querySelector('.upl-s').textContent = stage; el.querySelector('i').style.width = Math.max(4, Math.min(100, pct || 0)) + '%'; },
          ok() { it.state = 'ok'; el.classList.add('ok'); it.set('In Drive ✓', 100); count(); },
          fail(m) { it.state = 'bad'; el.classList.add('bad'); it.set(m || 'Not uploaded', 100); count(); } };
        items.push(it); count(); return it;
      },
      end() {
        const bad = items.some(i => i.state === 'bad');
        box.classList.add(bad ? 'bad' : 'ok');
        setTimeout(() => {
          box.classList.add('out');
          setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); if (!p.querySelector('.upl-job')) p.classList.add('out'); }, 300);
        }, bad ? 9000 : 2600);
      }
    };
  }

  /* =====================================================================
     NAVIGATION
  ===================================================================== */
  function showView(name) {
    $('view-dash').style.display = name === 'dash' ? '' : 'none';
    $('view-breakdown').style.display = name === 'breakdown' ? '' : 'none';
    $('view-work').style.display = name === 'work' ? '' : 'none';
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    $('content').scrollTop = 0;
    closeDrawer();
    if (isMobile()) closeMobileNav();
  }
  document.querySelectorAll('.nav-item[data-view]').forEach(n => {
    n.addEventListener('click', () => showView(n.dataset.view));
    n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showView(n.dataset.view); } });
  });

  function closeMobileNav() { $('sidebar').classList.remove('open'); $('nav-scrim').classList.remove('open'); }
  $('btn-menu').addEventListener('click', () => {
    if (isMobile()) {
      const open = $('sidebar').classList.toggle('open');
      $('nav-scrim').classList.toggle('open', open);
    } else {
      $('sidebar').classList.toggle('collapsed');
    }
  });
  $('nav-scrim').addEventListener('click', closeMobileNav);

  /* =====================================================================
     SETTINGS (from Code.gs)
  ===================================================================== */
  let S = null;                    // settings loaded from Code.gs (CONFIG box)
  let CROP = null;                 // photo shapes, taken from Code.gs
  let PX = 4;
  const PER_PAGE = 4;              // fixed (matches Code.gs)
  const GEN_LABEL = '📄 Compile &amp; Export Official Report';
  let photos = [];                 // { src, caption }

  google.script.run
    .withSuccessHandler(function (s) {
      S = s;
      CROP = { one: s.photoOneCol, two: s.photoTwoCol };
      PX = s.photoSharpness;

      document.title = s.appName;
      $('hdr-title').textContent = s.appName;
      $('dash-sub').dataset.sub = s.dashboardSubtitle || '';
      if (DASH.loaded) setDashSub();
      $('bd-title').textContent = s.appTitle;
      $('bd-sub').textContent = s.appSubtitle;
      if (s.logoUrl) { $('logo').src = s.logoUrl; $('logo').style.display = ''; }

      (s.statusOptions || []).forEach(function (o) {
        const opt = document.createElement('option');
        opt.textContent = o;
        opt.value = o;
        $('rep-status').appendChild(opt);
      });

      if (!s.showSidebar) {
        $('sidebar').style.display = 'none';
        $('btn-menu').style.display = 'none';
      }

      $('btn-preview').disabled = false;
      $('btn-generate').disabled = false;
      renderPhotos();
    })
    .withFailureHandler(function (err) {
      console.error('Settings failed', err);
      $('bd-settings-err').style.display = 'block';
      $('bd-settings-err').textContent = 'Could not load the report settings: ' + (err && err.message ? err.message : err) +
        ' Make sure you saved Code.gs and deployed a NEW version.';
    })
    .getSettings();


  /* =====================================================================
     DASHBOARD
  ===================================================================== */
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const STATUS_ORDER = ['awaiting','scheduled','inprogress','completed','completed_po','hold'];   // v16: cancelled works are not shown anywhere
  const STATUS_META = {
    awaiting:     { label:'Awaiting approval',       color:'#D97706' },
    scheduled:    { label:'Work scheduled',          color:'#2563EB' },
    inprogress:   { label:'In progress',             color:'#7C3AED' },
    completed:    { label:'Completed',               color:'#0D6E3F' },
    completed_po: { label:'Completed, awaiting PO',  color:'#0F766E' },
    hold:         { label:'On hold / other',         color:'#EA580C' },
    cancelled:    { label:'Cancelled',               color:'#94A3B8' }
  };
  const STAGES = [
    { k:'prepare', n:1, name:'To prepare',               short:'WCR: prepare' },
    { k:'send',    n:2, name:'To send to WASL',          short:'WCR: send' },
    { k:'sign',    n:3, name:'Awaiting WASL signature',  short:'WCR: signature' },
    { k:'sap',     n:4, name:'Signed, upload to SAP',    short:'WCR: SAP' }
  ];
  const PENDING_STAGES = STAGES.map(s => s.k);
  const QUICK_LABEL = {
    rf:'RFs to raise', tijori:'Tijori uploads', wcr:'WCRs outstanding', issues:'Data issues',
    'wcr:prepare':'WCR: to prepare', 'wcr:send':'WCR: to send', 'wcr:sign':'WCR: awaiting signature', 'wcr:sap':'WCR: upload to SAP'
  };

  const DASH = { loaded:false, today:'', generatedAt:'', ageAmber:7, ageRed:14 };
  const ST = { works:[], byId:{}, month:'', building:'', major:'', assignee:'', minor:'', status:'', quick:'', search:'',
               sortKey:'date', sortDir:'desc', shown:100 };

  // ---------- small formatters ----------
  const fmtNum = n => Math.round(n || 0).toLocaleString('en-US');
  const fmtAED = n => 'AED ' + fmtNum(n);
  function fmtDate(iso) { if (!iso) return ''; const p = iso.split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function fmtMonth(k) { if (k === '__none') return 'No date'; const p = k.split('-'); return MON[+p[1] - 1] + ' ' + p[0]; }
  function fmtMonthShort(k) { const p = k.split('-'); return MON[+p[1] - 1] + " '" + p[0].slice(2); }
  const yes = s => String(s || '').trim().toLowerCase() === 'yes';
  const t = x => x ? esc(x) : '';
  function ageClass(d) { return d >= DASH.ageRed ? 'age-bad' : d >= DASH.ageAmber ? 'age-warn' : 'age-ok'; }
  function ageChip(d) { return d == null ? '' : '<span class="age ' + ageClass(d) + '">' + d + (d === 1 ? ' day' : ' days') + '</span>'; }
  function setDashSub() {
    const parts = [];
    if ($('dash-sub').dataset.sub) parts.push($('dash-sub').dataset.sub);
    if (DASH.generatedAt) parts.push('Updated ' + DASH.generatedAt + '.');
    $('dash-sub').textContent = parts.join(' ');
  }

  // ---------- loading ----------
  function loadDashboard(force) {
    $('dash-error').style.display = 'none';
    $('btn-refresh').disabled = true;
    $('btn-export').disabled = true;
    if (!DASH.loaded) { $('dash-loading').style.display = 'flex'; }
    else { $('btn-refresh').textContent = '↻ Refreshing...'; }

    google.script.run
      .withSuccessHandler(function (d) {
        DASH.loaded = true;
        DASH.today = d.today; DASH.generatedAt = d.generatedAt; DASH.ageAmber = d.ageAmber; DASH.ageRed = d.ageRed;
        DASH.cancelled = {}; (d.cancelledQtns || []).forEach(function (q) { DASH.cancelled[q] = 1; });
        ST.works = (d.works || []).map(prepWork);
        ST.byId = {};
        ST.works.forEach(w => { ST.byId[w.id] = w; });

        if (d.warnings && d.warnings.length) { $('dash-warn').style.display = 'block'; $('dash-warn').textContent = d.warnings.join(' '); }
        else $('dash-warn').style.display = 'none';

        buildFilterOptions();
        syncControls();
        $('dash-loading').style.display = 'none';
        $('dash-body').style.display = 'block';
        setDashSub();
        renderAll();
        $('btn-refresh').disabled = false;
        $('btn-refresh').textContent = '↻ Refresh';
        $('btn-export').disabled = false;
        if (force) toast('Dashboard refreshed');
        document.dispatchEvent(new Event('vw-dash-loaded'));
      })
      .withFailureHandler(function (err) {
        $('dash-loading').style.display = 'none';
        const box = $('dash-error');
        box.style.display = 'block';
        box.innerHTML = '<b>Could not load the tracker.</b> ' + esc(err && err.message ? err.message : err) +
          ' <button class="btn btn-ghost btn-sm" id="btn-retry">Try again</button>';
        $('btn-retry').addEventListener('click', () => loadDashboard(true));
        $('btn-refresh').disabled = false;
        $('btn-refresh').textContent = '↻ Refresh';
        $('btn-export').disabled = !DASH.loaded;
        document.dispatchEvent(new Event('vw-dash-failed'));
      })
      .getDashboardData(!!force);
  }

  function prepWork(w) {
    w.group = (w.statusKey === 'hold' || w.statusKey === 'other' || w.statusKey === 'blank') ? 'hold' : w.statusKey;
    w._h = [w.qtn, w.crm, w.desc, w.building, w.apt, w.rf, w.po, w.pr, w.lpo, w.invoice, w.supplier, w.assignee, w.minor, w.cafmId, w.waslOrder, w.remarks]
      .join(' | ').toLowerCase();
    return w;
  }

  // ---------- filters ----------
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b)); }
  function fillSelect(id, firstLabel, values, labelFn) {
    const el = $(id);
    el.innerHTML = '<option value="">' + esc(firstLabel) + '</option>' +
      values.map(v => '<option value="' + esc(v) + '">' + esc(labelFn ? labelFn(v) : v) + '</option>').join('');
  }
  function buildFilterOptions() {
    const months = uniqueSorted(ST.works.map(w => w.monthKey)).reverse();
    const monthVals = months.slice();
    if (ST.works.some(w => !w.monthKey)) monthVals.push('__none');
    fillSelect('f-month', 'All months', monthVals, fmtMonth);
    fillSelect('f-building', 'All buildings', uniqueSorted(ST.works.map(w => w.building)));
    fillSelect('f-major', 'All categories', uniqueSorted(ST.works.map(w => w.major)));
    fillSelect('f-assignee', 'Everyone', uniqueSorted(ST.works.map(w => w.assignee)));
  }
  function syncControls() {
    $('f-month').value = ST.month;
    $('f-building').value = ST.building;
    $('f-major').value = ST.major;
    $('f-assignee').value = ST.assignee;
    if ($('f-search').value !== ST.search) $('f-search').value = ST.search;
  }

  const passBase   = w => (!ST.building || w.building === ST.building) && (!ST.major || w.major === ST.major) && (!ST.assignee || w.assignee === ST.assignee);
  const passMonth  = w => !ST.month || (ST.month === '__none' ? !w.monthKey : w.monthKey === ST.month);
  const passMinor  = w => !ST.minor || (w.minor || 'Uncategorised') === ST.minor;
  const passSearch = w => !ST.search || w._h.indexOf(ST.search) > -1;
  const passStatus = w => !ST.status || w.group === ST.status;
  function passQuick(w) {
    const q = ST.quick;
    if (!q) return true;
    if (q === 'rf') return w.needsRF;
    if (q === 'tijori') return w.needsTijori;
    if (q === 'wcr') return PENDING_STAGES.indexOf(w.wcrStage) > -1;
    if (q === 'issues') return w.issues.length > 0;
    if (q.indexOf('wcr:') === 0) return w.wcrStage === q.slice(4);
    return true;
  }

  function apply() { ST.shown = 100; renderAll(); }

  $('f-month').addEventListener('change', e => { ST.month = e.target.value; apply(); });
  $('f-building').addEventListener('change', e => { ST.building = e.target.value; apply(); });
  $('f-major').addEventListener('change', e => { ST.major = e.target.value; apply(); });
  $('f-assignee').addEventListener('change', e => { ST.assignee = e.target.value; apply(); });
  let searchTimer = null;
  $('f-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const v = e.target.value.trim().toLowerCase();
    searchTimer = setTimeout(() => { ST.search = v; apply(); }, 180);
  });

  // ---------- rendering ----------
  function renderAll() {
    renderActions();
    renderChips();
    renderKPIs();
    renderCharts();
    renderTable();
  }

  function oldest(arr, key) {
    let m = null;
    arr.forEach(w => { if (w[key] != null && (m === null || w[key] > m)) m = w[key]; });
    return m;
  }
  const sumCost = arr => arr.reduce((a, w) => a + (w.waslCost || 0), 0);

  function actCard(quick, tone, title, list, ageKey, desc) {
    const n = list.length;
    const age = ageKey ? oldest(list, ageKey) : null;
    return '<div class="act-card tone-' + tone + (ST.quick === quick ? ' active' : '') + '" data-quick="' + quick + '" tabindex="0" role="button">' +
      '<div class="act-title">' + esc(title) + '</div>' +
      '<div class="act-num' + (n === 0 ? ' zero' : '') + '">' + (n === 0 ? '✓ 0' : fmtNum(n)) + '</div>' +
      '<div class="act-meta">' + (n ? '<span>' + fmtAED(sumCost(list)) + '</span>' + (age != null ? '<span>Longest wait ' + ageChip(age) + '</span>' : '') : '<span>All clear</span>') + '</div>' +
      '<div class="act-desc">' + esc(desc) + '</div></div>';
  }

  function renderActions() {
    const base = ST.works.filter(passBase);
    const rf = base.filter(w => w.needsRF);
    const tj = base.filter(w => w.needsTijori);
    const dq = base.filter(w => w.issues.length > 0);
    const wcrAll = base.filter(w => PENDING_STAGES.indexOf(w.wcrStage) > -1);

    let wcr = '<div class="act-card wide tone-wcr' + (ST.quick === 'wcr' ? ' active' : '') + '" data-quick="wcr" tabindex="0" role="button">' +
      '<div class="act-title">WCRs outstanding</div>' +
      '<div class="act-num' + (wcrAll.length === 0 ? ' zero' : '') + '">' + (wcrAll.length === 0 ? '✓ 0' : fmtNum(wcrAll.length)) + '</div>' +
      '<div class="act-desc">Completed works whose WCR is not yet signed and in SAP</div>' +
      '<div class="stage-list">';
    STAGES.forEach(st => {
      const l = base.filter(w => w.wcrStage === st.k);
      const age = oldest(l, 'wcrAge');
      wcr += '<div class="stage-row' + (l.length === 0 ? ' empty' : '') + (ST.quick === 'wcr:' + st.k ? ' active' : '') + '" data-quick="wcr:' + st.k + '">' +
        '<span class="stage-n">' + st.n + '</span><span class="stage-name">' + esc(st.name) + '</span>' +
        '<span class="stage-count">' + l.length + '</span><span class="stage-age">' + (l.length && age != null ? ageChip(age) : '') + '</span></div>';
    });
    wcr += '</div></div>';

    $('action-grid').innerHTML =
      actCard('rf', 'rf', 'RFs to raise', rf, 'rfAge', 'Approved by WASL, no RF reference yet') +
      actCard('tijori', 'tj', 'Tijori uploads', tj, 'tijAge', 'Approved by WASL, not uploaded to Tijori') +
      wcr +
      actCard('issues', 'dq', 'Data to fix in the tracker', dq, null, 'Missing status or unreadable dates');
  }

  function filterLabel(key) {
    const L = { month: () => fmtMonth(ST.month), building: () => ST.building, major: () => ST.major, assignee: () => 'Assigned: ' + ST.assignee,
                minor: () => ST.minor, status: () => (STATUS_META[ST.status] || {}).label, quick: () => QUICK_LABEL[ST.quick], search: () => 'Search: ' + ST.search };
    return L[key]();
  }
  function renderChips() {
    const keys = ['month','building','major','assignee','minor','status','quick','search'].filter(k => ST[k]);
    $('chips').innerHTML = keys.length
      ? keys.map(k => '<span class="fchip">' + esc(filterLabel(k)) + '<button data-clear="' + k + '" aria-label="Remove filter">✕</button></span>').join('') +
        '<button class="clear-all" data-clear="all">Clear all</button>'
      : '';
  }
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('[data-clear]');
    if (!b) return;
    const k = b.dataset.clear;
    if (k === 'all') { ['month','building','major','assignee','minor','status','quick','search'].forEach(x => { ST[x] = ''; }); ST.sortKey = 'date'; ST.sortDir = 'desc'; }
    else { ST[k] = ''; if (k === 'quick') { ST.sortKey = 'date'; ST.sortDir = 'desc'; } }
    syncControls(); apply();
  });

  function renderKPIs() {
    const arr = ST.works.filter(w => passBase(w) && passMonth(w) && passMinor(w) && passSearch(w));
    const by = {};
    STATUS_ORDER.forEach(k => { by[k] = []; });
    arr.forEach(w => (by[w.group] || (by[w.group] = [])).push(w));
    const live = arr.filter(w => w.group !== 'cancelled');
    $('kpi-title').textContent = 'Overview: ' + (ST.month ? fmtMonth(ST.month) : 'all months');
    $('kpi-note').textContent = 'A work counts in its completion month once completed, otherwise in its quote month.';

    let html = '<div class="kpi' + (ST.status === '' ? ' active' : '') + '" data-kpi="all" style="--kc:var(--navy)" tabindex="0" role="button">' +
      '<div class="kpi-label">Total works</div><div class="kpi-num">' + fmtNum(arr.length) + '</div><div class="kpi-val">' + fmtAED(sumCost(live)) + '</div></div>';
    STATUS_ORDER.forEach(k => {
      const m = STATUS_META[k];
      html += '<div class="kpi' + (ST.status === k ? ' active' : '') + '" data-kpi="' + k + '" style="--kc:' + m.color + '" tabindex="0" role="button">' +
        '<div class="kpi-label">' + esc(m.label) + '</div><div class="kpi-num">' + fmtNum(by[k].length) + '</div><div class="kpi-val">' + fmtAED(sumCost(by[k])) + '</div></div>';
    });
    $('kpi-grid').innerHTML = html;
  }

  function renderCharts() {
    // 1. Status (follows month filter)
    const arr = ST.works.filter(w => passBase(w) && passMonth(w) && passMinor(w) && passSearch(w));
    const cnt = {}; STATUS_ORDER.forEach(k => { cnt[k] = 0; });
    arr.forEach(w => { cnt[w.group]++; });
    const maxS = Math.max(1, ...STATUS_ORDER.map(k => cnt[k]));
    $('chart-status').innerHTML = arr.length ? STATUS_ORDER.map(k =>
      '<div class="hbar' + (ST.status === k ? ' sel' : '') + '" data-status="' + k + '"><span class="hb-lbl" title="' + esc(STATUS_META[k].label) + '">' + esc(STATUS_META[k].label) +
      '</span><span class="hb-track"><span class="hb-fill" style="width:' + (cnt[k] / maxS * 100) + '%;background:' + STATUS_META[k].color + '"></span></span><span class="hb-n">' + cnt[k] + '</span></div>'
    ).join('') : '<div class="empty-note">No works match these filters.</div>';

    // 2. Per month (ignores the month filter so you can pick one)
    const mc = {};
    ST.works.filter(w => passBase(w) && passMinor(w) && passSearch(w) && w.monthKey).forEach(w => { mc[w.monthKey] = (mc[w.monthKey] || 0) + 1; });
    const keys = Object.keys(mc).sort().slice(-12);
    const maxM = Math.max(1, ...keys.map(k => mc[k]));
    $('chart-month').innerHTML = keys.length ? '<div class="vbars">' + keys.map(k =>
      '<div class="vbar' + (ST.month === k ? ' sel' : '') + '" data-month="' + k + '" title="' + esc(fmtMonth(k)) + ': ' + mc[k] + ' works"><div class="vb-num">' + mc[k] +
      '</div><div class="vb-wrap"><div class="vb-col" style="height:' + Math.max(3, mc[k] / maxM * 100) + '%"></div></div><div class="vb-lbl">' + fmtMonthShort(k) + '</div></div>'
    ).join('') + '</div>' : '<div class="empty-note">No dated works yet.</div>';

    // 3. Work types (ignores the work-type filter so you can pick another)
    const cc = {};
    ST.works.filter(w => passBase(w) && passMonth(w) && passSearch(w)).forEach(w => { const k = w.minor || 'Uncategorised'; cc[k] = (cc[k] || 0) + 1; });
    const top = Object.keys(cc).sort((a, b) => cc[b] - cc[a]).slice(0, 8);
    const maxC = Math.max(1, ...top.map(k => cc[k]));
    $('chart-cat').innerHTML = top.length ? top.map(k =>
      '<div class="hbar' + (ST.minor === k ? ' sel' : '') + '" data-minor="' + esc(k) + '"><span class="hb-lbl" title="' + esc(k) + '">' + esc(k) +
      '</span><span class="hb-track"><span class="hb-fill" style="width:' + (cc[k] / maxC * 100) + '%;background:var(--navy-lt)"></span></span><span class="hb-n">' + cc[k] + '</span></div>'
    ).join('') : '<div class="empty-note">No works match these filters.</div>';
  }

  function pills(w) {
    let h = '';
    if (w.rf) h += '<span class="pill ok" title="RF ' + esc(w.rf) + '">RF ✓</span>';
    else if (w.needsRF) h += '<span class="pill bad">RF needed</span>';
    else h += '<span class="pill mute">RF</span>';

    if (w.tijoriKey === 'yes') h += '<span class="pill ok">Tijori ✓</span>';
    else if (w.needsTijori) h += '<span class="pill bad">Tijori needed</span>';
    else h += '<span class="pill mute">Tijori</span>';

    const st = STAGES.filter(s => s.k === w.wcrStage)[0];
    if (w.wcrStage === 'done') h += '<span class="pill ok">WCR ✓</span>';
    else if (st) h += '<span class="pill warn">' + esc(st.short) + '</span>';
    else h += '<span class="pill mute">WCR</span>';

    if (w.issues.length) h += '<span class="pill warn" title="' + esc(w.issues.join('; ')) + '">⚠ Data</span>';
    return '<div class="pills">' + h + '</div>';
  }

  const SORTERS = {
    qtn:    w => w.qtn,
    status: w => STATUS_ORDER.indexOf(w.group),
    cost:   w => w.waslCost || 0,
    date:   w => w.dateBasis || '',
    age:    w => w.actionAge == null ? -1 : w.actionAge
  };

  function tableRows() {
    const rows = ST.works.filter(w => passBase(w) && passMonth(w) && passMinor(w) && passSearch(w) && passStatus(w) && passQuick(w));
    const f = SORTERS[ST.sortKey] || SORTERS.date;
    const dir = ST.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const x = f(a), y = f(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return a.qtn < b.qtn ? -1 : a.qtn > b.qtn ? 1 : 0;
    });
    return rows;
  }

  function renderTable() {
    const rows = tableRows();
    const shown = rows.slice(0, ST.shown);
    $('tbl-title').textContent = 'Works (' + fmtNum(rows.length) + ')';
    $('tbl-sub').textContent = rows.length ? fmtAED(sumCost(rows.filter(w => w.group !== 'cancelled'))) : '';

    document.querySelectorAll('.tbl th[data-sort]').forEach(th => {
      const on = th.dataset.sort === ST.sortKey;
      th.classList.toggle('sorted', on);
      th.dataset.arrow = on ? (ST.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + th.dataset.arrow;
    });

    if (!rows.length) {
      $('tbl-body').innerHTML = '<tr><td colspan="7"><div class="empty-note">No works match these filters. Clear a filter above to see more.</div></td></tr>';
      $('tbl-more').style.display = 'none';
      return;
    }
    $('tbl-body').innerHTML = shown.map(w => {
      const label = STATUS_META[w.group] && w.group !== 'hold' ? w.status : (w.status || 'No status');
      const dt = w.dateBasis ? fmtDate(w.dateBasis) + '<div class="t-sub">' + (w.basisType === 'completion' ? 'Completed' : 'Quoted') + '</div>' : '<span class="muted">No date</span>';
      return '<tr data-id="' + w.id + '" tabindex="0">' +
        '<td><div class="t-ref">' + esc(w.qtn || '-') + '</div><div class="t-sub">' + esc(w.crm) + '</div></td>' +
        '<td><div class="t-desc" title="' + esc(w.desc) + '">' + esc(w.desc) + '</div><div class="t-bldg">' + esc(w.building) + (w.apt ? ' · ' + esc(w.apt) : '') + '</div></td>' +
        '<td><span class="chip s-' + w.group + '" title="' + esc(label) + '">' + esc(label) + '</span></td>' +
        '<td>' + pills(w) + '</td>' +
        '<td class="num">' + (w.waslCost ? fmtNum(w.waslCost) : '<span class="muted">-</span>') + '</td>' +
        '<td>' + dt + '</td>' +
        '<td>' + (w.actionAge != null ? ageChip(w.actionAge) : '') + '</td></tr>';
    }).join('');
    $('tbl-more').style.display = rows.length > shown.length ? 'block' : 'none';
    $('btn-more').textContent = 'Show more (' + (rows.length - shown.length) + ' left)';
  }

  // ---------- clicks ----------
  function setQuick(q) {
    if (ST.quick === q) { ST.quick = ''; ST.sortKey = 'date'; ST.sortDir = 'desc'; }
    else {
      ST.quick = q; ST.month = ''; ST.status = ''; ST.minor = ''; ST.search = '';
      ST.sortKey = q === 'issues' ? 'date' : 'age'; ST.sortDir = 'desc';
    }
    syncControls(); apply();
    if (ST.quick) $('tbl-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('action-grid').addEventListener('click', e => {
    const el = e.target.closest('[data-quick]');
    if (el) setQuick(el.dataset.quick);
  });
  $('action-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-quick]');
    if (el) { e.preventDefault(); setQuick(el.dataset.quick); }
  });
  function kpiClick(el) {
    const k = el.dataset.kpi;
    ST.status = (k === 'all' || ST.status === k) ? '' : k;
    apply();
  }
  $('kpi-grid').addEventListener('click', e => { const el = e.target.closest('[data-kpi]'); if (el) kpiClick(el); });
  $('kpi-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-kpi]');
    if (el) { e.preventDefault(); kpiClick(el); }
  });
  $('chart-status').addEventListener('click', e => { const el = e.target.closest('[data-status]'); if (el) { ST.status = ST.status === el.dataset.status ? '' : el.dataset.status; apply(); } });
  $('chart-month').addEventListener('click', e => { const el = e.target.closest('[data-month]'); if (el) { ST.month = ST.month === el.dataset.month ? '' : el.dataset.month; syncControls(); apply(); } });
  $('chart-cat').addEventListener('click', e => { const el = e.target.closest('[data-minor]'); if (el) { ST.minor = ST.minor === el.dataset.minor ? '' : el.dataset.minor; apply(); } });
  $('btn-more').addEventListener('click', () => { ST.shown += 100; renderTable(); });
  $('btn-refresh').addEventListener('click', () => loadDashboard(true));

  document.querySelector('.tbl thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const k = th.dataset.sort;
    if (ST.sortKey === k) ST.sortDir = ST.sortDir === 'asc' ? 'desc' : 'asc';
    else { ST.sortKey = k; ST.sortDir = (k === 'qtn' || k === 'status') ? 'asc' : 'desc'; }
    ST.shown = 100; renderTable();
  });
  $('tbl-body').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openDrawer(+tr.dataset.id); });
  $('tbl-body').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDrawer(+tr.dataset.id);
  });

  // ---------- detail panel ----------
  function it(label, valueHtml, full) {
    const v = (valueHtml === '' || valueHtml == null) ? '<span class="muted">-</span>' : valueHtml;
    return '<div class="d-item' + (full ? ' full' : '') + '"><div class="d-lbl">' + esc(label) + '</div><div class="d-val">' + v + '</div></div>';
  }
  function sec(title, inner) { return '<div class="d-sec"><div class="d-title">' + esc(title) + '</div>' + inner + '</div>'; }
  function refWithDate(ref, date) { return ref ? esc(ref) + (date ? ' <span class="muted">(' + fmtDate(date) + ')</span>' : '') : ''; }

  function openDrawer(id) {
    const w = ST.byId[id];
    if (!w) return;
    $('dh-ref').textContent = w.qtn || 'Work';
    $('dh-sub').textContent = [w.crm ? 'CRM ' + w.crm : '', w.status || 'No status'].filter(Boolean).join('  ·  ');

    // To-do box
    const todo = [];
    if (w.needsRF) todo.push('<li>Raise the RF for this work ' + ageChip(w.rfAge) + '</li>');
    if (w.needsTijori) todo.push('<li>Upload the quote to Tijori ' + ageChip(w.tijAge) + '</li>');
    const stg = STAGES.filter(s => s.k === w.wcrStage)[0];
    if (stg) todo.push('<li>WCR: ' + esc(stg.name.charAt(0).toLowerCase() + stg.name.slice(1)) + ' ' + ageChip(w.wcrAge) + '</li>');
    w.issues.forEach(i => todo.push('<li>⚠ ' + esc(i) + '</li>'));
    let html = todo.length
      ? '<div class="todo bad"><div class="todo-title">Needs action</div><ul>' + todo.join('') + '</ul></div>'
      : '<div class="todo good">✓ Nothing outstanding on this work.</div>';

    html += sec('Work',
      '<div class="d-grid">' +
      it('Description', t(w.desc), true) +
      it('Building', t(w.building), true) +
      it('Apartment / area', t(w.apt)) +
      it('Category', t([w.major, w.minor].filter(Boolean).join(' › '))) +
      it('Quote date', t(fmtDate(w.qtnDate))) +
      it('Assigned to', t(w.assignee)) +
      it('WASL engineer', t(w.engineer)) +
      it('Order type', t(w.orderType)) + '</div>');

    const margin = (w.waslCost && w.supCost) ? w.waslCost - w.supCost : null;
    html += sec('Commercials',
      '<div class="d-grid">' +
      it('Supplier', t(w.supplier), true) +
      it('Supplier cost', w.supCost ? fmtAED(w.supCost) : '') +
      it('WASL cost', w.waslCost ? fmtAED(w.waslCost) : '') +
      it('Margin', margin !== null ? fmtAED(margin) + ' <span class="muted">(' + (margin / w.waslCost * 100).toFixed(1) + '%)</span>' : '') + '</div>');

    html += sec('Approval and Tijori',
      '<div class="d-grid">' +
      it('Approved by WASL', t(w.approved)) +
      it('Uploaded to Tijori', t(w.tijori)) +
      it('Tijori upload date', t(fmtDate(w.tijoriDate))) + '</div>');

    html += sec('Orders and references',
      '<div class="d-grid">' +
      it('RF', refWithDate(w.rf, w.rfDate)) +
      it('PR', refWithDate(w.pr, w.prDate)) +
      it('PO', refWithDate(w.po, w.poDate)) +
      it('Invoice', refWithDate(w.invoice, w.invoiceDate)) +
      it('WASL order', refWithDate(w.waslOrder, w.waslPoDate)) +
      it('Purchase requisition', t(w.prq)) +
      it('LPO', t(w.lpo)) +
      it('GRN', t(w.grn)) + '</div>');

    html += sec('Execution',
      '<div class="d-grid">' +
      it('Works status', t(w.status)) +
      it('Work start', t(fmtDate(w.workStart))) +
      it('Completion date', t(fmtDate(w.completionDate))) +
      it('CAFM task ID', refWithDate(w.cafmId, w.cafmDate)) + '</div>');

    // WCR timeline (only when it is relevant)
    const showWcr = w.statusKey === 'completed' || w.statusKey === 'completed_po' || w.wcrPrepared || w.wcrSent || w.wcrSigned;
    if (showWcr) {
      const done = w.statusKey === 'completed' || w.statusKey === 'completed_po';
      const stepsDef = [
        { name:'Work completed',   done:done,                 date:w.completionDate },
        { name:'WCR prepared',     done:yes(w.wcrPrepared),   date:'' },
        { name:'Sent to WASL',     done:yes(w.wcrSent),       date:w.wcrSentDate },
        { name:'Signed by WASL',   done:yes(w.wcrSigned),     date:w.wcrSignedDate },
        { name:'Uploaded to SAP',  done:yes(w.wcrSap),        date:'' }
      ];
      const firstOpen = stepsDef.findIndex(s => !s.done);
      html += sec('WCR progress', '<div class="steps">' + stepsDef.map((s, i) =>
        '<div class="step' + (s.done ? ' done' : (i === firstOpen ? ' cur' : '')) + '"><span class="step-dot">' + (s.done ? '✓' : (i + 1)) + '</span><span class="step-name">' + esc(s.name) +
        '</span><span class="step-date">' + (s.date ? fmtDate(s.date) : '') + '</span></div>').join('') + '</div>');
    }

    if (w.wordUrl || w.pdfUrl) {
      html += sec('Quote files', '<div class="d-links">' +
        (w.pdfUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(w.pdfUrl) + '" target="_blank" rel="noopener">Open PDF</a>' : '') +
        (w.wordUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(w.wordUrl) + '" target="_blank" rel="noopener">Open Word</a>' : '') + '</div>');
    }
    if (window.__vwMarks && w.qtn) html += sec('Quote sent and GRN', '<div id="d-marks" class="d-grid"><div class="d-item full"><div class="d-val muted">Loading…</div></div></div>');
    if (w.remarks) html += sec('Remarks', '<div class="d-val" style="white-space:pre-wrap;">' + esc(w.remarks) + '</div>');
    html += '<div class="muted" style="font-size:11px;text-align:center;">Row ' + w.id + ' in ' + 'VW_Tracker' + (w.lastModifiedBy ? ' · last edited by ' + esc(w.lastModifiedBy) + (w.lastModifiedAt ? ' on ' + fmtDate(w.lastModifiedAt) : '') : '') + '</div>';

    $('drawer-body').innerHTML = html;
    $('drawer-body').scrollTop = 0;
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('drawer-scrim').classList.add('open');
    if (window.__vwMarks && w.qtn) window.__vwMarks.fill(w);
  }
  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('drawer-scrim').classList.remove('open');
  }
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); $('preview-modal').classList.remove('open'); } });

  // ---------- Export to Excel (exactly what the table shows now) ----------
  function wcrText(w) {
    const st = STAGES.filter(s => s.k === w.wcrStage)[0];
    if (w.wcrStage === 'done') return 'Done';
    return st ? st.name : '';
  }
  function exportExcel() {
    const rows = tableRows();
    if (!rows.length) { toast('Nothing to export: no works match the filters'); return; }
    const head = ['Quote ref','CRM ref','Quote date','Description','Major category','Minor category','Building','Apartment','Works status',
      'Approved by WASL','Uploaded to Tijori','Assigned to','Supplier','Supplier cost','WASL cost','Order type','WASL order','RF','RF date','PR','PO',
      'Invoice','GRN','Completion date','WCR prepared','WCR sent to WASL','WCR sent date','WCR signed by WASL','WCR signed date','WCR uploaded to SAP',
      'WCR step','Needs','Days waiting','Month','Data issues','Remarks'];
    const aoa = [head].concat(rows.map(w => {
      const needs = [];
      if (w.needsRF) needs.push('Raise RF');
      if (w.needsTijori) needs.push('Upload to Tijori');
      if (PENDING_STAGES.indexOf(w.wcrStage) > -1) needs.push('WCR: ' + wcrText(w));
      return [w.qtn, w.crm, fmtDate(w.qtnDate), w.desc, w.major, w.minor, w.building, w.apt, w.status,
        w.approved, w.tijori, w.assignee, w.supplier, w.supCost || '', w.waslCost || '', w.orderType, w.waslOrder, w.rf, fmtDate(w.rfDate), w.pr, w.po,
        w.invoice, w.grn, fmtDate(w.completionDate), w.wcrPrepared, w.wcrSent, fmtDate(w.wcrSentDate), w.wcrSigned, fmtDate(w.wcrSignedDate), w.wcrSap,
        wcrText(w), needs.join(', '), w.actionAge == null ? '' : w.actionAge, w.monthKey ? fmtMonth(w.monthKey) : '', w.issues.join('; '), w.remarks];
    }));

    const label = ST.quick ? QUICK_LABEL[ST.quick] : (ST.status ? STATUS_META[ST.status].label : (ST.month ? fmtMonth(ST.month) : 'All works'));
    const base = 'VW - ' + label.replace(/[^A-Za-z0-9 ,'-]+/g, '').trim() + ' - ' + (DASH.today || '');

    if (window.XLSX) {
      try {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const widths = [16,13,12,50,18,24,34,12,22,14,14,16,26,12,12,10,14,16,12,13,16,18,14,13,12,12,12,12,12,12,24,34,10,12,40,40];
        ws['!cols'] = widths.map(w => ({ wch: w }));
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:aoa.length - 1, c:head.length - 1 } }) };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Works');
        XLSX.writeFile(wb, base + '.xlsx');
        toast('Exported ' + rows.length + ' works to Excel');
        return;
      } catch (err) { console.error('XLSX export failed, using CSV', err); }
    }
    // Fallback: CSV (opens in Excel)
    const csv = '\uFEFF' + aoa.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = base + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Exported ' + rows.length + ' works (CSV, opens in Excel)');
  }
  $('btn-export').addEventListener('click', exportExcel);

  // Start. Separate links: add ?page=work, ?page=breakdown or ?page=dashboard to the web app link.
  // With no ?page= the whole app opens, with the side menu, as before.
  $('view-dash').style.display = 'none';
  function startPage(mode) {
    const views = { dashboard: 'dash', breakdown: 'breakdown', work: 'work' };
    if (views[mode]) {
      $('sidebar').style.display = 'none';
      $('btn-menu').style.display = 'none';
      $('nav-scrim').style.display = 'none';
    }
    showView(views[mode] || 'dash');
    if (!views[mode] || mode === 'dashboard') loadDashboard(false);
  }
  try {
    google.script.url.getLocation(function (loc) {
      startPage(String((loc && loc.parameter && loc.parameter.page) || '').toLowerCase().trim());
    });
  } catch (e) { startPage(''); }


  /* v31: Project health page (server: ProjectHealth.gs). Read only. */
  (function () {
    var PH = { d: null, at: 0, busy: false, step: '' };
    function e2(t) { return String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function aed(n) { return 'AED ' + Math.round(n || 0).toLocaleString('en-US'); }
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function shown() { var v = $('view-health'); return v && v.style.display !== 'none'; }
    document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
      function sync() { var on = n.dataset.view === 'health'; $('view-health').style.display = on ? '' : 'none'; if (on && (!PH.d || Date.now() - PH.at > 120000)) load(); }
      n.addEventListener('click', sync);
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
    });
    function load() {
      if (PH.busy) return; PH.busy = true;
      $('ph-error').style.display = 'none';
      if (!PH.d) { $('ph-loading').style.display = ''; $('ph-body').style.display = 'none'; }
      google.script.run.withSuccessHandler(function (d) { PH.busy = false; PH.d = d; PH.at = Date.now(); render(); })
        .withFailureHandler(function (er) { PH.busy = false; $('ph-loading').style.display = 'none'; $('ph-error').style.display = ''; $('ph-error').textContent = 'Could not work out the project health: ' + (er && er.message || er); })
        .projectHealth();
    }
    function ring(score, state) {
      var c = 2 * Math.PI * 56, f = score === null ? 0 : c * score / 100;
      var col = { green: '#16A34A', amber: '#D97706', red: '#DC2626', none: '#94A3B8' }[state];
      return '<svg width="124" height="124" viewBox="0 0 132 132" role="img" aria-label="Project health ' + (score === null ? 'not available' : score + ' out of 100') + '">' +
        '<circle cx="66" cy="66" r="56" fill="none" stroke="var(--border)" stroke-width="12"></circle>' +
        '<circle cx="66" cy="66" r="56" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + f.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 66 66)"></circle>' +
        '<text x="66" y="68" text-anchor="middle" font-size="34" font-weight="800" fill="var(--text)" font-family="inherit">' + (score === null ? '–' : score) + '</text>' +
        '<text x="66" y="90" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text-2)" font-family="inherit">out of 100</text></svg>';
    }
    function render() {
      var d = PH.d; if (!d) return;
      $('ph-loading').style.display = 'none'; $('ph-body').style.display = '';
      $('ph-sub').textContent = 'How the project is doing · VW_Tracker and Dynamics read ' + (d.readAt || '');
      var st = d.score === null ? 'none' : d.score >= 80 ? 'green' : d.score >= 55 ? 'amber' : 'red';
      var bad = d.lights.filter(function (l) { return l.state === 'amber' || l.state === 'red'; }).map(function (l) { return l.name; });
      var h = '<div class="ph-grid">';
      h += '<div class="ph-card"><div class="ph-score">' + ring(d.score, st) + '<div><span class="ph-pill ' + st + '">' + e2(d.verdict) + (d.slow ? ' · ' + d.slow + ' thing' + (d.slow > 1 ? 's' : '') + ' slowing it down' : '') + '</span>' +
        '<p>' + (bad.length ? 'Behind: ' + e2(bad.join(', ')) + '.' : 'Every light is green.') + '</p></div></div></div>';
      var dm = d.head.doneMonth - d.head.doneLastMonth;
      h += '<div class="ph-card ph-kpis">' +
        '<div><span>Open works</span><b>' + d.head.open + '</b><small>' + aed(d.head.openAed) + '</small></div>' +
        '<div><span>Completed this month</span><b>' + d.head.doneMonth + '</b><small class="' + (dm > 0 ? 'up' : '') + '">' + (dm > 0 ? '▲ ' + dm : dm < 0 ? '▼ ' + (-dm) : '=') + ' on last month</small></div>' +
        '<div><span>With WASL</span><b>' + d.head.withWasl + '</b><small>quotes not approved yet</small></div>' +
        '<div><span>Late</span><b class="' + (d.head.late ? 'bad' : '') + '">' + d.head.late + '</b><small>past their step\'s limit</small></div></div>';
      h += '<div class="ph-card"><div class="ph-h">What makes up the score<small>last 6 months</small></div><div class="ph-lights">' + d.lights.map(function (l) {
        var v = l.value === null || l.value === undefined ? 'no data' : (l.unit === '%' ? l.value + '%' : l.value + ' ' + l.unit);
        return '<i class="ph-dot ' + l.state + '" aria-hidden="true"></i><span>' + e2(l.name) + '<br><small style="color:var(--text-3)">' + e2(l.target) + '</small></span><em>' + e2(v) + '</em>';
      }).join('') + '</div></div></div>';
      // where every work stands
      var max = Math.max.apply(null, d.steps.map(function (s) { return s.n; }).concat([1]));
      h += '<div class="ph-card" style="margin-bottom:16px" id="ph-steps-card"><div class="ph-h">Where every work stands<small>Tap a step to list its works · red = past the step\'s limit</small></div><div class="ph-steps">' + d.steps.map(function (s, i) {
        return '<button type="button" class="ph-step' + (s.late ? ' late' : '') + (PH.step === s.k ? ' on' : '') + '" data-phstep="' + s.k + '" title="' + e2(s.hint) + '"><span class="t">' + (i + 1) + ' · ' + e2(s.name) + '</span><b>' + s.n + '</b><small>' + aed(s.aed) + (s.late ? ' · ' + s.late + ' late' : '') + '</small><i><s style="width:' + Math.round(100 * s.n / max) + '%"></s></i></button>';
      }).join('') + '</div>';
      var cur = d.steps.filter(function (s) { return s.k === PH.step; })[0];
      if (cur) h += '<div class="ph-list"><div class="ph-note" style="margin:10px 0 2px">' + e2(cur.hint) + ' · limit ' + cur.limit + ' days</div>' + (cur.works.length ? cur.works.map(function (w) {
        return '<button type="button" class="ph-row" data-phwork="' + w.id + '"><b>' + e2(w.qtn) + '</b><em class="' + (w.late ? 'late' : '') + '">' + (w.days === null ? '' : w.days + ' d') + '</em><span>' + e2([w.desc, w.building].filter(Boolean).join(' · ')) + '</span></button>';
      }).join('') : '<div class="ph-note">None.</div>') + '</div>';
      h += '</div>';
      // money, supervisors, holding back
      var mq = Math.max(d.money.quoted, 1);
      h += '<div class="ph-grid">';
      h += '<div class="ph-card"><div class="ph-h">Money in ' + e2(d.year) + '<small>by quote date</small></div><div class="ph-money">' + [['Quoted', d.money.quoted], ['Approved', d.money.approved], ['Completed', d.money.completed], ['Invoiced', d.money.invoiced]].map(function (m) {
        return '<div class="ph-mrow"><span>' + m[0] + '</span><i><s style="width:' + Math.round(100 * m[1] / mq) + '%"></s></i><b>' + Math.round(m[1]).toLocaleString('en-US') + '</b></div>';
      }).join('') + '</div><div class="ph-note">' + aed(Math.max(0, d.money.completed - d.money.invoiced)) + ' of completed work has no invoice number in the tracker.</div></div>';
      h += '<div class="ph-card"><div class="ph-h">By supervisor</div><div class="ph-sup"><span class="h">Supervisor</span><span class="h n">Open</span><span class="h n">Done (month)</span><span class="h n">Late</span>' + d.supervisors.map(function (s) {
        return '<span>' + e2(s.name) + ' <small>· ' + (s.codes.length ? s.codes.length + ' buildings' : 'other buildings') + '</small></span><b class="n">' + s.open + '</b><span class="n">' + s.done + '</span><span class="n ' + (s.late ? 'bad' : '') + '">' + s.late + '</span>';
      }).join('') + '</div></div>';
      h += '<div class="ph-card"><div class="ph-h">Holding the project back</div><div class="ph-hold">' + (d.hold.length ? d.hold.map(function (x) {
        return '<button type="button"' + (x.step ? ' data-phstep="' + x.step + '"' : '') + (x.go ? ' data-phgo="' + x.go + '"' : '') + '><b>' + e2(x.title) + '</b><span>' + e2(x.sub) + '</span></button>';
      }).join('') : '<div class="ph-note">Nothing is holding it back right now.</div>') + '</div></div>';
      h += '</div>';
      // approved vs completed by month
      var mm = Math.max.apply(null, d.months.map(function (m) { return Math.max(m.approved, m.completed); }).concat([1]));
      h += '<div class="ph-card"><div class="ph-h">Approved vs completed, by month<span class="ph-legend"><span><i style="background:color-mix(in srgb, var(--navy-lt) 35%, var(--bg-card))"></i>Approved</span><span><i style="background:var(--navy-lt)"></i>Completed</span></span></div>' +
        '<div class="ph-chart" role="img" aria-label="Works approved and completed per month">' + d.months.map(function (m) {
          return '<div title="' + e2(m.m) + ': ' + m.approved + ' approved, ' + m.completed + ' completed"><s class="a" style="height:' + Math.round(100 * m.approved / mm) + '%"></s><s class="c" style="height:' + Math.round(100 * m.completed / mm) + '%"></s></div>';
        }).join('') + '</div><div class="ph-months">' + d.months.map(function (m) { return '<span>' + MON[Number(m.m.substr(5, 2)) - 1] + '</span>'; }).join('') + '</div></div>';
      $('ph-body').innerHTML = h;
    }
    function openWorkId(id) {
      id = Number(id);
      if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
      var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
      document.addEventListener('vw-dash-loaded', once);
      if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
    }
    $('ph-body').addEventListener('click', function (e) {
      var s = e.target.closest('[data-phstep]');
      if (s) { var k = s.getAttribute('data-phstep'); PH.step = PH.step === k ? '' : k; render(); if (PH.step && !s.classList.contains('ph-step')) { var c = $('ph-steps-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
      var w = e.target.closest('[data-phwork]'); if (w) { openWorkId(w.getAttribute('data-phwork')); return; }
      var g = e.target.closest('[data-phgo]'); if (g) { var n = document.querySelector('.nav-item[data-view="' + g.getAttribute('data-phgo') + '"]'); if (n) n.click(); }
    });
    $('ph-refresh').addEventListener('click', function () { PH.at = 0; load(); });
  })();

  /* v29: System status on the Today page (server: SystemStatus.gs). Read only. */
  (function () {
    var SY = { at: 0, busy: false, open: false };
    function esc2(t) { return String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function draw(d) {
      var card = $('sys-card'); if (!card) return;
      card.style.display = '';
      var bad = d.items.filter(function (i) { return i.state === 'bad' || i.state === 'warn'; }).length;
      $('sys-dot').className = 'sys-dot ' + d.worst;
      $('sys-sum').textContent = bad ? 'System status: ' + bad + ' thing' + (bad === 1 ? ' needs' : 's need') + ' attention' : (d.worst === 'off' ? 'System status: all fine, the PC is off' : 'System status: everything is running');
      $('sys-list').innerHTML = d.items.map(function (i) {
        return '<div class="sys-it ' + i.state + '"><i class="sys-dot ' + i.state + '"></i><b>' + esc2(i.name) + '</b><span>' + esc2(i.text) + '</span>' + (i.detail ? '<small>' + esc2(i.detail) + '</small>' : '') + '</div>';
      }).join('');
      if (bad && !SY.at) toggle(true);
    }
    function toggle(on) { SY.open = on; $('sys-list').hidden = !on; $('sys-head').setAttribute('aria-expanded', on ? 'true' : 'false'); }
    function load() {
      if (SY.busy || typeof google === 'undefined' || !google.script) return;
      SY.busy = true;
      google.script.run.withSuccessHandler(function (d) { SY.busy = false; draw(d); SY.at = Date.now(); })
        .withFailureHandler(function () { SY.busy = false; SY.at = Date.now(); }).hubSystemStatus();
    }
    if ($('sys-head')) $('sys-head').addEventListener('click', function () { toggle(!SY.open); });
    function shown() { var v = $('view-today'); return v && v.style.display !== 'none' && !document.hidden; }
    setInterval(function () { if (shown() && Date.now() - SY.at > 120000) load(); }, 5000);
    if ($('td-refresh')) $('td-refresh').addEventListener('click', function () { SY.at = 0; load(); });
  })();

  /* =====================================================================
     BREAKDOWN REPORT  (unchanged logic)
  ===================================================================== */
  (function initDate() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('rep-date').value = now.toISOString().slice(0, 10);          // v22: date filled, time left empty (optional)
  })();

  $('photo-dropzone').addEventListener('click', () => { if (S) $('photo-input').click(); });

  // Which shape will photo #i get, based on how many photos are on its page?
  // v24: photos are kept whole (never cropped). 1-2 photos: portrait ones side by side, landscape ones one above the other.
  //      3-4 photos: 2 x 2. Each photo is fitted inside its cell.
  function isPortrait(p) { return p && p.h > p.w; }
  function pageLayout(group) {
    if (group.length <= 2 && group.some(isPortrait)) return { cols: 2, rows: 1, shape: { w: CROP.two.w, h: CROP.one.h * 2 } };
    if (group.length <= 2) return { cols: 1, rows: 2, shape: CROP.one };
    return { cols: 2, rows: 2, shape: CROP.two };
  }
  function shapeFor(i, n) {
    const start = Math.floor(i / PER_PAGE) * PER_PAGE;
    return pageLayout(photos.slice(start, start + PER_PAGE)).shape;
  }

  // ---------- Photos ----------
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
    });
  }

  // Shrinks the original for storage (cropping happens later, at export time).
  async function prepareImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const im = await loadImg(dataUrl);
    const scale = Math.min(1, S.photoMaxSide / Math.max(im.width, im.height));
    const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(im, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', S.photoJpegQuality);
  }

  // Centre "cover" crop to an exact shape; returns base64 JPEG.
  async function cropTo(src, box) {
    const im = await loadImg(src);
    const W = Math.round(box.w * PX), H = Math.round(box.h * PX);
    const scale = Math.max(W / im.width, H / im.height);
    const sw = W / scale, sh = H / scale;
    const sx = (im.width - sw) / 2, sy = (im.height - sh) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(im, sx, sy, sw, sh, 0, 0, W, H);
    return canvas.toDataURL('image/jpeg', S.photoJpegQuality).split(',')[1];
  }

  $('photo-input').addEventListener('change', async e => {
    if (!S) return;
    const files = Array.from(e.target.files);
    for (const file of files) {
      try { const src = await prepareImage(file), im = await loadImg(src); photos.push({ src: src, caption: '', w: im.width, h: im.height }); }
      catch (err) { console.error('Could not read image:', file.name, err); }
    }
    renderPhotos();
    $('photo-input').value = '';
  });

  function layoutText(n) {
    if (!n) return '';
    const pages = Math.ceil(n / PER_PAGE);
    const last = n % PER_PAGE === 0 ? PER_PAGE : n % PER_PAGE;
    const lastGroup = photos.slice(n - last), lp = pageLayout(lastGroup);
    const lastGrid = lp.rows === 1 ? 'side by side' : last <= 2 ? 'one above the other' : '2 × 2 grid' + (last === 3 ? ' (4th cell empty)' : '');
    if (pages === 1) return n + (n > 1 ? ' photos' : ' photo') + ' → 1 page, ' + lastGrid + '.';
    return n + ' photos → ' + pages + ' pages (' + (pages - 1) + ' full 2 × 2, last page: ' + lastGrid + ').';
  }

  function renderPhotos() {
    const grid = $('photo-grid');
    grid.innerHTML = '';
    if (!S) return;
    photos.forEach((p, i) => {
      const shape = shapeFor(i, photos.length);
      const div = document.createElement('div');
      div.className = 'photo-item';
      div.innerHTML =
        '<div class="photo-frame" style="aspect-ratio:' + shape.w + ' / ' + shape.h + ';"><img src="' + p.src + '"></div>' +
        '<span class="photo-num">' + (i + 1) + '</span>' +
        '<button type="button" class="photo-del" data-act="del" data-i="' + i + '" title="Remove">✕</button>' +
        '<input type="text" class="photo-cap" data-i="' + i + '" placeholder="Caption (optional)">' +
        '<div class="photo-move">' +
          '<button type="button" data-act="left" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
          '<button type="button" data-act="right" data-i="' + i + '"' + (i === photos.length - 1 ? ' disabled' : '') + '>▶</button>' +
        '</div>';
      div.querySelector('.photo-cap').value = p.caption || '';
      grid.appendChild(div);
    });
    const hint = $('layout-hint');
    hint.style.display = photos.length ? 'block' : 'none';
    hint.textContent = '📐 ' + layoutText(photos.length) + ' Photos are kept whole, never cropped; portrait photos sit side by side.';
  }

  $('photo-grid').addEventListener('input', e => {
    if (e.target.classList.contains('photo-cap')) photos[+e.target.dataset.i].caption = e.target.value;
  });
  $('photo-grid').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = +b.dataset.i, act = b.dataset.act;
    if (act === 'del') photos.splice(i, 1);
    if (act === 'left' && i > 0) [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]];
    if (act === 'right' && i < photos.length - 1) [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]];
    renderPhotos();
  });

  // ---------- Preview ----------
  $('btn-preview').addEventListener('click', () => {
    if (!S) return;
    const val = id => $(id).value.trim();
    const rows = [
      ['Location', val('rep-loc')],
      ['Breakdown Date & Time', bdWhen().replace('T', ' ')],
      ['Equipment Involved', val('rep-equipment')],
      ['Status / Estimated Duration', ($('rep-status').value || 'N/A') + '  |  ' + (val('rep-duration') || 'N/A')],
      ['Impact on Operations', val('rep-ops')],
      ['Impact on Tenants', val('rep-tenant')],
      ['Description', val('rep-desc')],
      ['Root Cause', val('rep-cause')],
      ['Immediate Containment / Actions Taken', val('rep-containment')],
      ['Scope of Repair & Costs', val('rep-scope')],
      ['Reported By', val('rep-by')],
      ['Tentative Completion Date', $('rep-completion').value]
    ];

    let html = '<h3 style="color:var(--navy);margin-bottom:15px;border-bottom:2px solid var(--border);padding-bottom:6px;">' +
      esc(val('rep-title') || '(No title)') + '</h3>';
    rows.forEach(r => {
      html += '<div class="preview-row"><div class="preview-label">' + esc(r[0]) + '</div><div class="preview-val">' + esc(r[1] || 'N/A') + '</div></div>';
    });

    if (photos.length) {
      html += '<div class="preview-label" style="margin-top:18px;">Photo pages (' + photos.length + ' photo' + (photos.length > 1 ? 's' : '') + ')</div>';
      for (let start = 0; start < photos.length; start += PER_PAGE) {
        const group = photos.slice(start, start + PER_PAGE);
        const lay = pageLayout(group), cols = lay.cols, shape = lay.shape;
        const maxW = cols === 1 ? 260 : 300;
        let cells = '';
        for (let c = 0; c < lay.rows * cols; c++) {
          const p = group[c];
          cells += '<div class="prev-cell" style="aspect-ratio:' + shape.w + ' / ' + shape.h + ';">' +
            (p ? '<img src="' + p.src + '">' : '') + '</div>';
        }
        html += '<div class="prev-page"><div class="prev-page-label">Page ' + (2 + start / PER_PAGE) + '</div>' +
          '<div class="prev-grid" style="grid-template-columns:repeat(' + cols + ',1fr);max-width:' + maxW + 'px;margin:0 auto;">' + cells + '</div></div>';
      }
    }

    $('preview-content').innerHTML = html;
    $('preview-modal').classList.add('open');
  });

  $('modal-close-btn').addEventListener('click', () => $('preview-modal').classList.remove('open'));
  $('preview-modal').addEventListener('click', e => {
    if (e.target === $('preview-modal')) $('preview-modal').classList.remove('open');
  });

  // v22: date + optional time -> "2026-10-16" or "2026-10-16T14:30"
  function bdWhen() { const d = $('rep-date').value, t = $('rep-time').value; return d ? d + (t ? 'T' + t : '') : ''; }
  window.__bdWhen = bdWhen;
  window.__bdClearPhotos = function () { photos = []; renderPhotos(); };
  // ---------- Clear ----------
  $('btn-cancel').addEventListener('click', () => {
    if (!confirm('Clear the whole form and all photos?')) return;
    ['rep-crm','rep-title','rep-loc','rep-desc','rep-cause','rep-containment','rep-scope',
     'rep-equipment','rep-duration','rep-ops','rep-tenant','rep-by','rep-completion'].forEach(id => { $(id).value = ''; });
    $('rep-status').value = '';
    if ($('rep-type')) $('rep-type').value = '';
    if ($('rep-time')) $('rep-time').value = '';
    photos = [];
    renderPhotos();
    $('result-box').style.display = 'none';
    document.dispatchEvent(new CustomEvent('bd-cleared'));
  });

  // ---------- Generate ----------
  $('btn-generate').addEventListener('click', async () => {
    if (!S) return;
    const btn = $('btn-generate');
    const title = $('rep-title').value.trim();
    const location = $('rep-loc').value.trim();
    const desc = $('rep-desc').value.trim();

    // REQUIRED FIELDS: Title, Location, Description. (Also mark with <span class="req">*</span> in the labels above.)
    if (!title || !location || !desc) {
      return alert('Please fill in the required fields: Title, Building & Location, and Description.');
    }

    btn.disabled = true;
    $('result-box').style.display = 'none';

    const outPhotos = [];
    try {
      if (photos.length) {
        btn.innerHTML = '<div class="spin" style="margin-right:8px;"></div> Preparing photos...';
        for (let i = 0; i < photos.length; i++) {
          outPhotos.push({
            base64: String(photos[i].src).split(',')[1],            // v24: the whole photo, not cropped
            mimeType: 'image/jpeg', w: photos[i].w || 0, h: photos[i].h || 0,
            caption: photos[i].caption
          });
        }
      }
    } catch (err) {
      alert('Could not prepare the photos: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = GEN_LABEL;
      return;
    }

    btn.innerHTML = '<div class="spin" style="margin-right:8px;"></div> Compiling Report...';

    const formData = {
      title, location, description: desc, crm: ($('rep-crm') ? $('rep-crm').value.trim() : ''),
      cause: $('rep-cause').value.trim(),
      containment: $('rep-containment').value.trim(),
      scope: $('rep-scope').value.trim(),
      breakdownDateTime: bdWhen(),
      equipment: $('rep-equipment').value.trim(),
      duration: $('rep-duration').value.trim(),
      opsImpact: $('rep-ops').value.trim(),
      tenantImpact: $('rep-tenant').value.trim(),
      status: $('rep-status').value,
      reportedBy: $('rep-by').value.trim(),
      tentativeCompletion: $('rep-completion').value,
      photos: outPhotos, linkQtn: (window.__vwDocsLink ? window.__vwDocsLink() : '')
    };

    google.script.run
      .withSuccessHandler(res => {
        $('link-pdf').href = res.pdfUrl;
        $('link-doc').href = res.docUrl;
        $('result-title').textContent = 'Report ' + res.ref + ' Compiled Successfully' + (res.filedIn ? ' - saved to Drive' + (res.linked ? ' and linked to the job' : '') : '');
        $('result-box').style.display = 'flex';
        btn.disabled = false;
        btn.innerHTML = GEN_LABEL;
        if (res.crmFolder) $('result-title').textContent += ' - filed in a new job folder for CRM ' + res.ref;
        if (res.linkedQtn && window.__vwPdfcAuto) window.__vwPdfcAuto(res.linkedQtn);      // v22: the job's Tijori PDF picks up the new report
      })
      .withFailureHandler(err => {
        alert('Document Generation Error: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = GEN_LABEL;
      })
      .generateBreakdownDocument(formData);
  });

  /* =====================================================================
     MONTHLY REPORT: ADD A WORK SLIDE
  ===================================================================== */
  let WSS = null;                  // settings from WorkSlides.gs
  let wsPhotos = [];               // { src, caption }
  const WS_LABEL = '➕ Add Slide to Report';

  google.script.run
    .withSuccessHandler(function (s) {
      WSS = s;
      $('ws-deck').textContent = s.deckName;

      s.people.forEach(function (g) {
        const og = document.createElement('optgroup');
        og.label = g.role;
        g.names.forEach(function (n) {
          const o = document.createElement('option');
          o.value = n; o.textContent = n;
          o.dataset.section = g.section === null || g.section === undefined ? '' : g.section;
          og.appendChild(o);
        });
        $('ws-person').appendChild(og);
      });
      s.sections.forEach(function (x) {
        const o = document.createElement('option'); o.value = x.value; o.textContent = x.label; $('ws-section').appendChild(o);
      });
      s.buildings.forEach(function (b) {
        const o = document.createElement('option'); o.value = b; o.textContent = b; $('ws-building').appendChild(o);
      });
      s.statuses.forEach(function (x) {
        const o = document.createElement('option'); o.value = x.name; o.textContent = x.name; $('ws-status').appendChild(o);
      });

      $('btn-ws-preview').disabled = false;
      $('btn-ws-submit').disabled = false;
      wsRender();
    })
    .withFailureHandler(function (err) {
      const b = $('ws-err');
      b.style.display = 'block';
      b.textContent = 'Could not load the form settings: ' + (err && err.message ? err.message : err) +
        ' Check WorkSlides.gs, save it, and deploy a NEW version.';
    })
    .getWorkSettings();

  // Picking a name pre-selects that person's usual section (they can still change it)
  $('ws-person').addEventListener('change', function () {
    const o = $('ws-person').selectedOptions[0];
    if (o && o.dataset && o.dataset.section !== '' && o.dataset.section !== undefined) $('ws-section').value = o.dataset.section;
  });

  function wsShapeFor(n) { return n === 2 ? WSS.shapes.two : WSS.shapes.four; }

  $('ws-dropzone').addEventListener('click', function () { if (S && WSS) $('ws-photo-input').click(); });

  $('ws-photo-input').addEventListener('change', async function (e) {
    if (!S || !WSS) return;
    const files = Array.from(e.target.files);
    let skipped = 0;
    for (const file of files) {
      if (wsPhotos.length >= WSS.maxPhotos) { skipped++; continue; }
      try { wsPhotos.push({ src: await prepareImage(file), caption: '' }); }
      catch (err) { console.error('Could not read image:', file.name, err); }
    }
    if (skipped) toast('Only ' + WSS.maxPhotos + ' photos are allowed: ' + skipped + ' not added');
    wsRender();
    $('ws-photo-input').value = '';
  });

  function wsRender() {
    const grid = $('ws-photo-grid');
    grid.innerHTML = '';
    if (!S || !WSS) return;
    const n = wsPhotos.length;
    const shape = wsShapeFor(n);
    wsPhotos.forEach(function (p, i) {
      const div = document.createElement('div');
      div.className = 'photo-item';
      div.innerHTML =
        '<div class="photo-frame" style="aspect-ratio:' + shape.w + ' / ' + shape.h + ';"><img src="' + p.src + '"></div>' +
        '<span class="photo-num">' + (i + 1) + '</span>' +
        '<button type="button" class="photo-del" data-act="del" data-i="' + i + '" title="Remove">✕</button>' +
        '<input type="text" class="photo-cap" data-i="' + i + '" maxlength="80" placeholder="Caption (optional)">' +
        '<div class="photo-move">' +
          '<button type="button" data-act="left" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
          '<button type="button" data-act="right" data-i="' + i + '"' + (i === n - 1 ? ' disabled' : '') + '>▶</button>' +
        '</div>';
      div.querySelector('.photo-cap').value = p.caption || '';
      grid.appendChild(div);
    });
    const hint = $('ws-count');
    hint.style.display = n ? 'block' : 'none';
    if (n === 2 || n === 4) { hint.textContent = '✓ ' + n + ' photos: the slide will show them in one row, cropped as in the thumbnails.'; hint.style.color = 'var(--success)'; }
    else { hint.textContent = '⚠ ' + n + ' photo' + (n === 1 ? '' : 's') + ' selected. You need exactly 2 or 4: ' + (n === 1 ? 'add 1 or 3 more.' : 'add 1 more or remove 1.'); hint.style.color = 'var(--danger)'; }
  }

  $('ws-photo-grid').addEventListener('input', function (e) {
    if (e.target.classList.contains('photo-cap')) wsPhotos[+e.target.dataset.i].caption = e.target.value;
  });
  $('ws-photo-grid').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = +b.dataset.i, act = b.dataset.act;
    if (act === 'del') wsPhotos.splice(i, 1);
    if (act === 'left' && i > 0) [wsPhotos[i - 1], wsPhotos[i]] = [wsPhotos[i], wsPhotos[i - 1]];
    if (act === 'right' && i < wsPhotos.length - 1) [wsPhotos[i + 1], wsPhotos[i]] = [wsPhotos[i], wsPhotos[i + 1]];
    wsRender();
  });

  function wsCrop(src, box) {
    return loadImg(src).then(function (im) {
      const px = WSS.sharpness || 3;
      const W = Math.round(box.w * px), H = Math.round(box.h * px);
      const scale = Math.max(W / im.width, H / im.height);
      const sw = W / scale, sh = H / scale;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, W, H);
      return canvas.toDataURL('image/jpeg', S.photoJpegQuality).split(',')[1];
    });
  }

  function wsStatusColor(name) {
    const s = WSS.statuses.filter(function (x) { return x.name === name; })[0];
    return s ? s.color : '#fff';
  }

  // Returns a message if something is missing, else ''
  function wsProblem() {
    if (!$('ws-person').value) return 'Please choose your name.';
    if ($('ws-section').value === '') return 'Please choose the section.';
    if (!$('ws-building').value) return 'Please choose the building.';
    if (!$('ws-status').value) return 'Please choose the status.';
    if (!$('ws-title').value.trim()) return 'Please enter the work title.';
    const n = wsPhotos.length;
    if (n !== 2 && n !== 4) return 'Please add exactly 2 or 4 photos (you have ' + n + ').';
    return '';
  }

  // ---------- Preview (a sketch of the slide) ----------
  $('btn-ws-preview').addEventListener('click', function () {
    if (!S || !WSS) return;
    const n = wsPhotos.length;
    const shape = wsShapeFor(n === 2 ? 2 : 4);
    const sec = $('ws-section').selectedOptions[0];
    let photos = wsPhotos.map(function (p) {
      return '<div style="flex:1;min-width:0"><div style="aspect-ratio:' + shape.w + ' / ' + shape.h + ';background:#e2e8f0"><img src="' + p.src + '" style="width:100%;height:100%;object-fit:cover;display:block"></div>' +
        '<div style="font-size:10px;font-style:italic;text-align:center;color:#3D2A5F;min-height:14px;margin-top:2px">' + esc(p.caption) + '</div></div>';
    }).join('');
    let html = '<div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">' +
      '<div style="background:linear-gradient(100deg,#2A1B4D,#5A2A66 55%,#7A2F70);color:#fff;text-align:center;padding:16px 12px">' +
      '<div style="font-size:17px;font-weight:700">' + esc($('ws-title').value.trim() || '(No title)') + '</div>' +
      '<div style="font-size:12px;margin-top:4px">' + esc($('ws-building').value || '(No building)') + ' - <b style="color:' + wsStatusColor($('ws-status').value) + '">' + esc($('ws-status').value || '(No status)') + '</b></div></div>' +
      '<div style="display:flex;gap:8px;padding:14px 16px 4px">' + photos + '</div>' +
      '<div style="padding:4px 16px 12px;font-size:11px;color:#3D2A5F">Submitted by: ' + esc($('ws-person').value || '(No name)') + '</div></div>' +
      '<div class="preview-label" style="margin-top:12px;">Goes to the end of: ' + esc(sec && sec.value !== '' ? sec.textContent : '(No section)') + '</div>';
    $('preview-content').innerHTML = html;
    $('preview-modal').classList.add('open');
  });

  // ---------- Clear ----------
  function wsReset(keepPerson) {
    $('ws-title').value = '';
    $('ws-building').value = '';
    $('ws-status').value = '';
    if (!keepPerson) { $('ws-person').value = ''; $('ws-section').value = ''; }
    wsPhotos = [];
    wsRender();
  }
  $('btn-ws-clear').addEventListener('click', function () {
    if (!confirm('Clear the whole form and all photos?')) return;
    wsReset(false);
    $('ws-result').style.display = 'none';
  });

  // ---------- Submit ----------
  $('btn-ws-submit').addEventListener('click', async function () {
    if (!S || !WSS) return;
    const problem = wsProblem();
    if (problem) return alert(problem);
    const btn = $('btn-ws-submit');
    btn.disabled = true;
    $('ws-result').style.display = 'none';

    const out = [];
    try {
      btn.innerHTML = '<div class="spin" style="margin-right:8px;"></div> Preparing photos...';
      const shape = wsShapeFor(wsPhotos.length);
      for (let i = 0; i < wsPhotos.length; i++) {
        out.push({ base64: await wsCrop(wsPhotos[i].src, shape), caption: wsPhotos[i].caption });
      }
    } catch (err) {
      alert('Could not prepare the photos: ' + err.message);
      btn.disabled = false; btn.innerHTML = WS_LABEL;
      return;
    }

    btn.innerHTML = '<div class="spin" style="margin-right:8px;"></div> Adding slide (this can take a minute if others are submitting)...';
    google.script.run
      .withSuccessHandler(function (res) {
        $('ws-link').href = res.slideUrl;
        $('ws-result-title').textContent = 'Slide added to "' + res.section + '" (slide ' + res.slideNumber + ')';
        $('ws-result').style.display = 'flex';
        btn.disabled = false; btn.innerHTML = WS_LABEL;
        wsReset(true);
      })
      .withFailureHandler(function (err) {
        alert('Could not add the slide: ' + err.message);
        btn.disabled = false; btn.innerHTML = WS_LABEL;
      })
      .submitWork({
        person: $('ws-person').value,
        section: $('ws-section').value,
        building: $('ws-building').value,
        status: $('ws-status').value,
        title: $('ws-title').value.trim(),
        photos: out
      });
  });
