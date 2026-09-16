import { useApp, type ActiveView } from "@/lib/app-context";
import { Avatar, PresenceDot, PresenceLegend, SectionLabel } from "./ui-bits";
import { CHANNELS, type TeamUser } from "@/lib/sample-data";
import { cn } from "@/lib/utils";
import { useUI } from "@/lib/ui-context";
import { useEffect, useState } from "react";
import { CommandPalette } from "./command-palette";
import { UserProfileModal } from "./user-profile-modal";
import {
  LayoutDashboard,
  Phone,
  FolderKanban,
  KanbanSquare,
  CalendarDays,
  PenTool,
  Files as FilesIcon,
  Puzzle,
  Bot,
  Settings2,
  LogOut,
  Search,
} from "lucide-react";

const NAV: {
  id: ActiveView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "office", label: "Office", icon: LayoutDashboard },
  { id: "call", label: "Call", icon: Phone },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "tasks", label: "Tasks", icon: KanbanSquare },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "whiteboard", label: "Whiteboard", icon: PenTool },
  { id: "files", label: "Files", icon: FilesIcon },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "edith", label: "Edith AI", icon: Bot },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function Sidebar() {
  const { users, currentUser, activeView, setActiveView, setActiveChannel, logout } = useApp();
  const { mobileNavOpen, setMobileNavOpen } = useUI();
  // Navigate, then close the mobile drawer so the chosen view is visible.
  const go = (v: ActiveView) => {
    setActiveView(v);
    setMobileNavOpen(false);
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<TeamUser | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!currentUser) return null;
  const isAdmin = currentUser.role === "admin";

  return (
    <>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    {profileUser && (
      <UserProfileModal user={profileUser} onClose={() => setProfileUser(null)} />
    )}
    <aside
      className={cn(
        "border-r border-border/60 flex flex-col h-full bg-gradient-to-b from-card/80 via-card/50 to-card/70 backdrop-blur-xl overflow-hidden",
        // Mobile: off-canvas drawer that slides in over the content.
        "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-300 ease-out",
        mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        // Desktop: static column, always visible.
        "md:static md:z-auto md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none",
      )}
    >
      {/* Ambient sidebar glow */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full opacity-40 blur-3xl" style={{ background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute bottom-0 -right-16 size-56 rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, rgba(34,211,238,0.28), transparent 60%)" }} />

      <div className="relative p-4 border-b border-border/50 flex items-center gap-2.5">
        <div className="relative size-9 rounded-xl grid place-items-center text-white font-bold text-sm overflow-hidden" style={{ backgroundImage: "var(--grad-accent)", boxShadow: "0 8px 24px -8px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
          <span className="relative z-10 font-display">V</span>
          <span aria-hidden className="absolute inset-0 opacity-60 animate-breathe" style={{ background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.4), transparent 60%)" }} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground leading-none">
            Virtual Office
          </div>
          <div className="text-[13px] font-semibold truncate font-display tracking-tight">Team HQ</div>
        </div>
      </div>

      <div className="relative px-3 pt-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition hover:border-[color:var(--accent-1)]/50 hover:bg-background/60"
        >
          <Search className="size-3.5 group-hover:text-[color:var(--accent-1)] transition-colors" />
          <span>Search</span>
          <span className="ml-auto rounded border border-border/70 bg-background/70 px-1 py-px text-[9px] font-mono">⌘K</span>
        </button>
      </div>

      <nav className="relative flex-1 overflow-y-auto p-3 space-y-5">
        <div className="space-y-0.5">
          {NAV.map((n) => {
            const active = activeView === n.id;
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={cn(
                  "group relative w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-200",
                  active
                    ? "text-foreground font-medium"
                    : "text-foreground/70 hover:text-foreground hover:bg-foreground/5",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-lg -z-0"
                    style={{
                      background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(34,211,238,0.10))",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -12px rgba(124,58,237,0.5), 0 0 0 1px rgba(124,58,237,0.25)",
                    }}
                  />
                )}
                {active && (
                  <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full" style={{ background: "var(--grad-accent)", boxShadow: "0 0 8px rgba(124,58,237,0.7)" }} />
                )}
                <Icon className={cn("size-4 shrink-0 relative z-10 transition-colors", active && "text-[color:var(--accent-1)]")} />
                <span className="truncate relative z-10">{n.label}</span>
              </button>
            );
          })}
        </div>

        <div>
          <SectionLabel>Team · {users.length}</SectionLabel>
          <ul className="space-y-0.5">
            {users.map((u) => (
              <li
                key={u.id}
                onClick={() => {
                  setProfileUser(u);
                  setMobileNavOpen(false);
                }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-foreground/5 transition cursor-pointer"
              >
                <div className="relative">
                  <Avatar user={u} size={28} />
                  <PresenceDot
                    status={u.status}
                    className="absolute -bottom-0.5 -right-0.5 size-2.5"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium leading-tight truncate flex items-center gap-1.5">
                    {u.name}
                    {u.id === currentUser.id && (
                      <span className="text-[9px] text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {u.inCall ? (
                      <span className="font-medium accent-grad-text">
                        In call · {u.statusMessage}
                      </span>
                    ) : (
                      u.statusMessage
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <PresenceLegend className="mt-2 px-2 opacity-80" />
        </div>

        <div>
          <SectionLabel>Channels</SectionLabel>
          <ul className="space-y-0.5">
            {CHANNELS.map((c) => (
              <li
                key={c.id}
                onClick={() => {
                  setActiveChannel(c.id);
                  go("chat");
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs cursor-pointer transition",
                  c.id === "general"
                    ? "text-foreground font-medium bg-foreground/5"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <span className="opacity-60">#</span>
                <span>{c.name}</span>
                {c.unread > 0 && (
                  <span className="ml-auto rounded-full px-1.5 py-px text-[9px] font-semibold tabular-nums text-white" style={{ backgroundImage: "var(--grad-accent)", boxShadow: "0 4px 10px -4px rgba(124,58,237,0.6)" }}>
                    {c.unread}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="relative border-t border-border/50 p-3 flex items-center gap-2 bg-background/30 backdrop-blur-xl">
        <div className="flex flex-1 items-center gap-2 rounded-md p-1.5 min-w-0">
          <Avatar user={currentUser} size={28} showStatus />
          <div className="min-w-0 text-left">
            <div className="text-xs font-semibold truncate">
              {currentUser.name.split(" ")[0]}{" "}
              {isAdmin && (
                <span className="text-[9px] font-medium text-brand">Admin</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              <span className="capitalize">{currentUser.status}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => go("settings")}
          title="Settings"
          className="size-8 grid place-items-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
        >
          <Settings2 className="size-4" />
        </button>
        <button
          onClick={logout}
          title="Sign out"
          className="size-8 grid place-items-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
    </>
  );
}
