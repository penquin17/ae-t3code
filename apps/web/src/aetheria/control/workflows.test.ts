// The workflow runs view's pure logic (M07 Plan step 29, M10 run controls): how a reply is read, how reads order, what each run state says, and the one-click Cancel as one honest outcome. Boundary: the
// functions over a SCRIPTED transport and read, so these show the rules (sent once, never resent, read-back before success), not T3's socket or the real Backend: the browser test shows the view, and the
// built-app run shows the real calls.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { connectedView, notConnectedView, showConnection } from "../connection/testing";
import { createCancel, type CancelReport } from "./workflows/cancel";
import {
  classifyCancel,
  classifyRuns,
  type RunsRead,
  type WorkflowRunView,
} from "./workflows/reply";
import {
  cancelOffered,
  cancelShows,
  initialWorkflows,
  readArrived,
  readFailed,
  viewOf,
  type WorkflowsState,
} from "./workflows/state";
import { cancelNotice, memberLine, runFacts } from "./workflows/text";
import type { WorkflowsTransport } from "./workflows/types";
import type { TransportResult } from "./types";

const ROOT = "pi-root-1";
const ENV = "env-1";

const NONE = {
  pending: 0,
  started: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  cancelled: 0,
  closed: 0,
};
const run = (over: Partial<WorkflowRunView> = {}): WorkflowRunView => ({
  runId: "run-1",
  name: "research-sweep",
  state: "running",
  phase: "gather",
  agentsStarted: 3,
  members: { ...NONE, started: 2, completed: 1 },
  startedAt: "2026-05-01T10:00:00.000Z",
  ...over,
});

const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const ok = (value: unknown) => reply({ ok: true, value });
const fail = (code: string, extra: object = {}) => reply({ ok: false, code, ...extra });
const LOST: TransportResult = { tag: "lost" };

const okRead = (runs: readonly WorkflowRunView[], version: number, unreadable = 0): RunsRead => ({
  tag: "ok",
  runs,
  version,
  unreadable,
});

describe("a runs reply is read strictly", () => {
  it("reads the runs with their version and a count of unreadable records", () => {
    expect(classifyRuns(ok({ runs: [run()], version: 3 }))).toEqual(okRead([run()], 3));
    expect(classifyRuns(ok({ runs: [], version: 0, unreadable: 2 }))).toEqual(okRead([], 0, 2));
  });

  it("a run that carries a script, an argument, child output or any field the contract does not name is not shown", () => {
    const read = classifyRuns(
      ok({ runs: [{ ...run(), script: "rm -rf /", output: "secret" }], version: 3 }),
    );
    expect(read).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(JSON.stringify(read)).not.toContain("rm -rf");
  });

  it("a run in a state the contract does not name is not shown", () => {
    expect(classifyRuns(ok({ runs: [{ ...run(), state: "paused" }], version: 3 }))).toMatchObject({
      tag: "failed",
      kind: "unknown",
    });
  });

  it.each([
    ["WORKFLOWS_UNAVAILABLE", "unavailable"],
    ["WORKFLOWS_OUTCOME_UNKNOWN", "unknown"],
    ["WORKFLOWS_NOT_AUTHORIZED", "refused"],
    ["WORKFLOWS_DEVICE_REVOKED", "refused"],
    ["WORKFLOWS_NOT_FOUND", "refused"],
  ] as const)("%s is %s, never an empty list", (code, kind) => {
    expect(classifyRuns(fail(code, { detail: "words" }))).toMatchObject({
      tag: "failed",
      kind,
      code,
      reason: "words",
    });
  });

  it("a lost reply, a T3 refusal and a non-reply are failed reads", () => {
    expect(classifyRuns(LOST)).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(classifyRuns({ tag: "failed", message: "scope" })).toMatchObject({
      tag: "failed",
      kind: "refused",
      reason: "scope",
    });
    expect(classifyRuns(reply("nonsense"))).toMatchObject({ tag: "failed", kind: "unknown" });
    expect(classifyRuns(ok({ runs: "none", version: 1 }))).toMatchObject({
      tag: "failed",
      kind: "unknown",
    });
  });
});

describe("a cancel reply ends one of four ways", () => {
  it("accepted carries the run; an unreadable accepted run is unknown, not success", () => {
    expect(classifyCancel(ok({ run: run({ cancelRequested: true }) }))).toEqual({
      tag: "accepted",
      run: run({ cancelRequested: true }),
    });
    expect(classifyCancel(ok({ run: { runId: "x" } }))).toMatchObject({ tag: "unknown" });
    expect(classifyCancel(ok({ run: run(), extra: 1 }))).toMatchObject({ tag: "unknown" });
  });

  it.each([
    ["WORKFLOWS_UNAVAILABLE", "unavailable"],
    ["WORKFLOWS_OUTCOME_UNKNOWN", "unknown"],
    ["WORKFLOWS_NOT_AUTHORIZED", "refused"],
    ["WORKFLOWS_DEVICE_REVOKED", "refused"],
    ["WORKFLOWS_NOT_FOUND", "refused"],
  ] as const)("%s is %s", (code, tag) => {
    expect(classifyCancel(fail(code, { detail: "words" }))).toMatchObject({ tag });
  });

  it("a lost reply and a non-reply are unknown; T3's own refusal is a refusal", () => {
    expect(classifyCancel(LOST)).toMatchObject({ tag: "unknown" });
    expect(classifyCancel(reply(42))).toMatchObject({ tag: "unknown" });
    expect(classifyCancel({ tag: "failed", message: "no operate scope" })).toMatchObject({
      tag: "refused",
      detail: "no operate scope",
    });
  });
});

describe("reads order by version and a failed read is never no runs", () => {
  const read = (state: WorkflowsState, version: number, runs = [run()]) =>
    readArrived(state, { tag: "ok", runs, version, unreadable: 0 });

  it("waits before the first read; the newest version wins and an older read is dropped whole", () => {
    expect(viewOf(initialWorkflows())).toMatchObject({ status: "waiting" });
    const at5 = read(initialWorkflows(), 5, [run({ name: "five" })]);
    const behind = read(at5, 4, [run({ name: "four" })]);
    expect(behind).toBe(at5);
    const same = read(at5, 5, [run({ name: "five-again" })]);
    expect(viewOf(same)).toMatchObject({ status: "live", version: 5 });
    const newer = read(same, 6, [run({ name: "six" })]);
    expect(viewOf(newer)).toMatchObject({ status: "live", version: 6 });
    expect(newer.held?.runs[0]?.name).toBe("six");
  });

  it("an unavailable or unknown read keeps the last list stale; with none it is unavailable or unknown", () => {
    const live = read(initialWorkflows(), 3);
    const stale = readFailed(live, {
      tag: "failed",
      kind: "unavailable",
      reason: "the module is not running",
    });
    expect(viewOf(stale)).toMatchObject({
      status: "stale",
      version: 3,
      reason: "the module is not running",
    });
    expect(viewOf(read(stale, 4))).toMatchObject({ status: "live", version: 4 });
    expect(
      viewOf(readFailed(initialWorkflows(), { tag: "failed", kind: "unknown", reason: "lost" })),
    ).toMatchObject({ status: "unavailable", kind: "unknown" });
    expect(
      viewOf(readFailed(initialWorkflows(), { tag: "failed", kind: "unavailable", reason: "x" })),
    ).toMatchObject({ status: "unavailable", kind: "unavailable" });
  });

  it("a refusal shows no runs at all, not the last list", () => {
    const refused = readFailed(read(initialWorkflows(), 3), {
      tag: "failed",
      kind: "refused",
      reason: "revoked",
      code: "WORKFLOWS_DEVICE_REVOKED",
    });
    expect(viewOf(refused)).toEqual({
      status: "refused",
      code: "WORKFLOWS_DEVICE_REVOKED",
      reason: "revoked",
    });
  });

  it("unreadable records are carried, so a list is not claimed complete", () => {
    const state = readArrived(initialWorkflows(), okRead([], 2, 3) as never);
    expect(viewOf(state)).toMatchObject({ status: "live", runs: [], unreadable: 3 });
  });

  it("Cancel is offered only on a live list, for a running run with no cancel asked for", () => {
    const live = viewOf(read(initialWorkflows(), 3));
    expect(cancelOffered(live, run())).toBe(true);
    expect(cancelOffered(live, run({ cancelRequested: true }))).toBe(false);
    for (const state of ["completed", "failed", "cancelled", "lost"] as const) {
      expect(cancelOffered(live, run({ state }))).toBe(false);
    }
    const stale = viewOf(
      readFailed(read(initialWorkflows(), 3), { tag: "failed", kind: "unknown", reason: "x" }),
    );
    expect(cancelOffered(stale, run())).toBe(false);
    expect(cancelOffered(viewOf(initialWorkflows()), run())).toBe(false);
  });

  it("a cancel shows only when the run ended or its cancel is recorded", () => {
    expect(cancelShows(undefined)).toBe(false);
    expect(cancelShows(run())).toBe(false);
    expect(cancelShows(run({ cancelRequested: true }))).toBe(true);
    expect(cancelShows(run({ state: "cancelled" }))).toBe(true);
    expect(cancelShows(run({ state: "completed" }))).toBe(true);
  });
});

describe("each run state has its own words", () => {
  it("tells the six apart, and cancel requested is not cancelled", () => {
    const heads = [
      run(),
      run({ cancelRequested: true }),
      run({ state: "completed" }),
      run({ state: "failed", cause: "a member failed" }),
      run({ state: "cancelled" }),
      run({ state: "lost" }),
    ].map((r) => runFacts(r));
    expect(heads.map((f) => f.headline)).toEqual([
      "running",
      "cancel-requested",
      "completed",
      "failed",
      "cancelled",
      "lost",
    ]);
    expect(new Set(heads.map((f) => f.headlineText)).size).toBe(6);
    expect(heads[1]?.headlineText).not.toMatch(/^Cancelled/);
    expect(heads[3]?.lines.join(" ")).toContain("How it ended: a member failed");
  });

  it("members are named by state and an empty run says so", () => {
    expect(memberLine(run())).toBe("Members: 2 started, 1 completed (3 started in all).");
    expect(memberLine(run({ members: NONE, agentsStarted: 0 }))).toBe("No members recorded.");
  });
});

type Script = {
  readonly cancel?: TransportResult | (() => Promise<TransportResult>);
  readonly read?: RunsRead | (() => Promise<RunsRead>);
};
const SEEN = run({ cancelRequested: true });

function setup(script: Script) {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const resolve = async <T>(value: T | (() => Promise<T>)): Promise<T> =>
    typeof value === "function" ? (value as () => Promise<T>)() : value;
  const transport: WorkflowsTransport = {
    runs: vi.fn(async () => LOST),
    cancel: vi.fn(async (_env, root, runId) => {
      calls.push({ method: "cancel", payload: { root, runId } });
      return resolve(script.cancel ?? ok({ run: SEEN }));
    }),
  };
  const readRuns = vi.fn(async () => resolve(script.read ?? okRead([SEEN], 9)));
  let ids = 0;
  const cancel = createCancel({
    transport,
    environmentId: ENV,
    rootSessionId: ROOT,
    newRequestId: () => `req-${++ids}`,
    readRuns,
  });
  return { transport, calls, readRuns, cancel };
}

const sentReport = (report: CancelReport) => {
  if (!report.sent) throw new Error("nothing was sent");
  return report;
};

describe("one-click Cancel", () => {
  let hide = () => {};
  afterEach(() => hide());

  it("sends one cancel for exactly the run the person saw, then reads back before saying so", async () => {
    const h = setup({});
    const report = sentReport(await h.cancel(run()));
    expect(h.calls).toEqual([{ method: "cancel", payload: { root: ROOT, runId: "run-1" } }]);
    expect(report.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    // Exactly one read, and it is the confirming one.
    expect(h.readRuns).toHaveBeenCalledTimes(1);
    expect(cancelNotice(report)?.tone).toBe("ok");
  });

  it("success needs a read-back: a run not yet showing the cancel, or a read that failed, is unknown", async () => {
    const behind = setup({ read: okRead([run()], 9) });
    const notYet = sentReport(await behind.cancel(run()));
    expect(notYet.outcome).toMatchObject({ kind: "unknown" });
    expect(cancelNotice(notYet)?.text.startsWith("Cancel asked for")).toBe(false);
    const gone = setup({ read: okRead([], 9) });
    expect(sentReport(await gone.cancel(run())).outcome).toMatchObject({ kind: "unknown" });
    const broken = setup({ read: { tag: "failed", kind: "unavailable", reason: "down" } });
    expect(sentReport(await broken.cancel(run())).outcome).toMatchObject({ kind: "unknown" });
    for (const h of [behind, gone, broken]) {
      expect(h.transport.cancel).toHaveBeenCalledTimes(1);
    }
  });

  it("a run that already ended in the read-back also shows the cancel was seen", async () => {
    const h = setup({ read: okRead([run({ state: "cancelled" })], 9) });
    expect(sentReport(await h.cancel(run())).outcome).toMatchObject({ kind: "confirmed" });
  });

  it.each([
    ["a lost reply", LOST],
    ["WORKFLOWS_OUTCOME_UNKNOWN", fail("WORKFLOWS_OUTCOME_UNKNOWN", { detail: "not finished" })],
    ["a reply that does not decode", ok({ run: { runId: "run-1" } })],
    ["a non-reply", reply("???")],
  ] as const)(
    "%s is unknown, the runs are read again, and nothing is sent again",
    async (_n, r) => {
      const h = setup({ cancel: r });
      const report = sentReport(await h.cancel(run()));
      expect(report.outcome).toMatchObject({ kind: "unknown" });
      expect(h.transport.cancel).toHaveBeenCalledTimes(1);
      expect(h.readRuns).toHaveBeenCalledTimes(1);
      const text = cancelNotice(report)?.text ?? "";
      expect(text).toMatch(/not sent again/);
      expect(text.startsWith("Cancel asked for")).toBe(false);
    },
  );

  it("a send that throws is a lost reply, never a refusal and never repeated", async () => {
    const h = setup({
      cancel: () => {
        throw new Error("socket closed");
      },
    });
    const report = sentReport(await h.cancel(run()));
    expect(report.outcome).toMatchObject({ kind: "unknown" });
    expect(h.transport.cancel).toHaveBeenCalledTimes(1);
    expect(h.readRuns).toHaveBeenCalledTimes(1);
  });

  it("a refusal and an unavailable Backend are told apart, and neither is success", async () => {
    const refused = sentReport(
      await setup({ cancel: fail("WORKFLOWS_NOT_FOUND", { detail: "not available" }) }).cancel(
        run(),
      ),
    );
    expect(refused.outcome).toEqual({
      kind: "refused",
      code: "WORKFLOWS_NOT_FOUND",
      message: "not available",
    });
    expect(cancelNotice(refused)?.tone).toBe("error");
    const down = sentReport(
      await setup({ cancel: fail("WORKFLOWS_UNAVAILABLE", { detail: "module off" }) }).cancel(
        run(),
      ),
    );
    expect(down.outcome).toEqual({ kind: "unavailable", reason: "module off" });
    expect(cancelNotice(down)?.text).toContain("did nothing");
  });

  it("a second click on the same run while its cancel is in flight sends nothing; another run is independent", async () => {
    const releases: Array<(value: TransportResult) => void> = [];
    const h = setup({ cancel: () => new Promise<TransportResult>((r) => releases.push(r)) });
    const first = h.cancel(run());
    expect(await h.cancel(run())).toEqual({ sent: false });
    const other = h.cancel(run({ runId: "run-2", name: "other" }));
    for (const release of releases) release(ok({ run: SEEN }));
    expect((await first).sent).toBe(true);
    await other;
    expect(h.calls.map((c) => (c.payload as { runId: string }).runId)).toEqual(["run-1", "run-2"]);
  });

  it("is sent only while the connection allows actions, and a blocked Cancel sends and reads nothing", async () => {
    hide = showConnection(notConnectedView);
    const h = setup({});
    const report = sentReport(await h.cancel(run()));
    expect(report.outcome).toMatchObject({ kind: "unavailable" });
    expect(h.calls).toEqual([]);
    expect(h.readRuns).not.toHaveBeenCalled();
    hide = showConnection(connectedView);
    // The blocked one is not queued: nothing goes out until the person clicks again.
    expect(h.calls).toEqual([]);
  });

  it("every outcome has a sentence, and only a read-back success says it was asked for", async () => {
    const cases: ReadonlyArray<readonly [Script, boolean]> = [
      [{}, true],
      [{ cancel: LOST }, false],
      [{ cancel: fail("WORKFLOWS_OUTCOME_UNKNOWN") }, false],
      [{ cancel: fail("WORKFLOWS_UNAVAILABLE") }, false],
      [{ cancel: fail("WORKFLOWS_NOT_AUTHORIZED") }, false],
    ];
    for (const [script, success] of cases) {
      const notice = cancelNotice(await setup(script).cancel(run()));
      expect(notice).not.toBeNull();
      expect(notice?.text.startsWith("Cancel asked for")).toBe(success);
    }
    expect(cancelNotice({ sent: false })).toBeNull();
    expect(cancelNotice(undefined)).toBeNull();
  });
});
