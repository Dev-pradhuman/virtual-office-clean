import { useEffect, useRef, useState } from "react";
import { Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { Bot, Mic, MicOff, Send, Volume2, VolumeX, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Msg { id: string; role: "user" | "edith"; text: string }

const RULES: { match: RegExp; reply: string }[] = [
  { match: /\b(hi|hello|hey|namaste)\b/i, reply: "Hello! I'm Edith — your rule-based helper. Ask me about tasks, calls, files, or shortcuts." },
  { match: /\btask/i, reply: "You can open the Tasks board from the sidebar. Try dragging cards between Todo, In progress and Completed." },
  { match: /\b(call|meeting)/i, reply: "Use the Start Call quick action to open the call room. Mic and screen-share are on the bottom bar." },
  { match: /\bfile|drive/i, reply: "Go to Files. If Drive is connected (Integrations), files sync from your team drive." },
  { match: /\b(shortcut|keyboard)/i, reply: "Cmd/Ctrl+K opens search, N creates a task, / focuses this input." },
  { match: /\btheme|dark|light/i, reply: "Head to Settings → My Preferences to change theme, accent, and density. Changes are personal to your account." },
  { match: /\b(who|team|online)/i, reply: "Currently on the roster: Arjun, Aviral, Pradhuman. Presence dots show live status." },
  { match: /\b(thanks|thank)/i, reply: "Anytime. I'm always here — no LLM required." },
];

function edithReply(input: string): string {
  for (const r of RULES) if (r.match.test(input)) return r.reply;
  return "I only match a small set of rules — I'm not a general chatbot. Try asking about tasks, calls, files, theme, or team.";
}

export function EdithView() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: "e0", role: "edith", text: "Hi! I'm Edith. I answer via a small set of rules — not a general LLM. Ask me about tasks, calls, or files." },
  ]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [interim, setInterim] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const speakRef = useRef(speak);
  speakRef.current = speak;

  // Scroll only the message list — using scrollIntoView here dragged the whole
  // app shell (sidebar/header) out of view inside the fixed-height layout.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Stop any in-flight speech when leaving the view.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      recRef.current?.stop?.();
    };
  }, []);

  const speakText = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel(); // interrupt any previous reply so they don't queue up
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.03;
    utter.pitch = 1;
    // Prefer a natural English voice when one is available.
    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => /en-US/i.test(v.lang) && /female|samantha|zira|aria/i.test(v.name)) ||
      voices.find((v) => /en[-_]/i.test(v.lang)) ||
      voices[0];
    if (preferred) utter.voice = preferred;
    synth.speak(utter);
  };

  // `spoken` = the message came in by voice, so we always read the reply back.
  const send = (text: string, spoken = false) => {
    const t = text.trim();
    if (!t) return;
    const uid = `u${Date.now()}`;
    setMessages((m) => [...m, { id: uid, role: "user", text: t }]);
    setInput("");
    setInterim("");
    setTimeout(() => {
      const reply = edithReply(t);
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "edith", text: reply }]);
      if (spoken || speakRef.current) speakText(reply);
    }, 250);
  };

  const toggleMic = () => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this app build. Try the desktop app or Chrome.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    // Warm up the voice list (some browsers populate it lazily) and stop any
    // reply that's currently being spoken so it doesn't feed back into the mic.
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalText = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else partial += r[0].transcript;
      }
      setInterim(partial);
      if (finalText.trim()) {
        setListening(false);
        rec.stop();
        send(finalText, true); // spoken → Edith reads the reply back
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      setListening(false);
      setInterim("");
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        toast.error("Microphone permission was blocked. Allow mic access to use voice.");
      } else if (e?.error === "no-speech") {
        toast.error("Didn't catch that — try speaking again.");
      }
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      // start() throws if called while already running — ignore.
    }
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Edith AI"
        subtitle="Rule-based assistant · not a general LLM chatbot"
        actions={
          <button
            onClick={() => setSpeak((s) => !s)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
              speak ? "border-brand/40 bg-brand/10 text-brand" : "border-border hover:bg-muted"
            )}
          >
            {speak ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            Voice replies
          </button>
        }
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-3">
          <Card className="p-3 bg-brand/5 border-brand/20 flex items-center gap-2 text-xs text-brand">
            <Sparkles className="size-3.5" />
            Edith uses a fixed rule set — responses are deterministic and offline.
          </Card>
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}
            >
              <div
                className={cn(
                  "size-8 rounded-full grid place-items-center shrink-0",
                  m.role === "edith"
                    ? "bg-brand/15 text-brand"
                    : "bg-muted text-foreground"
                )}
              >
                {m.role === "edith" ? <Bot className="size-4" /> : "Y"}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2 text-sm max-w-[75%]",
                  m.role === "edith"
                    ? "bg-card border border-border"
                    : "bg-brand text-brand-foreground"
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-4 bg-card/70 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <button
            onClick={toggleMic}
            title={listening ? "Stop listening" : "Voice input"}
            className={cn(
              "size-9 shrink-0 rounded-full grid place-items-center border transition",
              listening
                ? "bg-destructive text-destructive-foreground border-destructive animate-pulse"
                : "border-border hover:bg-muted"
            )}
          >
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
          <input
            value={listening && interim ? interim : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={listening ? "Listening… speak now" : "Ask Edith about tasks, calls, files…"}
            className={cn(
              "flex-1 rounded-full border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/20",
              listening ? "border-destructive/50 text-muted-foreground italic" : "border-border focus:border-brand",
            )}
          />
          <button
            onClick={() => send(input)}
            className="size-9 shrink-0 rounded-full bg-brand text-brand-foreground grid place-items-center hover:brightness-110"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}