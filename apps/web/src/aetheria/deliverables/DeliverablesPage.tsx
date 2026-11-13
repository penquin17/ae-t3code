import { SidebarInset } from "../../components/ui/sidebar";
import { ConnectionStatus } from "../connection/ConnectionStatus";
import { DeliverablesView } from "./DeliverablesView";

/** The deliverables page at /aetheria/deliverables/:environmentId/:threadId (M10 Plan step 16): the delivery cards and edited files of one root session. */
export function DeliverablesPage({
  environmentId,
  threadId,
}: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  return (
    <SidebarInset className="h-dvh overflow-y-auto scrollbar-gutter-both">
      <main
        data-aetheria="deliverables-page"
        className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 px-4 pt-16 pb-8"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <h1 className="text-lg font-medium text-foreground">Deliverables</h1>
        <ConnectionStatus />
        <DeliverablesView
          key={`${environmentId}:${threadId}`}
          environmentId={environmentId}
          threadId={threadId}
        />
      </main>
    </SidebarInset>
  );
}
