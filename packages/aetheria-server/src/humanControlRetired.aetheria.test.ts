// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M06/M05 drill D4 (round 8) — a thread whose first Pi session was replaced still shows the question that session left open.
//
// Boundary: the real thread index (real files in a scratch state root) and the real session-access rule, under the production interaction service over the
// INSTALLED archive and its real file store; only T3's turn delivery is a recording double. It shows: the question created under the replaced session A is
// still read through A after the thread rebinds to B; a late answer to it is delivered to the thread (one dispatch, to the thread's live session); an
// unknown session and a stranger's thread stay refused; the live-only resolver, which every launch, steer and notice path uses, refuses A. It does NOT show
// the client RPC handlers (apps/server's suites) or that the running Backend wires this rule into the service (service.ts's one use of it is type-checked).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type {
  HumanControlService,
  HumanControlServiceDeps,
  SessionDirectory,
  ThreadTurnDispatch,
} from "./humanControl.ts";
import { createSessionAccess } from "./identity/sessionAccess.ts";
import { createThreadIndex } from "./identity/threadIndex.ts";
import { FOLDER, SESSION, SESSION_B, THREAD, THREAD_B, sessionFileOf } from "./identity/testkit.ts";
import { createArchiveInteractionService } from "./library.ts";

const OPERATOR = {
  actor: {
    clientSessionId: "device-1",
    grantedScopes: ["orchestration:operate", "orchestration:read"],
    authenticatedAt: "2026-11-11T00:00:00.000Z",
  },
} as const;
const ASKER = { sessionId: SESSION, rootSessionId: SESSION, kind: "main" } as const;
const QUESTIONS = [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }];

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const world = async () => {
  const stateRoot = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m06-retired-")),
  );
  NodeFS.chmodSync(stateRoot, 0o700);
  scratch.push(stateRoot);
  const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
  const access = createSessionAccess(index);
  const bind = (sessionId: string, providerSessionId: string, threadId = THREAD) =>
    expect(
      index.bind({
        threadId,
        providerSessionId,
        providerInstanceId: "pi",
        sessionFile: sessionFileOf(sessionId),
        workingFolder: FOLDER,
      }).ok,
    ).toBe(true);
  const dispatched: Array<{ commandId: string; threadId: string; text: string }> = [];
  const turnDispatch: ThreadTurnDispatch = {
    dispatch: async (request) => {
      dispatched.push(request);
      return { kind: "accepted" };
    },
    // T3's receipt store: a command it never saw is absent, one it took is accepted.
    receipt: async (commandId) =>
      dispatched.some((d) => d.commandId === commandId) ? { kind: "accepted" } : { kind: "absent" },
  };
  const sessions: SessionDirectory = {
    lookup: async (sessionId) =>
      sessionId === SESSION || sessionId === SESSION_B
        ? { kind: "found", sessionId, rootSessionId: sessionId }
        : { kind: "absent" },
  };
  const deps: HumanControlServiceDeps = {
    sessions,
    stateRoot,
    now: () => Date.parse("2026-11-11T00:00:00.000Z"),
    turnDispatch,
    canOperate: (_actor, target) => access.canOperate(target),
    threadOfSession: access.threadOf,
  };
  const started = async (): Promise<{
    service: HumanControlService;
    continued: readonly string[];
  }> => {
    const service: HumanControlService = createArchiveInteractionService(deps);
    const result = await service.start();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return { service, continued: result.ok ? result.value.continued : [] };
  };
  const { service } = await started();
  // A Backend restart: a second service over the same state root ends the waits no live segment holds, as `continued`.
  const restart = async () => (await started()).continued;
  return { index, access, bind, service, restart, dispatched, stateRoot };
};

describe("a replaced session's open question stays readable through its thread", () => {
  it("snapshot(A) still returns the question after the thread rebinds to B, and the access rule lets the connection read it", async () => {
    const w = await world();
    w.bind(SESSION, "prov-1");
    const created = await w.service.create(ASKER, {
      kind: "question",
      callId: "c1",
      questions: QUESTIONS,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    expect(
      await w.service.canAccess(OPERATOR.actor, { sessionId: SESSION, rootSessionId: SESSION }),
    ).toBe(true);

    w.bind(SESSION_B, "prov-2");
    expect(w.index.bindingOfSession(SESSION)).toBeUndefined();
    expect(
      await w.service.canAccess(OPERATOR.actor, { sessionId: SESSION, rootSessionId: SESSION }),
    ).toBe(true);
    const snap = await w.service.snapshot(SESSION);
    expect(snap.ok, JSON.stringify(snap)).toBe(true);
    const interactions = snap.ok ? ([...snap.value.interactions] as Array<{ kind: string }>) : [];
    expect(interactions.map((i) => i.kind)).toEqual(["question"]);
  });

  it("a late answer to the continued question resolves the thread and is delivered to it once", async () => {
    const w = await world();
    w.bind(SESSION, "prov-1");
    const created = await w.service.create(ASKER, {
      kind: "question",
      callId: "c1",
      questions: QUESTIONS,
    });
    expect(created.ok).toBe(true);
    w.bind(SESSION_B, "prov-2");
    const restarted = await w.restart();
    expect(restarted).toHaveLength(1);
    const snap = await w.service.snapshot(SESSION);
    const record = (snap.ok ? snap.value.interactions : [])[0] as {
      interactionId: string;
      revision: string;
      state: string;
    };
    expect(record.state).toBe("continued");
    const answered = await w.service.answer(OPERATOR, {
      interactionId: record.interactionId,
      revision: record.revision,
      answers: [{ id: "q1", selected: ["B"], skipped: false }],
    });
    expect(answered.ok, JSON.stringify(answered)).toBe(true);
    expect(w.dispatched.map((d) => d.threadId)).toEqual([THREAD]);
    expect(w.dispatched[0]?.commandId).toBe(`aetheria-answer:${record.interactionId}`);
  });

  it("refuses a session the index never knew, and a retired session whose thread was claimed by nothing", async () => {
    const w = await world();
    expect(w.access.canOperate({ sessionId: SESSION, rootSessionId: SESSION })).toBe(false);
    w.bind(SESSION, "prov-1");
    expect(
      w.access.canOperate({
        sessionId: SESSION,
        rootSessionId: "0197d3c0-9999-7000-8000-000000000009",
      }),
    ).toBe(false);
    expect(w.access.threadOf("0197d3c0-9999-7000-8000-000000000009")).toBeUndefined();
    // another thread cannot take over a replaced session's alias
    w.bind(SESSION_B, "prov-2");
    expect(
      w.index.bind({
        threadId: THREAD_B,
        providerSessionId: "prov-x",
        providerInstanceId: "pi",
        sessionFile: sessionFileOf(SESSION),
        workingFolder: FOLDER,
      }).ok,
    ).toBe(false);
    expect(w.access.threadOf(SESSION)).toBe(THREAD);
  });

  it("the live resolver, used by every launch, steer and notice path, refuses a replaced session", async () => {
    const w = await world();
    w.bind(SESSION, "prov-1");
    expect(w.access.liveThreadOf(SESSION)).toBe(THREAD);
    w.bind(SESSION_B, "prov-2");
    expect(w.access.liveThreadOf(SESSION)).toBeUndefined();
    expect(w.access.threadOf(SESSION)).toBe(THREAD);
    expect(w.access.liveThreadOf(SESSION_B)).toBe(THREAD);
  });
});
