import { useRef, useState } from "react";
import { useApp } from "@/lib/app-context";
import { type TeamFile } from "@/lib/sample-data";
import { fileUrl } from "@/lib/api";
import { Card } from "../ui-bits";
import { ViewHeader } from "./_header";
import { FileText, ImageIcon, Sheet, Presentation, FileType, Upload, Trash2, Cloud, HardDrive } from "lucide-react";
import { toast } from "sonner";

const ICONS: Record<TeamFile["kind"], React.ComponentType<{ className?: string }>> = {
  doc: FileText,
  image: ImageIcon,
  sheet: Sheet,
  slide: Presentation,
  pdf: FileType,
  other: FileText,
};

export function FilesView() {
  const { users, adminConfig, files, uploadFile, deleteFile } = useApp();
  const drive = adminConfig.googleDriveConnected;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = () => inputRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadFile(f);
      toast.success(`Uploaded ${f.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <input ref={inputRef} type="file" className="hidden" onChange={onFile} />
      <ViewHeader
        title="Files"
        subtitle={drive ? "Google Drive connected · Local fallback active" : "Local storage · Drive not connected"}
        actions={
          <button
            onClick={onPick}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground disabled:opacity-60"
          >
            <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_140px_120px_60px] gap-3 px-4 py-2.5 border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            <div>Name</div>
            <div>Source</div>
            <div>Owner</div>
            <div>Modified</div>
            <div className="text-right">Size</div>
          </div>
          {files.map((f) => {
            const Icon = ICONS[f.kind];
            const owner = users.find((u) => u.id === f.ownerId);
            return (
              <div
                key={f.id}
                className="group grid grid-cols-[minmax(0,1fr)_120px_140px_120px_60px] gap-3 px-4 py-2.5 border-b border-border/60 last:border-0 items-center hover:bg-muted/30 transition text-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="size-8 rounded-md bg-muted grid place-items-center text-muted-foreground">
                    <Icon className="size-4" />
                  </div>
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-brand hover:underline"
                    >
                      {f.name}
                    </a>
                  ) : (
                    <span className="truncate">{f.name}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  {f.source === "drive" ? <Cloud className="size-3.5" /> : <HardDrive className="size-3.5" />}
                  {f.source === "drive" ? "Drive" : "Local"}
                </div>
                <div className="text-xs text-muted-foreground truncate">{owner?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{f.modified}</div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono">{f.size}</span>
                  <button
                    onClick={() => deleteFile(f.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}