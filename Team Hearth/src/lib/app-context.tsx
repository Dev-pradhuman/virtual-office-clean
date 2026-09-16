import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import {
  ACCENT_OPTIONS,
  BACKDROP_OPTIONS,
  type CalendarEvent,
  type ChatMessage,
  type Project,
  type Task,
  type TeamFile,
  type TeamUser,
} from "./sample-data";
import {
  apiFetch,
  connectSocket,
  fmtTime,
  getApiBase,
  getDeviceId,
  getToken,
  loginRequest,
  setHqAddress,
  setToken,
  toEvent,
  toFile,
  toProject,
  toTask,
  toTeamUser,
  type BackendEvent,
  type BackendFile,
  type BackendMessage,
  type BackendProject,
  type BackendTask,
  type BackendUser,
} from "./api";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "compact" | "comfortable";
export type SidebarSide = "left" | "right";
export type FontSize = "small" | "medium" | "large";
export type UpdateChannel = "stable" | "beta" | "nightly";

export interface NotificationChannel {
  sound: boolean;
  badge: boolean;
}

export interface NotificationPrefs {
  dm: NotificationChannel;
  mention: NotificationChannel;
  taskAssigned: NotificationChannel;
  incomingCall: NotificationChannel;
}

export interface UserPreferences {
  theme: ThemeMode;
  accent: string;
  density: Density;
  sidebarPosition: SidebarSide;
  sidebarPinned: boolean;
  backdrop: string;
  backdropImage: string;
  officeTheme: string;
  fontSize: FontSize;
  notifications: NotificationPrefs;
}

export const DEFAULT_PREFS: UserPreferences = {
  theme: "dark",
  accent: "indigo",
  density: "comfortable",
  sidebarPosition: "left",
  sidebarPinned: true,
  backdrop: "mesh",
  backdropImage: "",
  officeTheme: "aurora",
  fontSize: "medium",
  notifications: {
    dm: { sound: true, badge: true },
    mention: { sound: true, badge: true },
    taskAssigned: { sound: false, badge: true },
    incomingCall: { sound: true, badge: true },
  },
};

export interface Session {
  userId: string;
  hqAddress: string;
}

export interface AdminConfig {
  teamBackdrop: string;
  teamBackdropImage: string;
  googleDriveApiKey: string;
  googleDriveClientId: string;
  googleDriveConnected: boolean;
  updateChannel: UpdateChannel;
}

export const DEFAULT_ADMIN_CONFIG: AdminConfig = {
  teamBackdrop: "mesh",
  teamBackdropImage: "",
  googleDriveApiKey: "",
  googleDriveClientId: "",
  googleDriveConnected: false,
  updateChannel: "stable",
};

export type ActiveView =
  | "office"
  | "chat"
  | "call"
  | "tasks"
  | "projects"
  | "calendar"
  | "whiteboard"
  | "files"
  | "integrations"
  | "edith"
  | "settings";

interface AppContextValue {
  session: Session | null;
  currentUser: TeamUser | null;
  users: TeamUser[];
  messages: ChatMessage[];
  // Direct-message threads, keyed by the *other* user's id.
  dms: Record<string, ChatMessage[]>;
  // Unread DM counts, keyed by the other user's id.
  dmUnread: Record<string, number>;
  tasks: Task[];
  projects: Project[];
  events: CalendarEvent[];
  files: TeamFile[];
  prefs: UserPreferences;
  adminConfig: AdminConfig;
  activeView: ActiveView;
  activeChannel: string;
  customizeOpen: boolean;
  socket: Socket | null;
  connected: boolean;
  officeBackdrop: string | null;
  // Live per-user telemetry for the profile panel: which view they're on and
  // what desktop apps/windows they have open (Electron clients report these).
  userActivity: Record<string, { view: string; label: string }>;
  userApps: Record<string, string[]>;
  canTurnOffVirtualOffice: boolean;
  adminUserPermissions: Record<string, boolean>;
  setUserShutdownPermission: (userId: string, granted: boolean) => Promise<void>;
  turnOffVirtualOffice: () => Promise<void>;
  login: (username: string, password: string, hq: string) => Promise<void>;
  logout: () => void;
  setActiveView: (v: ActiveView) => void;
  setActiveChannel: (c: string) => void;
  setPrefs: (p: Partial<UserPreferences>) => void;
  setAdminConfig: (c: Partial<AdminConfig>) => void;
  setCustomizeOpen: (open: boolean) => void;
  postMessage: (content: string, channel?: string) => void;
  loadDm: (userId: string) => void;
  postDm: (userId: string, content: string) => void;
  markDmRead: (userId: string) => void;
  moveTask: (id: string, status: Task["status"]) => void;
  createTask: (input: { title: string; description?: string; assigneeId?: string; priority?: Task["priority"] }) => Promise<void>;
  createProject: (input: { name: string; description?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createEvent: (input: { title: string; date: string; time?: string }) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  updateStatus: (message: string) => void;
}

// Built-in "who's online" backdrops (committed under public/backdrops), keyed by
// the sorted online usernames. Admin-uploaded images (auto_backdrop) override
// these; a manual shared office image is the next fallback.
const STATIC_AUTO_BACKDROPS: Record<string, string> = {
  "": "/backdrops/none.jpg",
  Arjun: "/backdrops/arjun.jpg",
  Aviral: "/backdrops/aviral.jpg",
  Pradhuman: "/backdrops/pradhuman.jpg",
  "Arjun|Aviral": "/backdrops/arjun-aviral.jpg",
  "Arjun|Pradhuman": "/backdrops/arjun-pradhuman.jpg",
  "Aviral|Pradhuman": "/backdrops/aviral-pradhuman.jpg",
  "Arjun|Aviral|Pradhuman": "/backdrops/all.jpg",
};

// Human labels for the view we broadcast to teammates via activity_update.
const VIEW_LABELS: Record<ActiveView, string> = {
  office: "In the office",
  chat: "Team chat",
  call: "In a call",
  tasks: "Tasks board",
  projects: "Projects",
  calendar: "Calendar",
  whiteboard: "Whiteboard",
  files: "Files",
  integrations: "Integrations",
  edith: "Edith AI",
  settings: "Settings",
};

const AppContext = createContext<AppContextValue | null>(null);

const PREFS_KEY = (uid: string) => `vo:prefs:${uid}`;
const SESSION_KEY = "vo:session";
const ADMIN_KEY = "vo:admin";

const FONT_SCALE: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.15 };

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dms, setDms] = useState<Record<string, ChatMessage[]>>({});
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [files, setFiles] = useState<TeamFile[]>([]);
  const [prefs, setPrefsState] = useState<UserPreferences>(DEFAULT_PREFS);
  const [adminConfig, setAdminConfigState] = useState<AdminConfig>(DEFAULT_ADMIN_CONFIG);
  const [canTurnOffVirtualOffice, setCanTurnOffVirtualOffice] = useState(false);
  const [adminUserPermissions, setAdminUserPermissions] = useState<Record<string, boolean>>({});
  const [activeView, setActiveView] = useState<ActiveView>("office");
  const [activeChannel, setActiveChannelState] = useState("general");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [manualBackdrop, setManualBackdrop] = useState<string | null>(null);
  const [autoBackdropMap, setAutoBackdropMap] = useState<Record<string, string>>({});
  const [userActivity, setUserActivity] = useState<Record<string, { view: string; label: string }>>({});
  const [userApps, setUserApps] = useState<Record<string, string[]>>({});
  const loadedChannelsRef = useRef<Set<string>>(new Set());
  const loadedDmsRef = useRef<Set<string>>(new Set());
  // The DM thread currently open in the UI — incoming messages for it don't
  // increment the unread badge.
  const activeDmRef = useRef<string | null>(null);
  const loadDmRef = useRef<((userId: string) => Promise<void>) | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  // Set by the live socket effect so setActiveChannel (outside the effect) can
  // lazily load a channel's history on first visit.
  const loadChannelMessagesRef = useRef<((channel: string) => Promise<void>) | null>(null);
  const [, forceSocket] = useState(0);
  const myStatusMsgRef = useRef<string>("");

  // Hydrate session + prefs + admin from localStorage on client
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw && getToken()) {
        const s: Session = JSON.parse(raw);
        setSession(s);
        if (s.hqAddress) setHqAddress(s.hqAddress);
        const pRaw = localStorage.getItem(PREFS_KEY(s.userId));
        if (pRaw) setPrefsState({ ...DEFAULT_PREFS, ...JSON.parse(pRaw) });
      }
      const aRaw = localStorage.getItem(ADMIN_KEY);
      if (aRaw) {
        const saved = JSON.parse(aRaw);
        delete saved.quitPassword;
        setAdminConfigState({ ...DEFAULT_ADMIN_CONFIG, ...saved });
      }
    } catch {}
  }, []);

  // Persist prefs whenever they change
  useEffect(() => {
    if (!session) return;
    try {
      localStorage.setItem(PREFS_KEY(session.userId), JSON.stringify(prefs));
    } catch {}
  }, [prefs, session]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_KEY, JSON.stringify(adminConfig));
    } catch {}
  }, [adminConfig]);

  // Apply prefs to <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;

    const applyTheme = () => {
      const resolved =
        prefs.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : prefs.theme;
      html.classList.toggle("dark", resolved === "dark");
    };
    applyTheme();
    html.classList.toggle("density-compact", prefs.density === "compact");
    html.style.setProperty("--user-font-scale", String(FONT_SCALE[prefs.fontSize]));

    const accent = ACCENT_OPTIONS.find((a) => a.id === prefs.accent) ?? ACCENT_OPTIONS[0];
    html.style.setProperty("--primary", `oklch(${accent.value})`);
    html.style.setProperty("--brand", `oklch(${accent.value})`);
    html.style.setProperty("--ring", `oklch(${accent.value} / 0.5)`);

    if (prefs.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [prefs]);

  // ---- Live backend connection (runs whenever we have a session) -----------
  useEffect(() => {
    if (!session || !getToken()) return;

    let cancelled = false;
    const currentUserId = Number(session.userId);
    const sock = connectSocket();
    socketRef.current = sock;
    forceSocket((n) => n + 1);

    const loadUsers = async () => {
      try {
        const rows = await apiFetch<BackendUser[]>("/api/users");
        if (!cancelled) setUsers(rows.map(toTeamUser));
        if (rows.find((u) => u.id === currentUserId)?.role === "admin") {
          const grants = await apiFetch<{ user_id: number; permission_key: string }[]>("/api/admin/user-permissions");
          if (!cancelled) setAdminUserPermissions(Object.fromEntries(
            grants.filter((g) => g.permission_key === "can_turn_off_v_office").map((g) => [String(g.user_id), true]),
          ));
        }
      } catch (e) {
        console.error("[vo] failed to load users", e);
      }
    };
    const loadMyPermissions = async () => {
      try {
        const grants = await apiFetch<{ can_turn_off_v_office: boolean }>("/api/me/permissions");
        if (!cancelled) setCanTurnOffVirtualOffice(!!grants.can_turn_off_v_office);
      } catch (e) {
        if (!cancelled) setCanTurnOffVirtualOffice(false);
      }
    };
    const loadChannelMessages = async (channel: string) => {
      try {
        const rows = await apiFetch<BackendMessage[]>(
          `/api/messages?channel=${encodeURIComponent(channel)}`,
        );
        if (cancelled) return;
        loadedChannelsRef.current.add(channel);
        const mapped = rows.map((m) => ({
          id: String(m.id),
          channelId: m.channel || channel,
          authorId: String(m.sender_id),
          timestamp: fmtTime(m.timestamp),
          content: m.content,
        }));
        // Merge (dedupe by id) so switching channels never drops history.
        setMessages((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const add = mapped.filter((x) => !seen.has(x.id));
          return add.length ? [...prev, ...add] : prev;
        });
      } catch (e) {
        console.error("[vo] failed to load messages", e);
      }
    };
    loadChannelMessagesRef.current = loadChannelMessages;

    // Load the DM history between us and `userId` (once per session by default).
    const loadDm = async (userId: string) => {
      try {
        const rows = await apiFetch<BackendMessage[]>(
          `/api/messages/dm/${encodeURIComponent(userId)}`,
        );
        if (cancelled) return;
        loadedDmsRef.current.add(userId);
        const mapped = rows.map((m) => ({
          id: String(m.id),
          channelId: `dm:${userId}`,
          authorId: String(m.sender_id),
          timestamp: fmtTime(m.timestamp),
          content: m.content,
        }));
        setDms((prev) => {
          // Merge server history with any live messages already received.
          const live = prev[userId] || [];
          const seen = new Set(live.map((x) => x.id));
          const merged = [...live];
          for (const x of mapped) if (!seen.has(x.id)) merged.push(x);
          return { ...prev, [userId]: merged };
        });
      } catch (e) {
        console.error("[vo] failed to load DM", e);
      }
    };
    loadDmRef.current = loadDm;

    const loadCollection = async <B, U>(
      path: string,
      map: (b: B) => U,
      set: (v: U[]) => void,
    ) => {
      try {
        const rows = await apiFetch<B[]>(path);
        if (!cancelled) set(rows.map(map));
      } catch (e) {
        console.error(`[vo] failed to load ${path}`, e);
      }
    };

    const loadBackdrops = async () => {
      try {
        const oi = await apiFetch<{ url: string | null }>("/api/office-image");
        if (!cancelled) setManualBackdrop(oi.url || null);
      } catch {}
      try {
        const ab = await apiFetch<{ map: Record<string, string> }>("/api/auto-backdrop");
        if (!cancelled) setAutoBackdropMap(ab.map || {});
      } catch {}
    };

    // Client heartbeat — keeps our session alive so the server's 90s sweeper
    // doesn't mark us offline while we're still connected. Carries desktop
    // telemetry (CPU/RAM/OS) when running inside Electron.
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const sendHeartbeat = async () => {
      const sid = sessionIdRef.current;
      if (!sock.connected || sid == null || !currentUserId) return;
      let stats: Record<string, unknown> | null = null;
      const api = (window as unknown as { electronAPI?: { getClientStats?: () => Promise<{ cpu: number; ram: number; os: string }> } }).electronAPI;
      if (api?.getClientStats) {
        try {
          const t = await api.getClientStats();
          stats = { cpu: t.cpu, ram: t.ram, os: t.os, network_quality: "Good" };
        } catch {}
      }
      sock.emit("heartbeat", {
        userId: currentUserId,
        sessionId: sid,
        deviceId: getDeviceId(),
        appVersion: "1.0.0",
        timestamp: Date.now(),
        stats,
      });
    };

    sock.on("session_created", (d: { sessionId: number }) => {
      sessionIdRef.current = d.sessionId;
      sendHeartbeat();
    });

    sock.on("connect", () => {
      if (cancelled) return;
      setConnected(true);
      loadUsers();
      loadMyPermissions();
      // Reload every channel we've already opened (general on first connect).
      loadedChannelsRef.current.add("general");
      loadedChannelsRef.current.forEach((c) => loadChannelMessages(c));
      loadCollection<BackendTask, Task>("/api/tasks", toTask, setTasks);
      loadCollection<BackendProject, Project>("/api/projects", toProject, setProjects);
      loadCollection<BackendEvent, CalendarEvent>("/api/events", toEvent, setEvents);
      loadCollection<BackendFile, TeamFile>("/api/files", toFile, setFiles);
      loadBackdrops();
      if (!heartbeatTimer) heartbeatTimer = setInterval(sendHeartbeat, 30000);
    });
    sock.on("disconnect", () => !cancelled && setConnected(false));

    // Live office backdrop changes
    sock.on("office_image_changed", (d: { url: string | null }) =>
      setManualBackdrop(d.url || null),
    );
    sock.on("auto_backdrop_changed", (d: { key: string; image: string | null }) =>
      setAutoBackdropMap((prev) => {
        const next = { ...prev };
        if (d.image) next[d.key] = d.image;
        else delete next[d.key];
        return next;
      }),
    );

    // Team tools — live sync
    sock.on("task_created", (t: BackendTask) =>
      setTasks((prev) => (prev.some((x) => x.id === String(t.id)) ? prev : [toTask(t), ...prev])),
    );
    sock.on("task_updated", (t: BackendTask) =>
      setTasks((prev) => prev.map((x) => (x.id === String(t.id) ? { ...x, ...toTask(t) } : x))),
    );
    sock.on("task_deleted", (d: { id: number }) =>
      setTasks((prev) => prev.filter((x) => x.id !== String(d.id))),
    );
    sock.on("project_created", (p: BackendProject) =>
      setProjects((prev) => (prev.some((x) => x.id === String(p.id)) ? prev : [toProject(p), ...prev])),
    );
    sock.on("project_deleted", (d: { id: number }) =>
      setProjects((prev) => prev.filter((x) => x.id !== String(d.id))),
    );
    sock.on("event_created", (e: BackendEvent) =>
      setEvents((prev) => (prev.some((x) => x.id === String(e.id)) ? prev : [...prev, toEvent(e)])),
    );
    sock.on("event_deleted", (d: { id: number }) =>
      setEvents((prev) => prev.filter((x) => x.id !== String(d.id))),
    );
    sock.on("file_uploaded", () =>
      loadCollection<BackendFile, TeamFile>("/api/files", toFile, setFiles),
    );
    sock.on("file_deleted", (d: { id: number }) =>
      setFiles((prev) => prev.filter((x) => x.id !== String(d.id))),
    );

    // Presence
    sock.on(
      "user_status_change",
      (d: { id: number; status?: string; message?: string }) => {
        setUsers((us) =>
          us.map((u) =>
            u.id === String(d.id)
              ? {
                  ...u,
                  status: d.status ? (d.status === "online" ? "online" : "offline") : u.status,
                  statusMessage: d.message ?? u.statusMessage,
                }
              : u,
          ),
        );
      },
    );
    sock.on("user_permission_changed", () => {
      loadMyPermissions();
      loadUsers();
    });
    sock.on("user_activity", (d: { id: number; view?: string; label?: string }) => {
      setUsers((us) =>
        us.map((u) => (u.id === String(d.id) ? { ...u, currentApp: d.label || undefined } : u)),
      );
      setUserActivity((prev) => ({
        ...prev,
        [String(d.id)]: { view: d.view || "", label: d.label || "" },
      }));
    });
    // Snapshot of everyone's current view/apps handed to us on connect.
    sock.on(
      "activity_snapshot",
      (arr: { id: number; view?: string; label?: string }[]) => {
        if (cancelled) return;
        const map: Record<string, { view: string; label: string }> = {};
        (arr || []).forEach((a) => {
          map[String(a.id)] = { view: a.view || "", label: a.label || "" };
        });
        setUserActivity(map);
      },
    );
    sock.on("apps_snapshot", (arr: { id: number; apps?: string[] }[]) => {
      if (cancelled) return;
      const map: Record<string, string[]> = {};
      (arr || []).forEach((a) => {
        map[String(a.id)] = a.apps || [];
      });
      setUserApps(map);
    });
    sock.on("user_apps", (d: { id: number; apps?: string[] }) => {
      setUserApps((prev) => ({ ...prev, [String(d.id)]: d.apps || [] }));
    });
    sock.on(
      "user_profile_updated",
      (d: { id: number; username?: string; designation?: string }) => {
        setUsers((us) =>
          us.map((u) =>
            u.id === String(d.id)
              ? { ...u, name: d.username ?? u.name, designation: d.designation ?? u.designation }
              : u,
          ),
        );
      },
    );

    // Chat
    sock.on("new_message", (m: BackendMessage) => {
      if (cancelled) return;
      // Direct message: bucket by the *other* participant.
      if (m.recipient_id != null) {
        const otherId = String(
          Number(m.sender_id) === currentUserId ? m.recipient_id : m.sender_id,
        );
        const mapped: ChatMessage = {
          id: String(m.id),
          channelId: `dm:${otherId}`,
          authorId: String(m.sender_id),
          timestamp: fmtTime(m.timestamp) || fmtTime(new Date().toISOString()),
          content: m.content,
        };
        setDms((prev) => {
          const list = prev[otherId] || [];
          if (list.some((x) => x.id === mapped.id)) return prev;
          return { ...prev, [otherId]: [...list, mapped] };
        });
        // Bump unread unless it's our own echo or the thread is open.
        if (Number(m.sender_id) !== currentUserId && activeDmRef.current !== otherId) {
          setDmUnread((prev) => ({ ...prev, [otherId]: (prev[otherId] || 0) + 1 }));
        }
        return;
      }
      setMessages((prev) => {
        if (prev.some((x) => x.id === String(m.id))) return prev;
        return [
          ...prev,
          {
            id: String(m.id),
            channelId: m.channel || "general",
            authorId: String(m.sender_id),
            timestamp: fmtTime(m.timestamp) || fmtTime(new Date().toISOString()),
            content: m.content,
          },
        ];
      });
    });

    return () => {
      cancelled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      sessionIdRef.current = null;
      sock.removeAllListeners();
      sock.disconnect();
      if (socketRef.current === sock) socketRef.current = null;
      setConnected(false);
    };
  }, [session]);

  // Report our current in-app view to teammates (drives their profile panel).
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock || !connected) return;
    sock.emit("activity_update", { view: activeView, label: VIEW_LABELS[activeView] || "" });
  }, [activeView, connected]);

  // Report our open desktop apps/windows (Electron only) so teammates can see
  // what we're working on. No-op in a plain browser.
  useEffect(() => {
    if (!connected) return;
    const api = (window as unknown as {
      electronAPI?: { getOpenWindows?: () => Promise<string[]> };
    }).electronAPI;
    if (!api?.getOpenWindows) return;
    let stopped = false;
    const push = async () => {
      try {
        const apps = await api.getOpenWindows!();
        if (!stopped && Array.isArray(apps)) socketRef.current?.emit("apps_update", { apps });
      } catch {}
    };
    push();
    const t = setInterval(push, 30000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [connected]);

  const currentUser = useMemo(
    () => (session ? users.find((u) => u.id === session.userId) ?? null : null),
    [session, users],
  );

  // Resolve the office backdrop for the current "who's online" combination.
  // Precedence: admin-uploaded auto image > built-in per-combo image > manual
  // shared image > default artwork. Matches the legacy client's keying.
  const officeBackdrop = useMemo(() => {
    const key = users
      .filter((u) => u.status === "online")
      .map((u) => u.name)
      .sort()
      .join("|");
    let next = autoBackdropMap[key] || STATIC_AUTO_BACKDROPS[key] || manualBackdrop || "/office.png";
    if (next.startsWith("/uploads/")) next = `${getApiBase()}${next}`;
    return next;
  }, [users, autoBackdropMap, manualBackdrop]);

  const login = useCallback(async (username: string, password: string, hq: string) => {
    const { user } = await loginRequest(username, password, hq);
    const s: Session = { userId: String(user.id), hqAddress: hq };
    // Seed users with self so currentUser resolves before the roster loads.
    setUsers((prev) =>
      prev.some((u) => u.id === s.userId) ? prev : [...prev, toTeamUser(user)],
    );
    setSession(s);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      const pRaw = localStorage.getItem(PREFS_KEY(s.userId));
      setPrefsState(pRaw ? { ...DEFAULT_PREFS, ...JSON.parse(pRaw) } : DEFAULT_PREFS);
    } catch {}
  }, []);

  const logout = useCallback(() => {
    try {
      socketRef.current?.emit("client_graceful_exit");
    } catch {}
    const desktop = (window as unknown as { electronAPI?: { clearDesktopAuth?: () => Promise<boolean> } }).electronAPI;
    desktop?.clearDesktopAuth?.().catch(() => {});
    setToken(null);
    setSession(null);
    setUsers([]);
    setMessages([]);
    setDms({});
    setDmUnread({});
    activeDmRef.current = null;
    loadedDmsRef.current = new Set();
    setTasks([]);
    setProjects([]);
    setEvents([]);
    setFiles([]);
    setUserActivity({});
    setUserApps({});
    setCanTurnOffVirtualOffice(false);
    setAdminUserPermissions({});
    loadedChannelsRef.current = new Set();
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, []);

  const setPrefs = useCallback((p: Partial<UserPreferences>) => {
    setPrefsState((prev) => ({ ...prev, ...p }));
  }, []);

  const setAdminConfig = useCallback((c: Partial<AdminConfig>) => {
    setAdminConfigState((prev) => ({ ...prev, ...c }));
  }, []);

  const postMessage = useCallback(
    (content: string, channel = "general") => {
      const text = content.trim();
      if (!text) return;
      // Server persists and echoes 'new_message' back to everyone (incl. sender).
      socketRef.current?.emit("send_message", { content: text, type: "text", channel });
    },
    [],
  );

  const loadDm = useCallback((userId: string) => {
    activeDmRef.current = userId;
    if (!loadedDmsRef.current.has(userId)) {
      loadDmRef.current?.(userId);
    }
  }, []);

  const postDm = useCallback((userId: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    // Server persists, delivers to the recipient, and echoes back to us.
    socketRef.current?.emit("send_message", {
      content: text,
      type: "text",
      recipient_id: Number(userId),
    });
  }, []);

  const markDmRead = useCallback((userId: string) => {
    activeDmRef.current = userId;
    setDmUnread((prev) => (prev[userId] ? { ...prev, [userId]: 0 } : prev));
  }, []);

  const setActiveChannel = useCallback((channel: string) => {
    setActiveChannelState(channel);
    // Lazy-load the channel's history the first time it's opened.
    if (!loadedChannelsRef.current.has(channel)) {
      loadChannelMessagesRef.current?.(channel);
    }
  }, []);

  const moveTask = useCallback((id: string, status: Task["status"]) => {
    // Optimistic; server broadcasts task_updated to reconcile everyone.
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    apiFetch(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch((e) => console.error("[vo] moveTask failed", e));
  }, []);

  const createTask = useCallback(
    async (input: { title: string; description?: string; assigneeId?: string; priority?: Task["priority"] }) => {
      const priority = input.priority
        ? input.priority[0].toUpperCase() + input.priority.slice(1)
        : "Medium";
      await apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          description: input.description || "",
          assignee_id: input.assigneeId ? Number(input.assigneeId) : null,
          priority,
          status: "todo",
        }),
      });
    },
    [],
  );

  const createProject = useCallback(async (input: { name: string; description?: string }) => {
    await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: input.name, description: input.description || "" }),
    });
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
  }, []);

  const createEvent = useCallback(async (input: { title: string; date: string; time?: string }) => {
    await apiFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: input.title, date: input.date, time: input.time || "" }),
    });
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    await apiFetch(`/api/events/${id}`, { method: "DELETE" });
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    // file_uploaded socket event refreshes the list for everyone.
    await apiFetch("/api/upload", { method: "POST", body: form });
  }, []);

  const deleteFile = useCallback(async (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    await apiFetch(`/api/files/${id}`, { method: "DELETE" });
  }, []);

  const updateStatus = useCallback((message: string) => {
    myStatusMsgRef.current = message;
    socketRef.current?.emit("set_status_message", { message });
    setUsers((us) =>
      us.map((u) => (session && u.id === session.userId ? { ...u, statusMessage: message } : u)),
    );
  }, [session]);

  const setUserShutdownPermission = useCallback(async (userId: string, granted: boolean) => {
    await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/permissions/can_turn_off_v_office`, {
      method: "PUT",
      body: JSON.stringify({ granted }),
    });
    setAdminUserPermissions((prev) => ({ ...prev, [userId]: granted }));
  }, []);

  const turnOffVirtualOffice = useCallback(async () => {
    const token = getToken();
    const api = (window as unknown as { electronAPI?: { turnOffVirtualOffice?: () => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!token || !session || !api?.turnOffVirtualOffice) throw new Error("Turn Off Virtual Office is available in the desktop app after sign-in.");
    const result = await api.turnOffVirtualOffice();
    if (!result.success) throw new Error(result.error || "Shutdown permission denied");
    const liveSocket = socketRef.current;
    if (liveSocket?.connected) {
      try { await liveSocket.timeout(1000).emitWithAck("client_graceful_exit"); } catch (e) {}
      liveSocket.disconnect();
    }
  }, [session]);

  const value: AppContextValue = {
    session,
    currentUser,
    users,
    messages,
    dms,
    dmUnread,
    tasks,
    projects,
    events,
    files,
    prefs,
    adminConfig,
    activeView,
    activeChannel,
    customizeOpen,
    socket: socketRef.current,
    connected,
    officeBackdrop,
    userActivity,
    userApps,
    canTurnOffVirtualOffice,
    adminUserPermissions,
    setUserShutdownPermission,
    turnOffVirtualOffice,
    login,
    logout,
    setActiveView,
    setActiveChannel,
    setPrefs,
    setAdminConfig,
    setCustomizeOpen,
    postMessage,
    loadDm,
    postDm,
    markDmRead,
    moveTask,
    createTask,
    createProject,
    deleteProject,
    createEvent,
    deleteEvent,
    uploadFile,
    deleteFile,
    updateStatus,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export { ACCENT_OPTIONS, BACKDROP_OPTIONS };
