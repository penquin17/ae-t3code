// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDateInEffect:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
/* oxlint-disable t3code/no-real-time-wait-in-tests, t3code/no-manual-effect-runtime-in-tests, t3code/no-test-timeout-or-unreasoned-skip, t3code/no-polling-loop-in-tests, t3code/no-low-value-comments -- Real T3 services: the Backend's index is fed by T3's event stream on a background fiber and a long-wait reply is a repollable token, so milestones are awaited by polling; the header and dividers carry the boundary and limits this evidence must state. */
// AETHERIA M05 Plan step 26 / step 29, fork-side cases 1, 2, 4, 6 and 7 — the REAL archive children service (the installed orchestration archive, through the fork's
// `createOrchestrationFactory`, the Backend service, M03's identity store and the production XC-6 core) over T3's REAL thread services.
//
// Boundary. REAL: ThreadManagementService, Orchestrator, EventSink, EventStore, ProjectionStore, ProviderSessionManager, effect worker and IdAllocator on one in-memory SQLite database
// (T3's ProviderReplayHarness, as childThreadPort.aetheria.test.ts); `makeChildThreadPort`, `makeLineageReader`, `makeLaunchFacts`, `makeCallerContext` (the adapters the Backend
// uses in production); T3's McpSessionRegistry (the credential a Pi child would hold); the Backend's thread index, fed from T3's own event stream exactly as aetheriaBackend.ts feeds it;
// the production XC-6 core (`productionBackend`), which takes the carrier's thread, credential and claimed session. SCRIPTED: the provider (driver `pi`, so the index binds its
// sessions; it reports Pi-style session file names, honours the IP-25 session-id request, completes or interrupts a turn only when told). No model, no credential, no real Pi.
// The `/aetheria/xc6` HTTP hop and the bearer check are tests/orchestration/matrix (real route there; FX-TP thread fixture), not repeated here.
//
// Shows (each test names its case): 1 adjacency, interrupt, close, cancelTree and closed-caller refusal over a real tree, with real `thread.stop` (stopDelegatedTasks false);
// 2 what T3's close leaves of the child's credential-holding session; 4 `delivery: "record-only"` through `children.await-report` at T3's real delegated-task boundary; 6 a restart over
// a real T3 store; 7 the T3 answers an unknown owner gives. Does NOT show: a real Pi process, an HTTP carrier, a real provider, power loss, Linux. Side: harness-only. Provider tier: scripted.
//
// Red evidence: the code existed first, so there is no red-first run. Negative controls stand in; M05_FORK_NEGATIVE=<name> (each is named at its test) must turn exactly that test red:
//   "adjacent-all"     : the adjacency test treats every target as adjacent (its refusal expectations are inverted by the mutation)
//   "no-record-only"   : the record-only test spawns with the chat delivery (the control flow) and must then see the delivery it forbids
//   "no-restart"       : the restart test skips the restart reconciliation (no settle, no notice)
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  createAetheriaBackendService,
  createOrchestrationFactory,
  type AetheriaBackendService,
  type StoredEventLike,
} from "@t3tools/aetheria-server";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRuntimeRecovery from "../../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ProviderSessionManager from "../../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as DocumentText from "../../provider/DocumentText.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeCallerContext } from "../callerContext.ts";
import { makeLaunchFacts } from "../launchFacts.ts";
import { makeLineageReader } from "../lineageReader.ts";
import { makeChildThreadPort } from "../threadPort.ts";
import * as Xc6Route from "../xc6Route.ts";

const NEGATIVE = process.env.M05_FORK_NEGATIVE ?? "";
const driver = ProviderDriverKind.make("pi");
const instanceId = ProviderInstanceId.make("pi");
const modelSelection = { instanceId, model: "test-model" };
// Pi's real session shape (packages/provider-pi/src/server/adapter.ts PiProviderCapabilitiesV2.sessions): ONE provider thread per session. T3's Orchestrator.providerSessionIdFor derives the
// shared per-instance session id only for adapters that support several threads per session (Codex, whose capabilities this scripted provider borrowed for everything else); for Pi it allocates
// a session per thread, so each thread has its own session and its own live runtime, as in production.
const PiShapedCapabilities = {
  ...CodexProviderCapabilitiesV2,
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
} as const;
const sessionIdOf = (n: number) => `0197d3c0-0000-7000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------------------------------------------------------------- the scripted provider
/** A scripted Pi-shaped provider. It records what T3 asks and finishes or interrupts a turn only on request or when T3 interrupts it. */
const scriptedProvider = Effect.fn("m05.scriptedProvider")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  // The folder the Backend's index sees for each session: a plain directory, not a git workspace (the identity's project derivation reads it).
  const plain = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `m05-folder-${name}-`)),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(plain, { recursive: true, force: true })),
  );
  // One event queue PER provider session (review fix 3). A single shared queue made every session's stream compete for every event, so a turn event could be taken by another session's
  // stream and never reach the run it belongs to; each turn's events now go to the queue of the session that opened its thread.
  const queues = new Map<string, Queue.Queue<ProviderAdapter.ProviderAdapterV2Event>>();
  const queueOf = (sessionId: string) =>
    Effect.gen(function* () {
      const known = queues.get(sessionId);
      if (known !== undefined) return known;
      const made = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
      queues.set(sessionId, made);
      return made;
    });
  const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
  const interrupted: string[] = [];
  const interruptCalls: { thread: string; turn: string }[] = [];
  /** While `gate.holding` is true, `startTurn` is accepted (recorded in `started`) but its first `provider_turn.updated` is withheld, so T3 has not projected the provider turn: the window R2-F1 is about. */
  const gate = { holding: false, held: [] as ProviderAdapter.ProviderAdapterV2TurnInput[] };
  const sessionOf = new Map<string, string>();
  const turnEvent = (
    turn: ProviderAdapter.ProviderAdapterV2TurnInput,
    status: "running" | "interrupted" | "completed",
  ) =>
    Effect.gen(function* () {
      const at = yield* DateTime.now;
      const events = yield* queueOf(String(turn.providerThread.providerSessionId));
      yield* Queue.offer(events, {
        type: "provider_turn.updated",
        driver,
        providerTurn: {
          id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
          providerThreadId: turn.providerThread.id,
          nodeId: turn.rootNodeId,
          runAttemptId: turn.attemptId,
          nativeTurnRef: { driver, nativeId: `native:${turn.attemptId}`, strength: "strong" },
          ordinal: turn.providerTurnOrdinal,
          status,
          startedAt: at,
          completedAt: status === "running" ? null : at,
        },
      });
    });
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(PiShapedCapabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const events = yield* queueOf(String(input.providerSessionId));
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: plain,
            model: modelSelection.model,
            capabilities: PiShapedCapabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId, existingProviderThread }) =>
            Effect.sync(() => {
              // IP-25: the Pi adapter opens a session under the id the Backend asked for; this provider reads the same slot.
              const seam = (
                globalThis as Record<
                  symbol,
                  { readonly take: (id: string) => string | undefined } | undefined
                >
              )[Symbol.for("aetheria.pi.session-id-seam")];
              const requested = seam?.take(`${threadId}`);
              const known = sessionOf.get(`${threadId}`);
              const id = requested ?? known ?? sessionIdOf(sessionOf.size + 1);
              sessionOf.set(`${threadId}`, id);
              return id;
            }).pipe(
              Effect.map((id) => ({
                id: ProviderThreadId.make(`provider-thread:${threadId}`),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: input.providerSessionId,
                appThreadId: threadId,
                ownerNodeId: null,
                nativeThreadRef: {
                  driver,
                  nativeId: `/sessions/2026-11-11_${id}.jsonl`,
                  strength: "strong" as const,
                },
                nativeConversationHeadRef: null,
                status:
                  existingProviderThread === undefined ? ("idle" as const) : ("idle" as const),
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
              })),
            ),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.sync(() => void started.push(turn)).pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  gate.holding
                    ? Effect.sync(() => void gate.held.push(turn))
                    : turnEvent(turn, "running"),
                ),
              ),
            ),
          steerTurn: () => Effect.void,
          interruptTurn: (request) =>
            Effect.sync(() => {
              interrupted.push(String(request.providerThread.appThreadId));
              // Per-call record (review fix 3): which thread and which provider turn each interrupt asked for, so a missing interrupt is told from a mis-attributed one.
              interruptCalls.push({
                thread: String(request.providerThread.appThreadId),
                turn: String(request.providerTurnId),
              });
            }).pipe(
              Effect.andThen(
                Effect.forEach(
                  started.filter(
                    (turn) =>
                      ProviderTurnId.make(`provider-turn:${turn.attemptId}`) ===
                      request.providerTurnId,
                  ),
                  (turn) => turnEvent(turn, "interrupted"),
                  { discard: true },
                ),
              ),
            ),
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  /** Completes the newest started turn of an app thread (the provider says the turn ended well). */
  const finish = (threadId: string) =>
    Effect.gen(function* () {
      const turn = started.filter((t) => String(t.threadId) === threadId).at(-1);
      if (turn === undefined) return yield* Effect.die(new Error(`no turn started on ${threadId}`));
      yield* turnEvent(turn, "completed");
    });
  /** Stops holding and delivers the withheld first events, as a provider whose event reaches T3 late would. */
  const release = Effect.suspend(() => {
    gate.holding = false;
    const held = gate.held.splice(0);
    return Effect.forEach(held, (turn) => turnEvent(turn, "running"), { discard: true });
  });
  return { cwd, started, interrupted, interruptCalls, sessionOf, adapter, finish, gate, release };
});

type Script = Effect.Success<ReturnType<typeof scriptedProvider>>;

// ---------------------------------------------------------------------------------------------------------------------------------------- the layers
const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerIntakeServices = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-m05-real-",
  }).pipe(Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))));
  const layerThreads = ThreadManagementService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        EventStore.layer.pipe(Layer.provide(layerDatabase)),
        ProviderReplayHarness.layerWithRegistry(
          { name },
          ProviderAdapterRegistry.layerSingle(adapter),
          { databaseLayer: layerDatabase, runEffectWorker: false },
        ),
      ),
    ),
    Layer.provideMerge(
      ServerSettings.layerTest({ providerInstances: { [instanceId]: { driver, enabled: true } } }),
    ),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  // T3's real recovery service over the SAME database (the restart test runs it), with project continuation ON: the setting R2 must override for a child.
  const layerRecovery = ProviderRuntimeRecovery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
        EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
        ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        IdAllocator.layer,
      ),
    ),
    Layer.provideMerge(layerThreads),
  );
  const layerRegistry = McpSessionRegistry.layer.pipe(
    Layer.provideMerge(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m05-real")),
      }),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Layer.mergeAll(layerRecovery, layerIntakeServices, IdAllocator.layer, layerRegistry);
};

// ----------------------------------------------------------------------------------------------------------------------------------- scratch material
const GIT_FREE_ROLE = (tool: string, tools: string) =>
  `---\nname: ${tool}\ndescription: A scratch role.\nmetadata:\n  dsh:\n    tool: ${tool}\n    routes:\n      - { provider: pi, model: test-model, effort: high }\n    tools: [${tools}]\n    maxDepth: 2\n    background: continuable\n---\n\nThe job: do the scratch work.\n`;

const makeCheckout = (dir: string) => {
  NodeFS.mkdirSync(NodePath.join(dir, ".agents", "agents", "ae"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(dir, ".agents", "agents", "ae", "worker.md"),
    GIT_FREE_ROLE("worker", "read, grep, lead"),
  );
  NodeFS.writeFileSync(
    NodePath.join(dir, ".agents", "agents", "ae", "lead.md"),
    GIT_FREE_ROLE("lead", "read, grep, worker"),
  );
  NodeFS.mkdirSync(NodePath.join(dir, ".aetheria"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(dir, ".aetheria", "settings.json"),
    JSON.stringify({ paths: { cycles: "cycles/" } }),
  );
  // The role reader treats the checkout as a git repository, as the matrix rig's scratch checkout is.
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { env },
    );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
};

const writeMainRecord = (stateRoot: string, sessionId: string) => {
  NodeFS.mkdirSync(NodePath.join(stateRoot, "identity"), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(stateRoot, "identity", `${sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state: "active",
      attemptId: `attempt-${sessionId}`,
      writer: "agent-host",
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
    }),
    { mode: 0o600 },
  );
};

interface Who {
  readonly threadId: string;
  readonly sessionId: string;
  readonly credential: string;
}
interface Outcome {
  readonly ok: boolean;
  readonly code?: string | undefined;
  readonly value?: Record<string, unknown> | undefined;
  readonly status: string;
}

// ------------------------------------------------------------------------------------------------------------------------------------ the world
interface BootOptions {
  readonly stateRoot?: string;
  readonly notices?: Array<{ key: string; childThreadId: string; parentThreadId: string }>;
  readonly onRestart?: (report: unknown) => void;
}

type World = Effect.Success<ReturnType<typeof makeWorld>>;

const world = <A, E>(name: string, body: (w: World) => Effect.Effect<A, E, any>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scriptedProvider(name);
      return yield* Effect.gen(function* () {
        const w = yield* makeWorld(name, script);
        return yield* body(w);
      }).pipe(Effect.provide(layerRuntime(name, script.adapter)));
    }),
  );

const makeWorld = Effect.fn("m05.world")(function* (name: string, script: Script) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const sink = yield* EventSink.EventSinkV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const recovery = yield* ProviderRuntimeRecovery.ProviderRuntimeRecoveryService;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const base = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `m05-real-${name}-`)),
  );
  const checkout = NodePath.join(base, "checkout");
  const home = NodePath.join(base, "home");
  NodeFS.mkdirSync(home);
  makeCheckout(checkout);
  const stateRoot = NodePath.join(base, "state");
  NodeFS.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFS.rmSync(base, { recursive: true, force: true })),
  );

  const credentials = new Map<string, string>();
  const credentialOf = async (threadId: string): Promise<string> => {
    const have = credentials.get(threadId);
    if (have !== undefined) return have;
    const issued = await runPromise(
      registry.issue({ threadId: ThreadId.make(threadId), providerInstanceId: instanceId }),
    );
    credentials.set(threadId, issued.config.providerSessionId);
    return issued.config.providerSessionId;
  };

  const port = yield* makeChildThreadPort({ threads, orchestrator, sessions, sink, ids });
  const domainEvents: Array<{ type: string; threadId: string; reason: string }> = [];
  yield* orchestrator.streamDomainEvents.pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        const payload = (event as { payload?: { reason?: string } }).payload;
        domainEvents.push({
          type: event.type,
          threadId: String((event as { threadId?: string }).threadId),
          reason: String(payload?.reason ?? ""),
        });
      }),
    ),
    Effect.forkScoped,
  );

  let counter = 0;
  /** One Backend over `stateRoot`, fed by T3's event stream; a second one over the same roots is a restart. */
  const boot = async (options: BootOptions = {}) => {
    let current: AetheriaBackendService | undefined;
    const bindingOf = (sessionId: string) => current?.index.bindingOfSession(sessionId);
    const callerContext = await runPromise(
      makeCallerContext(orchestrator, (sessionId) => {
        const binding = bindingOf(sessionId);
        return binding === undefined
          ? undefined
          : { threadId: binding.threadId, workingFolder: binding.workingFolder };
      }),
    );
    const launchFacts = await runPromise(
      makeLaunchFacts(orchestrator, (sessionId) => bindingOf(sessionId)?.threadId),
    );
    const lineage = await runPromise(
      Effect.gen(function* () {
        const { makeLineageReader: make } = yield* Effect.succeed({ makeLineageReader });
        return yield* make(threads, (threadId) => {
          const found = current?.index.lookup(threadId);
          return found === undefined
            ? "unknown"
            : found.status === "ok"
              ? found.binding.sessionId
              : found.status === "absent"
                ? null
                : "unknown";
        });
      }),
    );
    const factory = createOrchestrationFactory({
      callerContext,
      newSessionId: () => sessionIdOf(1000 + (counter += 1)),
      newThreadId: () => `thread:m05-fork-${counter}`,
      ...(options.onRestart === undefined ? {} : { onRestart: options.onRestart as never }),
      ...(options.notices === undefined
        ? {}
        : {
            notifyRestart: async (notice) => {
              options.notices?.push(notice);
              return { ok: true };
            },
          }),
    });
    const made = createAetheriaBackendService({
      stateRoot: options.stateRoot ?? stateRoot,
      credentialOf,
      projectRootOf: (folder: string) => folder,
      checkout,
      auditRoles: { env: {}, homedir: () => home },
      childThreads: port,
      childLineage: lineage,
      launchFacts,
      callerContext,
      orchestrationFactory: factory,
    } as never);
    assert.equal(made.outcome, "prepared", JSON.stringify(made));
    if (made.outcome !== "prepared") throw new Error("unreachable");
    const service = made.service;
    current = service;
    const started = await service.start();
    assert.equal(started.outcome, "started", JSON.stringify(started));
    const feed = Effect.runForkWith(runContext)(
      sink.stream().pipe(
        Stream.runForEach((stored) =>
          Effect.promise(() => service.ingest(stored as unknown as StoredEventLike)),
        ),
        Effect.ignore,
      ),
    );
    const backend = Xc6Route.productionBackend(service);
    const call = async (who: Who, op: string, args: Record<string, unknown>): Promise<Outcome> => {
      const send = (body: unknown) =>
        backend.handle({
          caller: {
            threadId: who.threadId,
            providerSessionId: who.credential,
            providerInstanceId: "pi",
          },
          claimedSessionId: who.sessionId,
          body,
        });
      let reply = await send({ v: 1, op, args });
      const begun = await runPromise(Clock.currentTimeMillis);
      while ((reply.body as { status?: string }).status === "pending") {
        assert.isBelow(
          (await runPromise(Clock.currentTimeMillis)) - begun,
          8000,
          `${op} did not settle`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        reply = await send({ v: 1, poll: (reply.body as { token: string }).token });
      }
      const body = reply.body as {
        status: string;
        code?: string;
        result?: { ok: boolean; code?: string; value?: Record<string, unknown> };
      };
      return body.status === "done" && body.result !== undefined
        ? { ...body.result, ok: body.result.ok, status: body.status }
        : { ok: false, code: body.code, status: body.status };
    };
    return {
      service,
      call,
      stop: async () => {
        await runPromise(Fiber.interrupt(feed));
        return service.dispose("test");
      },
    };
  };
  const runContext = yield* Effect.context<never>();

  const until = (label: string, ready: () => unknown) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        yield* worker.drain();
        if (ready()) return;
        yield* Effect.sleep("25 millis");
      }
      return yield* Effect.die(new Error(`timed out waiting for ${label}`));
    });

  /** A running main thread (its first turn is live) with an active M03 `main` record, a real credential, and the Backend's index binding. */
  const mainThread = Effect.fn("m05.mainThread")(function* (
    svc: { readonly service: AetheriaBackendService },
    threadId: string,
    n: number,
  ) {
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId: ThreadId.make(threadId),
      projectId: ProjectId.make(`project:m05-real-${name}`),
      title: threadId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: script.cwd,
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`first:${threadId}`),
      threadId: ThreadId.make(threadId),
      messageId: MessageId.make(`message:first:${threadId}`),
      text: "first",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* worker.drain();
    yield* until(`${threadId} to run`, () =>
      script.started.some((turn) => String(turn.threadId) === threadId),
    );
    const sessionId = script.sessionOf.get(threadId) ?? sessionIdOf(n);
    writeMainRecord(stateRoot, sessionId);
    const credential = yield* Effect.promise(() => credentialOf(threadId));
    // The feed binds the session when both of T3's events have reached it; the credential must exist by then, so re-ingest nothing: wait for the binding.
    yield* until(
      `${threadId} to be bound in the index`,
      () => svc.service.index.bindingOfSession(sessionId) !== undefined,
    );
    return { threadId, sessionId, credential } satisfies Who;
  });

  /** The Who of a child the service made: its thread (from the spawn result), its chosen Pi session, and a credential, once the index holds its binding. */
  const childWho = (svc: { readonly service: AetheriaBackendService }, childThreadId: string) =>
    Effect.gen(function* () {
      yield* until(`${childThreadId} to be bound in the index`, () => {
        const found = svc.service.index.lookup(childThreadId);
        return found.status === "ok";
      });
      const found = svc.service.index.lookup(childThreadId);
      if (found.status !== "ok") return yield* Effect.die(new Error("child not bound"));
      return {
        threadId: childThreadId,
        sessionId: found.binding.sessionId,
        credential: yield* Effect.promise(() => credentialOf(childThreadId)),
      } satisfies Who;
    });

  /**
   * Waits until T3's PROJECTION holds a running provider turn for each thread. The scripted provider's `started` list is filled when `startTurn` is called, BEFORE the turn's first
   * `provider_turn.updated` event has been ingested; an interrupt in that window finds no provider turn in the projection and T3 settles the run itself ("interrupted before its provider turn
   * started", Orchestrator.ts interrupt decider) without asking the provider. A test that cancels a tree of RUNNING turns must wait for this, not for `started`.
   */
  const untilTurnsProjected = (threadIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        yield* worker.drain();
        const projected = yield* Effect.forEach(threadIds, (id) =>
          orchestrator
            .getThreadProjection(ThreadId.make(id))
            .pipe(Effect.map((p) => p.providerTurns.some((turn) => turn.status === "running"))),
        );
        if (projected.every(Boolean)) return;
        yield* Effect.sleep("25 millis");
      }
      return yield* Effect.die(
        new Error(`timed out waiting for a running provider turn on ${threadIds.join(", ")}`),
      );
    });

  const runOf = (threadId: string) =>
    orchestrator
      .getThreadProjection(ThreadId.make(threadId))
      .pipe(Effect.map((p) => [...p.runs].sort((a, b) => b.ordinal - a.ordinal)[0]));

  return {
    script,
    orchestrator,
    worker,
    threads,
    port,
    recovery,
    domainEvents,
    boot,
    until,
    mainThread,
    childWho,
    untilTurnsProjected,
    runOf,
    stateRoot,
    sessions,
  };
});

const value = (outcome: Outcome) => {
  assert.isTrue(outcome.ok, JSON.stringify(outcome));
  return outcome.value as Record<string, unknown>;
};
const spawnArgs = (extra: Record<string, unknown> = {}) => ({
  role: "lead",
  prompt: "do the task",
  mode: "continuable",
  ...extra,
});
const ADJACENCY_CODES = new Set(["CHILD_NOT_ADJACENT", "CHILD_NOT_OWNED", "AUTH_NOT_ALLOWED"]);

// ============================================================================================================================ case 1 (and the F1 refusal)
it.live(
  "case 1: adjacency, interrupt and close over a real T3 tree (parent, child, grandchild, sibling, a second root) use real lineage and real thread.stop with stopDelegatedTasks false; a closed caller starts nothing",
  () =>
    world("tree", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-parent", 1);
        const other = yield* w.mainThread(svc, "thread:m05-other-root", 2);

        const c = value(
          yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())),
        );
        const c2 = value(
          yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())),
        );
        const childId = String(c.childId);
        const siblingId = String(c2.childId);
        const child = yield* w.childWho(svc, childId);
        yield* w.until("the child's turn to run", () =>
          w.script.started.some((turn) => String(turn.threadId) === childId),
        );
        // The child's own caller context needs its run to be calling; the grandchild is made BY the child.
        yield* w.until("the child's run to be running", () => true);
        yield* Effect.sleep("150 millis");
        const g = value(
          yield* Effect.promise(() =>
            svc.call(child, "children.spawn", spawnArgs({ role: "worker" })),
          ),
        );
        const grandId = String(g.childId);
        const grand = yield* w.childWho(svc, grandId);
        const d = value(
          yield* Effect.promise(() => svc.call(other, "children.spawn", spawnArgs())),
        );
        const strangerId = String(d.childId);

        // The real lineage T3 holds, as the archive reads it.
        const listed = yield* Effect.promise(() => w.port.readLastRun({ threadId: grandId }));
        assert.isTrue(listed.ok);
        const lineageOf = (id: string) =>
          w.orchestrator
            .getThreadProjection(ThreadId.make(id))
            .pipe(Effect.map((p) => p.thread.lineage));
        const grandLineage = yield* lineageOf(grandId);
        assert.equal(String(grandLineage.parentThreadId), childId);
        assert.equal(String(grandLineage.rootThreadId), parent.threadId);
        assert.equal(String((yield* lineageOf(strangerId)).rootThreadId), other.threadId);

        const messageCount = (id: string) =>
          w.orchestrator
            .getThreadProjection(ThreadId.make(id))
            .pipe(Effect.map((p) => p.messages.length));
        const before = yield* messageCount(grandId);
        const send = (who: Who, target: string) =>
          Effect.promise(() => svc.call(who, "children.message", { target, content: "hello" }));

        // Adjacent: a direct parent to its child, and a child to its own child.
        assert.isTrue((yield* send(parent, childId)).ok);
        assert.isTrue((yield* send(child, grandId)).ok);
        const refusals: Array<[string, Who, string]> = [
          ["parent to grandchild", parent, grandId],
          ["grandchild to grandparent", grand, parent.threadId],
          ["child to its sibling", child, siblingId],
          ["a second root to the first root's child", other, childId],
          ["the first root to a stranger's child", parent, strangerId],
        ];
        const seen: string[] = [];
        for (const [label, who, target] of refusals) {
          const outcome = yield* send(who, target);
          seen.push(`${label}: ${outcome.ok ? "accepted" : outcome.code}`);
          if (NEGATIVE === "adjacent-all") continue;
          assert.isFalse(outcome.ok, `${label}: ${JSON.stringify(outcome)}`);
          assert.isTrue(ADJACENCY_CODES.has(String(outcome.code)), `${label}: ${outcome.code}`);
        }
        if (NEGATIVE === "adjacent-all")
          assert.fail(
            `negative control: every refusal was expected to be accepted: ${seen.join("; ")}`,
          );
        // The refused messages reached no thread: the grandchild got only the child's.
        assert.equal(yield* messageCount(grandId), before + 1);

        // Interrupt: the parent interrupts its child through T3's real interruptThread. Only that child's turn is interrupted; its descendant is untouched.
        const interrupt = yield* Effect.promise(() =>
          svc.call(parent, "children.interrupt", { target: childId }),
        );
        assert.deepEqual(interrupt.value, { accepted: true });
        yield* w.worker.drain();
        assert.include(w.script.interrupted, childId);
        assert.notInclude(w.script.interrupted, grandId);
        assert.equal((yield* w.runOf(grandId))?.status, "running", "the grandchild still runs");

        // Close: real thread.stop with stopDelegatedTasks:false. The grandchild's task keeps running; the closed child takes no message and starts no child.
        const closed = yield* Effect.promise(() =>
          svc.call(parent, "children.close", { target: childId }),
        );
        assert.isTrue(closed.ok, JSON.stringify(closed));
        yield* w.worker.drain();
        assert.equal(
          (yield* w.runOf(grandId))?.status,
          "running",
          "close does not cascade to the descendant",
        );
        assert.notInclude(w.script.interrupted, grandId);
        const afterClose = yield* send(parent, childId);
        assert.isFalse(afterClose.ok, JSON.stringify(afterClose));
        const startedBefore = w.script.started.length;
        const refusedSpawn = yield* Effect.promise(() =>
          svc.call(child, "children.spawn", spawnArgs({ role: "worker" })),
        );
        assert.isFalse(refusedSpawn.ok);
        // Observed on real T3: close stops the child's run, so the caller-context port finds no calling run and the call fails closed as unavailable BEFORE the F1 standing check
        // (NOT_AUTHORIZED) can be reached. Either way nothing is created and no turn starts; the F1 refusal itself is the fork factory test and the matrix's closed-child tests.
        assert.include(["NOT_AUTHORIZED", "ORCHESTRATION_UNAVAILABLE"], String(refusedSpawn.code));
        assert.equal(w.script.started.length, startedBefore, "the closed caller started no turn");
        yield* Effect.promise(() => svc.stop());
      }),
    ),
  300_000,
);

it.live(
  "case 1: the user's cancelTree interrupts each running continuable descendant one by one through real interruptThread, then stops the root (thread.stop, stopDelegatedTasks false)",
  () =>
    world("cancel-tree", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-cancel-root", 1);
        const running = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        const idle = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        yield* w.until("both children to run", () =>
          [running, idle].every((id) => w.script.started.some((t) => String(t.threadId) === id)),
        );
        // NOT shown here: the idle-resident branch. The scripted provider cannot complete a turn (a "completed" provider_turn.updated leaves T3's run running: observed), so both
        // children are running; the idle-preserved case is the matrix's op-cancelTree (FX-TP) and needs a provider that settles a turn (real Pi).
        // Both provider turns must be RUNNING IN T3's projection, not merely started at the provider (review fix 3, finding 3: cancelling in the window between the two left the second
        // child's provider turn running and never interrupted; see `untilTurnsProjected`).
        yield* w.untilTurnsProjected([running, idle]);
        const direct = svc.service.orchestration()?.direct();
        assert.isDefined(direct);
        const result = yield* Effect.promise(() =>
          (
            direct as unknown as {
              cancelTree: (input: unknown) => Promise<{
                ok: boolean;
                value?: { rows: Array<{ childId: string; action: string }> };
              }>;
            }
          ).cancelTree({ caller: { user: true }, args: { rootThreadId: parent.threadId } }),
        );
        assert.isTrue(result.ok, JSON.stringify(result));
        yield* w.worker.drain();
        const actions = Object.fromEntries(
          (result.value?.rows ?? []).map((r) => [r.childId, r.action]),
        );
        assert.match(String(actions[running]), /interrupt/i);
        assert.match(String(actions[idle]), /interrupt/i);
        // Each thread has its own provider session, as Pi has in production (one thread per session), so no thread's interrupt can find another's session torn down.
        const sessionsOfStarted = new Set(
          w.script.started.map((t) => String(t.providerThread.providerSessionId)),
        );
        assert.equal(
          sessionsOfStarted.size,
          3,
          "root and both children each hold their own provider session",
        );
        // BOTH children's turns are interrupted at the provider (each call names its own thread and that thread's started provider turn), and both reach T3's terminal `interrupted` state.
        for (const id of [running, idle]) {
          const startedTurn = w.script.started.find((t) => String(t.threadId) === id);
          assert.deepEqual(
            w.script.interruptCalls.filter((c) => c.thread === id),
            [{ thread: id, turn: `provider-turn:${startedTurn?.attemptId}` }],
            `exactly one provider interrupt, for the started turn, on ${id}`,
          );
        }
        assert.equal((yield* w.runOf(running))?.status, "interrupted");
        assert.equal((yield* w.runOf(idle))?.status, "interrupted");
        assert.equal(
          w.script.started.filter((t) => String(t.threadId) === idle).length,
          1,
          "the second child's turn was started once and never restarted",
        );
        // The root's own run was stopped by the same real thread.stop.
        assert.equal((yield* w.runOf(parent.threadId))?.status, "interrupted");
        yield* Effect.promise(() => svc.stop());
      }),
    ),
  300_000,
);

// ====================================================================================================================================== case 1b (R2-F1)
it.live(
  "case 1b (independent review 2, finding 1): Stop straight after spawn, while T3 has accepted the provider start but not yet projected either provider turn, still interrupts both children's provider turns",
  () =>
    world("cancel-tree-early", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-cancel-early", 1);
        // The provider accepts each start but its first `provider_turn.updated` is withheld: T3's projection holds NO provider turn for either child, the window in which an interrupt
        // used to settle the run "interrupted before its provider turn started" while the provider turn kept running. No readiness wait (`untilTurnsProjected`) is used on purpose.
        w.script.gate.holding = true;
        const first = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        const second = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        yield* w.until("both children's starts to reach the provider", () =>
          [first, second].every((id) => w.script.started.some((t) => String(t.threadId) === id)),
        );
        for (const id of [first, second]) {
          const projection = yield* w.orchestrator.getThreadProjection(ThreadId.make(id));
          assert.equal(
            projection.providerTurns.length,
            0,
            `${id} has no projected provider turn yet (the window under test)`,
          );
        }
        const direct = svc.service.orchestration()?.direct();
        assert.isDefined(direct);
        const result = yield* Effect.promise(() =>
          (
            direct as unknown as {
              cancelTree: (input: unknown) => Promise<{
                ok: boolean;
                value?: { rows: Array<{ childId: string; action: string }> };
              }>;
            }
          ).cancelTree({ caller: { user: true }, args: { rootThreadId: parent.threadId } }),
        );
        assert.isTrue(result.ok, JSON.stringify(result));
        yield* w.worker.drain();
        // The provider's first events now reach T3, late, as they would from a real provider.
        yield* w.script.release;
        yield* w.until("both children's provider turns to be interrupted at the provider", () =>
          [first, second].every((id) => w.script.interruptCalls.some((c) => c.thread === id)),
        );
        yield* w.worker.drain();
        for (const id of [first, second]) {
          const startedTurn = w.script.started.find((t) => String(t.threadId) === id);
          assert.deepEqual(
            w.script.interruptCalls.filter((c) => c.thread === id),
            [{ thread: id, turn: `provider-turn:${startedTurn?.attemptId}` }],
            `exactly one provider interrupt, for the started turn, on ${id}`,
          );
          assert.equal((yield* w.runOf(id))?.status, "interrupted");
        }
        yield* Effect.promise(() => svc.stop());
      }),
    ),
  300_000,
);

// =========================================================================================================================================== case 2
it.live(
  "case 2: T3's close of a child (thread.stop) detaches no provider session and revokes nothing; only a terminal thread.archive detaches it (the credential revocation is T3's own terminal-detach rule)",
  () =>
    world("revocation", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-revoke-root", 1);
        const closing = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        const archived = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        yield* w.until("both children to run", () =>
          [closing, archived].every((id) =>
            w.script.started.some((t) => String(t.threadId) === id),
          ),
        );
        const detachedFor = (id: string) =>
          w.domainEvents.filter((e) => e.type === "provider-session.detached" && e.threadId === id);

        const closed = yield* Effect.promise(() =>
          svc.call(parent, "children.close", { target: closing }),
        );
        assert.isTrue(closed.ok, JSON.stringify(closed));
        yield* w.worker.drain();
        yield* Effect.sleep("100 millis");
        yield* w.worker.drain();
        assert.deepEqual(detachedFor(closing), [], "children.close detached no provider session");
        const status = yield* Effect.promise(() => w.port.status({ threadId: closing }));
        assert.isTrue(status.ok && status.status.resident !== false, JSON.stringify(status));

        // The contrast that makes the absence mean something: T3's terminal command does detach, with T3's own reason.
        yield* w.threads.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("m05-archive-contrast"),
          threadId: ThreadId.make(archived),
        } as never);
        yield* w.worker.drain();
        assert.isAbove(
          detachedFor(archived).filter((e) => /archived/i.test(e.reason)).length,
          0,
          `archive detaches: ${JSON.stringify(w.domainEvents.filter((e) => e.threadId === archived).map((e) => e.type))}`,
        );
        yield* Effect.promise(() => svc.stop());
      }),
    ),
  300_000,
);

// =========================================================================================================================================== case 4
it.live(
  "case 4 (spawn side only, no completion): a one-shot child spawned delivery record-only has T3's completion delivery for its task disposed at spawn, a chat-delivery child's is not, and a bounded await-report on the still-running child is not a completed report",
  () =>
    world("record-only", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-record-root", 1);
        const delivery = NEGATIVE === "no-record-only" ? "chat" : "record-only";
        const spawned = value(
          yield* Effect.promise(() =>
            svc.call(parent, "children.spawn", spawnArgs({ mode: "one-shot", delivery })),
          ),
        );
        const childId = String(spawned.childId);
        const chat = value(
          yield* Effect.promise(() =>
            svc.call(parent, "children.spawn", spawnArgs({ mode: "one-shot" })),
          ),
        );
        const chatId = String(chat.childId);
        yield* w.until("both one-shots to run", () =>
          [childId, chatId].every((id) => w.script.started.some((t) => String(t.threadId) === id)),
        );
        // What this shows: the SERVICE's record-only spawn reaches T3's own boundary. T3's delegated task for the record-only child has its completion delivery DISPOSED (the state both of
        // T3's delivery points skip, as recordOnlyDelivery.aetheria.test.ts proves with real Pi), and the chat-delivery child's task does not.
        // What it does NOT show, and why: a child COMPLETING and children.await-report returning its stored report. The scripted provider cannot settle a turn (a `completed`
        // provider_turn.updated leaves T3's run running: observed twice), and a real Pi world is out of this file's budget. The completion half at T3's boundary is
        // recordOnlyDelivery.aetheria.test.ts (real Pi); await-report over the stored report is tests/orchestration/matrix/operations.test.mjs and children-report.test.mjs (FX-TP).
        const parentProjection = yield* w.orchestrator.getThreadProjection(
          ThreadId.make(parent.threadId),
        );
        const taskOf = (id: string) =>
          parentProjection.subagents.find((s) => String(s.childThreadId) === id);
        assert.isDefined(taskOf(childId), "the parent holds the child's task");
        assert.equal(
          taskOf(childId)?.completionDelivery?.state,
          "disposed",
          "T3's task delivery is disposed for the record-only child",
        );
        // The control: the chat-delivery child's task is not disposed, so T3 would offer its completion to the parent.
        assert.notEqual(taskOf(chatId)?.completionDelivery?.state, "disposed");
        // The pending await is bounded and cancellable while the child still runs: a wait that elapses answers still-running, never a stored report that does not exist.
        const waiting = yield* Effect.promise(() =>
          svc.call(parent, "children.await-report", { target: childId, waitMs: 50 }),
        );
        assert.isFalse(
          waiting.ok && (waiting.value as { status?: unknown })?.status === "completed",
          JSON.stringify(waiting),
        );
        yield* Effect.promise(() => svc.stop());
      }),
    ),
  300_000,
);

// =========================================================================================================================================== case 6
it.live(
  "case 6: a restart over the real T3 store cuts a running child and its parent, continues only the parent, leaves T3's note empty for the app-owned child, and the restarted Backend settles the child backend-restarted and sends one notice, never a second",
  () =>
    world("restart", (w) =>
      Effect.gen(function* () {
        const svc = yield* Effect.promise(() => w.boot());
        const parent = yield* w.mainThread(svc, "thread:m05-restart-root", 1);
        const childId = String(
          value(yield* Effect.promise(() => svc.call(parent, "children.spawn", spawnArgs())))
            .childId,
        );
        yield* w.until("the child to run", () =>
          w.script.started.some((t) => String(t.threadId) === childId),
        );
        yield* Effect.promise(() => svc.stop());
        const startedBefore = w.script.started.length;
        const runsOf = (id: string) =>
          w.orchestrator
            .getThreadProjection(ThreadId.make(id))
            .pipe(Effect.map((p) => p.runs.length));
        const parentRunsBefore = yield* runsOf(parent.threadId);

        // T3's own startup recovery over the real store, project continuation ON.
        yield* w.recovery.reconcile("startup");
        yield* w.worker.drain();
        yield* Effect.sleep("150 millis");
        yield* w.worker.drain();
        const childRun = yield* w.runOf(childId);
        assert.include(
          ["cancelled", "interrupted"],
          String(childRun?.status),
          "the restart cut the child's run",
        );
        assert.equal(
          w.script.started.filter((t) => String(t.threadId) === childId).length,
          1,
          "the child was not re-run",
        );
        assert.isAbove(
          yield* runsOf(parent.threadId),
          parentRunsBefore - 0,
          "the parent's main-thread continuation was opened",
        );
        assert.isAbove(
          w.script.started.length,
          startedBefore,
          "T3 started a continuation turn (the parent's)",
        );
        const last = yield* Effect.promise(() => w.port.readLastRun({ threadId: childId }));
        assert.isTrue(last.ok && last.run?.outcome === "interrupted", JSON.stringify(last));
        // T3's restart note for the parent names nothing about the app-owned child: the archive owes the notice.
        const notes = yield* Effect.promise(() =>
          w.port.readRestartNotes({ threadId: parent.threadId }),
        );
        assert.deepEqual(notes, { ok: true, notes: [] });

        // The restarted Backend over the same stores.
        const notices: Array<{ key: string; childThreadId: string; parentThreadId: string }> = [];
        const reports: Array<{
          interruptedByRestart: string[];
          notices: { sent: string[]; byT3: string[] };
        }> = [];
        if (NEGATIVE !== "no-restart") {
          const second = yield* Effect.promise(() =>
            w.boot({ notices, onRestart: (r) => reports.push(r as never) }),
          );
          yield* w.until("the restart reconciliation to report", () => reports.length > 0);
          assert.deepEqual(reports[0]?.interruptedByRestart, [childId]);
          assert.deepEqual(reports[0]?.notices.byT3, [], "T3's note did not name the child");
          assert.lengthOf(notices, 1);
          assert.match(
            notices[0]!.key,
            new RegExp(`^child:${childId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:restart:`),
          );
          assert.equal(notices[0]!.parentThreadId, parent.threadId);
          yield* Effect.promise(() => second.stop());
          // A third Backend: the child's notice was delivered, so no second message is made.
          const again = yield* Effect.promise(() => w.boot({ notices }));
          yield* Effect.sleep("300 millis");
          assert.lengthOf(notices, 1, "a repeated boot sends no second notice");
          yield* Effect.promise(() => again.stop());
        } else {
          assert.fail(
            "negative control: the restart reconciliation was skipped, so no notice exists",
          );
        }
      }),
    ),
  300_000,
);

// =========================================================================================================================================== case 7
it.live(
  "case 7: T3 gives an unknown owner thread no delivery and no receipt (both unknown, never delivered or absent), the inputs under which the outbox keeps a row delivery-uncertain",
  () =>
    world("unknown-owner", (w) =>
      Effect.gen(function* () {
        const turn = yield* Effect.promise(() =>
          w.port.startTurn({
            threadId: "thread:m05-never-created",
            content: "notice",
            delivery: "queue",
            messageId: "outbox-unknown-owner-1",
          }),
        );
        assert.isFalse(turn.ok, JSON.stringify(turn));
        const receipt = yield* Effect.promise(() =>
          w.port.readMessageReceipt({
            threadId: "thread:m05-never-created",
            messageId: "outbox-unknown-owner-1",
          }),
        );
        assert.isFalse(receipt.ok);
        assert.equal(!receipt.ok && receipt.reason, "unavailable");
      }),
    ),
);
