// One delivery card (M10 Plan step 16, D9/D10): title, kind, size, declared time, turn, supersession and the snapshot state, all from what the Backend declared; the path is a Backend label and opens
// nothing. The controls below it are the shared file actions. A card replaced by a later version stays visible and says so. Props in, markup out.
import type { DeliverableCard } from "@t3tools/aetheria-contracts";

import { FileActions } from "../files/FileActions";
import { filenameOf } from "../files/preview";
import type { Fetches } from "../files/useFetches";
import { cardFacts, semanticsOffered } from "./model";

export function DeliverableCardView({
  card,
  rootThreadId,
  fetches,
}: {
  readonly card: DeliverableCard;
  readonly rootThreadId: string;
  readonly fetches: Fetches;
}) {
  const facts = cardFacts(card, rootThreadId);
  return (
    <li
      data-deliverable-id={card.id}
      data-superseded={String(card.supersededBy !== null)}
      data-snapshot={facts.snapshot.tag}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 break-words text-sm font-medium">{facts.title}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{facts.kindText}</span>
      </div>
      {facts.supersededText === null ? null : (
        <p data-testid="superseded" className="text-xs font-medium text-warning-foreground">
          {facts.supersededText}
        </p>
      )}
      <p className="break-all font-mono text-xs text-muted-foreground">
        <span className="sr-only">Backend path: </span>
        {facts.pathText}
      </p>
      <p className="text-xs text-muted-foreground">
        {[facts.sizeText, facts.declaredText, facts.turnText, facts.sessionText]
          .filter((part) => part !== null)
          .join(" · ")}
      </p>
      <p data-testid="snapshot-state" className="text-xs">
        {facts.snapshot.text}
      </p>
      <FileActions
        fetches={fetches}
        item={{
          id: card.id,
          label: facts.title,
          path: card.canonicalPath,
          filename: filenameOf(card.canonicalPath),
          kind: card.kind,
          size: card.size,
          declaredDigest: card.digest,
          semantics: semanticsOffered(card),
        }}
      />
    </li>
  );
}
