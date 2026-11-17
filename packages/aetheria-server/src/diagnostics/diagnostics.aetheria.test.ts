// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M12 Plan step 8 (fork part) — the Backend `diagnostics-backend` module: its row, its filesystem sink, the four strict XC-6 operations (append, list, read, health), the channel wrap and the drain.
// Boundary: real files under real temporary state roots and the real `@aetheria/diagnostics` archive (builder, vocabulary, recorder); the access rule and the operations that are observed are doubles. Shows: the store declares
// formatVersion 1 and refuses a newer, corrupt, foreign or unfinished one without repair; one writer; an append is `stored` only when the file agrees; an append failure or an uncertain one never changes the
// observed operation and leaves health unavailable; read and list serve only the verified caller's own sessions and refuse a forged session, root or host, an unknown field, a revoked caller and a missing
// access rule; every observed operation gives exactly one correctly attributed event and returns its result untouched; the drain flushes and releases once. Does not show: the assembled Backend
// service under a real T3 (the app server's carrier route), durability across a power loss, another host OS, or the Agent side of `diagnostics.append`.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import type { Xc6Operation, Xc6OperationContext } from "@t3tools/aetheria-contracts";

import { rootOf } from "../identity/testkit.ts";
import { DIAGNOSTICS_PINNED_ARTIFACT } from "../artifact.ts";
import type { DiagnosticsSink, DiagnosticsStore } from "./entry.ts";
import {
  DIAGNOSTICS_APPEND_OPERATION,
  DIAGNOSTICS_HEALTH_OPERATION,
  DIAGNOSTICS_LIST_OPERATION,
  DIAGNOSTICS_READ_OPERATION,
  createDiagnosticsBackendRegistration,
  type DiagnosticsAccess,
  type DiagnosticsRegistrationOptions,
} from "./registration.ts";
import {
  DIAGNOSTICS_BACKEND_ENTRY,
  DIAGNOSTICS_BACKEND_ID,
  diagnosticsBackendModuleRow,
} from "./row.ts";
import {
  DIAGNOSTICS_DIRECTORY,
  DIAGNOSTICS_EVENTS_FILE,
  DIAGNOSTICS_FORMAT_FILE,
  DIAGNOSTICS_LOCK_FILE,
  createDiagnosticsStore,
} from "./sink.ts";

const here = NodePath.dirname(new URL(import.meta.url).pathname);
const CANARY = "CANARY-sk-live-4f9a7c1e22b84d0f9a";
const T0 = Date.parse("2026-11-17T10:00:00.000Z");

const ctx = (
  sessionId: string,
  args: Record<string, unknown> = {},
  rootSessionId = sessionId,
): Xc6OperationContext => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId,
  args,
});

/** An Agent-side event, as the Agent host's recorder would send it. */
const agentEvent = (sessionId: string, n = 1, over: Record<string, unknown> = {}) => ({
  eventId: `evt-${sessionId}-${n}`,
  time: "2026-11-17T10:00:00.000Z",
  host: "agent",
  sessionId,
  kind: "tool",
  name: "bash",
  outcome: "ok",
  durationMs: 5,
  ...over,
});

const answer = (settled: unknown) => settled as { status: string; code?: string; result?: any };

interface WorldOptions extends Partial<DiagnosticsRegistrationOptions> {
  readonly revoked?: Set<string>;
  readonly children?: Record<string, string[]>;
  readonly noAccess?: boolean;
}

function world(over: WorldOptions = {}) {
  const stateRoot = over.stateRoot ?? rootOf();
  const revoked = over.revoked ?? new Set<string>();
  const children = over.children ?? {};
  let tick = 0;
  let ids = 0;
  const access: DiagnosticsAccess = {
    canRead: (caller) => !revoked.has(caller.sessionId),
    owns: (caller, target) => children[caller.sessionId]?.includes(target) === true,
  };
  const { revoked: _r, children: _c, noAccess, ...rest } = over;
  const registration = createDiagnosticsBackendRegistration({
    stateRoot,
    ...(noAccess === true ? {} : { access }),
    clock: () => T0 + tick++,
    newId: () => `backend-evt-${++ids}`,
    ...rest,
  });
  const operations = registration.operations as Record<string, Xc6Operation>;
  const call = async (name: string, context: Xc6OperationContext) =>
    answer(await operations[name]!(context));
  /** Wait until every event the recorder accepted is stored (its events are appended in order, after the call returns): the registration's own flush milestone, no timer. */
  const settle = async () => {
    await registration.flush();
    expect(registration.health().recorder?.counts.pending ?? 0).toBe(0);
  };
  return {
    stateRoot,
    registration,
    operations,
    call,
    settle,
    /** A successful Backend start: the activation, then the store opened as the service does once it holds the owner lock. */
    start: async () => {
      await registration.activation.start({ id: DIAGNOSTICS_BACKEND_ID });
      await registration.open();
    },
    /** The activation alone: what a Backend start that is refused or fails later has run. */
    activate: () => registration.activation.start({ id: DIAGNOSTICS_BACKEND_ID }),
    drain: () =>
      registration.activation.drain("test") as Promise<{
        released: string[];
        stopped: string[];
        transferred: string[];
        stillLive: string[];
      }>,
    dir: NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY),
    stored: async () => {
      const read = await createDiagnosticsStore({ stateRoot }).read();
      if (!read.ok) throw new Error(read.code);
      return read.events;
    },
    raw: () =>
      NodeFS.readFileSync(
        NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY, DIAGNOSTICS_EVENTS_FILE),
        "utf8",
      ),
  };
}

/** A store over the real one whose writer's appends can be made to fail, to throw or to confirm another event. */
function flaky(real: DiagnosticsStore) {
  const mode = { current: "pass" as "pass" | "fail" | "throw" | "disagree" };
  const store: DiagnosticsStore = {
    read: () => real.read(),
    openWriter: async () => {
      const opened = await real.openWriter();
      if (!opened.ok) return opened;
      const inner = opened.sink;
      const sink: DiagnosticsSink = {
        append: async (event) => {
          if (mode.current === "fail") return { status: "failed", code: "DIAGNOSTICS_IO" };
          if (mode.current === "throw") throw new Error("the disk went away");
          if (mode.current === "disagree")
            return { status: "stored", eventId: "another-event", seq: 999 };
          return inner.append(event);
        },
        flush: () => inner.flush(),
        release: () => inner.release(),
      };
      return { ok: true, sink };
    },
  };
  return { store, mode };
}

describe("the module's row and its one import site", () => {
  it("selects the Backend module with its own state, no required module and the archive stamp this build carries", () => {
    const row = diagnosticsBackendModuleRow() as Record<string, any>;
    expect(row).toMatchObject({
      id: "diagnostics-backend",
      host: "backend",
      entry: "aetheria:diagnostics-backend",
      required: true,
      mutatesToolInput: false,
      owns: ["backend-diagnostics-state"],
    });
    expect(row.requires).toBeUndefined();
    expect(row.contract.stateOwner).toBe("backend-diagnostics-state");
    expect(row.compat.artifacts).toEqual({
      "@aetheria/diagnostics": { stamp: DIAGNOSTICS_PINNED_ARTIFACT.stamp },
    });
    expect(diagnosticsBackendModuleRow({ stamp: "sha256:x" }).compat).toEqual({
      artifacts: { "@aetheria/diagnostics": { stamp: "sha256:x" } },
    });
    expect(DIAGNOSTICS_BACKEND_ENTRY).toBe("aetheria:diagnostics-backend");
  });

  it("reaches the archive from entry.ts only, through its Backend entry, with no outer-source path", () => {
    for (const file of NodeFS.readdirSync(here).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const text = NodeFS.readFileSync(NodePath.join(here, file), "utf8");
      const specifiers = [
        ...text.matchAll(/(?:from|import|resolve)\s*\(?\s*["']([^"']+)["']/g),
      ].map((m) => m[1]!);
      for (const specifier of specifiers) {
        if (specifier.startsWith("@aetheria/")) {
          expect(file).toBe("entry.ts");
          expect([
            "@aetheria/diagnostics/backend",
            "@aetheria/diagnostics/vocabulary.yml",
          ]).toContain(specifier);
        }
        expect(specifier).not.toMatch(/packages\/aetheria-|apps\/aetheria|(\.\.\/){3,}/);
      }
    }
  });
});

describe("the filesystem sink", () => {
  it("declares formatVersion 1 before any event, appends in order and confirms each position against what is stored", async () => {
    const stateRoot = rootOf();
    const store = createDiagnosticsStore({ stateRoot });
    const opened = await store.openWriter();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY);
    expect(
      JSON.parse(NodeFS.readFileSync(NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE), "utf8")),
    ).toEqual({ formatVersion: 1 });
    const a = agentEvent("s1", 1) as any;
    const b = agentEvent("s1", 2) as any;
    expect(await opened.sink.append(a)).toEqual({ status: "stored", eventId: a.eventId, seq: 1 });
    expect(await opened.sink.append(b)).toEqual({ status: "stored", eventId: b.eventId, seq: 2 });
    expect(await store.read()).toEqual({ ok: true, events: [a, b] });
    expect(
      NodeFS.readFileSync(NodePath.join(dir, DIAGNOSTICS_EVENTS_FILE), "utf8").split("\n"),
    ).toHaveLength(3);
    expect(await opened.sink.flush()).toEqual({ ok: true });
    expect(await opened.sink.release()).toEqual({ ok: true });
    // The seq of a later writer continues from what is stored.
    const again = await createDiagnosticsStore({ stateRoot }).openWriter();
    if (!again.ok) throw new Error(again.code);
    expect(await again.sink.append(agentEvent("s1", 3) as any)).toMatchObject({
      status: "stored",
      seq: 3,
    });
    await again.sink.release();
  });

  it("holds one writer: a second is refused while the first lives, and the lock is freed on release", async () => {
    const stateRoot = rootOf();
    const first = await createDiagnosticsStore({ stateRoot }).openWriter();
    expect(first.ok).toBe(true);
    expect(await createDiagnosticsStore({ stateRoot, pid: 424242 }).openWriter()).toEqual({
      ok: false,
      code: "DIAGNOSTICS_WRITER_EXISTS",
    });
    if (first.ok) await first.sink.release();
    expect(
      NodeFS.existsSync(NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY, DIAGNOSTICS_LOCK_FILE)),
    ).toBe(false);
    const next = await createDiagnosticsStore({ stateRoot }).openWriter();
    expect(next.ok).toBe(true);
    if (next.ok) await next.sink.release();
  });

  it("takes over a lock whose process is gone, and refuses one whose process is alive", async () => {
    const stateRoot = rootOf();
    const dir = NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY);
    NodeFS.mkdirSync(dir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, DIAGNOSTICS_LOCK_FILE), "777001\n");
    expect(await createDiagnosticsStore({ stateRoot, isAlive: () => true }).openWriter()).toEqual({
      ok: false,
      code: "DIAGNOSTICS_WRITER_EXISTS",
    });
    const taken = await createDiagnosticsStore({ stateRoot, isAlive: () => false }).openWriter();
    expect(taken.ok).toBe(true);
    if (taken.ok) await taken.sink.release();
  });

  it("refuses a newer, corrupt, foreign or event-without-format store without repairing it, and an unfinished last line", async () => {
    const cases: Array<[string, (dir: string) => void, string]> = [
      [
        "newer",
        (dir) =>
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE),
            '{"formatVersion":2}\n',
          ),
        "DIAGNOSTICS_FORMAT_NEWER",
      ],
      [
        "not json",
        (dir) => NodeFS.writeFileSync(NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE), "{nope"),
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
      [
        "extra key",
        (dir) =>
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE),
            '{"formatVersion":1,"x":1}',
          ),
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
      [
        "older",
        (dir) =>
          NodeFS.writeFileSync(NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE), '{"formatVersion":0}'),
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
      [
        "events without a declared format",
        (dir) =>
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_EVENTS_FILE),
            `${JSON.stringify(agentEvent("s1"))}\n`,
          ),
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
      [
        "a field outside the closed list",
        (dir) => {
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE),
            '{"formatVersion":1}\n',
          );
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_EVENTS_FILE),
            `${JSON.stringify({ ...agentEvent("s1"), prompt: CANARY })}\n`,
          );
        },
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
      [
        "an unfinished last line",
        (dir) => {
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_FORMAT_FILE),
            '{"formatVersion":1}\n',
          );
          NodeFS.writeFileSync(
            NodePath.join(dir, DIAGNOSTICS_EVENTS_FILE),
            `${JSON.stringify(agentEvent("s1"))}\n{"eventId":"par`,
          );
        },
        "DIAGNOSTICS_STORE_UNUSABLE",
      ],
    ];
    for (const [name, plant, code] of cases) {
      const stateRoot = rootOf();
      const dir = NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY);
      NodeFS.mkdirSync(dir, { recursive: true });
      plant(dir);
      const before = Object.fromEntries(
        NodeFS.readdirSync(dir).map((f) => [f, NodeFS.readFileSync(NodePath.join(dir, f), "utf8")]),
      );
      const store = createDiagnosticsStore({ stateRoot });
      expect(await store.openWriter(), name).toEqual({ ok: false, code });
      expect(await store.read(), name).toEqual({ ok: false, code });
      const after = Object.fromEntries(
        NodeFS.readdirSync(dir).map((f) => [f, NodeFS.readFileSync(NodePath.join(dir, f), "utf8")]),
      );
      expect(after, name).toEqual(before);
    }
  });

  it("fails an append when the store is gone or the owner lock is not held, and the next append after release", async () => {
    const stateRoot = rootOf();
    let held = true;
    const assertHeld = () => {
      if (!held) throw new Error("the owner lock is not held");
    };
    const opened = await createDiagnosticsStore({ stateRoot, assertHeld }).openWriter();
    if (!opened.ok) throw new Error(opened.code);
    held = false;
    expect(await opened.sink.append(agentEvent("s1") as any)).toEqual({
      status: "failed",
      code: "DIAGNOSTICS_OWNER_LOCK_NOT_HELD",
    });
    held = true;
    NodeFS.rmSync(NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY), {
      recursive: true,
      force: true,
    });
    expect(await opened.sink.append(agentEvent("s1") as any)).toEqual({
      status: "failed",
      code: "DIAGNOSTICS_IO",
    });
    expect(await opened.sink.release()).toEqual({ ok: true });
    expect(await opened.sink.append(agentEvent("s1") as any)).toEqual({
      status: "failed",
      code: "DIAGNOSTICS_SINK_RELEASED",
    });
  });
});

describe("diagnostics.append", () => {
  it("stores an Agent event for the verified session and answers stored with its position; a retry names the same position", async () => {
    const w = world();
    await w.start();
    const event = agentEvent("s1");
    const first = await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event }));
    expect(first).toEqual({
      status: "done",
      result: { status: "stored", eventId: event.eventId, seq: 1 },
    });
    expect(await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event }))).toEqual(first);
    expect(await w.stored()).toEqual([event]);
    expect(w.registration.health()).toMatchObject({
      state: "ok",
      agentAppends: { stored: 1, failed: 0, uncertain: 0 },
    });
    await w.drain();
  });

  it("refuses a forged session, root or host, an unknown field, a body field and an argument outside the contract, and stores nothing", async () => {
    const w = world();
    await w.start();
    const refusals: Array<[string, Record<string, unknown>, string]> = [
      ["forged session", { event: agentEvent("s2") }, "DIAGNOSTICS_FORGED_IDENTITY"],
      [
        "forged root",
        { event: agentEvent("s1", 1, { rootId: "other-root" }) },
        "DIAGNOSTICS_FORGED_IDENTITY",
      ],
      [
        "the Backend's own host",
        { event: agentEvent("s1", 1, { host: "backend" }) },
        "DIAGNOSTICS_FORGED_IDENTITY",
      ],
      [
        "an unknown field",
        { event: agentEvent("s1", 1, { extra: true }) },
        "DIAGNOSTICS_EVENT_REJECTED",
      ],
      [
        "a prompt body",
        { event: agentEvent("s1", 1, { prompt: CANARY }) },
        "DIAGNOSTICS_EVENT_REJECTED",
      ],
      [
        "a result body",
        { event: agentEvent("s1", 1, { result: { text: CANARY } }) },
        "DIAGNOSTICS_EVENT_REJECTED",
      ],
      [
        "an outcome outside the vocabulary",
        { event: agentEvent("s1", 1, { outcome: "MADE_UP_CODE" }) },
        "DIAGNOSTICS_EVENT_REJECTED",
      ],
      [
        "a path as a name",
        { event: agentEvent("s1", 1, { name: "/Users/x/secret.txt" }) },
        "DIAGNOSTICS_EVENT_REJECTED",
      ],
      ["a missing event", {}, "DIAGNOSTICS_ARGS_INVALID"],
      ["an event that is not an object", { event: "text" }, "DIAGNOSTICS_ARGS_INVALID"],
      [
        "an argument that names another session",
        { event: agentEvent("s1"), sessionId: "s2" },
        "DIAGNOSTICS_ARGS_INVALID",
      ],
    ];
    for (const [name, args, code] of refusals)
      expect(await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", args)), name).toEqual({
        status: "refused",
        code,
      });
    expect(await w.stored()).toEqual([]);
    expect(w.registration.health().agentAppends.refused).toBe(refusals.length);
    expect(w.registration.health().state).toBe("ok");
    await w.drain();
  });

  it("answers unavailable, and shows it in health, when the append fails, throws or is confirmed as another event; a later stored append clears it", async () => {
    const stateRoot = rootOf();
    const { store, mode } = flaky(createDiagnosticsStore({ stateRoot }));
    const w = world({ stateRoot, store });
    await w.start();
    mode.current = "fail";
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1", 1) })),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_IO" });
    expect(w.registration.health()).toMatchObject({
      state: "unavailable",
      reasons: ["agent-append-failed"],
      agentAppends: { failed: 1 },
    });
    mode.current = "throw";
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1", 2) })),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_APPEND_UNCERTAIN" });
    mode.current = "disagree";
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1", 3) })),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_APPEND_UNCERTAIN" });
    expect(w.registration.health()).toMatchObject({
      state: "unavailable",
      reasons: ["agent-append-uncertain"],
      agentAppends: { stored: 0, failed: 1, uncertain: 2 },
    });
    mode.current = "pass";
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1", 4) })),
    ).toMatchObject({ status: "done", result: { status: "stored" } });
    expect(w.registration.health().state).toBe("ok");
    await w.drain();
  });
});

describe("diagnostics.read and diagnostics.list", () => {
  async function seeded(over: WorldOptions = {}) {
    const w = world(over);
    await w.start();
    for (const [session, n] of [
      ["s1", 1],
      ["s1", 2],
      ["s2", 1],
      ["s3", 1],
    ] as const)
      expect(
        await w.call(
          DIAGNOSTICS_APPEND_OPERATION,
          ctx(session, { event: agentEvent(session, n, { name: n === 1 ? "bash" : "read" }) }),
        ),
      ).toMatchObject({ status: "done" });
    return w;
  }

  it("serves the caller's own session by default, oldest first, and by session alone the tool list of one run", async () => {
    const w = await seeded();
    const read = await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"));
    expect(read.status).toBe("done");
    expect(read.result.sessionId).toBe("s1");
    expect(read.result.events.map((e: any) => `${e.sessionId}:${e.name}`)).toEqual([
      "s1:bash",
      "s1:read",
    ]);
    expect(read.result.truncated).toBe(false);
    const limited = await w.call(
      DIAGNOSTICS_READ_OPERATION,
      ctx("s1", { sessionId: "s1", limit: 1 }),
    );
    expect(limited.result.events.map((e: any) => e.eventId)).toEqual(["evt-s1-2"]);
    expect(limited.result.truncated).toBe(true);
    await w.drain();
  });

  it("lists only the caller's own sessions, never the Backend's lifecycle session or another caller's", async () => {
    const w = await seeded({ children: { s1: ["s3"] } });
    const own = await w.call(DIAGNOSTICS_LIST_OPERATION, ctx("s1"));
    expect(own.result.sessions.map((s: any) => s.sessionId).sort()).toEqual(["s1", "s3"]);
    expect(own.result.sessions.find((s: any) => s.sessionId === "s1")).toMatchObject({
      eventCount: 2,
    });
    const other = await w.call(DIAGNOSTICS_LIST_OPERATION, ctx("s2"));
    expect(other.result.sessions.map((s: any) => s.sessionId)).toEqual(["s2"]);
    await w.drain();
  });

  it("refuses another caller's session, a forged identity argument and any unknown field; a session the caller owns is readable", async () => {
    const w = await seeded({ children: { s1: ["s3"] } });
    expect(await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1", { sessionId: "s2" }))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_NOT_OWN_SESSION",
    });
    expect(await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1", { sessionId: "backend" }))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_NOT_OWN_SESSION",
    });
    for (const forged of [
      { rootSessionId: "s2" },
      { kind: "main" },
      { actor: "s2" },
      { sessionId: "s1", extra: 1 },
    ])
      expect(
        await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1", forged)),
        JSON.stringify(forged),
      ).toEqual({ status: "refused", code: "DIAGNOSTICS_ARGS_INVALID" });
    for (const bad of [
      { limit: 0 },
      { limit: 1.5 },
      { limit: 100000 },
      { sessionId: 5 },
      { sessionId: "../x" },
    ])
      expect(await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1", bad)), JSON.stringify(bad)).toEqual(
        { status: "refused", code: "DIAGNOSTICS_ARGS_INVALID" },
      );
    expect(await w.call(DIAGNOSTICS_LIST_OPERATION, ctx("s1", { sessionId: "s2" }))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_ARGS_INVALID",
    });
    const child = await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1", { sessionId: "s3" }));
    expect(child.result.events.map((e: any) => e.sessionId)).toEqual(["s3"]);
    await w.drain();
  });

  it("refuses a caller whose access is revoked, and answers unavailable without an access rule", async () => {
    const revoked = new Set<string>();
    const w = await seeded({ revoked });
    revoked.add("s1");
    expect(await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_ACCESS_REVOKED",
    });
    expect(await w.call(DIAGNOSTICS_LIST_OPERATION, ctx("s1"))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_ACCESS_REVOKED",
    });
    expect((await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s2"))).status).toBe("done");
    await w.drain();
    const bare = world({ noAccess: true });
    await bare.start();
    expect(await bare.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_ACCESS_UNAVAILABLE",
    });
    await bare.drain();
  });

  it("answers unavailable before start, unconfigured and after drain, and with the store's code when it cannot be used", async () => {
    const early = world();
    expect(await early.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    expect(early.registration.health().state).toBe("not-started");
    await early.start();
    await early.drain();
    expect(await early.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    const unconfigured = createDiagnosticsBackendRegistration({});
    await unconfigured.activation.start({ id: DIAGNOSTICS_BACKEND_ID });
    expect(unconfigured.health().state).toBe("unconfigured");
    expect(
      answer(
        await (unconfigured.operations as Record<string, Xc6Operation>)[
          DIAGNOSTICS_APPEND_OPERATION
        ]!(ctx("s1", { event: agentEvent("s1") })),
      ),
    ).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    const stateRoot = rootOf();
    NodeFS.mkdirSync(NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY, DIAGNOSTICS_FORMAT_FILE),
      '{"formatVersion":2}\n',
    );
    const newer = world({ stateRoot });
    await newer.start();
    expect(await newer.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_FORMAT_NEWER",
    });
    expect(
      await newer.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1") })),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_FORMAT_NEWER" });
    expect(newer.registration.health()).toMatchObject({
      state: "unavailable",
      storeCode: "DIAGNOSTICS_FORMAT_NEWER",
    });
    expect(
      NodeFS.readFileSync(
        NodePath.join(stateRoot, DIAGNOSTICS_DIRECTORY, DIAGNOSTICS_FORMAT_FILE),
        "utf8",
      ),
    ).toBe('{"formatVersion":2}\n');
    await newer.drain();
  });
});

describe("diagnostics.health", () => {
  it("serves the content-free health snapshot, the same one health() gives, to a verified caller whose access is held", async () => {
    const w = world();
    await w.start();
    const event = agentEvent("s1", 1, { name: "bash" });
    await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event }));
    await w.settle();
    const got = await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"));
    expect(got.status).toBe("done");
    expect(got.result).toEqual(w.registration.health());
    expect(got.result).toMatchObject({
      state: "ok",
      reasons: [],
      storeCode: null,
      format: { formatVersion: 1 },
      agentAppends: { stored: 1, failed: 0, uncertain: 0, refused: 0 },
      telemetry: { t3: "unknown", aetheria: "none" },
      recorder: { state: "ok" },
    });
    // Another session whose access is held reads the same module-wide health; the snapshot carries no path, no event, no id of an event and no session.
    const other = await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s2"));
    expect(other.status).toBe("done");
    const text = JSON.stringify(got.result);
    for (const forbidden of [w.stateRoot, event.eventId, "s1", "events.jsonl", CANARY])
      expect(text, forbidden).not.toContain(forbidden);
    await w.drain();
  });

  it("shows a recorder fault and the telemetry setting it was built with as unavailable, never as silence", async () => {
    const stateRoot = rootOf();
    const { store, mode } = flaky(createDiagnosticsStore({ stateRoot }));
    const w = world({ stateRoot, store, telemetry: { t3: "disabled" } });
    await w.start();
    mode.current = "fail";
    await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1", 1) }));
    expect(await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toMatchObject({
      status: "done",
      result: {
        state: "unavailable",
        reasons: ["agent-append-failed"],
        agentAppends: { failed: 1 },
        telemetry: { t3: "disabled", aetheria: "none" },
      },
    });
    await w.drain();
  });

  it("refuses every argument, the operation takes exactly {}", async () => {
    const w = world();
    await w.start();
    for (const bad of [{ sessionId: "s1" }, { extra: 1 }, { rootSessionId: "s2" }, { limit: 1 }])
      expect(
        await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1", bad)),
        JSON.stringify(bad),
      ).toEqual({ status: "refused", code: "DIAGNOSTICS_ARGS_INVALID" });
    expect(
      await w.call(DIAGNOSTICS_HEALTH_OPERATION, {
        ...ctx("s1"),
        args: [] as unknown as Record<string, unknown>,
      }),
    ).toEqual({ status: "refused", code: "DIAGNOSTICS_ARGS_INVALID" });
    expect(
      await w.call(DIAGNOSTICS_HEALTH_OPERATION, {
        ...ctx("s1"),
        args: null as unknown as Record<string, unknown>,
      }),
    ).toEqual({ status: "refused", code: "DIAGNOSTICS_ARGS_INVALID" });
    await w.drain();
  });

  it("refuses a caller whose access is revoked, and answers unavailable without an access rule or an identity", async () => {
    const revoked = new Set<string>();
    const w = world({ revoked });
    await w.start();
    revoked.add("s1");
    expect(await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "refused",
      code: "DIAGNOSTICS_ACCESS_REVOKED",
    });
    expect((await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s2"))).status).toBe("done");
    expect(await w.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("../x"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_IDENTITY_UNAVAILABLE",
    });
    await w.drain();
    const bare = world({ noAccess: true });
    await bare.start();
    expect(await bare.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_ACCESS_UNAVAILABLE",
    });
    await bare.drain();
    const throwing = world({
      access: {
        canRead: () => {
          throw new Error("the session table is gone");
        },
      },
    });
    await throwing.start();
    expect(await throwing.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_ACCESS_UNAVAILABLE",
    });
    await throwing.drain();
  });

  it("answers unavailable before start, before the store is open, after drain and when unconfigured", async () => {
    const early = world();
    expect(await early.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    await early.activate();
    expect(early.registration.health().state).toBe("not-open");
    expect(await early.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    await early.registration.open();
    expect((await early.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).status).toBe("done");
    await early.drain();
    expect(await early.call(DIAGNOSTICS_HEALTH_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    const unconfigured = createDiagnosticsBackendRegistration({});
    await unconfigured.activation.start({ id: DIAGNOSTICS_BACKEND_ID });
    expect(
      answer(
        await (unconfigured.operations as Record<string, Xc6Operation>)[
          DIAGNOSTICS_HEALTH_OPERATION
        ]!(ctx("s1")),
      ),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_NOT_RUNNING" });
  });
});

describe("channel and Backend observation (the wrap)", () => {
  const sessions = ["s1", "s2", "s3", "s4"];
  const table = (over: Record<string, Xc6Operation> = {}): Record<string, Xc6Operation> => ({
    "demo.ok": () => ({ status: "done", result: { text: CANARY } }),
    "demo.refused": () => ({ status: "refused", code: "AUTH_IDENTITY_UNAVAILABLE" }),
    "demo.unavailable": () => ({ status: "unavailable", code: "NOT_A_KNOWN_CODE" }),
    "demo.throws": () => {
      throw Object.assign(new Error(`failed with ${CANARY}`), { code: "AUTH_IDENTITY_INVALID" });
    },
    "demo.pending": () => ({
      status: "pending",
      settle: Promise.resolve({ status: "done", result: 1 } as const),
    }),
    "demo.async": async () => ({ status: "done", result: [1] }),
    ...over,
  });

  it("records exactly one correctly attributed event per operation, keeps no argument or result, and returns every answer untouched", async () => {
    const w = world();
    await w.start();
    const inner = table();
    const wrapped = w.registration.observe({ ...inner, ...w.operations });
    const results: unknown[] = [];
    for (const name of [
      "demo.ok",
      "demo.refused",
      "demo.unavailable",
      "demo.pending",
      "demo.async",
    ])
      results.push(await wrapped[name]!(ctx("s1", { secret: CANARY, prompt: CANARY })));
    await expect(
      Promise.resolve().then(() => wrapped["demo.throws"]!(ctx("s1", { secret: CANARY }))),
    ).rejects.toThrow("failed with");
    await w.settle();
    expect(results[0]).toEqual({ status: "done", result: { text: CANARY } });
    expect((results[3] as { status: string }).status).toBe("pending");
    const events = await w.stored();
    expect(events.map((e) => [e.name, e.kind, e.outcome, e.sessionId])).toEqual([
      ["demo.ok", "operation", "ok", "s1"],
      ["demo.refused", "refusal", "AUTH_IDENTITY_UNAVAILABLE", "s1"],
      ["demo.unavailable", "operation", "unavailable", "s1"],
      ["demo.pending", "operation", "ok", "s1"],
      ["demo.async", "operation", "ok", "s1"],
      ["demo.throws", "error", "AUTH_IDENTITY_INVALID", "s1"],
    ]);
    expect(
      events.every(
        (e) => e.rootId === "s1" && e.host === "backend" && typeof e.durationMs !== "undefined",
      ),
    ).toBe(true);
    // The whole file, the operation's own table and the health output hold no canary.
    expect(w.raw()).not.toContain(CANARY);
    expect(JSON.stringify(w.registration.health())).not.toContain(CANARY);
    expect(Object.keys(w.registration.observe({ ...inner, ...w.operations })).sort()).toEqual(
      [...Object.keys(inner), ...Object.keys(w.operations)].sort(),
    );
    await w.drain();
  });

  it("leaves the diagnostics operations unwrapped, so reading is not itself an event", async () => {
    const w = world();
    await w.start();
    const wrapped = w.registration.observe(w.operations);
    for (const name of Object.keys(w.operations)) expect(wrapped[name]).toBe(w.operations[name]);
    await w.drain();
  });

  it("keeps attribution across a concurrent producer workload: each session gets exactly its own events, in a strictly increasing order", async () => {
    const w = world();
    await w.start();
    const wrapped = w.registration.observe(table());
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        wrapped[i % 2 === 0 ? "demo.ok" : "demo.refused"]!(ctx(sessions[i % sessions.length]!)),
      ),
    );
    await w.settle();
    const events = await w.stored();
    expect(events).toHaveLength(40);
    for (const session of sessions)
      expect(events.filter((e) => e.sessionId === session)).toHaveLength(10);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(40);
    const health = w.registration.health();
    expect(health.recorder?.lastSeq).toBe(40);
    expect(health.recorder?.counts).toMatchObject({
      stored: 40,
      appendFailed: 0,
      appendUncertain: 0,
      unattributed: 0,
      rejected: 0,
    });
    await w.drain();
  });

  it("never aborts, delays or changes the operation when the recorder's store fails; health stays unavailable and a later stored event clears it", async () => {
    const stateRoot = rootOf();
    const { store, mode } = flaky(createDiagnosticsStore({ stateRoot }));
    const w = world({ stateRoot, store });
    await w.start();
    const wrapped = w.registration.observe(table());
    for (const failure of ["fail", "throw", "disagree"] as const) {
      mode.current = failure;
      expect(await wrapped["demo.ok"]!(ctx("s1"))).toEqual({
        status: "done",
        result: { text: CANARY },
      });
      await w.settle();
      expect(w.registration.health().state, failure).toBe("unavailable");
      expect(
        w.registration.health().reasons.some((r) => r.startsWith("append-")),
        failure,
      ).toBe(true);
    }
    expect(w.registration.health().recorder?.counts).toMatchObject({
      appendFailed: 1,
      appendUncertain: 2,
      stored: 0,
    });
    mode.current = "pass";
    await wrapped["demo.ok"]!(ctx("s1"));
    await w.settle();
    expect(w.registration.health().state).toBe("ok");
    expect(await w.stored()).toHaveLength(1);
    await w.drain();
  });

  it("passes operations through unobserved, and counts them, when no recorder can take their event", async () => {
    const early = world();
    const wrapped = early.registration.observe(table());
    expect(await wrapped["demo.ok"]!(ctx("s1"))).toEqual({
      status: "done",
      result: { text: CANARY },
    });
    expect(early.registration.health().channel).toEqual({ observed: 0, unobserved: 1 });
  });

  it("records the Backend's lifecycle under the Backend's own session, which no principal owns", async () => {
    const w = world();
    await w.start();
    let listener: ((event: any) => void) | undefined;
    const handle = w.registration.observeBackend({
      observe: (l) => {
        listener = l as (event: any) => void;
        return { close: () => void (listener = undefined) };
      },
    });
    listener?.({ kind: "started", order: ["a"], digest: "x" });
    listener?.({ kind: "start-failed", module: "a" });
    await w.settle();
    expect((await w.stored()).map((e) => [e.sessionId, e.kind, e.name, e.outcome])).toEqual([
      ["backend", "lifecycle", "backend.started", "ok"],
      ["backend", "lifecycle", "backend.start-failed", "error"],
    ]);
    expect((await w.call(DIAGNOSTICS_LIST_OPERATION, ctx("s1"))).result.sessions).toEqual([]);
    handle.close();
    expect(listener).toBeUndefined();
    await w.drain();
  });
});

describe("the drain (XC-7) and health", () => {
  it("flushes, releases the one writer once, reports the store released and lets the next writer open", async () => {
    const w = world();
    await w.start();
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1") })),
    ).toMatchObject({ status: "done" });
    const report = await w.drain();
    expect(report).toEqual({
      released: ["backend-diagnostics.store"],
      stopped: ["backend-diagnostics.recorder"],
      transferred: [],
      stillLive: [],
    });
    expect(w.registration.health()).toMatchObject({
      state: "released",
      release: { ok: true, sinkReleased: true },
    });
    expect(NodeFS.existsSync(NodePath.join(w.dir, DIAGNOSTICS_LOCK_FILE))).toBe(false);
    const next = await createDiagnosticsStore({ stateRoot: w.stateRoot }).openWriter();
    expect(next.ok).toBe(true);
    if (next.ok) await next.sink.release();
  });

  it("reports honestly when events were lost: unflushed in stopped and unavailable in health, but the lock is freed and nothing is claimed live", async () => {
    const stateRoot = rootOf();
    const { store, mode } = flaky(createDiagnosticsStore({ stateRoot }));
    const w = world({ stateRoot, store });
    await w.start();
    const wrapped = w.registration.observe({ "demo.ok": () => ({ status: "done", result: 1 }) });
    mode.current = "fail";
    await wrapped["demo.ok"]!(ctx("s1"));
    const report = await w.drain();
    expect(report).toEqual({
      released: ["backend-diagnostics.store"],
      stopped: ["backend-diagnostics.recorder", "backend-diagnostics.recorder-unflushed"],
      transferred: [],
      stillLive: [],
    });
    expect(w.registration.health()).toMatchObject({
      state: "unavailable",
      release: { ok: false, sinkReleased: true },
    });
  });

  it("reports the writer still live when its release failed, and an event after the drain is not stored", async () => {
    const stateRoot = rootOf();
    const real = createDiagnosticsStore({ stateRoot });
    const store: DiagnosticsStore = {
      read: () => real.read(),
      openWriter: async () => {
        const opened = await real.openWriter();
        return opened.ok
          ? {
              ok: true,
              sink: {
                ...opened.sink,
                release: async () => ({ ok: false, code: "DIAGNOSTICS_IO" }),
              },
            }
          : opened;
      },
    };
    const w = world({ stateRoot, store });
    await w.start();
    const report = await w.drain();
    expect(report.stillLive).toEqual(["backend-diagnostics.store"]);
    expect(report.released).toEqual([]);
    expect(w.registration.health()).toMatchObject({
      state: "unavailable",
      reasons: expect.arrayContaining(["release-failed"]),
    });
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1") })),
    ).toMatchObject({ status: "unavailable" });
  });

  it("shows exact recorder state, the telemetry setting and never `ok` from an unconfigured or unstarted module", async () => {
    const w = world({ telemetry: { t3: "disabled" } });
    expect(w.registration.health()).toMatchObject({
      state: "not-started",
      recorder: null,
      telemetry: { t3: "disabled", aetheria: "none" },
      format: { formatVersion: 1 },
    });
    await w.start();
    const health = w.registration.health();
    expect(health).toMatchObject({
      state: "ok",
      storeCode: null,
      recorder: { state: "ok", observerErrors: "unknown" },
    });
    expect(Object.isFrozen(health)).toBe(true);
    expect(createDiagnosticsBackendRegistration({}).health().telemetry.t3).toBe("unknown");
    await w.drain();
  });
});

describe("a start that does not complete writes nothing (M04: refused before any effect)", () => {
  const lifecycleListener = (w: ReturnType<typeof world>) => {
    let listener: ((event: any) => void) | undefined;
    w.registration.observeBackend({
      observe: (l) => {
        listener = l as (event: any) => void;
        return { close: () => void (listener = undefined) };
      },
    });
    return (event: unknown) => listener?.(event);
  };

  it("creates no folder, format file, events or lock before open(); refused and failed starts are counted in health only", async () => {
    const w = world();
    const emit = lifecycleListener(w);
    await w.activate();
    emit({ kind: "start-refused", codes: ["X"] });
    emit({ kind: "start-failed", module: "a" });
    expect(NodeFS.existsSync(w.dir)).toBe(false);
    expect(NodeFS.readdirSync(w.stateRoot)).toEqual([]);
    expect(w.registration.health()).toMatchObject({
      state: "not-open",
      recorder: null,
      lifecycle: { unpersisted: 2 },
    });
    expect(await w.call(DIAGNOSTICS_READ_OPERATION, ctx("s1"))).toEqual({
      status: "unavailable",
      code: "DIAGNOSTICS_NOT_RUNNING",
    });
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1") })),
    ).toEqual({ status: "unavailable", code: "DIAGNOSTICS_NOT_RUNNING" });
    const wrapped = w.registration.observe({ "demo.ok": () => ({ status: "done", result: 1 }) });
    await wrapped["demo.ok"]!(ctx("s1"));
    expect(w.registration.health().channel).toEqual({ observed: 0, unobserved: 1 });
    expect(NodeFS.existsSync(w.dir)).toBe(false);
    // A rollback that drains the module writes nothing either.
    expect(await w.drain()).toEqual({ released: [], stopped: [], transferred: [], stillLive: [] });
    expect(NodeFS.readdirSync(w.stateRoot)).toEqual([]);
  });

  it("opens the store only on open(), records the held `started` event first, and counts later events as usual", async () => {
    const w = world();
    const emit = lifecycleListener(w);
    await w.activate();
    emit({ kind: "started", order: ["a"], digest: "x" });
    expect(NodeFS.existsSync(w.dir)).toBe(false);
    expect(w.registration.health().lifecycle.unpersisted).toBe(0);
    await w.registration.open();
    // open() resolves only after the held event is stored: no settle is needed, and nothing writes after it returns.
    expect(w.registration.health().recorder?.counts.pending).toBe(0);
    expect(NodeFS.readFileSync(NodePath.join(w.dir, DIAGNOSTICS_FORMAT_FILE), "utf8")).toBe(
      '{"formatVersion":1}\n',
    );
    expect((await w.stored()).map((e) => [e.sessionId, e.name, e.outcome])).toEqual([
      ["backend", "backend.started", "ok"],
    ]);
    expect(w.registration.health()).toMatchObject({ state: "ok", lifecycle: { unpersisted: 0 } });
    await w.drain();
  });

  it("frees a writer that finished opening after the drain, and leaves the store unused", async () => {
    const stateRoot = rootOf();
    const real = createDiagnosticsStore({ stateRoot });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store: DiagnosticsStore = {
      read: () => real.read(),
      openWriter: async () => {
        await gate;
        return real.openWriter();
      },
    };
    const w = world({ stateRoot, store });
    await w.activate();
    const opening = w.registration.open();
    const draining = w.drain();
    release?.();
    await opening;
    expect(await draining).toEqual({ released: [], stopped: [], transferred: [], stillLive: [] });
    expect(NodeFS.existsSync(NodePath.join(w.dir, DIAGNOSTICS_LOCK_FILE))).toBe(false);
    expect(w.registration.health().state).toBe("released");
    expect(
      await w.call(DIAGNOSTICS_APPEND_OPERATION, ctx("s1", { event: agentEvent("s1") })),
    ).toMatchObject({ status: "unavailable" });
  });
});
