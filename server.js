const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const multer = require('multer');
const chokidar = require('chokidar');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const app = express();

// CORE FIX: ibadhasan.com added to the security whitelist
const allowedOrigins = [
  'https://cryeterialoginpage.firebaseapp.com',
  'https://cryeterialoginpage.web.app',
  'https://vault.ibadhasan.com',
  'https://ibadhasan.com',
  'https://www.ibadhasan.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Denied'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname, { extensions: ['html'] }));

async function verifyToken(req, res, next) {
    let token = '';
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split('Bearer ')[1];
    } else if (req.query.token) {
        token = req.query.token; 
    }

    if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token.' });

    try {
        const decodedToken = await getAuth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Forbidden: Expired or forged token.' });
    }
}

const TUNNEL_URL = 'https://vault.ibadhasan.com'; 
const TMDB_API_KEY = '4b52b76174a761002dc02aa11e0394c8';

const moviesDir = path.join(__dirname, 'Movies');
const photosDir = path.join(__dirname, 'Photography');
if (!fs.existsSync(moviesDir)) fs.mkdirSync(moviesDir);
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, photosDir),
    filename: (req, file, cb) => {
        const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '')}`;
        cb(null, safeName);
    }
});
const upload = multer({ storage: storage });

let prevCpu = getCpuSnapshot();
function getCpuSnapshot() {
    const cpus = os.cpus();
    let idle = 0; let total = 0;
    cpus.forEach(cpu => {
        for (const type in cpu.times) total += cpu.times[type];
        idle += cpu.times.idle;
    });
    return { idle: idle / cpus.length, total: total / cpus.length };
}

function calculateCpuLoad() {
    const current = getCpuSnapshot();
    const idleDiff = current.idle - prevCpu.idle;
    const totalDiff = current.total - prevCpu.total;
    prevCpu = current;
    if (totalDiff === 0) return "0.0";
    const usage = 100 - (100 * idleDiff / totalDiff);
    return Math.max(0, Math.min(100, usage)).toFixed(1);
}

app.get('/api/stats', verifyToken, (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramPercent = (((totalMem - freeMem) / totalMem) * 100).toFixed(1);
    res.json({ cpu: calculateCpuLoad(), ram: ramPercent });
});

const COMMAND_WHITELIST = {
    'help': 'echo Available commands: ping, ip, uptime, storage, tasks, ver',
    'ping': 'ping -n 3 8.8.8.8',
    'ip': 'ipconfig',
    'uptime': 'net statistics workstation',
    'storage': 'wmic logicaldisk get size,freespace,caption',
    'tasks': 'tasklist /fi "STATUS eq running" /fo table /nh',
    'ver': 'ver'
};

app.post('/api/terminal', verifyToken, (req, res) => {
    const rawCmd = (req.body.command || '').trim().toLowerCase();
    const targetCmd = COMMAND_WHITELIST[rawCmd];

    if (!targetCmd) return res.json({ output: `Command '${rawCmd}' is not permitted. Type 'help'.` });

    exec(targetCmd, { timeout: 8000, windowsHide: true }, (error, stdout, stderr) => {
        res.json({ output: stdout || stderr || error.message || 'Command executed.' });
    });
});

app.get('/api/storage', verifyToken, (req, res) => {
    let totalBytes = 0;
    try {
        const pFiles = fs.readdirSync(photosDir);
        pFiles.forEach(f => totalBytes += fs.statSync(path.join(photosDir, f)).size);
        const mFiles = fs.readdirSync(moviesDir);
        mFiles.forEach(f => totalBytes += fs.statSync(path.join(moviesDir, f)).size);
        res.json({ totalBytes, maxBytes: 100 * 1024 * 1024 * 1024 }); 
    } catch(e) { res.status(500).json({ error: 'Storage calculation failed' }); }
});

app.use('/stream/photography', verifyToken, express.static(photosDir));

app.get('/api/photos', verifyToken, (req, res) => {
    fs.readdir(photosDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Unable to scan directory' });
        
        const photoList = files.filter(f => /\.(jpg|jpeg|png|webp|heic|gif)$/i.test(f)).map(file => {
            const stats = fs.statSync(path.join(photosDir, file));
            const timestamp = stats.birthtimeMs || stats.mtimeMs;
            return {
                filename: file,
                url: `${TUNNEL_URL}/stream/photography/${file}?token=${req.query.token || ''}`,
                size: stats.size,
                timestamp: timestamp,
                dateFormatted: new Date(timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            };
        }).sort((a, b) => b.timestamp - a.timestamp);
        res.json(photoList);
    });
});

app.post('/api/photos/upload', verifyToken, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true });
});

app.delete('/api/photos/delete/:filename', verifyToken, (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(photosDir, safeFilename);
    if (fs.existsSync(filePath)) { 
        fs.unlinkSync(filePath); 
        res.json({ success: true }); 
    } else { res.status(404).json({ error: 'File not found' }); }
});

// FLIGHT DOWNLOAD ENDPOINT 
app.get('/api/download/movies/:filename', verifyToken, (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(moviesDir, safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
});

// MATHEMATICALLY SHIELDED STREAMING
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
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        
        if (start >= fileSize || end >= fileSize) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            return res.end();
        }

        const file = fs.createReadStream(filePath, {start, end});
        res.writeHead(206, { 
            'Content-Range': `bytes ${start}-${end}/${fileSize}`, 
            'Accept-Ranges': 'bytes', 
            'Content-Length': (end - start) + 1, 
            'Content-Type': 'video/mp4' 
        });
        file.pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
        fs.createReadStream(filePath).pipe(res);
    }
});

const watcher = chokidar.watch(moviesDir, { 
    persistent: true, 
    ignoreInitial: false, 
    usePolling: true, 
    interval: 2000, 
    awaitWriteFinish: { stabilityThreshold: 10000, pollInterval: 2000 } 
});

watcher.on('add', async (filePath) => {
    if (!filePath.endsWith('.mp4')) return;
    const fileName = path.basename(filePath);
    const streamUrl = `${TUNNEL_URL}/stream/movies/${encodeURIComponent(fileName)}`;

    try {
        const existing = await db.collection('watchlist').where('streamUrl', '==', streamUrl).get();
        if (!existing.empty) return; 

        let cleanTitle = fileName.replace(/\.mp4$/, '').replace(/\./g, ' ').replace(/(1080p|720p|2160p|4k|blu-ray|bluray|x264|hevc|web-dl|HDR)/gi, '').replace(/\(\d{4}\)|\[.*?\]/g, '').trim();
        const res = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`);
        const match = res.data.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv');
        
        await db.collection('watchlist').add({
            title: match ? (match.title || match.name) : cleanTitle,
            poster: (match && match.poster_path) ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : '',
            type: 'Movie (Local Vault)', 
            status: 'Want to Watch',
            streamUrl: streamUrl,
            addedBy: 'Lair Server', 
            timestamp: FieldValue.serverTimestamp()
        });
        console.log(`[Lair OS] Indexed new file: ${fileName}`);
    } catch (e) { 
        console.error(`[Lair OS] Error indexing ${fileName}:`, e.message); 
    }
});

watcher.on('unlink', async (filePath) => {
    if (!filePath.endsWith('.mp4')) return;
    const fileName = path.basename(filePath);
    try {
        const streamUrl = `${TUNNEL_URL}/stream/movies/${encodeURIComponent(fileName)}`;
        const snapshot = await db.collection('watchlist').where('streamUrl', '==', streamUrl).get();
        snapshot.forEach(doc => doc.ref.delete());
        console.log(`[Lair OS] Removed deleted file from database: ${fileName}`);
    } catch (e) { }
});
watcher.on('error', err => { if(err.code !== 'EBUSY') console.error(err); });

app.listen(3000, () => console.log('[Lair OS] Engine running securely on port 3000'));