import { onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

let currentUser = null;

onAuthStateChanged(auth, (user) => { 
  if (!user) window.location.replace("index.html"); 
  
  currentUser = { id: user.uid };
  
  onSnapshot(doc(db, 'users', currentUser.id), (snap) => {
      if(!snap.exists() || snap.data().role !== 'admin') {
          alert('Unauthorized: Admin privileges required.');
          window.location.replace("lair.html");
          return;
      }
      if(snap.data().theme) { document.body.setAttribute('data-theme', snap.data().theme); }
  });

  onSnapshot(doc(db, 'system', 'notifications'), (snap) => {
    if(snap.exists()) {
      const d = snap.data();
      document.getElementById('notify-visitor').checked = d.visitor !== false;
      document.getElementById('notify-guest').checked = d.guest !== false;
    }
  });
  
  onSnapshot(doc(db, 'system', 'config'), (snap) => {
    if(snap.exists() && document.activeElement.tagName !== "INPUT") {
      const d = snap.data();
      if(d.accentColor) { 
        document.getElementById('config-accent').value = d.accentColor; 
        document.documentElement.style.setProperty('--accent', d.accentColor); 
      }
      if(d.fontDisplay) document.getElementById('config-font-display').value = d.fontDisplay;
      if(d.fontBody) document.getElementById('config-font-body').value = d.fontBody;
      if(d.broadcast) document.getElementById('edit-broadcast').value = d.broadcast;
      if(d.features) {
          document.getElementById('toggle-theater').checked = d.features.theater !== false;
          document.getElementById('toggle-voice').checked = d.features.voice !== false;
          document.getElementById('toggle-radar').checked = d.features.radar !== false;
      }
    }
  });

  onSnapshot(doc(db, 'system', 'profile'), (snap) => {
    if(snap.exists() && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
      const d = snap.data();
      document.getElementById('edit-hero-title').value = d.heroTitle || ''; 
      document.getElementById('edit-hero-sub').value = d.heroSub || '';
      document.getElementById('edit-bio').value = d.bio || ''; 
      document.getElementById('edit-email').value = d.email || '';
      document.getElementById('edit-social-ig').value = d.socials?.ig || ''; 
      document.getElementById('edit-social-x').value = d.socials?.x || ''; 
      document.getElementById('edit-social-git').value = d.socials?.git || '';
    }
  });
});

document.getElementById('btn-save-notifications').addEventListener('click', async () => {
  await setDoc(doc(db, 'system', 'notifications'), { 
    visitor: document.getElementById('notify-visitor').checked,
    guest: document.getElementById('notify-guest').checked
  }, { merge: true }); 
  alert('Matrix Updated');
});

document.getElementById('btn-save-os').addEventListener('click', async () => {
  const broadcast = document.getElementById('edit-broadcast').value;
  const features = { 
    theater: document.getElementById('toggle-theater').checked,
    voice: document.getElementById('toggle-voice').checked, 
    radar: document.getElementById('toggle-radar').checked 
  };
  await setDoc(doc(db, 'system', 'config'), { broadcast, features }, { merge: true }); 
  alert('OS Controls Updated');
});

document.getElementById('btn-save-profile').addEventListener('click', async () => {
  const data = {
    heroTitle: document.getElementById('edit-hero-title').value, 
    heroSub: document.getElementById('edit-hero-sub').value,
    bio: document.getElementById('edit-bio').value, 
    email: document.getElementById('edit-email').value,
    socials: { 
      ig: document.getElementById('edit-social-ig').value, 
      x: document.getElementById('edit-social-x').value, 
      git: document.getElementById('edit-social-git').value 
    }
  };
  await setDoc(doc(db, 'system', 'profile'), data, { merge: true }); 
  alert('Identity Published');
});

document.getElementById('btn-save-config').addEventListener('click', async () => {
  await setDoc(doc(db, 'system', 'config'), { 
    fontDisplay: document.getElementById('config-font-display').value.trim(), 
    fontBody: document.getElementById('config-font-body').value.trim(), 
    accentColor: document.getElementById('config-accent').value 
  }, { merge: true }); 
  alert('Aesthetics Applied');
});

document.getElementById('btn-update-password').addEventListener('click', async () => {
  const newPwd = document.getElementById('edit-password').value; 
  const msg = document.getElementById('pwd-msg');
  if(newPwd.length < 6) { 
    msg.textContent = "Must be at least 6 characters."; 
    msg.style.color = "var(--err)"; 
    msg.style.display = "block"; 
    return; 
  }
  try { 
    await updatePassword(auth.currentUser, newPwd); 
    msg.textContent = "Password updated successfully."; 
    msg.style.color = "var(--con)"; 
    msg.style.display = "block"; 
    document.getElementById('edit-password').value = ''; 
  } catch(e) { 
    msg.textContent = "Error: Please sign out and sign back in to update password."; 
    msg.style.color = "var(--err)"; 
    msg.style.display = "block"; 
  }
});