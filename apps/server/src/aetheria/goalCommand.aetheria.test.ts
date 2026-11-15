/* oxlint-disable t3code/no-low-value-comments -- The header states the boundary this evidence covers and what it does not show. */
// AETHERIA M07 Plan step 19 (D25, C8) — the typed-`/goal` route over T3's REAL `parseGoalCommand`, with the goal operations scripted.
//
// Boundary: `goalCommand.ts` only — which driver's message is read, what T3's parser hands on, and the one-line wording for the person. It shows: only a Pi thread's message reaches `run`, parsed by T3's
// own parser (so Codex and Claude keep native handling and ordinary text/attachments parse to null); the route passes the session and parsed command and nothing from the text; each outcome has
// plain wording that never claims an arming the service did not answer. It does NOT show the command-to-operation map or the goal service (outer tests/goals-workflows/typed/*, over the real
// service and parser), and it does not show the upstream call site that supplies a thread's driver and session (an integration point the caller owns).
import { describe, expect, it } from "vite-plus/test";

import {
  describeGoalOutcome,
  makeGoalCommandRoute,
  type GoalCommandOutcome,
} from "./goalCommand.ts";

function scripted() {
  const seen: { command: unknown; sessionId: string }[] = [];
  const route = makeGoalCommandRoute({
    run: async (command, sessionId) => {
      seen.push({ command, sessionId });
      return command === null
        ? { handled: false, reason: "not-a-command" }
        : { handled: true, plan: { kind: "get" }, result: { status: "ok", value: { goal: null } } };
    },
  });
  return { seen, route };
}

describe("typed /goal route", () => {
  it("reads a Pi thread's message with T3's parser and hands over the command and the caller's session, nothing from the text", async () => {
    const { seen, route } = scripted();
    await route.route({ driver: "pi", sessionId: "pi-root", message: { text: "/goal ship it" } });
    await route.route({ driver: "pi", sessionId: "pi-root", message: { text: "/goal" } });
    await route.route({ driver: "pi", sessionId: "pi-root", message: { text: "/goal pause" } });
    expect(seen).toEqual([
      { command: { type: "set", objective: "ship it" }, sessionId: "pi-root" },
      { command: { type: "show" }, sessionId: "pi-root" },
      { command: { type: "pause" }, sessionId: "pi-root" },
    ]);
  });

  it("ordinary text, text that only mentions /goal and a message with attachments reach `run` as null (not a command)", async () => {
    const { seen, route } = scripted();
    for (const message of [
      { text: "hello" },
      { text: "please /goal clear" },
      { text: "/goal clear", attachments: [{}] },
    ]) {
      const out = await route.route({ driver: "pi", sessionId: "pi-root", message });
      expect(out).toEqual({ handled: false, reason: "not-a-command" });
    }
    expect(seen.map((s) => s.command)).toEqual([null, null, null]);
  });

  it("another driver's message never reaches `run`: Codex and Claude keep T3's native /goal, any other driver keeps ordinary text", async () => {
    const { seen, route } = scripted();
    for (const driver of ["codex", "claudeAgent", "opencode", "Pi", ""]) {
      expect(
        await route.route({ driver, sessionId: "s", message: { text: "/goal clear" } }),
      ).toEqual({ handled: false, reason: "not-aetheria-driver" });
    }
    expect(seen).toEqual([]);
  });
});

describe("outcome wording", () => {
  const handled = (
    plan: { kind: string; command?: string } | null,
    result: Extract<GoalCommandOutcome, { handled: true }>["result"],
  ): GoalCommandOutcome => ({ handled: true, plan, result });

  it("says nothing for an unhandled message", () => {
    expect(describeGoalOutcome({ handled: false, reason: "not-a-command" })).toBeNull();
  });

  it("a request for approval says nothing changed until the card is approved; it never says armed", () => {
    const line = describeGoalOutcome(handled({ kind: "propose" }, { status: "awaiting-human" }));
    expect(line).toMatch(/approval/);
    expect(line).toMatch(/Nothing changes until you approve/);
    expect(line).not.toMatch(/armed|running|started/i);
  });

  it("show states the service's own view: running only when armed, waiting to re-arm when the service says so", () => {
    const goal = { objective: "ship it", phase: "active", roundsStarted: 2, maxRounds: 5 };
    const show = (extra: object) =>
      describeGoalOutcome(
        handled({ kind: "get" }, { status: "ok", value: { goal: { ...goal, ...extra } } }),
      );
    expect(show({ armed: true, needsRearm: false })).toBe("Goal (running, round 2 of 5): ship it");
    expect(show({ armed: false, needsRearm: true })).toBe(
      "Goal (waiting for you to re-arm, round 2 of 5): ship it",
    );
    expect(show({ armed: false, needsRearm: false, phase: "paused" })).toBe(
      "Goal (paused, round 2 of 5): ship it",
    );
    expect(
      describeGoalOutcome(handled({ kind: "get" }, { status: "ok", value: { goal: null } })),
    ).toBe("No goal is set for this session.");
  });

  it("pause, clear, no goal, refusals and unavailable each get one plain line", () => {
    expect(describeGoalOutcome(handled({ kind: "pause" }, { status: "ok" }))).toBe("Goal paused.");
    expect(describeGoalOutcome(handled({ kind: "clear" }, { status: "ok" }))).toBe("Goal cleared.");
    expect(
      describeGoalOutcome(handled({ kind: "no-goal", command: "clear" }, { status: "no-goal" })),
    ).toBe("There is no goal to clear.");
    expect(describeGoalOutcome(handled(null, { status: "refused", code: "GOAL_NOT_ROOT" }))).toBe(
      "Only the main session can have a goal.",
    );
    expect(
      describeGoalOutcome(
        handled({ kind: "pause" }, { status: "refused", code: "GOAL_STALE_REVISION" }),
      ),
    ).toBe("Goal request refused (GOAL_STALE_REVISION). Nothing changed.");
    expect(describeGoalOutcome(handled(null, { status: "unavailable" }))).toBe(
      "Goal state could not be read. Nothing changed.",
    );
    expect(describeGoalOutcome(handled(null, { status: "surprise" }))).toBe(
      "Goal request not understood. Nothing changed.",
    );
  });
});
