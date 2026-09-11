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

onSnapshot(doc(db, 'system', 'profile'), (snap) => {
  if(snap.exists()) {
    const d = snap.data();
    if(d.email) { document.getElementById('contact-email-link').href = `mailto:${d.email}`; document.getElementById('contact-email-text').textContent = d.email; }
    if(d.vcardName) vcardData.name = d.vcardName;
    if(d.vcardPhone) vcardData.phone = d.vcardPhone;
  }
});

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