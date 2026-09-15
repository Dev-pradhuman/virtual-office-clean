import { useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import { Avatar, Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { CHANNELS } from "@/lib/sample-data";
import type { ChatMessage } from "@/lib/sample-data";
import { Hash, Paperclip, Send, Smile, AtSign, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const EMOJIS = [
  "😀", "😂", "🙂", "😉", "😍", "🤔", "😎", "🥳",
  "👍", "🙏", "🎉", "🔥", "💯", "✅", "❤️", "👀",
  "🚀", "☕", "🎯", "🙌", "😅", "😴", "🤝", "💡",
];

export function ChatView() {
  const {
    users,
    messages,
    dms,
    dmUnread,
    postMessage,
    postDm,
    loadDm,
    markDmRead,
    uploadFile,
    currentUser,
    activeChannel,
    setActiveChannel,
  } = useApp();
  const [tab, setTab] = useState<"channel" | "dm">("channel");
  const [activeDm, setActiveDmState] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!currentUser) return null;

  const otherUsers = users.filter((u) => u.id !== currentUser.id);
  const dm = activeDm ? users.find((u) => u.id === activeDm) : null;
  const channelMessages = messages.filter((m) => m.channelId === activeChannel);
  const dmMessages: ChatMessage[] = dm ? dms[dm.id] || [] : [];
  const shown = dm ? dmMessages : channelMessages;

  const openDm = (userId: string) => {
    setActiveDmState(userId);
    loadDm(userId);
    markDmRead(userId);
  };

  const insertAtEnd = (text: string) => {
    setDraft((d) => (d ? `${d}${d.endsWith(" ") ? "" : " "}${text} ` : `${text} `));
    inputRef.current?.focus();
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    if (dm) postDm(dm.id, text);
    else postMessage(text, activeChannel);
    setDraft("");
    setEmojiOpen(false);
    setMentionOpen(false);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try {
      await uploadFile(file);
      const note = `📎 Shared a file: ${file.name}`;
      if (dm) postDm(dm.id, note);
      else postMessage(note, activeChannel);
      toast.success(`Uploaded ${file.name} — also in Files.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title={dm ? dm.name : `# ${activeChannel}`}
        subtitle={dm ? dm.designation : `${users.length} members · Public channel`}
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-border bg-card/40 flex flex-col max-h-44 md:max-h-none">
          <div className="p-2 grid grid-cols-2 gap-1 border-b border-border">
            <button
              onClick={() => {
                setTab("channel");
                setActiveDmState(null);
              }}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium",
                tab === "channel" ? "bg-brand/10 text-brand" : "text-muted-foreground",
              )}
            >
              Channels
            </button>
            <button
              onClick={() => setTab("dm")}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium relative",
                tab === "dm" ? "bg-brand/10 text-brand" : "text-muted-foreground",
              )}
            >
              Direct
              {Object.values(dmUnread).some((n) => n > 0) && tab !== "dm" && (
                <span className="absolute top-1 right-3 size-1.5 rounded-full bg-brand" />
              )}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {tab === "channel" ? (
              <ul className="space-y-0.5">
                {CHANNELS.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => {
                      setActiveDmState(null);
                      setActiveChannel(c.id);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition",
                      !dm && c.id === activeChannel
                        ? "bg-brand/5 text-brand font-medium"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Hash className="size-3.5" />
                    {c.name}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-0.5">
                {otherUsers.length === 0 && (
                  <li className="px-2 py-3 text-[11px] text-muted-foreground">
                    No teammates yet.
                  </li>
                )}
                {otherUsers.map((u) => {
                  const unread = dmUnread[u.id] || 0;
                  return (
                    <li
                      key={u.id}
                      onClick={() => openDm(u.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-2 text-xs cursor-pointer",
                        activeDm === u.id ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <Avatar user={u} size={26} showStatus />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{u.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {u.status === "offline" ? "Offline" : u.designation}
                        </div>
                      </div>
                      {unread > 0 && (
                        <span className="rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-brand-foreground">
                          {unread}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="text-center">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted rounded-full px-3 py-1">
                {dm ? `Private conversation with ${dm.name.split(" ")[0]}` : "Today"}
              </span>
            </div>
            {shown.length === 0 && (
              <div className="text-center text-xs text-muted-foreground pt-10">
                {dm
                  ? `No messages with ${dm.name.split(" ")[0]} yet. Say hi 👋`
                  : `No messages in #${activeChannel} yet. Say hello 👋`}
              </div>
            )}
            {shown.map((m) => {
              const author = users.find((u) => u.id === m.authorId);
              if (!author) return null;
              const isSelf = author.id === currentUser.id;
              return (
                <div key={m.id} className="flex gap-3 group">
                  <Avatar user={author} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cn("text-sm font-semibold", isSelf && "text-brand")}>
                        {author.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                    </div>
                    <p className="text-sm text-foreground/85 leading-relaxed max-w-[60ch] text-pretty whitespace-pre-wrap">
                      {m.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-border">
            <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendDraft();
              }}
              className="relative rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand/40 transition p-2"
            >
              {/* Emoji picker */}
              {emojiOpen && (
                <Popover title="Emoji" onClose={() => setEmojiOpen(false)}>
                  <div className="grid grid-cols-8 gap-1">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          insertAtEnd(e);
                          setEmojiOpen(false);
                        }}
                        className="text-lg rounded hover:bg-muted p-1"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </Popover>
              )}
              {/* @ mention picker */}
              {mentionOpen && (
                <Popover title="Mention" onClose={() => setMentionOpen(false)}>
                  <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                    {otherUsers.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            insertAtEnd(`@${u.name.split(" ")[0]}`);
                            setMentionOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <Avatar user={u} size={22} />
                          <span className="font-medium">{u.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Popover>
              )}
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendDraft();
                  }
                }}
                placeholder={dm ? `Message ${dm.name.split(" ")[0]}` : `Message # ${activeChannel}`}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 min-h-[44px] max-h-40"
              />
              <div className="flex items-center justify-between border-t border-border/60 pt-2 mt-1 px-1">
                <div className="flex gap-1">
                  <IconBtn title="Attach a file" onClick={() => fileRef.current?.click()}>
                    <Paperclip className="size-4" />
                  </IconBtn>
                  <IconBtn
                    title="Mention someone"
                    active={mentionOpen}
                    onClick={() => {
                      setMentionOpen((o) => !o);
                      setEmojiOpen(false);
                    }}
                  >
                    <AtSign className="size-4" />
                  </IconBtn>
                  <IconBtn
                    title="Emoji"
                    active={emojiOpen}
                    onClick={() => {
                      setEmojiOpen((o) => !o);
                      setMentionOpen(false);
                    }}
                  >
                    <Smile className="size-4" />
                  </IconBtn>
                </div>
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-40"
                >
                  <Send className="size-3" />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function Popover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute bottom-full left-2 mb-2 w-64 rounded-xl border border-border bg-popover shadow-xl p-2 z-20 animate-scale-in origin-bottom-left">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}

function IconBtn({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded-md transition",
        active
          ? "bg-brand/10 text-brand"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
