import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useState, useSyncExternalStore } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { randomUUID } from "~/lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { createGroupsStore, type GroupsState, type GroupsStore } from "./store";
import { useGroupsTransport } from "./commands";

export interface GroupsHandle {
  readonly state: GroupsState;
  readonly store: GroupsStore;
}

/** Stands in for the session generation while the primary environment is not known: it never changes, so nothing is read from it. */
const NO_SESSION = Atom.make(0);

/**
 * The saved groups for this view: one store over the transport in context, read on mount and once per new
 * session of the primary environment (a read sent before the session was ready is lost and nothing else
 * retries it), then only when a change asks for it. It keeps no second copy of the Backend's record.
 */
export function useGroups(): GroupsHandle {
  const transport = useGroupsTransport();
  const [store] = useState(() => createGroupsStore({ transport, newRequestId: randomUUID }));
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const environmentId = usePrimaryEnvironmentId();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the Backend's saved groups while mounted, and again when the primary environment becomes known
  useEffect(() => {
    void store.refresh();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the read does not use the id; it is read again when the id changes (null before the environment is known)
  }, [store, environmentId]);

  // The store's read is sequenced and newest-wins, so a new session only adds one read. A listener alone does not compute the atom, so nothing would follow the connection.
  const sessionGeneration =
    environmentId === null ? NO_SESSION : environmentCatalog.sessionGenerationAtom(environmentId);
  useAtomMount(sessionGeneration);
  useAtomSubscribe(
    sessionGeneration,
    useStableCallback(() => void store.refresh()),
  );
  return { state, store };
}
