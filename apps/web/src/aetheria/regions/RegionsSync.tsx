// Mounted once by the shell (step 24): reports the page's registered regions to the Backend for as long as it is mounted (D17, XC-19). It renders no visible UI; it renders the always-mounted connection monitor,
// so the connection gate has a view even when no status line is on screen. Unmounting stops the sending and nothing else: the
// Backend drops the client when the connection closes, and a page that just unmounted this component sends no cancel and no unregister.
import { useEffect, useRef } from "react";

import { ConnectionMonitor } from "../connection/ConnectionMonitor";
import { useT3RegionsTransport } from "./commands";
import { useRegionRegistry } from "./useRegion";
import { createRegionSync, type RegionsTransport } from "./sync";

/** Sending defaults: a short quiet window, a reply timeout shorter than the Backend's patience, and a bounded backoff. */
const REGION_SYNC_DEFAULTS = {
  debounceMs: 100,
  replyTimeoutMs: 15_000,
  retry: { baseMs: 1_000, maxMs: 30_000, maxAttempts: 5 },
} as const;

export function RegionsSync(props: { readonly transport?: RegionsTransport }) {
  const registry = useRegionRegistry();
  const real = useT3RegionsTransport();
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
    sync.start();
    return () => sync.stop();
  }, [registry]);
  return <ConnectionMonitor />;
}
