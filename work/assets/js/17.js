/* ---------------- ADDED: PDF Compiler (server: PdfCompiler.gs) ----------------
   * "PDF Compiler" page: pick works, drop the files, merge each work into ONE A4 portrait PDF, save it in Drive and/or download it.
   * The merge runs here in the browser (pdf-lib, loaded only when the page is first opened).
   * A "Merged PDF" box is added to each work's detail panel.
   Uses only public things of the page above (ST, toast) and the server file PdfCompiler.gs. */
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
  function dTime(t) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] + (m[4] ? ', ' + m[4] + ':' + m[5] : '') : (t || ''); }
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function key(q) { return String(q || '').toUpperCase().replace(/\s+/g, ''); }

  var A4W = 595.28, A4H = 841.89;
  var SLOTS = [
    { k: 'quote', label: 'Quotation' },
    { k: 'breakdown', label: 'Breakdown report', opt: true },
    { k: 'email', label: 'Approval email' },
    { k: 'other', label: 'Other documents', opt: true, open: true }       // any other PDF or picture, as many as needed
  ];

  /* ================= pdf-lib (loaded on first use) ================= */
  var libP = null;
  function lib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = function () { window.PDFLib ? res(window.PDFLib) : rej(new Error('The PDF tool did not load.')); };
      s.onerror = function () { libP = null; rej(new Error('The PDF tool could not be loaded. Check the internet connection and press Refresh.')); };
      document.head.appendChild(s);
    });
    return libP;
  }

  /* ================= file name ================= */
  var EMPTY = /^(-+|n\/?a|nil|none|common( area)?|na|0)$/i;
  function clean(s) { return String(s || '').replace(/[\\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function bCode(b) { var m = /^\s*(DD\s*\d+(?:\s*\/\s*[A-Z])?)/i.exec(b || ''); return m ? m[1].replace(/\s+/g, '').toUpperCase() : ''; }
  //  "<CRM> - <Title> at <DD106-V030>"   or, with no CRM (common areas):   "<Title> at <DD123 - Mankhool Building>"
  function nameParts(w) {
    var crm = clean(w.crm); if (EMPTY.test(crm)) crm = '';
    var title = clean(w.desc);
    if (crm && title.indexOf(crm) === 0) title = title.substring(crm.length).replace(/^[\s\-–:]+/, '');
    title = title.replace(/\s*-?\s*\bat\s+wasl\s+dd\s+project\b.*$/i, '').replace(/\s+-\s*\d{6}\s*$/, '').trim();
    var code = bCode(w.building), apt = clean(w.apt);
    apt = EMPTY.test(apt) ? '' : apt.replace(/\s+/g, '');
    var loc = '';
    if (apt && code) loc = apt.toUpperCase().indexOf(code) === 0 ? apt : code + '-' + apt;
    else if (apt) loc = apt;
    else loc = clean(w.building).replace(/\s*\/\s*/g, '-');
    var hasLoc = !!code && title.toUpperCase().indexOf(code) > -1;
    return { crm: crm, title: title || clean(w.qtn), loc: loc, hasLoc: hasLoc, qtn: clean(w.qtn), date: String(w.qtnDate || '').substring(0, 10) };
  }
  function defaultName(w) {
    var p = nameParts(w);
    return clean((p.crm ? p.crm + ' - ' : '') + p.title + (p.loc && !p.hasLoc ? ' at ' + p.loc : '')).substring(0, 180);
  }
  // a name made from a pattern such as "{crm} - {title} at {loc}"; parts that are empty leave no dangling " - " or " at"
  function patName(pat, w) {
    var p = nameParts(w);
    var s = String(pat || '').replace(/\{(crm|title|loc|qtn|date)\}/gi, function (m, k) { return p[k.toLowerCase()] || ''; });
    s = clean(s).replace(/(\s*[-–:·]\s*){2,}/g, ' - ').replace(/^[\s\-–:·]+|[\s\-–:·]+$/g, '').replace(/\s+at$/i, '').replace(/^at\s+/i, '');
    return clean(s).substring(0, 180);
  }

  /* ================= state ================= */
  var P = { data: null, loading: false, filter: 'todo', q: '', shown: 60, jobs: [], seq: 0, pgSize: window.innerWidth < 600 ? 104 : 132 };
  var fetchQ = Promise.resolve();                // Drive files are fetched one at a time

  function work(qtn) { var k = key(qtn); return ((P.data && P.data.works) || []).filter(function (w) { return key(w.qtn) === k; })[0] || null; }
  function merged(qtn) { return (P.data && P.data.merged && P.data.merged[key(qtn)]) || null; }
  function jobOf(qtn) { var k = key(qtn); return P.jobs.filter(function (j) { return key(j.qtn) === k; })[0] || null; }
  // scroll the page area (#content) to an element; scrollIntoView would also shift the whole app frame
  function scrollToEl(el) {
    var c = $('content'); if (!c) return;
    var r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
    c.scrollTo({ top: c.scrollTop + (r.top - cr.top) - Math.max(0, (cr.height - r.height) / 2), behavior: 'smooth' });
  }
  function jobById(id) { return P.jobs.filter(function (j) { return j.id === id; })[0] || null; }

  /* ================= page show / hide ================= */
  function showPage(on) { $('view-pdfc').style.display = on ? '' : 'none'; }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'pdfc'; showPage(on); if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function goPage(thenQtn) {
    var n = document.querySelector('.nav-item[data-view="pdfc"]');
    if (n) n.click();
    if (thenQtn) whenLoaded(function () { addJob(thenQtn, true); });
  }
  var waiters = [];
  function whenLoaded(fn) { if (P.data) fn(); else waiters.push(fn); }

  function opened() {
    lib().catch(function () {});
    if (!P.data && !P.loading) load();
  }

  function load() {
    P.loading = true;
    $('pc-error').style.display = 'none';
    if (!P.data) { $('pc-loading').style.display = ''; $('pc-body').style.display = 'none'; }
    call('pdfcInit').then(function (d) {
      P.data = d; P.loading = false;
      $('pc-loading').style.display = 'none'; $('pc-body').style.display = '';
      if (d.folderUrl) { $('pc-folder').href = d.folderUrl; $('pc-folder').style.display = ''; }
      renderList(); renderJobs();
      var w = waiters; waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} });
    }).catch(function (e) {
      P.loading = false;
      $('pc-loading').style.display = 'none';
      $('pc-error').innerHTML = esc(e.message) + ' <button class="btn btn-ghost btn-sm" id="pc-retry">Try again</button>';
      $('pc-error').style.display = '';
    });
  }

  /* ================= 1. the works list ================= */
  function renderList() {
    var list = (P.data && P.data.works) || [], q = P.q.toLowerCase().trim();
    var rows = list.filter(function (w) {
      var m = !!merged(w.qtn);
      if (P.filter === 'todo' && (!w.approved || m)) return false;
      if (P.filter === 'merged' && !m) return false;
      if (!q) return true;
      return [w.qtn, w.crm, w.desc, w.building, w.apt].join(' ').toLowerCase().indexOf(q) > -1;
    });
    rows.sort(function (a, b) { return a.qtnDate < b.qtnDate ? 1 : (a.qtnDate > b.qtnDate ? -1 : 0); });
    var h = rows.slice(0, P.shown).map(function (w) {
      var m = merged(w.qtn), j = jobOf(w.qtn);
      return '<div class="pc-row"><div class="q">' + esc(w.qtn) + (w.crm ? '<small>CRM ' + esc(w.crm) + '</small>' : '<small>Common area</small>') + '</div>' +
        '<div class="w"><div title="' + esc(w.desc) + '">' + esc(w.desc || '(no description)') + '</div><small>' + esc([w.building, w.apt].filter(Boolean).join(' · ')) + '</small>' +
        (m ? '<span class="pc-tag">Merged ' + esc(dTime(m.at).replace(/, \d\d:\d\d$/, '')) + '</span>' : '') + (!w.approved ? '<span class="pc-tag grey">Not approved</span>' : '') + '</div>' +
        '<div>' + (j ? '<button type="button" class="btn btn-ghost btn-sm" disabled>Added</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-add="' + esc(w.qtn) + '">+ Add</button>') + '</div></div>';
    }).join('');
    if (!rows.length) h = '<div class="pc-empty">' + (P.filter === 'todo' && !q ? 'Every approved work is merged. Use "All" to merge another one.' : 'No works match.') + '</div>';
    else if (rows.length > P.shown) h += '<div class="pc-more"><button type="button" class="btn btn-ghost btn-sm" id="pc-more">Show more (' + (rows.length - P.shown) + ')</button></div>';
    $('pc-list').innerHTML = h;
  }

  /* ================= 2. jobs ================= */
  function newItem(slot, name, src) { return { id: 'i' + (++P.seq), slot: slot, name: name, src: src, bytes: null, kind: '', pages: null, state: 'loading', msg: '' }; }

  function addJob(qtn, scroll) {
    var w = work(qtn);
    if (!w) { note('The quote ' + qtn + ' was not found in the tracker.'); return null; }
    var j = jobOf(qtn);
    if (!j) {
      j = { id: 'j' + (++P.seq), qtn: w.qtn, w: w, name: defaultName(w), slots: { quote: [], breakdown: [], email: [], other: [] }, state: '', msg: '', res: null, blob: null, busy: false };
      P.jobs.push(j);
      renderJobs(); renderList();
      loadDrive(j);
    }
    if (scroll) setTimeout(function () { var el = document.querySelector('.pc-job[data-j="' + j.id + '"]'); if (el) scrollToEl(el); }, 60);
    return j;
  }

  // a blank compile: any PDFs and pictures, not tied to a work (download only)
  function addFree() {
    var n = P.jobs.filter(function (x) { return x.free; }).length + 1;
    var j = { id: 'j' + (++P.seq), free: true, qtn: 'FREE-' + (++P.seq), w: { qtn: '', crm: '', desc: '', building: '', apt: '' }, name: 'Merged documents' + (n > 1 ? ' ' + n : ''),
      slots: { quote: [], breakdown: [], email: [], other: [] }, state: '', msg: '', res: null, blob: null, busy: false };
    P.jobs.unshift(j);
    renderJobs(); renderList();
    var el = document.querySelector('.pc-job[data-j="' + j.id + '"]');
    if (el) { var host = $('pc-jobs'); host.insertBefore(el, host.firstChild); setTimeout(function () { scrollToEl(el); }, 60); }
    return j;
  }
  function slotsFor(j) { return j.free ? SLOTS.filter(function (s) { return s.k === 'other'; }) : SLOTS; }

  // the quotation from the tracker + approval emails / breakdown reports already saved in Job Documents
  function loadDrive(j) {
    j.drive = 'loading'; drawJob(j);
    call('pdfcCandidates', j.qtn).then(function (r) {
      j.drive = r.files.length ? '' : 'none';
      r.files.forEach(function (f) {
        var it = newItem(f.slot, f.name, f.from === 'tracker' ? 'from the tracker' : 'from Job Documents');
        it.fileId = f.id;
        j.slots[f.slot].push(it);
        fetchQ = fetchQ.then(function () {
          if (P.jobs.indexOf(j) < 0 || !findItem(j, it.id)) return;
          return call('pdfcFetch', j.qtn, f.id).then(function (x) { return prepare(it, b64ToBytes(x.b64), x.mime, x.name); })
            .catch(function (e) { it.state = 'bad'; it.msg = e.message; }).then(function () { drawJob(j); });
        });
      });
      drawJob(j);
    }).catch(function (e) { j.drive = 'error'; j.driveMsg = e.message; drawJob(j); });
  }

  function findItem(j, id) {
    for (var s in j.slots) { var l = j.slots[s]; for (var i = 0; i < l.length; i++) if (l[i].id === id) return { list: l, i: i, it: l[i] }; }
    return null;
  }

  /* ---- reading a dropped / fetched file ---- */
  function b64ToBytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function bytesToB64(bytes) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = function () { rej(new Error('Could not prepare the PDF for upload.')); };
      r.onload = function () { var s = String(r.result || ''); res(s.substring(s.indexOf(',') + 1)); };
      r.readAsDataURL(new Blob([bytes], { type: 'application/pdf' }));
    });
  }
  function readFile(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = function () { rej(new Error('Could not read ' + f.name)); };
      r.onload = function () { res(new Uint8Array(r.result)); };
      r.readAsArrayBuffer(f);
    });
  }
  function kindOf(name, mime) {
    var n = String(name || '').toLowerCase(), m = String(mime || '').toLowerCase();
    if (m === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
    if (/^image\/(jpe?g|png|gif|webp|bmp)$/.test(m) || /\.(jpe?g|png|gif|webp|bmp)$/.test(n)) return 'image';
    if (/\.(msg|eml)$/.test(n)) return 'email';
    if (/\.(heic|heif)$/.test(n) || /heic|heif/.test(m)) return 'heic';
    return '';
  }
  // checks a file and counts its pages
  function prepare(it, bytes, mime, name) {
    it.kind = kindOf(name || it.name, mime);
    it.bytes = bytes; it.size = bytes.length;
    if (it.kind === 'image') { it.pages = 1; it.state = 'ok'; it.mime = mime; return Promise.resolve(); }
    if (it.kind !== 'pdf') { it.state = 'bad'; it.msg = 'Not a PDF or picture.'; return Promise.resolve(); }
    return lib().then(function (L) {
      return L.PDFDocument.load(bytes, { updateMetadata: false }).then(function (d) {
        it.pages = d.getPageCount(); it.state = it.pages ? 'ok' : 'bad'; if (!it.pages) it.msg = 'This PDF has no pages.';
      });
    }).catch(function (e) {
      it.state = 'bad';
      it.msg = /encrypt/i.test(String(e && e.message)) ? 'Password-protected. Open it, Print to PDF, and drop the new file.' : 'This PDF could not be read (damaged?). ' + (e && e.message ? e.message.substring(0, 80) : '');
    });
  }

  function guessSlot(name) {
    var n = String(name || '').toLowerCase();
    if (/breakdown|observation|\bbd[-_ ]?20\d\d/.test(n)) return 'breakdown';
    if (/\b(re|fw|fwd)\s*[_:-]|approv|e-?mail|\bmail\b/.test(n)) return 'email';
    if (/quot|\bqtn\b|dd\s*20\d\d|agfs/.test(n)) return 'quote';
    return 'email';
  }

  function addFiles(j, files, slot) {
    Array.prototype.forEach.call(files, function (f) {
      var k = kindOf(f.name, f.type);
      if (k === 'email') { note(f.name + ': print the email to PDF first (Outlook: File > Print > Microsoft Print to PDF).'); return; }
      if (k === 'heic') { note(f.name + ': iPhone HEIC photos cannot be read here. Send it as JPG or take a screenshot.'); return; }
      if (!k) { note(f.name + ' is not a PDF or a picture.'); return; }
      var s = j.free ? 'other' : (slot || guessSlot(f.name));
      var it = newItem(s, f.name, 'dropped');
      j.slots[s].push(it);
      j.res = null; j.state = '';
      readFile(f).then(function (b) { return prepare(it, b, f.type, f.name); }).catch(function (e) { it.state = 'bad'; it.msg = e.message; }).then(function () { drawJob(j); });
    });
    drawJob(j);
  }

  /* ---- a pile of files for many works: matched by CRM or quote number in the file name ---- */
  function qtnFrom(name) {
    var m = /D{0,2}\s*(20\d\d)\s*[\/\-_ .]?\s*(\d{2})\s*[\/\-_ .]?\s*(\d{3,6})(?!\d)/i.exec(name || '');
    return m ? 'DD' + m[1] + '/' + m[2] + '/' + ('00000' + parseInt(m[3], 10)).slice(-5) : '';
  }
  function normQ(q) { var k = qtnFrom(q); return k || key(q); }
  function addPile(files) {
    var works = (P.data && P.data.works) || [], miss = [];
    Array.prototype.forEach.call(files, function (f) {
      var crm = (/(?:^|\D)(\d{10})(?!\d)/.exec(f.name) || [])[1] || '', q = qtnFrom(f.name), w = null;
      var pool = P.jobs.map(function (j) { return j.w; }).concat(works);
      if (crm) w = pool.filter(function (x) { return x.crm && x.crm.indexOf(crm) > -1; })[0] || null;
      if (!w && q) w = pool.filter(function (x) { return normQ(x.qtn) === q; })[0] || null;
      if (!w) { miss.push(f.name); return; }
      var j = addJob(w.qtn, false);
      if (j) addFiles(j, [f], null);
    });
    if (miss.length) note('Not matched to a work (add it to its card by hand): ' + miss.slice(0, 3).join(', ') + (miss.length > 3 ? ' and ' + (miss.length - 3) + ' more' : ''));
  }

  /* ================= v2: arrange pages (thumbnails, drag to reorder, rotate, delete) ================= */
  var RAW = 260;                                   // longest side of the preview picture kept for each page
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ICONS = {
    rot: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    dup: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    del: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
    page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    dl: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
  };
  function ic(name, cls) {
    if (name === 'grip') return '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function capLabel(it) { return it.slot === 'other' ? String(it.name || 'File').replace(/\.(pdf|jpe?g|png|gif|webp|bmp)$/i, '') : slotLabel(it); }
  function slotLabel(it) { for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].k === it.slot) return SLOTS[i].label; return 'File'; }

  /* ---- pdf.js (only to draw the small page pictures; loaded the first time pages are arranged) ---- */
  var pjsP = null;
  function pjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pjsP) return pjsP;
    pjsP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) { pjsP = null; rej(new Error('The page preview tool did not load.')); return; }
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (e) {}
        res(window.pdfjsLib);
      };
      s.onerror = function () { pjsP = null; rej(new Error('The page preview tool could not be loaded.')); };
      document.head.appendChild(s);
    });
    return pjsP;
  }

  // a small picture of a page as it will look on the A4 sheet (with the extra turn the user asked for)
  function compose(raw, rot) {
    var S = (P.data && P.data.settings) || {}, TW = 260, TH = Math.round(TW * A4H / A4W);
    var cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, TW, TH);
    var r = ((rot % 360) + 360) % 360, rw = raw.width, rh = raw.height;
    var vw = r % 180 ? rh : rw, vh = r % 180 ? rw : rh, tot = r;
    if (S.rotateLandscape !== false && vw > vh * 1.02) { tot = (r + 270) % 360; var t = vw; vw = vh; vh = t; }
    var m = (Number(S.margin) || 0) * TW / A4W, s = Math.min((TW - 2 * m) / vw, (TH - 2 * m) / vh);
    cx.save(); cx.translate(TW / 2, TH / 2); cx.rotate(tot * Math.PI / 180); cx.drawImage(raw, -rw * s / 2, -rh * s / 2, rw * s, rh * s); cx.restore();
    return cv.toDataURL('image/jpeg', 0.82);
  }
  function imgRaw(it) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(new Blob([it.bytes], { type: it.mime || 'image/jpeg' })), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, RAW / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
        res(cv);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('picture not readable')); };
      im.src = url;
    });
  }
  // the page of a file drawn as it is seen (its own turn already applied), one at a time
  function rawFor(it, n) {
    it.raws = it.raws || {};
    if (it.raws[n]) return Promise.resolve(it.raws[n]);
    if (it.kind === 'image') return imgRaw(it).then(function (c) { it.raws[n] = c; return c; });
    return pjs().then(function (lib) {
      if (!it.pjs) it.pjs = lib.getDocument({ data: new Uint8Array(it.bytes) }).promise;     // a copy: pdf.js may take over the buffer
      return it.pjs;
    }).then(function (doc) { return doc.getPage(n + 1); }).then(function (page) {
      var v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: RAW / Math.max(v1.width, v1.height) });
      var cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      return page.render({ canvasContext: cv.getContext('2d'), viewport: vp, background: '#ffffff' }).promise.then(function () {
        try { page.cleanup(); } catch (e) {}
        it.raws[n] = cv; return cv;
      });
    });
  }

  /* ---- the tiles: one per page, in the order they will be merged ---- */
  function mkTile(it, n, rot, id) {
    var t = { id: id || ('t' + (++P.seq)), it: it, n: n, rot: rot || 0, thumb: null, state: 'wait' };
    var raw = it.raws && it.raws[n];
    if (raw) { t.thumb = compose(raw, t.rot); t.state = 'ok'; }
    return t;
  }
  function buildTiles(j) {
    var out = [];
    SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) {
      if (it.state !== 'ok' || !it.pages) return;
      it.tiled = true;
      for (var p = 0; p < it.pages; p++) out.push(mkTile(it, p, 0));
    }); });
    return out;
  }
  function plainTiles(j) {                         // same order, without pictures: what the merge uses when pages were never arranged
    var out = [];
    SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) {
      if (it.state !== 'ok' || !it.pages) return;
      for (var p = 0; p < it.pages; p++) out.push({ it: it, n: p, rot: 0 });
    }); });
    return out;
  }
  // files added / removed / finished loading after the pages were arranged
  function syncTiles(j) {
    if (!j.tiles) return;
    var live = {};
    SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) { live[it.id] = it; }); });
    j.tiles = j.tiles.filter(function (t) { return live[t.it.id] && t.it.state === 'ok'; });
    SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) {
      if (it.state === 'ok' && it.pages && !it.tiled) { it.tiled = true; for (var p = 0; p < it.pages; p++) j.tiles.push(mkTile(it, p, 0)); }
    }); });
  }
  function snap(j) { return (j.tiles || []).map(function (t) { return { id: t.id, it: t.it, n: t.n, rot: t.rot }; }); }
  function pushUndo(j) { j.undo = j.undo || []; j.undo.push(snap(j)); if (j.undo.length > 40) j.undo.shift(); }
  function restoreSnap(j, s) {
    var cur = {};
    (j.tiles || []).forEach(function (t) { cur[t.id] = t; });
    j.tiles = s.map(function (x) {
      var t = cur[x.id];
      if (!t) return mkTile(x.it, x.n, x.rot, x.id);
      t.rot = x.rot; var raw = t.it.raws && t.it.raws[t.n]; if (raw) { t.thumb = compose(raw, t.rot); t.state = 'ok'; }
      return t;
    });
  }

  /* ---- drawing the tiles ---- */
  function setMedia(node, t) {
    var m = node.querySelector('.pg-media'); if (!m) return;
    m.style.setProperty('--r', t.rot + 'deg');
    if (t.thumb) {
      var img = m.querySelector('img');
      if (!img) { m.innerHTML = '<img alt="Page preview" draggable="false">'; img = m.firstChild; }
      if (img.getAttribute('src') !== t.thumb) img.src = t.thumb;
    } else if (t.state === 'fail') m.innerHTML = '<div class="pg-sk fail">' + ic('page') + '</div>';
    else m.innerHTML = '<div class="pg-sk"></div>';
  }
  function tileEl(j, t) {
    var n = document.createElement('div');
    n.className = 'pg-t'; n.dataset.t = t.id; n.dataset.s = t.it.slot; n.tabIndex = 0; n.setAttribute('role', 'listitem');
    n.innerHTML = '<div class="pg-card"><div class="pg-media"></div><span class="pg-n"></span>' +
      '<span class="pg-grip" title="Drag to move">' + ic('grip') + '</span>' +
      '<button type="button" class="pg-arrow l" data-pg="left" title="Move earlier" aria-label="Move this page earlier" tabindex="-1">' + ic('left') + '</button>' +
      '<button type="button" class="pg-arrow r" data-pg="right" title="Move later" aria-label="Move this page later" tabindex="-1">' + ic('right') + '</button>' +
      '<div class="pg-act"><button type="button" data-pg="rot" title="Turn 90° (R)" aria-label="Turn this page">' + ic('rot') + '</button>' +
      '<button type="button" data-pg="dup" title="Duplicate" aria-label="Duplicate this page">' + ic('dup') + '</button>' +
      '<button type="button" class="del" data-pg="del" title="Delete (Del)" aria-label="Delete this page">' + ic('del') + '</button></div></div>' +
      '<div class="pg-cap" title="' + esc(t.it.name) + '"><i class="pg-dot"></i><span>' + esc(capLabel(t.it)) + ' · p' + (t.n + 1) + (t.it.pages > 1 ? '/' + t.it.pages : '') + '</span></div>';
    n.addEventListener('animationend', function (e) { if (e.target === n) n.classList.remove('pg-in'); });
    setMedia(n, t);
    return n;
  }
  function paintTile(j, t) {
    if (!j.pgEl) return;
    var node = j.pgEl.querySelector('.pg-t[data-t="' + t.id + '"]'); if (node) setMedia(node, t);
  }
  // FLIP: change the grid, then let every tile glide from where it was to where it is now
  function flip(grid, change) {
    var first = {};
    Array.prototype.forEach.call(grid.children, function (c) { first[c.dataset.t] = c.getBoundingClientRect(); });
    change();
    if (REDUCED) return;
    Array.prototype.forEach.call(grid.children, function (c) {
      var f = first[c.dataset.t]; if (!f) return;
      var l = c.getBoundingClientRect(), dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) return;
      c.style.transition = 'none'; c.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      c.getBoundingClientRect();
      c.style.transition = ''; c.style.transform = '';
    });
  }
  function fadeClone(node) {
    if (REDUCED) return;
    var r = node.getBoundingClientRect(), c = node.cloneNode(true);
    c.className = 'pg-t pg-ghost'; c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    c.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)';
    view.appendChild(c); c.getBoundingClientRect();
    c.style.transition = 'opacity .26s ease, transform .26s cubic-bezier(.4,0,1,1)';
    c.style.opacity = '0'; c.style.transform = 'translate3d(' + r.left + 'px,' + (r.top + 16) + 'px,0) scale(.8)';
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 300);
  }
  function hostOf(j) { var el = document.querySelector('.pc-job[data-j="' + j.id + '"]'); return el ? el.querySelector('[data-pghost]') : null; }
  function gridOf(j) { return j.pgEl ? j.pgEl.querySelector('.pg-grid') : null; }

  function ensurePg(j) {
    if (j.pgEl) return j.pgEl;
    var el = document.createElement('div'); el.className = 'pg-panel';
    el.innerHTML = '<div class="pg-box"><div class="pg-bar"><div class="pg-title">' + ic('page') + 'Pages <span class="pg-count"></span></div>' +
      '<div class="pg-tools"><label class="pg-size" title="Preview size">' + ic('page') + '<input type="range" min="88" max="220" step="4" value="' + P.pgSize + '" data-pgsize="1" aria-label="Preview size">' + '</label>' +
      '<button type="button" class="pg-tb" data-pg-undo="1">' + ic('undo') + 'Undo</button>' +
      '<button type="button" class="pg-tb" data-pg-reset="1" title="Back to the order of the files above">' + ic('reset') + 'Reset order</button></div></div>' +
      '<div class="pg-note"></div><div class="pg-grid" role="list"></div><div class="pg-empty">No pages left. Press Undo or Reset order.</div></div>';
    j.pgEl = el;
    bindDrag(j, el.querySelector('.pg-grid'));
    el.addEventListener('keydown', function (e) {
      var node = e.target; if (!node.classList || !node.classList.contains('pg-t')) return;
      pgKey(j, e, node);
    });
    return el;
  }
  function renderPages(j) {
    var el = ensurePg(j), grid = el.querySelector('.pg-grid');
    syncTiles(j);
    var tiles = j.tiles || [], map = {};
    Array.prototype.forEach.call(grid.children, function (c) { map[c.dataset.t] = c; });
    flip(grid, function () {
      tiles.forEach(function (t, i) {
        var node = map[t.id];
        if (!node) { node = tileEl(j, t); node.classList.add('pg-in'); }
        delete map[t.id];
        if (grid.children[i] !== node) grid.insertBefore(node, grid.children[i] || null);
      });
      Object.keys(map).forEach(function (k) { if (map[k].parentNode === grid) grid.removeChild(map[k]); });
    });
    paintMeta(j);
    wantThumbs(j);
  }
  function paintMeta(j) {
    if (!j.pgEl) return;
    var grid = gridOf(j), tiles = j.tiles || [];
    Array.prototype.forEach.call(grid.children, function (c, i) { var b = c.querySelector('.pg-n'); if (b && b.textContent !== String(i + 1)) b.textContent = i + 1; });
    j.pgEl.querySelector('.pg-count').textContent = tiles.length + ' page' + (tiles.length === 1 ? '' : 's');
    j.pgEl.querySelector('[data-pg-undo]').disabled = !(j.undo && j.undo.length);
    j.pgEl.querySelector('.pg-empty').classList.toggle('show', !tiles.length);
    var note = j.pgEl.querySelector('.pg-note');
    note.className = 'pg-note' + (j.pgWarn ? ' warn' : '');
    note.textContent = j.pgWarn
      ? 'The page pictures could not be drawn (the preview tool needs the internet). You can still drag, turn and delete pages by their numbers.'
      : 'Drag a page to move it, or use the buttons on it. The order here is the order of the merged PDF. Reset order goes back to the order of the files above.';
  }
  // draw the page pictures one at a time, so the screen stays smooth
  var thumbQ = Promise.resolve();
  function wantThumbs(j) {
    (j.tiles || []).forEach(function (t) {
      if (t.thumb || t.state !== 'wait' || t.queued) return;
      t.queued = true;
      thumbQ = thumbQ.then(function () {
        if (!j.tiles || j.tiles.indexOf(t) < 0 || P.jobs.indexOf(j) < 0) { t.queued = false; return; }
        return rawFor(t.it, t.n).then(function (cv) { t.thumb = compose(cv, t.rot); t.state = 'ok'; })
          .catch(function () { t.state = 'fail'; if (!j.pgWarn) { j.pgWarn = true; paintMeta(j); } })
          .then(function () { t.queued = false; paintTile(j, t); });
      });
    });
  }

  /* ---- what the buttons on a page do ---- */
  function touch(j) { j.res = null; j.state = ''; drawMeta(j); }
  function idxOf(tiles, id) { for (var i = 0; i < tiles.length; i++) if (tiles[i].id === id) return i; return -1; }
  function pgAct(j, act, node) {
    var tiles = j.tiles, grid = gridOf(j); if (!tiles || !grid || !node) return;
    var i = idxOf(tiles, node.dataset.t); if (i < 0) return;
    var t = tiles[i], nb = node.nextElementSibling || node.previousElementSibling;
    if (act === 'rot') {
      pushUndo(j); t.rot = (t.rot + 90) % 360;
      var m = node.querySelector('.pg-media'), c = m && m.firstElementChild;
      var done = function () {
        var raw = t.it.raws && t.it.raws[t.n]; if (raw) t.thumb = compose(raw, t.rot);
        if (c) { c.style.transition = 'none'; c.style.transform = ''; }
        setMedia(node, t);
      };
      if (c && !REDUCED) { c.style.transition = 'transform .26s cubic-bezier(.2,.8,.2,1)'; c.style.transform = 'rotate(90deg) scale(.72)'; setTimeout(done, 270); } else done();
    } else if (act === 'del') {
      pushUndo(j); fadeClone(node);
      flip(grid, function () { tiles.splice(i, 1); grid.removeChild(node); });
      if (nb) nb.focus({ preventScroll: true });
    } else if (act === 'dup') {
      pushUndo(j);
      var d = mkTile(t.it, t.n, t.rot); tiles.splice(i + 1, 0, d);
      flip(grid, function () { var nn = tileEl(j, d); nn.classList.add('pg-in'); grid.insertBefore(nn, node.nextSibling); });
    } else if (act === 'left' || act === 'right') {
      var k = act === 'left' ? i - 1 : i + 1; if (k < 0 || k >= tiles.length) return;
      pushUndo(j); tiles.splice(k, 0, tiles.splice(i, 1)[0]);
      flip(grid, function () { grid.insertBefore(node, act === 'left' ? node.previousElementSibling : node.nextElementSibling.nextElementSibling); });
      node.focus({ preventScroll: true });
    } else return;
    paintMeta(j); touch(j);
  }
  function undoPg(j) {
    if (!j.undo || !j.undo.length) return;
    restoreSnap(j, j.undo.pop());
    renderPages(j); touch(j);
  }
  function resetPg(j) {
    if (!j.tiles) return;
    pushUndo(j); j.tiles = null; SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) { it.tiled = false; }); });
    j.tiles = buildTiles(j);
    renderPages(j); touch(j);
  }
  function colCount(grid) {
    var c = grid.children, n = 0; if (!c.length) return 1;
    for (var i = 0; i < c.length; i++) { if (c[i].offsetTop === c[0].offsetTop) n++; else break; }
    return Math.max(1, n);
  }
  function pgKey(j, e, node) {
    var grid = gridOf(j), k = e.key, kids = Array.prototype.slice.call(grid.children), i = kids.indexOf(node), cols = colCount(grid);
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); pgAct(j, 'del', node); return; }
    if (k === 'r' || k === 'R') { e.preventDefault(); pgAct(j, 'rot', node); return; }
    if ((k === 'd' || k === 'D') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pgAct(j, 'dup', node); return; }
    if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); pgAct(j, k === 'ArrowLeft' ? 'left' : 'right', node); return; }
    var to = k === 'ArrowLeft' ? i - 1 : k === 'ArrowRight' ? i + 1 : k === 'ArrowUp' ? i - cols : k === 'ArrowDown' ? i + cols : -1;
    if (to >= 0 && to < kids.length) { e.preventDefault(); kids[to].focus(); }
  }

  /* ---- drag to reorder (mouse, pen and touch; touch drags by the grip) ---- */
  function bindDrag(j, grid) {
    var D = null;
    grid.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      var node = e.target.closest('.pg-t'); if (!node || e.target.closest('.pg-act') || e.target.closest('.pg-arrow')) return;
      if (e.pointerType !== 'mouse' && !e.target.closest('.pg-grip')) return;
      var r = node.getBoundingClientRect();
      D = { node: node, sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, on: false, pid: e.pointerId, ghost: null, raf: 0, py: 0, lock: 0, before: null, order: '' };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('blur', up);                            // never leave a drag half done if the window loses focus
    });
    function orderKey() { return Array.prototype.map.call(grid.children, function (c) { return c.dataset.t; }).join(','); }
    function begin() {
      D.on = true; D.before = snap(j); D.order = orderKey();
      try { grid.setPointerCapture(D.pid); grid.addEventListener('lostpointercapture', up); } catch (e) {}
      var g = D.node.cloneNode(true); g.classList.remove('pg-in'); g.classList.add('pg-ghost'); g.removeAttribute('tabindex');
      g.style.width = D.w + 'px'; g.style.height = D.h + 'px';
      view.appendChild(g); D.ghost = g;
      D.node.classList.add('pg-hole'); grid.classList.add('dragging');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    function move(e) {
      if (!D || e.pointerId !== D.pid) return;
      if (!D.on) { if (Math.hypot(e.clientX - D.sx, e.clientY - D.sy) < 6) return; begin(); }
      e.preventDefault();
      D.py = e.clientY;
      D.ghost.style.transform = 'translate3d(' + (e.clientX - D.ox) + 'px,' + (e.clientY - D.oy) + 'px,0) scale(1.05) rotate(2.5deg)';
      hover(e.clientX, e.clientY);
      if (!D.raf) D.raf = requestAnimationFrame(scroll);
    }
    function hover(x, y) {
      if (performance.now() < D.lock) return;
      var el = document.elementFromPoint(x, y), t = el && el.closest ? el.closest('.pg-t') : null;
      if (!t || t === D.node || t.parentNode !== grid) return;
      var kids = Array.prototype.slice.call(grid.children);
      var ref = kids.indexOf(D.node) < kids.indexOf(t) ? t.nextElementSibling : t;
      D.lock = performance.now() + 140;
      flip(grid, function () { grid.insertBefore(D.node, ref); });
    }
    function scroll() {
      if (!D || !D.on) return;
      D.raf = 0;
      var c = $('content'); if (!c) return;
      var r = c.getBoundingClientRect(), edge = 70, dy = 0;
      if (D.py < r.top + edge) dy = -Math.ceil((r.top + edge - D.py) / 4);
      else if (D.py > r.bottom - edge) dy = Math.ceil((D.py - (r.bottom - edge)) / 4);
      if (dy) { c.scrollTop += dy; D.raf = requestAnimationFrame(scroll); }
    }
    function up(e) {
      if (!D || (e && e.pointerId !== undefined && e.pointerId !== D.pid)) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up); grid.removeEventListener('lostpointercapture', up);
      var d = D; D = null; if (d.raf) cancelAnimationFrame(d.raf);
      if (!d.on) return;
      try { grid.releasePointerCapture(d.pid); } catch (x) {}
      grid.classList.remove('dragging');
      var hole = d.node.getBoundingClientRect();
      if (!REDUCED) { d.ghost.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)'; d.ghost.style.transform = 'translate3d(' + hole.left + 'px,' + hole.top + 'px,0)'; }
      setTimeout(function () { if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); d.node.classList.remove('pg-hole'); }, REDUCED ? 0 : 250);
      if (orderKey() === d.order) return;
      var byId = {}; (j.tiles || []).forEach(function (t) { byId[t.id] = t; });
      j.undo = j.undo || []; j.undo.push(d.before); if (j.undo.length > 40) j.undo.shift();
      j.tiles = Array.prototype.map.call(grid.children, function (c) { return byId[c.dataset.t]; }).filter(Boolean);
      paintMeta(j); touch(j);
    }
    // a click that ends a drag must not count as a click
    grid.addEventListener('click', function (e) { if (D && D.on) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  function toggleArr(j) {
    if (!j.arr) {
      if (!j.tiles) j.tiles = buildTiles(j);
      j.arr = true; j.arrOpen = false; drawJob(j);
      requestAnimationFrame(function () { requestAnimationFrame(function () { var h = hostOf(j); if (h) { h.classList.add('open'); j.arrOpen = true; } }); });
    } else {
      var h = hostOf(j); if (h) h.classList.remove('open');
      j.arrOpen = false;
      setTimeout(function () { j.arr = false; drawJob(j); }, REDUCED ? 0 : 400);
    }
  }

  /* ---- drawing ---- */
  function renderJobs() {
    $('pc-jobs-card').style.display = P.jobs.length ? '' : 'none';
    $('pc-jobs-title').textContent = '2. Check and merge (' + P.jobs.length + ' work' + (P.jobs.length === 1 ? '' : 's') + ')';
    var box = $('pc-jobs');
    // keep cards that exist (so typing in a name box is not interrupted), add new ones, drop removed ones
    var have = {};
    Array.prototype.forEach.call(box.children, function (c) { have[c.dataset.j] = c; });
    P.jobs.forEach(function (j) {
      if (!have[j.id]) { var d = document.createElement('div'); d.className = 'pc-job'; d.dataset.j = j.id; box.appendChild(d); drawJob(j); }
      delete have[j.id];
    });
    Object.keys(have).forEach(function (k) { box.removeChild(have[k]); });
    patPreview();
  }

  function jobCheck(j) {
    var all = [], loading = 0, bad = 0, pages = 0;
    SLOTS.forEach(function (s) { j.slots[s.k].forEach(function (it) { all.push(it); if (it.state === 'loading') loading++; else if (it.state === 'bad') bad++; else pages += it.pages || 0; }); });
    if (j.tiles) pages = j.tiles.length;                // pages were arranged: count what is kept
    var warn = [];
    if (!j.free && !j.slots.quote.length) warn.push('no quotation');
    if (!j.free && !j.slots.email.length) warn.push('no approval email');
    return { all: all, loading: loading, bad: bad, pages: pages, warn: warn, ready: all.length > 0 && !loading && !bad && pages > 0 && !!String(j.name).trim() };
  }
  function plainName(j) { return clean(j.name).replace(/\.pdf$/i, ''); }

  function prevHTML(j) {
    var m = merged(j.qtn), h = '';
    if (m && !j.res) h += '<div class="pc-prev">Merged before on ' + esc(dTime(m.at)) + '. Saving again replaces that file in Drive (same link).</div>';
    if (j.drive === 'loading') h += '<div class="pc-prev"><span class="pc-spin"></span>Looking in Drive for this work\'s files...</div>';
    if (j.drive === 'error') h += '<div class="pc-prev" style="color:var(--danger)">Could not look in Drive: ' + esc(j.driveMsg) + '</div>';
    return h;
  }

  function footHTML(j) {
    var c = jobCheck(j), info;
    if (j.busy) info = '<span class="pc-spin"></span>' + esc(j.msg || 'Working...');
    else if (j.res) info = '<span class="ok">✓ ' + esc(j.res.text) + '</span>';
    else if (j.state === 'bad') info = '<span class="bad">' + esc(j.msg) + '</span>';
    else if (!c.all.length) info = 'Drop the files onto the boxes above, or anywhere on this card.';
    else if (c.loading) info = '<span class="pc-spin"></span>Reading the files...';
    else if (c.bad) info = '<span class="bad">Remove the file marked in red first.</span>';
    else if (!c.pages) info = '<span class="bad">No pages left. Open Arrange pages and press Undo.</span>';
    else info = c.pages + ' page' + (c.pages === 1 ? '' : 's') + ' in total' + (c.warn.length ? ' · <span class="warn">' + esc(c.warn.join(', ')) + '</span>' : '');
    var drive = $('pc-drive').checked && !j.free, dis = (c.ready && !j.busy) ? '' : ' disabled', btns = '';
    if (j.res) {
      if (j.res.url) btns += '<a class="btn btn-ghost btn-sm" href="' + esc(j.res.url) + '" target="_blank" rel="noopener">Open in Drive</a>';
      if (j.res.url) btns += '<button type="button" class="btn btn-ghost btn-sm" data-rename="1"' + (plainName(j) === j.res.name || !plainName(j) ? ' disabled' : '') + ' title="Give the file in Drive the name typed above">' + ic('pen') + 'Rename in Drive</button>';
      btns += '<button type="button" class="btn btn-ghost btn-sm" data-again="1">Edit again</button>';
      if (j.blob) btns += '<button type="button" class="btn btn-primary btn-sm pc-dl" data-dl="1">' + ic('dl') + 'Download</button>';
    } else {
      btns += '<button type="button" class="btn btn-ghost btn-sm" data-preview="1"' + dis + '>Preview</button>';
      if (drive) btns += '<button type="button" class="btn btn-ghost btn-sm pc-b2" data-go="1"' + dis + '>Merge &amp; save to Drive</button>';
      btns += '<button type="button" class="btn btn-primary btn-sm pc-dl" data-local="1"' + dis + '>' + ic('dl') + 'Download</button>';
    }
    return '<div class="pc-info">' + info + '</div><div class="pc-btns">' + btns + '</div>';
  }
  // only the note and the bottom bar: used when something changes that must not disturb the page thumbnails
  function drawMeta(j) {
    var el = document.querySelector('.pc-job[data-j="' + j.id + '"]'); if (!el) return;
    var p = el.querySelector('[data-prev]'), f = el.querySelector('.pc-foot'), a = el.querySelector('.pc-arrbtn em');
    if (p) p.innerHTML = prevHTML(j);
    if (f) f.innerHTML = footHTML(j);
    if (a) { var c = jobCheck(j); a.textContent = c.pages ? c.pages + ' page' + (c.pages === 1 ? '' : 's') : ''; }
    el.classList.toggle('done', !!j.res);
  }

  function drawJob(j) {
    var el = document.querySelector('.pc-job[data-j="' + j.id + '"]'); if (!el) return;
    var w = j.w, c = jobCheck(j);
    var h = '<div class="pc-jh">' + (j.free ? '<div class="t">Blank compile<small>Drop any PDFs or pictures, then arrange the pages. Download only: nothing is saved to a work.</small></div>' :
      '<div class="t">' + esc(w.qtn) + (w.crm ? ' · CRM ' + esc(w.crm) : '') +
      '<small>' + esc(w.desc) + (w.building ? ' · ' + esc([w.building, w.apt].filter(Boolean).join(' ')) : '') + '</small></div>') +
      '<button type="button" class="pc-x" data-rm="1" title="Remove this work"' + (j.busy ? ' disabled' : '') + '>&times;</button></div>';
    h += '<div class="pc-name"><label for="pc-n-' + j.id + '">File name</label><input id="pc-n-' + j.id + '" data-name="1" data-keep="name" value="' + esc(j.name) + '" spellcheck="false"><span>.pdf</span>' +
         '<button type="button" data-reset="1" title="Back to the standard name">↺</button></div>';
    h += '<div data-prev="1">' + prevHTML(j) + '</div>';
    h += '<div class="pc-slots">' + slotsFor(j).map(function (s) {
      var l = j.slots[s.k];
      return '<div class="pc-slot" data-slot="' + s.k + '"><div class="pc-sl">' + esc(s.label) + (s.opt ? ' <i>optional</i>' : '') + '</div><div class="pc-itl">' +
        l.map(function (it, i) {
          var sub = it.state === 'loading' ? '<span class="pc-spin"></span>' + (it.fileId ? 'loading from Drive...' : 'reading...')
            : (it.state === 'bad' ? esc(it.msg) : (it.pages + ' page' + (it.pages === 1 ? '' : 's') + (it.size ? ' · ' + mb(it.size) : '') + ' · ' + esc(it.src)));
          var renaming = j.ren && j.ren.id === it.id;
          var nm = renaming ? '<div class="n"><input class="pc-ren" data-keep="ren" value="' + esc(j.ren.val) + '" spellcheck="false" aria-label="New name for this file"><small>' + sub + '</small></div>'
            : '<div class="n" title="' + esc(it.name) + '">' + esc(it.name) + '<small>' + sub + '</small></div>';
          return '<div class="pc-it' + (it.state === 'bad' ? ' bad' : '') + '" data-it="' + it.id + '">' + nm +
            '<div class="b"><button type="button" data-ren="1" title="Rename this file">' + ic('pen') + '</button>' + (i > 0 ? '<button type="button" data-up="1" title="Move up">↑</button>' : '') + (i < l.length - 1 ? '<button type="button" data-dn="1" title="Move down">↓</button>' : '') +
            '<button type="button" data-del="1" title="Remove">✕</button></div></div>';
        }).join('') + '</div>' +
        '<div class="pc-drop" data-pick="' + s.k + '">' + (s.open ? 'Drop or click to add any PDFs or pictures' : 'Drop or click to add') + '</div></div>';
    }).join('') + '</div><input type="file" data-file="1" multiple accept=".pdf,image/*" hidden>';
    h += '<div class="pc-arr"><button type="button" class="pc-arrbtn" data-arr="1" aria-expanded="' + (j.arr ? 'true' : 'false') + '">' + ic('page') + 'Arrange pages <em>' + (c.pages ? c.pages + ' page' + (c.pages === 1 ? '' : 's') : '') + '</em>' + ic('chev', 'chev') + '</button></div>';
    if (j.arr) h += '<div class="pc-pghost' + (j.arrOpen ? ' open' : '') + '" data-pghost="1"></div>';
    h += '<div class="pc-foot">' + footHTML(j) + '</div>';
    var ae = document.activeElement, keep = null;
    if (ae && el.contains(ae) && ae.dataset && ae.dataset.keep) keep = { k: ae.dataset.keep, s: ae.selectionStart, e: ae.selectionEnd };
    j.drawing = true;
    el.innerHTML = h;
    j.drawing = false;
    el.classList.toggle('done', !!j.res); el.classList.toggle('free', !!j.free);
    if (j.arr) { var host = el.querySelector('[data-pghost]'); host.appendChild(ensurePg(j)); renderPages(j); }
    if (keep) {
      var inp = el.querySelector('[data-keep="' + keep.k + '"]');
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } try { inp.setSelectionRange(keep.s, keep.e); } catch (e) {} }
    }
  }

  /* ================= the merge: every page onto A4 portrait ================= */
  function imageBytes(it, L, out, maxSide) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(new Blob([it.bytes], { type: it.mime || 'image/jpeg' }));
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxSide / Math.max(w, h));
        var isPng = /png/i.test(it.mime || '') || /\.png$/i.test(it.name);
        if (isPng && s === 1) { out.embedPng(it.bytes).then(res, rej); return; }
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * s); cv.height = Math.round(h * s);
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);           // transparent parts become white
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) {
          if (!b) { rej(new Error(it.name + ' could not be converted.')); return; }
          b.arrayBuffer().then(function (ab) { return out.embedJpg(new Uint8Array(ab)); }).then(res, rej);
        }, 'image/jpeg', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error(it.name + ' is not a picture this browser can read.')); };
      img.src = url;
    });
  }

  // draws something of size w x h (already turned by rot degrees clockwise when shown) centred on a new A4 portrait page
  function place(out, L, thing, isImg, w, h, rot) {
    var S = P.data.settings || {}, margin = Number(S.margin) || 0;
    rot = ((rot % 360) + 360) % 360;
    var vw = rot % 180 ? h : w, vh = rot % 180 ? w : h;                    // size as it is seen
    if (S.rotateLandscape !== false && vw > vh * 1.02) { rot = (rot + 270) % 360; var t = vw; vw = vh; vh = t; }   // landscape: turn it to fill the portrait page
    var aw = A4W - 2 * margin, ah = A4H - 2 * margin;
    var s = Math.min(aw / vw, ah / vh);
    var bw = vw * s, bh = vh * s, x0 = margin + (aw - bw) / 2, y0 = margin + (ah - bh) / 2;
    var cw = w * s, ch = h * s, x = x0, y = y0;                             // pdf-lib turns anticlockwise around (x, y)
    if (rot === 90) { y = y0 + cw; }
    else if (rot === 180) { x = x0 + cw; y = y0 + ch; }
    else if (rot === 270) { x = x0 + ch; }
    var pg = out.addPage([A4W, A4H]);
    var o = { x: x, y: y, rotate: L.degrees(-rot) };
    if (isImg) { o.width = cw; o.height = ch; pg.drawImage(thing, o); }
    else { o.xScale = s; o.yScale = s; pg.drawPage(thing, o); }
  }

  function merge(j) {
    return lib().then(function (L) {
      var S = P.data.settings || {};
      return L.PDFDocument.create().then(function (out) {
        out.setTitle(j.name); out.setProducer('DD Variable Works hub'); out.setCreator('DD Variable Works hub');
        // the pages, in order: as arranged by the user, or (never arranged) the files in their boxes
        var list = j.tiles ? j.tiles.slice() : plainTiles(j), docs = {}, embs = {}, imgs = {}, seen = {}, parts = [], chain = Promise.resolve();
        list.forEach(function (t) {
          chain = chain.then(function () {
            var it = t.it, pk = it.id;
            if (!seen[pk]) { seen[pk] = 1; parts.push(slotLabel(it) + ': ' + it.name); }
            if (it.kind === 'image') {
              var ip = imgs[pk] || (imgs[pk] = imageBytes(it, L, out, Number(S.maxImageSide) || 2400));
              return ip.then(function (im) { place(out, L, im, true, im.width, im.height, t.rot || 0); });
            }
            var dp = docs[pk] || (docs[pk] = L.PDFDocument.load(it.bytes, { updateMetadata: false }));
            return dp.then(function (src) {
              var page = src.getPage(t.n), ek = pk + ':' + t.n, ep = embs[ek];
              if (!ep) { var b = page.getCropBox(); ep = embs[ek] = out.embedPage(page, { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }); }
              return ep.then(function (e) { place(out, L, e, false, e.width, e.height, ((page.getRotation().angle || 0) + (t.rot || 0)) % 360); });
            });
          });
        });
        return chain.then(function () { return out.save(); }).then(function (bytes) { return { bytes: bytes, pages: out.getPageCount(), parts: parts.join(' | ') }; });
      });
    });
  }

  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    var a = document.createElement('a');
    a.href = url; a.download = (clean(name).replace(/\.pdf$/i, '') || 'merged') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // the file in Drive gets the name typed in the File name box (no new merge needed)
  function renameDrive(j) {
    var name = plainName(j); if (!j.res || !j.res.url || !name || j.busy) return;
    j.busy = true; j.msg = 'Renaming in Drive...'; drawMeta(j);
    call('pdfcRename', { qtn: j.qtn, name: name }).then(function (x) {
      var nm = String((x && x.name) || name).replace(/\.pdf$/i, '');
      j.name = nm; j.res.name = nm; j.res.text = 'Renamed in Drive · ' + nm + '.pdf';
      var mg = merged(j.qtn); if (mg) mg.name = nm + '.pdf';
      j.busy = false; drawJob(j); renderList();
      try { refreshBox(j.qtn); } catch (e) {}
    }).catch(function (e) { j.busy = false; drawMeta(j); note('Could not rename: ' + (e.message || e)); });
  }
  function commitRen(j) {
    if (!j || !j.ren) return;
    var x = findItem(j, j.ren.id), val = clean(j.ren.val);
    if (x && val) x.it.name = val;
    j.ren = null; drawJob(j);
  }

  /* ---- one naming pattern for every work ---- */
  function pattern() { var el = $('pc-pat-in'); return el ? el.value : ''; }
  function patPreview() {
    var pv = $('pc-pat-pv'); if (!pv) return;
    var j = P.jobs[0];
    pv.innerHTML = j ? 'Example for ' + esc(j.qtn) + ': <b>' + esc(patName(pattern(), j.w) || '(empty)') + '.pdf</b>' : '';
  }
  function applyPattern() {
    var pat = pattern(), n = 0;
    try { localStorage.setItem('vwPdfcPattern', pat); } catch (e) {}
    P.jobs.forEach(function (j) { if (j.busy) return; var nm = patName(pat, j.w); if (nm) { j.name = nm; n++; drawJob(j); } });
    note('Named ' + n + ' file' + (n === 1 ? '' : 's') + ' with the pattern.');
  }

  function upload(j, r) {
    var small = (P.data.settings && P.data.settings.smallBytes) || 6291456;
    var req = { qtn: j.qtn, name: j.name, pages: r.pages, parts: r.parts, size: r.bytes.length };
    if (r.bytes.length <= small) {
      j.msg = 'Saving to Drive...'; drawJob(j);
      return bytesToB64(r.bytes).then(function (b64) { req.b64 = b64; return call('pdfcSave', req); });
    }
    var CH = 4 * 1024 * 1024, total = r.bytes.length;                    // pieces of 4 MB (a multiple of 256 KB, as Drive wants)
    return call('pdfcBeginUpload', req).then(function (st) {
      var off = 0;
      function next() {
        j.msg = 'Uploading to Drive... ' + Math.round(off / total * 100) + '%'; drawJob(j);
        var piece = r.bytes.subarray(off, Math.min(total, off + CH));
        return bytesToB64(piece).then(function (b64) { return call('pdfcUploadChunk', { session: st.session, offset: off, total: total, b64: b64 }); }).then(function (x) {
          off += piece.length;
          if (x.done) { req.fileId = x.fileId; req.isNew = st.isNew; return call('pdfcFinishUpload', req); }
          if (off >= total) throw new Error('Drive did not confirm the upload. Press Save again.');
          return next();
        });
      }
      return next();
    });
  }

  // mode: 'drive' (merge + save + keep for download) | 'local' (merge + download) | 'preview'
  function run(j, mode) {
    var c = jobCheck(j);
    if (j.free && mode === 'drive') mode = 'local';             // a blank compile is not tied to a work: download only
    if (!c.ready || j.busy) return Promise.resolve();
    j.name = clean(j.name).replace(/\.pdf$/i, '');
    if (!j.name) { j.state = 'bad'; j.msg = 'Give the file a name.'; drawJob(j); return Promise.resolve(); }
    j.busy = true; j.state = ''; j.msg = 'Merging ' + c.pages + ' pages...'; drawJob(j);
    return merge(j).then(function (r) {
      if (mode === 'preview') {
        var url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' }));
        var win = window.open(url, '_blank');
        if (!win) download(r.bytes, j.name);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
        j.busy = false; drawJob(j); return;
      }
      if (mode === 'local') {
        download(r.bytes, j.name);
        j.busy = false; j.blob = r.bytes; j.res = { name: j.name, text: 'Downloaded · ' + r.pages + ' pages · ' + mb(r.bytes.length) + ' (not saved in Drive)' }; drawJob(j); return;
      }
      return upload(j, r).then(function (x) {
        P.data.merged[key(j.qtn)] = { qtn: j.qtn, name: x.name, id: x.id, url: x.url, at: x.at, pages: x.pages, kb: x.kb };
        j.busy = false; j.blob = r.bytes;
        j.res = { url: x.url, name: String(x.name || j.name).replace(/\.pdf$/i, ''), text: (x.replaced ? 'Saved again (replaced the earlier file)' : 'Saved in Drive') + ' · ' + r.pages + ' pages · ' + mb(r.bytes.length) + (x.filed ? ' · shortcut in the job folder' : '') };
        drawJob(j); renderList(); refreshBox(j.qtn);
        window.__vwDocsStale = true;
      });
    }).catch(function (e) {
      j.busy = false; j.state = 'bad'; j.msg = e.message || String(e); drawJob(j);
    });
  }

  /* ================= events ================= */
  var view = $('view-pdfc');
  view.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#pc-retry') || t.closest('#pc-refresh')) { load(); return; }
    var seg = t.closest('.pc-seg button');
    if (seg) { P.filter = seg.dataset.f; P.shown = 60; view.querySelectorAll('.pc-seg button').forEach(function (b) { b.classList.toggle('on', b === seg); }); renderList(); return; }
    if (t.closest('#pc-more')) { P.shown += 100; renderList(); return; }
    var add = t.closest('[data-add]');
    if (add) { addJob(add.dataset.add, true); return; }
    if (t.closest('#pc-pile')) { $('pc-pile-file').click(); return; }
    if (t.closest('#pc-all')) { mergeAll(); return; }
    if (t.closest('#pc-free')) { if (P.data) addFree(); else note('Wait for the page to finish loading.'); return; }
    if (t.closest('#pc-clear')) {
      P.jobs = P.jobs.filter(function (j) { return !j.res || j.busy; });
      renderJobs(); renderList(); return;
    }
    var tok = t.closest('[data-tok]');
    if (tok) { var pi = $('pc-pat-in'), s0 = pi.selectionStart == null ? pi.value.length : pi.selectionStart, s1 = pi.selectionEnd == null ? s0 : pi.selectionEnd; pi.value = pi.value.slice(0, s0) + tok.dataset.tok + pi.value.slice(s1); pi.focus(); try { pi.setSelectionRange(s0 + tok.dataset.tok.length, s0 + tok.dataset.tok.length); } catch (e) {} patPreview(); return; }
    if (t.closest('#pc-pat-go')) { applyPattern(); return; }
    var card = t.closest('.pc-job'); if (!card) return;
    var j = jobById(card.dataset.j); if (!j) return;
    if (t.closest('[data-rm]')) { if (j.busy) return; P.jobs.splice(P.jobs.indexOf(j), 1); renderJobs(); renderList(); return; }
    if (t.closest('[data-reset]')) { j.name = j.free ? 'Merged documents' : defaultName(j.w); drawJob(j); return; }
    var pgb = t.closest('[data-pg]'); if (pgb) { pgAct(j, pgb.dataset.pg, pgb.closest('.pg-t')); return; }
    if (t.closest('[data-pg-undo]')) { undoPg(j); return; }
    if (t.closest('[data-pg-reset]')) { resetPg(j); return; }
    if (t.closest('[data-arr]')) { toggleArr(j); return; }
    if (t.closest('[data-rename]')) { renameDrive(j); return; }
    var pick = t.closest('[data-pick]');
    if (pick) { var f = card.querySelector('input[data-file]'); f.dataset.slot = pick.dataset.pick; f.click(); return; }
    var row = t.closest('[data-it]');
    if (row) {
      var x = findItem(j, row.dataset.it); if (!x) return;
      if (t.closest('[data-ren]')) { j.ren = { id: x.it.id, val: x.it.name }; drawJob(j); var ri = card.querySelector('.pc-ren'); if (ri) { ri.focus(); ri.select(); } return; }
      if (t.closest('[data-del]')) { x.list.splice(x.i, 1); j.res = null; drawJob(j); return; }
      if (t.closest('[data-up]') && x.i > 0) { x.list.splice(x.i - 1, 0, x.list.splice(x.i, 1)[0]); j.res = null; drawJob(j); return; }
      if (t.closest('[data-dn]') && x.i < x.list.length - 1) { x.list.splice(x.i + 1, 0, x.list.splice(x.i, 1)[0]); j.res = null; drawJob(j); return; }
      return;
    }
    if (t.closest('[data-go]')) { run(j, 'drive'); return; }
    if (t.closest('[data-local]')) { run(j, 'local'); return; }
    if (t.closest('[data-preview]')) { run(j, 'preview'); return; }
    if (t.closest('[data-dl]')) { if (j.blob) download(j.blob, j.name); return; }
    if (t.closest('[data-again]')) { j.res = null; j.blob = null; drawJob(j); return; }
  });
  view.addEventListener('input', function (e) {
    if (e.target.id === 'pc-q') { P.q = e.target.value; P.shown = 60; renderList(); return; }
    if (e.target.id === 'pc-pat-in') { patPreview(); return; }
    if (e.target.dataset && e.target.dataset.pgsize) {
      P.pgSize = Number(e.target.value) || 132; view.style.setProperty('--pg-w', P.pgSize + 'px');
      view.querySelectorAll('[data-pgsize]').forEach(function (s) { if (s !== e.target) s.value = P.pgSize; });
      return;
    }
    var jc = e.target.closest ? e.target.closest('.pc-job') : null, jj = jc ? jobById(jc.dataset.j) : null;
    if (!jj) return;
    if (e.target.classList.contains('pc-ren')) { if (jj.ren) jj.ren.val = e.target.value; return; }
    if (e.target.dataset && e.target.dataset.name) {
      jj.name = e.target.value;
      if (jj.res) { var rb = jc.querySelector('[data-rename]'); if (rb) rb.disabled = !plainName(jj) || plainName(jj) === jj.res.name; }   // after a merge the name can still be changed: download uses it, Drive follows on "Rename in Drive"
    }
  });
  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'pc-pile-file') { addPile(t.files); t.value = ''; return; }
    if (t.id === 'pc-drive') { P.jobs.forEach(drawJob); return; }
    if (t.dataset && t.dataset.file) { var j = jobById(t.closest('.pc-job').dataset.j); if (j) addFiles(j, t.files, t.dataset.slot || null); t.value = ''; }
  });
  view.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'pc-pile') { e.preventDefault(); $('pc-pile-file').click(); }
  });
  view.addEventListener('keydown', function (e) {
    if (!e.target.classList || !e.target.classList.contains('pc-ren')) return;
    var c = e.target.closest('.pc-job'), j = c && jobById(c.dataset.j); if (!j || !j.ren) return;
    if (e.key === 'Enter') { e.preventDefault(); j.ren.val = e.target.value; commitRen(j); }
    else if (e.key === 'Escape') { e.preventDefault(); j.ren = null; drawJob(j); }
  });
  view.addEventListener('focusout', function (e) {
    if (!e.target.classList || !e.target.classList.contains('pc-ren')) return;
    var c = e.target.closest('.pc-job'), j = c && jobById(c.dataset.j); if (!j || j.drawing || !j.ren) return;
    j.ren.val = e.target.value; commitRen(j);
  });
  view.style.setProperty('--pg-w', P.pgSize + 'px');
  (function () { var el = $('pc-pat-in'); if (!el) return; try { var v = localStorage.getItem('vwPdfcPattern'); if (v) el.value = v; } catch (e) {} })();
  // drag and drop: onto a box (that slot), onto a card (guessed from the file name), onto the pile area (matched to its work)
  function zone(t) { return t && t.closest ? (t.closest('.pc-slot') || t.closest('.pc-job') || t.closest('#pc-pile')) : null; }
  view.addEventListener('dragover', function (e) {
    e.preventDefault();
    view.querySelectorAll('.over').forEach(function (z) { z.classList.remove('over'); });
    var z = zone(e.target); if (z) { z.classList.add('over'); var cj = z.closest('.pc-job'); if (cj && cj !== z) cj.classList.add('over'); }
  });
  view.addEventListener('dragleave', function (e) { if (!view.contains(e.relatedTarget)) view.querySelectorAll('.over').forEach(function (z) { z.classList.remove('over'); }); });
  view.addEventListener('drop', function (e) {
    e.preventDefault();
    view.querySelectorAll('.over').forEach(function (z) { z.classList.remove('over'); });
    var files = e.dataTransfer && e.dataTransfer.files; if (!files || !files.length) return;
    var z = zone(e.target);
    if (!z || z.id === 'pc-pile') { if (P.data) addPile(files); return; }
    var j = jobById(z.closest('.pc-job').dataset.j); if (!j) return;
    addFiles(j, files, z.classList.contains('pc-slot') ? z.dataset.slot : null);
  });

  function mergeAll() {
    var todo = P.jobs.filter(function (j) { return !j.res && !j.busy && jobCheck(j).ready; });
    if (!todo.length) { note('Nothing ready to merge yet.'); return; }
    var mode = $('pc-drive').checked ? 'drive' : 'local', chain = Promise.resolve(), btn = $('pc-all');
    btn.disabled = true;
    todo.forEach(function (j) { chain = chain.then(function () { return run(j, mode); }); });
    chain.then(function () {
      btn.disabled = false;
      var ok = todo.filter(function (j) { return j.res; }).length;
      note(ok + ' of ' + todo.length + ' merged' + (ok < todo.length ? ' - see the red messages' : ''));
    });
  }

  /* ================= "Merged PDF" box in a work's detail panel ================= */
  // v21: one tap (or by itself after you save an AGFS quote / breakdown report / email approval): the newest file of each
  // kind in the job is merged (quotation, breakdown report if any, approval email) and saved to Drive, ready to download.
  var M = { map: null, at: 0, qtn: '', busy: {}, msg: {} };
  function ensureData() {
    if (P.data) return Promise.resolve(P.data);
    return new Promise(function (res, rej) {
      waiters.push(function () { res(P.data); });
      if (!P.loading) {
        P.loading = true;
        call('pdfcInit').then(function (d) {
          P.data = d; P.loading = false;
          var w = waiters; waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} });
        }).catch(function (e) { P.loading = false; waiters = []; rej(e); });
      }
    });
  }
  function quickMerge(qtn, auto) {
    var k = key(qtn);
    if (M.busy[k]) return Promise.resolve();
    M.busy[k] = true; M.msg[k] = 'Getting the files...'; refreshBox(qtn);
    var j = null;
    return ensureData().then(function () {
      var w = work(qtn);
      if (!w) throw new Error('The quote ' + qtn + ' was not found in the tracker.');
      j = { id: 'q' + (++P.seq), qtn: w.qtn, w: w, name: (merged(w.qtn) || {}).name ? String(merged(w.qtn).name).replace(/\.pdf$/i, '') : defaultName(w),
            slots: { quote: [], breakdown: [], email: [], other: [] }, state: '', msg: '', res: null, blob: null, busy: false };
      return call('pdfcCandidates', w.qtn);
    }).then(function (r) {
      var pick = {};
      r.files.forEach(function (f) {                       // the tracker's quote first; otherwise the newest of each kind
        if (f.slot === 'quote' && f.from === 'tracker') { pick.quote = f; pick.qlock = true; return; }
        if (f.slot === 'quote' && pick.qlock) return;
        pick[f.slot] = f;
      });
      if (!pick.quote || !pick.email) {
        var need = [!pick.quote ? 'an AGFS quote' : '', !pick.email ? 'an email approval' : ''].filter(Boolean).join(' and ');
        throw { soft: true, message: 'Needs ' + need + ' in this job first.' };
      }
      var chain = Promise.resolve();
      ['quote', 'breakdown', 'email'].forEach(function (slot) {
        var f = pick[slot]; if (!f) return;
        var it = newItem(slot, f.name, f.from); it.fileId = f.id; j.slots[slot].push(it);
        chain = chain.then(function () { M.msg[k] = 'Reading ' + f.name + '...'; refreshBox(qtn); return call('pdfcFetch', j.qtn, f.id); })
          .then(function (x) { return prepare(it, b64ToBytes(x.b64), x.mime, x.name); })
          .then(function () { if (it.state === 'bad') throw new Error(f.name + ': ' + (it.msg || 'could not be read')); });
      });
      return chain;
    }).then(function () {
      M.msg[k] = 'Merging...'; refreshBox(qtn);
      return merge(j);
    }).then(function (r) {
      M.msg[k] = 'Saving to Drive...'; refreshBox(qtn);
      return upload(j, r).then(function (x) {
        P.data.merged[key(j.qtn)] = { qtn: j.qtn, name: x.name, id: x.id, url: x.url, at: x.at, pages: x.pages, kb: x.kb };
        M.map = P.data.merged; window.__vwDocsStale = true;
        M.busy[k] = false; M.msg[k] = ''; refreshBox(qtn);
        if (P.jobs.length || $('view-pdfc').style.display !== 'none') { try { renderList(); } catch (e) {} }
        note(auto ? 'Tijori PDF updated for ' + j.qtn : 'Tijori PDF ready: ' + r.pages + ' pages');
      });
    }).catch(function (e) {
      M.busy[k] = false;
      M.msg[k] = auto && e && e.soft ? '' : '⚠ ' + ((e && e.message) || String(e));
      refreshBox(qtn);
    });
  }
  function drawBox() {
    var box = $('vwm-sec'); if (!box) return;
    var h = '<div class="d-title">🧩 Merged PDF for Tijori</div><div class="vwm">';
    if (!M.map) { box.innerHTML = h + '<div class="pm-msg">Loading...</div></div>'; return; }
    if (M.map.error) { box.innerHTML = h + '<div class="pm-msg" style="color:var(--danger)">' + esc(M.map.error) + '</div></div>'; return; }
    var k = key(M.qtn), m = M.map[k], busy = !!M.busy[k], msg = M.msg[k] || '';
    if (m) {
      h += '<div class="pm-msg"><b>Ready</b> · made ' + esc(dTime(m.at)) + (m.pages ? ' · ' + m.pages + ' pages' : '') + '</div>' +
           '<div class="pm-name">' + esc(m.name) + '</div><div class="pm-act">' +
           '<a class="btn btn-primary btn-sm" href="https://drive.google.com/uc?export=download&amp;id=' + encodeURIComponent(m.id) + '" target="_blank" rel="noopener">⬇ Download</a>' +
           '<a class="btn btn-ghost btn-sm" href="' + esc(m.url) + '" target="_blank" rel="noopener">Open</a>' +
           '<button type="button" class="btn btn-ghost btn-sm" data-pcquick="1"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Working...' : '↻ Merge again') + '</button>' +
           '<button type="button" class="btn btn-ghost btn-sm" data-pcgo="1">Choose files</button></div>';
    } else {
      h += '<div class="pm-msg">Not merged yet. Quotation + breakdown report (if any) + approval email, newest of each.</div><div class="pm-act">' +
           '<button type="button" class="btn btn-primary btn-sm" data-pcquick="1"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Working...' : '🧩 Merge now') + '</button>' +
           '<button type="button" class="btn btn-ghost btn-sm" data-pcgo="1">Choose files</button></div>';
    }
    if (msg) h += '<div class="pm-msg" style="margin-top:8px;' + (/^⚠/.test(msg) ? 'color:var(--danger)' : '') + '">' + (busy ? '<span class="spin-dark" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:6px"></span>' : '') + esc(msg) + '</div>';
    box.innerHTML = h + '</div>';
  }
  function loadBox(force) {
    if (P.data && !force) { M.map = P.data.merged; drawBox(); return; }
    if (M.map && !force && Date.now() - M.at < 60000) { drawBox(); return; }
    call('pdfcMergedMap').then(function (m) { M.map = m; M.at = Date.now(); if (P.data) P.data.merged = m; drawBox(); })
      .catch(function (e) { M.map = { error: e.message }; drawBox(); });
  }
  function refreshBox(qtn) { if ($('vwm-sec') && key(M.qtn) === key(qtn)) { if (P.data && P.data.merged) M.map = P.data.merged; drawBox(); } }
  function mount() {
    var body = $('drawer-body'); if (!body || $('vwm-sec')) return;
    var qtn = ($('dh-ref').textContent || '').trim();
    var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return x.qtn === qtn; })[0] : null;
    if (!w) return;
    var sec = document.createElement('div');
    sec.className = 'd-sec'; sec.id = 'vwm-sec';
    var docsBox = $('vwd-sec');
    if (docsBox) body.insertBefore(sec, docsBox);                          // just above the Documents box
    else {
      var last = body.lastElementChild;                                    // keep the "Row n in VW_Tracker" footer last
      if (last && !last.classList.contains('d-sec') && !last.classList.contains('todo')) body.insertBefore(sec, last); else body.appendChild(sec);
    }
    M.qtn = qtn;
    drawBox(); loadBox(false);
  }
  if ($('drawer-body') && window.MutationObserver) new MutationObserver(function () { if (!$('vwm-sec')) mount(); }).observe($('drawer-body'), { childList: true });
  window.__vwPdfcAuto = function (qtn) { return quickMerge(qtn, true); };
  document.addEventListener('click', function (e) {
    var qb = e.target.closest && e.target.closest('#vwm-sec [data-pcquick]');
    if (qb) { quickMerge(M.qtn, false); return; }
    var b = e.target.closest && e.target.closest('#vwm-sec [data-pcgo]');
    if (!b) return;
    var q = M.qtn;
    var x = $('drawer-close'); if (x) x.click();
    goPage(q);
  });
})();
