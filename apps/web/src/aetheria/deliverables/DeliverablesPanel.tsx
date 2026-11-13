// A root's delivery cards (M10 Plan step 16, D9/D10, C5). The list is the Backend's last answer for this root, read again on Refresh and on each new session; it is known, refused, unavailable or
// unknown, never an empty list unless the Backend sent one. Nothing is edited before the Backend answers and leaving the page cancels nothing: a read is a GET of its record.
import type { EnvironmentId } from "@t3tools/contracts";
import { useId } from "react";

import { Button } from "../../components/ui/button";
import type { Fetches } from "../files/useFetches";
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { touchWithin } from "../control/touchTarget";
import type { DeliverablesCalls } from "./calls";
import { DeliverableCardView } from "./DeliverableCardView";
import { ListNotice } from "./ListNotice";
import { displayOrder, listViewFromSend, type ListView } from "./model";
import { useRootRead } from "./useRootRead";

export function DeliverablesPanel({
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
  const { state, refresh } = useRootRead<ListView>({
    environmentId,
    rootThreadId,
    read: async (root) => {
      try {
        return listViewFromSend(await calls.list({ environmentId, rootThreadId: root }), root);
      } catch {
        // A call that threw never told us what the Backend holds: it is unknown, never empty.
        return { tag: "unknown", reason: "the read failed before an answer" };
      }
    },
  });
  const { view, refreshing } = state;
  useRegion(REGION.deliverablesCards, () => ({
    props: { rootThreadId },
    state: {
      list: view.tag,
      cardCount: view.tag === "known" ? view.cards.length : undefined,
      refreshing,
    },
  }));
  return (
    <section
      aria-labelledby={headingId}
      data-aetheria="deliverables"
      data-root={rootThreadId}
      className={`flex min-w-0 flex-col gap-3 ${touchWithin}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          Delivered files
        </h2>
        <Button variant="outline" size="sm" onClick={refresh} aria-label="Refresh delivered files">
          Refresh
        </Button>
      </header>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {refreshing && view.tag !== "reading" ? <p>Reading the deliverables again…</p> : null}
      </div>
      {view.tag === "known" ? (
        view.cards.length === 0 ? (
          <p data-testid="deliverables-empty" className="text-sm text-muted-foreground">
            The Backend lists no delivered files for this session.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3" aria-label="Delivered files">
            {displayOrder(view.cards).map((card) => (
              <DeliverableCardView
                key={card.id}
                card={card}
                rootThreadId={rootThreadId}
                fetches={fetches}
              />
            ))}
          </ul>
        )
      ) : (
        <ListNotice what="deliverables" view={view} />
      )}
    </section>
  );
}
