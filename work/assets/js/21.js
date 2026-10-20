/* ---------------- v15.1 Admin page + themes ---------------- */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.VW_THEMES || {};
  var H = document.documentElement;
  function call(fn) {
    var a = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      var t = window.__hubSlow ? window.__hubSlow(fn) : 0;
      var r = google.script.run.withSuccessHandler(function (v) { clearTimeout(t); res(v); }).withFailureHandler(function (e) { clearTimeout(t); if (window.__hubFail) window.__hubFail(fn, e); rej(new Error(e && e.message ? e.message : String(e))); });
      r[fn].apply(r, a);
    });
  }
  function say(m) { try { if (typeof toast === 'function') toast(m); } catch (e) {} }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return ''; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k) || ''; if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return ''; } }
  var sysDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /* ---------- applying a theme ---------- */
  function smooth() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    H.classList.add('vw-theming'); clearTimeout(window.__vwThemeT);
    window.__vwThemeT = setTimeout(function () { H.classList.remove('vw-theming'); }, 600);
  }
  function setPalette(p, animate) {
    if (!T[p] || H.getAttribute('data-palette') === p) return;
    if (animate) smooth();
    H.setAttribute('data-palette', p); ls('vwPalette', p);
    document.dispatchEvent(new CustomEvent('vw-palette', { detail: p }));
  }
  function modeNow() { var t = ls('vwTheme'); return t === 'dark' || t === 'light' ? t : 'auto'; }
  function resolved(m) { return m === 'dark' || m === 'light' ? m : (sysDark && sysDark.matches ? 'dark' : 'light'); }
  function setMode(m, animate) {
    if (animate) smooth();
    if (m === 'auto') ls('vwTheme', null); else ls('vwTheme', m);
    var t = resolved(m); H.setAttribute('data-theme', t);
    var b = $('theme-btn'); if (b) { b.setAttribute('aria-checked', t === 'dark' ? 'true' : 'false'); b.title = t === 'dark' ? 'Switch to light' : 'Switch to dark'; }
  }
  // "Auto" follows the computer / phone when it switches between light and dark
  if (sysDark) {
    var onSys = function () { if (modeNow() === 'auto') { setMode('auto', true); drawThemes(); } };
    if (sysDark.addEventListener) sysDark.addEventListener('change', onSys); else if (sysDark.addListener) sysDark.addListener(onSys);
  }
  var hb = $('theme-btn'); if (hb) hb.addEventListener('click', function () { setTimeout(function () { drawMode(); drawThemes(); }, 0); });

  // The saved theme (same on every device). The light / dark choice made with the header switch on a device wins on that device.
  call('adminGetPrefs').then(function (p) {
    if (!p) return;
    setPalette(p.palette, true);
    if (p.mode && !ls('vwTheme') && p.mode !== 'auto') setMode(p.mode, true);
    setExtras(p.extras === true);
  }).catch(function () {});
  function setExtras(on) {
    H.classList.toggle('vw-extras', !!on);
    document.querySelectorAll('#adm-extras button').forEach(function (b) { var o = (b.dataset.x === '1') === !!on; b.classList.toggle('on', o); b.setAttribute('aria-checked', o ? 'true' : 'false'); });
  }

  /* ---------- page ---------- */
  var A = { key: ss('vwAdminKey'), state: null, firstPin: false, busy: false };
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'admin'; $('view-admin').style.display = on ? '' : 'none'; if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function show(which) {
    $('adm-loading').style.display = which === 'load' ? '' : 'none';
    $('adm-gate').style.display = which === 'gate' ? '' : 'none';
    $('adm-body').style.display = which === 'body' ? '' : 'none';
    $('adm-lock-btn').style.display = which === 'body' ? '' : 'none';
    var nl = $('adm-nav-lock'); if (nl) nl.textContent = which === 'body' ? '🔓' : '🔒';
  }
  function opened() {
    show('load');
    call('adminState', A.key).then(function (s) {
      A.state = s;
      if (s.unlocked) { openBody(); return; }
      A.key = ''; ss('vwAdminKey', null);
      gate(s);
    }).catch(function (e) { show('gate'); $('adm-gate-err').textContent = e.message; });
  }
  function gate(s) {
    A.firstPin = !s.pinSet;
    $('adm-gate-title').textContent = A.firstPin ? 'Choose an admin PIN' : 'Admin is locked';
    $('adm-gate-sub').textContent = A.firstPin ? 'Pick 4 to 8 digits. You will need it each time you open Admin.' : 'Enter your PIN to open the admin settings.';
    $('adm-pin2').style.display = A.firstPin ? '' : 'none';
    $('adm-gate-go').textContent = A.firstPin ? 'Save PIN and open' : 'Unlock';
    $('adm-gate-hint').style.display = A.firstPin ? 'none' : '';
    $('adm-gate-err').textContent = s.lockedMinutes ? 'Too many wrong PINs. Try again in ' + s.lockedMinutes + ' minute(s).' : '';
    $('adm-pin').value = ''; $('adm-pin2').value = ''; dots();
    show('gate');
    setTimeout(function () { try { $('adm-pin').focus(); } catch (e) {} }, 50);
  }
  function dots() {
    var n = $('adm-pin').value.length, max = Math.max(4, n), h = '';
    for (var i = 0; i < max; i++) h += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    $('adm-dots').innerHTML = h;
  }
  ['adm-pin', 'adm-pin2', 'adm-old', 'adm-new', 'adm-new2'].forEach(function (id) {
    var el = $(id); if (!el) return;
    el.addEventListener('input', function () { el.value = el.value.replace(/\D/g, '').slice(0, 8); if (id === 'adm-pin') dots(); });
  });
  function shake() { var c = document.querySelector('.adm-gate-card'); if (!c) return; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  $('adm-gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (A.busy) return;
    var pin = $('adm-pin').value, err = $('adm-gate-err');
    if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'The PIN is 4 to 8 digits.'; shake(); return; }
    if (A.firstPin && pin !== $('adm-pin2').value) { err.textContent = 'The two PINs are not the same.'; shake(); return; }
    A.busy = true; err.textContent = ''; $('adm-gate-go').disabled = true;
    call(A.firstPin ? 'adminCreatePin' : 'adminUnlock', pin).then(function (r) {
      A.key = r.key; ss('vwAdminKey', r.key);
      if (A.firstPin) say('PIN saved. Admin is open.');
      return call('adminState', A.key).then(function (s) { A.state = s; openBody(); });
    }).catch(function (x) {
      err.textContent = x.message.replace(/^.*?Error:\s*/, ''); shake();
      $('adm-pin').value = ''; dots(); $('adm-pin').focus();
    }).then(function () { A.busy = false; $('adm-gate-go').disabled = false; });
  });
  $('adm-lock-btn').addEventListener('click', function () {
    var k = A.key; A.key = ''; ss('vwAdminKey', null);
    call('adminLock', k).catch(function () {});
    gate({ pinSet: true, lockedMinutes: 0 });
    say('Admin locked.');
  });
  function lockedAgain(e) {
    if (!/LOCKED:/.test(e.message)) return false;
    A.key = ''; ss('vwAdminKey', null); gate({ pinSet: true, lockedMinutes: 0 });
    $('adm-gate-err').textContent = 'Admin locked itself after 30 minutes. Enter your PIN again.';
    return true;
  }

  /* ---------- unlocked page ---------- */
  function openBody() {
    show('body');
    drawMode(); drawThemes(); drawSaved(); setExtras(H.classList.contains('vw-extras'));
  }
  function drawSaved() {
    var p = A.state && A.state.prefs;
    $('adm-saved').textContent = p && p.savedAt ? 'Last saved ' + p.savedAt + '.' : '';
  }
  function drawMode() {
    var m = modeNow();
    document.querySelectorAll('#adm-mode button').forEach(function (b) { var on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
  }
  function win(t) {
    // a little app window drawn in the theme's own colours
    return '<div class="adm-win" style="background:' + t.bg + ';border-color:' + t.border + '">' +
      '<div class="bar" style="background:' + t['bg-card'] + ';border-bottom:1px solid ' + t.border + '"><i></i><i></i><i></i></div>' +
      '<div class="main">' +
        '<div class="side" style="background:' + t['bg-card'] + ';border-right:1px solid ' + t.border + '">' +
          '<span style="background:' + t.border + ';width:70%"></span>' +
          '<span style="background:linear-gradient(90deg,' + t.solid + ',' + t['solid-hover'] + ')"></span>' +
          '<span style="background:' + t.border + ';width:85%"></span><span style="background:' + t.border + ';width:60%"></span><span style="background:' + t.border + ';width:75%"></span>' +
        '</div>' +
        '<div class="pg"><div class="glow" style="background:' + t['glow-1'].replace(/,\s*\.\d+\)/, ',.55)') + '"></div>' +
          '<div class="ttl" style="background:linear-gradient(90deg,' + t.navy + ',' + t['title-end'] + ')"></div>' +
          '<div class="cards">' +
            '<div style="background:' + t['bg-card'] + ';border:1px solid ' + t.border + '"><b style="background:' + t['navy-lt'] + '"></b><s style="background:' + t['text-3'] + '"></s></div>' +
            '<div style="background:' + t['bg-card'] + ';border:1px solid ' + t.border + '"><b style="background:' + t.accent + '"></b><s style="background:' + t['text-3'] + '"></s></div>' +
          '</div>' +
          '<div class="row"><span class="btn1" style="background:' + t.solid + '"></span><span class="chip" style="background:' + t['accent-lt'] + ';border:1px solid ' + t.accent + '"></span></div>' +
        '</div>' +
      '</div></div>';
  }
  function drawThemes() {
    var box = $('adm-themes'); if (!box || $('adm-body').style.display === 'none') return;
    var cur = H.getAttribute('data-palette'), mode = H.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    box.innerHTML = Object.keys(T).map(function (k) {
      var th = T[k], t = th[mode];
      return '<button type="button" class="adm-th' + (k === cur ? ' on' : '') + '" data-p="' + k + '" role="radio" aria-checked="' + (k === cur) + '" aria-label="' + th.name + ' theme">' +
        '<span class="tick" aria-hidden="true">✓</span>' + win(t) +
        '<div class="nm">' + th.name + '<span class="sw" aria-hidden="true"><i style="background:' + th.light['navy-lt'] + '"></i><i style="background:' + th.dark.bg + '"></i><i style="background:' + th.light.accent + '"></i></span></div>' +
        '<div class="nt">' + th.note + '</div></button>';
    }).join('');
  }
  function save(prefs, msg) {
    return call('adminSavePrefs', A.key, prefs).then(function (p) {
      if (A.state) A.state.prefs = p; drawSaved(); if (msg) say(msg);
    }).catch(function (e) { if (!lockedAgain(e)) say('Not saved: ' + e.message); });
  }
  $('adm-themes').addEventListener('click', function (e) {
    var b = e.target.closest('.adm-th'); if (!b) return;
    var p = b.getAttribute('data-p'); if (!T[p]) return;
    setPalette(p, true); drawThemes();
    save({ palette: p }, T[p].name + ' theme saved');
  });
  $('adm-themes').addEventListener('keydown', function (e) {
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(e.key) < 0) return;
    var all = [].slice.call(this.querySelectorAll('.adm-th')), i = all.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); var n = all[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]; n.focus();
  });
  $('adm-mode').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]'); if (!b) return;
    var m = b.dataset.mode;
    setMode(m, true); drawMode(); drawThemes();
    save({ mode: m }, m === 'auto' ? 'Follows your device (light by day, dark by night if your device does that)' : (m === 'dark' ? 'Dark mode saved' : 'Light mode saved'));
  });
  $('adm-extras').addEventListener('click', function (e) {
    var b = e.target.closest('[data-x]'); if (!b) return;
    var on = b.dataset.x === '1'; setExtras(on);
    save({ extras: on }, on ? 'The extra pages are back in the menu' : 'The extra pages are hidden from the menu');
  });
  $('adm-pinform').addEventListener('submit', function (e) {
    e.preventDefault();
    var o = $('adm-old').value, n = $('adm-new').value, n2 = $('adm-new2').value, err = $('adm-pin-err');
    err.textContent = '';
    if (!/^\d{4,8}$/.test(n)) { err.textContent = 'The new PIN must be 4 to 8 digits.'; return; }
    if (n !== n2) { err.textContent = 'The two new PINs are not the same.'; return; }
    call('adminChangePin', A.key, o, n).then(function () {
      $('adm-old').value = $('adm-new').value = $('adm-new2').value = ''; say('PIN changed');
    }).catch(function (x) { if (!lockedAgain(x)) err.textContent = x.message; });
  });
})();
