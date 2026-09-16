# Virtual Office — Complete Project Summary & Handover

This single document contains **two parts**:

- **Part A — How it works & what it does** (a readable feature walkthrough).
- **Part B — Technical handover** (architecture, data/real-time contracts, run/build, known issues) for another engineer or AI to pick up the work.

---
---

# PART A — HOW IT WORKS & WHAT IT DOES

## The big picture — how it runs

It's a **desktop app (Electron) that carries its own backend inside it**. When you
launch it, `main.js` boots an Express + Socket.IO server (`backend/server.js`) *in
the same process* and opens a window pointing at `http://localhost:3000`. On one
machine it's fully self-contained — no separate server to start.

For a real team spread across machines, the **same backend is deployed once to
Render**, and each person's desktop app points at that shared URL (the
"Headquarters Address" on the login screen). The desktop app is the shell + UI;
the Render backend is the shared brain (database, presence, chat relay, WebRTC
signaling).

Two "brains" of the backend:
- **REST API** (Express) — request/response things: login, loading history, tasks, files, admin config.
- **Socket.IO** — everything live: presence, chat delivery, WebRTC signaling, whiteboard strokes.

The database is **SQLite** by default (a local `office.db` file), or **Turso/libSQL**
if you set `TURSO_DATABASE_URL` (so data survives Render's per-deploy disk wipes).

## Login & staying signed in

- Log in once with username/password. The server checks the bcrypt hash and returns a **JWT valid for 365 days**.
- Electron authenticates against the selected Headquarters and stores that token and address in `userData/vo-desktop-auth.json`, encrypted with `safeStorage` when available. The renderer also keeps its session for auto-login until sign-out.
- Login is **rate-limited** (20 attempts / 15 min per IP).
- The server URL you entered is saved, so the app reconnects to the same Headquarters each time.

## Presence — the core feature

The most engineered part. It tracks not just "online/offline" but a rich picture
of who's around and what they're doing.

**User presence states:** Online and Offline. Graceful close, crash, and network loss remain internal session/audit reasons. Users can set a custom status message without changing connection presence.

**How it stays accurate:**
- Every socket connection creates a **session row** in the DB. A user is online if *any* of their connections is alive — so a second window or the pop-out chat doesn't make you flicker.
- The client sends a **heartbeat every 30 seconds** carrying live telemetry: CPU %, RAM %, OS, and network quality (from socket round-trip ping — Excellent/Good/Fair/Poor).
- The server runs a **sweeper every 30s**: any session whose last heartbeat is older than 90 seconds is closed, and if the user has no other live sessions they're marked offline. This catches crashes and network drops that never sent a clean disconnect.
- **Graceful vs unexpected exit:** a normal close is recorded as graceful; a crash/kill as unexpected, and on next launch the app reports the previous run ended abnormally.

**"What is everyone working on":** each client broadcasts which in-app view it's on
(office, tasks, chat, etc.), shown next to each teammate.

**Open desktop apps:** on Windows, `main.js` reads the running process list and
reports which real apps/windows you have open (e.g. a browser, a game), shown on
your profile. A filter list hides OS noise.

**Time-online stats:** session rows are summed into **day / week / month** totals,
so you can see how long each person has been active.

## Team chat & direct messages

- **Team chat**: a broadcast channel everyone sees. **DMs**: one-to-one, delivered only to the recipient (plus an echo to you).
- Persisted (team history loads last 100; DM history last 200) and delivered live over Socket.IO.
- **XSS-safe**: chat is rendered as text, never HTML — no script injection.
- **Pop-out chat window**: an always-on-top mini chat (like a Meet PiP). It connects as a "secondary" socket that shares your identity but is excluded from presence, so opening/closing it never flaps your online status.
- New messages trigger **desktop notifications** and a sound.

## Screen sharing (multi-party)

- **Anyone can share, and multiple people can share at once.** WebRTC **mesh**: each sharer opens a one-directional connection (sharer → each viewer), which avoids renegotiation glare.
- You pick what to share via a **custom Electron source picker** (`desktopCapturer`) — a specific window or a full screen.
- On Windows it also captures **system/loopback audio**, so shared videos and calls are heard by viewers.
- **STUN/TURN**: STUN finds direct peer paths; TURN relays media across different home networks (the common case). The server serves an ICE config (`/api/rtc-config`), falling back to the free public **openrelay** TURN if you haven't configured your own.

## Remote control of a shared screen (permission-gated)

- While someone shares, viewers see a **"Request Control"** button. The sharer gets an **Allow/Deny** prompt. Once allowed, the controller's mouse/keyboard drive the sharer's machine; either side can release, and **Esc** stops it.
- Input injection uses the optional native library **`@nut-tree-fork/nut-js`**. If it isn't installed, the request/allow flow still works but input does nothing (logs a warning). The controlled machine acts on real OS input — trust-only.

## Voice / video calling

- A **separate WebRTC mesh** from screen sharing (independent so they don't interfere). It's a **single office call room**.
- **Ring everyone or selected people**; incoming calls show a ringing prompt to accept/decline. Anyone can also **join an ongoing call** because the server broadcasts a live **call roster**.
- Audio is captured on join (echo cancellation, noise suppression, auto-gain); **camera is opt-in** and toggles live.
- Uses **"perfect negotiation"** (polite/impolite peers) to cleanly handle several people joining at once.
- Mic/cam on-off state shows as overlays on each tile. You can pick mic/camera/speaker devices.

## Team tools (all live-synced + persisted)

All save to the database via REST and broadcast changes over Socket.IO, so
everyone's view updates instantly.

- **Tasks** — a shared board with title, description, assignee, owner, due date, priority, status (todo/in-progress/completed), project link. Each task has **comments** and a full **activity log** (created, moved, assigned, retitled, commented).
- **Projects** — a simple project list (name, description, owner, status) tasks can belong to.
- **Calendar** — team events (title, date, time). Local only — no Google/Outlook integration.
- **Whiteboard** — a collaborative canvas; strokes broadcast live and persist, so the board restores on load (and can be cleared for everyone).

## File sharing

- Uploads go to a **shared Google Drive** folder (if the admin configured Drive), made link-shareable, and recorded in the DB. Rate-limited (10/min).
- If Drive isn't configured **or an upload fails**, it **falls back to local disk** automatically — so file sharing always works.
- The team sees a live file list; new uploads trigger a notification.

## "Edith" — the assistant

- A floating assistant bubble with a chat panel, **voice output** (browser speech synthesis, tuned to a natural female voice) and **voice input** (speech recognition).
- **It's rule-based, not an LLM.** It answers canned queries — e.g. "who's online" produces a spoken/written presence summary. Not connected to any AI API.

## The office visuals

- The center shows an **office backdrop**. There's a shared backdrop image anyone can set (broadcast to everyone), plus an **auto-backdrop** that can show a different image depending on *which combination of people is currently online*.
- There's also a **Three.js 3D office scene** (procedural furniture, neon workstations that light up per person's presence, bloom effects) — decorative, historically toggled behind a static `office.png`.

## Admin capabilities

One user is admin via the `ADMIN_USERNAME` env var (nobody is admin by default).
Admins get an in-app **Settings** panel members don't see:

- **Google Drive keys** — stored server-side in `runtime-config.json`, never sent to browsers; includes a "Test Connection" button.
- **User permissions** — the admin assigns `can_turn_off_v_office` per user.
- **Update channel** for the auto-updater.
- **Analytics dashboard** — live sessions with CPU/RAM/OS/network per user.
- **Audit log** — full presence status-history (online/offline and connection/audit transitions with device + reason).

## Desktop behavior & persistence

- **System tray**: closing the window minimizes to the tray; the app keeps running. Left/double-click the tray icon to reopen.
- **Run at login**: auto-starts (hidden in the tray) on Windows/macOS login.
- **Auto-updater**: checks GitHub Releases and self-updates.
- **Intentional shutdown**: only a user with `can_turn_off_v_office` may turn the desktop client off; the main process verifies permission against Headquarters.
- **Persistence watchdog**: packaged builds recover from unexpected process failure. An authorized shutdown writes a persistent intent marker, stops recovery, and disables autostart until a visible manual launch.

## Reliability touches

- **Port fallback**: if 3000 is busy, the bundled server grabs a free port and the window follows.
- **Single-instance lock**: launching a second copy reveals the existing window instead of starting a second server.
- **Reconnection**: Socket.IO connection-state-recovery (2-min window) plus the client re-fetching users, tasks, whiteboard, and ICE config on reconnect.
- **Server heartbeat registry**: on startup the server closes sessions left open by dead server instances, avoiding "ghost" online users after a crash/redeploy.

## One honest caveat about scale

Everything real-time lives in **one process's memory** and media is **full mesh**,
so this is built for a **small trusted team (~3–10 people)**. It won't scale to
large rooms without an SFU and a Redis-backed multi-instance setup — but for a
private team headquarters the feature set is quite complete.

---
---

# PART B — TECHNICAL HANDOVER

## 1. What this project is (one line)

A **desktop team-HQ presence + collaboration client**. Not spatial (no
Gather-style world), not a Meet clone. The Electron app **bundles its own
backend**; run standalone on localhost, or point every client at one shared
Render backend.

## 2. Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron (`main.js`, `preload.js`) |
| Backend | Node.js + Express (`backend/server.js`) |
| Real-time / signaling | Socket.IO (`backend/socket.js`) |
| P2P media | WebRTC — two independent meshes (screen share + call) |
| Database | SQLite (`sqlite3`); optional **Turso/libSQL** for persistence on Render |
| Frontend | React/Vite in `Team Hearth`; vanilla `frontend/` is the fallback |
| 3D scene | Three.js (vendored under `frontend/vendor/`) |
| Auth | JWT (365-day tokens) + bcrypt |
| Native input (remote control) | `@nut-tree-fork/nut-js` (optional dependency) |
| Packaging | electron-builder (nsis/portable/AppImage/deb/rpm/dmg) |

The active build is served from `Team Hearth/dist` when present. Otherwise the backend serves `frontend/index.html` and its legacy script tags.

## 3. Repository layout

```
main.js                 Electron main — window, tray, IPC, autostart, permission-checked shutdown
                        gate, persistence watchdog, native input, desktop-source
                        picker, telemetry.
preload.js              contextBridge — exposes a safe electronAPI to the renderer.
server-only.js          Headless backend entry point (used on Render).
auth_setup.js           One-time Google Drive OAuth refresh-token helper.
updater.js              electron-updater wiring.
generate-icons.js       Icon generation helper.
render.yaml             Render deployment descriptor.
office.db               Local SQLite data (gitignored).

backend/
  server.js             Express REST API, auth/admin middleware, rate limiting,
                        uploads (Drive + local), tasks/projects/events/whiteboard,
                        admin analytics/audit, RTC config, server heartbeat.
  socket.js             Socket.IO: presence, chat/DM, WebRTC signaling (share +
                        call), remote-control relay, whiteboard, timeout sweeper.
  database.js           Schema + idempotent migrations + seed; sqlite3 OR a libSQL
                        adapter that mimics the sqlite3 run/get/all API.
  config-store.js       Server-side runtime secrets (runtime-config.json): Google
                        Drive keys and update channel.
  permissions.js        Reusable per-user permission lookup and supported keys.

Team Hearth/            React/Vite desktop renderer, built into dist/.

frontend/
  index.html            App shell (all views + all script includes).
  mini.html / js/mini.js  Always-on-top pop-out chat window.
  css/style.css
  js/app.js       (~2080 ln) auth, socket lifecycle, presence, chat, backdrop,
                            profile/settings, heartbeat/telemetry, views.
  js/features.js  (~1334 ln) tasks, projects, calendar, whiteboard, admin analytics.
  js/webrtc.js    (~665 ln)  screen-share mesh + remote control.
  js/call.js      (~620 ln)  voice/video mesh (perfect negotiation).
  js/edith.js     (~468 ln)  rule-based assistant + speech synth/recognition.
  js/office3d.js / js/office-room.js  Three.js decorative office scene.
  vendor/         Vendored Three.js build (offline-safe).
  assets/         Icons, office.png backdrop.
```

Frontend modules communicate through **module-level globals shared via `window`**
(`currentUser`, `token`, `socket`, `users`, plus helpers like `getUserName`,
`addActivity`). There is no state-management layer.

## 4. Data model (SQLite / libSQL)

Created and migrated in `backend/database.js` (`initDb`). Tables:

- **users** — `id, username (unique), password_hash, avatar, role ('member'|'admin'), last_seen, status, status_message, current_project, designation`.
- **messages** — `id, sender_id, content, type, recipient_id (NULL = team broadcast; else DM), timestamp`.
- **files** — `id, uploader_id, filename, filepath (URL or /uploads/...), mimetype, size, timestamp`.
- **tasks** — `id, title, description, done, assignee_id, owner_id, due_date, priority, status, project_id, created_by, created_at`.
- **task_comments**, **task_activities**, **task_attachments** — task detail/audit trail.
- **projects** — `id, name, description, status, owner_id, created_at`.
- **events** — calendar: `id, title, date, time, created_by, created_at`.
- **whiteboard_strokes** — `id, data (JSON stroke), created_by, created_at` (replayed on load; grows unbounded).
- **sessions** — one row per socket connection; drives presence + time-online: `user_id, started_at, ended_at, server_id, last_heartbeat, exit_status, exit_reason, device_id, app_version, cpu_usage, ram_usage, os, network_quality`.
- **user_status_history** — presence audit log (admin).
- **servers** — heartbeat registry for detecting dead server instances.
- **settings** — key/value (office backdrop image, per-online-combo auto-backdrops `autobg:<comboKey>`).

**Seeding:** if `users` is empty, seeds `Arjun`, `Aviral`, `Pradhuman`, each with
password `password123`. `ADMIN_USERNAME` (env) promotes one user to `admin` on
every boot.

**Persistence choice:** if `TURSO_DATABASE_URL` is set, uses Turso/libSQL (survives
Render deploys). Otherwise a local `office.db` (`userData/office.db` under
Electron, or `./office.db` headless). The libSQL adapter preserves the
`this.lastID`/`this.changes` callback contract so app code is identical either way.

## 5. REST API (all under `/api`, JWT `Bearer` required unless noted)

`requireAuth` verifies the token and sets `req.user = { id, username }`. **The JWT
only contains `id` + `username`** — not `role` or `avatar`. Admin routes use the
`requireAdmin` middleware, which looks up the role in the DB.

- `POST /api/login` (no auth, rate-limited) → `{ token, user }`.
- `POST /api/change-password` (auth).
- `POST /api/update-profile` (auth) — username/avatar/designation/password.
- `GET  /api/users` (auth) — roster.
- `GET  /api/rtc-config` (auth) — ICE servers (STUN + resolved TURN).
- `GET  /api/users/:id/online-time` (auth) — day/week/month seconds online.
- `GET/POST /api/office-image` (auth) — shared backdrop URL.
- `GET/POST /api/auto-backdrop` (auth) — per-"who's online" backdrop images.
- `GET  /api/messages` (auth) — team history (last 100).
- `GET  /api/messages/dm/:id` (auth) — DM history (last 200).
- `POST /api/upload` (auth, rate-limited) — Google Drive w/ local fallback.
- `GET  /api/files`, `DELETE /api/files/:id` (auth).
- `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` (auth).
- `GET/POST /api/tasks/:id/comments`, `GET /api/tasks/:id/activities` (auth).
- `GET/POST /api/projects`, `DELETE /api/projects/:id` (auth).
- `GET/POST /api/events`, `DELETE /api/events/:id` (auth).
- `GET  /api/whiteboard` (auth) — saved strokes.
- `GET/POST /api/admin/config`, `POST /api/admin/config/test` (auth + **admin**) — Drive keys / update channel.
- `GET  /api/admin/audit-log` (auth + **admin**).
- `GET  /api/admin/analytics` (auth + **admin**) — live sessions + recent status logs.
- `GET  /api/download-app` (no auth) — redirects to a GitHub Releases page.

REST mutations others must see immediately also `io.emit(...)` a socket event
(e.g. `task_created`, `file_uploaded`, `office_image_changed`).

## 6. Socket.IO events (contract)

Handshake auth: `{ token, deviceId, appVersion, sessionId, hasControlSupport, secondary }`.
A `secondary: true` connection (pop-out chat) shares identity but does **not**
affect presence and can only send/receive chat.

**Presence / session**
- server→client: `user_status_change`, `user_activity`, `user_apps`, `user_control_support`, `activity_snapshot`, `apps_snapshot`, `control_support_snapshot`, `session_created`, `heartbeat_ack`.
- client→server: `heartbeat` (validated against socket identity), `activity_update`, `apps_update`, `set_status_message`, `profile_update`, `client_graceful_exit`, `report_unexpected_termination`.

**Chat**
- `send_message` (client→server); `new_message` (server→client). `recipient_id` NULL = team, else DM.

**Screen share (WebRTC mesh, one-directional sharer→viewer)**
- `webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate` (relayed 1:1 by target user id), `stop_screen_share` → `peer_stopped_sharing`.

**Remote control (relayed 1:1 between the two users)**
- `request_control`→`control_requested`, `grant_control`→`control_granted`, `deny_control`→`control_denied`, `revoke_control`→`control_revoked`, `control_input`→`control_input`.

**Voice/video call (separate mesh)**
- `call_join`→`call_peers`; `call_peer_joined`/`call_peer_left`; `call_start`→`call_ringing`; `call_decline`→`call_declined`; `call_leave`; `call_signal` (offer/answer/ICE 1:1); `call_state` (mic/cam indicators); `call_roster` (broadcast so anyone can join an ongoing call).

**Whiteboard**
- `wb_stroke` (persisted + broadcast), `wb_clear`.

Server-side in-memory maps (single process): `onlineUsers`, `callParticipants`,
`userActivity`, `userApps`, `userControlSupport`. A 30s interval sweeps sessions
whose `last_heartbeat` is older than 90s and marks users offline.

## 7. Configuration & environment

`.env` (gitignored; `.env.example` documents it):
- `JWT_SECRET` — token signing key. If unset, the server generates+persists one at `backend/jwt-secret.key`. **On Render you must set it** (disk wiped per deploy).
- `ALLOWED_ORIGINS` — comma-separated CORS/socket origin allowlist.
- `PORT` — optional; Render sets it. If unset and 3000 is busy, falls back to a free port.
- `ADMIN_USERNAME` — promotes that user to `admin`.
- `TURN_SERVERS` (JSON array) **or** `TURN_URL`+`TURN_USERNAME`+`TURN_PASSWORD` — TURN config; falls back to free openrelay.
- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` — enable Turso persistence.

Admin-set settings (Google Drive keys and update channel) live in a
**server-side** `runtime-config.json` via `backend/config-store.js` — never sent
to the browser. Members hold no secrets.

Electron's verified Headquarters session lives in `userData/vo-desktop-auth.json`
with `safeStorage` encryption when available. The legacy renderer also stores
its local machine settings in `userData/vo_config.json`; the React renderer
stores its UI session and preferences locally.

## 8. Running & building

```bash
npm install
cp .env.example .env         # set JWT_SECRET, ALLOWED_ORIGINS at minimum

npm start                    # Electron app + bundled backend (localhost:3000)
npm run start:server         # headless backend only (server-only.js) — for Render

npm run build                # package for current OS (electron-builder)
npm run build:win            # Windows installer
npm run build:linux          # Linux AppImage/deb/rpm
```

Node 18+. After a major Electron upgrade, rebuild native modules:
`npx electron-rebuild -f`. Default login: seeded users with `password123`.

## 9. Presence and intentional shutdown

The client stays Online while its primary Socket.IO connection and heartbeat session
are alive. Closing the desktop window hides it in the tray. Disconnect, crash, and
heartbeat timeout make the user Offline when no other live session remains;
the reason is retained in session and audit records.

The administrator manages `can_turn_off_v_office` for each user through Settings.
The permission is stored in `user_permissions`, separate from Admin/Member roles.
Electron performs desktop login itself and pins the authenticated token and
Headquarters address. On full exit it sends that stored Bearer token to
`/api/desktop/shutdown-authorization`; renderer-supplied tokens or addresses
cannot authorize shutdown.
Only a granted user gets the **Turn Off Virtual Office** action. It emits a
graceful-exit event, disconnects, writes `userData/vo-intentional-shutdown.json`
and `userData/vo-watchdog.stop`, disables login autostart, and exits.

Packaged builds still use the detached watchdog and OS keep-alive task for
unexpected failures. Both respect the intentional-shutdown marker. Hidden
autostart launches respect it too. A visible manual launch clears the marker
and stop flag, rearms recovery, and restores normal autostart.

## 10. Recent bug fixes

Applied to the backend (all verified via `node --check`):

1. **`/api/admin/analytics` always returned 403** — it checked `req.user.role`, but the JWT has no `role`. Now uses the `requireAdmin` middleware (DB role check), like every other admin route. (`backend/server.js`)
2. **Task comments broadcast with `avatar: undefined`** — the POST handler read `req.user.avatar` (not in the JWT). Now fetches `username`+`avatar` from the DB before emitting, matching the GET endpoint's JOIN shape. (`backend/server.js`)
3. **Seeding could throw on a DB error** — `if (row.count === 0)` had no guard. Added `if (err || !row) { log; return; }`. (`backend/database.js`)

Shared root cause of (1) and (2): the login JWT only encodes `{ id, username }`. A
future cleanup could add `role` (and maybe `avatar`) to the token — but that only
takes effect after users re-login, which is why the fixes stayed server-side.

## 11. Known issues / caveats

- **Mesh media won't scale.** Screen share and calls are full O(n²) WebRTC meshes. Fine for ~3–10 people; needs an SFU (mediasoup/LiveKit) for real rooms.
- **Single-process real-time state.** `onlineUsers`, `callParticipants`, the rate-limiter Map, etc. are in-memory. The app **cannot be horizontally scaled** as-is (two Render instances → split-brain presence, broken cross-instance signaling). Would need the Redis Socket.IO adapter.
- **Monolithic frontend with global state.** `app.js` (2080 ln) + `features.js` (1334 ln) share mutable globals via `window`; no framework/state layer.
- **Duplicated WebRTC/ICE config** in `webrtc.js` and `call.js` (both hardcode openrelay TURN). openrelay is shared/overloaded — replace with a dedicated TURN for production.
- **365-day JWTs, no revocation/rotation.** A leaked token is valid for a year.
- **No spatial model / rooms** — calls and shares are a single global room.
- **Calendar is local-only** (an `events` table); no Google/Outlook integration.
- **Edith is rule-based**, not connected to any LLM.
- **Whiteboard strokes grow unbounded** (row per stroke, replayed on load).
- **Runtime and build artifacts** are gitignored in the cleaned source repository; generated local files still need normal operational cleanup.
- **Docs drift:** the README's project layout omits `call.js` and `edith.js`.
- **Migrations** are repeated `ALTER TABLE ... catch()` at boot — pragmatic but unversioned/fragile.

## 12. Suggested next steps (if growing it)

1. Add `role` to the JWT (removes a class of the bugs above).
2. Refactor the frontend into modules with a small state store.
3. Introduce an SFU + Redis Socket.IO adapter if scale matters.
4. Stand up a dedicated TURN server; unify the two ICE configs.
5. Add a versioned migration system and gitignore `office.db` / `dist*`.
6. Add automated tests (there are currently none).
```
