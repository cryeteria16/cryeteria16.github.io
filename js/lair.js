// The Lair talks to two places:
//   EDGE: the always-on helper (sign-in, watchlist, settings, visitors, PC status). Works when the PC is off.
//   TUNNEL_URL: the home PC itself (Vault files, movies, movie search). Only when the PC is on.
import { passkeySupported, registerPasskey, loginWithPasskey } from './passkey.js?v=1';

const EDGE = "https://api.ibadhasan.com";
const TUNNEL_URL = "https://vault.ibadhasan.com";
const CHUNK = 8 * 1024 * 1024; // uploads go in 8 MB pieces (Cloudflare limits each request to 100 MB)

// ================= helpers =================
const $ = (id) => document.getElementById(id);
// Escape text from elsewhere (file names, visitor logs, watchlist) before it goes into HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`;
const fmtBytes = (b) => {
  if (b == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const tz = 'Asia/Dubai';
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

document.addEventListener('click', (e) => { if (navigator.vibrate && e.target.closest('button, .tab')) navigator.vibrate(8); });

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast glass-solid ${type}`;
  const d = document.createElement('span'); d.className = 'dot';
  const s = document.createElement('span'); s.textContent = msg;
  t.append(d, s);
  $('toast-container').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 3200);
}

// ---- overlays: confirm, text prompt, bottom sheet ----
const openOverlay = (el) => { el.classList.add('active'); el.setAttribute('aria-hidden', 'false'); };
const closeOverlay = (el) => { el.classList.remove('active'); el.setAttribute('aria-hidden', 'true'); };
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const id of ['prompt-modal', 'confirm-modal', 'sheet']) if ($(id).classList.contains('active')) { (id === 'sheet' ? closeSheet : () => $(`btn-${id === 'confirm-modal' ? 'confirm' : 'prompt'}-cancel`).click())(); return; }
});

function showConfirm(title, msg, okText = 'Confirm') {
  return new Promise((resolve) => {
    const modal = $('confirm-modal');
    $('confirm-title').textContent = title; $('confirm-msg').textContent = msg; $('btn-confirm-ok').textContent = okText;
    openOverlay(modal);
    const done = (v) => { $('btn-confirm-ok').onclick = null; $('btn-confirm-cancel').onclick = null; closeOverlay(modal); resolve(v); };
    $('btn-confirm-ok').onclick = () => done(true);
    $('btn-confirm-cancel').onclick = () => done(false);
  });
}
function askText(title, value = '', okText = 'OK', placeholder = '') {
  return new Promise((resolve) => {
    const modal = $('prompt-modal'); const input = $('prompt-input');
    $('prompt-title').textContent = title; $('btn-prompt-ok').textContent = okText;
    input.value = value; input.placeholder = placeholder;
    openOverlay(modal);
    setTimeout(() => { input.focus(); input.select(); }, 60);
    const done = (v) => { $('prompt-form').onsubmit = null; $('btn-prompt-cancel').onclick = null; closeOverlay(modal); resolve(v); };
    $('prompt-form').onsubmit = (e) => { e.preventDefault(); done(input.value.trim() || null); };
    $('btn-prompt-cancel').onclick = () => done(null);
  });
}
function openSheet(title, html) {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  openOverlay($('sheet'));
  return $('sheet-body');
}
function closeSheet() { closeOverlay($('sheet')); setTimeout(() => { $('sheet-cancel').textContent = 'Close'; }, 300); }
$('sheet-cancel').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
// Buttons in a sheet: [{ label, icon, danger, run }]
function actionSheet(title, actions) {
  const body = openSheet(title, `<div class="sheet-group">${actions.map((a, i) => `<button class="sheet-btn ${a.danger ? 'danger' : ''}" data-i="${i}">${icon(a.icon)}${esc(a.label)}</button>`).join('')}</div>`);
  body.querySelectorAll('.sheet-btn').forEach(b => b.addEventListener('click', () => { closeSheet(); actions[b.dataset.i].run(); }));
}

// ================= talking to the helper and the PC =================
let memToken = null;
const session = {
  get() { try { return localStorage.getItem('lair.session') || memToken; } catch { return memToken; } },
  set(t) { memToken = t; try { localStorage.setItem('lair.session', t); } catch {} },
  clear() { memToken = null; try { localStorage.removeItem('lair.session'); } catch {} },
};
async function fetchWithAuth(url, options = {}) {
  return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.get() || ''}` } });
}
async function call(base, path, options, offlineMsg) {
  let res;
  try { res = await fetchWithAuth(base + path, options); }
  catch { throw Object.assign(new Error(offlineMsg), { offline: true }); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && booted) signedOut('Please sign in again.');
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status, data });
  return data;
}
const api = (path, options = {}) => call(TUNNEL_URL, path, options, 'Your PC is asleep right now.');
const postJSON = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const edge = (path, options = {}) => call(EDGE, path, options, 'No internet connection.');
const edgeJSON = (method, path, body) => edge(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ================= clock (once a minute, not every second) =================
function tickClock() {
  const now = new Date();
  const t = (zone) => now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
  $('clock-dxb').textContent = t(tz);
  $('clock-pkt').textContent = t('Asia/Karachi');
  $('today-date').textContent = now.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  setTimeout(tickClock, 60000 - (Date.now() % 60000) + 50);
}
tickClock();

// ================= navigation =================
const VIEWS = ['home', 'photos', 'vault', 'theater', 'radar', 'documents'];
const onOpen = {}; // view -> run once when first shown
let current = 'home';
function openView(target) {
  if (!VIEWS.includes(target)) target = 'home';
  current = target;
  document.querySelectorAll('.tab[data-target]').forEach(t => { const on = t.dataset.target === target; t.classList.toggle('active', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${target}`));
  if (onOpen[target]) { const fn = onOpen[target]; delete onOpen[target]; fn(); }
  if (target === 'home') pollStatus();
  if (target === 'radar') loadRadar();
  if (target === 'documents' && docsReady) { renderDates(); loadDocs(); }
  history.replaceState(null, '', target === 'home' ? location.pathname : `#${target}`);
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab[data-target]').forEach(t => t.addEventListener('click', () => openView(t.dataset.target)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => openView(el.dataset.go)));

// ================= sign in (owner only, through the helper) =================
$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('signin-btn'); const err = $('signin-error');
  const username = $('signin-user').value.trim(); const password = $('signin-pass').value;
  if (!username || !password) return;
  btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
  try {
    const res = await fetch(`${EDGE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign-in failed.');
    session.set(data.token);
    $('signin-pass').value = '';
    signedIn();
    offerFaceId();
  } catch (e2) {
    err.textContent = e2.message === 'Failed to fetch' ? 'No internet connection.' : e2.message;
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});

let booted = false;
function signedIn() {
  document.body.classList.remove('signed-out', 'auth-pending');
  if (!booted) { booted = true; boot(); }
}
function signedOut(message = '') {
  session.clear();
  if (booted) { location.reload(); return; }
  $('signin-error').textContent = message;
  document.body.classList.add('signed-out'); document.body.classList.remove('auth-pending');
  showFaceIdIfSetUp();
}

// ---- Face ID ----
// This device remembers that it has Face ID set up for The Lair, so the sign-in screen can lead with it
const FACEID_KEY = 'lair.faceid';
async function showFaceIdIfSetUp() {
  const on = store.get(FACEID_KEY) && await passkeySupported();
  $('faceid-box').hidden = !on;
  $('password-box').hidden = !!on;
  if (!on) $('signin-user').focus({ preventScroll: true });
}
$('btn-show-password').addEventListener('click', () => { $('faceid-box').hidden = true; $('password-box').hidden = false; $('signin-user').focus(); });
$('btn-faceid').addEventListener('click', async () => {
  const btn = $('btn-faceid'); const err = $('signin-error');
  btn.disabled = true; err.textContent = '';
  try {
    const data = await loginWithPasskey();
    session.set(data.token);
    signedIn();
  } catch (e) {
    if (!e.cancelled) err.textContent = e.message;
    if (e.status === 401 && /isn't set up/.test(e.message)) { store.del(FACEID_KEY); showFaceIdIfSetUp(); }
  } finally { btn.disabled = false; }
});
// After a password sign-in on a phone or computer that can do it, offer Face ID once
async function offerFaceId() {
  if (store.get(FACEID_KEY) || store.get('lair.faceidAsked') || !(await passkeySupported())) return;
  store.set('lair.faceidAsked', true);
  const body = openSheet('Use Face ID next time?', `<p class="sheet-note">Sign in with a glance instead of typing your password. Your face never leaves this device.</p>
    <button class="btn btn-primary btn-block" id="faceid-yes">Set up Face ID</button>`);
  $('sheet-cancel').textContent = 'Not now';
  body.querySelector('#faceid-yes').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await registerPasskey(session.get()); store.set(FACEID_KEY, true); closeSheet(); showToast('Face ID is ready. Use it next time you sign in.', 'success'); }
    catch (err) { e.currentTarget.disabled = false; if (!err.cancelled) showToast(err.message, 'error'); }
  });
}
$('btn-signout').addEventListener('click', async () => {
  if (!(await showConfirm('Lock The Lair?', 'You will need your password to come back in on this device.', 'Lock'))) return;
  try { await fetchWithAuth(`${EDGE}/auth/logout`, { method: 'POST' }); } catch {}
  session.clear(); location.reload();
});

function boot() {
  initConfig();
  pollStatus();
  loadRadar();
  loadWatchlist();
  onOpen.vault = initDrive;
  onOpen.theater = initTheater;
  onOpen.photos = initPhotos;
  onOpen.documents = initDocuments;
  loadDates();
  bindLightbox();
  loadMemories();
  const params = new URLSearchParams(location.search);
  const want = location.hash.replace('#', '');
  if (params.get('share') === 'true') { history.replaceState({}, '', location.pathname); openView('vault'); }
  else if (VIEWS.includes(want)) openView(want);
}

// ================= settings from the Settings page =================
async function initConfig() {
  let d;
  try { d = (await edge('/data/config')).value || {}; } catch { return; }
  const banner = $('broadcast-banner');
  banner.textContent = d.broadcast || ''; banner.style.display = d.broadcast ? 'block' : 'none';
  if (d.accentColor && /^#[0-9a-f]{6}$/i.test(d.accentColor)) document.documentElement.style.setProperty('--accent', d.accentColor);
  const f = d.features || {};
  const hide = { vault: f.drop === false, theater: f.theater === false, radar: f.radar === false };
  for (const [v, off] of Object.entries(hide)) {
    const tab = $(`tab-${v}`); if (tab) tab.hidden = off;
    if (v === 'vault') $('tile-vault').hidden = off;
    if (v === 'radar') $('tile-radar').hidden = off;
    if (v === 'theater') $('tile-upnext').hidden = off;
    if (off && current === v) openView('home');
  }
}

// ================= PC status (only while Home is on screen) =================
let statusTimer = null;
let pcOnline = null; // null = not known yet
let lastStatus = null;
async function pollStatus() {
  clearTimeout(statusTimer);
  if (!booted || document.visibilityState !== 'visible') return;
  try {
    const r = await edge('/pc/status');
    lastStatus = r;
    const st = r.status;
    pcOnline = r.online;
    $('pc-dot').className = `dot ${r.online ? 'on' : 'off'}`;
    $('connect-pc-card').hidden = r.paired;
    $('pc-offline-note').hidden = r.online || !r.paired;
    if (!r.paired) {
      $('pc-pill-text').textContent = 'PC not connected';
      $('tile-pc-big').textContent = '--'; $('tile-pc-label').textContent = 'Not connected';
    } else if (!st) {
      $('pc-pill-text').textContent = 'Waiting for PC';
    } else {
      $('pc-pill-text').textContent = r.online ? 'PC online' : 'PC asleep';
      $('pc-offline-text').textContent = `Last seen ${ago(st.lastSeen)}. Files and movies come back when it's on. Everything else works.`;
      if (r.online) { $('tile-pc-big').textContent = `${st.cpu ?? '--'}%`; $('tile-pc-label').textContent = `CPU · RAM ${st.ram ?? '--'}%`; }
      else { $('tile-pc-big').textContent = 'Asleep'; $('tile-pc-label').textContent = `Seen ${ago(st.lastSeen)}`; }
      renderUsage(st.usage);
    }
  } catch (e) {
    if (e.offline) $('pc-pill-text').textContent = 'No internet';
  }
  statusTimer = setTimeout(pollStatus, current === 'home' ? 30000 : 120000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollStatus(); });

function renderUsage(u) {
  if (!u) return;
  const pct = Math.min(100, (u.used / u.quota) * 100);
  const color = pct > 90 ? 'var(--err)' : pct > 75 ? 'var(--warn)' : 'var(--accent)';
  for (const id of ['tile-vault-fill', 'drive-usage-fill']) { $(id).style.width = `${pct.toFixed(1)}%`; $(id).style.background = color; }
  $('tile-vault-big').textContent = fmtBytes(u.used);
  $('tile-vault-label').textContent = `Vault · of ${fmtBytes(u.quota)}`;
  $('drive-usage-text').textContent = `${fmtBytes(u.used)} of ${fmtBytes(u.quota)}${u.counting ? ' (counting…)' : ''}`;
}

function showPcSheet() {
  const r = lastStatus; const st = r?.status;
  if (!r?.paired) return openView('home');
  const up = st?.uptime > 86400 ? `${Math.floor(st.uptime / 86400)} days` : st?.uptime > 3600 ? `${Math.floor(st.uptime / 3600)} hours` : `${Math.floor((st?.uptime || 0) / 60)} min`;
  const rows = [
    ['Status', r.online ? 'Online' : `Asleep · seen ${ago(st?.lastSeen || Date.now())}`],
    ...(r.online && st ? [['CPU', `${st.cpu ?? '--'}%`], ['Memory', `${st.ram ?? '--'}%`], ['Running for', up]] : []),
    ...(st?.usage ? [['Vault', `${fmtBytes(st.usage.used)} of ${fmtBytes(st.usage.quota)}`]] : []),
    ...(st?.usage?.diskFree != null ? [['Free on PC', fmtBytes(st.usage.diskFree)]] : []),
    ['Server version', st?.version || 'unknown'],
  ];
  const log = st?.log?.length ? st.log.map(l => l.replace(/^\S+T(\d\d:\d\d)\S* \[updater\] /, '$1  ')).join('\n') : 'No updates yet.';
  openSheet('Home PC', `<div class="sheet-group">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
    <div class="sheet-group"><div class="kv"><span>Recent updates</span></div><div class="log">${esc(log)}</div></div>`);
}
$('pc-pill').addEventListener('click', showPcSheet);
$('tile-pc').addEventListener('click', showPcSheet);

// Connect PC: the helper gives a one-time code, the PC swaps it for its own key
$('btn-connect-pc').addEventListener('click', async () => {
  const btn = $('btn-connect-pc'); btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    const { code } = await edgeJSON('POST', '/pc/pair-code', {});
    await postJSON('/api/edge/link', { code });
    showToast('PC connected', 'success');
    setTimeout(pollStatus, 4000);
  } catch (e) {
    showToast(e.offline ? 'Your PC needs to be on to connect it.' : e.message, 'error');
  } finally { btn.disabled = false; btn.textContent = 'Connect'; }
});

// ================= Radar =================
async function loadRadar() {
  let visits;
  try { visits = (await edge('/radar')).visits || []; }
  catch { $('radar-cities').textContent = 'Could not load'; $('radar-feed').innerHTML = '<p class="soft pad">Could not load visitors.</p>'; return; }
  const today = dayKey(Date.now());
  const todays = visits.filter(v => dayKey(v.at) === today);
  const cities = [...new Set(todays.map(v => v.city).filter(Boolean))];
  $('radar-today').textContent = todays.length === 1 ? '1 visitor today' : `${todays.length} visitors today`;
  $('radar-cities').textContent = cities.length ? cities.slice(0, 3).join(', ') + (cities.length > 3 ? ` +${cities.length - 3}` : '') : visits.length ? `Last visit ${ago(visits[0].at)}` : 'No visitors yet';

  const feed = $('radar-feed');
  if (!visits.length) { feed.innerHTML = '<p class="soft pad">No visitors yet.</p>'; return; }
  let lastDay = ''; let html = '';
  const yesterday = dayKey(Date.now() - 86400000);
  for (const v of visits.slice(0, 60)) {
    const d = dayKey(v.at);
    if (d !== lastDay) {
      lastDay = d;
      const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(v.at).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
      html += `<div class="r-day">${esc(label)}</div>`;
    }
    const when = new Date(v.at).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    html += `<div class="r-row"><span class="r-flag">${icon('globe')}</span><span class="r-text"><span class="r-place">${esc(v.city || 'Unknown place')}${v.country ? `, ${esc(v.country)}` : ''}</span><span class="tile-label soft">${esc(v.device || v.type || 'Visit')}</span></span><span class="r-when">${esc(when)}</span></div>`;
  }
  feed.innerHTML = html;
}

// ================= VAULT (drive on the PC) =================
let drivePath = store.get('lair.drivePath') || '';
let driveItems = [];
let driveSort = store.get('lair.driveSort') || 'name';
let driveLayout = store.get('lair.driveLayout') || 'list';
let driveQuery = '';
const KIND_ICON = { image: 'image', video: 'film', audio: 'music', pdf: 'doc', text: 'doc', other: 'box' };

function initDrive() {
  $('drive-sort').value = driveSort;
  $('drive-sort').addEventListener('change', (e) => { driveSort = e.target.value; store.set('lair.driveSort', driveSort); renderDrive(); });
  $('drive-search').addEventListener('input', (e) => { driveQuery = e.target.value.trim().toLowerCase(); renderDrive(); });
  $('drive-view-toggle').addEventListener('click', () => { driveLayout = driveLayout === 'list' ? 'grid' : 'list'; store.set('lair.driveLayout', driveLayout); renderDrive(); });
  $('drive-back').addEventListener('click', () => loadDrive(drivePath.split('/').slice(0, -1).join('/')));
  $('drive-add').addEventListener('click', () => {
    if (!drivePath) {
      return actionSheet('Add to the Vault', [
        { label: 'Take a photo or video', icon: 'camera', run: () => $('drive-camera-input').click() },
        { label: 'Open Files to upload', icon: 'folder', run: () => loadDrive('Files') },
        { label: 'Open Photos to upload', icon: 'image', run: () => loadDrive('Photos') },
      ]);
    }
    actionSheet(`Add to ${drivePath.split('/').pop()}`, [
      { label: 'Upload files', icon: 'upload', run: () => $('drive-file-input').click() },
      { label: 'Take a photo or video', icon: 'camera', run: () => $('drive-camera-input').click() },
      { label: 'New folder', icon: 'newfolder', run: newFolder },
    ]);
  });
  $('drive-file-input').addEventListener('change', (e) => { queueUploads([...e.target.files], drivePath); e.target.value = ''; });
  $('drive-camera-input').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
    const ext = (f.name.match(/\.[^.]+$/) || ['.jpg'])[0];
    const dir = drivePath || 'Photos';
    queueUploads([new File([f], `Camera ${stamp}${ext}`, { type: f.type, lastModified: f.lastModified })], dir);
  });

  // Drag and drop on a computer
  const zone = $('view-vault');
  ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, (e) => { if (drivePath && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); zone.classList.add('dragging'); } }));
  ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, (e) => { if (t === 'dragleave' && zone.contains(e.relatedTarget)) return; zone.classList.remove('dragging'); }));
  zone.addEventListener('drop', (e) => { if (!drivePath) return; e.preventDefault(); queueUploads([...e.dataTransfer.files], drivePath); });

  loadDrive();
  resumePendingUploads();
}

async function newFolder() {
  const name = await askText('New folder', '', 'Create', 'Folder name'); if (!name) return;
  try { await postJSON('/api/drive/mkdir', { path: drivePath, name }); loadDrive(); } catch (e) { showToast(e.message, 'error'); }
}

async function loadDrive(path = drivePath) {
  const list = $('drive-list');
  if (path !== drivePath) { driveQuery = ''; $('drive-search').value = ''; }
  if (!driveItems.length) list.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const data = await api(`/api/drive/list?path=${encodeURIComponent(path)}`);
    drivePath = data.path; store.set('lair.drivePath', drivePath);
    driveItems = data.items;
    renderUsage(data.usage);
    renderDrive();
  } catch (e) {
    if (e.status === 404 && path) { drivePath = ''; return loadDrive(''); }
    driveItems = [];
    list.className = 'drive list';
    $('drive-add').disabled = !!e.offline;
    if (e.offline) { $('drive-title').textContent = 'Vault'; $('drive-crumbs').textContent = ''; $('drive-back').hidden = true; $('drive-usage-text').textContent = 'PC asleep'; }
    list.innerHTML = e.offline
      ? `<div class="offline"><span class="tile-icon violet">${icon('moon')}</span><strong>Your PC is asleep</strong><p>Your files live on it, so they come back when it's on. Watchlist and settings still work.</p><button class="btn btn-glass" id="btn-retry-vault">Try again</button></div>`
      : `<p class="empty">${esc(e.message)}</p>`;
    $('btn-retry-vault')?.addEventListener('click', () => loadDrive(path));
  }
}

function sortedItems() {
  let items = [...driveItems];
  if (driveQuery) items = items.filter(i => i.name.toLowerCase().includes(driveQuery));
  if (!drivePath) return items; // top level stays Files, Photos, Movies
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }), new: (a, b) => b.modified - a.modified, size: (a, b) => (b.size || 0) - (a.size || 0) }[driveSort];
  return items.sort((a, b) => (a.type === b.type ? cmp(a, b) : a.type === 'folder' ? -1 : 1));
}

function renderDrive() {
  const parts = drivePath ? drivePath.split('/') : [];
  $('drive-title').textContent = parts.length ? parts[parts.length - 1] : 'Vault';
  $('drive-crumbs').textContent = parts.length > 1 ? `Vault › ${parts.slice(0, -1).join(' › ')}` : parts.length ? 'Vault' : '';
  $('drive-back').hidden = !parts.length;
  $('drive-add').disabled = false;
  const grid = driveLayout === 'grid';
  $('drive-view-toggle').innerHTML = icon(grid ? 'list' : 'grid');
  $('drive-view-toggle').setAttribute('aria-label', grid ? 'Show as list' : 'Show as grid');

  const list = $('drive-list');
  list.className = `drive ${grid ? 'grid' : 'list'}`;
  list.innerHTML = '';
  const items = sortedItems();
  if (!items.length) { list.innerHTML = `<p class="empty">${driveQuery ? 'Nothing matches that search.' : 'This folder is empty. Tap + to add something.'}</p>`; return; }
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const el = document.createElement('div'); el.className = 'item';
    const folder = item.type === 'folder';
    const thumb = item.thumb
      ? `<span class="thumb"><img src="${esc(TUNNEL_URL + item.thumb)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="thumb ${folder ? 'folder' : `k-${esc(item.kind || 'other')}`}">${icon(folder ? 'folder' : KIND_ICON[item.kind] || 'box')}</span>`;
    const meta = folder ? (item.count != null ? `${item.count} items` : 'Folder') : [fmtBytes(item.size), item.modified ? new Date(item.modified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · ');
    el.innerHTML = `
      <button class="item-main" title="${esc(item.name)}">${thumb}<span class="item-text"><span class="item-name">${esc(item.name)}</span><span class="item-meta">${esc(meta)}</span></span></button>
      ${!drivePath ? (grid ? '' : `<span class="item-more" aria-hidden="true">${icon('chev', 'chev')}</span>`) : `<button class="item-more" aria-label="More for ${esc(item.name)}">${icon('more')}</button>`}`;
    el.querySelector('.item-main').addEventListener('click', () => openItem(item));
    if (drivePath) el.querySelector('button.item-more').addEventListener('click', () => showActions(item));
    el.querySelector('img')?.addEventListener('error', (e) => { e.target.parentElement.className = `thumb k-${item.kind || 'image'}`; e.target.replaceWith(Object.assign(document.createElement('span'), { innerHTML: icon('image') }).firstChild); });
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function openItem(item) {
  if (item.type === 'folder') return loadDrive(item.path);
  if (item.preview) return openLightbox(item);
  if (item.kind === 'video' || item.kind === 'audio') { openView('theater'); return playInTheater(TUNNEL_URL + item.url, item.name); }
  if (item.kind === 'pdf' || item.kind === 'text' || item.kind === 'image') return window.open(TUNNEL_URL + item.url, '_blank', 'noopener');
  downloadItem(item);
}
function downloadItem(item) {
  const a = document.createElement('a'); a.href = TUNNEL_URL + item.download; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
const inPhotosRoot = (item) => item.path.startsWith('Photos/') && item.kind === 'image';

function showActions(item) {
  const acts = [{ label: 'Open', icon: item.type === 'folder' ? 'folder' : 'image', run: () => openItem(item) }];
  if (item.type === 'file') acts.push({ label: 'Download original', icon: 'upload', run: () => downloadItem(item) });
  acts.push({ label: 'Rename', icon: 'doc', run: () => renameItem(item) });
  acts.push({ label: 'Delete', icon: 'x', danger: true, run: () => deleteItem(item) });
  actionSheet(item.name, acts);
}
async function renameItem(item) {
  const name = await askText('Rename', item.name, 'Rename'); if (!name || name === item.name) return;
  try { await postJSON('/api/drive/rename', { path: item.path, name }); showToast('Renamed', 'success'); loadDrive(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function deleteItem(item, after = () => loadDrive()) {
  const what = item.type === 'folder' ? 'this folder and everything in it' : 'this file';
  if (!(await showConfirm(`Delete ${item.name}?`, `This moves ${what} to the recycle bin on your PC. It is emptied after 30 days.`, 'Delete'))) return false;
  try { await postJSON('/api/drive/delete', { path: item.path }); showToast('Moved to the recycle bin', 'success'); after(); return true; }
  catch (e) { showToast(e.message, 'error'); return false; }
}

// ---- photo viewer: shows a phone-sized preview; the original only on request ----
let lbList = []; let lbIndex = 0; let lbSource = 'vault';
function bindLightbox() {
  $('lb-close').addEventListener('click', closeLightbox);
  $('lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('lb-next').addEventListener('click', () => stepLightbox(1));
  document.addEventListener('keydown', (e) => {
    if (!$('photo-lightbox').classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') stepLightbox(-1); if (e.key === 'ArrowRight') stepLightbox(1);
  });
  let lbX = 0; let lbY = 0;
  const stage = document.querySelector('.lb-stage');
  stage.addEventListener('touchstart', (e) => { lbX = e.changedTouches[0].screenX; lbY = e.changedTouches[0].screenY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const dx = lbX - e.changedTouches[0].screenX; const dy = e.changedTouches[0].screenY - lbY;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return closeLightbox(); // swipe down to close
    if (Math.abs(dx) > 50) stepLightbox(dx > 0 ? 1 : -1);
  }, { passive: true });

}
// list: the photos to swipe through (defaults to the open Vault folder); source 'photos' adds Favourite and Album
function openLightbox(item, list, source = 'vault') {
  lbSource = source;
  lbList = (list || sortedItems()).filter(i => i.preview);
  lbIndex = Math.max(0, lbList.findIndex(i => i.path === item.path));
  showLightboxItem();
  openOverlay($('photo-lightbox'));
}
function closeLightbox() { closeOverlay($('photo-lightbox')); $('lightbox-img').removeAttribute('src'); }
function stepLightbox(d) { if (!lbList.length) return; lbIndex = (lbIndex + d + lbList.length) % lbList.length; showLightboxItem(); }
function showLightboxItem() {
  const item = lbList[lbIndex]; if (!item) return closeLightbox();
  $('lightbox-img').src = TUNNEL_URL + item.preview;
  $('lightbox-img').alt = item.name;
  $('lightbox-name').textContent = `${item.name} · ${fmtBytes(item.size)}`;
  $('lb-prev').style.visibility = $('lb-next').style.visibility = lbList.length > 1 ? 'visible' : 'hidden';
  $('lb-original').onclick = () => window.open(TUNNEL_URL + item.url, '_blank', 'noopener');
  $('lb-delete').onclick = async () => {
    if (!(await deleteItem(item, lbSource === 'photos' ? () => photosRemoved([item.path]) : undefined))) return;
    lbList.splice(lbIndex, 1);
    if (!lbList.length) return closeLightbox();
    lbIndex = Math.min(lbIndex, lbList.length - 1); showLightboxItem();
  };
  const fav = $('lb-fav'); const alb = $('lb-album');
  fav.hidden = alb.hidden = lbSource !== 'photos';
  if (lbSource === 'photos') {
    const paintFav = () => { fav.classList.toggle('on', !!item.fav); fav.classList.add('fav-btn'); fav.querySelector('span').textContent = item.fav ? 'Loved' : 'Favourite'; };
    paintFav();
    fav.onclick = async () => { fav.disabled = true; try { await setFavourite([item], !item.fav); paintFav(); } catch (e) { showToast(e.message, 'error'); } fav.disabled = false; };
    alb.onclick = () => pickAlbum([item]);
  }
  const ex = $('lb-exhibit');
  ex.hidden = !inPhotosRoot(item);
  if (ex.hidden) return;
  const paint = (on) => { ex.classList.toggle('on', on); ex.querySelector('span').textContent = on ? 'On homepage' : 'Homepage'; ex.dataset.on = on ? '1' : ''; };
  paint(false);
  exhibitionIds().then(ids => { if (lbList[lbIndex] === item) paint(ids.has(item.name)); });
  ex.onclick = async () => {
    ex.disabled = true;
    try {
      if (ex.dataset.on) { await edge(`/exhibition/${encodeURIComponent(item.name)}`, { method: 'DELETE' }); paint(false); showToast('Removed from the homepage'); }
      else { await postJSON('/api/exhibition/add', { path: item.path }); paint(true); showToast('On the homepage now', 'success'); }
      exhibitionCache = null;
    } catch (e) { showToast(e.message, 'error'); }
    ex.disabled = false;
  };
}
let exhibitionCache = null;
function exhibitionIds() {
  if (!exhibitionCache) exhibitionCache = edge('/exhibition').then(r => new Set(r.items.map(i => i.id))).catch(() => new Set());
  return exhibitionCache;
}

// ---- uploads: 8 MB pieces, resume after a dropped connection or a reload ----
const uploads = []; let uploading = false;
const BACKUP = '__backup__'; // the special "Back up" destination: the PC files these into Photos/iPhone/YYYY-MM
const fileKey = (f, dir) => `lair.up.${dir}|${f.name}|${f.size}|${f.lastModified}`;
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

function queueUploads(files, dir) {
  if (!files.length) return;
  for (const f of files) uploads.push({ file: f, dir, sent: 0, state: 'waiting' });
  renderQueue(); runUploads();
}
function renderQueue() {
  const box = $('upload-queue');
  const active = uploads.filter(u => u.state !== 'done' || Date.now() - u.doneAt < 4000);
  box.hidden = !active.length;
  box.innerHTML = active.map(u => {
    const pct = u.file.size ? Math.floor((u.sent / u.file.size) * 100) : 100;
    const label = u.state === 'done' ? 'Done' : u.state === 'error' ? esc(u.error) : u.state === 'waiting' ? 'Waiting' : u.state === 'retry' ? 'Reconnecting…' : `${pct}%`;
    return `<div class="up-row ${u.state}"><div class="up-text"><span class="up-name">${esc(u.file.name)}</span><span>${label}</span></div><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
}
async function runUploads() {
  if (uploading) return; uploading = true;
  let next;
  while ((next = uploads.find(u => u.state === 'waiting'))) {
    await uploadOne(next);
    renderQueue();
    if (next.state === 'done' && next.dir === drivePath) loadDrive();
  }
  uploading = false;
  backupFinished();
  setTimeout(renderQueue, 4200);
}
async function uploadOne(u) {
  const key = fileKey(u.file, u.dir);
  const saved = store.get(key);
  const id = saved?.id || newId();
  store.set(key, { id, dir: u.dir, name: u.file.name, size: u.file.size });
  u.state = 'sending'; renderQueue();
  try {
    if (saved) u.sent = (await api(`/api/drive/upload-status?id=${id}`)).received || 0;
    let tries = 0;
    while (true) {
      const end = Math.min(u.sent + CHUNK, u.file.size);
      const qs = `id=${id}&dir=${encodeURIComponent(u.dir)}&name=${encodeURIComponent(u.file.name)}&size=${u.file.size}&offset=${u.sent}${u.dir === BACKUP ? `&backup=1&taken=${u.file.lastModified || ''}` : ''}`;
      try {
        const res = await fetchWithAuth(`${TUNNEL_URL}/api/drive/upload?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: u.file.slice(u.sent, end) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof data.received === 'number') { u.sent = data.received; continue; }
        if (!res.ok) throw Object.assign(new Error(data.error || `Upload refused (${res.status})`), { fatal: true });
        u.sent = data.received; tries = 0; u.state = 'sending'; renderQueue();
        if (data.done) { u.duplicate = !!data.duplicate; break; }
      } catch (e) {
        if (e.fatal || ++tries > 6) throw e;
        u.state = 'retry'; renderQueue();
        await new Promise(r => setTimeout(r, Math.min(30000, 1500 * 2 ** tries)));
        try { u.sent = (await api(`/api/drive/upload-status?id=${id}`)).received || 0; } catch {}
      }
    }
    u.state = 'done'; u.doneAt = Date.now(); store.del(key);
  } catch (e) {
    u.state = 'error'; u.error = e.message || 'Upload failed';
    if (e.fatal) store.del(key);
  }
}
function resumePendingUploads() {
  const pending = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('lair.up.')) pending.push(store.get(k)); } } catch {}
  if (pending.length) showToast(`${pending.length} upload${pending.length > 1 ? 's were' : ' was'} interrupted. Choose the same file${pending.length > 1 ? 's' : ''} again to carry on where ${pending.length > 1 ? 'they' : 'it'} stopped.`);
}

// ================= PHOTOS =================
// Library (newest first, by the date each photo was taken), Albums, Favourites, On this day,
// and Back up from this phone. All of it lives on the PC; only small previews come down.
let phView = 'all';          // 'all' | 'favs' | 'album:<id>'
let phSeg = 'all';           // which tab of the switch: all | albums | favs
let phItems = [];            // what's shown, in order
let phNext = null; let phLoading = false; let phTotal = 0;
let phAlbum = null;          // { id, name } when an album is open
let selecting = false; const selected = new Set();
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const takenLabel = (t) => { if (!t) return ''; const [y, m, d] = t.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

function initPhotos() {
  document.querySelectorAll('#photos-seg .seg').forEach(b => b.addEventListener('click', () => setSeg(b.dataset.seg)));
  $('photos-select').addEventListener('click', () => setSelecting(!selecting));
  $('album-back').addEventListener('click', () => setSeg('albums'));
  $('album-menu').addEventListener('click', albumMenu);
  $('photos-backup').addEventListener('click', () => $('backup-input').click());
  $('backup-input').addEventListener('change', (e) => { startBackup([...e.target.files]); e.target.value = ''; });
  $('sel-fav').addEventListener('click', async () => { const items = selItems(); if (!items.length) return; const on = !items.every(i => i.fav); try { await setFavourite(items, on); showToast(on ? 'Added to Favourites' : 'Removed from Favourites', 'success'); setSelecting(false); } catch (e) { showToast(e.message, 'error'); } });
  $('sel-album').addEventListener('click', () => { const items = selItems(); if (items.length) pickAlbum(items, () => setSelecting(false)); });
  $('sel-delete').addEventListener('click', deleteSelected);
  // Load more as you scroll near the bottom
  new IntersectionObserver((es) => { if (es[0].isIntersecting && phNext && !phLoading && current === 'photos') loadPhotos(true); }, { rootMargin: '600px' }).observe($('photos-more'));
  setSeg('all');
}

function setSeg(seg) {
  phSeg = seg; phAlbum = null;
  document.querySelectorAll('#photos-seg .seg').forEach(b => { const on = b.dataset.seg === seg; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  $('photos-seg').hidden = false; $('album-back').hidden = true; $('album-menu').hidden = true;
  $('photos-title').textContent = 'Photos';
  setSelecting(false);
  if (seg === 'albums') { $('photos-grid').hidden = true; $('albums-grid').hidden = false; $('photos-memories').hidden = true; $('photos-select').hidden = true; $('photos-sub').textContent = ''; loadAlbums(); return; }
  $('photos-grid').hidden = false; $('albums-grid').hidden = true; $('photos-select').hidden = false;
  phView = seg; loadPhotos(false);
  if (seg === 'all') loadMemories(); else $('photos-memories').hidden = true;
}

function openAlbum(a) {
  phSeg = 'albums'; phAlbum = { id: a.id, name: a.name }; phView = `album:${a.id}`;
  $('photos-seg').hidden = true; $('album-back').hidden = false; $('album-menu').hidden = false; $('photos-select').hidden = false;
  $('photos-title').textContent = a.name;
  $('photos-grid').hidden = false; $('albums-grid').hidden = true; $('photos-memories').hidden = true;
  setSelecting(false); loadPhotos(false); window.scrollTo(0, 0);
}

async function loadPhotos(more) {
  const grid = $('photos-grid');
  if (!more) { phItems = []; phNext = null; grid.innerHTML = '<p class="ph-empty">Loading…</p>'; }
  phLoading = true;
  try {
    const q = new URLSearchParams({ view: phView, limit: '120' }); if (more && phNext) q.set('before', phNext);
    const data = await api(`/api/photos/list?${q}`);
    if (!Array.isArray(data.items)) data.items = [];
    phNext = data.next || null; phTotal = Number(data.total) || 0;
    if (!more) grid.innerHTML = '';
    appendPhotos(data.items);
    phItems.push(...data.items);
    const count = `${phTotal.toLocaleString()} ${phTotal === 1 ? 'item' : 'items'}`;
    $('photos-sub').textContent = phTotal ? count + (data.scanning ? ' · still reading dates…' : '') : '';
    if (!phItems.length) grid.innerHTML = emptyPhotos();
  } catch (e) {
    if (!more) grid.innerHTML = e.offline
      ? `<div class="ph-empty"><span class="tile-icon violet">${icon('moon')}</span><strong>Your PC is asleep</strong>Your photos live on it, so they come back when it's on.<br><button class="btn btn-glass" id="ph-retry">Try again</button></div>`
      : `<p class="ph-empty">${esc(e.message)}</p>`;
    $('ph-retry')?.addEventListener('click', () => loadPhotos(false));
    $('photos-sub').textContent = '';
  } finally { phLoading = false; }
}
function emptyPhotos() {
  if (phView === 'favs') return `<div class="ph-empty"><span class="tile-icon rose">${icon('heart')}</span><strong>No favourites yet</strong>Tap the heart on a photo to keep it here.</div>`;
  if (phAlbum) return `<div class="ph-empty"><span class="tile-icon blue">${icon('album')}</span><strong>This album is empty</strong>Go to Library, tap Select, choose photos, then the album button.</div>`;
  return `<div class="ph-empty"><span class="tile-icon teal">${icon('photos')}</span><strong>No photos yet</strong>Back up photos from this phone, or put them in Photos on your PC.<br><button class="btn btn-primary" onclick="document.getElementById('backup-input').click()">Back up from this phone</button></div>`;
}
function appendPhotos(items) {
  const grid = $('photos-grid');
  let monthGrid = grid.lastElementChild?.classList.contains('ph-grid') ? grid.lastElementChild : null;
  let curMonth = monthGrid?.dataset.month || '';
  const frag = document.createDocumentFragment();
  for (const it of items) {
    const ym = (it.taken || '').slice(0, 7);
    if (ym !== curMonth || !monthGrid) {
      curMonth = ym;
      const h = document.createElement('h2'); h.className = 'ph-month'; h.textContent = ym ? monthName(ym) : 'Undated';
      monthGrid = document.createElement('div'); monthGrid.className = 'ph-grid'; monthGrid.dataset.month = ym;
      frag.append(h, monthGrid);
    }
    monthGrid.appendChild(photoTile(it));
    if (!monthGrid.isConnected && !frag.contains(monthGrid)) frag.appendChild(monthGrid);
  }
  grid.appendChild(frag);
}
function photoTile(it) {
  const b = document.createElement('button');
  b.className = `ph${selected.has(it.path) ? ' sel' : ''}`; b.dataset.path = it.path;
  b.setAttribute('aria-label', `${it.kind === 'video' ? 'Video' : 'Photo'}, ${takenLabel(it.taken)}`);
  b.innerHTML = (it.thumb ? `<img src="${esc(TUNNEL_URL + it.thumb)}" alt="" loading="lazy" decoding="async">` : `<span class="ph-vid">${icon(it.kind === 'video' ? 'film' : 'image')}</span>`)
    + (it.fav ? `<svg class="ph-fav" aria-hidden="true"><use href="#i-heart"/></svg>` : '')
    + (it.kind === 'video' && it.thumb ? `<span class="ph-badge">Video</span>` : '')
    + `<span class="ph-check" aria-hidden="true">${icon('check')}</span>`;
  b.addEventListener('click', () => {
    if (selecting) { toggleSelect(it.path, b); return; }
    if (it.kind === 'video') { openView('theater'); playInTheater(TUNNEL_URL + it.url, it.name); return; }
    openLightbox(it, phItems, 'photos');
  });
  return b;
}
function refreshTile(it) {
  const old = document.querySelector(`.ph[data-path="${CSS.escape(it.path)}"]`);
  if (old) old.replaceWith(photoTile(it));
}
function photosRemoved(paths) {
  const gone = new Set(paths);
  phItems = phItems.filter(i => !gone.has(i.path));
  paths.forEach(p => document.querySelector(`.ph[data-path="${CSS.escape(p)}"]`)?.remove());
  document.querySelectorAll('.ph-grid').forEach(g => { if (!g.children.length) { g.previousElementSibling?.remove(); g.remove(); } });
  phTotal = Math.max(0, phTotal - paths.length);
  $('photos-sub').textContent = phTotal ? `${phTotal.toLocaleString()} items` : '';
  if (!phItems.length) $('photos-grid').innerHTML = emptyPhotos();
}

// ---- selecting several ----
function setSelecting(on) {
  selecting = on; selected.clear();
  document.querySelectorAll('.ph.sel').forEach(el => el.classList.remove('sel'));
  $('photos-grid').classList.toggle('selecting', on);
  document.body.classList.toggle('selecting-photos', on);
  $('select-bar').hidden = !on;
  $('photos-select').textContent = on ? 'Cancel' : 'Select';
  $('photos-select').classList.toggle('on', on);
  paintSelectBar();
}
function toggleSelect(p, el) { selected.has(p) ? selected.delete(p) : selected.add(p); el.classList.toggle('sel', selected.has(p)); paintSelectBar(); }
function paintSelectBar() {
  const n = selected.size;
  $('select-count').textContent = n ? `${n} selected` : 'Tap photos to select';
  ['sel-fav', 'sel-album', 'sel-delete'].forEach(id => { $(id).disabled = !n; });
}
const selItems = () => phItems.filter(i => selected.has(i.path));
async function deleteSelected() {
  const items = selItems(); if (!items.length) return;
  if (!(await showConfirm(`Delete ${items.length} ${items.length === 1 ? 'item' : 'items'}?`, 'They move to the recycle bin on your PC and are emptied after 30 days.', 'Delete'))) return;
  const done = [];
  for (const it of items) { try { await postJSON('/api/drive/delete', { path: it.path }); done.push(it.path); } catch {} }
  photosRemoved(done); setSelecting(false);
  showToast(done.length === items.length ? 'Moved to the recycle bin' : `${done.length} of ${items.length} deleted`, done.length === items.length ? 'success' : 'error');
}

// ---- favourites and albums ----
async function setFavourite(items, on) {
  await postJSON('/api/photos/favourite', { paths: items.map(i => i.path), on });
  for (const it of items) { it.fav = on; refreshTile(it); }
  if (phView === 'favs' && !on) photosRemoved(items.map(i => i.path));
}
async function pickAlbum(items, after = () => {}) {
  let albums = [];
  try { albums = (await api('/api/photos/albums')).albums; } catch (e) { return showToast(e.message, 'error'); }
  const body = openSheet(items.length === 1 ? 'Add to album' : `Add ${items.length} to album`, `<div class="sheet-group album-pick">
    <button class="sheet-btn" data-new="1">${icon('plus')}New album…</button>
    ${albums.map(a => `<button class="sheet-btn" data-id="${esc(a.id)}">${a.cover ? `<span class="thumb"><img src="${esc(TUNNEL_URL + a.cover)}" alt=""></span>` : icon('album')}<span>${esc(a.name)}</span><span class="soft" style="margin-left:auto">${a.count}</span></button>`).join('')}
  </div>`);
  body.querySelectorAll('.sheet-btn').forEach(b => b.addEventListener('click', async () => {
    closeSheet();
    const paths = items.map(i => i.path);
    try {
      if (b.dataset.new) {
        const name = await askText('New album', '', 'Create', 'Album name'); if (!name) return;
        await postJSON('/api/photos/albums', { name, paths }); showToast(`Added to ${name}`, 'success');
      } else {
        await postJSON(`/api/photos/albums/${b.dataset.id}/add`, { paths });
        showToast(`Added to ${albums.find(a => a.id === b.dataset.id)?.name || 'album'}`, 'success');
      }
      after();
    } catch (e) { showToast(e.message, 'error'); }
  }));
}
async function loadAlbums() {
  const box = $('albums-grid');
  box.innerHTML = '<p class="ph-empty" style="grid-column:1/-1">Loading…</p>';
  let data;
  try { data = await api('/api/photos/albums'); }
  catch (e) { box.innerHTML = `<p class="ph-empty" style="grid-column:1/-1">${esc(e.offline ? 'Your PC is asleep. Albums come back when it is on.' : e.message)}</p>`; return; }
  const card = (cover, name, count, attrs, extra = '') => `<button class="album" ${attrs}><span class="album-cover ${extra}">${cover ? `<img src="${esc(TUNNEL_URL + cover)}" alt="" loading="lazy">` : icon(extra === 'new' ? 'plus' : 'album')}</span><span class="album-name">${esc(name)}</span><span class="album-count">${esc(count)}</span></button>`;
  box.innerHTML = card(data.favourites.cover, 'Favourites', `${data.favourites.count}`, 'data-favs="1"')
    + data.albums.map(a => card(a.cover, a.name, `${a.count}`, `data-id="${esc(a.id)}"`)).join('')
    + card(null, 'New album', '', 'data-new="1"', 'new');
  box.querySelectorAll('.album').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.favs) return setSeg('favs');
    if (b.dataset.new) {
      const name = await askText('New album', '', 'Create', 'Album name'); if (!name) return;
      try { await postJSON('/api/photos/albums', { name }); loadAlbums(); } catch (e) { showToast(e.message, 'error'); }
      return;
    }
    openAlbum(data.albums.find(a => a.id === b.dataset.id));
  }));
}
function albumMenu() {
  if (!phAlbum) return;
  actionSheet(phAlbum.name, [
    { label: 'Rename album', icon: 'doc', run: async () => {
      const name = await askText('Rename album', phAlbum.name, 'Rename'); if (!name) return;
      try { await postJSON(`/api/photos/albums/${phAlbum.id}/rename`, { name }); phAlbum.name = name; $('photos-title').textContent = name; } catch (e) { showToast(e.message, 'error'); }
    } },
    ...(selecting && selected.size ? [{ label: `Remove ${selected.size} from album`, icon: 'x', run: async () => {
      const paths = [...selected];
      try { await postJSON(`/api/photos/albums/${phAlbum.id}/remove`, { paths }); photosRemoved(paths); setSelecting(false); } catch (e) { showToast(e.message, 'error'); }
    } }] : []),
    { label: 'Delete album', icon: 'x', danger: true, run: async () => {
      if (!(await showConfirm(`Delete "${phAlbum.name}"?`, 'Only the album goes. The photos stay in your library.', 'Delete album'))) return;
      try { await apiDelete(`/api/photos/albums/${phAlbum.id}`); setSeg('albums'); } catch (e) { showToast(e.message, 'error'); }
    } },
  ]);
}
const apiDelete = (path) => api(path, { method: 'DELETE' });

// ---- On this day ----
async function loadMemories() {
  let data;
  try { data = await api('/api/photos/memories'); } catch { $('home-memories').hidden = true; $('photos-memories').hidden = true; return; }
  data.items = Array.isArray(data.items) ? data.items : []; data.years = Array.isArray(data.years) ? data.years : [];
  const has = data.items.length > 0;
  const yrNow = Number(new Date().toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 4));
  const sub = data.years.map(y => { const n = yrNow - Number(y); return n === 1 ? '1 year ago' : `${n} years ago`; }).slice(0, 3).join(' · ');
  for (const pre of ['home', 'photos']) {
    const card = $(`${pre}-memories`);
    card.hidden = !has || (pre === 'photos' && phView !== 'all');
    if (!has) continue;
    $(`${pre}-memories-sub`).textContent = sub;
    const strip = $(`${pre}-memories-strip`); strip.innerHTML = '';
    data.items.slice(0, 12).forEach(it => {
      const b = document.createElement('button'); b.className = 'mem'; b.setAttribute('aria-label', `Photo from ${takenLabel(it.taken)}`);
      b.innerHTML = `<img src="${esc(TUNNEL_URL + it.thumb)}" alt="" loading="lazy"><span>${esc(it.taken.slice(0, 4))}</span>`;
      b.addEventListener('click', () => openLightbox(it, data.items, 'photos'));
      strip.appendChild(b);
    });
  }
}

// ---- Back up from this phone (only when you tap it) ----
let backupRun = null;
async function startBackup(files) {
  if (!files.length) return;
  let have = [];
  try { have = (await postJSON('/api/photos/backup/check', { files: files.map(f => ({ name: f.name, size: f.size })) })).have; }
  catch (e) { return showToast(e.offline ? 'Your PC needs to be on to back up.' : e.message, 'error'); }
  const fresh = files.filter((f, i) => !have[i]);
  const skipped = files.length - fresh.length;
  if (!fresh.length) return showToast(files.length === 1 ? 'That one is already backed up.' : `All ${files.length} are already backed up.`, 'success');
  backupRun = { skipped, items: fresh.length };
  showToast(`Backing up ${fresh.length} ${fresh.length === 1 ? 'item' : 'items'}${skipped ? ` (${skipped} already there)` : ''}`);
  queueUploads(fresh, BACKUP);
}
function backupFinished() {
  if (!backupRun) return;
  const mine = uploads.filter(u => u.dir === BACKUP);
  if (mine.some(u => u.state === 'waiting' || u.state === 'sending' || u.state === 'retry')) return;
  const ok = mine.filter(u => u.state === 'done' && !u.duplicate).length;
  const dup = mine.filter(u => u.duplicate).length + backupRun.skipped;
  const failed = mine.filter(u => u.state === 'error').length;
  showToast(`Backed up ${ok}${dup ? ` · ${dup} already there` : ''}${failed ? ` · ${failed} failed` : ''}`, failed ? 'error' : 'success');
  for (let i = uploads.length - 1; i >= 0; i--) if (uploads[i].dir === BACKUP && uploads[i].state !== 'error') uploads.splice(i, 1);
  backupRun = null;
  if (current === 'photos' && phSeg === 'all') loadPhotos(false);
}

// ================= DOCUMENTS =================
// Scans become PDFs on your PC, search reads the text inside them, and the important dates live in the helper (so they show even when the PC is off).
const DOC_PRESETS = ['Emirates ID', 'Passport', 'Residence visa', 'Driving licence', 'Car registration', 'Car insurance', 'Health insurance', 'Tenancy (Ejari)'];
const ymdMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const daysUntil = (ymd) => Math.round((ymdMs(ymd) - ymdMs(dayKey(Date.now()))) / 86400000);
const longDate = (ymd) => new Date(ymdMs(ymd)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function dueText(n) {
  const plural = (v, w) => `${v} ${w}${v === 1 ? '' : 's'}`;
  if (n < 0) return `${plural(-n, 'day')} ago`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n <= 60) return `in ${n} days`;
  const months = Math.round(n / 30.4);
  if (months < 24) return `in ${plural(months, 'month')}`;
  return `in ${Math.round(n / 365.25 * 10) / 10} years`;
}
const dueTone = (n) => (n <= 30 ? 'bad' : n <= 90 ? 'warn' : 'ok');

let dateItems = null; // null until loaded from the helper
async function loadDates() {
  try { dateItems = ((await edge('/data/docdates')).value?.items || []).filter(x => x && x.date && x.label); }
  catch { if (dateItems === null) dateItems = []; }
  renderHomeDates(); renderDates();
}
async function saveDates() { await edgeJSON('PUT', '/data/docdates', { value: { items: dateItems } }); renderHomeDates(); renderDates(); }
const sortedDates = () => [...(dateItems || [])].sort((a, b) => a.date.localeCompare(b.date));
const dateRow = (it, tag = 'button') => { const n = daysUntil(it.date); return `<${tag} class="r-row date-row" data-id="${esc(it.id)}"><span class="r-flag amber">${icon('doc')}</span><span class="r-text"><span class="r-place">${esc(it.label)}</span><span class="r-when">${n < 0 ? 'Expired ' : 'Expires '}${esc(longDate(it.date))}</span></span><span class="due ${dueTone(n)}">${esc(dueText(n))}</span></${tag}>`; };
function renderHomeDates() {
  const soon = sortedDates().filter(x => daysUntil(x.date) <= 180);
  $('home-dates').hidden = !soon.length;
  if (!soon.length) return;
  $('home-dates-list').innerHTML = soon.slice(0, 4).map(x => dateRow(x)).join('') + (soon.length > 4 ? `<p class="soft more-note">and ${soon.length - 4} more</p>` : '');
  $('home-dates-list').querySelectorAll('.date-row').forEach(b => b.addEventListener('click', () => openView('documents')));
}
function renderDates() {
  const box = $('dates-list'); if (!box) return;
  const items = sortedDates();
  if (!items.length) { box.innerHTML = '<p class="soft pad">Add your Emirates ID, passport, visa and car dates. They show on Home when they get close.</p>'; return; }
  box.innerHTML = items.map(x => dateRow(x)).join('');
  box.querySelectorAll('.date-row').forEach(b => b.addEventListener('click', () => dateSheet(dateItems.find(x => x.id === b.dataset.id))));
}
function dateSheet(existing, preset = {}) {
  const it = existing || {};
  const body = openSheet(existing ? 'Edit date' : 'Add a date', `
    <label class="field"><span>What</span><input id="dt-label" type="text" maxlength="60" placeholder="Emirates ID" value="${esc(it.label || preset.label || '')}"></label>
    <div class="chips" id="dt-presets">${DOC_PRESETS.map(p => `<button type="button" class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <label class="field"><span>Expires on</span><input id="dt-date" type="date" value="${esc(it.date || preset.date || '')}"></label>
    <button class="btn btn-primary btn-block" id="dt-save">Save</button>
    ${existing ? '<button class="btn btn-glass btn-block danger-text" id="dt-del">Remove</button>' : ''}`);
  body.querySelectorAll('#dt-presets .chip').forEach(c => c.addEventListener('click', () => { $('dt-label').value = c.dataset.p; }));
  $('dt-save').addEventListener('click', async () => {
    const label = $('dt-label').value.trim(); const date = $('dt-date').value;
    if (!label) return showToast('Add a name, like Passport.', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || +date.slice(0, 4) < 2000 || +date.slice(0, 4) > 2100) return showToast('Pick the expiry date.', 'error');
    const before = dateItems;
    dateItems = existing ? dateItems.map(x => x.id === existing.id ? { ...x, label, date } : x) : [...(dateItems || []), { id: newId(), label, date, ...(preset.doc ? { doc: preset.doc } : {}) }];
    try { await saveDates(); closeSheet(); showToast('Saved', 'success'); }
    catch (e) { dateItems = before; showToast(e.message, 'error'); }
  });
  $('dt-del')?.addEventListener('click', async () => {
    if (!(await showConfirm(`Remove ${existing.label}?`, 'This only removes the reminder. Your document stays where it is.', 'Remove'))) return;
    const before = dateItems; dateItems = dateItems.filter(x => x.id !== existing.id);
    try { await saveDates(); closeSheet(); } catch (e) { dateItems = before; showToast(e.message, 'error'); }
  });
}

let docs = []; let docsQuery = ''; let docsSeq = 0; let docsPollTimer = null; let docsReady = false;
function initDocuments() {
  $('docs-scan').addEventListener('click', () => scanSheet());
  $('dates-add').addEventListener('click', () => dateSheet(null));
  let t = null;
  $('docs-search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { docsQuery = e.target.value.trim(); loadDocs(); }, 350); });
  $('docs-search-form').addEventListener('submit', (e) => { e.preventDefault(); $('docs-search').blur(); clearTimeout(t); docsQuery = $('docs-search').value.trim(); loadDocs(); });
  $('scan-camera').addEventListener('change', (e) => addScanPages([...e.target.files], e.target));
  $('scan-library').addEventListener('change', (e) => addScanPages([...e.target.files], e.target));
  docsReady = true;
  renderDates(); loadDocs();
}
async function loadDocs() {
  const seq = ++docsSeq; const q = docsQuery;
  clearTimeout(docsPollTimer);
  $('docs-dates-block').hidden = !!q;
  $('docs-list-title').textContent = q ? 'Results' : 'Documents';
  let d;
  try { d = await api(q ? `/api/docs/search?q=${encodeURIComponent(q)}` : '/api/docs/list'); }
  catch (e) { if (seq === docsSeq) { $('docs-status').textContent = ''; $('docs-list').innerHTML = `<p class="empty">${e.offline ? 'Your PC is asleep. Documents come back when it is on. Your important dates still work.' : esc(e.message)}</p>`; } return; }
  if (seq !== docsSeq) return;
  docs = d.items || [];
  if (!q) $('docs-sub').textContent = docs.length ? `${d.total ?? docs.length} ${docs.length === 1 ? 'document' : 'documents'} · scan and search` : 'Scan, search and keep track of dates';
  $('docs-status').textContent = d.pending ? `Reading ${d.pending}…` : '';
  renderDocs(q);
  if (d.pending) docsPollTimer = setTimeout(() => { if (current === 'documents') loadDocs(); }, 4000); // while text is being read
}
const DOC_ICON = { pdf: 'doc', image: 'image', text: 'doc' };
function renderDocs(q) {
  const list = $('docs-list');
  if (!docs.length) { list.innerHTML = `<p class="empty">${q ? 'Nothing found. Scans take a moment before they can be searched.' : 'No documents yet. Tap the camera to scan one, or put files in Vault › Documents.'}</p>`; return; }
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  docs.forEach(item => {
    const el = document.createElement('div'); el.className = 'item';
    const thumb = item.thumb ? `<span class="thumb"><img src="${esc(TUNNEL_URL + item.thumb)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="thumb k-${esc(item.docKind === 'image' ? 'image' : item.docKind === 'pdf' ? 'pdf' : 'text')}">${icon(DOC_ICON[item.docKind] || 'doc')}</span>`;
    const meta = [item.folder, item.pages > 1 ? `${item.pages} pages` : '', item.modified ? new Date(item.modified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<button class="item-main" title="${esc(item.name)}">${thumb}<span class="item-text"><span class="item-name">${esc(item.name)}</span><span class="item-meta">${esc(meta)}</span>${item.snippet ? `<span class="item-snip">${esc(item.snippet)}</span>` : ''}${item.expiryGuess ? `<span class="item-exp">Expires ${esc(longDate(item.expiryGuess))}</span>` : ''}</span></button><button class="item-more" aria-label="More for ${esc(item.name)}">${icon('more')}</button>`;
    el.querySelector('.item-main').addEventListener('click', () => window.open(TUNNEL_URL + item.url, '_blank', 'noopener'));
    el.querySelector('.item-more').addEventListener('click', () => docActions(item));
    el.querySelector('img')?.addEventListener('error', (e) => e.target.parentElement.classList.add('k-image'));
    frag.appendChild(el);
  });
  list.appendChild(frag);
}
function docActions(item) {
  const acts = [
    { label: 'Open', icon: 'doc', run: () => window.open(TUNNEL_URL + item.url, '_blank', 'noopener') },
    { label: 'Download', icon: 'upload', run: () => downloadItem(item) },
  ];
  if (item.expiryGuess && !(dateItems || []).some(x => x.doc === item.path)) acts.push({ label: `Add expiry to Important dates (${longDate(item.expiryGuess)})`, icon: 'star', run: () => dateSheet(null, { label: item.name.replace(/\.[^.]+$/, ''), date: item.expiryGuess, doc: item.path }) });
  acts.push({ label: 'Rename', icon: 'doc', run: () => renameDoc(item) }, { label: 'Delete', icon: 'x', danger: true, run: () => deleteItem(item, loadDocs) });
  actionSheet(item.name, acts);
}
async function renameDoc(item) {
  const name = await askText('Rename', item.name, 'Rename'); if (!name || name === item.name) return;
  try { await postJSON('/api/drive/rename', { path: item.path, name }); showToast('Renamed', 'success'); loadDocs(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ---- scanner: take or choose pictures of pages, then save them as one PDF ----
let scanPages = []; let scanName = ''; let scanBusy = false;
async function fileToPage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) throw new Error('That picture could not be read.');
  const sc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85);
}
function rotateData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.height; c.height = img.width; const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0); resolve(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => reject(new Error('Could not turn that page.')); img.src = url;
  });
}
async function addScanPages(files, input) {
  if (input) input.value = '';
  if (!files.length) return;
  for (const f of files) {
    if (scanPages.length >= 40) { showToast('That is the most pages for one scan.', 'error'); break; }
    try { scanPages.push({ url: await fileToPage(f) }); } catch (e) { showToast(e.message, 'error'); }
  }
  scanSheet();
}
function scanSheet() {
  const n = scanPages.length;
  const body = openSheet('Scan a document', `
    <p class="sheet-note">${n ? 'Add the next page, or save when you are done.' : 'Take a photo of each page. Lay the paper flat with good light.'}</p>
    ${n ? `<div class="scan-pages">${scanPages.map((p, i) => `<div class="scan-page"><img src="${p.url}" alt="Page ${i + 1}"><span class="scan-n">${i + 1}</span><span class="scan-tools"><button data-rot="${i}" aria-label="Turn page ${i + 1}">↻</button><button data-del="${i}" aria-label="Remove page ${i + 1}">${icon('x')}</button></span></div>`).join('')}</div>` : ''}
    <div class="scan-add"><button class="btn btn-glass" id="scan-take">${icon('camera')} ${n ? 'Add page' : 'Take photo'}</button><button class="btn btn-glass" id="scan-pick">${icon('image')} From photos</button></div>
    ${n ? `<label class="field"><span>Name (optional)</span><input id="scan-name" type="text" maxlength="100" placeholder="Passport, Lease, Receipt…" value="${esc(scanName)}"></label>
    <button class="btn btn-primary btn-block" id="scan-save">Save as PDF · ${n} ${n === 1 ? 'page' : 'pages'}</button>
    <button class="btn btn-glass btn-block danger-text" id="scan-clear">Start over</button>` : ''}`);
  $('scan-take').addEventListener('click', () => $('scan-camera').click());
  $('scan-pick').addEventListener('click', () => $('scan-library').click());
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { scanPages.splice(+b.dataset.del, 1); scanSheet(); }));
  body.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', async () => { const p = scanPages[+b.dataset.rot]; try { p.url = await rotateData(p.url); scanSheet(); } catch (e) { showToast(e.message, 'error'); } }));
  $('scan-name')?.addEventListener('input', (e) => { scanName = e.target.value; });
  $('scan-clear')?.addEventListener('click', () => { scanPages = []; scanName = ''; scanSheet(); });
  $('scan-save')?.addEventListener('click', saveScan);
}
async function saveScan() {
  if (scanBusy || !scanPages.length) return;
  scanBusy = true; const btn = $('scan-save'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await postJSON('/api/docs/scan', { name: scanName.trim(), pages: scanPages.map(p => p.url) });
    scanPages = []; scanName = ''; closeSheet();
    showToast(`Saved ${r.item.name}`, 'success');
    docsQuery = ''; $('docs-search').value = ''; loadDocs();
  } catch (e) {
    showToast(e.offline ? 'Your PC needs to be on to save a scan. Your pages are kept.' : e.message, 'error');
    btn.disabled = false; btn.textContent = `Save as PDF · ${scanPages.length} ${scanPages.length === 1 ? 'page' : 'pages'}`;
  } finally { scanBusy = false; }
}

// ================= THEATER =================
let art = null; let ytPlayer = null; let ytLoading = null; let artLoading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
}
// The video player is only downloaded when you first play something
const ensureArtplayer = () => (window.Artplayer ? Promise.resolve() : (artLoading ||= loadScript('https://cdn.jsdelivr.net/npm/artplayer@5.4.0/dist/artplayer.js')));
const ensureYouTube = () => (window.YT && window.YT.Player ? Promise.resolve() : (ytLoading ||= new Promise((resolve) => { window.onYouTubeIframeAPIReady = resolve; loadScript('https://www.youtube.com/iframe_api'); })));

async function playInTheater(rawUrl, title = '') {
  const slot = $('theater-player-slot'); const yt = $('yt-container');
  const ytMatch = rawUrl.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
  if (ytMatch) {
    if (art) { art.destroy(); art = null; }
    slot.hidden = true; yt.hidden = false;
    await ensureYouTube();
    if (ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById(ytMatch[1]);
    else ytPlayer = new YT.Player('yt-player-slot', { videoId: ytMatch[1], playerVars: { autoplay: 1, controls: 1, playsinline: 1 } });
    return;
  }
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  yt.hidden = true; slot.hidden = false;
  let url = rawUrl;
  // Older watchlist links to vault.ibadhasan.com/stream/... need a fresh pass
  if (rawUrl.startsWith(`${TUNNEL_URL}/stream/`)) {
    try {
      const filename = decodeURIComponent(rawUrl.split('/').pop().split('?')[0]);
      const { token } = await postJSON('/api/stream-token', { filename });
      url = `${rawUrl.split('?')[0]}?stream_token=${token}`;
    } catch (e) { showToast(e.message, 'error'); return; }
  }
  try { await ensureArtplayer(); } catch { showToast('Could not load the video player.', 'error'); return; }
  if (art) art.destroy();
  slot.innerHTML = '';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7cc4ff';
  art = new Artplayer({ container: '#theater-player-slot', url, title, theme: accent, fullscreen: true, setting: true, playbackRate: true, aspectRatio: true, fastForward: true, miniProgressBar: true, pip: true, playsInline: true, autoOrientation: true, autoplay: true });
  art.on('fullscreen', (on) => { if (/iPhone/.test(navigator.userAgent) && on && art.video.webkitEnterFullscreen) { art.video.webkitEnterFullscreen(); art.fullscreen = false; } });
}

let watchlist = [];
async function loadWatchlist() {
  const listEl = $('shared-watchlist');
  try { watchlist = (await edge('/watchlist')).items || []; }
  catch (e) { listEl.innerHTML = `<p class="soft">${esc(e.message)}</p>`; $('upnext-sub').textContent = 'Could not load'; return; }
  // Home tile: the first thing you can play, otherwise the first on the list
  const next = watchlist.find(m => m.streamUrl) || watchlist[0];
  const okPoster = (p) => p && /^https:\/\/image\.tmdb\.org\//.test(p);
  if (next) {
    $('upnext-title').textContent = next.title;
    $('upnext-sub').textContent = `${watchlist.length} on your watchlist`;
    $('upnext-poster').style.backgroundImage = okPoster(next.poster) ? `url("${next.poster}")` : '';
    $('upnext-play').disabled = !next.streamUrl;
    $('upnext-play').onclick = () => { openView('theater'); playInTheater(next.streamUrl, next.title); };
  } else {
    $('upnext-title').textContent = 'Nothing to watch yet';
    $('upnext-sub').textContent = 'Add films in Theater';
    $('upnext-play').disabled = true;
  }

  if (!watchlist.length) { listEl.innerHTML = '<p class="soft">Your watchlist is empty. Search below to add something.</p>'; return; }
  listEl.innerHTML = '';
  watchlist.forEach(m => {
    const card = document.createElement('div'); card.className = 'poster-card';
    card.innerHTML = `
      <button class="poster" aria-label="${m.streamUrl ? 'Play' : 'Link a video for'} ${esc(m.title)}" ${okPoster(m.poster) ? `style="background-image:url('${esc(m.poster)}')"` : ''}></button>
      <span class="poster-title">${esc(m.title)}</span>
      <span class="poster-sub ${m.streamUrl ? 'ready' : ''}">${m.streamUrl ? 'Play' : 'Link a video'}</span>`;
    const rm = document.createElement('button'); rm.className = 'poster-remove'; rm.setAttribute('aria-label', `Remove ${m.title}`); rm.innerHTML = icon('x');
    card.appendChild(rm);
    card.querySelector('.poster').addEventListener('click', async () => {
      if (m.streamUrl) { window.scrollTo({ top: 0, behavior: 'smooth' }); return playInTheater(m.streamUrl, m.title); }
      const url = await askText(`Video for ${m.title}`, '', 'Save', 'YouTube or video link');
      if (url) { try { await edgeJSON('PATCH', `/watchlist/${m.id}`, { streamUrl: url }); showToast('Video linked', 'success'); loadWatchlist(); } catch (err) { showToast(err.message, 'error'); } }
    });
    rm.addEventListener('click', async () => {
      if (await showConfirm(`Remove ${m.title}?`, 'It will be taken off your watchlist.', 'Remove')) { await edge(`/watchlist/${m.id}`, { method: 'DELETE' }).catch(() => {}); loadWatchlist(); }
    });
    listEl.appendChild(card);
  });
}

function initTheater() {
  $('cowatch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('cowatch-url-input').value.trim(); if (!url) return;
    $('cowatch-url-input').value = ''; playInTheater(url);
  });
  const resultsEl = $('tmdb-results'); const input = $('tmdb-search-input');
  $('tmdb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.blur();
    resultsEl.innerHTML = '<p class="soft">Searching…</p>';
    try {
      const data = await api(`/api/tmdb/search?q=${encodeURIComponent(q)}`);
      if (!data.results.length) { resultsEl.innerHTML = '<p class="soft">No results.</p>'; return; }
      resultsEl.innerHTML = '';
      data.results.forEach(r => {
        const card = document.createElement('div'); card.className = 'poster-card';
        card.innerHTML = `<div class="poster" ${r.poster ? `style="background-image:url('${esc(r.poster)}')"` : ''}></div><span class="poster-title">${esc(r.title)}${r.year ? ` (${esc(r.year)})` : ''}</span><button class="btn btn-glass">${icon('plus')}Add</button>`;
        card.querySelector('button').addEventListener('click', async (ev) => {
          const b = ev.currentTarget; b.disabled = true;
          try { await edgeJSON('POST', '/watchlist', { title: r.title, poster: r.poster, type: r.type }); b.textContent = 'Added'; showToast(`Added ${r.title}`, 'success'); loadWatchlist(); }
          catch (err) { b.disabled = false; showToast(err.message, 'error'); }
        });
        resultsEl.appendChild(card);
      });
    } catch (err) { resultsEl.innerHTML = `<p class="soft">${esc(err.offline ? 'Search needs your PC to be on.' : err.message)}</p>`; }
  });
}

// ================= start (last, so everything above is ready) =================
// A remembered session goes straight in; the helper confirms it in the background.
if (session.get()) {
  signedIn();
  fetchWithAuth(`${EDGE}/auth/check`).then(r => { if (r.status === 401) signedOut(); }).catch(() => {});
} else signedOut();
