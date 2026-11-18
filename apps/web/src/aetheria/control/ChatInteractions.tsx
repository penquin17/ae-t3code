// The Backend's open questions, plan reviews and authorizations, answerable from the chat above the message box (C7), with a banner to the full Human control page. The cards are the control page's own
// `InteractionCard`s over the same hooks, so answering here sends what the page sends; settled and held requests stay on the page.
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { piSessionIdOf, type ThreadBindingInput } from "./binding";
import { browserDraftStorage, createDraftStore } from "./drafts";
import { isFromEarlierSession } from "./earlier";
import { chatSummary } from "./chatSummary";
import { InteractionCard } from "./InteractionCard";
import { cardClass, mutedClass } from "./parts";
import { useControlActions, useControlTransport, useInteractions } from "./useControl";

interface ChatInteractionsProps {
  readonly environmentId: string;
  readonly threadId: string;
}

/** `projection` is the chat's own quiet read of the thread, `null` until the server lists it: this view never reads the thread itself, so a draft's reserved id is not fetched before it exists. */
interface ChatInteractionsInput extends ChatInteractionsProps {
  readonly projection: ThreadBindingInput | null;
}

function OpenRequests({
  environmentId,
  threadId,
  rootSessionId,
}: ChatInteractionsProps & { readonly rootSessionId: string }) {
  const transport = useControlTransport();
  const [store] = useState(() => createDraftStore(browserDraftStorage()));
  const { view, readSnapshot } = useInteractions(transport, environmentId, rootSessionId);
  const actions = useControlActions(transport, environmentId, rootSessionId, readSnapshot);
  const summary =
    view.status === "live" || view.status === "stale" ? chatSummary(view.interactions) : null;
  if (summary === null) return null;
  return (
    <div data-aetheria="chat-interactions" className="mb-2 flex min-w-0 flex-col gap-2">
      <div className={cardClass} data-chat-banner>
        <div className="flex flex-col gap-0.5">
          <p role="status" className="text-sm font-medium">
            {summary.title}
          </p>
          <p className={mutedClass}>{summary.description}</p>
        </div>
        <Link
          to="/aetheria/control/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="flex min-h-11 w-fit items-center rounded-md bg-accent px-3 text-sm font-medium text-foreground hover:bg-accent/80"
        >
          Open Human control
        </Link>
      </div>
      {summary.cards.length > 0 ? (
        <div className="flex max-h-96 min-w-0 flex-col gap-2 overflow-y-auto" data-chat-cards>
          {summary.cards.map((record) => (
            <InteractionCard
              key={record.interactionId}
              record={record}
              actions={actions}
              drafts={store}
              earlierSession={isFromEarlierSession(record, rootSessionId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatInteractions({ environmentId, threadId, projection }: ChatInteractionsInput) {
  const binding = piSessionIdOf(projection);
  if (binding.state !== "known") return null;
  return (
    <OpenRequests
      // A root switch starts a fresh view, drafts and actions, as the control page's goal provider does.
      key={binding.value}
      environmentId={environmentId}
      threadId={threadId}
      rootSessionId={binding.value}
    />
  );
}
