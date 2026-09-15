import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { DEFAULT_HQ, getSavedCreds, saveCreds } from "@/lib/api";

export function LoginScreen() {
  const { login } = useApp();
  const saved = getSavedCreds();
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState(saved?.password ?? "");
  const [hq, setHq] = useState(saved?.hq || DEFAULT_HQ);
  const [remember, setRemember] = useState(!!saved);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError("");
    try {
      await login(username, password, hq);
      // Only persist credentials once the login actually succeeded.
      if (remember) saveCreds({ hq, username, password });
      else saveCreds(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to HQ");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen w-full grid place-items-center overflow-hidden bg-background"
      style={{
        backgroundImage:
          "radial-gradient(at 15% 10%, rgba(99,102,241,0.18), transparent 55%), radial-gradient(at 85% 0%, rgba(16,185,129,0.14), transparent 50%), radial-gradient(at 50% 100%, rgba(244,114,182,0.10), transparent 55%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative w-[420px] max-w-[92vw]">
        <div className="mb-6 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-brand grid place-items-center text-brand-foreground font-bold shadow-lg shadow-[color:var(--brand)]/25">
            V
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Virtual Office</div>
            <div className="text-sm font-semibold">Team Headquarters</div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-card/95 backdrop-blur p-7 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.25)]"
        >
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect to your team headquarters to see who's online.
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Headquarters Address" hint="Your team's server URL">
              <input
                type="text"
                value={hq}
                onChange={(e) => setHq(e.target.value)}
                placeholder="https://hq.yourteam.co"
                className="w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
            </Field>
            <Field label="Username">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alex"
                className="w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
            </Field>
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-3.5 rounded border-border accent-[var(--brand)]"
            />
            Remember me on this device
          </label>

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={connecting}
            className="mt-6 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-brand-foreground shadow-sm transition hover:brightness-110 disabled:opacity-70"
          >
            {connecting ? "Connecting…" : "Connect to HQ"}
          </button>

          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[var(--presence-online)]" />
              End-to-end encrypted
            </span>
            <button type="button" className="hover:text-foreground">
              Forgot password?
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sign in with your team credentials
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  );
}