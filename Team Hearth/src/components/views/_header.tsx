import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { useUI } from "@/lib/ui-context";

export function ViewHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const { toggleMobileNav } = useUI();
  return (
    <header className="relative z-10 h-14 shrink-0 border-b border-border/60 bg-background/40 backdrop-blur-xl px-4 md:px-6 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile-only menu button — opens the sidebar drawer. */}
        <button
          onClick={toggleMobileNav}
          aria-label="Open navigation menu"
          className="md:hidden -ml-1 shrink-0 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate font-display tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </header>
  );
}
