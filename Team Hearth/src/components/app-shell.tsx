import { useApp, BACKDROP_OPTIONS } from "@/lib/app-context";
import { Sidebar } from "./sidebar";
import { DashboardView } from "./views/dashboard";
import { ChatView } from "./views/chat";
import { CallView } from "./views/call";
import { TasksView } from "./views/tasks";
import { CalendarView } from "./views/calendar";
import { WhiteboardView } from "./views/whiteboard";
import { SettingsView } from "./views/settings";
import { ProjectsView } from "./views/projects";
import { FilesView } from "./views/files";
import { IntegrationsView } from "./views/integrations";
import { EdithView } from "./views/edith";
import { TeamView } from "./views/team";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";
import { UIProvider, useUI } from "@/lib/ui-context";

export function AppShell() {
  const { currentUser } = useApp();
  if (!currentUser) return null;
  return (
    <UIProvider>
      <ShellBody />
    </UIProvider>
  );
}

function ShellBody() {
  const { activeView, prefs, adminConfig } = useApp();
  const { mobileNavOpen, setMobileNavOpen } = useUI();

  // Personal backdrop wins over team backdrop
  const personalImg = prefs.backdropImage;
  const teamImg = adminConfig.teamBackdropImage;
  const personalPreset = BACKDROP_OPTIONS.find((b) => b.id === prefs.backdrop);
  const teamPreset = BACKDROP_OPTIONS.find((b) => b.id === adminConfig.teamBackdrop);
  const preset = personalPreset && personalPreset.id !== "none" ? personalPreset : teamPreset;
  const image = personalImg || teamImg;

  const backdropStyle: React.CSSProperties = image
    ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
    : preset && preset.css !== "transparent"
      ? preset.id === "grid"
        ? { backgroundImage: preset.css, backgroundSize: "32px 32px" }
        : { backgroundImage: preset.css }
      : {};

  return (
    <div
      className={cn(
        "app-ambient flex h-screen w-full overflow-hidden bg-background text-foreground",
        // Side switch is a desktop-only preference; on mobile the drawer is always left.
        prefs.sidebarPosition === "right" && "md:flex-row-reverse",
      )}
    >
      {/* Dimmed backdrop behind the mobile drawer — tap to close. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <Topbar />
        <main className="flex-1 min-h-0 min-w-0 relative" style={backdropStyle}>
          <div key={activeView} className="h-full animate-view-in">{renderView(activeView)}</div>
        </main>
      </div>
    </div>
  );
}

function renderView(view: string) {
  switch (view) {
    case "office":
      return <DashboardView />;
    case "chat":
      return <ChatView />;
    case "call":
      return <CallView />;
    case "tasks":
      return <TasksView />;
    case "projects":
      return <ProjectsView />;
    case "calendar":
      return <CalendarView />;
    case "whiteboard":
      return <WhiteboardView />;
    case "files":
      return <FilesView />;
    case "team":
      return <TeamView />;
    case "integrations":
      return <IntegrationsView />;
    case "edith":
      return <EdithView />;
    case "settings":
      return <SettingsView />;
    case "admin":
      return <SettingsView initialTab="admin" />;
    default:
      return <DashboardView />;
  }
}
