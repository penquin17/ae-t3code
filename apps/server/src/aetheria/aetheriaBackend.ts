// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M04 Plan step 16 (IP-1) — the Aetheria Backend as one Effect layer at the server layer graph.
//
// Owners. `@t3tools/aetheria-server` owns the Backend (composition, lifecycle, identity, liveness); this file owns only the Effect wiring: it
// reads `AETHERIA_STATE_ROOT` and `AETHERIA_PI_AGENT_DIR` (the explicit Pi sign-in directory), supplies T3's current MCP credential id, starts the service at layer build, feeds it from the UNFILTERED
// `EventSinkV2.stream` (a sequence gap must be visible to liveness), and drains it when the layer's scope closes.
//
// Two layers, because two consumers sit at different depths of the graph. `compositionLayer` has no dependencies and provides only the
// validated digest, so every `ServerEnvironment` instance and the /ws upgrade gate can read it (IP-8, IP-9). `layer` needs the event sink and
// the MCP credential store and provides the running service to the XC-6 route and the status RPC. Both are absent unless the state root is
// set, so a T3 without Aetheria is unchanged; a state root that is set but invalid fails the layer, so the server never starts with a
// half Backend. A start that does not report `started` fails the layer the same way.
import {
  createAetheriaBackendService,
  createOrchestrationFactory,
  installPiSelectionSeam,
  prepareAetheriaBackend,
  runGoalCommand,
  type AetheriaBackendService,
  type HumanControlServiceFactory,
  type OrchestrationServiceFactory,
  type StoredEventLike,
} from "@t3tools/aetheria-server";
import { ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import { layerFromBackend } from "./backendComposition.ts";
import { makeCallerContext } from "./callerContext.ts";
import { describeGoalOutcome, makeGoalCommandRoute } from "./goalCommand.ts";
import * as GoalCommandHookSlot from "./goalCommandHook.ts";
import {
  GoalCommandHook,
  GoalCommandSlot,
  type GoalCommandHookResult,
  type GoalCommandRoute,
} from "./goalCommandHook.ts";
import { makeGoalForkObserver, type GoalForkObserver } from "./goalForkObserver.ts";
import * as GoalRoundGuard from "./goalRoundGuard.ts";
import { getSharedInspectClients } from "./inspectClients.ts";
import { createBackendServicesMetadata } from "./inspectMetadata.ts";
import { makeThreadTurnDispatch } from "./humanControlDelivery.ts";
import { makeLaunchFacts } from "./launchFacts.ts";
import { makeLineageReader } from "./lineageReader.ts";
import { drainSharedRegionRegistry } from "./regionsState.ts";
import { makeChildThreadPort } from "./threadPort.ts";

const STATE_ROOT_ENV = "AETHERIA_STATE_ROOT";
const PI_AGENT_DIR_ENV = "AETHERIA_PI_AGENT_DIR";
/** The Aetheria checkout, the launch input the Pi child also receives: the source of the current role catalog the audit evidence check reads (M06 step 23). */
const CHECKOUT_ENV = "AETHERIA_CHECKOUT";
/** The operator's marking of this deployment (M11 U1/D7): `local` turns read-only inspection on; unset or anything else leaves it off. */
const DEPLOYMENT_ENV = "AETHERIA_DEPLOYMENT";

export class AetheriaBackend extends Context.Service<AetheriaBackend, AetheriaBackendService>()(
  "t3/aetheria/aetheriaBackend",
) {}

/** What happens on these stored events is one more look at T3's thread listing for a new fork (M07 step 19, D10): a thread appears, or a provider session is attached to it so M04's index can name its Pi session. */
const FORK_OBSERVATION_EVENTS: ReadonlySet<string> = new Set([
  "thread.created",
  "provider-session.attached",
]);

/**
 * The running service for a given state root, alone. `makeLayer` below is the one the graph uses: it adds the typed-`/goal` hook that depends on this service.
 */
const makeBackendLayer = (
  stateRoot: string,
  options: {
    readonly attachmentsDir?: string;
    readonly piAgentDir?: string;
    /** The Aetheria checkout for the audit evidence's role check. Absent or relative: `audit.history` refuses with AUTH_IDENTITY_UNAVAILABLE. */
    readonly checkout?: string;
    /** Builds the interaction service (M06). Absent: the module answers unavailable. */
    readonly interactionFactory?: HumanControlServiceFactory;
    /**
     * Builds the children service (M05). Absent: the production join `createOrchestrationFactory` over the orchestration archive is used when T3's managed-work
     * services exist (a test seam otherwise); without them the orchestration module answers unavailable.
     */
    readonly orchestrationFactory?: OrchestrationServiceFactory;
    /**
     * The operator's marking of this deployment (M11 U1/D7), from `AETHERIA_DEPLOYMENT`. Only `local` turns read-only inspection on; absent, `remote` or any other value leaves it off.
     * Passed to the Backend as trusted construction config; nothing a model or a browser sends can set it.
     */
    readonly deployment?: string;
  } = {},
) =>
  Layer.effect(
    AetheriaBackend,
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const mcpSessions = yield* McpProviderSessions;
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      // M06 steps 6 and 13: T3's own message dispatch and receipt store, adapted with the captured runtime like `credentialOf`. This layer exists only
      // when AETHERIA_STATE_ROOT is set, and then late-answer delivery is part of the Backend: a graph that lacks either service (server.ts IP-23
      // dropped or merged away) fails here, at start, instead of silently leaving answered questions undelivered. Bare T3 never builds this layer.
      const threads = yield* Effect.serviceOption(ThreadManagementService.ThreadManagementService);
      const receipts = yield* Effect.serviceOption(CommandReceiptStore.CommandReceiptStoreV2);
      if (Option.isNone(threads) || Option.isNone(receipts))
        return yield* Effect.die(
          new Error(
            `The Aetheria Backend needs T3's ${[
              Option.isNone(threads) ? "ThreadManagementService" : undefined,
              Option.isNone(receipts) ? "CommandReceiptStoreV2" : undefined,
            ]
              .filter((name) => name !== undefined)
              .join(
                " and ",
              )} to deliver late answers (server.ts, integration point IP-23); this server graph does not provide it`,
          ),
        );
      const turnDispatch = yield* makeThreadTurnDispatch(threads.value, receipts.value);
      const startup = yield* Effect.serviceOption(ServerRuntimeStartup.ServerRuntimeStartup);
      // M07 DV2 (IP-24): T3's recovery pass consults this guard per thread and waits for it before it decides. Present only when the layer is built from `layer` below (state root set); a
      // bare `makeLayer` has none and installs nothing.
      const goalGuard = yield* Effect.serviceOption(GoalRoundGuard.GoalRoundGuard);
      // DV8: the waiting recovery pass is released on EVERY ending of this layer — installed below on success, settled here on a failed start or a teardown that came first (no-op once installed).
      if (Option.isSome(goalGuard))
        yield* Effect.addFinalizer(() => Effect.sync(() => goalGuard.value.settle()));
      // M05 step 6 (C10): T3 as the children service sees it. A graph without these services leaves the module registered but unavailable (logged), because
      // managed work is not part of late-answer delivery and must not stop the Backend; nothing is stubbed.
      const orchestrator = yield* Effect.serviceOption(Orchestrator.OrchestratorV2);
      const providerSessions = yield* Effect.serviceOption(
        ProviderSessionManager.ProviderSessionManagerV2,
      );
      const ids = yield* Effect.serviceOption(IdAllocator.IdAllocatorV2);
      let indexOf: (() => AetheriaBackendService["index"] | undefined) | undefined;
      const sessionIndex = () => indexOf?.();
      /** The Pi session M04's index bound to a thread: null when none, "unknown" when the index cannot be read (the children service and the goal fork observer ask the same question). */
      const sessionOfThread = (threadId: string): string | null | "unknown" => {
        const found = sessionIndex()?.lookup(threadId);
        return found === undefined
          ? "unknown"
          : found.status === "ok"
            ? found.binding.sessionId
            : found.status === "absent"
              ? null
              : "unknown";
      };
      const managedWork =
        Option.isSome(orchestrator) && Option.isSome(providerSessions) && Option.isSome(ids)
          ? {
              childThreads: yield* makeChildThreadPort({
                threads: threads.value,
                orchestrator: orchestrator.value,
                sessions: providerSessions.value,
                sink,
                ids: ids.value,
              }),
              childLineage: yield* makeLineageReader(threads.value, sessionOfThread),
              launchFacts: yield* makeLaunchFacts(
                orchestrator.value,
                (sessionId) => sessionIndex()?.bindingOfSession(sessionId)?.threadId,
              ),
            }
          : undefined;
      if (managedWork === undefined)
        yield* Effect.logWarning(
          `Aetheria managed work is unavailable: the server graph lacks ${managedWorkMissing({
            orchestrator: Option.isSome(orchestrator),
            sessions: Option.isSome(providerSessions),
            ids: Option.isSome(ids),
          }).join(", ")}`,
        );
      // M05 step 9 (C10): the join to the archive's children service. The caller is the carrier's session; its thread and working folder come from M04's index and
      // its active run and node from T3's projection, never from an argument. Built only when T3's services exist, or the module stays unavailable.
      // One caller-context port, shared by managed work and the deliverables module (M10 step 13: its turn is the caller's single active run).
      const callerContext = Option.isSome(orchestrator)
        ? yield* makeCallerContext(orchestrator.value, (sessionId) => {
            const binding = sessionIndex()?.bindingOfSession(sessionId);
            return binding === undefined
              ? undefined
              : { threadId: binding.threadId, workingFolder: binding.workingFolder };
          })
        : undefined;
      const orchestrationFactory =
        options.orchestrationFactory ??
        (callerContext !== undefined && managedWork !== undefined
          ? createOrchestrationFactory({
              callerContext,
              onBoot: (report) => {
                void runPromise(
                  (report.lineage === "unavailable" ? Effect.logWarning : Effect.logInfo)(
                    "Aetheria managed work boot reconciliation",
                    {
                      lineage: report.lineage,
                      closed: report.closed.length,
                      retired: report.retired.length,
                      unconfirmed: report.unconfirmed.length,
                      unknown: report.unknown.length,
                      leftover: report.leftover.length,
                      orphanRecords: report.orphanRecords.length,
                      problems: report.problems.length,
                    },
                  ),
                ).catch(() => undefined);
              },
            })
          : undefined);
      const made = createAetheriaBackendService({
        stateRoot,
        turnDispatch,
        ...managedWork,
        ...(orchestrationFactory === undefined ? {} : { orchestrationFactory }),
        ...(callerContext === undefined ? {} : { callerContext }),
        // M11: the read-only driver and RPC metadata for the inspection module, and its enablement from the operator's own marking of this deployment (U1/D7): only `local` turns inspection on, and an
        // absent marking leaves it off. The value is the operator's environment, never a model, browser or hostname input; the Backend itself decides what the marking means.
        inspect: {
          metadata: createBackendServicesMetadata(),
          // The one live-client wiring ws.ts's handlers also hold: the same registry, so a query reaches the page the Backend's client-regions provider listed.
          clients: getSharedInspectClients().queries,
          ...(options.deployment === undefined
            ? {}
            : { enablement: { deployment: options.deployment } }),
        },
        ...(options.checkout === undefined ? {} : { checkout: options.checkout }),
        ...(options.interactionFactory === undefined
          ? {}
          : { interactionFactory: options.interactionFactory }),
        ...(options.attachmentsDir === undefined ? {} : { attachmentsDir: options.attachmentsDir }),
        ...(options.piAgentDir === undefined
          ? {}
          : {
              providers: {
                mode: "production" as const,
                agentDir: options.piAgentDir,
                warn: (line: string) => {
                  void runPromise(Effect.logWarning(line)).catch(() => undefined);
                },
              },
            }),
        credentialOf: (threadId) =>
          runPromise(
            mcpSessions
              .read(ThreadId.make(threadId))
              .pipe(Effect.map((config) => config?.providerSessionId)),
          ),
      });
      if (made.outcome === "refused") {
        return yield* Effect.die(
          new Error(
            `The Aetheria Backend composition was refused: ${made.faults.map((fault) => fault.code).join(", ")}`,
          ),
        );
      }
      const { service } = made;
      indexOf = () => service.index;
      yield* Effect.acquireRelease(
        Effect.promise(() => service.start()).pipe(
          Effect.flatMap((result) =>
            result.outcome === "started"
              ? Effect.logInfo("Aetheria Backend started", {
                  digest: service.digest().value,
                  order: result.activationOrder,
                })
              : Effect.die(
                  new Error(
                    `The Aetheria Backend did not start: ${result.outcome}${
                      result.outcome === "refused"
                        ? ` (${result.faults.map((fault) => fault.code).join(", ")})`
                        : ""
                    }`,
                  ),
                ),
          ),
        ),
        () =>
          Effect.promise(() => service.dispose("server-teardown")).pipe(
            Effect.flatMap((report) =>
              report.ok
                ? Effect.logInfo("Aetheria Backend drained", { order: report.order })
                : Effect.logError("Aetheria Backend drain was not clean", {
                    order: report.order,
                    failed: report.failed.length,
                    stillLive: report.stillLive.length,
                  }),
            ),
            Effect.ignoreCause,
          ),
      );
      // M07 step 19 (D10, B6): once the goal service runs, the fork observer takes its replay fence from ONE pull of T3's thread listing — every fork listed now is history and is never copied — and then
      // looks again on each thread creation and each provider-session attachment (below, after the identity feed has applied the event). It never throws: an unreadable listing or a service that is
      // not ready leaves the thread waiting for the next look.
      let forkObserver: GoalForkObserver | undefined;
      const goals = service.goals();
      if (goals !== undefined && managedWork !== undefined) {
        forkObserver = makeGoalForkObserver({
          reader: managedWork.childLineage,
          sessionOf: sessionOfThread,
          goals,
        });
        yield* Effect.promise(() => forkObserver!.observe()).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Aetheria goal fork observer could not take its fence", {
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
      // M07 DV2: the Backend has started and has reconciled every goal journal, so the guard can answer from them, and the waiting recovery pass is released. The slot is NOT emptied at scope close:
      // T3's shutdown preparation runs after this layer has drained, and the answer is read from the journal, which a drained service leaves intact; an emptied slot would read `unknown` for every
      // main thread and stop ordinary threads from continuing after a restart.
      if (Option.isSome(goalGuard))
        yield* Effect.sync(() =>
          goalGuard.value.install((threadId) => service.goalRoundOfThread(threadId)),
        );
      // M09 step 11 (IP-17): T3's Pi adapter reads the route policy from a process slot. Filled once the Backend runs, emptied before it drains.
      yield* Effect.acquireRelease(
        Effect.sync(() => installPiSelectionSeam(service.piSelectionSeam)),
        (release) => Effect.sync(release),
      );
      // M10 step 23 (XC-7): the region registry drains with the Backend.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() =>
          Effect.logInfo("Aetheria region registry drained", drainSharedRegionRegistry()),
        ),
      );
      // Events up to the log's head now are history to this Backend: the board treats liveness from them as unknown. If the head cannot be
      // read the horizon stays unset and every holder is unknown (open and visible, never a stale "active" or "free").
      yield* sink.latestSequence().pipe(
        Effect.tap((sequence) => Effect.sync(() => service.setReplayHorizon(sequence))),
        Effect.ignore,
      );
      // One unfiltered subscription from the start of the event log: replay, then live. Its end or failure is a missed observation.
      yield* sink.stream().pipe(
        Stream.runForEach((storedEvent) =>
          Effect.promise(() => service.ingest(storedEvent as unknown as StoredEventLike)).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (
                  forkObserver !== undefined &&
                  FORK_OBSERVATION_EVENTS.has(
                    (storedEvent as unknown as StoredEventLike).event.type,
                  )
                )
                  void forkObserver.observe().catch(() => undefined);
              }),
            ),
          ),
        ),
        Effect.matchCause({
          onSuccess: () => service.noteFeed("feed-ended"),
          onFailure: () => service.noteFeed("feed-failed"),
        }),
        Effect.forkScoped,
      );
      // M06: answers that were recorded but not yet delivered are retried once T3's runtime accepts commands (the core's `start` never dispatches).
      // The core reads T3's receipt first, so an answer that already landed is only journalled as delivered, never sent twice. A runtime that never
      // becomes ready skips this retry (logged); the next session resume retries (the feed's resume signal, in the Backend service). Without the
      // startup service (a bare layer) there is nothing to wait for.
      yield* (Option.isSome(startup) ? startup.value.awaitCommandReady : Effect.void).pipe(
        Effect.flatMap(() =>
          Effect.promise(async () => {
            await service.interactions()?.redeliver();
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Aetheria skipped the startup retry of undelivered answers", {
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.forkScoped,
      );
      return service;
    }).pipe(
      // DV8: any failure of this layer (a graph without T3's services, a refused composition, a Backend that did not start) releases the waiting recovery pass with an EMPTY slot, which answers
      // `unknown`: nothing is continued in that startup, and it never waits forever. Logged once here; a slot already filled is untouched.
      Effect.tapCause(() =>
        Effect.serviceOption(GoalRoundGuard.GoalRoundGuard).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (guard) =>
                Effect.logWarning(
                  "The Aetheria Backend layer failed: T3's recovery pass will not continue any main thread in this startup (goal-round guard unknown)",
                ).pipe(Effect.andThen(Effect.sync(() => guard.settle()))),
            }),
          ),
        ),
      ),
    ),
  ).pipe(
    // The runtime's id allocator is stateless (`Layer.succeed`) and `RuntimeLayer.layerProduction` provides it only to the layers inside it, so it is NOT in this
    // layer's context in the server graph; the Orchestrator, the provider session manager and ThreadManagementService are. Supplying it here makes the instance
    // irrelevant: any allocator derives the same ids.
    Layer.provide(IdAllocator.layer),
  );

/**
 * M07 step 19 (DV11; IP-67): the typed-`/goal` hook the Orchestrator reads, built over the running Backend. A message on a Pi thread becomes one goal operation for that thread's Pi session (M04's index),
 * through `runGoalCommand` bound to the ONE goal service; any other driver, an unbound thread, a Backend without the goal service and any failure answer `handled: false`, so T3 handles the message as before.
 */
const goalCommandHookLayer = Layer.effect(
  GoalCommandHook,
  Effect.gen(function* () {
    const backend = yield* AetheriaBackend;
    const commands = makeGoalCommandRoute({
      run: async (command, sessionId) => {
        const goals = backend.goals();
        if (goals === undefined) return { handled: false, reason: "goal-service-unavailable" };
        return runGoalCommand(command, sessionId, goals);
      },
    });
    const route: GoalCommandRoute = Effect.fn("GoalCommandHook.route")(function* ({
      threadId,
      driver,
      message,
    }) {
      return yield* Effect.promise(async (): Promise<GoalCommandHookResult> => {
        const found = backend.index.lookup(threadId);
        if (found.status !== "ok") return { handled: false };
        const outcome = await commands.route({
          driver,
          sessionId: found.binding.sessionId,
          message,
        });
        if (!outcome.handled) return { handled: false };
        const notice = describeGoalOutcome(outcome);
        return notice === null ? { handled: true } : { handled: true, notice };
      }).pipe(Effect.catchCause(() => Effect.succeed<GoalCommandHookResult>({ handled: false })));
    });
    // The Orchestrator holds the slot's hook from its own build (IP-67); fill the slot now that the Backend runs, and empty it when this layer ends.
    const slot = yield* Effect.serviceOption(GoalCommandSlot);
    if (Option.isSome(slot)) {
      const uninstall = slot.value.install(route);
      yield* Effect.addFinalizer(() => Effect.sync(uninstall));
    }
    return GoalCommandHook.of({ route });
  }),
).pipe(
  // The same constant the Orchestrator layer provides: one slot instance by memoization (present only when AETHERIA_STATE_ROOT is set).
  Layer.provide(GoalCommandHookSlot.layerWhenAetheria),
);

/**
 * The running service for a given state root, with the typed-`/goal` hook over it. Requires the event sink and the MCP credential store. `attachmentsDir` is T3's attachments directory,
 * handed over explicitly by the server graph (M09 step 21); without it the snapshot operations stay registered and fail closed.
 */
export const makeLayer = (
  stateRoot: string,
  options: Parameters<typeof makeBackendLayer>[1] = {},
) => goalCommandHookLayer.pipe(Layer.provideMerge(makeBackendLayer(stateRoot, options)));

/** The services managed work needs from T3's runtime and which of them the graph does not give, by name (the warning must say, or a missing service hides). */
export const managedWorkMissing = (have: {
  readonly orchestrator: boolean;
  readonly sessions: boolean;
  readonly ids: boolean;
}): string[] => [
  ...(have.orchestrator ? [] : ["OrchestratorV2"]),
  ...(have.sessions ? [] : ["ProviderSessionManagerV2"]),
  ...(have.ids ? [] : ["IdAllocatorV2"]),
];

/** The digest of the composition the Backend validates, with no dependency, for the descriptor and the connection gates. */
const compositionLayerFor = Layer.unwrap(
  Effect.sync(() => {
    const prepared = prepareAetheriaBackend();
    if (prepared.outcome === "refused")
      throw new Error(
        `The Aetheria Backend composition was refused: ${prepared.faults.map((fault) => fault.code).join(", ")}`,
      );
    return layerFromBackend(prepared.backend);
  }),
);

const whenStateRoot = <A, E, R>(
  build: (stateRoot: string) => Layer.Layer<A, E, R>,
): Layer.Layer<A, never, R> =>
  Layer.unwrap(
    Config.String(STATE_ROOT_ENV).pipe(
      Config.option,
      Effect.map(
        Option.match({
          onNone: () => Layer.empty as unknown as Layer.Layer<A, E, R>,
          onSome: build,
        }),
      ),
    ),
  ).pipe(Layer.orDie);

/**
 * Registered at the server graph (IP-1): the service, only when AETHERIA_STATE_ROOT is set, over T3's own attachments directory.
 * The Pi agent directory comes only from AETHERIA_PI_AGENT_DIR; with it unset the providers module answers unknown.
 */
export const layer = whenStateRoot((stateRoot) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
      if (Option.isNone(config))
        yield* Effect.logWarning("Aetheria snapshots are off: the server config is not available");
      const piAgentDir = yield* Config.String(PI_AGENT_DIR_ENV).pipe(Config.option);
      const checkout = yield* Config.String(CHECKOUT_ENV).pipe(Config.option);
      const deployment = yield* Config.String(DEPLOYMENT_ENV).pipe(Config.option);
      // M06 steps 6 and 13: T3's thread dispatch comes from the runtime services and the command receipt store from server.ts (IP-23); makeLayer
      // requires both and fails the Backend start without them.
      // M07 DV2 (IP-24): the same guard constant ProviderRuntimeRecoveryService provides, so recovery and this layer share one instance.
      return makeLayer(stateRoot, {
        ...(Option.isSome(config) ? { attachmentsDir: config.value.attachmentsDir } : {}),
        ...(Option.isSome(piAgentDir) ? { piAgentDir: piAgentDir.value } : {}),
        ...(Option.isSome(checkout) ? { checkout: checkout.value } : {}),
        ...(Option.isSome(deployment) ? { deployment: deployment.value } : {}),
      }).pipe(Layer.provide(GoalRoundGuard.layerWhenAetheria));
    }),
  ),
);

/** Provided at the bottom of the graph: the digest, only when AETHERIA_STATE_ROOT is set, so both are present or both absent. */
export const compositionLayer = whenStateRoot(() => compositionLayerFor);
