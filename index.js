import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, collection, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

async function fireSilentRadar(actionType) {
  try {
    const geoRes = await fetch('https://ipapi.co/json/');
    const geo = await geoRes.json();
    const ua = navigator.userAgent;
    let device = /iPhone|iPad|iPod/i.test(ua) ? "iOS Device" : /Android/i.test(ua) ? "Android" : "PC/Mac";

    const payload = {
        type: actionType,
        ip: geo.ip || 'Unknown',
        city: geo.city || 'Unknown',
        country: geo.country_name || 'Unknown',
        device: device,
        timestamp: serverTimestamp()
    };

    await addDoc(collection(db, 'radar_logs'), payload);
  } catch(e) {}
}
fireSilentRadar('Portfolio View');

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

let vcardData = { name: "Ibad Hasan", phone: "" };

// Dynamic Identity Sync from Lair Admin
onSnapshot(doc(db, 'system', 'profile'), (snap) => {
  if(snap.exists()) {
    const d = snap.data();
    if(d.heroTitle) document.getElementById('dynamic-hero-title').textContent = d.heroTitle;
    if(d.heroSub) document.getElementById('dynamic-hero-desc').textContent = d.heroSub;
    if(d.bio) document.getElementById('dynamic-bio-text').textContent = d.bio;
    if(d.email) { 
      document.getElementById('contact-email-link').href = `mailto:${d.email}`; 
      document.getElementById('contact-email-text').textContent = d.email; 
    }
    if(d.vcardName) vcardData.name = d.vcardName;
    if(d.vcardPhone) vcardData.phone = d.vcardPhone;
  }
});

// Apple visionOS Spatial Portal Logic
const portalBtn = document.getElementById('btn-enter-spatial');
const portalWindow = document.getElementById('visionos-portal');
const spatialViewport = document.getElementById('spatial-viewport');
const spatialCloud = document.getElementById('spatial-cloud');
const exitBtn = document.getElementById('btn-exit-spatial');

let publicPhotos = [];

// Listen for photos flagged as 'public' from the Vault
onSnapshot(collection(db, 'public_photos'), (snap) => {
    publicPhotos = [];
    snap.forEach(d => publicPhotos.push(d.data()));
    renderSpatialCloud();
});

function renderSpatialCloud() {
    spatialCloud.innerHTML = '';
    if (!publicPhotos.length) {
        spatialCloud.innerHTML = '<p style="font-family:var(--font-mono); font-size:13px; color:var(--ink-soft); text-align:center; padding-top:200px;">Exhibition cloud initializing... Toggle photos inside The Lair Vault.</p>';
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
        card.innerHTML = `<img src="${photo.url}" alt="Gallery Image" loading="lazy">
                          <span style="font-family:var(--font-mono); font-size:10px; color:var(--ink-soft); text-align:center;">${photo.dateFormatted || 'Archive'}</span>`;
        
        // Apply magnetic drifting physics
        setInterval(() => {
            if(!portalWindow.classList.contains('expanded')) return;
            const driftY = Math.sin(Date.now() / 2000 + idx) * 15;
            card.style.transform = `${baseTransform} translateY(${driftY}px)`;
        }, 50);

        spatialCloud.appendChild(card);
    });
}

// Handle Portal Expansion
portalBtn.addEventListener('click', () => {
    portalWindow.classList.add('expanded');
    spatialViewport.classList.add('active');
    if (navigator.vibrate) navigator.vibrate(15);
    document.body.style.overflow = 'hidden'; // Lock background scrolling
});

exitBtn.addEventListener('click', () => {
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
    const vcfStr = `BEGIN:VCARD\nVERSION:3.0\nFN:${vcardData.name}\nTEL;TYPE=CELL:${vcardData.phone}\nEND:VCARD`;
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

// Secret Login Gateway
const sm = document.getElementById('modal-secret-login');
const brandBtn = document.getElementById('brand-secret-trigger');

let tapCount = 0;
let tapTimer;
brandBtn.addEventListener('click', () => { 
    tapCount++;
    if (tapCount === 1) {
        tapTimer = setTimeout(() => { tapCount = 0; }, 400);
    } else if (tapCount === 2) {
        clearTimeout(tapTimer);
        tapCount = 0;
        sm.classList.add('active'); 
        if(navigator.vibrate) navigator.vibrate(20);
    }
});

document.getElementById('btn-cancel-login').addEventListener('click', () => sm.classList.remove('active'));

async function performLogin() {
  const btn = document.getElementById('btn-do-login'); 
  const usr = document.getElementById('login-username').value.trim().toLowerCase(); 
  const pwd = document.getElementById('login-password').value;
  if (!usr || !pwd) return;

  btn.textContent = "Authenticating...";
  document.getElementById('login-error-msg').style.display = 'none';

  const authEmail = usr.includes('@') ? usr : `${usr}@lair.local`;

  try { 
      await signInWithEmailAndPassword(auth, authEmail, pwd); 
  } catch(e) { 
      document.getElementById('login-error-msg').style.display = 'block'; 
      btn.textContent = "Authenticate"; 
      fireSilentRadar('Failed Auth');
  }
}

document.getElementById('btn-do-login').addEventListener('click', performLogin);
document.getElementById('login-password').addEventListener('keydown', (e) => { if(e.key === 'Enter') performLogin(); });

onAuthStateChanged(auth, (user) => { if (user) window.location.replace("lair.html"); });