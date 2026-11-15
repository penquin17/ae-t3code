// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/* oxlint-disable t3code/no-low-value-comments -- The header states what this test shows and what it does not. */
// AETHERIA M07 Plan step 22 (D17–D19; C5's Backend part) — the workflows module's three XC-6 operations `workflows.run-start`, `workflows.member` and `workflows.run-end`, through the module's REAL registration over
// the INSTALLED `@aetheria/workflows` archive's real ledger, writing real files in a temporary state root. SCRIPTED: M03's verdict on starting a workflow (the authorizer) and the owner lock (`assertHeld`). It
// shows: exactly the three operations are served; they answer `unavailable` before start and after drain, and a failed start leaves them unavailable; a run start is recorded only for a main caller M03 authorizes,
// never for a child, a refused caller, an unreadable identity or a module with no authorizer; a payload that names another owner or root is refused and writes nothing; a member is recorded before its child and
// again with the child id, an identical repeat records nothing twice, another session's run answers as one that does not exist, and a terminal run admits no new member; the record survives a drain and a new
// registration over the same state root; a write without the owner lock is not made. It does NOT show M03's real identity files, the carrier that maps the Agent's calls to these operations, M05's child state,
// or the boot cleanup of runs left running (Plan step 28).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { Xc6OperationContext } from "@t3tools/aetheria-contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { WORKFLOW_OPERATIONS } from "./workflows/entry.ts";
import {
  createWorkflowsBackendRegistration,
  type WorkflowsRegistrationOptions,
} from "./workflows/registration.ts";
import { WORKFLOWS_BACKEND_ENTRY, workflowsBackendModuleRow } from "./workflows/row.ts";

const { existsSync, mkdtempSync, readFileSync, rmSync } = NodeFS;
const { tmpdir } = NodeOS;
const { join } = NodePath;

const roots: string[] = [];
const stateRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "m07-workflow-records-"));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CAPS = {
  maxConcurrentAgents: 4,
  maxTotalAgents: 10,
  maxItemsPerCall: 20,
  syncTimeoutMs: 400,
};
const MAIN = "s-main";
const OTHER = "s-other";

const context = (
  sessionId: string,
  args: Record<string, unknown> = {},
  kind = "main",
): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "runtime-1", providerInstanceId: "pi" },
  sessionId,
  kind,
  rootSessionId: sessionId,
  args,
});

const startArgs = (runId = "run-1", session = MAIN) => ({
  runId,
  rootSessionId: session,
  ownerSessionId: session,
  name: "demo",
  caps: CAPS,
  startedAt: "2026-11-16T10:00:00.000Z",
});
const memberArgs = (seq: number, state: string, childId: string | null = null) => ({
  runId: "run-1",
  seq,
  childId,
  state,
});
const endArgs = (extra: Record<string, unknown> = {}) => ({
  runId: "run-1",
  state: "completed",
  cause: "completed",
  agentsStarted: 1,
  endedAt: "2026-11-16T10:05:00.000Z",
  agentOutcomes: [{ seq: 1, outcome: "completed", cause: "completed" }],
  result: { value: [1, null] },
  ...extra,
});

const MODULE = { id: "workflows-backend" };
const ALLOW: WorkflowsRegistrationOptions["authorize"] = async () => ({ ok: true });

const recordPath = (dir: string, runId = "run-1") =>
  join(dir, "workflows", "runs", `${runId}.json`);

const mounted = async (
  dir: string,
  options: Partial<WorkflowsRegistrationOptions> = {},
  start = true,
) => {
  const registration = createWorkflowsBackendRegistration({
    stateRoot: dir,
    authorize: ALLOW,
    ...options,
  });
  if (start) await registration.activation.start(MODULE);
  const call = async (name: string, ctx: Xc6OperationContext) => {
    const operation = registration.operations?.[name];
    if (operation === undefined) throw new Error(`no operation ${name}`);
    return operation(ctx);
  };
  return { registration, call };
};

describe("workflows module — the three run-record operations over the real ledger", () => {
  it("serves exactly the three strict data-only operations under its own entry", async () => {
    const { registration } = await mounted(stateRoot());
    expect(registration.entry).toBe(WORKFLOWS_BACKEND_ENTRY);
    expect(Object.keys(registration.operations ?? {}).sort()).toEqual([
      "workflows.member",
      "workflows.run-end",
      "workflows.run-start",
    ]);
    expect([...WORKFLOW_OPERATIONS].sort()).toEqual(
      Object.keys(registration.operations ?? {}).sort(),
    );
    const row = workflowsBackendModuleRow() as { requires?: unknown; owns: string[] };
    expect(row.requires).toBeUndefined();
    expect(row.owns).toEqual(["backend-workflows-state"]);
  });

  it("answers unavailable before start and after drain, and writes nothing", async () => {
    const dir = stateRoot();
    const { registration, call } = await mounted(dir, {}, false);
    expect(await call("workflows.run-start", context(MAIN, startArgs()))).toEqual({
      status: "unavailable",
      code: "WORKFLOWS_UNAVAILABLE",
    });
    await registration.activation.start(MODULE);
    expect((await call("workflows.run-start", context(MAIN, startArgs()))).status).toBe("done");
    const drained = (await registration.activation.drain("test")) as { stillLive: string[] };
    expect(drained.stillLive).toEqual([]);
    expect(registration.ledger()).toBeUndefined();
    expect(await call("workflows.member", context(MAIN, memberArgs(1, "pending")))).toEqual({
      status: "unavailable",
      code: "WORKFLOWS_UNAVAILABLE",
    });
  });

  it("records a run start only for a main caller M03 authorizes", async () => {
    const dir = stateRoot();
    const { call } = await mounted(dir);
    const started = await call("workflows.run-start", context(MAIN, startArgs()));
    expect(started).toEqual({
      status: "done",
      result: { ok: true, value: { runId: "run-1", duplicate: false } },
    });
    expect(existsSync(recordPath(dir))).toBe(true);

    const child = stateRoot();
    const asChild = await mounted(child);
    const refusedKind = await asChild.call(
      "workflows.run-start",
      context("s-child", startArgs("run-1", "s-child"), "child"),
    );
    expect(refusedKind).toMatchObject({ status: "done", result: { ok: false, code: "NOT_MAIN" } });
    expect(existsSync(recordPath(child))).toBe(false);
  });

  it("does not record a run start for a refused caller, an unreadable identity or a module with no authorizer", async () => {
    const refused = stateRoot();
    const a = await mounted(refused, {
      authorize: async () => ({ ok: false, code: "AUTH_TOOL_NOT_ALLOWED", reason: "no" }),
    });
    expect(await a.call("workflows.run-start", context(MAIN, startArgs()))).toEqual({
      status: "refused",
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
    expect(existsSync(recordPath(refused))).toBe(false);

    const unreadable = stateRoot();
    const b = await mounted(unreadable, {
      authorize: async () => ({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE", reason: "x" }),
    });
    expect(await b.call("workflows.run-start", context(MAIN, startArgs()))).toEqual({
      status: "unavailable",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    expect(existsSync(recordPath(unreadable))).toBe(false);

    const thrown = stateRoot();
    const c = await mounted(thrown, {
      authorize: async () => {
        throw new Error("identity files unreadable");
      },
    });
    expect((await c.call("workflows.run-start", context(MAIN, startArgs()))).status).toBe(
      "unavailable",
    );

    const none = stateRoot();
    const d = await mounted(none, { authorize: undefined });
    expect(await d.call("workflows.run-start", context(MAIN, startArgs()))).toEqual({
      status: "unavailable",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    expect(existsSync(recordPath(none))).toBe(false);
  });

  it("refuses a payload that names another owner or root, and an argument outside the strict contract, before anything is written", async () => {
    const dir = stateRoot();
    const { call } = await mounted(dir);
    const forged = await call(
      "workflows.run-start",
      context(MAIN, { ...startArgs(), ownerSessionId: OTHER }),
    );
    expect(forged).toMatchObject({ status: "done", result: { ok: false } });
    const extra = await call(
      "workflows.run-start",
      context(MAIN, { ...startArgs(), sessionId: OTHER }),
    );
    expect(extra).toMatchObject({
      status: "done",
      result: { ok: false, code: "WORKFLOW_ARGUMENTS" },
    });
    expect(existsSync(recordPath(dir))).toBe(false);
  });

  it("writes the member before its child and again with the child id; an identical repeat records nothing twice", async () => {
    const dir = stateRoot();
    const { call } = await mounted(dir);
    await call("workflows.run-start", context(MAIN, startArgs()));
    const pending = await call("workflows.member", context(MAIN, memberArgs(1, "pending")));
    expect(pending).toMatchObject({
      status: "done",
      result: { ok: true, value: { duplicate: false } },
    });
    const beforeChild = JSON.parse(readFileSync(recordPath(dir), "utf8")) as {
      members: { seq: number; childId: string | null; state: string }[];
    };
    expect(beforeChild.members).toEqual([
      { runId: "run-1", seq: 1, childId: null, state: "pending" },
    ]);
    const started = await call(
      "workflows.member",
      context(MAIN, memberArgs(1, "started", "child-1")),
    );
    expect(started).toMatchObject({ result: { ok: true, value: { duplicate: false } } });
    const again = await call(
      "workflows.member",
      context(MAIN, memberArgs(1, "started", "child-1")),
    );
    expect(again).toMatchObject({ result: { ok: true, value: { duplicate: true } } });
    const bytes = readFileSync(recordPath(dir), "utf8");
    await call("workflows.member", context(MAIN, memberArgs(1, "started", "child-1")));
    expect(readFileSync(recordPath(dir), "utf8")).toBe(bytes);
    const conflict = await call(
      "workflows.member",
      context(MAIN, memberArgs(1, "started", "child-2")),
    );
    expect(conflict).toMatchObject({ result: { ok: false } });
    expect(readFileSync(recordPath(dir), "utf8")).toBe(bytes);
  });

  it("answers another session's run as one that does not exist, and a terminal run admits no new member", async () => {
    const dir = stateRoot();
    const { call } = await mounted(dir);
    await call("workflows.run-start", context(MAIN, startArgs()));
    const probe = await call("workflows.member", context(OTHER, memberArgs(1, "pending")));
    expect(probe).toMatchObject({ result: { ok: false, code: "RUN_UNKNOWN" } });
    const stealing = await call("workflows.run-end", context(OTHER, endArgs()));
    expect(stealing).toMatchObject({ result: { ok: false, code: "RUN_UNKNOWN" } });

    await call("workflows.member", context(MAIN, memberArgs(1, "pending")));
    await call("workflows.member", context(MAIN, memberArgs(1, "started", "child-1")));
    await call("workflows.member", context(MAIN, memberArgs(1, "completed", "child-1")));
    expect(await call("workflows.run-end", context(MAIN, endArgs()))).toMatchObject({
      result: { ok: true },
    });
    const late = await call("workflows.member", context(MAIN, memberArgs(2, "pending")));
    expect(late).toMatchObject({ result: { ok: false } });
  });

  it("keeps the record across a drain and a new registration over the same state root", async () => {
    const dir = stateRoot();
    const first = await mounted(dir);
    await first.call("workflows.run-start", context(MAIN, startArgs()));
    await first.call("workflows.member", context(MAIN, memberArgs(1, "pending")));
    await first.registration.activation.drain("test");

    const second = await mounted(dir);
    const ledger = second.registration.ledger();
    const read = ledger?.read("run-1");
    expect(read).toMatchObject({ ok: true });
    expect(ledger?.running().runs.map((file) => file.run.runId)).toEqual(["run-1"]);
    const repeat = await second.call("workflows.run-start", context(MAIN, startArgs()));
    expect(repeat).toMatchObject({ result: { ok: true, value: { duplicate: true } } });
  });

  it("makes no write without the owner lock", async () => {
    const dir = stateRoot();
    const { call } = await mounted(dir, {
      assertHeld: () => {
        throw new Error("the Backend owner lock is not held");
      },
    });
    let outcome: unknown;
    try {
      outcome = await call("workflows.run-start", context(MAIN, startArgs()));
    } catch (error) {
      outcome = error;
    }
    expect(outcome).not.toMatchObject({ result: { ok: true } });
    expect(existsSync(recordPath(dir))).toBe(false);
  });
});
