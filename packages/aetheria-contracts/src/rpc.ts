// AETHERIA — the namespaced RPC group Aetheria adds; T3's WsRpcGroup joins it at one marked line (IP-3). Read-only: no method changes the Backend.
// This file must not import `@t3tools/contracts`: that package joins this group, so an import back would be a package cycle.
// T3's `RpcScopeAuthorization` supplies the authorization error, so a method's own error is only the Backend-specific one.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { AetheriaCompositionStatus } from "./compositionStatus.ts";

export const AETHERIA_WS_METHODS = {
  compositionStatus: "aetheria.composition.status",
} as const;

/** The Backend is not attached or has not produced a status; the caller sees this instead of an invented value. */
export class AetheriaStatusUnavailableError extends Schema.TaggedError<AetheriaStatusUnavailableError>()(
  "AetheriaStatusUnavailableError",
  { message: Schema.String },
) {}

export const AetheriaCompositionStatusRpc = Rpc.make(AETHERIA_WS_METHODS.compositionStatus, {
  payload: Schema.Struct({}),
  success: AetheriaCompositionStatus,
  error: AetheriaStatusUnavailableError,
});

export const AetheriaRpcGroup = RpcGroup.make(AetheriaCompositionStatusRpc);
