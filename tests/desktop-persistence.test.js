const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('desktop persistence stays at tray, autostart, and app-owned watchdog scope', () => {
  assert.match(mainSource, /function startWatchdog\(\)/);
  assert.match(mainSource, /stopRequested\(\).*intentMarker/s);
  assert.match(mainSource, /mainWindow\.on\('close',[\s\S]*?event\.preventDefault\(\);[\s\S]*?mainWindow\.hide\(\)/);

  assert.doesNotMatch(mainSource, /ensureKeepAliveTask|ensureLinuxKeepAliveTask|writeRelauncher|writeKeepAliveXml/);
  assert.doesNotMatch(mainSource, /\['\/Create', '\/TN', 'VirtualOfficeKeepAlive'/);
  assert.doesNotMatch(mainSource, /<TimeTrigger>|PT1M|while true; do|pgrep -f/);
});

test('legacy supervisors are only removed and never recreated', () => {
  assert.match(mainSource, /cleanupLegacyExternalSupervisors\(\)/);
  assert.match(mainSource, /\['\/Delete', '\/TN', 'VirtualOfficeKeepAlive', '\/F'\]/);
  assert.match(mainSource, /vo-relauncher\.vbs/);
  assert.match(mainSource, /vo-keepalive\.xml/);
  assert.match(mainSource, /vo-relauncher\.sh/);
  assert.ok(
    mainSource.indexOf('await cleanupLegacyExternalSupervisors();') <
      mainSource.indexOf('if (startHidden && hasIntentionalShutdown())'),
    'legacy cleanup must run before an intentional hidden launch exits',
  );
});

test('autostart combines the saved preference with intentional shutdown state', () => {
  assert.match(
    mainSource,
    /const shouldAutostart = configuredAutostartEnabled && !hasIntentionalShutdown\(\);/,
  );
  assert.match(mainSource, /openAtLogin: shouldAutostart/);
  assert.doesNotMatch(mainSource, /configuredAutostartEnabled\s*=|enabled\s*=\s*!hasIntentionalShutdown/);
});

test('authorized shutdown stops recovery while visible manual launch rearms it', () => {
  const shutdown = mainSource.indexOf("ipcMain.handle('turn-off-v-office'");
  const markerWrite = mainSource.indexOf('fs.writeFileSync(intentionalShutdownPath()', shutdown);
  const stopWrite = mainSource.indexOf('writeStopFlag();', markerWrite);
  const disableAutostart = mainSource.indexOf('applyAutostartSettings(false);', stopWrite);
  const quit = mainSource.indexOf('setTimeout(() => app.quit()', disableAutostart);
  assert.ok(shutdown >= 0 && markerWrite > shutdown && stopWrite > markerWrite && disableAutostart > stopWrite && quit > disableAutostart);

  const ready = mainSource.indexOf('app.whenReady().then(async () =>');
  const hiddenGuard = mainSource.indexOf('if (startHidden && hasIntentionalShutdown())', ready);
  const manualClear = mainSource.indexOf('if (!startHidden) clearIntentionalShutdown();', hiddenGuard);
  const clearStop = mainSource.indexOf('clearStopFlag();', manualClear);
  const watchdog = mainSource.indexOf('startWatchdog();', clearStop);
  assert.ok(ready >= 0 && hiddenGuard > ready && manualClear > hiddenGuard && clearStop > manualClear && watchdog > clearStop);
});
