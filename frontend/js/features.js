// Backend-backed feature pages: Tasks, Projects, Calendar, Whiteboard, Integrations.
// Uses globals from app.js (API_URL, token, currentUser, socket, authHeaders).
// Initialized once after login via window.features.init().
(function () {
  let initialized = false;

  function api(path, opts = {}) {
    return fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { ...authHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---------------- Tasks (Kanban Board) ----------------
  let allTasksList = [];
  let allProjectsList = [];
  let activeDetailTaskId = null;

  async function loadTasks() {
    const res = await api('/api/tasks'); if (!res.ok) return;
    allTasksList = await res.json();
    
    const projRes = await api('/api/projects');
    if (projRes.ok) {
      allProjectsList = await projRes.json();
      populateProjectDropdowns(allProjectsList);
    }
    
    populateAssigneeDropdowns(users);
    renderKanbanBoard();
  }

  function populateProjectDropdowns(projects) {
    const filterProj = document.getElementById('tasks-filter-project');
    const createProj = document.getElementById('task-project');
    const detailProj = document.getElementById('td-project-select');
    
    if (filterProj) {
      filterProj.innerHTML = '<option value="">All Projects</option>';
      projects.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        filterProj.appendChild(o);
      });
    }
    
    const fillModal = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">None / Private</option>';
      projects.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        sel.appendChild(o);
      });
    };
    fillModal(createProj);
    fillModal(detailProj);
  }

  function populateAssigneeDropdowns(usersList) {
    const createAss = document.getElementById('task-assignee');
    const detailAss = document.getElementById('td-assignee-select');
    
    const fill = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">Unassigned</option>';
      usersList.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = u.username;
        sel.appendChild(o);
      });
    };
    fill(createAss);
    fill(detailAss);
  }

  function renderKanbanBoard() {
    const searchVal = (document.getElementById('tasks-search').value || '').toLowerCase();
    const priorityFilter = document.getElementById('tasks-filter-priority').value;
    const projectFilter = document.getElementById('tasks-filter-project').value;
    
    const cols = {
      todo: document.getElementById('col-todo'),
      in_progress: document.getElementById('col-in_progress'),
      review: document.getElementById('col-review'),
      completed: document.getElementById('col-completed')
    };
    
    Object.values(cols).forEach(col => { if (col) col.innerHTML = ''; });
    const counts = { todo: 0, in_progress: 0, review: 0, completed: 0 };
    
    allTasksList.forEach(t => {
      if (searchVal && !t.title.toLowerCase().includes(searchVal) && !(t.description && t.description.toLowerCase().includes(searchVal))) {
        return;
      }
      if (priorityFilter && t.priority !== priorityFilter) {
        return;
      }
      if (projectFilter && String(t.project_id) !== String(projectFilter)) {
        return;
      }
      
      const status = t.status || 'todo';
      const colEl = cols[status];
      if (colEl) {
        colEl.appendChild(createKanbanCard(t));
        counts[status]++;
      }
    });
    
    const countTodo = document.getElementById('count-todo');
    const countInProgress = document.getElementById('count-inprogress');
    const countReview = document.getElementById('count-review');
    const countCompleted = document.getElementById('count-completed');
    
    if (countTodo) countTodo.textContent = counts.todo;
    if (countInProgress) countInProgress.textContent = counts.in_progress;
    if (countReview) countReview.textContent = counts.review;
    if (countCompleted) countCompleted.textContent = counts.completed;
  }

  function createKanbanCard(t) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.dataset.id = t.id;
    card.draggable = true;
    
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', t.id);
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '1';
    });
    
    card.onclick = () => openTaskDetailModal(t.id);
    
    const priorityClass = (t.priority || 'Medium').toLowerCase();
    const assigneeName = t.assignee_id ? (users.find(u => String(u.id) === String(t.assignee_id))?.username || 'Teammate') : 'Unassigned';
    const dueDateStr = t.due_date ? new Date(t.due_date).toLocaleDateString() : '';
    
    card.innerHTML = `
      <div class="kanban-card-title">${escapeHtml(t.title)}</div>
      <div class="kanban-card-meta">
        <span class="priority-tag ${priorityClass}">${escapeHtml(t.priority || 'Medium')}</span>
        <span style="opacity: 0.85; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">👤 ${escapeHtml(assigneeName)}</span>
      </div>
      ${dueDateStr ? `<div style="font-size:10.5px; opacity:0.7; margin-top:5px;">📅 Due: ${dueDateStr}</div>` : ''}
    `;
    return card;
  }

  const taskModal = document.getElementById('task-modal');
  const taskModalForm = document.getElementById('task-modal-form');
  const newTaskBtn = document.getElementById('tasks-new-btn');
  const taskModalClose = document.getElementById('task-modal-close');
  
  if (newTaskBtn) {
    newTaskBtn.onclick = () => {
      document.getElementById('task-modal-title-text').textContent = 'Create New Task';
      taskModalForm.reset();
      taskModalForm.dataset.mode = 'create';
      taskModal.classList.remove('hidden');
    };
  }
  if (taskModalClose) {
    taskModalClose.onclick = () => taskModal.classList.add('hidden');
  }
  
  if (taskModalForm) {
    taskModalForm.onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('task-title').value.trim();
      const description = document.getElementById('task-desc').value.trim();
      const assignee_id = document.getElementById('task-assignee').value ? Number(document.getElementById('task-assignee').value) : null;
      const priority = document.getElementById('task-priority').value;
      const status = document.getElementById('task-status').value;
      const due_date = document.getElementById('task-due-date').value;
      const project_id = document.getElementById('task-project').value ? Number(document.getElementById('task-project').value) : null;
      
      const payload = { title, description, assignee_id, priority, status, due_date, project_id };
      
      if (taskModalForm.dataset.mode === 'create') {
        const res = await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          taskModal.classList.add('hidden');
          loadTasks();
        }
      } else {
        const taskId = taskModalForm.dataset.id;
        const res = await api(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          taskModal.classList.add('hidden');
          loadTasks();
          if (!document.getElementById('task-detail-modal').classList.contains('hidden')) {
            openTaskDetailModal(taskId);
          }
        }
      }
    };
  }

  const detailModal = document.getElementById('task-detail-modal');
  const detailClose = document.getElementById('td-close');
  const commentForm = document.getElementById('td-comment-form');
  const commentInput = document.getElementById('td-comment-input');
  
  if (detailClose) {
    detailClose.onclick = () => {
      detailModal.classList.add('hidden');
      activeDetailTaskId = null;
    };
  }
  
  async function openTaskDetailModal(taskId) {
    activeDetailTaskId = taskId;
    const t = allTasksList.find(x => String(x.id) === String(taskId));
    if (!t) return;
    
    document.getElementById('td-title-display').textContent = t.title;
    document.getElementById('td-desc-display').textContent = t.description || 'No description provided.';
    
    const statusSelect = document.getElementById('td-status-select');
    statusSelect.innerHTML = `
      <option value="todo">To Do</option>
      <option value="in_progress">In Progress</option>
      <option value="review">Review</option>
      <option value="completed">Completed</option>
    `;
    statusSelect.value = t.status || 'todo';
    
    const prioritySelect = document.getElementById('td-priority-select');
    prioritySelect.value = t.priority || 'Medium';
    
    const assigneeSelect = document.getElementById('td-assignee-select');
    assigneeSelect.value = t.assignee_id || '';
    
    const dueDateSelect = document.getElementById('td-due-date-select');
    dueDateSelect.value = t.due_date || '';
    
    const projectSelect = document.getElementById('td-project-select');
    projectSelect.value = t.project_id || '';
    
    statusSelect.onchange = async () => {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) });
      t.status = statusSelect.value;
      renderKanbanBoard();
      loadTaskActivities(taskId);
    };
    prioritySelect.onchange = async () => {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ priority: prioritySelect.value }) });
      t.priority = prioritySelect.value;
      renderKanbanBoard();
      loadTaskActivities(taskId);
    };
    assigneeSelect.onchange = async () => {
      const val = assigneeSelect.value ? Number(assigneeSelect.value) : null;
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ assignee_id: val }) });
      t.assignee_id = val;
      renderKanbanBoard();
      loadTaskActivities(taskId);
    };
    dueDateSelect.onchange = async () => {
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ due_date: dueDateSelect.value }) });
      t.due_date = dueDateSelect.value;
      renderKanbanBoard();
      loadTaskActivities(taskId);
    };
    projectSelect.onchange = async () => {
      const val = projectSelect.value ? Number(projectSelect.value) : null;
      await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ project_id: val }) });
      t.project_id = val;
      renderKanbanBoard();
      loadTaskActivities(taskId);
    };
    
    document.getElementById('td-edit-btn').onclick = () => {
      document.getElementById('task-modal-title-text').textContent = 'Edit Task';
      document.getElementById('task-title').value = t.title;
      document.getElementById('task-desc').value = t.description || '';
      document.getElementById('task-assignee').value = t.assignee_id || '';
      document.getElementById('task-priority').value = t.priority || 'Medium';
      document.getElementById('task-status').value = t.status || 'todo';
      document.getElementById('task-due-date').value = t.due_date || '';
      document.getElementById('task-project').value = t.project_id || '';
      
      taskModalForm.dataset.mode = 'edit';
      taskModalForm.dataset.id = t.id;
      taskModal.classList.remove('hidden');
    };
    
    document.getElementById('td-delete-btn').onclick = async () => {
      if (confirm('Are you sure you want to delete this task?')) {
        const res = await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (res.ok) {
          detailModal.classList.add('hidden');
          loadTasks();
        }
      }
    };
    
    loadTaskComments(taskId);
    loadTaskActivities(taskId);
    detailModal.classList.remove('hidden');
  }
  
  async function loadTaskComments(taskId) {
    const listEl = document.getElementById('td-comments-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="font-size:12px;opacity:0.6;">Loading comments...</div>';
    
    const res = await api(`/api/tasks/${taskId}/comments`);
    if (!res.ok) return;
    const comments = await res.json();
    
    listEl.innerHTML = comments.length ? '' : '<div style="font-size:12px;opacity:0.6;padding:5px;">No comments yet.</div>';
    comments.forEach(c => {
      const item = document.createElement('div');
      item.className = 'td-comment-item';
      const avatarSrc = c.avatar || '';
      const dateStr = new Date(c.created_at).toLocaleString();
      
      item.innerHTML = `
        <img class="td-comment-avatar" src="${escapeHtml(avatarSrc)}" onerror="this.src=''" style="object-fit:cover;">
        <div style="flex:1;">
          <div class="td-comment-meta">
            <span style="font-weight:600; color:#fff;">${escapeHtml(c.username)}</span>
            <span>${escapeHtml(dateStr)}</span>
          </div>
          <div class="td-comment-body">${escapeHtml(c.content)}</div>
        </div>
      `;
      listEl.appendChild(item);
    });
    listEl.scrollTop = listEl.scrollHeight;
  }
  
  async function loadTaskActivities(taskId) {
    const logEl = document.getElementById('td-activity-log');
    if (!logEl) return;
    logEl.innerHTML = '<div style="font-size:11px;opacity:0.6;">Loading history...</div>';
    
    const res = await api(`/api/tasks/${taskId}/activities`);
    if (!res.ok) return;
    const activities = await res.json();
    
    logEl.innerHTML = activities.length ? '' : '<div style="font-size:11px;opacity:0.6;">No activity logged.</div>';
    activities.forEach(act => {
      const item = document.createElement('div');
      const time = new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `<span style="color:var(--primary-color);">${escapeHtml(act.username)}</span> ${escapeHtml(act.detail)} <span style="opacity:0.5; font-size:9.5px;">(${time})</span>`;
      logEl.appendChild(item);
    });
  }
  
  if (commentForm) {
    commentForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!activeDetailTaskId || !commentInput.value.trim()) return;
      
      const res = await api(`/api/tasks/${activeDetailTaskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: commentInput.value.trim() })
      });
      if (res.ok) {
        commentInput.value = '';
        loadTaskComments(activeDetailTaskId);
        loadTaskActivities(activeDetailTaskId);
      }
    };
  }

  function setupKanbanDragAndDrop() {
    const containers = document.querySelectorAll('.kanban-cards-container');
    containers.forEach(container => {
      container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
      });
      container.addEventListener('dragleave', () => {
        container.classList.remove('drag-over');
      });
      container.addEventListener('drop', async (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = container.getAttribute('data-status');
        
        if (taskId && newStatus) {
          const t = allTasksList.find(x => String(x.id) === String(taskId));
          if (t && t.status !== newStatus) {
            t.status = newStatus;
            renderKanbanBoard();
            
            await api(`/api/tasks/${taskId}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: newStatus })
            });
          }
        }
      });
    });
  }

  // ---------------- Files ----------------
  let allFilesList = [];
  let transferQueue = [];

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function createFilePreview(file) {
    const box = document.createElement('div');
    box.className = 'file-preview-box';
    const mime = file.mimetype || '';
    const name = file.filename || '';
    
    if (mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = file.filepath.startsWith('http') ? file.filepath : `${API_URL}${file.filepath}`;
      img.alt = name;
      box.appendChild(img);
    } else if (mime.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = file.filepath.startsWith('http') ? file.filepath : `${API_URL}${file.filepath}`;
      vid.muted = true;
      vid.controls = true;
      box.appendChild(vid);
    } else if (mime.startsWith('audio/')) {
      const aud = document.createElement('audio');
      aud.src = file.filepath.startsWith('http') ? file.filepath : `${API_URL}${file.filepath}`;
      aud.controls = true;
      box.appendChild(aud);
    } else if (mime === 'application/pdf') {
      box.innerHTML = '<span style="font-size: 32px;">📕</span><span style="font-size: 11px; margin-top:5px; opacity:0.85;">PDF Document</span>';
    } else {
      box.innerHTML = '<span style="font-size: 32px;">📄</span><span style="font-size: 11px; margin-top:5px; opacity:0.85;">Binary File</span>';
    }
    return box;
  }

  async function loadFiles() {
    const res = await api('/api/files');
    if (!res.ok) return;
    allFilesList = await res.json();
    renderFilesGrid();
  }

  function renderFilesGrid() {
    const searchVal = (document.getElementById('files-search').value || '').toLowerCase();
    const el = document.getElementById('files-grid');
    if (!el) return;
    
    el.innerHTML = '';
    const filtered = allFilesList.filter(f => 
      f.filename.toLowerCase().includes(searchVal) || 
      (f.uploader && f.uploader.toLowerCase().includes(searchVal))
    );
    
    if (filtered.length === 0) {
      el.innerHTML = '<div class="empty">No files shared yet.</div>';
      return;
    }
    
    filtered.forEach(f => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.dataset.id = f.id;
      
      const details = document.createElement('div');
      details.className = 'file-card-details';
      
      const name = document.createElement('div');
      name.className = 'file-card-name';
      name.textContent = f.filename;
      
      const meta = document.createElement('div');
      meta.className = 'file-card-meta';
      meta.innerHTML = `
        <span>${formatBytes(f.size)}</span>
        <span>By ${escapeHtml(f.uploader || 'System')}</span>
      `;
      
      const actions = document.createElement('div');
      actions.className = 'file-card-actions';
      
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn primary';
      dlBtn.textContent = '📥 Download';
      dlBtn.onclick = (e) => {
        e.preventDefault();
        downloadFile(f);
      };
      
      const delBtn = document.createElement('button');
      delBtn.className = 'file-card-delete';
      delBtn.textContent = '🗑️';
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete "${f.filename}"?`)) {
          const res = await api(`/api/files/${f.id}`, { method: 'DELETE' });
          if (res.ok) {
            loadFiles();
          }
        }
      };
      
      actions.append(dlBtn, delBtn);
      details.append(name, meta, actions);
      
      card.append(createFilePreview(f), details);
      el.appendChild(card);
    });
  }

  function updateTransferQueueUI() {
    const panel = document.getElementById('transfer-queue-panel');
    const container = document.getElementById('queue-items');
    if (!panel || !container) return;
    
    if (transferQueue.length === 0) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    container.innerHTML = '';
    
    transferQueue.forEach(item => {
      const row = document.createElement('div');
      row.className = 'transfer-item';
      
      const info = document.createElement('div');
      info.className = 'transfer-info';
      
      const name = document.createElement('div');
      name.className = 'transfer-name';
      name.textContent = `${item.status === 'uploading' ? '📤' : '📥'} ${item.name} (${formatBytes(item.size)})`;
      
      const progressBg = document.createElement('div');
      progressBg.className = 'transfer-progress-bg';
      const progressFill = document.createElement('div');
      progressFill.className = 'transfer-progress-fill';
      progressFill.style.width = `${item.progress}%`;
      progressBg.appendChild(progressFill);
      
      const statusText = document.createElement('div');
      statusText.className = 'transfer-status';
      statusText.textContent = `${item.status.toUpperCase()} - ${item.progress}%`;
      if (item.status === 'error') statusText.style.color = '#ff6b6b';
      if (item.status === 'completed') statusText.style.color = '#2ecc71';
      
      info.append(name, progressBg, statusText);
      
      const actions = document.createElement('div');
      actions.className = 'transfer-actions';
      
      if (item.status === 'uploading' || item.status === 'downloading') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn outline';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
          if (item.xhr) item.xhr.abort();
          if (item.controller) item.controller.abort();
          item.status = 'cancelled';
          item.progress = 0;
          updateTransferQueueUI();
        };
        actions.appendChild(cancelBtn);
      } else if (item.status === 'cancelled' || item.status === 'error') {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn primary';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => {
          retryTransfer(item.id);
        };
        actions.appendChild(retryBtn);
      }
      
      row.append(info, actions);
      container.appendChild(row);
    });
  }

  function uploadFile(file) {
    const itemId = 'up_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const item = {
      id: itemId,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading',
      xhr: null,
      filePayload: file
    };
    transferQueue.push(item);
    updateTransferQueueUI();
    
    startUploadXHR(item);
  }

  function startUploadXHR(item) {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    
    const formData = new FormData();
    formData.append('file', item.filePayload);
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100);
        updateTransferQueueUI();
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        item.status = 'completed';
        item.progress = 100;
        updateTransferQueueUI();
        loadFiles();
        try {
          const data = JSON.parse(xhr.responseText);
          const fullUrl = data.url.startsWith('http') ? data.url : `${API_URL}${data.url}`;
          const recipient_id = currentConversation === 'team' ? null : currentConversation;
          if (socket) {
            socket.emit('send_message', {
              content: JSON.stringify({ filename: data.filename, url: fullUrl }),
              type: 'file',
              recipient_id
            });
          }
        } catch (e) {}
      } else {
        item.status = 'error';
        updateTransferQueueUI();
      }
    });
    
    xhr.addEventListener('error', () => {
      item.status = 'error';
      updateTransferQueueUI();
    });
    
    xhr.open('POST', `${API_URL}/api/upload`);
    const auth = authHeaders();
    Object.keys(auth).forEach(k => {
      xhr.setRequestHeader(k, auth[k]);
    });
    
    xhr.send(formData);
  }

  async function downloadFile(f) {
    const itemId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const item = {
      id: itemId,
      name: f.filename,
      size: f.size,
      progress: 0,
      status: 'downloading',
      controller: new AbortController(),
      filePayload: f
    };
    transferQueue.push(item);
    updateTransferQueueUI();
    
    startDownload(item);
  }

  async function startDownload(item) {
    const f = item.filePayload;
    try {
      const filepath = f.filepath.startsWith('http') ? f.filepath : `${API_URL}${f.filepath}`;
      const res = await fetch(filepath, {
        signal: item.controller.signal,
        headers: authHeaders()
      });
      
      if (!res.ok) throw new Error('Download failed');
      
      const reader = res.body.getReader();
      const contentLength = f.size || Number(res.headers.get('Content-Length')) || 0;
      
      let receivedLength = 0;
      const chunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (contentLength) {
          item.progress = Math.round((receivedLength / contentLength) * 100);
          updateTransferQueueUI();
        }
      }
      
      item.status = 'completed';
      item.progress = 100;
      updateTransferQueueUI();
      
      const blob = new Blob(chunks, { type: f.mimetype });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      
    } catch (err) {
      if (err.name === 'AbortError') {
        item.status = 'cancelled';
      } else {
        item.status = 'error';
      }
      updateTransferQueueUI();
    }
  }

  function retryTransfer(itemId) {
    const item = transferQueue.find(x => x.id === itemId);
    if (!item) return;
    item.progress = 0;
    
    if (item.id.startsWith('up_')) {
      item.status = 'uploading';
      updateTransferQueueUI();
      startUploadXHR(item);
    } else if (item.id.startsWith('dl_')) {
      item.status = 'downloading';
      item.controller = new AbortController();
      updateTransferQueueUI();
      startDownload(item);
    }
  }

  function setupFilesDragAndDrop() {
    const zone = document.getElementById('files-dropzone');
    const overlay = document.getElementById('drag-overlay');
    if (!zone) return;
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.remove('hidden');
    });
    
    zone.addEventListener('dragleave', () => {
      if (overlay) overlay.classList.add('hidden');
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (overlay) overlay.classList.add('hidden');
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        Array.from(files).forEach(uploadFile);
      }
    });
  }

  // ---------------- Projects ----------------
  async function loadProjects() {
    const res = await api('/api/projects'); if (!res.ok) return;
    const list = await res.json();
    const el = document.getElementById('project-list'); if (!el) return;
    el.innerHTML = list.length ? '' : '<div class="empty">No projects yet.</div>';
    list.forEach(p => el.appendChild(projectCard(p)));
  }
  function projectCard(p) {
    const card = document.createElement('div');
    card.className = 'project-card glass-panel'; card.dataset.id = p.id;
    
    const head = document.createElement('div');
    head.className = 'project-card-header';
    const h = document.createElement('h3'); h.textContent = p.name;
    const del = document.createElement('button');
    del.className = 'icon-btn card-del'; del.textContent = '🗑';
    del.onclick = () => api(`/api/projects/${p.id}`, { method: 'DELETE' });
    head.append(h, del);

    const d = document.createElement('p'); d.textContent = p.description || 'No description provided.';
    d.className = 'project-card-desc';
    
    const footer = document.createElement('div');
    footer.className = 'project-card-footer';
    const ownerBadge = document.createElement('span');
    ownerBadge.className = 'project-owner-badge';
    ownerBadge.innerHTML = `👤 ${p.owner || '—'}`;
    footer.appendChild(ownerBadge);
    
    card.append(head, d, footer);
    return card;
  }

  // ---------------- Calendar ----------------
  async function loadEvents() {
    const res = await api('/api/events'); if (!res.ok) return;
    const list = await res.json();
    const el = document.getElementById('event-list'); if (!el) return;
    el.innerHTML = list.length ? '' : '<div class="empty">No events scheduled.</div>';
    list.forEach(ev => el.appendChild(eventRow(ev)));
  }
  function eventRow(ev) {
    const row = document.createElement('div');
    row.className = 'event-card glass-panel'; row.dataset.id = ev.id;
    
    const badge = document.createElement('div');
    badge.className = 'event-cal-badge';
    
    const dObj = new Date(ev.date);
    let monthStr = 'EVT';
    let dayStr = '??';
    if (!isNaN(dObj.getTime())) {
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      monthStr = months[dObj.getMonth()];
      dayStr = dObj.getDate();
    } else {
      const parts = ev.date.split('-');
      if (parts.length === 3) {
        dayStr = parts[2];
        const mIdx = parseInt(parts[1], 10) - 1;
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        if (mIdx >= 0 && mIdx < 12) monthStr = months[mIdx];
      }
    }
    
    const mEl = document.createElement('span'); mEl.className = 'cal-month'; mEl.textContent = monthStr;
    const dEl = document.createElement('span'); dEl.className = 'cal-day'; dEl.textContent = dayStr;
    badge.append(mEl, dEl);
    
    const content = document.createElement('div');
    content.className = 'event-content';
    const title = document.createElement('h4'); title.textContent = ev.title;
    const meta = document.createElement('span'); meta.className = 'event-time-meta';
    meta.textContent = `⏰ ${ev.time || 'All Day'}`;
    content.append(title, meta);
    
    const del = document.createElement('button'); del.className = 'icon-btn event-del-btn'; del.textContent = '🗑';
    del.onclick = () => api(`/api/events/${ev.id}`, { method: 'DELETE' });
    
    row.append(badge, content, del);
    return row;
  }

  // ---------------- Whiteboard ----------------
  // Two modes:
  //   Shared  (wbShared = true)  -> collaborative team board: strokes broadcast
  //                                 + persisted, and others' strokes are drawn.
  //   Private (wbShared = false) -> a personal scratchpad: strokes stay local,
  //                                 nothing is sent, and remote strokes are
  //                                 ignored. Your private board is also kept in
  //                                 memory so toggling back and forth keeps it.
  let wbCanvas, wbCtx, drawing = false, last = null;
  let wbShared = true;
  let privateStrokes = []; // your private board, replayed on resize/return
  let wbErasing = false;
  const WB_ERASE_COLOR = '#0f1117';          // matches the canvas background
  const WB_PALETTE = ['#ffffff', '#6366f1', '#a855f7', '#0ea5e9', '#10b981',
                      '#f59e0b', '#ef4444', '#f43f5e', '#000000'];

  // Build the quick-pick color swatches and wire the eraser toggle.
  function setupWhiteboardColors() {
    const colorInput = document.getElementById('wb-color');
    const swatchWrap = document.getElementById('wb-swatches');
    const eraserBtn = document.getElementById('wb-eraser');

    const selectColor = (hex) => {
      wbErasing = false;
      if (colorInput) colorInput.value = hex;
      if (eraserBtn) eraserBtn.classList.remove('active');
      if (swatchWrap) swatchWrap.querySelectorAll('.wb-swatch').forEach(s =>
        s.classList.toggle('active', s.dataset.color === hex));
    };

    if (swatchWrap && !swatchWrap.childElementCount) {
      WB_PALETTE.forEach(hex => {
        const b = document.createElement('button');
        b.className = 'wb-swatch';
        b.dataset.color = hex;
        b.style.background = hex;
        b.title = hex;
        b.onclick = () => selectColor(hex);
        swatchWrap.appendChild(b);
      });
    }
    if (colorInput) colorInput.addEventListener('input', () => selectColor(colorInput.value));
    if (eraserBtn) eraserBtn.onclick = () => {
      wbErasing = !wbErasing;
      eraserBtn.classList.toggle('active', wbErasing);
      if (wbErasing && swatchWrap) swatchWrap.querySelectorAll('.wb-swatch').forEach(s => s.classList.remove('active'));
    };
    selectColor((colorInput && colorInput.value) || '#6366f1');
  }

  function setupWhiteboard() {
    wbCanvas = document.getElementById('wb-canvas'); if (!wbCanvas) return;
    wbCtx = wbCanvas.getContext('2d');
    setupWhiteboardColors();

    const resize = () => {
      const r = wbCanvas.parentElement.getBoundingClientRect();
      if (!r.width || !r.height) return;
      wbCanvas.width = r.width; wbCanvas.height = r.height;
      loadWhiteboard(false); // Debounced resize load
    };
    new ResizeObserver(resize).observe(wbCanvas.parentElement);

    const pos = (e) => {
      const r = wbCanvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    wbCanvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); wbCanvas.setPointerCapture(e.pointerId); });
    wbCanvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      const baseSize = +document.getElementById('wb-size').value;
      const stroke = {
        x0: last.x, y0: last.y, x1: p.x, y1: p.y,
        color: wbErasing ? WB_ERASE_COLOR : document.getElementById('wb-color').value,
        size: wbErasing ? Math.max(baseSize * 4, 16) : baseSize
      };
      drawStroke(stroke);
      if (wbShared) {
        // Shared board: broadcast + persist for everyone.
        if (typeof socket !== 'undefined' && socket) socket.emit('wb_stroke', stroke);
      } else {
        // Private board: keep locally only so we can replay it later.
        privateStrokes.push(stroke);
      }
      last = p;
    });
    const stop = () => { drawing = false; };
    wbCanvas.addEventListener('pointerup', stop);
    wbCanvas.addEventListener('pointerleave', stop);
    const clearBtn = document.getElementById('wb-clear');
    if (clearBtn) clearBtn.onclick = () => {
      wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
      if (wbShared) {
        // Clears the shared board for everyone.
        if (typeof socket !== 'undefined' && socket) socket.emit('wb_clear');
      } else {
        // Only wipes your private board.
        privateStrokes = [];
      }
    };

    const modeBtn = document.getElementById('wb-mode');
    if (modeBtn) modeBtn.onclick = () => setWhiteboardShared(!wbShared);
  }

  // Switch between the shared team board and the private scratchpad.
  function setWhiteboardShared(shared) {
    wbShared = shared;
    const btn = document.getElementById('wb-mode');
    if (btn) {
      btn.textContent = shared ? '🌐 Shared' : '🔒 Private';
      btn.classList.toggle('private', !shared);
    }
    if (!wbCtx || !wbCanvas.width) return;
    wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    if (shared) {
      loadWhiteboard(true);              // rejoin the team board immediately
    } else {
      privateStrokes.forEach(drawStroke); // restore your private board
    }
  }
  function drawStroke(s) {
    if (!wbCtx || !wbCanvas.width) return;
    wbCtx.strokeStyle = s.color; wbCtx.lineWidth = s.size; wbCtx.lineCap = 'round';
    wbCtx.beginPath();
    wbCtx.moveTo(s.x0 * wbCanvas.width, s.y0 * wbCanvas.height);
    wbCtx.lineTo(s.x1 * wbCanvas.width, s.y1 * wbCanvas.height);
    wbCtx.stroke();
  }
  let loadWhiteboardTimeout = null;
  async function loadWhiteboard(immediate = false) {
    if (!wbCtx || !wbCanvas.width) return;
    if (!wbShared) {
      wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
      privateStrokes.forEach(drawStroke);
      return;
    }
    
    if (loadWhiteboardTimeout) clearTimeout(loadWhiteboardTimeout);

    const fetchStrokes = async () => {
      try {
        const res = await api('/api/whiteboard');
        if (!res.ok) return;
        const strokes = await res.json();
        wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
        strokes.forEach(drawStroke);
      } catch (e) {
        console.error('Failed to load whiteboard:', e);
      }
    };

    if (immediate) {
      await fetchStrokes();
    } else {
      loadWhiteboardTimeout = setTimeout(fetchStrokes, 200);
    }
  }

  // ---------------- Integrations ----------------
  async function loadIntegrations() {
    const el = document.getElementById('int-drive'); if (!el) return;
    if (currentUser.role !== 'admin') { el.textContent = 'Managed by your admin'; return; }
    try {
      const res = await api('/api/admin/config');
      const d = await res.json();
      el.textContent = (d.google && d.google.configured) ? 'Connected ✓' : 'Not configured';
    } catch (e) { el.textContent = 'Unknown'; }
  }

  // ---------------- wiring ----------------
  function wireForms() {
    const searchInput = document.getElementById('tasks-search');
    if (searchInput) searchInput.oninput = renderKanbanBoard;

    const filterPriority = document.getElementById('tasks-filter-priority');
    if (filterPriority) filterPriority.onchange = renderKanbanBoard;

    const filterProject = document.getElementById('tasks-filter-project');
    if (filterProject) filterProject.onchange = renderKanbanBoard;

    const filesSearchInput = document.getElementById('files-search');
    if (filesSearchInput) filesSearchInput.oninput = renderFilesGrid;

    const fileInputEl = document.getElementById('file-input');
    if (fileInputEl) {
      fileInputEl.onchange = (e) => {
        if (e.target.files.length > 0) {
          Array.from(e.target.files).forEach(uploadFile);
          fileInputEl.value = '';
        }
      };
    }

    const clearQueueBtn = document.getElementById('queue-clear-btn');
    if (clearQueueBtn) {
      clearQueueBtn.onclick = () => {
        transferQueue = transferQueue.filter(item => item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'error');
        updateTransferQueueUI();
      };
    }

    const pf = document.getElementById('project-form');
    if (pf) pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('project-name');
      const desc = document.getElementById('project-desc');
      if (!name.value.trim()) return;
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: name.value.trim(), description: desc.value.trim() }) });
      name.value = ''; desc.value = '';
    });

    const ef = document.getElementById('event-form');
    if (ef) ef.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('event-title');
      const date = document.getElementById('event-date');
      const time = document.getElementById('event-time');
      if (!title.value.trim() || !date.value) return;
      await api('/api/events', { method: 'POST', body: JSON.stringify({ title: title.value.trim(), date: date.value, time: time.value }) });
      title.value = ''; time.value = '';
    });
  }

  function wireSocket() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.on('task_created', (t) => {
      loadTasks();
      if (window.triggerNotification && t) {
        window.triggerNotification('New Task Created', t.title || 'Untitled Task', 'tasks');
      }
    });
    socket.on('task_updated', (t) => {
      loadTasks();
      if (activeDetailTaskId && String(activeDetailTaskId) === String(t.id)) {
        openTaskDetailModal(t.id);
      }
    });
    socket.on('task_deleted', (t) => {
      loadTasks();
      if (activeDetailTaskId && String(activeDetailTaskId) === String(t.id)) {
        detailModal.classList.add('hidden');
        activeDetailTaskId = null;
      }
    });
    socket.on('task_comment_created', (comment) => {
      if (activeDetailTaskId && String(activeDetailTaskId) === String(comment.task_id)) {
        loadTaskComments(comment.task_id);
        loadTaskActivities(comment.task_id);
      }
    });
    socket.on('file_uploaded', (f) => {
      loadFiles();
      if (window.triggerNotification && f) {
        window.triggerNotification('New File Shared', f.filename || 'Untitled File', 'chat');
      }
    });
    socket.on('file_deleted', () => loadFiles());
    socket.on('project_created', () => loadProjects());
    socket.on('project_deleted', () => loadProjects());
    socket.on('event_created', (e) => {
      loadEvents();
      if (window.triggerNotification && e) {
        window.triggerNotification('New Event Created', e.title || 'Untitled Event', 'tasks');
      }
    });
    socket.on('event_deleted', () => loadEvents());
    // Ignore remote strokes while on the private board.
    socket.on('wb_stroke', (s) => { if (wbShared) drawStroke(s); });
    socket.on('wb_clear', () => { if (wbShared && wbCtx) wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height); });
  }

  function init() {
    if (initialized) return; initialized = true;
    wireForms();
    setupWhiteboard();
    setupKanbanDragAndDrop();
    setupFilesDragAndDrop();
    wireSocket();
    loadTasks(); loadProjects(); loadEvents(); loadIntegrations(); loadFiles();
    // Re-render the whiteboard when its view becomes visible (canvas gets sized).
    document.querySelectorAll('[data-view="whiteboard"]').forEach(b =>
      b.addEventListener('click', () => setTimeout(() => loadWhiteboard(true), 60)));
  }

  // ---------------- Admin Analytics Dashboard ----------------
  let analyticsPollInterval = null;

  async function loadAnalytics() {
    if (currentUser.role !== 'admin') {
      const navBtn = document.getElementById('analytics-nav');
      if (navBtn) navBtn.classList.add('hidden');
      return;
    }
    
    const navBtn = document.getElementById('analytics-nav');
    if (navBtn) navBtn.classList.remove('hidden');
    
    const res = await api('/api/admin/analytics');
    if (!res.ok) return;
    const data = await res.json();
    
    renderAnalytics(data);
  }

  function renderAnalytics(data) {
    const { sessions, logs } = data;
    const activeCount = document.getElementById('analytics-active-count');
    if (activeCount) {
      activeCount.textContent = `${sessions.length} User${sessions.length !== 1 ? 's' : ''} Connected`;
    }
    
    const tbody = document.getElementById('analytics-telemetry-rows');
    if (tbody) {
      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center; opacity:0.6;">No active workstation sessions found.</td></tr>';
      } else {
        tbody.innerHTML = '';
        sessions.forEach(s => {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          
          const userCell = document.createElement('td');
          userCell.style.padding = '10px 5px';
          userCell.style.display = 'flex';
          userCell.style.alignItems = 'center';
          userCell.style.gap = '8px';
          
          const avatar = document.createElement('img');
          avatar.src = s.avatar || '';
          avatar.onerror = () => { avatar.src = ''; };
          avatar.style.width = '24px';
          avatar.style.height = '24px';
          avatar.style.borderRadius = '12px';
          avatar.style.objectFit = 'cover';
          
          const nameSpan = document.createElement('span');
          nameSpan.textContent = s.username;
          nameSpan.style.fontWeight = '500';
          
          userCell.append(avatar, nameSpan);
          
          const locCell = document.createElement('td');
          locCell.style.padding = '10px 5px';
          locCell.textContent = s.current_label || 'Offline';
          locCell.style.color = 'var(--primary-color)';
          
          const presenceCell = document.createElement('td');
          presenceCell.style.padding = '10px 5px';
          presenceCell.innerHTML = `<span class="dot online" style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; background:#10b981;"></span>Online`;
          
          const osCell = document.createElement('td');
          osCell.style.padding = '10px 5px';
          const osText = s.os ? s.os.replace('win32', 'Windows').replace('linux', 'Linux').replace('darwin', 'macOS') : 'Desktop Client';
          osCell.textContent = `${osText} (v${s.app_version || '1.0.0'})`;
          osCell.style.opacity = '0.8';
          
          const loadCell = document.createElement('td');
          loadCell.style.padding = '10px 5px';
          const cpuVal = s.cpu_usage !== null ? Math.round(s.cpu_usage) : 0;
          const ramVal = s.ram_usage !== null ? Math.round(s.ram_usage) : 0;
          
          const cpuWarn = cpuVal > 80 ? 'color:#ef4444; font-weight:bold;' : '';
          const ramWarn = ramVal > 2048 ? 'color:#ef4444; font-weight:bold;' : '';
          
          loadCell.innerHTML = `
            <span style="${cpuWarn}">CPU: ${cpuVal}%</span> | 
            <span style="${ramWarn}">RAM: ${ramVal}MB</span>
          `;
          
          const pingCell = document.createElement('td');
          pingCell.style.padding = '10px 5px';
          const latency = s.network_quality ? parseInt(s.network_quality) : 0;
          let pingColor = '#10b981';
          if (latency > 150) pingColor = '#f59e0b';
          if (latency > 300) pingColor = '#ef4444';
          
          pingCell.innerHTML = `<span style="color:${pingColor}; font-weight:500;">${latency ? latency + 'ms' : '—'}</span>`;
          
          tr.append(userCell, locCell, presenceCell, osCell, loadCell, pingCell);
          tbody.appendChild(tr);
        });
      }
    }
    
    const logContainer = document.getElementById('analytics-log-container');
    if (logContainer) {
      if (logs.length === 0) {
        logContainer.innerHTML = '<div style="opacity:0.6; text-align:center; padding-top:20px;">No events logged.</div>';
      } else {
        logContainer.innerHTML = '';
        logs.forEach(l => {
          const item = document.createElement('div');
          item.style.padding = '8px 10px';
          item.style.background = 'rgba(255,255,255,0.02)';
          item.style.border = '1px solid rgba(255,255,255,0.04)';
          item.style.borderRadius = '6px';
          item.style.display = 'flex';
          item.style.flexDirection = 'column';
          item.style.gap = '2px';
          
          const time = new Date(l.timestamp).toLocaleString();
          let prefix = '🔵';
          let textColor = '#fff';
          
          if (l.status === 'unexpected_termination') {
            prefix = '⚠️';
            textColor = '#ff6b6b';
            item.style.background = 'rgba(239, 68, 68, 0.05)';
            item.style.borderColor = 'rgba(239, 68, 68, 0.15)';
          } else if (l.status === 'disconnected') {
            prefix = '❌';
            textColor = 'rgba(255,255,255,0.7)';
          } else if (l.status === 'connected') {
            prefix = '🟢';
            textColor = '#2ecc71';
          }
          
          item.innerHTML = `
            <div style="display:flex; justify-content:space-between; font-size:11px; opacity:0.6;">
              <span>${time}</span>
              <span>v${l.app_version || '1.0.0'}</span>
            </div>
            <div style="font-weight:500; color:${textColor};">${prefix} <span style="color:#6366f1;">${escapeHtml(l.username || 'System')}</span>: ${escapeHtml(l.reason)}</div>
          `;
          logContainer.appendChild(item);
        });
      }
    }
  }

  function startAnalyticsPolling() {
    if (analyticsPollInterval) clearInterval(analyticsPollInterval);
    loadAnalytics();
    analyticsPollInterval = setInterval(loadAnalytics, 10000);
  }

  function stopAnalyticsPolling() {
    if (analyticsPollInterval) {
      clearInterval(analyticsPollInterval);
      analyticsPollInterval = null;
    }
  }

  function reload() {
    loadTasks();
    loadProjects();
    loadEvents();
    loadIntegrations();
    loadFiles();
    loadWhiteboard(true);
    if (currentUser.role === 'admin' && !document.getElementById('analytics-view').classList.contains('hidden')) {
      loadAnalytics();
    }
  }

  window.features = { init, reload, startAnalyticsPolling, stopAnalyticsPolling };
})();
