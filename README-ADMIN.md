# 👑 Virtual Office - Administrator Setup & Deployment Guide

This guide is for **Administrators** hosting, configuring, and packaging the Virtual Office application suite.

---

## 1. Architecture Overview
Virtual Office consists of:
- **Backend Server (Node.js & Express):** Manages SQLite storage (`office.db`), JWT authentication, and active Socket.IO connections.
- **Desktop Application (Electron):** Packages the frontend assets, monitors active teammate windows via powershell scripts, and supports native features (tray minimization, autostart on system login).

---

## 2. Server Deployment (Render / Cloud Hosting)
The server is stateless and runs on an ephemeral SQLite instance or an external volume. 

### Deployment Steps:
1. **GitHub Sync:** Connect your fork `https://github.com/studytime85200-cmd/v-office` to your Render dashboard.
2. **Configuration file:** The repository contains a pre-configured [render.yaml](file:///C:/Users/Pradhuman/projects/virtual-office%20(Copy)/render.yaml) mapping the web service and its SQLite disk.
3. **Automatic Rebuilds:** Every push to the `main` branch on GitHub automatically triggers a redeploy on Render.

### Environment Variables (`.env`):
Set the following keys in your Render Environment dashboard:
```ini
PORT=10000                      # Render maps this dynamically
JWT_SECRET=your_jwt_secret_key  # Cryptographic signature salt
INITIAL_ADMIN=Pradhuman         # Username designated as global admin
```

---

## 3. Privileged Admin Controls
When logged in as the designated administrator, the Settings tab exposes gated operations:
- **Channel Configuration:** Add or prune global text/voice channels.
- **Drive Folders:** Bind shared cloud storage paths.
- **Custom Backdrops:** Set global background image overrides.

---

## 4. Compiling & Packaging Client Releases
To package client installers for distribution to members, execute the scripts from the repository root:

### Package Windows Setup Installer & Portable:
```bash
npm run build:win
```
*Outputs compiled setups to the `dist/` directory:*
- Setup: `Virtual Office Setup 1.0.0.exe`
- Portable: `Virtual Office 1.0.0.exe`

### Package Linux (.tar.gz) Archive:
```bash
npm run build:linux
```
*Outputs compiled archive to the `dist/` directory:*
- Archive: `virtual-office-1.0.0.tar.gz`

---

## 5. Security & Parity Safeguards
- **Environment Isolation:** Ensure `.env` is listed in `.gitignore` to prevent secret leaks to public repositories.
- **Hybrid Config:** Desktop client tokens are encrypted locally using Electron's native `safeStorage` API to protect session keys.

---

## ☕ Support & Tips

If you find this project helpful and want to support the creator, feel free to buy a coffee or leave a tip!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Z6M322N8OR)

