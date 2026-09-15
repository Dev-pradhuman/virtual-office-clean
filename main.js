const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, desktopCapturer, safeStorage, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Read config and disable hardware acceleration if configured
try {
  const configPath = path.join(app.getPath('userData'), 'vo_config.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let configData = {};
    if (raw && raw.enc && safeStorage && safeStorage.isEncryptionAvailable()) {
      configData = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
    } else if (raw && raw.plain) {
      configData = JSON.parse(raw.plain);
    } else {
      configData = raw || {};
    }
    if (configData.perfHardware === false) {
      app.disableHardwareAcceleration();
      console.log('[perf] GPU Hardware Acceleration disabled.');
    }
  }
} catch (e) {
  console.error('[perf] Failed to check hardware acceleration settings:', e);
}
const { exec, spawn, execFile } = require('child_process');
const { startServer } = require('./backend/server');

// Local backend port. Change this by setting PORT in .env (e.g. PORT=3001) when
// 3000 is busy with another project. Backend (backend/server.js) reads the same
// var, so this one setting keeps the server and the app windows in sync.
// (dotenv was loaded above via require('./backend/server').)
const PORT = process.env.PORT || 3000;
// Updated to the actual port once the backend is listening — if 3000 is busy
// (and PORT wasn't set explicitly) the server falls back to a free port.
let BASE_URL = `http://localhost:${PORT}`;
let serverReady = false;
let isSecondaryInstance = false;

let mainWindow;
let miniWindow = null; // always-on-top pop-out chat window
let tray = null;
let pendingShareSourceId = null; // the source the user picked, for getDisplayMedia
const isDev = !app.isPackaged;

const startHidden = process.argv.includes('--hidden');
const configStore = require('./backend/config-store');

// Set gracefulExit to false immediately for this run to monitor unexpected shutdowns
configStore.writeConfig({ gracefulExit: false });

let authenticatedToQuit = false;

// --- Persistence watchdog ---------------------------------------------------
// Keeps the app alive: if it's force-killed (Task Manager "End task", a crash,
// or a power blip) it is relaunched ~1s later. A normal password-gated quit
// writes a stop-flag first, so the watchdog exits quietly instead of relaunching.
//
// Enabled only in packaged builds by default (set VO_FORCE_WATCHDOG=1 to test in
// dev) — otherwise it would respawn the app while you're developing with
// `npm start` and you'd be unable to stop it without the quit password.
const WATCHDOG_ENABLED = app.isPackaged || process.env.VO_FORCE_WATCHDOG === '1';

// The watchdog runs as plain Node (via the Electron binary in RUN_AS_NODE mode).
// It watches the app's PID and, if the app vanishes without a stop-flag, relaunches
// it. Kept dependency-free and written to userData so it works outside the asar.
const WATCHDOG_SOURCE = `
const fs = require('fs');
const { spawn } = require('child_process');
const parentPid = parseInt(process.argv[2], 10);
const stopFlag = process.argv[3];
let spec = {};
try { spec = JSON.parse(Buffer.from(process.argv[4] || '', 'base64').toString('utf8')); } catch (e) {}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function stopRequested() {
  try { return fs.existsSync(stopFlag); } catch (e) { return false; }
}

const timer = setInterval(function () {
  if (stopRequested()) { clearInterval(timer); process.exit(0); }
  if (!alive(parentPid)) {
    clearInterval(timer);
    // Grace period, then re-check the flag to avoid racing a graceful quit.
    setTimeout(function () {
      if (stopRequested()) { process.exit(0); }
      try {
        const env = Object.assign({}, process.env);
        delete env.ELECTRON_RUN_AS_NODE; // relaunch as a real GUI app, not Node
        const child = spawn(spec.execPath, spec.args || [], {
          detached: true, stdio: 'ignore', cwd: spec.cwd, env: env
        });
        child.unref();
      } catch (e) {}
      process.exit(0);
    }, 1000);
  }
}, 1000);
`;

function stopFlagPath() {
  return path.join(app.getPath('userData'), 'vo-watchdog.stop');
}
function writeStopFlag() {
  try { fs.writeFileSync(stopFlagPath(), String(Date.now())); } catch (e) {}
}
function clearStopFlag() {
  try { if (fs.existsSync(stopFlagPath())) fs.unlinkSync(stopFlagPath()); } catch (e) {}
}

function startWatchdog() {
  if (!WATCHDOG_ENABLED) return;
  if (isSecondaryInstance) return; // only the primary instance owns a watchdog
  try {
    const scriptPath = path.join(app.getPath('userData'), 'vo-watchdog.js');
    fs.writeFileSync(scriptPath, WATCHDOG_SOURCE);

    // How the watchdog should relaunch us. Packaged: run the exe directly.
    // Dev: run the Electron binary against the project directory.
    const spec = app.isPackaged
      ? { execPath: process.execPath, args: [], cwd: path.dirname(process.execPath) }
      : { execPath: process.execPath, args: [app.getAppPath()], cwd: app.getAppPath() };

    const child = spawn(process.execPath, [
      scriptPath,
      String(process.pid),
      stopFlagPath(),
      Buffer.from(JSON.stringify(spec)).toString('base64')
    ], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
    });
    child.unref();
    console.log('[watchdog] started, monitoring pid', process.pid);
  } catch (e) {
    console.error('[watchdog] failed to start:', e);
  }
}

// --- Windows keep-alive scheduled task -------------------------------------
// The in-process watchdog covers a crash or a kill of the main process, but if
// someone force-kills the whole process tree (watchdog included), only a wholly
// external supervisor can bring the app back. A per-user Scheduled Task —
// triggered at logon and repeating every minute — does exactly that, and also
// restores the app after a reboot. It launches the app ONLY when it isn't
// already running and NOT when the user did a legitimate password-gated quit
// (the same stop-flag the watchdog honors), and it needs no admin rights.
const KEEPALIVE_TASK = 'VirtualOfficeKeepAlive';
const relauncherVbsPath = () => path.join(app.getPath('userData'), 'vo-relauncher.vbs');
const keepAliveXmlPath = () => path.join(app.getPath('userData'), 'vo-keepalive.xml');
const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeRelauncherVbs() {
  // wscript runs this silently (no console flash). It relaunches the exe unless
  // the app is already running or a stop-flag marks an intentional quit.
  const lines = [
    'Dim exePath, stopFlag, fso, wmi, procs, running, p, shell',
    'exePath = "' + process.execPath + '"',
    'stopFlag = "' + stopFlagPath() + '"',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'If fso.FileExists(stopFlag) Then WScript.Quit',
    'Set wmi = GetObject("winmgmts:")',
    'Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = ' + "'Virtual Office.exe'" + '")',
    'running = False',
    'For Each p In procs',
    '  running = True',
    'Next',
    'If Not running Then',
    '  Set shell = CreateObject("WScript.Shell")',
    '  shell.Run """" & exePath & """", 1, False',
    'End If',
    ''
  ];
  fs.writeFileSync(relauncherVbsPath(), lines.join('\r\n'), 'utf8');
}

function writeKeepAliveXml() {
  const args = xmlEscape('"' + relauncherVbsPath() + '"');
  // Scope the task to the current user so it can be created without admin.
  // A LogonTrigger fires it right when the user signs in; a TimeTrigger with a
  // 1-minute repetition keeps it firing continuously during the session (the
  // LogonTrigger's own repetition wouldn't start until the next logon).
  const user = xmlEscape(((process.env.USERDOMAIN || process.env.COMPUTERNAME || '') + '\\' + (process.env.USERNAME || '')).replace(/^\\/, ''));
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Keeps Virtual Office running (relaunches it if it is closed).</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Enabled>true</Enabled>
      <StartBoundary>2024-01-01T00:00:00</StartBoundary>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>`;
  // Task Scheduler expects UTF-16 with a BOM to match the XML declaration.
  fs.writeFileSync(keepAliveXmlPath(), '﻿' + xml, 'utf16le');
}

const relauncherShPath = () => path.join(app.getPath('userData'), 'vo-relauncher.sh');

function writeRelauncherSh() {
  const lines = [
    '#!/bin/bash',
    `EXE_PATH="${process.execPath}"`,
    `STOP_FLAG="${stopFlagPath()}"`,
    'while true; do',
    '  sleep 5',
    '  if [ -f "$STOP_FLAG" ]; then',
    '    exit 0',
    '  fi',
    '  if ! ps -x -o command | grep -E -i "virtual-office|virtual office" | grep -v "grep" | grep -v "vo-relauncher.sh" > /dev/null; then',
    '    "$EXE_PATH" &',
    '  fi',
    'done'
  ];
  fs.writeFileSync(relauncherShPath(), lines.join('\n'), { mode: 0o755 });
}

function ensureLinuxKeepAliveTask() {
  if (process.platform !== 'linux' || !app.isPackaged) return;
  try {
    writeRelauncherSh();
    exec('pgrep -f vo-relauncher.sh', (err, stdout) => {
      if (err || !stdout.trim()) {
        const child = spawn(relauncherShPath(), [], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        console.log('[keepalive] linux watchdog started.');
      }
    });
  } catch (e) {
    console.error('[keepalive] error:', e);
  }
}

function ensureKeepAliveTask() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    writeRelauncherVbs();
    writeKeepAliveXml();
    // /F overwrites so re-running self-heals the paths after an update/move.
    execFile('schtasks', ['/Create', '/TN', KEEPALIVE_TASK, '/XML', keepAliveXmlPath(), '/F'], (err, _stdout, stderr) => {
      if (err) console.error('[keepalive] could not register scheduled task:', (stderr || err.message || '').trim());
      else console.log('[keepalive] scheduled task registered (logon + every 1 min).');
    });
  } catch (e) {
    console.error('[keepalive] error:', e);
  }
}

// Remove the keep-alive task (used if persistence is ever turned off).
function removeKeepAliveTask() {
  if (process.platform !== 'win32') return;
  try {
    execFile('schtasks', ['/Delete', '/TN', KEEPALIVE_TASK, '/F'], () => {});
  } catch (e) { /* ignore */ }
}
// ---------------------------------------------------------------------------

function requestQuit() {
  const conf = configStore.readConfig();
  const correctPassword = conf.quitPassword || process.env.QUIT_PASSWORD || 'office_admin_exit_pass';

  if (authenticatedToQuit || !correctPassword) {
    app.isQuitting = true;
    writeStopFlag(); // legitimate quit — tell the watchdog not to relaunch

    // Clean up database presence before terminating
    const serverModule = require('./backend/server');
    const db = require('./backend/database');
    const serverId = serverModule.getServerId ? serverModule.getServerId() : null;

    if (serverId && db && typeof db.run === 'function') {
      console.log('[main] Cleaning up database presence before shutdown...');
      db.run(`
        UPDATE sessions 
        SET ended_at = CURRENT_TIMESTAMP, exit_status = 'graceful', exit_reason = 'User closed application normally' 
        WHERE ended_at IS NULL AND server_id = ?
      `, [serverId], () => {
        db.run(`
          UPDATE users 
          SET status = 'closed', last_seen = CURRENT_TIMESTAMP 
          WHERE id NOT IN (
            SELECT DISTINCT user_id FROM sessions WHERE ended_at IS NULL
          )
        `, () => {
          app.quit();
        });
      });
    } else {
      app.quit();
    }
  } else {
    showMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('prompt-quit-password');
    }
  }
}

app.on('before-quit', (event) => {
  if (isSecondaryInstance) return;
  const conf = configStore.readConfig();
  const correctPassword = conf.quitPassword || process.env.QUIT_PASSWORD || 'office_admin_exit_pass';

  if (!app.isQuitting && !authenticatedToQuit && correctPassword) {
    event.preventDefault();
    requestQuit();
  }
});

app.on('session-end', () => {
  app.isQuitting = true;
  writeStopFlag(); // OS shutdown/logoff — don't fight it; autostart brings us back at next login
});

ipcMain.handle('verify-quit-password', (event, password) => {
  const conf = configStore.readConfig();
  const correctPassword = conf.quitPassword || process.env.QUIT_PASSWORD || 'office_admin_exit_pass';
  
  if (password === correctPassword) {
    authenticatedToQuit = true;
    app.isQuitting = true;
    
    // Save graceful exit flag as true before quitting!
    configStore.writeConfig({ gracefulExit: true });

    requestQuit();
    return { success: true };
  }
  return { success: false, error: 'Incorrect password' };
});

// Enable Linux screen sharing support (PipeWire)
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

// Windows shows the AppUserModelID as the notification's source app; without it
// matching the installer appId, toast notifications are silently suppressed.
if (process.platform === 'win32') app.setAppUserModelId('com.virtualoffice.app');

// Single-instance lock: relaunching the app should reveal the existing window
// (which may be hidden in the tray) instead of starting a second server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  isSecondaryInstance = true;
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  // Start the Express backend server (only in the primary instance).
  // The callback gives us the real port (it may differ from 3000 if that was
  // busy), so the windows always point at the right place.
  startServer((boundPort) => {
    BASE_URL = `http://localhost:${boundPort}`;
    serverReady = true;
    // If the window was created before the port was known, load it now.
    if (mainWindow) mainWindow.loadURL(BASE_URL);
  });
}

// Show (creating if needed) and focus the main window.
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// IPC handler for screen sources (used to populate our custom picker)
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

// The renderer tells us which source it picked, then calls getDisplayMedia();
// routing capture through Electron's handler fixes black frames on Wayland/PipeWire.
ipcMain.handle('set-share-source', (event, id) => {
  pendingShareSourceId = id;
  return true;
});

// Which apps the user has open (Opera, VS Code, Valorant, Roblox…), shown to
// teammates. On Windows we read the full process list (so games/fullscreen apps
// that aren't normal "windows" are still caught) and reduce it to friendly app
// names; elsewhere we fall back to capturable window titles.
const APP_NAME_MAP = {
  chrome: 'Chrome', msedge: 'Edge', opera: 'Opera', opera_gx: 'Opera GX',
  firefox: 'Firefox', brave: 'Brave', vivaldi: 'Vivaldi',
  code: 'VS Code', 'code - insiders': 'VS Code', devenv: 'Visual Studio',
  sublime_text: 'Sublime Text', 'notepad++': 'Notepad++', notepad: 'Notepad', idea64: 'IntelliJ',
  discord: 'Discord', slack: 'Slack', spotify: 'Spotify', steam: 'Steam', steamwebhelper: 'Steam',
  whatsapp: 'WhatsApp', telegram: 'Telegram', notion: 'Notion', obs64: 'OBS', vlc: 'VLC',
  valorant: 'Valorant', 'valorant-win64-shipping': 'Valorant', riotclientux: 'Riot Client',
  robloxplayerbeta: 'Roblox', leagueclient: 'League of Legends', 'league of legends': 'League of Legends',
  epicgameslauncher: 'Epic Games', minecraft: 'Minecraft', minecraftlauncher: 'Minecraft',
  photoshop: 'Photoshop', figma: 'Figma', cs2: 'Counter-Strike 2', fortniteclient_win64_shipping: 'Fortnite'
};
const APP_DENY = new Set([
  'explorer.exe', 'applicationframehost.exe', 'textinputhost.exe', 'systemsettings.exe',
  'searchhost.exe', 'searchapp.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
  'dwm.exe', 'sihost.exe', 'ctfmon.exe', 'runtimebroker.exe', 'smartscreen.exe', 'widgets.exe',
  'widgetservice.exe', 'lockapp.exe', 'electron.exe', 'virtual office.exe', 'virtualoffice.exe',
  'taskmgr.exe', 'msedgewebview2.exe', 'phoneexperiencehost.exe', 'gamebar.exe', 'gamebarftserver.exe',
  'svchost.exe', 'taskhostw.exe', 'unsecapp.exe', 'conhost.exe', 'dllhost.exe', 'backgroundtaskhost.exe',
  'wmiprvse.exe', 'audiodg.exe', 'fontdrvhost.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'smss.exe', 'spoolsv.exe', 'rundll32.exe', 'dashost.exe',
  'securityhealthsystray.exe', 'shellhost.exe', 'appactions.exe', 'sppsvc.exe'
]);
// Background/utility processes (often have hidden window titles) and service
// accounts we never want to surface as "apps".
const APP_BG_PATTERN = /tray|hotkey|helper|agent|updat|daemon|service|broker|crashpad|notif|systray|vantage|webview|gamebar|overlay|crossdevice|smartsense|appactions|host$/i;
const APP_SVC_USER = /system|local service|network service|^n\/?a$|dwm-|umfd-|font driver/i;

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function cleanBrowserTitle(procName, title) {
  if (!title) return '';
  let clean = title.trim();
  
  // Common browser suffixes
  const suffixes = [
    ' - Google Chrome',
    ' - Microsoft Edge',
    ' - Personal - Microsoft Edge',
    ' — Mozilla Firefox',
    ' - Opera',
    ' - Brave',
    ' - Vivaldi',
    ' - Discord',
    ' - Slack'
  ];
  
  for (const s of suffixes) {
    if (clean.endsWith(s)) {
      clean = clean.slice(0, -s.length).trim();
    }
  }
  
  // Edge sometimes adds "and X more pages"
  clean = clean.replace(/ and \d+ more pages?/gi, '');
  
  // If the clean title is just the browser name or a generic "new tab", return empty
  const lower = clean.toLowerCase();
  if (lower === 'google chrome' || lower === 'microsoft edge' || lower === 'new tab' || lower === 'mozilla firefox' || lower === 'opera' || lower === 'brave' || lower === 'vivaldi') {
    return '';
  }
  
  return clean;
}

function appsFromPowershell(stdout) {
  const seen = new Set(), apps = [];
  stdout.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line) return;
    const parts = line.split(':::');
    if (parts.length < 2) return;
    
    const proc = parts[0].trim().toLowerCase();
    let title = parts.slice(1).join(':::').trim();
    if (!title || title === 'N/A' || title === 'Default IME' || title === 'MSCTFIME UI') return;
    
    if (APP_DENY.has(proc + '.exe')) return;
    if (APP_BG_PATTERN.test(proc)) return;
    
    let appName = APP_NAME_MAP[proc];
    if (appName === '') return;
    if (!appName) appName = proc.charAt(0).toUpperCase() + proc.slice(1);
    
    // Clean tab title if it's a browser
    const browsers = ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi'];
    if (browsers.includes(proc)) {
      const tabTitle = cleanBrowserTitle(proc, title);
      if (tabTitle) {
        appName = `${appName}: ${tabTitle}`;
      }
    }
    
    if (seen.has(appName)) return;
    seen.add(appName);
    apps.push(appName);
  });
  return apps.slice(0, 25);
}

function appsFromTasklist(stdout) {
  const seen = new Set(), apps = [];
  stdout.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const f = parseCsvLine(line);
    if (f.length < 9) return;
    const image = (f[0] || '').trim();
    const user = (f[6] || '').trim();
    const title = (f[8] || '').trim();
    if (!title || title === 'N/A') return;            // no window => background process
    if (APP_SVC_USER.test(user)) return;              // system/service account, not a user app
    if (APP_DENY.has(image.toLowerCase())) return;
    const base = image.replace(/\.exe$/i, '').toLowerCase();
    if (APP_BG_PATTERN.test(base)) return;            // tray/helper/background utility
    let name = APP_NAME_MAP[base];
    if (name === '') return;
    if (!name) name = image.replace(/\.exe$/i, '');   // unknown app: show the exe name
    if (seen.has(name)) return;
    seen.add(name);
    apps.push(name);
  });
  return apps.slice(0, 25);
}

async function windowsFromCapturer() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    const seen = new Set(), names = [];
    for (const s of sources) {
      const name = (s.name || '').trim();
      if (!name || name === 'Virtual Office' || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  } catch (e) { return []; }
}

let cachedWindows = null;
let lastWindowsFetch = 0;

ipcMain.handle('get-open-windows', async () => {
  const now = Date.now();
  if (cachedWindows && (now - lastWindowsFetch < 60000)) {
    return cachedWindows;
  }
  
  let apps = [];
  if (process.platform === 'win32') {
    const out = await new Promise((resolve) => {
      const psCmd = "Get-Process | Where-Object {$_.MainWindowTitle} | ForEach-Object { $_.Name + ':::' + $_.MainWindowTitle }";
      const encoded = Buffer.from(psCmd, 'utf-16le').toString('base64');
      const cmd = `powershell -NoProfile -EncodedCommand ${encoded}`;
      exec(cmd, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });
    
    if (out) {
      apps = appsFromPowershell(out);
    } else {
      const outTasklist = await new Promise((resolve) => {
        exec('tasklist /v /fo csv /nh', { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout) => resolve(err ? null : stdout));
      });
      if (outTasklist) {
        apps = appsFromTasklist(outTasklist);
      }
    }
  } else {
    apps = await windowsFromCapturer();
  }
  
  cachedWindows = apps;
  lastWindowsFetch = now;
  return apps;
});

// --- Remote-control input injection ----------------------------------------
// Lazily loads a native input library (@nut-tree-fork/nut-js). Until that is
// installed the handler logs once and no-ops, so the app runs without it.
let nut = null;
let nutChecked = false;
let nutWarned = false;

function getNut() {
  if (nutChecked) return nut;
  nutChecked = true;
  try {
    nut = require('@nut-tree-fork/nut-js');
    nut.mouse.config.autoDelayMs = 0;
    nut.keyboard.config.autoDelayMs = 0;
  } catch (e) {
    nut = null;
  }
  return nut;
}

// Maps a few non-printable keys to nut-js Key enum names. Printable characters
// are typed directly; anything unmapped is ignored.
const SPECIAL_KEYS = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Control: 'LeftControl', Shift: 'LeftShift', Alt: 'LeftAlt', Meta: 'LeftSuper'
};

ipcMain.handle('inject-input', async (event, input) => {
  const n = getNut();
  if (!n) {
    if (!nutWarned) {
      nutWarned = true;
      console.warn('[control] @nut-tree-fork/nut-js not installed — remote control is inert. Run: npm install @nut-tree-fork/nut-js');
    }
    return false;
  }

  try {
    const { mouse, keyboard, Point, Button, Key, screen } = n;

    if (input.type === 'move' || input.type === 'down' || input.type === 'up') {
      const w = await screen.width();
      const h = await screen.height();
      const x = Math.round(Math.min(Math.max(input.x, 0), 1) * w);
      const y = Math.round(Math.min(Math.max(input.y, 0), 1) * h);
      await mouse.setPosition(new Point(x, y));

      const btn = input.button === 2 ? Button.RIGHT : input.button === 1 ? Button.MIDDLE : Button.LEFT;
      if (input.type === 'down') await mouse.pressButton(btn);
      if (input.type === 'up') await mouse.releaseButton(btn);
    } else if (input.type === 'scroll') {
      if (input.dy < 0) await mouse.scrollUp(Math.abs(Math.round(input.dy)));
      else if (input.dy > 0) await mouse.scrollDown(Math.round(input.dy));
    } else if (input.type === 'keydown') {
      const special = SPECIAL_KEYS[input.key];
      if (special && Key[special] !== undefined) {
        await keyboard.pressKey(Key[special]);
        await keyboard.releaseKey(Key[special]);
      } else if (input.key && input.key.length === 1) {
        await keyboard.type(input.key);
      }
    }
    return true;
  } catch (e) {
    console.error('[control] injection failed:', e);
    return false;
  }
});

ipcMain.handle('has-native-control-support', () => {
  return getNut() !== null;
});

// --- Pop-out chat window (always-on-top, Google Meet style) -----------------
function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    return;
  }
  const { screen } = require('electron');
  const work = screen.getPrimaryDisplay().workAreaSize;
  const w = 340, h = 460;
  miniWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.max(work.width - w - 20, 0),
    y: Math.max(work.height - h - 20, 0),
    frame: false,
    resizable: true,
    minWidth: 260,
    minHeight: 320,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#0f111a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  });
  // Float above other apps, including fullscreen ones (like a Meet PiP).
  miniWindow.setAlwaysOnTop(true, 'screen-saver');
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWindow.loadURL(`${BASE_URL}/mini.html`);
  miniWindow.on('closed', () => { miniWindow = null; });
}

ipcMain.handle('open-mini-chat', () => { createMiniWindow(); return true; });
ipcMain.handle('close-mini-chat', () => {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
  return true;
});
ipcMain.handle('show-main-window', () => { showMainWindow(); return true; });

// IPC handlers for persistent config.
// The saved login token is encrypted with the OS keychain via safeStorage so
// it can't be read off disk as plaintext. The token persists across restarts
// (auto-login) until the user signs out, which deletes the file.
const getConfigPath = () => path.join(app.getPath('userData'), 'vo_config.json');

ipcMain.handle('get-config', () => {
  let configData = {};
  let changed = false;
  try {
    if (fs.existsSync(getConfigPath())) {
      const raw = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
      if (raw && raw.enc && safeStorage.isEncryptionAvailable()) {
        configData = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      } else if (raw && raw.plain) {
        configData = JSON.parse(raw.plain);
      } else {
        configData = raw || {};
        if (configData.token && configData.tokenIsEncrypted && safeStorage.isEncryptionAvailable()) {
          try {
            configData.token = safeStorage.decryptString(Buffer.from(configData.token, 'base64'));
          } catch (e) {
            console.error('[config] Failed to decrypt token:', e);
          }
        }
      }
    }
  } catch (e) {
    configData = {};
  }
  
  // Ensure unique device ID exists (generated once and persisted)
  if (!configData.deviceId) {
    const crypto = require('crypto');
    configData.deviceId = crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Math.random().toString(36).substr(2, 9);
    changed = true;
  }

  if (changed) {
    saveConfigHybrid(configData);
  }
  
  const configStore = require('./backend/config-store');
  const conf = configStore.readConfig();
  configData.wasUnexpectedExit = (conf.gracefulExit === false);
  return configData;
});

function saveConfigHybrid(data) {
  try {
    const dataToSave = { ...data };
    if (dataToSave.token && safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        dataToSave.token = safeStorage.encryptString(dataToSave.token).toString('base64');
        dataToSave.tokenIsEncrypted = true;
      } catch (e) {
        console.error('[config] Failed to encrypt token:', e);
      }
    }
    fs.writeFileSync(getConfigPath(), JSON.stringify(dataToSave, null, 2));
  } catch (e) {
    fs.writeFileSync(getConfigPath(), JSON.stringify({ plain: JSON.stringify(data) }));
  }
}

ipcMain.handle('set-config', (event, data) => {
  saveConfigHybrid(data);

  // Apply autostart settings dynamically when saved
  if (data && data.appAutostart !== undefined) {
    applyAutostartSettings(data.appAutostart !== false);
  }
  return true;
});

ipcMain.handle('clear-config', () => {
  try {
    fs.unlinkSync(getConfigPath());
  } catch (e) {}
  return true;
});

const os = require('os');
function getCPUUsage() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return { idle: 0, total: 0 };
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

let lastCpuSample = getCPUUsage();
function getCpuPercentage() {
  const current = getCPUUsage();
  const idleDiff = current.idle - lastCpuSample.idle;
  const totalDiff = current.total - lastCpuSample.total;
  lastCpuSample = current;
  if (totalDiff === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(100 - (100 * idleDiff / totalDiff))));
}

ipcMain.handle('get-client-stats', async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const systemRamUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const appMemoryMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const cpuUsage = getCpuPercentage();
  const osType = `${os.type()} ${os.arch()} ${os.release()}`;
  const appVer = app.getVersion();

  return {
    cpu: cpuUsage,
    ram: systemRamUsage,
    appRam: appMemoryMb,
    os: osType,
    version: appVer
  };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'frontend/assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Keep timers/socket running at full rate when the window is hidden to the
      // tray, so the user stays "online" and still receives messages/calls.
      backgroundThrottling: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f111a',
    show: false // Wait until ready-to-show
  });

  // Load only once we know the backend's real port (it may have fallen back
  // from a busy 3000). If it isn't ready yet, the startServer callback loads it.
  if (serverReady) mainWindow.loadURL(BASE_URL);

  const { initializeUpdater } = require('./updater');
  initializeUpdater(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      console.log('Started at login, keeping hidden in tray.');
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    let minimizeToTray = true;
    try {
      const configPath = path.join(app.getPath('userData'), 'vo_config.json');
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        let configData = {};
        if (raw && raw.enc && safeStorage && safeStorage.isEncryptionAvailable()) {
          configData = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
        } else if (raw && raw.plain) {
          configData = JSON.parse(raw.plain);
        } else {
          configData = raw || {};
        }
        if (configData.appTray === false) minimizeToTray = false;
      }
    } catch (e) {
      minimizeToTray = true;
    }

    if (!app.isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

// Build a tray icon, falling back to the office artwork (downscaled) when the
// dedicated icon.png is absent — otherwise there'd be no way to reopen the app
// after it's been closed to the background.
function trayImage() {
  const candidates = [
    path.join(__dirname, 'frontend/assets/icon.png'),
    path.join(__dirname, 'frontend/assets/office.png')
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
    } catch (e) { /* try next */ }
  }
  return null;
}

function createTray() {
  try {
    const img = trayImage();
    tray = new Tray(img || nativeImage.createEmpty());
  } catch (e) {
    tray = null;
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Virtual Office', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { requestQuit(); } }
  ]);
  tray.setToolTip('Virtual Office — running in the background');
  tray.setContextMenu(contextMenu);
  tray.on('click', showMainWindow);        // single left-click (Windows habit)
  tray.on('double-click', showMainWindow);
}

app.whenReady().then(() => {
  // Route getDisplayMedia() to the source the user picked in our custom picker.
  // This uses Electron's native capture path, which renders correctly on
  // Wayland/PipeWire (the old chromeMediaSourceId path produced black frames).
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        const chosen = sources.find(s => s.id === pendingShareSourceId) || sources[0];
        // Capture system/loopback audio alongside the screen on Windows so
        // shared videos/calls are heard by viewers. Other platforms: video only.
        const audio = process.platform === 'win32' ? 'loopback' : false;
        callback(chosen ? { video: chosen, audio } : {});
      }).catch(() => callback({}));
    });
  }

  createWindow();
  createTray();

  // Fresh launch: clear any leftover stop intent, then arm the persistence
  // watchdog so a force-kill (Task Manager / crash) relaunches us after ~1s.
  clearStopFlag();
  startWatchdog();
  ensureKeepAliveTask();
  ensureLinuxKeepAliveTask();

  // Read config and apply autostart (runs safely after app ready when safeStorage is active)
  try {
    const configPath = path.join(app.getPath('userData'), 'vo_config.json');
    let configData = {};
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (raw && raw.enc && safeStorage && safeStorage.isEncryptionAvailable()) {
        configData = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc, 'base64')));
      } else if (raw && raw.plain) {
        configData = JSON.parse(raw.plain);
      } else {
        configData = raw || {};
        if (configData.token && configData.tokenIsEncrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
          try {
            configData.token = safeStorage.decryptString(Buffer.from(configData.token, 'base64'));
          } catch (e) {
            console.error('[config] Failed to decrypt token on autostart check:', e);
          }
        }
      }
    }
    applyAutostartSettings(configData.appAutostart !== false);
  } catch (e) {
    applyAutostartSettings(true); // default to true
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Launch automatically when the user logs into Windows/macOS (if configured).
function applyAutostartSettings(enabled) {
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
    try {
      if (app.isPackaged) {
        app.setLoginItemSettings({
          openAtLogin: !!enabled,
          args: ['--hidden']
        });
      } else {
        app.setLoginItemSettings({
          openAtLogin: !!enabled,
          path: process.execPath,
          args: [path.resolve(__dirname), '--hidden']
        });
      }
      console.log(`[autostart] set openAtLogin to ${!!enabled}`);
    } catch (e) {
      console.error('[autostart] failed to set login settings:', e);
    }
  }
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for notifications
ipcMain.on('show-notification', (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body, silent: false }).show();
    }
  } catch (e) {
    console.error('[notify] failed to show notification:', e);
  }
});

ipcMain.on('get-app-path', (event) => {
  event.returnValue = app.getAppPath();
});
