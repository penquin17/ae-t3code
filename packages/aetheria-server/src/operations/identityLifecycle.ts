// AETHERIA — the read-only XC-6 operation `identity.lifecycle`: hands the Agent host the thread index's and lifecycle tracker's facts for M03's sweep.
// It changes neither, reads no argument, and names only Pi session ids and the three tri-state facts (`IdentityLifecycleResult`).
// The adapter gates it to answer `unavailable` unless the Backend is running.
import type { IdentityLifecycleResult, Xc6Operation } from "@t3tools/aetheria-contracts";

import type { LifecycleTracker } from "../identity/lifecycle.ts";
import type { ThreadIndex } from "../identity/threadIndex.ts";

export interface IdentityLifecycleDeps {
  readonly tracker: Pick<LifecycleTracker, "snapshot">;
  readonly index: Pick<ThreadIndex, "sessions">;
}

export function createIdentityLifecycleOperation(deps: IdentityLifecycleDeps): Xc6Operation {
  return () => {
    const sessions: IdentityLifecycleResult["sessions"] = {
      ...deps.tracker.snapshot(deps.index.sessions()),
    };
    return { status: "done", result: { sessions } };
  };
}
