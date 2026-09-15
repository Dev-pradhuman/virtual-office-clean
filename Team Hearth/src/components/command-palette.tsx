import { useEffect, useMemo, useState } from "react";
import { useApp, type ActiveView } from "@/lib/app-context";
import { Avatar } from "./ui-bits";
import {
  LayoutDashboard,
  FolderKanban,
  KanbanSquare,
  CalendarDays,
  PenTool,
  Files as FilesIcon,
  Puzzle,
  Bot,
  Settings2,
  Video,
  MessageSquare,
  Plus,
  Search,
  CornerDownLeft,
} from "lucide-react";

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Actions" | "Message" | "Create";
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

const NAV: { id: ActiveView; label: string; icon: Item["icon"] }[] = [
  { id: "office", label: "Office", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "tasks", label: "Tasks", icon: KanbanSquare },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "whiteboard", label: "Whiteboard", icon: PenTool },
  { id: "files", label: "Files", icon: FilesIcon },
  { id: "integrations", label: "Integrations", icon: Puzzle },
  { id: "edith", label: "Edith AI", icon: Bot },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { users, setActiveView, currentUser } = useApp();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = NAV.map((n) => ({
      id: `nav-${n.id}`,
      label: `Go to ${n.label}`,
      group: "Navigate",
      icon: n.icon,
      run: () => setActiveView(n.id),
    }));
    const actions: Item[] = [
      { id: "act-call", label: "Start a call", group: "Actions", icon: Video, run: () => setActiveView("call") },
      { id: "act-chat", label: "Open team chat", group: "Actions", icon: MessageSquare, run: () => setActiveView("chat") },
      { id: "act-task", label: "Create a task", group: "Create", icon: Plus, run: () => setActiveView("tasks") },
    ];
    const dms: Item[] = users
      .filter((u) => u.id !== currentUser?.id)
      .map((u) => ({
        id: `dm-${u.id}`,
        label: `Message ${u.name}`,
        hint: u.designation,
        group: "Message",
        icon: MessageSquare,
        run: () => setActiveView("chat"),
      }));
    return [...nav, ...actions, ...dms];
  }, [users, currentUser, setActiveView]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) ||
        (i.hint?.toLowerCase().includes(needle) ?? false),
    );
  }, [items, q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = filtered[idx];
        if (it) {
          it.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, idx, onClose]);

  if (!open) return null;

  const grouped = filtered.reduce<Record<string, Item[]>>((acc, it) => {
    (acc[it.group] ??= []).push(it);
    return acc;
  }, {});

  let running = -1;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center pt-[10vh] px-4 bg-black/50 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden animate-scale-in glass-strong"
        style={{ boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.2), 0 0 60px -20px rgba(124,58,237,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Search className="size-4 text-[color:var(--accent-1)]" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page, start a call, message a teammate…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground font-display tracking-tight"
          />
          <kbd className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              Nothing matches "{q}"
            </div>
          )}
          {Object.entries(grouped).map(([group, list]) => (
            <div key={group} className="mb-1">
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                {group}
              </div>
              {list.map((it) => {
                running += 1;
                const active = running === idx;
                const Icon = it.icon;
                const user =
                  it.id.startsWith("dm-")
                    ? users.find((u) => u.id === it.id.slice(3))
                    : undefined;
                return (
                  <button
                    key={it.id}
                    onMouseEnter={((n) => () => setIdx(n))(running)}
                    onClick={() => {
                      it.run();
                      onClose();
                    }}
                    className={
                      "relative w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition " +
                      (active
                        ? "text-foreground bg-gradient-to-r from-[color:var(--accent-1)]/15 to-[color:var(--accent-2)]/5"
                        : "text-foreground/75 hover:bg-foreground/5")
                    }
                  >
                    {active && (
                      <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full" style={{ background: "var(--grad-accent)" }} />
                    )}
                    {user ? (
                      <Avatar user={user} size={22} />
                    ) : (
                      <Icon className={"size-4 " + (active ? "text-[color:var(--accent-1)]" : "text-muted-foreground")} />
                    )}
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && (
                      <span className="text-[10px] text-muted-foreground truncate">{it.hint}</span>
                    )}
                    {active && <CornerDownLeft className="size-3 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
          </div>
          <span>Virtual Office · Command palette</span>
        </div>
      </div>
    </div>
  );
}