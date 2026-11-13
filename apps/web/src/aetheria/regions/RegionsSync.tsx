// Mounted once by the shell (D17, XC-19): reports the registered regions to the Backend while mounted, and again on each new connection (a new session of the primary environment, or the environment becoming
// known), because the Backend drops the client when a connection closes and an unchanged page would never report to the new one (review 3, F1). The sync outlives connections, so the sequence keeps rising.
// It renders no UI of its own, only the connection monitor and the registration of T3's surfaces, so it sits inside the shell's sidebar provider and router. Unmounting sends no cancel: the Backend drops the client.
import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ConnectionMonitor } from "../connection/ConnectionMonitor";
import { useT3RegionsTransport } from "./commands";
import { T3SurfaceRegions } from "./T3SurfaceRegions";
import { useRegionRegistry } from "./useRegion";
import { createRegionSync, type RegionSync, type RegionsTransport } from "./sync";

/** Sending defaults: a short quiet window, a reply timeout shorter than the Backend's patience, and a bounded backoff. */
const REGION_SYNC_DEFAULTS = {
  debounceMs: 100,
  replyTimeoutMs: 15_000,
  retry: { baseMs: 1_000, maxMs: 30_000, maxAttempts: 5 },
} as const;

/** Stands in for the session generation while the primary environment is not known: it never changes, so it signals nothing. */
const NO_SESSION = Atom.make(0);

export function RegionsSync(props: { readonly transport?: RegionsTransport }) {
  const registry = useRegionRegistry();
  const real = useT3RegionsTransport();
  const environmentId = usePrimaryEnvironmentId();
  const syncRef = useRef<RegionSync | undefined>(undefined);
  const latest = useRef<RegionsTransport>(props.transport ?? real);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sync reads the latest transport at each send
  useEffect(() => {
    latest.current = props.transport ?? real;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the registry's regions to the Backend while mounted
  useEffect(() => {
    const sync = createRegionSync({
      ...REGION_SYNC_DEFAULTS,
      registry,
      transport: { report: (payload) => latest.current.report(payload) },
    });
    syncRef.current = sync;
    sync.start();
    return () => {
      sync.stop();
      syncRef.current = undefined;
    };
  }, [registry]);

  // A new session of the primary environment is a new connection: report the whole set to it. A listener alone does not compute the atom, so it is mounted too; it fires on a change, once per new session.
  const generation =
    environmentId === null ? NO_SESSION : environmentCatalog.sessionGenerationAtom(environmentId);
  useAtomMount(generation);
  useAtomSubscribe(
    generation,
    useStableCallback(() => syncRef.current?.resend()),
  );
  // A report sent before the primary environment was known went nowhere, and the session atom of an environment that just became known does not "change": report when it becomes known.
  const lastEnvironmentId = useRef(environmentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports to the primary environment once it becomes known
  useEffect(() => {
    if (lastEnvironmentId.current === environmentId) return;
    lastEnvironmentId.current = environmentId;
    if (environmentId !== null) syncRef.current?.resend();
  }, [environmentId]);
  return (
    <>
      <T3SurfaceRegions />
      <ConnectionMonitor />
    </>
  );
}
