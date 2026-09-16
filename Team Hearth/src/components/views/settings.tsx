import { useState, type ReactNode } from "react";
import {
  ACCENT_OPTIONS,
  BACKDROP_OPTIONS,
  useApp,
  type FontSize,
  type ThemeMode,
  type Density,
  type SidebarSide,
  type UpdateChannel,
} from "@/lib/app-context";
import { SAMPLE_AUDIT } from "@/lib/sample-data";
import { Avatar, Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { cn } from "@/lib/utils";
import { LogOut, User2, ShieldCheck, Save, Power } from "lucide-react";

type Tab = "me" | "admin";

export function SettingsView() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === "admin";
  const [tab, setTab] = useState<Tab>("me");
  if (!currentUser) return null;

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Settings"
        subtitle="Personalize your view or (if admin) configure the workspace"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 mb-6">
            <TabButton active={tab === "me"} onClick={() => setTab("me")} icon={<User2 className="size-3.5" />}>
              My Preferences
            </TabButton>
            {isAdmin && (
              <TabButton
                active={tab === "admin"}
                onClick={() => setTab("admin")}
                icon={<ShieldCheck className="size-3.5" />}
                variant="admin"
              >
                Admin Settings
              </TabButton>
            )}
          </div>

          {tab === "me" ? <MyPreferences /> : <AdminSettings />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  variant?: "admin";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
        active
          ? variant === "admin"
            ? "bg-amber-500 text-white shadow-sm"
            : "bg-brand text-brand-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------------------- My Preferences ---------------------- */

function MyPreferences() {
  const { currentUser, prefs, setPrefs, updateStatus, logout, canTurnOffVirtualOffice, turnOffVirtualOffice } = useApp();
  const [name, setName] = useState(currentUser?.name ?? "");
  const [designation, setDesignation] = useState(currentUser?.designation ?? "");
  const [statusMsg, setStatusMsg] = useState(currentUser?.statusMessage ?? "");
  const [shutdownError, setShutdownError] = useState("");
  const [shuttingDown, setShuttingDown] = useState(false);

  return (
    <div className="space-y-5">
      {canTurnOffVirtualOffice && !!(window as unknown as { electronAPI?: unknown }).electronAPI && (
        <SectionCard title="Turn Off Virtual Office" description="End your session and keep the desktop app off until you open it manually again.">
          <button
            disabled={shuttingDown}
            onClick={async () => {
              setShutdownError("");
              setShuttingDown(true);
              try { await turnOffVirtualOffice(); }
              catch (e) { setShutdownError(e instanceof Error ? e.message : "Could not turn off Virtual Office"); setShuttingDown(false); }
            }}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground disabled:opacity-50"
          >
            <Power className="size-3.5" /> Turn Off Virtual Office
          </button>
          {shutdownError && <p className="mt-2 text-xs text-red-500">{shutdownError}</p>}
        </SectionCard>
      )}
      <SectionCard title="Profile" description="Visible to your teammates.">
        <div className="flex items-center gap-4 mb-5">
          <Avatar user={currentUser!} size={64} showStatus />
          <div>
            <button className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground">
              Change avatar
            </button>
            <p className="text-[10px] text-muted-foreground mt-1.5">PNG or JPG · Max 2MB</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Display name" value={name} onChange={setName} />
          <Field label="Designation" value={designation} onChange={setDesignation} />
          <div className="col-span-2">
            <Field
              label="Status message"
              value={statusMsg}
              onChange={(v) => {
                setStatusMsg(v);
                updateStatus(v);
              }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Theme" description="Applies only to you.">
        <RadioRow
          value={prefs.theme}
          onChange={(v) => setPrefs({ theme: v as ThemeMode })}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Accent color">
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map((a) => {
            const active = prefs.accent === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setPrefs({ accent: a.id })}
                title={a.label}
                className={cn(
                  "size-9 rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                  active ? "ring-foreground" : "ring-transparent"
                )}
                style={{ background: a.hex }}
              />
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Layout density">
        <RadioRow
          value={prefs.density}
          onChange={(v) => setPrefs({ density: v as Density })}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Sidebar" description="Choose which side the nav lives on.">
        <div className="flex items-center gap-6">
          <RadioRow
            value={prefs.sidebarPosition}
            onChange={(v) => setPrefs({ sidebarPosition: v as SidebarSide })}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={prefs.sidebarPinned}
              onChange={(e) => setPrefs({ sidebarPinned: e.target.checked })}
              className="size-3.5 accent-[color:var(--brand)]"
            />
            Pinned open
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Font size">
        <RadioRow
          value={prefs.fontSize}
          onChange={(v) => setPrefs({ fontSize: v as FontSize })}
          options={[
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Notifications" description="Per event, choose sound and badge.">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 items-center text-xs">
          <div />
          <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sound</div>
          <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Badge</div>
          {(
            [
              ["dm", "New DM"],
              ["mention", "Mention"],
              ["taskAssigned", "Task assigned"],
              ["incomingCall", "Incoming call"],
            ] as const
          ).map(([key, label]) => (
            <NotifRow key={key} label={label} keyName={key} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Personal office backdrop" description="Only you see this — separate from the shared team backdrop.">
        <div className="flex flex-wrap gap-2 mb-4">
          {BACKDROP_OPTIONS.map((b) => {
            const active = prefs.backdrop === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setPrefs({ backdrop: b.id })}
                className={cn(
                  "h-16 w-24 rounded-lg border-2 transition overflow-hidden",
                  active ? "border-brand" : "border-border hover:border-brand/40"
                )}
                style={
                  b.css === "transparent"
                    ? {}
                    : b.id === "grid"
                      ? { backgroundImage: b.css, backgroundSize: "16px 16px" }
                      : { backgroundImage: b.css }
                }
              >
                <span className="block text-[10px] font-medium mt-1">{b.label}</span>
              </button>
            );
          })}
        </div>
        <Field
          label="Custom image URL"
          value={prefs.backdropImage}
          onChange={(v) => setPrefs({ backdropImage: v })}
          placeholder="https://…"
        />
      </SectionCard>

      <SectionCard title="Change password">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Current password" type="password" />
          <div />
          <Field label="New password" type="password" />
          <Field label="Confirm new password" type="password" />
        </div>
        <button className="mt-4 flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground">
          <Save className="size-3.5" /> Update password
        </button>
      </SectionCard>

      <SectionCard title="Session">
        <p className="text-xs text-muted-foreground">
          Signing out disconnects this device from your team headquarters.
        </p>
        <button
          onClick={logout}
          className="mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
      </SectionCard>
    </div>
  );
}

function NotifRow({
  label,
  keyName,
}: {
  label: string;
  keyName: "dm" | "mention" | "taskAssigned" | "incomingCall";
}) {
  const { prefs, setPrefs } = useApp();
  const val = prefs.notifications[keyName];
  const set = (patch: { sound?: boolean; badge?: boolean }) =>
    setPrefs({
      notifications: { ...prefs.notifications, [keyName]: { ...val, ...patch } },
    });
  return (
    <>
      <div className="text-sm">{label}</div>
      <div className="text-center">
        <Switch checked={val.sound} onChange={(c) => set({ sound: c })} />
      </div>
      <div className="text-center">
        <Switch checked={val.badge} onChange={(c) => set({ badge: c })} />
      </div>
    </>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition",
        checked ? "bg-brand" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "inline-block size-3 rounded-full bg-white transition",
          checked ? "translate-x-3.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/* ---------------------- Admin Settings ---------------------- */

function AdminSettings() {
  const { adminConfig, setAdminConfig, users, adminUserPermissions, setUserShutdownPermission } = useApp();
  const [permissionError, setPermissionError] = useState("");
  const [permissionSaving, setPermissionSaving] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5 text-xs">
        <ShieldCheck className="size-4 text-amber-500 mt-0.5" />
        <div>
          <div className="font-semibold text-amber-600 dark:text-amber-400">Workspace-wide settings</div>
          <div className="text-muted-foreground mt-0.5">
            Changes here affect every teammate. Personal preferences live in the "My Preferences" tab.
          </div>
        </div>
      </div>

      <SectionCard title="Shared team backdrop" description="Applied to every teammate unless they override with a personal backdrop.">
        <div className="flex flex-wrap gap-2 mb-4">
          {BACKDROP_OPTIONS.map((b) => {
            const active = adminConfig.teamBackdrop === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setAdminConfig({ teamBackdrop: b.id })}
                className={cn(
                  "h-16 w-24 rounded-lg border-2 transition overflow-hidden",
                  active ? "border-amber-500" : "border-border hover:border-amber-500/40"
                )}
                style={
                  b.css === "transparent"
                    ? {}
                    : b.id === "grid"
                      ? { backgroundImage: b.css, backgroundSize: "16px 16px" }
                      : { backgroundImage: b.css }
                }
              >
                <span className="block text-[10px] font-medium mt-1">{b.label}</span>
              </button>
            );
          })}
        </div>
        <Field
          label="Shared background image URL"
          value={adminConfig.teamBackdropImage}
          onChange={(v) => setAdminConfig({ teamBackdropImage: v })}
          placeholder="https://…"
        />
      </SectionCard>

      <SectionCard title="Google Drive integration">
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="API key"
            value={adminConfig.googleDriveApiKey}
            onChange={(v) => setAdminConfig({ googleDriveApiKey: v })}
            placeholder="AIza…"
          />
          <Field
            label="OAuth Client ID"
            value={adminConfig.googleDriveClientId}
            onChange={(v) => setAdminConfig({ googleDriveClientId: v })}
            placeholder="1234-abc.apps.googleusercontent.com"
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={adminConfig.googleDriveConnected}
            onChange={(e) => setAdminConfig({ googleDriveConnected: e.target.checked })}
            className="size-3.5 accent-[color:var(--brand)]"
          />
          Mark connection as active
        </label>
      </SectionCard>

      <SectionCard title="User permissions" description="Choose who may turn off the desktop app completely. Closing a window always keeps the office running in the tray.">
        <div className="divide-y divide-border/60 rounded-lg border border-border">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar user={u} size={24} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{u.name}</div>
                  <div className="text-[10px] text-muted-foreground">Can turn off V-Office</div>
                </div>
              </div>
              <div className={permissionSaving === u.id ? "pointer-events-none opacity-50" : ""}>
                <Switch checked={!!adminUserPermissions[u.id]} onChange={async (granted) => {
                  setPermissionError("");
                  setPermissionSaving(u.id);
                  try { await setUserShutdownPermission(u.id, granted); }
                  catch (e) { setPermissionError(e instanceof Error ? e.message : "Permission update failed"); }
                  finally { setPermissionSaving(null); }
                }} />
              </div>
            </div>
          ))}
        </div>
        {permissionError && <p className="mt-2 text-xs text-red-500">{permissionError}</p>}
      </SectionCard>

      <SectionCard title="Update channel">
        <RadioRow
          value={adminConfig.updateChannel}
          onChange={(v) => setAdminConfig({ updateChannel: v as UpdateChannel })}
          options={[
            { value: "stable", label: "Stable" },
            { value: "beta", label: "Beta" },
            { value: "nightly", label: "Nightly" },
          ]}
        />
      </SectionCard>

      <SectionCard title="Analytics" description="Live snapshot of workspace health.">
        <div className="grid grid-cols-4 gap-3 mb-5">
          <Stat label="Active sessions" value="7" />
          <Stat label="Avg CPU" value="18%" />
          <Stat label="Avg RAM" value="412 MB" />
          <Stat label="Network" value="1.2 MB/s" />
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            <div>User</div>
            <div className="text-right">1d</div>
            <div className="text-right">7d</div>
            <div className="text-right">30d</div>
          </div>
          {users.map((u, i) => (
            <div
              key={u.id}
              className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] px-3 py-2 items-center border-t border-border/60 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Avatar user={u} size={22} />
                <span className="truncate">{u.name}</span>
              </div>
              <div className="text-right font-mono text-xs text-muted-foreground">{4 + i}h</div>
              <div className="text-right font-mono text-xs text-muted-foreground">{22 + i * 4}h</div>
              <div className="text-right font-mono text-xs text-muted-foreground">{88 + i * 6}h</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Audit log">
        <div className="rounded-lg border border-border overflow-hidden">
          {SAMPLE_AUDIT.map((row, i) => {
            const u = users.find((x) => x.id === row.actorId);
            return (
              <div
                key={row.id}
                className={cn(
                  "grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,180px)] gap-3 px-3 py-2 text-xs items-center",
                  i > 0 && "border-t border-border/60"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {u && <Avatar user={u} size={20} />}
                  <span className="truncate">{u?.name}</span>
                </div>
                <div className="min-w-0 truncate">
                  <span className="text-foreground">{row.action}</span>
                  <span className="text-muted-foreground"> · {row.target}</span>
                </div>
                <div className="text-right text-muted-foreground font-mono text-[10px]">
                  {row.timestamp}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

/* ---------------------- shared bits ---------------------- */

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function RadioRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1 rounded-md text-xs font-medium transition",
            value === o.value
              ? "bg-brand text-brand-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
