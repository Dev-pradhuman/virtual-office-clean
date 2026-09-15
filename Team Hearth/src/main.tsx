import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppProvider, useApp } from "@/lib/app-context";
import { CallProvider } from "@/lib/use-call";
import { LoginScreen } from "@/components/login-screen";
import { AppShell } from "@/components/app-shell";
import { IncomingCallPrompt } from "@/components/incoming-call";
import { ElectronBridge } from "@/components/electron-bridge";
import { Toaster } from "@/components/ui/sonner";

function Gate() {
  const { session } = useApp();
  if (!session) return <LoginScreen />;
  return (
    <CallProvider>
      <AppShell />
      <IncomingCallPrompt />
    </CallProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <Gate />
      <ElectronBridge />
      <Toaster richColors position="bottom-right" />
    </AppProvider>
  </StrictMode>,
);
