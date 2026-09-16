export type PresenceStatus = "online" | "offline";

export type Role = "admin" | "member";

export interface TeamUser {
  id: string;
  name: string;
  designation: string;
  initials: string;
  color: string;
  status: PresenceStatus;
  statusMessage: string;
  inCall: boolean;
  role: Role;
  currentApp?: string;
  timeOnlineToday?: string;
  cameraOn?: boolean;
  micOn?: boolean;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  timestamp: string;
  content: string;
  attachment?: { name: string; size: string };
  reactions?: { emoji: string; count: number }[];
  attachmentPreview?: { kind: "image" | "file"; label: string };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "completed";
  assigneeId: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  projectId?: string;
  comments: { authorId: string; body: string; timestamp: string }[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date
  time: string;
  attendees: string[];
  color: string;
}

// Supported shared rooms. Message contents and unread state always come from
// the backend; this list only defines the stable channel identifiers.
export const CHANNELS = [
  { id: "general", name: "general" },
  { id: "engineering", name: "engineering" },
  { id: "design-ops", name: "design-ops" },
] as const;

export const ACCENT_OPTIONS = [
  { id: "indigo", label: "Indigo", value: "0.585 0.187 277", hex: "#6366f1" },
  { id: "emerald", label: "Emerald", value: "0.72 0.17 162", hex: "#10b981" },
  { id: "amber", label: "Amber", value: "0.78 0.16 75", hex: "#f59e0b" },
  { id: "rose", label: "Rose", value: "0.65 0.22 15", hex: "#f43f5e" },
  { id: "violet", label: "Violet", value: "0.55 0.24 300", hex: "#a855f7" },
];

export const BACKDROP_OPTIONS = [
  { id: "none", label: "Plain", css: "transparent" },
  { id: "mesh", label: "Aurora mesh", css: "radial-gradient(at 20% 10%, rgba(99,102,241,.18), transparent 55%), radial-gradient(at 90% 0%, rgba(16,185,129,.12), transparent 50%), radial-gradient(at 50% 100%, rgba(244,114,182,.12), transparent 55%)" },
  { id: "grid", label: "Soft grid", css: "linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)" },
  { id: "warm", label: "Warm dusk", css: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(244,63,94,0.10))" },
  { id: "ocean", label: "Deep ocean", css: "radial-gradient(at 15% 15%, rgba(14,165,233,.20), transparent 55%), radial-gradient(at 85% 85%, rgba(45,212,191,.14), transparent 55%)" },
  { id: "nebula", label: "Nebula", css: "radial-gradient(at 30% 0%, rgba(168,85,247,.22), transparent 55%), radial-gradient(at 80% 100%, rgba(99,102,241,.16), transparent 55%)" },
];

// ---- Office scene themes (the "main office" backdrop) -----------------------
// Each theme supplies a 3-stop gradient (from/via/to) for four occupancy states.
// Users pick one in the Office view; it's stored in per-user prefs.
export const SCENE_LABELS: Record<"none" | "solo" | "duo" | "full", string> = {
  none: "Empty office · after hours",
  solo: "Quiet morning · one lamp on",
  duo: "Focused pair · midday",
  full: "Full house · all hands",
};

export type SceneKey = "none" | "solo" | "duo" | "full";

export interface OfficeTheme {
  id: string;
  label: string;
  swatch: string; // representative color for the picker chip
  scenes: Record<SceneKey, [string, string, string]>; // [from, via, to]
}

export const OFFICE_THEMES: OfficeTheme[] = [
  {
    id: "aurora",
    label: "Aurora",
    swatch: "#212c5c",
    scenes: {
      none: ["#0a0c1a", "#0d1024", "#050612"],
      solo: ["#0d1226", "#141a3a", "#080a1c"],
      duo: ["#111834", "#1a234d", "#0a0f2a"],
      full: ["#141d40", "#212c5c", "#0c122e"],
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    swatch: "#5c3a2c",
    scenes: {
      none: ["#1a0d12", "#241016", "#120609"],
      solo: ["#2a1218", "#3a1a24", "#1c0a10"],
      duo: ["#3a1f18", "#4d2a23", "#2a0f0f"],
      full: ["#40281d", "#5c3a2c", "#2e1a12"],
    },
  },
  {
    id: "forest",
    label: "Forest",
    swatch: "#1f4d3a",
    scenes: {
      none: ["#08140f", "#0b1a13", "#050c09"],
      solo: ["#0c1f17", "#123024", "#081912"],
      duo: ["#12342a", "#1a4d3a", "#0a2a20"],
      full: ["#173d2f", "#1f4d3a", "#0c2e22"],
    },
  },
  {
    id: "mono",
    label: "Graphite",
    swatch: "#3a4152",
    scenes: {
      none: ["#0e0f12", "#141519", "#070808"],
      solo: ["#16181d", "#20232b", "#0e0f12"],
      duo: ["#22252e", "#30343f", "#131519"],
      full: ["#2a2e39", "#3a4152", "#181a20"],
    },
  },
  {
    id: "rose",
    label: "Rosé",
    swatch: "#5c2c3f",
    scenes: {
      none: ["#160a10", "#1e0d16", "#0d060a"],
      solo: ["#25121b", "#341a26", "#180a11"],
      duo: ["#3a1f2c", "#4d2a3a", "#2a0f1c"],
      full: ["#452336", "#5c2c3f", "#2e1220"],
    },
  },
];

export interface Project {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "on_hold" | "completed";
  members: string[];
  progress: number;
  dueDate: string;
}

export interface TeamFile {
  id: string;
  name: string;
  size: string;
  ownerId: string;
  source: "drive" | "local";
  modified: string;
  kind: "doc" | "image" | "sheet" | "slide" | "pdf" | "other";
  url?: string;
}

export const OFFICE_QUOTES = [
  "The best way to predict the future is to build it. — Alan Kay",
  "Simplicity is the ultimate sophistication. — da Vinci",
  "Move slowly and fix things.",
  "Deep work beats shallow noise.",
  "Small teams, big trust.",
];
