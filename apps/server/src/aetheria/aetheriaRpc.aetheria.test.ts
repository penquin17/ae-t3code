// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off
// AETHERIA M04 Plan step 16 (IP-3, IP-11, IP-12, IP-14) — the client RPC group join: scope map, scope middleware and the status handler.
//
// Boundary: T3's real `WsRpcGroup` (now including `aetheria.composition.status`), the real exhaustive scope map and the real scope
// middleware (`RpcAuthorization.layer`) over an in-process RPC client. It shows: the new tag is in the group and has one explicit scope; a
// token without that scope is refused before the handler runs; a token with it gets the Backend's safe status; with no Backend the handler
// answers the typed unavailable error, never an invented status. It does not show a real WebSocket upgrade or session credential; the
// native run (tests/awareness/s16) calls the status method over the built server's /ws.
import { AuthOrchestrationReadScope, AuthTerminalReadScope, WsRpcGroup } from "@t3tools/contracts";
import { AETHERIA_WS_METHODS } from "@t3tools/aetheria-contracts";
import { createAetheriaBackendService } from "@t3tools/aetheria-server";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcTest from "effect/rpc/RpcTest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { compositionStatus } from "./aetheriaRpc.ts";

const TAG = AETHERIA_WS_METHODS.compositionStatus;

const makeService = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const stateRoot = NodeFS.mkdtempSync(NodePath.join(base, "m04-s16-rpc-"));
  const made = createAetheriaBackendService({ stateRoot, credentialOf: () => undefined });
  if (made.outcome !== "prepared") throw new Error("must prepare");
  return made.service;
};

describe("the Aetheria RPC is in the group with one explicit scope", () => {
  it("joins WsRpcGroup and is covered by the exhaustive scope map", () => {
    expect(WsRpcGroup.requests.has(TAG)).toBe(true);
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
    expect(requiredScopeForRpcMethod(TAG)).toBe(AuthOrchestrationReadScope);
  });

  it("adds only the status tag and the eleven XC-18 human-control tags (M06 step 6)", () => {
    expect(
      [...WsRpcGroup.requests.keys()].filter((tag) => tag.startsWith("aetheria.")).sort(),
    ).toEqual(Object.values(AETHERIA_WS_METHODS).sort());
  });
});

describe("the scope middleware in front of the status handler", () => {
  const group = WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<keyof typeof RPC_REQUIRED_SCOPES, typeof TAG> => tag !== TAG,
    ),
  );

  it.effect("refuses an absent or insufficient scope before the handler runs", () =>
    Effect.gen(function* () {
      for (const scopes of [[], [AuthTerminalReadScope]] as const) {
        const handled: Array<string> = [];
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(TAG, () =>
                Effect.sync(() => handled.push("status")).pipe(Effect.andThen(Effect.never)),
              ),
              RpcAuthorization.layer(scopes),
            ),
          ),
        );
        expect(yield* client[TAG]({}).pipe(Effect.flip)).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: AuthOrchestrationReadScope,
        });
        expect(handled).toEqual([]);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("answers an authenticated permitted call with the Backend's safe status", () =>
    Effect.gen(function* () {
      const service = makeService();
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(TAG, () => compositionStatus(Option.some(service))),
            RpcAuthorization.layer([AuthOrchestrationReadScope]),
          ),
        ),
      );
      const status = yield* client[TAG]({});
      expect(status).toMatchObject({ host: "backend", phase: "prepared" });
      expect(status.digest).toEqual(service.digest());
      expect(JSON.stringify(status)).not.toContain(".aetheria");
    }).pipe(Effect.scoped),
  );
});

describe("the status handler", () => {
  it.effect("fails with the typed unavailable error when no Backend is registered", () =>
    Effect.gen(function* () {
      const error = yield* compositionStatus(Option.none()).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "AetheriaStatusUnavailableError" });
    }),
  );
});
