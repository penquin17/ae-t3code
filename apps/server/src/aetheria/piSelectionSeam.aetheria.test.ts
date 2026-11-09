// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M09 Plan step 11 (IP-17) — the Backend layer fills and empties the Pi selection slot, over the real Backend and providers module.
//
// Boundary: the real layer (`makeLayer`) over the real service and the real installed `@aetheria/providers` archive, with the event stream and the
// credential store replaced by in-memory doubles, as in the layer test. There is no agent directory, so capabilities come from the archive's bundled
// Pi catalog alone. It shows: the slot holds the Backend's seam while the layer is open and nothing after the scope closes; a table model gets its
// chat or child default marked supported, an unsupported explicit effort is refused, a model the catalog lacks passes an explicit effort labelled
// unknown; the slot key is the one T3's adapter source reads. It does NOT show the adapter's commands (the provider-pi test does) or a full server.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { PI_SELECTION_SEAM_SLOT } from "@t3tools/aetheria-server";
import { McpProviderSessions } from "@t3tools/provider-core/server/McpProviderSessions";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Live from "./aetheriaBackend.ts";

const slot = (): any => (globalThis as Record<symbol, unknown>)[PI_SELECTION_SEAM_SLOT];

const makeRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  return NodeFS.mkdtempSync(NodePath.join(base, "m09-s11-seam-"));
};

const doubles = Layer.mergeAll(
  Layer.mock(EventSink.EventSinkV2)({
    latestSequence: () => Effect.succeed(0),
    stream: () => Stream.never,
  }),
  Layer.mock(McpProviderSessions)({ read: () => Effect.sync(() => undefined) }),
);

describe("the Backend layer and the Pi selection slot", () => {
  it.live(
    "holds the Backend's seam while open, answers from the bundled catalog, and empties the slot at close",
    () =>
      Effect.gen(function* () {
        expect(slot()).toBeUndefined();
        const root = makeRoot();
        yield* Effect.scoped(
          Layer.build(Live.makeLayer(root).pipe(Layer.provide(doubles))).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                const seam = slot();
                expect(seam).toBeDefined();
                const fable = { provider: "anthropic", model: "claude-fable-5-1" };
                expect(seam.resolve({ ...fable, child: false })).toMatchObject({
                  outcome: "resolved",
                  effort: "high",
                  effortSource: "aetheria-default",
                  validation: "supported",
                });
                expect(seam.resolve({ ...fable, child: true })).toMatchObject({ effort: "medium" });
                expect(seam.resolve({ ...fable, effort: "off", child: false })).toMatchObject({
                  outcome: "refused",
                  code: "effort-unsupported",
                });
                expect(
                  seam.resolve({ provider: "xai", model: "grok-4.6", effort: "low", child: false }),
                ).toMatchObject({
                  outcome: "resolved",
                  effort: "low",
                  source: "explicit",
                  validation: "unknown-capability",
                });
                expect(
                  seam.resolve({ provider: "xai", model: "grok-4.6", child: false }),
                ).toMatchObject({ outcome: "resolved", effort: null });
              }),
            ),
          ),
        );
        expect(slot()).toBeUndefined();
        NodeFS.rmSync(root, { recursive: true, force: true });
      }),
  );

  it.live("installs nothing without a state root, so bare T3 reads an empty slot", () =>
    Effect.scoped(
      Layer.build(
        Live.layer.pipe(
          Layer.provide(doubles),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        ),
      ).pipe(Effect.tap(() => Effect.sync(() => expect(slot()).toBeUndefined()))),
    ),
  );

  it("uses the slot key the adapter source reads", () => {
    const adapter = NodeFS.readFileSync(
      new URL("../../../../packages/provider-pi/src/server/adapter.ts", import.meta.url),
      "utf8",
    );
    expect(PI_SELECTION_SEAM_SLOT.description).toBe("aetheria.pi.selection-seam");
    expect(adapter).toContain(`Symbol.for("${String(PI_SELECTION_SEAM_SLOT.description)}")`);
  });
});
