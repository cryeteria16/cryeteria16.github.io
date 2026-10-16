// Settings for The Lair and the homepage. Everything is stored in the always-on helper.
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
    button.textContent = 'Saved ✔';
  } catch (e) { button.textContent = 'Not saved'; alert(e.message); }
  setTimeout(() => { button.textContent = label; button.disabled = false; }, 1600);
}

(async () => {
  const [config, profile] = await Promise.all([getValue('config'), getValue('profile')]);
  if (config.theme) document.body.setAttribute('data-theme', config.theme);
  if (config.accentColor) { $('config-accent').value = config.accentColor; document.documentElement.style.setProperty('--accent', config.accentColor); }
  $('config-font-display').value = config.fontDisplay || '';
  $('config-font-body').value = config.fontBody || '';
  $('edit-broadcast').value = config.broadcast || '';
  const f = config.features || {};
  for (const k of ['dashboard', 'drop', 'theater', 'radar']) $(`toggle-${k}`).checked = f[k] !== false;
  $('edit-hero-title').value = profile.heroTitle || '';
  $('edit-hero-sub').value = profile.heroSub || '';
  $('edit-bio').value = profile.bio || '';
  $('edit-email').value = profile.email || '';
  $('edit-vcard-phone').value = profile.vcardPhone || '';
  $('edit-social-ig').value = profile.socials?.ig || '';
  $('edit-social-x').value = profile.socials?.x || '';
  $('edit-social-git').value = profile.socials?.git || '';
  loadSessions();
})().catch(() => {});

async function loadSessions() {
  try {
    const { sessions } = await edge('/auth/sessions');
    const box = $('session-list'); box.innerHTML = '';
    sessions.forEach((s) => {
      const row = document.createElement('div'); row.className = 'toggle-row';
      const name = document.createElement('span'); name.textContent = `${s.device}${s.current ? ' (this device)' : ''}`;
      const when = document.createElement('span'); when.style.cssText = 'font-family:var(--font-mono); font-size:11px; color:var(--ink-soft);';
      when.textContent = new Date(s.lastSeen).toLocaleDateString([], { month: 'short', day: 'numeric' });
      row.append(name, when); box.appendChild(row);
    });
  } catch { $('session-list').textContent = 'Could not load.'; }
}

$('btn-save-os').addEventListener('click', (e) => merge('config', {
  broadcast: $('edit-broadcast').value.trim(),
  features: Object.fromEntries(['dashboard', 'drop', 'theater', 'radar'].map((k) => [k, $(`toggle-${k}`).checked])),
}, e.currentTarget));

$('btn-save-config').addEventListener('click', (e) => merge('config', {
  fontDisplay: $('config-font-display').value.trim(), fontBody: $('config-font-body').value.trim(), accentColor: $('config-accent').value,
}, e.currentTarget));

$('btn-save-profile').addEventListener('click', (e) => merge('profile', {
  heroTitle: $('edit-hero-title').value.trim(), heroSub: $('edit-hero-sub').value.trim(), bio: $('edit-bio').value.trim(),
  email: $('edit-email').value.trim(), vcardPhone: $('edit-vcard-phone').value.trim(),
  socials: { ig: $('edit-social-ig').value.trim(), x: $('edit-social-x').value.trim(), git: $('edit-social-git').value.trim() },
}, e.currentTarget));

$('btn-logout-others').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!confirm('Sign out every other phone, tablet and computer?')) return;
  try { await edge('/auth/logout-others', { method: 'POST', body: '{}' }); loadSessions(); btn.textContent = 'Done ✔'; } catch (err) { alert(err.message); }
});
