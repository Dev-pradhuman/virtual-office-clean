import { CalendarDays, CheckCircle2, FolderKanban, MessageSquare, Phone, Plus, Upload, Users } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Avatar, Card, PresenceDot } from "@/components/ui-bits";
import { ViewHeader } from "./_header";

export function DashboardView() {
  const { users, tasks, projects, events, messages, currentUser, connected, setActiveView } = useApp();
  if (!currentUser) return null;
  const online = users.filter((user) => user.status === "online");
  const openTasks = tasks.filter((task) => task.status !== "completed");
  const mine = openTasks.filter((task) => task.assigneeId === currentUser.id).slice(0, 5);
  const activeProjects = projects.filter((project) => project.status === "active");
  const upcoming = [...events].filter((event) => event.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 4);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="vo-page">
      <ViewHeader eyebrow="HEADQUARTERS" title={`${greeting}, ${currentUser.name.split(" ")[0]}`} subtitle={connected ? "Same people. A smarter way to work." : "Reconnecting to your headquarters…"} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={Users} label="Team Online" value={`${online.length} / ${users.length}`} hint={online.length === users.length && users.length ? "Everyone’s here" : `${users.length - online.length} offline`} />
        <Stat icon={CheckCircle2} label="Open Tasks" value={openTasks.length} hint={`${mine.length} assigned to you`} />
        <Stat icon={FolderKanban} label="Active Projects" value={activeProjects.length} hint={`${projects.length} total workstreams`} />
        <Stat icon={CalendarDays} label="Upcoming Events" value={upcoming.length} hint={upcoming[0]?.title || "Nothing scheduled"} />
      </div>

      <div className="vo-dashboard-grid">
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <PanelTitle icon={MessageSquare} title="Office Pulse" detail="Live activity from your team" />
            <div className="divide-y divide-border">
              {messages.slice(-5).reverse().map((message) => {
                const author = users.find((user) => user.id === message.authorId);
                return <div key={message.id} className="flex items-start gap-3 px-4 py-3">{author && <Avatar user={author} size={30} showStatus />}<div className="min-w-0 flex-1"><div className="flex gap-2"><strong className="text-xs">{author?.name || "Team member"}</strong><span className="text-[10px] text-muted-foreground">{message.timestamp}</span></div><p className="mt-0.5 line-clamp-2 text-xs text-secondary-foreground">{message.content}</p></div><span className="vo-chip">Chat</span></div>;
              })}
              {!messages.length && <Empty text="Team messages and activity will appear here." />}
            </div>
          </Card>
          <Card className="vo-brand-strip"><div><strong>A private office for your real work.</strong><span>Chat. Plan. Build. All in one place.</span></div><div className="text-right"><b>V-OFFICE</b><small>YOUR DIGITAL HEADQUARTERS</small></div></Card>
        </div>

        <div className="space-y-3">
          <Card><PanelTitle icon={CalendarDays} title="Upcoming Events" /><div className="divide-y divide-border">{upcoming.map((event) => <button key={event.id} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setActiveView("calendar")}><span className="size-2 rounded-full bg-cyan-400" /><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{event.title}</strong><span className="text-[10px] text-muted-foreground">{event.date}{event.time ? ` · ${event.time}` : ""}</span></div></button>)}{!upcoming.length && <Empty text="No upcoming events." />}</div></Card>
          <Card><PanelTitle icon={Plus} title="Quick Actions" /><div className="space-y-2 p-3"><Quick icon={Phone} label="Start Huddle" note="Jump into the office call" onClick={() => setActiveView("call")} /><Quick icon={Plus} label="New Task" note="Capture and assign work" onClick={() => setActiveView("tasks")} /><Quick icon={Upload} label="Upload File" note="Share with your team" onClick={() => setActiveView("files")} /></div></Card>
        </div>

        <aside className="space-y-3">
          <Card><PanelTitle icon={Users} title="Team Online" /><div className="divide-y divide-border">{online.slice(0, 6).map((user) => <div key={user.id} className="flex items-center gap-2.5 px-4 py-3"><Avatar user={user} size={30} /><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{user.name}</strong><span className="block truncate text-[10px] text-muted-foreground">{user.statusMessage || user.designation}</span></div><PresenceDot status="online" ring={false} showTooltip={false} /></div>)}{!online.length && <Empty text="Nobody else is online." />}</div></Card>
          <Card><PanelTitle icon={CheckCircle2} title="My Tasks" /><div className="divide-y divide-border">{mine.map((task) => <button key={task.id} onClick={() => setActiveView("tasks")} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"><span className="size-4 rounded-full border border-muted-foreground" /><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{task.title}</strong><span className="text-[10px] capitalize text-muted-foreground">{task.priority} priority</span></div><span className="text-[10px] text-cyan-400">{task.dueDate || "Open"}</span></button>)}{!mine.length && <Empty text="No open tasks assigned to you." />}</div></Card>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string | number; hint: string }) { return <Card className="flex items-center gap-3 p-4"><div className="vo-stat-icon"><Icon className="size-5" /></div><div className="min-w-0"><span className="block text-[11px] text-muted-foreground">{label}</span><strong className="block text-2xl font-semibold leading-tight">{value}</strong><small className="block truncate text-[10px] text-muted-foreground">{hint}</small></div></Card>; }
function PanelTitle({ icon: Icon, title, detail }: { icon: typeof Users; title: string; detail?: string }) { return <div className="flex items-center gap-2 border-b border-border px-4 py-3"><Icon className="size-4 text-cyan-400" /><div><h2 className="text-sm font-semibold">{title}</h2>{detail && <p className="text-[10px] text-muted-foreground">{detail}</p>}</div></div>; }
function Quick({ icon: Icon, label, note, onClick }: { icon: typeof Users; label: string; note: string; onClick: () => void }) { return <button onClick={onClick} className="vo-quick-action"><span><Icon className="size-4" /></span><div><strong>{label}</strong><small>{note}</small></div><b>›</b></button>; }
function Empty({ text }: { text: string }) { return <p className="vo-empty-copy px-4 py-6">{text}</p>; }
