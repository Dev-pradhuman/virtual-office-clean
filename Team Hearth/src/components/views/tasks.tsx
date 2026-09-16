import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { apiFetch, fmtTime } from "@/lib/api";
import { Avatar, Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { Modal, ModalActions, ModalButton, ModalField, fieldClass } from "../modal";
import type { Task } from "@/lib/sample-data";
import { Plus, MessageSquare, Calendar as Cal, Flag, X, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TaskComment {
  id: number;
  user_id: number;
  username?: string;
  content: string;
  created_at?: string;
}
interface TaskActivity {
  id: number;
  username?: string;
  action: string;
  detail: string;
  created_at?: string;
}

const COLUMNS: { id: Task["status"]; title: string; hint: string }[] = [
  { id: "todo", title: "To do", hint: "Not started" },
  { id: "in_progress", title: "In progress", hint: "Actively working" },
  { id: "completed", title: "Completed", hint: "Shipped" },
];

const PRIORITY = {
  low: { label: "Low", cls: "bg-muted text-muted-foreground" },
  medium: { label: "Medium", cls: "bg-brand/10 text-brand" },
  high: { label: "High", cls: "bg-[var(--danger)]/10 text-[var(--danger)]" },
};

export function TasksView() {
  const { tasks, users, moveTask, createTask } = useApp();
  const [selected, setSelected] = useState<Task | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [commentText, setCommentText] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [nt, setNt] = useState<{ title: string; description: string; assigneeId: string; priority: Task["priority"] }>({
    title: "",
    description: "",
    assigneeId: "",
    priority: "medium",
  });
  const [saving, setSaving] = useState(false);

  // Keep the selected task in sync with the live tasks list.
  useEffect(() => {
    if (selected) {
      const fresh = tasks.find((t) => t.id === selected.id);
      if (fresh && fresh !== selected) setSelected(fresh);
      if (!fresh) setSelected(null);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load comments + activity when a task opens.
  useEffect(() => {
    if (!selected) {
      setComments([]);
      setActivities([]);
      return;
    }
    let cancelled = false;
    apiFetch<TaskComment[]>(`/api/tasks/${selected.id}/comments`)
      .then((c) => !cancelled && setComments(c))
      .catch(() => {});
    apiFetch<TaskActivity[]>(`/api/tasks/${selected.id}/activities`)
      .then((a) => !cancelled && setActivities(a))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nt.title.trim()) return;
    setSaving(true);
    try {
      await createTask({
        title: nt.title.trim(),
        description: nt.description.trim(),
        assigneeId: nt.assigneeId || undefined,
        priority: nt.priority,
      });
      toast.success("Task created");
      setNewOpen(false);
      setNt({ title: "", description: "", assigneeId: "", priority: "medium" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async () => {
    if (!selected || !commentText.trim()) return;
    try {
      const c = await apiFetch<TaskComment>(`/api/tasks/${selected.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setComments((prev) => [...prev, c]);
      setCommentText("");
      apiFetch<TaskActivity[]>(`/api/tasks/${selected.id}/activities`)
        .then(setActivities)
        .catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add comment");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Tasks & projects"
        subtitle={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        actions={
          <button
            onClick={() => setNewOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground"
          >
            <Plus className="size-3.5" />
            New task
          </button>
        }
      />

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New task">
        <form onSubmit={onCreateTask} className="space-y-4">
          <ModalField label="Title">
            <input
              autoFocus
              value={nt.title}
              onChange={(e) => setNt((s) => ({ ...s, title: e.target.value }))}
              placeholder="Define the API contract"
              className={fieldClass}
              required
            />
          </ModalField>
          <ModalField label="Description (optional)">
            <textarea
              value={nt.description}
              onChange={(e) => setNt((s) => ({ ...s, description: e.target.value }))}
              rows={3}
              className={`${fieldClass} resize-none`}
            />
          </ModalField>
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Assignee">
              <select
                value={nt.assigneeId}
                onChange={(e) => setNt((s) => ({ ...s, assigneeId: e.target.value }))}
                className={fieldClass}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </ModalField>
            <ModalField label="Priority">
              <select
                value={nt.priority}
                onChange={(e) => setNt((s) => ({ ...s, priority: e.target.value as Task["priority"] }))}
                className={fieldClass}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </ModalField>
          </div>
          <ModalActions>
            <ModalButton type="button" variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </ModalButton>
            <ModalButton type="submit" disabled={saving || !nt.title.trim()}>
              {saving ? "Creating…" : "Create task"}
            </ModalButton>
          </ModalActions>
        </form>
      </Modal>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-x-auto p-6">
          <div className="grid grid-cols-3 gap-4 min-w-[900px] h-full">
            {COLUMNS.map((col) => {
              const columnTasks = tasks.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging) {
                      moveTask(dragging, col.id);
                      setDragging(null);
                    }
                  }}
                  className="flex flex-col rounded-xl bg-muted/40 border border-border/60"
                >
                  <div className="flex items-center justify-between p-3 border-b border-border/60">
                    <div>
                      <div className="text-xs font-semibold">{col.title}</div>
                      <div className="text-[10px] text-muted-foreground">{col.hint}</div>
                    </div>
                    <span className="text-[10px] font-semibold rounded-full bg-card px-2 py-0.5 border border-border">
                      {columnTasks.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {columnTasks.map((t) => {
                      const a = users.find((u) => u.id === t.assigneeId);
                      return (
                        <Card
                          key={t.id}
                          draggable
                          onDragStart={() => setDragging(t.id)}
                          onClick={() => setSelected(t)}
                          className="p-3 cursor-pointer hover:shadow-md transition"
                        >
                          <div className="flex items-center gap-1.5 mb-2">
                            <span
                              className={cn(
                                "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                PRIORITY[t.priority].cls,
                              )}
                            >
                              {PRIORITY[t.priority].label}
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                              <Cal className="size-3" />
                              {t.dueDate}
                            </span>
                          </div>
                          <p className="text-xs font-medium leading-snug mb-3 text-pretty">
                            {t.title}
                          </p>
                          <div className="flex items-center justify-between">
                            {a && <Avatar user={a} size={22} />}
                            {t.comments.length > 0 && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <MessageSquare className="size-3" />
                                {t.comments.length}
                              </span>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selected && (
          <aside className="w-96 border-l border-border bg-card flex flex-col shrink-0">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Task detail
              </span>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-1 hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1",
                      PRIORITY[selected.priority].cls,
                    )}
                  >
                    <Flag className="size-3" />
                    {PRIORITY[selected.priority].label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Due {selected.dueDate}</span>
                </div>
                <h2 className="text-base font-semibold text-pretty">{selected.title}</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {selected.description}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  {(() => {
                    const a = users.find((u) => u.id === selected.assigneeId);
                    return a ? (
                      <>
                        <Avatar user={a} size={24} />
                        <span className="text-xs font-medium">{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">· Assignee</span>
                      </>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="p-5 border-b border-border">
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                  Comments
                </h3>
                {comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No comments yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {comments.map((c) => {
                      const a = users.find((u) => u.id === String(c.user_id));
                      return (
                        <li key={c.id} className="flex gap-2.5">
                          {a ? (
                            <Avatar user={a} size={26} />
                          ) : (
                            <div className="size-[26px] rounded-full bg-muted" />
                          )}
                          <div>
                            <div className="text-[11px]">
                              <span className="font-semibold">{c.username || a?.name || "Someone"}</span>
                              <span className="text-muted-foreground"> · {fmtTime(c.created_at)}</span>
                            </div>
                            <p className="text-xs mt-0.5">{c.content}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                  placeholder="Add a comment…  (Enter to send)"
                  className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 resize-none"
                  rows={2}
                />
              </div>

              <div className="p-5">
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-1.5">
                  <Activity className="size-3" />
                  Activity
                </h3>
                {activities.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No activity yet.</p>
                ) : (
                  <ul className="space-y-2 text-[11px] text-muted-foreground">
                    {activities.map((a) => (
                      <li key={a.id}>
                        <span className="font-semibold text-foreground">{a.username || "Someone"}</span>{" "}
                        {a.detail} · {fmtTime(a.created_at)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}