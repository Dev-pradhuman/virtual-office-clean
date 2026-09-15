// Server-side runtime configuration set by an admin through the app UI.
// Encrypted in production builds using Electron's native safeStorage API.
// Stored in the user's data directory so it survives ASAR packaging and remains writable.
const fs = require('fs');
const path = require('path');

let userDataPath = null;
let safeStorage = null;
try {
  const electron = require('electron');
  const app = electron.app;
  if (app) {
    userDataPath = app.getPath('userData');
  }
  safeStorage = electron.safeStorage;
} catch (e) {
  // Headless mode or running outside Electron (development server-only)
}

const CONFIG_FILENAME = 'runtime-config.enc';
const PLAINTEXT_FILENAME = 'runtime-config.json';

const CONFIG_PATH = userDataPath 
  ? path.join(userDataPath, CONFIG_FILENAME) 
  : path.join(__dirname, PLAINTEXT_FILENAME);

const PLAINTEXT_PATH = userDataPath 
  ? path.join(userDataPath, PLAINTEXT_FILENAME) 
  : path.join(__dirname, PLAINTEXT_FILENAME);

function isEncryptionSupported() {
  return safeStorage && safeStorage.isEncryptionAvailable();
}

function readConfig() {
  // 1. Try to read and decrypt the encrypted configuration if supported
  if (isEncryptionSupported() && fs.existsSync(CONFIG_PATH)) {
    try {
      const encryptedBuffer = fs.readFileSync(CONFIG_PATH);
      const decryptedString = safeStorage.decryptString(encryptedBuffer);
      return JSON.parse(decryptedString);
    } catch (e) {
      console.error('[config] Failed to decrypt configuration:', e.message);
    }
  }

  // 2. Fallback to plaintext runtime-config.json if it exists (legacy / development)
  if (fs.existsSync(PLAINTEXT_PATH)) {
    try {
      const plaintextString = fs.readFileSync(PLAINTEXT_PATH, 'utf8');
      const parsed = JSON.parse(plaintextString);
      // Migrate plaintext configuration to encrypted store if encryption is supported
      if (isEncryptionSupported()) {
        console.log('[config] Migrating plaintext config to safeStorage...');
        writeConfig(parsed);
        try { fs.unlinkSync(PLAINTEXT_PATH); } catch (_) {}
      }
      return parsed;
    } catch (e) {
      console.error('[config] Failed to read plaintext config:', e.message);
    }
  }

  return {};
}

function writeConfig(partial) {
  const merged = { ...readConfig(), ...partial };
  const jsonString = JSON.stringify(merged, null, 2);

  if (isEncryptionSupported()) {
    try {
      const encryptedBuffer = safeStorage.encryptString(jsonString);
      fs.writeFileSync(CONFIG_PATH, encryptedBuffer);
      return merged;
    } catch (e) {
      console.error('[config] safeStorage encryption failed, writing plaintext fallback:', e.message);
    }
  }

  // Plaintext fallback
  fs.writeFileSync(PLAINTEXT_PATH, jsonString);
  return merged;
}

// Effective Google Drive config: runtime config first, then env fallback.
function getGoogleConfig() {
  const g = readConfig().google || {};
  return {
    clientId: g.clientId || process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: g.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: g.refreshToken || process.env.GOOGLE_REFRESH_TOKEN || '',
    folderId: g.folderId || process.env.GOOGLE_DRIVE_FOLDER_ID || ''
  };
}

module.exports = { readConfig, writeConfig, getGoogleConfig, CONFIG_PATH };
