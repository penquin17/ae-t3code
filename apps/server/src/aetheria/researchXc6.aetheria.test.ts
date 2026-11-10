// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off globalDate:off
// AETHERIA M09 Plan step 15 (fork part) — the research operations through the ACTUAL authenticated XC-6 route.
//
// Boundary: T3's real McpSessionRegistry (the bearer), a real loopback HTTP server for the route, the real Backend service with its real providers module over the
// real installed `@aetheria/providers` archive (which now carries the tools research modules), M03's identity records in a real folder (a main session and a
// real-store child session, each by its own bearer), the digest gate, a synthetic auth.json, a stub search transport, and a real loopback socket for the fetch
// stand-in. No real credential, endpoint, DNS, model or search exists in this file. It shows: search runs as an ordinary XC-6 pending operation and its result is
// polled; the token reaches only the transport; Stop reaches the upstream request through research.cancel; a second session's cancel of the same requestId changes
// nothing; a Backend with no sign-in store answers credential-missing; the real default fetch refuses a loopback destination before any connection; fetch runs as
// pending over a real socket through a stand-in work. It does NOT show the pinning of the real fetch (the outer node tests do), the built server, or an installed Pi.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
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
const TOKEN_CANARY = "ACCESS-TOKEN-SYNTHETIC-RESEARCH";
const ACCOUNT_CANARY = "ACCOUNT-SYNTHETIC-RESEARCH-0001";
const REQUEST_ID = "request-id-0000000001";
const SETTLE_POLLS = 200;

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m09-research")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const record = (sessionId: string, kind: "main" | "child") => ({
  sessionId,
  kind,
  rootSessionId: MAIN,
  parentChain: kind === "main" ? [] : [MAIN],
  role: kind === "main" ? null : "worker",
  roleOrigin: kind === "main" ? null : "home",
  roleDigest: null,
  authoritySource: kind === "main" ? "main" : "role",
});
const writeRecord = (root: string, value: ReturnType<typeof record>) => {
  NodeFS.mkdirSync(NodePath.join(root, "identity"), { recursive: true, mode: 0o700 });
  NodeFS.writeFileSync(
    NodePath.join(root, "identity", `${value.sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state: "active",
      attemptId: `attempt-${value.sessionId}`,
      writer: "agent-host",
      acceptedPrompt: false,
      record: value,
    }),
    { mode: 0o600 },
  );
};

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
const agentDirWithGrant = () => {
  const dir = tempRoot("m09-s15-agent-");
  const file = NodePath.join(dir, "auth.json");
  NodeFS.writeFileSync(
    file,
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: TOKEN_CANARY,
        refresh: "REFRESH-SYNTHETIC-RESEARCH",
        expires: 4_102_444_800_000, // 2100-01-01: a fixed far-future expiry, so no refresh is due
        accountId: ACCOUNT_CANARY,
      },
    }),
    { mode: 0o600 },
  );
  NodeFS.chmodSync(file, 0o600);
  return dir;
};

const sseOf = (urls: ReadonlyArray<string>) => {
  const event = (data: unknown) => `event: x\ndata: ${JSON.stringify(data)}\n\n`;
  return (
    event({
      type: "response.output_item.done",
      item: {
        type: "web_search_call",
        action: { type: "search", sources: urls.map((url) => ({ type: "url", url })) },
      },
    }) +
    event({
      type: "response.output_item.done",
      item: {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              results: urls.map((url, i) => ({ title: `T${i}`, url, snippet: `S${i}` })),
            }),
            annotations: [],
          },
        ],
      },
    }) +
    event({
      type: "response.completed",
      response: { usage: { input_tokens: 5, output_tokens: 2 } },
    })
  );
};

/** One Backend behind the real route; `body` gets the posting helpers and both identities. */
const withBackend = (
  options: { providers?: any; research?: any },
  body: (h: {
    call: (
      bearer: string,
      session: string,
      op: string,
      args: unknown,
    ) => Effect.Effect<any, any, any>;
    settle: (bearer: string, session: string, first: any) => Effect.Effect<any, any, any>;
    poll: (bearer: string, session: string, token: string) => Effect.Effect<any, any, any>;
    mainBearer: string;
    childBearer: string;
  }) => Effect.Effect<void, any, any>,
) => {
  const stateRoot = tempRoot("m09-s15-xc6-");
  return Effect.scoped(
    Effect.gen(function* () {
      writeRecord(stateRoot, record(MAIN, "main"));
      writeRecord(stateRoot, record(CHILD, "child"));
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
        ...(options.providers === undefined ? {} : { providers: options.providers }),
        ...(options.research === undefined ? {} : { research: options.research }),
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
      const send = (bearer: string, session: string, payload: unknown) =>
        Effect.gen(function* () {
          const response = yield* http.post(Xc6Route.XC6_PATH, {
            headers: {
              authorization: bearer,
              "x-aetheria-caller-session": session,
              [EXPECTED_BACKEND_DIGEST_HEADER]: digest,
            },
            body: HttpBody.text(JSON.stringify(payload), "application/json"),
          });
          const text = yield* response.text;
          return { status: response.status, text, json: JSON.parse(text) as Record<string, any> };
        });
      const call = (bearer: string, session: string, op: string, args: unknown) =>
        send(bearer, session, { v: 1, op, args });
      const poll = (bearer: string, session: string, token: string) =>
        send(bearer, session, { v: 1, poll: token });
      const settle = (bearer: string, session: string, first: any) =>
        Effect.gen(function* () {
          // The carrier may answer pending first: poll until it settles, at most SETTLE_POLLS more times (each poll is a socket round trip, so the work progresses between polls); one still pending at the end fails the caller's assertion.
          if (first.json.status !== "pending") return first;
          return yield* poll(bearer, session, first.json.token).pipe(
            Effect.repeat({
              until: (reply) => reply.json.status !== "pending",
              times: SETTLE_POLLS,
            }),
          );
        });
      yield* Effect.promise(async () => {
        const result = await service.start();
        expect(result.outcome).toBe("started");
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
      yield* body({
        call,
        settle,
        poll,
        mainBearer: mainIssued.config.authorizationHeader,
        childBearer: childIssued.config.authorizationHeader,
      });
      yield* Effect.promise(() => service.dispose("test"));
    }),
  ).pipe(Effect.provide(layerRegistry));
};

it.live(
  "search is an ordinary XC-6 pending operation: the result is polled, the token reaches only the transport, and no reply carries a secret",
  () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const transport = async (url: string, init: RequestInit) => {
      requests.push({
        url,
        authorization: (init.headers as Record<string, string>)["Authorization"],
      });
      return new Response(sseOf(["https://a.example/", "https://b.example/"]), { status: 200 });
    };
    return withBackend(
      {
        providers: { mode: "production", agentDir: agentDirWithGrant(), warn: () => {} },
        research: { fetch: transport },
      },
      ({ call, settle, mainBearer, childBearer }) =>
        Effect.gen(function* () {
          for (const [bearer, session, id] of [
            [mainBearer, MAIN, REQUEST_ID],
            [childBearer, CHILD, "request-id-0000000002"],
          ] as const) {
            const first = yield* call(bearer, session, "research.search", {
              query: "q",
              limit: 3,
              requestId: id,
            });
            expect(first.status).toBe(200);
            expect(first.json.status).toBe("pending");
            const done = yield* settle(bearer, session, first);
            expect(done.json.status).toBe("done");
            expect(done.json.result.kind).toBe("ok");
            expect(done.json.result.value.sources.map((s: { url: string }) => s.url)).toEqual([
              "https://a.example/",
              "https://b.example/",
            ]);
            for (const text of [first.text, done.text]) {
              expect(text).not.toContain(TOKEN_CANARY);
              expect(text).not.toContain(ACCOUNT_CANARY);
              expect(text).not.toContain(id);
            }
          }
          expect(requests).toHaveLength(2);
          expect(
            requests.every((r) => r.url === "https://chatgpt.com/backend-api/codex/responses"),
          ).toBe(true);
          expect(requests.every((r) => r.authorization === `Bearer ${TOKEN_CANARY}`)).toBe(true);
        }),
    );
  },
);

it.live(
  "Stop reaches the upstream request through research.cancel, and a second session's cancel of the same requestId changes nothing",
  () => {
    let aborted = 0;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        started();
        init.signal?.addEventListener(
          "abort",
          () => {
            aborted += 1;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    return withBackend(
      {
        providers: { mode: "production", agentDir: agentDirWithGrant(), warn: () => {} },
        research: { fetch: transport },
      },
      ({ call, settle, poll, mainBearer, childBearer }) =>
        Effect.gen(function* () {
          const first = yield* call(mainBearer, MAIN, "research.search", {
            query: "q",
            limit: 3,
            requestId: REQUEST_ID,
          });
          expect(first.json.status).toBe("pending");
          yield* Effect.promise(() => begun);
          const other = yield* call(childBearer, CHILD, "research.cancel", {
            requestId: REQUEST_ID,
          });
          expect(other.json).toMatchObject({
            status: "done",
            result: { kind: "ok", value: { accepted: true } },
          });
          expect(aborted).toBe(0);
          const still = yield* poll(mainBearer, MAIN, first.json.token);
          expect(still.json.status).toBe("pending");
          const own = yield* call(mainBearer, MAIN, "research.cancel", { requestId: REQUEST_ID });
          expect(own.json).toMatchObject({ status: "done", result: { kind: "ok" } });
          const done = yield* settle(mainBearer, MAIN, still);
          expect(done.json).toMatchObject({ status: "done", result: { kind: "aborted" } });
          expect(aborted).toBe(1);
        }),
    );
  },
);

it.live(
  "a Backend with no sign-in store answers credential-missing, makes no request, and refuses bad arguments and a supplied session id",
  () => {
    let requests = 0;
    return withBackend(
      { research: { fetch: async () => ((requests += 1), new Response("", { status: 500 })) } },
      ({ call, settle, mainBearer }) =>
        Effect.gen(function* () {
          const first = yield* call(mainBearer, MAIN, "research.search", {
            query: "q",
            limit: 3,
            requestId: REQUEST_ID,
          });
          const done = yield* settle(mainBearer, MAIN, first);
          expect(done.json.result).toEqual({
            kind: "refused",
            code: "WEB_PROVIDER_CREDENTIAL_MISSING",
          });
          expect(requests).toBe(0);
          const bad = yield* call(mainBearer, MAIN, "research.search", {
            query: "q",
            limit: 99,
            requestId: REQUEST_ID,
          });
          expect(bad.json).toMatchObject({
            status: "done",
            result: { kind: "refused", code: "WEB_INVALID_ARGUMENTS" },
          });
          const naming = yield* call(mainBearer, MAIN, "research.search", {
            query: "q",
            limit: 3,
            requestId: REQUEST_ID,
            sessionId: CHILD,
          });
          expect(naming.json).toMatchObject({
            status: "done",
            result: { kind: "refused", code: "WEB_INVALID_ARGUMENTS" },
          });
        }),
    );
  },
);

it.live(
  "the real default fetch refuses a loopback destination before any connection, and a stand-in work serves a page from a real socket as a pending operation",
  () => {
    let connections = 0;
    const server = NodeHttp.createServer((_request, response) => {
      connections += 1;
      response.setHeader("content-type", "text/plain");
      response.end("hello from the synthetic server");
    });
    return Effect.promise(
      () =>
        new Promise<number>((resolve) =>
          server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
        ),
    ).pipe(
      Effect.flatMap((port) =>
        withBackend({}, ({ call, settle, mainBearer }) =>
          Effect.gen(function* () {
            const url = `http://127.0.0.1:${port}/page`;
            const refused = yield* settle(
              mainBearer,
              MAIN,
              yield* call(mainBearer, MAIN, "research.fetch", { url, requestId: REQUEST_ID }),
            );
            expect(refused.json.result).toEqual({ kind: "refused", code: "WEB_BLOCKED_URL" });
            expect(connections).toBe(0);
          }),
        ).pipe(
          Effect.andThen(
            withBackend(
              {
                research: {
                  fetchWork: {
                    decodeValue: (value: unknown) => ({ ok: true, value }),
                    run: (input: { url: string }) =>
                      new Promise((resolve, reject) => {
                        NodeHttp.get(input.url, (response) => {
                          let content = "";
                          response.setEncoding("utf8");
                          response.on("data", (chunk) => (content += chunk));
                          response.on("end", () =>
                            resolve({
                              kind: "ok",
                              value: {
                                url: input.url,
                                status: response.statusCode,
                                kind: "text",
                                content,
                                truncated: false,
                              },
                            }),
                          );
                        }).on("error", reject);
                      }),
                  },
                },
              },
              ({ call, settle, mainBearer }) =>
                Effect.gen(function* () {
                  const url = `http://127.0.0.1:${port}/page`;
                  const first = yield* call(mainBearer, MAIN, "research.fetch", {
                    url,
                    requestId: "request-id-0000000009",
                  });
                  expect(first.json.status).toBe("pending");
                  const done = yield* settle(mainBearer, MAIN, first);
                  expect(done.json.result).toMatchObject({
                    kind: "ok",
                    value: { status: 200, content: "hello from the synthetic server" },
                  });
                  expect(connections).toBe(1);
                }),
            ),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => void server.close())),
    );
  },
);
