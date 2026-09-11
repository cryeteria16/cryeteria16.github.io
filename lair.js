import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, collection, onSnapshot, query, orderBy, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

const TUNNEL_URL = "https://vault.ibadhasan.com"; 

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
    if (e.target.closest('#command-bay-grid, #tmdb-results, #shared-watchlist, .os-dock, input, textarea, .artplayer-app, .ledger-scroll-wrapper, table, #auditor-queue-container')) return;
    const diffX = touchStartX - e.changedTouches[0].screenX; const diffY = touchStartY - e.changedTouches[0].screenY;
    if (Math.abs(diffY) > Math.abs(diffX)) return;

    const views = ['dashboard', 'work', 'drop', 'theater', 'voice'];
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
          if(snap.data().theme) {
              document.body.setAttribute('data-theme', snap.data().theme);
              
              const themeBtnText = document.querySelector('#btn-theme-toggle .nav-btn-text');
              const themeBtnIcon = document.getElementById('icon-theme');
              const isLight = snap.data().theme === 'light';
              
              themeBtnText.textContent = isLight ? '🌙 Dark' : '☀️ Light';
              themeBtnIcon.textContent = isLight ? '🌙' : '☀️';

              document.getElementById('meta-theme-color').setAttribute('content', isLight ? '#F2F2F7' : '#060709');
          }
      }
  });
  
  initOS();
});

document.getElementById('btn-signout').addEventListener('click', () => { signOut(auth); window.location.replace("index.html"); });

document.querySelectorAll('[data-workseg]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        triggerHaptic();
        document.querySelectorAll('[data-workseg]').forEach(b => b.classList.remove('active')); 
        e.currentTarget.classList.add('active');
        document.querySelectorAll('.work-module').forEach(t => t.style.display = 'none');
        const targetSeg = e.currentTarget.getAttribute('data-workseg');
        document.getElementById(`work-${targetSeg}`).style.display = 'block';
       
    });
});

document.querySelectorAll('.app-link').forEach(link => {
  link.addEventListener('click', (e) => {
    document.querySelectorAll('.dock-app').forEach(d => d.classList.remove('active')); 
    e.currentTarget.classList.add('active');
    document.querySelectorAll('.view-container').forEach(w => w.classList.remove('active'));
    
    const target = e.currentTarget.getAttribute('data-target');
    document.getElementById(`view-${target}`).classList.add('active'); 
    
    const fab = document.getElementById('btn-quick-capture');
    if (fab) fab.style.display = (target === 'work' || target === 'drop') ? 'flex' : 'none';

    window.scrollTo(0,0);
  });
});

function initAuditor() {
    const dropzone = document.getElementById('auditor-dropzone');
    const fileInput = document.getElementById('batch-upload-input');
    const queueContainer = document.getElementById('auditor-queue-container');
    const fileList = document.getElementById('auditor-file-list');
    const tableBody = document.getElementById('auditor-table-body');
    const emptyRow = document.getElementById('auditor-empty-row');
    const exportBtn = document.getElementById('auditor-export-btn');
    const settingsBtn = document.getElementById('btn-auditor-settings');
    const taskIdInput = document.getElementById('work-task-id');

    if (!dropzone || !fileInput) return;

    let csvRows = [["Task ID", "Subcontractor", "Invoice Number", "Date", "TRN", "Net", "VAT", "Total", "Status"]];

    const savedTaskId = localStorage.getItem('lair_default_task_id');
    if (savedTaskId && taskIdInput) taskIdInput.value = savedTaskId;

    if (settingsBtn && taskIdInput) {
        settingsBtn.addEventListener('click', () => {
            triggerHaptic();
            const newDefault = prompt("Set Default Global Task ID (e.g. FM-2026-901):", taskIdInput.value);
            if (newDefault !== null) {
                taskIdInput.value = newDefault.trim();
                localStorage.setItem('lair_default_task_id', newDefault.trim());
                window.showToast('Default Task ID saved to device memory.', 'success');
            }
        });
    }

    const updateMetricsUI = (c, net, vat, gross) => {
        document.getElementById('auditor-count').textContent = c;
        document.getElementById('auditor-net').textContent = Number(net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('auditor-vat').textContent = Number(vat).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('auditor-gross').textContent = Number(gross).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    window.handleCellEdit = async function(element, sheetRow, colIdx, originalValue) {
        const newValue = element.innerText.trim();
        if (newValue === originalValue) return;

        element.style.color = 'var(--warn)';
        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/update-cell`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ row: sheetRow, col: colIdx, value: newValue })
            });

            if (res.ok) {
                element.style.color = 'var(--con)';
                setTimeout(() => { element.style.color = 'inherit'; }, 1500);
                element.setAttribute('onblur', `handleCellEdit(this, ${sheetRow}, ${colIdx}, '${newValue.replace(/'/g, "\\'")}')`);
                window.showToast('Cell updated in Google Sheets', 'success');
            } else {
                throw new Error();
            }
        } catch (err) {
            window.showToast('Failed to update Sheet', 'error');
            element.innerText = originalValue;
            element.style.color = 'inherit';
        }
    };

    const appendLedgerRow = (row, sheetRowIndex, prepend = true) => {
        if (emptyRow) emptyRow.style.display = 'none';

        const net = Number(row[5]) || 0;
        const vat = Number(row[6]) || 0;
        const total = Number(row[7]) || 0;
        const isValid = Math.abs((net + vat) - total) < 0.05;

        const tr = document.createElement('tr');
        tr.style.cssText = isValid ? '' : 'background:rgba(217,83,79,0.08); border-left:3px solid var(--err);';

        const editableCell = (val, colIdx, align = 'left', bold = false) => `
            <td style="padding:12px 16px; border-bottom:var(--glass-border); text-align:${align}; ${bold ? 'font-weight:600;' : ''}">
                <div contenteditable="true" style="outline:none; min-width:20px; -webkit-user-select:text; user-select:text;" onblur="handleCellEdit(this, ${sheetRowIndex}, ${colIdx}, '${String(val).replace(/'/g, "\\'")}')">${val}</div>
            </td>`;

        tr.innerHTML = `
            <td style="padding:12px 16px; border-bottom:var(--glass-border); text-align:center; color:${isValid ? 'var(--con)' : 'var(--err)'};">${isValid ? '✔' : '⚠'}</td>
            ${editableCell(row[0], 0)}
            ${editableCell(row[1], 1)}
            ${editableCell(row[2], 2, 'left', true)}
            ${editableCell(row[3], 3)}
            ${editableCell(row[4], 4)}
            ${editableCell(net.toFixed(2), 5, 'right')}
            ${editableCell(vat.toFixed(2), 6, 'right')}
            ${editableCell(total.toFixed(2), 7, 'right', true)}
        `;

        if (prepend) {
            tableBody.insertBefore(tr, tableBody.firstChild);
        } else {
            tableBody.appendChild(tr);
        }

        csvRows.push([...row, isValid ? "Valid" : "Mismatch"]);
    };

    const loadLiveLedger = async () => {
        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/ledger`);
            if (!res.ok) {
                if (emptyRow) emptyRow.innerHTML = '<td colspan="9" style="padding:50px 20px; text-align:center; color:var(--err); font-size:13px;">Error connecting to Google Sheets. Check server terminal.</td>';
                return;
            }

            const data = await res.json();
            updateMetricsUI(data.count, data.net, data.vat, data.gross);

            if (data.rows && data.rows.length > 0) {
                tableBody.innerHTML = '';
                data.rows.forEach(item => {
                    appendLedgerRow([
                        item.taskId,
                        item.subcontractor,
                        item.invoiceNumber,
                        item.date,
                        item.trn,
                        item.net,
                        item.vat,
                        item.total
                    ], item.sheetRow, false);
                });
            } else {
                if (emptyRow) emptyRow.innerHTML = '<td colspan="9" style="padding:50px 20px; text-align:center; color:var(--ink-soft); font-size:13px;">Ledger is empty. Drop an invoice to begin.</td>';
            }
        } catch (e) {
            if (emptyRow) emptyRow.innerHTML = '<td colspan="9" style="padding:50px 20px; text-align:center; color:var(--err); font-size:13px;">Server offline or tunnel disconnected.</td>';
        }
    };
    loadLiveLedger();

    const processFiles = async (files) => {
        if (!files.length) return;
        const taskId = (taskIdInput && taskIdInput.value.trim()) || 'UNASSIGNED';
        
        queueContainer.style.display = 'flex';
        document.getElementById('auditor-queue-count').textContent = files.length;
        fileList.innerHTML = '';

        Array.from(files).forEach((file, index) => {
            fileList.innerHTML += `
                <div id="file-card-${index}" style="display:flex; justify-content:space-between; padding:10px 14px; background:var(--glass-bg); border:var(--glass-border); border-radius:12px;">
                    <span style="font-size:12px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">${file.name}</span>
                    <span id="file-status-${index}" style="font-size:12px; color:var(--warn);">Processing...</span>
                </div>`;
        });

        const CONCURRENCY_LIMIT = 3;
        let active = 0;
        let queueIndex = 0;

        const runNext = async () => {
            if (queueIndex >= files.length) return;
            const i = queueIndex++;
            active++;
            
            const fd = new FormData();
            fd.append('invoice', files[i]);
            const statusEl = document.getElementById(`file-status-${i}`);
            const cardEl = document.getElementById(`file-card-${i}`);

            try {
                const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/extract`, { method: 'POST', body: fd });
                if (!res.ok) throw new Error('Parse failed');
                const data = await res.json();

                const row = [ 
                    taskId, 
                    data.subcontractor_name || '', 
                    data.invoice_number || '', 
                    data.invoice_date || '', 
                    data.trn || '', 
                    Number(data.net_amount) || 0, 
                    Number(data.vat_amount) || 0, 
                    Number(data.total_amount) || 0 
                ];

                const syncRes = await fetchWithAuth(`${TUNNEL_URL}/api/work/sync`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ rows: [row] }) 
                });
                const syncData = await syncRes.json();

                if (!syncRes.ok || !syncData.success) throw new Error(syncData.error || 'Sync failed');
                if (syncData.skipped && syncData.skipped.includes(data.invoice_number)) throw new Error('Duplicate');

                appendLedgerRow(row, syncData.rowIndex, true);
                loadLiveLedger();
                
                statusEl.textContent = '✔ Done';
                statusEl.style.color = 'var(--con)';
                cardEl.style.borderColor = 'rgba(112,148,122,0.4)';
            } catch (e) {
                statusEl.textContent = `✖ ${e.message}`;
                statusEl.style.color = 'var(--err)';
                cardEl.style.borderColor = 'rgba(217,83,79,0.4)';
            } finally {
                active--;
                runNext();
                if (active === 0 && queueIndex >= files.length) {
                    setTimeout(() => { queueContainer.style.display = 'none'; }, 4000);
                }
            }
        };

        for (let i = 0; i < CONCURRENCY_LIMIT; i++) runNext();
        fileInput.value = '';
    };

    fileInput.addEventListener('change', (e) => processFiles(e.target.files));
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--con)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'rgba(255,255,255,0.2)'; });
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.style.borderColor = 'rgba(255,255,255,0.2)'; if (e.dataTransfer.files) processFiles(e.dataTransfer.files); });

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (csvRows.length <= 1) { window.showToast('No data to export yet.'); return; }
            const csv = csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `auditor_pro_session_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
        });
    }
}

function initPODropzone() {
    const dropzone = document.getElementById('po-dropzone');
    const fileInput = document.getElementById('po-file-input');
    const resultContainer = document.getElementById('po-result-container');
    if (!dropzone || !fileInput) return;

    const supervisorMap = {
        'umm hurair': { name: 'Jan Melvin Jimenez', email: 'jan.melvin@al-ghurair.com' },
        'al murooj': { name: 'Supervisor Team A', email: 'supervisor.a@al-ghurair.com' },
        'boutique villas': { name: 'Supervisor Team B', email: 'supervisor.b@al-ghurair.com' }
    };

    let extractedPoNumber = '';

    const processPOFile = async (file) => {
        if (!file) return;
        window.showToast('Extracting PO details with Gemini...', 'info');
        const fd = new FormData();
        fd.append('po_file', file);

        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/extract-po`, { method: 'POST', body: fd });
            if (!res.ok) throw new Error('Extraction failed');
            const data = await res.json();

            extractedPoNumber = data.po_number || '';
            document.getElementById('po-res-num').textContent = extractedPoNumber || '—';
            document.getElementById('po-res-supplier').textContent = data.supplier_name || '—';
            document.getElementById('po-res-building').textContent = data.building || 'General';
            document.getElementById('po-res-total').textContent = Number(data.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            document.getElementById('po-match-ref').value = data.project_name || '';

            const buildingKey = Object.keys(supervisorMap).find(k => (data.building || '').toLowerCase().includes(k)) || 'umm hurair';
            const supervisor = supervisorMap[buildingKey];

            const draftText = `Subject: New PO Issued: ${extractedPoNumber} — ${data.building || 'Project Site'}

Hi ${supervisor.name},

A new Purchase Order has been raised and confirmed for your site execution and tracking:

- PO Number: ${extractedPoNumber}
- Supplier: ${data.supplier_name}
- Building / Location: ${data.building || 'General'}
- Project: ${data.project_name || 'VAR-TFM DD'}
- Grand Total: AED ${Number(data.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Incl. VAT)

Scope Summary:
${(data.line_items || []).map(li => `• ${li.item} (Qty: ${li.qty})`).join('\n')}

Please coordinate with the team accordingly.

Best regards,
Lair OS`;

            document.getElementById('po-email-draft').value = draftText;
            resultContainer.style.display = 'flex';
            window.showToast('PO successfully extracted & email drafted ✔', 'success');
        } catch (err) {
            window.showToast('Failed to parse PO PDF', 'error');
        } finally {
            fileInput.value = '';
        }
    };

    fileInput.addEventListener('change', (e) => processPOFile(e.target.files[0]));
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--con)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'rgba(255,255,255,0.2)'; });
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.style.borderColor = 'rgba(255,255,255,0.2)'; if (e.dataTransfer.files[0]) processPOFile(e.dataTransfer.files[0]); });

    const syncSheetBtn = document.getElementById('btn-sync-po-sheet');
    if (syncSheetBtn && !syncSheetBtn.__hasListener) {
        syncSheetBtn.__hasListener = true;
        syncSheetBtn.addEventListener('click', async () => {
            const refCode = document.getElementById('po-match-ref').value.trim();
            if (!refCode || !extractedPoNumber) {
                window.showToast('Please provide a valid reference code to match.', 'error');
                return;
            }

            triggerHaptic();
            window.showToast('Syncing PO reference to Google Sheets...', 'info');

            try {
                const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/sync-po-to-sheet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ po_number: extractedPoNumber, ref_code: refCode })
                });

                const result = await res.json();
                if (!res.ok || !result.success) throw new Error(result.error || 'Sync failed');

                window.showToast(`Successfully updated row ${result.updatedRow} with ${extractedPoNumber} ✔`, 'success');
            } catch (err) {
                window.showToast(err.message || 'Failed to update Google Sheet', 'error');
            }
        });
    }

    document.getElementById('btn-copy-email').addEventListener('click', () => {
        const textarea = document.getElementById('po-email-draft');
        textarea.select();
        navigator.clipboard.writeText(textarea.value);
        triggerHaptic();
        window.showToast('Email draft copied to clipboard!', 'success');
    });
}

function initVWTracker() {
    const tableBody = document.getElementById('vw-table-body');
    const searchInput = document.getElementById('vw-search-input');
    const refreshBtn = document.getElementById('vw-refresh-btn');
    const dossierModal = document.getElementById('vw-dossier-modal');
    const dossierContent = document.getElementById('vw-dossier-content');
    const dossierTitle = document.getElementById('vw-dossier-title');

    if (!tableBody) return;

    let allVWRows = [];

    const renderTable = (rowsToRender) => {
        if (!rowsToRender.length) {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding:40px; text-align:center; color:var(--ink-soft);">No matching works found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        rowsToRender.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.cssText = 'cursor:pointer; transition:background 0.2s;';
            tr.onmouseover = () => tr.style.background = 'rgba(255,255,255,0.03)';
            tr.onmouseout = () => tr.style.background = 'transparent';

            tr.innerHTML = `
                <td style="padding:12px 16px; border-bottom:var(--glass-border); font-family:var(--font-mono); font-size:12px;">
                    <div style="font-weight:600; color:var(--ink);">${item.crmRef || '—'}</div>
                    <div style="color:var(--ink-soft); font-size:11px;">${item.qtnRef || ''}</div>
                </td>
                <td style="padding:12px 16px; border-bottom:var(--glass-border);">
                    <div style="font-weight:500; color:var(--ink); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${item.description}">${item.description || '—'}</div>
                    <div style="color:var(--ink-soft); font-size:11px;">${item.building || 'General'}</div>
                </td>
                <td style="padding:12px 16px; border-bottom:var(--glass-border); font-size:12px;">
                    <div>${item.supplierName || '—'}</div>
                    <div style="color:var(--ink-soft); font-size:11px;">Assignee: ${item.qtnAssignedTo || 'Unassigned'}</div>
                </td>
                <td style="padding:12px 16px; border-bottom:var(--glass-border); text-align:right; font-family:var(--font-mono); font-size:12px;">
                    ${item.supplierCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td style="padding:12px 16px; border-bottom:var(--glass-border); text-align:right; font-family:var(--font-mono); font-size:12px; font-weight:600; color:var(--con);">
                    ${item.waslCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td style="padding:12px 16px; border-bottom:var(--glass-border);">
                    <span style="font-family:var(--font-mono); font-size:10px; padding:4px 8px; border-radius:12px; background:rgba(112,148,122,0.15); color:var(--con);">${item.worksStatus}</span>
                </td>
            `;

            tr.addEventListener('click', () => {
                triggerHaptic();
                dossierTitle.textContent = `CRM: ${item.crmRef || item.qtnRef || 'Work Details'}`;
                dossierContent.innerHTML = '';

                const headers = item.rawHeaders;
                const values = item.rawValues;

                headers.forEach((header, idx) => {
                    const val = values[idx];
                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                        const box = document.createElement('div');
                        box.style.cssText = 'background:var(--input-bg); padding:12px; border-radius:var(--radius-sm); border:var(--glass-border);';
                        box.innerHTML = `
                            <div style="font-family:var(--font-mono); font-size:10px; color:var(--ink-soft); text-transform:uppercase; margin-bottom:4px;">${header}</div>
                            <div style="color:var(--ink); font-weight:500; word-break:break-word;">${val}</div>
                        `;
                        dossierContent.appendChild(box);
                    }
                });

                dossierModal.classList.add('active');
            });

            tableBody.appendChild(tr);
        });
    };

    const loadVWData = async () => {
        try {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding:50px 20px; text-align:center; color:var(--ink-soft);">Syncing Variable Works with Google Sheets...</td></tr>`;
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/vw-tracker`);
            if (!res.ok) throw new Error('Failed to fetch VW tracker');
            const data = await res.json();

            document.getElementById('vw-stat-count').textContent = data.count;
            document.getElementById('vw-stat-supplier').textContent = data.totalSupplierCost.toLocaleString('en-US', { minimumFractionDigits: 2 });
            document.getElementById('vw-stat-wasl').textContent = data.totalWaslCost.toLocaleString('en-US', { minimumFractionDigits: 2 });
            
            const estMargin = data.totalWaslCost - data.totalSupplierCost;
            const marginEl = document.getElementById('vw-stat-margin');
            marginEl.textContent = estMargin.toLocaleString('en-US', { minimumFractionDigits: 2 });
            marginEl.style.color = estMargin >= 0 ? 'var(--con)' : 'var(--err)';

            allVWRows = data.rows;
            renderTable(allVWRows);
          
        } catch (e) {
            tableBody.innerHTML = `<tr><td colspan="6" style="padding:50px 20px; text-align:center; color:var(--err);">Failed to load VW tracker. Check server logs.</td></tr>`;
        }
    };

    loadVWData();

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            triggerHaptic();
            loadVWData();
            window.showToast('VW Tracker synced', 'success');
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const queryStr = e.target.value.toLowerCase().trim();
            if (!queryStr) {
                renderTable(allVWRows);
                return;
            }
            const filtered = allVWRows.filter(item => 
                String(item.crmRef).toLowerCase().includes(queryStr) ||
                String(item.qtnRef).toLowerCase().includes(queryStr) ||
                String(item.description).toLowerCase().includes(queryStr) ||
                String(item.building).toLowerCase().includes(queryStr) ||
                String(item.supplierName).toLowerCase().includes(queryStr) ||
                String(item.worksStatus).toLowerCase().includes(queryStr)
            );
            renderTable(filtered);
        });
    }
}

window.loadVWBriefing = async function() {
    const textEl = document.getElementById('vw-briefing-text');
    const metricsEl = document.getElementById('vw-metrics-row');
    if (!textEl) return;

    textEl.textContent = "Analyzing compliance KPIs and generating executive briefing...";
    metricsEl.innerHTML = "";

    try {
        const res = await fetchWithAuth(`${TUNNEL_URL}/api/work/vw-briefing`);
        if (!res.ok) throw new Error('Failed to fetch briefing');
        
        const data = await res.json();
        textEl.textContent = `"${data.summary}"`;
        textEl.style.fontStyle = 'normal';
        textEl.style.color = 'var(--ink)';

        const m = data.metrics;
        metricsEl.innerHTML = `
            <div style="background:var(--input-bg); padding:12px; border-radius:var(--radius-sm); border:var(--glass-border);">
                <span style="display:block; color:var(--ink-soft); font-size:10px; font-family:var(--font-mono); margin-bottom:4px; text-transform:uppercase;">Completed Works</span>
                <span style="font-size:16px; font-weight:600; color:var(--ink);">${m.completedWorks}</span>
            </div>
            <div style="background:var(--input-bg); padding:12px; border-radius:var(--radius-sm); border:var(--glass-border);">
                <span style="display:block; color:var(--ink-soft); font-size:10px; font-family:var(--font-mono); margin-bottom:4px; text-transform:uppercase;">Missing WCRs</span>
                <span style="font-size:16px; font-weight:600; color:var(--warn);">${m.missingWcr}</span>
            </div>
            <div style="background:var(--input-bg); padding:12px; border-radius:var(--radius-sm); border:var(--glass-border);">
                <span style="display:block; color:var(--ink-soft); font-size:10px; font-family:var(--font-mono); margin-bottom:4px; text-transform:uppercase;">Missing SAP Uploads</span>
                <span style="font-size:16px; font-weight:600; color:var(--warn);">${m.missingSapUpload}</span>
            </div>
            <div style="background:var(--input-bg); padding:12px; border-radius:var(--radius-sm); border:var(--glass-border);">
                <span style="display:block; color:var(--ink-soft); font-size:10px; font-family:var(--font-mono); margin-bottom:4px; text-transform:uppercase;">Pending WASL POs</span>
                <span style="font-size:16px; font-weight:600; color:var(--err);">${m.pendingWaslPo}</span>
            </div>
        `;
    } catch (e) {
        textEl.textContent = "Unable to generate AI briefing at this moment.";
    }
};

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

  const themeBtn = document.getElementById('btn-theme-toggle');
  themeBtn.addEventListener('click', () => {
      const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      setDoc(doc(db, 'users', currentUser.id), { theme: newTheme }, { merge: true });
  });

  const urlParams = new URLSearchParams(window.location.search);
  if(urlParams.get('share') === 'true') {
      window.showToast('Work order media received from Share Sheet.', 'success');
      document.querySelector('.dock-app[data-target="work"]').click();
      window.history.replaceState({}, document.title, window.location.pathname);
  }

  const fridgeText = document.getElementById('fridge-door-text');
  const fridgeStatus = document.getElementById('fridge-status');
  const fridgeCard = document.getElementById('fridge-card');
  let fridgeTimeout;
  let isTyping = false;
  let glowTimeout;

  onSnapshot(doc(db, 'system', 'fridge_door'), (snap) => {
      if(snap.exists()) {
          const data = snap.data();
          if(data.updatedBy !== currentUser.id && !isTyping) {
              fridgeText.value = data.content || '';
              fridgeStatus.textContent = `Last edit: ${data.updatedByName || 'Partner'}`;
              
              fridgeCard.classList.add('ambient-typing');
              clearTimeout(glowTimeout);
              glowTimeout = setTimeout(() => fridgeCard.classList.remove('ambient-typing'), 3500);
          }
      }
  });

  fridgeText.addEventListener('input', () => {
      isTyping = true;
      fridgeStatus.textContent = 'Typing...';
      clearTimeout(fridgeTimeout);
      fridgeTimeout = setTimeout(async () => {
          await setDoc(doc(db, 'system', 'fridge_door'), { 
              content: fridgeText.value, 
              updatedBy: currentUser.id,
              updatedByName: currentUser.name,
              timestamp: serverTimestamp() 
          }, {merge: true});
          isTyping = false;
          fridgeStatus.textContent = 'Saved to Cloud';
      }, 500); 
  });
  
  fridgeText.addEventListener('blur', () => { isTyping = false; });

  initWatchParty();
  initVault();
  initTheaterChat();
  initWatchlist();
  initConfigAndFeatures();
  initRadarFeed();
  initVoiceRoom();
  initAuditor();
  initVWTracker();
  initPODropzone();
  initAdminPinPad();

  document.getElementById('btn-open-po-modal').addEventListener('click', () => {
      triggerHaptic();
      document.getElementById('po-extractor-modal').classList.add('active');
  });
}

function initAdminPinPad() {
    const adminBtn = document.getElementById('dock-admin-link');
    const pinModal = document.getElementById('pin-modal');
    const pinDots = document.querySelectorAll('.pin-dot');
    let currentPin = '';

    const updateDots = () => {
        pinDots.forEach((dot, idx) => {
            dot.style.background = idx < currentPin.length ? 'var(--ink)' : 'transparent';
        });
    };

    adminBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerHaptic();
        currentPin = '';
        updateDots();
        pinModal.classList.add('active');
    });

    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            triggerHaptic();
            if(btn.id === 'btn-pin-delete') {
                currentPin = currentPin.slice(0, -1);
            } else if(btn.dataset.num && currentPin.length < 4) {
                currentPin += btn.dataset.num;
            }
            updateDots();
            
            if (currentPin.length === 4) {
                setTimeout(() => {
                    if (currentPin === userAdminPin) {
                        window.location.href = 'admin.html';
                    } else {
                        const dotsContainer = document.getElementById('pin-dots');
                        dotsContainer.classList.add('shake');
                        if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
                        setTimeout(() => {
                            dotsContainer.classList.remove('shake');
                            currentPin = '';
                            updateDots();
                        }, 400);
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
        
        if (!mine) {
            const nameDiv = document.createElement('div');
            nameDiv.style.cssText = 'font-family:var(--font-mono); font-size:10px; opacity:0.7; margin-bottom:2px;';
            nameDiv.textContent = m.name;
            row.appendChild(nameDiv);
        }
        
        const textNode = document.createTextNode(m.text);
        row.appendChild(textNode);
        return row;
    };

    const chatQuery = query(collection(db, 'chat'), orderBy('timestamp', 'asc'), limit(100));
    onSnapshot(chatQuery, (snap) => {
        chatWindow.innerHTML = '';
        snap.forEach(d => chatWindow.appendChild(renderMsg(d.data())));
        chatWindow.scrollTop = chatWindow.scrollHeight;
    });

    const sendChat = async () => {
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        triggerHaptic();
        await addDoc(collection(db, 'chat'), { text, name: currentUser.name, uid: currentUser.id, timestamp: serverTimestamp() });
    };
    document.getElementById('btn-send-chat').addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
}

function initWatchlist() {
    const listEl = document.getElementById('shared-watchlist');
    const watchQuery = query(collection(db, 'watchlist'), orderBy('timestamp', 'desc'), limit(40));
    onSnapshot(watchQuery, (snap) => {
        if (snap.empty) { listEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Watchlist is empty. Search TMDB above to add something.</p>'; return; }
        listEl.innerHTML = '';
        snap.forEach(docSnap => {
            const m = docSnap.data();
            const card = document.createElement('div');
            card.style.cssText = 'width:110px; cursor:pointer;';
            card.innerHTML = `
                <div style="width:110px; height:160px; border-radius:12px; background:${m.poster ? `url('${m.poster}') center/cover` : 'var(--input-bg)'}; border:var(--glass-border); margin-bottom:6px;"></div>
                <div style="font-size:11px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.title}</div>
                <div style="font-size:10px; color:var(--ink-soft);">${m.streamUrl ? '▶ Play' : m.status || ''}</div>
            `;
            if (m.streamUrl) {
                card.addEventListener('click', async () => {
                    triggerHaptic();
                    document.querySelector('.dock-app[data-target="theater"]').click();
                    document.getElementById('theater-join-overlay').style.display = 'none';
                    const { mountMediaFromWatchlist } = window.__lairTheater || {};
                    if (mountMediaFromWatchlist) mountMediaFromWatchlist(m.streamUrl);
                });
            }
            listEl.appendChild(card);
        });
    });

    const resultsEl = document.getElementById('tmdb-results');
    const searchInput = document.getElementById('tmdb-search-input');

    const runSearch = async () => {
        const qStr = searchInput.value.trim();
        if (!qStr) return;
        resultsEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Searching...</p>';
        try {
            const res = await fetchWithAuth(`${TUNNEL_URL}/api/tmdb/search?q=${encodeURIComponent(qStr)}`);
            const data = await res.json();
            if (!res.ok) { resultsEl.innerHTML = `<p style="font-size:12px; color:var(--err);">${data.error || 'Search failed.'}</p>`; return; }
            if (!data.results.length) { resultsEl.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">No results.</p>'; return; }
            resultsEl.innerHTML = '';
            data.results.forEach(r => {
                const card = document.createElement('div');
                card.style.cssText = 'width:110px;';
                card.innerHTML = `
                    <div style="width:110px; height:160px; border-radius:12px; background:${r.poster ? `url('${r.poster}') center/cover` : 'var(--input-bg)'}; border:var(--glass-border); margin-bottom:6px;"></div>
                    <div style="font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title} ${r.year ? `(${r.year})` : ''}</div>
                    <button class="btn-secondary haptic-btn" style="width:100%; margin-top:4px; padding:6px; font-size:10px;">+ Add</button>
                `;
                card.querySelector('button').addEventListener('click', async () => {
                    triggerHaptic();
                    await addDoc(collection(db, 'watchlist'), {
                        title: r.title, poster: r.poster, type: r.type, status: 'Want to Watch',
                        streamUrl: '', addedBy: currentUser.name, timestamp: serverTimestamp()
                    });
                    window.showToast(`Added ${r.title} to Watchlist`, 'success');
                });
                resultsEl.appendChild(card);
            });
        } catch (e) {
            resultsEl.innerHTML = '<p style="font-size:12px; color:var(--err);">Search failed.</p>';
        }
    };
    document.getElementById('btn-tmdb-search').addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
}

function initConfigAndFeatures() {
    onSnapshot(doc(db, 'system', 'config'), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();

        const banner = document.getElementById('broadcast-banner');
        if (d.broadcast) { banner.textContent = d.broadcast; banner.style.display = 'block'; }
        else { banner.style.display = 'none'; }

        if (d.accentColor) document.documentElement.style.setProperty('--accent', d.accentColor);
        if (d.fontDisplay || d.fontBody) {
            const families = [d.fontDisplay, d.fontBody].filter(Boolean).map(f => f.trim().replace(/ /g, '+'));
            document.getElementById('dynamic-fonts').href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}:wght@400;500;600`).join('&')}&display=swap`;
            if (d.fontDisplay) document.documentElement.style.setProperty('--font-display', `'${d.fontDisplay}', serif`);
            if (d.fontBody) document.documentElement.style.setProperty('--font-body', `'${d.fontBody}', sans-serif`);
        }

        const f = d.features || {};
        document.getElementById('dock-dashboard-link').style.display = f.dashboard === false ? 'none' : 'block';
        document.getElementById('dock-work-link').style.display = f.work === false ? 'none' : 'block';
        document.getElementById('dock-drop-link').style.display = f.drop === false ? 'none' : 'block';
        document.getElementById('dock-theater-link').style.display = f.theater === false ? 'none' : 'block';
        document.getElementById('dock-voice-link').style.display = f.voice === false ? 'none' : 'block';
        
        const radarCard = document.getElementById('radar-feed')?.closest('.card');
        if (radarCard) radarCard.style.display = f.radar === false ? 'none' : 'flex';

        const activeTarget = document.querySelector('.dock-app.active')?.getAttribute('data-target');
        if ((activeTarget === 'dashboard' && f.dashboard === false) || 
            (activeTarget === 'work' && f.work === false) || 
            (activeTarget === 'drop' && f.drop === false) || 
            (activeTarget === 'theater' && f.theater === false) || 
            (activeTarget === 'voice' && f.voice === false)) {
            
            const firstAvailable = document.querySelector('.dock-app[style*="display: block"], .dock-app:not([style*="display: none"])');
            if (firstAvailable) firstAvailable.click();
        }
    });
}

function initRadarFeed() {
    const feed = document.getElementById('radar-feed');
    const radarQuery = query(collection(db, 'radar_logs'), orderBy('timestamp', 'desc'), limit(20));
    onSnapshot(radarQuery, (snap) => {
        if (snap.empty) { feed.innerHTML = '<p style="font-size:12px; color:var(--ink-soft);">Waiting for telemetry...</p>'; return; }
        feed.innerHTML = '';
        snap.forEach(d => {
            const r = d.data();
            const row = document.createElement('div');
            row.className = 'radar-row';
            const when = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            row.innerHTML = `<span>${r.type || 'Visit'} — ${r.city || 'Unknown'}, ${r.country || ''}</span><span style="color:var(--ink-soft); font-family:var(--font-mono); font-size:11px;">${when}</span>`;
            feed.appendChild(row);
        });
    });
}

function initVoiceRoom() {
    const ROOM_ID = 'main-room';
    const roomRef = doc(db, 'voice_calls', ROOM_ID);
    const callerCandidatesRef = collection(roomRef, 'callerCandidates');
    const calleeCandidatesRef = collection(roomRef, 'calleeCandidates');
    const rtcConfig = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let role = null; 
    let unsubRoom = null, unsubCandidates = null;
    let analyser = null, analyserRaf = null;
    let heartbeatTimer = null;

    const orb = document.getElementById('voice-orb');
    const orbLabel = document.getElementById('voice-orb-label');
    const statusDot = document.getElementById('voice-status-dot');
    const statusText = document.getElementById('voice-status-text');
    const btnJoin = document.getElementById('btn-voice-join');
    const btnMute = document.getElementById('btn-voice-mute');
    const btnLeave = document.getElementById('btn-voice-leave');
    const remoteAudioEl = document.getElementById('voice-remote-audio');

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

    const startHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(async () => {
        try { await updateDoc(roomRef, { heartbeat: serverTimestamp() }); } catch(e) {}
      }, 15000);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    const watchRemoteVolume = (stream) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const source = ctx.createMediaStreamSource(stream);
            analyser = ctx.createAnalyser(); analyser.fftSize = 512;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
                analyser.getByteFrequencyData(data);
                const avg = data.reduce((a, b) => a + b, 0) / data.length;
                orb.classList.toggle('speaking', avg > 12);
                analyserRaf = requestAnimationFrame(tick);
            };
            tick();
        } catch (e) {}
    };

    async function cleanupPeer() {
        stopHeartbeat();
        if (analyserRaf) cancelAnimationFrame(analyserRaf);
        analyser = null;
        if (unsubRoom) { unsubRoom(); unsubRoom = null; }
        if (unsubCandidates) { unsubCandidates(); unsubCandidates = null; }
        if (pc) { pc.close(); pc = null; }
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        remoteStream = null;
        remoteAudioEl.srcObject = null;
        role = null;
        orb.classList.remove('speaking');
    }

    async function hangUp(deleteRoom) {
        triggerHaptic();
        await cleanupPeer();
        if (deleteRoom) {
            try {
                const [callerDocs, calleeDocs] = await Promise.all([getDocs(callerCandidatesRef), getDocs(calleeCandidatesRef)]);
                await Promise.all([
                    ...callerDocs.docs.map(d => deleteDoc(d.ref)),
                    ...calleeDocs.docs.map(d => deleteDoc(d.ref))
                ]);
                await deleteDoc(roomRef);
            } catch (e) {}
        }
        setUiState('idle');
        window.showToast('Call ended');
    }

    btnLeave.addEventListener('click', () => hangUp(true));

    btnMute.addEventListener('click', () => {
        if (!localStream) return;
        const track = localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
        btnMute.classList.toggle('muted', !track.enabled);
        triggerHaptic();
        window.showToast(track.enabled ? 'Microphone unmuted' : 'Microphone muted');
    });

    btnJoin.addEventListener('click', async () => {
        triggerHaptic();
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
            window.showToast('Microphone access is required', 'error');
            return;
        }

        pc = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        remoteStream = new MediaStream();
        remoteAudioEl.srcObject = remoteStream;
        pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
            watchRemoteVolume(remoteStream);
        };

        const existingSnap = await getDoc(roomRef);
        let existing = existingSnap.exists() ? existingSnap.data() : null;

        if (existing && existing.heartbeat) {
          const ageMs = Date.now() - existing.heartbeat.toMillis();
          if (ageMs > 35000) {
            await deleteDoc(roomRef);
            existing = null;
          }
        }

        if (!existing || !existing.offer || (existing.status === 'ended')) {
            role = 'caller';
            pc.onicecandidate = (e) => { if (e.candidate) addDoc(callerCandidatesRef, e.candidate.toJSON()); };

            const offerDesc = await pc.createOffer();
            await pc.setLocalDescription(offerDesc);
            await setDoc(roomRef, {
                offer: { type: offerDesc.type, sdp: offerDesc.sdp },
                answer: null, callerId: currentUser.id, callerName: currentUser.name, status: 'waiting',
                heartbeat: serverTimestamp()
            });
            setUiState('waiting');
            startHeartbeat();

            unsubRoom = onSnapshot(roomRef, async (snap) => {
                const data = snap.data();
                if (data && data.answer && pc && !pc.currentRemoteDescription) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    setUiState('connected');
                    window.showToast('Voice connected', 'success');
                }
                if (!snap.exists()) { await cleanupPeer(); setUiState('idle'); }
            });
            unsubCandidates = onSnapshot(calleeCandidatesRef, (snap) => {
                snap.docChanges().forEach(change => {
                    if (change.type === 'added' && pc) pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                });
            });
        } else if (existing.callerId === currentUser.id) {
            window.showToast('You already have a call open on another tab', 'error');
            await cleanupPeer();
            return;
        } else if (!existing.answer) {
            role = 'callee';
            pc.onicecandidate = (e) => { if (e.candidate) addDoc(calleeCandidatesRef, e.candidate.toJSON()); };

            await pc.setRemoteDescription(new RTCSessionDescription(existing.offer));
            const answerDesc = await pc.createAnswer();
            await pc.setLocalDescription(answerDesc);
            await updateDoc(roomRef, {
                answer: { type: answerDesc.type, sdp: answerDesc.sdp },
                calleeId: currentUser.id, calleeName: currentUser.name, status: 'connected',
                heartbeat: serverTimestamp()
            });
            setUiState('connected');
            startHeartbeat();
            window.showToast('Voice connected', 'success');

            unsubCandidates = onSnapshot(callerCandidatesRef, (snap) => {
                snap.docChanges().forEach(change => {
                    if (change.type === 'added' && pc) pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                });
            });
            unsubRoom = onSnapshot(roomRef, (snap) => { if (!snap.exists()) { cleanupPeer(); setUiState('idle'); } });
        } else {
            window.showToast('The Voice Room is currently full', 'error');
            await cleanupPeer();
            return;
        }
    });

    setUiState('idle');
}

function initWatchParty() {
    let currentSessionUrl = null;
    let isYt = false;
    let ytPlayer = null;
    let art = null; 
    let ignoreNextSync = false;
    let wakeLock = null;

    const requestWakeLock = async () => { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} };

    let ytApiReady = false;
    window.onYouTubeIframeAPIReady = function() { ytApiReady = true; };
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    const joinOverlay = document.getElementById('theater-join-overlay');
    document.getElementById('btn-join-party').addEventListener('click', () => {
        triggerHaptic();
        joinOverlay.style.display = 'none';
        document.getElementById('theater-player-slot').style.display = 'flex';
    });

    document.getElementById('btn-load-cowatch').addEventListener('click', async () => {
        const urlInput = document.getElementById('cowatch-url-input');
        const url = urlInput.value.trim();
        if (!url) return;
        triggerHaptic();
        joinOverlay.style.display = 'none';
        await mountMedia(url);
        pushState(true, 0);
        urlInput.value = '';
    });

    const pushState = (isPlaying, time) => {
        if(ignoreNextSync) return;
        setDoc(doc(db, 'system', 'watch_party'), { url: currentSessionUrl, isPlaying: isPlaying, timestamp: time, updatedAt: serverTimestamp(), updatedBy: currentUser.name });
    };

    const mountMedia = async (rawUrl) => {
        currentSessionUrl = rawUrl;
        document.getElementById('theater-player-slot').style.display = 'none';
        document.getElementById('yt-container').style.display = 'none';

        if (/(youtube\.com|youtu\.be)/.test(rawUrl)) {
            isYt = true;
            document.getElementById('yt-container').style.display = 'block';
            
            let videoId = '';
            const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
            const match = rawUrl.match(ytRegex);
            if(match) videoId = match[1];

            if(art) { art.destroy(); art = null; }

            if (ytPlayer && ytPlayer.loadVideoById) {
                ytPlayer.loadVideoById(videoId);
            } else {
                if (!ytApiReady || typeof YT === 'undefined' || !YT.Player) { 
                    setTimeout(() => mountMedia(rawUrl), 1000); 
                    return; 
                }
                ytPlayer = new YT.Player('yt-player-slot', {
                    videoId: videoId, playerVars: { 'autoplay': 1, 'controls': 1 },
                    events: {
                        'onStateChange': (e) => {
                            if (e.data === YT.PlayerState.PLAYING) pushState(true, ytPlayer.getCurrentTime());
                            if (e.data === YT.PlayerState.PAUSED) pushState(false, ytPlayer.getCurrentTime());
                        }
                    }
                });
            }
        } else {
            isYt = false;
            document.getElementById('theater-player-slot').style.display = 'block';
            if(ytPlayer && ytPlayer.stopVideo) { ytPlayer.stopVideo(); }
            if(art) art.destroy();

            let secureUrl = rawUrl;
            if (rawUrl.startsWith(`${TUNNEL_URL}/stream/`)) {
                try {
                    const filename = decodeURIComponent(rawUrl.split('/').pop().split('?')[0]);
                    const tokRes = await fetchWithAuth(`${TUNNEL_URL}/api/stream-token`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename })
                    });
                    if (tokRes.ok) {
                        const { token } = await tokRes.json();
                        secureUrl = rawUrl.includes('?') ? `${rawUrl}&stream_token=${token}` : `${rawUrl}?stream_token=${token}`;
                    }
                } catch (e) {}
            }

            art = new Artplayer({
                container: '#theater-player-slot', url: secureUrl, theme: '#70947A',
                fullscreen: true, setting: true, playbackRate: true, aspectRatio: true, fastForward: true, miniProgressBar: true,
                pip: true, playsInline: true, autoOrientation: true
            });

            art.on('play', () => { requestWakeLock(); pushState(true, art.currentTime); });
            art.on('pause', () => { if(wakeLock) { wakeLock.release(); wakeLock = null; } pushState(false, art.currentTime); });
            art.on('seek', () => { pushState(art.playing, art.currentTime); });
            art.on('fullscreen', (state) => {
                if (/iPhone/.test(navigator.userAgent) && state && art.video.webkitEnterFullscreen) {
                    art.video.webkitEnterFullscreen(); art.fullscreen = false;
                }
            });
        }
    };

    window.__lairTheater = {
        mountMediaFromWatchlist: async (url) => {
            document.getElementById('theater-player-slot').style.display = 'flex';
            await mountMedia(url);
            pushState(true, 0);
        }
    };

    onSnapshot(doc(db, 'system', 'watch_party'), (snap) => {
        if(!snap.exists()) return;
        const data = snap.data();
        if(data.url && data.url !== currentSessionUrl) mountMedia(data.url);
        if(data.updatedBy === currentUser.name) return; 

        const expectedTime = data.timestamp + (data.updatedAt ? ((Date.now() - data.updatedAt.toMillis()) / 1000) : 0);
        ignoreNextSync = true;
        
        if (isYt && ytPlayer && ytPlayer.getPlayerState) {
            if (Math.abs(ytPlayer.getCurrentTime() - expectedTime) > 2.0) ytPlayer.seekTo(expectedTime, true);
            if (data.isPlaying && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) ytPlayer.playVideo();
            if (!data.isPlaying && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        } else if (!isYt && art) {
            if (Math.abs(art.currentTime - expectedTime) > 2.0) art.currentTime = expectedTime;
            if (data.isPlaying && !art.playing) art.play();
            if (!data.isPlaying && art.playing) art.pause();
        }
        setTimeout(() => { ignoreNextSync = false; }, 500);
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
          if (activeTarget === 'drop' || activeTarget === 'work') {
              cameraInput.click();
          }
      };
  }

  if (cameraInput && !cameraInput.__hasListener) {
      cameraInput.__hasListener = true;
      cameraInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          window.showToast('Streaming direct to Home PC...', 'info');
          const fd = new FormData();
          fd.append('photo', file);

          try {
              const res = await fetchWithAuth(`${TUNNEL_URL}/api/photos/upload`, {
                  method: 'POST',
                  body: fd
              });

              if (res.ok) {
                  window.showToast('Safely stored in PC Vault ✔', 'success');
                  initVault();
              } else {
                  throw new Error();
              }
          } catch (err) {
              window.showToast('Upload failed: Home PC unreachable', 'error');
          } finally {
              cameraInput.value = '';
          }
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
                const bgStyle = isPdf ? `background:url('${bgImage}') center/contain no-repeat; background-color: var(--glass-bg);` : `background:url('${bgImage}') center/cover;`;
                
                gridHtml += `<div class="vault-thumb-card media-card haptic-btn" data-url="${p.url}" data-filename="${p.filename}" style="${bgStyle}"></div>`; 
              });
              container.innerHTML += gridHtml;
            }
        };

        renderGrid(allFiles.filter(f => /\.(jpg|jpeg|png|webp|heic|gif)$/i.test(f.filename)), 'timeline-photos');
        renderGrid(allFiles.filter(f => /\.(mp4|mov|m4v)$/i.test(f.filename)), 'timeline-videos');
        renderGrid(allFiles.filter(f => /\.(pdf)$/i.test(f.filename)), 'timeline-docs');

        document.querySelectorAll('.media-card').forEach(card => {
          card.addEventListener('click', () => {
            triggerHaptic(); 
            activeLightboxFile = card.getAttribute('data-filename');
            
            if (activeLightboxFile.toLowerCase().endsWith('.pdf')) {
                window.open(card.getAttribute('data-url'), '_blank');
            } else {
                document.getElementById('lightbox-img').src = card.getAttribute('data-url'); 
                document.getElementById('photo-lightbox').classList.add('active');
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
