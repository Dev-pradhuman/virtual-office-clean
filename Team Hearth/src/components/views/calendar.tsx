import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { ViewHeader } from "./_header";
import { Avatar } from "../ui-bits";
import { Modal, ModalActions, ModalButton, ModalField, fieldClass } from "../modal";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function CalendarView() {
  const { users, events, createEvent } = useApp();
  const [view, setView] = useState<"month" | "week">("month");
  const today = new Date();
  // Month cursor — drives the grid and the prev/next arrows.
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    date: `${cursor.year}-${pad(cursor.month + 1)}-${pad(today.getDate())}`,
    time: "10:00",
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    try {
      await createEvent({ title: form.title.trim(), date: form.date, time: form.time });
      toast.success("Event added");
      setOpen(false);
      setForm((f) => ({ ...f, title: "" }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add event");
    } finally {
      setSaving(false);
    }
  };

  const monthDate = new Date(cursor.year, cursor.month, 1);
  const monthLabel = monthDate.toLocaleString("en", { month: "long", year: "numeric" });
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });

  const isTodayCell = (day: number) =>
    day === today.getDate() &&
    cursor.month === today.getMonth() &&
    cursor.year === today.getFullYear();

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        eyebrow="CALENDAR"
        title="Stay in sync. Make it happen together."
        subtitle={monthLabel}
        actions={
          <>
            <div className="flex rounded-md border border-border p-0.5">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium capitalize rounded",
                    view === v ? "bg-brand/10 text-brand" : "text-muted-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 ml-2">
              <button
                onClick={() => shiftMonth(-1)}
                title="Previous month"
                className="p-1.5 rounded-md hover:bg-muted"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
                title="Jump to today"
                className="px-2 py-1 text-[11px] font-medium rounded-md hover:bg-muted text-muted-foreground"
              >
                Today
              </button>
              <button
                onClick={() => shiftMonth(1)}
                title="Next month"
                className="p-1.5 rounded-md hover:bg-muted"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button
              onClick={() => setOpen(true)}
              className="ml-2 flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground"
            >
              <Plus className="size-3.5" />
              Event
            </button>
          </>
        }
      />

      <Modal open={open} onClose={() => setOpen(false)} title="New event">
        <form onSubmit={onSubmit} className="space-y-4">
          <ModalField label="Title">
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Sprint planning"
              className={fieldClass}
              required
            />
          </ModalField>
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Date">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={fieldClass}
                required
              />
            </ModalField>
            <ModalField label="Time">
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className={fieldClass}
              />
            </ModalField>
          </div>
          <ModalActions>
            <ModalButton type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </ModalButton>
            <ModalButton type="submit" disabled={saving || !form.title.trim()}>
              {saving ? "Adding…" : "Add event"}
            </ModalButton>
          </ModalActions>
        </form>
      </Modal>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden ring-1 ring-border">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="bg-card px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
            >
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            const dateStr = day
              ? `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`
              : "";
            const dayEvents = events.filter((e) => e.date === dateStr);
            return (
              <div
                key={i}
                className={cn(
                  "bg-card min-h-[104px] p-2 flex flex-col gap-1",
                  !day && "opacity-40",
                )}
              >
                {day && (
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      isTodayCell(day)
                        ? "size-5 grid place-items-center rounded-full bg-brand text-brand-foreground"
                        : "text-foreground/80",
                    )}
                  >
                    {day}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  {dayEvents.map((e) => (
                    <div
                      key={e.id}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium truncate"
                      style={{ background: `${e.color}22`, color: e.color }}
                    >
                      {e.time} · {e.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold mb-3">Upcoming</h3>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet. Add the first one.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                  <div
                    className="size-9 rounded-lg grid place-items-center text-[10px] font-semibold"
                    style={{ background: `${e.color}22`, color: e.color }}
                  >
                    {new Date(e.date).toLocaleDateString("en", { day: "numeric" })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(e.date).toLocaleDateString("en", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {e.time}
                    </div>
                  </div>
                  <div className="flex -space-x-2">
                    {e.attendees.map((aid) => {
                      const u = users.find((x) => x.id === aid);
                      return u ? (
                        <div key={aid} className="ring-2 ring-card rounded-full">
                          <Avatar user={u} size={24} />
                        </div>
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
