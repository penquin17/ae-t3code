// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/* oxlint-disable t3code/no-low-value-comments -- The header states what this test shows and what it does not. */
// AETHERIA M07 Plan steps 26, 28 and 29 (D18, D19; C5's Backend part) — the Backend's drain and restart of the workflows module, through its REAL registration over the INSTALLED `@aetheria/workflows`
// archive's real ledger and run service, writing real files in a temporary state root, and the module's REAL run ports (`createWorkflowRunsPorts`) over a SCRIPTED M05 direct API (the jobs and children
// it lists, kills and closes, each call recorded). SCRIPTED: M05 itself, M03's authorizer and the owner lock. It shows: a second cancel of one run joins the first (one piece of work, one kill, one
// close per child); the drain joins a cancel still in flight, says how many it joined, and only then lets the ledger go — after it every call answers unavailable and nothing is accepted; while it waits
// (F1 of the round-2 review) a run start and a new member are refused as `WORKFLOWS_DRAINING` but the Agent's `workflows.run-end` and an existing member's settlement still reach the ledger, so a controller
// that answers the cancel with its terminal record lets the drain report the run `stopped` with nothing `stillLive`; a run whose Agent never answers but whose kill and closes were all confirmed is
// ALSO `stopped` (`stillLive` names a live owned resource, not a stale record; its record stays `running` and a `run-end` after the drain is unavailable), while a kill that is not confirmed or a close that
// fails keeps it `stillLive`; the drain itself never writes a terminal fact (the Backend owns no process of the run), and the next start marks an unanswered run `lost` ONCE and closes
// its children, a pending member found by its label included and one that never started closed as such; a close that fails at that start is a recorded debt that the NEXT start retries; a cancel
// for a run of another root (or one that does not exist) is `RUN_UNKNOWN` — which the client RPC answers as NOT_FOUND — marks nothing and stops nothing; a root with no bound thread leaves its job and
// children unresolved, never "none". It does NOT show the client RPC handlers or their scopes (a read-only connection cannot cancel: apps/server `m07GoalsRpc.aetheria.test.ts`, which imports
// from this package — this package cannot import it back), M05's real kill and close (tests/goals-workflows/workflows/real-child.test.mjs), the Agent's terminal record, or a native restart.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { OrchestrationDirectApi } from "./orchestration.ts";
import { createWorkflowsBackendRegistration } from "./workflows/registration.ts";
import { createWorkflowRunsPorts } from "./workflows/ports.ts";

const { mkdtempSync, rmSync } = NodeFS;
const { tmpdir } = NodeOS;
const { join } = NodePath;

const roots: string[] = [];
const stateRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "m07-drain-"));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The run's state as the file in the state root holds it, read after the module's ledger is gone. */
const recordState = (dir: string, runId: string): unknown =>
  (
    JSON.parse(NodeFS.readFileSync(join(dir, "workflows", "runs", `${runId}.json`), "utf8")) as {
      run: { state: unknown };
    }
  ).run.state;

const MAIN = "s-main";
const OTHER = "s-other";
const MODULE = { id: "workflows-backend" };
const NOW = "2026-11-16T10:00:02.000Z";
const CAPS = {
  maxConcurrentAgents: 4,
  maxTotalAgents: 10,
  maxItemsPerCall: 20,
  syncTimeoutMs: 400,
};

const context = (sessionId: string, args: Record<string, unknown>): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "runtime-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});
// The cancel under test is held by a gate the test owns, so draining the microtask queue is enough to let everything that can proceed do so; no clock is involved.
const tick = async () => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
};

interface World {
  /** M05's job rows as its direct list shows them: a flag appears only when true (M05 omits a false one). */
  jobs: {
    jobId: string;
    label: string;
    state: string;
    terminationUnconfirmed?: true;
    livenessIndeterminate?: true;
  }[];
  /** Kill answers M05 gives in turn: each one is also written into the job's record, so the next list shows it (a stateful M05). Empty: the kill answers `killed`. */
  killScript: Record<string, unknown>[];
  children: { childId: string; label?: string }[];
  calls: { op: string; id: string }[];
  /** A close the test makes fail (by child id), and gates it can hold shut. */
  failClose: Set<string>;
  /** A kill M05 does not confirm (it answers a failure code). */
  failKill: boolean;
  killGate: Promise<void> | undefined;
  /** Called when M05 is asked to kill the run's job: the test's stand-in for the Agent controller noticing the cancel. */
  onKill: (() => void) | undefined;
  threads: Map<string, string>;
}

const world = (): World => ({
  jobs: [{ jobId: "job-1", label: "# workflow run-1 demo", state: "running" }],
  killScript: [],
  children: [],
  calls: [],
  failClose: new Set(),
  failKill: false,
  killGate: undefined,
  onKill: undefined,
  threads: new Map([[MAIN, "thread-main"]]),
});

/** M05's direct API as the run ports call it: the user's acts, scripted. */
const scriptedDirect = (w: World): OrchestrationDirectApi =>
  ({
    listJobs: async () => ({ ok: true, value: { jobs: w.jobs, unreadable: 0 } }),
    killJob: async (input: { args: { jobId: string } }) => {
      w.calls.push({ op: "kill", id: input.args.jobId });
      w.onKill?.();
      if (w.killGate !== undefined) await w.killGate;
      if (w.failKill) return { ok: false, code: "JOB_KILL_UNCONFIRMED" };
      const scripted = w.killScript.shift();
      if (scripted === undefined) return { ok: true, value: { state: "killed" } };
      const job = w.jobs.find((row) => row.jobId === input.args.jobId);
      if (job !== undefined) {
        delete job.terminationUnconfirmed;
        delete job.livenessIndeterminate;
        Object.assign(job, scripted);
      }
      return { ok: true, value: { ...scripted } };
    },
    listChildren: async () => ({ ok: true, value: { rows: w.children, diagnostics: [] } }),
    closeChild: async (input: { args: { target: string } }) => {
      w.calls.push({ op: "close", id: input.args.target });
      return w.failClose.has(input.args.target)
        ? { ok: false, code: "CHILD_CLOSE_UNCONFIRMED" }
        : { ok: true, value: { closed: true, killedJobs: [] } };
    },
  }) as unknown as OrchestrationDirectApi;

const mounted = async (
  dir: string,
  w: World,
  start = true,
  authorize: () => Promise<{ ok: true }> = async () => ({ ok: true }),
) => {
  const registration = createWorkflowsBackendRegistration({
    stateRoot: dir,
    drainBoundMs: 100,
    drainPollMs: 1,
    authorize,
    ports: createWorkflowRunsPorts({
      direct: () => scriptedDirect(w),
      threadOfSession: (sessionId) => w.threads.get(sessionId),
    }),
    now: () => NOW,
  });
  if (start) await registration.activation.start(MODULE);
  const call = async (name: string, ctx: Xc6OperationContext) => {
    const operation = registration.operations?.[name];
    if (operation === undefined) throw new Error(`no operation ${name}`);
    return operation(ctx);
  };
  const runs = () => {
    const service = registration.runs();
    if (service === undefined) throw new Error("the run service is not running");
    return service;
  };
  const members = (runId = "run-1") => {
    const read = registration.ledger()?.read(runId);
    return read?.ok === true && read.value !== null ? read.value.members : [];
  };
  const run = (runId = "run-1") => {
    const read = registration.ledger()?.read(runId);
    return read?.ok === true && read.value !== null ? read.value.run : undefined;
  };
  return { registration, call, runs, members, run };
};

/** A run the controller has started: run-1 for MAIN with child-1 started, a second member pending whose child id was never written, and a third pending one. */
const seedRun = async (m: Awaited<ReturnType<typeof mounted>>, seqs: number[] = [1]) => {
  await m.call(
    "workflows.run-start",
    context(MAIN, {
      runId: "run-1",
      rootSessionId: MAIN,
      ownerSessionId: MAIN,
      name: "demo",
      caps: CAPS,
      startedAt: "2026-11-16T10:00:00.000Z",
    }),
  );
  for (const seq of seqs) {
    await m.call(
      "workflows.member",
      context(MAIN, { runId: "run-1", seq, childId: null, state: "pending" }),
    );
    if (seq === 1)
      await m.call(
        "workflows.member",
        context(MAIN, { runId: "run-1", seq, childId: "child-1", state: "started" }),
      );
  }
};

const runEndArgs = (runId = "run-1") => ({
  runId,
  state: "cancelled",
  cause: "cancelled",
  agentsStarted: 1,
  endedAt: "2026-11-16T10:00:03.000Z",
  agentOutcomes: [],
});
const startArgs = (runId: string) => ({
  runId,
  rootSessionId: MAIN,
  ownerSessionId: MAIN,
  name: "demo",
  caps: CAPS,
  startedAt: "2026-11-16T10:00:00.000Z",
});

describe("the drain waits for the Agent's terminal record, so run-end stays open while it waits (review round 2, F1)", () => {
  it("a controller that answers the cancel with run-end during the drain: the run is stopped, nothing stillLive; a new run and a new member are refused meanwhile", async () => {
    const dir = stateRoot();
    const w = world();
    let release: () => void = () => {};
    w.killGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const m = await mounted(dir, w);
    await seedRun(m);
    // The Agent's controller, noticing the kill, publishes its terminal record through the same operation the carrier would call.
    // It answers only once the test lets it, after the refusals below were observed mid-drain.
    let answer: () => void = () => {};
    const answering = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let controller: Promise<unknown> = Promise.resolve();
    w.onKill = () => {
      controller = answering.then(() => m.call("workflows.run-end", context(MAIN, runEndArgs())));
    };

    const draining = m.registration.activation.drain("test") as Promise<{
      stillLive: string[];
      stopped: string[];
    }>;
    await tick();
    expect(w.calls, "the drain asked M05 to stop the run").toEqual([{ op: "kill", id: "job-1" }]);
    expect(
      await m.call("workflows.run-start", context(MAIN, startArgs("run-2"))),
      "a new run is not started while draining",
    ).toEqual({ status: "unavailable", code: "WORKFLOWS_DRAINING" });
    expect(m.run("run-2"), "and nothing was recorded for it").toBeUndefined();
    expect(
      await m.call(
        "workflows.member",
        context(MAIN, { runId: "run-1", seq: 7, childId: null, state: "pending" }),
      ),
      "a new member is not admitted while draining",
    ).toEqual({ status: "unavailable", code: "WORKFLOWS_DRAINING" });
    expect(m.members().map((member) => member.seq)).toEqual([1]);
    expect(
      await m.call(
        "workflows.member",
        context(MAIN, { runId: "run-1", seq: 1, childId: "child-1", state: "cancelled" }),
      ),
      "the settlement of a member the ledger already holds still reaches it",
    ).toMatchObject({ status: "done", result: { ok: true } });

    answer();
    release();
    const report = await draining;
    expect(await controller).toMatchObject({ status: "done", result: { ok: true } });
    expect(report.stillLive).toEqual([]);
    expect(report.stopped).toContain("backend-workflows.run:run-1");
    expect(m.registration.ledger()).toBeUndefined();

    const next = await mounted(dir, w);
    expect(next.run()).toMatchObject({ state: "cancelled", cause: "cancelled" });
    expect(next.registration.reconcileReport()).toMatchObject({ lost: [], unresolved: [] });
  });

  it("a silent Agent whose kill and closes were all confirmed is stopped, not stillLive: its record stays running, run-end after the drain is unavailable, and the restart marks it lost once", async () => {
    const dir = stateRoot();
    const w = world();
    const m = await mounted(dir, w);
    await seedRun(m);
    const report = (await m.registration.activation.drain("test")) as {
      stillLive: string[];
      stopped: string[];
    };
    expect(report.stillLive).toEqual([]);
    expect(report.stopped).toContain("backend-workflows.run:run-1");
    expect(w.calls).toEqual([
      { op: "kill", id: "job-1" },
      { op: "close", id: "child-1" },
    ]);
    expect(await m.call("workflows.run-end", context(MAIN, runEndArgs()))).toEqual({
      status: "unavailable",
      code: "WORKFLOWS_UNAVAILABLE",
    });
    expect(
      await m.call("workflows.run-start", context(MAIN, startArgs("run-3"))),
      "and nothing is started after the drain either",
    ).toEqual({ status: "unavailable", code: "WORKFLOWS_UNAVAILABLE" });
    expect(
      recordState(dir, "run-1"),
      "the drain wrote no terminal fact: the record is still running",
    ).toBe("running");
    const restarted = await mounted(dir, w);
    expect(restarted.run()?.state, "the unanswered run is marked lost at restart").toBe("lost");
    expect(restarted.registration.reconcileReport()).toMatchObject({
      lost: ["run-1"],
      unresolved: [],
    });
    expect(
      w.calls.filter((c) => c.op === "kill"),
      "the restart touches no job",
    ).toHaveLength(1);
  });

  it("a kill M05 does not confirm keeps the run stillLive with its id; the restart still marks it lost", async () => {
    const dir = stateRoot();
    const w = world();
    w.failKill = true;
    const m = await mounted(dir, w);
    await seedRun(m);
    const report = (await m.registration.activation.drain("test")) as {
      stillLive: string[];
      stopped: string[];
    };
    expect(report.stillLive).toEqual(["workflow-run:run-1"]);
    expect(report.stopped).not.toContain("backend-workflows.run:run-1");
    expect(recordState(dir, "run-1")).toBe("running");
    expect((await mounted(dir, w)).run()?.state).toBe("lost");
  });

  it("a close that fails keeps the run stillLive with its id, and the failed close is recorded for the restart to retry", async () => {
    const dir = stateRoot();
    const w = world();
    w.failClose.add("child-1");
    const m = await mounted(dir, w);
    await seedRun(m);
    const report = (await m.registration.activation.drain("test")) as {
      stillLive: string[];
      stopped: string[];
    };
    expect(report.stillLive).toEqual(["workflow-run:run-1"]);
    expect(report.stopped).not.toContain("backend-workflows.run:run-1");
    const restarted = await mounted(dir, w);
    expect(restarted.run()?.state).toBe("lost");
    expect(restarted.members()[0]).toMatchObject({ state: "failed", cause: "close-failed" });
  });

  it("a run start whose authorizer answers after the drain began is not recorded", async () => {
    const dir = stateRoot();
    const w = world();
    let verdict: () => void = () => {};
    let gate: Promise<void> | undefined;
    let release: () => void = () => {};
    w.killGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const m = await mounted(dir, w, true, async () => {
      await gate;
      return { ok: true };
    });
    await seedRun(m);
    gate = new Promise<void>((resolve) => {
      verdict = resolve;
    });
    const starting = m.call("workflows.run-start", context(MAIN, startArgs("run-4")));
    await tick();
    const draining = m.registration.activation.drain("test");
    await tick();
    expect(w.calls, "the drain is still waiting on M05").toEqual([{ op: "kill", id: "job-1" }]);
    verdict();
    expect(await starting).toEqual({ status: "unavailable", code: "WORKFLOWS_DRAINING" });
    release();
    await draining;
    expect((await mounted(dir, w)).run("run-4"), "nothing was written for it").toBeUndefined();
  });
});

describe("the Backend's drain and restart of the workflows module", () => {
  it("a second cancel of one run joins the first: one kill, one close; the drain joins it too, reports it, and only then do calls become unavailable", async () => {
    const dir = stateRoot();
    const w = world();
    let release: () => void = () => {};
    w.killGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const m = await mounted(dir, w);
    await seedRun(m);
    const runs = m.runs();
    const first = runs.cancel(MAIN, "run-1");
    const second = runs.cancel(MAIN, "run-1");
    expect(second).toBe(first);
    await tick();

    let drained = false;
    const draining = (async () => {
      const report = (await m.registration.activation.drain("test")) as {
        stillLive: string[];
        stopped: string[];
      };
      drained = true;
      return report;
    })();
    await tick();
    expect(drained, "the drain waits for the cancel in flight").toBe(false);
    expect(
      await runs.cancel(MAIN, "run-1"),
      "once draining, a new cancel is refused, not joined",
    ).toMatchObject({ ok: false, code: "WORKFLOWS_UNAVAILABLE" });

    release();
    const answer = await first;
    expect(answer).toMatchObject({ ok: true, unresolved: [] });
    const report = await draining;
    expect(report.stopped).toContain("backend-workflows.ledger");
    expect(report.stopped).toContain("backend-workflows.cancels:1");
    expect(report.stillLive, "kill and close both completed: the run owns nothing live").toEqual(
      [],
    );
    expect(report.stopped).toContain("backend-workflows.run:run-1");
    expect(w.calls).toEqual([
      { op: "kill", id: "job-1" },
      { op: "close", id: "child-1" },
    ]);
    expect(m.registration.ledger()).toBeUndefined();
    expect(m.registration.runs()).toBeUndefined();
    expect(runs.list(MAIN)).toMatchObject({ ok: false, code: "WORKFLOWS_UNAVAILABLE" });
    expect(
      await m.call(
        "workflows.member",
        context(MAIN, { runId: "run-1", seq: 9, childId: null, state: "pending" }),
      ),
    ).toEqual({ status: "unavailable", code: "WORKFLOWS_UNAVAILABLE" });
  });

  it("a drain asks M05 to stop a live run and reports it stillLive while a pending member cannot be found (an unresolved cancel step); the next start marks it lost and closes remaining open children", async () => {
    const dir = stateRoot();
    const w = world();
    w.children = [
      { childId: "child-2", label: "wf:run-1:2" },
      { childId: "child-x", label: "other" },
    ];
    const first = await mounted(dir, w);
    await seedRun(first, [1, 2, 3]);
    const drained = (await first.registration.activation.drain("test")) as {
      stillLive: string[];
      released: string[];
    };
    expect(drained.stillLive).toEqual(["workflow-run:run-1"]);
    expect(w.calls.filter((call) => call.op === "kill")).toEqual([{ op: "kill", id: "job-1" }]);
    expect(
      w.calls
        .filter((call) => call.op === "close")
        .map((call) => call.id)
        .sort(),
    ).toEqual(["child-1", "child-2"]);

    const killsAtDrain = w.calls.filter((call) => call.op === "kill").length;
    const second = await mounted(dir, w);
    expect(second.run()?.state, "the drain wrote no terminal fact; the start marks it").toBe(
      "lost",
    );
    const report = second.registration.reconcileReport();
    expect(report).toMatchObject({ lost: ["run-1"], closed: 1, unresolved: [], unreadable: [] });
    expect(
      w.calls
        .filter((c) => c.op === "close")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["child-1", "child-2"]);
    expect(second.members().map((member) => [member.seq, member.state, member.cause])).toEqual([
      [1, "closed", "cancelled"],
      [2, "closed", "cancelled"],
      [3, "closed", "never-started"],
    ]);
    expect(w.calls.filter((c) => c.op === "kill")).toHaveLength(killsAtDrain);
    expect(second.runs().list(MAIN)).toMatchObject({
      ok: true,
      runs: [{ runId: "run-1", state: "lost" }],
    });

    await second.registration.activation.drain("test");
    const third = await mounted(dir, w);
    expect(third.registration.reconcileReport()).toMatchObject({
      lost: [],
      closed: 0,
      unresolved: [],
    });
    expect(w.calls.filter((c) => c.op === "close")).toHaveLength(2);
  });

  it("a close that fails at the restart is a recorded debt, never a clean claim, and the next start retries exactly that child", async () => {
    const dir = stateRoot();
    const w = world();
    w.failClose.add("child-1");
    const first = await mounted(dir, w);
    await seedRun(first);
    await first.registration.activation.drain("test");

    const second = await mounted(dir, w);
    const report = second.registration.reconcileReport();
    expect(report?.lost).toEqual(["run-1"]);
    expect(report?.unresolved.map((u) => [u.what, u.id, u.code])).toEqual([
      ["child", "child-1", "CHILD_CLOSE_UNCONFIRMED"],
    ]);
    expect(second.members()[0]).toMatchObject({ state: "failed", cause: "close-failed" });
    await second.registration.activation.drain("test");

    w.failClose.clear();
    w.calls.length = 0;
    const third = await mounted(dir, w);
    expect(third.registration.reconcileReport()).toMatchObject({
      lost: [],
      closed: 1,
      unresolved: [],
    });
    expect(w.calls).toEqual([{ op: "close", id: "child-1" }]);
    expect(third.members()[0]).toMatchObject({ state: "closed" });
  });

  it("a cancel for another root's run, or for a run that does not exist, is RUN_UNKNOWN: it marks nothing and kills and closes nothing", async () => {
    const dir = stateRoot();
    const w = world();
    w.threads.set(OTHER, "thread-other");
    const m = await mounted(dir, w);
    await seedRun(m);
    const runs = m.runs();
    expect(await runs.cancel(OTHER, "run-1")).toEqual({ ok: false, code: "RUN_UNKNOWN" });
    expect(await runs.cancel(MAIN, "run-nope")).toEqual({ ok: false, code: "RUN_UNKNOWN" });
    expect(
      m.run()?.cancelRequestedAt,
      "a foreign cancel does not even mark the run",
    ).toBeUndefined();
    expect(w.calls).toEqual([]);
    expect(runs.list(OTHER)).toMatchObject({ ok: true, runs: [] });
    expect(runs.list(MAIN)).toMatchObject({
      ok: true,
      runs: [{ runId: "run-1", state: "running" }],
    });
    const own = await runs.cancel(MAIN, "run-1");
    expect(own).toMatchObject({
      ok: true,
      run: { runId: "run-1", state: "running", cancelRequested: true },
    });
  });

  it("a root with no bound thread cannot be listed or stopped: its job and children stay unresolved, never read as none", async () => {
    const dir = stateRoot();
    const w = world();
    w.threads.clear();
    const m = await mounted(dir, w);
    await seedRun(m);
    const answer = await m.runs().cancel(MAIN, "run-1");
    expect(answer).toMatchObject({ ok: true });
    if (!answer.ok) throw new Error("unreachable");
    expect(answer.unresolved.map((u) => [u.what, u.code]).sort()).toEqual([
      ["child", "ORCHESTRATION_UNAVAILABLE"],
      ["job", "ORCHESTRATION_UNAVAILABLE"],
    ]);
    expect(
      m.run()?.cancelRequestedAt,
      "the ask is recorded, so no new member is admitted",
    ).toBeDefined();
    expect(w.calls).toEqual([]);
  });
});

describe("a job M05 holds lost without proof that its group is empty (review round 4, F1): the real ports carry M05's flags, the real run service keeps it unresolved", () => {
  const UNCONFIRMED = { state: "lost", terminationUnconfirmed: true };
  const kills = (w: World) => w.calls.filter((c) => c.op === "kill").length;

  it("cancel → the kill answers lost/unconfirmed → a repeat cancel lists that lost job → the drain: unresolved every time, the run stillLive, M05 asked to re-verify, no terminal record", async () => {
    const dir = stateRoot();
    const w = world();
    w.killScript.push(UNCONFIRMED, UNCONFIRMED, UNCONFIRMED);
    const m = await mounted(dir, w);
    await seedRun(m);
    const first = await m.runs().cancel(MAIN, "run-1");
    if (!first.ok) throw new Error("unreachable");
    expect(first.unresolved).toEqual([
      { what: "job", id: "job-1", code: "JOB_TERMINATION_UNCONFIRMED" },
    ]);
    expect(w.jobs[0]).toMatchObject({ state: "lost", terminationUnconfirmed: true });
    const repeat = await m.runs().cancel(MAIN, "run-1");
    if (!repeat.ok) throw new Error("unreachable");
    expect(repeat.unresolved, "the listed lost row is no longer ignored").toEqual([
      { what: "job", id: "job-1", code: "JOB_TERMINATION_UNCONFIRMED" },
    ]);
    const report = (await m.registration.activation.drain("test")) as {
      stillLive: string[];
      stopped: string[];
    };
    expect(report.stillLive).toEqual(["workflow-run:run-1"]);
    expect(report.stopped).not.toContain("backend-workflows.run:run-1");
    expect(kills(w), "two cancels and the drain each re-verified the job through M05's kill").toBe(
      3,
    );
    expect(recordState(dir, "run-1")).toBe("running");
  });

  it("a lost job whose group M05 proves empty (it omits both flags) is resolved: the cancel and the drain are clean, the proven job is not killed again, and the run is stopped", async () => {
    const dir = stateRoot();
    const w = world();
    w.killScript.push(UNCONFIRMED, { state: "lost" });
    const m = await mounted(dir, w);
    await seedRun(m);
    const first = await m.runs().cancel(MAIN, "run-1");
    if (!first.ok) throw new Error("unreachable");
    expect(first.unresolved.map((u) => u.code)).toEqual(["JOB_TERMINATION_UNCONFIRMED"]);
    const second = await m.runs().cancel(MAIN, "run-1");
    if (!second.ok) throw new Error("unreachable");
    expect(second.unresolved, "the re-verification proved the group empty").toEqual([]);
    expect(w.jobs[0]).toEqual({ jobId: "job-1", label: "# workflow run-1 demo", state: "lost" });
    const report = (await m.registration.activation.drain("test")) as {
      stillLive: string[];
      stopped: string[];
    };
    expect(report.stillLive).toEqual([]);
    expect(report.stopped).toContain("backend-workflows.run:run-1");
    expect(kills(w), "the listed lost/proven job is left alone").toBe(2);
  });

  it("a kill that answers lost with liveness indeterminate is not proof either", async () => {
    const w = world();
    w.killScript.push({ state: "lost", livenessIndeterminate: true });
    const m = await mounted(stateRoot(), w);
    await seedRun(m);
    const answer = await m.runs().cancel(MAIN, "run-1");
    if (!answer.ok) throw new Error("unreachable");
    expect(answer.unresolved.map((u) => u.code)).toEqual(["JOB_TERMINATION_UNCONFIRMED"]);
  });
});
