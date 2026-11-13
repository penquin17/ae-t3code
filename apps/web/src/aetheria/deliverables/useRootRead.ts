// One owner for the last read of a root's list (M10 Plan step 16, C1; the P2 pattern of `children/useChildren.ts`): it reads when mounted and when the root or environment changes, and once more
// each time the environment's connection establishes a new session (a read sent before the session was ready, or whose reply a dropped connection lost, never comes back on its own). The newest
// read wins; a stale reply lands nowhere; leaving the page cancels nothing because a read is a GET of the Backend's record.
import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useStableCallback } from "../../hooks/useStableCallback";
import { finishRead, initialReadState, startRead, type ReadState } from "./readState";

export function useRootRead<V>(input: {
  readonly environmentId: EnvironmentId;
  readonly rootThreadId: string;
  /** One read of `rootThreadId`, settled into a view; it never throws. */
  readonly read: (rootThreadId: string) => Promise<V>;
}) {
  const { environmentId, rootThreadId } = input;
  const root = useRef(rootThreadId);
  const owner = useRef<ReadState<V>>(initialReadState<V>(rootThreadId));
  const [state, setState] = useState<ReadState<V>>(() => initialReadState<V>(rootThreadId));
  const doRead = useStableCallback(input.read);

  async function read(forRoot: string): Promise<void> {
    const started = startRead(owner.current, forRoot);
    owner.current = started.state;
    setState(started.state);
    const view = await doRead(forRoot);
    owner.current = finishRead(owner.current, started.ticket, forRoot, view);
    setState(owner.current);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the root's list from the Backend when the root or environment changes
  useEffect(() => {
    root.current = rootThreadId;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `read` is rebuilt every render and closes over stable refs; the read starts only when these two change
    void read(rootThreadId);
  }, [environmentId, rootThreadId]);

  const sessionGeneration = environmentCatalog.sessionGenerationAtom(environmentId);
  // A listener alone does not compute the atom, so nothing would follow the connection.
  useAtomMount(sessionGeneration);
  useAtomSubscribe(
    sessionGeneration,
    useStableCallback(() => void read(root.current)),
  );

  const visible: ReadState<V> =
    state.rootThreadId === rootThreadId
      ? state
      : { rootThreadId, ticket: 0, refreshing: true, view: { tag: "reading" } };
  return { state: visible, refresh: () => void read(rootThreadId) };
}
