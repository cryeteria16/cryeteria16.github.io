import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, collection, onSnapshot, query, orderBy, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const TUNNEL_URL = "https://vault.ibadhasan.com"; 

// Escape text written by other people (visitor logs, chat names, watchlist) before it goes into HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currentUser = null;
let activeLightboxFile = null;
let userAdminPin = "0000"; 

window.showToast = (msg, type = 'info') => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `lair-toast ${type}`;
  const icon = type === 'success' ? '✔' : type === 'error' ? '✖' : '●';
  toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'all 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px) scale(0.92)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

window.showConfirm = (title, msg) => {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    modal.classList.add('active');

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      document.getElementById('btn-confirm-ok').removeEventListener('click', onOk);
      document.getElementById('btn-confirm-cancel').removeEventListener('click', onCancel);
      modal.classList.remove('active');
    };

    document.getElementById('btn-confirm-ok').addEventListener('click', onOk);
    document.getElementById('btn-confirm-cancel').addEventListener('click', onCancel);
  });
};

function initParallax() {
  const wallpaper = document.getElementById('diurnal-wallpaper');
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    window.addEventListener('click', () => {
      DeviceOrientationEvent.requestPermission().then(res => {
        if (res === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
        }
      }).catch(() => {});
    }, { once: true });
  } else if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', handleOrientation);
  }

  function handleOrientation(e) {
    if (!e.gamma || !e.beta) return;
    const xOffset = Math.max(-14, Math.min(14, e.gamma * 0.4));
    const yOffset = Math.max(-14, Math.min(14, (e.beta - 40) * 0.4));
    wallpaper.style.transform = `translate3d(${xOffset}px, ${yOffset}px, 0)`;
  }
}
initParallax();

function updateDiurnalCycle() {
  const dxbHour = parseInt(new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false }), 10);
  const root = document.documentElement;
  if (document.body.getAttribute('data-theme') === 'light') return;

  if (dxbHour >= 6 && dxbHour < 17) {
    root.style.setProperty('--aurora-1', '#16241c');
    root.style.setProperty('--aurora-2', '#12202c');
  } else if (dxbHour >= 17 && dxbHour < 19) {
    root.style.setProperty('--aurora-1', '#2d1f18');
    root.style.setProperty('--aurora-2', '#1b1424');
  } else {
    root.style.setProperty('--aurora-1', '#0b1410');
    root.style.setProperty('--aurora-2', '#090f15');
  }
}

const triggerHaptic = () => { 
    if(navigator.vibrate) navigator.vibrate(15);
    try {
        const iosHack = document.createElement('input');
        iosHack.type = 'checkbox'; iosHack.setAttribute('switch', ''); iosHack.style.position = 'absolute'; iosHack.style.left = '-9999px';
        document.body.appendChild(iosHack); iosHack.click(); iosHack.remove();
    } catch(e) {}
};
document.querySelectorAll('.haptic-btn').forEach(b => b.addEventListener('click', triggerHaptic));

let touchStartX = 0; let touchStartY = 0;
const swipeZone = document.getElementById('swipe-zone');

swipeZone.addEventListener('touchstart', e => { 
    touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

swipeZone.addEventListener('touchend', e => {
    if (e.target.closest('#command-bay-grid, #tmdb-results, #shared-watchlist, .os-dock, input, textarea, .artplayer-app, table, #fridge-magnet')) return;
    const diffX = touchStartX - e.changedTouches[0].screenX; const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffY) > Math.abs(diffX)) return;

    const views = ['dashboard', 'drop', 'theater', 'voice'];
    const activeIdx = views.findIndex(v => document.getElementById(`view-${v}`).classList.contains('active'));
    
    if (diffX > 80 && activeIdx < views.length - 1) { 
        triggerHaptic(); document.querySelector(`.dock-app[data-target="${views[activeIdx+1]}"]`).click();
    } else if (diffX < -80 && activeIdx > 0) {
        triggerHaptic(); document.querySelector(`.dock-app[data-target="${views[activeIdx-1]}"]`).click();
    }
}, {passive: true});

function syncEnvironment() {
    try {
        const now = new Date();
        document.getElementById('clock-dxb').textContent = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Dubai', hour:'2-digit', minute:'2-digit', hour12:false });
        document.getElementById('clock-pkt').textContent = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour:'2-digit', minute:'2-digit', hour12:false });
        updateDiurnalCycle();
    } catch(e) {}
}
setInterval(syncEnvironment, 1000); syncEnvironment();

async function fetchWithAuth(url, options = {}) {
    if (!auth.currentUser) return fetch(url, options);
    if (url.includes('?token=')) return fetch(url, options); 
    const token = await auth.currentUser.getIdToken();
    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    return fetch(url, { ...options, headers });
}

const termIn = document.getElementById('terminal-in');
const termOut = document.getElementById('terminal-out');
termIn.addEventListener('keydown', async (e) => {
    if(e.key === 'Enter' && termIn.value.trim() !== '') {
        const cmd = termIn.value.trim();
        termIn.value = ''; triggerHaptic();
        termOut.innerHTML += `<div><span style="color:#0f0;">$</span> <span style="color:#fff;">${cmd}</span></div>`;
        termOut.scrollTop = termOut.scrollHeight;
        
        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/terminal`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd })
            });
            const data = await res.json();
            termOut.innerHTML += `<div style="color:var(--ink-soft); margin-bottom:8px;">${(data.output || 'Done.').replace(/\n/g, '<br>')}</div>`;
        } catch(err) {
            termOut.innerHTML += `<div style="color:var(--err); margin-bottom:8px;">> Connection failed.</div>`;
        }
        termOut.scrollTop = termOut.scrollHeight;
    }
});

let statsTimer = null;
async function pollSystemStats() {
    try {
        const res = await fetchWithAuth(`${TUNNEL_URL}/api/stats`);
        if (res.ok) {
            const stats = await res.json();
            document.getElementById('sys-cpu').textContent = `${stats.cpu}%`;
            document.getElementById('sys-ram').textContent = `${stats.ram}%`;
            document.getElementById('health-dot').style.color = "var(--con)";
            document.getElementById('health-text').textContent = "LINK ACTIVE";
        } else { throw new Error(); }
    } catch(e) {
        document.getElementById('health-dot').style.color = "var(--err)";
        document.getElementById('health-text').textContent = "TUNNEL OFFLINE";
    }
}

function setupAdaptivePolling() {
  if (statsTimer) clearInterval(statsTimer);
  const interval = document.visibilityState === 'visible' ? 4000 : 30000;
  pollSystemStats();
  statsTimer = setInterval(pollSystemStats, interval);
}
document.addEventListener('visibilitychange', setupAdaptivePolling);

onAuthStateChanged(auth, (user) => {
  if (!user) window.location.replace("index.html");
  currentUser = { name: user.email.split('@')[0], id: user.uid };
  
  onSnapshot(doc(db, 'users', currentUser.id), (snap) => {
      if(snap.exists()) {
          if (snap.data().role === 'admin') {
              document.getElementById('dock-admin-link').style.display = 'block';
              if (snap.data().adminPin) {
                  userAdminPin = snap.data().adminPin;
              }
          }
      }
  });
  
  initOS();
});

document.getElementById('btn-signout').addEventListener('click', () => { signOut(auth); window.location.replace("index.html"); });

document.querySelectorAll('.app-link').forEach(link => {
  link.addEventListener('click', (e) => {
    document.querySelectorAll('.dock-app').forEach(d => d.classList.remove('active')); 
    e.currentTarget.classList.add('active');
    document.querySelectorAll('.view-container').forEach(w => w.classList.remove('active'));
    
    const target = e.currentTarget.getAttribute('data-target');
    document.getElementById(`view-${target}`).classList.add('active'); 
    
    const fab = document.getElementById('btn-quick-capture');
    if (fab) fab.style.display = target === 'drop' ? 'flex' : 'none';

    window.scrollTo(0,0);
  });
});

function initOS() {
  setupAdaptivePolling();

  const presenceRef = doc(db, 'users', currentUser.id);
  const setOnline = () => setDoc(presenceRef, { state: 'online', name: currentUser.name, lastActive: serverTimestamp() }, {merge: true});
  const setOffline = () => setDoc(presenceRef, { state: 'offline', lastActive: serverTimestamp() }, {merge: true});

  window.addEventListener('visibilitychange', () => document.visibilityState === 'visible' ? setOnline() : setOffline());
  window.addEventListener('beforeunload', setOffline);
  setOnline();

  onSnapshot(collection(db, 'users'), (snap) => {
     snap.forEach(d => {
        if(d.id !== currentUser.id && d.data().name) {
           const isOnline = d.data().state === 'online';
           document.getElementById('partner-dot').style.color = isOnline ? 'var(--con)' : 'var(--err)';
           document.getElementById('partner-name').textContent = isOnline ? `${d.data().name} (Active)` : `${d.data().name} (Offline)`;
        }
     });
  });

  // ==== GLOBAL THEME SYSTEM ====
  const themeBtn = document.getElementById('btn-theme-toggle');
  themeBtn.addEventListener('click', () => {
      const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setDoc(doc(db, 'system', 'config'), { theme: newTheme }, { merge: true });
  });

  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.get('share') === 'true') {
      window.showToast('Shared item received.', 'success');
      document.querySelector('.dock-app[data-target="drop"]').click();
      window.history.replaceState({}, document.title, window.location.pathname);
  }

  const fridgeText = document.getElementById('fridge-door-text');
  const fridgeStatus = document.getElementById('fridge-status');
  const fridgeCard = document.getElementById('fridge-card');
  let fridgeTimeout; let isTyping = false; let glowTimeout;

 onSnapshot(doc(db, 'system', 'fridge_door'), (snap) => {
      if(snap.exists()) {
          const data = snap.data();
          // Populate text box on load or partner update, as long as you aren't actively typing inside it
          if (!isTyping && document.activeElement !== fridgeText) {
              fridgeText.value = data.content || '';
              if (data.updatedBy !== currentUser.id) {
                  fridgeStatus.textContent = `Last edit: ${data.updatedByName || 'Partner'}`;
                  fridgeCard.classList.add('ambient-typing');
                  clearTimeout(glowTimeout);
                  glowTimeout = setTimeout(() => fridgeCard.classList.remove('ambient-typing'), 3500);
              } else {
                  fridgeStatus.textContent = 'Synced';
              }
          }
      }
  });

  fridgeText.addEventListener('input', () => {
      isTyping = true; fridgeStatus.textContent = 'Typing...'; clearTimeout(fridgeTimeout);
      fridgeTimeout = setTimeout(async () => {
          await setDoc(doc(db, 'system', 'fridge_door'), { content: fridgeText.value, updatedBy: currentUser.id, updatedByName: currentUser.name, timestamp: serverTimestamp() }, {merge: true});
          isTyping = false; fridgeStatus.textContent = 'Saved to Cloud';
      }, 500); 
  });
  
  // ==== FRIDGE DOOR: GOOGLE SHEETS LOGGING ====
  fridgeText.addEventListener('blur', () => { 
      isTyping = false; 
      fetchWithAuth(`${TUNNEL_URL}/api/fridge/log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fridgeText.value, user: currentUser.name })
      }).catch(e => console.log('Silently failed to log to Sheets', e));
  });

  initWatchParty(); initVault(); initTheaterChat(); initWatchlist(); initConfigAndFeatures(); initRadarFeed(); initVoiceRoom(); initAdminPinPad();

}

// ==== THE FRIDGE MAGNET (DRAWING BOARD) ====

function initAdminPinPad() {
    const adminBtn = document.getElementById('dock-admin-link');
    const pinModal = document.getElementById('pin-modal');
    const pinDots = document.querySelectorAll('.pin-dot');
    let currentPin = '';

    const updateDots = () => { pinDots.forEach((dot, idx) => { dot.style.background = idx < currentPin.length ? 'var(--ink)' : 'transparent'; }); };

    adminBtn.addEventListener('click', (e) => {
        e.preventDefault(); triggerHaptic(); currentPin = ''; updateDots(); pinModal.classList.add('active');
    });

    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            triggerHaptic();
            if(btn.id === 'btn-pin-delete') { currentPin = currentPin.slice(0, -1); } else if(btn.dataset.num && currentPin.length < 4) { currentPin += btn.dataset.num; }
            updateDots();
            
            if (currentPin.length === 4) {
                setTimeout(() => {
                    if (currentPin === userAdminPin) { window.location.href = 'admin.html'; } else {
                        const dotsContainer = document.getElementById('pin-dots'); dotsContainer.classList.add('shake');
                        if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
                        setTimeout(() => { dotsContainer.classList.remove('shake'); currentPin = ''; updateDots(); }, 400);
                    }
                }, 100);
            }
        });
    });
}

function initTheaterChat() {
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');

    const renderMsg = (m) => {
        const mine = m.uid === currentUser.id;
        const row = document.createElement('div');
        row.style.cssText = `align-self:${mine ? 'flex-end' : 'flex-start'}; max-width:80%; background:${mine ? 'var(--accent)' : 'var(--input-bg)'}; color:${mine ? '#000' : 'var(--ink)'}; padding:8px 14px; border-radius:16px; font-size:13px;`;
        
        // Format Firestore timestamp safely
        const timeStr = m.timestamp?.toDate ? m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';

        if (!mine || timeStr) { 
            const metaDiv = document.createElement('div'); 
            metaDiv.style.cssText = 'font-family:var(--font-mono); font-size:10px; opacity:0.7; margin-bottom:2px; display:flex; justify-content:space-between; gap:12px;';
            metaDiv.innerHTML = `<span>${!mine ? esc(m.name) : ''}</span><span>${timeStr}</span>`;
            row.appendChild(metaDiv); 
        }
        row.appendChild(document.createTextNode(m.text)); return row;
    };

    onSnapshot(query(collection(db, 'chat'), orderBy('timestamp', 'asc'), limit(100)), (snap) => {
        chatWindow.innerHTML = ''; snap.forEach(d => chatWindow.appendChild(renderMsg(d.data()))); chatWindow.scrollTop = chatWindow.scrollHeight;
    });

    const sendChat = async () => {
        const text = chatInput.value.trim(); if (!text) return;
        chatInput.value = ''; triggerHaptic();
        await addDoc(collection(db, 'chat'), { text, name: currentUser.name, uid: currentUser.id, timestamp: serverTimestamp() });
    };
    document.getElementById('btn-send-chat').addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
}

function initWatchlist() {
    const listEl = document.getElementById('shared-watchlist');
    onSnapshot(query(collection(db, 'watchlist'), orderBy('timestamp', 'desc'), limit(40)), (snap) => {
        if (snap.empty) { listEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Watchlist is empty. Search TMDB above to add something.</p>'; return; }
        listEl.innerHTML = '';
        snap.forEach(docSnap => {
            const m = docSnap.data(); const card = document.createElement('div'); card.style.cssText = 'width:110px; cursor:pointer;';
            card.innerHTML = `
                <div style="width:110px; height:160px; border-radius:12px; background:${m.poster ? `url('${m.poster}') center/cover` : 'var(--input-bg)'}; border:var(--glass-border); margin-bottom:6px;"></div>
                <div style="font-size:11px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.title)}</div>
                <div style="font-size:10px; color:${m.streamUrl ? 'var(--con)' : 'var(--ink-soft)'}; margin-top:2px;">${m.streamUrl ? '▶ Play in Theater' : '🔗 Link Media File'}</div>
            `;
            
            card.addEventListener('click', async () => { 
                triggerHaptic(); 
                if (m.streamUrl) {
                    document.querySelector('.dock-app[data-target="theater"]').click(); 
                    document.getElementById('theater-join-overlay').style.display = 'none'; 
                    const { mountMediaFromWatchlist } = window.__lairTheater || {}; 
                    if (mountMediaFromWatchlist) mountMediaFromWatchlist(m.streamUrl); 
                } else {
                    const url = prompt(`Paste direct video URL (from Vault or YouTube) to permanently link it to ${m.title}:`);
                    if (url && url.trim() !== '') {
                        await updateDoc(docSnap.ref, { streamUrl: url.trim() });
                        window.showToast('Media linked successfully', 'success');
                    }
                }
            }); 
            listEl.appendChild(card);
        });
    });

    const resultsEl = document.getElementById('tmdb-results'); const searchInput = document.getElementById('tmdb-search-input');
    const runSearch = async () => {
        const qStr = searchInput.value.trim(); if (!qStr) return; resultsEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Searching...</p>';
        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/tmdb/search?q=${encodeURIComponent(qStr)}`); const data = await res.json();
            if (!res.ok) { resultsEl.innerHTML = `<p style="font-size:12px; color:var(--err);">${data.error || 'Search failed.'}</p>`; return; }
            if (!data.results.length) { resultsEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">No results.</p>'; return; }
            resultsEl.innerHTML = '';
            data.results.forEach(r => {
                const card = document.createElement('div'); card.style.cssText = 'width:110px;';
                card.innerHTML = `<div style="width:110px; height:160px; border-radius:12px; background:${r.poster ? `url('${r.poster}') center/cover` : 'var(--input-bg)'}; border:var(--glass-border); margin-bottom:6px;"></div><div style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title} ${r.year ? `(${r.year})` : ''}</div><button class="btn-secondary haptic-btn" style="width:100%; margin-top:4px; padding:6px; font-size:10px;">+ Add</button>`;
                card.querySelector('button').addEventListener('click', async () => {
                    triggerHaptic(); await addDoc(collection(db, 'watchlist'), { title: r.title, poster: r.poster, type: r.type, status: 'Want to Watch', streamUrl: '', addedBy: currentUser.name, timestamp: serverTimestamp() });
                    window.showToast(`Added ${r.title} to Watchlist`, 'success');
                });
                resultsEl.appendChild(card);
            });
        } catch (e) { resultsEl.innerHTML = '<p style="font-size:12px; color:var(--err);">Search failed.</p>'; }
    };
    document.getElementById('btn-tmdb-search').addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}

function initConfigAndFeatures() {
    onSnapshot(doc(db, 'system', 'config'), (snap) => {
        if (!snap.exists()) return; const d = snap.data();
        
        if (d.theme) {
            document.body.setAttribute('data-theme', d.theme);
            const themeBtnText = document.querySelector('#btn-theme-toggle .nav-btn-text');
            const themeBtnIcon = document.getElementById('icon-theme');
            const isLight = d.theme === 'light';
            if(themeBtnText) themeBtnText.textContent = isLight ? '🌙 Dark' : '☀️ Light';
            if(themeBtnIcon) themeBtnIcon.textContent = isLight ? '🌙' : '☀️';
            const meta = document.getElementById('meta-theme-color');
            if(meta) meta.setAttribute('content', isLight ? '#F2F2F7' : '#060709');
        }

        const banner = document.getElementById('broadcast-banner');
        if (d.broadcast) { banner.textContent = d.broadcast; banner.style.display = 'block'; } else { banner.style.display = 'none'; }
        if (d.accentColor) document.documentElement.style.setProperty('--accent', d.accentColor);
        if (d.fontDisplay || d.fontBody) {
            const families = [d.fontDisplay, d.fontBody].filter(Boolean).map(f => f.trim().replace(/ /g, '+'));
            document.getElementById('dynamic-fonts').href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}:wght@400;500;600`).join('&')}&display=swap`;
            if (d.fontDisplay) document.documentElement.style.setProperty('--font-display', `'${d.fontDisplay}', serif`);
            if (d.fontBody) document.documentElement.style.setProperty('--font-body', `'${d.fontBody}', sans-serif`);
        }
        const f = d.features || {};
        document.getElementById('dock-dashboard-link').style.display = f.dashboard === false ? 'none' : 'block';
        document.getElementById('dock-drop-link').style.display = f.drop === false ? 'none' : 'block';
        document.getElementById('dock-theater-link').style.display = f.theater === false ? 'none' : 'block';
        document.getElementById('dock-voice-link').style.display = f.voice === false ? 'none' : 'block';
        
        const radarCard = document.getElementById('radar-feed')?.closest('.card'); if (radarCard) radarCard.style.display = f.radar === false ? 'none' : 'flex';
        const activeTarget = document.querySelector('.dock-app.active')?.getAttribute('data-target');
        if ((activeTarget === 'dashboard' && f.dashboard === false) || (activeTarget === 'drop' && f.drop === false) || (activeTarget === 'theater' && f.theater === false) || (activeTarget === 'voice' && f.voice === false)) {
            const firstAvailable = document.querySelector('.dock-app[style*="display: block"], .dock-app:not([style*="display: none"])');
            if (firstAvailable) firstAvailable.click();
        }
    });
}

function initRadarFeed() {
    const feed = document.getElementById('radar-feed');
    onSnapshot(query(collection(db, 'radar_logs'), orderBy('timestamp', 'desc'), limit(20)), (snap) => {
        if (snap.empty) { feed.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Waiting for telemetry...</p>'; return; }
        feed.innerHTML = '';
        snap.forEach(d => {
            const r = d.data(); const row = document.createElement('div'); row.className = 'radar-row';
            const when = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            row.innerHTML = `<span>${esc(r.type || 'Visit')} — ${esc(r.city || 'Unknown')}, ${esc(r.country || '')}</span><span style="color:var(--ink-soft); font-family:var(--font-mono); font-size:11px;">${when}</span>`;
            feed.appendChild(row);
        });
    });
}

function initVoiceRoom() {
    const ROOM_ID = 'main-room'; const roomRef = doc(db, 'voice_calls', ROOM_ID);
    const callerCandidatesRef = collection(roomRef, 'callerCandidates'); const calleeCandidatesRef = collection(roomRef, 'calleeCandidates');
    const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

    let pc = null; let localStream = null; let remoteStream = null; let role = null; 
    let unsubRoom = null, unsubCandidates = null; let analyser = null, analyserRaf = null; let heartbeatTimer = null;

    const orb = document.getElementById('voice-orb'); const orbLabel = document.getElementById('voice-orb-label');
    const statusDot = document.getElementById('voice-status-dot'); const statusText = document.getElementById('voice-status-text');
    const btnJoin = document.getElementById('btn-voice-join'); const btnMute = document.getElementById('btn-voice-mute');
    const btnLeave = document.getElementById('btn-voice-leave'); const remoteAudioEl = document.getElementById('voice-remote-audio');

    const setUiState = (state) => {
        if (state === 'idle') {
            orbLabel.textContent = 'Idle'; statusDot.style.color = 'var(--err)'; statusText.textContent = 'Not connected';
            btnJoin.style.display = 'flex'; btnMute.style.display = 'none'; btnLeave.style.display = 'none';
        } else if (state === 'waiting') {
            orbLabel.textContent = 'Ringing…'; statusDot.style.color = 'var(--warn)'; statusText.textContent = 'Waiting for the other side to join';
            btnJoin.style.display = 'none'; btnMute.style.display = 'flex'; btnLeave.style.display = 'flex';
        } else if (state === 'connected') {
            orbLabel.textContent = 'Live'; statusDot.style.color = 'var(--con)'; statusText.textContent = 'Connected';
            btnJoin.style.display = 'none'; btnMute.style.display = 'flex'; btnLeave.style.display = 'flex';
        }
    };

    const startHeartbeat = () => { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = setInterval(async () => { try { await updateDoc(roomRef, { heartbeat: serverTimestamp() }); } catch(e) {} }, 15000); };
    const stopHeartbeat = () => { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; };

    const watchRemoteVolume = (stream) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)(); const source = ctx.createMediaStreamSource(stream);
            analyser = ctx.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => { analyser.getByteFrequencyData(data); const avg = data.reduce((a, b) => a + b, 0) / data.length; orb.classList.toggle('speaking', avg > 12); analyserRaf = requestAnimationFrame(tick); };
            tick();
        } catch (e) {}
    };

    async function cleanupPeer() {
        stopHeartbeat(); if (analyserRaf) cancelAnimationFrame(analyserRaf); analyser = null;
        if (unsubRoom) { unsubRoom(); unsubRoom = null; } if (unsubCandidates) { unsubCandidates(); unsubCandidates = null; }
        if (pc) { pc.close(); pc = null; } if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        remoteStream = null; remoteAudioEl.srcObject = null; role = null; orb.classList.remove('speaking');
    }

    async function hangUp(deleteRoom) {
        triggerHaptic(); await cleanupPeer();
        if (deleteRoom) {
            try {
                const [callerDocs, calleeDocs] = await Promise.all([getDocs(callerCandidatesRef), getDocs(calleeCandidatesRef)]);
                await Promise.all([...callerDocs.docs.map(d => deleteDoc(d.ref)), ...calleeDocs.docs.map(d => deleteDoc(d.ref))]);
                await deleteDoc(roomRef);
            } catch (e) {}
        }
        setUiState('idle'); window.showToast('Call ended');
    }

    btnLeave.addEventListener('click', () => hangUp(true));

    btnMute.addEventListener('click', () => {
        if (!localStream) return; const track = localStream.getAudioTracks()[0]; track.enabled = !track.enabled;
        btnMute.classList.toggle('muted', !track.enabled); triggerHaptic(); window.showToast(track.enabled ? 'Microphone unmuted' : 'Microphone muted');
    });

    btnJoin.addEventListener('click', async () => {
        triggerHaptic();
        try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); } catch (e) { window.showToast('Microphone access is required', 'error'); return; }

        pc = new RTCPeerConnection(rtcConfig); localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        remoteStream = new MediaStream(); remoteAudioEl.srcObject = remoteStream;
        pc.ontrack = (event) => { event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t)); watchRemoteVolume(remoteStream); };

        const existingSnap = await getDoc(roomRef); let existing = existingSnap.exists() ? existingSnap.data() : null;

        if (existing && existing.heartbeat) {
          if (Date.now() - existing.heartbeat.toMillis() > 35000) { await deleteDoc(roomRef); existing = null; }
        }

        if (!existing || !existing.offer || (existing.status === 'ended')) {
            role = 'caller'; pc.onicecandidate = (e) => { if (e.candidate) addDoc(callerCandidatesRef, e.candidate.toJSON()); };
            const offerDesc = await pc.createOffer(); await pc.setLocalDescription(offerDesc);
            await setDoc(roomRef, { offer: { type: offerDesc.type, sdp: offerDesc.sdp }, answer: null, callerId: currentUser.id, callerName: currentUser.name, status: 'waiting', heartbeat: serverTimestamp() });
            setUiState('waiting'); startHeartbeat();
            unsubRoom = onSnapshot(roomRef, async (snap) => {
                const data = snap.data();
                if (data && data.answer && pc && !pc.currentRemoteDescription) { await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); setUiState('connected'); window.showToast('Voice connected', 'success'); }
                if (!snap.exists()) { await cleanupPeer(); setUiState('idle'); }
            });
            unsubCandidates = onSnapshot(calleeCandidatesRef, (snap) => { snap.docChanges().forEach(change => { if (change.type === 'added' && pc) pc.addIceCandidate(new RTCIceCandidate(change.doc.data())); }); });
        } else if (existing.callerId === currentUser.id) {
            window.showToast('You already have a call open on another tab', 'error'); await cleanupPeer(); return;
        } else if (!existing.answer) {
            role = 'callee'; pc.onicecandidate = (e) => { if (e.candidate) addDoc(calleeCandidatesRef, e.candidate.toJSON()); };
            await pc.setRemoteDescription(new RTCSessionDescription(existing.offer));
            const answerDesc = await pc.createAnswer(); await pc.setLocalDescription(answerDesc);
            await updateDoc(roomRef, { answer: { type: answerDesc.type, sdp: answerDesc.sdp }, calleeId: currentUser.id, calleeName: currentUser.name, status: 'connected', heartbeat: serverTimestamp() });
            setUiState('connected'); startHeartbeat(); window.showToast('Voice connected', 'success');
            unsubCandidates = onSnapshot(callerCandidatesRef, (snap) => { snap.docChanges().forEach(change => { if (change.type === 'added' && pc) pc.addIceCandidate(new RTCIceCandidate(change.doc.data())); }); });
            unsubRoom = onSnapshot(roomRef, (snap) => { if (!snap.exists()) { cleanupPeer(); setUiState('idle'); } });
        } else {
            window.showToast('The Voice Room is currently full', 'error'); await cleanupPeer(); return;
        }
    });

    setUiState('idle');
}

function initWatchParty() {
    let currentSessionUrl = null; 
    let isYt = false; 
    let ytPlayer = null; 
    let art = null; 
    let isSyncing = false; // Strictly blocks the feedback loop
    let wakeLock = null;

    const requestWakeLock = async () => { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} };

    let ytApiReady = false; 
    window.onYouTubeIframeAPIReady = function() { ytApiReady = true; };
    const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0]; firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    const joinOverlay = document.getElementById('theater-join-overlay');
    document.getElementById('btn-join-party').addEventListener('click', () => { 
        triggerHaptic(); joinOverlay.style.display = 'none'; document.getElementById('theater-player-slot').style.display = 'flex'; 
    });

    document.getElementById('btn-load-cowatch').addEventListener('click', async () => {
        const urlInput = document.getElementById('cowatch-url-input'); const url = urlInput.value.trim(); if (!url) return;
        triggerHaptic(); joinOverlay.style.display = 'none'; await mountMedia(url); pushState(true, 0); urlInput.value = '';
    });

    const pushState = (isPlaying, time) => { 
        if(isSyncing) return; // Prevent echoing remote commands back to Firebase
        setDoc(doc(db, 'system', 'watch_party'), { url: currentSessionUrl, isPlaying: isPlaying, timestamp: time, updatedAt: serverTimestamp(), updatedBy: currentUser.name }); 
    };

    const mountMedia = async (rawUrl) => {
        currentSessionUrl = rawUrl; 
        document.getElementById('theater-player-slot').style.display = 'none'; 
        document.getElementById('yt-container').style.display = 'none';

        if (/(youtube\.com|youtu\.be)/.test(rawUrl)) {
            isYt = true; document.getElementById('yt-container').style.display = 'block';
            let videoId = ''; const match = rawUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            if(match) videoId = match[1];
            
            if(art) { art.destroy(); art = null; }

            if (ytPlayer && ytPlayer.loadVideoById) { 
                ytPlayer.loadVideoById(videoId); 
            } else {
                if (!ytApiReady || typeof YT === 'undefined' || !YT.Player) { setTimeout(() => mountMedia(rawUrl), 1000); return; }
                ytPlayer = new YT.Player('yt-player-slot', {
                    videoId: videoId, playerVars: { 'autoplay': 1, 'controls': 1 },
                    events: { 
                        'onStateChange': (e) => { 
                            if(isSyncing) return; 
                            if (e.data === YT.PlayerState.PLAYING) pushState(true, ytPlayer.getCurrentTime()); 
                            if (e.data === YT.PlayerState.PAUSED) pushState(false, ytPlayer.getCurrentTime()); 
                        } 
                    }
                });
            }
        } else {
            isYt = false; document.getElementById('theater-player-slot').style.display = 'block';
            if(ytPlayer && ytPlayer.stopVideo) { ytPlayer.stopVideo(); } if(art) art.destroy();

            let secureUrl = rawUrl;
            if (rawUrl.startsWith(`${TUNNEL_URL}/stream/`)) {
                try {
                    const filename = decodeURIComponent(rawUrl.split('/').pop().split('?')[0]);
                    const tokRes = await fetchWithAuth(`${TUNNEL_URL}/api/stream-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
                    if (tokRes.ok) { const { token } = await tokRes.json(); secureUrl = rawUrl.includes('?') ? `${rawUrl}&stream_token=${token}` : `${rawUrl}?stream_token=${token}`; }
                } catch (e) {}
            }

            art = new Artplayer({ container: '#theater-player-slot', url: secureUrl, theme: '#70947A', fullscreen: true, setting: true, playbackRate: true, aspectRatio: true, fastForward: true, miniProgressBar: true, pip: true, playsInline: true, autoOrientation: true });
            
            art.on('play', () => { requestWakeLock(); if(!isSyncing) pushState(true, art.currentTime); });
            art.on('pause', () => { if(wakeLock) { wakeLock.release(); wakeLock = null; } if(!isSyncing) pushState(false, art.currentTime); });
            art.on('seek', () => { if(!isSyncing) pushState(art.playing, art.currentTime); });
            art.on('fullscreen', (state) => { if (/iPhone/.test(navigator.userAgent) && state && art.video.webkitEnterFullscreen) { art.video.webkitEnterFullscreen(); art.fullscreen = false; } });
        }
    };

    window.__lairTheater = { mountMediaFromWatchlist: async (url) => { document.getElementById('theater-player-slot').style.display = 'flex'; await mountMedia(url); pushState(true, 0); } };

    onSnapshot(doc(db, 'system', 'watch_party'), (snap) => {
        if(!snap.exists()) return; const data = snap.data();
        
        // Let a new video mount fully before attempting to sync times
        if(data.url && data.url !== currentSessionUrl) { mountMedia(data.url); return; }
        
        if(data.updatedBy === currentUser.name) return; 

        const expectedTime = data.timestamp + (data.updatedAt ? ((Date.now() - data.updatedAt.toMillis()) / 1000) : 0);
        
        isSyncing = true; // Lock out the event listeners temporarily
        
        if (isYt && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
            if (Math.abs(ytPlayer.getCurrentTime() - expectedTime) > 2.0) ytPlayer.seekTo(expectedTime, true);
            if (data.isPlaying && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) ytPlayer.playVideo();
            if (!data.isPlaying && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        } else if (!isYt && art && art.video && art.video.readyState >= 1) { // Ensure MP4 metadata is loaded before seeking
            if (Math.abs(art.currentTime - expectedTime) > 2.0) art.currentTime = expectedTime;
            if (data.isPlaying && !art.playing) art.play().catch(()=>{});
            if (!data.isPlaying && art.playing) art.pause();
        }
        
        // Unblock after an 800ms delay to let asynchronous play/pause events safely pass without triggering a pushState
        setTimeout(() => { isSyncing = false; }, 800);
    });
}

document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active');
        document.querySelectorAll('.vault-timeline').forEach(t => t.classList.remove('active'));
        document.getElementById(`timeline-${e.currentTarget.getAttribute('data-seg')}`).classList.add('active');
    });
});

async function initVault() {
  const cameraInput = document.getElementById('vault-camera-input');
  const quickCaptureFab = document.getElementById('btn-quick-capture');

  if (quickCaptureFab) {
      quickCaptureFab.onclick = () => {
          triggerHaptic();
          const activeTarget = document.querySelector('.dock-app.active')?.getAttribute('data-target');
          if (activeTarget === 'drop') cameraInput.click();
      };
  }

  if (cameraInput && !cameraInput.__hasListener) {
      cameraInput.__hasListener = true;
      cameraInput.addEventListener('change', async (e) => {
          const file = e.target.files[0]; if (!file) return;
          window.showToast('Streaming direct to Home PC...', 'info');
          const fd = new FormData(); fd.append('photo', file);

          try {
              const res = await fetchWithAuth(`${TUNNEL_URL}/api/photos/upload`, { method: 'POST', body: fd });
              if (res.ok) { window.showToast('Safely stored in PC Vault ✔', 'success'); initVault(); } else { throw new Error(); }
          } catch (err) { window.showToast('Upload failed: Home PC unreachable', 'error'); } finally { cameraInput.value = ''; }
      });
  }

  try {
    const [storageRes, filesRes] = await Promise.all([ fetchWithAuth(`${TUNNEL_URL}/api/storage`), fetchWithAuth(`${TUNNEL_URL}/api/photos`) ]);
    if(storageRes.ok) {
        const s = await storageRes.json();
        const gbUsage = (s.totalBytes / (1024*1024*1024)).toFixed(1);
        document.getElementById('drop-usage-text').textContent = `${gbUsage}GB`;
        document.getElementById('drop-gauge').style.setProperty('--pct', Math.min(100, Math.round((s.totalBytes / s.maxBytes) * 100)));
    }
    if(filesRes.ok) {
        const allFiles = await filesRes.json();
        
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    el.style.backgroundImage = `url('${el.getAttribute('data-bg')}')`;
                    obs.unobserve(el);
                }
            });
        }, { rootMargin: '300px' }); 

        const renderGrid = (list, containerId) => {
            const container = document.querySelector(`#${containerId} > div`);
            if(!list.length) { container.innerHTML = '<p style="color:var(--ink-soft); font-size:13px; text-align:center;">Empty directory.</p>'; return; }
            
            const grouped = {}; 
            list.forEach(p => { if(!grouped[p.dateFormatted]) grouped[p.dateFormatted] = []; grouped[p.dateFormatted].push(p); });
            container.innerHTML = '';
            
            for(const [dateStr, items] of Object.entries(grouped)) {
              let gridHtml = `<div style="grid-column: 1 / -1;"><h3 style="font-family:var(--font-mono); font-size:12px; text-transform:uppercase; color:var(--ink-soft); margin-bottom:12px; margin-top:10px;">${dateStr}</h3></div>`;
              
              items.forEach(p => { 
                const isPdf = p.filename.toLowerCase().endsWith('.pdf');
                const bgImage = isPdf ? 'https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg' : (p.thumbUrl || p.url);
                const extraStyle = isPdf ? `background-size:contain; background-repeat:no-repeat; background-color: var(--glass-bg);` : `background-size:cover; background-position:center;`;
                
                gridHtml += `<div class="vault-thumb-card media-card haptic-btn lazy-bg" data-bg="${bgImage}" data-url="${p.url}" data-filename="${p.filename}" data-date="${p.dateFormatted}" style="${extraStyle}"></div>`; 
              });
              container.innerHTML += gridHtml;
            }
        };

        renderGrid(allFiles.filter(f => /\.(jpg|jpeg|png|webp|heic|gif)$/i.test(f.filename)), 'timeline-photos');
        renderGrid(allFiles.filter(f => /\.(mp4|mov|m4v)$/i.test(f.filename)), 'timeline-videos');
        renderGrid(allFiles.filter(f => /\.(pdf)$/i.test(f.filename)), 'timeline-docs');

        document.querySelectorAll('.lazy-bg').forEach(card => observer.observe(card));

        document.querySelectorAll('.media-card').forEach(card => {
          card.addEventListener('click', async () => {
            triggerHaptic(); 
            activeLightboxFile = card.getAttribute('data-filename');
            
            if (activeLightboxFile.toLowerCase().endsWith('.pdf')) {
                window.open(card.getAttribute('data-url'), '_blank');
            } else {
                document.getElementById('lightbox-img').src = card.getAttribute('data-url'); 
                document.getElementById('photo-lightbox').classList.add('active');

                let toggleBtn = document.getElementById('btn-toggle-public');
                if (!toggleBtn) {
                    toggleBtn = document.createElement('button');
                    toggleBtn.id = 'btn-toggle-public';
                    toggleBtn.className = 'btn-secondary haptic-btn';
                    toggleBtn.style.cssText = 'padding:10px 14px; font-size:12px; font-weight:600; margin-right:10px; background:rgba(255,255,255,0.06); border:var(--glass-border);';
                    const lightboxControls = document.getElementById('btn-delete-vault-photo').parentElement;
                    lightboxControls.insertBefore(toggleBtn, lightboxControls.firstChild);
                }

                toggleBtn.textContent = "Checking status...";
                toggleBtn.style.color = "var(--ink-soft)";
                
                const publicRef = doc(db, 'public_photos', activeLightboxFile);
                const snap = await getDoc(publicRef);
                
                if (snap.exists()) {
                    toggleBtn.innerHTML = "★ Remove from Exhibition";
                    toggleBtn.style.color = "var(--warn)";
                } else {
                    toggleBtn.innerHTML = "☆ Send to Exhibition";
                    toggleBtn.style.color = "var(--ink)";
                }

                toggleBtn.onclick = async () => {
                    triggerHaptic();
                    toggleBtn.textContent = "Syncing...";
                    const checkSnap = await getDoc(publicRef);
                    if (checkSnap.exists()) {
                        await deleteDoc(publicRef);
                        toggleBtn.innerHTML = "☆ Send to Exhibition";
                        toggleBtn.style.color = "var(--ink)";
                        window.showToast('Removed from public exhibition', 'info');
                    } else {
                        await setDoc(publicRef, { 
                            filename: activeLightboxFile,
                            url: `${TUNNEL_URL}/api/public/cloud/${encodeURIComponent(activeLightboxFile)}`,
                            dateFormatted: card.getAttribute('data-date') || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        });
                        toggleBtn.innerHTML = "★ Remove from Exhibition";
                        toggleBtn.style.color = "var(--warn)";
                        window.showToast('Added to spatial cloud!', 'success');
                    }
                };
            }
          });
        });
    }
  } catch(err) {}
}

document.getElementById('btn-delete-vault-photo').addEventListener('click', async () => {
    if (!activeLightboxFile) return;
    const ok = await window.showConfirm('Delete Item', `Permanently remove ${activeLightboxFile} from local storage?`);
    if (!ok) return;
    try {
        const res = await fetchWithAuth(`${TUNNEL_URL}/api/photos/delete/${encodeURIComponent(activeLightboxFile)}`, { method: 'DELETE' });
        if(res.ok) { 
          document.getElementById('photo-lightbox').classList.remove('active'); 
          await deleteDoc(doc(db, 'public_photos', activeLightboxFile));
          initVault(); 
          window.showToast('Item deleted successfully', 'success');
        }
    } catch(e) { window.showToast('Delete failed', 'error'); }
});

document.getElementById('vault-photo-input').addEventListener('change', async (e) => {
  const files = e.target.files; if(!files.length) return;
  const status = document.getElementById('vault-status'); status.style.display = 'block';
  for(let i=0; i<files.length; i++) {
      status.textContent = `Uploading ${i+1}/${files.length}: ${files[i].name}...`;
      const fd = new FormData(); fd.append('photo', files[i]);
      try { await fetchWithAuth(`${TUNNEL_URL}/api/photos/upload`, { method: 'POST', body: fd }); } catch(err) {}
  }
  status.textContent = 'Upload Complete ✔'; setTimeout(() => status.style.display = 'none', 3000); 
  window.showToast('Media uploaded to Vault', 'success');
  initVault(); e.target.value = '';
});
// ==== THE FRIDGE MAGNET (DRAWING BOARD & DRIVE AUTO-SAVE) ====
// ==== THE FRIDGE MAGNET (DRAWING BOARD & DRIVE MANUAL SAVE) ====
const canvas = document.getElementById('magnet-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const colorPicker = document.getElementById('magnet-color');
const clearBtn = document.getElementById('btn-clear-canvas');
const saveBtn = document.getElementById('btn-save-magnet');

let isDrawing = false;
let lastX = 0;
let lastY = 0;

function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0);

            canvas.width = rect.width;
            canvas.height = rect.height;
            ctx.drawImage(tempCanvas, 0, 0);
        }
    }
}

window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 150);

function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x, y;
    if (e.touches && e.touches[0]) {
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
    } else {
        x = e.offsetX !== undefined ? e.offsetX : (e.clientX - rect.left);
        y = e.offsetY !== undefined ? e.offsetY : (e.clientY - rect.top);
    }

    return { x: x * scaleX, y: y * scaleY };
}

function startDrawing(e) {
    if (!canvas || !ctx) return;
    isDrawing = true;
    const pos = getCoords(e);
    lastX = pos.x;
    lastY = pos.y;
}

function draw(e) {
    if (!isDrawing || !canvas || !ctx) return;
    e.preventDefault();
    const pos = getCoords(e);

    ctx.strokeStyle = colorPicker ? colorPicker.value : '#70947A';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
}

function stopDrawing() {
    isDrawing = false;
}

if (canvas) {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
}

if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (canvas && ctx) {
            triggerHaptic();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    });
}

if (saveBtn) {
    saveBtn.addEventListener('click', () => {
        if (!canvas || !ctx) return;
        triggerHaptic();

        saveBtn.disabled = true;
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';

        canvas.toBlob(async (blob) => {
            if (!blob) {
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
                return;
            }

            const formData = new FormData();
            formData.append('magnet_image', blob, `magnet_${Date.now()}.png`);

            try {
                const res = await fetchWithAuth(`${TUNNEL_URL}/api/fridge/save-magnet`, {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    window.showToast('Sketch saved to Google Drive! ✔', 'success');
                } else {
                    window.showToast(data.error || 'Failed to save sketch', 'error');
                }
            } catch (err) {
                window.showToast('Server unreachable. Save failed.', 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
            }
        }, 'image/png');
    });
}
