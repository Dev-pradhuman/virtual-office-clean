import { useEffect } from "react";
import { useApp } from "@/lib/app-context";
import { useCall } from "@/lib/use-call";
import { Phone, PhoneOff } from "lucide-react";

// Global incoming-call prompt. Rendered above every view so a ring reaches you
// wherever you are. Accepting jumps you into the Call view.
export function IncomingCallPrompt() {
  const { incoming, accept, decline } = useCall();
  const { setActiveView } = useApp();

  useEffect(() => {
    if (incoming && "Notification" in window && Notification.permission === "granted") {
      new Notification("Incoming call", { body: `${incoming.username} is calling…` });
    }
  }, [incoming]);

  if (!incoming) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 rounded-2xl border border-border bg-card shadow-2xl p-4 animate-scale-in">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Incoming call</div>
      <div className="mt-1 text-sm font-semibold">{incoming.username} is calling…</div>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={async () => {
            await accept();
            setActiveView("call");
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--presence-online)] py-2 text-xs font-semibold text-white hover:brightness-110"
        >
          <Phone className="size-3.5" /> Accept
        </button>
        <button
          onClick={decline}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-[var(--danger)] py-2 text-xs font-semibold text-white hover:brightness-110"
        >
          <PhoneOff className="size-3.5" /> Decline
        </button>
      </div>
    </div>
  );
}
