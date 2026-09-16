import { useEffect, useState } from "react";
import { ChevronDown, Menu, Search, Server } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useUI } from "@/lib/ui-context";
import { Avatar, PresenceDot } from "./ui-bits";
import { CommandPalette } from "./command-palette";

export function Topbar() {
  const { currentUser, connected, setActiveView } = useApp();
  const { toggleMobileNav } = useUI();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!currentUser) return null;
  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <header className="vo-topbar">
        <button className="vo-icon-button md:hidden" onClick={toggleMobileNav} aria-label="Open navigation">
          <Menu className="size-4" />
        </button>
        <button className="vo-search" onClick={() => setPaletteOpen(true)}>
          <Search className="size-4" />
          <span>Search tasks, projects, people…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="ml-auto flex h-full items-center gap-5">
          <div className="hidden items-center gap-2 text-xs sm:flex">
            <PresenceDot status={connected ? "online" : "offline"} ring={false} showTooltip={false} />
            <span className={connected ? "text-foreground" : "text-muted-foreground"}>{connected ? "Connected" : "Reconnecting"}</span>
            <Server className="size-3.5 text-muted-foreground" />
          </div>
          <div className="h-7 w-px bg-border" />
          <button className="flex items-center gap-2.5" onClick={() => setActiveView("settings")}>
            <Avatar user={currentUser} size={34} showStatus isMe />
            <span className="hidden text-left lg:block">
              <span className="block text-xs font-semibold leading-tight">{currentUser.name}</span>
              <span className="block max-w-36 truncate text-[10px] text-muted-foreground">{currentUser.statusMessage || currentUser.designation}</span>
            </span>
            <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" />
          </button>
        </div>
      </header>
    </>
  );
}
