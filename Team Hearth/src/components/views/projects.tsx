import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { Avatar, Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { Modal, ModalActions, ModalButton, ModalField, fieldClass } from "../modal";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  on_hold: "bg-muted text-muted-foreground border-border",
  completed: "bg-brand/15 text-brand border-brand/30",
};

export function ProjectsView() {
  const { users, projects, tasks, createProject, deleteProject } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createProject({ name: name.trim(), description: description.trim() });
      toast.success("Project created");
      setOpen(false);
      setName("");
      setDescription("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        eyebrow="PROJECTS"
        title="Build what’s next, together."
        subtitle={`${projects.length} real workstream${projects.length === 1 ? "" : "s"} in this headquarters`}
        actions={
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground"
          >
            <Plus className="size-3.5" /> New project
          </button>
        }
      />

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <form onSubmit={onSubmit} className="space-y-4">
          <ModalField label="Project name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Presence Engine v2"
              className={fieldClass}
              required
            />
          </ModalField>
          <ModalField label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this workstream about?"
              rows={3}
              className={`${fieldClass} resize-none`}
            />
          </ModalField>
          <ModalActions>
            <ModalButton type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </ModalButton>
            <ModalButton type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create project"}
            </ModalButton>
          </ModalActions>
        </form>
      </Modal>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="vo-page-grid">
        <div className="min-w-0">
        {projects.length === 0 ? (
          <Card className="px-6 py-16 text-center text-sm text-muted-foreground">No projects yet. Create the first one.</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((p) => {
              const projTasks = tasks.filter((t) => t.projectId === p.id);
              const done = projTasks.filter((t) => t.status === "completed").length;
              const progress = projTasks.length ? Math.round((done / projTasks.length) * 100) : null;
              return (
                <Card key={p.id} className="group p-5 hover:border-brand/40 transition">
                  <div className="flex items-start justify-between mb-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[p.status]}`}
                    >
                      {p.status.replace("_", " ")}
                    </span>
                    <button
                      onClick={() => deleteProject(p.id)}
                      title="Delete project"
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <h3 className="text-sm font-semibold">{p.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.description}</p>

                  {progress !== null && <div className="mt-4">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span className="font-mono">{progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
                    </div>
                  </div>}

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex -space-x-1.5">
                      {p.members.map((mId) => {
                        const u = users.find((x) => x.id === mId);
                        return u ? (
                          <div key={mId} className="ring-2 ring-card rounded-full">
                            <Avatar user={u} size={22} />
                          </div>
                        ) : null;
                      })}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {projTasks.length} task{projTasks.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        </div>
        <aside className="vo-right-rail space-y-4">
          <Card className="p-5">
            <h3 className="vo-section-title">Project overview</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Summary label="Active" value={projects.filter((p) => p.status === "active").length} />
              <Summary label="Planning" value={projects.filter((p) => p.status === "planning").length} />
              <Summary label="On hold" value={projects.filter((p) => p.status === "on_hold").length} />
              <Summary label="Completed" value={projects.filter((p) => p.status === "completed").length} />
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="vo-section-title">Work in progress</h3>
            <div className="mt-3 divide-y divide-border/70">
              {projects.filter((p) => p.status === "active").slice(0, 5).map((project) => <div key={project.id} className="py-3"><div className="truncate text-xs font-medium">{project.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{tasks.filter((task) => task.projectId === project.id && task.status !== "completed").length} open tasks</div></div>)}
              {!projects.some((p) => p.status === "active") && <p className="py-4 text-xs text-muted-foreground">No active projects.</p>}
            </div>
          </Card>
        </aside>
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-border bg-muted/20 p-3"><div className="text-xl font-semibold">{value}</div><div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div></div>;
}
