// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDate:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off runEffectInsideEffect:off
/* oxlint-disable t3code/no-manual-effect-runtime-in-tests, t3code/no-real-time-wait-in-tests -- the stores are real layers built by hand over one SQLite file; a short expiry is waited out. */
// AETHERIA M06 (C7, m06-revocation and m06-u2-dpop): a session revoked by a SEPARATE store (the `t3` CLI) is refused on every call and writes nothing; a renewed DPoP
// session follows T3's chain through the IP-26 seam, and a plain session is untouched. Real SessionStores on one SQLite file and the real Backend.
// Not shown: a real WebSocket, the CLI process, or a link that was current only in the past.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  createAetheriaBackendService,
  type AetheriaBackendService,
} from "@t3tools/aetheria-server";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  authorizationGrant,
  connectionActor,
  interactionsAnswer,
  interactionsCancel,
  interactionsChanges,
  interactionsClose,
  interactionsHold,
  interactionsSnapshot,
  planDecide,
  planModeGet,
  planModeSet,
  tasksGet,
} from "./humanControlRpc.ts";

type Json = Record<string, any>; // replies are checked field by field; the wire shapes are the contracts' own
const REVISION = "a".repeat(64);
const REVOKED = "INTERACTION_ORIGIN_NOT_HUMAN";
const FOLDER = "/work/project";
const ROOT = "root-a";
const QUESTIONS = [{ id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }] }];
const ANSWER = [{ id: "q1", selected: ["A"], skipped: false }];
const scopes = [AuthOrchestrationOperateScope, AuthOrchestrationReadScope];
const NODE = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

const roots: string[] = [];
const newDir = (prefix: string) => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = NodeFS.mkdtempSync(NodePath.join(base, prefix));
  roots.push(dir);
  return dir;
};
const live: AetheriaBackendService[] = [];
afterEach(async () => {
  for (const service of live.splice(0)) await service.dispose("test").catch(() => undefined);
  for (const dir of roots.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** One SessionStore on the T3 database in `baseDir`. Two of these over one directory are the server and the `t3` CLI process: one SQLite file, two stores, two PubSubs. */
const storeLayer = (baseDir: string) =>
  Effect.gen(function* () {
    const devUrl = new URL("http://127.0.0.1:5173");
    const paths = yield* ServerConfig.deriveServerPaths(baseDir, devUrl, {
      baseDirIsExplicit: true,
    });
    yield* ServerConfig.ensureServerDirectories(paths);
    return SessionStore.layer.pipe(
      Layer.provide(SqlitePersistence.layerFromPath(paths.dbPath)),
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make(baseDir)),
        }),
      ),
      Layer.provide(
        Layer.effect(
          ServerConfig.ServerConfig,
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            return {
              ...config,
              ...paths,
              baseDir,
              mode: "web",
              devUrl,
              devAuthToken: Redacted.make("unused"),
            } satisfies ServerConfig.ServerConfig["Service"];
          }),
        ).pipe(
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-m06-revocation-" })),
        ),
      ),
    );
  });

const startBackend = async (stateRoot: string): Promise<AetheriaBackendService> => {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => (threadId === "thread:a" ? "provider-session:a" : undefined),
    projectRootOf: (folder) => folder,
  });
  if (made.outcome !== "prepared") throw new Error("the Backend must prepare");
  const started = await made.service.start();
  if (started.outcome !== "started") throw new Error(`the Backend did not start`);
  await made.service.ingest({
    sequence: 1,
    event: {
      type: "provider-session.updated",
      threadId: "thread:a",
      payload: { id: "provider-session:a", providerInstanceId: "pi", status: "ready", cwd: FOLDER },
    },
  });
  await made.service.ingest({
    sequence: 2,
    event: {
      type: "provider-thread.updated",
      threadId: "thread:a",
      payload: {
        driver: "pi",
        providerInstanceId: "pi",
        providerSessionId: "provider-session:a",
        appThreadId: "thread:a",
        nativeThreadRef: { nativeId: `/s/2026-11-08T08-00-00-000Z_${ROOT}.jsonl` },
      },
    },
  });
  return made.service;
};
const ask = async (service: AetheriaBackendService, callId: string): Promise<Json> => {
  const created = await service
    .interactions()!
    .create(
      { sessionId: ROOT, rootSessionId: ROOT },
      { kind: "question", callId, questions: QUESTIONS },
    );
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  return created.value as Json;
};
const journalOf = (stateRoot: string) => {
  const file = NodePath.join(stateRoot, "interactions", "journal", `${ROOT}.jsonl`);
  return NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8") : "";
};

/** A service that counts its calls: a refused call must never reach it. */
const countingService = () => {
  const calls: string[] = [];
  const note =
    (method: string, value: unknown) =>
    async (..._args: unknown[]) => {
      calls.push(method);
      return value;
    };
  const record = { interactionId: "i1", state: "pending" };
  return {
    calls,
    service: {
      answer: note("answer", { ok: true, value: record }),
      cancel: note("cancel", { ok: true, value: record }),
      hold: note("hold", { ok: true, value: record }),
      close: note("close", { ok: true, value: record }),
      decidePlan: note("decidePlan", { ok: true, value: record }),
      setPlanMode: note("setPlanMode", { ok: true, value: {} }),
      grant: note("grant", { ok: true, value: { originId: "o1" } }),
      snapshot: note("snapshot", {
        ok: true,
        value: { rootSessionId: ROOT, version: 1, interactions: [] },
      }),
      getPlanMode: note("getPlanMode", { ok: true, value: {} }),
      getTasks: note("getTasks", { ok: true, value: null }),
      canAccess: async () => true,
    },
  };
};

describe("a revoked device is refused on every human-control call (C7, m06-revocation)", () => {
  it("refuses an answer after a SEPARATE store revoked the session, writes nothing, and still serves a second device", async () => {
    const stateRoot = newDir("m06-rev-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    const question = await ask(service, "call-1");
    const baseDir = newDir("m06-rev-t3-");

    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const serverStore = SessionStoreOf(server);
          const cliStore = SessionStoreOf(cli);
          const first = yield* serverStore.issue({ subject: "device-1", scopes });
          const second = yield* serverStore.issue({ subject: "device-2", scopes });
          const actorOf = (sessionId: string) =>
            connectionActor({ sessionId, scopes }).pipe(Effect.provide(server));
          const firstActor = yield* actorOf(first.sessionId);
          const secondActor = yield* actorOf(second.sessionId);

          // Before the revocation the connection works: a read answers.
          const before = yield* interactionsSnapshot(backend, firstActor, { rootSessionId: ROOT });
          const journalBefore = journalOf(stateRoot);

          // The `t3 auth session revoke` of another process: a different store on the same database. The server's store is not told.
          yield* cliStore.revoke(first.sessionId);

          const payload = {
            interactionId: question.interactionId,
            revision: question.revision,
            answers: ANSWER,
          };
          const refused = yield* interactionsAnswer(backend, firstActor, payload);
          const read = yield* interactionsSnapshot(backend, firstActor, { rootSessionId: ROOT });
          const journalAfter = journalOf(stateRoot);
          const stillPending = yield* interactionsSnapshot(backend, secondActor, {
            rootSessionId: ROOT,
          });
          const accepted = yield* interactionsAnswer(backend, secondActor, payload);
          return { before, refused, read, journalBefore, journalAfter, stillPending, accepted };
        }).pipe(Effect.provide(NODE)),
      ),
    );

    expect(outcome.before).toMatchObject({ ok: true, value: { rootSessionId: ROOT } });
    expect(outcome.refused).toMatchObject({ ok: false, code: REVOKED });
    expect(outcome.read).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
    expect(outcome.journalAfter).toBe(outcome.journalBefore);
    expect((outcome.stillPending as Json).value.interactions[0]).toMatchObject({
      interactionId: question.interactionId,
      state: "pending",
    });
    expect(outcome.accepted).toMatchObject({ ok: true, value: { state: "answered" } });
  });

  it("refuses all seven actions and the reads before the service is called, and calls it for a live session", async () => {
    const baseDir = newDir("m06-rev-all-");
    const fake = countingService();
    const backend = Option.some({ interactions: () => fake.service }) as never;
    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const device = yield* store.issue({ subject: "device", scopes });
          const actor = yield* connectionActor({ sessionId: device.sessionId, scopes }).pipe(
            Effect.provide(server),
          );
          const calls = (b: typeof backend) => ({
            answer: interactionsAnswer(b, actor, {
              interactionId: "i1",
              revision: REVISION,
              answers: ANSWER,
            }),
            cancel: interactionsCancel(b, actor, { interactionId: "i1", revision: REVISION }),
            hold: interactionsHold(b, actor, { interactionId: "i1", revision: REVISION }),
            close: interactionsClose(b, actor, { interactionId: "i1", revision: REVISION }),
            decide: planDecide(b, actor, {
              interactionId: "i1",
              revision: REVISION,
              decision: "approved",
            }),
            mode: planModeSet(b, actor, { sessionId: "s1", active: true, expectedModeRevision: 0 }),
            grant: authorizationGrant(b, actor, { subject: "subject-1", sessionId: "s1" } as never),
          });
          const live = {} as Json;
          for (const [name, effect] of Object.entries(calls(backend))) live[name] = yield* effect;
          const liveCalls = [...fake.calls];
          fake.calls.length = 0;
          yield* SessionStoreOf(cli).revoke(device.sessionId);
          const refused = {} as Json;
          for (const [name, effect] of Object.entries(calls(backend)))
            refused[name] = yield* effect;
          const reads = {
            snapshot: yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT }),
            mode: yield* planModeGet(backend, actor, { sessionId: "s1" }),
            tasks: yield* tasksGet(backend, actor, { sessionId: "s1" }),
          };
          return { live, liveCalls, refused, reads, refusedCalls: [...fake.calls] };
        }).pipe(Effect.provide(NODE)),
      ),
    );
    expect(Object.values(out.live).every((r) => (r as Json).ok === true)).toBe(true);
    expect(out.liveCalls).toHaveLength(7);
    for (const reply of Object.values(out.refused))
      expect(reply).toMatchObject({ ok: false, code: REVOKED });
    for (const reply of Object.values(out.reads))
      expect(reply).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
    expect(out.refusedCalls).toEqual([]);
  });

  it("refuses an expired session, and ends an open change stream at the next push after a revocation", async () => {
    const baseDir = newDir("m06-rev-exp-");
    const stateRoot = newDir("m06-rev-exp-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const short = yield* store.issue({ subject: "short", scopes, ttl: Duration.millis(5) });
          const watcher = yield* store.issue({ subject: "watcher", scopes });
          const shortActor = yield* connectionActor({ sessionId: short.sessionId, scopes }).pipe(
            Effect.provide(server),
          );
          const watchActor = yield* connectionActor({
            sessionId: watcher.sessionId,
            scopes,
          }).pipe(Effect.provide(server));
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
          const expired = yield* interactionsSnapshot(backend, shortActor, { rootSessionId: ROOT });

          const seen: Array<{ version: number }> = [];
          let ended = false;
          const fiber = Effect.runFork(
            interactionsChanges(backend, watchActor, { rootSessionId: ROOT }).pipe(
              Stream.runForEach((event) => Effect.sync(() => void seen.push(event))),
              Effect.tap(() => Effect.sync(() => void (ended = true))),
            ),
          );
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
          yield* SessionStoreOf(cli).revoke(watcher.sessionId);
          yield* Effect.promise(() => ask(service, "call-after-revoke"));
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
          const endedAfterPush = ended;
          yield* Fiber.interrupt(fiber);
          return { expired, seen, endedAfterPush };
        }).pipe(Effect.provide(NODE)),
      ),
    );
    expect(out.expired).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
    expect(out.seen).toEqual([]);
    expect(out.endedAfterPush).toBe(true);
  });
});

const DPOP = "dpop-access-token" as const;
const KEY = "jkt-device-1";
const pause = (ms: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("a DPoP session that T3 renewed is refused once its renewal chain is revoked (C7, review 3 U2)", () => {
  it("refuses an action after a SEPARATE store revoked only the successor of an expired original, and writes nothing", async () => {
    const stateRoot = newDir("m06-dpop-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    const question = await ask(service, "call-dpop");
    const baseDir = newDir("m06-dpop-t3-");

    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          // The device's first token is short; T3's renewal is a second session for the same subject and DPoP key.
          const original = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.millis(500),
          });
          const successor = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.hours(1),
          });
          const other = yield* store.issue({ subject: "device-2", scopes });
          // The socket was accepted on the ORIGINAL session and keeps its actor for its whole life.
          const actor = yield* connectionActor({
            sessionId: original.sessionId,
            scopes,
            proofKeyThumbprint: KEY,
          }).pipe(Effect.provide(server));
          const otherActor = yield* connectionActor({ sessionId: other.sessionId, scopes }).pipe(
            Effect.provide(server),
          );
          const payload = {
            interactionId: question.interactionId,
            revision: question.revision,
            answers: ANSWER,
          };

          const beforeExpiry = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          yield* pause(650); // the original has expired; T3 would now carry the socket on the successor
          const renewedRead = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          const journalBefore = journalOf(stateRoot);

          yield* SessionStoreOf(cli).revoke(successor.sessionId); // the `t3` CLI revokes the device's current session
          const refused = yield* interactionsAnswer(backend, actor, payload);
          const read = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          const journalAfter = journalOf(stateRoot);
          const secondDevice = yield* interactionsAnswer(backend, otherActor, payload);
          return {
            beforeExpiry,
            renewedRead,
            refused,
            read,
            journalBefore,
            journalAfter,
            secondDevice,
          };
        }).pipe(Effect.provide(NODE)),
      ),
    );

    expect(out.beforeExpiry).toMatchObject({ ok: true, value: { rootSessionId: ROOT } });
    // A live successor keeps the socket working: T3's renewal is not an outage.
    expect(out.renewedRead).toMatchObject({ ok: true, value: { rootSessionId: ROOT } });
    expect(out.refused).toMatchObject({ ok: false, code: REVOKED });
    expect(out.read).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
    expect(out.journalAfter).toBe(out.journalBefore);
    expect(out.secondDevice).toMatchObject({ ok: true, value: { state: "answered" } });
  });

  it("refuses an expired DPoP original that has no live renewal, and does not count another subject's or a narrower session as its renewal", async () => {
    const stateRoot = newDir("m06-dpop-exp-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    const question = await ask(service, "call-dpop-expired");
    const baseDir = newDir("m06-dpop-exp-t3-");

    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const original = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.millis(5),
          });
          // Live DPoP sessions that are NOT its renewal: another subject, and the same subject with fewer scopes (T3 closes a socket for that too).
          yield* store.issue({
            subject: "someone-else",
            scopes,
            method: DPOP,
            proofKeyThumbprint: "jkt-other",
            ttl: Duration.hours(1),
          });
          yield* store.issue({
            subject: "paired-device",
            scopes: [AuthOrchestrationReadScope],
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.hours(1),
          });
          const actor = yield* connectionActor({
            sessionId: original.sessionId,
            scopes,
            proofKeyThumbprint: KEY,
          }).pipe(Effect.provide(server));
          yield* pause(60);
          const journalBefore = journalOf(stateRoot);
          const refused = yield* interactionsAnswer(backend, actor, {
            interactionId: question.interactionId,
            revision: question.revision,
            answers: ANSWER,
          });
          const read = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          return { refused, read, journalBefore, journalAfter: journalOf(stateRoot) };
        }).pipe(Effect.provide(NODE)),
      ),
    );

    expect(out.refused).toMatchObject({ ok: false, code: REVOKED });
    expect(out.read).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
    expect(out.journalAfter).toBe(out.journalBefore);
  });

  it("keeps an unexpired DPoP original working while only its successor is revoked (T3 moves the socket only when the original expires)", async () => {
    const stateRoot = newDir("m06-dpop-early-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    await ask(service, "call-dpop-early"); // a root the connection can reach exists
    const baseDir = newDir("m06-dpop-early-t3-");

    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const original = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.hours(1),
          });
          const successor = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.hours(2),
          });
          const actor = yield* connectionActor({
            sessionId: original.sessionId,
            scopes,
            proofKeyThumbprint: KEY,
          }).pipe(Effect.provide(server));
          yield* SessionStoreOf(cli).revoke(successor.sessionId);
          return yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
        }).pipe(Effect.provide(NODE)),
      ),
    );

    expect(out).toMatchObject({ ok: true, value: { rootSessionId: ROOT } });
  });

  // Review 3 U2, the exact path (decision m06-u2-dpop): the approximate "any usable renewal" rule could not close this.
  it("does not let another live DPoP session of the same subject keep a revoked successor's connection active", async () => {
    const stateRoot = newDir("m06-dpop-mask-state-");
    const service = await startBackend(stateRoot);
    live.push(service);
    const backend = Option.some(service);
    const question = await ask(service, "call-dpop-mask");
    const baseDir = newDir("m06-dpop-mask-t3-");

    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const original = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.millis(300),
          });
          const successor = yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: KEY,
            ttl: Duration.hours(1),
          });
          // Same subject, DPoP, every scope, live and issued later, but another device's key: not the renewal T3 follows.
          yield* store.issue({
            subject: "paired-device",
            scopes,
            method: DPOP,
            proofKeyThumbprint: "jkt-device-2",
            ttl: Duration.hours(1),
          });
          const actor = yield* connectionActor({
            sessionId: original.sessionId,
            scopes,
            proofKeyThumbprint: KEY,
          }).pipe(Effect.provide(server));
          yield* pause(450);
          const renewedRead = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          yield* SessionStoreOf(cli).revoke(successor.sessionId);
          const journalBefore = journalOf(stateRoot);
          const refused = yield* interactionsAnswer(backend, actor, {
            interactionId: question.interactionId,
            revision: question.revision,
            answers: ANSWER,
          });
          return { renewedRead, refused, journalBefore, journalAfter: journalOf(stateRoot) };
        }).pipe(Effect.provide(NODE)),
      ),
    );

    expect(out.renewedRead).toMatchObject({ ok: true });
    expect(out.refused).toMatchObject({ ok: false, code: REVOKED });
    expect(out.journalAfter).toBe(out.journalBefore);
  });

  it("follows the newest renewal when the first renewal expired too, and refuses once that current session is revoked", async () => {
    const baseDir = newDir("m06-dpop-chain-t3-");
    const fake = countingService();
    const backend = Option.some({ interactions: () => fake.service }) as never;
    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const cli = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const issue = (ttl: number) =>
            store.issue({
              subject: "paired-device",
              scopes,
              method: DPOP,
              proofKeyThumbprint: KEY,
              ttl: Duration.millis(ttl),
            });
          const first = yield* issue(150);
          yield* issue(150);
          const actor = yield* connectionActor({
            sessionId: first.sessionId,
            scopes,
            proofKeyThumbprint: KEY,
          }).pipe(Effect.provide(server));
          yield* pause(250); // the first and the second have both expired
          const third = yield* issue(60_000); // the current session, the end of the chain
          const onThird = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          yield* SessionStoreOf(cli).revoke(third.sessionId);
          const revoked = yield* interactionsSnapshot(backend, actor, { rootSessionId: ROOT });
          return { onThird, revoked };
        }).pipe(Effect.provide(NODE)),
      ),
    );
    expect(out.onThird).toMatchObject({ ok: true });
    expect(out.revoked).toMatchObject({ ok: false, code: "INTERACTION_NOT_FOUND" });
  });
});

describe("the current-chain seam of T3's SessionStore changes nothing for a bare T3 (Aetheria IP-26)", () => {
  it("answers just the session for a plain session, never writes, and a connection actor built without the stores has no check", async () => {
    const baseDir = newDir("m06-bare-t3-");
    const fake = countingService();
    const backend = Option.some({ interactions: () => fake.service }) as never;
    const out = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Layer.build(yield* storeLayer(baseDir));
          const store = SessionStoreOf(server);
          const plain = yield* store.issue({ subject: "browser", scopes });
          const before = yield* store.listActive();
          const chain = yield* store.currentChain(plain.sessionId);
          const withKey = yield* store.currentChain(plain.sessionId, "jkt-nobody");
          const missing = yield* store.currentChain(
            "00000000-0000-4000-8000-000000000000" as never,
          );
          const after = yield* store.listActive();
          // No SessionStore or repository in scope: the connection actor is the plain actor and calls reach the service.
          const bare = yield* connectionActor({ sessionId: "anything", scopes });
          const reply = yield* interactionsSnapshot(backend, bare, { rootSessionId: ROOT });
          return { plain: plain.sessionId, chain, withKey, missing, before, after, reply };
        }).pipe(Effect.provide(NODE)),
      ),
    );
    expect(out.chain).toEqual([out.plain]);
    expect(out.withKey).toEqual([out.plain]);
    expect(out.missing).toEqual(["00000000-0000-4000-8000-000000000000"]);
    expect(out.after).toEqual(out.before);
    expect(out.reply).toMatchObject({ ok: true });
    expect(fake.calls).toEqual(["snapshot"]);
  });
});

/** The store out of a built context (the layer also exposes the repository the handlers read). */
function SessionStoreOf(context: Context.Context<SessionStore.SessionStore>) {
  return Context.get(context, SessionStore.SessionStore);
}
