require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

// Safe Sharp Loader
let sharp;
try { sharp = require('sharp'); } 
catch (e) { console.warn('[Lair OS] Sharp module unavailable. WebP compression bypassed.'); }

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const app = express();

// --- MASTER CONFIGURATION ---
const SPREADSHEET_ID = '1uX2OOd4HE3c_-Vl-PkeQhZicY2cFh3qFxASG7yl_uEo';
const VW_SPREADSHEET_ID = '1PVfQqctgI3cehaNjb_6rabkDauudfKYmiJJafLQ3haw';
const TUNNEL_URL = 'https://vault.ibadhasan.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const STREAM_SECRET = process.env.STREAM_TOKEN_SECRET;

if (!STREAM_SECRET) console.warn('[Lair OS] WARNING: STREAM_TOKEN_SECRET is not set in .env.');

function issueStreamToken(uid, filename, hours = 6) {
  if (!STREAM_SECRET) throw new Error('STREAM_TOKEN_SECRET not configured');
  return jwt.sign({ uid, filename }, STREAM_SECRET, { expiresIn: `${hours}h` });
}

const allowedOrigins = [
  'https://cryeterialoginpage.firebaseapp.com',
  'https://cryeterialoginpage.web.app',
  'https://vault.ibadhasan.com',
  'https://ibadhasan.com',
  'https://www.ibadhasan.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(null, false);
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname, { extensions: ['html'] }));

async function verifyToken(req, res, next) {
  const streamToken = req.query.stream_token;
  if (streamToken) {
    if (!STREAM_SECRET) return res.status(503).json({ error: 'Streaming temporarily unavailable.' });
    try {
      const payload = jwt.verify(streamToken, STREAM_SECRET);
      const requestedFile = req.params.filename ? path.basename(req.params.filename) : null;
      if (requestedFile && payload.filename !== requestedFile) return res.status(403).json({ error: 'Forbidden' });
      req.user = { uid: payload.uid };
      return next();
    } catch (e) { return res.status(403).json({ error: 'Forbidden' }); }
  }

  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split('Bearer ')[1];
  else if (req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token.' });

  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) { return res.status(403).json({ error: 'Forbidden: Expired token.' }); }
}

app.post('/api/stream-token', verifyToken, (req, res) => {
  const filename = path.basename(req.body.filename || '');
  if (!filename) return res.status(400).json({ error: 'filename required' });
  try { res.json({ token: issueStreamToken(req.user.uid, filename, 6) }); } 
  catch (e) { res.status(503).json({ error: 'Streaming unavailable.' }); }
});

const moviesDir = path.join(__dirname, 'Movies');
const photosDir = path.join(__dirname, 'Photography');
const thumbsDir = path.join(photosDir, '.thumbs');
const invoicesDir = path.join(__dirname, 'Invoices');

if (!fs.existsSync(moviesDir)) fs.mkdirSync(moviesDir);
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir);
if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, photosDir),
    filename: (req, file, cb) => {
        const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '')}`;
        cb(null, safeName);
    }
});
const upload = multer({ storage: storage });
const uploadInvoice = multer({ dest: invoicesDir });

// --- THE TRI-CORE LOAD BALANCER ---
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3
].filter(Boolean);

app.post('/api/work/extract', verifyToken, uploadInvoice.single('invoice'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const activeKey = API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
        const genAI = new GoogleGenerativeAI(activeKey);
        
        const fileBytes = fs.readFileSync(req.file.path);
        const base64Data = fileBytes.toString("base64");
        const fileMimeType = req.file.mimetype; 
        
        const prompt = `You are a financial auditor. Read this invoice and extract the details. Return strictly a raw JSON object (no markdown) with exact keys: "subcontractor_name" (String), "invoice_number" (String), "invoice_date" (YYYY-MM-DD), "trn" (String or ""), "net_amount" (Number), "vat_amount" (Number), "total_amount" (Number).`;
        
        const models = ["gemini-1.5-flash", "gemini-1.5-pro"];
        let result = null;
        let lastError = null;

        for (const modelName of models) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                let delay = 2000;
                const maxRetries = 5;
                
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        result = await model.generateContent([ prompt, { inlineData: { data: base64Data, mimeType: fileMimeType } } ]);
                        break; 
                    } catch (error) {
                        const isOverloaded = error.status === 503 || error.status === 429 || (error.message && /high demand|quota|overloaded/i.test(error.message));
                        if (isOverloaded && i < maxRetries - 1) {
                            const waitTime = delay + Math.floor(Math.random() * 1000); 
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            delay *= 2; 
                        } else { throw error; }
                    }
                }
                if (result) break; 
            } catch (err) { lastError = err; }
        }
        
        if (!result) throw lastError || new Error('All models failed.');

        let rawText = result.response.text().trim();
        if (rawText.startsWith('```json')) rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (rawText.startsWith('```')) rawText = rawText.replace(/^```/, '').replace(/```$/, '').trim();
        
        const data = JSON.parse(rawText);
        fs.unlinkSync(req.file.path); 
        res.json(data);
    } catch(e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Extraction failed' });
    }
});

app.post('/api/work/sync', verifyToken, async (req, res) => {
    try {
        const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
        if (!rows.length) return res.json({ success: true, added: 0, skipped: [] });

        const authClient = new google.auth.GoogleAuth({ keyFile: './serviceAccountKey.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!C2:C' });
        const seenInvoiceNumbers = new Set((existing.data.values || []).flat().map(v => String(v).trim()).filter(Boolean));

        const skipped = [];
        const toWrite = rows.filter(row => {
            const invoiceNumber = String(row[2] || '').trim();
            if (invoiceNumber && seenInvoiceNumbers.has(invoiceNumber)) { skipped.push(invoiceNumber); return false; }
            if (invoiceNumber) seenInvoiceNumbers.add(invoiceNumber); 
            return true;
        });

        let rowIndex = null;
        if (toWrite.length) {
            const appendRes = await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!A:H', valueInputOption: 'USER_ENTERED', requestBody: { values: toWrite }
            });
            const match = appendRes.data.updates.updatedRange.match(/\d+/);
            if(match) rowIndex = parseInt(match[0], 10);
        }

        res.json({ success: true, added: toWrite.length, skipped, rowIndex });
    } catch(e) { res.status(500).json({ error: 'Failed to sync' }); }
});

// --- LIVE GOOGLE SHEETS HYDRATION (Auditor PRO) ---
app.get('/api/work/ledger', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ 
            keyFile: './serviceAccountKey.json', 
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] 
        });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A2:H'
        });

        const rows = response.data.values || [];
        let totalNet = 0, totalVat = 0, grossTotal = 0;

        const formattedRows = rows.map((row, index) => {
            const net = Number(String(row[5] || '0').replace(/,/g, '')) || 0;
            const vat = Number(String(row[6] || '0').replace(/,/g, '')) || 0;
            const total = Number(String(row[7] || '0').replace(/,/g, '')) || 0;

            totalNet += net;
            totalVat += vat;
            grossTotal += total;

            return {
                sheetRow: index + 2,
                taskId: row[0] || 'UNASSIGNED',
                subcontractor: row[1] || '',
                invoiceNumber: row[2] || '',
                date: row[3] || '',
                trn: row[4] || '',
                net,
                vat,
                total
            };
        });

        res.json({
            count: formattedRows.length,
            net: totalNet,
            vat: totalVat,
            gross: grossTotal,
            rows: formattedRows.reverse()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load ledger from Sheets.' });
    }
});

// --- LIVE VARIABLE WORKS (VW) TRACKER HYDRATION ---
app.get('/api/work/vw-tracker', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ 
            keyFile: './serviceAccountKey.json', 
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] 
        });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const meta = await sheets.spreadsheets.get({ spreadsheetId: VW_SPREADSHEET_ID });
        const sheetName = meta.data.sheets[0].properties.title;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: VW_SPREADSHEET_ID,
            range: `${sheetName}!A1:AZ`
        });

        const rows = response.data.values || [];
        if (rows.length === 0) return res.json({ count: 0, totalSupplierCost: 0, totalWaslCost: 0, statusCounts: {}, rows: [] });

        const headers = rows[0];
        const dataRows = rows.slice(1);

        let totalSupplierCost = 0;
        let totalWaslCost = 0;
        const statusCounts = {};

        const formattedRows = dataRows.map((row, index) => {
            const getCol = (name) => {
                const idx = headers.indexOf(name);
                return idx !== -1 ? (row[idx] || '') : '';
            };

            const supplierCost = Number(String(getCol('Total Supplier Cost ()') || '0').replace(/,/g, '')) || 0;
            const waslCost = Number(String(getCol('Total WASL Cost ()') || '0').replace(/,/g, '')) || 0;
            const status = getCol('AGFS Works Status') || 'Pending';

            totalSupplierCost += supplierCost;
            totalWaslCost += waslCost;
            statusCounts[status] = (statusCounts[status] || 0) + 1;

            return {
                sheetRow: index + 2,
                crmRef: getCol('CRM REF'),
                qtnRef: getCol('QTN REF'),
                qtnDate: getCol('QTN DATE'),
                description: getCol('Description'),
                majorCategory: getCol('Major Category'),
                minorCategory: getCol('Minor Category'),
                building: getCol('Building'),
                apartment: getCol('Apartment'),
                qtnAssignedTo: getCol('QTN Assigned To'),
                supplierName: getCol('Supplier Name'),
                supplierCost,
                waslCost,
                orderType: getCol('Order Type'),
                waslOrder: getCol('WASL Order'),
                purchaseOrder: getCol('Purchase Order'),
                worksStatus: status,
                workCompletionDate: getCol('Work Completion Date'),
                wcrPrepared: getCol('WCR Prepared (Yes/Pending/NA)'),
                wcrSigned: getCol('WCR Signed from WASL (Yes/No)'),
                wcrUploadedSap: getCol('WCR Uploaded in SAP (Yes/No)'),
                poReference: getCol('PO Reference'),
                invoiceNumber: getCol('Invoice Number'),
                invoiceDate: getCol('Invoice Date'),
                taskId: getCol('AGFS CAFM Work Order Number (Task ID)'),
                remarks: getCol('Remarks'),
                waslEngineer: getCol('WASL Engineer'),
                rawHeaders: headers,
                rawValues: row
            };
        });

        res.json({
            count: formattedRows.length,
            totalSupplierCost,
            totalWaslCost,
            statusCounts,
            rows: formattedRows.reverse()
        });
    } catch (error) {
        console.error('[Lair OS] VW Tracker Fetch Error:', error);
        res.status(500).json({ error: 'Failed to load Variable Works tracker from Google Sheets.' });
    }
});

// --- AI EXECUTIVE BRIEFING (COMPLIANCE & BILLING) ---
app.get('/api/work/vw-briefing', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ 
            keyFile: './serviceAccountKey.json', 
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] 
        });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const meta = await sheets.spreadsheets.get({ spreadsheetId: VW_SPREADSHEET_ID });
        const sheetName = meta.data.sheets[0].properties.title;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: VW_SPREADSHEET_ID,
            range: `${sheetName}!A1:AZ`
        });

        const rows = response.data.values || [];
        if (rows.length <= 1) return res.json({ summary: "No data available to analyze." });

        const headers = rows[0];
        const dataRows = rows.slice(1);

        // Compliance Counters
        let metrics = {
            totalWorks: dataRows.length,
            completedWorks: 0,
            missingWcr: 0,
            missingSapUpload: 0,
            missingTijoriUpload: 0,
            pendingWaslPo: 0
        };

        dataRows.forEach(row => {
            const getCol = (name) => {
                const idx = headers.indexOf(name);
                return idx !== -1 ? (row[idx] || '').toString().trim() : '';
            };

            const status = getCol('AGFS Works Status');
            const wcrPrepared = getCol('WCR Prepared (Yes/Pending/NA)');
            const sapUpload = getCol('WCR Uploaded in SAP (Yes/No)');
            const tijoriUpload = getCol('Quote Uploaded in Tijori (Yes/No)');
            const purchaseOrder = getCol('Purchase Order');

            if (status.toLowerCase().includes('completed')) {
                metrics.completedWorks++;
                if (wcrPrepared.toLowerCase() !== 'yes' && wcrPrepared.toLowerCase() !== 'na') metrics.missingWcr++;
                if (sapUpload.toLowerCase() !== 'yes' && sapUpload.toLowerCase() !== 'na') metrics.missingSapUpload++;
            }

            if (tijoriUpload.toLowerCase() === 'no' || tijoriUpload === '') metrics.missingTijoriUpload++;
            if (purchaseOrder === '' || purchaseOrder.toLowerCase() === 'pending') metrics.pendingWaslPo++;
        });

        // Construct the optimized payload for Gemini
        const prompt = `
            You are an elite Facility Management & Financial Auditor. Analyze the following operational compliance snapshot for a property management portfolio. 
            Provide a crisp, professional 3-4 sentence executive summary highlighting the primary bottlenecks in billing and document closure.
            Use a direct, authoritative tone. Do not use pleasantries.
            
            DATA SNAPSHOT:
            - Total Tracked Works: ${metrics.totalWorks}
            - Physically Completed Works: ${metrics.completedWorks}
            - Completed but missing WCR (Billing Blocker): ${metrics.missingWcr}
            - WCR Prepared but missing SAP Upload (Invoicing Blocker): ${metrics.missingSapUpload}
            - Quotes missing Tijori Upload: ${metrics.missingTijoriUpload}
            - Active jobs missing WASL Purchase Order: ${metrics.pendingWaslPo}
        `;

        const activeKey = API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
        const genAI = new GoogleGenerativeAI(activeKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const aiResponse = await model.generateContent(prompt);
        let summaryText = aiResponse.response.text().trim();

        res.json({ metrics, summary: summaryText });
    } catch (error) {
        console.error('[Lair OS] AI Briefing Error:', error);
        res.status(500).json({ error: 'Failed to generate AI briefing.' });
    }
});

// --- INLINE GOOGLE SHEETS EDITING ---
app.post('/api/work/update-cell', verifyToken, async (req, res) => {
    try {
        const { row, col, value } = req.body;
        const sheetCol = String.fromCharCode(65 + col); 
        const range = `Sheet1!${sheetCol}${row}`;
        
        const authClient = new google.auth.GoogleAuth({ keyFile: './serviceAccountKey.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] }
        });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Cell update failed' }); }
});

async function generateThumbnail(filename) {
  if (!sharp) return null;
  const ext = path.extname(filename).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return null;
  const sourcePath = path.join(photosDir, filename);
  const thumbName = `${filename}.webp`;
  const thumbPath = path.join(thumbsDir, thumbName);
  
  if (fs.existsSync(thumbPath)) return thumbName;
  try {
    await sharp(sourcePath).resize(320, 320, { fit: 'cover' }).webp({ quality: 80 }).toFile(thumbPath);
    return thumbName;
  } catch (e) { return null; }
}

let prevCpu = { idle: 0, total: 0 };
function getCpuSnapshot() {
    const cpus = os.cpus();
    let idle = 0; let total = 0;
    cpus.forEach(cpu => { for (const type in cpu.times) total += cpu.times[type]; idle += cpu.times.idle; });
    return { idle: idle / cpus.length, total: total / cpus.length };
}

app.get('/api/stats', verifyToken, (req, res) => {
    try {
        const current = getCpuSnapshot();
        const idleDiff = current.idle - prevCpu.idle;
        const totalDiff = current.total - prevCpu.total;
        prevCpu = current;
        const usage = totalDiff === 0 ? "0.0" : Math.max(0, Math.min(100, 100 - (100 * idleDiff / totalDiff))).toFixed(1);
        const totalMem = os.totalmem(); const freeMem = os.freemem();
        const ramPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1);
        res.json({ cpu: usage, ram: ramPercent });
    } catch(e) { res.json({ cpu: "0.0", ram: "0.0" }); }
});

const COMMAND_WHITELIST = {
    'help': 'echo Available commands: ping, ip, uptime, storage, tasks, ver, git pull, git status',
    'ping': 'ping -n 3 8.8.8.8',
    'ip': 'ipconfig',
    'uptime': 'net statistics workstation',
    'storage': 'powershell -command "Get-Volume | Select-Object DriveLetter, FileSystemLabel, SizeRemaining, Size"',
    'tasks': 'tasklist /fi "STATUS eq running" /fo table /nh',
    'ver': 'ver', 'git pull': 'git pull', 'git status': 'git status -s'
};

app.post('/api/terminal', verifyToken, (req, res) => {
    const rawCmd = (req.body.command || '').trim().toLowerCase();
    const targetCmd = COMMAND_WHITELIST[rawCmd];
    if (!targetCmd) return res.json({ output: `Command '${rawCmd}' is not permitted. Type 'help'.` });
    exec(targetCmd, { timeout: 12000, windowsHide: true }, (error, stdout, stderr) => {
        res.json({ output: stdout || stderr || (error ? error.message : '') || 'Command executed.' });
    });
});

app.get('/api/storage', verifyToken, (req, res) => {
    let totalBytes = 0;
    try {
        if (fs.existsSync(photosDir)) fs.readdirSync(photosDir).forEach(f => { if (f !== '.thumbs') { try { totalBytes += fs.statSync(path.join(photosDir, f)).size; } catch(err) {} } });
        if (fs.existsSync(moviesDir)) fs.readdirSync(moviesDir).forEach(f => { try { totalBytes += fs.statSync(path.join(moviesDir, f)).size; } catch(err) {} });
        res.json({ totalBytes, maxBytes: 100 * 1024 * 1024 * 1024 });
    } catch(e) { res.json({ totalBytes: 0, maxBytes: 100 * 1024 * 1024 * 1024 }); }
});

app.use('/stream/photography', verifyToken, express.static(photosDir));

app.get('/stream/photography/thumb/:filename', verifyToken, async (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const thumbName = `${safeFilename}.webp`;
    const thumbPath = path.join(thumbsDir, thumbName);
    if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);
    const created = await generateThumbnail(safeFilename);
    if (created && fs.existsSync(thumbPath)) return res.sendFile(thumbPath);
    const originalPath = path.join(photosDir, safeFilename);
    if (fs.existsSync(originalPath)) return res.sendFile(originalPath);
    res.status(404).send('Not found');
});

app.get('/api/photos', verifyToken, (req, res) => {
    try {
        if (!fs.existsSync(photosDir)) return res.json([]);
        const files = fs.readdirSync(photosDir).filter(f => f !== '.thumbs' && /\.(jpg|jpeg|png|webp|heic|gif|mp4|mov|m4v|pdf)$/i.test(f));
        const photoList = [];
        files.forEach(file => {
            try {
                const stats = fs.statSync(path.join(photosDir, file));
                const timestamp = stats.birthtimeMs || stats.mtimeMs || Date.now();
                let url = `${TUNNEL_URL}/stream/photography/${encodeURIComponent(file)}`;
                let thumbUrl = `${TUNNEL_URL}/stream/photography/thumb/${encodeURIComponent(file)}`;
                try {
                    const streamToken = issueStreamToken(req.user.uid, file, 12);
                    url += `?stream_token=${streamToken}`; thumbUrl += `?stream_token=${streamToken}`;
                } catch (e) {}
                photoList.push({
                    filename: file, url, thumbUrl, size: stats.size, timestamp: timestamp,
                    dateFormatted: new Date(timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                });
            } catch(err) {}
        });
        res.json(photoList.sort((a, b) => b.timestamp - a.timestamp));
    } catch(err) { res.json([]); }
});

app.post('/api/photos/upload', verifyToken, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    await generateThumbnail(req.file.filename);
    res.json({ success: true });
});

app.delete('/api/photos/delete/:filename', verifyToken, (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(photosDir, safeFilename);
    const thumbPath = path.join(thumbsDir, `${safeFilename}.webp`);
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Deletion failed' }); }
});

app.get('/api/download/movies/:filename', verifyToken, (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(moviesDir, safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
});

app.get('/stream/movies/:filename', verifyToken, (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(moviesDir, safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    const stat = fs.statSync(filePath); const fileSize = stat.size; const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-"); const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + (5 * 1024 * 1024) - 1, fileSize - 1);
        if (start >= fileSize || end >= fileSize) { res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }); return res.end(); }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': (end - start) + 1, 'Content-Type': 'video/mp4' });
        fs.createReadStream(filePath, {start, end}).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
        fs.createReadStream(filePath, {start, end}).pipe(res);
    }
});

app.get('/api/tmdb/search', verifyToken, async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) return res.json({ results: [] });
    if (!TMDB_API_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not configured.' });
    try {
        const tmdbRes = await axios.get('https://api.themoviedb.org/3/search/multi', { params: { api_key: TMDB_API_KEY, query, include_adult: false } });
        const results = (tmdbRes.data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 12).map(r => ({
            id: r.id, title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4),
            poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : '', type: r.media_type === 'movie' ? 'Movie' : 'TV Show'
        }));
        res.json({ results });
    } catch (e) { res.status(502).json({ error: 'TMDB lookup failed.' }); }
});

const PORT = 3005;
app.listen(PORT, () => console.log(`[Lair OS] Engine running securely on port ${PORT}`));
