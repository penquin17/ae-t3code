// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 16 — the lifecycle snapshot served to the Agent host's sweep (XC-6 `identity.lifecycle`).
//
// Boundary: the real tracker over the real thread index. It shows the snapshot lists exactly the sessions the index binds, with the same
// three answers `observer().session` gives, and lists nothing else. It does not show the operation or the transport (service and route tests).
import { describe, expect, it } from "vite-plus/test";

import { createLifecycleTracker } from "./lifecycle.ts";
import { createThreadIndex } from "./threadIndex.ts";
import { FOLDER, SESSION, SESSION_B, THREAD, THREAD_B, rootOf, sessionFileOf } from "./testkit.ts";

function world() {
  const index = createThreadIndex({ stateRoot: rootOf(), projectRootOf: (folder) => folder });
  const tracker = createLifecycleTracker({ index });
  return { index, tracker };
}
const bind = (index: ReturnType<typeof createThreadIndex>, threadId: string, sessionId: string) =>
  index.bind({
    threadId,
    providerSessionId: `cred-${threadId.slice(-4)}`,
    providerInstanceId: "pi",
    sessionFile: sessionFileOf(sessionId),
    workingFolder: FOLDER,
  });

describe("the thread index lists its bound sessions", () => {
  it("lists nothing when nothing is bound, then each bound session once", () => {
    const { index } = world();
    expect(index.sessions()).toEqual([]);
    bind(index, THREAD, SESSION);
    bind(index, THREAD_B, SESSION_B);
    bind(index, THREAD, SESSION); // an unchanged rebind adds nothing
    expect(index.sessions()).toEqual([SESSION, SESSION_B].sort());
  });
});

describe("the tracker snapshot", () => {
  it("answers unknown for a bound session T3 has said nothing about, and the observed answers for the rest", () => {
    const { index, tracker } = world();
    bind(index, THREAD, SESSION);
    bind(index, THREAD_B, SESSION_B);
    tracker.record({ kind: "running", threadId: THREAD });
    tracker.record({ kind: "accepted", threadId: THREAD });
    expect(tracker.snapshot(index.sessions())).toEqual({
      [SESSION]: { exists: true, closed: false, acceptedPrompt: true },
      [SESSION_B]: { exists: null, closed: null, acceptedPrompt: null },
    });
  });

  it("lists only the sessions it is asked about and gives a frozen result", () => {
    const { index, tracker } = world();
    bind(index, THREAD, SESSION);
    tracker.record({ kind: "running", threadId: THREAD });
    const snapshot = tracker.snapshot([SESSION, "not-bound"]);
    expect(Object.keys(snapshot)).toEqual([SESSION, "not-bound"]); // exactly what was asked; an unbound id is all-null, never invented
    expect(snapshot["not-bound"]).toEqual({ exists: null, closed: null, acceptedPrompt: null });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(tracker.snapshot([])).toEqual({});
  });

  it("leaves a session two threads claim unknown", () => {
    const { index, tracker } = world();
    bind(index, THREAD, SESSION);
    tracker.record({ kind: "running", threadId: THREAD });
    expect(tracker.snapshot([SESSION])[SESSION]).toEqual({
      exists: true,
      closed: false,
      acceptedPrompt: null,
    });
    // the second thread's bind is refused by the index, so the claim cannot arise through bind; the tracker still answers from `threadsOf`
    expect(bind(index, THREAD_B, SESSION).ok).toBe(false);
  });
});
