/* ---------------- ADDED: Site Map ----------------
   Uses only public things of the page above (ST, DASH, toast, openDrawer, loadDashboard) and the server file Map.gs.
   The map itself (MapLibre) is loaded from the internet the first time this page is opened, so it costs nothing on the other pages. */
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

  var LIB_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  var LIB_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  var STREET_URL = 'https://tiles.openfreemap.org/styles/liberty';
  var SAT = { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] };
  var SEVNAME = { late: 'Late', warn: 'Needs attention', ok: 'On track', idle: 'Nothing open' };
  var RANK = { late: 0, warn: 1, ok: 2, idle: 3 };
  var M = { data: null, by: {}, map: null, markers: {}, sel: '', filter: 'all', q: '', layer: 'sat', tilt: false, move: false, armed: '', at: 0, failed: false, showAll: {}, dragAt: 0, rmAt: 0, ready: false };
  try { var sl = localStorage.getItem('vwMapLayer'); if (sl === 'street' || sl === 'sat') M.layer = sl; } catch (e) {}

  function styleFor(l) { var o = window.__vwMapStyle; return o && o[l] ? o[l] : (l === 'sat' ? SAT : STREET_URL); }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function label(code) { return String(code).replace(/^DD/i, ''); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }

  /* ---------- page ---------- */
  document.querySelectorAll('.nav-item[data-view]').forEach(function (n) {
    function sync() { var on = n.dataset.view === 'map'; $('view-map').style.display = on ? '' : 'none'; if (on) opened(); }
    n.addEventListener('click', sync);
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') sync(); });
  });
  function opened() {
    if (!M.data || Date.now() - M.at > 60000) load(false);
    else { renderPanel(); resizeSoon(); }
  }
  function resizeSoon() { setTimeout(function () { if (M.map) { try { M.map.resize(); } catch (e) {} } }, 60); }

  function load(force) {
    if (!M.data) { $('mp-loading').style.display = ''; $('mp-body').style.display = 'none'; }
    $('mp-error').style.display = 'none';
    call('mapGet', !!force).then(function (d) {
      M.data = d; M.at = Date.now(); M.by = {};
      d.buildings.forEach(function (b) { M.by[b.code] = b; });
      if (M.sel && !M.by[M.sel]) M.sel = '';
      $('mp-loading').style.display = 'none'; $('mp-body').style.display = '';
      $('mp-sub').textContent = d.placed + ' of ' + d.buildings.length + ' buildings are on the map' + (d.generatedAt ? ' · tracker read ' + d.generatedAt : '') + '.';
      var nt = $('mp-note');
      if (d.unassigned) { nt.textContent = d.unassigned + ' open work(s) in the tracker have no building, so they are not on the map.'; nt.style.display = ''; } else nt.style.display = 'none';
      renderPanel();
      return initMap().then(function () { syncMarkers(); if (!M.ready) { M.ready = true; fitAll(true); } if (force) note('Refreshed'); document.dispatchEvent(new Event('vw-map-loaded')); });
    }).catch(function (e) {
      $('mp-loading').style.display = 'none';
      $('mp-error').textContent = 'Could not load the map data: ' + e.message; $('mp-error').style.display = '';
    });
  }

  /* ---------- the map library ---------- */
  function loadLib() {
    return new Promise(function (res, rej) {
      if (window.maplibregl) return res();
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LIB_CSS; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = LIB_JS; s.async = true;
      var t = setTimeout(function () { rej(new Error('The map library took too long to load.')); }, 20000);
      s.onload = function () { clearTimeout(t); window.maplibregl ? res() : rej(new Error('The map library did not start.')); };
      s.onerror = function () { clearTimeout(t); rej(new Error('The map library could not be loaded (no internet, or it is blocked on this network).')); };
      document.head.appendChild(s);
    });
  }
  function showMsg(title, text) {
    $('mp-msg').innerHTML = '<div><b>' + esc(title) + '</b>' + esc(text) + '</div>'; $('mp-msg').style.display = '';
    ['mp-tl', 'mp-legend'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });
    document.querySelector('#view-map .mp-tr').style.display = 'none';
  }
  function initMap() {
    if (M.map || M.failed) return Promise.resolve();
    return loadLib().then(function () {
      var v = M.data.start;
      var map = new maplibregl.Map({ container: 'mp-canvas', style: styleFor(M.layer), center: [v.lng, v.lat], zoom: v.zoom, maxPitch: 75, attributionControl: { compact: true } });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
      map.on('style.load', onStyle);
      map.on('click', onMapClick);
      map.on('zoom', farClass);
      M.map = map; setLayerUi(); farClass(); resizeSoon();
    }).catch(function (e) {
      M.failed = true;
      showMsg('The map cannot be shown', e.message + ' The list on the right still works, and you can still set a pin by pasting coordinates.');
    });
  }
  function farClass() { if (M.map) $('mp-canvas').classList.toggle('far', M.map.getZoom() < 14); }
  function onStyle() {
    if (M.layer === 'street') ensure3D();
    clearTimeout(M.styleT);
  }
  function ensure3D() {
    try {
      var st = M.map.getStyle(); if (!st || !st.layers) return;
      if (st.layers.some(function (l) { return l.type === 'fill-extrusion'; })) return;
      var src = Object.keys(st.sources).filter(function (k) { return st.sources[k].type === 'vector'; })[0]; if (!src) return;
      M.map.addLayer({ id: 'vw-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-extrusion-color': '#c4cbd8', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.86 } });
    } catch (e) {}
  }
  function setLayerUi() {
    $('mp-l-sat').classList.toggle('on', M.layer === 'sat'); $('mp-l-street').classList.toggle('on', M.layer === 'street');
    $('mp-canvas').classList.toggle('inv', M.layer === 'street' && isDark());
    $('mp-tilt').classList.toggle('on', M.tilt); $('mp-move').classList.toggle('on', M.move);
  }
  function setLayer(l) {
    if (!M.map || l === M.layer) return;
    var prev = M.layer; M.layer = l; try { localStorage.setItem('vwMapLayer', l); } catch (e) {}
    setLayerUi();
    try { M.map.setStyle(styleFor(l)); } catch (e) { M.layer = prev; setLayerUi(); return; }
    clearTimeout(M.styleT);
    M.styleT = setTimeout(function () {                      // the street style never arrived: go back to satellite
      if (M.layer === 'street' && !(M.map.isStyleLoaded && M.map.isStyleLoaded())) { note('The street map could not load here, showing satellite instead.'); M.layer = 'sat'; setLayerUi(); try { M.map.setStyle(styleFor('sat')); } catch (e) {} }
    }, 9000);
  }
  function setTilt(on) {
    M.tilt = on; setLayerUi();
    if (M.map) M.map.easeTo({ pitch: on ? 62 : 0, bearing: on ? -18 : 0, duration: 700 });
  }
  function fitAll(first) {
    if (!M.map || !M.data) return;
    var p = M.data.buildings.filter(function (b) { return b.placed; });
    if (!p.length) { M.map.jumpTo({ center: [M.data.start.lng, M.data.start.lat], zoom: M.data.start.zoom }); return; }
    if (p.length === 1) { M.map.flyTo({ center: [p[0].lng, p[0].lat], zoom: 16, duration: first ? 0 : 800 }); return; }
    var b = new maplibregl.LngLatBounds();
    p.forEach(function (x) { b.extend([x.lng, x.lat]); });
    M.map.fitBounds(b, { padding: 70, maxZoom: 17, duration: first ? 0 : 800 });
  }

  /* ---------- pins ---------- */
  function pinHtml(b) {
    return '<div class="mp-pin s-' + b.sev + (M.sel === b.code ? ' sel' : '') + '"><span class="mp-ring"></span><span class="mp-core">' + esc(label(b.code)) + '</span>' + (b.late ? '<i class="mp-badge">' + b.late + '</i>' : '') + '</div>';
  }
  var Z = { late: 4, warn: 3, ok: 2, idle: 1 };
  function pinTitle(b) { return b.code + ' · ' + b.name + ' — ' + SEVNAME[b.sev] + (b.late ? ' (' + plural(b.late, 'late item', 'late items') + ')' : ''); }
  function matches(b) {
    var f = M.filter;
    if (f === 'unplaced') { if (b.placed) return false; }
    else if (f !== 'all' && b.sev !== f) return false;
    if (M.q) { var h = (b.code + ' ' + b.name).toLowerCase(); if (h.indexOf(M.q) < 0) return false; }
    return true;
  }
  function syncMarkers() {
    if (!M.map || !M.data) return;
    Object.keys(M.markers).forEach(function (k) { M.markers[k].remove(); }); M.markers = {};
    M.data.buildings.forEach(function (b) {
      if (!b.placed) return;
      var el = document.createElement('div'); el.className = 'mp-pin-wrap'; el.innerHTML = pinHtml(b); el.title = pinTitle(b); el.style.zIndex = Z[b.sev];
      el.addEventListener('click', function (ev) { ev.stopPropagation(); if (Date.now() - M.dragAt < 400) return; if (M.armed) return; select(b.code, false); });
      var mk = new maplibregl.Marker({ element: el, draggable: M.move, anchor: 'center' }).setLngLat([b.lng, b.lat]).addTo(M.map);
      mk.on('dragend', function () { M.dragAt = Date.now(); var p = mk.getLngLat(); savePos(b.code, p.lat, p.lng, false); });
      M.markers[b.code] = { mk: mk, el: el, remove: function () { mk.remove(); } };
    });
    applyVisibility();
  }
  function refreshPin(code) {
    var m = M.markers[code], b = M.by[code]; if (!m || !b) return;
    m.el.innerHTML = pinHtml(b); m.el.title = pinTitle(b); m.el.style.zIndex = M.sel === code ? 9 : Z[b.sev];
  }
  function applyVisibility() {
    Object.keys(M.markers).forEach(function (k) { M.markers[k].el.style.display = matches(M.by[k]) ? '' : 'none'; });
  }
  function setMove(on) {
    M.move = on; setLayerUi();
    Object.keys(M.markers).forEach(function (k) { M.markers[k].mk.setDraggable(on); });
    note(on ? 'Drag a pin to move it. It saves when you let go.' : 'Pins are locked again.');
  }

  /* ---------- saving positions ---------- */
  function parseCoords(t) {
    t = String(t || '').trim(); if (!t) return null;
    try { t = decodeURIComponent(t); } catch (e) {}
    var m = /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(t) || /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(t) ||
            /[?&](?:q|ll|query|center)=(-?\d{1,3}\.\d+)[,\s+]+(-?\d{1,3}\.\d+)/.exec(t) || /^\s*(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/.exec(t);
    if (!m) return /goo\.gl|maps\.app/i.test(t) ? 'short' : null;
    var lat = Number(m[1]), lng = Number(m[2]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }
  function savePos(code, lat, lng, fly) {
    var b = M.by[code]; if (!b) return Promise.resolve();
    return call('mapSavePin', code, lat, lng, b.extra ? b.name : '').then(function (r) {
      b.lat = r.lat; b.lng = r.lng; b.placed = true;
      M.data.placed = M.data.buildings.filter(function (x) { return x.placed; }).length; M.data.notPlaced = M.data.buildings.length - M.data.placed;
      note(code + ' saved');
      syncMarkers();
      if (fly && M.map) M.map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(M.map.getZoom(), 17), duration: 900 });
      renderPanel();
    }).catch(function (e) { note('Could not save: ' + e.message); syncMarkers(); });
  }
  function onMapClick(e) {
    if (!M.armed) { return; }
    var code = M.armed; disarm();
    savePos(code, e.lngLat.lat, e.lngLat.lng, false).then(function () { select(code, false); });
  }
  function arm(code) {
    var b = M.by[code]; if (!b) return;
    M.armed = code; M.sel = code;
    $('mp-armed-t').textContent = (b.placed ? 'Move ' : 'Place ') + b.code + ' · ' + b.name + ': tap its spot on the map.';
    $('mp-coord').value = ''; $('mp-armed').style.display = '';
    $('mp-stage').classList.add('arming');
    renderPanel();
    if (window.innerWidth <= 1000) $('mp-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function disarm() { M.armed = ''; $('mp-armed').style.display = 'none'; $('mp-stage').classList.remove('arming'); }

  /* ---------- selecting a building ---------- */
  function select(code, fly) {
    var old = M.sel; M.sel = code; M.rmAt = 0;
    refreshPin(old); refreshPin(code);
    var b = M.by[code];
    if (b && b.placed && M.map && fly !== false) M.map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(M.map.getZoom(), 17), duration: 900 });
    renderPanel();
    if (window.innerWidth <= 1000) { var p = $('mp-panel'); p.scrollTop = 0; p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function openWork(id) {
    id = Number(id); if (!id) return;
    if (typeof DASH !== 'undefined' && DASH.loaded && ST.byId[id]) { openDrawer(id); return; }
    note('Loading the tracker...');
    var once = function () { document.removeEventListener('vw-dash-loaded', once); if (ST.byId[id]) openDrawer(id); };
    document.addEventListener('vw-dash-loaded', once);
    if (typeof DASH !== 'undefined' && !DASH.loaded) loadDashboard(false);
  }

  /* ---------- side panel ---------- */
  function renderPanel() {
    var p = $('mp-panel'); if (!M.data) return;
    p.innerHTML = M.sel && M.by[M.sel] ? detailHtml(M.by[M.sel]) : listHtml();
    var inp = $('mp-q'); if (inp && document.activeElement !== inp && M.keepFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    M.keepFocus = false;
  }
  function listHtml() {
    var d = M.data, t = d.totals, bs = d.buildings;
    var cnt = { all: bs.length, late: 0, warn: 0, ok: 0, idle: 0, unplaced: 0 };
    bs.forEach(function (b) { cnt[b.sev]++; if (!b.placed) cnt.unplaced++; });
    var chips = [['all', 'All'], ['late', 'Late'], ['warn', 'Attention'], ['ok', 'On track'], ['idle', 'Idle'], ['unplaced', 'Not placed']].map(function (c) {
      return '<button type="button" class="mp-chip' + (M.filter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + ' ' + cnt[c[0]] + '</button>';
    }).join('');
    var rows = bs.filter(matches).sort(function (a, b) { return (RANK[a.sev] - RANK[b.sev]) || (b.late - a.late) || (a.code < b.code ? -1 : 1); });
    var html = '<div class="mp-tiles mp-rise">' +
      '<div class="mp-tile' + (t.late ? ' late' : '') + '"><b>' + t.late + '</b><span>late items</span></div>' +
      '<div class="mp-tile' + (t.buildingsLate ? ' late' : '') + '"><b>' + t.buildingsLate + '</b><span>buildings with late items</span></div>' +
      '<div class="mp-tile"><b>' + t.open + '</b><span>open works</span></div>' +
      '<div class="mp-tile"><b>' + d.placed + '/' + bs.length + '</b><span>pinned on the map</span></div></div>';
    if (d.notPlaced) html += '<div class="mp-empty" style="padding:4px 2px;text-align:left;">' + (d.placed ? '' : 'No pins yet. ') + 'Pick a building below marked <b>📍 place</b>, then tap its spot on the map. You can also paste coordinates from Google Maps.</div>';
    html += '<input id="mp-q" class="mp-search" type="search" placeholder="Search a building..." value="' + esc(M.q) + '" autocomplete="off" aria-label="Search buildings">' +
      '<div class="mp-chips">' + chips + '</div><div class="mp-list">';
    if (!rows.length) html += '<div class="mp-empty">Nothing matches.</div>';
    rows.forEach(function (b, i) {
      var em = !b.placed ? '<em class="place">📍 place</em>' : (b.late ? '<em class="late">' + b.late + ' late</em>' : (b.warn ? '<em class="warn">' + b.warn + ' due</em>' : (b.open ? '<em>' + b.open + ' open</em>' : '')));
      html += '<button type="button" class="mp-row mp-rise" style="--i:' + Math.min(i, 14) + '" data-code="' + esc(b.code) + '"><span class="mp-dot s-' + b.sev + '"></span><span class="t"><b>' + esc(b.code) + '</b><span>' + esc(b.name) + '</span></span>' + em + '</button>';
    });
    return html + '</div>';
  }
  function itemRow(it, i) {
    var title = (it.qtn || 'RF') + (it.crm ? ' · CRM ' + it.crm : '') + (it.apt ? ' · ' + it.apt : '');
    var d = it.days !== null && it.days !== undefined ? it.days + 'd' : '';
    var can = !!it.id;
    return '<button type="button" class="mp-it mp-rise ' + (it.sev || '') + (can ? '' : ' static') + '" style="--i:' + Math.min(i, 12) + '"' + (can ? ' data-work="' + it.id + '"' : '') + '><span class="t"><div class="a">' + esc(title) + '</div><div class="b">' + esc(it.label || it.desc) + (it.label && it.desc ? ' · ' + esc(it.desc) : '') + '</div></span>' + (d ? '<span class="d">' + d + '</span>' : '') + '</button>';
  }
  function detailHtml(b) {
    var h = '<button type="button" class="btn btn-ghost btn-sm" data-a="back" style="align-self:flex-start;">← All buildings</button>' +
      '<div class="mp-dh mp-rise"><span class="mp-dot s-' + b.sev + '"></span><div><h3>' + esc(b.code) + ' · ' + esc(b.name) + '</h3><div class="mp-dsub">' + esc(SEVNAME[b.sev]) + ' · ' + b.open + ' open, ' + b.done + ' completed' + (b.placed ? '' : ' · not on the map yet') + '</div></div></div>' +
      '<div class="mp-tiles mp-rise" style="--i:1">' +
      '<div class="mp-tile' + (b.late ? ' late' : '') + '"><b>' + b.late + '</b><span>late items</span></div>' +
      '<div class="mp-tile"><b>' + b.open + '</b><span>open works</span></div>' +
      '<div class="mp-tile' + (b.rfOver ? ' late' : '') + '"><b>' + b.rfOver + '<small style="font-size:12px;font-weight:600;color:var(--text-3);"> / ' + b.rfOpen + '</small></b><span>RFs late / in progress</span></div>' +
      '<div class="mp-tile"><b>' + (M.data.docsOn ? b.docsMissing : '–') + '</b><span>' + (M.data.docsOn ? 'works missing documents' : 'documents not set up') + '</span></div></div>';
    var items = b.items, n = items.length, all = M.showAll[b.code + ':i'];
    h += '<div class="mp-h4">Needs attention' + (b.itemsTotal ? ' (' + b.itemsTotal + ')' : '') + '</div>';
    if (!n) h += '<div class="mp-empty">Nothing is waiting on you here. 🎉</div>';
    else {
      (all ? items : items.slice(0, 6)).forEach(function (it, i) { h += itemRow(it, i); });
      if (!all && n > 6) h += '<button type="button" class="btn btn-ghost btn-sm" data-a="more-i">Show all ' + n + '</button>';
    }
    var wl = b.list, wall = M.showAll[b.code + ':w'];
    h += '<div class="mp-h4">Open works (' + b.open + ')</div>';
    if (!wl.length) h += '<div class="mp-empty">No open works.</div>';
    else {
      (wall ? wl : wl.slice(0, 6)).forEach(function (w, i) {
        h += itemRow({ id: w.id, qtn: w.qtn, crm: w.crm, apt: w.apt, label: w.status, desc: w.desc, sev: '', days: null }, i);
      });
      if (!wall && wl.length > 6) h += '<button type="button" class="btn btn-ghost btn-sm" data-a="more-w">Show all ' + wl.length + '</button>';
    }
    h += '<div class="mp-pos">';
    if (b.placed) h += '<button type="button" class="btn btn-ghost btn-sm" data-a="zoom">Zoom to pin</button><button type="button" class="btn btn-ghost btn-sm" data-a="move">Move pin</button><button type="button" class="btn btn-ghost btn-sm" data-a="remove" id="mp-rm">Remove pin</button>';
    else h += '<button type="button" class="btn btn-primary btn-sm" data-a="move">📍 Place this building</button>';
    return h + '</div>';
  }

  /* ---------- events ---------- */
  $('mp-panel').addEventListener('click', function (e) {
    var t = e.target.closest('[data-code],[data-f],[data-a],[data-work]'); if (!t) return;
    if (t.dataset.work) { openWork(t.dataset.work); return; }
    if (t.dataset.f) { M.filter = t.dataset.f; applyVisibility(); renderPanel(); return; }
    if (t.dataset.code) { var b = M.by[t.dataset.code]; if (!b.placed) { arm(b.code); } else select(b.code, true); return; }
    var a = t.dataset.a, b2 = M.by[M.sel];
    if (a === 'back') { if (M.armed) disarm(); M.sel = ''; refreshAllPins(); renderPanel(); }
    else if (a === 'more-i') { M.showAll[M.sel + ':i'] = true; renderPanel(); }
    else if (a === 'more-w') { M.showAll[M.sel + ':w'] = true; renderPanel(); }
    else if (a === 'zoom' && b2 && M.map) M.map.flyTo({ center: [b2.lng, b2.lat], zoom: 18, duration: 800 });
    else if (a === 'move' && b2) arm(b2.code);
    else if (a === 'remove' && b2) {
      if (Date.now() - M.rmAt > 3500) { M.rmAt = Date.now(); t.textContent = 'Click again to remove'; return; }
      call('mapRemovePin', b2.code).then(function () { b2.placed = false; b2.lat = b2.lng = null; M.data.placed--; M.data.notPlaced++; M.rmAt = 0; syncMarkers(); renderPanel(); note('Pin removed'); }).catch(function (er) { note('Could not remove: ' + er.message); });
    }
  });
  function refreshAllPins() { Object.keys(M.markers).forEach(refreshPin); }
  $('mp-panel').addEventListener('input', function (e) {
    if (e.target.id !== 'mp-q') return;
    M.q = e.target.value.trim().toLowerCase(); M.keepFocus = true; applyVisibility(); renderPanel();
  });
  $('mp-panel').addEventListener('keydown', function (e) {
    if (e.target.id === 'mp-q' && e.key === 'Enter') { var f = M.data.buildings.filter(matches)[0]; if (f) { if (f.placed) select(f.code, true); else arm(f.code); } }
  });
  $('mp-refresh').addEventListener('click', function () { load(true); });
  $('mp-l-sat').addEventListener('click', function () { setLayer('sat'); });
  $('mp-l-street').addEventListener('click', function () { setLayer('street'); });
  $('mp-tilt').addEventListener('click', function () { setTilt(!M.tilt); });
  $('mp-fit').addEventListener('click', function () { fitAll(false); });
  $('mp-move').addEventListener('click', function () { setMove(!M.move); });
  $('mp-armed-x').addEventListener('click', function () { disarm(); renderPanel(); });
  function setFromBox() {
    var r = parseCoords($('mp-coord').value);
    if (r === 'short') { note('That is a short link. Open it in your browser first, then copy the address from the top, or long-press the spot in Google Maps and copy the coordinates.'); return; }
    if (!r) { note('Paste coordinates like 25.2048, 55.2708 or a full Google Maps link.'); return; }
    var code = M.armed; if (!code) return; disarm();
    savePos(code, r.lat, r.lng, true).then(function () { select(code, false); });
  }
  $('mp-coord-set').addEventListener('click', setFromBox);
  $('mp-coord').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setFromBox(); } });
  $('mp-findf').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('mp-find').value.trim(); if (!q || !M.map) return;
    var near = parseCoords(q);
    if (near && near !== 'short') { M.map.flyTo({ center: [near.lng, near.lat], zoom: 17, duration: 900 }); return; }
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q + ' Dubai'))
      .then(function (r) { return r.json(); })
      .then(function (a) {
        if (!a || !a[0]) { note('Nothing found for "' + q + '".'); return; }
        M.map.flyTo({ center: [Number(a[0].lon), Number(a[0].lat)], zoom: 16, duration: 1000 });
      }).catch(function () { note('The place search is not available right now. Zoom the map by hand instead.'); });
  });
  new MutationObserver(setLayerUi).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', function () { if (M.map) M.map.resize(); });
})();
