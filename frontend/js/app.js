let currentUser = null;
let token = null;
let socket = null;
let users = [];
// Default to the shared Render HQ so everyone lands on the same server. Can be
// overridden per-login via the "Headquarters Address" field; saved after login.
let API_URL = 'https://virtual-office-hq-test.onrender.com';

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const serverUrlInput = document.getElementById('server-url');

let previousSessionUnexpected = false;
let currentDeviceId = '';
let currentSessionId = null;

// Early boot config fetch
if (window.electronAPI) {
  window.electronAPI.getConfig().then(config => {
    if (config) {
      currentDeviceId = config.deviceId || '';
      if (config.wasUnexpectedExit) {
        previousSessionUnexpected = true;
      }
    }
  }).catch(() => {});
}

// Auto-login check
async function checkAutoLogin() {
  if (window.electronAPI) {
    const config = await window.electronAPI.getConfig();
    if (config) {
      currentDeviceId = config.deviceId || '';
      if (config.wasUnexpectedExit) {
        previousSessionUnexpected = true;
      }
    }
    if (config && config.token && config.user && config.serverUrl) {
      token = config.token;
      currentUser = config.user;
      API_URL = config.serverUrl;
      authScreen.classList.add('hidden');
      dashboardScreen.classList.remove('hidden');
      initApp();
      return;
    }
  }
}
checkAutoLogin();

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  API_URL = serverUrlInput.value.replace(/\/$/, ''); // Remove trailing slash
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    let data;
    if (window.electronAPI?.authenticateHeadquarters) {
      data = await window.electronAPI.authenticateHeadquarters(username, password, API_URL);
      if (!data.success) throw new Error(data.error || 'Invalid credentials');
    } else {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }

    token = data.token;
    currentUser = data.user;
    
    if (window.electronAPI) {
      const config = await window.electronAPI.getConfig();
      if (config) currentDeviceId = config.deviceId || '';
      await window.electronAPI.setConfig({ token, user: currentUser, serverUrl: API_URL });
    }
    
    // Switch screen
    authScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    
    // Init app
    initApp();
  } catch (err) {
    loginError.textContent = `Could not connect to HQ: ${err.message}`;
  }
});

let appInitialized = false;
async function initApp() {
  // Guard against running twice (e.g. a double-clicked login, or auto-login
  // racing a manual login). Binding the chat/socket handlers twice is what made
  // a single typed message send — and render — twice.
  if (appInitialized) return;
  appInitialized = true;

  // Profile card (name set as text to avoid injection)
  const prof = document.getElementById('my-profile');
  prof.innerHTML = `<img class="avatar" alt="Avatar"><div><div class="pname"></div><div class="pver">Team HQ · v1.0.0</div></div>`;
  prof.querySelector('img').src = currentUser.avatar || '';
  prof.querySelector('.pname').textContent = currentUser.username;

  startClock();

  // Load and apply theme and device settings before connecting socket
  getAppConfig().then(config => {
    applyAppearanceTheme(config.themeMode || 'dark', localStorage.getItem('vo_theme') || 'indigo');
    if (window.callControl) {
      window.callControl.setDevicesState(config.audioInput, config.videoInput, config.audioOutput);
      if (config.audioOutput) window.callControl.applySpeaker(config.audioOutput);
      if (config.audioVolume !== undefined) window.callControl.applyVolume(config.audioVolume);
    }
  });

  let hasControl = false;
  if (window.electronAPI && typeof window.electronAPI.hasNativeControlSupport === 'function') {
    try {
      hasControl = await window.electronAPI.hasNativeControlSupport();
    } catch (e) {}
  }

  // Connect Socket
  socket = io(API_URL, {
    auth: { 
      token,
      deviceId: currentDeviceId || 'browser_client',
      appVersion: '1.0.0',
      sessionId: currentSessionId || null,
      hasControlSupport: hasControl
    }
  });

  socket.on('session_created', (data) => {
    currentSessionId = data.sessionId;
    if (socket && socket.auth) {
      socket.auth.sessionId = data.sessionId;
    }
    console.log('[presence] Session registered:', currentSessionId);
  });

  const saveProfileBtn = document.getElementById('settings-save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
      const username = document.getElementById('settings-profile-username').value;
      const designation = document.getElementById('settings-profile-designation').value;
      const avatar = document.getElementById('settings-profile-avatar').value;
      const password = document.getElementById('settings-profile-password').value;

      try {
        const res = await fetch(`${API_URL}/api/update-profile`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ username, designation, avatar, password })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Failed to update profile.');
          return;
        }
        
        triggerNotification('Success', 'Profile updated successfully!', 'activity');
        document.getElementById('settings-profile-password').value = '';
        
        currentUser = data.user;
        
        if (window.electronAPI && typeof window.electronAPI.getConfig === 'function') {
          try {
            const currentConfig = await window.electronAPI.getConfig();
            currentConfig.user = data.user;
            await window.electronAPI.setConfig(currentConfig);
          } catch (e) {
            console.error('Failed to save updated config locally:', e);
          }
        }

        if (socket) {
          socket.emit('profile_update', {
            id: currentUser.id,
            username: currentUser.username,
            avatar: currentUser.avatar,
            designation: currentUser.designation
          });
        }
      } catch (err) {
        console.error(err);
        alert('Network error updating profile.');
      }
    };
  }

  let currentPing = 0;
  let heartbeatInterval = null;
  function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Listen for roundtrip ack to calculate latency
    socket.off('heartbeat_ack');
    socket.on('heartbeat_ack', (data) => {
      if (data && data.timestamp) {
        currentPing = Date.now() - data.timestamp;
      }
    });

    const sendHeartbeat = async () => {
      if (socket && socket.connected && currentSessionId) {
        let stats = null;
        if (window.electronAPI && window.electronAPI.getClientStats) {
          try {
            const telemetry = await window.electronAPI.getClientStats();
            let netQuality = 'Excellent';
            if (currentPing > 600) netQuality = 'Poor';
            else if (currentPing > 300) netQuality = 'Fair';
            else if (currentPing > 100) netQuality = 'Good';

            stats = {
              cpu: telemetry.cpu,
              ram: telemetry.ram,
              os: telemetry.os,
              network_quality: netQuality
            };
          } catch (e) {
            console.error('Telemetry gather error:', e);
          }
        }

        socket.emit('heartbeat', { 
          userId: currentUser.id,
          sessionId: currentSessionId,
          deviceId: currentDeviceId || 'browser_client',
          appVersion: '1.0.0',
          timestamp: Date.now(),
          stats: stats
        });
      }
    };
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, 30000);
  }

  socket.on('connect', async () => {
    console.log('Connected to server');
    
    if (previousSessionUnexpected) {
      previousSessionUnexpected = false;
      socket.emit('report_unexpected_termination', { 
        userId: currentUser.id,
        deviceId: currentDeviceId || 'browser_client',
        appVersion: '1.0.0'
      });
    }
    
    startHeartbeat();
    setServerStatus(true);
    await fetchUsers();
    reportApps(); // Report apps immediately on connection
    // We just connected, so we're online — fix any stale 'offline' from a race
    // where /api/users was read before the server marked us online.
    const me = users.find(u => String(u.id) === String(currentUser.id));
    if (me && me.status === 'offline') { me.status = 'online'; renderWorkstations(); }
    renderConvos();
    openConversation(currentConversation || 'team');

    // Trigger features re-sync (tasks, whiteboard, projects, etc.)
    if (window.features && typeof window.features.reload === 'function') {
      try {
        window.features.reload();
      } catch (e) {
        console.error('Failed to reload features:', e);
      }
    }
    // Pull the server's ICE/TURN config so calls use a real TURN if configured.
    try {
      const r = await fetch(`${API_URL}/api/rtc-config`, { headers: authHeaders() });
      if (r.ok) window.__rtcConfig = await r.json();
    } catch (e) { /* fall back to built-in ICE */ }
    // Load the shared office backdrop + the auto-by-presence map.
    try {
      const r = await fetch(`${API_URL}/api/office-image`, { headers: authHeaders() });
      if (r.ok) { manualBackdrop = (await r.json()).url || null; }
    } catch (e) { /* keep default */ }
    try {
      const r = await fetch(`${API_URL}/api/auto-backdrop`, { headers: authHeaders() });
      if (r.ok) { autoBackdropMap = (await r.json()).map || {}; }
    } catch (e) { /* none */ }
    refreshBackdrop();
    // Announce the tab we're on (default office) so teammates see it right away.
    const active = document.querySelector('.nav-item.active');
    const view = active ? active.getAttribute('data-view') : 'office';
    socket.emit('activity_update', { view, label: VIEW_LABELS[view] || view });
  });

  socket.on('disconnect', () => {
    setServerStatus(false);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });
  
  socket.on('connect_error', () => {
    setServerStatus(false);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });

  socket.on('user_permission_changed', () => { loadShutdownPermission(); if (currentUser?.role === 'admin') loadShutdownAdminList(); });

  socket.on('user_status_change', (data) => {
    updateUserStatus(data);
    // Only log online/offline transitions to the feed; no toast (it was spammy).
    const isOnline = data.status === 'online';
    if (data.status === 'online' || data.status === 'offline') {
      const text = `${getUserName(data.id)} is now ${data.status}`;
      addActivity(text);
      triggerNotification('Presence Update', text, 'activity');
    }
  });

  socket.on('control_support_snapshot', (list) => {
    (list || []).forEach(item => {
      const u = users.find(x => String(x.id) === String(item.id));
      if (u) u.controlSupported = item.supported;
    });
    if (window.webrtc && typeof window.webrtc.updateControlButtons === 'function') {
      window.webrtc.updateControlButtons();
    }
  });

  socket.on('user_control_support', (data) => {
    const u = users.find(x => String(x.id) === String(data.id));
    if (u) u.controlSupported = data.supported;
    if (window.webrtc && typeof window.webrtc.updateControlButtons === 'function') {
      window.webrtc.updateControlButtons();
    }
  });

  socket.on('user_profile_updated', (data) => {
    const u = users.find(x => String(x.id) === String(data.id));
    if (u) {
      u.username = data.username;
      u.avatar = data.avatar;
      u.designation = data.designation;
    }
    
    if (currentUser && String(currentUser.id) === String(data.id)) {
      currentUser.username = data.username;
      currentUser.avatar = data.avatar;
      currentUser.designation = data.designation;
      const prof = document.getElementById('my-profile');
      if (prof) {
        prof.querySelector('img').src = data.avatar || '';
        prof.querySelector('.pname').textContent = data.username;
      }
    }
    
    renderTeam();
    renderWorkstations();
    if (window.office3d) window.office3d.update(users);
  });

  socket.on('new_message', (msg) => {
    const convo = msgConversation(msg);
    if (convo === 'team') renderDockMessage(msg);      // dock mirrors team only
    if (currentConversation === convo) appendChatMessage(msg);
    else markConvoUnread(convo);

    if (msg.sender_id === currentUser.id) return;
    
    const isDM = msg.recipient_id === currentUser.id;
    const mentioned = new RegExp(`(^|\\W)@${currentUser.username}\\b`, 'i').test(msg.content || '');
    const unfocused = !document.hasFocus();
    
    if (isDM || mentioned || unfocused) {
      const title = isDM ? `DM from ${msg.username}` : mentioned ? `${msg.username} mentioned you` : 'New Message';
      const category = (isDM || mentioned) ? 'mentions' : 'chat';
      triggerNotification(title, `${msg.username}: ${msg.content}`, category);
    }
  });

  // Live "what is everyone working on" presence.
  socket.on('activity_snapshot', (list) => {
    (list || []).forEach(a => {
      const u = users.find(x => String(x.id) === String(a.id));
      if (u) { u.current_view = a.view; u.current_label = a.label; }
    });
    renderTeam();
    renderWorkstations();
  });
  socket.on('user_activity', (data) => {
    const u = users.find(x => String(x.id) === String(data.id));
    if (u) { u.current_view = data.view; u.current_label = data.label; }
    renderTeam();
    const tabEl = document.getElementById(`ws-tab-${data.id}`);
    if (tabEl) tabEl.textContent = data.view ? `🗂 ${data.label || data.view}` : '';
    refreshUserModal(data.id);
  });

  // Open desktop apps/windows per user (shown on their profile card).
  socket.on('apps_snapshot', (list) => {
    (list || []).forEach(a => { const u = users.find(x => String(x.id) === String(a.id)); if (u) u.apps = a.apps; });
    refreshUserModal(userModalId);
  });
  socket.on('user_apps', (data) => {
    const u = users.find(x => String(x.id) === String(data.id));
    if (u) u.apps = data.apps;
    refreshUserModal(data.id);
  });

  // Start reporting our own open apps/windows (desktop app only).
  startAppsReporting();

  // Shared office backdrop changed by a teammate.
  socket.on('office_image_changed', (data) => setManualBackdrop(data && data.url));
  // Auto-backdrop mapping changed (an image assigned/cleared for a combo).
  socket.on('auto_backdrop_changed', (data) => {
    if (!data) return;
    if (data.image) autoBackdropMap[data.key] = data.image;
    else delete autoBackdropMap[data.key];
    refreshBackdrop();
  });

  // Navigation + quick actions share one view switcher.
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.getAttribute('data-view')));
  });
  const qa = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  qa('qa-chat', () => showView('chat'));
  qa('qa-whiteboard', () => showView('whiteboard'));
  qa('qa-project', () => showView('projects'));
  qa('qa-meeting', () => { if (window.startCall) window.startCall(); });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (window.electronAPI) {
      await window.electronAPI.clearDesktopAuth?.();
      await window.electronAPI.clearConfig();
    } else {
      localStorage.removeItem('virtual_office_token');
      localStorage.removeItem('virtual_office_user');
    }
    socket.disconnect();
    location.reload();
  });

  // Chat — sends to the open conversation (team, or a DM recipient).
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    const recipient_id = currentConversation === 'team' ? null : currentConversation;
    socket.emit('send_message', { content: input.value, recipient_id });
    input.value = '';
  });

  // File Upload — from the Files view button or the chat 📎; the file is posted
  // as a message into whatever conversation is currently open (team or a DM).
  const fileInput = document.getElementById('file-input');
  const pickFile = () => fileInput.click();
  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) uploadBtn.addEventListener('click', pickFile);
  const chatAttach = document.getElementById('chat-attach');
  if (chatAttach) chatAttach.addEventListener('click', pickFile);

  // Profile / change password (all users).
  setupProfile();

  // Teammate call card, docked chat, and theme picker.
  setupTeamCard();
  setupChatDock();
  setupBackdrop();
  setupAutoBackdrop();

  // Feature pages (tasks, projects, calendar, whiteboard, integrations).
  if (window.features) window.features.init();

  // Admin-only settings panel.
  if (currentUser.role === 'admin') {
    setupSettings();
  }
}

// --- Teammate profile card: call / re-call ----------------------------------
function setupTeamCard() {
  const modal = document.getElementById('user-modal');
  document.getElementById('user-card-close').onclick = () => { userModalId = null; modal.classList.add('hidden'); };
  document.getElementById('user-card-call').onclick = () => {
    if (userModalId == null) return;
    const target = userModalId;
    modal.classList.add('hidden');
    if (window.callUser) window.callUser(target); // ring just this person (also used for re-call)
    userModalId = null;
  };
  document.getElementById('user-card-dm').onclick = () => {
    if (userModalId == null) return;
    const target = userModalId;
    modal.classList.add('hidden');
    userModalId = null;
    showView('chat');
    openConversation(target);
  };
}

// --- Docked bottom chat ------------------------------------------------------
function setupChatDock() {
  const dock = document.getElementById('chat-dock');
  dock.classList.remove('hidden'); // reveal once logged in
  const title = dock.querySelector('.cd-title');
  const minBtn = document.getElementById('chat-dock-min');
  const closeBtn = document.getElementById('chat-dock-close');
  const bubble = document.getElementById('chat-bubble');
  const badge = document.getElementById('chat-bubble-badge');
  const form = document.getElementById('chat-dock-form');
  const input = document.getElementById('chat-dock-input');

  const scrollBottom = () => { const m = document.getElementById('chat-dock-messages'); if (m) m.scrollTop = m.scrollHeight; };

  const setCollapsed = (collapsed) => {
    dock.classList.toggle('collapsed', collapsed);
    minBtn.textContent = collapsed ? '▴' : '▾';
    if (!collapsed) { dock.classList.remove('unread'); scrollBottom(); }
  };
  const openDock = () => {
    dock.classList.remove('hidden');
    bubble.classList.add('hidden');
    badge.classList.add('hidden'); badge.textContent = '0';
    setCollapsed(false);
    input.focus();
  };
  // Close hides only the popup; the socket stays connected so we remain online.
  const closeDock = () => {
    dock.classList.add('hidden');
    bubble.classList.remove('hidden');
  };

  const toggleCollapse = () => setCollapsed(!dock.classList.contains('collapsed'));
  title.onclick = toggleCollapse;
  minBtn.onclick = (e) => { e.stopPropagation(); toggleCollapse(); };
  closeBtn.onclick = (e) => { e.stopPropagation(); closeDock(); };
  bubble.onclick = openDock;

  // Pop-out into a standalone always-on-top window (desktop app only).
  const popBtn = document.getElementById('chat-dock-pop');
  if (popBtn && window.electronAPI && window.electronAPI.openMiniChat) {
    popBtn.classList.remove('hidden');
    popBtn.onclick = (e) => { e.stopPropagation(); window.electronAPI.openMiniChat(); };
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim() || !socket) return;
    socket.emit('send_message', { content: input.value });
    input.value = '';
  });

  // Called by renderDockMessage when a message arrives while the popup is closed.
  window.__chatBubbleBump = () => {
    if (!dock.classList.contains('hidden')) return; // only matters when closed
    badge.classList.remove('hidden');
    badge.textContent = String((parseInt(badge.textContent, 10) || 0) + 1);
  };
}

// --- Shared office backdrop --------------------------------------------------
// Precedence: an auto image for the current "who's online" combo wins; else the
// manual shared backdrop; else the default artwork.
let manualBackdrop = null;     // office_image setting
let autoBackdropMap = {};      // comboKey -> image data URL (admin-uploaded, via DB)

// Built-in auto-backdrops shipped with the app (committed assets, so they always
// work with no database). Keyed by the sorted online usernames. Admin-uploaded
// images override these when present.
const STATIC_AUTO_BACKDROPS = {
  '': 'assets/backdrops/none.jpg',
  'Arjun': 'assets/backdrops/arjun.jpg',
  'Aviral': 'assets/backdrops/aviral.jpg',
  'Pradhuman': 'assets/backdrops/pradhuman.jpg',
  'Arjun|Aviral': 'assets/backdrops/arjun-aviral.jpg',
  'Arjun|Pradhuman': 'assets/backdrops/arjun-pradhuman.jpg',
  'Aviral|Pradhuman': 'assets/backdrops/aviral-pradhuman.jpg',
  'Arjun|Aviral|Pradhuman': 'assets/backdrops/all.jpg'
};

// Sorted online usernames joined by '|' (empty = nobody online).
function currentOnlineKey() {
  return users.filter(u => u.status === 'online')
    .map(u => u.username).sort().join('|');
}
function refreshBackdrop() {
  const img = document.getElementById('office-image');
  if (!img) return;
  const key = currentOnlineKey();
  const auto = autoBackdropMap[key] || STATIC_AUTO_BACKDROPS[key];
  let next = auto || manualBackdrop || 'assets/office.png';
  if (next.startsWith('/uploads/')) {
    next = `${API_URL}${next}`;
  }
  if (img.getAttribute('src') !== next) img.src = next; // avoid needless reloads/flicker
}
function setManualBackdrop(url) { manualBackdrop = url || null; refreshBackdrop(); }

function setupBackdrop() {
  const changeBtn = document.getElementById('backdrop-change');
  const resetBtn = document.getElementById('backdrop-reset');
  const input = document.getElementById('backdrop-input');
  const status = document.getElementById('backdrop-status');
  if (!changeBtn) return;
  const setS = (m, k) => { if (status) { status.textContent = m; status.className = 'settings-status' + (k ? ' ' + k : ''); } };

  const save = async (url) => {
    const r = await fetch(`${API_URL}/api/office-image`, {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!r.ok) throw new Error('Could not save');
  };

  changeBtn.onclick = () => input.click();
  resetBtn.onclick = async () => {
    setS('Resetting…', '');
    try { await save(''); setS('Reset to the default backdrop.', 'ok'); }
    catch (e) { setS('Failed to reset.', 'err'); }
  };
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setS('Uploading…', '');
    try {
      const fd = new FormData(); fd.append('file', file);
      const up = await fetch(`${API_URL}/api/upload`, { method: 'POST', headers: authHeaders(), body: fd });
      const data = await up.json();
      if (!up.ok) throw new Error(data.error || 'Upload failed');
      const fullUrl = data.url.startsWith('http') ? data.url : `${API_URL}${data.url}`;
      await save(fullUrl);
      setS('Backdrop updated for everyone.', 'ok');
    } catch (err) {
      setS(err.message, 'err');
    } finally {
      input.value = '';
    }
  };
}

// --- Auto-backdrop: assign an image per "who's online" combination ----------
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('could not read image')); };
    img.src = URL.createObjectURL(file);
  });
}

function setupAutoBackdrop() {
  const openBtn = document.getElementById('autobg-open');
  const modal = document.getElementById('autobg-modal');
  const closeBtn = document.getElementById('autobg-close');
  const listEl = document.getElementById('autobg-list');
  const input = document.getElementById('autobg-input');
  if (!openBtn) return;
  let pendingKey = null;

  const subsetsOf = (arr) => { let res = [[]]; for (const x of arr) { const n = res.length; for (let i = 0; i < n; i++) res.push(res[i].concat(x)); } return res; };

  function buildList() {
    const names = users.map(u => u.username).sort();
    listEl.innerHTML = '';
    subsetsOf(names).sort((a, b) => b.length - a.length).forEach(subset => {
      const key = subset.slice().sort().join('|');
      const row = document.createElement('div');
      row.className = 'autobg-row';

      const label = document.createElement('div');
      label.className = 'autobg-label';
      if (subset.length === 0) {
        const chip = document.createElement('span'); chip.className = 'autobg-chip'; chip.textContent = '⚫ Nobody online';
        label.appendChild(chip);
      } else {
        names.forEach(n => {
          const on = subset.includes(n);
          const chip = document.createElement('span');
          chip.className = 'autobg-chip' + (on ? ' on' : '');
          chip.textContent = (on ? '🟢 ' : '⚫ ') + n;
          label.appendChild(chip);
        });
      }

      const thumb = document.createElement('div');
      thumb.className = 'autobg-thumb' + (autoBackdropMap[key] ? '' : ' empty');
      if (autoBackdropMap[key]) {
        let bgUrl = autoBackdropMap[key];
        if (bgUrl.startsWith('/uploads/')) bgUrl = `${API_URL}${bgUrl}`;
        thumb.style.backgroundImage = `url("${bgUrl}")`;
      }

      const actions = document.createElement('div');
      actions.className = 'autobg-row-actions';
      const up = document.createElement('button');
      up.className = 'btn outline'; up.textContent = autoBackdropMap[key] ? 'Replace' : 'Upload';
      up.onclick = () => { pendingKey = key; input.click(); };
      const clr = document.createElement('button');
      clr.className = 'btn outline'; clr.textContent = 'Clear'; clr.disabled = !autoBackdropMap[key];
      clr.onclick = () => saveCombo(key, '');
      actions.append(up, clr);

      row.append(label, thumb, actions);
      listEl.appendChild(row);
    });
  }

  async function saveCombo(key, image) {
    try {
      const r = await fetch(`${API_URL}/api/auto-backdrop`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, image })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'save failed');
      if (image) autoBackdropMap[key] = image; else delete autoBackdropMap[key];
      refreshBackdrop();
      buildList();
    } catch (e) { alert('Could not save backdrop: ' + e.message); }
  }

  input.onchange = async (e) => {
    const file = e.target.files[0];
    input.value = '';
    if (!file || pendingKey == null) return;
    try { await saveCombo(pendingKey, await downscaleImage(file, 1600, 0.82)); }
    catch (err) { alert('Image error: ' + err.message); }
    pendingKey = null;
  };

  openBtn.onclick = () => { buildList(); modal.classList.remove('hidden'); };
  closeBtn.onclick = () => modal.classList.add('hidden');
}

// --- Profile: change password ----------------------------------------------
function setupProfile() {
  const modal = document.getElementById('profile-modal');
  const status = document.getElementById('profile-status');
  const profile = document.getElementById('my-profile');
  const form = document.getElementById('change-password-form');

  const setStatus = (msg, kind) => {
    status.textContent = msg;
    status.className = 'settings-status' + (kind ? ' ' + kind : '');
  };

  profile.addEventListener('click', () => {
    document.getElementById('profile-username').textContent = `Signed in as ${currentUser.username}`;
    form.reset();
    setStatus('', '');
    document.getElementById('status-message').value = currentUser.status_message || '';
    modal.classList.remove('hidden');
  });

  document.getElementById('profile-close').addEventListener('click', () => modal.classList.add('hidden'));

  setupStatusControls();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('cur-pass').value;
    const newPassword = document.getElementById('new-pass').value;
    const confirm = document.getElementById('confirm-pass').value;

    if (newPassword !== confirm) { setStatus('New passwords do not match.', 'err'); return; }
    if (newPassword.length < 6) { setStatus('New password must be at least 6 characters.', 'err'); return; }

    setStatus('Updating...', '');
    try {
      const res = await fetch(`${API_URL}/api/change-password`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setStatus('Password changed successfully.', 'ok');
      form.reset();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  });
}

// Status messages are independent of Online/Offline connection presence.
function setupStatusControls() {
  const saveBtn = document.getElementById('status-save');
  if (saveBtn) saveBtn.onclick = () => {
    const message = document.getElementById('status-message').value.trim();
    currentUser.status_message = message;
    socket?.emit('set_status_message', { message });
  };
}

async function loadShutdownPermission() {
  const section = document.getElementById('turn-off-section');
  if (!section) return;
  section.classList.add('hidden');
  if (!window.electronAPI?.turnOffVirtualOffice || !token) return;
  try {
    const res = await fetch(`${API_URL}/api/me/permissions`, { headers: authHeaders() });
    if (!res.ok) return;
    const grants = await res.json();
    section.classList.toggle('hidden', !grants.can_turn_off_v_office);
  } catch (e) { /* permission unknown: keep the action hidden */ }
}

async function loadShutdownAdminList() {
  const list = document.getElementById('shutdown-permissions-list');
  const status = document.getElementById('shutdown-permissions-status');
  if (!list || currentUser?.role !== 'admin') return;
  try {
    const [usersRes, grantsRes] = await Promise.all([
      fetch(`${API_URL}/api/users`, { headers: authHeaders() }),
      fetch(`${API_URL}/api/admin/user-permissions`, { headers: authHeaders() })
    ]);
    if (!usersRes.ok || !grantsRes.ok) throw new Error('Could not load permissions');
    const people = await usersRes.json();
    const grants = await grantsRes.json();
    const allowed = new Set(grants.filter(g => g.permission_key === 'can_turn_off_v_office').map(g => Number(g.user_id)));
    list.replaceChildren();
    people.forEach(person => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid rgba(255,255,255,.08)';
      const name = document.createElement('span');
      name.textContent = `${person.username} — Can turn off V-Office`;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = allowed.has(Number(person.id));
      toggle.style.width = 'auto';
      toggle.onchange = async () => {
        toggle.disabled = true;
        status.textContent = '';
        try {
          const res = await fetch(`${API_URL}/api/admin/users/${person.id}/permissions/can_turn_off_v_office`, {
            method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ granted: toggle.checked })
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Permission update failed');
          if (Number(person.id) === Number(currentUser.id)) loadShutdownPermission();
        } catch (e) {
          toggle.checked = !toggle.checked;
          status.textContent = e.message;
          status.className = 'settings-status err';
        } finally { toggle.disabled = false; }
      };
      row.append(name, toggle);
      list.appendChild(row);
    });
  } catch (e) {
    status.textContent = e.message;
    status.className = 'settings-status err';
  }
}

function setupTurnOffButton() {
  const button = document.getElementById('turn-off-v-office');
  const status = document.getElementById('turn-off-status');
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = '';
    try {
      const result = await window.electronAPI.turnOffVirtualOffice();
      if (!result.success) throw new Error(result.error || 'Shutdown permission denied');
      if (socket?.connected) {
        try { await socket.timeout(1000).emitWithAck('client_graceful_exit'); } catch (e) {}
        socket.disconnect();
      }
      status.textContent = 'Turning off Virtual Office…';
    } catch (e) {
      status.textContent = e.message;
      status.className = 'settings-status err';
      button.disabled = false;
    }
  };
}

// --- Admin settings (Google Drive & Updates) --------------------------------
// Local configuration helper
async function getAppConfig() {
  if (window.electronAPI) {
    try { return await window.electronAPI.getConfig(); } catch (e) {}
  }
  try {
    const raw = localStorage.getItem('vo_local_config');
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

async function setAppConfig(data) {
  if (window.electronAPI) {
    try { await window.electronAPI.setConfig(data); return true; } catch (e) {}
  }
  try {
    localStorage.setItem('vo_local_config', JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

function applyAppearanceTheme(mode, accentId) {
  if (mode === 'light') {
    document.body.setAttribute('data-theme', 'light');
  } else if (mode === 'dark') {
    document.body.setAttribute('data-theme', accentId === 'light' ? 'indigo' : accentId);
  } else {
    // Auto: check media query
    const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    document.body.setAttribute('data-theme', systemLight ? 'light' : (accentId === 'light' ? 'indigo' : accentId));
  }
}

// Play synthesized alert sound
function playNotificationSound() {
  getAppConfig().then(config => {
    if (config.notifSounds === false) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
      osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.08); // A5 note
      
      const vol = (config.audioVolume !== undefined ? config.audioVolume : 100) / 100;
      gain.gain.setValueAtTime(vol * 0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45);
    } catch (e) {
      console.error('Failed to play synthesized sound:', e);
    }
  });
}

// Trigger alert notification across categories
async function triggerNotification(title, body, category) {
  const config = await getAppConfig();
  
  if (category === 'chat' && config.notifChat === false) return;
  if (category === 'mentions' && config.notifMentions === false) return;
  if (category === 'calls' && config.notifCalls === false) return;
  if (category === 'tasks' && config.notifTasks === false) return;
  if (category === 'activity' && config.notifActivity === false) return;

  if (config.notifSounds !== false) {
    playNotificationSound();
  }

  if (window.electronAPI && window.electronAPI.showNotification) {
    window.electronAPI.showNotification(title, body);
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') new Notification(title, { body });
    });
  }
}
window.triggerNotification = triggerNotification;

// Watch system theme change
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
  const config = await getAppConfig();
  if (config.themeMode === 'auto') {
    applyAppearanceTheme('auto', localStorage.getItem('vo_theme') || 'indigo');
  }
});

let previewStream = null;

// --- Admin settings (Google Drive & Updates) --------------------------------
async function setupSettings() {
  const nav = document.getElementById('settings-nav');
  if (nav) nav.classList.remove('hidden');
  const analyticsNav = document.getElementById('analytics-nav');
  if (analyticsNav) analyticsNav.classList.remove('hidden');

  const status = document.getElementById('settings-status');
  const setStatus = (msg, kind) => {
    status.textContent = msg;
    status.className = 'settings-status' + (kind ? ' ' + kind : '');
  };

  // Local PFP Upload wiring
  const avatarFileInput = document.getElementById('settings-profile-avatar-file');
  const avatarUploadBtn = document.getElementById('settings-profile-avatar-upload-btn');
  const avatarTextInput = document.getElementById('settings-profile-avatar');
  const avatarPreview = document.getElementById('settings-profile-avatar-preview');
  const avatarFileName = document.getElementById('settings-avatar-file-name');

  if (avatarUploadBtn && avatarFileInput) {
    avatarUploadBtn.onclick = () => avatarFileInput.click();
    
    avatarFileInput.onchange = () => {
      const file = avatarFileInput.files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) { // limit to 2MB to keep DB light
          alert('Image size exceeds 2MB limit. Please select a smaller photo.');
          avatarFileInput.value = '';
          return;
        }
        if (avatarFileName) avatarFileName.textContent = file.name;
        
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64Data = e.target.result;
          if (avatarTextInput) avatarTextInput.value = base64Data;
          if (avatarPreview) avatarPreview.src = base64Data;
        };
        reader.readAsDataURL(file);
      }
    };
  }

  if (avatarTextInput && avatarPreview) {
    avatarTextInput.addEventListener('input', () => {
      avatarPreview.src = avatarTextInput.value || 'assets/default-avatar.png';
    });
  }

  // Populate devices
  const micSel = document.getElementById('settings-audio-input');
  const spkSel = document.getElementById('settings-audio-output');
  const camSel = document.getElementById('settings-video-input');
  
  async function populateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind) => {
        if (!sel) return;
        sel.innerHTML = '';
        const filtered = devices.filter(d => d.kind === kind);
        if (filtered.length === 0) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = 'None detected';
          sel.appendChild(o);
          return;
        }
        filtered.forEach((d, i) => {
          const o = document.createElement('option');
          o.value = d.deviceId;
          o.textContent = d.label || `${kind} ${i + 1}`;
          sel.appendChild(o);
        });
      };
      fill(micSel, 'audioinput');
      fill(spkSel, 'audiooutput');
      fill(camSel, 'videoinput');
    } catch (e) {
      console.error('Failed to enumerate devices in settings:', e);
    }
  }

  await populateDevices();
  
  // Camera Live Preview toggle
  const previewVideo = document.getElementById('settings-video-preview');
  const previewPlaceholder = document.getElementById('settings-video-preview-placeholder');
  const previewBtn = document.getElementById('settings-toggle-preview-btn');

  async function toggleCameraPreview() {
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
      previewStream = null;
      if (previewVideo) previewVideo.srcObject = null;
      if (previewPlaceholder) previewPlaceholder.classList.remove('hidden');
      if (previewBtn) previewBtn.textContent = '📷 Toggle Camera Preview';
    } else {
      const camId = camSel ? camSel.value : '';
      const constraints = {
        video: camId ? { deviceId: { exact: camId } } : true
      };
      try {
        previewStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (previewVideo) previewVideo.srcObject = previewStream;
        if (previewPlaceholder) previewPlaceholder.classList.add('hidden');
        if (previewBtn) previewBtn.textContent = '🛑 Stop Camera Preview';
      } catch (err) {
        console.error('Failed to open camera preview:', err);
        alert('Could not open camera preview. Make sure it is not in use.');
      }
    }
  }

  if (previewBtn) {
    previewBtn.onclick = toggleCameraPreview;
  }

  // Sync volume label
  const volInput = document.getElementById('settings-audio-volume');
  const volVal = document.getElementById('audio-volume-val');
  if (volInput && volVal) {
    volInput.addEventListener('input', () => {
      volVal.textContent = volInput.value + '%';
    });
  }

  // Load Settings
  await loadSettings();
  setupTurnOffButton();
  await loadShutdownPermission();
  if (currentUser.role === 'admin') await loadShutdownAdminList();

  // Show admin settings block if user is admin
  const adminSection = document.getElementById('admin-settings-section');
  if (adminSection) {
    if (currentUser.role === 'admin') {
      adminSection.classList.remove('hidden');
    } else {
      adminSection.classList.add('hidden');
    }
  }

  // Save Settings Clicked
  document.getElementById('settings-save').addEventListener('click', async () => {
    setStatus('Saving...', '');
    try {
      const config = await getAppConfig();
      const updated = {
        ...config,
        themeMode: document.getElementById('settings-theme-mode').value,
        audioInput: micSel ? micSel.value : '',
        audioOutput: spkSel ? spkSel.value : '',
        audioVolume: volInput ? Number(volInput.value) : 100,
        audioNoise: document.getElementById('settings-audio-noise').checked,
        videoInput: camSel ? camSel.value : '',
        videoQuality: document.getElementById('settings-video-quality').value,
        videoBlur: document.getElementById('settings-video-blur').checked,
        notifChat: true,
        notifMentions: document.getElementById('settings-notif-mentions').checked,
        notifCalls: true,
        notifTasks: document.getElementById('settings-notif-tasks').checked,
        notifActivity: document.getElementById('settings-notif-activity').checked,
        notifSounds: document.getElementById('settings-notif-sounds').checked,
        appAutostart: true,
        appLanguage: document.getElementById('settings-app-language').value,
        perfResources: document.getElementById('settings-perf-resources').checked,
        perfHardware: document.getElementById('settings-perf-hardware').checked,
        theme3d: document.getElementById('settings-theme-3d').checked,
      };

      await setAppConfig(updated);

      // Apply runtime changes
      if (window.callControl) {
        window.callControl.setDevicesState(updated.audioInput, updated.videoInput, updated.audioOutput);
        if (updated.audioOutput) window.callControl.applySpeaker(updated.audioOutput);
        if (updated.audioVolume !== undefined) window.callControl.applyVolume(updated.audioVolume);
      }
      applyAppearanceTheme(updated.themeMode, localStorage.getItem('vo_theme') || 'indigo');
      apply3DSetting(updated.theme3d);

      // Save admin configs if admin
      if (currentUser.role === 'admin') {
        const adminBody = {
          google: {
            clientId: document.getElementById('g-client-id').value,
            folderId: document.getElementById('g-folder-id').value,
            clientSecret: document.getElementById('g-client-secret').value,
            refreshToken: document.getElementById('g-refresh-token').value
          },
          updater: {
            updateChannel: document.getElementById('settings-update-channel').value
          }
        };
        const res = await fetch(`${API_URL}/api/admin/config`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(adminBody)
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
        document.getElementById('g-client-secret').value = '';
        document.getElementById('g-refresh-token').value = '';
      }

      setStatus('Saved.', 'ok');
      await loadSettings();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  });

  // Connection Test
  document.getElementById('settings-test').addEventListener('click', async () => {
    setStatus('Testing connection...', '');
    try {
      const res = await fetch(`${API_URL}/api/admin/config/test`, {
        method: 'POST',
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Test failed');
      setStatus(`Connected to Google Drive${data.email ? ' as ' + data.email : ''}.`, 'ok');
    } catch (err) {
      setStatus(err.message, 'err');
    }
  });

  // Manual Update Checker
  const checkBtn = document.getElementById('settings-check-update-btn');
  const checkStatus = document.getElementById('settings-update-check-status');
  if (checkBtn && checkStatus) {
    checkBtn.onclick = async () => {
      if (!window.electronAPI || !window.electronAPI.checkForUpdates) {
        checkStatus.textContent = 'Not supported in browser mode.';
        checkStatus.style.color = '#ff6b6b';
        return;
      }
      checkStatus.textContent = 'Checking for updates...';
      checkStatus.style.color = '#fff';
      try {
        const res = await window.electronAPI.checkForUpdates();
        if (!res.success) {
          checkStatus.textContent = `Error: ${res.error}`;
          checkStatus.style.color = '#ff6b6b';
        } else {
          checkStatus.textContent = 'Check request sent.';
          checkStatus.style.color = '#2ecc71';
        }
      } catch (err) {
        checkStatus.textContent = err.message;
        checkStatus.style.color = '#ff6b6b';
      }
    };
  }

  // Audit Logs
  const refreshAuditBtn = document.getElementById('settings-refresh-audit-btn');
  if (refreshAuditBtn) {
    refreshAuditBtn.onclick = loadAuditLog;
  }
}

const escapeHtml = (str) => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};

async function loadAuditLog() {
  const auditLogBody = document.getElementById('settings-audit-log-body');
  if (!auditLogBody) return;
  auditLogBody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; opacity: 0.6;">Loading audit logs...</td></tr>';
  try {
    const res = await fetch(`${API_URL}/api/admin/audit-log`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch logs');
    const rows = await res.json();
    if (rows.length === 0) {
      auditLogBody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; opacity: 0.6;">No audit records found.</td></tr>';
      return;
    }
    auditLogBody.innerHTML = rows.map(r => {
      const time = new Date(r.timestamp).toLocaleString();
      const user = r.username || 'System';
      const eventColor = {
        launch: '#3498db',
        online: '#2ecc71',
        disconnected: '#e67e22',
        closed: '#95a5a6',
        unexpected_termination: '#e74c3c',
        system_update: '#9b59b6'
      }[r.status] || '#fff';

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
          <td style="padding: 6px 10px; opacity:0.85;">${time}</td>
          <td style="padding: 6px 10px; font-weight:bold;">${escapeHtml(user)}</td>
          <td style="padding: 6px 10px;"><span style="color:${eventColor}; font-weight:bold;">${escapeHtml(r.status.toUpperCase())}</span></td>
          <td style="padding: 6px 10px; opacity:0.9;">${escapeHtml(r.reason || '')}</td>
          <td style="padding: 6px 10px; opacity:0.75; font-size:0.95em;">${escapeHtml(r.device_id ? r.device_id.substring(0, 8) + '...' : '—')} / ${escapeHtml(r.app_version || '—')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    auditLogBody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #ff6b6b;">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadSettings() {
  try {
    const config = await getAppConfig();
    
    if (currentUser) {
      document.getElementById('settings-profile-username').value = currentUser.username || '';
      document.getElementById('settings-profile-designation').value = currentUser.designation || '';
      document.getElementById('settings-profile-avatar').value = currentUser.avatar || '';
      const avatarPreview = document.getElementById('settings-profile-avatar-preview');
      if (avatarPreview) {
        avatarPreview.src = currentUser.avatar || 'assets/default-avatar.png';
      }
    }

    if (document.getElementById('settings-theme-3d')) {
      document.getElementById('settings-theme-3d').checked = !!config.theme3d;
      apply3DSetting(!!config.theme3d);
    }

    // Load local config into inputs
    document.getElementById('settings-theme-mode').value = config.themeMode || 'dark';
    if (document.getElementById('settings-audio-input')) {
      document.getElementById('settings-audio-input').value = config.audioInput || '';
    }
    if (document.getElementById('settings-audio-output')) {
      document.getElementById('settings-audio-output').value = config.audioOutput || '';
    }
    if (document.getElementById('settings-audio-volume')) {
      document.getElementById('settings-audio-volume').value = config.audioVolume !== undefined ? config.audioVolume : 100;
    }
    if (document.getElementById('audio-volume-val')) {
      document.getElementById('audio-volume-val').textContent = (config.audioVolume !== undefined ? config.audioVolume : 100) + '%';
    }
    document.getElementById('settings-audio-noise').checked = config.audioNoise !== false;
    if (document.getElementById('settings-video-input')) {
      document.getElementById('settings-video-input').value = config.videoInput || '';
    }
    document.getElementById('settings-video-quality').value = config.videoQuality || 'medium';
    document.getElementById('settings-video-blur').checked = !!config.videoBlur;
    if (document.getElementById('settings-notif-chat')) {
      document.getElementById('settings-notif-chat').checked = config.notifChat !== false;
    }
    document.getElementById('settings-notif-mentions').checked = config.notifMentions !== false;
    if (document.getElementById('settings-notif-calls')) {
      document.getElementById('settings-notif-calls').checked = config.notifCalls !== false;
    }
    document.getElementById('settings-notif-tasks').checked = config.notifTasks !== false;
    document.getElementById('settings-notif-activity').checked = config.notifActivity !== false;
    document.getElementById('settings-notif-sounds').checked = config.notifSounds !== false;
    if (document.getElementById('settings-app-autostart')) {
      document.getElementById('settings-app-autostart').checked = config.appAutostart !== false;
    }
    document.getElementById('settings-app-language').value = config.appLanguage || 'en';
    document.getElementById('settings-perf-resources').checked = !!config.perfResources;
    document.getElementById('settings-perf-hardware').checked = config.perfHardware !== false;

    // Verify native input library control support and display status
    if (window.electronAPI && typeof window.electronAPI.hasNativeControlSupport === 'function') {
      try {
        const supported = await window.electronAPI.hasNativeControlSupport();
        const statusEl = document.getElementById('settings-control-status');
        const descEl = document.getElementById('settings-control-desc');
        if (statusEl) {
          if (supported) {
            statusEl.textContent = 'Active (Installed)';
            statusEl.style.color = 'var(--online-color)';
            if (descEl) descEl.style.display = 'none';
          } else {
            statusEl.textContent = 'Inactive (Missing dependencies)';
            statusEl.style.color = 'var(--danger-color)';
            if (descEl) descEl.style.display = 'block';
          }
        }
      } catch (e) {
        console.error('Failed to query remote control support:', e);
      }
    }

    // Apply appearance theme
    applyAppearanceTheme(config.themeMode || 'dark', localStorage.getItem('vo_theme') || 'indigo');

    // Admin configs
    if (currentUser.role === 'admin') {
      loadAuditLog();
      const res = await fetch(`${API_URL}/api/admin/config`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const g = data.google || {};
      const u = data.updater || {};
      document.getElementById('g-client-id').value = g.clientId || '';
      document.getElementById('g-folder-id').value = g.folderId || '';
      document.getElementById('g-secret-set').classList.toggle('hidden', !g.hasClientSecret);
      document.getElementById('g-token-set').classList.toggle('hidden', !g.hasRefreshToken);
      
      const channelSelect = document.getElementById('settings-update-channel');
      if (channelSelect) {
        channelSelect.value = u.updateChannel || 'stable';
      }
      document.getElementById('settings-about-channel').textContent = (u.updateChannel || 'stable').toUpperCase();
    } else {
      document.getElementById('settings-about-channel').textContent = (config.updateChannel || 'stable').toUpperCase();
    }
  } catch (e) { console.error('Failed to load settings:', e); }
}

// Human-readable labels for each in-app tab (shown to teammates).
const VIEW_LABELS = {
  office: 'In the office', chat: 'Team Chat', projects: 'Projects', tasks: 'Tasks',
  calendar: 'Calendar', whiteboard: 'Whiteboard', files: 'Files',
  integrations: 'Integrations', settings: 'Settings', analytics: 'Admin Analytics',
  edith: 'Talking to Edith (AI)'
};

// Switch the center view (used by nav items and quick actions).
function showView(viewId) {
  // If leaving settings, stop camera preview if active to avoid leaving indicator on
  if (viewId !== 'settings' && previewStream) {
    previewStream.getTracks().forEach(t => t.stop());
    previewStream = null;
    const previewVideo = document.getElementById('settings-video-preview');
    const previewPlaceholder = document.getElementById('settings-video-preview-placeholder');
    const previewBtn = document.getElementById('settings-toggle-preview-btn');
    if (previewVideo) previewVideo.srcObject = null;
    if (previewPlaceholder) previewPlaceholder.classList.remove('hidden');
    if (previewBtn) previewBtn.textContent = '📷 Toggle Camera Preview';
  }

  // Handle analytics polling
  if (viewId === 'analytics') {
    if (window.features && typeof window.features.startAnalyticsPolling === 'function') {
      window.features.startAnalyticsPolling();
    }
  } else {
    if (window.features && typeof window.features.stopAnalyticsPolling === 'function') {
      window.features.stopAnalyticsPolling();
    }
  }

  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === viewId));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(`${viewId}-view`);
  if (target) target.classList.remove('hidden');
  // Tell the team which tab I'm on so it shows on my profile/workstation.
  if (socket) socket.emit('activity_update', { view: viewId, label: VIEW_LABELS[viewId] || viewId });

  // Resume/pause Three.js 3D rendering loop to save background CPU/GPU
  if (window.office3d) {
    const theme3dEl = document.getElementById('settings-theme-3d');
    const theme3d = theme3dEl && theme3dEl.checked;
    if (viewId === 'office' && theme3d) {
      if (typeof window.office3d.startAnimating === 'function') {
        window.office3d.startAnimating();
      }
    } else {
      if (typeof window.office3d.stopAnimating === 'function') {
        window.office3d.stopAnimating();
      }
    }
  }
}

function apply3DSetting(enabled) {
  const office3d = document.getElementById('office-3d');
  const officeImg = document.getElementById('office-image');
  if (enabled) {
    if (office3d) office3d.classList.remove('hidden');
    if (officeImg) officeImg.classList.add('hidden');
    const officeView = document.getElementById('office-view');
    const onOfficeView = officeView && !officeView.classList.contains('hidden');
    if (onOfficeView && window.office3d && typeof window.office3d.startAnimating === 'function') {
      window.office3d.startAnimating();
    }
  } else {
    if (office3d) office3d.classList.add('hidden');
    if (officeImg) officeImg.classList.remove('hidden');
    if (window.office3d && typeof window.office3d.stopAnimating === 'function') {
      window.office3d.stopAnimating();
    }
  }
}

// Right-sidebar Team Members panel.
function renderTeam() {
  const el = document.getElementById('team-members');
  if (!el) return;
  el.innerHTML = '';
  users.forEach(u => {
    const active = u.status === 'online';
    const row = document.createElement('div');
    row.className = 'team-member';
    row.title = 'Click to view & call';
    row.onclick = () => openUserModal(u.id);

    const av = document.createElement('div');
    av.className = 't-avatar';
    const img = document.createElement('img');
    img.src = u.avatar || '';
    img.alt = u.username;
    const dot = document.createElement('div');
    dot.className = 't-dot' + (active ? ' ' + u.status : '');
    av.appendChild(img);
    av.appendChild(dot);

    const info = document.createElement('div');
    info.className = 't-info';
    const name = document.createElement('div');
    name.className = 't-name';
    name.textContent = u.username;
    const st = document.createElement('div');
    st.className = 't-status' + (active ? ' online' : '');
    // Show the live tab when available, else status message / state.
    const word = 'Online';
    st.textContent = active
      ? (u.current_view ? `🗂 ${u.current_label || u.current_view}` : (u.status_message || u.current_project || word))
      : 'Offline';
    info.appendChild(name);
    info.appendChild(st);

    row.appendChild(av);
    row.appendChild(info);
    el.appendChild(row);
  });

  refreshBackdrop(); // presence may have changed which auto-backdrop applies
}

// ---- Teammate profile modal (activity + call) ------------------------------
let userModalId = null;
function openUserModal(id) {
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;
  userModalId = id;
  document.getElementById('user-card-img').src = u.avatar || '';
  document.getElementById('user-card-name').textContent = u.username;
  const dot = document.getElementById('user-card-dot');
  dot.className = 't-dot' + (u.status === 'online' ? ' online' : '');
  refreshUserModal(id);
  loadOnlineTime(id);
  const isSelf = id === currentUser.id;
  document.getElementById('user-card-call').classList.toggle('hidden', isSelf);
  document.getElementById('user-card-dm').classList.toggle('hidden', isSelf);
  document.getElementById('user-modal').classList.remove('hidden');
}
function refreshUserModal(id) {
  if (id == null || userModalId !== id) return;
  const u = users.find(x => String(x.id) === String(id));
  if (!u) return;
  const statusLabel = { online: 'Online' };
  const online = u.status === 'online';
  let stateText = (online ? (statusLabel[u.status] || 'Online') : 'Offline');
  if (u.designation) stateText += ` · ${u.designation}`;
  if (u.status_message) stateText += ` (${u.status_message})`;
  document.getElementById('user-card-state').textContent = stateText;
  document.getElementById('user-card-dot').className = 't-dot' + (online ? ' ' + u.status : '');
  const act = document.getElementById('user-card-activity');
  act.textContent = online
    ? (u.current_view ? (u.current_label || u.current_view) : (u.current_project || 'In the office'))
    : 'Currently offline';
  // Open apps/windows.
  const appsEl = document.getElementById('user-card-apps');
  appsEl.innerHTML = '';
  if (u.apps && u.apps.length) {
    u.apps.slice(0, 12).forEach(name => {
      const chip = document.createElement('span');
      chip.className = 'app-chip';
      chip.textContent = name.length > 32 ? name.slice(0, 31) + '…' : name;
      appsEl.appendChild(chip);
    });
  } else {
    appsEl.textContent = online ? 'Not shared' : '—';
  }
}

// Fetch + render the 1/7/30-day time-online stats for a user.
async function loadOnlineTime(id) {
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.textContent = v; };
  set('uo-day', '…'); set('uo-week', '…'); set('uo-month', '…');
  try {
    const res = await fetch(`${API_URL}/api/users/${id}/online-time`, { headers: authHeaders() });
    if (!res.ok) throw new Error();
    const d = await res.json();
    if (userModalId !== id) return; // modal switched while loading
    set('uo-day', fmtDuration(d.day));
    set('uo-week', fmtDuration(d.week));
    set('uo-month', fmtDuration(d.month));
  } catch (e) {
    set('uo-day', '—'); set('uo-week', '—'); set('uo-month', '—');
  }
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return `${sec}s`;
}

async function reportApps() {
  if (!window.electronAPI || !window.electronAPI.getOpenWindows || !socket || !socket.connected) return;
  try {
    if (!currentUser || currentUser.status !== 'online') return;
    const apps = await window.electronAPI.getOpenWindows();
    socket.emit('apps_update', { apps });
  } catch (e) { /* ignore */ }
}

// Periodically report our own open desktop apps/windows (desktop app only).
function startAppsReporting() {
  reportApps();
  setInterval(reportApps, 60000); // refresh every 60s
}

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => { if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 1000 * 15);
}

function setServerStatus(online) {
  const el = document.getElementById('server-status');
  if (!el) return;
  el.innerHTML = `<span class="dot ${online ? 'online' : ''}"></span> Server ${online ? 'online' : 'offline'}`;
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function fetchUsers() {
  try {
    const res = await fetch(`${API_URL}/api/users`, { headers: authHeaders() });
    if (!res.ok) return;
    const freshList = await res.json();
    
    // Merge list, preserving in-memory 'apps' list of users
    freshList.forEach(freshUser => {
      const existing = users.find(u => String(u.id) === String(freshUser.id));
      if (existing && existing.apps) {
        freshUser.apps = existing.apps;
      }
    });
    users = freshList;
    
    if (currentUser) {
      const me = users.find(u => String(u.id) === String(currentUser.id) || u.username === currentUser.username);
      if (me) {
        currentUser = me;
        if (window.electronAPI) {
          window.electronAPI.getConfig().then(config => {
            window.electronAPI.setConfig({ ...config, user: currentUser });
          });
        }
        const settingsNav = document.getElementById('settings-nav');
        if (settingsNav) settingsNav.classList.remove('hidden');
        if (currentUser.role === 'admin') {
          const analyticsNav = document.getElementById('analytics-nav');
          if (analyticsNav) analyticsNav.classList.remove('hidden');
        }
        const prof = document.getElementById('my-profile');
        if (prof) {
          const img = prof.querySelector('img');
          if (img) img.src = currentUser.avatar || '';
          const name = prof.querySelector('.pname');
          if (name) name.textContent = currentUser.username;
        }
      }
    }
    renderWorkstations();
  } catch (e) {
    console.error('fetchUsers error:', e);
  }
}

function getUserName(id) {
  const u = users.find(u => String(u.id) === String(id));
  return u ? u.username : 'Unknown';
}

function renderWorkstations() {
  const container = document.getElementById('workstations');
  container.innerHTML = '';

  users.forEach(u => {
    const isOnline = u.status === 'online';
    const statusClass = isOnline ? 'online' : 'offline';
    const html = `
      <div class="workstation ${statusClass}" id="ws-${u.id}">
        <div class="monitor">
           <!-- Fake code/screen lines -->
           <div style="width: 80%; height: 2px; background: #333; margin: 4px; ${isOnline ? 'background: var(--primary-color); box-shadow: 0 0 5px var(--primary-color);' : ''}"></div>
           <div style="width: 60%; height: 2px; background: #333; margin: 4px; ${isOnline ? 'background: var(--primary-color); box-shadow: 0 0 5px var(--primary-color);' : ''}"></div>
        </div>
        <div class="desk-light"></div>
        <div class="worker-info">
          <div class="worker-avatar">
            <img src="${u.avatar}" alt="${u.username}">
            <div class="status-indicator status-${u.status}"></div>
          </div>
          <div class="worker-name">${u.username}</div>
          <div class="worker-designation" style="font-size:11px; opacity:0.6; margin-top:1px; color:var(--text-muted); font-weight:500;">${u.designation || ''}</div>
          <div class="worker-status" id="status-text-${u.id}">${u.status} ${u.status_message ? '- ' + u.status_message : ''}</div>
          <div class="worker-tab" id="ws-tab-${u.id}">${u.current_view ? '🗂 ' + (u.current_label || u.current_view) : ''}</div>
        </div>
        <div class="project-card">${u.current_project || 'No Active Project'}</div>
      </div>
    `;
    container.innerHTML += html;
  });

  // Clicking a workstation opens that teammate's profile/call card.
  users.forEach(u => {
    const ws = document.getElementById(`ws-${u.id}`);
    if (ws) ws.onclick = () => openUserModal(u.id);
  });

  renderTeam();
  renderConvos();
  if (window.office3d) window.office3d.update(users);
}

function updateUserStatus(data) {
  const u = users.find(u => String(u.id) === String(data.id));
  if (!data.status && u) data.status = u.status;
  const ws = document.getElementById(`ws-${data.id}`);
  if (ws) {
    const isOnline = data.status === 'online';
    ws.className = `workstation ${isOnline ? 'online' : 'offline'}`;
    const indicator = ws.querySelector('.status-indicator');
    if (indicator) {
      indicator.className = `status-indicator status-${data.status}`;
    }
    const statusText = document.getElementById(`status-text-${data.id}`);
    if (statusText) {
      statusText.textContent = `${data.status} ${data.message ? '- ' + data.message : ''}`;
    }
  }

  // Update in local users array
  if (u) {
    u.status = data.status;
    if (data.message !== undefined) u.status_message = data.message;
  }

  renderTeam();
  refreshUserModal(data.id);
  if (window.office3d) window.office3d.update(users);
}

// ---- Conversations (team + DMs) -------------------------------------------
let currentConversation = 'team';   // 'team' or a user id
const unreadConvos = new Map();      // convoKey -> unread count

// Which conversation a message belongs to, from my perspective.
function msgConversation(msg) {
  if (msg.recipient_id == null) return 'team';
  return msg.sender_id === currentUser.id ? msg.recipient_id : msg.sender_id;
}

function renderConvos() {
  const el = document.getElementById('chat-convos');
  if (!el) return;
  el.innerHTML = '';
  const items = [{ key: 'team', name: 'Team Chat', team: true }]
    .concat(users.filter(u => u.id !== currentUser.id).map(u => ({ key: u.id, name: u.username, avatar: u.avatar, status: u.status })));
  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'convo-item' + (currentConversation === it.key ? ' active' : '');
    row.onclick = () => openConversation(it.key);
    if (it.team) {
      const ic = document.createElement('div'); ic.className = 'convo-ic'; ic.textContent = '🌐';
      row.appendChild(ic);
    } else {
      const wrap = document.createElement('div'); wrap.className = 'convo-av-wrap';
      const img = document.createElement('img'); img.className = 'convo-av'; img.src = it.avatar || '';
      const isOnline = it.status === 'online';
      const dot = document.createElement('span'); dot.className = 't-dot' + (isOnline ? ' ' + it.status : '');
      wrap.append(img, dot); row.appendChild(wrap);
    }
    const nm = document.createElement('span'); nm.className = 'convo-name'; nm.textContent = it.name;
    row.appendChild(nm);
    const badge = document.createElement('span'); badge.className = 'convo-unread';
    const n = unreadConvos.get(it.key) || 0;
    if (n > 0) badge.textContent = n > 9 ? '9+' : String(n); else badge.classList.add('hidden');
    row.appendChild(badge);
    el.appendChild(row);
  });
}

async function openConversation(key) {
  currentConversation = key;
  unreadConvos.set(key, 0);
  renderConvos();
  const title = document.getElementById('chat-title');
  if (title) title.textContent = key === 'team' ? 'Team Chat' : `Chat with ${getUserName(key)}`;
  const area = document.getElementById('chat-messages');
  area.innerHTML = '';
  const url = key === 'team' ? `${API_URL}/api/messages` : `${API_URL}/api/messages/dm/${key}`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (res.ok) (await res.json()).forEach(appendChatMessage);
  } catch (e) { /* offline */ }
}

function markConvoUnread(key) {
  unreadConvos.set(key, (unreadConvos.get(key) || 0) + 1);
  renderConvos();
}

function appendChatMessage(msg) {
  const area = document.getElementById('chat-messages');

  // Skip if this message id is already on screen (guards against duplicate
  // socket echoes on reconnect).
  if (msg.id != null && area.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const isSelf = String(msg.sender_id) === String(currentUser.id);

  const div = document.createElement('div');
  div.className = `message ${isSelf ? 'self' : ''}`;
  if (msg.id != null) div.dataset.msgId = msg.id;

  const avatarUrl = msg.avatar || users.find(u => String(u.id) === String(msg.sender_id))?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Unknown';

  // Build with the DOM so message content is treated as text, never HTML.
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.alt = 'Avatar';
  avatar.src = avatarUrl;

  const content = document.createElement('div');
  content.className = 'msg-content';

  const header = document.createElement('div');
  header.className = 'msg-header';
  const name = document.createElement('strong');
  name.textContent = msg.username;
  const time = document.createElement('span');
  time.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  header.appendChild(name);
  header.appendChild(time);

  const body = document.createElement('div');
  if (msg.type === 'file') {
    // File shares arrive as JSON { filename, url }; render a safe link.
    let file = null;
    try { file = JSON.parse(msg.content); } catch (e) { /* legacy/plain message */ }
    if (file && /^https?:\/\//.test(file.url)) {
      const link = document.createElement('a');
      link.href = file.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.color = 'var(--primary-color)';
      link.textContent = `📎 ${file.filename}`;
      body.appendChild(link);
    } else {
      body.textContent = msg.content;
    }
  } else {
    body.textContent = msg.content;
  }

  content.appendChild(header);
  content.appendChild(body);
  div.appendChild(avatar);
  div.appendChild(content);

  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

// Compact mirror of each message into the always-on bottom chat dock.
function renderDockMessage(msg) {
  const dock = document.getElementById('chat-dock-messages');
  if (!dock) return;
  if (msg.id != null && dock.querySelector(`[data-msg-id="${msg.id}"]`)) return;
  const line = document.createElement('div');
  line.className = 'dock-msg' + (msg.sender_id === currentUser.id ? ' self' : '');
  if (msg.id != null) line.dataset.msgId = msg.id;
  const who = document.createElement('strong');
  who.textContent = msg.username + ': ';
  const text = document.createElement('span');
  if (msg.type === 'file') {
    let file = null; try { file = JSON.parse(msg.content); } catch (e) {}
    text.textContent = file ? `📎 ${file.filename}` : msg.content;
  } else {
    text.textContent = msg.content;
  }
  line.append(who, text);
  dock.appendChild(line);
  dock.scrollTop = dock.scrollHeight;
  // Surface unread state for messages from others depending on popup state.
  const dockEl = document.getElementById('chat-dock');
  if (dockEl && msg.sender_id !== currentUser.id) {
    if (dockEl.classList.contains('hidden')) {
      if (window.__chatBubbleBump) window.__chatBubbleBump(); // closed -> bubble badge
    } else if (dockEl.classList.contains('collapsed')) {
      dockEl.classList.add('unread');                         // minimized -> header glow
    }
  }
}

function addActivity(text) {
  const feed = document.getElementById('activity-feed');
  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `
    <span style="color: var(--primary-color)">●</span>
    <div>
      <div>${text}</div>
      <div class="time">Just now</div>
    </div>
  `;
  feed.prepend(div);
}

// --- Color themes (available to every user, saved per device) ----------------
(function () {
  const THEMES = [
    { id: 'indigo', name: 'Indigo', swatch: '#6366f1' },
    { id: 'midnight', name: 'Black', swatch: '#4b5563' },
    { id: 'purple', name: 'Purple', swatch: '#a855f7' },
    { id: 'green', name: 'Green', swatch: '#10b981' },
    { id: 'ocean', name: 'Ocean', swatch: '#0ea5e9' },
    { id: 'rose', name: 'Rose', swatch: '#f43f5e' },
    { id: 'amber', name: 'Amber', swatch: '#f59e0b' },
    { id: 'crimson', name: 'Crimson', swatch: '#dc2626' },
    { id: 'teal', name: 'Teal', swatch: '#0d9488' },
    { id: 'fuchsia', name: 'Fuchsia', swatch: '#d946ef' },
    { id: 'aurora', name: 'Aurora', swatch: '#34d399' },
    { id: 'sunset', name: 'Sunset', swatch: '#f97316' },
    { id: 'cyberpunk', name: 'Cyberpunk', swatch: '#eab308' },
    { id: 'forest', name: 'Forest', swatch: '#059669' },
    { id: 'nebula', name: 'Nebula', swatch: '#8b5cf6' },
    { id: 'light', name: 'White', swatch: '#e2e8f0' }
  ];
  const KEY = 'vo_theme';

  function applyTheme(id) {
    getAppConfig().then(config => {
      const mode = config.themeMode || 'dark';
      applyAppearanceTheme(mode, id || 'indigo');
    });
    try { localStorage.setItem(KEY, id); } catch (e) {}
    document.querySelectorAll('.theme-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.theme === id));
  }

  function buildGrid() {
    const grids = document.querySelectorAll('.theme-grid');
    grids.forEach(grid => {
      if (!grid || grid.childElementCount) return;
      THEMES.forEach(t => {
        const chip = document.createElement('button');
        chip.className = 'theme-chip';
        chip.dataset.theme = t.id;
        chip.innerHTML = `<span class="theme-dot" style="background:${t.swatch}"></span><span>${t.name}</span>`;
        chip.onclick = () => applyTheme(t.id);
        grid.appendChild(chip);
      });
    });
  }

  function setupUpdater() {
    if (!window.electronAPI || !window.electronAPI.onUpdaterEvent) return;

    const modal = document.getElementById('update-modal');
    const screenInfo = document.getElementById('update-screen-info');
    const screenProgress = document.getElementById('update-screen-progress');
    const screenReady = document.getElementById('update-screen-ready');

    const newVerSpan = document.getElementById('update-new-ver');
    const dateSpan = document.getElementById('update-date');
    const sizeSpan = document.getElementById('update-size');
    const notesDiv = document.getElementById('update-notes');

    const progressBar = document.getElementById('update-progress-bar');
    const speedSpan = document.getElementById('update-speed');
    const percentSpan = document.getElementById('update-percent');

    const downloadBtn = document.getElementById('update-download-btn');
    const laterBtn = document.getElementById('update-later-btn');
    const restartBtn = document.getElementById('update-restart-btn');
    const installLaterBtn = document.getElementById('update-install-later-btn');

    const formatBytes = (bytes) => {
      if (!bytes) return 'Unknown';
      if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      return (bytes / 1024).toFixed(2) + ' KB';
    };

    window.electronAPI.onUpdaterEvent((data) => {
      console.log('[updater-event]', data);

      if (data.event === 'available') {
        newVerSpan.textContent = data.info.version;
        dateSpan.textContent = data.info.releaseDate ? new Date(data.info.releaseDate).toLocaleDateString() : 'Unknown';
        sizeSpan.textContent = formatBytes(data.info.size);
        notesDiv.textContent = data.info.releaseNotes;

        screenInfo.classList.remove('hidden');
        screenProgress.classList.add('hidden');
        screenReady.classList.add('hidden');
        modal.classList.remove('hidden');
      } 
      else if (data.event === 'progress') {
        screenInfo.classList.add('hidden');
        screenProgress.classList.remove('hidden');
        screenReady.classList.add('hidden');
        modal.classList.remove('hidden');

        const percent = Math.round(data.progress.percent);
        progressBar.style.width = percent + '%';
        percentSpan.textContent = percent + '%';
        speedSpan.textContent = `Speed: ${formatBytes(data.progress.bytesPerSecond)}/s`;
      } 
      else if (data.event === 'downloaded') {
        screenInfo.classList.add('hidden');
        screenProgress.classList.add('hidden');
        screenReady.classList.remove('hidden');
        modal.classList.remove('hidden');
      }
      else if (data.event === 'error') {
        modal.classList.add('hidden');
        console.error('[updater-error]', data.error);
      }
    });

    downloadBtn.addEventListener('click', async () => {
      screenInfo.classList.add('hidden');
      screenProgress.classList.remove('hidden');
      try {
        await window.electronAPI.downloadUpdate();
      } catch (e) {
        modal.classList.add('hidden');
      }
    });

    laterBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    restartBtn.addEventListener('click', () => {
      window.electronAPI.installUpdate();
    });

    installLaterBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  function wire() {
    buildGrid();
    const saved = (() => { try { return localStorage.getItem(KEY); } catch (e) { return null; } })();
    applyTheme(saved || 'indigo');
    const btn = document.getElementById('theme-btn');
    const modal = document.getElementById('theme-modal');
    const close = document.getElementById('theme-close');
    if (btn) btn.onclick = () => modal.classList.remove('hidden');
    if (close) close.onclick = () => modal.classList.add('hidden');
    setupUpdater();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
