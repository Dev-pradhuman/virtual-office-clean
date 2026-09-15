# Virtual Office — Linux Installation Guide

This document covers **installing and running** the Virtual Office desktop app on
Linux, and **building the Linux installer** from source (the reliable route,
since native modules can't be cross-compiled from Windows).

The app is an Electron desktop client that bundles its own backend and connects
to your team's Headquarters (HQ) server. Default HQ:
`https://virtual-office-hq-test.onrender.com`.

---

## 1. System requirements

| Requirement | Minimum |
|---|---|
| OS | 64-bit Linux (Ubuntu 20.04+/Debian 11+/Fedora 36+ or equivalent) |
| Architecture | x86-64 (`x64`) |
| RAM | 4 GB (8 GB recommended) |
| Disk | ~400 MB free |
| Display | X11 or Wayland (with XWayland) |
| Network | Outbound HTTPS/WebSocket to your HQ server |

### Runtime libraries

Most desktop distros already ship these. If the app fails to launch, install:

**Debian / Ubuntu**
```bash
sudo apt update
sudo apt install -y \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libdrm2 libgbm1 libasound2
```

**Fedora / RHEL**
```bash
sudo dnf install -y \
  gtk3 libnotify nss libXScrnSaver libXtst \
  xdg-utils at-spi2-core libdrm mesa-libgbm alsa-lib
```

**AppImage only** also needs FUSE:
```bash
# Debian/Ubuntu
sudo apt install -y libfuse2
# Fedora
sudo dnf install -y fuse fuse-libs
```

> Camera, microphone, and screen-share (used in Calls) require a working
> PipeWire/PulseAudio setup and browser-style media permissions, which the app
> requests at runtime.

---

## 2. Installing a prebuilt package

You will have **one** of the following artifacts from `dist/`.

### AppImage (portable — works on most distros)
```bash
chmod +x "Virtual Office-1.0.0.AppImage"
./"Virtual Office-1.0.0.AppImage"
```
No installation needed. To integrate it into your app menu, use
[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or Gear Lever.

If it won't start, run it from a terminal to see the error, and add
`--no-sandbox` if you hit a sandbox error:
```bash
./"Virtual Office-1.0.0.AppImage" --no-sandbox
```

### .deb (Debian / Ubuntu / Mint / Pop!_OS)
```bash
sudo apt install ./virtual-office_1.0.0_amd64.deb
# or:  sudo dpkg -i virtual-office_1.0.0_amd64.deb && sudo apt -f install
```
Launch from your applications menu ("Virtual Office") or run `virtual-office`.

### .rpm (Fedora / RHEL / openSUSE)
```bash
sudo dnf install ./virtual-office-1.0.0.x86_64.rpm
# or:  sudo rpm -i virtual-office-1.0.0.x86_64.rpm
```

To uninstall: `sudo apt remove virtual-office` / `sudo dnf remove virtual-office`,
or just delete the AppImage.

---

## 3. Building the Linux installer from source

**Build on Linux (or WSL2 / a Linux container).** Do not build the Linux target
on Windows — the native `sqlite3` module is compiled per-platform, and `.deb`/
`.rpm` packaging needs `fpm`, which isn't available on Windows. Building on Linux
produces correct native binaries.

### Prerequisites
- **Node.js 20.x** (`node -v` → v20). Install via [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  nvm install 20 && nvm use 20
  ```
- **Build toolchain** for compiling native modules (`sqlite3`):
  ```bash
  # Debian/Ubuntu
  sudo apt install -y build-essential python3 git
  # Fedora
  sudo dnf install -y @development-tools python3 git
  ```
- For `.rpm` output, also install `rpm-build` (`sudo apt install rpm` / it's built in on Fedora).
- `.deb`/`.rpm` packaging via electron-builder pulls `fpm` automatically on first run.

### Build steps
```bash
# 1. Clone and enter the repo
git clone https://github.com/Dev-pradhuman/v-office.git
cd v-office

# 2. Install desktop (root) dependencies — compiles sqlite3 for Linux
npm install

# 3. Install and build the React frontend (Team Hearth)
npm install --prefix "Team Hearth"

# 4. Build everything (frontend + all Linux targets: AppImage, deb, rpm)
npm run build:linux
```

Artifacts land in `dist/`:
- `Virtual Office-1.0.0.AppImage`
- `virtual-office_1.0.0_amd64.deb`
- `virtual-office-1.0.0.x86_64.rpm`

To build a single target only:
```bash
npm run build:frontend
npx electron-builder --linux AppImage      # or: deb / rpm
```

### Run from source (no packaging, for development)
```bash
npm install
npm install --prefix "Team Hearth"
npm run build:frontend
npm start            # launches Electron (adds --no-sandbox automatically)
```

---

## 4. First run

1. Launch the app.
2. On the login screen, confirm the **Headquarters Address** (defaults to the
   test HQ) or point it at your own server.
3. Sign in with your team credentials (seed users default to password
   `password123`; ask your admin).
4. Optionally tick **"Remember me on this device"** to pre-fill next time.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| App window is blank / won't open | Run from terminal; try `--no-sandbox`. Ensure GTK libs (§1) are installed. |
| `dlopen ... libnode` / sqlite errors | You built on the wrong OS. Rebuild on Linux (§3) so `sqlite3` is native. |
| AppImage: "AppImages require FUSE" | Install `libfuse2` (§1), or run with `--appimage-extract-and-run`. |
| "Failed to fetch" on login | Check the HQ address is reachable and uses `https://`. |
| No camera/mic in calls | Grant media permissions; verify PipeWire/PulseAudio is running. |

---

**Note on native modules:** This app depends on `sqlite3` (native) and the
optional `@nut-tree-fork/nut-js`. Always run `npm install` and build on the same
OS/architecture you intend to ship to.
