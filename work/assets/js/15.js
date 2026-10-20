/* ---------------- ADDED: Create in MRI (the panel, the MRI box in each work's side panel) ----------------
   Uses only public things of the page above (ST, toast) and the server file MRI.gs.
   The actual clicking in MRI is done by mri_sync.py on your PC. */
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
  function num(v) { var n = Number(String(v === null || v === undefined ? '' : v).replace(/[, ]|AED/gi, '')); return isFinite(n) ? n : NaN; }

  var L = { data: null, at: 0, loading: null };          // mriList cache for side panels
  var P = null;                                            // the open panel

  function ago(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || ''); if (!m) return '';
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 4, +m[5]), d = Math.round((Date.now() - t) / 60000);
    if (d < 2) return 'just now'; if (d < 60) return d + ' min ago'; if (d < 1440) return Math.round(d / 60) + ' h ago'; return Math.round(d / 1440) + ' days ago';
  }
  function pcLine(last) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(last || ''), on = false;
    if (m) on = (Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 4, +m[5])) < 5 * 60000;
    return '<span class="mx-pc' + (on ? ' on' : '') + '"><i></i>' + (last ? 'Your PC last checked in ' + esc(ago(last)) + (on ? '' : '. Start mri_sync.py on the PC to run it.') : 'Your PC has not checked in yet. Start mri_sync.py on the PC.') + '</span>';
  }

  /* ---------- reading lines pasted from a quote (PDF, Excel, e-mail) ---------- */
  var UNIT = /^(nos?\.?|no\.?s?|pcs?\.?|pieces?|each|ea|sets?|lots?|ls|l\.s\.?|units?|rolls?|mtrs?|m|lm|sqm|m2|kg|kgs|ltrs?|l|boxes|box|pairs?|lump ?sum)$/i;   // a unit in its own cell
  var UNIT_WORD = /^(nos?\.?|no\.?s|pcs?\.?|ea|each|ls|l\.s\.?|lots?|rolls?|mtrs?|lm|sqm|m2|kgs?|ltrs?)$/i;          // a unit inside a plain text line
  function isNum(t) { return /^-?(aed)?\s*\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/i.test(String(t).trim()); }
  function parseLines(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/ /g, ' ').trim(); if (!line) return;
      var cells = line.indexOf('\t') > -1 ? line.split('\t').map(function (c) { return c.trim(); }).filter(Boolean) : line.split(/\s+/);
      var tab = line.indexOf('\t') > -1;
      var nums = [];
      while (cells.length && isNum(cells[cells.length - 1]) && nums.length < 4) nums.unshift(num(cells.pop()));
      while (cells.length > 1 && (tab ? UNIT : UNIT_WORD).test(cells[cells.length - 1])) cells.pop();   // unit after the description
      while (cells.length > 1 && isNum(cells[cells.length - 1]) && nums.length < 4) nums.unshift(num(cells.pop())); // "2 Nos 75.00", or Qty | Unit | Rate | Amount
      if (cells.length > 1 && /^\d{1,3}[.)]?$/.test(cells[0])) cells.shift();                       // S.No
      var desc = (tab ? cells.filter(function (c) { return !UNIT.test(c); }) : cells).join(' ').replace(/\s+/g, ' ').trim();
      if (!desc || !nums.length || /^(sub ?total|total|grand total|vat|discount|net|amount)\b/i.test(desc)) return;
      var qty = 1, price = nums[nums.length - 1];
      if (nums.length >= 3) {
        var a = nums[nums.length - 3], b = nums[nums.length - 2], c = nums[nums.length - 1];
        if (Math.abs(a * b - c) < 0.05 * Math.max(1, c)) { qty = a; price = b; }
        else if (Math.abs(b * a - c) >= 0.05 * Math.max(1, c) && Math.abs(nums[0] * nums[1] - c) < 0.05 * Math.max(1, c)) { qty = nums[0]; price = nums[1]; }
        else { qty = b; price = c; }
      } else if (nums.length === 2) {
        if (Number.isInteger(nums[0]) && nums[0] <= 1000) { qty = nums[0]; price = nums[1]; } else { price = nums[0]; }
      }
      out.push({ desc: desc, qty: qty, price: price });
    });
    return out;
  }


  /* ---------- reading an Excel / CSV file of lines ---------- */
  var BALIAS = { BT: 'DD137', 'BLUE TOWER': 'DD137', MJ: 'DD140', 'MJ COMPLEX': 'DD140', MUROOJ: 'DD140', HAMSHA: 'DD125', HAMSA: 'DD125', KNB: 'DD131', 'KARAMA NEW BUILDING': 'DD131', SAK: 'DD124', AMWAJ: 'DD145', 'AMWAJ 3': 'DD145' };
  function matchBuilding(txt, list) {
    var t = String(txt === null || txt === undefined ? '' : txt).trim(); if (!t) return '';
    var m = /\bDD\s?(\d{3})\s*(?:\/\s*([A-Z]))?/i.exec(t), code = '';
    if (m) code = 'DD' + m[1] + (m[2] ? '/' + m[2].toUpperCase() : '');
    else { var al = BALIAS[t.toUpperCase()]; if (al) code = al; }
    var hits;
    if (code) { hits = list.filter(function (b) { return b.toUpperCase().indexOf(code + ' ') === 0 || b.toUpperCase() === code; }); if (hits.length === 1) return hits[0]; return ''; }
    var low = t.toLowerCase();
    hits = list.filter(function (b) { var n = b.replace(/^DD\d+(?:\/[A-Z])?\s*-\s*/i, '').toLowerCase(); return n === low || (low.length > 3 && (n.indexOf(low) > -1 || low.indexOf(n) > -1)); });
    return hits.length === 1 ? hits[0] : '';
  }
  function parseSheet(aoa, bl) {
    var hi = -1, cols = {};
    for (var i = 0; i < Math.min(aoa.length, 30) && hi < 0; i++) {
      var r = aoa[i].map(function (c) { return String(c === null || c === undefined ? '' : c).trim().toLowerCase(); });
      if (r.some(function (c) { return /desc/.test(c); }) && r.some(function (c) { return /^(qty|quantity|qnty)\b/.test(c); })) {
        hi = i;
        r.forEach(function (c, j) {
          if (!c) return;
          if (cols.part === undefined && /(part|item|material|product)\s*(code|no|number)|^code$|^part$/.test(c)) cols.part = j;
          else if (cols.desc === undefined && /desc/.test(c)) cols.desc = j;
          else if (cols.bld === undefined && /building|site|location|\bdd\b/.test(c)) cols.bld = j;
          else if (cols.qty === undefined && /^(qty|quantity|qnty)\b/.test(c)) cols.qty = j;
          else if (cols.price === undefined && /unit|rate|price/.test(c) && !/amount|total|net|vat/.test(c)) cols.price = j;
        });
      }
    }
    if (hi < 0 || cols.desc === undefined || cols.qty === undefined || cols.price === undefined) return null;
    var out = [], skipped = 0;
    for (var k = hi + 1; k < aoa.length; k++) {
      var row = aoa[k], d = String(row[cols.desc] === undefined || row[cols.desc] === null ? '' : row[cols.desc]).replace(/\s+/g, ' ').trim();
      if (!d) continue;
      var qc = row[cols.qty], pc = row[cols.price];
      var q = (qc === '' || qc === null || qc === undefined) ? NaN : num(qc), pr = (pc === '' || pc === null || pc === undefined) ? NaN : num(pc);
      if (/^(sub ?total|total|grand total|vat|discount|net|amount)\b/i.test(d) || !isFinite(q) || !isFinite(pr)) { skipped++; continue; }
      var part = cols.part === undefined ? '' : String(row[cols.part] === undefined || row[cols.part] === null ? '' : row[cols.part]).replace(/\s+/g, '').trim();
      out.push({ part: part, desc: d, bldTxt: cols.bld === undefined ? '' : row[cols.bld], qty: q, price: pr });
    }
    return { lines: out, skipped: skipped };
  }
  function readFileLines(file) {
    return new Promise(function (res, rej) {
      if (!window.XLSX) { rej(new Error('The Excel reader is still loading. Try again in a few seconds.')); return; }
      var fr = new FileReader();
      fr.onerror = function () { rej(new Error('Could not open that file.')); };
      fr.onload = function () {
        try {
          var wb = XLSX.read(fr.result, { type: 'array' }), best = null;
          wb.SheetNames.forEach(function (n) {
            if (best) return;
            var got = parseSheet(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
            if (got && got.lines.length) best = got;
          });
          if (!best) rej(new Error('Could not find the columns. The first rows need headings such as Description, Qty and Unit rate (and Part code and Building if you have them).'));
          else res(best);
        } catch (e) { rej(new Error('That file could not be read: ' + e.message)); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- the panel ---------- */
  function ensureShell() {
    var b = $('mx-back'); if (b) return b;
    b = document.createElement('div'); b.id = 'mx-back'; b.className = 'mx-back'; b.style.display = 'none';
    b.innerHTML = '<div class="mx" role="dialog" aria-modal="true" aria-labelledby="mx-title"><div class="mx-h"><div><b id="mx-title">Create in MRI</b><span id="mx-subt"></span></div><button type="button" class="mx-x" id="mx-close" aria-label="Close">&times;</button></div><div id="mx-main"></div></div>';
    document.body.appendChild(b);
    // clicking outside the box does NOT close it; only the X or Esc do, and they ask first when the form has been changed
    $('mx-close').addEventListener('click', tryClose);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && b.style.display !== 'none') tryClose(); });
    b.addEventListener('click', onClick);
    b.addEventListener('input', onInput);
    b.addEventListener('change', onInput);
    return b;
  }
  function tryClose() { if (P && P.dirty && P.view === 'form' && !confirm('Close this form? What you typed or uploaded and have not saved will be lost.')) return; close(); }
  function close() { var b = $('mx-back'); if (b) b.style.display = 'none'; P = null; document.body.style.overflow = ''; }

  function isBlankRef(q) { return /^NC-\d{6}-\d+$/i.test(String(q || '')); }
  function open(qtn, blank) {
    qtn = qtn || ''; blank = !!blank || isBlankRef(qtn);
    var b = ensureShell();
    b.style.display = ''; document.body.style.overflow = 'hidden';
    $('mx-title').textContent = blank ? 'MRI WO without a quote' : 'Create in MRI';
    $('mx-subt').textContent = qtn;
    $('mx-main').innerHTML = '<div class="loading-box" style="margin:30px"><div class="spin-dark"></div><span>' + (blank ? 'Getting the form ready...' : 'Getting the job details...') + '</span></div>';
    P = { qtn: qtn, blank: blank };
    if (window.__vwMriLive) window.__vwMriLive.kick(150);           // fresh queue info for the button
    call(blank ? 'mriPrepareBlank' : 'mriPrepare', qtn).then(function (d) {
      if (!P || P.qtn !== qtn) return;
      P.d = d;
      var ex = d.existing;
      P.view = ex && ['review', 'sent', 'running', 'done'].indexOf(ex.status) > -1 ? 'status' : 'form';
      var base = d.defaults;
      if (ex && ['draft', 'queued', 'error'].indexOf(ex.status) > -1 && ex.payload && (ex.payload.qtn || P.blank)) base = ex.payload;
      P.f = JSON.parse(JSON.stringify(base));
      if (!P.f.costCentre) P.f.costCentre = d.defaults.costCentre || '';
      if (!P.f.costCode) P.f.costCode = d.defaults.costCode || '';
      if (!P.f.lines || !P.f.lines.length) P.f.lines = [{ part: d.defaultPart, desc: '', building: d.work.building, qty: 1, price: '' }];
      if (!P.f.buildingCode) P.f.buildingCode = d.work.buildingCode;
      P.f.lines.forEach(function (l) { if (l.part === 'MISSING') l.part = ''; });
      P.lastDesc = P.f.poDescription === P.f.description ? P.f.description : null;
      $('mx-subt').textContent = P.blank ? (d.work.qtn ? d.work.qtn + ' · ' + (P.f.chargeable === false ? 'non-chargeable' : 'chargeable') + ' · contract ' + P.f.contract : 'You fill in everything: any contract, chargeable or not.')
        : [d.work.qtn, d.work.crm ? 'CRM ' + d.work.crm : '', d.work.desc, d.work.building].filter(Boolean).join(' · ');
      render();
    }).catch(function (e) { $('mx-main').innerHTML = '<div class="mx-b"><div class="mx-err">' + esc(e.message) + '</div></div>'; });
  }

  function seg(name, opts, val) {
    return '<span class="mx-seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' class="on"' : '') + '>' + esc(o[1]) + '</button>'; }).join('') + '</span>';
  }
  function statusBox(ex) {
    var cls = ex.status, btns = '';
    if (ex.status === 'review') btns = '<button type="button" class="btn btn-primary btn-sm" data-a="sent">I sent it to ERP</button><button type="button" class="btn btn-ghost btn-sm" data-a="cancel">Cancel this request</button>';
    if (ex.status === 'sent') btns = '<button type="button" class="btn btn-ghost btn-sm" data-a="again">' + (P && P.blank ? 'Raise another WO without a quote' : 'Create another for this quote') + '</button>';
    if (ex.status === 'done' && !ex.rfNumber) btns = '<button type="button" class="btn btn-primary btn-sm" data-a="addpo">Create the PO now</button>';
    if (ex.status === 'queued') btns = '<button type="button" class="btn btn-ghost btn-sm" data-a="cancel">Cancel</button>';
    if (ex.status === 'running') btns = '<button type="button" class="btn btn-ghost btn-sm" data-a="stop">Stop</button>';
    if (ex.status === 'error') btns = '<button type="button" class="btn btn-ghost btn-sm" data-a="cancel">Cancel</button>';
    var info = [ex.taskId ? 'Task ' + ex.taskId + (ex.taskNo ? ' (no. ' + ex.taskNo + ')' : '') : '', ex.poReq ? 'PO request ' + ex.poReq : '', ex.rfNumber ? 'RF ' + ex.rfNumber : ''].filter(Boolean).join(' · ');
    var msg = ex.status === 'review' ? 'Open the PO in MRI, check it, then press "Send Purchase Request To ERP".' :
              ex.status === 'error' ? (ex.message || 'Your PC could not finish.') + (ex.taskId ? ' The task was already created, so trying again only makes the PO.' : '') + ' Fix it below and send again.' :
              ex.status === 'queued' ? 'Your PC will pick it up within a minute while mri_sync.py is running. You can still change it.' :
              ex.status === 'running' ? 'Your PC is working on it now.' :
              ex.status === 'done' && ex.rfNumber ? (ex.rfDocs === 'ready' ? 'The RF is in Dynamics with its documents attached. Open it there and press Submit.' : (ex.message || 'RF raised.')) :
              ex.status === 'done' ? 'The task is in MRI. Add its PO when you have the supplier\'s quote.' : (ex.message || '');
    var live = (ex.status === 'queued' || ex.status === 'running') && window.__vwMriLive ? '<div data-mrl="' + esc(ex.key) + '"' + (ex.status === 'queued' ? ' data-mrl-closed' : '') + ' style="flex-basis:100%"></div>' : '';
    return '<div class="mx-stat ' + cls + '" style="flex-wrap:wrap"><div><b>' + esc(ex.statusText) + (info ? ' · ' + esc(info) : '') + '</b>' + esc(msg) + '</div><div class="btns">' + btns + '</div>' + live + '</div>';
  }

  function render() {
    var d = P.d, f = P.f, ex = d.existing, w = d.work, h = '';
    if (P.view === 'status') {
      h = '<div class="mx-b">' + statusBox(ex) + '<div class="mx-s mx-full"><div class="mx-kv">' +
        '<span>Task ID</span><b>' + esc(ex.taskId || '-') + '</b><span>Task number</span><b>' + esc(ex.taskNo || '-') + '</b>' +
        '<span>PO request</span><b>' + esc(ex.poReq || '-') + '</b><span>RF number</span><b>' + esc(ex.rfNumber || '-') + '</b><span>Supplier</span><b>' + esc((ex.payload && ex.payload.supplier) || '-') + '</b>' +
        '<span>Lines</span><b>' + ((ex.payload && ex.payload.lines) || []).length + ' · AED ' + money(((ex.payload && ex.payload.lines) || []).reduce(function (a, l) { return a + l.qty * l.price; }, 0)) + '</b>' +
        '<span>Updated</span><b>' + esc(ex.updated) + '</b></div>' + trkHtml(ex) + '</div></div>' +
        '<div class="mx-ft"><div>' + pcLine(d.lastCheck) + '</div><div class="btns"><button type="button" class="btn btn-ghost btn-sm" id="mx-close2">Close</button></div></div>';
      $('mx-main').innerHTML = h;
      $('mx-close2').addEventListener('click', close);
      liveFill();
      return;
    }
    var task = f.mode !== 'po', po = f.mode !== 'task';
    h += '<div class="mx-b">';
    if (ex && ['queued', 'error', 'draft'].indexOf(ex.status) > -1 && ex.status !== 'draft') h += statusBox(ex);
    if (!w.approved && !P.blank) h += '<div class="mx-err" style="background:var(--warn-bg);color:var(--warn)">This work is not marked as approved by WASL in the tracker yet.</div>';
    if (P.blank && !w.qtn && d.recent && d.recent.length) {
      h += '<div class="mx-full mx-recent"><span>Earlier WOs without a quote:</span>' + d.recent.map(function (r) {
        return '<button type="button" class="mx-chip" data-mx-open="' + esc(r.qtn) + '" title="' + esc(r.desc) + '">' + esc(r.qtn) + ' · ' + esc(r.statusText) + (r.chargeable ? '' : ' · NC') + '</button>';
      }).join('') + '</div>';
    }
    if (P.blank) {
      var nc = f.chargeable === false;
      h += '<div class="mx-s mx-full"><h4>Job</h4><div class="mx-f">' +
        '<label>Charging</label><div>' + seg('chargeable', [['yes', 'Chargeable'], ['no', 'Non-chargeable']], nc ? 'no' : 'yes') + '</div>' +
        (nc && !d.nonChargeableReady ? '<div class="hint" style="color:var(--warn)">Your PC script cannot tick "Non-chargeable" in MRI yet, so this can be saved as a draft but not raised. Once mri_sync.py is updated, set NONCHARGEABLE_READY to true in MRI.gs.</div>' : '') +
        '<label>Contract</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + seg('contract', d.lists.contracts.map(function (c) { return [c, c]; }), f.contract) +
        '<input id="mx-con" class="mx-in" data-k="contract" value="' + esc(d.lists.contracts.indexOf(f.contract) > -1 ? '' : f.contract) + '" placeholder="or another (6 digits)" inputmode="numeric" maxlength="6" style="width:150px"></div>' +
        '<label for="mx-bpick">Building</label><select id="mx-bpick" class="mx-in" data-a2="bpick"><option value="">Pick the building...</option>' + d.lists.buildings.map(function (b) { var c = (/^(DD\d+(?:\/[A-Z])?)/i.exec(b) || [])[1] || ''; return '<option value="' + esc(b) + '"' + (c && c === f.buildingCode ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select>' +
        '<div class="hint">Fills the MRI building and the building on each line. You can still change them.</div></div></div>';
    }
    h += '<div class="mx-full" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--text-2)">Create ' + seg('mode', [['both', 'Task + PO'], ['task', 'Task only'], ['po', 'PO only']], f.mode) + '</div>';

    // task
    h += '<div class="mx-s"' + (task ? '' : ' style="opacity:.45;pointer-events:none"') + '><h4>1. Task ' + (P.blank ? '<small style="font-weight:500;color:var(--text-3)">contract ' + esc(f.contract) + '</small>' : seg('contract', d.lists.contracts.map(function (c) { return [c, c]; }), f.contract)) + '</h4><div class="mx-f">' +
      '<label for="mx-bld">MRI building</label><input id="mx-bld" class="mx-in" data-k="mriBuilding" value="' + esc(f.mriBuilding) + '" list="mx-bl" autocomplete="off">' +
      (P.blank ? '<div class="hint">As MRI names it. Picking the building above fills it when your PC has learned the name.</div>' : '<div class="hint">' + (d.defaults.buildingKnown || /^\d{6}/.test(f.mriBuilding) ? 'From ' + esc(w.building || 'the tracker') : 'First time for ' + esc(w.buildingCode || 'this building') + ': type it as MRI names it. Your PC learns the exact name.') + '</div>') +
      '<label for="mx-prob">Problem</label><select id="mx-prob" class="mx-in" data-k="problem">' + d.lists.problems.map(function (p) { return '<option' + (p === f.problem ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>' +
      '<label for="mx-desc">Description</label><textarea id="mx-desc" class="mx-in" data-k="description" rows="2">' + esc(f.description) + '</textarea>' +
      '<label>Always set</label><div class="mx-fixed">Reporter: you · Priority: Quotation Task · Cost code 3725CC · Source Web · ' + (P.blank && f.chargeable === false ? '<b>Non-chargeable</b>' : 'Chargeable') + '</div></div></div>';

    // PO
    h += '<div class="mx-s"' + (po ? '' : ' style="opacity:.45;pointer-events:none"') + '><h4>2. Purchase order ' + seg('reference', [['supply', 'Supply'], ['si', 'Supply & installation']], f.reference) + '</h4><div class="mx-f">' +
      '<label for="mx-sup">Supplier</label><input id="mx-sup" class="mx-in" data-k="supplier" value="' + esc(f.supplier) + '" list="mx-sl" placeholder="Code like V034348, or the name" autocomplete="off">' +
      (w.supplier ? '<div class="hint">Tracker vendor: ' + esc(w.supplier) + '</div>' : '') +
      (f.mode === 'po' ? (f.taskId || !(ex && ex.taskId) || (f.taskId = ex.taskId), '<label for="mx-tid">Task ID</label><input id="mx-tid" class="mx-in" data-k="taskId" value="' + esc(f.taskId || '') + '" placeholder="749997:387">') : '') +
      '<label for="mx-pdesc">PO description</label><textarea id="mx-pdesc" class="mx-in" data-k="poDescription" rows="2">' + esc(f.poDescription) + '</textarea>' +
      '<label for="mx-ccen">Line cost centre</label><input id="mx-ccen" class="mx-in" data-k="costCentre" value="' + esc(f.costCentre || '') + '" placeholder="As MRI shows it (the code is enough)" autocomplete="off">' +
      '<label for="mx-ccode">Line cost code</label><input id="mx-ccode" class="mx-in" data-k="costCode" value="' + esc(f.costCode || '') + '" placeholder="As MRI shows it (the code is enough)" autocomplete="off">' +
      '<div class="hint">Typed into every PO line when MRI leaves them empty. Remembered for your next WO.</div>' +
      '<label>Always set</label><div class="mx-fixed">Central Store (7-AGFBM) · SC-005 Sub Contractor · ' + (f.mode === 'po' ? 'the task ID above' : 'the task ID from step 1') + '</div></div></div>';

    // lines
    var bopts = function (sel) { return '<option value="">(no building)</option>' + d.lists.buildings.map(function (b) { return '<option' + (b === sel ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join(''); };
    var rows = '', tot = 0;
    f.lines.forEach(function (l, i) {
      var net = (num(l.qty) || 0) * (num(l.price) || 0); tot += net;
      rows += '<tr data-i="' + i + '"><td style="width:110px"><input class="mx-in' + (P.blank && !String(l.part || '').trim() ? ' mx-miss' : '') + '" data-l="part" placeholder="needed" value="' + esc(l.part) + '" list="mx-pl" aria-label="Part code"></td>' +
        '<td><input class="mx-in" data-l="desc" value="' + esc(l.desc) + '" aria-label="Description"></td>' +
        '<td style="width:190px"><select class="mx-in" data-l="building" aria-label="Building">' + bopts(l.building) + '</select></td>' +
        '<td style="width:74px"><input class="mx-in" data-l="unit" value="' + esc(l.unit || '') + '" placeholder="unit" aria-label="Unit"></td>' +
        '<td style="width:74px"><input class="mx-in" data-l="qty" value="' + esc(l.qty) + '" inputmode="decimal" style="text-align:right" aria-label="Quantity"></td>' +
        '<td style="width:96px"><input class="mx-in" data-l="price" value="' + esc(l.price) + '" inputmode="decimal" style="text-align:right" aria-label="Unit price"></td>' +
        '<td class="n net">' + money(net) + '</td><td style="width:30px"><button type="button" class="mx-del" data-del="' + i + '" aria-label="Remove line">&times;</button></td></tr>';
    });
    h += '<div class="mx-s mx-full"' + (po ? '' : ' style="opacity:.45;pointer-events:none"') + '><h4>Lines <small style="color:var(--text-3);font-weight:500">Part code ' + esc(d.defaultPart) + ' unless you change it. The building is added to each line as "for DD137 - Blue Tower".</small></h4>' +
      '<div class="mx-paste"><textarea id="mx-ptext" placeholder="Paste the lines here: copy the rows straight from the supplier\'s quote (PDF, Excel or the e-mail). Description, quantity and unit price are picked out for you to check."></textarea>' +
      '<div class="r"><span id="mx-pinfo">Each pasted row becomes a line. Totals and VAT rows are skipped.</span><span><button type="button" class="btn btn-ghost btn-sm" data-a="upload">Upload Excel / CSV</button><input type="file" id="mx-file" accept=".xlsx,.xls,.csv" hidden> <button type="button" class="btn btn-ghost btn-sm" data-a="paste-replace">Replace lines</button> <button type="button" class="btn btn-primary btn-sm" data-a="paste-add">Add lines</button></span></div></div>' +
      '<div class="mx-tbl-wrap"><table class="mx-ln"><thead><tr><th>Part code</th><th>Description</th><th>Building</th><th>Unit</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Net</th><th></th></tr></thead><tbody id="mx-rows">' + rows + '</tbody></table></div>' +
      '<div class="mx-tot"><button type="button" class="btn btn-ghost btn-sm" data-a="addline">+ Add line</button><span>Net <b id="mx-total">AED ' + money(tot) + '</b></span></div></div>';
    h += '<div id="mx-errbox" class="mx-err" style="display:none"></div></div>';

    h += '<div id="mx-qnote" class="mx-qnote" hidden></div>';
    h += '<div class="mx-ft"><div>' + pcLine(d.lastCheck) + '</div><div class="btns"><button type="button" class="btn btn-ghost btn-sm" data-a="draft">Save draft</button><button type="button" class="btn btn-primary btn-sm" data-a="send" id="mx-send">Raise MRI WO</button></div></div>';
    h += '<datalist id="mx-bl">' + Object.keys(d.lists.buildingMap).map(function (k) { return '<option value="' + esc(d.lists.buildingMap[k]) + '">'; }).join('') + '</datalist>';
    h += '<datalist id="mx-sl">' + d.lists.suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>';
    h += '<datalist id="mx-pl">' + d.lists.parts.map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.desc) + '</option>'; }).join('') + '</datalist>';
    $('mx-main').innerHTML = h;
    liveFill();
    queueNote();
  }
  // where a new request would land in the PC's queue (from the MRI Work Orders data)
  function queueNote() {
    var btn = $('mx-send'), box = $('mx-qnote'), Q = window.__vwMriLive && window.__vwMriLive.queueInfo();
    if (!btn || !box || !Q || !Q.ready || !P || !P.d) return;
    var me = P.d.existing && P.d.existing.key, run = Q.running && Q.running.key !== me ? Q.running : null;
    var ahead = Q.waiting.filter(function (j) { return j.key !== me; }).length;
    var L2 = window.__vwMriLive, use = L2.useName ? L2.useName() : '', where = use ? L2.label(use) : 'your PC';
    if (!run && !ahead) {
      btn.textContent = 'Raise MRI WO'; P.queueNo = 0;
      box.hidden = Q.pcOn;
      if (!Q.pcOn) box.innerHTML = '<b>' + (use ? esc(where) + ' is not running' : 'No PC is running') + ' mri_sync.py right now.</b> You can still raise it: it waits in the queue and starts as soon as ' + esc(where) + ' is on' + (use ? ', or pick the other PC on the MRI Work Orders page.' : '.');
      return;
    }
    var n = ahead + 1, nth = window.__vwMriLive.nth;
    P.queueNo = n;
    btn.textContent = n === 1 ? 'Add to queue (goes next)' : 'Add to queue (' + nth(n) + ' in line)';
    box.hidden = false;
    box.innerHTML = '<b>' + esc(use ? where : 'Your PC') + ' is busy.</b> ' + (run ? 'It is making ' + esc(run.qtn || 'a WO') + ' now' + (ahead ? ', with ' + ahead + ' more waiting' : '') + '. ' : ahead + ' waiting already. ') +
      (n === 1 ? 'This one <b>goes next</b>' : 'This one joins the queue <b>' + nth(n) + ' in line</b>') + ' and starts by itself when its turn comes' + (use ? ' on ' + esc(where) : '') + '. Nothing that is running gets interrupted.';
  }
  function liveFill() { if (window.__vwMriLive && document.querySelector('#mx-main [data-mrl]')) { window.__vwMriLive.fill(); window.__vwMriLive.kick(400); } }

  function totals() {
    var tot = 0;
    document.querySelectorAll('#mx-rows tr').forEach(function (tr) {
      var l = P.f.lines[Number(tr.dataset.i)]; var net = (num(l.qty) || 0) * (num(l.price) || 0); tot += net;
      tr.querySelector('.net').textContent = money(net);
    });
    if ($('mx-total')) $('mx-total').textContent = 'AED ' + money(tot);
  }
  function onInput(e) {
    if (!P || !P.f) return;
    var t = e.target;
    if (t.id === 'mx-file') { var fl = t.files && t.files[0]; t.value = ''; if (fl) uploadFile(fl); return; }
    if (t.dataset.a2 === 'bpick') { if (e.type === 'change') pickBuilding(t.value); return; }
    if (t.id === 'mx-con') { var cv = t.value.replace(/\D/g, '').slice(0, 6); if (cv !== t.value) t.value = cv; if (cv) { P.f.contract = cv; P.f.contractPicked = true; document.querySelectorAll('[data-seg="contract"] button').forEach(function (x) { x.classList.remove('on'); }); var st = document.querySelector('.mx-s h4 small'); if (st) st.textContent = 'contract ' + cv + (cv.length < 6 ? ' (needs 6 digits)' : ''); } else { P.f.contract = P.d.lists.contracts[0]; } return; }
    if (t.dataset.k) { P.f[t.dataset.k] = t.value; if (t.dataset.k === 'description' && P.f.poDescription === P.lastDesc) { P.f.poDescription = t.value; if ($('mx-pdesc')) $('mx-pdesc').value = t.value; } P.lastDesc = P.f.description; }
    P.dirty = true;
    if (t.dataset.l === 'part') t.classList.toggle('mx-miss', P.blank && !t.value.trim());
    if (t.dataset.l) { var tr = t.closest('tr'); P.f.lines[Number(tr.dataset.i)][t.dataset.l] = t.value; if (t.dataset.l === 'qty' || t.dataset.l === 'price') totals(); }
    if (t.id === 'mx-ptext') { var n = parseLines(t.value).length; $('mx-pinfo').textContent = t.value.trim() ? n + ' line' + (n === 1 ? '' : 's') + ' found.' : 'Each pasted row becomes a line. Totals and VAT rows are skipped.'; }
  }
  function pickBuilding(b) {
    var code = (/^(DD\d+(?:\/[A-Z])?)/i.exec(b || '') || [])[1] || '', old = P.f.pickedBuilding || '';
    P.f.buildingCode = code.toUpperCase(); P.f.pickedBuilding = b;
    var m = P.d.lists.buildingMap[P.f.buildingCode];
    if (!P.f.mriBuilding || P.f.mriBuilding === P.f.autoMri) P.f.mriBuilding = m || b.replace(/^DD\d+(?:\/[A-Z])?\s*-\s*/i, '');
    P.f.autoMri = P.f.mriBuilding;
    P.f.lines.forEach(function (l) { if (!l.building || l.building === old) l.building = b; });
    render();
  }
  function uploadFile(file) {
    var info = $('mx-pinfo');
    if (info) info.textContent = 'Reading ' + file.name + '...';
    readFileLines(file).then(function (g) {
      if (!P || !P.f) return;
      var bl = P.d.lists.buildings, noB = 0, def = P.blank ? (P.f.pickedBuilding || '') : P.d.work.building;
      var add = g.lines.map(function (x) {
        var b = x.bldTxt ? matchBuilding(x.bldTxt, bl) : def;
        if (x.bldTxt && !b) noB++;
        return { part: x.part || (P.blank ? '' : P.d.defaultPart), desc: x.desc, building: b, qty: x.qty, price: x.price };
      });
      P.f.lines = P.f.lines.filter(function (l) { return l.desc || num(l.price); }).concat(add);
      P.dirty = true; render();
      var nm = add.filter(function (l) { return !String(l.part).trim(); }).length;
      var msg = add.length + ' line' + (add.length === 1 ? '' : 's') + ' read from ' + file.name + '.' + (nm ? ' ' + nm + ' need a part code (red).' : '') + (noB ? ' ' + noB + ' need a building.' : '');
      if ($('mx-pinfo')) $('mx-pinfo').textContent = msg; note(msg + ' Check them.');
    }).catch(function (er) { if ($('mx-pinfo')) $('mx-pinfo').textContent = er.message; note(er.message); });
  }
  function onClick(e) {
    if (!P || !P.d) return;
    var s = e.target.closest('[data-seg] button');
    if (s && s.parentNode.dataset.seg === 'chargeable') { P.f.chargeable = s.dataset.v === 'yes'; render(); return; }
    if (s) { var k = s.parentNode.dataset.seg; P.f[k] = s.dataset.v;
      if (k === 'reference' && P.f.mode !== 'po') P.f.problem = s.dataset.v === 'supply' ? 'Supply of Materials' : (P.f.problem === 'Supply of Materials' ? 'Supply and Installation Works' : P.f.problem);
      if (k === 'contract') { P.f.contractPicked = true; P.f.description = P.f.description.replace(/- (\d{6})\s*$/, '- ' + s.dataset.v); P.f.poDescription = P.f.poDescription.replace(/- (\d{6})\s*$/, '- ' + s.dataset.v); }
      render(); return; }
    var del = e.target.closest('[data-del]');
    if (del) { P.f.lines.splice(Number(del.dataset.del), 1); if (!P.f.lines.length) P.f.lines.push({ part: P.d.defaultPart, desc: '', building: P.d.work.building, qty: 1, price: '' }); render(); return; }
    var a = e.target.closest('[data-a]'); if (!a) return;
    var act = a.dataset.a;
    if (act === 'addline') { P.f.lines.push({ part: P.d.defaultPart, desc: '', building: P.blank ? (P.f.pickedBuilding || '') : P.d.work.building, qty: 1, price: '' }); render(); var r = document.querySelectorAll('#mx-rows tr'); if (r.length) r[r.length - 1].querySelector('[data-l=desc]').focus(); }
    else if (act === 'upload') { var fi = $('mx-file'); if (fi) fi.click(); }
    else if (act === 'paste-add' || act === 'paste-replace') {
      var got = parseLines($('mx-ptext').value);
      if (!got.length) { note('No lines found. Each row needs a description and a price.'); return; }
      var add = got.map(function (g) { return { part: P.d.defaultPart, desc: g.desc, building: P.blank ? (P.f.pickedBuilding || '') : P.d.work.building, qty: g.qty, price: g.price }; });
      var keep = act === 'paste-add' ? P.f.lines.filter(function (l) { return l.desc || num(l.price); }) : [];
      P.f.lines = keep.concat(add); P.dirty = true; render(); note(add.length + ' line' + (add.length === 1 ? '' : 's') + ' added. Check them.');
    }
    else if (act === 'draft' || act === 'send') {
      var send = act === 'send', box = $('mx-errbox');
      var miss = P.blank ? P.f.lines.filter(function (l) { return (l.desc || num(l.price)) && !String(l.part || '').trim(); }).length : 0;
      if (miss && send) { box.textContent = miss + ' line' + (miss === 1 ? ' has' : 's have') + ' no part code (shown in red). Type the codes, or save the draft and finish later.'; box.style.display = ''; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      var payload = JSON.parse(JSON.stringify(P.f)); payload.qtn = P.d.work.qtn; payload.crm = P.d.work.crm; payload.buildingCode = P.blank ? (P.f.buildingCode || '') : P.d.work.buildingCode;
      if (P.blank) { payload.blank = true; payload.crm = ''; payload.chargeable = P.f.chargeable !== false; }
      if (P.again) payload.again = true;
      if (send && P.allowDup) payload.allowDuplicate = true;
      payload.lines.forEach(function (l) { if (P.blank && (l.desc || num(l.price)) && !String(l.part || '').trim()) l.part = 'MISSING'; });   // keeps the blank through a draft save
      if (!send) { /* draft: server keeps MISSING, shown as blank when reopened */ }
      a.disabled = true; box.style.display = 'none';
      call('mriSave', payload, send).then(function (r) {
        L.at = 0; if (send && window.__vwMriLive) window.__vwMriLive.kick(300); note(send && P.queueNo ? 'Added to the queue (' + (P.queueNo === 1 ? 'goes next' : window.__vwMriLive.nth(P.queueNo) + ' in line') + ')' + (r.qtn && P.blank ? ': ' + r.qtn : '') : send ? 'MRI WO raised: your PC will create it' + (r.qtn && P.blank ? ' (' + r.qtn + ')' : '') : 'Draft saved' + (r.qtn && P.blank ? ' as ' + r.qtn : ''));
        refreshBoxes();
        if (P.blank && r.qtn && !P.d.work.qtn) { P.d.work.qtn = r.qtn; P.qtn = r.qtn; $('mx-subt').textContent = r.qtn; }
        if (send) { var q = r.qtn || P.d.work.qtn, bl = P.blank; close(); open(q, bl); } else a.disabled = false;
      }).catch(function (er) {
        a.disabled = false; box.textContent = er.message; box.style.display = '';
        if (send && /^Duplicate/.test(er.message)) { P.allowDup = true; box.textContent = er.message + '. Nothing was created in MRI. Press the button again only if you really want it raised anyway.'; }
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    else if (act === 'stop' && !a.dataset.sure) { a.dataset.sure = '1'; a.textContent = 'Click again to stop'; a.classList.add('btn-primary'); }
    else if (act === 'sent' || act === 'cancel' || act === 'stop') {
      a.disabled = true;
      call('mriSet', P.d.existing.key, act).then(function () { L.at = 0; note(act === 'sent' ? 'Marked as sent to ERP' : act === 'stop' ? 'Stopping: your PC drops it at its next step' : 'Cancelled'); if (window.__vwMriLive) window.__vwMriLive.kick(200); refreshBoxes(); var q = P.d.work.qtn, bl = P.blank; close(); open(q, bl); })
        .catch(function (er) { a.disabled = false; note(er.message); });
    }
    else if (act === 'addpo') { P.view = 'form'; P.f = JSON.parse(JSON.stringify(P.blank && P.d.existing.payload ? P.d.existing.payload : P.d.defaults)); if (!P.blank) P.f.buildingCode = P.d.work.buildingCode; P.f.mode = 'po'; P.f.taskId = P.d.existing.taskId; render(); }
    else if (act === 'again' && P.blank) { close(); open('', true); }
    else if (act === 'again') { P.again = true; P.view = 'form'; P.f = JSON.parse(JSON.stringify(P.d.defaults)); P.f.buildingCode = P.d.work.buildingCode; render(); }
  }

  /* ---------- MRI box inside a work's side panel ---------- */
  function list(force) {
    if (!force && L.data && Date.now() - L.at < 60000) return Promise.resolve(L.data);
    if (L.loading) return L.loading;
    L.loading = call('mriList').then(function (d) { L.data = d; L.at = Date.now(); L.loading = null; return d; }, function (e) { L.loading = null; throw e; });
    return L.loading;
  }
  function boxHtml(qtn, j, w) {
    var h = '<div class="jx-h">MRI <span>' + (j ? '<button type="button" class="btn btn-ghost btn-sm" data-mx-open="' + esc(qtn) + '">Open</button>' : '') + '</span></div>';
    if (!j || j.status === 'cancelled') {
      return h + '<div style="font-size:13px;color:var(--text-2);margin:6px 0 10px">No task or PO made from the hub yet.</div>' +
        (w && w.approvedKey === 'yes' ? '<button type="button" class="btn btn-primary btn-sm" data-mx-open="' + esc(qtn) + '">Create in MRI</button>' : '<div style="font-size:12px;color:var(--text-3)">Available once WASL approves the quote.</div>');
    }
    return h + '<div class="mx-kv"><span>Task</span><b>' + esc(j.taskId || '-') + (j.taskNo ? ' · task ' + esc(j.taskNo) : '') + '</b>' +
      '<span>PO request</span><b>' + esc(j.poReq || '-') + (j.lines ? ' · ' + j.lines + ' line' + (j.lines === 1 ? '' : 's') + ' · AED ' + money(j.total) : '') + '</b>' +
      (j.rfNumber ? '<span>RF</span><b>' + esc(j.rfNumber) + '</b>' : '') +
      '<span>Status</span><span class="st ' + esc(j.status) + '">' + esc(j.statusText) + '</span>' + (j.status === 'error' && j.message ? '<span></span><span style="color:var(--danger);font-size:12px">' + esc(j.message) + '</span>' : '') + '</div>' +
      trkHtml(j) +
      ((j.status === 'running' || j.status === 'queued') && window.__vwMriLive ? '<div data-mrl="' + esc(j.key) + '" data-mrl-compact></div><button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-mri-follow>Follow it live</button>' : '');
  }
  /* "Copy for the tracker": values to paste into VW_Tracker BY HAND, and a tick kept only in the hub. The hub never writes to VW_Tracker. */
  function trkHtml(j) {
    if (!j || !(j.rfNumber || j.taskId) || ['review', 'done', 'sent'].indexOf(j.status) < 0) return '';
    var day = String(j.updated || '').substring(0, 10), b = function (txt, v) { return v ? '<button type="button" class="btn btn-ghost btn-sm" data-mrt-copy="' + esc(v) + '">' + esc(txt) + '</button>' : ''; };
    return '<div class="mx-trk" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex-basis:100%"><span style="font-size:12px;color:var(--text-3)">For VW_Tracker (you paste it yourself):</span>' +
      b('Copy RF number', j.rfNumber) + b('Copy RF date', j.rfNumber ? (j.rfDate || day) : '') + b('Copy task ID', j.taskId) +
      '<button type="button" class="btn ' + (j.trackerDone ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-mrt-tick="' + esc(j.key) + '" data-on="' + (j.trackerDone ? '1' : '') + '">' + (j.trackerDone ? '☑ Tracker updated' : '☐ Tracker updated') + '</button></div>';
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-mrt-copy]');
    if (c) {
      var v = c.dataset.mrtCopy, ok = function () { note('Copied: ' + v); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, function () { note('Could not copy. Select it by hand: ' + v); });
      else note('Could not copy. Select it by hand: ' + v);
      return;
    }
    var t = e.target.closest && e.target.closest('[data-mrt-tick]');
    if (t) {
      var on = !t.dataset.on; t.disabled = true;
      call('mriTrackerDone', t.dataset.mrtTick, on).then(function () {
        t.disabled = false; t.dataset.on = on ? '1' : ''; t.textContent = on ? '☑ Tracker updated' : '☐ Tracker updated';
        t.classList.toggle('btn-primary', on); t.classList.toggle('btn-ghost', !on); L.at = 0;
        if (window.__vwMriLive) window.__vwMriLive.kick(200);
      }).catch(function (er) { t.disabled = false; note(er.message); });
    }
  });
  function mount() {
    var body = $('drawer-body'); if (!body || $('mri-sec')) return;
    var qtn = ($('dh-ref').textContent || '').trim(); if (!qtn) return;
    var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return x.qtn === qtn; })[0] : null;
    if (!w || w.statusKey === 'cancelled') return;
    var sec = document.createElement('div'); sec.className = 'd-sec'; sec.id = 'mri-sec'; sec.dataset.qtn = qtn;
    var after = $('jx-sec');
    if (after && after.parentNode === body) body.insertBefore(sec, after.nextSibling); else body.insertBefore(sec, body.firstChild);
    sec.innerHTML = '<div class="jx-h">MRI <small>checking...</small></div>';
    list(false).then(function (d) { if (sec.dataset.qtn === qtn) { sec.innerHTML = boxHtml(qtn, d.jobs[qtn], w); liveFill(); } }).catch(function () { sec.style.display = 'none'; });
  }
  function refreshBoxes() {
    var sec = $('mri-sec'); if (!sec) return;
    list(true).then(function (d) {
      var q = sec.dataset.qtn, w = ST.works.filter(function (x) { return x.qtn === q; })[0];
      sec.innerHTML = boxHtml(q, d.jobs[q], w); liveFill();
    }).catch(function () {});
  }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () { if (!$('mri-sec')) mount(); }).observe($('drawer-body'), { childList: true });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-mx-open]'); if (b) open(b.dataset.mxOpen); });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-mri-follow]') && window.__vwMriLive) { if (typeof closeDrawer === 'function') closeDrawer(); window.__vwMriLive.goPage(); } });
  // the PC finished the request this window shows: show the result
  function reloadIf(key) {
    if (P && P.d && P.d.existing && P.d.existing.key === key && (P.view === 'status' || P.d.existing.status === 'queued' || P.d.existing.status === 'running')) { var q = P.qtn || P.d.work.qtn, bl = P.blank; open(q, bl); }
    var sec = $('mri-sec'); if (sec) { L.at = 0; refreshBoxes(); }
  }

  function openBlank() { open('', true); }
  // "+ MRI WO without a quote" buttons on the Today and Procurement pages
  [].forEach(function (x) {                                // (moved to the MRI Work Orders page: "Raise MRI WO")
    var anchor = $(x[0]); if (!anchor || $(x[1])) return;
    var btn = document.createElement('button'); btn.type = 'button'; btn.id = x[1]; btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = '+ MRI WO without a quote'; btn.title = 'Raise a task + PO in MRI that is not tied to a quote, e.g. a non-chargeable job under another contract';
    btn.addEventListener('click', openBlank);
    if (anchor.classList.contains('view-actions')) anchor.insertBefore(btn, anchor.firstChild); else anchor.parentNode.insertBefore(btn, anchor);
  });
  window.__vwMriTrk = trkHtml;
  window.__vwMri = { open: open, openBlank: openBlank, parseLines: parseLines, reloadIf: reloadIf, queueNote: queueNote };
})();
