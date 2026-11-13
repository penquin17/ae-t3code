import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { SidebarInset } from "../../components/ui/sidebar";
import { useThreadProjection } from "../../state/entities";
import { ChildrenPanel } from "../children/ChildrenPanel";
import { IDENTITY_UNKNOWN_TEXT, piSessionIdOf } from "./binding";
import { ControlPanel } from "./ControlPanel";
import { GoalsCard } from "./goals/GoalsCard";
import { JobsPanel } from "./jobs/JobsPanel";
import { cardClass, mutedClass } from "./parts";
import { UsagePanel } from "./usage/UsagePanel";

/**
 * The human-control page at /aetheria/control/:environmentId/:threadId. The cards need the Backend's Pi session id, which is read from the thread's strong Pi native reference; when
 * T3's data does not supply it the page says so and shows nothing rather than guess an equivalence between a T3 thread id and a Pi session id.
 */
export function ControlPage({
  environmentId,
  threadId,
}: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  const ref = scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
  const projection = useThreadProjection(ref)?.projection ?? null;
  const binding = piSessionIdOf(projection);
  return (
    <SidebarInset className="h-dvh overflow-y-auto scrollbar-gutter-both">
      <main
        data-aetheria="control"
        className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 px-4 pt-16 pb-8"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <h1 className="text-lg font-medium text-foreground">Human control</h1>
        {binding.state === "known" ? (
          <ControlPanel
            key={`${environmentId}:${binding.value}`}
            environmentId={environmentId}
            rootSessionId={binding.value}
          />
        ) : (
          <div data-identity="unknown" className={cardClass}>
            <p role="status" className="text-sm">
              {IDENTITY_UNKNOWN_TEXT}
            </p>
            <p className={mutedClass}>{binding.reason}.</p>
          </div>
        )}
        <ChildrenPanel environmentId={environmentId} threadId={threadId} />
        <JobsPanel environmentId={environmentId} threadId={threadId} />
        <UsagePanel environmentId={environmentId} threadId={threadId} />
        <GoalsCard />
      </main>
    </SidebarInset>
  );
}
