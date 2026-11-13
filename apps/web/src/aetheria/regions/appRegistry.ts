// The page's one region registry (D17, XC-19): created on first use with a clientId that is random for this page load. The Backend binds that id to the authenticated connection; the client asserts no
// principal and no session. Tokens are read from the page's computed style only when a query asks.
import { randomUUID } from "~/lib/utils";

import { createRegionRegistry, readComputedToken, type RegionRegistry } from "./registry";

let registry: RegionRegistry | undefined;

export function getAppRegionRegistry(): RegionRegistry {
  registry ??= createRegionRegistry({
    clientId: randomUUID(),
    now: () => Date.now(),
    readToken: readComputedToken,
  });
  return registry;
}
