const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

function setupSocket(server, db, JWT_SECRET, SERVER_ID) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || `http://localhost:${process.env.PORT || 3000}`)
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  // Mirror the REST CORS policy: explicit allow-list plus any loopback origin
  // (the desktop renderer runs on http://localhost:<varying port>) and
  // no-origin clients. Loopback is always the user's own machine, so it's safe.
  const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  // Also allow the hosted web frontend (Netlify) and APK/WebView app shells, so
  // a hosted or wrapped copy of the app can open the realtime socket. Mirrors
  // the REST policy in server.js.
  const HOSTED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(netlify\.app|netlify\.live)$/i;
  const APP_SHELL_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'file://', 'null']);
  const corsOriginCheck = (origin, cb) => {
    if (!origin) return cb(null, true);
    if (
      allowedOrigins.includes(origin) ||
      LOOPBACK_ORIGIN.test(origin) ||
      HOSTED_ORIGIN.test(origin) ||
      APP_SHELL_ORIGINS.has(origin)
    ) return cb(null, true);
    return cb(new Error(`Origin not allowed by CORS: ${origin}`));
  };

  const io = new Server(server, {
    cors: { origin: corsOriginCheck },
    pingInterval: 10000,
    pingTimeout: 20000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true
    }
  });

  const onlineUsers = new Map();
  // Users currently in the voice/video call (mesh). userId -> socketId.
  const callParticipants = new Map();
  // What each online user is currently doing (which in-app tab/view).
  // userId -> { view, label }. Used for the "what is everyone working on" UI.
  const userActivity = new Map();
  // Open desktop windows/apps per user (e.g. Opera, Roblox), shown on profiles.
  // userId -> [names].
  const userApps = new Map();
  // Native control support status per user.
  // userId -> boolean.
  const userControlSupport = new Map();

  function logStatusTransition(userId, status, reason, deviceId = null, appVersion = null) {
    db.run("INSERT INTO user_status_history (user_id, status, reason, device_id, app_version) VALUES (?, ?, ?, ?, ?)", [userId, status, reason, deviceId, appVersion], (err) => {
      if (err) console.error('[presence] Failed to log status transition:', err.message);
    });
  }

  // Broadcast the current call roster so everyone can see (and join) an
  // ongoing call even if they were never rung.
  function broadcastCallRoster() {
    const roster = [...callParticipants.keys()];
    io.emit('call_roster', { roster });
  }

  // Persist a chat message and deliver it. recipient_id null = team broadcast;
  // otherwise a direct message sent only to the recipient + the sender's echo.
  function handleSendMessage(socket, data) {
    const recipientId = data && data.recipient_id ? Number(data.recipient_id) : null;
    // Team messages carry a channel (default 'general'); DMs ignore it.
    const channel = recipientId == null
      ? (data && typeof data.channel === 'string' && data.channel.trim() ? data.channel.trim() : 'general')
      : null;
    db.run("INSERT INTO messages (sender_id, content, type, recipient_id, channel) VALUES (?, ?, ?, ?, ?)",
      [socket.user.id, data.content, data.type || 'text', recipientId, channel], function (err) {
        if (err) return;
        const msg = {
          id: this.lastID,
          sender_id: socket.user.id,
          username: socket.user.username,
          content: data.content,
          type: data.type || 'text',
          recipient_id: recipientId,
          channel,
          timestamp: new Date()
        };
        if (recipientId == null) {
          io.emit('new_message', msg); // team: everyone
        } else {
          const sids = onlineUsers.get(recipientId);
          if (sids) {
            sids.forEach(sid => io.to(sid).emit('new_message', msg));
          }
          io.to(socket.id).emit('new_message', msg);       // echo to the sender
        }
      });
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error('Authentication error'));
      socket.user = decoded;
      socket.deviceId = socket.handshake.auth.deviceId || 'browser_client';
      socket.appVersion = socket.handshake.auth.appVersion || '1.0.0';
      next();
    });
  });

  io.on('connection', (socket) => {
    // Chat-only "secondary" connections (e.g. the pop-out chat window) share the
    // user's identity but must NOT affect presence — otherwise opening/closing
    // the pop-out would flap the user's online status. They can only send and
    // receive chat messages.
    if (socket.handshake.auth && socket.handshake.auth.secondary) {
      console.log(`Secondary (chat) connection: ${socket.user.username}`);
      socket.on('send_message', (data) => handleSendMessage(socket, data));
      return;
    }

    console.log(`User connected: ${socket.user.username}`);

    if (!onlineUsers.has(socket.user.id)) {
      onlineUsers.set(socket.user.id, new Set());
    }
    const isFirstConnection = onlineUsers.get(socket.user.id).size === 0;
    onlineUsers.get(socket.user.id).add(socket.id);

    if (isFirstConnection) {
      db.run("UPDATE users SET status = 'online' WHERE id = ?", [socket.user.id], () => {
        io.emit('user_status_change', { id: socket.user.id, status: 'online' });
      });
    }

    const hasControlSupport = !!socket.handshake.auth.hasControlSupport;
    userControlSupport.set(socket.user.id, hasControlSupport);
    io.emit('user_control_support', { id: socket.user.id, supported: hasControlSupport });

    const finalizeConnection = (socket) => {
      // Hand the newcomer a snapshot of who's doing what + the live call roster.
      socket.emit('activity_snapshot', [...userActivity.entries()].map(([id, a]) => ({ id, ...a })));
      socket.emit('apps_snapshot', [...userApps.entries()].map(([id, apps]) => ({ id, apps })));
      socket.emit('control_support_snapshot', [...userControlSupport.entries()].map(([id, supported]) => ({ id, supported })));
      socket.emit('call_roster', { roster: [...callParticipants.keys()] });
    };

    const createNewSession = (socket) => {
      socket.sessionId = null;
      db.run(
        "INSERT INTO sessions (user_id, server_id, device_id, app_version, last_heartbeat) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        [socket.user.id, SERVER_ID, socket.deviceId, socket.appVersion],
        function (err) {
          if (!err) {
            socket.sessionId = this.lastID;
            socket.emit('session_created', { sessionId: this.lastID });
            logStatusTransition(socket.user.id, 'launch', 'Application launched (session established)', socket.deviceId, socket.appVersion);
          }
          finalizeConnection(socket);
        }
      );
    };

    const existingSessionId = socket.handshake.auth.sessionId ? Number(socket.handshake.auth.sessionId) : null;
    if (existingSessionId) {
      db.get(
        "SELECT id, user_id, device_id FROM sessions WHERE id = ? AND ended_at IS NULL",
        [existingSessionId],
        (err, row) => {
          if (!err && row && row.user_id === socket.user.id) {
            socket.sessionId = row.id;
            db.run("UPDATE sessions SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
            socket.emit('session_created', { sessionId: row.id });
            logStatusTransition(socket.user.id, 'online', 'Session re-established (automatic reconnection)', socket.deviceId, socket.appVersion);
            finalizeConnection(socket);
          } else {
            createNewSession(socket);
          }
        }
      );
    } else {
      createNewSession(socket);
    }

    // A user tells us which tab/view they switched to; relay to everyone.
    socket.on('activity_update', (data) => {
      const view = (data && data.view) || 'office';
      const label = (data && data.label) || '';
      userActivity.set(socket.user.id, { view, label });
      io.emit('user_activity', { id: socket.user.id, view, label });
    });

    // A user reports the desktop apps/windows they currently have open.
    socket.on('apps_update', (data) => {
      const apps = Array.isArray(data && data.apps) ? data.apps.slice(0, 25) : [];
      userApps.set(socket.user.id, apps);
      io.emit('user_apps', { id: socket.user.id, apps });
    });

    socket.on('client_graceful_exit', () => {
      socket.isGracefulExit = true;
      if (socket.sessionId) {
        db.run("UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, exit_status = 'graceful', exit_reason = 'Application closed normally' WHERE id = ?", [socket.sessionId]);
      }
    });

    socket.on('report_unexpected_termination', (data) => {
      const targetUserId = data && data.userId ? Number(data.userId) : socket.user.id;
      const targetDeviceId = data && data.deviceId ? data.deviceId : socket.deviceId;
      const targetAppVersion = data && data.appVersion ? data.appVersion : socket.appVersion;

      db.get("SELECT id FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1", [targetUserId], (err, row) => {
        if (!err && row) {
          db.run("UPDATE sessions SET exit_status = 'unexpected', exit_reason = 'Application stopped unexpectedly (crash/power failure)' WHERE id = ?", [row.id]);
        }
      });
      logStatusTransition(targetUserId, 'unexpected_termination', 'Application startup recovery: previous run ended unexpectedly', targetDeviceId, targetAppVersion);
    });

    socket.on('heartbeat', (data) => {
      // Validate incoming heartbeat parameters securely to prevent spoofing
      if (!data || data.userId !== socket.user.id || data.sessionId !== socket.sessionId || data.deviceId !== socket.deviceId) {
        console.warn(`[presence] Spoofed/invalid heartbeat from ${socket.user.username}`);
        return;
      }
      
      if (socket.sessionId) {
        const stats = data.stats || {};
        db.run(
          `UPDATE sessions 
           SET last_heartbeat = CURRENT_TIMESTAMP,
               cpu_usage = ?,
               ram_usage = ?,
               os = ?,
               network_quality = ?
           WHERE id = ?`,
          [
            stats.cpu !== undefined ? Number(stats.cpu) : null,
            stats.ram !== undefined ? Number(stats.ram) : null,
            stats.os || null,
            stats.network_quality || null,
            socket.sessionId
          ]
        );
      }

      // Echo back timestamp to calculate ping RTT
      socket.emit('heartbeat_ack', { timestamp: data.timestamp });
      
      const status = (data && data.status) || 'online';
      if (status === 'away') {
        const lastAct = userActivity.get(socket.user.id);
        if (!lastAct || lastAct.view !== 'idle') {
          userActivity.set(socket.user.id, { view: 'idle', label: 'Idle' });
          io.emit('user_activity', { id: socket.user.id, view: 'idle', label: 'Idle' });
          logStatusTransition(socket.user.id, 'idle', 'System idle detected via client heartbeat', socket.deviceId, socket.appVersion);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.username}`);
      const exitStatus = socket.isGracefulExit ? 'graceful' : 'unexpected';
      const exitReason = socket.isGracefulExit ? 'Application closed normally' : 'Connection dropped unexpectedly';

      // Always close THIS connection's session for the time-online stats.
      if (socket.sessionId) {
        db.run("UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, exit_status = ?, exit_reason = ? WHERE id = ? AND ended_at IS NULL", [exitStatus, exitReason, socket.sessionId]);
      }
      
      const sids = onlineUsers.get(socket.user.id);
      if (sids) {
        sids.delete(socket.id);
        if (sids.size > 0) {
          logStatusTransition(socket.user.id, 'online', `Client disconnected (exit: ${exitStatus}). Other client(s) still active.`, socket.deviceId, socket.appVersion);
          if (callParticipants.get(socket.user.id) === socket.id) {
            callParticipants.delete(socket.user.id);
            socket.broadcast.emit('call_peer_left', { id: socket.user.id });
            broadcastCallRoster();
          }
          return;
        }
      }

      onlineUsers.delete(socket.user.id);
      userActivity.delete(socket.user.id);
      userApps.delete(socket.user.id);
      userControlSupport.delete(socket.user.id);
      io.emit('user_activity', { id: socket.user.id, view: null, label: '' });
      io.emit('user_apps', { id: socket.user.id, apps: [] });
      io.emit('user_control_support', { id: socket.user.id, supported: false });
      
      // If they were in the call, drop them and tell the others.
      if (callParticipants.delete(socket.user.id)) {
        socket.broadcast.emit('call_peer_left', { id: socket.user.id });
        broadcastCallRoster();
      }

      const finalStatus = socket.isGracefulExit ? 'closed' : 'disconnected';
      const transitionReason = socket.isGracefulExit 
        ? 'Application closed normally (exit password verified)' 
        : 'Lost connection unexpectedly (heartbeat timeout / network lost)';

      db.run("UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?", [finalStatus, socket.user.id], () => {
        io.emit('user_status_change', { id: socket.user.id, status: finalStatus, last_seen: new Date() });
        logStatusTransition(socket.user.id, finalStatus, transitionReason, socket.deviceId, socket.appVersion);
      });
    });

    socket.on('set_status', (data) => {
      db.run("UPDATE users SET status = ?, status_message = ? WHERE id = ?", [data.status, data.message, socket.user.id], () => {
        io.emit('user_status_change', { id: socket.user.id, status: data.status, message: data.message });
        logStatusTransition(socket.user.id, data.status, `User set status manually to ${data.status} with message: ${data.message || 'none'}`, socket.deviceId, socket.appVersion);
      });
    });

    socket.on('profile_update', (data) => {
      io.emit('user_profile_updated', data);
    });

    socket.on('send_message', (data) => handleSendMessage(socket, data));

    // WebRTC Signaling (mesh: each sharer streams to every viewer).
    socket.on('webrtc_offer', (data) => {
      const sids = onlineUsers.get(data.target_id);
      if (sids) {
        sids.forEach(sid => {
          io.to(sid).emit('webrtc_offer', {
            sender_id: socket.user.id,
            username: socket.user.username,
            offer: data.offer
          });
        });
      }
    });

    socket.on('webrtc_answer', (data) => {
      const sids = onlineUsers.get(data.target_id);
      if (sids) {
        sids.forEach(sid => {
          io.to(sid).emit('webrtc_answer', {
            sender_id: socket.user.id,
            answer: data.answer
          });
        });
      }
    });

    socket.on('webrtc_ice_candidate', (data) => {
      const sids = onlineUsers.get(data.target_id);
      if (sids) {
        sids.forEach(sid => {
          io.to(sid).emit('webrtc_ice_candidate', {
            sender_id: socket.user.id,
            candidate: data.candidate,
            role: data.role // 'sharer' or 'viewer'
          });
        });
      }
    });

    // Sharer stopped broadcasting — tell everyone to drop their view of them.
    socket.on('stop_screen_share', () => {
      socket.broadcast.emit('peer_stopped_sharing', { sender_id: socket.user.id });
    });

    // --- Remote control of a shared screen -------------------------------
    // A viewer asks the sharer for control; the sharer grants/denies; either
    // side can revoke. All messages are relayed 1:1 between the two users.
    const relay = (event, data, payload) => {
      const sids = onlineUsers.get(data.target_id);
      if (sids) {
        sids.forEach(sid => io.to(sid).emit(event, { sender_id: socket.user.id, ...payload }));
      }
    };

    socket.on('request_control', (data) => {
      relay('control_requested', data, { username: socket.user.username });
    });
    socket.on('grant_control', (data) => {
      relay('control_granted', data, {});
    });
    socket.on('deny_control', (data) => {
      relay('control_denied', data, {});
    });
    socket.on('revoke_control', (data) => {
      relay('control_revoked', data, {});
    });
    // Forwarded input event from controller -> sharer's machine.
    socket.on('control_input', (data) => {
      relay('control_input', data, { input: data.input });
    });

    // --- Voice / video call (mesh) ---------------------------------------
    // A single office call room. You can ring everyone or selected people;
    // whoever joins is meshed peer-to-peer (audio always, camera optional).

    // Join the call: get the list of who's already in, register, and tell the
    // existing participants someone new arrived.
    socket.on('call_join', () => {
      const peers = [...callParticipants.keys()].filter(id => id !== socket.user.id);
      callParticipants.set(socket.user.id, socket.id);
      socket.emit('call_peers', { peers });
      peers.forEach(pid => {
        const sid = callParticipants.get(pid);
        if (sid) io.to(sid).emit('call_peer_joined', { id: socket.user.id, username: socket.user.username });
      });
      broadcastCallRoster();
    });

    // Ring people (targets = 'all' or an array of user ids).
    socket.on('call_start', (data) => {
      const targets = data && data.targets;
      const ids = (targets === 'all' || !Array.isArray(targets))
        ? [...onlineUsers.keys()]
        : targets;
      ids.filter(id => id !== socket.user.id).forEach(id => {
        const sids = onlineUsers.get(id);
        if (sids) {
          sids.forEach(sid => io.to(sid).emit('call_ringing', { from: { id: socket.user.id, username: socket.user.username } }));
        }
      });
    });

    // Declined an incoming call — let the caller know.
    socket.on('call_decline', (data) => {
      const sids = onlineUsers.get(data && data.target_id);
      if (sids) {
        sids.forEach(sid => io.to(sid).emit('call_declined', { id: socket.user.id, username: socket.user.username }));
      }
    });

    // Leave the call.
    socket.on('call_leave', () => {
      if (callParticipants.delete(socket.user.id)) {
        socket.broadcast.emit('call_peer_left', { id: socket.user.id });
        broadcastCallRoster();
      }
    });

    // WebRTC signaling for the call, relayed 1:1 (carries offer/answer/ICE).
    socket.on('call_signal', (data) => {
      const sid = callParticipants.get(data && data.target_id);
      if (sid) io.to(sid).emit('call_signal', { sender_id: socket.user.id, data: data.data });
    });

    // Mic/camera on-off state, shown as overlays on each tile.
    socket.on('call_state', (data) => {
      callParticipants.forEach((sid, uid) => {
        if (uid !== socket.user.id) {
          io.to(sid).emit('call_state', { sender_id: socket.user.id, cam: !!(data && data.cam), mic: !!(data && data.mic) });
        }
      });
    });

    // --- Collaborative whiteboard ----------------------------------------
    socket.on('wb_stroke', (stroke) => {
      db.run("INSERT INTO whiteboard_strokes (data, created_by) VALUES (?, ?)", [JSON.stringify(stroke), socket.user.id]);
      socket.broadcast.emit('wb_stroke', stroke);
    });
    socket.on('wb_clear', () => {
      db.run("DELETE FROM whiteboard_strokes");
      socket.broadcast.emit('wb_clear');
    });
  });

  // Heartbeat timeout checker running every 30 seconds
  setInterval(() => {
    db.all(`
      SELECT s.id, s.user_id, s.device_id, s.app_version, u.username 
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.ended_at IS NULL 
        AND datetime(s.last_heartbeat) < datetime('now', '-90 seconds')
    `, [], (err, rows) => {
      if (err || !rows) return;
      
      rows.forEach(row => {
        console.warn(`[presence] Heartbeat timeout detected for user: ${row.username} (session ID: ${row.id})`);
        
        // Update session
        db.run(`
          UPDATE sessions 
          SET ended_at = last_heartbeat, exit_status = 'unexpected', exit_reason = 'Heartbeat timeout (unexpected disconnection / network loss)' 
          WHERE id = ?
        `, [row.id], () => {
          // Check if this user has any other active sessions
          db.get("SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND ended_at IS NULL", [row.user_id], (err, countRow) => {
            if (!err && countRow && countRow.count === 0) {
              // Mark user offline
              db.run("UPDATE users SET status = 'offline', last_seen = CURRENT_TIMESTAMP WHERE id = ?", [row.user_id], () => {
                io.emit('user_status_change', { id: row.user_id, status: 'offline', last_seen: new Date() });
                
                logStatusTransition(
                  row.user_id, 
                  'disconnected', 
                  'Lost connection unexpectedly (heartbeat timeout)', 
                  row.device_id, 
                  row.app_version
                );
              });
            }
          });
        });
      });
    });
  }, 30000);

  io.userActivity = userActivity;
  return io;
}

module.exports = setupSocket;
