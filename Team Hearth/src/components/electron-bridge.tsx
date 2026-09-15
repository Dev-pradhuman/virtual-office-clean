import { useEffect } from "react";

// Bridges the React renderer to the Electron main process (main.js) for the few
// desktop features that need renderer cooperation. No-op in a plain browser.
interface ElectronAPI {
  onPromptQuitPassword?: (cb: () => void) => void;
  verifyQuitPassword?: (pw: string) => Promise<{ success: boolean; error?: string }>;
}

export function ElectronBridge() {
  useEffect(() => {
    // Ask for desktop notification permission (incoming calls, DMs).
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!api?.onPromptQuitPassword) return;

    // main.js gates real quit behind an admin password; it asks the renderer to
    // collect it. (This is the same flow the watchdog/quit-gate relies on.)
    api.onPromptQuitPassword(() => {
      const pw = window.prompt("Enter the admin password to quit Virtual Office:");
      if (pw && api.verifyQuitPassword) {
        api.verifyQuitPassword(pw).then((r) => {
          if (!r.success) window.alert(r.error || "Incorrect password.");
        });
      }
    });
  }, []);

  return null;
}
