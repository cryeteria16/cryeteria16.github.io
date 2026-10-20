// Homepage data comes from the always-on helper (api.ibadhasan.com), so it works even when
// the home PC is off. No Firebase, no third-party trackers.
const EDGE = 'https://api.ibadhasan.com';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Count a visit once per browser session (city and country come from Cloudflare; no IP is kept)
try {
  if (!sessionStorage.getItem('visited')) {
    sessionStorage.setItem('visited', '1');
    fetch(`${EDGE}/public/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Portfolio View' }), keepalive: true }).catch(() => {});
  }
} catch (e) {}

// Navigation Logic
document.querySelectorAll('.pub-nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    document.querySelectorAll('.pub-nav-link').forEach(l => l.classList.remove('active')); 
    e.currentTarget.classList.add('active');
    document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
    document.getElementById(`pub-view-${e.currentTarget.getAttribute('data-pubtarget')}`).classList.add('active'); 
    layoutCloud();
    if(navigator.vibrate) navigator.vibrate(10);
  });
});

let vcardData = { name: "Ibad Hasan", phone: "", email: "" };
let publicPhotos = [];

// Profile and exhibition, set from The Lair's Settings
fetch(`${EDGE}/public/site`).then(r => r.json()).then(({ profile = {}, exhibition = [] }) => {
  const d = profile;
  if (d.heroTitle) document.getElementById('dynamic-hero-title').textContent = d.heroTitle;
  if (d.heroSub) document.getElementById('dynamic-hero-desc').textContent = d.heroSub;
  if (d.bio) document.getElementById('dynamic-bio-text').textContent = d.bio;
  if (d.email) {
    document.getElementById('contact-email-link').href = `mailto:${d.email}`;
    document.getElementById('contact-email-text').textContent = d.email;
  }
  if (d.vcardName) vcardData.name = d.vcardName;
  if (d.vcardPhone) vcardData.phone = d.vcardPhone;
  vcardData.email = d.email || '';
  publicPhotos = exhibition.map(x => ({ url: EDGE + x.url, dateFormatted: x.date }));
  renderSpatialCloud();
}).catch(() => {
  document.getElementById('dynamic-bio-text').textContent = 'Back soon.';
  document.getElementById('contact-email-text').textContent = 'Unavailable right now';
  renderSpatialCloud();
});

// Apple visionOS Spatial Portal Logic
const portalBtn = document.getElementById('btn-enter-spatial');
const portalWindow = document.getElementById('visionos-portal');
const spatialViewport = document.getElementById('spatial-viewport');
const spatialCloud = document.getElementById('spatial-cloud');
const exitBtn = document.getElementById('btn-exit-spatial');


// The photos float on the page as soon as it opens, no tap needed. "Enter Exhibition" still
// takes them full screen. The gentle bob is a CSS animation (cheap for the phone), not a script loop.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderSpatialCloud() {
    spatialCloud.innerHTML = '';
    if (!publicPhotos.length) {
        spatialCloud.innerHTML = '<p style="font-family:var(--font-mono); font-size:13px; color:var(--ink-soft); text-align:center; padding-top:200px;">New work is on its way.</p>';
        spatialViewport.classList.add('active');
        return;
    }

    publicPhotos.forEach((photo, idx) => {
        const card = document.createElement('div');
        card.className = 'floating-photo-card';

        // Randomizing drift and depth (picked once, so a resize doesn't make them jump)
        card.dataset.jx = Math.random() * 2 - 1;
        card.dataset.jy = Math.random() * 2 - 1;
        const z = (idx % 4) * 150 - 300;
        const rotY = (Math.random() * 20 - 10);
        const rotZ = (Math.random() * 6 - 3);
        card.style.transform = `translateZ(${z}px) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`;
        if (!reduceMotion) card.style.animationDelay = `${-idx * 2.1}s`;

        // Render the image
        card.innerHTML = `<img src="${esc(photo.url)}" alt="Photograph by Ibad Hasan" loading="lazy" decoding="async">
                          <span style="font-family:var(--font-mono); font-size:10px; color:var(--ink-soft); text-align:center;">${esc(photo.dateFormatted || 'Archive')}</span>`;

        spatialCloud.appendChild(card);
    });
    layoutCloud();
    spatialViewport.classList.add('active');
}

// Organic distribution on an ellipse that fits the window the photos are in (inline or full screen)
function layoutCloud() {
    const cards = spatialCloud.querySelectorAll('.floating-photo-card');
    if (!cards.length) return;
    const expanded = portalWindow.classList.contains('expanded');
    const w = expanded ? window.innerWidth : portalWindow.clientWidth;
    const h = expanded ? window.innerHeight : portalWindow.clientHeight;
    if (!w || !h) return; // not on screen (another section is open)
    const cw = cards[0].offsetWidth, ch = cards[0].offsetHeight;
    const rx = Math.max(0, Math.min(w * 0.4, 600, w / 2 - cw * 0.35));
    const ry = Math.max(0, Math.min(h / 2 - ch * 0.45, Math.max(rx * 0.5, h * 0.3)));
    const jitter = Math.min(50, w * 0.05);
    cards.forEach((card, idx) => {
        const angle = (idx / cards.length) * Math.PI * 2;
        const x = Math.cos(angle) * rx + card.dataset.jx * jitter;
        const y = Math.sin(angle) * ry + card.dataset.jy * jitter;
        card.style.left = `calc(50% + ${x - cw / 2}px)`;
        card.style.top = `calc(50% + ${y - ch / 2}px)`;
    });
}
let layoutQueued = false;
window.addEventListener('resize', () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layoutCloud(); });
});

// Handle Portal Expansion
portalBtn.addEventListener('click', () => {
    portalWindow.classList.add('expanded');
    layoutCloud();
    if (navigator.vibrate) navigator.vibrate(15);
    document.body.style.overflow = 'hidden'; // Lock background scrolling
});

exitBtn.addEventListener('click', () => {
    portalWindow.classList.remove('expanded');
    layoutCloud();
    spatialCloud.style.transform = '';
    document.body.style.overflow = 'auto';
});

// Spatial Parallax Tilt (Mouse Tracking)
window.addEventListener('mousemove', (e) => {
    if (!portalWindow.classList.contains('expanded') && !portalWindow.matches(':hover')) return;
    
    const xPct = (e.clientX / window.innerWidth) - 0.5;
    const yPct = (e.clientY / window.innerHeight) - 0.5;
    
    // Tilt the entire cloud based on mouse position
    spatialCloud.style.transform = `rotateY(${xPct * 25}deg) rotateX(${-yPct * 25}deg)`;
});

// V-Card Downloader
document.getElementById('btn-download-vcard').addEventListener('click', () => {
    if(navigator.vibrate) navigator.vibrate(15);
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardData.name}`];
    if (vcardData.phone) lines.push(`TEL;TYPE=CELL:${vcardData.phone}`);
    if (vcardData.email) lines.push(`EMAIL:${vcardData.email}`);
    lines.push('URL:https://ibadhasan.com', 'END:VCARD');
    const vcfStr = lines.join('\n');
    const blob = new Blob([vcfStr], { type: "text/vcard" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${vcardData.name.replace(/[^a-zA-Z0-9]/g, "_")}.vcf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});
