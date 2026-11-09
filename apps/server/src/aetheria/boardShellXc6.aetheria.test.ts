// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M09 Plan step 17 (fork part) — `board.record-shell` through the ACTUAL authenticated XC-6 route and the Backend digest gate.
//
// Boundary: T3's real McpSessionRegistry (the bearer), a real loopback HTTP server, the real Backend service with its real awareness module over the real
// installed `@aetheria/awareness` archive, M03's identity records in a real folder (a main session and a real-store child session, each by its own bearer), a
// real workspace folder and the board file under the state root. Git is a named double answering "outside git". It shows: both bearers record a shell
// change on the root's board; an extra field is an XC-6 error that runs nothing; an outside path is a done refusal that stores nothing; a wrong or absent
// digest is refused before the body is read; a drained Backend answers unavailable. It does NOT show a peer's summary (the server package's tests do),
// the built server, or an installed Pi: the "child" is a record the test wrote, not a spawned process.
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
const OP = "board.record-shell";

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m09-board-shell")),
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
  cwd: string,
) => {
  await service.ingest({
    sequence,
    event: {
      type: "provider-session.updated",
      threadId,
      payload: { id: runtime, providerInstanceId: "pi", status: "ready", cwd },
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

const made: string[] = [];
afterAll(() => {
  for (const dir of made) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const stateRootOf = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = NodeFS.mkdtempSync(NodePath.join(base, "m09-s17-shell-"));
  made.push(dir);
  return dir;
};
const workspaceOf = () => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-shell-")));
  made.push(dir);
  return dir;
};
const outsideGit = {
  topLevel: async () => undefined,
  changedFiles: async () => ({ status: "outside-git" as const }),
};

it.effect(
  "serves board.record-shell to a main and a real-store child bearer through the route and the digest gate, strictly and for the root",
  () => {
    const stateRoot = stateRootOf();
    const ws = workspaceOf();
    const boardOf = () => {
      const dir = NodePath.join(stateRoot, "board");
      const files = (NodeFS.existsSync(dir) ? NodeFS.readdirSync(dir) : []).filter((name) =>
        name.endsWith(".json"),
      );
      return files.length === 0
        ? undefined
        : (JSON.parse(NodeFS.readFileSync(NodePath.join(dir, files[0]!), "utf8")) as {
            revision: number;
            sessions: Record<string, { shell?: { changed: string[]; unknown: boolean } }>;
          });
    };
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
        const prepared = createAetheriaBackendService({
          stateRoot,
          credentialOf: (threadId) => credentials.get(threadId),
          projectRootOf: (folder) => folder,
          git: outsideGit,
        });
        if (prepared.outcome !== "prepared") throw new Error("must prepare");
        const { service } = prepared;
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
        const mainBearer = mainIssued.config.authorizationHeader;
        const childBearer = childIssued.config.authorizationHeader;
        const a = NodePath.join(ws, "a.txt");
        const b = NodePath.join(ws, "src", "b.ts");
        const request = (args: unknown) => ({ v: 1, op: OP, args });

        // Before start: unavailable, never an answer.
        expect(
          (yield* post(mainBearer, MAIN, request({ paths: [a], outcome: "changed" }))).json,
        ).toMatchObject({ status: "unavailable" });

        yield* Effect.promise(async () => {
          await service.start();
          await bind(service, "mcp:thread-main", MAIN, "provider-session:pi:m", 1, ws);
          await bind(service, "mcp:thread-child", CHILD, "provider-session:pi:c", 3, ws);
        });

        // Normal: each bearer records for its root; the child's record lands on the main's session.
        const first = yield* post(mainBearer, MAIN, request({ paths: [b, a], outcome: "changed" }));
        expect(first.status).toBe(200);
        expect(first.json).toEqual({ v: 1, status: "done", result: { recorded: true, count: 2 } });
        const second = yield* post(childBearer, CHILD, request({ paths: [a], outcome: "changed" }));
        expect(second.json.result).toEqual({ recorded: true, count: 1 });
        expect(boardOf()?.sessions[MAIN]?.shell).toEqual({ changed: [a, b], unknown: false });
        expect(boardOf()?.sessions[CHILD]).toBeUndefined();
        const unknown = yield* post(childBearer, CHILD, request({ paths: [], outcome: "unknown" }));
        expect(unknown.json.result).toEqual({ recorded: true, count: 0 });
        expect(boardOf()?.sessions[MAIN]?.shell).toEqual({ changed: [a, b], unknown: true });
        const stored = boardOf();

        // A bearer cannot speak for the other session, and a caller id at the envelope is refused.
        expect(
          (yield* post(childBearer, MAIN, request({ paths: [a], outcome: "changed" }))).status,
        ).toBe(403);
        expect(
          (yield* post(mainBearer, MAIN, {
            ...request({ paths: [a], outcome: "changed" }),
            caller: MAIN,
          })).status,
        ).toBe(400);

        // Strict arguments: an extra field or a wrong shape is an XC-6 error and nothing is stored.
        const smuggled = yield* post(
          mainBearer,
          MAIN,
          request({ paths: [a], outcome: "changed", sessionId: CHILD }),
        );
        expect(smuggled.status).toBe(500);
        expect(smuggled.json).toEqual({ v: 1, status: "error", code: "XC6_OPERATION_FAILED" });
        expect(
          (yield* post(mainBearer, MAIN, request({ paths: ["a.txt"], outcome: "changed" }))).json,
        ).toMatchObject({ status: "error" });
        expect(
          (yield* post(mainBearer, MAIN, request({ paths: [a, a], outcome: "changed" }))).json,
        ).toMatchObject({ status: "error" });

        // A path outside the workspace is a done refusal with a registry code, and nothing is stored.
        const outside = yield* post(
          mainBearer,
          MAIN,
          request({ paths: [NodePath.join(NodeOS.tmpdir(), "elsewhere.txt")], outcome: "changed" }),
        );
        expect(outside.json).toMatchObject({
          status: "done",
          result: { recorded: false, code: "AWARENESS_INVALID" },
        });
        expect(boardOf()).toEqual(stored);

        // Wrong and absent digest: refused at the gate, before the body is read, and nothing runs.
        const wrong = yield* post(
          mainBearer,
          MAIN,
          request({ paths: [NodePath.join(ws, "z.txt")], outcome: "changed" }),
          `sha256:${"0".repeat(64)}`,
        );
        expect(wrong.status).toBe(409);
        expect(wrong.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MISMATCH" });
        const absent = yield* post(
          mainBearer,
          MAIN,
          request({ paths: [a], outcome: "changed" }),
          null,
        );
        expect(absent.status).toBe(409);
        expect(absent.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MALFORMED" });
        expect(boardOf()).toEqual(stored);

        // Drain: unavailable again, never a stale answer.
        yield* Effect.promise(() => service.dispose("test"));
        const drained = request({ paths: [a], outcome: "changed" });
        expect((yield* post(mainBearer, MAIN, drained)).json).toMatchObject({
          status: "unavailable",
        });
        expect((yield* post(childBearer, CHILD, drained)).json).toMatchObject({
          status: "unavailable",
        });
      }),
    ).pipe(Effect.provide(layerRegistry));
  },
);
