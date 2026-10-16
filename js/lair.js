import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, collection, onSnapshot, query, orderBy, setDoc, updateDoc, deleteDoc, addDoc, getDoc, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const TUNNEL_URL = "https://vault.ibadhasan.com";
const CHUNK = 8 * 1024 * 1024; // uploads go in 8 MB pieces (Cloudflare limits each request to 100 MB)

// ================= helpers =================
const $ = (id) => document.getElementById(id);
// Escape text from elsewhere (file names, visitor logs, watchlist) before it goes into HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

const triggerHaptic = () => { if (navigator.vibrate) navigator.vibrate(12); };
document.addEventListener('click', (e) => { if (e.target.closest('.haptic-btn')) triggerHaptic(); });

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `lair-toast ${type}`;
  const icon = document.createElement('span'); icon.textContent = type === 'success' ? '✔' : type === 'error' ? '✖' : '●';
  const text = document.createElement('span'); text.textContent = msg;
  toast.append(icon, ' ', text);
  $('toast-container').appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'all 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    toast.style.opacity = '0'; toast.style.transform = 'translateY(12px) scale(0.92)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function showConfirm(title, msg, okText = 'Confirm') {
  return new Promise((resolve) => {
    const modal = $('confirm-modal');
    $('confirm-title').textContent = title; $('confirm-msg').textContent = msg; $('btn-confirm-ok').textContent = okText;
    modal.classList.add('active');
    const done = (v) => { $('btn-confirm-ok').onclick = null; $('btn-confirm-cancel').onclick = null; modal.classList.remove('active'); resolve(v); };
    $('btn-confirm-ok').onclick = () => done(true);
    $('btn-confirm-cancel').onclick = () => done(false);
  });
}

async function fetchWithAuth(url, options = {}) {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
}
// JSON call to the PC; throws with the PC's own message
async function api(path, options = {}) {
  let res;
  try { res = await fetchWithAuth(TUNNEL_URL + path, options); }
  catch { throw new Error('Your PC is not reachable right now.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `The PC answered ${res.status}.`), { status: res.status, data });
  return data;
}
const postJSON = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ================= clock & wallpaper (once a minute, not every second) =================
function updateDiurnalCycle() {
  const root = document.documentElement;
  if (document.body.getAttribute('data-theme') === 'light') return;
  const h = parseInt(new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false }), 10);
  const [a, b] = h >= 6 && h < 17 ? ['#16241c', '#12202c'] : h >= 17 && h < 19 ? ['#2d1f18', '#1b1424'] : ['#0b1410', '#090f15'];
  root.style.setProperty('--aurora-1', a); root.style.setProperty('--aurora-2', b);
}
function tickClock() {
  const now = new Date();
  const t = (tz) => now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  $('clock-dxb').textContent = t('Asia/Dubai');
  $('clock-pkt').textContent = t('Asia/Karachi');
  updateDiurnalCycle();
  setTimeout(tickClock, 60000 - (Date.now() % 60000) + 50);
}
tickClock();

// ================= navigation =================
const VIEWS = ['dashboard', 'drop', 'theater'];
const onOpen = {}; // view -> callback when first shown
function openView(target) {
  document.querySelectorAll('.dock-app').forEach(d => d.classList.toggle('active', d.dataset.target === target));
  document.querySelectorAll('.view-container').forEach(v => v.classList.toggle('active', v.id === `view-${target}`));
  $('btn-quick-capture').style.display = target === 'drop' ? 'flex' : 'none';
  if (onOpen[target]) { const fn = onOpen[target]; delete onOpen[target]; fn(); }
  if (target === 'dashboard') pollStatus();
  window.scrollTo(0, 0);
}
const activeView = () => document.querySelector('.dock-app.active')?.dataset.target;
document.querySelectorAll('.app-link').forEach(link => link.addEventListener('click', () => openView(link.dataset.target)));

let touchStartX = 0; let touchStartY = 0;
const swipeZone = $('swipe-zone');
swipeZone.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY; }, { passive: true });
swipeZone.addEventListener('touchend', e => {
  if (e.target.closest('#command-bay-grid, #tmdb-results, #shared-watchlist, input, textarea, select, .theater-container, #fridge-magnet-card, .drive-grid')) return;
  const dx = touchStartX - e.changedTouches[0].screenX; const dy = touchStartY - e.changedTouches[0].screenY;
  if (Math.abs(dy) > Math.abs(dx)) return;
  const visible = VIEWS.filter(v => $(`dock-${v}-link`).style.display !== 'none');
  const i = visible.indexOf(activeView());
  if (dx > 80 && i < visible.length - 1) openView(visible[i + 1]);
  else if (dx < -80 && i > 0) openView(visible[i - 1]);
}, { passive: true });

// ================= sign in (owner only) =================
const toEmail = (u) => (u.includes('@') ? u : `${u}@lair.local`);
$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('signin-btn'); const err = $('signin-error');
  const user = $('signin-user').value.trim().toLowerCase(); const pass = $('signin-pass').value;
  if (!user || !pass) return;
  btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, toEmail(user), pass);
    $('signin-pass').value = '';
  } catch (e2) {
    err.textContent = e2.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes and try again.'
      : e2.code === 'auth/network-request-failed' ? 'No internet connection.' : 'Wrong username or password.';
  } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});

let booted = false;
onAuthStateChanged(auth, async (user) => {
  if (!user) { document.body.classList.add('signed-out'); document.body.classList.remove('auth-pending'); $('signin-user').focus({ preventScroll: true }); return; }
  let owner = false;
  try { const snap = await getDoc(doc(db, 'users', user.uid)); owner = snap.exists() && snap.data().role === 'admin'; } catch {}
  if (!owner) {
    await signOut(auth);
    $('signin-error').textContent = 'This account does not have access to The Lair.';
    document.body.classList.add('signed-out'); document.body.classList.remove('auth-pending');
    return;
  }
  document.body.classList.remove('signed-out', 'auth-pending');
  if (!booted) { booted = true; boot(); }
});

$('btn-signout').addEventListener('click', async () => { await signOut(auth); location.reload(); });

function boot() {
  initConfig();
  initFridgeDoor();
  initRadar();
  onOpen.drop = initDrive;
  onOpen.theater = initTheater;
  const params = new URLSearchParams(location.search);
  const want = location.hash.replace('#', '');
  if (params.get('share') === 'true') { history.replaceState({}, '', location.pathname); openView('drop'); }
  else if (VIEWS.includes(want)) openView(want);
  else pollStatus();
  setTimeout(resizeCanvas, 150);
}

// ================= settings from Admin (theme, banner, fonts, which tabs show) =================
function initConfig() {
  $('btn-theme-toggle').addEventListener('click', () => {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setDoc(doc(db, 'system', 'config'), { theme: next }, { merge: true }).catch(() => {});
  });
  onSnapshot(doc(db, 'system', 'config'), (snap) => {
    if (!snap.exists()) return; const d = snap.data();
    if (d.theme) applyTheme(d.theme);
    const banner = $('broadcast-banner');
    banner.textContent = d.broadcast || ''; banner.style.display = d.broadcast ? 'block' : 'none';
    if (d.accentColor) document.documentElement.style.setProperty('--accent', d.accentColor);
    if (d.fontDisplay || d.fontBody) {
      const fams = [d.fontDisplay, d.fontBody].filter(Boolean).map(f => f.trim().replace(/ /g, '+'));
      $('dynamic-fonts').href = `https://fonts.googleapis.com/css2?${fams.map(f => `family=${encodeURIComponent(f).replace(/%2B/g, '+')}:wght@400;500;600`).join('&')}&display=swap`;
      if (d.fontDisplay) document.documentElement.style.setProperty('--font-display', `'${d.fontDisplay}', serif`);
      if (d.fontBody) document.documentElement.style.setProperty('--font-body', `'${d.fontBody}', sans-serif`);
    }
    const f = d.features || {};
    $('dock-dashboard-link').style.display = f.dashboard === false ? 'none' : '';
    $('dock-drop-link').style.display = f.drop === false ? 'none' : '';
    $('dock-theater-link').style.display = f.theater === false ? 'none' : '';
    const radarCard = $('radar-feed').closest('.card'); radarCard.style.display = f.radar === false ? 'none' : 'flex';
    if ($(`dock-${activeView()}-link`)?.style.display === 'none') {
      const first = VIEWS.find(v => $(`dock-${v}-link`).style.display !== 'none'); if (first) openView(first);
    }
  });
}
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  const light = theme === 'light';
  $('theme-icon').textContent = light ? '🌙' : '☀️';
  document.querySelector('#btn-theme-toggle .nav-btn-text').textContent = light ? ' Dark' : ' Light';
  $('meta-theme-color').setAttribute('content', light ? '#F2F2F7' : '#060709');
  updateDiurnalCycle();
}

// ================= dashboard: PC status (only while the dashboard is on screen) =================
let statusTimer = null;
async function pollStatus() {
  clearTimeout(statusTimer);
  if (!booted || activeView() !== 'dashboard' || document.visibilityState !== 'visible') return;
  const setLink = (on, text) => {
    for (const id of ['health-dot', 'health-dot-top']) $(id).style.color = on ? 'var(--con)' : 'var(--err)';
    $('health-text').textContent = text;
  };
  try {
    const s = await api('/api/status');
    setLink(true, 'PC online');
    $('sys-cpu').textContent = s.cpu; $('sys-ram').textContent = s.ram;
    renderUsage(s.usage, 'status-usage-fill', 'status-usage-text');
    $('status-log').textContent = s.log && s.log.length ? s.log.map(l => l.replace(/^\S+T(\d\d:\d\d)\S* \[updater\] /, '$1  ')).join('\n') : 'No updates yet.';
    const up = s.uptime > 86400 ? `${Math.floor(s.uptime / 86400)}d` : s.uptime > 3600 ? `${Math.floor(s.uptime / 3600)}h` : `${Math.floor(s.uptime / 60)}m`;
    $('status-version').textContent = `Server ${s.version || 'unknown'} · running ${up}`;
  } catch (e) {
    setLink(false, e.status === 403 ? 'Access refused' : 'PC offline');
    $('status-log').textContent = e.message;
  }
  statusTimer = setTimeout(pollStatus, 30000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollStatus(); });

function renderUsage(u, fillId, textId) {
  if (!u) return;
  const pct = Math.min(100, (u.used / u.quota) * 100);
  const fill = $(fillId); fill.style.width = `${pct.toFixed(1)}%`;
  fill.style.background = pct > 90 ? 'var(--err)' : pct > 75 ? 'var(--warn)' : 'var(--con)';
  $(textId).textContent = `${fmtBytes(u.used)} of ${fmtBytes(u.quota)}${u.counting ? ' (counting…)' : ''}${u.diskFree != null ? ` · ${fmtBytes(u.diskFree)} free on PC` : ''}`;
}

// ================= Fridge Door =================
function initFridgeDoor() {
  const text = $('fridge-door-text'); const status = $('fridge-status');
  let saveTimer; let typing = false;
  onSnapshot(doc(db, 'system', 'fridge_door'), (snap) => {
    if (snap.exists() && !typing && document.activeElement !== text) { text.value = snap.data().content || ''; status.textContent = 'Synced'; }
  });
  text.addEventListener('input', () => {
    typing = true; status.textContent = 'Typing…'; clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await setDoc(doc(db, 'system', 'fridge_door'), { content: text.value, timestamp: serverTimestamp() }, { merge: true }); status.textContent = 'Saved'; }
      catch { status.textContent = 'Not saved'; }
      typing = false;
    }, 600);
  });
  text.addEventListener('blur', () => {
    typing = false;
    fetchWithAuth(`${TUNNEL_URL}/api/fridge/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.value }) }).catch(() => {});
  });
}

// ================= Live Radar =================
function initRadar() {
  const feed = $('radar-feed');
  onSnapshot(query(collection(db, 'radar_logs'), orderBy('timestamp', 'desc'), limit(20)), (snap) => {
    if (snap.empty) { feed.innerHTML = '<p class="muted-note">Waiting for visitors…</p>'; return; }
    feed.innerHTML = '';
    snap.forEach(d => {
      const r = d.data(); const row = document.createElement('div'); row.className = 'radar-row';
      const when = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      row.innerHTML = `<span>${esc(r.type || 'Visit')} · ${esc(r.city || 'Unknown')}, ${esc(r.country || '')}</span><span class="mini-label">${esc(when)}</span>`;
      feed.appendChild(row);
    });
  });
}

// ================= VAULT (drive on the PC) =================
let drivePath = store.get('lair.drivePath') || '';
let driveItems = [];
let driveSort = store.get('lair.driveSort') || 'name';
const ICONS = { folder: '📁', image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', text: '📝', other: '📦' };

function initDrive() {
  $('drive-sort').value = driveSort;
  $('drive-sort').addEventListener('change', (e) => { driveSort = e.target.value; store.set('lair.driveSort', driveSort); renderDrive(); });
  $('btn-upload').addEventListener('click', () => { if (!drivePath) return showToast('Open Files, Photos or Movies first.'); $('drive-file-input').click(); });
  $('btn-quick-capture').addEventListener('click', () => $('drive-camera-input').click());
  $('drive-file-input').addEventListener('change', (e) => { queueUploads([...e.target.files], drivePath); e.target.value = ''; });
  $('drive-camera-input').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
    const ext = (f.name.match(/\.[^.]+$/) || ['.jpg'])[0];
    queueUploads([new File([f], `Camera ${stamp}${ext}`, { type: f.type, lastModified: f.lastModified })], 'Photos');
  });
  $('btn-new-folder').addEventListener('click', async () => {
    if (!drivePath) return showToast('Open Files, Photos or Movies first.');
    const name = prompt('New folder name'); if (!name || !name.trim()) return;
    try { await postJSON('/api/drive/mkdir', { path: drivePath, name: name.trim() }); loadDrive(); } catch (e) { showToast(e.message, 'error'); }
  });

  // Drag and drop on desktop
  const card = document.querySelector('.drive-card');
  ['dragenter', 'dragover'].forEach(t => card.addEventListener(t, (e) => { if (drivePath && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); card.classList.add('dragging'); } }));
  ['dragleave', 'drop'].forEach(t => card.addEventListener(t, (e) => { if (t === 'dragleave' && card.contains(e.relatedTarget)) return; card.classList.remove('dragging'); }));
  card.addEventListener('drop', (e) => { if (!drivePath) return; e.preventDefault(); queueUploads([...e.dataTransfer.files], drivePath); });

  // Lightbox controls
  $('lb-close').addEventListener('click', closeLightbox);
  $('lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('lb-next').addEventListener('click', () => stepLightbox(1));
  $('photo-lightbox').addEventListener('click', (e) => { if (e.target.id === 'photo-lightbox') closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (!$('photo-lightbox').classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') stepLightbox(-1); if (e.key === 'ArrowRight') stepLightbox(1);
  });
  let lbX = 0;
  $('lightbox-img').addEventListener('touchstart', (e) => { lbX = e.changedTouches[0].screenX; }, { passive: true });
  $('lightbox-img').addEventListener('touchend', (e) => { const d = lbX - e.changedTouches[0].screenX; if (Math.abs(d) > 50) stepLightbox(d > 0 ? 1 : -1); }, { passive: true });
  $('sheet-cancel').addEventListener('click', () => $('action-sheet').classList.remove('active'));
  $('action-sheet').addEventListener('click', (e) => { if (e.target.id === 'action-sheet') $('action-sheet').classList.remove('active'); });

  loadDrive();
  resumePendingUploads();
}

async function loadDrive(path = drivePath) {
  const grid = $('drive-grid');
  if (!driveItems.length) grid.innerHTML = '<p class="muted-note">Loading…</p>';
  try {
    const data = await api(`/api/drive/list?path=${encodeURIComponent(path)}`);
    drivePath = data.path; store.set('lair.drivePath', drivePath);
    driveItems = data.items;
    renderUsage(data.usage, 'drive-usage-fill', 'drive-usage-text');
    renderDrive();
  } catch (e) {
    if (e.status === 404 && path) { drivePath = ''; return loadDrive(''); }
    grid.innerHTML = `<p class="muted-note">${esc(e.message)}</p>`;
  }
}

function sortedItems() {
  const items = [...driveItems];
  if (!drivePath) return items; // top level stays Files, Photos, Movies
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }), new: (a, b) => b.modified - a.modified, size: (a, b) => (b.size || 0) - (a.size || 0) }[driveSort];
  return items.sort((a, b) => (a.type === b.type ? cmp(a, b) : a.type === 'folder' ? -1 : 1));
}

function renderDrive() {
  // Breadcrumbs
  const crumbs = $('drive-crumbs'); crumbs.innerHTML = '';
  const parts = drivePath ? drivePath.split('/') : [];
  const addCrumb = (label, p) => {
    const b = document.createElement('button'); b.className = 'crumb haptic-btn'; b.textContent = label;
    b.addEventListener('click', () => loadDrive(p)); crumbs.appendChild(b);
  };
  addCrumb('Vault', '');
  parts.forEach((name, i) => { const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '/'; crumbs.appendChild(s); addCrumb(name, parts.slice(0, i + 1).join('/')); });
  $('btn-upload').disabled = !drivePath; $('btn-new-folder').disabled = !drivePath;

  const grid = $('drive-grid'); grid.innerHTML = '';
  const items = sortedItems();
  if (!items.length) { grid.innerHTML = '<p class="muted-note">This folder is empty. Upload something.</p>'; return; }
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const tile = document.createElement('div'); tile.className = 'drive-tile';
    const thumb = item.thumb
      ? `<img src="${esc(TUNNEL_URL + item.thumb)}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tile-icon',textContent:'🖼️'}))">`
      : `<span class="tile-icon">${ICONS[item.type === 'folder' ? 'folder' : item.kind] || ICONS.other}</span>`;
    tile.innerHTML = `
      <button class="tile-main haptic-btn" title="${esc(item.name)}">
        <span class="tile-thumb">${thumb}</span>
        <span class="tile-name">${esc(item.name)}</span>
        <span class="tile-meta">${item.type === 'folder' ? 'Folder' : esc(fmtBytes(item.size))}</span>
      </button>
      ${!drivePath ? '' : `<button class="tile-more haptic-btn" aria-label="More for ${esc(item.name)}">⋯</button>`}`;
    tile.querySelector('.tile-main').addEventListener('click', () => openItem(item));
    tile.querySelector('.tile-more')?.addEventListener('click', () => showActions(item));
    frag.appendChild(tile);
  });
  grid.appendChild(frag);
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
const inPhotosRoot = (item) => item.path.split('/').length === 2 && item.path.startsWith('Photos/');

function showActions(item) {
  $('sheet-title').textContent = item.name;
  const box = $('sheet-buttons'); box.innerHTML = '';
  const add = (label, fn, cls = '') => {
    const b = document.createElement('button'); b.className = `btn-secondary haptic-btn ${cls}`; b.textContent = label;
    b.addEventListener('click', () => { $('action-sheet').classList.remove('active'); fn(); }); box.appendChild(b);
  };
  add('Open', () => openItem(item));
  if (item.type === 'file') add('Download original', () => downloadItem(item));
  add('Rename', () => renameItem(item));
  add('Delete', () => deleteItem(item), 'danger-text');
  $('action-sheet').classList.add('active');
}

async function renameItem(item) {
  const name = prompt('New name', item.name); if (!name || !name.trim() || name.trim() === item.name) return;
  try { await postJSON('/api/drive/rename', { path: item.path, name: name.trim() }); showToast('Renamed', 'success'); loadDrive(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function deleteItem(item) {
  const what = item.type === 'folder' ? 'this folder and everything in it' : 'this file';
  if (!(await showConfirm(`Delete ${item.name}?`, `This moves ${what} to the recycle bin on your PC. It is emptied after 30 days.`, 'Delete'))) return false;
  try { await postJSON('/api/drive/delete', { path: item.path }); showToast('Moved to the recycle bin', 'success'); loadDrive(); return true; }
  catch (e) { showToast(e.message, 'error'); return false; }
}

// ---- photo viewer: shows a phone-sized preview; the original only on request ----
let lbList = []; let lbIndex = 0;
function openLightbox(item) {
  lbList = sortedItems().filter(i => i.preview);
  lbIndex = Math.max(0, lbList.findIndex(i => i.path === item.path));
  showLightboxItem();
  $('photo-lightbox').classList.add('active');
}
function closeLightbox() { $('photo-lightbox').classList.remove('active'); $('lightbox-img').removeAttribute('src'); }
function stepLightbox(d) { if (!lbList.length) return; lbIndex = (lbIndex + d + lbList.length) % lbList.length; showLightboxItem(); }
async function showLightboxItem() {
  const item = lbList[lbIndex]; if (!item) return closeLightbox();
  $('lightbox-img').src = TUNNEL_URL + item.preview;
  $('lightbox-name').textContent = `${item.name} · ${fmtBytes(item.size)} original`;
  $('lb-prev').style.visibility = $('lb-next').style.visibility = lbList.length > 1 ? 'visible' : 'hidden';
  $('lb-original').onclick = () => window.open(TUNNEL_URL + item.url, '_blank', 'noopener');
  $('lb-delete').onclick = async () => { if (await deleteItem(item)) closeLightbox(); };
  const ex = $('lb-exhibit');
  ex.hidden = !inPhotosRoot(item);
  if (!ex.hidden) {
    const ref = doc(db, 'public_photos', item.name);
    const paint = (on) => { ex.textContent = on ? '★ In exhibition' : '☆ Exhibition'; ex.style.color = on ? 'var(--warn)' : ''; };
    paint(false);
    getDoc(ref).then(s => paint(s.exists())).catch(() => {});
    ex.onclick = async () => {
      try {
        const s = await getDoc(ref);
        if (s.exists()) { await deleteDoc(ref); paint(false); showToast('Removed from the homepage exhibition'); }
        else {
          await setDoc(ref, { filename: item.name, url: `${TUNNEL_URL}/api/public/cloud/${encodeURIComponent(item.name)}`, dateFormatted: new Date(item.modified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
          paint(true); showToast('Added to the homepage exhibition', 'success');
        }
      } catch { showToast('Could not change the exhibition', 'error'); }
    };
  }
}

// ---- uploads: 8 MB pieces, resume after a dropped connection or a reload ----
const uploads = []; let uploading = false;
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
    return `<div class="up-row ${u.state}"><div class="up-text"><span class="up-name">${esc(u.file.name)}</span><span class="mini-label">${label}</span></div><div class="usage-bar"><div class="usage-fill" style="width:${pct}%"></div></div></div>`;
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
      const qs = `id=${id}&dir=${encodeURIComponent(u.dir)}&name=${encodeURIComponent(u.file.name)}&size=${u.file.size}&offset=${u.sent}`;
      try {
        const res = await fetchWithAuth(`${TUNNEL_URL}/api/drive/upload?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: u.file.slice(u.sent, end) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof data.received === 'number') { u.sent = data.received; continue; }
        if (!res.ok) throw Object.assign(new Error(data.error || `Upload refused (${res.status})`), { fatal: true });
        u.sent = data.received; tries = 0; u.state = 'sending'; renderQueue();
        if (data.done) break;
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
  if (pending.length) showToast(`${pending.length} upload${pending.length > 1 ? 's were' : ' was'} interrupted. Choose the same file${pending.length > 1 ? 's' : ''} again to continue where ${pending.length > 1 ? 'they' : 'it'} stopped.`);
}

// ================= THEATER =================
let art = null; let ytPlayer = null; let ytLoading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
}
// The video player is only downloaded when you first play something
let artLoading = null;
const ensureArtplayer = () => (window.Artplayer ? Promise.resolve() : (artLoading ||= loadScript('https://cdn.jsdelivr.net/npm/artplayer@5.4.0/dist/artplayer.js')));
const ensureYouTube = () => (window.YT && window.YT.Player ? Promise.resolve() : (ytLoading ||= new Promise((resolve) => { window.onYouTubeIframeAPIReady = resolve; loadScript('https://www.youtube.com/iframe_api'); })));

async function playInTheater(rawUrl, title = '') {
  const slot = $('theater-player-slot'); const yt = $('yt-container');
  const ytMatch = rawUrl.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
  if (ytMatch) {
    if (art) { art.destroy(); art = null; }
    slot.style.display = 'none'; yt.style.display = 'block';
    await ensureYouTube();
    if (ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById(ytMatch[1]);
    else ytPlayer = new YT.Player('yt-player-slot', { videoId: ytMatch[1], playerVars: { autoplay: 1, controls: 1, playsinline: 1 } });
    return;
  }
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  yt.style.display = 'none'; slot.style.display = 'flex';
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
  art = new Artplayer({ container: '#theater-player-slot', url, title, theme: '#70947A', fullscreen: true, setting: true, playbackRate: true, aspectRatio: true, fastForward: true, miniProgressBar: true, pip: true, playsInline: true, autoOrientation: true, autoplay: true });
  art.on('fullscreen', (on) => { if (/iPhone/.test(navigator.userAgent) && on && art.video.webkitEnterFullscreen) { art.video.webkitEnterFullscreen(); art.fullscreen = false; } });
}

function initTheater() {
  $('btn-load-cowatch').addEventListener('click', () => {
    const url = $('cowatch-url-input').value.trim(); if (!url) return;
    $('cowatch-url-input').value = ''; playInTheater(url);
  });

  const listEl = $('shared-watchlist');
  onSnapshot(query(collection(db, 'watchlist'), orderBy('timestamp', 'desc'), limit(40)), (snap) => {
    if (snap.empty) { listEl.innerHTML = '<p class="muted-note">Your watchlist is empty. Search above to add something.</p>'; return; }
    listEl.innerHTML = '';
    snap.forEach(docSnap => {
      const m = docSnap.data(); const card = document.createElement('div'); card.className = 'poster-card';
      card.innerHTML = `
        <div class="poster" ${m.poster && /^https:\/\/image\.tmdb\.org\//.test(m.poster) ? `style="background-image:url('${esc(m.poster)}')"` : ''}></div>
        <div class="poster-title">${esc(m.title)}</div>
        <div class="poster-sub" style="color:${m.streamUrl ? 'var(--con)' : 'var(--ink-soft)'}">${m.streamUrl ? '▶ Play' : '🔗 Link a video'}</div>`;
      card.addEventListener('click', async () => {
        if (m.streamUrl) { window.scrollTo(0, 0); return playInTheater(m.streamUrl, m.title); }
        const url = prompt(`Paste a video link for ${m.title} (a YouTube link, or open the video in the Vault and copy its address):`);
        if (url && url.trim()) { await updateDoc(docSnap.ref, { streamUrl: url.trim() }); showToast('Video linked', 'success'); }
      });
      card.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        if (await showConfirm(`Remove ${m.title}?`, 'It will be taken off your watchlist.', 'Remove')) deleteDoc(docSnap.ref);
      });
      listEl.appendChild(card);
    });
  });

  const resultsEl = $('tmdb-results'); const input = $('tmdb-search-input');
  const runSearch = async () => {
    const q = input.value.trim(); if (!q) return;
    resultsEl.innerHTML = '<p class="muted-note">Searching…</p>';
    try {
      const data = await api(`/api/tmdb/search?q=${encodeURIComponent(q)}`);
      if (!data.results.length) { resultsEl.innerHTML = '<p class="muted-note">No results.</p>'; return; }
      resultsEl.innerHTML = '';
      data.results.forEach(r => {
        const card = document.createElement('div'); card.className = 'poster-card';
        card.innerHTML = `<div class="poster" ${r.poster ? `style="background-image:url('${esc(r.poster)}')"` : ''}></div><div class="poster-title">${esc(r.title)} ${r.year ? `(${esc(r.year)})` : ''}</div><button class="btn-secondary haptic-btn poster-add">+ Add</button>`;
        card.querySelector('button').addEventListener('click', async () => {
          await addDoc(collection(db, 'watchlist'), { title: r.title, poster: r.poster, type: r.type, status: 'Want to Watch', streamUrl: '', timestamp: serverTimestamp() });
          showToast(`Added ${r.title}`, 'success');
        });
        resultsEl.appendChild(card);
      });
    } catch (e) { resultsEl.innerHTML = `<p class="muted-note">${esc(e.message)}</p>`; }
  };
  $('btn-tmdb-search').addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}

// ================= Fridge Magnet (drawing board) =================
const canvas = $('magnet-canvas');
const ctx = canvas.getContext('2d');
let isDrawing = false; let lastX = 0; let lastY = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (canvas.width === Math.floor(rect.width) && canvas.height === Math.floor(rect.height)) return;
  const tmp = document.createElement('canvas'); tmp.width = canvas.width; tmp.height = canvas.height;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  canvas.width = rect.width; canvas.height = rect.height; ctx.drawImage(tmp, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
const coords = (e) => {
  const rect = canvas.getBoundingClientRect();
  const p = e.touches && e.touches[0] ? e.touches[0] : e;
  return { x: (p.clientX - rect.left) * (canvas.width / rect.width), y: (p.clientY - rect.top) * (canvas.height / rect.height) };
};
const startDrawing = (e) => { resizeCanvas(); isDrawing = true; ({ x: lastX, y: lastY } = coords(e)); };
const draw = (e) => {
  if (!isDrawing) return; e.preventDefault();
  const p = coords(e);
  ctx.strokeStyle = $('magnet-color').value; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
  lastX = p.x; lastY = p.y;
};
const stopDrawing = () => { isDrawing = false; };
canvas.addEventListener('mousedown', startDrawing); canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing); canvas.addEventListener('mouseleave', stopDrawing);
canvas.addEventListener('touchstart', startDrawing, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing);
$('btn-clear-canvas').addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
$('btn-save-magnet').addEventListener('click', () => {
  const btn = $('btn-save-magnet'); btn.disabled = true; btn.textContent = 'Saving…';
  canvas.toBlob(async (blob) => {
    try {
      if (!blob) throw new Error('Nothing to save.');
      const fd = new FormData(); fd.append('magnet_image', blob, 'magnet.png');
      const res = await fetchWithAuth(`${TUNNEL_URL}/api/fridge/save-magnet`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      ctx.clearRect(0, 0, canvas.width, canvas.height); showToast('Sketch saved to Photos', 'success');
    } catch (e) { showToast(e.message === 'Failed to fetch' ? 'Your PC is not reachable right now.' : e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Save to Photos'; }
  }, 'image/png');
});
