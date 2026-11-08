// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11) — the XC-6 transport: a private request/reply route on T3's own loopback HTTP server, a sibling
// of `/mcp`. It reuses McpSessionRegistry.resolve, the same bearer resolution `/mcp` uses for the credential T3 injects into Pi, and
// is NOT an MCP toolkit: nothing here is registered with McpServer, so no operation can appear in `tools/list` or in Pi's tool
// declarations (the bridge in mcpExtensionSource.ts only registers what `/mcp` advertises).
//
// What the transport owns: the bearer -> caller facts (thread, provider session, provider instance), the Pi session id the Agent
// adapter attaches in `x-aetheria-caller-session` (a claim, verified by the core's identity port), the body size bound, and the
// no-store JSON reply. A failed bearer logs a reason only, never the token or the body.
//
// The default `layer` exists only when AETHERIA_B9_PROBE_ROOT names the probe root; without it no route is registered, so a plain
// T3 is unchanged. Step 16 replaces the probe identity and operations with the Backend's.

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { parseBearerToken } from "../auth/EnvironmentAuth.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as NodeCrypto from "node:crypto";
import type { AetheriaBackendService } from "@t3tools/aetheria-server";
import { AetheriaBackend } from "./aetheriaBackend.ts";
import { AetheriaBackendComposition } from "./backendComposition.ts";
import { EXPECTED_BACKEND_DIGEST_HEADER } from "./backendDigest.ts";
import { xc6DigestRefusal } from "./connectionGate.ts";
import { createXc6Backend, type Xc6Backend, type Xc6Event, type Xc6Reply } from "./xc6Core.ts";
import { makeProbeIdentity } from "./xc6ProbeIdentity.ts";
import { PROBE_OPERATIONS } from "./xc6ProbeOperations.ts";

export const XC6_PATH = "/aetheria/xc6";
const XC6_SESSION_HEADER = "x-aetheria-caller-session";
const XC6_PROBE_ROOT_ENV = "AETHERIA_B9_PROBE_ROOT";
const MAX_BODY_CHARS = 65_536;
const MAX_SESSION_CHARS = 200;

const json = (body: Xc6Reply, status: number) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

export const routeLayer = (backend: Xc6Backend) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const registry = yield* McpSessionRegistry.McpSessionRegistry;
      const composition = yield* Effect.serviceOption(AetheriaBackendComposition);
      return HttpRouter.add(
        "POST",
        XC6_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const token = parseBearerToken(request) ?? "";
          const scope = yield* registry.resolve(token);
          if (scope?.thread === undefined) {
            yield* Effect.logWarning("rejected XC-6 request with an unusable credential", {
              reason:
                request.headers.authorization === undefined
                  ? "missing_authorization_header"
                  : "unusable_token",
            });
            return json({ v: 1, status: "refused", code: "XC6_UNAUTHORIZED" }, 401);
          }
          // B5: once the Backend composition is provided, the caller must declare the Backend digest its pinned build expects, and it must equal ours.
          // Refused here, before the body is read and before any operation or identity lookup runs.
          const digestRefusal = xc6DigestRefusal(
            request.headers[EXPECTED_BACKEND_DIGEST_HEADER],
            composition,
          );
          if (digestRefusal !== undefined) {
            return HttpServerResponse.jsonUnsafe(digestRefusal.body, {
              status: digestRefusal.status,
              headers: { "cache-control": "no-store" },
            });
          }
          const text = yield* request.text.pipe(Effect.orElseSucceed(() => undefined));
          if (text !== undefined && text.length > MAX_BODY_CHARS) {
            return json({ v: 1, status: "refused", code: "XC6_TOO_LARGE" }, 413);
          }
          let body: unknown;
          try {
            body = text === undefined ? undefined : JSON.parse(text);
          } catch {
            body = undefined;
          }
          const claimed = request.headers[XC6_SESSION_HEADER];
          const response = yield* Effect.promise(() =>
            backend.handle({
              caller: {
                threadId: scope.thread!.threadId,
                providerSessionId: scope.thread!.providerSessionId,
                providerInstanceId: scope.thread!.providerInstanceId,
              },
              claimedSessionId:
                typeof claimed === "string" && claimed.length <= MAX_SESSION_CHARS ? claimed : null,
              body,
            }),
          );
          return json(response.body, response.http);
        }),
      );
    }),
  );

/**
 * The production XC-6 core (step 16): the Backend's own identity port (bearer thread + credential + claimed Pi session checked against
 * the thread index and M03's active record, unavailable unless the Backend runs) and its gated operation table. Nothing probe-shaped.
 */
const logEvent = (event: Xc6Event): void => void Effect.runFork(Effect.logInfo("xc6", event));

export const productionBackend = (
  service: Pick<AetheriaBackendService, "identity" | "operations">,
): Xc6Backend =>
  createXc6Backend({
    identity: (caller, claimedSessionId) => service.identity(caller, claimedSessionId),
    operations: service.operations(),
    newToken: () => NodeCrypto.randomBytes(32).toString("base64url"),
    log: logEvent,
    maxPending: 256,
  });

/**
 * The seam entry (IP-6, extended at step 16): with the Aetheria Backend registered (IP-1) the route serves the Backend's identity and
 * operations. Without it, the B9 probe (identity index and operations) exists only when AETHERIA_B9_PROBE_ROOT names a probe root, and
 * it is test-only; with neither, no route is registered and a plain T3 is unchanged. The Backend wins when both are present.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const backend = yield* Effect.serviceOption(AetheriaBackend);
    if (Option.isSome(backend)) return routeLayer(productionBackend(backend.value));
    const probeRoot = yield* Config.String(XC6_PROBE_ROOT_ENV).pipe(Config.option);
    return Option.match(probeRoot, {
      onNone: (): ReturnType<typeof routeLayer> => Layer.empty,
      onSome: (root) =>
        routeLayer(
          createXc6Backend({
            identity: makeProbeIdentity(root),
            operations: PROBE_OPERATIONS,
            newToken: () => NodeCrypto.randomBytes(32).toString("base64url"),
            log: logEvent,
            maxPending: 256,
          }),
        ),
    });
  }),
);
