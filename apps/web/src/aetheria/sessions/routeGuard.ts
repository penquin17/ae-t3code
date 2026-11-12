import { redirect } from "@tanstack/react-router";

/**
 * Every added Aetheria route runs this in `beforeLoad`: the root does not guard a signed-out route,
 * and `_chat` (whose predicate this is) does not cover these routes. A signed-out visit is sent to
 * /pair before the page mounts, so no state request is made before sign-in. Hosted static builds
 * pass, as they do under `_chat`.
 */
export function requireSignedIn(context: {
  readonly authGateState: { readonly status: string };
}): void {
  const { status } = context.authGateState;
  if (status !== "authenticated" && status !== "hosted-static") {
    throw redirect({ to: "/pair", replace: true });
  }
}
