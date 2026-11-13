// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 26 / step 29, fork-side case 3 (the ws half) — a REAL HTTP request to T3's own `/ws` route (ws.ts `Ws.layer`) that declares the Backend digest it
// expects is refused with 409 before any authentication, in front of the real Backend composition (the digest `prepareAetheriaBackend` validates).
//
// Why this file exists. connectionGate.aetheria.test.ts calls the gate function and reads ws.ts by eye (its header says so); the XC-6 header half, for every orchestration operation, is
// tests/orchestration/matrix/route.test.mjs ("route: the Backend digest the peer declares must be present, well formed and equal, and a refusal precedes the body"), on T3's real route.
// Neither runs the ws route itself. This one does: the real `Ws.layer` on a loopback HTTP server, its collaborators the handler never reaches before the gate answered
// (browser, self-update, pull requests, peer links, SQL) mocked, and NO credential on any request, so a 409 can only come from a gate that runs before authentication.
//
// Shows: a wrong, malformed or repeated declaration is 409 with the gate's safe body; a declaration against a server with no Backend composition is 409 ABSENT; a matching
// declaration and a request that declares nothing are not refused by the gate (they go on to authentication, which has no credential here and answers something other than 409).
// Does NOT show a WebSocket upgrade completing, the RPC surface behind it, or a built server. Side: harness-only. Provider tier: none. Linux: not run.
//
// Negative control: M05_FORK_NEGATIVE=no-declare makes the "wrong digest" request omit its declaration; that test must then fail (it would be passing through the gate).
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { prepareAetheriaBackend } from "@t3tools/aetheria-server";
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpRouter } from "effect/http";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSelfUpdate from "../../cloud/selfUpdate.ts";
import * as PeerLinkRequests from "../../peer/PeerLinkRequests.ts";
import * as PeerLinks from "../../peer/PeerLinks.ts";
import * as ServerBrowser from "../../preview/ServerBrowser.ts";
import * as PullRequestReviewGuideService from "../../pullRequest/PullRequestReviewGuideService.ts";
import * as PullRequestService from "../../pullRequest/PullRequestService.ts";
import * as Ws from "../../ws.ts";
import { layerFromBackend } from "../backendComposition.ts";
import { EXPECTED_BACKEND_DIGEST_QUERY } from "../backendDigest.ts";

const NEGATIVE = process.env.M05_FORK_NEGATIVE ?? "";

const prepared = prepareAetheriaBackend();
if (prepared.outcome === "refused") throw new Error("the Backend composition must prepare");
const composition = layerFromBackend(prepared.backend);
const actual = prepared.backend.status().digest.value;
const wrong = `sha256:${"0".repeat(64)}`;

// Everything `Ws.layer` reads when it is built. The handler returns before using any of them for a refused connection.
const collaborators = Layer.mergeAll(
  Layer.mock(ServerBrowser.ServerBrowser)({}),
  Layer.mock(ServerSelfUpdate.ServerSelfUpdate)({}),
  Layer.mock(PullRequestService.PullRequestService)({}),
  Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
  Layer.mock(PeerLinks.PeerLinks)({}),
  Layer.mock(PeerLinkRequests.PeerLinkRequests)({}),
  Layer.succeed(SqlClient.SqlClient, {} as never),
);

/** One GET to `/ws` on a loopback server running the real ws route, with or without the Backend composition. */
const getWs = (withComposition: boolean, declared: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const route = Ws.layer.pipe(
        Layer.provide(collaborators as never),
        Layer.provide((withComposition ? composition : Layer.empty) as never),
      ) as unknown as Layer.Layer<never>;
      yield* HttpRouter.serve(route, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const http = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({
        [ORCHESTRATION_PROTOCOL_QUERY_PARAM]: String(ORCHESTRATION_PROTOCOL_VERSION),
      });
      for (const value of declared) query.append(EXPECTED_BACKEND_DIGEST_QUERY, value);
      const response = yield* http.get(`/ws?${query.toString()}`);
      const text = yield* response.text;
      let json: Record<string, unknown> | undefined;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = undefined;
      }
      return { status: response.status, json, text };
    }).pipe(Effect.provide(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))),
  );

it.effect(
  "a declared digest that differs from the Backend's is 409 MISMATCH on the real ws route, before any authentication, naming only digest facts",
  () =>
    Effect.gen(function* () {
      const reply = yield* getWs(true, NEGATIVE === "no-declare" ? [] : [wrong]);
      expect(reply.status).toBe(409);
      expect(reply.json).toMatchObject({
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        actualDigest: { version: 1, algorithm: "sha256", value: actual },
        expectedDigest: { value: wrong },
      });
      expect(Object.keys(reply.json ?? {}).sort()).toEqual([
        "actualDigest",
        "code",
        "expectedDigest",
        "message",
      ]);
    }),
);

it.effect("a malformed or a repeated declaration is refused too (409), never first-wins", () =>
  Effect.gen(function* () {
    const malformed = yield* getWs(true, ["sha256:short"]);
    expect(malformed.status).toBe(409);
    expect(malformed.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MALFORMED" });
    const repeated = yield* getWs(true, [actual, wrong]);
    expect(repeated.status).toBe(409);
    expect(repeated.json).toMatchObject({ code: "AETHERIA_BACKEND_DIGEST_MALFORMED" });
  }),
);

it.effect(
  "a server with no Backend composition refuses a client that declares an expectation (409 ABSENT) and does not report an actual digest",
  () =>
    Effect.gen(function* () {
      const reply = yield* getWs(false, [actual]);
      expect(reply.status).toBe(409);
      expect(reply.json).toMatchObject({
        code: "AETHERIA_BACKEND_DIGEST_ABSENT",
        expectedDigest: { value: actual },
      });
      expect(reply.json).not.toHaveProperty("actualDigest");
    }),
);

it.effect(
  "the contrast: a matching declaration and a client that declares nothing are NOT refused by the gate (they reach authentication, which has no credential here)",
  () =>
    Effect.gen(function* () {
      const matching = yield* getWs(true, [actual]);
      const silent = yield* getWs(true, []);
      for (const reply of [matching, silent]) {
        expect(reply.status).not.toBe(409);
        expect(String(reply.json?.code ?? "")).not.toMatch(/^AETHERIA_BACKEND_DIGEST/);
      }
    }),
);
