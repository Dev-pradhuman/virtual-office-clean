// Multi-party screen sharing (mesh).
// Anyone can broadcast their screen to everyone in the office, and multiple
// people can share simultaneously. Each share is a one-directional connection
// from the sharer to every viewer:
//   - outgoing: Map<viewerId, conn>  -> connections where *I* am the sharer
//   - incoming: Map<sharerId, conn>  -> connections where someone shares to me
// Keeping each peer connection one-directional avoids renegotiation/glare.

let localStream = null;
let isSharing = false;
const outgoing = new Map(); // viewerId -> { pc, pending: [] }
const incoming = new Map(); // sharerId -> { pc, pending: [] }

// STUN finds your public address for a direct peer-to-peer link. TURN relays
// the media when a direct link can't be formed — which is the common case for
// two friends on different home networks (symmetric NAT / firewalls). Without
// a TURN server, screen sharing works on the same LAN but silently fails across
// the internet (the connection goes to "failed" and you see no video). The
// openrelay servers below are a free public TURN; swap in your own (or a
// Cloudflare/Twilio TURN) via window.TURN_SERVERS for better reliability.
const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    // Free public TURN relays (openrelay.metered.ca) over UDP, TCP and TLS:443
    // so they punch through restrictive networks that block everything but HTTPS.
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ...(Array.isArray(window.TURN_SERVERS) ? window.TURN_SERVERS : [])
  ],
  iceCandidatePoolSize: 10
};

// Prefer the server-provided ICE (real TURN, fetched in app.js); fall back to
// the built-in list above. Read lazily so a later-configured TURN is used.
function rtcConfig() {
  const ice = (window.__rtcConfig && Array.isArray(window.__rtcConfig.iceServers))
    ? window.__rtcConfig.iceServers
    : config.iceServers;
  return { iceServers: ice, iceCandidatePoolSize: 10 };
}

const screenshareContainer = document.getElementById('screenshare-container');
const screenshareGrid = document.getElementById('screenshare-grid');
const shareScreenBtn = document.getElementById('share-screen-btn');
const closeScreenBtn = document.getElementById('close-screenshare-btn');

// Source Picker Elements
const sourcePickerModal = document.getElementById('source-picker-modal');
const sourcesList = document.getElementById('sources-list');
const cancelPickerBtn = document.getElementById('cancel-picker');

// Remote control elements + state
const controlModal = document.getElementById('control-modal');
const controlModalMessage = document.getElementById('control-modal-message');
const controlAllowBtn = document.getElementById('control-allow');
const controlDenyBtn = document.getElementById('control-deny');
const controlBanner = document.getElementById('control-banner');
const controlBannerText = document.getElementById('control-banner-text');
const controlStopBtn = document.getElementById('control-stop');

let controllingId = null;   // sharer whose screen *I* am currently controlling
let controllerId = null;    // viewer I have granted control of *my* screen to
let pendingRequesterId = null; // viewer awaiting my allow/deny decision
let lastMoveSent = 0;       // throttle timestamp for mousemove forwarding

// ---------------------------------------------------------------------------
// Share button: toggles between starting and stopping my own screen share.
// ---------------------------------------------------------------------------
if (shareScreenBtn) {
  shareScreenBtn.addEventListener('click', async () => {
    if (isSharing) {
      stopSharing();
      return;
    }
    if (typeof users === 'undefined' || users.length === 0) {
      alert('Office is still loading users...');
      return;
    }
    if (!socket) {
      alert('Not connected to Headquarters yet.');
      return;
    }
    showSourcePicker();
  });
}

if (closeScreenBtn) {
  // The ❌ stops my own broadcast; viewers can keep watching others.
  closeScreenBtn.addEventListener('click', () => {
    if (isSharing) stopSharing();
    else screenshareContainer.classList.add('hidden');
  });
}

if (cancelPickerBtn) {
  cancelPickerBtn.onclick = () => sourcePickerModal.classList.add('hidden');
}

// Remote control permission buttons (sharer side).
if (controlAllowBtn) {
  controlAllowBtn.onclick = () => {
    controlModal.classList.add('hidden');
    if (pendingRequesterId == null) return;
    controllerId = pendingRequesterId;
    pendingRequesterId = null;
    socket.emit('grant_control', { target_id: controllerId });
    controlBannerText.textContent = `${getUserName(controllerId)} is controlling your screen`;
    controlBanner.classList.remove('hidden');
    addActivity(`You gave ${getUserName(controllerId)} control of your screen.`);
  };
}
if (controlDenyBtn) {
  controlDenyBtn.onclick = () => {
    controlModal.classList.add('hidden');
    if (pendingRequesterId != null) socket.emit('deny_control', { target_id: pendingRequesterId });
    pendingRequesterId = null;
  };
}
if (controlStopBtn) {
  controlStopBtn.onclick = () => endBeingControlled(true);
}

async function showSourcePicker() {
  if (!window.electronAPI || !window.electronAPI.getDesktopSources) {
    alert('Native screen sharing not available in this environment.');
    return;
  }
  try {
    const sources = await window.electronAPI.getDesktopSources();
    sourcesList.innerHTML = '';
    sources.forEach(source => {
      const div = document.createElement('div');
      div.className = 'source-item';
      div.innerHTML = `
        <img src="${source.thumbnail}" class="source-thumbnail">
        <div class="source-name">${source.name}</div>
      `;
      div.onclick = () => {
        sourcePickerModal.classList.add('hidden');
        startSharing(source.id);
      };
      sourcesList.appendChild(div);
    });
    sourcePickerModal.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to get sources:', err);
    alert('Could not retrieve screen sources.');
  }
}

// ---------------------------------------------------------------------------
// Signaling — attached once the socket from app.js is ready.
// ---------------------------------------------------------------------------
const checkSocketInterval = setInterval(() => {
  if (typeof socket !== 'undefined' && socket) {
    clearInterval(checkSocketInterval);
    setupSignaling();
  }
}, 60);

function setupSignaling() {
  let disconnectTimer = null;
  socket.on('disconnect', () => {
    if (isSharing || incoming.size > 0) {
      console.log('[webrtc] Socket disconnected. Waiting 45s grace period before tearing down screen share...');
      disconnectTimer = setTimeout(() => {
        console.log('[webrtc] Reconnection grace period expired. Stopping screen share.');
        if (isSharing) stopSharing();
        incoming.forEach((conn, id) => { conn.pc.close(); removeTile(id); });
        incoming.clear();
      }, 45000);
    }
  });

  socket.on('connect', () => {
    if (disconnectTimer) {
      console.log('[webrtc] Socket reconnected. Clearing screen share teardown timer.');
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  });

  // Incoming offer => someone is sharing their screen with me. I'm a viewer.
  socket.on('webrtc_offer', async (data) => {
    let conn = incoming.get(data.sender_id);
    if (!conn) {
      if (window.triggerNotification) {
        const name = (typeof getUserName === 'function') ? getUserName(data.sender_id) : 'A teammate';
        window.triggerNotification('Screen Share Started', `${name} is sharing their screen`, 'calls');
      }
      const pc = new RTCPeerConnection(rtcConfig());
      conn = { pc, pending: [] };
      incoming.set(data.sender_id, conn);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('webrtc_ice_candidate', {
            target_id: data.sender_id, candidate: e.candidate, role: 'viewer'
          });
        }
      };
      pc.ontrack = (e) => {
        addTile(data.sender_id, e.streams[0], getUserName(data.sender_id), { controllable: true });
        addActivity(`${getUserName(data.sender_id)} is sharing their screen.`);
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          addActivity(`Connection to ${getUserName(data.sender_id)}'s screen failed (NAT/firewall).`);
        }
      };
    }

    await conn.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await conn.pc.createAnswer();
    await conn.pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target_id: data.sender_id, answer });
    flushPending(conn);
  });

  // Incoming answer => a viewer accepted my share. I'm the sharer.
  socket.on('webrtc_answer', async (data) => {
    const conn = outgoing.get(data.sender_id);
    if (conn) {
      await conn.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      flushPending(conn);
    }
  });

  // ICE: route by the sender's role. If they were the sharer, the candidate
  // belongs to my incoming connection from them; if viewer, to my outgoing one.
  socket.on('webrtc_ice_candidate', async (data) => {
    const conn = data.role === 'sharer'
      ? incoming.get(data.sender_id)
      : outgoing.get(data.sender_id);
    if (!conn) return;
    const candidate = new RTCIceCandidate(data.candidate);
    if (conn.pc.remoteDescription && conn.pc.remoteDescription.type) {
      await conn.pc.addIceCandidate(candidate).catch(e => console.error('addIceCandidate', e));
    } else {
      conn.pending.push(candidate); // buffer until remote description is set
    }
  });

  // A peer stopped sharing => tear down my view of their screen.
  socket.on('peer_stopped_sharing', (data) => {
    const conn = incoming.get(data.sender_id);
    if (conn) { conn.pc.close(); incoming.delete(data.sender_id); }
    if (controllingId === data.sender_id) exitControlMode();
    removeTile(data.sender_id);
  });

  // Track presence so we can offer to late joiners and clean up on leave.
  socket.on('user_status_change', (data) => {
    if (data.id === currentUser.id) return;
    if (data.status === 'offline') {
      if (incoming.has(data.id)) { incoming.get(data.id).pc.close(); incoming.delete(data.id); }
      if (outgoing.has(data.id)) { outgoing.get(data.id).pc.close(); outgoing.delete(data.id); }
      if (controllingId === data.id) exitControlMode();
      if (controllerId === data.id) endBeingControlled(false);
      removeTile(data.id);
    } else if (data.status === 'online' && isSharing) {
      // Someone joined while I'm broadcasting — start sharing to them too.
      shareToViewer(data.id);
    }
  });

  // --- Remote control signaling ----------------------------------------
  // (sharer side) A viewer asks to control my screen.
  socket.on('control_requested', (data) => {
    // Only meaningful if I'm actually sharing; ignore stray requests.
    if (!isSharing) { socket.emit('deny_control', { target_id: data.sender_id }); return; }
    if (controllerId) { socket.emit('deny_control', { target_id: data.sender_id }); return; }
    pendingRequesterId = data.sender_id;
    controlModalMessage.textContent = `${data.username} wants to control your screen.`;
    controlModal.classList.remove('hidden');
    if (window.electronAPI) {
      window.electronAPI.showNotification('Remote Control Request', controlModalMessage.textContent);
    }
  });

  // (viewer side) My request was granted.
  socket.on('control_granted', (data) => {
    enterControlMode(data.sender_id);
  });

  // (viewer side) My request was denied.
  socket.on('control_denied', (data) => {
    addActivity(`${getUserName(data.sender_id)} denied your control request.`);
  });

  // Either side revoked — clean up whichever role applies.
  socket.on('control_revoked', (data) => {
    if (controllingId === data.sender_id) exitControlMode();
    if (controllerId === data.sender_id) endBeingControlled(false);
  });

  // (sharer side) Injected input from the controller.
  socket.on('control_input', (data) => {
    if (data.sender_id !== controllerId) return; // only the granted controller
    if (window.electronAPI && window.electronAPI.injectInput) {
      window.electronAPI.injectInput(data.input);
    }
  });
}

// ---------------------------------------------------------------------------
// Sharing (publisher side)
// ---------------------------------------------------------------------------
async function startSharing(sourceId) {
  try {
    // Preferred path: tell the main process which source we picked, then use
    // getDisplayMedia so capture goes through Electron's native pipeline
    // (renders correctly on Wayland/PipeWire; the legacy path showed black).
    if (window.electronAPI && window.electronAPI.setShareSource && navigator.mediaDevices.getDisplayMedia) {
      await window.electronAPI.setShareSource(sourceId);
      // Request audio too — the main process supplies system/loopback audio on
      // Windows; elsewhere it returns video-only (no error).
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      // Fallback for non-Electron / older environments.
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
      });
    }
    isSharing = true;
    updateShareButton();

    // Local self-preview tile.
    addTile(currentUser.id, localStream, 'You', { muted: true });

    // Stop when the OS "stop sharing" control is used.
    localStream.getVideoTracks()[0].onended = () => stopSharing();

    // Offer to every other online user.
    users
      .filter(u => u.id !== currentUser.id && u.status === 'online')
      .forEach(u => shareToViewer(u.id));

    addActivity('You started sharing your screen with the office.');
  } catch (err) {
    console.error('Error sharing screen:', err);
    isSharing = false;
    updateShareButton();
    alert('Failed to share screen.');
  }
}

function shareToViewer(viewerId) {
  if (!localStream || outgoing.has(viewerId)) return;

  const pc = new RTCPeerConnection(rtcConfig());
  const conn = { pc, pending: [] };
  outgoing.set(viewerId, conn);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc_ice_candidate', {
        target_id: viewerId, candidate: e.candidate, role: 'sharer'
      });
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      addActivity(`Could not reach ${getUserName(viewerId)} (NAT/firewall).`);
    }
  };

  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer).then(() => offer))
    .then(offer => socket.emit('webrtc_offer', { target_id: viewerId, offer }))
    .catch(err => console.error('createOffer', err));
}

function stopSharing() {
  isSharing = false;
  if (controllerId) endBeingControlled(true); // revoke any active control of my screen
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  outgoing.forEach(conn => conn.pc.close());
  outgoing.clear();
  removeTile(currentUser.id);
  if (socket) socket.emit('stop_screen_share');
  updateShareButton();
  addActivity('You stopped sharing your screen.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function flushPending(conn) {
  conn.pending.forEach(c => conn.pc.addIceCandidate(c).catch(e => console.error('flush ice', e)));
  conn.pending = [];
}

function updateShareButton() {
  if (!shareScreenBtn) return;
  shareScreenBtn.innerHTML = isSharing
    ? '<span class="icon">🛑</span> Stop Sharing'
    : '<span class="icon">📺</span> Share Screen';
  shareScreenBtn.classList.toggle('sharing', isSharing);
}

function addTile(userId, stream, label, { muted = false, controllable = false } = {}) {
  screenshareContainer.classList.remove('hidden');

  let tile = document.getElementById(`tile-${userId}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = `tile-${userId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (muted) video.muted = true;

    const labelEl = document.createElement('div');
    labelEl.className = 'tile-label';
    labelEl.textContent = label;

    tile.appendChild(video);
    tile.appendChild(labelEl);

    // Fullscreen toggle (every tile). Goes fullscreen on the tile element so
    // the label/control button stay visible over the video.
    const fsBtn = document.createElement('button');
    fsBtn.className = 'tile-fullscreen-btn';
    fsBtn.title = 'Fullscreen';
    fsBtn.textContent = '⛶';
    fsBtn.onclick = (e) => { e.stopPropagation(); toggleTileFullscreen(tile); };
    tile.appendChild(fsBtn);

    // Double-clicking the video also toggles fullscreen (familiar gesture).
    video.addEventListener('dblclick', () => toggleTileFullscreen(tile));

    // Remote screens get a "Request Control" button.
    if (controllable) {
      const ctrlBtn = document.createElement('button');
      ctrlBtn.className = 'tile-control-btn';
      
      const u = users.find(x => String(x.id) === String(userId));
      const supported = u ? u.controlSupported : true;
      
      if (supported) {
        ctrlBtn.textContent = '🖱 Request Control';
        ctrlBtn.onclick = () => requestControl(userId);
      } else {
        ctrlBtn.textContent = '🚫 Control Unsupported';
        ctrlBtn.disabled = true;
        ctrlBtn.title = "Teammate doesn't have the native input library installed";
        ctrlBtn.style.opacity = 0.5;
        ctrlBtn.style.cursor = 'not-allowed';
      }
      tile.appendChild(ctrlBtn);
    }

    screenshareGrid.appendChild(tile);
  }

  const video = tile.querySelector('video');
  video.srcObject = stream;
  video.onloadedmetadata = () => video.play().catch(e => console.error('Auto-play failed:', e));
}

function updateControlButtons() {
  const buttons = document.querySelectorAll('.tile-control-btn');
  buttons.forEach(btn => {
    const tile = btn.closest('.video-tile');
    if (!tile) return;
    const userId = tile.id.replace('tile-', '');
    const u = users.find(x => String(x.id) === String(userId));
    const supported = u ? u.controlSupported : true;
    
    if (supported) {
      btn.textContent = '🖱 Request Control';
      btn.disabled = false;
      btn.removeAttribute('title');
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.onclick = () => requestControl(userId);
    } else {
      btn.textContent = '🚫 Control Unsupported';
      btn.disabled = true;
      btn.title = "Teammate doesn't have the native input library installed";
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.onclick = null;
    }
  });
}

function removeTile(userId) {
  const tile = document.getElementById(`tile-${userId}`);
  if (tile) tile.remove();
  if (screenshareGrid.children.length === 0) {
    screenshareContainer.classList.add('hidden');
  }
}

// Toggle native fullscreen for a single screen-share tile. Requesting it on the
// tile (not the bare <video>) keeps the label and Request-Control button usable.
function toggleTileFullscreen(tile) {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const req = tile.requestFullscreen || tile.webkitRequestFullscreen;
  if (req) req.call(tile).catch(e => console.error('Fullscreen failed:', e));
}

// ---------------------------------------------------------------------------
// Remote control
//   controllingId : the sharer whose screen I am driving (viewer role)
//   controllerId  : the viewer I have allowed to drive my screen (sharer role)
// Input is captured over the controlled tile's <video>, normalized to [0..1]
// (accounting for object-fit letterboxing), relayed via socket, and injected
// on the sharer's machine. Control of a full-screen share works best.
// ---------------------------------------------------------------------------
let controlHandlers = null;

function requestControl(sharerId) {
  if (controllingId) { addActivity('You are already controlling a screen.'); return; }
  if (!socket) return;
  socket.emit('request_control', { target_id: sharerId });
  addActivity(`Requested control of ${getUserName(sharerId)}'s screen...`);
}

// The displayed video content rect, accounting for object-fit: contain bars.
function contentRect(video) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return rect;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const w = vw * scale, h = vh * scale;
  return {
    left: rect.left + (rect.width - w) / 2,
    top: rect.top + (rect.height - h) / 2,
    width: w, height: h
  };
}

function norm(video, clientX, clientY) {
  const cr = contentRect(video);
  return {
    x: Math.min(Math.max((clientX - cr.left) / cr.width, 0), 1),
    y: Math.min(Math.max((clientY - cr.top) / cr.height, 0), 1)
  };
}

function sendInput(input) {
  if (controllingId == null || !socket) return;
  socket.emit('control_input', { target_id: controllingId, input });
}

function tileControlButton(userId) {
  const tile = document.getElementById(`tile-${userId}`);
  return tile && tile.querySelector('.tile-control-btn');
}

function enterControlMode(sharerId) {
  if (controllingId === sharerId) return;
  if (controllingId) exitControlMode();

  const tile = document.getElementById(`tile-${sharerId}`);
  const video = tile && tile.querySelector('video');
  if (!video) { addActivity('Could not find the screen to control.'); return; }

  controllingId = sharerId;
  tile.classList.add('controlling');
  tile.setAttribute('tabindex', '0');
  if (video.focus) video.focus();

  const onMove = (e) => {
    const now = performance.now();
    if (now - lastMoveSent < 25) return; // ~40 updates/sec cap
    lastMoveSent = now;
    const p = norm(video, e.clientX, e.clientY);
    sendInput({ type: 'move', x: p.x, y: p.y });
  };
  const onDown = (e) => {
    e.preventDefault();
    const p = norm(video, e.clientX, e.clientY);
    sendInput({ type: 'down', x: p.x, y: p.y, button: e.button });
  };
  const onUp = (e) => {
    e.preventDefault();
    const p = norm(video, e.clientX, e.clientY);
    sendInput({ type: 'up', x: p.x, y: p.y, button: e.button });
  };
  const onWheel = (e) => {
    e.preventDefault();
    sendInput({ type: 'scroll', dx: e.deltaX, dy: e.deltaY / 100 });
  };
  const onContext = (e) => e.preventDefault();
  const onKey = (e) => {
    if (e.key === 'Escape') { releaseControl(); return; }
    e.preventDefault();
    sendInput({ type: 'keydown', key: e.key });
  };

  video.addEventListener('mousemove', onMove);
  video.addEventListener('mousedown', onDown);
  video.addEventListener('mouseup', onUp);
  video.addEventListener('wheel', onWheel, { passive: false });
  video.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey);
  controlHandlers = { video, onMove, onDown, onUp, onWheel, onContext, onKey };

  const btn = tileControlButton(sharerId);
  if (btn) { btn.textContent = '🛑 Release Control'; btn.onclick = releaseControl; }

  addActivity(`You are controlling ${getUserName(sharerId)}'s screen. Press Esc to release.`);
}

// Tears down capture without notifying the sharer (used when the sharer ends it).
function exitControlMode() {
  if (controllingId == null) return;
  const sharerId = controllingId;
  const tile = document.getElementById(`tile-${sharerId}`);
  if (tile) { tile.classList.remove('controlling'); tile.removeAttribute('tabindex'); }
  if (controlHandlers) {
    const h = controlHandlers;
    h.video.removeEventListener('mousemove', h.onMove);
    h.video.removeEventListener('mousedown', h.onDown);
    h.video.removeEventListener('mouseup', h.onUp);
    h.video.removeEventListener('wheel', h.onWheel);
    h.video.removeEventListener('contextmenu', h.onContext);
    window.removeEventListener('keydown', h.onKey);
    controlHandlers = null;
  }
  controllingId = null;

  const btn = tileControlButton(sharerId);
  if (btn) { btn.textContent = '🖱 Request Control'; btn.onclick = () => requestControl(sharerId); }
}

// Viewer voluntarily releases control and tells the sharer.
function releaseControl() {
  const sharerId = controllingId;
  exitControlMode();
  if (sharerId != null && socket) socket.emit('revoke_control', { target_id: sharerId });
  if (sharerId != null) addActivity(`You released control of ${getUserName(sharerId)}'s screen.`);
}

// Sharer side: end the controller's session. notify=true informs the controller.
function endBeingControlled(notify) {
  controlBanner.classList.add('hidden');
  if (controllerId == null) return;
  const viewerId = controllerId;
  controllerId = null;
  if (notify && socket) socket.emit('revoke_control', { target_id: viewerId });
  addActivity(`Control of your screen by ${getUserName(viewerId)} ended.`);
}
