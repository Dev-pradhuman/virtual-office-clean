import type { ComponentType } from "react";
import {
  Bot, CalendarDays, Files, FolderKanban, Home, LogOut, MessageSquare,
  Phone, Puzzle, Settings2, ShieldCheck, Users, WandSparkles,
} from "lucide-react";
import { useApp, type ActiveView } from "@/lib/app-context";
import { useUI } from "@/lib/ui-context";
import { cn } from "@/lib/utils";
import { Avatar, PresenceDot } from "./ui-bits";

type NavItem = { id: ActiveView; label: string; icon: ComponentType<{ className?: string }> };
const PRIMARY: NavItem[] = [
  { id: "office", label: "Home", icon: Home },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "tasks", label: "Tasks", icon: ShieldCheck },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "files", label: "Files", icon: Files },
  { id: "team", label: "Team", icon: Users },
  { id: "call", label: "Calls", icon: Phone },
  { id: "whiteboard", label: "Whiteboard", icon: WandSparkles },
  { id: "edith", label: "Edith", icon: Bot },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function Sidebar() {
  const { currentUser, activeView, setActiveView, logout, connected } = useApp();
  const { mobileNavOpen, setMobileNavOpen } = useUI();
  if (!currentUser) return null;
  const navigation = currentUser.role === "admin"
    ? [...PRIMARY, { id: "admin" as ActiveView, label: "Admin", icon: ShieldCheck }]
    : PRIMARY;
  const go = (view: ActiveView) => { setActiveView(view); setMobileNavOpen(false); };
  return (
    <aside className={cn("vo-sidebar", mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")}>
      <div className="vo-brand">
        <div className="vo-mark"><span>V</span></div>
        <div><strong>V-OFFICE</strong><small>WORK TOGETHER<br />ANYWHERE</small></div>
      </div>

      <nav className="vo-nav" aria-label="Primary navigation">
        {navigation.map(({ id, label, icon: Icon }) => {
          const active = activeView === id;
          return (
            <button key={id} className={cn("vo-nav-item", active && "active")} onClick={() => go(id)}>
              <Icon className="size-[18px]" /><span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="vo-sidebar-quote" aria-hidden="true">
        <div className="vo-stars" />
        <p>A focused team<br />builds extraordinary<br />things.</p>
        <span />
        <small>Same space.<br />Further together.</small>
      </div>

      <div className="vo-sidebar-user">
        <Avatar user={currentUser} size={34} isMe />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-xs">{currentUser.name}</strong>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <PresenceDot status={connected ? "online" : "offline"} ring={false} showTooltip={false} />
            {connected ? "Online" : "Offline"}
          </span>
        </div>
        <button className="vo-icon-button" onClick={logout} title="Sign out"><LogOut className="size-4" /></button>
      </div>
    </aside>
  );
}
