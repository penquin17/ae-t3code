// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off globalDate:off
// AETHERIA M09 Plan step 21 (fork part) — the snapshot operations through the ACTUAL authenticated XC-6 route.
//
// Boundary: T3's real McpSessionRegistry (the bearer), a real loopback HTTP server for the route, the real Backend service with its real providers module over
// the real installed `@aetheria/providers` archive (its snapshot store included), M03's identity records in a real folder (a main session and a real-store child
// session, each by its own bearer), the digest gate, and real temporary folders for the attachments directory and the declared files. No credential, model or
// network exists in this file. It shows: both bearers store and describe their own snapshots with metadata-only replies (no path, no bytes); a session cannot
// describe another's snapshot; an argument outside the strict contract (a session id, a bad digest) is refused as an error before the store runs; a wrong digest
// is SNAPSHOT_CHANGED; a thread deletion on the event stream removes that thread's snapshots only; a drained Backend answers unavailable. It does NOT show
// T3's real attachments directory or upload path, the layer wiring (aetheriaBackend.aetheria.test.ts), Linux, or the download route (M10's).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
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
const STORE = "attachments.store-snapshot";
const DESCRIBE = "attachments.describe-snapshot";
const sha = (data: string) =>
  `sha256:${NodeCrypto.createHash("sha256").update(data).digest("hex")}`;

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-m09-snapshots")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)),
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

/** One Backend behind the real route, with its own attachments directory; `body` gets the posting helpers, both bearers and the service. */
const withBackend = (
  body: (h: {
    call: (
      bearer: string,
      session: string,
      op: string,
      args: unknown,
    ) => Effect.Effect<any, any, any>;
    service: any;
    file: (name: string, content: string) => string;
    attachmentsDir: string;
    mainBearer: string;
    childBearer: string;
  }) => Effect.Effect<void, any, any>,
) => {
  const stateRoot = tempRoot("m09-s21-xc6-");
  const attachmentsDir = NodePath.join(tempRoot("m09-s21-att-"), "attachments");
  const work = tempRoot("m09-s21-work-");
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
        attachmentsDir,
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
      const call = (bearer: string, session: string, op: string, args: unknown) =>
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
      yield* Effect.promise(async () => {
        expect((await service.start()).outcome).toBe("started");
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
        service,
        file: (name, content) => {
          const path = NodePath.join(work, name);
          NodeFS.writeFileSync(path, content);
          return path;
        },
        attachmentsDir,
        mainBearer: mainIssued.config.authorizationHeader,
        childBearer: childIssued.config.authorizationHeader,
      });
      yield* Effect.promise(() => service.dispose("test"));
    }),
  ).pipe(Effect.provide(layerRegistry));
};

it.live(
  "both bearers store and describe their own snapshots, and no reply carries a path or the bytes",
  () =>
    withBackend(({ call, service, file, attachmentsDir, mainBearer, childBearer }) =>
      Effect.gen(function* () {
        const stored: Array<{ session: string; id: string; content: string }> = [];
        const one = (bearer: string, session: string, content: string) =>
          Effect.gen(function* () {
            const path = file(`${session}.txt`, content);
            const done = yield* call(bearer, session, STORE, {
              sourcePath: path,
              declaredDigest: sha(content),
            });
            expect(done.json.status).toBe("done");
            expect(done.json.result).toEqual({
              ok: true,
              snapshotId: `snap_${sha(content).slice(7)}`,
              digest: sha(content),
              size: content.length,
            });
            expect(done.text).not.toContain(path);
            expect(done.text).not.toContain(attachmentsDir);
            expect(done.text).not.toContain(content.trim());
            const described = yield* call(bearer, session, DESCRIBE, {
              snapshotId: done.json.result.snapshotId,
            });
            expect(described.json.result).toEqual(done.json.result);
            stored.push({ session, id: done.json.result.snapshotId, content });
          });
        yield* one(mainBearer, MAIN, "main session's delivered file\n");
        yield* one(childBearer, CHILD, "child session's delivered file\n");
        for (const { session, id, content } of stored) {
          const opened: any = yield* Effect.promise(() => service.openSnapshot(session, id));
          const bytes = yield* Effect.promise(async () => {
            const parts: Buffer[] = [];
            for await (const chunk of opened.stream) parts.push(chunk as Buffer);
            return Buffer.concat(parts).toString("utf8");
          });
          expect(bytes).toBe(content);
        }
      }),
    ),
);

it.live(
  "a session cannot describe another session's snapshot, and a wrong digest is SNAPSHOT_CHANGED",
  () =>
    withBackend(({ call, file, mainBearer, childBearer }) =>
      Effect.gen(function* () {
        const content = "the main session's file\n";
        const stored = yield* call(mainBearer, MAIN, STORE, {
          sourcePath: file("main.txt", content),
          declaredDigest: sha(content),
        });
        const foreign = yield* call(childBearer, CHILD, DESCRIBE, {
          snapshotId: stored.json.result.snapshotId,
        });
        expect(foreign.json).toMatchObject({
          status: "done",
          result: { ok: false, code: "ATTACHMENT_MISSING" },
        });
        const wrong = yield* call(mainBearer, MAIN, STORE, {
          sourcePath: file("other.txt", "different bytes\n"),
          declaredDigest: sha(content),
        });
        expect(wrong.json).toMatchObject({
          status: "done",
          result: { ok: false, code: "SNAPSHOT_CHANGED" },
        });
      }),
    ),
);

it.live(
  "an argument outside the strict contract is refused as an error before the store runs, and the reply repeats nothing it was given",
  () =>
    withBackend(({ call, file, attachmentsDir, mainBearer }) =>
      Effect.gen(function* () {
        const content = "x\n";
        const path = file("a.txt", content);
        const marker = "CANARY-SUPPLIED-VALUE";
        for (const args of [
          { sourcePath: path, declaredDigest: sha(content), sessionId: CHILD },
          { sourcePath: path, declaredDigest: marker },
          { sourcePath: path },
        ]) {
          const refused = yield* call(mainBearer, MAIN, STORE, args);
          expect(refused.json.status).toBe("error");
          expect(refused.text).not.toContain(marker);
          expect(refused.text).not.toContain(CHILD);
        }
        const naming = yield* call(mainBearer, MAIN, DESCRIBE, {
          snapshotId: `snap_${"a".repeat(64)}`,
          sessionId: CHILD,
        });
        expect(naming.json.status).toBe("error");
        expect(NodeFS.existsSync(NodePath.join(attachmentsDir, "deliverables"))).toBe(false);
      }),
    ),
);

it.live(
  "a thread deletion on the event stream removes that thread's snapshots only, and a drained Backend answers unavailable",
  () =>
    withBackend(({ call, service, file, mainBearer, childBearer }) =>
      Effect.gen(function* () {
        const make = (bearer: string, session: string, content: string) =>
          call(bearer, session, STORE, {
            sourcePath: file(`${session}.txt`, content),
            declaredDigest: sha(content),
          });
        const main = (yield* make(mainBearer, MAIN, "main file\n")).json.result.snapshotId;
        const child = (yield* make(childBearer, CHILD, "child file\n")).json.result.snapshotId;
        yield* Effect.promise(() =>
          service.ingest({
            sequence: 5,
            event: { type: "thread.deleted", threadId: "mcp:thread-main", payload: {} },
          }),
        );
        const gone = yield* call(mainBearer, MAIN, DESCRIBE, { snapshotId: main });
        expect(gone.json.result).toEqual({ ok: false, code: "ATTACHMENT_MISSING" });
        const kept = yield* call(childBearer, CHILD, DESCRIBE, { snapshotId: child });
        expect(kept.json.result.ok).toBe(true);
        yield* Effect.promise(() => service.dispose("test"));
        const after = yield* call(childBearer, CHILD, DESCRIBE, { snapshotId: child });
        expect(after.json.status).toBe("unavailable");
        expect(after.text).not.toContain(child);
      }),
    ),
);
