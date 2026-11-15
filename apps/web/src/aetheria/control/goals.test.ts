// The goal view's pure logic (M07 Plan step 18, D24, C8, XC-23): how a reply is read, how a push and a baseline order, what each goal state says, and the one-click Re-arm as one honest outcome. Boundary: the
// functions over a SCRIPTED transport and read, so these show the rules (sent once, never resent, read-back before success, the origin id kept inside the send), not T3's socket or the real Backend: the
// browser test shows the view, and step 20's built-app run shows the real call.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { connectedView, notConnectedView, showConnection } from "../connection/testing";
import { createRearm, type RearmReport } from "./goals/rearm";
import { classifyRearm, classifySnapshot, type GoalRead, type GoalView } from "./goals/reply";
import {
  disconnected,
  initialGoals,
  liveGoal,
  pushArrived,
  reconnected,
  snapshotArrived,
  snapshotFailed,
  streamEnded,
  viewOf,
  type GoalsState,
} from "./goals/state";
import { goalFacts, rearmNotice } from "./goals/text";
import type { GoalsTransport } from "./goals/types";
import type { TransportResult } from "./types";

const ROOT = "pi-root-1";
const ENV = "env-1";
const DIGEST = "d".repeat(64);
const ORIGIN = "origin-secret-42";

const goal = (over: Partial<GoalView> = {}): GoalView => ({
  goalId: "g-7",
  revision: 4,
  objective: "Ship the thing",
  phase: "active",
  roundsStarted: 2,
  maxRounds: 10,
  armed: true,
  needsRearm: false,
  ...over,
});
const needsRearm = (over: Partial<GoalView> = {}): GoalView =>
  goal({
    armed: false,
    needsRearm: true,
    rearm: {
      subject: { type: "goal-mutation", id: "g-7:4:rearm", revision: DIGEST },
      text: "Re-arm goal g-7",
    },
    ...over,
  });

const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const ok = (value: unknown) => reply({ ok: true, value });
const fail = (code: string, extra: object = {}) => reply({ ok: false, code, ...extra });
const LOST: TransportResult = { tag: "lost" };

describe("a goal snapshot reply is read strictly", () => {
  it("reads a goal and no goal, each with its version", () => {
    expect(classifySnapshot(ok({ goal: goal(), version: 3 }))).toEqual({
      tag: "ok",
      goal: goal(),
      version: 3,
    });
    expect(classifySnapshot(ok({ goal: null, version: 0 }))).toEqual({
      tag: "ok",
      goal: null,
      version: 0,
    });
  });

  it("a view that carries an origin id, or any field the contract does not name, is not shown", () => {
    const read = classifySnapshot(ok({ goal: { ...goal(), originId: ORIGIN }, version: 3 }));
    expect(read).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(JSON.stringify(read)).not.toContain(ORIGIN);
  });

  it.each([
    ["GOALS_UNAVAILABLE", "unavailable"],
    ["GOALS_OUTCOME_UNKNOWN", "unknown"],
    ["GOALS_NOT_AUTHORIZED", "refused"],
    ["GOALS_DEVICE_REVOKED", "refused"],
    ["GOALS_NOT_FOUND", "refused"],
  ] as const)("%s is %s, never an empty goal", (code, kind) => {
    expect(classifySnapshot(fail(code, { detail: "words" }))).toMatchObject({
      tag: "failed",
      kind,
      code,
      reason: "words",
    });
  });

  it("a lost reply, a T3 refusal and a non-reply are failed reads", () => {
    expect(classifySnapshot(LOST)).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(classifySnapshot({ tag: "failed", message: "scope" })).toMatchObject({
      tag: "failed",
      kind: "refused",
      reason: "scope",
    });
    expect(classifySnapshot(reply("nonsense"))).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(classifySnapshot(ok({ goal: { goalId: "g" }, version: 1 }))).toMatchObject({
      tag: "failed",
      kind: "unknown",
    });
  });
});

describe("a Re-arm reply ends one of five ways", () => {
  it("accepted carries the goal; an unreadable accepted goal is unknown, not success", () => {
    expect(classifyRearm(ok({ goal: goal() }))).toEqual({ tag: "accepted", goal: goal() });
    expect(classifyRearm(ok({ goal: { goalId: "g" } }))).toMatchObject({ tag: "unknown" });
    expect(classifyRearm(ok({ goal: goal(), originId: ORIGIN }))).toMatchObject({
      tag: "unknown",
    });
  });

  it("GOAL_STALE_REVISION carries the current view when it decodes", () => {
    expect(
      classifyRearm(
        fail("GOAL_STALE_REVISION", { detail: "moved", current: goal({ revision: 5 }) }),
      ),
    ).toEqual({ tag: "stale", detail: "moved", current: goal({ revision: 5 }) });
    expect(classifyRearm(fail("GOAL_STALE_REVISION", { current: null }))).toEqual({
      tag: "stale",
      current: null,
    });
    expect(classifyRearm(fail("GOAL_STALE_REVISION", { current: { bad: true } }))).toEqual({
      tag: "stale",
    });
  });

  it("GOALS_OUTCOME_UNKNOWN and a lost reply are unknown; GOALS_UNAVAILABLE is nothing done", () => {
    expect(classifyRearm(fail("GOALS_OUTCOME_UNKNOWN"))).toMatchObject({ tag: "unknown" });
    expect(classifyRearm(LOST)).toMatchObject({ tag: "unknown" });
    expect(classifyRearm(fail("GOALS_UNAVAILABLE", { detail: "down" }))).toEqual({
      tag: "unavailable",
      reason: "down",
    });
  });

  it("every other code is a refusal that keeps its words and the failed field", () => {
    expect(
      classifyRearm(fail("ORIGIN_MISMATCH", { detail: "wrong root", field: "sessionId" })),
    ).toEqual({
      tag: "refused",
      code: "ORIGIN_MISMATCH",
      detail: "wrong root",
      field: "sessionId",
    });
    expect(classifyRearm(fail("AUTH_TOKEN_EXPIRED"))).toMatchObject({
      tag: "refused",
      code: "AUTH_TOKEN_EXPIRED",
    });
  });
});

describe("the goal state follows versions, and a failed read is never no goal", () => {
  const baseline = (state: GoalsState, version: number, g: GoalView | null = goal()) =>
    snapshotArrived(state, { goal: g, version });

  it("is waiting before the first read and live after it", () => {
    expect(viewOf(initialGoals()).status).toBe("waiting");
    const step = baseline(initialGoals(), 3);
    expect(viewOf(step.state)).toEqual({ status: "live", version: 3, goal: goal() });
    expect(step.read).toBe(false);
  });

  it("keeps a push seen before the baseline and reads again when the baseline is behind it", () => {
    const early = pushArrived(initialGoals(), ROOT, { rootSessionId: ROOT, version: 5 });
    expect(early.read).toBe(false);
    expect(baseline(early.state, 4).read).toBe(true);
    expect(baseline(early.state, 5).read).toBe(false);
  });

  it("drops an older baseline, a duplicate push and a push for another root; a gap needs a baseline", () => {
    const live = baseline(initialGoals(), 5).state;
    expect(baseline(live, 4, goal({ revision: 1 })).state).toBe(live);
    expect(pushArrived(live, ROOT, { rootSessionId: ROOT, version: 5 }).read).toBe(false);
    expect(pushArrived(live, ROOT, { rootSessionId: ROOT, version: 3 }).read).toBe(false);
    expect(pushArrived(live, ROOT, { rootSessionId: "other", version: 9 }).read).toBe(false);
    const next = pushArrived(live, ROOT, { rootSessionId: ROOT, version: 6 });
    expect(next.read).toBe(true);
    // A push never changes the goal.
    expect(viewOf(next.state)).toMatchObject({ status: "live", goal: goal() });
    const gap = pushArrived(live, ROOT, { rootSessionId: ROOT, version: 9 });
    expect(gap.read).toBe(true);
    expect(gap.state.projection).toMatchObject({ needsBaseline: true });
  });

  it("the newest version wins: an out-of-order older read never replaces a newer goal", () => {
    const newer = baseline(initialGoals(), 7, goal({ revision: 6 })).state;
    const after = baseline(newer, 6, goal({ revision: 5 })).state;
    expect(viewOf(after)).toMatchObject({ version: 7, goal: { revision: 6 } });
  });

  it("a read that moves the view forward asks for another while a push is ahead, one that does not never loops", () => {
    const ahead = pushArrived(baseline(initialGoals(), 3).state, ROOT, {
      rootSessionId: ROOT,
      version: 6,
    }).state;
    // A Backend that keeps answering version 3 under a push for 6: no progress, so no read is asked for.
    expect(baseline(ahead, 3).read).toBe(false);
    expect(baseline(baseline(ahead, 3).state, 3).read).toBe(false);
    // Progress below the push asks again; reaching it stops.
    expect(baseline(ahead, 4).read).toBe(true);
    expect(baseline(ahead, 6).read).toBe(false);
  });

  it("a failed first read is unavailable or unknown, never an empty goal", () => {
    const failed = (kind: "unavailable" | "unknown") =>
      viewOf(
        snapshotFailed(initialGoals(), { tag: "failed", kind, reason: "no reply", code: "X" }),
      );
    expect(failed("unavailable")).toEqual({
      status: "unavailable",
      kind: "unavailable",
      reason: "no reply",
    });
    expect(failed("unknown")).toMatchObject({ status: "unavailable", kind: "unknown" });
  });

  it("a read that fails after a good one keeps the goal, marked stale, and offers no Re-arm", () => {
    const live = baseline(initialGoals(), 3, needsRearm()).state;
    expect(liveGoal(viewOf(live))).not.toBeNull();
    const stale = viewOf(snapshotFailed(live, { tag: "failed", kind: "unknown", reason: "lost" }));
    expect(stale).toMatchObject({ status: "stale", version: 3, reason: "lost" });
    expect(liveGoal(stale)).toBeNull();
    expect(liveGoal(viewOf(disconnected(live)))).toBeNull();
    expect(viewOf(disconnected(live)).status).toBe("stale");
  });

  it("a refusal shows no goal at all, and a good read clears it", () => {
    const live = baseline(initialGoals(), 3).state;
    const refused = snapshotFailed(live, {
      tag: "failed",
      kind: "refused",
      reason: "revoked",
      code: "GOALS_DEVICE_REVOKED",
    });
    expect(viewOf(refused)).toEqual({
      status: "refused",
      code: "GOALS_DEVICE_REVOKED",
      reason: "revoked",
    });
    expect(viewOf(baseline(refused, 4).state).status).toBe("live");
  });

  it("an ended stream is unavailable; coming back asks for a read", () => {
    const ended = streamEnded(baseline(initialGoals(), 3).state, "gone");
    expect(viewOf(ended)).toMatchObject({ status: "unavailable", reason: "gone" });
    const back = reconnected(ended);
    expect(back.read).toBe(true);
    expect(back.state.ended).toBeNull();
  });
});

describe("each goal state says what it is", () => {
  const headline = (g: GoalView) => goalFacts(g).headline;

  it("needs-Re-arm, armed, paused and not-armed are distinct", () => {
    expect(headline(needsRearm())).toBe("needs-rearm");
    expect(headline(goal())).toBe("armed");
    expect(headline(goal({ phase: "paused", armed: false }))).toBe("paused");
    expect(headline(goal({ armed: false }))).toBe("not-armed");
    expect(goalFacts(needsRearm()).headlineText).toMatch(/not armed.*re-armed/i);
  });

  it("awaiting-human leads, with the card named, over every other state", () => {
    const g = needsRearm({ awaitingHuman: { proposalId: "p-1", interactionId: "i-9" } });
    const facts = goalFacts(g);
    expect(facts.headline).toBe("awaiting-human");
    expect(facts.lines.join(" ")).toContain("i-9");
    expect(facts.lines.join(" ")).toContain("p-1");
  });

  it("round-limit and any other block are told apart, and the blocker's words are kept", () => {
    const limit = goalFacts(
      goal({
        phase: "blocked",
        armed: false,
        roundsStarted: 10,
        blocker: { code: "round-limit", message: "" },
      }),
    );
    expect(limit.headline).toBe("blocked-round-limit");
    expect(limit.headlineText).toContain("10 of 10");
    const model = goalFacts(
      goal({ phase: "blocked", armed: false, blocker: { code: "model", message: "cannot reach" } }),
    );
    expect(model.headline).toBe("blocked");
    expect(model.lines.join(" ")).toContain("cannot reach");
  });

  it("interrupted is said, complete ends it, and nothing claims a round is running", () => {
    expect(goalFacts(goal({ interrupted: "backend-restarted" })).lines.join(" ")).toMatch(
      /restarted.*interrupted/,
    );
    expect(headline(goal({ phase: "complete", armed: false }))).toBe("complete");
    for (const g of [goal(), needsRearm(), goal({ phase: "paused" })]) {
      const text = [goalFacts(g).headlineText, ...goalFacts(g).lines].join(" ");
      expect(text).not.toMatch(/\brunning\b/i);
    }
  });
});

type Script = {
  readonly grant?: TransportResult | (() => Promise<TransportResult>);
  readonly rearm?: TransportResult | (() => Promise<TransportResult>);
  readonly read?: GoalRead | (() => Promise<GoalRead>);
};
const grantOk = ok({ originId: ORIGIN });
const shows = (g: GoalView): GoalRead => ({ tag: "ok", goal: g, version: 9 });

function setup(script: Script) {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const run = async <T>(value: T | (() => Promise<T>)): Promise<T> =>
    typeof value === "function" ? (value as () => Promise<T>)() : value;
  const transport: GoalsTransport = {
    snapshot: vi.fn(async () => LOST),
    grant: vi.fn(async (_env, payload) => {
      calls.push({ method: "grant", payload });
      return run(script.grant ?? grantOk);
    }),
    rearm: vi.fn(async (_env, payload) => {
      calls.push({ method: "rearm", payload });
      return run(script.rearm ?? ok({ goal: goal({ revision: 5 }) }));
    }),
  };
  const readSnapshot = vi.fn(async () => run(script.read ?? shows(goal({ revision: 5 }))));
  let ids = 0;
  const rearm = createRearm({
    transport,
    environmentId: ENV,
    rootSessionId: ROOT,
    newRequestId: () => `req-${++ids}`,
    readSnapshot,
  });
  return { transport, calls, readSnapshot, rearm };
}

const sentReport = (report: RearmReport) => {
  if (!report.sent) throw new Error("nothing was sent");
  return report;
};

describe("one-click Re-arm", () => {
  let hide = () => {};
  afterEach(() => hide());

  it("grants for the snapshot's exact subject and root, then passes that grant once to goal.rearm for the goal the person saw", async () => {
    const h = setup({});
    const report = sentReport(await h.rearm(needsRearm()));
    expect(h.calls).toEqual([
      {
        method: "grant",
        payload: {
          subject: { type: "goal-mutation", id: "g-7:4:rearm", revision: DIGEST },
          sessionId: ROOT,
        },
      },
      {
        method: "rearm",
        payload: { rootSessionId: ROOT, goalId: "g-7", revision: 4, originId: ORIGIN },
      },
    ]);
    expect(report.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    // Exactly one read, and it is the confirming one.
    expect(h.readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps the origin id out of the report: it is in the one rearm payload and nowhere else", async () => {
    const h = setup({});
    const report = await h.rearm(needsRearm());
    expect(JSON.stringify(report)).not.toContain(ORIGIN);
    expect(JSON.stringify(rearmNotice(report))).not.toContain(ORIGIN);
    expect(JSON.stringify(h.calls).split(ORIGIN)).toHaveLength(2);
  });

  it("success needs a read-back: a goal not yet shown at the accepted revision is unknown, not confirmed", async () => {
    const behind = setup({ read: shows(goal({ revision: 3 })) });
    expect(sentReport(await behind.rearm(needsRearm())).outcome.kind).toBe("unknown");
    const gone = setup({ read: shows(goal({ goalId: "g-other", revision: 9 })) });
    expect(sentReport(await gone.rearm(needsRearm())).outcome.kind).toBe("unknown");
    const none = setup({ read: { tag: "ok", goal: null, version: 9 } });
    expect(sentReport(await none.rearm(needsRearm())).outcome.kind).toBe("unknown");
    const failed = setup({ read: { tag: "failed", kind: "unknown", reason: "lost" } });
    const report = sentReport(await failed.rearm(needsRearm()));
    expect(report.outcome.kind).toBe("unknown");
    expect(rearmNotice(report)?.tone).toBe("warning");
  });

  it("a lost grant reply is unknown, sends no Re-arm, never grants again, and reads the goal again", async () => {
    const h = setup({ grant: LOST });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report).toMatchObject({ stage: "grant", outcome: { kind: "unknown" } });
    expect(h.transport.grant).toHaveBeenCalledTimes(1);
    expect(h.transport.rearm).not.toHaveBeenCalled();
    expect(h.readSnapshot).toHaveBeenCalledTimes(1);
    expect(rearmNotice(report)?.text).toMatch(/no Re-arm was sent/);
  });

  it("a grant that came back without an origin is unknown and sends no Re-arm", async () => {
    const h = setup({ grant: ok({}) });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report.outcome.kind).toBe("unknown");
    expect(h.transport.rearm).not.toHaveBeenCalled();
  });

  it("a refused grant sends no Re-arm and keeps the Backend's words", async () => {
    const h = setup({ grant: fail("INTERACTION_GRANT_INVALID", { detail: "agent caller" }) });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report).toMatchObject({
      stage: "grant",
      outcome: { kind: "refused", code: "INTERACTION_GRANT_INVALID", message: "agent caller" },
    });
    expect(h.transport.rearm).not.toHaveBeenCalled();
  });

  it("a throwing transport is a lost reply, never a refusal and never a resend", async () => {
    const h = setup({
      rearm: () => Promise.reject(new Error("socket closed")),
    });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report).toMatchObject({ stage: "rearm", outcome: { kind: "unknown" } });
    expect(h.transport.rearm).toHaveBeenCalledTimes(1);
    expect(h.transport.grant).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a lost Re-arm reply", LOST],
    ["GOALS_OUTCOME_UNKNOWN", fail("GOALS_OUTCOME_UNKNOWN", { detail: "may have landed" })],
    ["a non-reply", reply("nonsense")],
  ] as const)("%s is unknown, never resent, and re-reads the goal", async (_name, result) => {
    const h = setup({ rearm: result, read: shows(needsRearm()) });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report).toMatchObject({ stage: "rearm", outcome: { kind: "unknown" } });
    expect(h.transport.rearm).toHaveBeenCalledTimes(1);
    expect(h.transport.grant).toHaveBeenCalledTimes(1);
    expect(h.readSnapshot).toHaveBeenCalledTimes(1);
    expect(rearmNotice(report)?.text).toMatch(/not sent again/);
  });

  it("GOALS_UNAVAILABLE means nothing was done; the goal is still read again", async () => {
    const h = setup({ rearm: fail("GOALS_UNAVAILABLE", { detail: "the service is not running" }) });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report.outcome).toMatchObject({
      kind: "unavailable",
      reason: "the service is not running",
    });
    expect(h.readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("a stale reference is refused with the current view reported and the goal read again", async () => {
    const h = setup({
      rearm: fail("GOAL_STALE_REVISION", { detail: "moved", current: goal({ revision: 6 }) }),
      read: shows(goal({ revision: 6 })),
    });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report.outcome).toMatchObject({ kind: "refused", code: "GOAL_STALE_REVISION" });
    expect(report.current).toEqual(goal({ revision: 6 }));
    expect(rearmNotice(report)?.text).toContain("revision 6");
    expect(h.transport.rearm).toHaveBeenCalledTimes(1);
    expect(h.readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("a refused origin (consumed, mismatched, foreign) keeps its code, words and failed field", async () => {
    const h = setup({
      rearm: fail("GOAL_ORIGIN_CONSUMED", { detail: "already used", field: "originId" }),
    });
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report.outcome).toEqual({
      kind: "refused",
      code: "GOAL_ORIGIN_CONSUMED",
      message: "already used (originId)",
    });
    expect(rearmNotice(report)?.tone).toBe("error");
  });

  it("a goal with no Re-arm offer sends nothing, even for a goal that needs re-arming by its flag", async () => {
    const h = setup({});
    expect(await h.rearm(goal({ armed: false, needsRearm: true }))).toEqual({ sent: false });
    expect(h.calls).toEqual([]);
    expect(h.readSnapshot).not.toHaveBeenCalled();
  });

  it("a second click while one is in flight sends nothing", async () => {
    let release!: (value: TransportResult) => void;
    const h = setup({
      grant: () => new Promise<TransportResult>((resolve) => (release = resolve)),
    });
    const first = h.rearm(needsRearm());
    expect(await h.rearm(needsRearm())).toEqual({ sent: false });
    release(grantOk);
    expect((await first).sent).toBe(true);
    expect(h.transport.grant).toHaveBeenCalledTimes(1);
    expect(h.transport.rearm).toHaveBeenCalledTimes(1);
  });

  it("is sent only while the connection allows actions, and a blocked Re-arm sends and reads nothing", async () => {
    hide = showConnection(notConnectedView);
    const h = setup({});
    const report = sentReport(await h.rearm(needsRearm()));
    expect(report.outcome).toMatchObject({ kind: "unavailable" });
    expect((report.outcome as { reason: string }).reason).toMatch(/nothing was sent/i);
    expect(h.calls).toEqual([]);
    expect(h.readSnapshot).not.toHaveBeenCalled();
    hide = showConnection(connectedView);
    // The blocked one is not queued: nothing goes out until the person clicks again.
    expect(h.calls).toEqual([]);
  });

  it("every outcome has a sentence, and only a read-back success says re-armed", async () => {
    const cases: ReadonlyArray<readonly [Script, boolean]> = [
      [{}, true],
      [{ rearm: LOST }, false],
      [{ grant: LOST }, false],
      [{ rearm: fail("GOALS_UNAVAILABLE") }, false],
      [{ rearm: fail("GOAL_STALE_REVISION") }, false],
      [{ rearm: fail("ORIGIN_STALE") }, false],
      [{ grant: fail("INTERACTION_GRANT_INVALID") }, false],
    ];
    for (const [script, success] of cases) {
      const notice = rearmNotice(await setup(script).rearm(needsRearm()));
      expect(notice).not.toBeNull();
      expect(notice?.text.startsWith("Re-armed")).toBe(success);
    }
    expect(rearmNotice({ sent: false })).toBeNull();
    expect(rearmNotice(null)).toBeNull();
  });
});
