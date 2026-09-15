import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PresenceStatus, TeamUser } from "@/lib/sample-data";
import { breathePhaseDelayMs, initPresenceTiming } from "@/lib/presence-timing";

const PRESENCE_DESCRIPTIONS: Record<PresenceStatus, string> = {
  online: "Online — available for chat and calls",
  away: "Away — stepped out, notifications are delayed",
  busy: "Busy — do not disturb",
  offline: "Offline — not connected right now",
};

// Publish the shared presence timing config as CSS custom properties so
// keyframes in styles.css stay in lockstep with the numbers used by React.
initPresenceTiming();

export function PresenceDot({
  status,
  className,
  ring = true,
  showTooltip = true,
}: {
  status: PresenceStatus;
  className?: string;
  ring?: boolean;
  showTooltip?: boolean;
}) {
  const cssVar =
    status === "online"
      ? "var(--presence-online)"
      : status === "away"
        ? "var(--presence-away)"
        : status === "busy"
          ? "var(--presence-busy)"
          : "var(--presence-offline)";

  // Pulse-then-settle on status change (skip first mount).
  const prev = useRef<PresenceStatus | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (prev.current !== null && prev.current !== status) {
      setPulseKey((k) => k + 1);
    }
    prev.current = status;
  }, [status]);

  const animate = pulseKey > 0;

  // Phase-lock the continuous breathe animation across every dot in the app
  // (sidebar, roster, call tiles) using a shared clock offset.
  const breatheDelay = status === "online" ? `${breathePhaseDelayMs()}ms` : undefined;

  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipId = useId();
  const description = PRESENCE_DESCRIPTIONS[status];

  return (
    <span
      role="img"
      aria-label={`status: ${status}`}
      aria-describedby={showTooltip ? tooltipId : undefined}
      tabIndex={showTooltip ? 0 : -1}
      className={cn(
        "relative inline-flex size-2.5 items-center justify-center align-middle outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-1)] focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full",
        className,
      )}
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => setTooltipOpen(true)}
      onBlur={() => setTooltipOpen(false)}
    >
      {/* Expanding halo — plays once per status change */}
      {animate && (
        <span
          key={`halo-${pulseKey}`}
          aria-hidden
          className="absolute inset-0 rounded-full presence-halo"
          style={{ background: cssVar }}
        />
      )}
      {/* Dot core — gentle scale-settle on change; continuous soft breathe for online */}
      <span
        key={`core-${status}-${pulseKey}`}
        className={cn(
          "relative inline-block size-full rounded-full presence-core",
          status === "online" && "presence-breathe",
          ring && "ring-2 ring-background",
        )}
        style={{
          background: cssVar,
          boxShadow: `0 0 0 0 ${cssVar}`,
          animationDelay: breatheDelay,
        }}
      />
      {/* Hover / focus tooltip explaining the exact status meaning */}
      {showTooltip && tooltipOpen && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-lg animate-scale-in origin-top"
        >
          {description}
        </span>
      )}
    </span>
  );
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  busy: "Busy",
  offline: "Offline",
};

/**
 * Compact legend explaining what each presence dot color means.
 * Uses the same `PresenceDot` so users see the exact colors + animations
 * that appear next to teammates.
 */
export function PresenceLegend({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  const statuses: PresenceStatus[] = ["online", "away", "busy", "offline"];
  return (
    <div
      role="list"
      aria-label="Presence status legend"
      className={cn(
        "flex text-[10px] text-muted-foreground",
        orientation === "horizontal"
          ? "flex-wrap items-center gap-x-3 gap-y-1"
          : "flex-col gap-1",
        className,
      )}
    >
      {statuses.map((s) => (
        <div key={s} role="listitem" className="flex items-center gap-1.5">
          <PresenceDot status={s} ring={false} className="size-2" showTooltip={false} />
          <span>{PRESENCE_LABELS[s]}</span>
        </div>
      ))}
    </div>
  );
}

export function Avatar({
  user,
  size = 32,
  showStatus = false,
  className,
  isMe = false,
}: {
  user: TeamUser;
  size?: number;
  showStatus?: boolean;
  className?: string;
  isMe?: boolean;
}) {
  return (
    <div
      className={cn("relative shrink-0", isMe && "avatar-me", className)}
      style={{ width: size, height: size }}
    >
      <div
        className="grid place-items-center rounded-full text-[10px] font-semibold text-white select-none"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${user.color}, ${user.color}cc)`,
          fontSize: Math.max(10, size / 2.6),
        }}
      >
        {user.initials}
      </div>
      {showStatus && (
        <PresenceDot
          status={user.status}
          className="absolute -bottom-0.5 -right-0.5"
        />
      )}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 px-2 mb-2">
      {children}
    </h3>
  );
}

export function Card({
  children,
  className,
  as: As = "div",
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return (
    <As
      className={cn(
        "relative rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_20px_40px_-24px_rgba(0,0,0,0.35)]",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}