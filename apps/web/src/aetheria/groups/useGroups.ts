import { RegistryContext } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useSyncExternalStore } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { sharedGroups } from "./sharedStore";
import { type GroupsState, type GroupsStore } from "./store";
import { useGroupsSource } from "./commands";

export interface GroupsHandle {
  readonly state: GroupsState;
  readonly store: GroupsStore;
}

/** Stands in for the session generation while the primary environment is not known: it never changes, so nothing is read from it. */
const NO_SESSION = Atom.make(0);

/**
 * The saved groups for this view: the one store every mounted view shares (sharedStore.ts), read when the first view mounts and once per new
 * session of the primary environment (a read sent before the session was ready is lost and nothing else retries it), then only when a change
 * asks for it. It keeps no second copy of the Backend's record, and a change made through one view is the state of all of them.
 */
export function useGroups(): GroupsHandle {
  const { source, transport } = useGroupsSource();
  const shared = sharedGroups(source);
  const { store } = shared;
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const environmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const generation =
    environmentId === null ? NO_SESSION : environmentCatalog.sessionGenerationAtom(environmentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- joins the shared store while this view is mounted; the last view to leave drops it
  useEffect(() => shared.acquire(transport), [shared, transport]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the primary environment's sessions for the shared store (one read on arrival and per new session, however many views); it reads again when the environment becomes known
  useEffect(() => {
    shared.watch({ registry, environmentId, generation });
  }, [shared, registry, environmentId, generation]);
  return { state, store };
}
