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
import { makeThreadTurnDispatch } from "./humanControlDelivery.ts";
import { makeLaunchFacts } from "./launchFacts.ts";
import { makeLineageReader } from "./lineageReader.ts";
import { makeChildThreadPort } from "./threadPort.ts";

const STATE_ROOT_ENV = "AETHERIA_STATE_ROOT";
const PI_AGENT_DIR_ENV = "AETHERIA_PI_AGENT_DIR";
/** The Aetheria checkout, the launch input the Pi child also receives: the source of the current role catalog the audit evidence check reads (M06 step 23). */
const CHECKOUT_ENV = "AETHERIA_CHECKOUT";

export class AetheriaBackend extends Context.Service<AetheriaBackend, AetheriaBackendService>()(
  "t3/aetheria/aetheriaBackend",
) {}

/**
 * The running service for a given state root. Requires the event sink and the MCP credential store. `attachmentsDir` is T3's attachments directory,
 * handed over explicitly by the server graph (M09 step 21); without it the snapshot operations stay registered and fail closed.
 */
export const makeLayer = (
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
      // M05 step 6 (C10): T3 as the children service sees it. A graph without these services leaves the module registered but unavailable (logged), because
      // managed work is not part of late-answer delivery and must not stop the Backend; nothing is stubbed.
      const orchestrator = yield* Effect.serviceOption(Orchestrator.OrchestratorV2);
      const providerSessions = yield* Effect.serviceOption(
        ProviderSessionManager.ProviderSessionManagerV2,
      );
      const ids = yield* Effect.serviceOption(IdAllocator.IdAllocatorV2);
      let indexOf: (() => AetheriaBackendService["index"] | undefined) | undefined;
      const sessionIndex = () => indexOf?.();
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
              childLineage: yield* makeLineageReader(threads.value, (threadId) => {
                const found = sessionIndex()?.lookup(threadId);
                return found === undefined
                  ? "unknown"
                  : found.status === "ok"
                    ? found.binding.sessionId
                    : found.status === "absent"
                      ? null
                      : "unknown";
              }),
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
      // M09 step 11 (IP-17): T3's Pi adapter reads the route policy from a process slot. Filled once the Backend runs, emptied before it drains.
      yield* Effect.acquireRelease(
        Effect.sync(() => installPiSelectionSeam(service.piSelectionSeam)),
        (release) => Effect.sync(release),
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
          Effect.promise(() => service.ingest(storedEvent as unknown as StoredEventLike)),
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
    }),
  ).pipe(
    // The runtime's id allocator is stateless (`Layer.succeed`) and `RuntimeLayer.layerProduction` provides it only to the layers inside it, so it is NOT in this
    // layer's context in the server graph; the Orchestrator, the provider session manager and ThreadManagementService are. Supplying it here makes the instance
    // irrelevant: any allocator derives the same ids.
    Layer.provide(IdAllocator.layer),
  );

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
      // M06 steps 6 and 13: T3's thread dispatch comes from the runtime services and the command receipt store from server.ts (IP-23); makeLayer
      // requires both and fails the Backend start without them.
      return makeLayer(stateRoot, {
        ...(Option.isSome(config) ? { attachmentsDir: config.value.attachmentsDir } : {}),
        ...(Option.isSome(piAgentDir) ? { piAgentDir: piAgentDir.value } : {}),
        ...(Option.isSome(checkout) ? { checkout: checkout.value } : {}),
      });
    }),
  ),
);

/** Provided at the bottom of the graph: the digest, only when AETHERIA_STATE_ROOT is set, so both are present or both absent. */
export const compositionLayer = whenStateRoot(() => compositionLayerFor);
