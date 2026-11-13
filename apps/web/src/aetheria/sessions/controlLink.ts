import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";

import { buildThreadRouteParams } from "../../threadRoutes";

/**
 * The route params of /aetheria/control/$environmentId/$threadId for a session row, or null when the
 * row's id is not a T3 thread (then no link is drawn). A session id is T3's scoped thread key.
 */
export function controlRouteParams(sessionId: string) {
  const ref = parseScopedThreadKey(sessionId);
  return ref === null ? null : buildThreadRouteParams(ref);
}
