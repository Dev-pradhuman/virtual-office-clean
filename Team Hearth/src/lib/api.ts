// Backend client layer: REST + Socket.IO wiring to the Virtual Office server
// (Express + Socket.IO). The React app is served by that same backend in
// production, but the "Headquarters Address" can also point at a remote (Render)
// backend, so the API base is configurable and stored with the session.

import { io, type Socket } from "socket.io-client";
import type {
  CalendarEvent,
  PresenceStatus,
  Project,
  Role,
  Task,
  TeamFile,
  TeamUser,
} from "./sample-data";

const TOKEN_KEY = "vo:token";
const HQ_KEY = "vo:hq";
const DEVICE_KEY = "vo:deviceId";
const CREDS_KEY = "vo:creds";

// Default team headquarters. Used to pre-fill the login screen when the user
// hasn't connected before.
export const DEFAULT_HQ = "https://virtual-office-hq-test.onrender.com";

// ---- saved login (opt-in "remember me") -----------------------------------
// Stored locally on the user's own machine so the desktop app can pre-fill the
// login form. Cleared on explicit sign-out or when "remember me" is unchecked.
export interface SavedCreds {
  hq: string;
  username: string;
  password: string;
}
export function getSavedCreds(): SavedCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    return raw ? (JSON.parse(raw) as SavedCreds) : null;
  } catch {
    return null;
  }
}
export function saveCreds(creds: SavedCreds | null) {
  try {
    if (creds) localStorage.setItem(CREDS_KEY, JSON.stringify(creds));
    else localStorage.removeItem(CREDS_KEY);
  } catch {}
}

// ---- session storage helpers ----------------------------------------------

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// The API base. A saved HQ address wins; otherwise same-origin (the backend that
// served this page). Trailing slashes are trimmed.
export function getApiBase(): string {
  let hq = "";
  try {
    hq = localStorage.getItem(HQ_KEY) || "";
  } catch {}
  if (!hq) hq = window.location.origin;
  return hq.replace(/\/+$/, "");
}
export function setHqAddress(hq: string) {
  try {
    if (hq) localStorage.setItem(HQ_KEY, hq.replace(/\/+$/, ""));
    else localStorage.removeItem(HQ_KEY);
  } catch {}
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        "web_" +
        (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "web_client";
  }
}

// ---- REST helpers ----------------------------------------------------------

export function authHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: { ...authHeaders(!(opts.body instanceof FormData)), ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) ||
      `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  return data as T;
}

// ---- auth ------------------------------------------------------------------

export interface BackendUser {
  id: number;
  username: string;
  avatar?: string;
  role?: string;
  designation?: string;
  status?: string;
  status_message?: string;
  current_project?: string;
  last_seen?: string;
}

export async function loginRequest(
  username: string,
  password: string,
  hq: string,
): Promise<{ token: string; user: BackendUser }> {
  // Persist the HQ address first so getApiBase() targets the right server.
  setHqAddress(hq);
  const res = await fetch(`${getApiBase()}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Invalid credentials");
  setToken(data.token);
  return data;
}

// ---- Socket.IO -------------------------------------------------------------

export function connectSocket(extra: Record<string, unknown> = {}): Socket {
  return io(getApiBase(), {
    auth: {
      token: getToken(),
      deviceId: getDeviceId(),
      appVersion: "1.0.0",
      ...extra,
    },
    transports: ["websocket", "polling"],
  });
}

// ---- mappers: backend shapes -> Lovable UI types ---------------------------

const AVATAR_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#a855f7", "#0ea5e9", "#ec4899"];

export function colorForId(id: string | number): string {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Backend statuses include 'closed'/'disconnected' which the UI treats as offline.
export function normalizeStatus(s?: string): PresenceStatus {
  if (s === "online" || s === "away" || s === "busy") return s;
  return "offline";
}

export function toTeamUser(u: BackendUser): TeamUser {
  return {
    id: String(u.id),
    name: u.username,
    designation: u.designation || (u.role === "admin" ? "Admin" : "Member"),
    initials: initialsFor(u.username),
    color: colorForId(u.id),
    status: normalizeStatus(u.status),
    statusMessage: u.status_message || "",
    inCall: false,
    role: (u.role === "admin" ? "admin" : "member") as Role,
    currentApp: u.current_project ? `Working on ${u.current_project}` : undefined,
  };
}

export interface BackendMessage {
  id: number;
  sender_id: number;
  username?: string;
  content: string;
  type?: string;
  recipient_id?: number | null;
  channel?: string | null;
  timestamp?: string;
}

// Total seconds a user has been online across recent windows.
export interface OnlineTime {
  day: number;
  week: number;
  month: number;
}
export function fmtDuration(seconds: number): string {
  if (!seconds || seconds < 60) return "< 1m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function fmtTime(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDate(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function humanSize(bytes?: number): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- tasks -----------------------------------------------------------------

export interface BackendTask {
  id: number;
  title: string;
  description?: string;
  status?: string;
  assignee_id?: number | null;
  due_date?: string;
  priority?: string;
  project_id?: number | null;
  done?: number;
}

const TASK_STATUSES = ["todo", "in_progress", "completed"] as const;

export function toTask(t: BackendTask): Task {
  const status = (TASK_STATUSES as readonly string[]).includes(t.status || "")
    ? (t.status as Task["status"])
    : "todo";
  const pr = (t.priority || "medium").toLowerCase();
  const priority: Task["priority"] =
    pr === "low" || pr === "high" ? (pr as Task["priority"]) : "medium";
  return {
    id: String(t.id),
    title: t.title,
    description: t.description || "",
    status,
    assigneeId: t.assignee_id != null ? String(t.assignee_id) : "",
    dueDate: t.due_date ? fmtDate(t.due_date) : "",
    priority,
    comments: [],
  };
}

// ---- projects --------------------------------------------------------------

export interface BackendProject {
  id: number;
  name: string;
  description?: string;
  status?: string;
  owner_id?: number | null;
  owner?: string;
}

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed"] as const;

export function toProject(p: BackendProject): Project {
  const status = (PROJECT_STATUSES as readonly string[]).includes(p.status || "")
    ? (p.status as Project["status"])
    : "active";
  return {
    id: String(p.id),
    name: p.name,
    description: p.description || "",
    status,
    members: p.owner_id != null ? [String(p.owner_id)] : [],
    progress: 0, // computed from tasks in the view
    dueDate: "",
  };
}

// ---- events ----------------------------------------------------------------

export interface BackendEvent {
  id: number;
  title: string;
  date: string;
  time?: string;
  created_by?: number | null;
}

export function toEvent(e: BackendEvent): CalendarEvent {
  return {
    id: String(e.id),
    title: e.title,
    date: e.date,
    time: e.time || "",
    attendees: e.created_by != null ? [String(e.created_by)] : [],
    color: colorForId(e.id),
  };
}

// ---- files -----------------------------------------------------------------

export interface BackendFile {
  id: number;
  uploader_id?: number | null;
  filename: string;
  filepath: string;
  mimetype?: string;
  size?: number;
  created_at?: string;
  timestamp?: string;
  uploader?: string;
}

function kindFromName(name: string, mime = ""): TeamFile["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "fig"].includes(ext))
    return "image";
  if (["pdf"].includes(ext)) return "pdf";
  if (["xls", "xlsx", "csv", "sheet"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "key", "slide"].includes(ext)) return "slide";
  if (["doc", "docx", "md", "txt"].includes(ext)) return "doc";
  return "other";
}

export function toFile(f: BackendFile): TeamFile {
  const local = (f.filepath || "").startsWith("/uploads/");
  return {
    id: String(f.id),
    name: f.filename,
    size: humanSize(f.size),
    ownerId: f.uploader_id != null ? String(f.uploader_id) : "",
    source: local ? "local" : "drive",
    modified: fmtDate(f.created_at || f.timestamp),
    kind: kindFromName(f.filename, f.mimetype),
    url: fileUrl(f.filepath),
  };
}

// Resolve a file's openable URL (Drive links are absolute; local are API-relative).
export function fileUrl(filepath: string): string {
  if (/^https?:/i.test(filepath)) return filepath;
  return `${getApiBase()}${filepath}`;
}
