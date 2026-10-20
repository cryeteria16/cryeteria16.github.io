/* ibadhasan.com/work only: the copy never reads the company tracker. Its works list comes from the tracker
   Excel you upload here (Dashboard > Upload tracker); the server side is wcImportTracker in WorkCopy.gs. */
(function () {
  'use strict';
  var acts = document.querySelector('#view-dash .view-actions'); if (!acts) return;
  var say = function (m) { if (typeof toast === 'function') toast(m); };
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm'; btn.id = 'wc-upload'; btn.textContent = '⬆ Upload tracker';
  var pick = document.createElement('input');
  pick.type = 'file'; pick.accept = '.xlsx,.xls,.csv'; pick.hidden = true;
  acts.insertBefore(btn, acts.firstChild); acts.appendChild(pick);
  var note = document.createElement('div');
  note.className = 'view-sub'; note.id = 'wc-tracker-note';
  var sub = document.getElementById('dash-sub'); if (sub && sub.parentNode) sub.parentNode.appendChild(note);

  function show(i) {
    note.textContent = i && i.file ? 'Works from ' + i.file + ', uploaded ' + i.at + ' (' + i.rows + ' rows)' : 'No tracker uploaded yet: use "Upload tracker" with the VW_Tracker Excel file.';
  }
  google.script.run.withSuccessHandler(show).withFailureHandler(function () {}).wcTrackerInfo();

  btn.addEventListener('click', function () { pick.click(); });
  pick.addEventListener('change', function () {
    var f = pick.files && pick.files[0]; pick.value = '';
    if (!f) return;
    if (f.size > 40 * 1024 * 1024) { say('That file is too big (40 MB at most).'); return; }
    btn.disabled = true; btn.textContent = 'Uploading…';
    var r = new FileReader();
    r.onerror = function () { btn.disabled = false; btn.textContent = '⬆ Upload tracker'; say('Could not read ' + f.name); };
    r.onload = function () {
      google.script.run
        .withSuccessHandler(function (i) {
          btn.disabled = false; btn.textContent = '⬆ Upload tracker'; show(i);
          say('Tracker loaded: ' + i.rows + ' rows.');
          var re = document.getElementById('btn-refresh'); if (re) { re.disabled = false; re.click(); }
        })
        .withFailureHandler(function (e) { btn.disabled = false; btn.textContent = '⬆ Upload tracker'; say(e && e.message ? e.message : 'Upload failed.'); })
        .wcImportTracker({ name: f.name, b64: String(r.result).split(',')[1] || '' });
    };
    r.readAsDataURL(f);
  });
})();
