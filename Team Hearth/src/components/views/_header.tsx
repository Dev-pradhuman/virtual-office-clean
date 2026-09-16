import type { ReactNode } from "react";

export function ViewHeader({ title, subtitle, eyebrow, actions, compact = false }: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return <header className="vo-compact-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="flex items-center gap-2">{actions}</div></header>;
  }
  return (
    <header className="vo-page-header">
      <div className="relative z-10 min-w-0">
        <div className="vo-eyebrow">{eyebrow || title.toUpperCase()}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="relative z-10 flex shrink-0 items-center gap-2 self-end pb-1">{actions}</div>}
    </header>
  );
}
