const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (data) => ipcRenderer.invoke('set-config', data),
  clearConfig: () => ipcRenderer.invoke('clear-config'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setShareSource: (id) => ipcRenderer.invoke('set-share-source', id),
  getOpenWindows: () => ipcRenderer.invoke('get-open-windows'),
  injectInput: (input) => ipcRenderer.invoke('inject-input', input),
  // Pop-out (always-on-top) chat window.
  openMiniChat: () => ipcRenderer.invoke('open-mini-chat'),
  closeMiniChat: () => ipcRenderer.invoke('close-mini-chat'),
  showMainFromMini: () => ipcRenderer.invoke('show-main-window'),
  authenticateHeadquarters: (username, password, hq) => ipcRenderer.invoke('authenticate-headquarters', { username, password, hq }),
  clearDesktopAuth: () => ipcRenderer.invoke('clear-desktop-auth'),
  turnOffVirtualOffice: () => ipcRenderer.invoke('turn-off-v-office'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdaterEvent: (callback) => {
    ipcRenderer.removeAllListeners('updater-event');
    ipcRenderer.on('updater-event', (event, data) => callback(data));
  },
  getClientStats: () => ipcRenderer.invoke('get-client-stats'),
  hasNativeControlSupport: () => ipcRenderer.invoke('has-native-control-support')
});
