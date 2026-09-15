// Pop-out chat window. A standalone renderer that reuses the saved login
// (token + Headquarters URL) to connect a CHAT-ONLY "secondary" socket — it
// relays messages but never affects the user's online presence (the main
// window owns that). See backend/socket.js `secondary` handling.
(async function () {
  const messagesEl = document.getElementById('mini-messages');
  const dot = document.getElementById('mini-dot');
  const note = (msg) => { messagesEl.innerHTML = `<div class="m-note">${msg}</div>`; };

  // Match the theme chosen in the main app (same origin -> shared localStorage).
  try { document.body.setAttribute('data-theme', localStorage.getItem('vo_theme') || 'indigo'); } catch (e) {}

  if (!window.electronAPI || !window.electronAPI.getConfig) {
    note('Pop-out chat is only available in the desktop app.');
    return;
  }

  const cfg = await window.electronAPI.getConfig();
  if (!cfg || !cfg.token || !cfg.serverUrl) {
    note('Sign in to the app first, then re-open the pop-out chat.');
    return;
  }

  const token = cfg.token;
  const me = cfg.user || {};
  const API_URL = cfg.serverUrl.replace(/\/$/, '');
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  function addMsg(msg) {
    if (msg.id != null && messagesEl.querySelector(`[data-id="${msg.id}"]`)) return;
    const line = document.createElement('div');
    line.className = 'm-msg' + (msg.sender_id === me.id ? ' self' : '');
    if (msg.id != null) line.dataset.id = msg.id;
    const who = document.createElement('strong');
    who.textContent = msg.username + ': ';
    const text = document.createElement('span');
    if (msg.type === 'file') {
      let f = null; try { f = JSON.parse(msg.content); } catch (e) {}
      text.textContent = f ? `📎 ${f.filename}` : msg.content;
    } else {
      text.textContent = msg.content;
    }
    line.append(who, text);
    messagesEl.appendChild(line);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Load recent history.
  try {
    const res = await fetch(`${API_URL}/api/messages`, { headers: authHeaders() });
    if (res.ok) {
      messagesEl.innerHTML = '';
      (await res.json()).forEach(addMsg);
    }
  } catch (e) { /* offline; socket will still deliver live messages */ }

  // Chat-only socket connection.
  const socket = io(API_URL, { auth: { token, secondary: true } });
  socket.on('connect', () => dot.classList.add('online'));
  socket.on('disconnect', () => dot.classList.remove('online'));
  socket.on('connect_error', () => dot.classList.remove('online'));
  // Notifications are fired by the main window to avoid duplicates.
  socket.on('new_message', addMsg);

  document.getElementById('mini-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('mini-input');
    if (!input.value.trim()) return;
    socket.emit('send_message', { content: input.value });
    input.value = '';
  });

  document.getElementById('mini-close').onclick = () => window.electronAPI.closeMiniChat && window.electronAPI.closeMiniChat();
  document.getElementById('mini-open-app').onclick = () => window.electronAPI.showMainFromMini && window.electronAPI.showMainFromMini();
})();
