// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M04 Plan step 16 (IP-1) — the Aetheria Backend as one Effect layer at the server layer graph.
//
// Owners. `@t3tools/aetheria-server` owns the Backend (composition, lifecycle, identity, liveness); this file owns only the Effect wiring: it
// reads `AETHERIA_STATE_ROOT`, supplies T3's current MCP credential id, starts the service at layer build, feeds it from the UNFILTERED
// `EventSinkV2.stream` (a sequence gap must be visible to liveness), and drains it when the layer's scope closes.
//
// Two layers, because two consumers sit at different depths of the graph. `compositionLayer` has no dependencies and provides only the
// validated digest, so every `ServerEnvironment` instance and the /ws upgrade gate can read it (IP-8, IP-9). `layer` needs the event sink and
// the MCP credential store and provides the running service to the XC-6 route and the status RPC. Both are absent unless the state root is
// set, so a T3 without Aetheria is unchanged; a state root that is set but invalid fails the layer, so the server never starts with a
// half Backend. A start that does not report `started` fails the layer the same way.
import {
  createAetheriaBackendService,
  prepareAetheriaBackend,
  type AetheriaBackendService,
  type StoredEventLike,
} from "@t3tools/aetheria-server";
import { ThreadId } from "@t3tools/contracts";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import { layerFromBackend } from "./backendComposition.ts";

const STATE_ROOT_ENV = "AETHERIA_STATE_ROOT";

export class AetheriaBackend extends Context.Service<AetheriaBackend, AetheriaBackendService>()(
  "t3/aetheria/aetheriaBackend",
) {}

/** The running service for a given state root. Requires the event sink and the MCP credential store. */
export const makeLayer = (stateRoot: string) =>
  Layer.effect(
    AetheriaBackend,
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const mcpSessions = yield* McpProviderSessions;
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      const made = createAetheriaBackendService({
        stateRoot,
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
      return service;
    }),
  );

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

/** Registered at the server graph (IP-1): the service, only when AETHERIA_STATE_ROOT is set. */
export const layer = whenStateRoot(makeLayer);

/** Provided at the bottom of the graph: the digest, only when AETHERIA_STATE_ROOT is set, so both are present or both absent. */
export const compositionLayer = whenStateRoot(() => compositionLayerFor);
