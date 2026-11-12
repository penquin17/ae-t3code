import { SidebarInset } from "../../components/ui/sidebar";
import { SessionsPanel } from "./SessionsPanel";

/** The sessions page at /aetheria/sessions: the same list as the sidebar, as a page that can be linked to. */
export function AetheriaSessionsPage() {
  return (
    <SidebarInset className="h-dvh overflow-y-auto scrollbar-gutter-both">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pt-16 pb-8">
        <h1 className="text-lg font-medium text-foreground">Sessions</h1>
        <SessionsPanel />
      </main>
    </SidebarInset>
  );
}
