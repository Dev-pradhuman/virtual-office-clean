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
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setConnecting(true); setError("");
    try { await login(username, password, hq); if (remember) saveCreds({ hq, username, password }); else saveCreds(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect to HQ"); }
    finally { setConnecting(false); }
  };
  return (
    <div className="vo-login-shell">
      <section className="vo-login-visual">
        <div className="vo-login-brand"><div className="vo-mark"><span>V</span></div><div><strong>V-OFFICE</strong><small>YOUR DIGITAL HEADQUARTERS</small></div></div>
        <div className="vo-login-copy"><span>PRIVATE · PERSISTENT · TOGETHER</span><h1>Work together.<br /><em>From anywhere.</em></h1><p>A focused digital headquarters where your team can talk, plan, build, and stay connected.</p></div>
        <div className="vo-login-mountains" aria-hidden="true" />
      </section>
      <section className="vo-login-form-wrap">
        <form onSubmit={submit} className="vo-login-form">
          <div className="vo-eyebrow">WELCOME BACK</div><h2>Enter headquarters</h2><p>Sign in with your private team credentials.</p>
          <div className="mt-7 space-y-4">
            <Field label="Headquarters Address" hint="Your team server"><input value={hq} onChange={(e) => setHq(e.target.value)} placeholder="https://your-hq.onrender.com" className="vo-field" required /></Field>
            <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your username" className="vo-field" required /></Field>
            <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="vo-field" required /></Field>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-3.5 accent-cyan-400" />Remember me on this device</label>
          {error && <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <button type="submit" disabled={connecting} className="vo-primary-button mt-6 w-full justify-center py-3 disabled:opacity-60">{connecting ? "Connecting…" : "Sign In"}</button>
          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-400" />Private team workspace</div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><div className="mb-1.5 flex justify-between"><span className="text-xs font-medium">{label}</span>{hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}</div>{children}</label>;
}
