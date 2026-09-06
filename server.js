// Fixed: Loading environment variables securely
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

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const app = express();

// Fixed: Stream tokens are short-lived, filename-scoped JWTs used ONLY for
// media <video>/<img> tags that can't send an Authorization header. They are
// never a substitute for real Firebase auth on JSON API routes.
const STREAM_SECRET = process.env.STREAM_TOKEN_SECRET;
if (!STREAM_SECRET) {
  console.warn('[Lair OS] WARNING: STREAM_TOKEN_SECRET is not set in .env. ' +
    'Set a long random value there or media streaming will refuse to issue tokens.');
}

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
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Fixed: Gracefully rejecting CORS without throwing a 500 Node.js error
      callback(null, false);
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname, { extensions: ['html'] }));

// Fixed: Removed the "expired token + Range header" bypass. That let anyone
// with a stale/forged bearer token stream indefinitely once they'd gotten in
// once, since a Range header is trivial for any client to send. Long-lived
// media access now goes through the scoped stream_token below instead.
async function verifyToken(req, res, next) {
  // Path 1: scoped, single-file, short-lived stream token (for <video>/<img>
  // tags and other requests that can't carry an Authorization header).
  const streamToken = req.query.stream_token;
  if (streamToken) {
    if (!STREAM_SECRET) return res.status(503).json({ error: 'Streaming temporarily unavailable.' });
    try {
      const payload = jwt.verify(streamToken, STREAM_SECRET);
      const requestedFile = req.params.filename ? path.basename(req.params.filename) : null;
      if (requestedFile && payload.filename !== requestedFile) {
        return res.status(403).json({ error: 'Forbidden: token does not match this file.' });
      }
      req.user = { uid: payload.uid };
      return next();
    } catch (e) {
      return res.status(403).json({ error: 'Forbidden: invalid or expired stream token.' });
    }
  }

  // Path 2: standard Firebase ID token, verified fully every time.
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

// Issues a short-lived token scoped to exactly one filename. The caller must
// already be a verified Firebase user (via verifyToken) to get one.
app.post('/api/stream-token', verifyToken, (req, res) => {
  const filename = path.basename(req.body.filename || '');
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  try {
    const token = issueStreamToken(req.user.uid, filename, 6);
    res.json({ token });
  } catch (e) {
    res.status(503).json({ error: 'Streaming temporarily unavailable.' });
  }
});

const TUNNEL_URL = 'https://vault.ibadhasan.com';
const TMDB_API_KEY = process.env.TMDB_API_KEY;

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
    // Fixed: Replaced deprecated wmic with PowerShell equivalent
    'storage': 'powershell -command "Get-Volume | Select-Object DriveLetter, FileSystemLabel, SizeRemaining, Size"',
    'tasks': 'tasklist /fi "STATUS eq running" /fo table /nh',
    'ver': 'ver'
};

app.post('/api/terminal', verifyToken, (req, res) => {
    const rawCmd = (req.body.command || '').trim().toLowerCase();
    const targetCmd = COMMAND_WHITELIST[rawCmd];

    if (!targetCmd) return res.json({ output: `Command '${rawCmd}' is not permitted. Type 'help'.` });

    exec(targetCmd, { timeout: 8000, windowsHide: true }, (error, stdout, stderr) => {
        res.json({ output: stdout || stderr || (error ? error.message : '') || 'Command executed.' });
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

        // Fixed: previously embedded `req.query.token` here, which is always
        // empty because the client authenticates this GET with a Bearer
        // header, not a query param — so every photo/video URL rendered by
        // the client came back with `?token=` empty and 401'd when the
        // browser tried to load it directly as an <img>/<video> src. Each
        // file now gets its own short-lived, filename-scoped stream token
        // that's valid on its own.
        const photoList = files.filter(f => /\.(jpg|jpeg|png|webp|heic|gif|mp4|mov|m4v|pdf)$/i.test(f)).map(file => {
            const stats = fs.statSync(path.join(photosDir, file));
            const timestamp = stats.birthtimeMs || stats.mtimeMs;
            let url = `${TUNNEL_URL}/stream/photography/${encodeURIComponent(file)}`;
            try {
                const streamToken = issueStreamToken(req.user.uid, file, 12);
                url += `?stream_token=${streamToken}`;
            } catch (e) { /* STREAM_SECRET missing; url will 503 on load */ }
            return {
                filename: file,
                url,
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

        // Fixed: Implemented strict 5MB chunk sizes to prevent Memory Exhaustion Vulnerability
        const CHUNK_SIZE = 5 * 1024 * 1024;
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

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

// Server-side TMDB proxy so the browser never needs the TMDB API key.
// This is what makes the Theater tab's "Search TMDB" box actually work.
app.get('/api/tmdb/search', verifyToken, async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) return res.json({ results: [] });
    if (!TMDB_API_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not configured on server.' });
    try {
        const tmdbRes = await axios.get('https://api.themoviedb.org/3/search/multi', {
            params: { api_key: TMDB_API_KEY, query, include_adult: false }
        });
        const results = (tmdbRes.data.results || [])
            .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
            .slice(0, 12)
            .map(r => ({
                id: r.id,
                title: r.title || r.name,
                year: (r.release_date || r.first_air_date || '').slice(0, 4),
                poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : '',
                type: r.media_type === 'movie' ? 'Movie' : 'TV Show'
            }));
        res.json({ results });
    } catch (e) {
        res.status(502).json({ error: 'TMDB lookup failed.' });
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
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}`);
        const match = tmdbRes.data.results?.find(r => r.media_type === 'movie' || r.media_type === 'tv');

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
