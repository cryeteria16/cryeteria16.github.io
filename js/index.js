// Homepage data comes from the always-on helper (api.ibadhasan.com), so it works even when
// the home PC is off. No Firebase, no third-party trackers.
const EDGE = 'https://api.ibadhasan.com';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Count a visit once per browser session (city and country come from Cloudflare; no IP is kept)
try {
  if (!sessionStorage.getItem('visited')) {
    sessionStorage.setItem('visited', '1');
    fetch(`${EDGE}/public/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Portfolio View' }), keepalive: true }).catch(() => {});
  }
} catch (e) {}

const year = new Date().getFullYear();
$('hero-year').textContent = `© ${year}`;
$('foot-year').textContent = `© ${year}`;

let vcardData = { name: 'Ibad Hasan', phone: '', email: '' };
let photos = [];

// "Hello, I'm Ada Lovelace" -> two lines: everything up to the name, then the name
function setTitle(text) {
  const t = String(text || '').trim();
  const m = /^(hello,?\s*i[’']?m)\s+(.+)$/i.exec(t);
  const [a, b] = m ? [m[1], m[2]] : ['Hello, I’m', t || 'Ibad Hasan'];
  $('hero-title').innerHTML = `<span>${esc(a)}</span><span>${esc(b)}</span>`;
}

// Profile and exhibition, set from The Lair's Settings
fetch(`${EDGE}/public/site`).then(r => r.json()).then(({ profile = {}, exhibition = [] }) => {
  const d = profile;
  if (d.heroTitle && /^hello/i.test(d.heroTitle.trim())) setTitle(d.heroTitle);
  if (d.heroSub) $('hero-sub').textContent = d.heroSub;
  $('bio').textContent = d.bio || 'Visuals and archive.';
  if (d.email) { $('email').href = `mailto:${d.email}`; $('email').textContent = d.email; }
  else { $('email').hidden = true; }
  if (d.vcardName) vcardData.name = d.vcardName;
  if (d.vcardPhone) vcardData.phone = d.vcardPhone;
  vcardData.email = d.email || '';
  photos = exhibition.map(x => ({ url: EDGE + x.url, date: x.date || '' }));
  renderGallery();
}).catch(() => {
  $('bio').textContent = 'Back soon.';
  $('email').hidden = true;
  renderGallery();
});

function renderGallery() {
  $('gallery-count').textContent = String(photos.length).padStart(2, '0');
  $('gallery-empty').hidden = photos.length > 0;
  document.querySelector('.arrows').hidden = photos.length === 0;
  $('strip').innerHTML = photos.map((p, i) =>
    `<figure class="gallery-card" data-i="${i}"><img src="${esc(p.url)}" alt="Photograph by Ibad Hasan" loading="${i < 4 ? 'eager' : 'lazy'}" decoding="async"><figcaption>${esc(p.date || String(i + 1).padStart(2, '0'))}</figcaption></figure>`).join('');
  // the few photos stacked behind the title
  $('hero-stack').innerHTML = photos.slice(0, 3).map(p => `<img src="${esc(p.url)}" alt="" decoding="async">`).join('');
}

// Arrows scroll the strip by about one photo
const step = () => ($('strip').querySelector('.gallery-card')?.offsetWidth || 300) + 16;
$('prev').addEventListener('click', () => $('strip').scrollBy({ left: -step(), behavior: 'smooth' }));
$('next').addEventListener('click', () => $('strip').scrollBy({ left: step(), behavior: 'smooth' }));

// Lightbox
let cur = 0;
function openLb(i) {
  cur = (i + photos.length) % photos.length;
  $('lb-img').src = photos[cur].url;
  $('lb-cap').textContent = `${String(cur + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}${photos[cur].date ? ' · ' + photos[cur].date : ''}`;
  $('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLb() { $('lightbox').hidden = true; $('lb-img').removeAttribute('src'); document.body.style.overflow = ''; }
$('strip').addEventListener('click', (e) => { const c = e.target.closest('.gallery-card'); if (c) openLb(Number(c.dataset.i)); });
$('lb-close').addEventListener('click', closeLb);
$('lb-prev').addEventListener('click', () => openLb(cur - 1));
$('lb-next').addEventListener('click', () => openLb(cur + 1));
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox') || e.target === $('lb-img')) closeLb(); });
document.addEventListener('keydown', (e) => {
  if ($('lightbox').hidden) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') openLb(cur - 1);
  if (e.key === 'ArrowRight') openLb(cur + 1);
});

// V-Card Downloader
$('vcard').addEventListener('click', () => {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardData.name}`];
  if (vcardData.phone) lines.push(`TEL;TYPE=CELL:${vcardData.phone}`);
  if (vcardData.email) lines.push(`EMAIL:${vcardData.email}`);
  lines.push('URL:https://ibadhasan.com', 'END:VCARD');
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/vcard' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${vcardData.name.replace(/[^a-zA-Z0-9]/g, '_')}.vcf`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
