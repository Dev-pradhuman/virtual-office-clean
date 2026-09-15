export type PresenceStatus = "online" | "away" | "busy" | "offline";

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

export interface DMThread {
  id: string;
  withUserId: string;
  lastMessage: string;
  unread: number;
  timestamp: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "completed";
  assigneeId: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
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

export const SAMPLE_USERS: TeamUser[] = [
  {
    id: "u1",
    name: "Arjun Sharma",
    designation: "Founder & Admin",
    initials: "AS",
    color: "#6366f1",
    status: "online",
    statusMessage: "Writing docs",
    inCall: true,
    role: "admin",
    currentApp: "Writing docs · Notion",
    timeOnlineToday: "4h 12m today",
    cameraOn: true,
    micOn: true,
  },
  {
    id: "u2",
    name: "Aviral Verma",
    designation: "Product Engineer",
    initials: "AV",
    color: "#10b981",
    status: "busy",
    statusMessage: "In a meeting",
    inCall: true,
    role: "member",
    currentApp: "In Figma · Presence v3",
    timeOnlineToday: "3h 48m today",
    cameraOn: false,
    micOn: true,
  },
  {
    id: "u3",
    name: "Pradhuman Singh",
    designation: "Design Lead",
    initials: "PS",
    color: "#f59e0b",
    status: "away",
    statusMessage: "Focus mode — back at 3pm",
    inCall: false,
    role: "member",
    currentApp: "Focus mode · VS Code",
    timeOnlineToday: "2h 05m today",
    cameraOn: false,
    micOn: false,
  },
];

export const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    channelId: "general",
    authorId: "u3",
    timestamp: "10:12 AM",
    content:
      "Morning team ☕ — pushed the new sidebar spec. Would love a quick review before standup.",
  },
  {
    id: "m2",
    channelId: "general",
    authorId: "u2",
    timestamp: "10:15 AM",
    content:
      "Just looked. The presence dots feel calm — exactly what we want. One nit: let's use amber for 'away', not orange.",
    attachment: { name: "presence-dots-v3.fig", size: "2.4 MB" },
    reactions: [{ emoji: "👍", count: 2 }, { emoji: "🎯", count: 1 }],
    attachmentPreview: { kind: "image", label: "presence-dots-v3.fig" },
  },
  {
    id: "m3",
    channelId: "general",
    authorId: "u1",
    timestamp: "10:18 AM",
    content:
      "Agreed. I'll ship the token change this afternoon. Anyone free to pair on the Electron build scripts?",
    reactions: [{ emoji: "🙌", count: 1 }],
  },
  {
    id: "m4",
    channelId: "general",
    authorId: "u3",
    timestamp: "10:22 AM",
    content: "I can jump in after lunch. Ping me in DMs when you're ready.",
  },
];

export const SAMPLE_DMS: DMThread[] = [
  { id: "d1", withUserId: "u2", lastMessage: "Sounds good, let's sync at 2pm", unread: 2, timestamp: "9:41" },
  { id: "d2", withUserId: "u3", lastMessage: "Attached the mocks", unread: 0, timestamp: "Yesterday" },
];

export const SAMPLE_TASKS: Task[] = [
  {
    id: "t1",
    title: "Define API contract for presence engine",
    description:
      "Draft the websocket message shape, heartbeat cadence, and reconnection policy. Sync with backend before implementation.",
    status: "todo",
    assigneeId: "u2",
    dueDate: "Oct 14",
    priority: "high",
    comments: [
      { authorId: "u1", body: "Let's target < 200ms round-trip.", timestamp: "2d ago" },
    ],
  },
  {
    id: "t2",
    title: "Update documentation for Electron bridge",
    description: "Cover IPC channels, permission prompts, and update-channel flow.",
    status: "todo",
    assigneeId: "u3",
    dueDate: "Oct 18",
    priority: "medium",
    comments: [],
  },
  {
    id: "t3",
    title: "Design per-user customization panel",
    description:
      "Personal preferences scoped per user: theme, accent, density, sidebar position, backdrop, font size.",
    status: "in_progress",
    assigneeId: "u3",
    dueDate: "Oct 12",
    priority: "high",
    comments: [
      { authorId: "u2", body: "Loving the floating popover pattern.", timestamp: "1h ago" },
    ],
  },
  {
    id: "t4",
    title: "Finalize Electron build scripts",
    description: "Cross-compile Windows + macOS packages, sign binaries.",
    status: "in_progress",
    assigneeId: "u1",
    dueDate: "Oct 15",
    priority: "medium",
    comments: [],
  },
  {
    id: "t5",
    title: "OAuth login flow refactor",
    description: "Migrate to httpOnly refresh tokens.",
    status: "completed",
    assigneeId: "u2",
    dueDate: "Oct 5",
    priority: "medium",
    comments: [],
  },
  {
    id: "t6",
    title: "Set up server address routing",
    description: "Multi-HQ address support in login.",
    status: "completed",
    assigneeId: "u1",
    dueDate: "Sep 30",
    priority: "low",
    comments: [],
  },
];

export const SAMPLE_EVENTS: CalendarEvent[] = [
  { id: "e1", title: "Design critique", date: "2026-07-13", time: "10:00", attendees: ["u1", "u3"], color: "#6366f1" },
  { id: "e2", title: "Sprint planning", date: "2026-07-14", time: "14:00", attendees: ["u1", "u2", "u3"], color: "#10b981" },
  { id: "e3", title: "1:1 with Sam", date: "2026-07-16", time: "11:30", attendees: ["u1", "u2"], color: "#f59e0b" },
  { id: "e4", title: "All-hands", date: "2026-07-20", time: "16:00", attendees: ["u1", "u2", "u3"], color: "#ef4444" },
];

export const CHANNELS = [
  { id: "general", name: "general", unread: 0 },
  { id: "engineering", name: "engineering", unread: 3 },
  { id: "design-ops", name: "design-ops", unread: 0 },
];

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

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Presence Engine v2",
    description: "Websocket-based presence with sub-200ms round-trip.",
    status: "active",
    members: ["u1", "u2"],
    progress: 62,
    dueDate: "Oct 28",
  },
  {
    id: "p2",
    name: "Design System Refresh",
    description: "Consolidate tokens, ship dark theme, drop legacy primitives.",
    status: "active",
    members: ["u3", "u1"],
    progress: 34,
    dueDate: "Nov 10",
  },
  {
    id: "p3",
    name: "Desktop Update Channel",
    description: "Signed installers + auto-update rollout by cohort.",
    status: "planning",
    members: ["u1"],
    progress: 12,
    dueDate: "Nov 22",
  },
  {
    id: "p4",
    name: "Onboarding Flow",
    description: "Fresh setup wizard, HQ connection, invite links.",
    status: "on_hold",
    members: ["u2", "u3"],
    progress: 45,
    dueDate: "Dec 05",
  },
  {
    id: "p5",
    name: "Q3 Retro",
    description: "Post-mortem docs and action items.",
    status: "completed",
    members: ["u1", "u2", "u3"],
    progress: 100,
    dueDate: "Sep 30",
  },
];

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

export const SAMPLE_FILES: TeamFile[] = [
  { id: "f1", name: "Presence spec.md", size: "24 KB", ownerId: "u1", source: "drive", modified: "2h ago", kind: "doc" },
  { id: "f2", name: "presence-dots-v3.fig", size: "2.4 MB", ownerId: "u3", source: "drive", modified: "Yesterday", kind: "image" },
  { id: "f3", name: "Q4 roadmap.sheet", size: "88 KB", ownerId: "u1", source: "drive", modified: "3d ago", kind: "sheet" },
  { id: "f4", name: "All-hands deck.slide", size: "5.1 MB", ownerId: "u2", source: "drive", modified: "Oct 04", kind: "slide" },
  { id: "f5", name: "Contract-signed.pdf", size: "312 KB", ownerId: "u1", source: "local", modified: "Sep 28", kind: "pdf" },
  { id: "f6", name: "brand-mark.png", size: "180 KB", ownerId: "u3", source: "local", modified: "Sep 22", kind: "image" },
];

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  target: string;
  timestamp: string;
}

export const SAMPLE_AUDIT: AuditEntry[] = [
  { id: "a1", actorId: "u1", action: "Updated integration keys", target: "Google Drive", timestamp: "Today · 10:41 AM" },
  { id: "a2", actorId: "u2", action: "Assigned task", target: "Define API contract", timestamp: "Today · 09:15 AM" },
  { id: "a3", actorId: "u1", action: "Changed shared backdrop", target: "Aurora mesh", timestamp: "Yesterday · 6:22 PM" },
  { id: "a4", actorId: "u3", action: "Uploaded file", target: "presence-dots-v3.fig", timestamp: "Yesterday · 2:04 PM" },
  { id: "a5", actorId: "u1", action: "Rotated quit password", target: "App config", timestamp: "Oct 06 · 5:12 PM" },
  { id: "a6", actorId: "u2", action: "Joined call", target: "Sprint planning", timestamp: "Oct 05 · 2:00 PM" },
];

export const OFFICE_QUOTES = [
  "The best way to predict the future is to build it. — Alan Kay",
  "Simplicity is the ultimate sophistication. — da Vinci",
  "Move slowly and fix things.",
  "Deep work beats shallow noise.",
  "Small teams, big trust.",
];
