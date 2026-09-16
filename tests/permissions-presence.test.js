const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');

const root = path.resolve(__dirname, '..');
const frontendRequire = createRequire(path.join(root, 'Team Hearth', 'package.json'));
const { io } = frontendRequire('socket.io-client');

async function waitFor(check, timeoutMs = 6000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for server state');
}

test('shutdown grants are admin-only and connection presence cannot be set Away', async () => {
  const dbName = `permission-test-${crypto.randomUUID()}.db`;
  const dbPath = path.join(root, 'scratch', dbName);
  const seedDb = new sqlite3.Database(dbPath);
  const run = (sql, args = []) => new Promise((resolve, reject) => seedDb.run(sql, args, (err) => err ? reject(err) : resolve()));
  await run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, avatar TEXT,
    role TEXT, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'offline', status_message TEXT DEFAULT '',
    current_project TEXT, designation TEXT DEFAULT ''
  )`);
  const hash = await bcrypt.hash('test-password', 4);
  await run('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)', [1, 'TestAdmin', hash, 'admin']);
  await run('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)', [2, 'TestMember', hash, 'member']);
  await new Promise((resolve, reject) => seedDb.close((err) => err ? reject(err) : resolve()));

  const child = spawn(process.execPath, ['server-only.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0', JWT_SECRET: 'test-only-secret', TURSO_DATABASE_URL: `file:scratch/${dbName}`, ADMIN_USERNAME: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let socket;
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const port = await waitFor(() => {
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      return /Backend server running on http:\/\/localhost:(\d+)/.exec(output)?.[1];
    }, 30000).catch((e) => { throw new Error(`${e.message}\n${output}`); });
    const base = `http://localhost:${port}`;
    const request = async (path, token, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, data: await response.json() };
    };
    const login = async (username) => {
      const response = await request('/api/login', null, 'POST', { username, password: 'test-password' });
      assert.equal(response.status, 200, output);
      return response.data.token;
    };
    const admin = await login('TestAdmin');
    const member = await login('TestMember');
    await waitFor(async () => (await request('/api/me/permissions', member)).status === 200);
    assert.equal((await request('/api/me/permissions', member)).data.can_turn_off_v_office, false);
    assert.equal((await request('/api/desktop/shutdown-authorization', member, 'POST')).status, 403);
    assert.equal((await request('/api/admin/users/2/permissions/can_turn_off_v_office', member, 'PUT', { granted: true })).status, 403);
    assert.equal((await request('/api/admin/users/2/permissions/can_turn_off_v_office', admin, 'PUT', { granted: true })).status, 200);
    assert.equal((await request('/api/me/permissions', member)).data.can_turn_off_v_office, true);
    assert.equal((await request('/api/desktop/shutdown-authorization', member, 'POST')).status, 200);
    assert.equal((await request('/api/admin/users/2/permissions/can_turn_off_v_office', admin, 'PUT', { granted: false })).status, 200);
    assert.equal((await request('/api/desktop/shutdown-authorization', member, 'POST')).status, 403);

    socket = io(base, { auth: { token: member, deviceId: 'integration-test' }, transports: ['websocket'] });
    const sessionId = await new Promise((resolve, reject) => {
      socket.once('session_created', (data) => resolve(data.sessionId));
      socket.once('connect_error', reject);
    });
    await waitFor(async () => (await request('/api/users', member)).data.find((u) => u.id === 2)?.status === 'online');
    socket.emit('set_status', { status: 'away', message: 'old-client-attempt' });
    socket.emit('heartbeat', { userId: 2, sessionId, deviceId: 'integration-test', status: 'away', timestamp: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await request('/api/users', member)).data.find((u) => u.id === 2)?.status, 'online');
    socket.emit('client_graceful_exit');
    socket.disconnect();
    await waitFor(async () => (await request('/api/users', member)).data.find((u) => u.id === 2)?.status === 'offline');
  } finally {
    socket?.disconnect();
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
    try { fs.unlinkSync(dbPath); } catch (e) {}
  }
});
