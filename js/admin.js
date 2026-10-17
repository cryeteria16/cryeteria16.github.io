// Settings for The Lair and the homepage. Everything is stored in the always-on helper.
import { passkeySupported, registerPasskey } from './passkey.js?v=1';

const EDGE = 'https://api.ibadhasan.com';
const $ = (id) => document.getElementById(id);
const token = (() => { try { return localStorage.getItem('lair.session'); } catch { return null; } })();
if (!token) location.replace('/lair');

async function edge(path, options = {}) {
  const res = await fetch(EDGE + path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 401) { location.replace('/lair'); throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const getValue = async (key) => (await edge(`/data/${key}`)).value || {};
async function merge(key, patch, button) {
  const label = button.textContent; button.disabled = true; button.textContent = 'Saving…';
  try {
    const current = await getValue(key);
    await edge(`/data/${key}`, { method: 'PUT', body: JSON.stringify({ value: { ...current, ...patch } }) });
    button.textContent = 'Saved';
  } catch (e) { button.textContent = 'Not saved'; alert(e.message); }
  setTimeout(() => { button.textContent = label; button.disabled = false; }, 1600);
}

(async () => {
  const [config, profile] = await Promise.all([getValue('config'), getValue('profile')]);
  if (config.accentColor && /^#[0-9a-f]{6}$/i.test(config.accentColor)) { $('config-accent').value = config.accentColor; document.documentElement.style.setProperty('--accent', config.accentColor); }
  $('edit-broadcast').value = config.broadcast || '';
  const f = config.features || {};
  for (const k of ['drop', 'theater', 'radar']) $(`toggle-${k}`).checked = f[k] !== false;
  $('edit-hero-title').value = profile.heroTitle || '';
  $('edit-hero-sub').value = profile.heroSub || '';
  $('edit-bio').value = profile.bio || '';
  $('edit-email').value = profile.email || '';
  $('edit-vcard-phone').value = profile.vcardPhone || '';
  $('edit-social-ig').value = profile.socials?.ig || '';
  $('edit-social-x').value = profile.socials?.x || '';
  $('edit-social-git').value = profile.socials?.git || '';
  loadSessions();
  loadPasskeys();
})().catch(() => {});

async function loadSessions() {
  const box = $('session-list');
  try {
    const { sessions } = await edge('/auth/sessions');
    box.innerHTML = '';
    sessions.forEach((s) => {
      const row = document.createElement('div'); row.className = 'row';
      const name = document.createElement('span'); name.textContent = `${s.device}${s.current ? ' (this device)' : ''}`;
      const when = document.createElement('small');
      when.textContent = new Date(s.lastSeen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      row.append(name, when); box.appendChild(row);
    });
  } catch { box.innerHTML = '<div class="row"><span class="soft">Could not load.</span></div>'; }
}

$('btn-save-os').addEventListener('click', (e) => merge('config', {
  broadcast: $('edit-broadcast').value.trim(),
  accentColor: $('config-accent').value,
  features: Object.fromEntries(['drop', 'theater', 'radar'].map((k) => [k, $(`toggle-${k}`).checked])),
}, e.currentTarget));

$('btn-save-profile').addEventListener('click', (e) => merge('profile', {
  heroTitle: $('edit-hero-title').value.trim(), heroSub: $('edit-hero-sub').value.trim(), bio: $('edit-bio').value.trim(),
  email: $('edit-email').value.trim(), vcardPhone: $('edit-vcard-phone').value.trim(),
  socials: { ig: $('edit-social-ig').value.trim(), x: $('edit-social-x').value.trim(), git: $('edit-social-git').value.trim() },
}, e.currentTarget));

$('btn-logout-others').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!confirm('Sign out every other phone, tablet and computer?')) return;
  try { await edge('/auth/logout-others', { method: 'POST', body: '{}' }); loadSessions(); btn.textContent = 'Done'; } catch (err) { alert(err.message); }
});

// ---- Face ID devices ----
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
async function loadPasskeys() {
  const box = $('passkey-list');
  let passkeys;
  try { passkeys = (await edge('/auth/passkeys')).passkeys || []; } catch { box.innerHTML = '<div class="row"><span class="soft">Could not load.</span></div>'; return; }
  box.innerHTML = '';
  if (!passkeys.length) box.innerHTML = '<div class="row"><span class="soft">Not set up on any device yet.</span></div>';
  passkeys.forEach((p) => {
    const row = document.createElement('div'); row.className = 'row';
    const meta = document.createElement('span'); meta.className = 'meta';
    const name = document.createElement('span'); name.textContent = p.device || 'Device';
    const when = document.createElement('small'); when.textContent = `Added ${fmtDate(p.created)}${p.lastUsed ? ` · last used ${fmtDate(p.lastUsed)}` : ''}`;
    meta.append(name, when);
    const rm = document.createElement('button'); rm.className = 'remove'; rm.textContent = 'Remove';
    rm.addEventListener('click', async () => {
      if (!confirm(`Remove Face ID for ${p.device}? That device will need the password next time.`)) return;
      try { await edge(`/auth/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); loadPasskeys(); } catch (e) { alert(e.message); }
    });
    row.append(meta, rm); box.appendChild(row);
  });
  $('btn-add-passkey').hidden = !(await passkeySupported());
}
$('btn-add-passkey').addEventListener('click', async (e) => {
  const btn = e.currentTarget; btn.disabled = true; const label = btn.textContent; btn.textContent = 'Waiting for Face ID…';
  try {
    await registerPasskey(token);
    try { localStorage.setItem('lair.faceid', 'true'); } catch {}
    btn.textContent = 'Face ID is ready'; loadPasskeys();
  } catch (err) { btn.textContent = label; if (!err.cancelled) alert(err.message); }
  setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1800);
});
