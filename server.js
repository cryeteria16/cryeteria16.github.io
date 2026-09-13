// server.js
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

let sharp;
try { sharp = require('sharp'); } 
catch (e) { console.warn('[Lair OS] Sharp module unavailable. WebP compression bypassed.'); }

let heicConvert;
try { heicConvert = require('heic-convert'); } 
catch (e) { console.warn('[Lair OS] heic-convert module unavailable. iPhone photos will not convert.'); }

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const app = express();

const SPREADSHEET_ID = '1uX2OOd4HE3c_-Vl-PkeQhZicY2cFh3qFxASG7yl_uEo'; // Your private Auditor Ledger
const VW_SPREADSHEET_ID = '16xMK8-wOZsysB2g28uwzN0BL3iZg3jet-_Nv_M9jxB4'; // The Manager's New Sheet (READ ONLY)
const TUNNEL_URL = 'https://vault.ibadhasan.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const STREAM_SECRET = process.env.STREAM_TOKEN_SECRET;

if (!STREAM_SECRET) console.warn('[Lair OS] WARNING: STREAM_TOKEN_SECRET is not set in .env.');

function issueStreamToken(uid, filename, hours = 6) {
  if (!STREAM_SECRET) throw new Error('STREAM_TOKEN_SECRET not configured');
  return jwt.sign({ uid, filename }, STREAM_SECRET, { expiresIn: `${hours}h` });
}

function extractCleanJSON(rawText) {
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
    
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned);
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
const uploadPO = multer({ dest: invoicesDir });

const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3
].filter(Boolean);

app.get('/api/public/cloud/:filename', async (req, res) => {
    try {
        const safeFilename = path.basename(req.params.filename);
        const snap = await db.collection('public_photos').doc(safeFilename).get();
        if (!snap.exists) return res.status(403).send('Forbidden: Not in Exhibition');
        
        const filePath = path.join(photosDir, safeFilename);
        if (fs.existsSync(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.sendFile(filePath);
        }
        res.status(404).send('Not found');
    } catch(e) {
        res.status(500).send('Server Error');
    }
});

app.post('/api/work/extract', verifyToken, uploadInvoice.single('invoice'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (API_KEYS.length === 0) return res.status(503).json({ error: 'No AI configuration found on server.' });
    
    try {
        const activeKey = API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
        const genAI = new GoogleGenerativeAI(activeKey);
        const fileBytes = fs.readFileSync(req.file.path);
        const base64Data = fileBytes.toString("base64");
        
        const prompt = `You are a financial auditor. Read this invoice and extract the details. Return strictly a raw JSON object (no markdown) with exact keys: "subcontractor_name" (String), "invoice_number" (String), "invoice_date" (YYYY-MM-DD), "trn" (String or ""), "net_amount" (Number), "vat_amount" (Number), "total_amount" (Number).`;
        
        let result = null;
        for (const modelName of ["gemini-3.8-flash", "gemini-3.1-pro-preview"]) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" }});
                result = await model.generateContent([ prompt, { inlineData: { data: base64Data, mimeType: "application/pdf" } } ]);
                break; 
            } catch (err) {}
        }
        
        if (!result) throw new Error('All models failed.');

        const data = extractCleanJSON(result.response.text());
        fs.unlinkSync(req.file.path); 
        res.json(data);
    } catch(e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Extraction failed' });
    }
});

app.post('/api/work/extract-po', verifyToken, uploadPO.single('po_file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No PO file uploaded' });
    if (API_KEYS.length === 0) return res.status(503).json({ error: 'No AI config found on server.' });
    
    try {
        const activeKey = API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
        const genAI = new GoogleGenerativeAI(activeKey);
        const fileBytes = fs.readFileSync(req.file.path);
        
        const prompt = `You are an elite procurement auditor. Read this Microsoft Dynamics Purchase Order PDF and extract the details. Return strictly a raw JSON object (no markdown) with exact keys: "po_number", "po_date", "supplier_name", "building", "project_name", "net_amount", "tax_amount", "total_amount", "line_items" (Array of objects with "item", "qty", "total").`;
        
        let result = null;
        for (const modelName of ["gemini-3.8-flash", "gemini-3.1-pro-preview"]) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" }});
                result = await model.generateContent([ prompt, { inlineData: { data: fileBytes.toString("base64"), mimeType: "application/pdf" } } ]);
                break; 
            } catch (err) {}
        }
        
        const data = extractCleanJSON(result.response.text());
        fs.unlinkSync(req.file.path); 
        res.json(data);
    } catch(e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'PO extraction failed' });
    }
});

// REMOVED: /api/work/sync-po-to-sheet
// ENFORCING STRICT READ-ONLY POLICY ON MANAGER'S SHEET

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

app.get('/api/work/ledger', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ keyFile: './serviceAccountKey.json', scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Sheet1!A2:H' });

        const rows = response.data.values || [];
        let totalNet = 0, totalVat = 0, grossTotal = 0;

        const formattedRows = rows.map((row, index) => {
            const net = Number(String(row[5] || '0').replace(/,/g, '')) || 0;
            const vat = Number(String(row[6] || '0').replace(/,/g, '')) || 0;
            const total = Number(String(row[7] || '0').replace(/,/g, '')) || 0;
            totalNet += net; totalVat += vat; grossTotal += total;

            return { sheetRow: index + 2, taskId: row[0] || '', subcontractor: row[1] || '', invoiceNumber: row[2] || '', date: row[3] || '', trn: row[4] || '', net, vat, total };
        });

        res.json({ count: formattedRows.length, net: totalNet, vat: totalVat, gross: grossTotal, rows: formattedRows.reverse() });
    } catch (error) { res.status(500).json({ error: 'Failed to load ledger.' }); }
});

// PASSIVE SYNC TO MANAGER'S SHEET - STRICT READ ONLY SCOPE
app.get('/api/work/vw-tracker', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ 
            keyFile: './serviceAccountKey.json', 
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] // Impenetrable read-only wall
        });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const meta = await sheets.spreadsheets.get({ spreadsheetId: VW_SPREADSHEET_ID });
        // Target VW_Tracker tab explicitly, fallback to first tab if missing
        const targetSheet = meta.data.sheets.find(s => s.properties.title === 'VW_Tracker') || meta.data.sheets[0];
        const sheetName = targetSheet.properties.title;
        
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: VW_SPREADSHEET_ID, range: `'${sheetName}'!A1:AZ` });

        const rows = response.data.values || [];
        // We pass the raw matrix directly to the frontend to allow the dashboard to parse and render it dynamically
        res.json({ success: true, rows });
    } catch (error) { 
        console.error('[Lair OS] VW Tracker Sync Error:', error.message);
        res.status(500).json({ error: 'Failed to load VW tracker from Google Cloud.' }); 
    }
});

app.post('/api/work/update-cell', verifyToken, async (req, res) => {
    try {
        const { row, col, value } = req.body;
        const authClient = new google.auth.GoogleAuth({ keyFile: './serviceAccountKey.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range: `Sheet1!${String.fromCharCode(65 + col)}${row}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[value]] }
        });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Cell update failed' }); }
});

async function generateThumbnail(filename) {
  if (!sharp) return null;
  const ext = path.extname(filename).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext)) return null;
  
  const sourcePath = path.join(photosDir, filename);
  const thumbName = `${filename}.webp`;
  const thumbPath = path.join(thumbsDir, thumbName);
  
  if (fs.existsSync(thumbPath)) return thumbName;
  try {
    await sharp(sourcePath)
      .resize(300, 300, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 65, effort: 6, smartSubsample: true })
      .withMetadata(false) 
      .toFile(thumbPath);
    return thumbName;
  } catch (e) {
    return null; 
  }
}

app.get('/api/stats', verifyToken, (req, res) => {
    const cpus = os.cpus();
    let idle = 0; let total = 0;
    cpus.forEach(cpu => { for (const type in cpu.times) total += cpu.times[type]; idle += cpu.times.idle; });
    const usage = Math.max(0, Math.min(100, 100 - (100 * idle / total))).toFixed(1);
    const ramPercent = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1);
    res.json({ cpu: usage, ram: ramPercent });
});

app.post('/api/terminal', verifyToken, (req, res) => {
    const cmd = (req.body.command || '').trim().toLowerCase();
    const whitelist = { 'ping': 'ping -n 3 8.8.8.8', 'ip': 'ipconfig', 'uptime': 'net statistics workstation', 'ver': 'ver', 'git pull': 'git pull' };
    if (!whitelist[cmd]) return res.json({ output: `Command '${cmd}' not permitted.` });
    exec(whitelist[cmd], { timeout: 12000, windowsHide: true }, (error, stdout, stderr) => { res.json({ output: stdout || stderr || 'Executed.' }); });
});

app.get('/api/storage', verifyToken, (req, res) => {
    let totalBytes = 0;
    try {
        if (fs.existsSync(photosDir)) fs.readdirSync(photosDir).forEach(f => { if (f !== '.thumbs') totalBytes += fs.statSync(path.join(photosDir, f)).size; });
        if (fs.existsSync(moviesDir)) fs.readdirSync(moviesDir).forEach(f => totalBytes += fs.statSync(path.join(moviesDir, f)).size);
        res.json({ totalBytes, maxBytes: 100 * 1024 * 1024 * 1024 });
    } catch(e) { res.json({ totalBytes: 0, maxBytes: 100 * 1024 * 1024 * 1024 }); }
});

app.get('/stream/photography/thumb/:filename', verifyToken, async (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const thumbName = `${safeFilename}.webp`;
    const thumbPath = path.join(thumbsDir, thumbName);
    
    if (fs.existsSync(thumbPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(thumbPath);
    }
    
    const created = await generateThumbnail(safeFilename);
    if (created && fs.existsSync(thumbPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(thumbPath);
    }
    
    res.status(404).send('Thumbnail unavailable');
});

app.use('/stream/photography', verifyToken, express.static(photosDir));

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
    let targetFilename = req.file.filename;
    if (targetFilename.toLowerCase().endsWith('.heic') && heicConvert) {
        try {
            const filePath = path.join(photosDir, targetFilename);
            const inputBuffer = fs.readFileSync(filePath);
            const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.8 });
            
            targetFilename = targetFilename.replace(/\.heic$/i, '.jpg');
            fs.writeFileSync(path.join(photosDir, targetFilename), outputBuffer);
            fs.unlinkSync(filePath); 
        } catch(e) { console.error('[Lair OS] HEIC conversion failed:', e); }
    }
    await generateThumbnail(targetFilename);
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
    
    const stat = fs.statSync(filePath); 
    const fileSize = stat.size; 
    const range = req.headers.range;
    
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-"); 
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + (5 * 1024 * 1024) - 1, fileSize - 1);
        if (start >= fileSize || end >= fileSize) { res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }); return res.end(); }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': (end - start) + 1, 'Content-Type': 'video/mp4' });
        fs.createReadStream(filePath, {start, end}).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
        fs.createReadStream(filePath).pipe(res);
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