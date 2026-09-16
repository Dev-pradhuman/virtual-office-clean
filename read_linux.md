# Virtual Office — Linux Guide

Welcome to the Virtual Office desktop app for Linux!

## 1. Installation

You have been provided with prebuilt Linux installation files (check the `dist-linux/` folder after the build finishes). Choose the one that matches your distribution:

### AppImage (Portable — Works on most distros)
```bash
chmod +x "Virtual Office-1.0.0.AppImage"
./"Virtual Office-1.0.0.AppImage"
```
*Note: If it won't start out of the box, run it from a terminal and add `--no-sandbox` if you hit a permissions/sandbox error.*

### .deb (Ubuntu / Debian / Mint / Pop!_OS)
```bash
sudo apt install ./virtual-office_1.0.0_amd64.deb
```
Launch from your applications menu ("Virtual Office").

### .rpm (Fedora / RHEL / openSUSE)
```bash
sudo dnf install ./virtual-office-1.0.0.x86_64.rpm
```

---

## 2. Persistence & Autostart (Always Online)

The app is designed to ensure you never miss an office call or chat. 

- **Autostart on Login**: When you log in to your computer, the app will automatically launch in the background. It achieves this by creating a standard `.desktop` file in your `~/.config/autostart/` folder.
- **Background Mode**: If you click the "X" on the window to close it, the app will minimize to your system tray. It continues running silently in the background.
- **Crash Watchdog**: If the app crashes, or if you accidentally forcefully kill it via the terminal or a system monitor, a built-in background script will instantly notice and **restart the app for you**.

---

## 3. How to Completely Quit

The background watchdog may reopen the app after an unexpected process failure. The device owner can still stop recovery through normal OS administration or uninstall the app.

To turn Virtual Office off completely, open **Settings → My Preferences → Turn Off Virtual Office**.
This action appears only if the administrator has granted your account the
`can_turn_off_v_office` permission. It ends your session and keeps the client
off through restarts until you manually open it again. Closing the window
only moves the running app to the system tray.

---

## 4. Troubleshooting

| Symptom | Fix |
|---|---|
| App window is blank / won't open | Run from terminal; try `--no-sandbox`. Ensure standard GTK desktop libraries are installed. |
| AppImage: "AppImages require FUSE" | Install `libfuse2` (`sudo apt install libfuse2`) via your package manager. |
| No camera/mic in calls | Grant media permissions when asked; verify PipeWire/PulseAudio is running. |
