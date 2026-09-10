require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const multer = require('multer');
const chokidar = require('chokidar');
const jwt = require('jsonwebtoken');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

// Safe Sharp Loader (Prevents Windows compilation crashes from killing the server)
let sharp;
try { sharp = require('sharp'); } 
catch (e) { console.warn('[Lair OS] Sharp module unavailable. WebP compression bypassed.'); }

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const app = express();

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

const TUNNEL_URL = 'https://vault.ibadhasan.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

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

app.post('/api/work/extract', verifyToken, uploadInvoice.single('invoice'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const apiKey = process.env.GEMINI_API_KEY || "AQ.Ab8RN6J0U-2QICflP43f8mpmOsu7kg9foapNJJ2Yk11bi7i3kA";
        const genAI = new GoogleGenerativeAI(apiKey);
        
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
                        const isOverloaded = error.status === 503 || (error.message && error.message.toLowerCase().includes('high demand'));
                        if (isOverloaded && i < maxRetries - 1) {
                            const jitter = Math.floor(Math.random() * 1000); 
                            const waitTime = delay + jitter;
                            console.warn(`[Lair OS] ${modelName} overloaded. Retrying in ${waitTime/1000}s... (Attempt ${i + 1}/${maxRetries})`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            delay *= 2; 
                        } else {
                            throw error; 
                        }
                    }
                }
                if (result) break; 
            } catch (err) {
                console.warn(`[Lair OS] ${modelName} failed or exhausted retries. Falling back to next model...`);
                lastError = err;
            }
        }
        
        if (!result) throw lastError || new Error('All fallback models failed.');

        let rawText = result.response.text().trim();
        if (rawText.startsWith('```json')) rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (rawText.startsWith('```')) rawText = rawText.replace(/^```/, '').replace(/```$/, '').trim();
        
        const data = JSON.parse(rawText);
        fs.unlinkSync(req.file.path); 
        res.json(data);
    } catch(e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error('[Lair OS] Extraction Error:', e);
        res.status(500).json({ error: 'Extraction failed or invalid file format' });
    }
});

app.post('/api/work/sync', verifyToken, async (req, res) => {
    try {
        const authClient = new google.auth.GoogleAuth({ keyFile: './serviceAccountKey.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        await sheets.spreadsheets.values.append({
            spreadsheetId: '1NaObt-gwnmsn8Ouv1onbF4UUuFiiaPZPZj-pLU3G6SM',
            range: 'Sheet1!A:H', valueInputOption: 'USER_ENTERED', requestBody: { values: req.body.rows }
        });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Failed to sync with Sheets Matrix' }); }
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