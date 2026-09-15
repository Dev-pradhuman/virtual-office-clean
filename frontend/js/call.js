// Voice / video calling (Google Meet / Discord-style).
// A full-mesh call: every participant holds a bidirectional RTCPeerConnection
// to every other participant. Audio is captured on join; the camera is opt-in
// and added/removed live via WebRTC "perfect negotiation" (which also resolves
// offer glare when several people join at once).
//
// Uses globals from app.js: socket, currentUser, users, getUserName, addActivity.
// Signaling goes through these socket events (see backend/socket.js):
//   call_join -> call_peers           (who's already in)
//   call_peer_joined / call_peer_left (presence)
//   call_start -> call_ringing        (incoming call prompt)
//   call_decline -> call_declined
//   call_signal                       (offer/answer/ICE, 1:1)
//   call_state                        (mic/cam indicators)
(function () {
  // Same ICE config as screen sharing: STUN for direct links, TURN to relay
  // across home networks. Kept independent so the two features don't interfere.
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ...(Array.isArray(window.TURN_SERVERS) ? window.TURN_SERVERS : [])
    ],
    // Pre-gather ICE so the connection is ready the instant we get an answer,
    // and bundle all media on one transport to cut ICE checks (lower setup lag).
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
  };

  // Prefer the server-provided ICE (real TURN) fetched in app.js; fall back to
  // the built-in list. Read lazily so a TURN configured after load is picked up.
  function rtcConfig() {
    const ice = (window.__rtcConfig && Array.isArray(window.__rtcConfig.iceServers))
      ? window.__rtcConfig.iceServers
      : RTC_CONFIG.iceServers;
    return { iceServers: ice, iceCandidatePoolSize: 10, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
  }

  // Low-latency mic capture: echo cancellation on, but keep the audio path lean.
  const AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
  };

  let inCall = false;
  let localStream = null;        // mic (+ camera when on)
  let micOn = true;
  let camOn = false;
  const peers = new Map();       // peerId -> { pc, makingOffer, ignoreOffer, polite }

  // ---- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const panel = $('call-panel');
  const grid = $('call-grid');
  const micBtn = $('call-mic');
  const camBtn = $('call-cam');
  const leaveBtn = $('call-leave');
  const inviteBtn = $('call-invite');
  const joinPill = $('qa-join-call');
  const devicesBtn = $('call-devices');
  const devicePanel = $('call-device-panel');
  const micSel = $('dev-mic');
  const camSel = $('dev-cam');
  const spkSel = $('dev-spk');

  let selMic = '', selCam = '', selSpk = ''; // chosen device ids ('' = default)
  const startModal = $('call-start-modal');
  const memberList = $('call-member-list');
  const selectAllCb = $('call-select-all');
  const camStartCb = $('call-cam-start');
  const startBtn = $('call-start-btn');
  const startCancel = $('call-start-cancel');
  const incomingModal = $('call-incoming-modal');
  const incomingText = $('call-incoming-text');
  const incomingJoin = $('call-incoming-join');
  const incomingDecline = $('call-incoming-decline');

  let ringingFrom = null; // { id, username } of an incoming call

  // ---- Start-call modal ---------------------------------------------------
  let startMode = 'start'; // 'start' = begin a call, 'invite' = ring more people mid-call
  function openStartModal(mode) {
    if (typeof socket === 'undefined' || !socket) { alert('Not connected to Headquarters yet.'); return; }
    startMode = mode === 'invite' ? 'invite' : 'start';
    // When inviting we stay in the existing call; otherwise re-opening just shows the panel.
    if (startMode === 'start' && inCall) { showPanel(); return; }
    const title = startModal.querySelector('h3');
    if (title) title.textContent = startMode === 'invite' ? 'Invite to Call' : 'Start a Call';
    if (startBtn) startBtn.textContent = startMode === 'invite' ? 'Ring' : 'Start Call';
    const online = (typeof users !== 'undefined' ? users : []).filter(u => u.id !== currentUser.id && u.status === 'online');
    memberList.innerHTML = '';
    if (!online.length) {
      memberList.innerHTML = '<div class="empty">No one else is online right now. You can still start the call and others can join.</div>';
    }
    online.forEach(u => {
      const row = document.createElement('label');
      row.className = 'call-member';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = u.id; cb.checked = true; cb.className = 'call-mem-cb';
      const img = document.createElement('img'); img.src = u.avatar || ''; img.alt = u.username;
      const name = document.createElement('span'); name.textContent = u.username;
      row.append(cb, img, name);
      memberList.appendChild(row);
    });
    selectAllCb.checked = true;
    camStartCb.checked = false;
    startModal.classList.remove('hidden');
  }
  if (selectAllCb) selectAllCb.onchange = () => {
    memberList.querySelectorAll('.call-mem-cb').forEach(cb => { cb.checked = selectAllCb.checked; });
  };
  if (startCancel) startCancel.onclick = () => startModal.classList.add('hidden');
  if (startBtn) startBtn.onclick = async () => {
    const checked = [...memberList.querySelectorAll('.call-mem-cb:checked')].map(cb => Number(cb.value));
    const allOnline = [...memberList.querySelectorAll('.call-mem-cb')].length;
    startModal.classList.add('hidden');
    // Invite mode: already in the call, just ring the selected people again.
    if (startMode === 'invite') {
      if (!checked.length) return;
      socket.emit('call_start', { targets: checked });
      addActivity(`You invited ${checked.map(getUserName).join(', ')} to the call.`);
      return;
    }
    const wantCam = !!camStartCb.checked;
    const ok = await joinCall(wantCam);
    if (!ok) return;
    // 'all' if everyone selected (also rings people who come online later view N/A);
    // otherwise just the chosen ids.
    const targets = (checked.length === allOnline && allOnline > 0) ? 'all' : checked;
    socket.emit('call_start', { targets });
    addActivity(targets === 'all' ? 'You started a call with the team.' : `You started a call with ${checked.map(getUserName).join(', ') || 'the office'}.`);
  };

  // Expose a way for app.js / quick actions to open the modal.
  window.startCall = openStartModal;

  // Ring one specific person — used by the teammate card (call / re-call).
  // Joins the call first if we aren't in one, then rings just them.
  window.callUser = async (id) => {
    if (typeof socket === 'undefined' || !socket) { alert('Not connected to Headquarters yet.'); return; }
    if (!inCall) { const ok = await joinCall(false); if (!ok) return; }
    socket.emit('call_start', { targets: [id] });
    addActivity(`📞 You rang ${getUserName(id)}.`);
  };

  // Join a call that's already in progress (no ring needed).
  window.joinOngoingCall = async () => {
    if (inCall) { showPanel(); return; }
    await joinCall(false);
  };

  // ---- Incoming call ------------------------------------------------------
  function showIncoming(from) {
    ringingFrom = from;
    incomingText.textContent = `${from.username} is calling…`;
    incomingModal.classList.remove('hidden');
    if (window.triggerNotification) {
      window.triggerNotification('Incoming Call', `${from.username} is calling you`, 'calls');
    } else if (window.electronAPI) {
      window.electronAPI.showNotification('Incoming Call', `${from.username} is calling you`);
    }
  }
  if (incomingJoin) incomingJoin.onclick = async () => {
    incomingModal.classList.add('hidden');
    if (!ringingFrom) return;
    ringingFrom = null;
    await joinCall(false);
  };
  if (incomingDecline) incomingDecline.onclick = () => {
    incomingModal.classList.add('hidden');
    if (ringingFrom && socket) socket.emit('call_decline', { target_id: ringingFrom.id });
    ringingFrom = null;
  };

  // ---- Join / leave -------------------------------------------------------
  async function joinCall(withCamera) {
    if (inCall) { showPanel(); return true; }
    try {
      const audio = selMic ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: selMic } } : AUDIO_CONSTRAINTS;
      localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (e) {
      alert('Could not access your microphone. Check permissions.');
      return false;
    }
    micOn = true; camOn = false;
    inCall = true;
    showPanel();
    addSelfTile();
    updateControls();
    refreshDeviceLists(); // labels are available now that mic permission is granted

    socket.emit('call_join');           // server replies with call_peers
    broadcastState();
    updateJoinPill();
    if (withCamera) await toggleCamera(true);
    return true;
  }

  function leaveCall() {
    if (!inCall) return;
    inCall = false;
    if (socket) socket.emit('call_leave');
    peers.forEach(p => { try { p.pc.close(); } catch (e) {} });
    peers.clear();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    grid.innerHTML = '';
    panel.classList.add('hidden');
    if (devicePanel) devicePanel.classList.add('hidden');
    [...analysers.keys()].forEach(untrackAudio);
    camOn = false; micOn = true;
    updateJoinPill();
    addActivity('You left the call.');
  }
  if (leaveBtn) leaveBtn.onclick = leaveCall;
  if (inviteBtn) inviteBtn.onclick = () => openStartModal('invite');
  if (joinPill) joinPill.onclick = () => window.joinOngoingCall();

  function showPanel() { panel.classList.remove('hidden'); }

  // Show/hide the "Join ongoing call" quick-action depending on whether a call
  // is running and we're not already in it.
  let lastRoster = [];
  function updateJoinPill() {
    if (!joinPill) return;
    const others = lastRoster.filter(id => id !== currentUser.id);
    const show = others.length > 0 && !inCall;
    joinPill.classList.toggle('hidden', !show);
    if (show) {
      const names = others.map(getUserName).filter(n => n && n !== 'Unknown');
      joinPill.innerHTML = `<span>🟢</span> Join call${names.length ? ' · ' + names.slice(0, 2).join(', ') : ''}`;
    }
  }

  // ---- Device pickers (mic / camera / speaker) ----------------------------
  async function refreshDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let devices;
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return; }
    const fill = (sel, kind, cur) => {
      if (!sel) return;
      sel.innerHTML = '';
      devices.filter(d => d.kind === kind).forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `${kind} ${i + 1}`;
        sel.appendChild(o);
      });
      if (cur) sel.value = cur;
    };
    fill(micSel, 'audioinput', selMic);
    fill(camSel, 'videoinput', selCam);
    fill(spkSel, 'audiooutput', selSpk);
  }

  if (devicesBtn) devicesBtn.onclick = async () => {
    await refreshDeviceLists();
    devicePanel.classList.toggle('hidden');
  };
  if (micSel) micSel.onchange = () => applyMic(micSel.value);
  if (camSel) camSel.onchange = async () => { selCam = camSel.value; if (camOn) { await toggleCamera(false); await toggleCamera(true); } };
  if (spkSel) spkSel.onchange = () => applySpeaker(spkSel.value);

  // Swap the mic mid-call without renegotiating (replaceTrack on each sender).
  async function applyMic(deviceId) {
    selMic = deviceId;
    if (!inCall || !localStream) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } }); }
    catch (e) { return; }
    const newTrack = stream.getAudioTracks()[0];
    if (!newTrack) return;
    newTrack.enabled = micOn;
    const old = localStream.getAudioTracks()[0];
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(newTrack);
    peers.forEach(({ pc }) => {
      const s = pc.getSenders().find(se => se.track && se.track.kind === 'audio');
      if (s) s.replaceTrack(newTrack);
    });
    trackAudio('self', localStream); // re-arm the active-speaker analyser
  }

  // Route call audio to the chosen speaker (Chromium setSinkId).
  async function applySpeaker(deviceId) {
    selSpk = deviceId;
    document.querySelectorAll('#call-grid video').forEach(v => {
      if (v.setSinkId) v.setSinkId(deviceId).catch(() => {});
    });
  }

  // ---- Active-speaker detection (Web Audio level metering) ----------------
  let audioCtx = null;
  const analysers = new Map(); // tileId -> { src, an, data }
  function trackAudio(id, stream) {
    if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      untrackAudio(id);
      const src = audioCtx.createMediaStreamSource(stream);
      const an = audioCtx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      analysers.set(id, { src, an, data: new Uint8Array(an.frequencyBinCount) });
    } catch (e) { /* analyser unavailable */ }
  }
  function untrackAudio(id) {
    const a = analysers.get(id);
    if (a) { try { a.src.disconnect(); } catch (e) {} analysers.delete(id); }
    if (analysers.size === 0 && audioCtx && audioCtx.state === 'running') {
      audioCtx.suspend();
    }
  }
  setInterval(() => {
    if (!inCall || !analysers.size) return;
    let loud = null, max = 0;
    analysers.forEach((a, id) => {
      a.an.getByteFrequencyData(a.data);
      let sum = 0;
      for (let i = 0; i < a.data.length; i++) sum += a.data[i];
      const avg = sum / a.data.length;
      if (avg > max) { max = avg; loud = id; }
    });
    document.querySelectorAll('.call-tile').forEach(t => t.classList.remove('speaking'));
    if (loud != null && max > 10) {
      const t = document.getElementById(`call-tile-${loud}`);
      if (t) t.classList.add('speaking');
    }
  }, 350);

  // ---- Peer connections (perfect negotiation) -----------------------------
  function getPeer(peerId) {
    let entry = peers.get(peerId);
    if (entry) return entry;

    const pc = new RTCPeerConnection(rtcConfig());
    // Deterministic role so glare resolves the same way on both ends.
    entry = { pc, makingOffer: false, ignoreOffer: false, polite: currentUser.id < peerId };
    peers.set(peerId, entry);

    // Send our current tracks (mic, and camera if on).
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('call_signal', { target_id: peerId, data: { description: pc.localDescription } });
      } catch (err) {
        console.error('[call] negotiation error', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('call_signal', { target_id: peerId, data: { candidate } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      addRemoteTile(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        addActivity(`Call connection to ${getUserName(peerId)} failed (NAT/firewall).`);
      }
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        // leave tiles; explicit call_peer_left handles removal.
      }
    };
    return entry;
  }

  async function handleSignal(senderId, data) {
    const entry = getPeer(senderId);
    const pc = entry.pc;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          socket.emit('call_signal', { target_id: senderId, data: { description: pc.localDescription } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (err) { if (!entry.ignoreOffer) console.error('[call] addIceCandidate', err); }
      }
    } catch (err) {
      console.error('[call] handleSignal', err);
    }
  }

  // ---- Mic / camera -------------------------------------------------------
  function updateControls() {
    if (micBtn) { micBtn.textContent = micOn ? '🎙️ Mute' : '🔇 Unmute'; micBtn.classList.toggle('off', !micOn); }
    if (camBtn) { camBtn.textContent = camOn ? '📷 Stop Video' : '📹 Start Video'; camBtn.classList.toggle('off', !camOn); }
    const selfTile = document.getElementById('call-tile-self');
    if (selfTile) {
      selfTile.classList.toggle('cam-off', !camOn);
      selfTile.classList.toggle('mic-off', !micOn);
    }
  }

  if (micBtn) micBtn.onclick = () => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    updateControls();
    broadcastState();
  };

  if (camBtn) camBtn.onclick = () => toggleCamera(!camOn);

  async function toggleCamera(on) {
    if (!inCall || !localStream) return;
    if (on) {
      let camStream;
      try {
        const video = selCam
          ? { deviceId: { exact: selCam }, width: 1280, height: 720 }
          : { width: 1280, height: 720 };
        camStream = await navigator.mediaDevices.getUserMedia({ video });
      } catch (e) {
        alert('Could not access your camera.');
        return;
      }
      const track = camStream.getVideoTracks()[0];
      if (!track) return;
      localStream.addTrack(track);
      // Add to every peer — fires negotiationneeded -> renegotiates.
      peers.forEach(({ pc }) => pc.addTrack(track, localStream));
      camOn = true;
      attachSelfVideo();
    } else {
      const tracks = localStream.getVideoTracks();
      tracks.forEach(track => {
        track.stop();
        localStream.removeTrack(track);
        peers.forEach(({ pc }) => {
          const sender = pc.getSenders().find(s => s.track === track);
          if (sender) pc.removeTrack(sender); // fires negotiationneeded
        });
      });
      camOn = false;
    }
    updateControls();
    broadcastState();
  }

  function broadcastState() {
    if (socket && inCall) socket.emit('call_state', { cam: camOn, mic: micOn });
  }

  // ---- Tiles --------------------------------------------------------------
  function makeTile(id, label) {
    let tile = document.getElementById(`call-tile-${id}`);
    if (tile) return tile;
    tile = document.createElement('div');
    tile.className = 'call-tile cam-off';
    tile.id = `call-tile-${id}`;

    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true;
    if (selSpk && video.setSinkId) video.setSinkId(selSpk).catch(() => {});

    const avatar = document.createElement('img');
    avatar.className = 'call-avatar';
    const u = (typeof users !== 'undefined' ? users : []).find(x => x.id === id);
    avatar.src = (id === 'self' ? currentUser.avatar : (u && u.avatar)) || '';

    const name = document.createElement('div');
    name.className = 'call-name';
    name.textContent = label;

    const mic = document.createElement('div');
    mic.className = 'call-mic-ind';
    mic.textContent = '🔇';

    tile.append(avatar, video, name, mic);
    grid.appendChild(tile);
    return tile;
  }

  function addSelfTile() {
    const tile = makeTile('self', 'You');
    const video = tile.querySelector('video');
    video.muted = true; // never hear yourself
    video.srcObject = localStream;
    video.onloadedmetadata = () => video.play().catch(() => {});
    tile.classList.toggle('cam-off', !camOn);
    trackAudio('self', localStream); // active-speaker metering for my own mic
  }
  function attachSelfVideo() {
    const tile = document.getElementById('call-tile-self');
    if (!tile) return;
    const video = tile.querySelector('video');
    video.srcObject = localStream;
    video.play().catch(() => {});
  }

  function addRemoteTile(peerId, stream) {
    const tile = makeTile(peerId, getUserName(peerId));
    const video = tile.querySelector('video');
    video.srcObject = stream;
    video.onloadedmetadata = () => video.play().catch(() => {});
    // Show video only if a live (unmuted) video track is present.
    const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live');
    tile.classList.toggle('cam-off', !hasVideo);
    trackAudio(peerId, stream); // active-speaker metering for this peer
  }

  function removeTile(id) {
    const tile = document.getElementById(`call-tile-${id}`);
    if (tile) tile.remove();
    untrackAudio(id);
  }

  function setTileState(peerId, state) {
    const tile = document.getElementById(`call-tile-${peerId}`);
    if (!tile) return;
    tile.classList.toggle('cam-off', !state.cam);
    tile.classList.toggle('mic-off', !state.mic);
  }

  // ---- Signaling wiring (once socket is ready) ----------------------------
  function wire() {
    socket.on('call_ringing', (data) => {
      if (inCall) return; // already busy; ignore (could auto-decline)
      showIncoming(data.from);
    });
    socket.on('call_declined', (data) => addActivity(`${data.username} declined the call.`));

    socket.on('call_peers', (data) => {
      // We're the newcomer: open a connection to everyone already in.
      (data.peers || []).forEach(pid => getPeer(pid));
    });
    socket.on('call_peer_joined', (data) => {
      if (!inCall) return;
      addActivity(`${data.username} joined the call.`);
      // Existing side also opens a connection; perfect negotiation handles glare.
      getPeer(data.id);
      broadcastState(); // let the newcomer learn our mic/cam state
    });
    socket.on('call_peer_left', (data) => {
      const entry = peers.get(data.id);
      if (entry) { try { entry.pc.close(); } catch (e) {} peers.delete(data.id); }
      removeTile(data.id);
      if (inCall) addActivity(`${getUserName(data.id)} left the call.`);
    });
    socket.on('call_signal', (data) => {
      if (!inCall) return;
      handleSignal(data.sender_id, data.data);
    });
    socket.on('call_state', (data) => setTileState(data.sender_id, data));

    // Live roster of who's in the call -> drives the "Join ongoing call" pill.
    socket.on('call_roster', (data) => {
      lastRoster = (data && data.roster) || [];
      updateJoinPill();
    });

    // If our own connection drops, wait a short grace period for auto-reconnection.
    let disconnectTimer = null;
    socket.on('disconnect', () => {
      if (inCall) {
        console.log('[call] Socket disconnected. Waiting 45s grace period before tearing down call...');
        disconnectTimer = setTimeout(() => {
          console.log('[call] Reconnection grace period expired. Leaving call.');
          leaveCall();
        }, 45000);
      }
    });
    socket.on('connect', () => {
      if (disconnectTimer) {
        console.log('[call] Socket reconnected. Clearing call teardown timer.');
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
        broadcastState(); // Sync mic/cam state with peers
      }
    });
  }

  window.callControl = {
    applyMic,
    applySpeaker,
    applyVolume: (vol) => {
      document.querySelectorAll('#call-grid video, #call-grid audio').forEach(el => {
        el.volume = Number(vol) / 100;
      });
    },
    applyCamera: async (deviceId) => {
      selCam = deviceId;
      if (camOn) {
        await toggleCamera(false);
        await toggleCamera(true);
      }
    },
    getDevicesState: () => ({ selMic, selCam, selSpk, micOn, camOn, inCall }),
    setDevicesState: (mic, cam, spk) => {
      if (mic) selMic = mic;
      if (cam) selCam = cam;
      if (spk) selSpk = spk;
    }
  };

  // Wire as soon as the socket exists (poll briefly; faster than the old 500ms
  // so an incoming ring/roster reaches us with minimal delay after login).
  const wait = setInterval(() => {
    if (typeof socket !== 'undefined' && socket) { clearInterval(wait); wire(); }
  }, 60);
})();
