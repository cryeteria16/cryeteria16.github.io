/* ---------------- v39: Bills page. Server: Bills.gs ----------------
   Drop scans / photos / PDFs: each is read by Google and waits in "Check before saving" until you press Save.
   The month's bills come from the Bills tab. The bank statement card matches unpaid bills against the manager's PDF. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('view-bills')) return;
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
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function money(n) { return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(s) { var v = parseFloat(String(s === null || s === undefined ? '' : s).replace(/[^\d.\-]/g, '')); return isFinite(v) ? v : 0; }
  function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || ''); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLabel(ym) { var m = /^(\d{4})-(\d{2})$/.exec(ym || ''); return m ? MON[+m[2] - 1] + ' ' + m[1] : ym; }
  function readB64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { rej(new Error('Could not read the file from your device.')); };
      fr.readAsDataURL(file);
    });
  }
  var MAX = 18 * 1024 * 1024;
  var B = { d: null, busy: false, month: '', items: {}, order: [], run: null, st: null, q: '' };

  /* ---------- page show / hide ---------- */
  function shown() { return $('view-bills').style.display !== 'none'; }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'bills'; $('view-bills').style.display = on ? '' : 'none'; if (on) load(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });

  /* ---------- loading ---------- */
  function load(month) {
    if (B.busy) return; B.busy = true;
    $('bl-error').style.display = 'none';
    if (!B.d) { $('bl-loading').style.display = ''; $('bl-body').style.display = 'none'; }
    call('billsStatus', month || B.month || '').then(function (d) {
      B.busy = false; B.d = d; B.month = d.month;
      $('bl-loading').style.display = 'none'; $('bl-body').style.display = '';
      if (d.sheetUrl) { $('bl-sheet').href = d.sheetUrl; $('bl-sheet').style.display = ''; }
      if (d.folderUrl) { $('bl-folder').href = d.folderUrl; $('bl-folder').style.display = ''; }
      if (d.error) { $('bl-error').textContent = d.error; $('bl-error').style.display = ''; }
      $('bl-subs').innerHTML = (d.subs || []).map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join('');
      drawMonths(); drawRows();
      var keep = {};
      (d.waiting || []).forEach(function (w) { keep[w.id] = 1; if (!B.items[w.id]) { B.items[w.id] = w; B.order.push(w.id); } });
      B.order = B.order.filter(function (id) { return keep[id] || (B.items[id] && B.items[id].local); });
      drawWait();
      readPending();
    }).catch(function (e) {
      B.busy = false; $('bl-loading').style.display = 'none';
      $('bl-error').textContent = 'Could not load the bills: ' + e.message; $('bl-error').style.display = '';
    });
  }
  // bills saved straight into the Drive Inbox are read one at a time
  function readPending() {
    var id = B.order.filter(function (k) { return B.items[k] && B.items[k].pending && !B.items[k].reading; })[0];
    if (!id) return;
    B.items[id].reading = true; drawWait();
    call('billsReadFile', id).then(function (w) { B.items[id] = w; drawWait(); readPending(); })
      .catch(function (e) { B.items[id].reading = false; B.items[id].pending = false; B.items[id].notes = [e.message]; drawWait(); });
  }
  function drawMonths() {
    var d = B.d;
    $('bl-month').innerHTML = (d.months || []).map(function (m) { return '<option value="' + esc(m.k) + '"' + (m.k === d.month ? ' selected' : '') + '>' + esc(m.label) + ' (' + m.n + ')</option>'; }).join('');
  }
  $('bl-month').addEventListener('change', function () { B.month = this.value; B.d = B.d || {}; load(this.value); });
  $('bl-refresh').addEventListener('click', function () { load(); });
  $('bl-q').addEventListener('input', function () { B.q = this.value.trim().toLowerCase(); drawRows(); });

  /* ---------- the month's bills ---------- */
  function visible() {
    var rows = (B.d && B.d.rows) || [], q = B.q;
    return !q ? rows : rows.filter(function (r) { return [r.name, r.inv, r.trn, r.paid, dmy(r.date), money(r.total)].join(' ').toLowerCase().indexOf(q) > -1; });
  }
  function drawRows() {
    if (!B.d) return;
    var rows = visible(), all = B.d.rows || [];
    $('bl-list-title').textContent = 'Bills in ' + monLabel(B.d.month);
    var t = { net: 0, vat: 0, total: 0 }, unpaid = 0;
    all.forEach(function (r) { t.net += r.net; t.vat += r.vat; t.total += r.total; if (!r.paid) unpaid++; });
    $('bl-kpis').innerHTML = [['Bills', all.length], ['Net', money(t.net)], ['VAT', money(t.vat)], ['Total', money(t.total)], ['Not paid yet', unpaid]]
      .map(function (k) { return '<div class="bl-k"><small>' + k[0] + '</small><b>' + esc(k[1]) + '</b></div>'; }).join('');
    if (!all.length) { $('bl-rows').innerHTML = '<div class="bl-empty">No bills saved for ' + esc(monLabel(B.d.month)) + ' yet.</div>'; return; }
    if (!rows.length) { $('bl-rows').innerHTML = '<div class="bl-empty">Nothing matches the search.</div>'; return; }
    var f = { net: 0, vat: 0, total: 0 };
    rows.forEach(function (r) { f.net += r.net; f.vat += r.vat; f.total += r.total; });
    $('bl-rows').innerHTML = '<div class="bl-tw"><table class="bl-tbl"><thead><tr><th>Subcontractor</th><th>Invoice no.</th><th>Invoice date</th><th>TRN</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Paid</th><th>File</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="c1">' + esc(r.name) + '</td><td class="nw" data-h="Invoice">' + esc(r.inv) + '</td><td class="nw" data-h="Date">' + esc(dmy(r.date)) + '</td><td class="nw" data-h="TRN">' + esc(r.trn) + '</td>' +
          '<td class="num" data-h="Net">' + money(r.net) + '</td><td class="num" data-h="VAT">' + money(r.vat) + '</td><td class="num c-total">' + money(r.total) + '</td>' +
          '<td data-h="Paid">' + (r.paid ? '<span class="bl-paid">' + esc(r.paid) + ' <button type="button" data-unpay="' + esc(r.id) + '" title="Not paid (wrong match)" aria-label="Mark not paid">✕</button></span>' : '<span class="bl-unpaid">Not yet</span>') + '</td>' +
          '<td class="nw" data-h="File">' + (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener">Open ↗</a>' : '') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="4">' + rows.length + ' bill' + (rows.length === 1 ? '' : 's') + '</td><td class="num">' + money(f.net) + '</td><td class="num">' + money(f.vat) + '</td><td class="num">' + money(f.total) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
  }
  $('bl-rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unpay]'); if (!b) return;
    if (!confirm('Mark this bill as not paid?')) return;
    b.disabled = true;
    call('billsUnmarkPaid', b.getAttribute('data-unpay')).then(function () { note('Marked as not paid'); load(); }).catch(function (e2) { note(e2.message); b.disabled = false; });
  });

  /* ---------- Excel for the month ---------- */
  $('bl-xlsx').addEventListener('click', function () {
    if (!B.d || !(B.d.rows || []).length) { note('No bills in this month yet.'); return; }
    var rows = B.d.rows, head = ['Subcontractor Name', 'Invoice Number', 'Invoice Date', 'TRN', 'Net Amount', 'VAT Amount', 'Total Amount', 'Paid (bank)', 'File link'];
    var t = [0, 0, 0];
    var aoa = [head].concat(rows.map(function (r) { t[0] += r.net; t[1] += r.vat; t[2] += r.total; return [r.name, r.inv, dmy(r.date), r.trn, r2(r.net), r2(r.vat), r2(r.total), r.paid || '', r.link || '']; }));
    aoa.push(['Total (' + rows.length + ' bills)', '', '', '', r2(t[0]), r2(t[1]), r2(t[2]), '', '']);
    var base = 'Bills ' + monLabel(B.d.month);
    if (window.XLSX) {
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 12 }, { wch: 17 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 22 }, { wch: 40 }];
      for (var i = 1; i < aoa.length; i++) for (var c = 4; c <= 6; c++) { var cell = ws[XLSX.utils.encode_cell({ r: i, c: c })]; if (cell) cell.z = '#,##0.00'; }
      for (var j = 1; j < aoa.length - 1; j++) { var tc = ws[XLSX.utils.encode_cell({ r: j, c: 3 })]; if (tc) tc.t = 's'; }
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, monLabel(B.d.month).replace(/[\\\/?*\[\]:]/g, ' '));
      XLSX.writeFile(wb, base + '.xlsx');
    } else {
      var csv = aoa.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = base + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
    }
  });

  /* ---------- adding bills ---------- */
  function start(files) {
    if (B.run && B.run.active) { note('Still reading the previous bills. Add these when it finishes.'); return; }
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    B.run = { active: true, items: list.map(function (f) { return { f: f, st: 'Waiting', cls: 'run' }; }) };
    drawRun();
    var i = 0;
    (function next() {
      var it = B.run.items[i++];
      if (!it) { B.run.active = false; drawRun(); note('Bills read. Check them below, then Save.'); return; }
      if (it.f.size > MAX) { it.st = 'Larger than 18 MB'; it.cls = 'bad'; drawRun(); next(); return; }
      it.st = 'Reading…'; drawRun();
      var tries = 0;
      (function go() {
        tries++;
        readB64(it.f).then(function (b64) { return call('billsUpload', { name: it.f.name, b64: b64, mime: it.f.type || '' }); }).then(function (w) {
          it.st = 'Read: check it below'; it.cls = 'ok'; drawRun();
          if (!B.items[w.id]) B.order.unshift(w.id);
          w.local = true; B.items[w.id] = w; drawWait(); next();
        }).catch(function (e) {
          if (tries < 3 && !/larger than|arrived empty|Safety stop|not set yet|cannot be opened/i.test(e.message)) { it.st = 'Connection problem, trying again…'; drawRun(); setTimeout(go, tries * 3000); return; }
          it.st = e.message; it.cls = 'bad'; drawRun(); next();
        });
      })();
    })();
  }
  function drawRun() {
    if (!B.run) return;
    $('bl-run').style.display = '';
    $('bl-run').innerHTML = B.run.items.map(function (it) { return '<div><span title="' + esc(it.f.name) + '">' + esc(it.f.name) + '</span><b class="' + it.cls + '">' + esc(it.st) + '</b></div>'; }).join('');
  }
  $('bl-input').addEventListener('change', function () { start(this.files); this.value = ''; });
  function dz(el, fn) {
    ['dragenter', 'dragover'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.preventDefault(); el.classList.remove('over'); }); });
    el.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) fn(e.dataTransfer.files); });
  }
  dz($('bl-drop'), start);

  /* ---------- check before saving ---------- */
  function monthOpts(sel) {
    var now = new Date(), out = [], seen = {};
    for (var k = 1; k >= -18; k--) { var d = new Date(now.getFullYear(), now.getMonth() + k, 1); var ym = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); out.push(ym); seen[ym] = 1; }
    if (sel && !seen[sel]) out.push(sel);
    return out.map(function (ym) { return '<option value="' + ym + '"' + (ym === sel ? ' selected' : '') + '>' + monLabel(ym) + '</option>'; }).join('');
  }
  function warnHtml(w) {
    var h = (w.warn || []).map(function (x) { return '<div>⚠ ' + esc(x) + '</div>'; }).join('');
    return h;
  }
  function dupHtml(w) {
    if (!w.dup) return '';
    return '<div>Already saved: invoice ' + esc(w.dup.inv) + ' (' + esc(monLabel(w.dup.month)) + ', ' + esc(dmy(w.dup.date)) + ', total ' + money(w.dup.total) + ')' +
      (w.dup.link ? ' · <a href="' + esc(w.dup.link) + '" target="_blank" rel="noopener">open it</a>' : '') + '. Saving again needs “Save anyway”.</div>';
  }
  function drawWait() {
    var ids = B.order.filter(function (id) { return B.items[id]; });
    $('bl-check').style.display = ids.length ? '' : 'none';
    $('bl-wn').textContent = ids.length;
    var box = $('bl-wait');
    // keep what you are typing: only add / remove cards, never redraw one that is on screen (unless it was just read)
    var have = {};
    Array.prototype.forEach.call(box.querySelectorAll('.bl-b'), function (el) {
      var id = el.getAttribute('data-id'), w = B.items[id];
      if (!w || ids.indexOf(id) < 0 || el.getAttribute('data-v') !== ver(w)) el.remove(); else have[id] = 1;
    });
    var prev = null;
    ids.forEach(function (id) {
      var el = box.querySelector('.bl-b[data-id="' + cssId(id) + '"]');
      if (!el) { el = document.createElement('div'); el.className = 'bl-b'; el.setAttribute('data-id', id); el.setAttribute('data-v', ver(B.items[id])); el.innerHTML = cardHtml(B.items[id]); }
      if (prev ? prev.nextSibling !== el : box.firstChild !== el) box.insertBefore(el, prev ? prev.nextSibling : box.firstChild);
      prev = el;
    });
  }
  function cssId(id) { return String(id).replace(/["\\]/g, '\\$&'); }
  function ver(w) { return w.pending ? (w.reading ? 'r' : 'p') : 'd'; }
  function cardHtml(w) {
    if (w.pending) return '<div class="bl-bh"><a href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.file) + ' ↗</a><small>' + (w.reading ? 'Google is reading it…' : 'Saved in Drive, waiting to be read') + '</small></div>';
    var net = num(w.net), vat = r2(net * 0.05);
    var how = w.read ? (w.how ? 'Read by Google: ' + w.how : 'Read by Google') : 'Not read';
    var trns = (w.trns || []).filter(function (t) { return t !== w.trn; });
    return '<div class="bl-bh"><a href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.file) + ' ↗</a><small>' + esc(how) + '</small></div>' +
      '<div class="bl-grid">' +
        '<div class="bl-f w2"><label>Subcontractor name</label><input class="bl-in" data-k="name" list="bl-subs" value="' + esc(w.name) + '" autocomplete="off"></div>' +
        '<div class="bl-f"><label>Invoice number</label><input class="bl-in" data-k="inv" value="' + esc(w.inv) + '" autocomplete="off"></div>' +
        '<div class="bl-f"><label>Invoice date</label><input class="bl-in" data-k="date" type="date" value="' + esc(w.date) + '"></div>' +
        '<div class="bl-f"><label>TRN</label><input class="bl-in" data-k="trn" inputmode="numeric" value="' + esc(w.trn) + '" autocomplete="off"></div>' +
        '<div class="bl-f"><label>Net amount</label><input class="bl-in" data-k="net" inputmode="decimal" value="' + (net ? esc(net.toFixed(2)) : '') + '" autocomplete="off"></div>' +
        '<div class="bl-f"><label>Month (for the report)</label><select class="bl-in" data-k="month">' + monthOpts(w.month) + '</select></div>' +
      '</div>' +
      (trns.length ? '<div class="bl-chips"><small class="muted" style="font-size:11.5px;">Other TRNs on the bill:</small>' + trns.map(function (t) { return '<button type="button" class="bl-chip" data-trn="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="bl-sum"><span>VAT 5%: <b data-o="vat">' + money(vat) + '</b></span><span>Total: <b data-o="total">' + money(net + vat) + '</b></span>' +
        (w.tp ? '<span class="muted">Total on the bill: ' + money(w.tp) + '</span>' : '') + '</div>' +
      '<div class="bl-warn" data-o="notes">' + (w.notes || []).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' +
      '<div class="bl-warn" data-o="warn">' + warnHtml(w) + '</div>' +
      '<div class="bl-warn bl-dup" data-o="dup">' + dupHtml(w) + '</div>' +
      '<div class="bl-btns"><button type="button" class="btn btn-primary btn-sm" data-act="save">' + (w.dup ? 'Save anyway' : 'Save') + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="skip" title="Moves it to Bills / Not saved">Not a bill</button></div>';
  }
  function vals(el) {
    var o = {}; Array.prototype.forEach.call(el.querySelectorAll('[data-k]'), function (i) { o[i.getAttribute('data-k')] = i.value.trim(); }); return o;
  }
  var checkT = {};
  function recalc(el) {
    var id = el.getAttribute('data-id'), w = B.items[id], v = vals(el), net = num(v.net), vat = r2(net * 0.05);
    el.querySelector('[data-o="vat"]').textContent = money(vat);
    el.querySelector('[data-o="total"]').textContent = money(net + vat);
    clearTimeout(checkT[id]);
    checkT[id] = setTimeout(function () {
      call('billsCheck', { id: id, name: v.name, inv: v.inv, trn: v.trn, net: net, vp: w.vp, tp: w.tp }).then(function (c) {
        w.warn = c.warn; w.dup = c.dup;
        if (!el.isConnected) return;
        el.querySelector('[data-o="warn"]').innerHTML = warnHtml(w);
        el.querySelector('[data-o="dup"]').innerHTML = dupHtml(w);
        el.querySelector('[data-act="save"]').textContent = w.dup ? 'Save anyway' : 'Save';
      }).catch(function () {});
    }, 700);
  }
  $('bl-wait').addEventListener('input', function (e) { var el = e.target.closest('.bl-b'); if (el && e.target.matches('[data-k]')) recalc(el); });
  $('bl-wait').addEventListener('change', function (e) {
    var el = e.target.closest('.bl-b'); if (!el || !e.target.matches('[data-k]')) return;
    if (e.target.getAttribute('data-k') === 'date' && e.target.value) { var s = el.querySelector('[data-k="month"]'); var ym = e.target.value.substring(0, 7); if (!s.querySelector('option[value="' + ym + '"]')) s.insertAdjacentHTML('beforeend', '<option value="' + ym + '">' + monLabel(ym) + '</option>'); s.value = ym; }
    if (e.target.getAttribute('data-k') === 'name') {
      var hit = ((B.d && B.d.subs) || []).filter(function (x) { return x.name === e.target.value; })[0], t = el.querySelector('[data-k="trn"]');
      if (hit && hit.trn && !t.value) t.value = hit.trn;
    }
    recalc(el);
  });
  $('bl-wait').addEventListener('click', function (e) {
    var el = e.target.closest('.bl-b'); if (!el) return;
    var id = el.getAttribute('data-id'), w = B.items[id];
    var chip = e.target.closest('[data-trn]');
    if (chip) { el.querySelector('[data-k="trn"]').value = chip.getAttribute('data-trn'); recalc(el); return; }
    var b = e.target.closest('[data-act]'); if (!b) return;
    if (b.getAttribute('data-act') === 'skip') {
      if (!confirm('Not a bill? It moves to the Drive folder Bills / Not saved.')) return;
      b.disabled = true;
      call('billsSkip', id).then(function () { delete B.items[id]; drawWait(); note('Moved to Bills / Not saved'); }).catch(function (e2) { note(e2.message); b.disabled = false; });
      return;
    }
    var v = vals(el);
    if (!v.name) { note('Type the subcontractor name.'); return; }
    if (!v.inv) { note('Type the invoice number.'); return; }
    if (!v.date) { note('Pick the invoice date.'); return; }
    if (!(num(v.net) > 0)) { note('Type the net amount.'); return; }
    v.id = id; v.net = num(v.net); v.force = !!w.dup;
    b.disabled = true; b.textContent = 'Saving…';
    call('billsSave', v).then(function (r) {
      if (r.state === 'duplicate') {
        w.dup = r.dup; el.querySelector('[data-o="dup"]').innerHTML = dupHtml(w);
        b.disabled = false; b.textContent = 'Save anyway'; note('That invoice is already saved.'); return;
      }
      delete B.items[id]; drawWait();
      note('Saved: ' + v.name + ' ' + v.inv + ' (' + monLabel(r.month) + ')');
      load(r.month);
    }).catch(function (e2) { note(e2.message); b.disabled = false; b.textContent = w.dup ? 'Save anyway' : 'Save'; });
  });

  /* ---------- bank statement ---------- */
  function statement(files) {
    var f = files && files[0]; if (!f) return;
    if (B.stBusy) return;
    if (f.size > MAX) { note('The statement is larger than 18 MB.'); return; }
    B.stBusy = true;
    $('bl-sres').innerHTML = '<div class="loading-box" style="padding:24px 10px;"><div class="spin-dark"></div><span>Reading the statement and matching the bills…</span></div>';
    readB64(f).then(function (b64) { return call('billsMatchStatement', { name: f.name, b64: b64, mime: f.type || 'application/pdf' }); }).then(function (r) {
      B.stBusy = false; B.st = r; drawStatement();
    }).catch(function (e) { B.stBusy = false; $('bl-sres').innerHTML = '<div class="bl-warn bl-dup" style="margin-top:12px;">' + esc(e.message) + '</div>'; });
  }
  function billLine(b) { return esc(b.name) + ' · ' + esc(b.inv) + ' · ' + esc(b.monthLabel || monLabel(b.month)) + ' · ' + money(b.total); }
  function drawStatement() {
    var r = B.st; if (!r) return;
    var h = '<div class="bl-sum" style="margin-top:14px;"><span><a href="' + esc(r.statementUrl) + '" target="_blank" rel="noopener">' + esc(r.statement) + ' ↗</a></span>' +
      '<span><b>' + r.matches.length + '</b> payment' + (r.matches.length === 1 ? '' : 's') + ' matched</span><span><b>' + r.notFound.length + '</b> unpaid bill' + (r.notFound.length === 1 ? '' : 's') + ' not on it</span>' +
      '<span><b>' + r.extra.length + '</b> other line' + (r.extra.length === 1 ? '' : 's') + '</span></div>';
    if (!r.lines) h += '<div class="bl-warn" style="margin-top:10px;">No dated lines with amounts were found in the statement. Send a sample to Claude so the reading can be tuned.</div>';
    if (r.matches.length) {
      h += '<div class="bl-sh">Matched: tick the right ones, then mark them paid</div>' + r.matches.map(function (m, i) {
        return '<label class="bl-m"><input type="checkbox" data-mi="' + i + '"' + (m.sure ? ' checked' : '') + '>' +
          '<div><div class="t">' + m.bills.map(billLine).join('<br>') + '<span class="bl-tag ' + (m.sure ? 'sure' : 'maybe') + '">' + esc(m.how) + '</span></div>' +
          '<div class="l">' + esc(dmy(m.date)) + ' · ' + esc(m.line) + '</div></div><div class="a">' + money(m.amount) + '</div></label>';
      }).join('') +
        '<div class="bl-btns"><button type="button" class="btn btn-primary btn-sm" id="bl-pay">Mark ticked as paid</button></div>';
    }
    if (r.notFound.length) {
      h += '<div class="bl-sh">Unpaid bills not found on this statement</div>' + r.notFound.map(function (b) {
        return '<div class="bl-m"><span></span><div><div class="t">' + esc(b.name) + ' · ' + esc(b.inv) + '</div><div class="l">' + esc(b.monthLabel) + ' · invoice date ' + esc(dmy(b.date)) +
          (b.link ? ' · <a href="' + esc(b.link) + '" target="_blank" rel="noopener">open</a>' : '') + '</div></div><div class="a">' + money(b.total) + '</div></div>';
      }).join('');
    }
    if (r.extra.length) {
      h += '<details><summary>Statement lines with no bill (' + r.extra.length + ')</summary><div class="muted" style="font-size:11.5px;margin:6px 0;">Best guess from the PDF: check the amounts against the statement itself.</div>' + r.extra.map(function (x) {
        return '<div class="bl-m"><span></span><div><div class="l">' + esc(dmy(x.date)) + ' · ' + esc(x.line) + '</div></div><div class="a">' + money(x.amount) + '</div></div>';
      }).join('') + '</details>';
    }
    $('bl-sres').innerHTML = h;
  }
  $('bl-sres').addEventListener('click', function (e) {
    if (!e.target.closest('#bl-pay')) return;
    var b = e.target.closest('#bl-pay'), r = B.st;
    var items = Array.prototype.filter.call($('bl-sres').querySelectorAll('input[data-mi]'), function (c) { return c.checked; })
      .map(function (c) { var m = r.matches[+c.getAttribute('data-mi')]; return { ids: m.ids, date: m.date, statement: r.statement }; });
    if (!items.length) { note('Tick at least one match.'); return; }
    b.disabled = true; b.textContent = 'Marking…';
    call('billsMarkPaid', { items: items }).then(function (x) {
      note(x.marked + ' bill' + (x.marked === 1 ? '' : 's') + ' marked as paid');
      var gone = {}; items.forEach(function (it) { it.ids.forEach(function (id) { gone[id] = 1; }); });
      r.matches = r.matches.filter(function (m) { return !m.ids.every(function (id) { return gone[id]; }); });
      drawStatement(); load();
    }).catch(function (e2) { note(e2.message); b.disabled = false; b.textContent = 'Mark ticked as paid'; });
  });
  $('bl-sinput').addEventListener('change', function () { statement(this.files); this.value = ''; });
  dz($('bl-sdrop'), statement);

  window.addEventListener('beforeunload', function (e) { if ((B.run && B.run.active) || B.stBusy) { e.preventDefault(); e.returnValue = ''; } });
  if (shown()) load();
})();
