const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const stream = require('stream');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('./database');
const setupSocket = require('./socket');
const configStore = require('./config-store');
const permissions = require('./permissions');

const app = express();
const server = http.createServer(app);
let io; // assigned by setupSocket; used to broadcast live updates from REST routes

const SERVER_ID = crypto.randomUUID();
let heartbeatInterval = null;

function registerHeartbeat() {
  db.run("INSERT OR REPLACE INTO servers (id, last_heartbeat) VALUES (?, datetime('now'))", [SERVER_ID], (err) => {
    if (err) console.error('[server] Failed to register heartbeat:', err.message);
  });

  heartbeatInterval = setInterval(() => {
    db.run("UPDATE servers SET last_heartbeat = datetime('now') WHERE id = ?", [SERVER_ID]);
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  db.run("DELETE FROM servers WHERE id = ?", [SERVER_ID]);
}

const cleanQuit = () => {
  console.log('[server] Shutdown signal received. Cleaning up presence...');
  stopHeartbeat();
  db.run("UPDATE sessions SET ended_at = started_at WHERE ended_at IS NULL AND server_id = ?", [SERVER_ID], () => {
    db.run(`
      UPDATE users 
      SET status = 'offline' 
      WHERE id NOT IN (
        SELECT DISTINCT user_id FROM sessions WHERE ended_at IS NULL
      )
    `, () => {
      process.exit(0);
    });
  });
};

process.on('SIGINT', cleanQuit);
process.on('SIGTERM', cleanQuit);

const PORT = process.env.PORT || 3000;

// Token signing secret. Prefers the environment; otherwise reuses (or creates
// and persists) a local secret so self-hosted/local runs need zero setup.
// NOTE: on Render the disk is wiped each deploy, so set JWT_SECRET there to
// keep everyone logged in across deploys.
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretPath = path.join(__dirname, 'jwt-secret.key');
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (e) { /* not created yet */ }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretPath, generated);
    console.warn('[security] No JWT_SECRET set — generated and persisted one at backend/jwt-secret.key. On Render, set JWT_SECRET as an env var instead.');
  } catch (e) {
    console.warn('[security] No JWT_SECRET set and could not persist one — using an ephemeral secret (logins reset on restart).');
  }
  return generated;
}
const JWT_SECRET = loadJwtSecret();

// Origins allowed to call the API / open a socket.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`)
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// The desktop app serves its renderer from http://localhost:<port>, but the
// exact port varies (it falls back when the default is busy). So in addition to
// the explicit allow-list, accept any loopback origin — that is always the
// user's own machine, so it's safe. Requests with no Origin (same-origin,
// native clients, curl) are allowed too.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
// The hosted web frontend (Netlify) and the APK/WebView wrappers that load it
// call the API cross-origin, so allow those too. Netlify deploy URLs are
// *.netlify.app (and *.netlify.live for previews); Capacitor/Cordova/Android
// WebViews send origins like capacitor://localhost, file://, or a literal
// "null". All API routes still require a valid JWT, so this only widens which
// pages may *attempt* a call. To pin it to one exact domain, set ALLOWED_ORIGINS.
const HOSTED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(netlify\.app|netlify\.live)$/i;
const APP_SHELL_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'file://', 'null']);
function corsOriginCheck(origin, cb) {
  if (!origin) return cb(null, true);
  if (
    ALLOWED_ORIGINS.includes(origin) ||
    LOOPBACK_ORIGIN.test(origin) ||
    HOSTED_ORIGIN.test(origin) ||
    APP_SHELL_ORIGINS.has(origin)
  ) return cb(null, true);
  return cb(new Error(`Origin not allowed by CORS: ${origin}`));
}

// Verifies the Bearer token on protected routes and attaches req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
}

// Only the admin user may change server settings (e.g. Google Drive keys).
function requireAdmin(req, res, next) {
  db.get("SELECT role FROM users WHERE id = ?", [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row || row.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// Ensure uploads directory exists for local fallback
let uploadsDir = path.join(__dirname, 'uploads');
try {
  const { app } = require('electron');
  if (app) {
    uploadsDir = path.join(app.getPath('userData'), 'uploads');
  }
} catch (e) {
  // Headless mode
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors({ origin: corsOriginCheck }));
app.use(express.json({ limit: '8mb' })); // room for inline backdrop images (data URLs)

// Serve the React (Vite) build if it exists; otherwise fall back to the legacy
// vanilla frontend. The SPA fallback for client routing is registered after all
// API routes (see the bottom of this file).
const REACT_DIST = path.join(__dirname, '..', 'Team Hearth', 'dist');
const LEGACY_FRONTEND = path.join(__dirname, '../frontend');
const FRONTEND_DIR = fs.existsSync(path.join(REACT_DIST, 'index.html')) ? REACT_DIST : LEGACY_FRONTEND;
console.log(`[server] Serving frontend from: ${FRONTEND_DIR === REACT_DIST ? 'Team Hearth/dist (React)' : 'frontend (legacy)'}`);
app.use(express.static(FRONTEND_DIR));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup using memory storage for Google Drive upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Lightweight, custom in-memory rate-limiter to protect REST endpoints
const rateLimits = new Map();

function rateLimiter({ windowMs, max, message }) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
    let limit = rateLimits.get(ip);
    if (!limit || now > limit.resetTime) {
      limit = {
        count: 0,
        resetTime: now + windowMs
      };
    }
    
    limit.count++;
    rateLimits.set(ip, limit);
    
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - limit.count));
    res.setHeader('X-RateLimit-Reset', Math.round(limit.resetTime / 1000));
    
    if (limit.count > max) {
      return res.status(429).json({ error: message || 'Too many requests, please try again later.' });
    }
    
    next();
  };
}

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 login/password-change requests per 15 minutes
  message: 'Too many attempts. Please try again after 15 minutes.'
});

const uploadLimiter = rateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 upload requests per minute
  message: 'Too many file uploads. Please try again after 1 minute.'
});

// API Routes
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Long-lived token: the desktop app stores it encrypted and auto-logs in
    // on startup until the user explicitly signs out.
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, project: user.current_project, role: user.role, designation: user.designation } });
  });
});

// Any signed-in user can change their own password.
app.post('/api/change-password', requireAuth, loginLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  db.get("SELECT password_hash FROM users WHERE id = ?", [req.user.id], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.id], (e) => {
      if (e) return res.status(500).json({ error: 'Database error' });
      res.json({ ok: true });
    });
  });
});

app.post('/api/update-profile', requireAuth, loginLimiter, async (req, res) => {
  const { username, avatar, designation, password } = req.body || {};
  const userId = req.user.id;

  if (username && username.trim().length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  }

  db.get("SELECT id FROM users WHERE username = ? AND id != ?", [username, userId], async (err, existing) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (existing) return res.status(400).json({ error: 'Username is already taken.' });

    const updates = [];
    const params = [];

    if (username) {
      updates.push("username = ?");
      params.push(username.trim());
    }
    if (avatar !== undefined) {
      updates.push("avatar = ?");
      params.push(avatar.trim());
    }
    if (designation !== undefined) {
      updates.push("designation = ?");
      params.push(designation.trim());
    }

    if (password && password.trim().length >= 6) {
      const hash = await bcrypt.hash(password.trim(), 10);
      updates.push("password_hash = ?");
      params.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    params.push(userId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function (err2) {
      if (err2) return res.status(500).json({ error: 'Failed to update profile.' });
      
      db.get("SELECT id, username, avatar, designation, role FROM users WHERE id = ?", [userId], (err3, user) => {
        if (err3 || !user) return res.status(500).json({ error: 'Failed to retrieve updated profile.' });
        res.json({ message: 'Profile updated successfully', user });
      });
    });
  });
});

app.get('/api/users', requireAuth, (req, res) => {
  db.all("SELECT id, username, avatar, role, last_seen, status, status_message, current_project, designation FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/me/permissions', requireAuth, (req, res) => {
  permissions.hasPermission(db, req.user.id, permissions.CAN_TURN_OFF_V_OFFICE, (err, granted) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ [permissions.CAN_TURN_OFF_V_OFFICE]: granted });
  });
});

// Main process calls this with the current Bearer token before any full exit.
// A renderer-provided boolean is never accepted as authorization.
app.post('/api/desktop/shutdown-authorization', requireAuth, (req, res) => {
  permissions.hasPermission(db, req.user.id, permissions.CAN_TURN_OFF_V_OFFICE, (err, granted) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!granted) return res.status(403).json({ error: 'You cannot turn off Virtual Office' });
    res.json({ allowed: true, userId: req.user.id });
  });
});

app.get('/api/admin/user-permissions', requireAuth, requireAdmin, (req, res) => {
  db.all('SELECT user_id, permission_key FROM user_permissions ORDER BY user_id, permission_key', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.put('/api/admin/users/:id/permissions/:key', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const key = req.params.key;
  const granted = req.body && req.body.granted;
  if (!Number.isSafeInteger(userId) || userId <= 0 || !permissions.SUPPORTED_PERMISSIONS.has(key) || typeof granted !== 'boolean') {
    return res.status(400).json({ error: 'Invalid permission update' });
  }
  db.get('SELECT id FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const sql = granted
      ? 'INSERT OR REPLACE INTO user_permissions (user_id, permission_key, granted_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      : 'DELETE FROM user_permissions WHERE user_id = ? AND permission_key = ?';
    const args = granted ? [userId, key, req.user.id] : [userId, key];
    db.run(sql, args, (writeErr) => {
      if (writeErr) return res.status(500).json({ error: 'Database error' });
      if (io) io.emit('user_permission_changed', { userId, permissionKey: key });
      res.json({ userId, permissionKey: key, granted });
    });
  });
});

// WebRTC ICE config. Serves STUN + TURN so calls/screen-share can relay across
// home networks. Configure a real (low-latency) TURN via env vars:
//   TURN_SERVERS = JSON array of RTCIceServer objects, OR
//   TURN_URL (comma-separated) + TURN_USERNAME + TURN_PASSWORD
// With neither set it falls back to the free (overloaded) openrelay TURN.
app.get('/api/rtc-config', requireAuth, (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  // Resolve TURN with graceful fallthrough so a malformed/empty TURN_SERVERS
  // never silently disables a working TURN_URL.
  let turn = [];
  if (process.env.TURN_SERVERS) {
    try {
      const extra = JSON.parse(process.env.TURN_SERVERS);
      if (Array.isArray(extra)) turn = extra;
      else console.warn('[rtc] TURN_SERVERS is not a JSON array; ignoring.');
    } catch (e) { console.warn('[rtc] TURN_SERVERS is not valid JSON; ignoring.'); }
  }
  if (turn.length === 0 && process.env.TURN_URL) {
    turn = [{
      urls: process.env.TURN_URL.split(',').map(s => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || ''
    }];
  }
  if (turn.length === 0) {
    turn = [
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ];
  }
  iceServers.push(...turn);
  res.json({ iceServers });
});

// Total time a user has been online over the last day / week / month, summed
// from their session rows (overlap of each session with each window).
app.get('/api/users/:id/online-time', requireAuth, (req, res) => {
  const uid = Number(req.params.id);
  const now = Date.now();
  const cutoff30 = new Date(now - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  db.all("SELECT started_at, ended_at FROM sessions WHERE user_id = ? AND (ended_at IS NULL OR ended_at >= ?)",
    [uid, cutoff30], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      const windows = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };
      const acc = { day: 0, week: 0, month: 0 };
      const parse = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').getTime() : now;
      (rows || []).forEach(r => {
        const start = parse(r.started_at);
        const end = r.ended_at ? parse(r.ended_at) : now;
        for (const k in windows) {
          const winStart = now - windows[k];
          acc[k] += Math.max(0, Math.min(end, now) - Math.max(start, winStart));
        }
      });
      res.json({
        day: Math.round(acc.day / 1000),
        week: Math.round(acc.week / 1000),
        month: Math.round(acc.month / 1000)
      });
    });
});

// Shared office backdrop image. Any signed-in user can change it; the new URL
// is stored and broadcast so everyone's center image updates live. Empty = the
// default artwork (assets/office.png).
app.get('/api/office-image', requireAuth, (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'office_image'", [], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ url: (row && row.value) || null });
  });
});
app.post('/api/office-image', requireAuth, (req, res) => {
  const url = (req.body && typeof req.body.url === 'string') ? req.body.url.trim() : '';
  db.run("INSERT INTO settings (key, value) VALUES ('office_image', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [url], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (io) io.emit('office_image_changed', { url });
      res.json({ ok: true, url });
    });
});

app.get('/api/messages', requireAuth, (req, res) => {
  // Team channel history. Defaults to 'general'; existing rows with a NULL
  // channel are treated as 'general' for backward compatibility.
  const channel = (typeof req.query.channel === 'string' && req.query.channel.trim())
    ? req.query.channel.trim()
    : 'general';
  db.all(`SELECT messages.*, users.username, users.avatar
          FROM messages
          JOIN users ON messages.sender_id = users.id
          WHERE messages.recipient_id IS NULL
            AND COALESCE(messages.channel, 'general') = ?
          ORDER BY timestamp ASC LIMIT 100`, [channel], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// --- Auto backdrop: one image per "who's online" combination ----------------
// Images are stored inline (compressed data URLs) under settings keys
// 'autobg:<comboKey>', where comboKey is the sorted online usernames joined by
// '|' (empty = nobody online). Stored in the DB so it persists (with Turso) and
// doesn't depend on the ephemeral uploads dir.
app.get('/api/auto-backdrop', requireAuth, (req, res) => {
  db.all("SELECT key, value FROM settings WHERE key LIKE 'autobg:%'", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const map = {};
    (rows || []).forEach(r => { map[r.key.slice(7)] = r.value; });
    res.json({ map });
  });
});
app.post('/api/auto-backdrop', requireAuth, (req, res) => {
  const key = (req.body && typeof req.body.key === 'string') ? req.body.key : null;
  if (key === null) return res.status(400).json({ error: 'key required' });
  const image = (req.body && typeof req.body.image === 'string') ? req.body.image : '';
  const skey = 'autobg:' + key;

  if (image) {
    // Check if it's already a saved URL to avoid redundant writes
    if (image.startsWith('/uploads/')) {
      db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [skey, image], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (io) io.emit('auto_backdrop_changed', { key, image });
        res.json({ ok: true });
      });
      return;
    }

    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid image format' });

    const buffer = Buffer.from(matches[2], 'base64');
    const safeKey = key.replace(/[^a-zA-Z0-9|]/g, '').replace(/\|/g, '_');
    const filename = `autobg-${safeKey}.jpg`;
    const filepath = path.join(uploadsDir, filename);

    try {
      fs.writeFileSync(filepath, buffer);
    } catch (e) {
      console.error('Failed to write auto-backdrop file:', e);
      return res.status(500).json({ error: 'Failed to write file' });
    }

    const dbValue = `/uploads/${filename}`;
    db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [skey, dbValue], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (io) io.emit('auto_backdrop_changed', { key, image: dbValue });
      res.json({ ok: true });
    });
  } else {
    const safeKey = key.replace(/[^a-zA-Z0-9|]/g, '').replace(/\|/g, '_');
    const filename = `autobg-${safeKey}.jpg`;
    const filepath = path.join(uploadsDir, filename);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (e) {
      console.error('Failed to delete auto-backdrop file:', e);
    }

    db.run("DELETE FROM settings WHERE key = ?", [skey], (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (io) io.emit('auto_backdrop_changed', { key, image: null });
      res.json({ ok: true });
    });
  }
});

// Direct-message history between the signed-in user and another user.
app.get('/api/messages/dm/:id', requireAuth, (req, res) => {
  const other = Number(req.params.id);
  db.all(`SELECT messages.*, users.username, users.avatar
          FROM messages
          JOIN users ON messages.sender_id = users.id
          WHERE (messages.sender_id = ? AND messages.recipient_id = ?)
             OR (messages.sender_id = ? AND messages.recipient_id = ?)
          ORDER BY timestamp ASC LIMIT 200`,
    [req.user.id, other, other, req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows);
    });
});

// --- Admin settings: Google Drive keys configured via the app UI ----------
// Status only — never returns the actual secrets to the client.
app.get('/api/admin/config', requireAuth, requireAdmin, (req, res) => {
  const g = configStore.getGoogleConfig();
  const c = configStore.readConfig();
  res.json({
    google: {
      clientId: g.clientId,   // a Google client id is not a secret
      folderId: g.folderId,
      hasClientSecret: !!g.clientSecret,
      hasRefreshToken: !!g.refreshToken,
      configured: !!(g.clientId && g.clientSecret && g.refreshToken && g.folderId)
    },
    updater: {
      updateChannel: c.updateChannel || 'stable'
    }
  });
});

// Save keys. Blank secret/token fields are ignored so they aren't wiped.
app.post('/api/admin/config', requireAuth, requireAdmin, (req, res) => {
  const incoming = req.body || {};
  const google = { ...(configStore.readConfig().google || {}) };
  if (incoming.google) {
    if (typeof incoming.google.clientId === 'string') google.clientId = incoming.google.clientId.trim();
    if (typeof incoming.google.folderId === 'string') google.folderId = incoming.google.folderId.trim();
    if (incoming.google.clientSecret) google.clientSecret = incoming.google.clientSecret.trim();
    if (incoming.google.refreshToken) google.refreshToken = incoming.google.refreshToken.trim();
  }
  
  const updates = { google };
  if (incoming.updater && incoming.updater.updateChannel) {
    updates.updateChannel = incoming.updater.updateChannel.trim();
  }

  configStore.writeConfig(updates);
  res.json({ ok: true });
});

// Verify the stored credentials actually reach Google Drive.
app.post('/api/admin/config/test', requireAuth, requireAdmin, async (req, res) => {
  const g = configStore.getGoogleConfig();
  if (!g.clientId || !g.clientSecret || !g.refreshToken) {
    return res.status(400).json({ ok: false, error: 'Missing Google credentials' });
  }
  try {
    const auth = new google.auth.OAuth2(g.clientId, g.clientSecret);
    auth.setCredentials({ refresh_token: g.refreshToken });
    const drive = google.drive({ version: 'v3', auth });
    const about = await drive.about.get({ fields: 'user(emailAddress)' });
    res.json({ ok: true, email: about.data.user && about.data.user.emailAddress });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin-only presence audit log endpoint
app.get('/api/admin/audit-log', requireAuth, requireAdmin, (req, res) => {
  db.all(`
    SELECT h.*, u.username 
    FROM user_status_history h
    LEFT JOIN users u ON h.user_id = u.id
    WHERE h.status NOT IN ('away', 'busy', 'idle')
    ORDER BY h.timestamp DESC 
    LIMIT 200
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/upload', requireAuth, uploadLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const uploader_id = req.user.id; // trust the verified token, not the request body

  const gcfg = configStore.getGoogleConfig();
  const useOAuth = gcfg.clientId && gcfg.clientSecret && gcfg.refreshToken;

  // Save to the server's local uploads dir and record it. Used both when Google
  // Drive isn't configured and as a fallback when a Drive upload fails, so file
  // sharing always works regardless of Drive's state.
  const saveLocal = () => {
    const safe = `${Date.now()}-${(req.file.originalname || 'file').replace(/[^\w.\-]+/g, '_')}`;
    try {
      fs.writeFileSync(path.join(uploadsDir, safe), req.file.buffer);
    } catch (e) {
      console.error('Local upload error:', e);
      return res.status(500).json({ error: 'Failed to save file' });
    }
    const url = `/uploads/${safe}`;
    db.run("INSERT INTO files (uploader_id, filename, filepath, mimetype, size) VALUES (?, ?, ?, ?, ?)",
      [uploader_id, req.file.originalname, url, req.file.mimetype, req.file.size], function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (io) io.emit('file_uploaded', { id: this.lastID, filename: req.file.originalname, filepath: url });
        res.json({ id: this.lastID, filename: req.file.originalname, url });
      });
  };

  if (!useOAuth) return saveLocal();

  try {
    console.log('Uploading to Team Google Drive...');
    const auth = new google.auth.OAuth2(gcfg.clientId, gcfg.clientSecret);
    auth.setCredentials({ refresh_token: gcfg.refreshToken });

    const drive = google.drive({ version: 'v3', auth });
    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const driveRes = await drive.files.create({
      resource: {
        name: req.file.originalname,
        parents: gcfg.folderId ? [gcfg.folderId] : undefined
      },
      media: {
        mimeType: req.file.mimetype,
        body: bufferStream
      },
      fields: 'id, webViewLink'
    });

    const fileId = driveRes.data.id;
    const fileUrl = driveRes.data.webViewLink;

    await drive.permissions.create({
      fileId: fileId,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    db.run("INSERT INTO files (uploader_id, filename, filepath, mimetype, size) VALUES (?, ?, ?, ?, ?)",
      [uploader_id, req.file.originalname, fileUrl, req.file.mimetype, req.file.size], function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (io) io.emit('file_uploaded', { id: this.lastID, filename: req.file.originalname, filepath: fileUrl });
        res.json({ id: this.lastID, filename: req.file.originalname, url: fileUrl });
      });
  } catch (err) {
    // Drive failed (expired token, bad folder, quota…) — don't lose the file,
    // fall back to local storage so the upload still succeeds.
    console.error('Drive Upload Error (falling back to local):', err.message);
    saveLocal();
  }
});

// --- Files -----------------------------------------------------------------
app.get('/api/files', requireAuth, (req, res) => {
  db.all(
    `SELECT files.*, users.username AS uploader FROM files
     LEFT JOIN users ON files.uploader_id = users.id
     ORDER BY files.timestamp DESC`,
    [],
    (e, rows) => e ? res.status(500).json({ error: 'Database error' }) : res.json(rows)
  );
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  db.get("SELECT * FROM files WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'File not found' });
    db.run("DELETE FROM files WHERE id = ?", [req.params.id], function (e) {
      if (e) return res.status(500).json({ error: 'Database error' });
      if (io) io.emit('file_deleted', { id: Number(req.params.id) });
      res.json({ ok: true });
    });
  });
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, (req, res) => {
  db.all(
    `SELECT sessions.*, users.username, users.avatar, users.status AS user_presence_status
     FROM sessions
     JOIN users ON sessions.user_id = users.id
     WHERE sessions.ended_at IS NULL AND datetime(sessions.last_heartbeat) >= datetime('now', '-10 minutes')
     ORDER BY sessions.last_heartbeat DESC`,
    [],
    (err, sessions) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      const userActMap = (io && io.userActivity) || new Map();
      const enrichedSessions = sessions.map(s => {
        const act = userActMap.get(s.user_id) || { view: 'offline', label: 'Offline' };
        return {
          ...s,
          current_view: act.view,
          current_label: act.label
        };
      });

      db.all(
        `SELECT user_status_history.*, users.username 
         FROM user_status_history
         JOIN users ON user_status_history.user_id = users.id
         ORDER BY user_status_history.timestamp DESC LIMIT 50`,
        [],
        (err2, logs) => {
          if (err2) return res.status(500).json({ error: 'Database error' });
          res.json({
            sessions: enrichedSessions,
            logs: logs
          });
        }
      );
    }
  );
});

// --- Tasks -----------------------------------------------------------------
app.get('/api/tasks', requireAuth, (req, res) => {
  db.all("SELECT * FROM tasks ORDER BY created_at DESC", [], (e, rows) =>
    e ? res.status(500).json({ error: 'Database error' }) : res.json(rows));
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title required' });
  const description = (req.body.description || '').trim();
  const assignee_id = req.body.assignee_id ? Number(req.body.assignee_id) : null;
  const owner_id = req.body.owner_id ? Number(req.body.owner_id) : req.user.id;
  const due_date = req.body.due_date || '';
  const priority = req.body.priority || 'Medium';
  const status = req.body.status || 'todo';
  const project_id = req.body.project_id ? Number(req.body.project_id) : null;
  const done = status === 'completed' ? 1 : 0;

  db.run(
    `INSERT INTO tasks (title, description, assignee_id, owner_id, due_date, priority, status, project_id, done, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description, assignee_id, owner_id, due_date, priority, status, project_id, done, req.user.id],
    function (e) {
      if (e) return res.status(500).json({ error: 'Database error' });
      const task = {
        id: this.lastID, title, description, assignee_id, owner_id, due_date, priority, status, project_id, done,
        created_by: req.user.id, created_at: new Date()
      };
      db.run(
        "INSERT INTO task_activities (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
        [this.lastID, req.user.id, 'created', `Task created in "${status.toUpperCase()}" list`]
      );
      if (io) io.emit('task_created', task);
      res.json(task);
    }
  );
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const updates = req.body;
  if (updates.status !== undefined) {
    updates.done = updates.status === 'completed' ? 1 : 0;
  }
  
  const fields = [];
  const params = [];
  const allowed = ['title', 'description', 'assignee_id', 'owner_id', 'due_date', 'priority', 'status', 'project_id', 'done'];
  
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(updates[key]);
    }
  }
  
  if (fields.length === 0) return res.json({ ok: true });
  params.push(req.params.id);

  db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id], (err, oldTask) => {
    if (err || !oldTask) return res.status(404).json({ error: 'Task not found' });
    
    db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params, function (e) {
      if (e) return res.status(500).json({ error: 'Database error' });
      
      // Log activities
      if (updates.status && updates.status !== oldTask.status) {
        db.run(
          "INSERT INTO task_activities (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
          [req.params.id, req.user.id, 'status_changed', `Moved from "${oldTask.status.toUpperCase()}" to "${updates.status.toUpperCase()}"`]
        );
      }
      if (updates.assignee_id !== undefined && updates.assignee_id !== oldTask.assignee_id) {
        db.run(
          "INSERT INTO task_activities (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
          [req.params.id, req.user.id, 'assigned', updates.assignee_id ? `Assigned to user ID ${updates.assignee_id}` : 'Unassigned']
        );
      }
      if (updates.title && updates.title !== oldTask.title) {
        db.run(
          "INSERT INTO task_activities (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
          [req.params.id, req.user.id, 'updated', `Title changed to "${updates.title}"`]
        );
      }
      
      db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id], (err2, newTask) => {
        if (!err2 && newTask) {
          if (io) io.emit('task_updated', newTask);
        }
      });
      res.json({ ok: true });
    });
  });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  db.run("DELETE FROM tasks WHERE id = ?", [req.params.id], function (e) {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (io) io.emit('task_deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  });
});

// Comments & Activities
app.get('/api/tasks/:id/comments', requireAuth, (req, res) => {
  db.all(
    `SELECT task_comments.*, users.username, users.avatar FROM task_comments 
     JOIN users ON task_comments.user_id = users.id 
     WHERE task_id = ? ORDER BY created_at ASC`,
    [req.params.id],
    (e, rows) => e ? res.status(500).json({ error: 'Database error' }) : res.json(rows)
  );
});

app.post('/api/tasks/:id/comments', requireAuth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Comment content required' });
  db.run(
    "INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)",
    [req.params.id, req.user.id, content],
    function (e) {
      if (e) return res.status(500).json({ error: 'Database error' });
      const commentId = this.lastID;
      db.run(
        "INSERT INTO task_activities (task_id, user_id, action, detail) VALUES (?, ?, ?, ?)",
        [req.params.id, req.user.id, 'commented', `Added a comment: "${content.substring(0, 30)}..."`]
      );
      // The JWT only carries id/username, so fetch the avatar from the DB to
      // match the shape the GET endpoint returns (username + avatar via JOIN).
      db.get("SELECT username, avatar FROM users WHERE id = ?", [req.user.id], (uErr, u) => {
        const comment = {
          id: commentId, task_id: Number(req.params.id), user_id: req.user.id, content,
          created_at: new Date(),
          username: (u && u.username) || req.user.username,
          avatar: (u && u.avatar) || ''
        };
        if (io) io.emit('task_comment_created', comment);
        res.json(comment);
      });
    }
  );
});

app.get('/api/tasks/:id/activities', requireAuth, (req, res) => {
  db.all(
    `SELECT task_activities.*, users.username FROM task_activities 
     JOIN users ON task_activities.user_id = users.id 
     WHERE task_id = ? ORDER BY created_at DESC`,
    [req.params.id],
    (e, rows) => e ? res.status(500).json({ error: 'Database error' }) : res.json(rows)
  );
});

// --- Projects --------------------------------------------------------------
app.get('/api/projects', requireAuth, (req, res) => {
  db.all(`SELECT projects.*, users.username AS owner FROM projects
          LEFT JOIN users ON projects.owner_id = users.id
          ORDER BY created_at DESC`, [], (e, rows) =>
    e ? res.status(500).json({ error: 'Database error' }) : res.json(rows));
});
app.post('/api/projects', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run("INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)", [name, description, req.user.id], function (e) {
    if (e) return res.status(500).json({ error: 'Database error' });
    const p = { id: this.lastID, name, description, status: 'active', owner_id: req.user.id, owner: req.user.username, created_at: new Date() };
    if (io) io.emit('project_created', p);
    res.json(p);
  });
});
app.delete('/api/projects/:id', requireAuth, (req, res) => {
  db.run("DELETE FROM projects WHERE id = ?", [req.params.id], function (e) {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (io) io.emit('project_deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  });
});

// --- Calendar events -------------------------------------------------------
app.get('/api/events', requireAuth, (req, res) => {
  db.all("SELECT * FROM events ORDER BY date ASC, time ASC", [], (e, rows) =>
    e ? res.status(500).json({ error: 'Database error' }) : res.json(rows));
});
app.post('/api/events', requireAuth, (req, res) => {
  const title = (req.body.title || '').trim();
  const date = (req.body.date || '').trim();
  const time = (req.body.time || '').trim();
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
  db.run("INSERT INTO events (title, date, time, created_by) VALUES (?, ?, ?, ?)", [title, date, time, req.user.id], function (e) {
    if (e) return res.status(500).json({ error: 'Database error' });
    const ev = { id: this.lastID, title, date, time, created_by: req.user.id };
    if (io) io.emit('event_created', ev);
    res.json(ev);
  });
});
app.delete('/api/events/:id', requireAuth, (req, res) => {
  db.run("DELETE FROM events WHERE id = ?", [req.params.id], function (e) {
    if (e) return res.status(500).json({ error: 'Database error' });
    if (io) io.emit('event_deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  });
});

// --- Whiteboard (strokes added live via socket; this loads the saved board) -
app.get('/api/whiteboard', requireAuth, (req, res) => {
  db.all("SELECT data FROM whiteboard_strokes ORDER BY id ASC", [], (e, rows) => {
    if (e) return res.status(500).json({ error: 'Database error' });
    res.json(rows.map(r => { try { return JSON.parse(r.data); } catch (_) { return null; } }).filter(Boolean));
  });
});

// Serves / redirects to the latest application installer download hosted on GitHub Releases
app.get('/api/download-app', (req, res) => {
  res.redirect('https://github.com/studytime85200-cmd/v-office/releases/latest');
});

// SPA fallback: any non-API GET that didn't match a static file returns the
// app shell so the client-side app boots. Registered last so it can't shadow
// the /api routes above.
app.get(/^(?!\/api\/|\/uploads\/|\/socket\.io\/).*/, (req, res, next) => {
  const indexFile = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  next();
});

// Setup Socket.IO
io = setupSocket(server, db, JWT_SECRET, SERVER_ID);

// Starts the backend. onReady(actualPort) is called once it's listening.
// If PORT wasn't set explicitly (Render sets it; a user can set it in .env to
// force one), we prefer 3000 but fall back to any free port when 3000 is busy —
// so a clashing port can't stop the desktop app from launching.
function startServer(onReady) {
  const forced = process.env.PORT != null && process.env.PORT !== '';

  const announce = () => {
    const actualPort = server.address().port;
    console.log(`Backend server running on http://localhost:${actualPort}`);
    registerHeartbeat();
    if (typeof onReady === 'function') onReady(actualPort);
  };

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !forced) {
      console.warn(`[server] Port ${PORT} is busy — falling back to a free port.`);
      server.listen(0, announce); // 0 => OS picks an open port
    } else {
      console.error(`[server] Could not start on port ${PORT}:`, err.message);
      throw err;
    }
  });

  server.listen(PORT, announce);
}

function getServerId() { return SERVER_ID; }
module.exports = { startServer, getServerId };
