// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off globalDate:off
// AETHERIA M09 Plan step 8 (fork part) — XC-11 with the REAL credential, quota and catalog adapters, through the ACTUAL authenticated XC-6 route.
//
// Boundary: T3's real McpSessionRegistry (the bearer), a real loopback HTTP server, the real Backend service with its real providers module over
// the real installed `@aetheria/providers` archive (its bundled Pi auth code, readers and catalog), M03's identity records in a real folder (a main
// session and a real-store child session, each by its own bearer), the digest gate, a synthetic auth.json in a temporary owner-only agent directory,
// and an injected fetch. No real auth file, endpoint, credential or model exists in this file. It shows: signed-in routes are available through both
// identities with the meter, catalog and remembered-failure rules of the design; only the two fixed endpoints are requested; no reply carries the
// token or the account id; a failing meter is unknown, not out; a refused agent directory leaves the Backend running, answers unknown, and warns once
// without the path. It does NOT show the built server, an installed Pi, the production spawner, a real OAuth refresh, or how a deployment supplies the
// directory (step 24): the directory here is a service option.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, expect, it } from "@effect/vitest";
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
const SONNET = { provider: "anthropic", model: "claude-sonnet-5" };
const CODEX = { provider: "openai-codex", model: "gpt-5.6-luna" };
const OTHER = { provider: "openai", model: "gpt-5" };
const TOKEN_CANARY = "ACCESS-TOKEN-SYNTHETIC-XC6";
const ACCOUNT_CANARY = "ACCOUNT-SYNTHETIC-XC6-0001";
const EXTRA_USAGE = "You're out of extra usage credits.";

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m09-adapters")),
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

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) NodeFS.rmSync(root, { recursive: true, force: true });
});

const tempRoot = (prefix: string) => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, prefix));
  tempRoots.push(root);
  return root;
};

const agentDirWith = (auth: unknown) => {
  const dir = tempRoot("m09-s08-agent-");
  const file = NodePath.join(dir, "auth.json");
  NodeFS.writeFileSync(file, JSON.stringify(auth), { mode: 0o600 });
  NodeFS.chmodSync(file, 0o600);
  return dir;
};
const grant = () => ({
  type: "oauth",
  access: TOKEN_CANARY,
  refresh: "REFRESH-TOKEN-SYNTHETIC-XC6",
  expires: 4_102_444_800_000, // 2100-01-01: a fixed far-future expiry, so no refresh is due
  accountId: ACCOUNT_CANARY,
});

/** One Backend with the given providers mode behind the real route; `body` gets the posting helper and the identities. */
const withBackend = (
  providers: any,
  body: (h: {
    post: (
      bearer: string,
      session: string,
      op: string,
      args: unknown,
    ) => Effect.Effect<any, any, any>;
    mainBearer: string;
    childBearer: string;
    service: any;
  }) => Effect.Effect<void, any, any>,
  now: () => number = () => Date.parse("2026-11-09T10:00:00.000Z"),
) => {
  const stateRoot = tempRoot("m09-s08-xc11-");
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
        providers,
        now,
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
      const post = (bearer: string, session: string, op: string, args: unknown) =>
        Effect.gen(function* () {
          const response = yield* http.post(Xc6Route.XC6_PATH, {
            headers: {
              authorization: bearer,
              "x-aetheria-caller-session": session,
              [EXPECTED_BACKEND_DIGEST_HEADER]: digest,
            },
            body: HttpBody.text(JSON.stringify({ v: 1, op, args }), "application/json"),
          });
          const text = yield* response.text;
          return { status: response.status, text, json: JSON.parse(text) as Record<string, any> };
        });
      const started = yield* Effect.promise(async () => {
        const result = await service.start();
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
        return result;
      });
      expect(started.outcome).toBe("started");
      yield* body({
        post,
        mainBearer: mainIssued.config.authorizationHeader,
        childBearer: childIssued.config.authorizationHeader,
        service,
      });
      yield* Effect.promise(() => service.dispose("test"));
    }),
  ).pipe(Effect.provide(layerRegistry));
};

it.effect(
  "real adapters over XC-6: signed-in routes are available for a main and a child bearer, meter and catalog are real, and no secret is in a reply",
  () => {
    const dir = agentDirWith({ anthropic: grant(), "openai-codex": grant() });
    const urls: string[] = [];
    const warnings: string[] = [];
    const fetchDouble = async (url: unknown) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          String(url).includes("anthropic")
            ? { five_hour: { utilization: 12 } }
            : { rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000 } } },
        ),
        { status: 200 },
      );
    };
    return withBackend(
      {
        mode: "production",
        agentDir: dir,
        warn: (l: string) => warnings.push(l),
        fetch: fetchDouble,
      },
      ({ post, mainBearer, childBearer }) =>
        Effect.gen(function* () {
          const all: string[] = [];
          for (const [bearer, session] of [
            [mainBearer, MAIN],
            [childBearer, CHILD],
          ] as const) {
            const reply = yield* post(bearer, session, "providers.route-states", {
              routes: [SONNET, CODEX, OTHER],
              purpose: "launch",
            });
            all.push(reply.text);
            expect(reply.json.status).toBe("done");
            expect(reply.json.result.states.map((s: any) => [s.state, s.reasonClass])).toEqual([
              ["available", "signed-in-window-ok"],
              ["available", "signed-in-window-ok"],
              ["out", "no-sign-in"],
            ]);
            expect(reply.text).not.toContain("fixture");
          }
          const caps = yield* post(mainBearer, MAIN, "providers.route-capabilities", {
            route: SONNET,
          });
          all.push(caps.text);
          expect(caps.json.result).toMatchObject({ source: "catalog", images: "yes" });
          const usage = yield* post(childBearer, CHILD, "providers.usage", {});
          all.push(usage.text);
          expect(usage.json.result.readings.map((r: any) => [r.provider, r.status]).sort()).toEqual(
            [
              ["anthropic", "ok"],
              ["openai-codex", "ok"],
            ],
          );
          // Remembered extra-usage refusal: out with its own reason, through the same gates.
          const report = yield* post(mainBearer, MAIN, "providers.report-failure", {
            route: SONNET,
            failure: { message: EXTRA_USAGE },
          });
          all.push(report.text);
          expect(report.json.result).toMatchObject({ class: "limit", remembered: true });
          const after = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "display",
          });
          all.push(after.text);
          expect(after.json.result.states[0]).toMatchObject({
            state: "out",
            reasonClass: "extra-usage-refused",
          });
          // One meter call per provider served route-states and usage together (one cache); only the two fixed endpoints were requested.
          expect([...new Set(urls)].sort()).toEqual([
            "https://api.anthropic.com/api/oauth/usage",
            "https://chatgpt.com/backend-api/wham/usage",
          ]);
          expect(urls.filter((u) => u.includes("anthropic"))).toHaveLength(1);
          for (const text of all) {
            expect(text).not.toContain(TOKEN_CANARY);
            expect(text).not.toContain(ACCOUNT_CANARY);
          }
          expect(warnings).toEqual([]);
        }),
    );
  },
);

it.effect(
  "a refused agent directory leaves the Backend running: unknown / service-unavailable through the route, one warning that names the reason and not the path",
  () => {
    const warnings: string[] = [];
    let fetched = 0;
    return withBackend(
      {
        mode: "production",
        agentDir: "relative/very-secret-dir",
        warn: (l: string) => warnings.push(l),
        fetch: async () => {
          fetched += 1;
          return new Response("{}");
        },
      },
      ({ post, mainBearer }) =>
        Effect.gen(function* () {
          const reply = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "launch",
          });
          expect(reply.json.status).toBe("done");
          expect(reply.json.result.states[0]).toMatchObject({
            state: "unknown",
            reasonClass: "service-unavailable",
          });
          expect(warnings).toHaveLength(1);
          expect(warnings[0]).toMatch(/invalid-agent-dir/);
          expect(warnings[0]).not.toContain("very-secret-dir");
          expect(reply.text).not.toContain("very-secret-dir");
          expect(fetched).toBe(0);
        }),
    );
  },
);

it.effect(
  "a meter that fails is a failure class on usage and unknown (not out) on route-states, and the grant on disk is untouched",
  () => {
    const dir = agentDirWith({ anthropic: grant() });
    const before = NodeFS.readFileSync(NodePath.join(dir, "auth.json"), "utf8");
    return withBackend(
      {
        mode: "production",
        agentDir: dir,
        warn: () => {},
        fetch: async () => new Response("{}", { status: 503 }),
      },
      ({ post, mainBearer }) =>
        Effect.gen(function* () {
          const usage = yield* post(mainBearer, MAIN, "providers.usage", { provider: "anthropic" });
          expect(usage.json.result.readings[0]).toMatchObject({
            status: "unavailable",
            failure: "network",
          });
          const states = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "launch",
          });
          expect(states.json.result.states[0].state).toBe("unknown");
          expect(NodeFS.readFileSync(NodePath.join(dir, "auth.json"), "utf8")).toBe(before);
        }),
    );
  },
);

it.effect(
  "a stale full meter holds the route out until reset, then the same failing meter leaves it unknown through XC-6",
  () => {
    const dir = agentDirWith({ anthropic: grant() });
    const t0 = Date.parse("2026-11-09T10:00:00.000Z");
    const time = { value: t0 };
    let calls = 0;
    return withBackend(
      {
        mode: "production",
        agentDir: dir,
        warn: () => {},
        parameters: { usageCacheOkMs: 1000, usageCacheDegradedMs: 1000 },
        fetch: async () => {
          calls += 1;
          return calls === 1
            ? new Response(
                JSON.stringify({
                  five_hour: { utilization: 100, resets_at: new Date(t0 + 10_000).toISOString() },
                }),
                { status: 200 },
              )
            : new Response("{}", { status: 503 });
        },
      },
      ({ post, mainBearer }) =>
        Effect.gen(function* () {
          const first = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "launch",
          });
          expect(first.json.result.states[0]).toMatchObject({
            state: "out",
            reasonClass: "usage-window-full",
          });
          time.value += 2000;
          const stale = yield* post(mainBearer, MAIN, "providers.usage", { provider: "anthropic" });
          expect(stale.json.result.readings[0]).toMatchObject({
            status: "stale",
            failure: "network",
          });
          expect(stale.json.result.readings[0].windows[0]).toMatchObject({ usedPercent: 100 });
          const held = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "display",
          });
          expect(held.json.result.states[0]).toMatchObject({
            state: "out",
            reasonClass: "usage-window-full",
          });
          time.value = t0 + 11_000;
          const reset = yield* post(mainBearer, MAIN, "providers.route-states", {
            routes: [SONNET],
            purpose: "display",
          });
          expect(reset.json.result.states[0]).toMatchObject({
            state: "unknown",
            reasonClass: "read-failed",
          });
          expect(calls).toBe(3);
        }),
      () => time.value,
    );
  },
);
