# Virtual Office — Ubuntu/Debian Installation Guide

Welcome to the Virtual Office desktop app! This guide explains how to install and manage the application on Ubuntu, Debian, Linux Mint, Pop!_OS, or any other Debian-based Linux distribution using the provided `.deb` file.

## 1. Installation

You have been provided with a `.deb` installation file. You can install it in one of two ways:

### Option A: Graphical Install (Easiest)
1. Open your File Manager and locate the `.deb` file (e.g., `virtual-office_1.0.0_amd64.deb`).
2. Double-click the file. It will open your Software Center (or GDebi).
3. Click **Install** and enter your computer's password.

### Option B: Terminal Install
Open your terminal in the directory where the `.deb` file is located and run:
```bash
sudo apt install ./virtual-office_1.0.0_amd64.deb
```

Once installed, you can launch **Virtual Office** directly from your application menu!

---

## 2. Persistence & Autostart (Always Online)

The app is designed to ensure you never miss an office call or chat. 

- **Autostart on Login**: When you log in to your computer, the app will automatically launch in the background. It achieves this by creating a standard `.desktop` file in your system's autostart folder.
- **Background Mode**: If you click the "X" on the window to close it, the app will not exit. Instead, it will minimize to your system tray and continue running silently in the background.
- **Crash Watchdog**: If the app crashes, or if you accidentally forcefully kill it via the terminal or a system monitor, a built-in background script will instantly notice and **restart the app for you**.

---

## 3. How to Completely Quit

Because of the background watchdog, you cannot simply "kill" the app from the terminal or a task manager (it will just forcefully reopen). 

To completely quit the application:
1. Find the Virtual Office icon in your system tray (usually at the top right or bottom right of your screen).
2. Right-click the icon and select **Quit**.
3. You will be prompted to enter the administrator quit password (ask your admin if you do not know it).
4. Once you enter the password, the app will signal the watchdog to stop and will safely exit without relaunching.

---

## 4. Uninstalling the App

If you ever need to remove the app from your system, simply open your terminal and run:
```bash
sudo apt remove virtual-office
```

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| App window is blank / won't open | Open a terminal and type `virtual-office --no-sandbox`. |
| No camera/mic in calls | Grant media permissions when asked by the app; verify your PipeWire/PulseAudio sound system is running. |
