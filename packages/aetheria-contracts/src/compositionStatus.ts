// AETHERIA — the read-only composition and lifecycle status a client may see.
//
// "Safe" is a property of this shape, not of the caller's care: it names digest, versions, module ids and states, and counts. It has no
// field for a failure message, a path, an item name, an argument or a token, so none can leak through it. The Backend builds it; the
// read-only RPC (rpc.ts) serves it; step 16 joins the RPC to the client group.
import * as Schema from "effect/Schema";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Sha256Stamp = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const ModuleId = Schema.String.check(Schema.isMinLength(1));

/** Where the Backend's lifecycle stands. `failed` is a start that rolled back; `disposed` is a Backend that was released. */
export const AetheriaPhase = Schema.Literals([
  "prepared",
  "starting",
  "running",
  "failed",
  "disposed",
]);
export type AetheriaPhase = typeof AetheriaPhase.Type;

export const AetheriaModuleState = Schema.Literals([
  "registered",
  "starting",
  "running",
  "failed",
  "skipped",
  "disposed",
]);
export type AetheriaModuleState = typeof AetheriaModuleState.Type;

/** The XC-7 disposal report reduced to what is safe to show: counts, and the modules whose drain failed or was not observed. */
export const AetheriaDisposalSummary = Schema.Struct({
  ok: Schema.Boolean,
  order: Schema.Array(ModuleId),
  released: Count,
  stopped: Count,
  transferred: Count,
  stillLive: Count,
  failedModules: Schema.Array(ModuleId),
  unobservedModules: Schema.Array(ModuleId),
});
export type AetheriaDisposalSummary = typeof AetheriaDisposalSummary.Type;

export const AetheriaCompositionStatus = Schema.Struct({
  composition: Schema.String.check(Schema.isMinLength(1)),
  host: Schema.Literal("backend"),
  phase: AetheriaPhase,
  /** The composition digest the Backend publishes (design D11, digest v1). */
  digest: Schema.Struct({
    version: Schema.Int,
    algorithm: Schema.Literal("sha256"),
    value: Sha256Stamp,
  }),
  /** The pinned library artifact this Backend was built with. */
  artifact: Schema.Struct({ package: Schema.String, version: Schema.String, stamp: Sha256Stamp }),
  activationOrder: Schema.Array(ModuleId),
  modules: Schema.Array(
    Schema.Struct({ id: ModuleId, required: Schema.Boolean, state: AetheriaModuleState }),
  ),
  disposal: Schema.NullOr(AetheriaDisposalSummary),
});
export type AetheriaCompositionStatus = typeof AetheriaCompositionStatus.Type;

/** Strict decode: a field the safe shape does not name is an error, so a leak cannot pass as a status. */
export const decodeAetheriaCompositionStatus = Schema.decodeSync(AetheriaCompositionStatus, {
  onExcessProperty: "error",
});
