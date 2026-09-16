import { useEffect } from "react";

export function ElectronBridge() {
  useEffect(() => {
    // Ask for desktop notification permission (incoming calls, DMs).
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

  }, []);

  return null;
}
