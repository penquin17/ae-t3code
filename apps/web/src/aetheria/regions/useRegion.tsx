// The hook a view calls to register its declared region (D17, XC-19): registered while the component is mounted, removed when it unmounts (and correct under React's double effects), with a reporter that
// always reads the CURRENT props and state without registering again. A view with no provider uses the page's one registry. The hook renders nothing, reads no DOM and sends nothing.
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { getAppRegionRegistry } from "./appRegistry";
import type { RegionDescriptor } from "./descriptor";
import type { RegionRegistry, Reporter } from "./registry";

const RegistryContext = createContext<RegionRegistry | null>(null);

/** A host or a test supplies its own registry here; absent, views use the page's one registry. */
export function RegionRegistryProvider(props: {
  readonly registry: RegionRegistry;
  readonly children: ReactNode;
}) {
  return <RegistryContext value={props.registry}>{props.children}</RegistryContext>;
}

export const useRegionRegistry = (): RegionRegistry =>
  useContext(RegistryContext) ?? getAppRegionRegistry();

export interface UseRegionOptions {
  /** Whether the region is in view; absent means visible. */
  readonly visible?: boolean | undefined;
}

/** `descriptor` is null for a view that was given no region to report (a shared component mounted where nothing declares it): the hook then registers nothing. */
export function useRegion(
  descriptor: RegionDescriptor | null,
  reporter: Reporter,
  options: UseRegionOptions = {},
): void {
  const registry = useRegionRegistry();
  const visible = options.visible ?? true;
  const latest = useRef<Reporter>(reporter);
  const wanted = useRef(visible);
  const regionId = descriptor?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the registry reads the latest reporter and visibility at a query, without registering again
  useEffect(() => {
    latest.current = reporter;
    wanted.current = visible;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the region while this view is mounted and removes it on unmount
  useEffect(
    () =>
      descriptor === null
        ? undefined
        : registry.register(descriptor, () => latest.current(), { visible: wanted.current }),
    [registry, descriptor],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports the view's visibility to the registry
  useEffect(() => {
    if (regionId !== undefined) registry.setVisible(regionId, visible);
  }, [registry, regionId, visible]);
}
