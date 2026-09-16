import { useEffect, useRef } from "react";
import { useApp } from "@/lib/app-context";
import { useCall, type CallParticipant } from "@/lib/use-call";
import { ViewHeader } from "./_header";
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, PhoneCall, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Renders one participant tile, attaching the live MediaStream to a <video>.
function Tile({ p }: { p: CallParticipant }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== p.stream) {
      ref.current.srcObject = p.stream;
    }
  }, [p.stream]);
  const showVideo = p.camOn && !!p.stream;
  return (
    <div
      className={cn(
        "relative rounded-xl overflow-hidden ring-1 ring-border aspect-video bg-[var(--surface-900)]",
        p.self && "ring-2 ring-brand",
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={p.self}
        className={cn("absolute inset-0 h-full w-full object-cover", !showVideo && "hidden")}
      />
      {!showVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="size-14 rounded-full grid place-items-center text-lg font-semibold text-white" style={{ background: "#6366f1" }}>
            {p.name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] text-white">
        <span className="rounded bg-black/50 backdrop-blur px-1.5 py-0.5 font-medium">
          {p.name.split(" ")[0]}
          {p.self && " (you)"}
        </span>
        <span className="rounded bg-black/50 backdrop-blur size-5 grid place-items-center">
          {p.micOn ? <Mic className="size-3" /> : <MicOff className="size-3" />}
        </span>
      </div>
    </div>
  );
}

export function CallView() {
  const { currentUser } = useApp();
  const { inCall, micOn, camOn, sharing, participants, join, leave, toggleMic, toggleCamera, toggleShare, ring } =
    useCall();
  if (!currentUser) return null;

  if (!inCall) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader title="Call" subtitle="Office voice & video" />
        <div className="flex-1 grid place-items-center p-6">
          <div className="text-center max-w-sm">
            <div className="mx-auto size-16 rounded-2xl bg-brand/10 grid place-items-center mb-4">
              <PhoneCall className="size-7 text-brand" />
            </div>
            <h2 className="text-lg font-semibold">Start or join the office call</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Audio connects instantly; turn on your camera or share your screen once you're in.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => join(false)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:brightness-110"
              >
                <PhoneCall className="size-4" /> Join call
              </button>
              <button
                onClick={async () => {
                  const ok = await join(false);
                  if (ok) ring("all");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                <Users className="size-4" /> Ring the team
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Office call"
        subtitle={`${participants.length} participant${participants.length === 1 ? "" : "s"}`}
        actions={
          <button
            onClick={() => ring("all")}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted"
          >
            <Users className="size-3.5" /> Ring team
          </button>
        }
      />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 p-6 flex flex-col gap-4 min-w-0">
          <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-3 content-start overflow-y-auto">
            {participants.map((p) => (
              <Tile key={p.id} p={p} />
            ))}
          </div>

          <div className="mx-auto flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
            <CtrlBtn active={micOn} onClick={toggleMic} label={micOn ? "Mic on" : "Muted"}>
              {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </CtrlBtn>
            <CtrlBtn active={camOn && !sharing} onClick={toggleCamera} label={camOn && !sharing ? "Cam on" : "Cam off"}>
              {camOn && !sharing ? <Video className="size-4" /> : <VideoOff className="size-4" />}
            </CtrlBtn>
            <CtrlBtn active={sharing} onClick={toggleShare} label={sharing ? "Stop sharing" : "Share screen"}>
              <MonitorUp className="size-4" />
            </CtrlBtn>
            <div className="w-px h-6 bg-border mx-1" />
            <button
              onClick={leave}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
            >
              <PhoneOff className="size-3.5" />
              Leave
            </button>
          </div>
        </div>

        <aside className="w-72 border-l border-border bg-card/60 flex flex-col">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">In this call</h3>
          </div>
          <ul className="p-3 space-y-2">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-muted">
                <div className="size-[30px] rounded-full grid place-items-center text-[11px] font-semibold text-white" style={{ background: "#6366f1" }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">
                    {p.name}
                    {p.self && " (you)"}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.camOn ? "Video on" : "Audio"}
                  </div>
                </div>
                {p.micOn ? (
                  <Mic className="size-3.5 text-muted-foreground" />
                ) : (
                  <MicOff className="size-3.5 text-[var(--danger)]" />
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function CtrlBtn({
  active = true,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-muted hover:bg-muted/70" : "bg-[var(--danger)]/10 text-[var(--danger)]",
      )}
    >
      {children}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
