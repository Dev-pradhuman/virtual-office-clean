const { autoUpdater } = require('electron-updater');
const { ipcMain, app } = require('electron');
const configStore = require('./backend/config-store');

// Configure autoUpdater options
autoUpdater.autoDownload = false; // We want to prompt the user first
autoUpdater.logger = console;

let updateCheckInterval = null;

function initializeUpdater(mainWindow) {
  // Read admin settings
  const conf = configStore.readConfig();
  const channel = conf.updateChannel || 'stable'; // stable, beta, dev
  const updateCheckFrequency = Number(conf.updateCheckFrequency) || 3600000; // default 1 hour in ms

  autoUpdater.channel = channel;
  autoUpdater.allowDowngrade = false;

  const logUpdateEvent = (status, details) => {
    console.log(`[updater] ${status}:`, details || '');
    try {
      const db = require('./backend/database');
      if (db && typeof db.run === 'function') {
        db.run(
          "INSERT INTO user_status_history (user_id, status, reason) VALUES (0, ?, ?)",
          ['system_update', `${status}: ${JSON.stringify(details || {})}`]
        );
      }
    } catch (e) {
      // Database not yet loaded or running in standalone mode
    }
  };

  // IPC Handlers
  ipcMain.handle('check-for-updates', async () => {
    logUpdateEvent('check_started', 'User triggered manual update check');
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (err) {
      logUpdateEvent('check_failed', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    logUpdateEvent('download_started', 'User requested update download');
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      logUpdateEvent('download_failed', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('install-update', () => {
    logUpdateEvent('install_started', 'User requested update restart/installation');
    app.isQuitting = true; // update restart is maintenance, not a manual shutdown
    autoUpdater.quitAndInstall();
    return true;
  });

  // autoUpdater events mapping
  autoUpdater.on('checking-for-update', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { event: 'checking' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    logUpdateEvent('update_available', info);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', {
        event: 'available',
        info: {
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes || 'No release notes provided.',
          size: info.files && info.files[0] ? info.files[0].size : null
        }
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    logUpdateEvent('no_update_available', info);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { event: 'not-available' });
    }
  });

  autoUpdater.on('error', (err) => {
    logUpdateEvent('error', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { event: 'error', error: err.message });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', {
        event: 'progress',
        progress: {
          percent: progressObj.percent,
          bytesPerSecond: progressObj.bytesPerSecond,
          transferred: progressObj.transferred,
          total: progressObj.total
        }
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    logUpdateEvent('download_completed', info);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater-event', { event: 'downloaded', version: info.version });
    }
  });

  const checkUpdatesSilently = () => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('[updater] Silent update check failed:', err.message);
    });
  };

  // Delayed start (10s) to avoid dragging startup performance
  setTimeout(checkUpdatesSilently, 10000);

  if (updateCheckInterval) clearInterval(updateCheckInterval);
  updateCheckInterval = setInterval(checkUpdatesSilently, updateCheckFrequency);
}

module.exports = { initializeUpdater };
