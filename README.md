# Virtual Office

A private desktop "headquarters" for a small team — real-time presence, team chat,
file sharing, and multi-party screen sharing — built with Electron, Node.js,
Express, Socket.IO, WebRTC, and SQLite.

> This repo is a **template**. Anyone who clones it runs their **own** backend
> (locally and/or on their own Render service) with their **own** secrets.
> No credentials are bundled in the repo.

---

## Features

- **3D Virtual Headquarters** — a live 3D office (Three.js) with a desk + monitor + avatar per teammate; desks glow and monitors switch on as people come online. Drag to look around, scroll to zoom. Falls back to 2D cards if WebGL is unavailable.
- **Real-time presence** — status updates over Socket.IO.
- **Team chat** — real-time messaging with history (rendered safely, no HTML injection).
- **Multi-party screen sharing** — anyone can broadcast to everyone, multiple screens at once (WebRTC mesh).
- **Remote control (permission-gated)** — a viewer can request control of a shared screen; the sharer must explicitly allow it, and either side can release at any time.
- **Team tools** — shared **Tasks** board, **Projects** list, **Calendar** events, and a collaborative **Whiteboard**, all persisted in SQLite and synced live over Socket.IO.
- **File sharing** — optional uploads to Google Drive.
- **Desktop notifications** + system tray + run-on-startup.
- **Persistent login** — sign in once per machine; Electron keeps the authenticated Headquarters session in encrypted local storage when the OS supports it.

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron |
| Backend | Node.js + Express |
| Real-time / signaling | Socket.IO |
| Peer-to-peer media | WebRTC |
| Database | SQLite |
| Frontend | React/Vite (`Team Hearth`), with a vanilla fallback (`frontend`) |
| 3D scene | Three.js (vendored under `frontend/vendor/`) |

---

## How it works

The Electron app **both** serves the frontend and bundles the backend, so it runs
fully on one machine out of the box (`http://localhost:3000`). For a team spread
across machines, you deploy the backend once (Render) and each person points their
desktop app at that shared **Headquarters Address**.

```
Desktop app (Electron) ──serves──> Frontend (localhost:3000)
        │
        └──connects to──> Backend (local OR your Render URL)
                              ├── Express REST API + SQLite
                              └── Socket.IO (presence, chat, WebRTC signaling)
```

---

## 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A [Render](https://render.com/) account (only if you want a shared/always-on backend)
- (Optional) A Google Cloud project, for Google Drive file uploads

## 2. Clone & install

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
```

## 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

- `JWT_SECRET` — generate your own:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `ALLOWED_ORIGINS` — keep `http://localhost:3000` and add your Render URL once you have it.

Google Drive uploads are optional — see the comments in `.env.example`
(`node auth_setup.js` generates the refresh token). If you skip it, everything
except file upload works.

## 4. Get the backend working (do this first)

**Local (single machine / testing):**
```bash
npm start          # launches the Electron app + the bundled backend
```
The default Headquarters Address `http://localhost:3000` already points at this
bundled backend, so login works immediately.

**Headless backend only (for development):**
```bash
npm run start:server   # runs Express + Socket.IO without the desktop GUI
```

### Deploy your own backend to Render (for a real team)

Each team runs **their own** backend. On Render:

1. **New → Web Service**, connect this repo.
2. **Build command:** `npm install`
3. **Start command:** `node server-only.js`
4. **Environment variables:**
   - `JWT_SECRET` — a long random string (see `.env.example`).
   - `ALLOWED_ORIGINS` — include `http://localhost:3000` (the desktop app's
     origin) **and** your `https://<your-app>.onrender.com` URL.
   - `ADMIN_USERNAME` — the username allowed to open the in-app **Settings**
     panel and configure API keys (e.g. Google Drive). No one is admin unless
     you set this.
   - You do **not** need to set `PORT`; Render provides it.
   - You do **not** need the Google vars here — the admin sets those in the app.
5. Deploy. Your backend is now at `https://<your-app>.onrender.com`.

> ⚠️ Always set `JWT_SECRET` on Render. If it's unset, the server generates a
> random one on each restart and everyone gets logged out on every deploy.

## 5. Connect the frontend (desktop app)

1. Run `npm start`.
2. In the login screen, set **Headquarters Address** to your backend URL
   (e.g. `https://<your-app>.onrender.com`, or leave `http://localhost:3000` for local).
3. Log in. Electron pins the authenticated Headquarters session for permission
   checks, and the renderer keeps its login until you sign out.

---

## Roles: one admin, everyone else just connects

There are two kinds of user:

- **Members** — install the app, enter the Headquarters Address, and log in.
  They never touch any keys, API config, or `.env`. The client holds no secrets.
  Each member can set their own password from the dashboard (click your profile
  in the sidebar → **Change Password**), so the seeded default isn't shared.
- **Admin** — one designated user who can open the in-app **Settings** panel to
  configure shared API keys (e.g. Google Drive). You choose the admin by setting
  `ADMIN_USERNAME` (see above) to an existing username. No one is admin by
  default, and the Settings menu is hidden for everyone else.

### Configuring Google Drive (admin, in-app)

1. In Google Cloud Console, create an **OAuth client ID (Desktop)**.
2. Run once to get a refresh token: `node auth_setup.js` (open the link, paste
   the code it returns).
3. Open the app as the admin → **Settings → Google Drive** → enter the Client
   ID, Client Secret, Refresh Token, and Drive Folder ID → **Save**, then
   **Test Connection**. Uploads now work for the whole team.

Keys entered here are stored **on the server** (a gitignored `runtime-config.json`),
never on members' machines, and are never sent back to the browser.

## Default users

`backend/database.js` seeds three demo users on first run (empty DB), each with
the password `password123`. **Change these for your own team:** edit the seed
list in `backend/database.js` before first run, and have each person change their
password. The SQLite file (`office.db`) is created automatically and is gitignored.

---

## The 3D office (and swapping in real models)

> **Currently parked:** the centre shows a static office image
> (`frontend/assets/office.png`) while the 3D scene is iterated on. Re-enable the
> live 3D by uncommenting the import map + `js/office3d.js` module script at the
> bottom of `frontend/index.html` (and removing the `#office-image`).

The office is a Three.js scene with bloom post-processing and procedural
furniture (warm wood floor, dark walls, neon "TEAM HQ" sign, whiteboard, sofa
lounge, bookshelf, plants) plus three neon-themed workstations
(Aviral = green, Arjun = blue, Pradhuman = purple) that light up with presence.

`frontend/js/office-room.js` builds each element from a small factory and tags
it (`userData.asset = "<name>"`), so any placeholder can be replaced with a real
GLTF model without touching the rest of the scene:

```js
// e.g. drop a downloaded CC0 model into frontend/vendor/models/ then:
window.office3d.loadModel('sofa', '/vendor/models/sofa.glb', { scale: 1.2, rotationY: Math.PI });
```

Swappable asset names: `floor, walls, neon-sign, whiteboard, rug, sofa,
coffee-table, bookshelf, plant`. Until a model is provided, the procedural
placeholder is used, so the office always renders.

## Remote control

While someone shares their screen, others see a **🖱 Request Control** button on
that screen's tile. The sharer gets an Allow/Deny prompt; once allowed, the
controller's mouse and keyboard drive the sharer's machine. Press **Esc** (or
**Release Control**) to stop; the sharer can hit **Stop** on the red banner.

Actually moving the remote cursor / typing requires a native input library on
the machine being controlled. It's listed as an **optional dependency**, so a
normal `npm install` will try to build it and silently skip it if it can't:

```bash
npm install @nut-tree-fork/nut-js   # (re)install explicitly if needed
```

If the library isn't present, the request/allow flow still works but input does
nothing (the app logs a one-time warning). Notes:
- Control maps best to a **full-screen** share (a single-window share moves the
  real cursor across the whole screen).
- The controlled machine acts on real OS input — only allow people you trust.

## Build a distributable app

```bash
npm run build         # current OS
npm run build:win     # Windows installer
npm run build:linux   # Linux AppImage
```

---

## Security notes

- Secrets live only in `.env` (gitignored) and your Render env vars — never in the repo.
- Login tokens are JWT-signed with your `JWT_SECRET`. Electron stores its
  verified Headquarters token encrypted with `safeStorage` when available;
  the renderer currently also keeps its session token in local storage.
- REST endpoints (`/api/users`, `/api/messages`, `/api/upload`) require a valid token.
- CORS is restricted to `ALLOWED_ORIGINS`.
- Chat content is rendered as text (no HTML/script injection).

### Known / accepted advisories

`npm audit` reports a moderate issue in **`file-type`** (an infinite loop when
parsing a malformed ASF media file). It is pulled in transitively by
`@nut-tree-fork/nut-js` → `jimp` and **cannot be patched** without breaking
nut-js (every fixed `file-type` release is ESM-only and incompatible with the
`jimp` version nut-js pins). It is **not reachable** here: the app uses nut-js
only for mouse/keyboard/screen control, never image matching, and never parses
untrusted media. Accepted until nut-js ships a newer `jimp`. All other audit
findings (Electron CVEs, `tar`, the `node-gyp` toolchain) were resolved by
upgrading `electron`, `electron-builder`, `sqlite3`, and `bcryptjs`.

> After a major Electron upgrade, rebuild native modules so they match
> Electron's ABI: `npx electron-rebuild -f`

## Project layout

```
main.js              Electron shell — window, tray, auto-start, IPC
preload.js           Secure bridge to the renderer
server-only.js       Backend entry point for cloud hosting (Render)
auth_setup.js        One-time Google Drive OAuth refresh-token helper
backend/
  server.js          Express REST API + auth/admin middleware
  socket.js          Socket.IO presence, chat, WebRTC signaling
  database.js        SQLite schema + seed (+ ADMIN_USERNAME promotion)
  config-store.js    Server-side runtime config (admin-set API keys)
frontend/
  index.html         App shell
  css/style.css
  js/app.js          Auth, chat, presence, uploads, profile/settings
  js/features.js     Tasks, Projects, Calendar, Whiteboard (REST + live sync)
  js/webrtc.js       Multi-party screen sharing (mesh) + remote control
  js/office3d.js     3D office scene (Three.js): camera, bloom, presence
  js/office-room.js  Modular room (floor/walls/sofa/whiteboard/plants/...)
  vendor/            Vendored Three.js build + addons (offline-safe)
```

## License

ISC

---

## ☕ Support & Tips

If you find this project helpful and want to support the creator, feel free to buy a coffee or leave a tip!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Z6M322N8OR)

