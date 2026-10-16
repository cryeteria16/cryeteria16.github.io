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


function renderSpatialCloud() {
    spatialCloud.innerHTML = '';
    if (!publicPhotos.length) {
        spatialCloud.innerHTML = '<p style="font-family:var(--font-mono); font-size:13px; color:var(--ink-soft); text-align:center; padding-top:200px;">New work is on its way.</p>';
        return;
    }

    const count = publicPhotos.length;
    publicPhotos.forEach((photo, idx) => {
        const card = document.createElement('div');
        card.className = 'floating-photo-card';

        // Organic 3D coordinate distribution algorithm
        const angle = (idx / count) * Math.PI * 2;
        const radius = Math.min(window.innerWidth * 0.4, 600); 
        
        // Randomizing drift and depth
        const x = Math.cos(angle) * radius + (Math.random() * 100 - 50);
        const y = Math.sin(angle) * (radius * 0.5) + (Math.random() * 100 - 50);
        const z = (idx % 4) * 150 - 300; 
        const rotY = (Math.random() * 20 - 10);
        const rotZ = (Math.random() * 6 - 3);

        card.style.left = `calc(50% + ${x - 120}px)`;
        card.style.top = `calc(50% + ${y - 160}px)`;
        
        // Store base transform so hover can return to it
        const baseTransform = `translateZ(${z}px) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`;
        card.style.transform = baseTransform;
        card.dataset.baseTransform = baseTransform;

        // Render the image
        card.innerHTML = `<img src="${esc(photo.url)}" alt="Photograph by Ibad Hasan" loading="lazy" decoding="async">
                          <span style="font-family:var(--font-mono); font-size:10px; color:var(--ink-soft); text-align:center;">${esc(photo.dateFormatted || 'Archive')}</span>`;
        
        spatialCloud.appendChild(card);
    });
}

// Magnetic drift: one animation loop for all cards, running only while the exhibition is open
let driftFrame = null;
function drift() {
    const t = Date.now() / 2000;
    spatialCloud.querySelectorAll('.floating-photo-card').forEach((card, idx) => {
        card.style.transform = `${card.dataset.baseTransform} translateY(${Math.sin(t + idx) * 15}px)`;
    });
    driftFrame = requestAnimationFrame(drift);
}

// Handle Portal Expansion
portalBtn.addEventListener('click', () => {
    if (!driftFrame) driftFrame = requestAnimationFrame(drift);
    portalWindow.classList.add('expanded');
    spatialViewport.classList.add('active');
    if (navigator.vibrate) navigator.vibrate(15);
    document.body.style.overflow = 'hidden'; // Lock background scrolling
});

exitBtn.addEventListener('click', () => {
    cancelAnimationFrame(driftFrame); driftFrame = null;
    portalWindow.classList.remove('expanded');
    spatialViewport.classList.remove('active');
    document.body.style.overflow = 'auto';
});

// Spatial Parallax Tilt (Mouse Tracking)
window.addEventListener('mousemove', (e) => {
    if (!spatialViewport.classList.contains('active')) return;
    
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
