// AETHERIA M04 Plan step 16 (IP-3, IP-11) — the handler behind the read-only client RPC `aetheria.composition.status`.
//
// It serves the Backend's safe status (the shape in @t3tools/aetheria-contracts, which has no field for a path, message, item name or
// token) and nothing else. With no Backend registered it fails with the typed unavailable error; it never invents a status.
import {
  AetheriaStatusUnavailableError,
  type AetheriaCompositionStatus,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const compositionStatus = (
  service: Option.Option<Pick<AetheriaBackendService, "status">>,
): Effect.Effect<AetheriaCompositionStatus, AetheriaStatusUnavailableError> =>
  Option.match(service, {
    onNone: () =>
      Effect.fail(
        new AetheriaStatusUnavailableError({
          message: "The Aetheria Backend is not registered on this server.",
        }),
      ),
    onSome: (backend) => Effect.sync(() => backend.status()),
  });
