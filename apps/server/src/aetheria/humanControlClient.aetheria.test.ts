// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDate:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off runEffectInsideEffect:off
/* oxlint-disable t3code/no-manual-effect-runtime-in-tests, t3code/no-real-time-wait-in-tests -- scripted clients are plain async code over a real service; a subscription becoming live is awaited by polling. */
// AETHERIA M06 step 16 (XC-18) — the real handlers over the REAL Backend service, archive service and file journal (bindings from the Backend's feed).
// Shows: reconnect-then-answer once, second-client settlement, hold/close/cancel, missed version and subscribe-then-snapshot, version across restart,
// unauthorized and cross-root clients changing nothing, a drain ending the stream.
// Does NOT show a real WebSocket, pairing, or live revocation (ws.ts closes the connection; a stripped actor stands for it here).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import {
  createAetheriaBackendService,
  type AetheriaBackendService,
} from "@t3tools/aetheria-server";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectionActor,
  interactionsAnswer,
  interactionsCancel,
  interactionsChanges,
  interactionsClose,
  interactionsHold,
  interactionsSnapshot,
  tasksGet,
} from "./humanControlRpc.ts";

type Json = Record<string, any>; // replies are checked field by field; the wire shapes are the contracts' own
const FOLDER = "/work/project";
const ROOT_A = "root-a";
const ROOT_B = "root-b";
const UNBOUND = "root-unbound";
const THREADS = new Map([
  ["thread:a", { runtime: "provider-session:a", session: ROOT_A }],
  ["thread:b", { runtime: "provider-session:b", session: ROOT_B }],
]);
const QUESTIONS = [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }];
const ANSWER = [{ id: "q1", selected: ["A"], skipped: false }];

const stateRoots: string[] = [];
const newStateRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, "m06-s16-client-"));
  stateRoots.push(root);
  return root;
};
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const startService = async (stateRoot: string): Promise<AetheriaBackendService> => {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => THREADS.get(threadId)?.runtime,
    projectRootOf: (folder) => folder,
  });
  if (made.outcome !== "prepared") throw new Error("the Backend must prepare");
  const started = await made.service.start();
  if (started.outcome !== "started")
    throw new Error(`the Backend did not start: ${started.outcome}`);
  let sequence = 0;
  for (const [threadId, { runtime, session }] of THREADS) {
    await made.service.ingest({
      sequence: (sequence += 1),
      event: {
        type: "provider-session.updated",
        threadId,
        payload: { id: runtime, providerInstanceId: "pi", status: "ready", cwd: FOLDER },
      },
    });
    await made.service.ingest({
      sequence: (sequence += 1),
      event: {
        type: "provider-thread.updated",
        threadId,
        payload: {
          driver: "pi",
          providerInstanceId: "pi",
          providerSessionId: runtime,
          appThreadId: threadId,
          nativeThreadRef: { nativeId: `/s/2026-11-08T08-00-00-000Z_${session}.jsonl` },
        },
      },
    });
  }
  return made.service;
};

const live: AetheriaBackendService[] = [];
afterEach(async () => {
  for (const service of live.splice(0)) await service.dispose("test").catch(() => undefined);
});
const world = async (stateRoot = newStateRoot()) => {
  const service = await startService(stateRoot);
  live.push(service);
  const backend = Option.some(service);
  const ask = async (root: string, callId: string): Promise<Json> => {
    const created = await service
      .interactions()!
      .create(
        { sessionId: root, rootSessionId: root },
        { kind: "question", callId, questions: QUESTIONS },
      );
    if (!created.ok) throw new Error(`create failed: ${created.code}`);
    return created.value as Json;
  };
  return { service, backend, stateRoot, ask };
};
type World = Awaited<ReturnType<typeof world>>;

const operatorScopes = [AuthOrchestrationOperateScope, AuthOrchestrationReadScope];
const client = (id: string, scopes: ReadonlyArray<string> = operatorScopes) =>
  Effect.runPromise(connectionActor({ sessionId: id, scopes }));
const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect) as Promise<Json>;
const journalOf = (stateRoot: string, root: string) => {
  const file = NodePath.join(stateRoot, "interactions", "journal", `${root}.jsonl`);
  return NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8") : "";
};

/** A subscribed stream, collected until interrupted. The subscription is live after `settle`. */
const watch = async (w: World, actor: Awaited<ReturnType<typeof client>>, root: string) => {
  const events: Array<{ rootSessionId: string; version: number }> = [];
  let ended = false;
  const fiber = Effect.runFork(
    interactionsChanges(w.backend, actor, { rootSessionId: root }).pipe(
      Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
      Effect.tap(() => Effect.sync(() => void (ended = true))),
    ),
  );
  await settle();
  return {
    events,
    ended: () => ended,
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
};

describe("a client reads a pending question after reconnect and answers it once", () => {
  it("lists it for a fresh connection, settles it for the first answer, and returns the settled record to the second client", async () => {
    const w = await world();
    const question = await w.ask(ROOT_A, "call-1");
    const first = await client("client-1");
    const second = await client("client-2");

    // A "reconnect" is a new connection with a new actor: the state is the service's, not the connection's.
    const listed = await run(
      interactionsSnapshot(w.backend, await client("client-1"), { rootSessionId: ROOT_A }),
    );
    expect(listed).toMatchObject({ ok: true, value: { rootSessionId: ROOT_A } });
    expect(listed.value.interactions).toHaveLength(1);
    expect(listed.value.interactions[0]).toMatchObject({
      interactionId: question.interactionId,
      state: "pending",
    });

    const payload = {
      interactionId: question.interactionId,
      revision: question.revision,
      answers: ANSWER,
    };
    const answered = await run(interactionsAnswer(w.backend, first, payload));
    expect(answered).toMatchObject({ ok: true, value: { state: "answered" } });

    const lost = await run(interactionsAnswer(w.backend, second, payload));
    expect(lost).toMatchObject({ ok: false, code: "INTERACTION_ALREADY_SETTLED" });
    expect(lost.record).toMatchObject({ interactionId: question.interactionId, state: "answered" });

    const after = await run(interactionsSnapshot(w.backend, second, { rootSessionId: ROOT_A }));
    expect(after.value.interactions[0]).toMatchObject({ state: "answered" });
  });
});

describe("hold, close and cancel are served by the one service", () => {
  it("holds a question, closes without changing its state, and cancels it; the payload carries no actor", async () => {
    const w = await world();
    const actor = await client("client-1");
    const held = await w.ask(ROOT_A, "call-held");
    const closed = await w.ask(ROOT_A, "call-closed");
    const cancelled = await w.ask(ROOT_A, "call-cancelled");

    const holdReply = await run(
      interactionsHold(w.backend, actor, {
        interactionId: held.interactionId,
        revision: held.revision,
      }),
    );
    expect(holdReply).toMatchObject({ ok: true, value: { state: "pending", held: true } });

    const closeReply = await run(
      interactionsClose(w.backend, actor, {
        interactionId: closed.interactionId,
        revision: closed.revision,
      }),
    );
    expect(closeReply).toMatchObject({ ok: true, value: { state: "pending", held: false } });

    const cancelReply = await run(
      interactionsCancel(w.backend, actor, {
        interactionId: cancelled.interactionId,
        revision: cancelled.revision,
        feedback: "not now",
        // A forged claim is not part of the schema; the handler never reads one.
        ...({ actor: { clientSessionId: "someone-else" } } as object),
      }),
    );
    expect(cancelReply).toMatchObject({ ok: true, value: { state: "cancelled" } });
    expect(JSON.stringify(journalOf(w.stateRoot, ROOT_A))).not.toContain("someone-else");

    const stale = await run(
      interactionsHold(w.backend, actor, {
        interactionId: held.interactionId,
        revision: "0".repeat(64),
      }),
    );
    expect(stale).toMatchObject({ ok: false, code: "INTERACTION_STALE_REVISION" });
  });
});

describe("the change stream", () => {
  it("pushes a rising version for the requested root only, and a missed version recovers by snapshot", async () => {
    const w = await world();
    const actor = await client("client-1");
    const a = await w.ask(ROOT_A, "call-a");
    const stream = await watch(w, actor, ROOT_A);

    const other = await w.ask(ROOT_B, "call-b"); // another root: no push for this subscriber
    await run(
      interactionsHold(w.backend, actor, { interactionId: a.interactionId, revision: a.revision }),
    );
    await run(
      interactionsAnswer(w.backend, actor, {
        interactionId: a.interactionId,
        revision: a.revision,
        answers: ANSWER,
      }),
    );
    await vi.waitFor(() => expect(stream.events).toHaveLength(2));
    expect(stream.events.every((event) => event.rootSessionId === ROOT_A)).toBe(true);
    expect(stream.events[1]!.version).toBeGreaterThan(stream.events[0]!.version);
    expect(Object.keys(stream.events[0]!).sort()).toEqual(["rootSessionId", "version"]);

    // A client that missed every push (it was offline) reads a snapshot at least as new as the last push it could have seen.
    const late = await run(
      interactionsSnapshot(w.backend, await client("client-late"), { rootSessionId: ROOT_A }),
    );
    expect(late.value.version).toBeGreaterThanOrEqual(stream.events[1]!.version);
    expect(other.interactionId).not.toBe(a.interactionId);
    await stream.stop();
  });

  it("loses nothing when a client subscribes and then reads the snapshot while a change lands", async () => {
    const w = await world();
    const actor = await client("client-1");
    const a = await w.ask(ROOT_A, "call-a");
    const stream = await watch(w, actor, ROOT_A);

    const [snapshot] = await Promise.all([
      run(interactionsSnapshot(w.backend, actor, { rootSessionId: ROOT_A })),
      run(
        interactionsHold(w.backend, actor, {
          interactionId: a.interactionId,
          revision: a.revision,
        }),
      ),
    ]);
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThanOrEqual(1));
    const latest = await run(interactionsSnapshot(w.backend, actor, { rootSessionId: ROOT_A }));
    // Either the snapshot already held the change, or the stream announces a version beyond it: the client always converges on the latest version.
    expect(Math.max(snapshot.value.version, ...stream.events.map((event) => event.version))).toBe(
      latest.value.version,
    );
    await stream.stop();
  });

  it("does not let the version go backward across a Backend restart", async () => {
    const stateRoot = newStateRoot();
    const first = await world(stateRoot);
    const actor = await client("client-1");
    const a = await first.ask(ROOT_A, "call-a");
    await run(
      interactionsHold(first.backend, actor, {
        interactionId: a.interactionId,
        revision: a.revision,
      }),
    );
    const before = await run(interactionsSnapshot(first.backend, actor, { rootSessionId: ROOT_A }));
    await first.service.dispose("restart");

    const second = await world(stateRoot);
    const stream = await watch(second, actor, ROOT_A);
    const after = await run(interactionsSnapshot(second.backend, actor, { rootSessionId: ROOT_A }));
    // The restart itself may record events (it ends a wait no segment holds), so the version is at least what it was, derived from the journal.
    expect(after.value.version).toBeGreaterThanOrEqual(before.value.version);
    await run(
      interactionsClose(second.backend, actor, {
        interactionId: a.interactionId,
        revision: a.revision,
      }),
    );
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
    expect(stream.events[0]!.version).toBeGreaterThan(after.value.version);
    await stream.stop();
  });

  it("ends at once for a connection whose scope or root access is missing, and when the service drains", async () => {
    const w = await world();
    await w.ask(ROOT_A, "call-a");
    const noScope = await watch(w, await client("client-none", []), ROOT_A);
    const unbound = await watch(w, await client("client-1"), UNBOUND);
    expect(noScope.ended()).toBe(true);
    expect(unbound.ended()).toBe(true);

    const open = await watch(w, await client("client-2"), ROOT_A);
    expect(open.ended()).toBe(false);
    await w.service.dispose("drain");
    await vi.waitFor(() => expect(open.ended()).toBe(true));
    const afterDrain = await run(
      interactionsSnapshot(w.backend, await client("client-2"), { rootSessionId: ROOT_A }),
    );
    expect(afterDrain).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
  });
});

describe("unauthorized clients and cross-root requests", () => {
  it("changes nothing for a read-only or scope-less connection, in state or journal", async () => {
    const w = await world();
    const question = await w.ask(ROOT_A, "call-a");
    const operator = await client("client-1");
    const journal = journalOf(w.stateRoot, ROOT_A);
    const snapshot = await run(
      interactionsSnapshot(w.backend, operator, { rootSessionId: ROOT_A }),
    );
    const ids = { interactionId: question.interactionId, revision: question.revision };

    for (const scopes of [[AuthOrchestrationReadScope], []] as const) {
      const weak = await client("client-weak", scopes);
      for (const reply of [
        await run(interactionsAnswer(w.backend, weak, { ...ids, answers: ANSWER })),
        await run(interactionsCancel(w.backend, weak, ids)),
        await run(interactionsHold(w.backend, weak, ids)),
        await run(interactionsClose(w.backend, weak, ids)),
      ])
        expect(reply).toMatchObject({ ok: false, code: "INTERACTION_ORIGIN_NOT_HUMAN" });
    }
    expect(journalOf(w.stateRoot, ROOT_A)).toBe(journal);
    expect(await run(interactionsSnapshot(w.backend, operator, { rootSessionId: ROOT_A }))).toEqual(
      snapshot,
    );
  });

  it("refuses a read without the read scope, and shows another root nothing it may not reach", async () => {
    const w = await world();
    await w.ask(ROOT_A, "call-a");
    const outsider = await w.ask(UNBOUND, "call-outside");
    const operator = await client("client-1");

    const noScope = await client("client-none", []);
    expect(
      await run(interactionsSnapshot(w.backend, noScope, { rootSessionId: ROOT_A })),
    ).toMatchObject({
      ok: false,
      code: "INTERACTION_NOT_FOUND",
    });
    // A root no T3 thread is bound to is not reachable: it reads as absent, and an action on its interaction is refused with state unchanged.
    expect(
      await run(interactionsSnapshot(w.backend, operator, { rootSessionId: UNBOUND })),
    ).toMatchObject({
      ok: false,
      code: "INTERACTION_NOT_FOUND",
    });
    const journal = journalOf(w.stateRoot, UNBOUND);
    const answer = await run(
      interactionsAnswer(w.backend, operator, {
        interactionId: outsider.interactionId,
        revision: outsider.revision,
        answers: ANSWER,
      }),
    );
    expect(answer).toMatchObject({ ok: false, code: "INTERACTION_ORIGIN_NOT_HUMAN" });
    expect(journalOf(w.stateRoot, UNBOUND)).toBe(journal);

    // Each reachable root shows its own interactions only.
    await w.ask(ROOT_B, "call-b");
    const rootA = await run(interactionsSnapshot(w.backend, operator, { rootSessionId: ROOT_A }));
    expect(rootA.value.interactions.every((record: Json) => record.rootSessionId === ROOT_A)).toBe(
      true,
    );
  });
});

describe("XC-6 origin.verify over the real service (M07's Agent-side route to XC-17)", () => {
  it("verifies the origin a client's answer wrote, names a mismatch, and finds nothing for an unknown id", async () => {
    const w = await world();
    const question = await w.ask(ROOT_A, "call-v");
    const answered = await run(
      interactionsAnswer(w.backend, await client("client-1"), {
        interactionId: question.interactionId,
        revision: question.revision,
        answers: ANSWER,
      }),
    );
    const originId = answered.value.resolution.originId as string;
    const verify = (args: Record<string, unknown>) =>
      w.service.operations()["origin.verify"]!({
        caller: {
          threadId: "thread:a",
          providerSessionId: "provider-session:a",
          providerInstanceId: "pi",
        },
        sessionId: ROOT_A,
        kind: "main",
        rootSessionId: ROOT_A,
        args,
      });
    const verified = (await verify({
      originId,
      expect: {
        kind: "answer",
        subject: { type: "question", id: question.interactionId, revision: question.revision },
      },
    })) as Json;
    expect(verified).toMatchObject({
      status: "done",
      result: { verified: true, origin: { originId, kind: "answer" } },
    });
    expect(await verify({ originId, expect: { kind: "authorization" } })).toEqual({
      status: "done",
      result: { verified: false, code: "ORIGIN_MISMATCH", field: "kind" },
    });
    expect(await verify({ originId, expect: { subject: { revision: "0".repeat(64) } } })).toEqual({
      status: "done",
      result: { verified: false, code: "ORIGIN_STALE" },
    });
    expect(await verify({ originId: "org-nobody" })).toEqual({
      status: "done",
      result: { verified: false, code: "ORIGIN_NOT_FOUND" },
    });
  });
});

describe("XC-6 tasks.publish and the client tasks.get over the real service (step 21)", () => {
  // Needs the repacked @aetheria/interaction archive (publishTasks/getTasks); against the step-15 archive these answer unavailable.
  const L1 = "2026-11-10T10:00:00.000Z";
  const L2 = "2026-11-10T11:00:00.000Z";
  const todos = (...contents: string[]) =>
    contents.map((content) => ({ content, status: "pending" as const }));
  const publish = (
    w: World,
    session: string,
    args: Record<string, unknown>,
    thread = "thread:a",
  ): Promise<Json> =>
    w.service.operations()["tasks.publish"]!({
      caller: {
        threadId: thread,
        providerSessionId: `provider-session:${thread.slice(-1)}`,
        providerInstanceId: "pi",
      },
      sessionId: session,
      kind: "main",
      rootSessionId: session,
      args,
    }) as Promise<Json>;
  const body = (entryId: string, seq: number, lifecycle: string, n: number, list: unknown) => ({
    entryId,
    seq,
    order: { lifecycle, n },
    list,
  });
  // The session tree is M03's identity records (the Agent host's writer leaves them under <stateRoot>/identity); ROOT_A and ROOT_B are main sessions.
  // UNBOUND has none, so the tree does not know it.
  const identify = (stateRoot: string, sessionId: string) => {
    const dir = NodePath.join(stateRoot, "identity");
    NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
    NodeFS.chmodSync(dir, 0o700);
    const file = NodePath.join(dir, `${sessionId}.json`);
    NodeFS.writeFileSync(
      file,
      `${JSON.stringify({
        formatVersion: 1,
        state: "active",
        attemptId: "attempt-1",
        writer: "agent-authority",
        acceptedPrompt: false,
        record: {
          sessionId,
          kind: "main",
          rootSessionId: sessionId,
          parentChain: [],
          role: null,
          roleOrigin: null,
          roleDigest: null,
          authoritySource: "main",
        },
      })}\n`,
      { mode: 0o600 },
    );
    NodeFS.chmodSync(file, 0o600);
  };
  const taskWorld = (stateRoot = newStateRoot()) => {
    identify(stateRoot, ROOT_A);
    identify(stateRoot, ROOT_B);
    return world(stateRoot);
  };

  it("publishes under the verified session, reads it back through the client with scope and access checks, and leaves the change stream still", async () => {
    const w = await taskWorld();
    const operator = await client("client-1");
    await w.ask(ROOT_A, "call-a");
    const stream = await watch(w, operator, ROOT_A);
    const published = await publish(w, ROOT_A, body("e1", 1, L1, 1, todos("write", "test")));
    expect(published).toMatchObject({
      status: "done",
      result: {
        ok: true,
        value: { sessionId: ROOT_A, rootSessionId: ROOT_A, entryId: "e1", state: "current" },
      },
    });
    const read = await run(tasksGet(w.backend, operator, { sessionId: ROOT_A }));
    expect(read).toEqual({ ok: true, value: published.result.value });
    expect(read.value.todos).toEqual(todos("write", "test"));
    await settle();
    // D15/C7: the stream's version counts journal events, and the derived task view has none; M10 re-reads tasks.get.
    expect(stream.events.map((event) => event.version)).toEqual([]);
    await stream.stop();
    expect(await run(tasksGet(w.backend, operator, { sessionId: ROOT_B }))).toEqual({
      ok: true,
      value: null,
    });
  });

  it("orders by the Agent's evidence, so an abandoned branch's larger seq arriving late changes nothing", async () => {
    const w = await taskWorld();
    const operator = await client("client-1");
    await publish(w, ROOT_A, body("a5", 5, L1, 5, todos("A5")));
    await publish(w, ROOT_A, body("a2", 2, L2, 0, todos("A2")));
    const late = await publish(w, ROOT_A, body("a6", 6, L1, 6, todos("A6")));
    expect(late).toMatchObject({
      result: { ok: true, value: { entryId: "a2", state: "current" } },
    });
    expect(await run(tasksGet(w.backend, operator, { sessionId: ROOT_A }))).toMatchObject({
      value: { entryId: "a2", seq: 2, todos: todos("A2"), state: "current" },
    });
  });

  it("reads stale after a Backend restart until a republish, and a lost tasks/ folder reads as nothing published until the next publish repairs it", async () => {
    const stateRoot = newStateRoot();
    const first = await taskWorld(stateRoot);
    await publish(first, ROOT_A, body("e1", 1, L1, 1, todos("x")));
    await first.service.dispose("restart");
    live.splice(live.indexOf(first.service), 1);
    const second = await taskWorld(stateRoot);
    const operator = await client("client-1");
    expect(await run(tasksGet(second.backend, operator, { sessionId: ROOT_A }))).toMatchObject({
      ok: true,
      value: { entryId: "e1", state: "stale", todos: todos("x") },
    });
    const republished = await publish(second, ROOT_A, body("e1", 1, L2, 0, todos("x")));
    expect(republished).toMatchObject({ result: { value: { state: "current" } } });
    NodeFS.rmSync(NodePath.join(stateRoot, "interactions", "tasks"), { recursive: true });
    expect(await run(tasksGet(second.backend, operator, { sessionId: ROOT_A }))).toEqual({
      ok: true,
      value: null,
    });
    await publish(second, ROOT_A, body("e2", 2, L2, 1, todos("x", "y")));
    expect(await run(tasksGet(second.backend, operator, { sessionId: ROOT_A }))).toMatchObject({
      value: { entryId: "e2", state: "current" },
    });
  });

  it("answers an unreadable view as unavailable, never as an empty list", async () => {
    const w = await taskWorld();
    await publish(w, ROOT_A, body("e1", 1, L1, 1, todos("x")));
    NodeFS.writeFileSync(
      NodePath.join(w.stateRoot, "interactions", "tasks", `${ROOT_A}.json`),
      "{broken",
    );
    expect(
      await run(tasksGet(w.backend, await client("client-1"), { sessionId: ROOT_A })),
    ).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
  });

  it("is root-scoped and caller-keyed: an unbound session is unreachable, a session unknown to the tree cannot publish, and an identity claim in the arguments is refused", async () => {
    const w = await taskWorld();
    const operator = await client("client-1");
    await w.ask(UNBOUND, "call-outside");
    // The access rule refuses a session no T3 thread is bound to: not found, with nothing about it shown.
    expect(await run(tasksGet(w.backend, operator, { sessionId: UNBOUND }))).toMatchObject({
      ok: false,
      code: "INTERACTION_NOT_FOUND",
    });
    const stranger = await publish(w, UNBOUND, body("e1", 1, L1, 1, todos("x")));
    expect(stranger).toMatchObject({
      status: "done",
      result: { ok: false, code: "INTERACTION_UNAVAILABLE" },
    });
    for (const claim of [{ sessionId: ROOT_B }, { rootSessionId: ROOT_B }, { actor: "human" }])
      await expect(
        Promise.resolve().then(() =>
          publish(w, ROOT_A, { ...body("e9", 9, L1, 9, todos("claimed")), ...claim }),
        ),
      ).rejects.toThrow();
    // Each root keeps its own list; the claim never reached the other root's view.
    expect(await run(tasksGet(w.backend, operator, { sessionId: ROOT_B }))).toEqual({
      ok: true,
      value: null,
    });
    expect(await run(tasksGet(w.backend, operator, { sessionId: ROOT_A }))).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("the contract has no way to read an agent's context", () => {
  it("names no read-context method among the Aetheria methods", () => {
    const names = Object.values(AETHERIA_WS_METHODS);
    expect(names.some((name) => /context/i.test(name))).toBe(false);
    expect(names.filter((name) => name.startsWith("aetheria.interactions."))).toHaveLength(6);
  });
});

afterEach(() => {
  for (const root of stateRoots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
