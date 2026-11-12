import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useSyncExternalStore } from "react";

import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { forkLinkSource } from "./links";
import { noSuggestions, toTreeModel } from "./model";
import { toListFacts } from "./t3Facts";
import type { TreeModel } from "./types";

const MINUTE_MS = 60_000;

function subscribeToMinutes(onChange: () => void): () => void {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
}
const readMinute = (): number => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

/** The current minute, as epoch milliseconds; changes once a minute. */
function useMinuteClock(): number {
  return useSyncExternalStore(subscribeToMinutes, readMinute);
}

/**
 * The session tree for the current T3 data, search text and minute. Read-only over T3's shells: it
 * reads no state of its own, writes nothing and edits no row.
 */
export function useSessionTree(query: string): { readonly model: TreeModel; readonly now: number } {
  const shells = useQuietThreadShells();
  const projects = useProjects();
  const routeTarget = useThreadRouteTarget();
  const now = useMinuteClock();
  const openKey = routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  const facts = toListFacts({ shells, projects, openKey, now });
  const model = toTreeModel(facts, forkLinkSource(facts), noSuggestions, { now, query });
  return { model, now };
}
