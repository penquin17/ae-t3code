// The control panel for one root session (C7): the Backend's interactions, plan mode and tasks, each shown as read and each action ending as one honest outcome. It holds no copy of backend state
// beyond the last read, which it marks stale when the connection ends. A request that disappears from the Backend's list is said to have disappeared, never to have been completed.
import { useState } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { browserDraftStorage, createDraftStore, type DraftStore } from "./drafts";
import { isFromEarlierSession } from "./earlier";
import { InteractionCard } from "./InteractionCard";
import { PlanModeCard } from "./PlanModeCard";
import { cardClass, mutedClass } from "./parts";
import { isOpen } from "./recordText";
import { TasksView } from "./TasksView";
import {
  useControlActions,
  useControlTransport,
  useInteractions,
  usePlanMode,
  useTasks,
} from "./useControl";
import type { InteractionRecord } from "./types";

export interface ControlPanelProps {
  readonly environmentId: string;
  /** The Backend's Pi session id of the root (from `binding.ts`), never a T3 thread id. */
  readonly rootSessionId: string;
  /** Unsent drafts; defaults to `sessionStorage`. Injectable for tests. */
  readonly drafts?: DraftStore;
}

export function ControlPanel({ environmentId, rootSessionId, drafts }: ControlPanelProps) {
  const transport = useControlTransport();
  const [store] = useState(() => drafts ?? createDraftStore(browserDraftStorage()));
  const { view, readSnapshot } = useInteractions(transport, environmentId, rootSessionId);
  const version = view.status === "live" || view.status === "stale" ? view.version : 0;
  const mode = usePlanMode(transport, environmentId, rootSessionId, version);
  const tasks = useTasks(transport, environmentId, rootSessionId, version);
  const actions = useControlActions(transport, environmentId, rootSessionId, readSnapshot);

  // `vanished` comes from the view: ids an earlier read listed that this read does not, said as a disappearance and never as an outcome.
  const interactions: readonly InteractionRecord[] =
    view.status === "live" || view.status === "stale" ? view.interactions : [];
  const vanished = view.status === "live" ? view.vanished : [];
  const open = interactions.filter(isOpen);
  const settled = interactions.filter((record) => !isOpen(record));
  useRegion(REGION.controlInteractions, () => ({
    props: { rootSessionId },
    state: { view: view.status, open: open.length, settled: settled.length },
  }));

  return (
    <div data-control-panel data-view={view.status} className="flex min-w-0 flex-col gap-4">
      {view.status === "waiting" ? (
        <p role="status" className={mutedClass}>
          Reading what the Backend holds… ({view.reason})
        </p>
      ) : null}
      {view.status === "unavailable" ? (
        <Alert variant="error" role="alert">
          <AlertDescription>
            <span className="text-foreground">
              The Backend's requests are unavailable: {view.reason}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.status === "stale" ? (
        <Alert variant="warning" role="status">
          <AlertDescription>
            <span className="text-foreground">
              This may be out of date: {view.reason}. It shows what was last read (version{" "}
              {view.version}) and is being read again.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {vanished.length > 0 ? (
        <Alert variant="warning" role="status" data-vanished>
          <AlertDescription>
            <span className="text-foreground">
              No longer in the Backend's list: {vanished.join(", ")}. That does not mean it was
              answered or completed; the list is the Backend's, and it no longer includes it.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.status === "live" && interactions.length === 0 ? (
        <div className={cardClass} data-empty="interactions">
          <p className="text-sm">
            The Backend holds no questions, plans or requests for this session.
          </p>
        </div>
      ) : null}
      {/* One parent for open and settled cards: a card that settles keeps its instance, so its last report and focus stay. */}
      <div className="flex min-w-0 flex-col gap-3" data-interactions>
        {[
          ...open.map((record) => (
            <InteractionCard
              key={record.interactionId}
              record={record}
              actions={actions}
              drafts={store}
              earlierSession={isFromEarlierSession(record, rootSessionId)}
            />
          )),
          ...(settled.length > 0
            ? [
                <h2
                  key="settled-heading"
                  className="pt-2 text-sm font-medium text-muted-foreground"
                >
                  Settled
                </h2>,
              ]
            : []),
          ...settled.map((record) => (
            <InteractionCard
              key={record.interactionId}
              record={record}
              actions={actions}
              drafts={store}
              earlierSession={isFromEarlierSession(record, rootSessionId)}
            />
          )),
        ]}
      </div>
      <PlanModeCard
        sessionId={rootSessionId}
        view={mode.view}
        actions={actions}
        onRefresh={mode.refresh}
      />
      <TasksView view={tasks.view} />
    </div>
  );
}
