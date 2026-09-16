import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { apiFetch, fmtDuration, type OnlineTime } from "@/lib/api";
import type { TeamUser } from "@/lib/sample-data";
import { Modal } from "./modal";
import { Avatar, PresenceDot } from "./ui-bits";
import { Clock, MonitorSmartphone, Layers } from "lucide-react";

// Friendly labels for the app views a teammate can be on (matches ActiveView).
const VIEW_LABELS: Record<string, string> = {
  office: "Office",
  chat: "Team chat",
  call: "In a call",
  tasks: "Tasks board",
  projects: "Projects",
  calendar: "Calendar",
  whiteboard: "Whiteboard",
  files: "Files",
  integrations: "Integrations",
  edith: "Edith AI",
  settings: "Settings",
};

export function UserProfileModal({
  user,
  onClose,
}: {
  user: TeamUser;
  onClose: () => void;
}) {
  const { userActivity, userApps } = useApp();
  const [time, setTime] = useState<OnlineTime | null>(null);
  const [loading, setLoading] = useState(true);

  const activity = userActivity[user.id];
  const apps = userApps[user.id] || [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<OnlineTime>(`/api/users/${user.id}/online-time`)
      .then((t) => !cancelled && setTime(t))
      .catch(() => !cancelled && setTime(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <Modal open onClose={onClose} title="Teammate">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar user={user} size={48} />
          <PresenceDot status={user.status} className="absolute -bottom-0.5 -right-0.5 size-3" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{user.name}</div>
          <div className="text-xs text-muted-foreground truncate">{user.designation}</div>
          <div className="mt-0.5 text-[11px] capitalize text-muted-foreground">
            {user.status}
            {user.statusMessage ? ` · ${user.statusMessage}` : ""}
          </div>
        </div>
      </div>

      {/* Time online (day / week / month) */}
      <div className="mt-5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          <Clock className="size-3" /> Time online
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["day", "week", "month"] as const).map((k) => (
            <div key={k} className="rounded-lg border border-border bg-background/50 px-3 py-2 text-center">
              <div className="text-sm font-semibold tabular-nums">
                {loading ? "…" : time ? fmtDuration(time[k]) : "—"}
              </div>
              <div className="text-[10px] text-muted-foreground capitalize">
                {k === "day" ? "today" : `this ${k}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Current in-app view */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          <MonitorSmartphone className="size-3" /> Currently
        </div>
        <div className="rounded-lg border border-border bg-background/50 px-3 py-2 text-xs">
          {user.status === "offline"
            ? "Offline"
            : activity?.label ||
              (activity?.view && VIEW_LABELS[activity.view]) ||
              VIEW_LABELS[activity?.view || "office"] ||
              "In the office"}
        </div>
      </div>

      {/* Open desktop apps / windows (reported by Electron clients) */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          <Layers className="size-3" /> Open tabs & apps
        </div>
        {apps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {user.status === "offline" ? "—" : "Nothing reported."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {apps.map((a, i) => (
              <span
                key={`${a}-${i}`}
                className="rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] text-foreground/80"
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
