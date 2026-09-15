import { useMemo, useRef, useState } from "react";
import { ViewHeader } from "./_header";
import { OfficeScene } from "@/components/office/OfficeScene";
import { useApp } from "@/lib/app-context";
import { OFFICE_THEMES } from "@/lib/sample-data";
import { Avatar, Card } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { MessageSquare, Send, Palette } from "lucide-react";

export function DashboardView() {
  const {
    users,
    connected,
    officeBackdrop,
    prefs,
    setPrefs,
    messages,
    postMessage,
    currentUser,
    setActiveView,
  } = useApp();
  const online = users.filter((u) => u.status !== "offline").length;

  return (
    <div className="h-full flex flex-col relative">
      <ViewHeader
        title="Office"
        subtitle={
          connected
            ? `${online} of ${users.length} online`
            : "Connecting to headquarters…"
        }
      />
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-10 lg:pb-16 pt-6 lg:pt-10">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Who's-online backdrop: a distinct image for each combination of
              teammates currently online (served by the backend / built-in set). */}
          {officeBackdrop && (
            <div className="relative rounded-2xl overflow-hidden border border-border/60 shadow-sm aspect-[16/7]">
              <img
                src={officeBackdrop}
                alt="Office backdrop for who's online"
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-3 left-4 text-xs font-medium text-white/90">
                {online === 0 ? "Nobody's in yet" : `${online} online right now`}
              </div>
            </div>
          )}

          {/* Office theme picker — personal, applied to the live scene below. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mr-1">
              <Palette className="size-3.5" /> Office theme
            </span>
            {OFFICE_THEMES.map((t) => {
              const active = prefs.officeTheme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setPrefs({ officeTheme: t.id })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                    active
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className="size-3 rounded-full ring-1 ring-white/20"
                    style={{ background: t.swatch }}
                  />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Live team scene — desks light up per real presence. */}
          <OfficeScene demo={false} />

          {/* Team chat, right in the office. */}
          <OfficeChatPanel
            messages={messages}
            users={users}
            currentUserId={currentUser?.id}
            onSend={(t) => postMessage(t, "general")}
            onOpenFull={() => setActiveView("chat")}
          />
        </div>
      </div>
    </div>
  );
}

function OfficeChatPanel({
  messages,
  users,
  currentUserId,
  onSend,
  onOpenFull,
}: {
  messages: { id: string; channelId: string; authorId: string; timestamp: string; content: string }[];
  users: ReturnType<typeof useApp>["users"];
  currentUserId?: string;
  onSend: (text: string) => void;
  onOpenFull: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Latest handful of #general messages, oldest → newest.
  const recent = useMemo(
    () => messages.filter((m) => m.channelId === "general").slice(-8),
    [messages],
  );

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
    // Let the new message render, then pin to bottom.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4 text-brand" />
          Team chat
          <span className="text-[10px] font-normal text-muted-foreground">#general</span>
        </div>
        <button
          onClick={onOpenFull}
          className="text-[11px] font-medium text-brand hover:underline"
        >
          Open full chat →
        </button>
      </div>

      <div ref={scrollRef} className="max-h-64 overflow-y-auto p-4 space-y-3">
        {recent.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            No messages yet. Start the conversation 👋
          </div>
        ) : (
          recent.map((m) => {
            const author = users.find((u) => u.id === m.authorId);
            if (!author) return null;
            const isSelf = author.id === currentUserId;
            return (
              <div key={m.id} className="flex gap-2.5">
                <Avatar user={author} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-xs font-semibold", isSelf && "text-brand")}>
                      {author.name.split(" ")[0]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                  </div>
                  <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-center gap-2 border-t border-border/60 p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message #general…"
          className="flex-1 rounded-full border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="size-9 shrink-0 rounded-full bg-brand text-brand-foreground grid place-items-center disabled:opacity-40 hover:brightness-110"
        >
          <Send className="size-4" />
        </button>
      </form>
    </Card>
  );
}
