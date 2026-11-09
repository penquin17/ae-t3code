// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M04 Plan step 16 (IP-1) — the Backend registered at the server layer graph: one Effect layer that starts the Backend, feeds it
// from the unfiltered stored-event stream, publishes its digest, and drains it at scope close.
//
// Boundary: the real layer over the real service (thread index, pinned-artifact reader, identity records on disk), with `EventSinkV2.stream`
// and `McpProviderSessions.read` replaced by in-memory doubles. It shows: the layer starts the Backend and fails closed when it cannot;
// the stream binds the index from `provider-thread.updated` with the CREDENTIAL id (not T3's runtime provider-session id); the composition
// service carries the same digest the Backend validated; scope close drains once with a clean XC-7 report; with no `AETHERIA_STATE_ROOT`
// nothing is registered (bare T3 unchanged). It does not show T3's real event emission or the full server graph; the native run does.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { AetheriaBackendService } from "@t3tools/aetheria-server";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import { AetheriaBackendComposition } from "./backendComposition.ts";
import * as Live from "./aetheriaBackend.ts";

const THREAD = "mcp:6f1c2d3e-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const SESSION = "0197d3c0-1111-7000-8000-000000000001";
const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";
const FOLDER = "/work/project";

const makeRoot = (withRecord = true) => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, "m04-s16-layer-"));
  if (withRecord) {
    NodeFS.mkdirSync(NodePath.join(root, "identity"), { mode: 0o700 });
    NodeFS.writeFileSync(
      NodePath.join(root, "identity", `${SESSION}.json`),
      JSON.stringify({
        formatVersion: 1,
        state: "active",
        attemptId: "attempt-1",
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
  }
  return root;
};

const stored = (sequence: number, type: string, payload: unknown) =>
  ({ sequence, commandId: null, event: { type, threadId: THREAD, payload } }) as never;
const events = [
  stored(1, "provider-session.updated", {
    id: RUNTIME,
    providerInstanceId: "pi",
    status: "ready",
    cwd: FOLDER,
  }),
  stored(2, "provider-thread.updated", {
    driver: "pi",
    providerInstanceId: "pi",
    providerSessionId: RUNTIME,
    appThreadId: THREAD,
    nativeThreadRef: { nativeId: `/sessions/2026-11-08T08-00-00-000Z_${SESSION}.jsonl` },
  }),
];

const layerSink = (list: ReadonlyArray<unknown>) =>
  Layer.mock(EventSink.EventSinkV2)({
    latestSequence: () => Effect.succeed(0),
    stream: () => Stream.fromIterable(list as never[]).pipe(Stream.concat(Stream.never)),
  });
const layerCredentials = (credential: string | undefined) =>
  Layer.mock(McpProviderSessions)({
    read: (threadId: string) =>
      Effect.succeed(
        threadId === THREAD && credential !== undefined
          ? ({ providerSessionId: credential } as never)
          : undefined,
      ),
  });

const makeAgentDir = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m09-s24-agent-"));
  NodeFS.chmodSync(dir, 0o700);
  return NodeFS.realpathSync(dir);
};
const capabilitiesOf = (service: AetheriaBackendService) =>
  Effect.promise(async () => {
    const answer = await service.operations()["providers.route-states"]!({
      caller: { threadId: THREAD, providerSessionId: "p", providerInstanceId: "i" },
      sessionId: SESSION,
      kind: "main",
      rootSessionId: SESSION,
      args: {
        routes: [{ provider: "anthropic", model: "claude-sonnet-5" }],
        purpose: "launch",
      },
    } as never);
    const { result } = answer as unknown as { result: { states: Array<Record<string, unknown>> } };
    return result.states[0]!;
  });

const waitFor = (check: () => boolean) =>
  Effect.promise(() => expect.poll(check, { interval: 20, timeout: 2000 }).toBe(true));

describe("the Backend layer", () => {
  it.live(
    "starts the Backend, binds the index from the stream with the credential id, and drains clean at scope close",
    () =>
      Effect.gen(function* () {
        const root = makeRoot();
        const service = yield* Effect.scoped(
          Layer.build(
            Live.makeLayer(root).pipe(
              Layer.provide(Layer.mergeAll(layerSink(events), layerCredentials("cred-1"))),
            ),
          ).pipe(
            Effect.flatMap((context) => {
              const service = Context.get(context, Live.AetheriaBackend);
              expect(service.status().phase).toBe("running");
              return waitFor(() => service.index.lookup(THREAD).status === "ok").pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    const found = service.index.lookup(THREAD);
                    expect(found.status === "ok" && found.binding.providerSessionId).toBe("cred-1");
                    expect(found.status === "ok" && found.binding.providerSessionId).not.toBe(
                      RUNTIME,
                    );
                    expect(
                      service.identity(
                        { threadId: THREAD, providerSessionId: "cred-1", providerInstanceId: "pi" },
                        SESSION,
                      ),
                    ).toMatchObject({ ok: true, sessionId: SESSION });
                    expect(
                      service.identity(
                        { threadId: THREAD, providerSessionId: RUNTIME, providerInstanceId: "pi" },
                        SESSION,
                      ),
                    ).toMatchObject({ ok: false });
                  }),
                ),
                Effect.as(service),
              );
            }),
          ),
        );
        // the scope is closed: the Backend drained once, cleanly (XC-7), and now answers unavailable
        expect(service.status().phase).toBe("disposed");
        expect(service.status().disposal).toMatchObject({ ok: true, stillLive: 0 });
        expect(
          service.identity(
            { threadId: THREAD, providerSessionId: "cred-1", providerInstanceId: "pi" },
            SESSION,
          ),
        ).toMatchObject({ ok: false, outcome: "unavailable" });
      }),
  );

  it.live("gives the Backend T3's attachments directory only when the host supplies one", () =>
    Effect.gen(function* () {
      const ask = (options?: { readonly attachmentsDir: string }) =>
        Effect.scoped(
          Layer.build(
            Live.makeLayer(makeRoot(false), options).pipe(
              Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
            ),
          ).pipe(
            Effect.flatMap((context) =>
              Effect.promise(() =>
                Context.get(context, Live.AetheriaBackend).openSnapshot(
                  SESSION,
                  `snap_${"a".repeat(64)}`,
                ),
              ),
            ),
          ),
        );
      const attachmentsDir = NodePath.join(makeRoot(false), "attachments");
      expect(yield* ask({ attachmentsDir })).toEqual({ ok: false, code: "ATTACHMENT_MISSING" });
      expect(yield* ask()).toEqual({ ok: false, code: "unavailable" });
    }),
  );

  it.live("hands the providers module the Pi agent directory only when the host supplies one", () =>
    Effect.gen(function* () {
      const ask = (options?: { readonly piAgentDir: string }) =>
        Effect.scoped(
          Layer.build(
            Live.makeLayer(makeRoot(false), options).pipe(
              Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
            ),
          ).pipe(
            Effect.flatMap((context) => capabilitiesOf(Context.get(context, Live.AetheriaBackend))),
          ),
        );
      expect(yield* ask({ piAgentDir: makeAgentDir() })).toMatchObject({
        reasonClass: "no-sign-in",
      });
      expect(yield* ask()).toMatchObject({
        state: "unknown",
        reasonClass: "service-unavailable",
      });
    }),
  );

  it.live("binds nothing when T3 holds no credential for the thread", () =>
    Effect.gen(function* () {
      const root = makeRoot();
      const drained = yield* Deferred.make<void>();
      const sink = Layer.mock(EventSink.EventSinkV2)({
        latestSequence: () => Effect.succeed(0),
        stream: () =>
          Stream.fromIterable(events as never[]).pipe(
            Stream.concat(Stream.drain(Stream.fromEffect(Deferred.succeed(drained, undefined)))),
            Stream.concat(Stream.never),
          ),
      });
      yield* Effect.scoped(
        Layer.build(
          Live.makeLayer(root).pipe(
            Layer.provide(Layer.mergeAll(sink, layerCredentials(undefined))),
          ),
        ).pipe(
          Effect.flatMap((context) => {
            const service = Context.get(context, Live.AetheriaBackend);
            return Deferred.await(drained).pipe(
              Effect.tap(() =>
                Effect.sync(() => expect(service.index.lookup(THREAD).status).toBe("absent")),
              ),
            );
          }),
        ),
      );
    }),
  );

  it.live("refuses to start with a state root that is not a normalised absolute path", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Layer.build(
          Live.makeLayer("relative/root").pipe(
            Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
          ),
        ).pipe(Effect.scoped),
      );
      expect(exit._tag).toBe("Failure");
    }),
  );

  it.live(
    "a second layer over a live Backend's state root fails with the refusal's fault code, and the first keeps running",
    () =>
      Effect.gen(function* () {
        const root = makeRoot();
        const provided = Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials("cred-1")));
        yield* Effect.scoped(
          Layer.build(Live.makeLayer(root).pipe(provided)).pipe(
            Effect.flatMap((context) => {
              const first = Context.get(context, Live.AetheriaBackend);
              return Effect.exit(
                Layer.build(Live.makeLayer(root).pipe(provided)).pipe(Effect.scoped),
              ).pipe(
                Effect.tap((exit) =>
                  Effect.sync(() => {
                    expect(exit._tag).toBe("Failure");
                    if (exit._tag === "Failure")
                      expect(Cause.pretty(exit.cause)).toContain(
                        "The Aetheria Backend did not start: refused (state-root-owned)",
                      );
                    expect(first.status().phase).toBe("running");
                  }),
                ),
              );
            }),
          ),
        );
      }),
  );

  it.live("marks every holder unknown when the stream ends", () =>
    Effect.gen(function* () {
      const root = makeRoot();
      const ending = Layer.mock(EventSink.EventSinkV2)({
        latestSequence: () => Effect.succeed(0),
        stream: () => Stream.fromIterable(events as never[]),
      });
      yield* Effect.scoped(
        Layer.build(
          Live.makeLayer(root).pipe(
            Layer.provide(Layer.mergeAll(ending, layerCredentials("cred-1"))),
          ),
        ).pipe(
          Effect.flatMap((context) => {
            const service = Context.get(context, Live.AetheriaBackend);
            return waitFor(() => service.liveness.status(THREAD).kind === "unknown");
          }),
        ),
      );
    }),
  );
});

describe("registration is gated on AETHERIA_STATE_ROOT", () => {
  const withEnv = (env: Record<string, string>) =>
    ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

  it.live("registers nothing without the state root, so a bare T3 is unchanged", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        Layer.mergeAll(Live.layer, Live.compositionLayer).pipe(
          Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
          Layer.provide(withEnv({})),
        ),
      ).pipe(
        Effect.scoped,
        Effect.map((c) => Context.getOption(c, Live.AetheriaBackend)),
      );
      expect(context._tag).toBe("None");
    }),
  );

  const capabilitiesWithEnv = (env: Record<string, string>) =>
    Effect.scoped(
      Layer.build(
        Live.layer.pipe(
          Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
          Layer.provide(withEnv(env)),
        ),
      ).pipe(
        Effect.flatMap((context) => capabilitiesOf(Context.get(context, Live.AetheriaBackend))),
      ),
    );

  it.live("reads the Pi agent directory only from AETHERIA_PI_AGENT_DIR, no ambient fallback", () =>
    Effect.gen(function* () {
      const root = makeRoot(false);
      const dir = makeAgentDir();
      const set = yield* capabilitiesWithEnv({
        AETHERIA_STATE_ROOT: root,
        AETHERIA_PI_AGENT_DIR: dir,
      });
      expect(set).toMatchObject({ reasonClass: "no-sign-in" });
      const unset = yield* capabilitiesWithEnv({
        AETHERIA_STATE_ROOT: makeRoot(false),
        PI_CODING_AGENT_DIR: dir,
      });
      expect(unset).toMatchObject({
        state: "unknown",
        reasonClass: "service-unavailable",
      });
    }),
  );

  it.live("keeps the Backend running and unknown when AETHERIA_PI_AGENT_DIR is unusable", () =>
    Effect.gen(function* () {
      const refused = yield* capabilitiesWithEnv({
        AETHERIA_STATE_ROOT: makeRoot(false),
        AETHERIA_PI_AGENT_DIR: "relative/agent",
      });
      expect(refused).toMatchObject({
        state: "unknown",
        reasonClass: "service-unavailable",
      });
    }),
  );

  it.live("publishes the composition digest the service validated when the state root is set", () =>
    Effect.gen(function* () {
      const root = makeRoot();
      const outcome = yield* Effect.scoped(
        Layer.build(
          Layer.mergeAll(Live.layer, Live.compositionLayer).pipe(
            Layer.provide(Layer.mergeAll(layerSink([]), layerCredentials(undefined))),
            Layer.provide(withEnv({ AETHERIA_STATE_ROOT: root })),
          ),
        ).pipe(
          Effect.map((context) => ({
            service: Context.get(context, Live.AetheriaBackend),
            composition: Context.get(context, AetheriaBackendComposition),
          })),
        ),
      );
      expect(outcome.composition.digest).toEqual(outcome.service.digest());
    }),
  );
});
