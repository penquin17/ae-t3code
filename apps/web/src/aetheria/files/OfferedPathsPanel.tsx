// The files recorded as edited in a session, each downloadable by its offered id (M10 Plan step 16, D11/D12/R8). The list is read from the Backend's board and labelled per session, not per turn,
// with shell writes not tracked; the board's known, unknown and unavailable answers are kept apart, and a known empty list says it is empty. Per-turn diffs are T3's and need Git, said once.
// The browser never names a path: it names an id the Backend assigned, with the root.
import type { EnvironmentId } from "@t3tools/contracts";
import { useId } from "react";

import { Button } from "../../components/ui/button";
import { touchWithin } from "../control/touchTarget";
import type { DeliverablesCalls } from "../deliverables/calls";
import { ListNotice } from "../deliverables/ListNotice";
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { useRootRead } from "../deliverables/useRootRead";
import { FileActions } from "./FileActions";
import { OFFERED_LABEL, offeredViewFromSend, TURN_DIFF_NOTE, type OfferedView } from "./offered";
import { filenameOf, kindOfPath } from "./preview";
import type { Fetches } from "./useFetches";

export function OfferedPathsPanel({
  environmentId,
  rootThreadId,
  calls,
  fetches,
}: {
  readonly environmentId: EnvironmentId;
  readonly rootThreadId: string;
  readonly calls: DeliverablesCalls;
  readonly fetches: Fetches;
}) {
  const headingId = useId();
  const { state, refresh } = useRootRead<OfferedView>({
    environmentId,
    rootThreadId,
    read: async (root) => {
      try {
        return offeredViewFromSend(
          await calls.offeredPaths({ environmentId, rootThreadId: root }),
          root,
        );
      } catch {
        // A call that threw never told us what the Backend holds: it is unknown, never empty.
        return { tag: "unknown", reason: "the read failed before an answer" };
      }
    },
  });
  const { view, refreshing } = state;
  useRegion(REGION.deliverablesFiles, () => ({
    props: { rootThreadId },
    state: {
      list: view.tag,
      editedCount: view.tag === "known" ? view.paths.length : undefined,
      refreshing,
    },
  }));
  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="offered-paths"
      data-root={rootThreadId}
      className={`flex min-w-0 flex-col gap-3 ${touchWithin}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Edited files
        </h2>
        <Button variant="outline" size="sm" onClick={refresh} aria-label="Refresh edited files">
          Refresh
        </Button>
      </header>
      <p data-testid="offered-label" className="text-xs text-muted-foreground">
        {OFFERED_LABEL}
      </p>
      <p data-testid="turn-diff-note" className="text-xs text-muted-foreground">
        {TURN_DIFF_NOTE}
      </p>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {refreshing && view.tag !== "reading" ? <p>Reading the edited files again…</p> : null}
      </div>
      {view.tag === "known" ? (
        view.paths.length === 0 ? (
          <p data-testid="offered-empty" className="text-sm text-muted-foreground">
            The board recorded no edited files for this session.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2" aria-label="Edited files">
            {view.paths.map((path) => (
              <li
                key={path.id}
                data-offered-id={path.id}
                className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground"
              >
                <p className="break-all font-mono text-xs">
                  <span className="sr-only">Backend path: </span>
                  {path.canonicalPath}
                </p>
                <FileActions
                  fetches={fetches}
                  item={{
                    id: path.id,
                    label: filenameOf(path.canonicalPath),
                    rootThreadId,
                    path: path.canonicalPath,
                    filename: filenameOf(path.canonicalPath),
                    kind: kindOfPath(path.canonicalPath),
                    size: null,
                    declaredDigest: null,
                    semantics: ["current"],
                  }}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <ListNotice what="edit record" view={view} />
      )}
    </section>
  );
}
