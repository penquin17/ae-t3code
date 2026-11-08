// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M04 Plan step 16 — the PRODUCTION XC-6 route: T3's real McpSessionRegistry and a real loopback HTTP server in front of the
// Backend service (not the B9 probe identity). It shows the credential alignment end to end: the bearer T3 issues proves a credential id;
// the index is bound with that id (read through the credential reader, exactly as the server layer does), so a real bound session
// resolves, and a mismatched claimed session, an unbound thread and a Backend that is not running are all refused or unavailable. It does
// not show the built server or an installed Pi (tests/awareness/s16/native.test.mjs does).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { createAetheriaBackendService } from "@t3tools/aetheria-server";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as Xc6Route from "./xc6Route.ts";

const SESSION = "0197d3c0-1111-7000-8000-000000000001";
const OTHER = "0197d3c0-2222-7000-8000-000000000002";
const FOLDER = "/work/project";
const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-s16-test")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const writeRecord = (root: string, sessionId: string) => {
  NodeFS.mkdirSync(NodePath.join(root, "identity"), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(root, "identity", `${sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state: "active",
      attemptId: `attempt-${sessionId}`,
      writer: "agent-host",
      acceptedPrompt: false,
      record: {
        sessionId,
        kind: "main",
        rootSessionId: sessionId,
        parentChain: [],
        role: null,
        roleOrigin: null,
        roleDigest: null,
        authoritySource: "main",
      },
    }),
    { mode: 0o600 },
  );
};

it.effect(
  "resolves a real bound session through the production identity and refuses mismatches",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
        NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
        const stateRoot = NodeFS.mkdtempSync(NodePath.join(base, "m04-s16-route-"));
        writeRecord(stateRoot, SESSION);
        writeRecord(stateRoot, OTHER);

        const registry = yield* McpSessionRegistry.McpSessionRegistry;
        const issued = yield* registry.issue({
          threadId: ThreadId.make("mcp:thread-A"),
          providerInstanceId: ProviderInstanceId.make("pi"),
        });
        const bearer = issued.config.authorizationHeader;
        const credentials = new Map<string, string>([
          ["mcp:thread-A", issued.config.providerSessionId],
        ]);
        const other = yield* registry.issue({
          threadId: ThreadId.make("mcp:thread-B"),
          providerInstanceId: ProviderInstanceId.make("pi"),
        });

        const made = createAetheriaBackendService({
          stateRoot,
          credentialOf: (threadId) => credentials.get(threadId),
          projectRootOf: (folder) => folder,
        });
        if (made.outcome !== "prepared") throw new Error("must prepare");
        const { service } = made;
        yield* HttpRouter.serve(Xc6Route.routeLayer(Xc6Route.productionBackend(service)), {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(Layer.build);
        const http = yield* HttpClient.HttpClient;
        const post = (authorization: string, session: string | null, body: unknown) =>
          Effect.gen(function* () {
            const response = yield* http.post(Xc6Route.XC6_PATH, {
              headers: {
                authorization,
                ...(session === null ? {} : { "x-aetheria-caller-session": session }),
              },
              body: HttpBody.text(JSON.stringify(body), "application/json"),
            });
            return {
              status: response.status,
              json: JSON.parse(yield* response.text) as Record<string, unknown>,
            };
          });
        const call = { v: 1, op: "identity.lifecycle" };

        // Before start: unavailable, never an answer.
        expect((yield* post(bearer, SESSION, call)).json).toMatchObject({ status: "unavailable" });

        yield* Effect.promise(() => service.start());
        yield* Effect.promise(async () => {
          await service.ingest({
            sequence: 1,
            event: {
              type: "provider-session.updated",
              threadId: "mcp:thread-A",
              payload: { id: RUNTIME, providerInstanceId: "pi", status: "ready", cwd: FOLDER },
            },
          });
          await service.ingest({
            sequence: 2,
            event: {
              type: "provider-thread.updated",
              threadId: "mcp:thread-A",
              payload: {
                driver: "pi",
                providerInstanceId: "pi",
                providerSessionId: RUNTIME,
                appThreadId: "mcp:thread-A",
                nativeThreadRef: { nativeId: `/s/2026-11-08T08-00-00-000Z_${SESSION}.jsonl` },
              },
            },
          });
        });
        // The runtime provider-session id is not what the bearer proves; the credential id is, and it is what the index holds.
        expect(RUNTIME).not.toBe(issued.config.providerSessionId);
        const found = service.index.lookup("mcp:thread-A");
        expect(found.status === "ok" && found.binding.providerSessionId).toBe(
          issued.config.providerSessionId,
        );

        const good = yield* post(bearer, SESSION, call);
        expect(good.status).toBe(200);
        expect(good.json).toMatchObject({
          v: 1,
          status: "done",
          result: {
            sessions: { [SESSION]: { exists: true, closed: false, acceptedPrompt: null } },
          },
        });

        // A claimed session that is not the bound one: refused (403), not unavailable.
        expect((yield* post(bearer, OTHER, call)).status).toBe(403);
        // A model-supplied caller identifier in the body is refused as an unknown key, whatever the identity.
        expect((yield* post(bearer, SESSION, { ...call, caller: SESSION })).status).toBe(400);
        // A real bearer for a thread nobody bound: unavailable, never main.
        const unbound = yield* post(other.config.authorizationHeader, OTHER, call);
        expect(unbound.json).toMatchObject({ status: "unavailable" });

        // After the Backend drained: unavailable again.
        yield* Effect.promise(() => service.dispose("test"));
        expect((yield* post(bearer, SESSION, call)).json).toMatchObject({ status: "unavailable" });
      }),
    ).pipe(Effect.provide(layerRegistry)),
);
