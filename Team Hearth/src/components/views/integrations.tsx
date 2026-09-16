import { useApp } from "@/lib/app-context";
import { Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { Cloud } from "lucide-react";

export function IntegrationsView() {
  const { adminConfig, setAdminConfig, currentUser } = useApp();
  const isAdmin = currentUser?.role === "admin";
  const drive = adminConfig.googleDriveConnected;

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        eyebrow="INTEGRATIONS"
        title="Connect the tools you actually use."
        subtitle="Only services supported by this headquarters appear here."
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="size-11 rounded-xl bg-blue-500/15 text-blue-500 grid place-items-center">
                <Cloud className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Google Drive</h3>
                  <span
                    className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full ${
                      drive
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {drive ? "Connected" : "Not connected"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sync team files and let Edith AI reference documents.
                </p>

                {isAdmin ? (
                  <div className="mt-4 space-y-3">
                    <Input
                      label="API Key"
                      value={adminConfig.googleDriveApiKey}
                      onChange={(v) => setAdminConfig({ googleDriveApiKey: v })}
                      placeholder="AIza…"
                    />
                    <Input
                      label="OAuth Client ID"
                      value={adminConfig.googleDriveClientId}
                      onChange={(v) => setAdminConfig({ googleDriveClientId: v })}
                      placeholder="1234-abc.apps.googleusercontent.com"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setAdminConfig({ googleDriveConnected: !drive })
                        }
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                          drive
                            ? "border border-border hover:bg-muted"
                            : "bg-brand text-brand-foreground"
                        }`}
                      >
                        {drive ? "Disconnect" : "Connect"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-muted-foreground italic">
                    Only admins can configure Drive credentials.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <p className="px-1 text-xs text-muted-foreground">Additional integrations will appear only when their backend support is available.</p>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
