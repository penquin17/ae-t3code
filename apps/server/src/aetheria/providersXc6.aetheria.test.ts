// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M09 Plan step 4 — XC-11 (`providers.*`) through the ACTUAL authenticated XC-6 route and the Backend digest gate.
//
// Boundary: T3's real McpSessionRegistry (the bearer), a real loopback HTTP server, the real Backend service with its real providers module over
// the real installed `@aetheria/providers` archive, M03's identity records in a real folder (a main session and a real-store child session, each
// reached by its own bearer), and the digest gate. It shows: the honest production answers; strict-argument violations are an `error` and run nothing;
// extra body fields, a wrong or absent digest and a stopped Backend are refused or unavailable before an answer; and the scripted fixture is
// labelled and only exists in a scripted composition with its own digest. It does NOT show the built server, an installed Pi, a real credential or
// usage adapter (none exists before step 6), or the production spawner: the "child" here is a record the test wrote, not a spawned process.
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
import { AetheriaBackendComposition } from "./backendComposition.ts";
import { EXPECTED_BACKEND_DIGEST_HEADER } from "./backendDigest.ts";
import * as Xc6Route from "./xc6Route.ts";

const MAIN = "0197d3c0-1111-7000-8000-000000000001";
const CHILD = "0197d3c0-3333-7000-8000-000000000003";
const FOLDER = "/work/project";
const ROUTE = { provider: "anthropic", model: "claude-sonnet-x" };
const LIMIT_TEXT = "You have hit your ChatGPT usage limit. Try again in ~30 min.";
const SECRET = "SECRET-VALUE-123";

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m09-test")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const writeRecord = (root: string, record: Record<string, unknown> & { sessionId: string }) => {
  NodeFS.mkdirSync(NodePath.join(root, "identity"), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(root, "identity", `${record.sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state: "active",
      attemptId: `attempt-${record.sessionId}`,
      writer: "agent-host",
      acceptedPrompt: false,
      record,
    }),
    { mode: 0o600 },
  );
};
const mainRecord = (sessionId: string) => ({
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  parentChain: [],
  role: null,
  roleOrigin: null,
  roleDigest: null,
  authoritySource: "main",
});
const childRecord = (sessionId: string, root: string) => ({
  sessionId,
  kind: "child",
  rootSessionId: root,
  parentChain: [root],
  role: "worker",
  roleOrigin: "home",
  roleDigest: null,
  authoritySource: "role",
});

const bind = async (
  service: { ingest: (event: any) => Promise<void> },
  threadId: string,
  sessionId: string,
  runtime: string,
  sequence: number,
) => {
  await service.ingest({
    sequence,
    event: {
      type: "provider-session.updated",
      threadId,
      payload: { id: runtime, providerInstanceId: "pi", status: "ready", cwd: FOLDER },
    },
  });
  await service.ingest({
    sequence: sequence + 1,
    event: {
      type: "provider-thread.updated",
      threadId,
      payload: {
        driver: "pi",
        providerInstanceId: "pi",
        providerSessionId: runtime,
        appThreadId: threadId,
        nativeThreadRef: { nativeId: `/s/2026-11-09T08-00-00-000Z_${sessionId}.jsonl` },
      },
    },
  });
};

const stateRootOf = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  return NodeFS.mkdtempSync(NodePath.join(base, "m09-s04-xc11-"));
};

it.effect(
  "serves XC-11 to a main and a real-store child bearer through the authenticated route and the digest gate, honestly and strictly",
  () => {
    const stateRoot = stateRootOf();
    return Effect.scoped(
      Effect.gen(function* () {
        writeRecord(stateRoot, mainRecord(MAIN));
        writeRecord(stateRoot, childRecord(CHILD, MAIN));
        const registry = yield* McpSessionRegistry.McpSessionRegistry;
        const mainIssued = yield* registry.issue({
          threadId: ThreadId.make("mcp:thread-main"),
          providerInstanceId: ProviderInstanceId.make("pi"),
        });
        const childIssued = yield* registry.issue({
          threadId: ThreadId.make("mcp:thread-child"),
          providerInstanceId: ProviderInstanceId.make("pi"),
        });
        const credentials = new Map<string, string>([
          ["mcp:thread-main", mainIssued.config.providerSessionId],
          ["mcp:thread-child", childIssued.config.providerSessionId],
        ]);
        const made = createAetheriaBackendService({
          stateRoot,
          credentialOf: (threadId) => credentials.get(threadId),
          projectRootOf: (folder) => folder,
        });
        if (made.outcome !== "prepared") throw new Error("must prepare");
        const { service } = made;
        const digest = service.digest().value;
        yield* HttpRouter.serve(Xc6Route.routeLayer(Xc6Route.productionBackend(service)), {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.build,
          Effect.provideService(
            AetheriaBackendComposition,
            AetheriaBackendComposition.of({ digest: service.digest() }),
          ),
        );
        const http = yield* HttpClient.HttpClient;
        const post = (
          bearer: string,
          session: string | null,
          body: unknown,
          declared: string | null = digest,
        ) =>
          Effect.gen(function* () {
            const response = yield* http.post(Xc6Route.XC6_PATH, {
              headers: {
                authorization: bearer,
                ...(session === null ? {} : { "x-aetheria-caller-session": session }),
                ...(declared === null ? {} : { [EXPECTED_BACKEND_DIGEST_HEADER]: declared }),
              },
              body: HttpBody.text(JSON.stringify(body), "application/json"),
            });
            const text = yield* response.text;
            return { status: response.status, text, json: JSON.parse(text) as Record<string, any> };
          });
        const states = {
          v: 1,
          op: "providers.route-states",
          args: { routes: [ROUTE], purpose: "launch" },
        };
        const mainBearer = mainIssued.config.authorizationHeader;
        const childBearer = childIssued.config.authorizationHeader;

        // Before start: unavailable, never an answer.
        // (The identity port answers first, so the code is the identity port's, not the operation gate's.)
        expect((yield* post(mainBearer, MAIN, states)).json).toMatchObject({
          status: "unavailable",
        });

        yield* Effect.promise(async () => {
          await service.start();
          await bind(
            service,
            "mcp:thread-main",
            MAIN,
            "provider-session:provider-instance:pi:thread:m:abc",
            1,
          );
          await bind(
            service,
            "mcp:thread-child",
            CHILD,
            "provider-session:provider-instance:pi:thread:c:def",
            3,
          );
        });
        // The two bearers are the two real identities the route resolves.
        expect(
          service.identity(
            {
              threadId: "mcp:thread-main",
              providerSessionId: mainIssued.config.providerSessionId,
              providerInstanceId: "pi",
            },
            MAIN,
          ),
        ).toMatchObject({ ok: true, kind: "main" });
        expect(
          service.identity(
            {
              threadId: "mcp:thread-child",
              providerSessionId: childIssued.config.providerSessionId,
              providerInstanceId: "pi",
            },
            CHILD,
          ),
        ).toMatchObject({ ok: true, kind: "child" });

        // Normal: production answers honestly unknown / service-unavailable to both identities, with no fixture label.
        for (const [bearer, session] of [
          [mainBearer, MAIN],
          [childBearer, CHILD],
        ] as const) {
          const reply = yield* post(bearer, session, states);
          expect(reply.status).toBe(200);
          expect(reply.json.status).toBe("done");
          expect(reply.json.result.states).toHaveLength(1);
          expect(reply.json.result.states[0]).toMatchObject({
            state: "unknown",
            reasonClass: "service-unavailable",
          });
          expect(reply.text).not.toContain("fixture");
        }
        // A bearer cannot speak for the other session.
        expect((yield* post(childBearer, MAIN, states)).status).toBe(403);

        // Capabilities and usage over the same gates: nothing claimed, nothing invented.
        const caps = yield* post(mainBearer, MAIN, {
          v: 1,
          op: "providers.route-capabilities",
          args: { route: ROUTE },
        });
        expect(caps.json.result).toMatchObject({ images: "unknown", source: "none" });
        const usage = yield* post(childBearer, CHILD, { v: 1, op: "providers.usage", args: {} });
        expect(usage.json.status).toBe("done");
        for (const reading of usage.json.result.readings)
          expect(reading.status).toBe("unavailable");

        // Strict arguments: an extra field is an XC-6 error, runs nothing, and the message echoes no value.
        const smuggled = yield* post(mainBearer, MAIN, {
          v: 1,
          op: "providers.report-failure",
          args: {
            route: ROUTE,
            failure: { message: LIMIT_TEXT },
            authorization: `Bearer ${SECRET}`,
          },
        });
        expect(smuggled.status).toBe(500);
        expect(smuggled.json).toEqual({ v: 1, status: "error", code: "XC6_OPERATION_FAILED" });
        expect(smuggled.text).not.toContain(SECRET);
        expect(
          (yield* post(mainBearer, MAIN, { ...states, args: { ...states.args, sessionId: MAIN } }))
            .json,
        ).toMatchObject({ status: "error" });
        // ...and nothing was remembered by the refused report: the route is still honestly unknown.
        const after = yield* post(mainBearer, MAIN, states);
        expect(after.json.result.states[0]).toMatchObject({
          state: "unknown",
          reasonClass: "service-unavailable",
        });
        // A caller id at the envelope is refused as an unknown key, whatever the identity.
        expect((yield* post(mainBearer, MAIN, { ...states, caller: MAIN })).status).toBe(400);

        // Wrong and absent digest: refused at the gate, before the body is read, and nothing runs.
        const wrong = yield* post(
          mainBearer,
          MAIN,
          {
            v: 1,
            op: "providers.report-failure",
            args: { route: ROUTE, failure: { message: LIMIT_TEXT } },
          },
          `sha256:${"0".repeat(64)}`,
        );
        expect(wrong.status).toBe(409);
        expect(wrong.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MISMATCH" });
        const absent = yield* post(mainBearer, MAIN, states, null);
        expect(absent.status).toBe(409);
        // The route reads a missing declaration as an empty one, which the gate refuses as malformed (M04's behavior, unchanged).
        expect(absent.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MALFORMED" });
        const stillUnknown = yield* post(childBearer, CHILD, states);
        expect(stillUnknown.json.result.states[0]).toMatchObject({
          reasonClass: "service-unavailable",
        });

        // Workload: a valid report is remembered by the one service both identities share, and the next launch sees it; a restart is an empty memory.
        const report = yield* post(mainBearer, MAIN, {
          v: 1,
          op: "providers.report-failure",
          args: { route: ROUTE, failure: { message: LIMIT_TEXT } },
        });
        expect(report.json.result).toMatchObject({ class: "limit", remembered: true });
        const seen = yield* post(childBearer, CHILD, states);
        expect(seen.json.result.states[0]).toMatchObject({
          state: "out",
          reasonClass: "limit-remembered",
        });
        expect(seen.text).not.toContain("fixture");

        // Drain: unavailable again, never a stale answer.
        yield* Effect.promise(() => service.dispose("test"));
        expect((yield* post(mainBearer, MAIN, states)).json).toMatchObject({
          status: "unavailable",
        });
        expect((yield* post(childBearer, CHILD, states)).json).toMatchObject({
          status: "unavailable",
        });
      }),
    ).pipe(
      Effect.provide(layerRegistry),
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(stateRoot, { recursive: true, force: true })),
      ),
    );
  },
);

it.effect(
  "refuses the fixture in the production composition and serves it labelled only in a scripted composition with its own digest",
  () => {
    const stateRoot = stateRootOf();
    return Effect.scoped(
      Effect.gen(function* () {
        writeRecord(stateRoot, mainRecord(MAIN));
        // Refused before anything exists: no service, so no route can answer from it.
        const refused = createAetheriaBackendService({
          stateRoot,
          credentialOf: () => undefined,
          providers: { mode: "fixture" },
        });
        expect(refused).toMatchObject({
          outcome: "refused",
          faults: [{ code: "providers-fixture-in-production" }],
        });

        const production = createAetheriaBackendService({
          stateRoot: stateRootOf(),
          credentialOf: () => undefined,
        });
        if (production.outcome !== "prepared") throw new Error("must prepare");

        const registry = yield* McpSessionRegistry.McpSessionRegistry;
        const issued = yield* registry.issue({
          threadId: ThreadId.make("mcp:thread-main"),
          providerInstanceId: ProviderInstanceId.make("pi"),
        });
        const made = createAetheriaBackendService({
          stateRoot,
          credentialOf: () => issued.config.providerSessionId,
          projectRootOf: (folder) => folder,
          composition: "aetheria-backend-scripted",
          providers: {
            mode: "fixture",
            script: { states: () => ({ state: "available", reasonClass: "signed-in-window-ok" }) },
          },
        });
        if (made.outcome !== "prepared")
          throw new Error(`must prepare: ${JSON.stringify(made.faults)}`);
        const { service } = made;
        expect(service.digest().value).not.toBe(production.service.digest().value);
        yield* HttpRouter.serve(Xc6Route.routeLayer(Xc6Route.productionBackend(service)), {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.build,
          Effect.provideService(
            AetheriaBackendComposition,
            AetheriaBackendComposition.of({ digest: service.digest() }),
          ),
        );
        const http = yield* HttpClient.HttpClient;
        const post = (declared: string) =>
          Effect.gen(function* () {
            const response = yield* http.post(Xc6Route.XC6_PATH, {
              headers: {
                authorization: issued.config.authorizationHeader,
                "x-aetheria-caller-session": MAIN,
                [EXPECTED_BACKEND_DIGEST_HEADER]: declared,
              },
              body: HttpBody.text(
                JSON.stringify({
                  v: 1,
                  op: "providers.route-states",
                  args: { routes: [ROUTE], purpose: "launch" },
                }),
                "application/json",
              ),
            });
            return {
              status: response.status,
              json: JSON.parse(yield* response.text) as Record<string, any>,
            };
          });
        yield* Effect.promise(async () => {
          await service.start();
          await bind(
            service,
            "mcp:thread-main",
            MAIN,
            "provider-session:provider-instance:pi:thread:m:abc",
            1,
          );
        });
        // A peer that expects the PRODUCTION digest is refused by the scripted Backend: a fixture composition cannot pass for production.
        const asProduction = yield* post(production.service.digest().value);
        expect(asProduction.status).toBe(409);
        expect(asProduction.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MISMATCH" });
        // A peer that declares the scripted digest gets the labelled scripted answer.
        const scripted = yield* post(service.digest().value);
        expect(scripted.status).toBe(200);
        expect(scripted.json.result.states[0]).toMatchObject({
          state: "available",
          reasonClass: "signed-in-window-ok",
          label: "fixture",
        });
        yield* Effect.promise(() => service.dispose("test"));
      }),
    ).pipe(
      Effect.provide(layerRegistry),
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(stateRoot, { recursive: true, force: true })),
      ),
    );
  },
);
