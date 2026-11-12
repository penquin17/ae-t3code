// The guard every added Aetheria route runs in beforeLoad (D1): the same predicate as T3's `_chat`
// layout, reproduced because `_chat` does not cover these routes and the root does not redirect.
// Boundary: the predicate and its redirect only. It does not show a real router refuses a
// signed-out visit before the page renders; no browser test here signs out the fake environment.
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { requireSignedIn } from "./routeGuard";

const context = (status: string) => ({ authGateState: { status } }) as never;

describe("requireSignedIn", () => {
  it("lets an authenticated visit and a hosted static visit through", () => {
    expect(() => requireSignedIn(context("authenticated"))).not.toThrow();
    expect(() => requireSignedIn(context("hosted-static"))).not.toThrow();
  });

  it.each(["requires-auth", "unauthenticated", "loading", "anything-else"])(
    "redirects a %s visit to /pair, replacing the entry",
    (status) => {
      let thrown: unknown;
      try {
        requireSignedIn(context(status));
      } catch (error) {
        thrown = error;
      }
      expect(isRedirect(thrown)).toBe(true);
      expect(thrown).toMatchObject({ options: { to: "/pair", replace: true } });
    },
  );
});
