// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDate:off runEffectInsideEffect:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
/* oxlint-disable t3code/no-wall-clock-in-tests, t3code/no-manual-effect-runtime-in-tests, t3code/no-real-time-wait-in-tests -- This is a subprocess and loopback-network fixture: its milestones (an installed Pi child's events, a client's reply timing out because the reply is lost, an XC-6 renewal pace of 5 s) come from outside the Effect runtime, so they are awaited by polling the child's event stream and the scripted clients are driven from plain async code. */
// AETHERIA M06 Plan step 8: installed Pi 1.5.0 + real ask_user_question over real XC-6 + real Backend/archive service + real client RPC group + T3 dispatch.
// Cases NORMAL, CONSEQUENTIAL FAILURE, RESTART, each in a fresh world. Doubles: scripted providers, the host-style identity record, a down-route proxy.
// Not shown: the shipped scenario bundle, a WebSocket/device session, abrupt Backend death, Linux. Evidence records the same limits.
// HC_FIRST_SLICE_MUTATE=normal|failure|restart seeds one mutation per case; that case must turn red.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import {
  createAetheriaBackendService,
  type AetheriaBackendService,
} from "@t3tools/aetheria-server";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  WsRpcGroup,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServer } from "effect/http";
import * as RpcTest from "effect/rpc/RpcTest";
import { describe, expect } from "vitest";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import type { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { layerFromBackend } from "./backendComposition.ts";
import { connectionActor, interactionsAnswer, interactionsSnapshot } from "./humanControlRpc.ts";
import { makeThreadTurnDispatch } from "./humanControlDelivery.ts";
import type { Xc6Backend, Xc6Response } from "./xc6Core.ts";
import * as Xc6Route from "./xc6Route.ts";

const OUTER =
  process.env.AETHERIA_OUTER_ROOT ?? NodePath.resolve(import.meta.dirname, "../../../../../..");
const PI_DIR = NodePath.join(OUTER, "node_modules/@earendil-works/pi-coding-agent");
const PI_CLI = NodePath.join(PI_DIR, "dist/bundle/cli.js");
const FAUX = NodePath.join(OUTER, "tests/tools/installed-pi-world.faux.mjs");
const ASK = NodePath.join(OUTER, "tests/human-control/first-slice/ask-extension.mjs");
const WRITER = NodePath.join(OUTER, "tests/human-control/evidence/writer.mjs");
const MISSING = [PI_CLI, FAUX, WRITER].filter((file) => !NodeFS.existsSync(file));
const MUTATE = process.env.HC_FIRST_SLICE_MUTATE ?? "";

const M = AETHERIA_WS_METHODS;
const SESSION = "0197d3c0-3333-7000-8000-0000000000a1";
const THREAD = "thread:hc-first-slice";
const FOLDER = "/work/project";
const RUNTIME = "provider-session:provider-instance:pi:thread:hc";
const QUESTIONS = [{ id: "q1", question: "Which one?", options: [{ label: "A" }, { label: "B" }] }];
const MODEL = [{ provider: "faux-m06", id: "faux-ask", input: ["text"] }];
const REVISION_FORGED = "f".repeat(64);
const answerWith = (label: string) => [{ id: "q1", selected: [label], skipped: false }];

type Json = Record<string, any>; // replies are checked field by field below; the wire shapes are the contracts' own
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// T3's pieces below are copied from humanControlDelivery.aetheria.test.ts (its helpers are not exported).
const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

const scriptedProvider = Effect.fn("firstSlice.scriptedProvider")(function* (name: string) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd,
            model: modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.sync(() => {
              started.push(turn);
            }).pipe(
              Effect.andThen(
                Queue.offer(events, {
                  type: "provider_turn.updated",
                  driver,
                  providerTurn: {
                    id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                    providerThreadId: turn.providerThread.id,
                    nodeId: turn.rootNodeId,
                    runAttemptId: turn.attemptId,
                    nativeTurnRef: {
                      driver,
                      nativeId: `native:${turn.attemptId}`,
                      strength: "strong",
                    },
                    ordinal: turn.providerTurnOrdinal,
                    status: "running",
                    startedAt: now,
                    completedAt: null,
                  },
                }),
              ),
            ),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  return { cwd, started, adapter };
});

const layerRuntime = (name: string, adapter: ProviderAdapter.ProviderAdapterV2["Service"]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  return ThreadManagementService.layer.pipe(
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
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
};

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-first-slice")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

type Kept = typeof M.interactionsAnswer | typeof M.interactionsSnapshot;
const rpcGroup = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, Kept> =>
      tag !== M.interactionsAnswer && tag !== M.interactionsSnapshot,
  ),
);

const stateRootBase = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  return base;
};

const startPi = (config: {
  readonly url: string;
  readonly bearer: string;
  readonly digest: string;
}) => {
  const root = NodeFS.mkdtempSync(NodePath.join(stateRootBase(), "m06-s08-pi-"));
  const dirs = Object.fromEntries(
    ["workspace", "agent", "home", "sessions"].map((name) => [name, NodePath.join(root, name)]),
  ) as Record<"workspace" | "agent" | "home" | "sessions", string>;
  for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });
  NodeChildProcess.execFileSync("git", ["init", "-q"], { cwd: dirs.workspace });
  const configPath = NodePath.join(root, "ask-config.json");
  NodeFS.writeFileSync(
    configPath,
    JSON.stringify({
      url: config.url,
      bearer: config.bearer,
      session: SESSION,
      digest: config.digest,
    }),
    { mode: 0o600 },
  );
  const script = [{ tool: "ask_user_question", args: { questions: QUESTIONS } }, { text: "done" }];
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dirs.home,
    PI_CODING_AGENT_DIR: dirs.agent,
    PI_DIR,
    FAUX_MODELS: JSON.stringify(MODEL),
    FAUX_SCRIPT: JSON.stringify(script),
    AETHERIA_CHECKOUT: OUTER,
    HC_ASK_CONFIG: configPath,
  };
  const args = [
    PI_CLI,
    "--mode",
    "rpc",
    "--offline",
    "--approve",
    "--session-dir",
    dirs.sessions,
    "--no-context-files",
    "--no-skills",
    "--no-extensions",
    "--extension",
    FAUX,
    "--extension",
    ASK,
    "--provider",
    MODEL[0]!.provider,
    "--model",
    MODEL[0]!.id,
  ];
  const child = NodeChildProcess.spawn(process.execPath, args, {
    cwd: dirs.workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events: Json[] = [];
  let err = "";
  let buffer = "";
  let exited: { code: number | null; signal: string | null } | null = null;
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (line) {
        try {
          events.push(JSON.parse(line));
        } catch {
          /* not a record */
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => (err += String(chunk)));
  child.once("close", (code, signal) => {
    exited = { code, signal };
  });
  const hasExited = () => exited !== null;
  return {
    events,
    send: (message: string) =>
      child.stdin.write(`${JSON.stringify({ type: "prompt", message })}\n`),
    async until(predicate: (event: Json) => boolean, what: string, ms = 60_000): Promise<Json> {
      const start = Date.now();
      for (;;) {
        const found = events.find(predicate);
        if (found) return found;
        if (exited !== null)
          throw new Error(
            `Pi exited (${JSON.stringify(exited)}) while waiting for ${what}: ${err.slice(-600)}`,
          );
        if (Date.now() - start > ms)
          throw new Error(`timed out waiting for ${what}: ${err.slice(-600)}`);
        await sleep(25);
      }
    },
    starts: () =>
      events.filter((e) => e.type === "tool_execution_start" && e.toolName === "ask_user_question"),
    ends: () =>
      events.filter((e) => e.type === "tool_execution_end" && e.toolName === "ask_user_question"),
    stderr: () => err.slice(-600),
    /** End stdin (Pi's RPC mode exits when it closes), wait for the process to exit, kill it only if it does not. */
    async finish(): Promise<{
      exited: boolean;
      killed: boolean;
      code: number | null;
      signal: string | null;
    }> {
      let killed = false;
      if (exited === null) {
        child.stdin.end();
        const start = Date.now();
        while (!hasExited() && Date.now() - start < 15_000) await sleep(50);
        if (exited === null) {
          killed = true;
          child.kill("SIGKILL");
          const killStart = Date.now();
          while (!hasExited() && Date.now() - killStart < 5_000) await sleep(50);
        }
      }
      const done = exited as { code: number | null; signal: string | null } | null;
      return {
        exited: done !== null,
        killed,
        code: done?.code ?? null,
        signal: done?.signal ?? null,
      };
    },
    workRoot: root,
  };
};
const textOf = (event: Json) =>
  ((event.result?.content ?? []) as Json[]).map((c) => c.text ?? "").join("");

let evidenceRun:
  | Promise<{ writeCase: (id: string, doc: Json) => { path: string }; dir: string; runId: string }>
  | undefined;
const outerCommit = () =>
  NodeChildProcess.execFileSync("git", ["-C", OUTER, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const forkCommit = () =>
  NodeChildProcess.execFileSync(
    "git",
    ["-C", NodePath.resolve(OUTER, "apps/t3code"), "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
const evidenceFor = (canaries: readonly string[]) => {
  evidenceRun ??= (async () => {
    const writer = (await import(NodeURL.pathToFileURL(WRITER).href)) as {
      createEvidenceRun: (options: Json) => {
        writeCase: (id: string, doc: Json) => { path: string };
        dir: string;
        runId: string;
      };
    };
    const root =
      process.env.HC_EVIDENCE_ROOT ?? NodePath.join(stateRootBase(), "m06-first-slice-evidence");
    return writer.createEvidenceRun({ root, commit: outerCommit(), canaries });
  })();
  return evidenceRun;
};

interface Seen {
  readonly op: string;
  readonly interactionId?: string;
  readonly servedBy: number | "down";
}
interface Client {
  snapshot: () => Promise<Json>;
  answer: (payload: Json) => Promise<Json>;
  readonly handled: string[];
  loseReply: boolean;
}

const makeWorld = (label: string, script: Effect.Success<ReturnType<typeof scriptedProvider>>) =>
  Effect.gen(function* () {
    const registry = yield* McpSessionRegistry.McpSessionRegistry;
    const server = yield* HttpServer.HttpServer;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const dispatch = yield* makeThreadTurnDispatch(threads, receipts);

    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${THREAD}`),
      threadId: ThreadId.make(THREAD),
      projectId: ProjectId.make("project:first-slice"),
      title: label,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: script.cwd,
      createdBy: "user",
      creationSource: "web",
    });

    // The M03 identity record, written the way the Agent host writes it (the state root's `identity/` folder).
    const writeIdentity = (to: string) => {
      NodeFS.mkdirSync(NodePath.join(to, "identity"), { recursive: true, mode: 0o700 });
      NodeFS.writeFileSync(
        NodePath.join(to, "identity", `${SESSION}.json`),
        JSON.stringify({
          formatVersion: 1,
          state: "active",
          attemptId: `attempt-${SESSION}`,
          writer: "agent-host",
          acceptedPrompt: false,
          record: {
            sessionId: SESSION,
            kind: "main",
            rootSessionId: SESSION,
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
    const stateRoot = NodeFS.mkdtempSync(NodePath.join(stateRootBase(), `m06-s08-${label}-`));
    writeIdentity(stateRoot);

    const issued = yield* registry.issue({
      threadId: ThreadId.make(THREAD),
      providerInstanceId: ProviderInstanceId.make("pi"),
    });
    const bearer = issued.config.authorizationHeader.slice("Bearer ".length);
    const credentials = new Map<string, string>([[THREAD, issued.config.providerSessionId]]);

    // The Backend, over a state root. Every start re-reads T3's thread events the way the server's feed does (replay from the start).
    const startService = async (root: string): Promise<AetheriaBackendService> => {
      const made = createAetheriaBackendService({
        stateRoot: root,
        credentialOf: (threadId) => credentials.get(threadId),
        projectRootOf: (folder) => folder,
        turnDispatch: dispatch,
      });
      if (made.outcome !== "prepared") throw new Error("the Backend must prepare");
      const started = await made.service.start();
      if (started.outcome !== "started")
        throw new Error(`the Backend did not start: ${started.outcome}`);
      await made.service.ingest({
        sequence: 1,
        event: {
          type: "provider-session.updated",
          threadId: THREAD,
          payload: { id: RUNTIME, providerInstanceId: "pi", status: "ready", cwd: FOLDER },
        },
      });
      await made.service.ingest({
        sequence: 2,
        event: {
          type: "provider-thread.updated",
          threadId: THREAD,
          payload: {
            driver: "pi",
            providerInstanceId: "pi",
            providerSessionId: RUNTIME,
            appThreadId: THREAD,
            nativeThreadRef: { nativeId: `/s/2026-11-08T08-00-00-000Z_${SESSION}.jsonl` },
          },
        },
      });
      await made.service.interactions()?.redeliver();
      return made.service;
    };

    const live = { service: yield* Effect.promise(() => startService(stateRoot)) };
    const services = [live.service];
    let root = stateRoot;

    // The route: T3's real XC-6 HTTP route and real bearer resolution. The proxy is the only double: it marks a generation, stands in for a down
    // process, and records what was served.
    const seen: Seen[] = [];
    let generation = 0;
    let routeUp = true;
    let core: Xc6Backend = Xc6Route.productionBackend(live.service);
    const down: Xc6Response = {
      http: 503,
      body: { v: 1, status: "unavailable", code: "XC6_TRANSPORT" },
    } as Xc6Response;
    const proxy: Xc6Backend = {
      observe: (listener) => core.observe(listener),
      handle: async (input) => {
        const body = (input.body ?? {}) as Json;
        const op = typeof body.op === "string" ? body.op : "poll";
        const interactionId =
          typeof body.args?.interactionId === "string" ? body.args.interactionId : undefined;
        const born = generation;
        if (!routeUp) {
          seen.push({
            op,
            ...(interactionId === undefined ? {} : { interactionId }),
            servedBy: "down",
          });
          return down;
        }
        const response = await core.handle(input);
        // A reply of an instance that has since gone down never reaches the caller: its connection died with the process.
        if (born !== generation) {
          seen.push({
            op,
            ...(interactionId === undefined ? {} : { interactionId }),
            servedBy: "down",
          });
          return down;
        }
        seen.push({
          op,
          ...(interactionId === undefined ? {} : { interactionId }),
          servedBy: born,
        });
        if (MUTATE === "normal" && op === "interaction.await") {
          const answers = (response.body as Json).result?.value?.resolution?.answers;
          if (Array.isArray(answers)) for (const a of answers) a.selected = ["A"];
        }
        return response;
      },
    };
    yield* HttpRouter.serve(
      Xc6Route.routeLayer(proxy).pipe(Layer.provide(layerFromBackend(live.service.backend))),
      { disableListenLog: true, disableLogger: true },
    ).pipe(Layer.build);
    const address = server.address;
    if (address._tag === "UnixPathAddress") throw new Error("the route must listen on TCP");
    const url = `http://127.0.0.1:${address.port}/mcp`;

    // Clients over T3's real RPC group, scope middleware and this package's handlers; the actor is the connection's.
    const backend = Option.some({ interactions: () => live.service.interactions() });
    let clientCount = 0;
    const makeClient = (
      scopes: ReadonlyArray<
        typeof AuthOrchestrationOperateScope | typeof AuthOrchestrationReadScope
      >,
    ) =>
      Effect.gen(function* () {
        clientCount += 1;
        const handled: string[] = [];
        const actor = yield* connectionActor({
          sessionId: `client-session-${clientCount}`,
          scopes,
        });
        const state = { loseReply: false };
        const rpc = yield* RpcTest.makeClient(rpcGroup).pipe(
          Effect.provide(
            Layer.mergeAll(
              rpcGroup.toLayerHandler(M.interactionsSnapshot, (payload) =>
                Effect.sync(() => handled.push("snapshot")).pipe(
                  Effect.andThen(interactionsSnapshot(backend, payload)),
                ),
              ),
              rpcGroup.toLayerHandler(M.interactionsAnswer, (payload) =>
                Effect.sync(() => handled.push("answer")).pipe(
                  Effect.andThen(interactionsAnswer(backend, actor, payload)),
                  // A lost reply: the work is done, the reply never arrives.
                  Effect.tap(() => (state.loseReply ? Effect.never : Effect.void)),
                ),
              ),
              RpcAuthorization.layer(scopes),
            ),
          ),
        );
        const settle = <A>(effect: Effect.Effect<A, unknown>) =>
          Effect.runPromise(
            Effect.race(
              effect.pipe(
                Effect.match({
                  onFailure: (e) => ({ rpcRefused: (e as { _tag?: string })._tag ?? "error" }),
                  onSuccess: (v) => v as unknown,
                }),
              ),
              Effect.sleep("1500 millis").pipe(Effect.as({ noReply: true } as unknown)),
            ),
          ) as Promise<Json>;
        const client: Client = {
          handled,
          get loseReply() {
            return state.loseReply;
          },
          set loseReply(value: boolean) {
            state.loseReply = value;
          },
          snapshot: () => settle(rpc[M.interactionsSnapshot]({ rootSessionId: SESSION })),
          answer: (payload) => settle(rpc[M.interactionsAnswer](payload as never)),
        };
        return { client, actor };
      });
    const reader = yield* makeClient([AuthOrchestrationReadScope]);
    const operator = yield* makeClient([AuthOrchestrationOperateScope, AuthOrchestrationReadScope]);
    const operator2 = yield* makeClient([
      AuthOrchestrationOperateScope,
      AuthOrchestrationReadScope,
    ]);
    const readOnly = yield* makeClient([AuthOrchestrationReadScope]);
    const lossy = yield* makeClient([AuthOrchestrationOperateScope, AuthOrchestrationReadScope]);

    const pi = startPi({ url, bearer, digest: live.service.digest().value });
    const caller = {
      threadId: THREAD,
      providerSessionId: issued.config.providerSessionId,
      providerInstanceId: "pi",
    };
    const journalPath = () => NodePath.join(root, "interactions", "journal", `${SESSION}.jsonl`);

    const world = {
      label,
      stateRoot,
      script,
      pi,
      seen,
      bearer,
      caller,
      clients: {
        reader: reader.client,
        operator: operator.client,
        operator2: operator2.client,
        readOnly: readOnly.client,
        lossy: lossy.client,
      },
      actors: { readOnly: readOnly.actor },
      interactions: () => live.service.interactions(),
      root: () => root,
      directAnswer: (actor: Json, payload: Json) =>
        Effect.runPromise(
          interactionsAnswer(backend, actor as never, payload as never),
        ) as Promise<Json>,
      dispatch,
      receiptOf: (commandId: string) => dispatch.receipt(commandId),
      drainWorker: () => Effect.runPromise(worker.drain()),
      projectionMessages: () =>
        Effect.runPromise(
          orchestrator
            .getThreadProjection(ThreadId.make(THREAD))
            .pipe(Effect.map((p) => p.messages.map((m) => ({ id: String(m.id), text: m.text })))),
        ),
      oldCore: () => core,
      newCore: () => core,
      journal: (): Json[] =>
        NodeFS.existsSync(journalPath())
          ? NodeFS.readFileSync(journalPath(), "utf8")
              .trim()
              .split("\n")
              .flatMap((line) =>
                (JSON.parse(line).events as Json[]).map((e) => ({
                  type: e.type,
                  interactionId: e.interactionId,
                  cause: e.cause,
                  code: e.code,
                  commandId: e.commandId,
                })),
              )
          : [],
      routeDown: () => {
        routeUp = false;
        generation += 1;
      },
      restart: async (reason: string, options: { emptyRoot?: boolean } = {}) => {
        const report = await live.service.dispose(reason);
        if (options.emptyRoot === true) {
          // Seeded mutation: the new Backend has its identity but none of the durable interactions.
          root = NodeFS.mkdtempSync(NodePath.join(stateRootBase(), `m06-s08-${label}-empty-`));
          writeIdentity(root);
        }
        live.service = await startService(root);
        services.push(live.service);
        core = Xc6Route.productionBackend(live.service);
        routeUp = true;
        return report;
      },
      shutdown: async () => {
        const piExit = await pi.finish();
        const reports = [] as Json[];
        for (const service of services)
          reports.push((await service.dispose("end-of-case")) as unknown as Json);
        return { piExit, reports };
      },
    };
    return world;
  });

type World = Effect.Success<ReturnType<typeof makeWorld>>;

interface Notes {
  expected: Json;
  actual: Json;
  client: Json[];
  toolResults: Json[];
  limits: string[];
}
const runCase = (id: string, scenario: (world: World, notes: Notes) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const script = yield* scriptedProvider(`hc-${id}`);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const world = yield* makeWorld(id, script);
          const notes: Notes = {
            expected: {},
            actual: {},
            client: [],
            toolResults: [],
            limits: [
              "One process: the Backend, the XC-6 route (real bearer), the client RPC group (in-process, no WebSocket or device session) and T3's thread management share it; Pi is a child process.",
              "Pi loads a test-only extension registering the real ask_user_question tool over the real XC-6 client; the shipped scenario bundle and host adapter are not loaded, and the M03 identity record is written the way the host writes it.",
              "The model (Pi) and the T3 thread provider are scripted; the resumed thread is T3's thread bound to the asking session, not the Pi process.",
              "Synthetic data only; macOS only.",
            ],
          };
          yield* Effect.addFinalizer(() =>
            Effect.promise(() =>
              world.shutdown().then(
                () => undefined,
                () => undefined,
              ),
            ),
          );
          yield* Effect.promise(async () => {
            let failure: unknown;
            try {
              await scenario(world, notes);
            } catch (error) {
              failure = error;
              notes.actual.failure = String(error instanceof Error ? error.message : error).slice(
                0,
                600,
              );
            }
            const ended = await world.shutdown();
            notes.actual.piProcess = ended.piExit;
            notes.actual.backendDrain = ended.reports.map((r) => ({
              ok: r.ok,
              stillLive: r.stillLive,
            }));
            const run = await evidenceFor([world.bearer]);
            run.writeCase(id, {
              status: failure === undefined && ended.piExit.exited ? "pass" : "fail",
              boundary:
                "client RPC answer handler over the Backend's conditional write; installed Pi tool over the XC-6 route",
              expected: notes.expected,
              actual: notes.actual,
              journal: world.journal(),
              toolResults: notes.toolResults,
              client: notes.client,
              installed: {
                pi: "1.5.0",
                outerCommit: outerCommit(),
                forkCommit: forkCommit(),
                os: NodeOS.type(),
                node: process.version,
              },
              limits: notes.limits,
            });
            if (failure !== undefined) throw failure;
            expect(ended.piExit.exited, "the spawned Pi exits").toBe(true);
          });
        }),
      ).pipe(
        Effect.provide(Layer.mergeAll(layerRuntime(`hc-${id}`, script.adapter), layerRegistry)),
      );
    }),
  );

const waitPending = async (world: World, ms = 20_000): Promise<Json> => {
  const start = Date.now();
  for (;;) {
    const snap = await world.clients.reader.snapshot();
    const found = (snap.value?.interactions as Json[] | undefined)?.find(
      (i) => i.state === "pending",
    );
    if (found) return found;
    if (Date.now() - start > ms)
      throw new Error(`no pending question appeared: ${JSON.stringify(snap).slice(0, 300)}`);
    await sleep(50);
  }
};
const recordOf = async (world: World): Promise<Json> => {
  const snap = await world.clients.reader.snapshot();
  expect(snap.ok, JSON.stringify(snap)).toBe(true);
  return (snap.value.interactions as Json[])[0]!;
};
const toolEnd = async (world: World, ms = 60_000) => {
  await world.pi.until(
    (e) => e.type === "tool_execution_end" && e.toolName === "ask_user_question",
    "the tool result",
    ms,
  );
  return JSON.parse(textOf(world.pi.ends()[0]!)) as Json;
};

describe.skipIf(MISSING.length > 0)(
  "M06 first useful slice (installed Pi + real Backend + real client RPC)",
  () => {
    it.live(
      "NORMAL: pending question in the snapshot, the client answers, the exact answer reaches the tool once, the reopened store holds the origin",
      () =>
        runCase("normal", async (world, notes) => {
          world.pi.send("ask me");
          const start = await world.pi.until(
            (e) => e.type === "tool_execution_start" && e.toolName === "ask_user_question",
            "tool start",
          );
          const pending = await waitPending(world);
          expect(pending.askCallId, "created with Pi's actual tool call id").toBe(start.toolCallId);
          expect(pending.content.questions).toEqual(QUESTIONS);
          expect(pending.rootSessionId).toBe(SESSION);
          expect(world.pi.ends()).toHaveLength(0);
          notes.client.push({
            step: "snapshot",
            state: pending.state,
            interactionId: pending.interactionId,
            revision: pending.revision,
          });

          const answers = answerWith("B");
          const reply = await world.clients.operator.answer({
            interactionId: pending.interactionId,
            revision: pending.revision,
            answers,
          });
          notes.client.push({
            step: "answer",
            ok: reply.ok,
            state: reply.value?.state,
            code: reply.code,
          });
          expect(reply.ok, JSON.stringify(reply)).toBe(true);
          expect(reply.value.state).toBe("answered");
          const originId = reply.value.resolution.originId as string;

          const result = await toolEnd(world);
          notes.toolResults.push(result);
          expect(result).toEqual({
            status: "answered",
            interactionId: pending.interactionId,
            answers,
          });
          await world.pi.until((e) => e.type === "agent_end", "agent end");
          expect(world.pi.ends(), "the tool returned exactly once").toHaveLength(1);

          // An in-wait answer reaches the tool through its segment and is never also dispatched as a message.
          expect(await world.receiptOf(`aetheria-answer:${pending.interactionId}`)).toEqual({
            kind: "absent",
          });
          expect(world.script.started).toHaveLength(0);

          // A replay of the same answer settles nothing new and writes no second origin.
          const replay = await world.clients.operator.answer({
            interactionId: pending.interactionId,
            revision: pending.revision,
            answers,
          });
          expect(replay).toMatchObject({
            ok: false,
            code: "INTERACTION_ALREADY_SETTLED",
            record: { state: "answered", resolution: { originId } },
          });
          expect(
            NodeFS.readdirSync(NodePath.join(world.root(), "interactions", "origins")),
          ).toHaveLength(1);

          // The reopened store (a new Backend instance over the same root) holds the answer and its origin.
          await world.restart("reopen");
          const reopened = await recordOf(world);
          expect(reopened).toMatchObject({
            interactionId: pending.interactionId,
            state: "answered",
            resolution: { type: "answers", answers, originId },
          });
          const origin = JSON.parse(
            NodeFS.readFileSync(
              NodePath.join(world.root(), "interactions", "origins", `${originId}.json`),
              "utf8",
            ),
          ) as Json;
          expect(origin).toMatchObject({
            originId,
            interactionId: pending.interactionId,
            sessionId: SESSION,
            rootSessionId: SESSION,
          });
          expect(origin.subject).toMatchObject({
            id: pending.interactionId,
            revision: pending.revision,
          });
          expect(origin.actor.grantedScopes).toContain(AuthOrchestrationOperateScope);
          expect(world.journal().map((e) => e.type)).toEqual(["created", "answered"]);

          notes.expected = {
            toolResult: { status: "answered", answers },
            deliveredAsMessage: false,
            originsOnDisk: 1,
            reopenedState: "answered",
          };
          notes.actual = {
            ...notes.actual,
            toolResult: result,
            reopened: { state: reopened.state, originId },
            originSubject: origin.subject,
            toolEnds: 1,
            startedTurns: world.script.started.length,
          };
        }),
    );

    it.live(
      "CONSEQUENTIAL FAILURE: stale revision, unauthorized actions and an injected persistence failure cannot settle; a later valid retry still can",
      () =>
        runCase("consequential-failure", async (world, notes) => {
          world.pi.send("ask me");
          await world.pi.until(
            (e) => e.type === "tool_execution_start" && e.toolName === "ask_user_question",
            "tool start",
          );
          const pending = await waitPending(world);
          const base = {
            interactionId: pending.interactionId,
            revision: pending.revision,
            answers: answerWith("A"),
          };
          const recordFile = NodePath.join(
            world.root(),
            "interactions",
            "records",
            `${pending.interactionId}.json`,
          );
          const before = NodeFS.readFileSync(recordFile, "utf8");
          const stillOpen = async (what: string) => {
            const now = await recordOf(world);
            expect(now.state, `${what}: still pending`).toBe("pending");
            expect(now.revision, `${what}: unchanged revision`).toBe(pending.revision);
            expect(NodeFS.readFileSync(recordFile, "utf8"), `${what}: record bytes unchanged`).toBe(
              before,
            );
            expect(world.pi.ends(), `${what}: nothing reached the tool`).toHaveLength(0);
            expect(
              NodeFS.readdirSync(NodePath.join(world.root(), "interactions", "origins")),
              `${what}: no origin`,
            ).toHaveLength(0);
          };
          const refusals: Json[] = [];

          const stale = await world.clients.operator.answer({ ...base, revision: REVISION_FORGED });
          refusals.push({ attempt: "stale revision", code: stale.code });
          expect(stale).toMatchObject({ ok: false, code: "INTERACTION_STALE_REVISION" });
          await stillOpen("stale revision");

          const readOnlyReply = await world.clients.readOnly.answer(base);
          refusals.push({
            attempt: "read-only token over the RPC group",
            refused: readOnlyReply.rpcRefused,
            handlerReached: world.clients.readOnly.handled.includes("answer"),
          });
          expect(readOnlyReply.rpcRefused).toBe("EnvironmentAuthorizationError");
          expect(world.clients.readOnly.handled, "refused before the handler ran").not.toContain(
            "answer",
          );
          await stillOpen("read-only token");

          const withoutScope = await world.directAnswer(world.actors.readOnly, base);
          refusals.push({
            attempt: "actor without operate scope at the service",
            code: withoutScope.code,
          });
          expect(withoutScope).toMatchObject({ ok: false, code: "INTERACTION_ORIGIN_NOT_HUMAN" });
          await stillOpen("actor without operate scope");

          const invalid = await world.clients.operator.answer({
            ...base,
            answers: answerWith("NOT-AN-OPTION"),
          });
          refusals.push({ attempt: "label that is not an option", code: invalid.code });
          expect(invalid).toMatchObject({ ok: false, code: "INTERACTION_ANSWER_INVALID" });
          await stillOpen("invalid answer");

          // The injected persistence failure: the journal cannot be appended, so the write is refused before anything is committed.
          const journalFile = NodePath.join(
            world.root(),
            "interactions",
            "journal",
            `${SESSION}.jsonl`,
          );
          const canInject = NodeOS.userInfo().uid !== 0;
          if (MUTATE !== "failure" && canInject) NodeFS.chmodSync(journalFile, 0o400);
          let persistence: Json;
          try {
            persistence = await world.clients.operator.answer(base);
          } finally {
            NodeFS.chmodSync(journalFile, 0o600);
          }
          refusals.push({
            attempt: "journal append refused by the file system (EACCES)",
            code: persistence.code,
            detail: String(persistence.detail ?? "").slice(0, 120),
          });
          expect(canInject, "the persistence fault needs a non-root user").toBe(true);
          expect(persistence).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
          expect(String(persistence.detail)).toMatch(/nothing was written/);
          await stillOpen("injected persistence failure");
          notes.client.push(...refusals);

          // The valid retry still settles: two clients answer at once with different answers; exactly one wins, the other learns it is settled.
          const [a, b] = await Promise.all([
            world.clients.operator.answer({ ...base, answers: answerWith("A") }),
            world.clients.operator2.answer({ ...base, answers: answerWith("B") }),
          ]);
          const winners = [a, b].filter((r) => r.ok === true);
          const losers = [a, b].filter((r) => r.ok !== true);
          expect(winners, JSON.stringify([a, b])).toHaveLength(1);
          expect(losers[0]).toMatchObject({
            ok: false,
            code: "INTERACTION_ALREADY_SETTLED",
            record: { state: "answered" },
          });
          const won = winners[0]!.value.resolution.answers;
          notes.client.push({
            step: "simultaneous answers",
            winner: a.ok === true ? "A" : "B",
            loser: losers[0]!.code,
          });

          const result = await toolEnd(world);
          notes.toolResults.push(result);
          expect(result).toEqual({
            status: "answered",
            interactionId: pending.interactionId,
            answers: won,
          });
          await world.pi.until((e) => e.type === "agent_end", "agent end");
          expect(world.pi.ends(), "the tool returned once").toHaveLength(1);
          expect(
            NodeFS.readdirSync(NodePath.join(world.root(), "interactions", "origins")),
            "one origin",
          ).toHaveLength(1);
          expect(world.journal().map((e) => e.type)).toEqual(["created", "answered"]);

          notes.expected = {
            refused: [
              "INTERACTION_STALE_REVISION",
              "EnvironmentAuthorizationError",
              "INTERACTION_ORIGIN_NOT_HUMAN",
              "INTERACTION_ANSWER_INVALID",
              "INTERACTION_UNAVAILABLE",
            ],
            toolReachedBeforeValidRetry: false,
            validRetrySettlesOnce: true,
          };
          notes.actual = {
            ...notes.actual,
            refusals,
            simultaneous: { ok: winners.length, other: losers[0]!.code },
            toolResult: result,
          };
        }),
    );

    it.live(
      "RESTART: the Backend restarts mid-wait; the tool renews by the same interaction id; the question is continued; a late answer reaches the resumed thread once, and a lost reply does not repeat it",
      () =>
        runCase("restart", async (world, notes) => {
          world.pi.send("ask me");
          const start = await world.pi.until(
            (e) => e.type === "tool_execution_start" && e.toolName === "ask_user_question",
            "tool start",
          );
          const pending = await waitPending(world);
          const id = pending.interactionId as string;
          const commandId = `aetheria-answer:${id}`;
          await sleep(300); // an await segment is open at the old instance
          expect(world.seen.filter((s) => s.op === "interaction.create")).toHaveLength(1);
          const before = world.oldCore();

          // The restart: the route goes down (replies of the old instance never arrive), the old instance drains, a new one starts over the same root.
          world.routeDown();
          const drained = await world.restart("restart-mid-wait", {
            emptyRoot: MUTATE === "restart",
          });
          notes.client.push({
            step: "restart",
            drain: { released: drained.released, stillLive: drained.stillLive },
          });
          expect(drained.ok).toBe(true);
          // Old carrier state is unusable: the old core answers unavailable, and the new core knows no token minted before.
          const callerBody = { v: 1, op: "interaction.await", args: { interactionId: id } };
          const oldReply = await before.handle({
            caller: world.caller,
            claimedSessionId: SESSION,
            body: callerBody,
          });
          expect(oldReply.body).toMatchObject({ status: "unavailable" });
          const oldPoll = await world.newCore().handle({
            caller: world.caller,
            claimedSessionId: SESSION,
            body: { v: 1, poll: "token-from-the-old-instance" },
          });
          expect(oldPoll.body).toMatchObject({ status: "refused", code: "XC6_POLL_REFUSED" });

          // The durable question is continued, not lost and not asked again.
          const continued = await recordOf(world);
          expect(continued).toMatchObject({ interactionId: id, state: "continued" });
          notes.client.push({
            step: "snapshot after restart",
            state: continued.state,
            cause: continued.continuedCause,
          });

          // The tool renews by the same interaction id (after its 5 s pace) and its wait ends as timed_out with the late-message notice.
          const result = await toolEnd(world, 45_000);
          notes.toolResults.push(result);
          expect(result).toMatchObject({ status: "timed_out", interactionId: id });
          expect(String(result.notice)).toMatch(/late answer/i);
          await world.pi.until((e) => e.type === "agent_end", "agent end");
          const renewed = world.seen.filter((s) => s.servedBy === 1);
          expect(renewed.length, "the new instance served the renewal").toBeGreaterThan(0);
          expect(
            renewed.every((s) => s.op === "interaction.await" && s.interactionId === id),
            JSON.stringify(renewed),
          ).toBe(true);
          expect(
            world.seen.filter((s) => s.op === "interaction.create" && s.servedBy !== "down"),
            "no second ask",
          ).toHaveLength(1);
          expect(world.pi.starts().map((s) => s.toolCallId)).toEqual([start.toolCallId]);

          // The late answer: the reply is lost after the commit, yet the answer reaches the resumed thread exactly once.
          const answers = answerWith("B");
          const payload = { interactionId: id, revision: continued.revision, answers };
          world.clients.lossy.loseReply = true;
          const lost = await world.clients.lossy.answer(payload);
          expect(lost, "the client never saw the reply").toMatchObject({ noReply: true });
          await world.drainWorker();
          const settled = await recordOf(world);
          expect(settled).toMatchObject({
            state: "answered",
            resolution: { type: "answers", answers },
            delivery: { status: "delivered", commandId },
          });
          expect(await world.receiptOf(commandId)).toEqual({ kind: "accepted" });
          expect(world.script.started, "the resumed thread started once").toHaveLength(1);
          const messages = (await world.projectionMessages()).filter(
            (m) => m.id === `message:${commandId}`,
          );
          expect(messages).toHaveLength(1);
          expect(messages[0]!.text).toContain(`Answer to question ${id}:`);

          // The retry of the answer learns the settled record; neither it nor a redelivery sends a second message.
          const retry = await world.clients.operator.answer(payload);
          expect(retry).toMatchObject({
            ok: false,
            code: "INTERACTION_ALREADY_SETTLED",
            record: { state: "answered", delivery: { status: "delivered" } },
          });
          expect(await world.interactions()?.redeliver()).toMatchObject({
            ok: true,
            value: { delivered: [], failed: [], pending: [] },
          });
          await world.drainWorker();
          expect(world.script.started).toHaveLength(1);
          expect(
            (await world.projectionMessages()).filter((m) => m.id === `message:${commandId}`),
          ).toHaveLength(1);

          // Never a second decision for the tool: its single result is still the timed_out one and carries no answer.
          expect(world.pi.ends()).toHaveLength(1);
          expect(JSON.stringify(result)).not.toContain('"B"');
          expect(world.journal().map((e) => e.type)).toEqual([
            "created",
            "wait_lost",
            "answered",
            "delivered",
          ]);

          notes.expected = {
            stateAfterRestart: "continued",
            sameInteractionId: id,
            toolResult: "timed_out",
            lateAnswerDispatchedOnce: true,
            commandId,
            secondDecisionForTool: false,
          };
          notes.actual = {
            ...notes.actual,
            stateAfterRestart: continued.state,
            continuedCause: continued.continuedCause,
            toolResult: result,
            renewalOps: renewed.map((s) => s.op),
            receipt: "accepted",
            startedTurns: world.script.started.length,
            deliveredMessages: messages.length,
            retry: retry.code,
          };
          notes.limits.push(
            "The restart is a graceful dispose plus a new instance over the same root (cause host-stop); the abrupt-death cause backend-restart is covered by the interaction service suite only.",
          );
        }),
    );
  },
);
