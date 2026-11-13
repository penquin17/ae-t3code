// The write guard of T3's terminal drawer (M10 Plan steps 15–16, the step-15 verdict "write to an exited terminal reports success while delivering nothing"). Boundary: the pure guard the drawer's
// one marked hunk (IP-61) calls before it sends input. It shows when a write is refused on the client and what the person is told; it does NOT show the drawer, the socket, or T3's server (the
// browser test over the real drawer and the native terminal case do).
import { describe, expect, it } from "vite-plus/test";

import { createEndedWriteGuard, ENDED_WRITE_CLOSED, ENDED_WRITE_EXITED } from "./endedWrite";

describe("ended terminal write guard", () => {
  it("lets input through while the process runs, and before the session has been seen at all", () => {
    const guard = createEndedWriteGuard();
    expect(guard.check({ status: "running", version: 3 })).toBeNull();
    expect(guard.check({ status: "starting", version: 1 })).toBeNull();
    // The initial state of an attached session is 'closed' at version 0: nothing is known yet, so T3's own path decides.
    expect(guard.check({ status: "closed", version: 0 })).toBeNull();
  });

  it("says the process has exited, once, instead of letting the input look delivered", () => {
    const guard = createEndedWriteGuard();
    expect(guard.check({ status: "exited", version: 4 })).toBe(ENDED_WRITE_EXITED);
    expect(ENDED_WRITE_EXITED).toContain("Process exited");
    expect(ENDED_WRITE_EXITED).toContain("not delivered");
    // The same ended state is told once: the words stay on the screen, and a key held down does not scroll them away.
    expect(guard.blocks({ status: "exited", version: 4 })).toBe(true);
    expect(guard.check({ status: "exited", version: 4 })).toBeNull();
    expect(guard.blocks({ status: "exited", version: 4 })).toBe(true);
  });

  it("names a closed terminal differently from an exited one", () => {
    const guard = createEndedWriteGuard();
    expect(guard.check({ status: "closed", version: 5 })).toBe(ENDED_WRITE_CLOSED);
    expect(ENDED_WRITE_CLOSED).toContain("Terminal closed");
    expect(ENDED_WRITE_CLOSED).not.toBe(ENDED_WRITE_EXITED);
  });

  it("tells again when the ended state changes (exited, then closed) or after the terminal ran again", () => {
    const guard = createEndedWriteGuard();
    expect(guard.check({ status: "exited", version: 4 })).toBe(ENDED_WRITE_EXITED);
    expect(guard.check({ status: "closed", version: 5 })).toBe(ENDED_WRITE_CLOSED);
    expect(guard.check({ status: "running", version: 6 })).toBeNull();
    expect(guard.blocks({ status: "running", version: 6 })).toBe(false);
    expect(guard.check({ status: "exited", version: 7 })).toBe(ENDED_WRITE_EXITED);
  });

  it("an error status is not an ended process: T3's own failure handling shows it", () => {
    const guard = createEndedWriteGuard();
    expect(guard.blocks({ status: "error", version: 2 })).toBe(false);
    expect(guard.check({ status: "error", version: 2 })).toBeNull();
  });
});
