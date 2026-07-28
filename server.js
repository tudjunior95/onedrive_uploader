require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CLIENT_ID,
  CLIENT_SECRET,
  TENANT = 'consumers', // 'consumers' = personal Microsoft accounts only
  REDIRECT_URI,
  TARGET_FOLDER = 'Photo Uploads',
  PORT = 3000,
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('Missing required env vars: CLIENT_ID, CLIENT_SECRET, REDIRECT_URI');
  process.exit(1);
}

const TOKEN_PATH = path.join(__dirname, 'data', 'token.json');
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;
const SCOPE = 'offline_access Files.ReadWrite';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Token storage ----------
function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  const withExpiry = {
    ...tokens,
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000, // refresh 60s early
  };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(withExpiry, null, 2));
  return withExpiry;
}

async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error('NOT_AUTHENTICATED');
  }
  if (tokens.access_token && tokens.expires_at > Date.now()) {
    return tokens.access_token;
  }
  // refresh
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: SCOPE,
  });
  const resp = await axios.post(`${AUTHORITY}/oauth2/v2.0/token`, params);
  tokens = saveTokens(resp.data);
  return tokens.access_token;
}

// ---------- One-time auth flow (run this yourself, once) ----------
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPE,
  });
  res.redirect(`${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`Auth error: ${error} - ${error_description}`);
  }
  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    });
    const resp = await axios.post(`${AUTHORITY}/oauth2/v2.0/token`, params);
    saveTokens(resp.data);
    res.send('<h2>OneDrive connected.</h2><p>You can close this tab. The upload page is ready to use.</p>');
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).send('Something went wrong exchanging the code. Check server logs.');
  }
});

app.get('/auth/status', async (req, res) => {
  try {
    await getAccessToken();
    res.json({ connected: true });
  } catch {
    res.json({ connected: false });
  }
});

// ---------- Upload endpoint ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB per file
});

async function ensureUploadSession(accessToken, filename) {
  // Support nested paths like "Events/2026/Reunion" by encoding each
  // segment separately rather than encoding the slashes themselves.
  const folder = TARGET_FOLDER
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const cleanName = encodeURIComponent(filename);
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${folder}/${cleanName}:/createUploadSession`;
  const resp = await axios.post(
    url,
    { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return resp.data.uploadUrl;
}

async function uploadInChunks(uploadUrl, filePath, total) {
  const CHUNK_SIZE = 10 * 327680; // ~3.2MB, must be a multiple of 327,680 bytes
  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    for (let start = 0; start < total; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, total);
      const length = end - start;
      const buffer = Buffer.alloc(length);
      await fileHandle.read(buffer, 0, length, start);
      await axios.put(uploadUrl, buffer, {
        headers: {
          'Content-Length': length,
          'Content-Range': `bytes ${start}-${end - 1}/${total}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    }
  } finally {
    await fileHandle.close();
  }
}

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file received' });

    const { size } = await fs.promises.stat(file.path);
    const uploadUrl = await ensureUploadSession(accessToken, file.originalname);
    await uploadInChunks(uploadUrl, file.path, size);

    await fs.promises.unlink(file.path).catch(() => {});
    res.json({ ok: true, filename: file.originalname });
  } catch (e) {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
    if (e.message === 'NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'Server is not connected to OneDrive yet. Visit /auth/login once as the owner.' });
    }
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: 'Upload failed. Check server logs.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`One-time setup: visit /auth/login as the OneDrive owner.`);
});
