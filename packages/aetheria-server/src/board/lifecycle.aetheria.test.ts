// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 22 — the board's lifecycle fails honestly (design D9, D11, D12, D17; C4 "Done when"): interrupted persistence, corruption,
// close-on-stop from liveness, drain, repeated dispose, restart, the observer's isolation, and one writer.
// Boundary: the real assembled Backend service (thread index, liveness, file board under a real state root) with hand-fed stored events; Git is a
// named double ("outside git", a scripted listing, "unknown") except in one test that runs a real repository; the pending-operation case drives the
// board runtime directly over a real file board whose replacement is held at a gate. It does not show T3's event delivery, the HTTP route, the
// Agent's tools (tests/awareness), or machine-level durability.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createAetheriaBackendService } from "../service.ts";
import type { AetheriaBackendServiceOptions } from "../service.ts";
import type { StoredEventLike } from "../identity/feed.ts";
import { createThreadIndex } from "../identity/threadIndex.ts";
import { createLivenessService } from "../liveness/service.ts";
import { boardFileFor, createFileBoardStorage, parseAwarenessConfig } from "../library.ts";
import type { ChangedFiles } from "../library.ts";
import { createGit } from "./git.ts";
import { createBoardRuntime } from "./runtime.ts";
import {
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  rootOf,
  sessionFileOf,
} from "../identity/testkit.ts";

const SESSION_C = "0197d3c0-3333-7000-8000-000000000003";
const THREAD_C = "mcp:88888888-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const workspaceDir = (): string => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-life-")));
  created.push(dir);
  return dir;
};

const git = (answer: () => ChangedFiles | Promise<ChangedFiles>) => ({
  topLevel: async () => undefined,
  changedFiles: async () => answer(),
});
const outsideGit = git(() => ({ status: "outside-git" }));
const clock = { t: 5_000_000 };
let sequence = 0;
const credentials: Record<string, string> = { [THREAD]: "c1", [THREAD_B]: "c2", [THREAD_C]: "c3" };
const runtimeOf = (threadId: string) => `provider-session:pi:${threadId}`;
const sessionEvent = (threadId: string, status: string, cwd: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-session.updated",
    threadId,
    payload: { id: runtimeOf(threadId), providerInstanceId: "pi", status, cwd },
  },
});
const threadEvent = (threadId: string, sessionId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-thread.updated",
    threadId,
    payload: {
      driver: "pi",
      providerInstanceId: "pi",
      providerSessionId: runtimeOf(threadId),
      appThreadId: threadId,
      nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
    },
  },
});
type Who = { thread: string; session: string; kind?: "main" | "child"; root?: string };
const A: Who = { thread: THREAD, session: SESSION };
const B: Who = { thread: THREAD_B, session: SESSION_B };
const ctx = (who: Who, args: Record<string, unknown> = {}) => ({
  caller: {
    threadId: who.thread,
    providerSessionId: credentials[who.thread]!,
    providerInstanceId: "pi",
  },
  sessionId: who.session,
  kind: who.kind ?? "main",
  rootSessionId: who.root ?? who.session,
  args,
});

function make(options: Partial<AetheriaBackendServiceOptions> = {}, stateRoot = rootOf()) {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => credentials[threadId],
    projectRootOf: (folder) => folder,
    now: () => clock.t,
    git: outsideGit,
    ...options,
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  const { service } = made;
  const run = async (name: string, who: Who, args: Record<string, unknown>) =>
    service.operations()[name]!(ctx(who, args));
  return { service, stateRoot, run };
}
async function live(
  whos: readonly Who[],
  options: Partial<AetheriaBackendServiceOptions> = {},
  ws = workspaceDir(),
) {
  const w = make(options);
  expect((await w.service.start()).outcome).toBe("started");
  w.service.setReplayHorizon(sequence);
  for (const who of whos) {
    await w.service.ingest(sessionEvent(who.thread, "running", ws));
    await w.service.ingest(threadEvent(who.thread, who.session));
  }
  return { ...w, ws, file: boardFileFor(w.stateRoot, ws) };
}
type World = Awaited<ReturnType<typeof live>>;
const recordEdit = (w: World, who: Who, path: string, callId: string) =>
  w.run("board.record-edit", who, {
    toolCallId: callId,
    operation: "write",
    canonicalPath: path,
    mode: "create",
    token: { size: 1, digest: "d" },
  });
const check = (w: World, who: Who, path: string) =>
  w.run("board.check-write", who, {
    toolCallId: "t1",
    operation: "write",
    canonicalPath: path,
    mode: "replace",
  });
interface StoredBoard {
  revision: number;
  sessions: Record<string, { state: string; edits: string[] }>;
  claims: Record<string, unknown>;
  markers: Record<string, { reason: string; sessionId: string }>;
}
const stored = (file: string): StoredBoard => JSON.parse(NodeFS.readFileSync(file, "utf8"));
const filesUnder = (dir: string): string[] =>
  NodeFS.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => NodePath.join(entry.parentPath, entry.name));
const unavailable = { status: "unavailable", code: "AWARENESS_UNAVAILABLE" };

describe("interrupted persistence", () => {
  it("an unwritable board folder makes record-edit unavailable, keeps the stored bytes and leaves no temporary file; a later record lands once", async () => {
    const w = await live([A, B]);
    expect(await recordEdit(w, B, NodePath.join(w.ws, "one.txt"), "e1")).toMatchObject({
      result: { recorded: true },
    });
    const before = NodeFS.readFileSync(w.file, "utf8");
    const folder = NodePath.dirname(w.file);
    NodeFS.chmodSync(folder, 0o500);
    try {
      const refused = await recordEdit(w, B, NodePath.join(w.ws, "two.txt"), "e2");
      expect(refused).toEqual(unavailable);
      expect(NodeFS.readFileSync(w.file, "utf8")).toBe(before);
      expect(NodeFS.readdirSync(folder)).toEqual([NodePath.basename(w.file)]);
    } finally {
      NodeFS.chmodSync(folder, 0o700);
    }
    expect(await recordEdit(w, B, NodePath.join(w.ws, "two.txt"), "e2")).toMatchObject({
      result: { recorded: true, duplicate: false },
    });
    expect(stored(w.file).revision).toBe(JSON.parse(before).revision + 1);
    expect(NodeFS.readdirSync(folder)).toEqual([NodePath.basename(w.file)]);
  });
});

describe("corruption", () => {
  const cases: [string, string][] = [
    ["invalid JSON", "{broken"],
    [
      "a newer version",
      JSON.stringify({ version: 2, revision: 9, sessions: {}, claims: {}, markers: {} }),
    ],
  ];
  it.each(cases)(
    "%s is refused on every path, preserved byte for byte and never repaired",
    async (_name, text) => {
      const w = await live([A, B]);
      await w.run("awareness.action", B, { action: "goal", text: "x" });
      NodeFS.writeFileSync(w.file, text);
      const target = NodePath.join(w.ws, "a.txt");
      expect(await check(w, A, target)).toEqual(unavailable);
      expect(await recordEdit(w, A, target, "e1")).toEqual(unavailable);
      expect(await w.run("awareness.action", A, { action: "status" })).toEqual(unavailable);
      expect(await w.run("awareness.summary", A, {})).toEqual(unavailable);
      expect(NodeFS.readFileSync(w.file, "utf8")).toBe(text);
      expect(NodeFS.readdirSync(NodePath.dirname(w.file))).toEqual([NodePath.basename(w.file)]);
      // A stop observed meanwhile cannot close anything on a board that cannot be read.
      await w.service.ingest(sessionEvent(B.thread, "stopped", w.ws));
      await w.service.board.settled();
      expect(NodeFS.readFileSync(w.file, "utf8")).toBe(text);
      // The drain does not call it closed: the board is reported still live and the bytes stay.
      const report = await w.service.dispose("corruption");
      expect(report.ok).toBe(false);
      expect(report.stillLive.map((entry) => entry.item)).toEqual([
        `backend-awareness.board:${w.ws}`,
      ]);
      expect(NodeFS.readFileSync(w.file, "utf8")).toBe(text);
    },
  );

  it("a restart over a refused board reports the start reconcile unavailable, preserves the bytes and reconciles at first use once the board is readable", async () => {
    const ws = workspaceDir();
    const first = await live([B], {}, ws);
    const target = NodePath.join(ws, "b.txt");
    await recordEdit(first, B, target, "e1");
    const good = NodeFS.readFileSync(first.file, "utf8");
    NodeFS.writeFileSync(first.file, "{broken");
    await first.service.dispose("restart");

    const second = make({}, first.stateRoot);
    await second.service.start();
    expect(second.service.board.reconciled()).toEqual([
      { workspace: ws, result: { status: "unavailable", detail: expect.any(String) } },
    ]);
    expect(NodeFS.readFileSync(first.file, "utf8")).toBe("{broken");
    NodeFS.writeFileSync(first.file, good);
    second.service.setReplayHorizon(sequence);
    await second.service.ingest(sessionEvent(THREAD, "running", ws));
    await second.service.ingest(threadEvent(THREAD, SESSION));
    expect(
      await second.run("board.check-write", A, {
        toolCallId: "t",
        operation: "write",
        canonicalPath: target,
        mode: "replace",
      }),
    ).toMatchObject({ result: { verdict: "allowed" } });
    expect(stored(first.file).sessions[SESSION_B]?.state).toBe("closed");
  });
});

describe("close on stop", () => {
  const stopB = async (w: World, status: "stopped" | "error" = "stopped") => {
    await w.service.ingest(sessionEvent(B.thread, status, w.ws));
    await w.service.board.settled();
  };

  it("outside Git, a stopped session is closed: its claims go and every edit stays as a marker; a running peer is untouched", async () => {
    const w = await live([A, B]);
    await w.run("awareness.action", A, { action: "goal", text: "peer" });
    await w.run("awareness.action", B, { action: "claim", path: "c.txt", idea: "mine" });
    const edit = NodePath.join(w.ws, "e.txt");
    await recordEdit(w, B, edit, "e1");
    await stopB(w);
    const board = stored(w.file);
    expect(board.sessions[SESSION_B]).toMatchObject({ state: "closed", edits: [edit] });
    expect(board.sessions[SESSION]?.state).toBe("open");
    expect(board.claims).toEqual({});
    expect(board.markers[edit]).toMatchObject({ reason: "closed", sessionId: SESSION_B });
  });

  it("in a real Git repository only the still-changed file keeps a marker", async () => {
    const ws = workspaceDir();
    const gitIn = (...args: string[]) =>
      NodeChildProcess.execFileSync(
        "git",
        ["-C", ws, "-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
        { stdio: "ignore" },
      );
    gitIn("init", "-q");
    NodeFS.writeFileSync(NodePath.join(ws, "clean.txt"), "committed\n");
    gitIn("add", "clean.txt");
    gitIn("commit", "-q", "-m", "base");
    NodeFS.writeFileSync(NodePath.join(ws, "changed.txt"), "uncommitted\n");
    const w = await live([B], { git: createGit() }, ws);
    const changed = NodePath.join(ws, "changed.txt");
    const clean = NodePath.join(ws, "clean.txt");
    await recordEdit(w, B, changed, "e1");
    await recordEdit(w, B, clean, "e2");
    await stopB(w);
    const board = stored(w.file);
    expect(board.sessions[SESSION_B]).toMatchObject({ state: "closed", edits: [changed] });
    expect(Object.keys(board.markers)).toEqual([changed]);
  });

  it("a crash closes the session with the reason crashed", async () => {
    const w = await live([B]);
    const edit = NodePath.join(w.ws, "e.txt");
    await recordEdit(w, B, edit, "e1");
    await stopB(w, "error");
    expect(stored(w.file).markers[edit]).toMatchObject({ reason: "crashed" });
  });

  it("unknown Git defers a session with edits (left open, no marker invented) and still closes one with nothing to judge", async () => {
    const answer: { value: ChangedFiles } = { value: { status: "unknown", detail: "git is down" } };
    const w = await live([A, B], { git: git(() => answer.value) });
    const edit = NodePath.join(w.ws, "e.txt");
    await recordEdit(w, B, edit, "e1");
    await w.run("awareness.action", A, { action: "goal", text: "no edits" });
    await stopB(w);
    let board = stored(w.file);
    expect(board.sessions[SESSION_B]).toMatchObject({ state: "open", edits: [edit] });
    expect(board.markers).toEqual({});
    await w.service.ingest(sessionEvent(A.thread, "stopped", w.ws));
    await w.service.board.settled();
    board = stored(w.file);
    expect(board.sessions[SESSION]?.state).toBe("closed");
    expect(board.sessions[SESSION_B]?.state).toBe("open");
    // The drain finishes it once Git can answer.
    answer.value = { status: "known", paths: new Set([edit]) };
    const report = await w.service.dispose("later");
    expect(report.ok).toBe(true);
    expect(stored(w.file).markers[edit]).toMatchObject({ sessionId: SESSION_B });
  });

  it("a child thread's stop, an unbound thread's stop and a stop after the drain close and write nothing", async () => {
    const child = { thread: THREAD_C, session: SESSION_C, kind: "child" as const, root: SESSION_B };
    const w = await live([B, child]);
    await recordEdit(w, B, NodePath.join(w.ws, "e.txt"), "e1");
    const before = NodeFS.readFileSync(w.file, "utf8");
    await w.service.ingest(sessionEvent(THREAD_C, "stopped", w.ws));
    await w.service.ingest(sessionEvent("mcp:never-bound", "stopped", w.ws));
    await w.service.board.settled();
    expect(NodeFS.readFileSync(w.file, "utf8")).toBe(before);
    expect(stored(w.file).sessions[SESSION_B]?.state).toBe("open");
    await w.service.dispose("done");
    const afterDrain = NodeFS.readFileSync(w.file, "utf8");
    await w.service.ingest(sessionEvent(B.thread, "stopped", w.ws));
    await w.service.board.settled();
    expect(NodeFS.readFileSync(w.file, "utf8")).toBe(afterDrain);
  });

  it("an observer failure never reaches the feed: a throwing Git port makes the session deferred, ingest resolves and liveness still shows the stop", async () => {
    const w = await live([B], {
      git: git(() => {
        throw new Error("spawn failed");
      }),
    });
    await recordEdit(w, B, NodePath.join(w.ws, "e.txt"), "e1");
    await expect(
      w.service.ingest(sessionEvent(B.thread, "stopped", w.ws)),
    ).resolves.toBeUndefined();
    await w.service.board.settled();
    expect(w.service.liveness.status(B.thread).kind).toBe("stopped");
    expect(stored(w.file).sessions[SESSION_B]?.state).toBe("open");
  });
});

describe("drain and disposal", () => {
  it("closes every open session by the one policy, reports clean, and leaves no live session, temporary file or lock", async () => {
    const w = await live([A, B]);
    await w.run("awareness.action", A, { action: "claim", path: "a.txt", idea: "x" });
    const edit = NodePath.join(w.ws, "e.txt");
    await recordEdit(w, B, edit, "e1");
    const report = await w.service.dispose("test");
    expect(report.ok).toBe(true);
    expect(report.stillLive).toEqual([]);
    const board = stored(w.file);
    expect(Object.values(board.sessions).map((session) => session.state)).toEqual([
      "closed",
      "closed",
    ]);
    expect(board.claims).toEqual({});
    expect(board.markers[edit]).toMatchObject({ reason: "closed", sessionId: SESSION_B });
    const leftovers = filesUnder(w.stateRoot).filter((file) => /\.(tmp|lock)$|\.tmp-/.test(file));
    expect(leftovers).toEqual([]);
    expect(w.service.status().disposal).toMatchObject({ ok: true, stillLive: 0 });
  });

  it("unknown Git at dispose leaves the session with edits open and reports it still live: the dispose is not ok", async () => {
    const w = await live([B], { git: git(() => ({ status: "unknown", detail: "git is down" })) });
    const edit = NodePath.join(w.ws, "e.txt");
    await recordEdit(w, B, edit, "e1");
    const report = await w.service.dispose("test");
    expect(report.ok).toBe(false);
    expect(report.stillLive.map((entry) => entry.item)).toEqual([
      `backend-awareness.session:${SESSION_B}`,
    ]);
    expect(stored(w.file).sessions[SESSION_B]).toMatchObject({ state: "open", edits: [edit] });
    expect(stored(w.file).markers).toEqual({});
  });

  it("repeated dispose returns the one report and writes nothing more", async () => {
    const w = await live([B]);
    await recordEdit(w, B, NodePath.join(w.ws, "e.txt"), "e1");
    const first = await w.service.dispose("first");
    const bytes = NodeFS.readFileSync(w.file, "utf8");
    const second = await w.service.dispose("second");
    expect(second).toBe(first);
    expect(NodeFS.readFileSync(w.file, "utf8")).toBe(bytes);
    expect(await check(w, B, NodePath.join(w.ws, "e.txt"))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  });

  it("restart after a clean dispose finds nothing open, changes no byte, and a resumed session gets its own closed markers released", async () => {
    const ws = workspaceDir();
    const first = await live([B], {}, ws);
    const edit = NodePath.join(ws, "e.txt");
    await recordEdit(first, B, edit, "e1");
    await first.service.dispose("restart");
    expect(stored(first.file).markers[edit]).toMatchObject({ reason: "closed" });
    const bytes = NodeFS.readFileSync(first.file, "utf8");
    const second = make({}, first.stateRoot);
    await second.service.start();
    expect(NodeFS.readFileSync(first.file, "utf8")).toBe(bytes);
    second.service.setReplayHorizon(sequence);
    await second.service.ingest(sessionEvent(B.thread, "running", ws));
    await second.service.ingest(threadEvent(B.thread, SESSION_B));
    await second.run("awareness.action", B, { action: "goal", text: "resumed" });
    const board = stored(first.file);
    expect(board.sessions[SESSION_B]?.state).toBe("open");
    expect(board.markers[edit]).toBeUndefined();
    expect(board.sessions[SESSION_B]?.edits).toEqual([edit]);
  });

  it("a pending operation at drain is awaited: the drain settles only after it, the record stands, and nothing is left live", async () => {
    const stateRoot = rootOf();
    const ws = workspaceDir();
    const index = createThreadIndex({ stateRoot, now: () => clock.t, projectRootOf: (f) => f });
    const bound = index.bind({
      threadId: B.thread,
      providerInstanceId: "pi",
      providerSessionId: "c2",
      sessionFile: sessionFileOf(SESSION_B),
      workingFolder: ws,
    });
    expect(bound.ok).toBe(true);
    const liveness = createLivenessService({ now: () => clock.t });
    const gate: { open: () => void; entered: () => void } = { open: () => {}, entered: () => {} };
    const released = new Promise<void>((resolve) => (gate.open = resolve));
    const entered = new Promise<void>((resolve) => (gate.entered = resolve));
    const runtime = createBoardRuntime({
      stateRoot,
      index,
      liveness,
      config: (() => {
        const parsed = parseAwarenessConfig(undefined);
        if (!parsed.ok) throw new Error("config");
        return parsed.config;
      })(),
      now: () => clock.t,
      git: outsideGit,
      storageFor: (workspace) => {
        const real = createFileBoardStorage({ stateRoot, workspace });
        return {
          ...real,
          replace: async (board) => {
            gate.entered();
            await released;
            return real.replace(board);
          },
        };
      },
    });
    runtime.setReplayHorizon(0);
    liveness.ingest({
      sequence: 1,
      type: "provider-session.updated",
      threadId: B.thread,
      payload: { id: runtimeOf(B.thread), status: "running" },
    });
    const edit = NodePath.join(ws, "e.txt");
    const pending = runtime.operations()["board.record-edit"]!(
      ctx(B, {
        toolCallId: "e1",
        operation: "write",
        canonicalPath: edit,
        mode: "create",
        token: { size: 1, digest: "d" },
      }),
    );
    await entered;
    let drained = false;
    const draining = runtime.drain().then((outcome) => {
      drained = true;
      return outcome;
    });
    // Several real I/O turns pass while the replacement is held: a drain that did not wait would have settled by now.
    for (let turn = 0; turn < 8; turn += 1) await NodeFS.promises.stat(stateRoot);
    expect(drained).toBe(false);
    gate.open();
    expect(await draining).toEqual({
      released: [`backend-awareness.board:${ws}`],
      stillLive: [],
    });
    expect(await pending).toMatchObject({ result: { recorded: true } });
    const board = stored(boardFileFor(stateRoot, ws));
    expect(board.sessions[SESSION_B]).toMatchObject({ state: "closed", edits: [edit] });
    expect(await runtime.drain()).toEqual({
      released: [`backend-awareness.board:${ws}`],
      stillLive: [],
    });
  });
});

describe("one writer", () => {
  it("exactly one module builds the board's file storage, the Backend source holds no native lock, and the board folder holds only the board", async () => {
    const sourceDir = NodePath.join(import.meta.dirname, "..");
    const sources = filesUnder(sourceDir).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith("testkit.ts"),
    );
    const builders = sources.filter((file) =>
      NodeFS.readFileSync(file, "utf8").includes("createFileBoardStorage("),
    );
    expect(builders.map((file) => NodePath.relative(sourceDir, file))).toEqual([
      NodePath.join("board", "runtime.ts"),
    ]);
    for (const file of sources)
      expect(NodeFS.readFileSync(file, "utf8"), file).not.toMatch(
        /flock|presence\.mjs|dsh\/packages/i,
      );
    const w = await live([A, B]);
    await recordEdit(w, B, NodePath.join(w.ws, "e.txt"), "e1");
    await w.service.dispose("done");
    expect(NodeFS.readdirSync(NodePath.dirname(w.file))).toEqual([NodePath.basename(w.file)]);
  });
});
