/* ---------------- ADDED v22: Breakdown report helpers ----------------
   "Type of work" fills the empty boxes with the standard text (tab BR_Templates, server: BrTemplates.gs),
   "Paste a WhatsApp message" reads CRM / floor / size / thickness from it, "Make another like this" keeps the texts. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('rep-type')) return;
  var T = [], auto = {}, ctx = {};
  var MAP = [['title', 'rep-title'], ['desc', 'rep-desc'], ['cause', 'rep-cause'], ['actions', 'rep-containment'], ['scope', 'rep-scope'],
             ['equipment', 'rep-equipment'], ['duration', 'rep-duration'], ['ops', 'rep-ops'], ['tenant', 'rep-tenant']];
  var KEYS = [[/bath ?tub/i, 'Bathtub replacement'], [/kitchen|cabinet with counter|countertop/i, 'Kitchen cabinet replacement'], [/\bdoor\b/i, 'Door replacement'],
              [/paint/i, 'Apartment painting'], [/leak|seepage/i, 'Water leakage'], [/fan ?coil|\bfcu\b|\ba\.?c\b|cooling/i, 'AC / fan coil unit'],
              [/heater|geyser/i, 'Water heater replacement'], [/pump/i, 'Pump replacement'], [/tile|flooring/i, 'Tiles / flooring'], [/ceiling|gypsum/i, 'Gypsum / false ceiling']];

  function load() {
    if (T.length) return;
    google.script.run.withSuccessHandler(function (list) {
      T = list || [];
      $('rep-type').innerHTML = '<option value="">Choose to fill in the standard text…</option>' + T.map(function (t, i) { return '<option value="' + i + '">' + esc(t.type) + '</option>'; }).join('');
    }).withFailureHandler(function () {}).brTemplates();
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // {word} -> value; "[ ... ]" parts drop out when a {word} inside them is empty
  function fill(text, v) {
    var t = String(text || '').replace(/\[([^\]]*)\]/g, function (m, part) {
      var ok = true; part.replace(/\{(\w+)\}/g, function (x, k) { if (!v[k]) ok = false; return x; });
      return ok ? part : '';
    });
    return t.replace(/\{(\w+)\}/g, function (x, k) { return v[k] || (k === 'location' ? 'the location' : k === 'item' ? 'door' : ''); }).replace(/\s+([,.])/g, '$1').replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ').trim();
  }
  function vals() { return { location: $('rep-loc').value.trim(), floor: ctx.floor || '', size: ctx.size || '', thickness: ctx.thickness || '', item: ctx.item || '' }; }
  function typedByYou(id) { var v = $(id).value.trim(); return v && v !== (auto[id] || ''); }

  function apply(i) {
    var t = T[i]; if (!t) return;
    var v = vals();
    var mine = MAP.filter(function (m) { return t[m[0]] && typedByYou(m[1]); });
    var replaceMine = mine.length ? confirm('Replace what you typed in ' + mine.length + ' box' + (mine.length === 1 ? '' : 'es') + ' with the standard text for "' + t.type + '"?\n\nOK = replace, Cancel = only fill the empty boxes.') : false;
    MAP.forEach(function (m) {
      var id = m[1], txt = fill(t[m[0]], v);
      if (!txt) return;
      if (typedByYou(id) && !replaceMine) return;
      $(id).value = txt; auto[id] = txt;
      $(id).dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (t.days && !$('rep-completion').value) {
      var d = new Date(Date.now() + 4 * 3600e3 + t.days * 86400e3);
      $('rep-completion').value = d.toISOString().slice(0, 10);
    }
  }
  $('rep-type').addEventListener('change', function () { if (this.value !== '') apply(Number(this.value)); });
  // the location typed after choosing the type: put it into the standard text that is still untouched
  $('rep-loc').addEventListener('change', function () { var i = $('rep-type').value; if (i !== '') { var keep = {}; MAP.forEach(function (m) { if (typedByYou(m[1])) keep[m[1]] = 1; }); if (!Object.keys(keep).length) apply(Number(i)); } });

  // ---------- WhatsApp message ----------
  function ord(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function parse(txt) {
    var t = String(txt || ''), r = {};
    var c = /(?:^|\D)(6\d{9})(?!\d)/.exec(t); if (c) r.crm = c[1];
    var f = /(\d{1,3})\s*(?:st|nd|rd|th)?\s*(?:floor|flr)\b/i.exec(t); if (f) r.floor = ord(f[1]) + ' floor';
    else if (/ground floor|\bG\.?F\b/i.test(t)) r.floor = 'ground floor';
    var z = /(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm)?\s*[x×*]\s*(\d{2,4}(?:\.\d+)?)\s*(cm|mm)?/i.exec(t);
    if (z) r.size = z[1] + ' × ' + z[2] + ' ' + (z[3] ? z[3].toLowerCase() : (Number(z[1]) > 400 ? 'mm' : 'cm'));
    var k = /(?:thickness|thikness|thicknes|tetnes|tickness|thk|thick)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm)?/i.exec(t);
    if (k) r.thickness = k[1] + ' ' + (k[2] ? k[2].toLowerCase() : 'cm');
    if (/fire\s*hose/i.test(t)) r.item = 'fire hose cabinet door';
    else if (/water\s*meter/i.test(t)) r.item = 'water meter cabinet door';
    else if (/main\s*door|entrance\s*door/i.test(t)) r.item = 'main entrance door';
    else if (/\bdoor\b/i.test(t)) r.item = 'door';
    for (var i = 0; i < KEYS.length; i++) if (KEYS[i][0].test(t)) { r.type = KEYS[i][1]; break; }
    return r;
  }
  function found(r) {
    return [r.crm ? 'CRM ' + r.crm : '', r.floor, r.size, r.thickness ? r.thickness + ' thick' : '', r.type].filter(Boolean).join(' · ') || 'Nothing recognised yet.';
  }
  $('bd-wa-link').addEventListener('click', function () {
    var box = $('bd-wa'), open = box.hidden; box.hidden = !open; this.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('bd-wa-text').focus();
  });
  $('bd-wa-text').addEventListener('input', function () { $('bd-wa-found').textContent = this.value.trim() ? 'Found: ' + found(parse(this.value)) : ''; });
  $('bd-wa-use').addEventListener('click', function () {
    var r = parse($('bd-wa-text').value);
    ctx = { floor: r.floor, size: r.size, thickness: r.thickness, item: r.item };
    if (r.crm && !$('rep-crm').value.trim()) { $('rep-crm').value = r.crm; $('rep-crm').dispatchEvent(new Event('input', { bubbles: true })); }
    var idx = -1; T.forEach(function (t, i) { if (r.type && t.type.toLowerCase() === r.type.toLowerCase()) idx = i; });
    if (idx < 0 && $('rep-type').value !== '') idx = Number($('rep-type').value);
    if (idx > -1) { $('rep-type').value = String(idx); apply(idx); }
    $('bd-wa').hidden = true; $('bd-wa-link').setAttribute('aria-expanded', 'false');
    if (typeof toast === 'function') toast(idx > -1 ? 'Filled in. Check the text.' : 'Details read. Choose the type of work to fill in the text.');
  });

  // ---------- Make another like this ----------
  $('bd-again').addEventListener('click', function () {
    ['rep-crm'].forEach(function (id) { $(id).value = ''; });
    ctx = {};
    // the standard texts that you did not change are rebuilt for the next item; your own wording stays
    MAP.forEach(function (m) { if (!typedByYou(m[1])) { $(m[1]).value = ''; auto[m[1]] = ''; } });
    if ($('rep-type').value !== '') apply(Number($('rep-type').value));
    if (window.__bdClearPhotos) window.__bdClearPhotos();
    $('bd-wa-text').value = ''; $('bd-wa-found').textContent = '';
    $('result-box').style.display = 'none';
    var top = document.getElementById('view-breakdown'); if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('bd-wa').hidden = false; $('bd-wa-link').setAttribute('aria-expanded', 'true');
    if (typeof toast === 'function') toast('Ready for the next one: paste its message or type the CRM');
  });
  document.addEventListener('bd-cleared', function () { auto = {}; ctx = {}; if ($('bd-wa-text')) { $('bd-wa-text').value = ''; $('bd-wa-found').textContent = ''; } });

  document.querySelectorAll('.nav-item[data-view="breakdown"]').forEach(function (n) { n.addEventListener('click', load); });
  if ($('view-breakdown') && $('view-breakdown').style.display !== 'none') load();
})();
