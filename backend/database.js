const path = require('path');
const bcrypt = require('bcryptjs');

let dbPath = path.resolve(__dirname, '..', 'office.db');
try {
  const { app } = require('electron');
  if (app) {
    dbPath = path.join(app.getPath('userData'), 'office.db');
  }
} catch (e) {
  // Headless or developer mode
}

// Persistence layer. If TURSO_DATABASE_URL is set we use Turso (libSQL) so data
// survives Render deploys; otherwise we fall back to a local SQLite file (the
// previous behavior — ephemeral on Render, fine for desktop/local use).
//
// The Turso path is wrapped in a thin adapter that mimics node-sqlite3's
// run/get/all/serialize API (including the `this.lastID`/`this.changes` context
// on run callbacks) so the rest of the app is unchanged.
let db;

// Build a node-sqlite3-compatible adapter over a libSQL client. Operations are
// queued so they execute in order (the schema must be created before it's used),
// matching sqlite3's serialized single-connection behavior.
function makeLibsqlAdapter(client) {
  let chain = Promise.resolve();
  const enqueue = (op) => { chain = chain.then(() => op().catch((e) => e)); return chain; };

  const norm = (params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    if (params == null) params = [];
    else if (!Array.isArray(params)) params = [params];
    // libSQL rejects `undefined`; coerce to null.
    params = params.map((v) => (v === undefined ? null : v));
    return { params, cb };
  };
  const rowToObj = (cols, row) => {
    const o = {};
    cols.forEach((c, i) => { const v = row[i]; o[c] = (typeof v === 'bigint') ? Number(v) : v; });
    return o;
  };

  return {
    run(sql, params, cb) {
      const n = norm(params, cb);
      enqueue(async () => {
        try {
          const rs = await client.execute({ sql, args: n.params });
          if (n.cb) n.cb.call({ lastID: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined, changes: rs.rowsAffected }, null);
        } catch (e) { if (n.cb) n.cb.call({}, e); else console.error('[db.run]', e.message); }
      });
    },
    get(sql, params, cb) {
      const n = norm(params, cb);
      enqueue(async () => {
        try {
          const rs = await client.execute({ sql, args: n.params });
          if (n.cb) n.cb(null, rs.rows[0] ? rowToObj(rs.columns, rs.rows[0]) : undefined);
        } catch (e) { if (n.cb) n.cb(e); }
      });
    },
    all(sql, params, cb) {
      const n = norm(params, cb);
      enqueue(async () => {
        try {
          const rs = await client.execute({ sql, args: n.params });
          if (n.cb) n.cb(null, rs.rows.map((r) => rowToObj(rs.columns, r)));
        } catch (e) { if (n.cb) n.cb(e, []); }
      });
    },
    // Ops are already serialized via the chain, so just run the body.
    serialize(fn) { if (fn) fn(); }
  };
}

const tursoUrl = process.env.TURSO_DATABASE_URL;
if (tursoUrl) {
  // Remote (libsql://, https://, wss://) -> pure-JS web client (no native deps,
  // safe on Render). Local (file:/:memory:) -> native client (used for testing).
  const isRemote = /^(libsql|wss?|https?):/i.test(tursoUrl);
  const { createClient } = require(isRemote ? '@libsql/client/web' : '@libsql/client');
  const client = createClient({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  db = makeLibsqlAdapter(client);
  console.log(`Connected to Turso (libSQL) database${isRemote ? '' : ' [local]'}.`);
  initDb();
} else {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database', err.message);
    } else {
      console.log('Connected to the SQLite database.');
      initDb();
    }
  });
}

function initDb() {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      avatar TEXT,
      role TEXT,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'offline',
      status_message TEXT DEFAULT '',
      current_project TEXT,
      designation TEXT DEFAULT ''
    )`);

    // Ensure designation column exists for older database instances
    db.run("ALTER TABLE users ADD COLUMN designation TEXT DEFAULT ''", () => {});

    // Messages table. recipient_id NULL = team/public message; otherwise a DM.
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      content TEXT,
      type TEXT DEFAULT 'text',
      recipient_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id)
    )`);
    // Add recipient_id to databases created before DMs existed (ignore if present).
    db.run("ALTER TABLE messages ADD COLUMN recipient_id INTEGER", () => {});
    // Channel for team (non-DM) messages. Existing rows default to 'general'.
    db.run("ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'general'", () => {});

    // Files table
    db.run(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uploader_id INTEGER,
      filename TEXT,
      filepath TEXT,
      mimetype TEXT,
      size INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(uploader_id) REFERENCES users(id)
    )`);

    // Tasks (shared task board)
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      done INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run("ALTER TABLE tasks ADD COLUMN description TEXT", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN assignee_id INTEGER", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN owner_id INTEGER", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN due_date TEXT", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium'", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'todo'", () => {});
    db.run("ALTER TABLE tasks ADD COLUMN project_id INTEGER", () => {});

    // Task Comments
    db.run(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Task Activities
    db.run(`CREATE TABLE IF NOT EXISTS task_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      user_id INTEGER,
      action TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Task Attachments
    db.run(`CREATE TABLE IF NOT EXISTS task_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      file_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    )`);

    // Projects
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      owner_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Calendar events
    db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      date TEXT,
      time TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Whiteboard strokes (collaborative canvas)
    db.run(`CREATE TABLE IF NOT EXISTS whiteboard_strokes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Online sessions (for the 1/7/30-day "time online" stats). One row per
    // connection: ended_at stays NULL until the user disconnects.
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    )`);
    db.run("ALTER TABLE sessions ADD COLUMN server_id TEXT", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN last_heartbeat DATETIME", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN exit_status TEXT DEFAULT 'disconnected'", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN exit_reason TEXT", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN device_id TEXT", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN app_version TEXT", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN cpu_usage INTEGER", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN ram_usage INTEGER", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN os TEXT", () => {});
    db.run("ALTER TABLE sessions ADD COLUMN network_quality TEXT", () => {});

    // Status transition audit log for administrators
    db.run(`CREATE TABLE IF NOT EXISTS user_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      status TEXT,
      reason TEXT,
      device_id TEXT,
      app_version TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run("ALTER TABLE user_status_history ADD COLUMN device_id TEXT", () => {});
    db.run("ALTER TABLE user_status_history ADD COLUMN app_version TEXT", () => {});

    // Servers table for heartbeat tracking in multi-instance environments
    db.run(`CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Simple shared key/value settings (e.g. the office backdrop image).
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    // 1. Close sessions of dead servers (where no heartbeat has been sent for 90 seconds).
    // Also close legacy sessions with NULL server_id on startup.
    db.run(`
      UPDATE sessions 
      SET ended_at = started_at 
      WHERE ended_at IS NULL 
        AND (server_id IS NULL OR server_id IN (
          SELECT id FROM servers WHERE datetime(last_heartbeat) < datetime('now', '-90 seconds')
        ))
    `);

    // 2. Remove dead servers from the heartbeat registry
    db.run("DELETE FROM servers WHERE datetime(last_heartbeat) < datetime('now', '-90 seconds')");

    // 3. Precisely transition users to offline ONLY if they have no other open sessions.
    // Actually-connected clients stay online, avoiding split-brain presence issues.
    db.run(`
      UPDATE users 
      SET status = 'offline' 
      WHERE id NOT IN (
        SELECT DISTINCT user_id FROM sessions WHERE ended_at IS NULL
      )
    `);

    // Seed default users if empty
    db.get("SELECT COUNT(*) AS count FROM users", (err, row) => {
      if (err || !row) {
        console.error('[db] Could not check for existing users; skipping seed:', err && err.message);
        return;
      }
      if (row.count === 0) {
        console.log("Seeding default users...");
        const users = [
          { username: 'Arjun', project: 'Cricket Coach AI', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Arjun' },
          { username: 'Aviral', project: 'Business Planning', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aviral' },
          { username: 'Pradhuman', project: 'MCP Research', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pradhuman' }
        ];

        users.forEach(async (u) => {
          const hash = await bcrypt.hash('password123', 10);
          db.run("INSERT INTO users (username, password_hash, avatar, role, current_project) VALUES (?, ?, ?, ?, ?)", [u.username, hash, u.avatar, 'member', u.project]);
        });
      }
    });

    // Optionally promote a user to admin (configures API keys in-app).
    // Set ADMIN_USERNAME in the environment to choose who. No one is admin
    // by default. Runs on every boot so it also works on existing databases.
    if (process.env.ADMIN_USERNAME) {
      db.run("UPDATE users SET role = 'admin' WHERE username = ?", [process.env.ADMIN_USERNAME], function (err) {
        if (!err && this.changes > 0) {
          console.log(`[admin] '${process.env.ADMIN_USERNAME}' is set as admin.`);
        }
      });
    }
  });
}

module.exports = db;
