// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11): the XC-6 route behind T3's REAL McpSessionRegistry and a real loopback HTTP server. It proves
// bearer resolution (missing, forged, revoked), the bearer-derived thread/provider identity checked against an M03-shaped active
// record, cross-session poll refusal, and that neither bearer nor payload text reaches logs or error bodies. The native end-to-end
// run (installed Pi -> built T3) lives in tests/awareness/b9/.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { createXc6Backend, type Xc6Operation, type Xc6Settled } from "./xc6Core.ts";
import { indexFileName, makeProbeIdentity } from "./xc6ProbeIdentity.ts";
import { PROBE_OPERATIONS } from "./xc6ProbeOperations.ts";
import * as Xc6Route from "./xc6Route.ts";

const PAYLOAD = "PAYLOAD-SENTINEL-TEXT-0042";
const environmentId = EnvironmentId.make("environment-b9-test");

const makeRoot = () => {
  const base = NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs");
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = NodeFS.mkdtempSync(NodePath.join(base, "m04-s11-route-"));
  NodeFS.mkdirSync(NodePath.join(root, "identity"), { mode: 0o700 });
  NodeFS.mkdirSync(NodePath.join(root, "b9-index"), { mode: 0o700 });
  return root;
};
const writeRecord = (root: string, sessionId: string, state: "active" | "retired" = "active") =>
  NodeFS.writeFileSync(
    NodePath.join(root, "identity", `${sessionId}.json`),
    JSON.stringify({
      formatVersion: 1,
      state,
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
const writeIndex = (root: string, threadId: string, sessionId: string, providerInstanceId = "pi") =>
  NodeFS.writeFileSync(
    NodePath.join(root, "b9-index", indexFileName(threadId)),
    JSON.stringify({ threadId, providerInstanceId, sessionId }),
    {
      mode: 0o600,
    },
  );

const layerRegistry = McpSessionRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(environmentId),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const run = <A, E>(
  root: string,
  body: (input: {
    registry: McpSessionRegistry.McpSessionRegistryShape;
    post: (input: {
      bearer?: string | undefined;
      session?: string | null;
      body?: unknown;
      raw?: string;
    }) => Effect.Effect<{ status: number; text: string; json: any }, any, any>;
    issue: (thread: string) => Effect.Effect<string, any, any>;
    logs: unknown[];
  }) => Effect.Effect<A, E, any>,
  operations: Readonly<Record<string, Xc6Operation>> = PROBE_OPERATIONS,
) => {
  const logs: unknown[] = [];
  const logger = Logger.make(({ message }) => logs.push(message));
  return Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* McpSessionRegistry.McpSessionRegistry;
      const backend = createXc6Backend({
        identity: makeProbeIdentity(root),
        operations,
        newToken: () => `pending-${Math.random().toString(36).slice(2)}`,
        log: (event) => logs.push(event),
        maxPending: 8,
      });
      yield* HttpRouter.serve(Xc6Route.routeLayer(backend), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const http = yield* HttpClient.HttpClient;
      const post = (input: {
        bearer?: string | undefined;
        session?: string | null;
        body?: unknown;
        raw?: string;
      }) =>
        Effect.gen(function* () {
          const response = yield* http.post(Xc6Route.XC6_PATH, {
            headers: {
              ...(input.bearer === undefined ? {} : { authorization: input.bearer }),
              ...(input.session === undefined || input.session === null
                ? {}
                : { "x-aetheria-caller-session": input.session }),
            },
            body: HttpBody.text(input.raw ?? JSON.stringify(input.body ?? {}), "application/json"),
          });
          const text = yield* response.text;
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          return { status: response.status, text, json };
        });
      const issue = (thread: string) =>
        registry
          .issue({
            threadId: ThreadId.make(thread),
            providerInstanceId: ProviderInstanceId.make("pi"),
          })
          .pipe(Effect.map((issued) => issued.config.authorizationHeader.slice("Bearer ".length)));
      return yield* body({ registry, post, issue, logs });
    }),
  ).pipe(
    Effect.provide(
      layerRegistry.pipe(Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false }))),
    ),
  );
};

it.effect(
  "answers an authenticated request with the identity T3's bearer and M03's record agree on",
  () => {
    const root = makeRoot();
    writeRecord(root, "session-A");
    writeIndex(root, "thread-A", "session-A");
    return run(root, ({ post, issue }) =>
      Effect.gen(function* () {
        const token = yield* issue("thread-A");
        const reply = yield* post({
          bearer: `Bearer ${token}`,
          session: "session-A",
          body: {
            v: 1,
            op: "probe.whoami",
            args: { callerSessionId: "session-VICTIM", note: PAYLOAD },
          },
        });
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({
          v: 1,
          status: "done",
          result: {
            sessionId: "session-A",
            threadId: "thread-A",
            providerInstanceId: "pi",
            kind: "main",
          },
        });
        expect(reply.text).not.toContain(PAYLOAD);
      }),
    ).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
    );
  },
);

it.effect(
  "refuses missing, malformed, forged and revoked bearers, and leaks neither bearer nor payload",
  () => {
    const root = makeRoot();
    writeRecord(root, "session-A");
    writeIndex(root, "thread-A", "session-A");
    return run(root, ({ post, issue, registry, logs }) =>
      Effect.gen(function* () {
        const token = yield* issue("thread-A");
        const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
        const body = { v: 1, op: "probe.echo-digest", args: { text: PAYLOAD } };
        const attempts: Array<string | undefined> = [
          undefined,
          "Bearer",
          "Bearer ",
          `Basic ${token}`,
          `Bearer ${flipped}`,
          `Bearer ${token.toUpperCase()}`,
          "Bearer not-a-token",
        ];
        for (const bearer of attempts) {
          const reply = yield* post({ bearer, session: "session-A", body });
          expect(reply.status, String(bearer)).toBe(401);
          expect(reply.json).toEqual({ v: 1, status: "refused", code: "XC6_UNAUTHORIZED" });
          expect(reply.text).not.toContain(token);
        }
        // a case-insensitive scheme is accepted, as for /mcp
        expect(
          (yield* post({ bearer: `bEaReR ${token}`, session: "session-A", body })).status,
        ).toBe(200);
        yield* registry.revokeThread(ThreadId.make("thread-A"));
        const revoked = yield* post({ bearer: `Bearer ${token}`, session: "session-A", body });
        expect(revoked.status).toBe(401);
        expect(revoked.json).toEqual({ v: 1, status: "refused", code: "XC6_UNAUTHORIZED" });
        const everything = JSON.stringify(logs);
        expect(everything).not.toContain(token);
        expect(everything).not.toContain(flipped);
        expect(everything).not.toContain(PAYLOAD);
      }),
    ).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
    );
  },
);

it.effect(
  "checks the bearer's thread and provider against M03's active record for the claimed Pi session",
  () => {
    const root = makeRoot();
    writeRecord(root, "session-A");
    writeRecord(root, "session-B");
    writeRecord(root, "session-R", "retired");
    writeIndex(root, "thread-A", "session-A");
    writeIndex(root, "thread-B", "session-B");
    writeIndex(root, "thread-R", "session-R");
    writeIndex(root, "thread-P", "session-A", "other-provider");
    return run(root, ({ post, issue }) =>
      Effect.gen(function* () {
        const tokenA = yield* issue("thread-A");
        const call = (token: string, session: string | null) =>
          post({ bearer: `Bearer ${token}`, session, body: { v: 1, op: "probe.whoami" } });

        // thread A's bearer claiming B's (also active) session: mismatch
        const swapped = yield* call(tokenA, "session-B");
        expect(swapped.status).toBe(403);
        expect(swapped.json).toEqual({ v: 1, status: "refused", code: "XC6_IDENTITY_MISMATCH" });
        // a session id that is not a safe name, or absent: unavailable, never main
        expect((yield* call(tokenA, "../etc/passwd")).json).toMatchObject({
          status: "unavailable",
          code: "XC6_IDENTITY_UNAVAILABLE",
        });
        expect((yield* call(tokenA, null)).json).toMatchObject({
          status: "unavailable",
          code: "XC6_IDENTITY_UNAVAILABLE",
        });
        // no index for the thread yet (launch awaiting): unavailable
        const tokenN = yield* issue("thread-NEW");
        expect((yield* call(tokenN, "session-A")).json).toMatchObject({
          status: "unavailable",
          code: "XC6_IDENTITY_UNAVAILABLE",
        });
        // index present, record not yet written: unavailable
        writeIndex(root, "thread-W", "session-W");
        const tokenW = yield* issue("thread-W");
        expect((yield* call(tokenW, "session-W")).json).toMatchObject({
          status: "unavailable",
          code: "XC6_IDENTITY_UNAVAILABLE",
        });
        // retired record: refused
        const tokenR = yield* issue("thread-R");
        expect((yield* call(tokenR, "session-R")).json).toEqual({
          v: 1,
          status: "refused",
          code: "XC6_IDENTITY_RETIRED",
        });
        // provider instance differs from the index's
        const tokenP = yield* issue("thread-P");
        expect((yield* call(tokenP, "session-A")).json).toEqual({
          v: 1,
          status: "refused",
          code: "XC6_IDENTITY_MISMATCH",
        });
        // the matching pair works
        expect((yield* call(tokenA, "session-A")).json).toMatchObject({ status: "done" });
      }),
    ).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
    );
  },
);

it.effect(
  "returns a pending token, repolls it to completion, and refuses another session's poll",
  () => {
    const root = makeRoot();
    writeRecord(root, "session-A");
    writeRecord(root, "session-B");
    writeIndex(root, "thread-A", "session-A");
    writeIndex(root, "thread-B", "session-B");
    let release: () => void = () => {};
    const settle = new Promise<Xc6Settled>((resolve) => {
      release = () => resolve({ status: "done", result: { slow: true } });
    });
    return run(
      root,
      ({ post, issue }) =>
        Effect.gen(function* () {
          const tokenA = yield* issue("thread-A");
          const tokenB = yield* issue("thread-B");
          const as = (token: string, session: string, body: unknown) =>
            post({ bearer: `Bearer ${token}`, session, body });

          const start = yield* as(tokenA, "session-A", {
            v: 1,
            op: "probe.slow",
            args: { delayMs: 150 },
          });
          expect(start.json).toMatchObject({ v: 1, status: "pending" });
          const pendingToken = start.json.token as string;
          expect(typeof pendingToken).toBe("string");
          expect((yield* as(tokenA, "session-A", { v: 1, poll: pendingToken })).json).toEqual({
            v: 1,
            status: "pending",
            token: pendingToken,
          });

          // B (valid bearer, valid session) cannot read or consume A's pending result; A's own bearer with B's session cannot either
          const foreign = yield* as(tokenB, "session-B", { v: 1, poll: pendingToken });
          expect(foreign.status).toBe(403);
          expect(foreign.json).toEqual({ v: 1, status: "refused", code: "XC6_POLL_REFUSED" });
          expect((yield* as(tokenA, "session-B", { v: 1, poll: pendingToken })).json).toMatchObject(
            {
              status: "refused",
            },
          );

          // The operation settles only when the test releases it; the next poll then reports the result.
          release();
          const completed = yield* as(tokenA, "session-A", { v: 1, poll: pendingToken });
          expect(completed.json).toEqual({ v: 1, status: "done", result: { slow: true } });
          expect((yield* as(tokenA, "session-A", { v: 1, poll: pendingToken })).status).toBe(403);
        }),
      { ...PROBE_OPERATIONS, "probe.slow": () => ({ status: "pending", settle }) },
    ).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
    );
  },
);

it.effect(
  "answers an explicit unavailable, and refuses top-level caller identity, unknown operations and oversized bodies",
  () => {
    const root = makeRoot();
    writeRecord(root, "session-A");
    writeIndex(root, "thread-A", "session-A");
    return run(root, ({ post, issue }) =>
      Effect.gen(function* () {
        const token = yield* issue("thread-A");
        const as = (input: { body?: unknown; raw?: string }) =>
          post({ bearer: `Bearer ${token}`, session: "session-A", ...input });
        expect((yield* as({ body: { v: 1, op: "probe.unavailable" } })).json).toEqual({
          v: 1,
          status: "unavailable",
          code: "XC6_PROBE_UNAVAILABLE",
        });
        const forged = yield* as({
          body: { v: 1, op: "probe.whoami", callerSessionId: "session-B" },
        });
        expect(forged.status).toBe(400);
        expect(forged.json).toEqual({ v: 1, status: "refused", code: "XC6_BAD_REQUEST" });
        expect((yield* as({ body: { v: 1, op: "board.write" } })).status).toBe(404);
        expect((yield* as({ raw: "{not json" })).status).toBe(400);
        const big = yield* as({
          raw: JSON.stringify({
            v: 1,
            op: "probe.echo-digest",
            args: { text: "x".repeat(70_000) },
          }),
        });
        expect(big.status).toBe(413);
        expect(big.json).toEqual({ v: 1, status: "refused", code: "XC6_TOO_LARGE" });
      }),
    ).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true }))),
    );
  },
);
