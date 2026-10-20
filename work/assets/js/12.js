/* ---------------- ADDED: Today page, Prepare RF, Chase ----------------
   Uses only public things of the page above (ST, DASH, toast, openDrawer, loadDashboard) and the server file Today.gs. */
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
  function copy(text) {
    return new Promise(function (res) {
      function fallback() {
        var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(t); res(ok);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { res(true); }, fallback); else fallback();
    });
  }
  function money(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dLabel(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  var SHOW = 8;
  var T = { data: null, map: {}, more: {}, hidOpen: false, at: 0 };

  function openWork(id) {
    id = Number(id);
    if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
    note('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
  }
  function openProc(rf) {
    if (window.__vwDesk && window.__vwDesk.openRf) { window.__vwDesk.openRf(rf); return; }      // v37: the job popup's Dynamics part
    var n = document.querySelector('.nav-item[data-view="proc"]'); if (n) n.click();
    setTimeout(function () { var q = $('pq-q'); if (q) { q.value = rf || ''; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 800);
  }

  /* ---------- page ---------- */
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'today'; $('view-today').style.display = on ? '' : 'none'; if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function opened() { if (!T.data || Date.now() - T.at > 45000) load(false); else render(); }

  function load(force) {
    $('td-loading').style.display = ''; $('td-error').style.display = 'none';
    if (!T.data) $('td-body').style.display = 'none';
    call('todayGet').then(function (d) {
      T.data = d; T.at = Date.now(); T.map = {};
      d.groups.forEach(function (g) { g.items.forEach(function (i) { T.map[i.key] = i; }); });
      $('td-loading').style.display = 'none'; if (force) note('Refreshed');
      render(); document.dispatchEvent(new Event('vw-today-loaded'));
    }).catch(function (e) {
      $('td-loading').style.display = 'none';
      $('td-error').textContent = 'Could not build the Today list: ' + e.message; $('td-error').style.display = '';
    });
  }

  function itemHtml(i) {
    var acts = '';
    if (i.acts.indexOf('prepare') > -1) acts += '<button type="button" class="btn btn-primary btn-sm std" data-a="prepare">Prepare RF</button>';
    if (i.acts.indexOf('chase') > -1) acts += '<button type="button" class="btn btn-primary btn-sm std" data-a="chase">Chase</button>';
    if (i.acts.indexOf('sent') > -1 && window.__vwMarks) acts += '<button type="button" class="btn btn-primary btn-sm std" data-a="sent">📨 Sent on…</button>';
    if (i.acts.indexOf('grn') > -1 && window.__vwMarks) acts += '<button type="button" class="btn btn-primary btn-sm std" data-a="grn">✅ GRN released</button>';
    if (i.acts.indexOf('mri') > -1 && window.__vwMri) acts += '<button type="button" class="btn btn-ghost btn-sm std" data-a="mri">' + (i.g === 'mri' ? 'Open MRI request' : 'Create in MRI') + '</button>';
    if (i.acts.indexOf('proc') > -1) acts += '<button type="button" class="btn btn-ghost btn-sm std" data-a="proc">D365 steps</button>';
    if (i.acts.indexOf('open') > -1 && i.id) acts += '<button type="button" class="btn btn-ghost btn-sm std" data-a="open">Open work</button>';
    acts += '<button type="button" class="btn btn-ghost btn-sm std" data-a="done" title="Hide for a few days">✓ Done</button>' +
            '<button type="button" class="btn btn-ghost btn-sm std" data-a="later" title="Remind me later">⏱ Later</button>' +
            '<span class="td-snz">Remind me in <button type="button" class="btn btn-ghost btn-sm" data-a="snz" data-d="1">1 day</button><button type="button" class="btn btn-ghost btn-sm" data-a="snz" data-d="3">3 days</button><button type="button" class="btn btn-ghost btn-sm" data-a="snz" data-d="7">a week</button><button type="button" class="btn btn-ghost btn-sm" data-a="cancel">✕</button></span>';
    return '<div class="td-item ' + esc(i.sev) + '" data-key="' + esc(i.key) + '"><div class="td-main"><div class="td-title">' + esc(i.title) + '</div>' +
      (i.sub ? '<div class="td-sub">' + esc(i.sub) + '</div>' : '') + '</div>' +
      (i.days !== null && i.days !== undefined ? '<span class="td-days">' + i.days + ' day' + (i.days === 1 ? '' : 's') + '</span>' : '') +
      '<div class="td-acts">' + acts + '</div></div>';
  }

  var WHO = { manager: 'manager', procurement: 'procurement', vendor: 'vendors' };

  function render() {
    var d = T.data; if (!d) return;
    $('td-body').style.display = '';
    $('td-sub').textContent = dLabel(d.today) + ' · ' + (d.total ? d.total + ' thing' + (d.total === 1 ? '' : 's') + ' need you' + (d.late ? ', ' + d.late + ' late' : '') : 'nothing needs you right now');
    var notes = [];
    if (!d.hasD365) notes.push('D365 data has not been imported yet, so the Procurement items (waiting on you, chase, GRN) are missing. Import it on the Procurement page.');
    if (d.hasD365 && d.d365Fresh && d.d365Fresh.stale) notes.push('The D365 data is out of date, so the RF items may be too.');
    if (!d.docsOn) notes.push('Missing-document checks are off until you set the main Drive folder on the Job Documents page.');
    $('td-note').innerHTML = notes.map(esc).join('<br>'); $('td-note').style.display = notes.length ? '' : 'none';

    $('td-tiles').innerHTML = d.groups.map(function (g) {
      return '<button type="button" class="td-tile' + (g.late ? ' has-late' : '') + '" data-g="' + g.k + '"><b>' + g.items.length + '</b><span>' + esc(g.icon + ' ' + g.title) + '</span><small>' + (g.late ? g.late + ' late' : '&nbsp;') + '</small></button>';
    }).join('');

    if (!d.groups.length) {
      $('td-groups').innerHTML = '<div class="card"><div class="td-empty"><div style="font-size:34px;">🎉</div><h3>All clear</h3><p>Nothing needs you right now.' + (d.hidden.length ? ' (' + d.hidden.length + ' hidden for later)' : '') + '</p></div></div>';
    } else {
      $('td-groups').innerHTML = d.groups.map(function (g) {
        var n = T.more[g.k] ? g.items.length : Math.min(SHOW, g.items.length);
        var bundle = '';
        if (g.k === 'chase') {
          var by = {}; g.items.forEach(function (i) { var w = i.chase && i.chase.who; if (w) by[w] = (by[w] || 0) + 1; });
          bundle = '<div class="td-bundle">' + Object.keys(WHO).filter(function (w) { return by[w]; }).map(function (w) {
            return '<button type="button" class="btn btn-ghost btn-sm" data-bundle="' + w + '">✉ One message to ' + WHO[w] + ' (' + by[w] + ')</button>';
          }).join('') + '</div>';
        }
        return '<div class="card td-grp" id="td-g-' + g.k + '"><div class="td-ghead"><h3>' + esc(g.icon) + ' ' + esc(g.title) + ' <span class="n">' + g.items.length + '</span></h3><span class="h">' + esc(g.hint) + '</span></div>' + bundle +
          g.items.slice(0, n).map(itemHtml).join('') +
          (g.items.length > n ? '<div class="td-more"><button type="button" class="btn btn-ghost btn-sm" data-more="' + g.k + '">Show all ' + g.items.length + '</button></div>' : '') + '</div>';
      }).join('');
    }

    var h = d.hidden;
    $('td-hidcard').style.display = h.length ? '' : 'none';
    $('td-hidtitle').textContent = 'Hidden for now (' + h.length + ')';
    $('td-hidtoggle').textContent = T.hidOpen ? 'Hide' : 'Show';
    $('td-hidlist').style.display = T.hidOpen ? '' : 'none';
    $('td-hidlist').innerHTML = h.map(function (x) {
      return '<div class="td-hid"><span>' + esc(x.title) + ' <em>· back on ' + esc(dLabel(x.until)) + '</em></span><button type="button" class="btn btn-ghost btn-sm" data-restore="' + esc(x.key) + '">Bring back</button></div>';
    }).join('');
  }

  function hideLocal(key) {
    var d = T.data; if (!d) return;
    d.groups.forEach(function (g) { g.items = g.items.filter(function (i) { return i.key !== key; }); });
    d.groups = d.groups.filter(function (g) { return g.items.length; });
    d.total = d.groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    d.late = d.groups.reduce(function (n, g) { return n + g.items.filter(function (i) { return i.sev === 'late'; }).length; }, 0);
    d.groups.forEach(function (g) { g.late = g.items.filter(function (i) { return i.sev === 'late'; }).length; });
  }
  function mark(key, mode, days) {
    var it = T.map[key]; hideLocal(key); render();
    return call('todaySet', key, mode, days).then(function () { T.at = 0; }).catch(function (e) { note('Could not save: ' + e.message); T.at = 0; load(false); });
  }

  $('td-groups').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.more) { T.more[b.dataset.more] = true; render(); return; }
    if (b.dataset.bundle) { chaseModal(b.dataset.bundle, null); return; }
    var row = b.closest('.td-item'); if (!row || !b.dataset.a) return;
    var key = row.dataset.key, it = T.map[key]; if (!it) return;
    switch (b.dataset.a) {
      case 'prepare': prepareModal(it); break;
      case 'chase': chaseModal(it.chase.who, [it]); break;
      case 'sent': case 'grn': window.__vwMarks.ask(it.qtn, b.dataset.a, function () { hideLocal(key); render(); T.at = 0; }); break;
      case 'proc': openProc(it.rf); break;
      case 'mri': if (window.__vwMri) window.__vwMri.open(it.qtn); break;
      case 'open': openWork(it.id); break;
      case 'done': mark(key, 'done'); note('Hidden for a few days'); break;
      case 'later': row.classList.add('snz'); break;
      case 'cancel': row.classList.remove('snz'); break;
      case 'snz': mark(key, 'snooze', Number(b.dataset.d)); note('I will bring it back in ' + b.dataset.d + ' day' + (b.dataset.d === '1' ? '' : 's')); break;
    }
  });
  $('td-tiles').addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (b) { var el = $('td-g-' + b.dataset.g); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  $('td-hidtoggle').addEventListener('click', function () { T.hidOpen = !T.hidOpen; render(); });
  $('td-hidlist').addEventListener('click', function (e) {
    var b = e.target.closest('[data-restore]'); if (!b) return;
    b.disabled = true;
    call('todaySet', b.dataset.restore, 'restore').then(function () { load(false); }).catch(function (er) { note(er.message); b.disabled = false; });
  });
  $('td-refresh').addEventListener('click', function () { load(true); });

  /* v36: the app always opens on the Dashboard (the old "open this page first" box is gone) */
  try { localStorage.removeItem('vwHome'); } catch (e) {}

  /* ---------- modal ---------- */
  function showModal(title, html) { $('td-mtitle').textContent = title; $('td-mbody').innerHTML = html; $('td-modal').classList.add('open'); }
  function closeModal() { $('td-modal').classList.remove('open'); }
  $('td-mclose').addEventListener('click', closeModal);
  $('td-modal').addEventListener('click', function (e) { if (e.target === $('td-modal')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* ---------- Prepare RF ---------- */
  function prepareModal(it) { prepareFor(it.qtn); }
  function prepareFor(qtn) {
    showModal('Prepare RF', '<div class="muted" style="padding:20px 0;text-align:center;">Reading the work...</div>');
    call('todayPrepareRf', qtn).then(function (r) {
      var all = r.fields.map(function (f) { return f.label + ': ' + f.value; }).join('\n');
      $('td-mbody').innerHTML = (r.warnings.length ? '<div class="td-warn">' + r.warnings.map(function (w) { return '⚠ ' + esc(w); }).join('<br>') + '</div>' : '') +
        '<div class="muted" style="font-size:12.5px;margin-bottom:6px;">' + esc(r.qtn) + ' · tap Copy next to a line and paste it into the RF in D365. The RF itself is still raised by you in D365.</div>' +
        r.fields.map(function (f, i) {
          return '<div class="td-field' + (f.main ? ' main' : '') + '"><div class="l">' + esc(f.label) + '</div><div class="v">' + esc(f.value) + (f.note ? '<small>' + esc(f.note) + '</small>' : '') + '</div><button type="button" class="btn btn-ghost btn-sm" data-c="' + i + '">Copy</button></div>';
        }).join('') +
        '<div class="td-row"><button type="button" class="btn btn-primary btn-sm" id="td-copyall">Copy everything</button><button type="button" class="btn btn-ghost btn-sm" id="td-openwork">Open the work</button></div>';
      $('td-mbody').onclick = function (e) {
        var c = e.target.closest('[data-c]');
        if (c) { copy(r.fields[Number(c.dataset.c)].value).then(function (ok) { c.textContent = ok ? 'Copied ✓' : 'Select & copy'; setTimeout(function () { c.textContent = 'Copy'; }, 1500); }); return; }
        if (e.target.id === 'td-copyall') { copy(all).then(function (ok) { note(ok ? 'Everything copied' : 'Could not copy: select the text'); }); return; }
        if (e.target.id === 'td-openwork') { closeModal(); openWork(r.id); }
      };
    }).catch(function (e) { $('td-mbody').innerHTML = '<div class="td-warn">' + esc(e.message) + '</div>'; });
  }

  /* ---------- Chase ---------- */
  function chaseText(who, list, cfg) {
    var c = (cfg.contacts || {})[who] || {}, hi = 'Hi' + (c.name ? ' ' + c.name : '') + ',';
    var intro = { manager: list.length > 1 ? 'Could you please review and approve the following:' : 'Could you please review and approve the following:',
                  procurement: 'Could you please progress the following:', vendor: 'Could you please give me an update on the following:' }[who] || 'Could you please look at the following:';
    var lines = list.map(function (i) {
      var c2 = i.chase;
      var head = c2.rf + (c2.crm ? ' (CRM ' + c2.crm + ')' : '') + (c2.desc ? ' - ' + c2.desc : '') + (c2.vendor && who !== 'vendor' ? ' - ' + c2.vendor : '') + (c2.amount ? ' - AED ' + money(c2.amount) : '');
      var what = who === 'vendor' ? (c2.po ? 'PO ' + c2.po + ': ' : '') + 'please confirm the work status and expected completion date' :
                 who === 'manager' ? (c2.stage === 'pr_review' ? 'PR ' + (c2.pr || '') + ' awaiting your approval' : 'awaiting your approval') :
                 ({ pr_pending: 'please raise the PR', pr_draft: 'please submit the PR', po_pending: 'please issue the PO', po_review: 'please confirm the PO' }[c2.stage] || (c2.next || '').replace(/^Procurement to /, 'please '));
      return '• ' + head + ' - waiting ' + c2.days + ' day' + (c2.days === 1 ? '' : 's') + (c2.since ? ' (since ' + dLabel(c2.since) + ')' : '') + ': ' + what;
    });
    return hi + '\n\n' + intro + '\n\n' + lines.join('\n') + '\n\nThank you,\n' + (cfg.signature || '');
  }
  function chaseModal(who, list) {
    var d = T.data;
    var items = list || d.groups.filter(function (g) { return g.k === 'chase'; }).reduce(function (a, g) { return a.concat(g.items); }, []).filter(function (i) { return i.chase && i.chase.who === who; });
    if (!items.length) { note('Nothing to chase'); return; }
    var c = (d.cfg.contacts || {})[who] || {};
    var subject = (who === 'vendor' ? 'Status update: ' : who === 'manager' ? 'For your approval: ' : 'Follow-up: ') + (items.length === 1 ? items[0].chase.rf : items.length + ' RFs');
    showModal('Chase ' + (WHO[who] || who) + (items.length > 1 ? ' (' + items.length + ' RFs)' : ''),
      '<input class="td-to" id="td-to" placeholder="To (e-mail address, optional)" value="' + esc(c.email || '') + '"><input class="td-to" id="td-subj" value="' + esc(subject) + '">' +
      '<textarea id="td-text">' + esc(chaseText(who, items, d.cfg)) + '</textarea>' +
      '<div class="td-row"><button type="button" class="btn btn-primary btn-sm" id="td-copymsg">Copy message</button><button type="button" class="btn btn-ghost btn-sm" id="td-mail">Open in e-mail</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="td-chased">I sent it: remind me in 2 days</button></div>' +
      '<div class="muted" style="font-size:12px;margin-top:10px;">You can edit the text first. Nothing is sent from here: you send it yourself.</div>');
    $('td-mbody').onclick = function (e) {
      var txt = $('td-text').value;
      if (e.target.id === 'td-copymsg') copy(txt).then(function (ok) { note(ok ? 'Message copied' : 'Could not copy: select the text'); });
      else if (e.target.id === 'td-mail') window.location.href = 'mailto:' + encodeURIComponent($('td-to').value.trim()).replace(/%40/g, '@') + '?subject=' + encodeURIComponent($('td-subj').value) + '&body=' + encodeURIComponent(txt);
      else if (e.target.id === 'td-chased') { items.forEach(function (i) { mark(i.key, 'snooze', 2); }); closeModal(); note('I will remind you in 2 days'); }
    };
  }

  /* ---------- "Prepare RF" button inside a work's detail panel (only for works that still need an RF) ---------- */
  if ($('drawer-body') && window.MutationObserver) {
    new MutationObserver(function () {
      var box = $('drawer-body').querySelector('.todo.bad'); if (!box || $('td-prep')) return;
      var qtn = ($('dh-ref').textContent || '').trim();
      var w = (typeof ST !== 'undefined' && ST.works) ? ST.works.filter(function (x) { return x.qtn === qtn; })[0] : null;
      if (!w || !w.needsRF) return;
      var b = document.createElement('button'); b.type = 'button'; b.id = 'td-prep'; b.className = 'btn btn-primary btn-sm'; b.style.marginTop = '10px'; b.textContent = 'Prepare RF';
      b.addEventListener('click', function () { prepareFor(qtn); });
      box.appendChild(b);
    }).observe($('drawer-body'), { childList: true });
  }
})();
