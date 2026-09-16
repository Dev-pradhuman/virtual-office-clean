import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { OFFICE_THEMES, SCENE_LABELS } from "@/lib/sample-data";
import type { PresenceStatus, SceneKey, TeamUser } from "@/lib/sample-data";

// Demo cycles — shared across all viewers of the Office (team-wide, not
// per-user). Each frame is a presence map keyed by userId. In production this
// would come from live presence data via GET /api/auto-backdrop.
const DEMO_CYCLE: Record<string, PresenceStatus>[] = [
  { u1: "offline", u2: "offline", u3: "offline" },
  { u1: "offline", u2: "offline", u3: "online" },
  { u1: "online", u2: "online", u3: "offline" },
  { u1: "online", u2: "online", u3: "online" },
  { u1: "online", u2: "offline", u3: "online" },
];

function pickBackdropKey(presence: Record<string, PresenceStatus>): SceneKey {
  const online = Object.values(presence).filter((s) => s === "online").length;
  if (online === 0) return "none";
  if (online === 1) return "solo";
  if (online === 2) return "duo";
  return "full";
}

function isLit(status: PresenceStatus) {
  return status === "online";
}

function statusColor(status: PresenceStatus) {
  switch (status) {
    case "online":
      return "var(--presence-online, #22c55e)";
    default:
      return "#3b4763";
  }
}

function Desk({
  user,
  status,
  x,
  y = 0,
}: {
  user: TeamUser;
  status: PresenceStatus;
  x: number;
  y?: number;
}) {
  const lit = isLit(status);
  const glow = statusColor(status);
  const inCall = user.inCall && status === "online";
  const offline = status === "offline";

  // Structural collapse for offline — the desk becomes a low silhouette
  // rather than a full-height clone of the active desks.
  const scale = offline ? 0.62 : 1;
  const opacity = offline ? 0.42 : 1;

  return (
    <g
      transform={`translate(${x} ${y + (offline ? 78 : 0)}) scale(${scale})`}
      style={{
        transition: "transform 700ms cubic-bezier(0.2,0.7,0.2,1), opacity 700ms ease",
        opacity,
        transformOrigin: "center bottom",
      }}
    >
      {/* Monitor glow halo */}
      <ellipse
        cx="90"
        cy="120"
        rx="120"
        ry="60"
        fill={glow}
        opacity={lit ? 0.24 : 0.03}
        style={{ transition: "opacity 700ms ease, fill 700ms ease" }}
      >
      </ellipse>
      {/* In-call animated ring under the monitor */}
      {inCall && (
        <>
          <circle cx="90" cy="120" r="70" fill="none" stroke={glow} strokeWidth="1.2" opacity="0.55">
            <animate attributeName="r" values="60;92;60" dur="2.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0;0.55" dur="2.6s" repeatCount="indefinite" />
          </circle>
          <circle cx="90" cy="120" r="55" fill="none" stroke={glow} strokeWidth="1" opacity="0.35">
            <animate attributeName="r" values="50;80;50" dur="2.6s" begin="0.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="2.6s" begin="0.6s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      {/* Desk plane — thin edge-lit slab, no cartoon legs when offline */}
      <rect x="10" y="170" width="160" height="2" rx="1" fill="url(#deskEdge)" />
      <rect x="10" y="172" width="160" height="8" rx="1" fill="rgba(255,255,255,0.02)" />
      {!offline && (
        <>
          <rect x="22" y="180" width="4" height="58" fill="rgba(255,255,255,0.05)" />
          <rect x="154" y="180" width="4" height="58" fill="rgba(0,0,0,0.35)" />
        </>
      )}
      {/* Monitor stand */}
      <rect x="84" y="150" width="12" height="20" rx="1" fill="rgba(255,255,255,0.06)" />
      <rect x="66" y="168" width="48" height="3" rx="1" fill="rgba(255,255,255,0.05)" />
      {/* Monitor bezel — thin, premium */}
      <rect
        x="30"
        y="70"
        width="120"
        height="82"
        rx="8"
        fill="url(#monitorBezel)"
        stroke={lit ? glow : "rgba(255,255,255,0.05)"}
        strokeWidth={lit ? 1.2 : 0.75}
        style={{ transition: "stroke 700ms ease" }}
      />
      {/* Screen — gradient tint keyed to status */}
      <rect
        x="35"
        y="75"
        width="110"
        height="72"
        rx="4"
        fill={lit ? glow : "#0a0f1e"}
        opacity={lit ? 0.5 : 0.1}
        style={{ transition: "fill 700ms ease, opacity 700ms ease" }}
      >
      </rect>
      {/* Screen glare highlight — top-left directional light */}
      {lit && (
        <rect
          x="35" y="75" width="110" height="72" rx="4"
          fill="url(#screenGlare)"
          opacity="0.35"
        />
      )}
      {/* Offline scanline overlay */}
      {!lit && (
        <rect x="35" y="75" width="110" height="72" rx="4" fill="url(#offlineHatch)" opacity="0.35" />
      )}
      {/* Chair — kept only when someone is actually here */}
      {!offline && (
        <>
          <rect x="70" y="200" width="40" height="22" rx="6" fill="rgba(255,255,255,0.06)" />
          <rect x="70" y="200" width="40" height="22" rx="6" fill="url(#chairShade)" />
          <rect x="86" y="222" width="8" height="16" fill="rgba(0,0,0,0.4)" />
        </>
      )}
      {/* Nameplate */}
      <g style={{ transition: "opacity 700ms ease" }} opacity={offline ? 0 : 1}>
        <rect
          x="20"
          y="250"
          width="140"
          height="40"
          rx="8"
          fill="rgba(8,10,24,0.7)"
          stroke={lit ? glow : "rgba(255,255,255,0.06)"}
          strokeWidth="0.75"
          style={{ transition: "stroke 700ms ease" }}
        />
        <circle
          cx="32"
          cy="267"
          r="4"
          fill={statusColor(status)}
          style={{ transition: "fill 700ms ease" }}
        >
          {status === "online" && (
            <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" />
          )}
        </circle>
        <text
          x="44"
          y="264"
          fontSize="11"
          fontWeight="600"
          fill="#e6ecff"
          fontFamily="ui-sans-serif, system-ui"
        >
          {user.name}
        </text>
        <text
          x="44"
          y="277"
          fontSize="9"
          fill="#8894b8"
          fontFamily="ui-sans-serif, system-ui"
        >
          {user.designation}
        </text>
        {inCall && (
          <g transform="translate(120 258)">
            {/* mic pill */}
            <rect x="0" y="0" width="14" height="10" rx="2" fill={user.micOn ? glow : "#3b4763"} opacity="0.9" />
            <rect x="5" y="2" width="4" height="6" rx="1.5" fill="#0a0f1e" />
            {/* cam pill */}
            <rect x="18" y="0" width="16" height="10" rx="2" fill={user.cameraOn ? glow : "#3b4763"} opacity="0.9" />
            <polygon points="30,2 34,4 34,6 30,8" fill="#0a0f1e" />
            <rect x="20" y="2" width="8" height="6" rx="1" fill="#0a0f1e" />
          </g>
        )}
      </g>
      {/* Offline silhouette label — small, humble, replaces nameplate */}
      {offline && (
        <g>
          <text
            x="90"
            y="200"
            textAnchor="middle"
            fontSize="10"
            fontWeight="500"
            fill="rgba(230,236,255,0.35)"
            fontFamily="ui-sans-serif, system-ui"
            letterSpacing="0.14em"
          >
            {user.initials} · OFFLINE
          </text>
        </g>
      )}
    </g>
  );
}

export function OfficeScene({
  demo = true,
  dimmed = false,
}: {
  demo?: boolean;
  dimmed?: boolean;
}) {
  const { users, prefs } = useApp();
  const [frame, setFrame] = useState(0);

  const theme =
    OFFICE_THEMES.find((t) => t.id === prefs.officeTheme) ?? OFFICE_THEMES[0];
  // Build the four occupancy backdrops from the selected theme's palette.
  const backdrops = useMemo(() => {
    const out = {} as Record<SceneKey, { from: string; via: string; to: string; label: string }>;
    (Object.keys(theme.scenes) as SceneKey[]).forEach((k) => {
      const [from, via, to] = theme.scenes[k];
      out[k] = { from, via, to, label: SCENE_LABELS[k] };
    });
    return out;
  }, [theme]);

  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % DEMO_CYCLE.length), 4200);
    return () => clearInterval(t);
  }, [demo]);

  const presence = useMemo<Record<string, PresenceStatus>>(() => {
    if (demo) return DEMO_CYCLE[frame];
    const map: Record<string, PresenceStatus> = {};
    for (const u of users) map[u.id] = u.status;
    return map;
  }, [demo, frame, users]);

  const backdropKey = pickBackdropKey(presence);

  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm surface-raised " +
        (dimmed ? "backdrop-dim" : "")
      }
    >
      {/* Crossfading backdrop layers — every variant is always mounted, only
          the active one is visible, giving a smooth fade between combos. */}
      {Object.entries(backdrops).map(([key, bg]) => (
        <div
          key={key}
          aria-hidden
          className="absolute inset-0 transition-opacity duration-[900ms] ease-in-out"
          style={{
            opacity: key === backdropKey ? 1 : 0,
            background: `radial-gradient(120% 80% at 50% 20%, ${bg.via} 0%, ${bg.from} 55%, ${bg.to} 100%)`,
          }}
        />
      ))}

      {/* Directional key light — top-left, warm violet */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(55% 60% at 12% 0%, rgba(196,181,253,0.22), transparent 65%), radial-gradient(80% 90% at 100% 120%, rgba(0,0,0,0.5), transparent 60%)",
        }}
      />

      <div className="relative z-10 flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6">
          <div>
            <div className="t-eyebrow" style={{ color: "rgba(255,255,255,0.45)" }}>
              Live team backdrop
            </div>
            <div className="t-body-emph mt-1.5" style={{ color: "rgba(255,255,255,0.92)" }}>
              {backdrops[backdropKey].label}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {users.map((u) => {
              const s = presence[u.id] ?? "offline";
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2 py-1 backdrop-blur-sm"
                  title={`${u.name} · ${s}`}
                >
                  <span
                    className="size-1.5 rounded-full transition-colors duration-700"
                    style={{ background: statusColor(s) }}
                  />
                  <span className="text-[10px] font-medium text-white/80">
                    {u.name.split(" ")[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <svg
          viewBox="0 0 720 300"
          className="w-full h-[280px]"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="offlineHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
            <linearGradient id="deskEdge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.02)" />
            </linearGradient>
            <linearGradient id="monitorBezel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
            </linearGradient>
            <linearGradient id="screenGlare" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.4)" />
              <stop offset="0.4" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            <linearGradient id="chairShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.03)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
            </linearGradient>
            <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.05)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
            </linearGradient>
          </defs>
          {/* Floor plane — subtle horizon */}
          <line
            x1="0"
            y1="245"
            x2="720"
            y2="245"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          <rect x="0" y="245" width="720" height="55" fill="url(#floorGrad)" opacity="0.4" />
          {users.slice(0, 3).map((u, i) => (
            <Desk
              key={u.id}
              user={u}
              status={presence[u.id] ?? "offline"}
              x={40 + i * 230}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
