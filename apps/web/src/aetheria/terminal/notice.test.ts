// The terminal words this build can supply without editing T3 (M10 Plan step 16, D13; step 15's terminal verdicts). T3's own drawer is not mounted from an Aetheria route, so its surface is not
// relabelled here: these lines say who a terminal runs as and where the terminal is.
import { describe, expect, it } from "vite-plus/test";

import { TERMINAL_AUTHORITY, TERMINAL_NOT_MOUNTED } from "./notice";

describe("terminal notice", () => {
  it("says commands run as the Backend user, outside the agent's permissions", () => {
    expect(TERMINAL_AUTHORITY).toContain("run as the Backend user");
    expect(TERMINAL_AUTHORITY).toContain("outside the agent's permissions");
  });

  it("says plainly that the terminal page is not mounted and T3's drawer stays the surface", () => {
    expect(TERMINAL_NOT_MOUNTED).toBe(
      "Terminal page not mounted; T3's own drawer remains the terminal surface.",
    );
  });
});
