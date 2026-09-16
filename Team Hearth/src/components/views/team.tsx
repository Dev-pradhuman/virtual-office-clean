import { MessageSquare, Phone, Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Avatar, Card, PresenceDot } from "@/components/ui-bits";
import { ViewHeader } from "./_header";

export function TeamView() {
  const { users, currentUser, userActivity, setActiveView } = useApp();
  const online = users.filter((user) => user.status === "online");
  const inCalls = users.filter((user) => user.inCall);
  return (
    <div className="vo-page">
      <ViewHeader eyebrow="TEAM" title="People make progress." subtitle="Your real team, connected in one shared headquarters." />
      <div className="vo-page-grid">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="vo-section-title">Team Directory <span>{users.length} members</span></h2>
            <span className="text-[11px] text-muted-foreground">Online first</span>
          </div>
          {users.length === 0 ? <EmptyTeam /> : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {[...users].sort((a, b) => Number(b.status === "online") - Number(a.status === "online")).map((user) => {
                const activity = userActivity[user.id]?.label || user.currentApp || user.statusMessage;
                return (
                  <Card key={user.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar user={user} size={52} showStatus isMe={user.id === currentUser?.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate text-sm font-semibold">{user.name}</h3>
                          {user.id === currentUser?.id && <span className="vo-chip">You</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{user.designation}</p>
                        <p className="mt-1 truncate text-xs text-secondary-foreground">{activity || "No current activity"}</p>
                        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                          <PresenceDot status={user.status} ring={false} showTooltip={false} />
                          <span className={user.status === "online" ? "text-emerald-400" : "text-muted-foreground"}>{user.status === "online" ? "Online" : "Offline"}</span>
                          {user.inCall && <span className="text-cyan-400">· In a call</span>}
                        </div>
                      </div>
                    </div>
                    {user.id !== currentUser?.id && (
                      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
                        <button className="vo-secondary-button" onClick={() => setActiveView("chat")}><MessageSquare className="size-3.5" /> Message</button>
                        <button className="vo-secondary-button" onClick={() => setActiveView("call")}><Phone className="size-3.5" /> Call</button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
        <aside className="vo-right-rail">
          <Card className="p-4">
            <h2 className="vo-section-title">Team at a Glance</h2>
            <div className="mt-4 grid grid-cols-2 divide-x divide-border">
              <Metric value={online.length} label="Online" color="text-emerald-400" />
              <Metric value={users.length - online.length} label="Offline" />
            </div>
            <div className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">{users.length} total members</div>
          </Card>
          <Card className="p-4">
            <h2 className="vo-section-title">Currently in Huddles</h2>
            <div className="mt-3 space-y-2">
              {inCalls.length ? inCalls.map((user) => <div key={user.id} className="flex items-center gap-2 rounded-lg border border-border p-2"><Avatar user={user} size={28} /><span className="min-w-0 flex-1 truncate text-xs">{user.name}</span><span className="text-[10px] text-cyan-400">In call</span></div>) : <p className="vo-empty-copy">No active huddles.</p>}
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="vo-section-title">Live Activity</h2>
            <div className="mt-3 space-y-3">
              {Object.entries(userActivity).length ? Object.entries(userActivity).map(([id, activity]) => {
                const user = users.find((item) => item.id === id);
                return user ? <div key={id} className="flex items-center gap-2"><Avatar user={user} size={26} /><div className="min-w-0"><p className="truncate text-xs font-medium">{user.name}</p><p className="truncate text-[10px] text-muted-foreground">{activity.label}</p></div></div> : null;
              }) : <p className="vo-empty-copy">Activity appears as teammates move through V-OFFICE.</p>}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Metric({ value, label, color = "text-foreground" }: { value: number; label: string; color?: string }) {
  return <div className="px-3 first:pl-0"><div className={`text-2xl font-semibold ${color}`}>{value}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div></div>;
}

function EmptyTeam() {
  return <Card className="grid min-h-52 place-items-center p-8 text-center"><div><Users className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No teammates yet</p><p className="mt-1 text-xs text-muted-foreground">Members appear here after they join this headquarters.</p></div></Card>;
}
