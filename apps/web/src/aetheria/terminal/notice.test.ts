// The terminal words of the Aetheria build (M10 Plan steps 15–16, D13). T3's own terminal drawer in the chat view IS the terminal surface (no Aetheria terminal page): the drawer carries the
// authority label (IP-61), and the Deliverables page points to the drawer. These are the words; the drawer test (terminalDrawer.aetheria.browser.test.tsx) shows them on screen.
import { describe, expect, it } from "vite-plus/test";

import { TERMINAL_AUTHORITY, TERMINAL_WHERE } from "./notice";

describe("terminal notice", () => {
  it("says commands run as the Backend user, outside the agent's permissions", () => {
    expect(TERMINAL_AUTHORITY).toBe(
      "Commands run as the Backend user, outside the agent's permissions.",
    );
  });

  it("points to the chat view's terminal truthfully: the drawer, opened from a session, and nothing that is not mounted", () => {
    expect(TERMINAL_WHERE).toContain("chat view");
    expect(TERMINAL_WHERE).toContain("Toggle terminal drawer");
    expect(TERMINAL_WHERE).not.toMatch(/not mounted/i);
  });
});
