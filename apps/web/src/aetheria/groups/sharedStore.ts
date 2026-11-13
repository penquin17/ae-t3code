// One groups store for every view that is mounted at once (M10 product fix P4). The sessions page draws the session list twice (the sidebar and the page); each draw used to make its own store, so a change
// in one left the other on the old record until a reload. The record lives here, once per source: the transport a host or test provided, or the production one. A view takes the store while it is
// mounted; the store, its one read when the first view arrives and its one subscription to the primary environment's session generation go when the last view leaves, so a view that mounts later starts
// from a fresh read. Boundary: plain TypeScript over the store and an atom registry; no React, no T3 state. It shows the sharing, the counts and the release; the hook (useGroups.ts) ties it to React.
import type { Atom, AtomRegistry } from "effect/reactivity";

import { randomUUID } from "~/lib/utils";
import { createGroupsStore, type GroupsStore } from "./store";
import type { GroupsTransport } from "./transport";

/** Which session generation to follow: the registry that holds it and the primary environment it belongs to (null before that is known, when there is nothing to follow). */
export interface SessionWatch {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly environmentId: string | null;
  readonly generation: Atom.Atom<number>;
}

export interface SharedGroups {
  readonly store: GroupsStore;
  /** A view joins with its own transport; the store sends through the newest live one. Returns the release. The last release drops the store from the registry and stops its subscription. */
  acquire(transport: GroupsTransport): () => void;
  /**
   * Says which session generation to follow. The first call after the store came alive, and each call with a different environment or registry, reads once and follows that generation from then on:
   * one read per new session however many views are mounted. Calls that change nothing do nothing.
   */
  watch(watch: SessionWatch): void;
}

const entries = new Map<object, SharedGroups>();

/** The store for a source, made if none is alive. Making it starts nothing: a store nobody acquires holds no subscription. */
export function sharedGroups(source: object): SharedGroups {
  const alive = entries.get(source);
  if (alive !== undefined) return alive;
  const made = createShared(source);
  entries.set(source, made);
  return made;
}

function createShared(source: object): SharedGroups {
  // The views' transports, oldest first. The newest one sends: it is the one whose view saw the latest primary environment.
  const live: GroupsTransport[] = [];
  const send = (): GroupsTransport => {
    const newest = live.at(-1);
    if (newest === undefined) throw new Error("no view of the groups is mounted");
    return newest;
  };
  const store = createGroupsStore({
    transport: { read: () => send().read(), apply: (body) => send().apply(body) },
    newRequestId: randomUUID,
  });

  let watching:
    | { readonly registry: AtomRegistry.AtomRegistry; readonly environmentId: string | null }
    | undefined;
  let stopWatching: (() => void) | undefined;
  const unwatch = () => {
    stopWatching?.();
    stopWatching = undefined;
    watching = undefined;
  };

  const shared: SharedGroups = {
    store,
    acquire: (transport) => {
      live.push(transport);
      // A store that was dropped (a view that outlives its own release, as in a strict-mode remount) joins the registry again.
      if (!entries.has(source)) entries.set(source, shared);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        live.splice(live.indexOf(transport), 1);
        if (live.length > 0) return;
        unwatch();
        if (entries.get(source) === shared) entries.delete(source);
      };
    },
    watch: ({ registry, environmentId, generation }) => {
      if (watching?.registry === registry && watching.environmentId === environmentId) return;
      stopWatching?.();
      watching = { registry, environmentId };
      // The store's read is sequenced and newest-wins, so a new session only adds one read. A listener alone does not compute the atom, so nothing would follow the connection unless it is mounted.
      const unmount = registry.mount(generation);
      const unsubscribe =
        environmentId === null
          ? undefined
          : registry.subscribe(generation, () => void store.refresh());
      stopWatching = () => {
        unsubscribe?.();
        unmount();
      };
      void store.refresh();
    },
  };
  return shared;
}
