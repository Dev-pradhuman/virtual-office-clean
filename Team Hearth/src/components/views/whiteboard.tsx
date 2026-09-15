import { useEffect, useRef, useState } from "react";
import { ViewHeader } from "./_header";
import { useApp } from "@/lib/app-context";
import { apiFetch } from "@/lib/api";
import { Pen, Eraser, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = ["#0f172a", "#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6"];

// A single drawn segment, coordinates normalised 0..1 so every client renders
// the same board regardless of canvas size. Persisted + broadcast via socket.
interface Stroke {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
  mode: "pen" | "eraser";
}

export function WhiteboardView() {
  const { socket } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[1]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [size, setSize] = useState(3);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const drawStroke = (s: Stroke) => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.mode === "eraser" ? "#ffffff" : s.color;
    ctx.lineWidth = s.mode === "eraser" ? s.size * 4 : s.size;
    ctx.beginPath();
    ctx.moveTo(s.x0 * rect.width, s.y0 * rect.height);
    ctx.lineTo(s.x1 * rect.width, s.y1 * rect.height);
    ctx.stroke();
  };

  // Size the canvas + replay the saved board once.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const resize = () => {
      const rect = c.parentElement!.getBoundingClientRect();
      c.width = rect.width * devicePixelRatio;
      c.height = rect.height * devicePixelRatio;
      c.style.width = `${rect.width}px`;
      c.style.height = `${rect.height}px`;
      ctx?.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    apiFetch<Stroke[]>("/api/whiteboard")
      .then((strokes) => strokes.forEach(drawStroke))
      .catch(() => {});

    return () => window.removeEventListener("resize", resize);
  }, []);

  // Live strokes from teammates.
  useEffect(() => {
    if (!socket) return;
    const onStroke = (s: Stroke) => drawStroke(s);
    const onClear = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    };
    socket.on("wb_stroke", onStroke);
    socket.on("wb_clear", onClear);
    return () => {
      socket.off("wb_stroke", onStroke);
      socket.off("wb_clear", onClear);
    };
  }, [socket]);

  const emitSegment = (x: number, y: number) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const cur = { x, y };
    const from = last.current ?? cur;
    const stroke: Stroke = {
      x0: from.x / rect.width,
      y0: from.y / rect.height,
      x1: cur.x / rect.width,
      y1: cur.y / rect.height,
      color,
      size,
      mode: tool,
    };
    drawStroke(stroke);
    socket?.emit("wb_stroke", stroke);
    last.current = cur;
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    emitSegment(e.clientX - rect.left, e.clientY - rect.top);
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    socket?.emit("wb_clear");
  };

  return (
    <div className="h-full flex flex-col">
      <ViewHeader title="Whiteboard" subtitle="Shared canvas · Everyone can edit" />
      <div className="flex-1 relative bg-card">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            drawing.current = true;
            last.current = null;
            const rect = canvasRef.current!.getBoundingClientRect();
            emitSegment(e.clientX - rect.left, e.clientY - rect.top);
          }}
          onPointerMove={onMove}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
          }}
          onPointerLeave={() => {
            drawing.current = false;
            last.current = null;
          }}
          className="absolute inset-0 cursor-crosshair touch-none"
        />

        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-2xl border border-border bg-card/95 backdrop-blur p-1.5 shadow-lg">
          <ToolBtn active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
            <Pen className="size-4" />
          </ToolBtn>
          <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
            <Eraser className="size-4" />
          </ToolBtn>
          <div className="w-px h-6 bg-border mx-0.5" />
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setTool("pen");
              }}
              className={cn(
                "size-6 rounded-full ring-2 transition",
                color === c && tool === "pen" ? "ring-brand scale-110" : "ring-transparent",
              )}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
          <div className="w-px h-6 bg-border mx-0.5" />
          <input
            type="range"
            min={1}
            max={12}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24 accent-[var(--brand)]"
          />
          <div className="w-px h-6 bg-border mx-0.5" />
          <ToolBtn onClick={clear} label="Clear board">
            <Trash2 className="size-4" />
          </ToolBtn>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-brand/10 text-brand",
      )}
    >
      {children}
    </button>
  );
}
