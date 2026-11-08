// AETHERIA M04 Plan step 15 (B5) — the server's handle on the Aetheria Backend composition it actually validated.
//
// The service exists only when the Aetheria Backend is provided at the server layer graph (step 16). The environment descriptor and the
// connection checks read it with `Effect.serviceOption`, so a T3 without the Backend has no service and behaves as before. It holds the
// published digest and nothing else: the validated composition, the lifecycle and the status RPC belong to the Backend adapter.
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import type { BackendDigest } from "./backendDigest.ts";

export class AetheriaBackendComposition extends Context.Service<
  AetheriaBackendComposition,
  {
    /** The digest of the composition the Backend validated (digest v1, host `backend`). */
    readonly digest: BackendDigest;
  }
>()("t3/aetheria/backendComposition/AetheriaBackendComposition") {}

/** Provide the service from a prepared Backend's safe status, read once at assembly (the digest of a validated composition does not change). */
export const layerFromBackend = (backend: {
  readonly status: () => { readonly digest: BackendDigest };
}) =>
  Layer.sync(AetheriaBackendComposition, () =>
    AetheriaBackendComposition.of({ digest: backend.status().digest }),
  );
