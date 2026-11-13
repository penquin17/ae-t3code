// The deliverables page's content for one root (M10 Plan step 16, C5/C6): the delivery cards, the files recorded as edited in the session, and the terminal statement. The root is the thread of the
// route; environment and root are keyed so another root never inherits this one's state. Production uses T3's commands and the environment's Bearer connection; a host or test supplies other
// calls and another fetcher through contexts.
import { EnvironmentId } from "@t3tools/contracts";
import { use } from "react";

import { OfferedPathsPanel } from "../files/OfferedPathsPanel";
import { useFetches } from "../files/useFetches";
import { TerminalNotice } from "../terminal/TerminalNotice";
import { DeliverablesCallsContext, useT3DeliverablesCalls, type DeliverablesCalls } from "./calls";
import { DeliverablesPanel } from "./DeliverablesPanel";

export interface DeliverablesViewProps {
  /** The T3 environment and thread of the root session, as in the route's params. */
  readonly environmentId: string;
  readonly threadId: string;
}

export function DeliverablesView(props: DeliverablesViewProps) {
  const injected = use(DeliverablesCallsContext);
  return injected === null ? <T3Sections {...props} /> : <Sections {...props} calls={injected} />;
}

function T3Sections(props: DeliverablesViewProps) {
  return <Sections {...props} calls={useT3DeliverablesCalls()} />;
}

function Sections(props: DeliverablesViewProps & { readonly calls: DeliverablesCalls }) {
  const environmentId = EnvironmentId.make(props.environmentId);
  // One owner for every file action on the page: the ids of cards and offered paths never collide.
  const fetches = useFetches(props.environmentId);
  return (
    <div
      data-aetheria="deliverables-view"
      data-root={props.threadId}
      className="flex min-w-0 flex-col gap-6"
    >
      <DeliverablesPanel
        key={`cards:${props.environmentId}:${props.threadId}`}
        environmentId={environmentId}
        rootThreadId={props.threadId}
        calls={props.calls}
        fetches={fetches}
      />
      <OfferedPathsPanel
        key={`edits:${props.environmentId}:${props.threadId}`}
        environmentId={environmentId}
        rootThreadId={props.threadId}
        calls={props.calls}
        fetches={fetches}
      />
      <TerminalNotice />
    </div>
  );
}
