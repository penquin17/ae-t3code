import { useEffect, useState, useSyncExternalStore } from "react";

import { randomUUID } from "~/lib/utils";
import { createGroupsStore, type GroupsState, type GroupsStore } from "./store";
import { useGroupsTransport } from "./transport";

export interface GroupsHandle {
  readonly state: GroupsState;
  readonly store: GroupsStore;
}

/**
 * The saved groups for this view: one store over the transport in context (fixed for the view's life),
 * read once on mount, then only when a change asks for it. It reads the Backend's record and keeps no
 * second copy; reloading the page, or a second device, reads the same record again.
 */
export function useGroups(): GroupsHandle {
  const transport = useGroupsTransport();
  const [store] = useState(() => createGroupsStore({ transport, newRequestId: randomUUID }));
  const state = useSyncExternalStore(store.subscribe, store.getState);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the Backend's saved groups while mounted
  useEffect(() => {
    void store.refresh();
  }, [store]);
  return { state, store };
}
