// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 20 — the Backend connects the board: named XC-6 operations over one board per workspace, with the caller taken from
// the thread binding and the real liveness service. Boundary: the real assembled service (thread index, liveness, file board under a real
// state root) and hand-fed stored events; Git is a named double answering "outside git". It shows cross-session collision with the holder named,
// a fresh read per check, assignee compared by id, main-only, outage and recovery, bounded summaries, stale pre-start evidence as unknown and
// reconciliation at start. It does not show identity resolution (steps 13, 16), the HTTP route or the Agent's tools.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createAetheriaBackendService } from "../service.ts";
import type { AetheriaBackendService, AetheriaBackendServiceOptions } from "../service.ts";
import type { HumanControlService } from "../humanControl.ts";
import type { StoredEventLike } from "../identity/feed.ts";
import { boardFileFor, createArchiveInteractionService } from "../library.ts";
import {
  DEAD_OWNER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  rootOf,
  sessionFileOf,
} from "../identity/testkit.ts";

const SESSION_C = "0197d3c0-3333-7000-8000-000000000003";
const THREAD_C = "mcp:88888888-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const LABEL_B = "00000002";
const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const workspaceDir = (): string => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-board-")));
  created.push(dir);
  return dir;
};

const outsideGit = {
  topLevel: async () => undefined,
  changedFiles: async () => ({ status: "outside-git" as const }),
};
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
const C: Who = { thread: THREAD_C, session: SESSION_C };
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

/** A started Backend whose replay horizon is "now", with the given threads bound in the workspace and running. */
async function live(whos: readonly Who[], options: Partial<AetheriaBackendServiceOptions> = {}) {
  const ws = workspaceDir();
  const w = make(options);
  expect((await w.service.start()).outcome).toBe("started");
  w.service.setReplayHorizon(sequence);
  for (const who of whos) {
    await w.service.ingest(sessionEvent(who.thread, "running", ws));
    await w.service.ingest(threadEvent(who.thread, who.session));
  }
  return { ...w, ws };
}
const act = (w: { run: ReturnType<typeof make>["run"] }, who: Who, args: Record<string, unknown>) =>
  w.run("awareness.action", who, args);
const check = (w: { run: ReturnType<typeof make>["run"] }, who: Who, path: string) =>
  w.run("board.check-write", who, {
    toolCallId: "t1",
    operation: "write",
    canonicalPath: path,
    mode: "replace",
  });

describe("collision across sessions", () => {
  it("refuses the second session's write naming the holder, reads the board fresh each time, and allows once the holder releases", async () => {
    const w = await live([A, B]);
    const target = NodePath.join(w.ws, "a.txt");
    const claim = await act(w, B, { action: "claim", path: "a.txt", idea: "tokenizer" });
    expect(claim).toMatchObject({ status: "done", result: { ok: true } });
    const refused = await check(w, A, target);
    expect(refused).toMatchObject({
      status: "done",
      result: { verdict: "refused", code: "AWARENESS_HELD" },
    });
    const detail = String((refused as { result: { detail: string } }).result.detail);
    expect(detail).toContain(`session "${LABEL_B}" (active) — tokenizer`);
    const claimId = (claim as { result: { claim: { claimId: string } } }).result.claim.claimId;
    await act(w, B, { action: "release", claimId });
    expect(await check(w, A, target)).toMatchObject({
      result: { verdict: "allowed", governed: true },
    });
    expect(await check(w, A, NodePath.join(NodeOS.tmpdir(), "elsewhere.txt"))).toMatchObject({
      result: { verdict: "allowed", governed: false },
    });
  });

  it("records an edit idempotently per call id on the root session, and the edit then guards the path", async () => {
    const w = await live([A, B]);
    const target = NodePath.join(w.ws, "b.txt");
    const record = {
      toolCallId: "e1",
      operation: "edit",
      canonicalPath: target,
      mode: "replace",
      token: { size: 4, digest: "d" },
    };
    expect(await w.run("board.record-edit", B, record)).toMatchObject({
      result: { recorded: true, duplicate: false },
    });
    expect(await w.run("board.record-edit", B, record)).toMatchObject({
      result: { recorded: true, duplicate: true },
    });
    const child = { thread: THREAD_C, session: SESSION_C, kind: "child" as const, root: SESSION_B };
    await w.service.ingest(sessionEvent(THREAD_C, "running", w.ws));
    await w.service.ingest(threadEvent(THREAD_C, SESSION_C));
    expect(
      await w.run("board.record-edit", child, {
        ...record,
        toolCallId: "e2",
        canonicalPath: NodePath.join(w.ws, "c.txt"),
      }),
    ).toMatchObject({
      result: { duplicate: false },
    });
    const status = await act(w, B, { action: "status" });
    expect((status as { result: { you: { edits: string[] } } }).result.you.edits).toEqual([
      target,
      NodePath.join(w.ws, "c.txt"),
    ]);
    expect(await check(w, A, target)).toMatchObject({
      result: { verdict: "refused", code: "AWARENESS_HELD" },
    });
  });
});

describe("assignment by identity, and main authority", () => {
  it("compares the assignee by XC-1 id: the assigned child and the main pass, a sibling is refused; production assign is unavailable naming XC-10", async () => {
    const w = await live([A, B, C], { childStatus: async () => ({ owned: true, state: "idle" }) });
    const claimed = await act(w, A, { action: "claim", path: "a.txt", idea: "x" });
    const claimId = (claimed as { result: { claim: { claimId: string } } }).result.claim.claimId;
    expect(await act(w, A, { action: "assign", claimId, agentId: SESSION_B })).toMatchObject({
      result: { ok: true },
    });
    const target = NodePath.join(w.ws, "a.txt");
    expect(await check(w, { ...B, kind: "child", root: SESSION }, target)).toMatchObject({
      result: { verdict: "allowed" },
    });
    expect(await check(w, A, target)).toMatchObject({ result: { verdict: "allowed" } });
    const sibling = await check(w, { ...C, kind: "child", root: SESSION }, target);
    expect(sibling).toMatchObject({ result: { verdict: "refused", code: "AWARENESS_ASSIGNED" } });
    expect(String((sibling as { result: { detail: string } }).result.detail)).toContain(SESSION_B);

    const production = await live([A, B]);
    const mine = await act(production, A, { action: "claim", path: "a.txt", idea: "x" });
    const id = (mine as { result: { claim: { claimId: string } } }).result.claim.claimId;
    expect(await act(production, A, { action: "assign", claimId: id, agentId: SESSION_B })).toEqual(
      {
        status: "unavailable",
        code: "XC10_CHILD_STATUS_UNAVAILABLE",
      },
    );
  });

  it("refuses a child at execution, refuses a named caller key, and changes nothing", async () => {
    const w = await live([A, B]);
    const child = { ...B, kind: "child" as const, root: SESSION };
    expect(await act(w, child, { action: "goal", text: "x" })).toMatchObject({
      result: { ok: false, code: "AWARENESS_NOT_MAIN" },
    });
    expect(await act(w, A, { action: "goal", text: "x", sessionId: SESSION_B })).toMatchObject({
      result: { ok: false, code: "AWARENESS_INVALID", field: "sessionId" },
    });
    expect(
      await w
        .run("board.check-write", A, {
          toolCallId: "t",
          operation: "write",
          canonicalPath: "/x",
          mode: "replace",
          sessionId: "s",
        })
        .catch(() => "threw"),
    ).toBe("threw");
    expect(NodeFS.existsSync(boardFileFor(w.stateRoot, w.ws))).toBe(false);
  });
});

// M06 step 26 (D13, D20): resolve on the REAL interaction service's verified answers, through the assembled Backend; T3's client auth is not shown.
// The eight DSH rows are ported in tests/awareness/board/resolve.test.mjs; here: wiring, advice, outage, restart, an unchanged board on failure.
const humanClient = {
  actor: {
    clientSessionId: "device-1",
    grantedScopes: ["orchestration:operate"],
    authenticatedAt: "2026-11-10T12:00:00.000Z",
  },
};
const batch = [{ id: "q1", question: "Decide?", options: [{ label: "Yes" }, { label: "No" }] }];
const yes = [{ id: "q1", selected: ["Yes"], skipped: false }];
type Interactions = NonNullable<ReturnType<AetheriaBackendService["interactions"]>>;
type Asked = { interactionId: string; revision: string };
const interactionsOf = (w: { service: AetheriaBackendService }): Interactions => {
  const service = w.service.interactions();
  if (service === undefined) throw new Error("the interaction service is not running");
  return service;
};
const ask = async (w: { service: AetheriaBackendService }, who: Who, callId: string) => {
  clock.t += 10;
  const out = await interactionsOf(w).create(
    { sessionId: who.session, rootSessionId: who.root ?? who.session, kind: who.kind ?? "main" },
    { kind: "question", callId, questions: batch } as never,
  );
  expect(out.ok).toBe(true);
  return (out as unknown as { value: Asked }).value;
};
const answerIt = async (w: { service: AetheriaBackendService }, question: Asked) => {
  clock.t += 10;
  const out = await interactionsOf(w).answer(humanClient, {
    interactionId: question.interactionId,
    revision: question.revision,
    answers: yes as never,
  });
  expect(out.ok).toBe(true);
  return (out as unknown as { value: { resolution: { originId: string } } }).value.resolution
    .originId;
};
const boardText = (w: { stateRoot: string; ws: string }): string =>
  NodeFS.readFileSync(boardFileFor(w.stateRoot, w.ws), "utf8");
const boardOf = (w: { stateRoot: string; ws: string }) =>
  JSON.parse(boardText(w)) as {
    decisions: { kind: string; askCallId: string; answer: string }[];
    claims: Record<string, { sharedWith: string[] }>;
  };
const share = (callId: string) => ({
  action: "resolve",
  decision: "overlap",
  path: "a.txt",
  answer: "share",
  askCallId: callId,
});

describe("resolve on a verified human answer (XC-8)", () => {
  it("offers resolve in its advice, refuses an unanswered question without a change, and records the decision once a client has answered the same question", async () => {
    const w = await live([A, B]);
    const target = NodePath.join(w.ws, "a.txt");
    await act(w, B, { action: "claim", path: "a.txt", idea: "tokenizer" });
    const refused = await check(w, A, target);
    expect(String((refused as { result: { detail: string } }).result.detail)).toContain(
      "awareness resolve",
    );
    const claimText = await act(w, A, { action: "claim", path: "a.txt", idea: "mine" });
    expect(String((claimText as { result: { message: string } }).result.message)).toContain(
      'then call awareness resolve {decision: "overlap"',
    );
    const question = await ask(w, A, "ask-1");
    const before = boardText(w);
    expect(await act(w, A, share("ask-1"))).toMatchObject({
      status: "done",
      result: { ok: false, code: "AWARENESS_UNVERIFIED" },
    });
    expect(boardText(w)).toBe(before);
    await answerIt(w, question);
    const done = await act(w, A, share("ask-1"));
    expect(done).toMatchObject({ status: "done", result: { ok: true, sharedWith: [SESSION_B] } });
    expect(boardOf(w).decisions).toMatchObject([
      { kind: "overlap", askCallId: "ask-1", answer: "share" },
    ]);
    expect(await check(w, A, target)).toMatchObject({ result: { verdict: "allowed" } });
    expect(await check(w, B, target)).toMatchObject({ result: { verdict: "allowed" } });
  });

  it("is unavailable naming XC-8 while the origin cannot be read, changes nothing, and succeeds on the same request once it can", async () => {
    const w = await live([A, B]);
    await act(w, B, { action: "claim", path: "a.txt", idea: "tokenizer" });
    await check(w, A, NodePath.join(w.ws, "a.txt"));
    const originId = await answerIt(w, await ask(w, A, "ask-1"));
    const originFile = NodePath.join(w.stateRoot, "interactions", "origins", `${originId}.json`);
    const good = NodeFS.readFileSync(originFile, "utf8");
    NodeFS.writeFileSync(originFile, "{broken");
    const before = boardText(w);
    expect(await act(w, A, share("ask-1"))).toEqual({
      status: "unavailable",
      code: "XC8_DECISION_EVIDENCE_UNAVAILABLE",
    });
    expect(boardText(w)).toBe(before);
    NodeFS.writeFileSync(originFile, good);
    expect(await act(w, A, share("ask-1"))).toMatchObject({ result: { ok: true } });
  });

  it("is unavailable naming XC-8 when the running interaction service offers no question evidence", async () => {
    const w = await live([A, B], {
      interactionFactory: (deps) => {
        const { questionEvidence: _gone, ...rest } = createArchiveInteractionService(
          deps,
        ) as unknown as Record<string, unknown>;
        return rest as unknown as HumanControlService;
      },
    });
    await act(w, B, { action: "claim", path: "a.txt", idea: "tokenizer" });
    await check(w, A, NodePath.join(w.ws, "a.txt"));
    await answerIt(w, await ask(w, A, "ask-1"));
    const before = boardText(w);
    expect(await act(w, A, share("ask-1"))).toEqual({
      status: "unavailable",
      code: "XC8_DECISION_EVIDENCE_UNAVAILABLE",
    });
    expect(boardText(w)).toBe(before);
  });

  it("keeps the evidence across a restart while the persisted decision stays history: the refusal that owed it died with the process", async () => {
    const w = await live([A, B]);
    await act(w, B, { action: "claim", path: "a.txt", idea: "tokenizer" });
    await check(w, A, NodePath.join(w.ws, "a.txt"));
    await answerIt(w, await ask(w, A, "ask-1"));
    expect(await act(w, A, share("ask-1"))).toMatchObject({ result: { ok: true } });
    const report = await w.service.dispose("restart");
    expect(report.ok).toBe(true);

    const second = make({}, w.stateRoot);
    expect((await second.service.start()).outcome).toBe("started");
    second.service.setReplayHorizon(sequence);
    for (const who of [A, B]) {
      await second.service.ingest(sessionEvent(who.thread, "running", w.ws));
      await second.service.ingest(threadEvent(who.thread, who.session));
    }
    const evidence = await (
      interactionsOf(second) as Interactions & {
        questionEvidence(args: {
          rootSessionId: string;
          askCallId: string;
          askerSessionId: string;
        }): Promise<{ ok: boolean; value?: { answered: boolean } }>;
      }
    ).questionEvidence({ rootSessionId: SESSION, askCallId: "ask-1", askerSessionId: SESSION });
    expect(evidence).toMatchObject({ ok: true, value: { answered: true } });
    const before = boardText(w);
    expect(await act(second, A, share("ask-1"))).toMatchObject({
      status: "done",
      result: { ok: false, code: "AWARENESS_UNVERIFIED" },
    });
    expect(boardText(w)).toBe(before);
    expect(boardOf(w).decisions).toHaveLength(1);
  });
});

describe("outage and recovery", () => {
  it("answers unavailable on every path while the board file is unreadable, replaces nothing, and answers again once it is readable", async () => {
    const w = await live([A, B]);
    await act(w, B, { action: "goal", text: "first" });
    const file = boardFileFor(w.stateRoot, w.ws);
    const good = NodeFS.readFileSync(file, "utf8");
    NodeFS.writeFileSync(file, "{broken");
    const unavailable = { status: "unavailable", code: "AWARENESS_UNAVAILABLE" };
    expect(await check(w, A, NodePath.join(w.ws, "a.txt"))).toEqual(unavailable);
    expect(await act(w, A, { action: "status" })).toEqual(unavailable);
    expect(await act(w, A, { action: "goal", text: "x" })).toEqual(unavailable);
    expect(await w.run("awareness.summary", A, {})).toEqual(unavailable);
    const record = {
      toolCallId: "e",
      operation: "write",
      canonicalPath: NodePath.join(w.ws, "a.txt"),
      mode: "create",
      token: { size: 1, digest: "d" },
    };
    expect(await w.run("board.record-edit", A, record)).toEqual(unavailable);
    expect(NodeFS.readFileSync(file, "utf8")).toBe("{broken");
    NodeFS.writeFileSync(file, good);
    expect(await check(w, A, NodePath.join(w.ws, "a.txt"))).toMatchObject({
      result: { verdict: "allowed" },
    });
    expect(await w.run("board.record-edit", A, record)).toMatchObject({
      result: { recorded: true, duplicate: false },
    });
  });
});

describe("the bounded summary", () => {
  it("derives and renders the peer view within the configured bytes, tells it once, and refuses a cap below 512", async () => {
    const w = await live([A, B], { awareness: { summaryMaxBytes: 512 } });
    await act(w, B, { action: "goal", text: "é".repeat(900) });
    const first = await w.run("awareness.summary", A, {});
    const text = (first as { result: { text: string; bytes: number } }).result;
    expect(Buffer.byteLength(text.text, "utf8")).toBeLessThanOrEqual(512);
    expect(text.bytes).toBe(Buffer.byteLength(text.text, "utf8"));
    expect(text.text).toMatch(/^Awareness — workspace /);
    expect(await w.run("awareness.summary", A, {})).toMatchObject({ result: { text: null } });
    await expect(w.run("awareness.summary", A, { sessionId: "x" })).rejects.toThrow();
    const refused = createAetheriaBackendService({
      stateRoot: rootOf(),
      credentialOf: () => undefined,
      awareness: { summaryMaxBytes: 100 },
    });
    expect(refused.outcome).toBe("refused");
  });
});

describe("evidence from before this Backend started is unknown", () => {
  it("does not let a replayed running state block, and lets a live one block", async () => {
    const ws = workspaceDir();
    const w = make();
    await w.service.start();
    // The feed replays the whole log: these events carry sequences at or below the horizon read just before subscribing.
    await w.service.ingest(sessionEvent(THREAD_B, "running", ws));
    await w.service.ingest(threadEvent(THREAD_B, SESSION_B));
    await w.service.ingest(sessionEvent(THREAD, "ready", ws));
    await w.service.ingest(threadEvent(THREAD, SESSION));
    w.service.setReplayHorizon(sequence);
    await act(w, B, { action: "claim", path: "a.txt", idea: "old" });
    const target = NodePath.join(ws, "a.txt");
    expect(await check(w, A, target)).toMatchObject({
      result: { verdict: "allowed", takenOver: 1 },
    });
    await act(w, B, { action: "claim", path: "a.txt", idea: "new" });
    await w.service.ingest(sessionEvent(THREAD_B, "running", ws));
    expect(await check(w, A, target)).toMatchObject({ result: { verdict: "refused" } });
  });
});

describe("reconciliation at start", () => {
  it("closes a session the restarted Backend cannot show to be live after an unclean death, as crashed, dropping its claims and keeping an edit marker (outside git)", async () => {
    const ws = workspaceDir();
    const first = make();
    await first.service.start();
    first.service.setReplayHorizon(sequence);
    await first.service.ingest(sessionEvent(THREAD_B, "running", ws));
    await first.service.ingest(threadEvent(THREAD_B, SESSION_B));
    await first.run("awareness.action", B, { action: "claim", path: "a.txt", idea: "mine" });
    const target = NodePath.join(ws, "a.txt");
    await first.run("board.record-edit", B, {
      toolCallId: "e",
      operation: "write",
      canonicalPath: target,
      mode: "create",
      token: { size: 1, digest: "d" },
    });
    // The first Backend dies without draining (step 22: a clean dispose now closes its sessions itself, as `closed`; see lifecycle.aetheria.test.ts).
    // Its state-root lock is left behind; the second Backend takes it over only because the probe proves that process gone (staleAfterMs 0: no clock waiting).
    const second = make({ ownerLock: DEAD_OWNER }, first.stateRoot);
    expect((await second.service.start()).outcome).toBe("started");
    const board = JSON.parse(NodeFS.readFileSync(boardFileFor(first.stateRoot, ws), "utf8")) as {
      sessions: Record<string, { state: string }>;
      claims: Record<string, unknown>;
      markers: Record<string, { reason: string }>;
    };
    expect(board.sessions[SESSION_B]?.state).toBe("closed");
    expect(board.claims).toEqual({});
    expect(board.markers[target]).toMatchObject({ reason: "crashed" });
    // No liveness evidence yet: the marker belongs to a session that is not running, so a writer takes it over with a notice.
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
    ).toMatchObject({
      result: { verdict: "allowed", takenOver: 1 },
    });
  });
});

const shell = (w: { run: ReturnType<typeof make>["run"] }, who: Who, args: unknown) =>
  w.run("board.record-shell", who, args as Record<string, unknown>);

describe("board.record-shell", () => {
  it("records a session's shell change on its root, and a peer's summary shows it as not guarded without any claim", async () => {
    const w = await live([A, B]);
    const changed = NodePath.join(w.ws, "x.txt");
    expect(await shell(w, A, { paths: [changed], outcome: "changed" })).toEqual({
      status: "done",
      result: { recorded: true, count: 1 },
    });
    const summary = await w.run("awareness.summary", B, {});
    const text = (summary as { result: { text: string } }).result.text;
    expect(text).toContain(`changed via shell (not guarded): ${changed}`);
    expect(await check(w, B, changed)).toMatchObject({
      result: { verdict: "allowed", governed: true, takenOver: 0 },
    });
    const board = JSON.parse(NodeFS.readFileSync(boardFileFor(w.stateRoot, w.ws), "utf8")) as {
      claims: Record<string, unknown>;
      markers: Record<string, unknown>;
      sessions: Record<string, { edits: string[] }>;
    };
    expect([board.claims, board.markers, board.sessions[SESSION]?.edits]).toEqual([{}, {}, []]);
  });

  it("lands a child's record on its root session and records an unknown outcome", async () => {
    const w = await live([A, C]);
    const child = { ...C, kind: "child" as const, root: SESSION };
    await shell(w, child, { paths: [NodePath.join(w.ws, "c.txt")], outcome: "changed" });
    await shell(w, child, { paths: [], outcome: "unknown" });
    const board = JSON.parse(NodeFS.readFileSync(boardFileFor(w.stateRoot, w.ws), "utf8")) as {
      sessions: Record<string, { shell?: unknown }>;
    };
    expect(board.sessions[SESSION]?.shell).toEqual({
      changed: [NodePath.join(w.ws, "c.txt")],
      unknown: true,
    });
    expect(board.sessions[SESSION_C]).toBeUndefined();
  });

  it("refuses an outside or non-canonical path as a done value, stores nothing, and throws on a wrong shape", async () => {
    const w = await live([A]);
    const outside = await shell(w, A, { paths: ["/etc/hosts"], outcome: "changed" });
    expect(outside).toMatchObject({
      status: "done",
      result: { recorded: false, code: "AWARENESS_INVALID" },
    });
    const dotted = `${w.ws}/d/../x.txt`;
    expect(await shell(w, A, { paths: [dotted], outcome: "changed" })).toMatchObject({
      result: { recorded: false, code: "AWARENESS_INVALID" },
    });
    expect(NodeFS.existsSync(boardFileFor(w.stateRoot, w.ws))).toBe(false);
    await expect(shell(w, A, { paths: [], outcome: "changed" })).rejects.toThrow();
    await expect(
      shell(w, A, { paths: [NodePath.join(w.ws, "x")], outcome: "changed", sessionId: "s" }),
    ).rejects.toThrow();
  });

  it("answers unavailable for a session with no workspace and while the board is unreadable, then records once it is readable", async () => {
    const w = await live([A, B]);
    const unavailable = { status: "unavailable", code: "AWARENESS_UNAVAILABLE" };
    const target = NodePath.join(w.ws, "x.txt");
    expect(await shell(w, C, { paths: [target], outcome: "changed" })).toEqual(unavailable);
    await act(w, B, { action: "goal", text: "first" });
    const file = boardFileFor(w.stateRoot, w.ws);
    const good = NodeFS.readFileSync(file, "utf8");
    NodeFS.writeFileSync(file, "{broken");
    expect(await shell(w, A, { paths: [target], outcome: "changed" })).toEqual(unavailable);
    expect(NodeFS.readFileSync(file, "utf8")).toBe("{broken");
    NodeFS.writeFileSync(file, good);
    expect(await shell(w, A, { paths: [target], outcome: "changed" })).toMatchObject({
      result: { recorded: true, count: 1 },
    });
  });
});

describe("drain", () => {
  it("drains the boards with the Backend: clean report, operations unavailable afterwards", async () => {
    const w = await live([A]);
    await act(w, A, { action: "goal", text: "x" });
    const report = await w.service.dispose("test");
    expect(report.ok).toBe(true);
    expect(report.stillLive).toEqual([]);
    expect(await check(w, A, NodePath.join(w.ws, "a.txt"))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  });

  it("answers a shell record unavailable once drained, and records nothing", async () => {
    const w = await live([A]);
    await w.service.dispose("test");
    expect(
      await shell(w, A, { paths: [NodePath.join(w.ws, "x.txt")], outcome: "changed" }),
    ).toEqual({ status: "unavailable", code: "XC6_BACKEND_NOT_RUNNING" });
    expect(NodeFS.existsSync(boardFileFor(w.stateRoot, w.ws))).toBe(false);
  });
});
