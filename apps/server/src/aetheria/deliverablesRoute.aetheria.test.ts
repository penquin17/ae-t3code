// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 14 (D7, D11, D12, R3, R8, XC-20; IP-50) — the authenticated download route, over T3's REAL `EnvironmentAuth` (an in-memory session store: real issue, verify, revoke and
// expiry) and a real loopback HTTP server, with the REAL declaration store, real files in temporary folders, and a FAKE snapshot store, thread index, access rule and board read.
//
// It shows: authentication on EVERY request, before anything about an id is answered (a missing, forged, revoked or expired credential is 401, a revoked one only after it had worked); the
// credential is the Bearer header or T3's own session cookie from the app's own origin (a token in the query is no credential, and T3 refuses a cookie from another origin); `filesystem:read` is checked by the route itself (orchestration scopes do not admit it);
// a declaration or offered path of another root, an unknown id and a thread the connection may not reach all answer the same 404; bytes come from the attached snapshot for `as-delivered` (pending,
// unavailable, missing and mismatching snapshots are refusals that say so, and the stream is always closed) and from the file for `current` (symlink, directory, deleted, replaced parent, outside
// the root, replaced or changed during the read, and over the cap are refusals); offered edit paths are served only when the board still offers them; headers are attachment-only with a sanitised
// name; and no credential appears in any URL, response or log.
// It does NOT show a separate-origin browser download (steps 21 and 25), the web client, or the assembled Backend's own snapshot store.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";

import { NodeHttpServer } from "@effect/platform-node";
import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DELIVERABLE_DOWNLOAD_PATH,
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
} from "@t3tools/aetheria-contracts";
import {
  createDeliverablesStore,
  type DeliverablesCaller,
  type EditsRead,
} from "@t3tools/aetheria-server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import { HttpClient, HttpRouter } from "effect/http";
import { afterEach, describe, expect } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { offeredIdOf } from "./deliverablesRpc.ts";
import { routeLayer } from "./deliverablesRoute.ts";

const FS_READ = "filesystem:read" as const;
const ORCH_READ = "orchestration:read" as const;
const sha = (data: string | Buffer) =>
  `sha256:${NodeCrypto.createHash("sha256").update(data).digest("hex")}`;

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0))
    NodeFS.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});
const tmp = (prefix: string): string => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix)));
  created.push(dir);
  return dir;
};

const ROOT_A: DeliverablesCaller = { sessionId: "pi-a", rootSessionId: "pi-a", kind: "main" };
const KID: DeliverablesCaller = { sessionId: "pi-kid", rootSessionId: "pi-a", kind: "child" };
const OTHER: DeliverablesCaller = {
  sessionId: "pi-other",
  rootSessionId: "pi-other",
  kind: "main",
};

interface WorldOptions {
  readonly denied?: ReadonlyArray<string>;
  readonly edits?: (workspace: string) => EditsRead;
  readonly noStore?: boolean;
  readonly snapshotMode?: "ok" | "unavailable";
}

/** One world: a working folder, a real declaration store over it, and the fakes the route reaches the Backend through. */
function world(options: WorldOptions = {}) {
  const stateRoot = tmp("m10-route-state-");
  const work = tmp("m10-route-work-");
  const kidWork = tmp("m10-route-kid-");
  const outside = tmp("m10-route-outside-");
  const folderOf: Record<string, string> = { "pi-a": work, "pi-kid": kidWork, "pi-other": work };
  const snapshots = new Map<string, { bytes: Buffer; digest: string }>();
  const state = { destroyed: 0, opened: 0 };
  const calls: string[] = [];
  let runFolder = work;
  const store: ReturnType<typeof createDeliverablesStore> = createDeliverablesStore({
    stateRoot,
    callerContext: async (sessionId) => ({
      ok: true,
      threadId: `t-${sessionId}`,
      runId: "run-1",
      nodeId: "n-1",
      workingFolder: sessionId === "pi-kid" ? kidWork : runFolder,
    }),
    openSnapshot: async (session, id) => {
      const found = snapshots.get(`${session}|${id}`);
      if (found === undefined) return { ok: false, code: "ATTACHMENT_MISSING" };
      return {
        ok: true,
        digest: found.digest,
        size: found.bytes.length,
        stream: { destroy: () => {} },
      };
    },
  });
  const openSnapshot = async (session: string, id: string) => {
    state.opened += 1;
    calls.push("openSnapshot");
    if (options.snapshotMode === "unavailable") return { ok: false as const, code: "unavailable" };
    const found = snapshots.get(`${session}|${id}`);
    if (found === undefined) return { ok: false as const, code: "ATTACHMENT_MISSING" };
    const stream = NodeStream.Readable.from([found.bytes]);
    stream.on("close", () => {
      state.destroyed += 1;
    });
    return {
      ok: true as const,
      snapshotId: id,
      digest: found.digest,
      size: found.bytes.length,
      stream,
    };
  };
  const bindings = {
    "t-a": { sessionId: "pi-a", subagent: false },
    "t-kid": { sessionId: "pi-kid", subagent: null },
    "t-other": { sessionId: "pi-other", subagent: false },
  } as const;
  const backend = Option.some({
    deliverables: () => (options.noStore === true ? undefined : store),
    interactions: () => ({
      canAccess: async (_actor: unknown, target: { sessionId: string; rootSessionId: string }) => {
        calls.push(`canAccess:${target.sessionId}:${target.rootSessionId}`);
        return !(options.denied ?? []).some(
          (id) => id === target.sessionId || id === target.rootSessionId,
        );
      },
    }),
    index: {
      lookup: (threadId: string) => {
        calls.push(`lookup:${threadId}`);
        const found = (bindings as Record<string, { sessionId: string; subagent: boolean | null }>)[
          threadId
        ];
        return found === undefined
          ? { status: "absent" }
          : {
              status: "ok",
              binding: { threadId, ...found, workingFolder: folderOf[found.sessionId] },
            };
      },
      bindingOfSession: (sessionId: string) => {
        calls.push(`bindingOfSession:${sessionId}`);
        const folder = folderOf[sessionId];
        return folder === undefined
          ? undefined
          : { threadId: `t-${sessionId.slice(3)}`, sessionId, workingFolder: folder };
      },
    },
    identityKind: (sessionId: string) => (sessionId === "pi-kid" ? "child" : "not-child"),
    board: {
      editsOf: async (root: string) => {
        calls.push(`editsOf:${root}`);
        return options.edits?.(work) ?? ({ status: "unknown", reason: "no-record" } as EditsRead);
      },
    },
    openSnapshot,
  });
  const write = (name: string, content: string | Buffer, root = work): string => {
    const path = NodePath.join(root, name);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, content);
    return path;
  };
  /** Declare a file and (optionally) attach a snapshot of its present bytes; the id the route is asked for. */
  const declare = async (
    who: DeliverablesCaller,
    name: string,
    content: string | Buffer,
    attach: "snapshot" | "pending" | "unavailable" | "snapshot-other-bytes" = "snapshot",
    root = work,
  ) => {
    const path = write(name, content, root);
    const out = await store.declare(who, { requestId: `req-${sha(name).slice(7, 31)}`, path });
    if (out.status !== "done" || !out.result.ok)
      throw new Error(`declare failed: ${JSON.stringify(out)}`);
    const id = out.result.declaration.id;
    if (attach === "snapshot" || attach === "snapshot-other-bytes") {
      const snapshotId = `snap_${sha(`${name}|${attach}`).slice(7)}`;
      snapshots.set(`${who.sessionId}|${snapshotId}`, {
        bytes:
          attach === "snapshot"
            ? Buffer.from(content)
            : Buffer.alloc(Buffer.from(content).length, 0x58),
        digest: sha(content),
      });
      await store.attachSnapshot(who, { declarationId: id, snapshotId });
    } else if (attach === "unavailable") {
      await store.attachSnapshot(who, { declarationId: id, unavailable: "SNAPSHOT_CHANGED" });
    }
    return { id, path };
  };
  return {
    stateRoot,
    work,
    kidWork,
    outside,
    backend: backend as never,
    store,
    declare,
    write,
    snapshots,
    state,
    calls,
    setRunFolder: (folder: string) => {
      runFolder = folder;
    },
  };
}

// The real authentication (an in-memory session store) and a real loopback server.
const layerServerConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return { ...config, port: 13_774 } satisfies ServerConfig.ServerConfig["Service"];
  }),
).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-route-auth-test-" })));
const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(layerServerConfig),
);
const layerBase = layerAuth.pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodePlatformCrypto.layer)),
);

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bytes: Buffer;
  readonly text: string;
  readonly json: any;
}

/** Runs `body` against the route over the given world. `seen` collects every URL, header and body, for the no-credential check. */
const withRoute = <A, E>(
  w: ReturnType<typeof world>,
  routeOptions: Parameters<typeof routeLayer>[1],
  body: (ctx: {
    get: (pathAndQuery: string, headers?: Record<string, string>) => Effect.Effect<Reply, any, any>;
    issue: (
      scopes: ReadonlyArray<string>,
      ttl?: Duration.Duration,
      method?: "bearer-access-token" | "browser-session-cookie",
    ) => Effect.Effect<{ token: string; sessionId: string }, any, any>;
    revoke: (sessionId: string) => Effect.Effect<void, any, any>;
    bearer: (token: string) => Record<string, string>;
    cookie: (token: string, origin?: string) => Record<string, string>;
    seen: string[];
    logs: string[];
  }) => Effect.Effect<A, E, any>,
) => {
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => logs.push(JSON.stringify(message)));
  return Effect.scoped(
    Effect.gen(function* () {
      yield* HttpRouter.serve(routeLayer(w.backend, routeOptions), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const http = yield* HttpClient.HttpClient;
      const sessions = yield* SessionStore.SessionStore;
      const seen: string[] = [];
      const get = (pathAndQuery: string, headers: Record<string, string> = {}) =>
        Effect.gen(function* () {
          seen.push(pathAndQuery);
          const response = yield* http.get(pathAndQuery, { headers });
          const bytes = Buffer.from(yield* response.arrayBuffer);
          const text = bytes.toString("utf8");
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          const reply: Reply = {
            status: response.status,
            headers: { ...(response.headers as Record<string, string>) },
            bytes,
            text,
            json,
          };
          seen.push(JSON.stringify(reply.headers), reply.json === undefined ? "" : text);
          return reply;
        });
      const issue = (
        scopes: ReadonlyArray<string>,
        ttl?: Duration.Duration,
        method: "bearer-access-token" | "browser-session-cookie" = "bearer-access-token",
      ) =>
        sessions
          .issue({
            scopes: scopes as never,
            method,
            subject: "device",
            ...(ttl === undefined ? {} : { ttl }),
          })
          .pipe(Effect.map((issued) => ({ token: issued.token, sessionId: issued.sessionId })));
      const revoke = (sessionId: string) => sessions.revoke(sessionId as never);
      const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
      /** T3's own browser session as a same-origin page sends it: the session cookie, and the origin the app was served from. */
      const cookie = (token: string, origin?: string) => ({
        cookie: `${sessions.cookieName}=${token}`,
        ...(origin === undefined
          ? {}
          : { origin, "sec-fetch-site": origin === SAME_ORIGIN ? "same-origin" : "cross-site" }),
      });
      return yield* body({ get, issue, revoke, bearer, cookie, seen, logs });
    }),
  ).pipe(
    Effect.provide(
      layerBase.pipe(Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false }))),
    ),
  );
};

const ok = (reply: Reply, expected: string | Buffer) => {
  expect(reply.status).toBe(200);
  expect(reply.bytes.equals(Buffer.from(expected))).toBe(true);
};
const refused = (reply: Reply, code: keyof typeof DELIVERABLE_DOWNLOAD_REFUSAL_STATUS) => {
  expect(reply.json).toMatchObject({ ok: false, code });
  expect(reply.status).toBe(DELIVERABLE_DOWNLOAD_REFUSAL_STATUS[code]);
  // A refusal never carries file bytes: only the coded JSON.
  expect(Object.keys(reply.json).sort()).toEqual(["code", "detail", "ok"]);
};
const url = (id: string, query = "") => `${DELIVERABLE_DOWNLOAD_PATH}/${id}${query}`;
const unknownId = `dlv_${"0".repeat(32)}`;
/** The origin the test server is served from, as a page there would name it (the loopback server's host). */
const SAME_ORIGIN = "http://127.0.0.1:13774";

describe("authentication on every request", () => {
  it.live("answers 401 before anything about the id is looked at, with no Backend call", () => {
    const w = world();
    return withRoute(w, undefined, ({ get, issue, bearer }) =>
      Effect.gen(function* () {
        const none = yield* get(url(unknownId));
        refused(none, "DOWNLOAD_BEARER_REQUIRED");
        const forged = yield* get(url(unknownId), bearer("not-a-session-token"));
        refused(forged, "DOWNLOAD_UNAUTHENTICATED");
        const { token } = yield* issue([FS_READ]);
        // A credential in the query is no credential, whatever the names it goes by.
        refused(
          yield* get(url(unknownId, `?access_token=${token}&token=${token}`)),
          "DOWNLOAD_BEARER_REQUIRED",
        );
        expect(w.calls).toEqual([]);
      }),
    );
  });

  it.live(
    "accepts T3's own signed-in session from the app's own origin, with filesystem:read, and refuses it otherwise",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, revoke, bearer, cookie }) =>
        Effect.gen(function* () {
          const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
          const session = yield* issue([FS_READ], undefined, "browser-session-cookie");
          // Same origin: with no Origin header (a plain navigation or fetch) and with the app's own origin.
          ok(yield* get(url(id), cookie(session.token)), "alpha");
          ok(yield* get(url(id), cookie(session.token, SAME_ORIGIN)), "alpha");
          // A cookie is not enough when the scope is missing: the route's own check still runs.
          const narrow = yield* issue([ORCH_READ], undefined, "browser-session-cookie");
          refused(
            yield* get(url(id), cookie(narrow.token, SAME_ORIGIN)),
            "DOWNLOAD_NOT_AUTHORIZED",
          );
          // T3 refuses a cookie from another origin: the route inherits that, so a page elsewhere cannot download with the user's session.
          w.calls.length = 0;
          refused(
            yield* get(url(id), cookie(session.token, "https://evil.example")),
            "DOWNLOAD_UNAUTHENTICATED",
          );
          expect(w.calls).toEqual([]);
          // The session is re-read on every request: a revoked cookie session is refused on the next one.
          yield* revoke(session.sessionId);
          refused(
            yield* get(url(id), cookie(session.token, SAME_ORIGIN)),
            "DOWNLOAD_UNAUTHENTICATED",
          );
          // Bearer is unchanged: it still works with no cookie and no origin.
          const device = yield* issue([FS_READ]);
          ok(yield* get(url(id), bearer(device.token)), "alpha");
        }),
      );
    },
  );

  it.live(
    "a query credential is refused even beside a session that has no credential of its own",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue }) =>
        Effect.gen(function* () {
          const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
          const { token } = yield* issue([FS_READ], undefined, "browser-session-cookie");
          refused(yield* get(url(id, `?access_token=${token}`)), "DOWNLOAD_BEARER_REQUIRED");
          refused(yield* get(url(id, `?token=${token}`)), "DOWNLOAD_BEARER_REQUIRED");
          expect(w.calls).toEqual([]);
        }),
      );
    },
  );

  it.live("a credential that worked is refused once revoked, on the very next request", () => {
    const w = world();
    return withRoute(w, undefined, ({ get, issue, revoke, bearer }) =>
      Effect.gen(function* () {
        const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
        const { token, sessionId } = yield* issue([FS_READ]);
        ok(yield* get(url(id), bearer(token)), "alpha");
        yield* revoke(sessionId);
        refused(yield* get(url(id), bearer(token)), "DOWNLOAD_UNAUTHENTICATED");
      }),
    );
  });

  it.live("an expired credential is refused", () => {
    const w = world();
    return withRoute(w, undefined, ({ get, issue, bearer }) =>
      Effect.gen(function* () {
        const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
        // A credential whose lifetime has already run out: the session store signs an expiry equal to its issue time.
        const { token } = yield* issue([FS_READ], Duration.zero);
        refused(yield* get(url(id), bearer(token)), "DOWNLOAD_UNAUTHENTICATED");
      }),
    );
  });

  it.live(
    "filesystem:read is the route's own scope check: orchestration scopes do not admit it",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
          for (const scopes of [
            [ORCH_READ],
            ["orchestration:operate", ORCH_READ],
            ["terminal:read"],
            [],
          ]) {
            const { token } = yield* issue(scopes);
            refused(yield* get(url(id), bearer(token)), "DOWNLOAD_NOT_AUTHORIZED");
          }
          // The same token with the scope is served: the refusal was the scope alone.
          const { token } = yield* issue([FS_READ]);
          ok(yield* get(url(id), bearer(token)), "alpha");
          expect(w.calls.some((call) => call.startsWith("openSnapshot"))).toBe(false);
        }),
      );
    },
  );
});

describe("which declaration a connection may reach", () => {
  it.live(
    "an unknown id, another root's declaration and a root the connection may not reach all answer the same 404",
    () => {
      const w = world({ denied: ["pi-other"] });
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const mine = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
          const theirs = yield* Effect.promise(() => w.declare(OTHER, "o.txt", "other"));
          const { token } = yield* issue([FS_READ]);
          const a = yield* get(url(unknownId), bearer(token));
          const b = yield* get(url(theirs.id), bearer(token));
          const malformed = yield* get(url("dlv_nope"), bearer(token));
          const traversal = yield* get(
            `${DELIVERABLE_DOWNLOAD_PATH}/..%2F..%2Fetc%2Fpasswd`,
            bearer(token),
          );
          refused(a, "DOWNLOAD_NOT_FOUND");
          refused(b, "DOWNLOAD_NOT_FOUND");
          refused(malformed, "DOWNLOAD_NOT_FOUND");
          refused(traversal, "DOWNLOAD_NOT_FOUND");
          expect(b.text).toBe(a.text);
          // The reachable one is served; no bytes of the other leaked.
          ok(yield* get(url(mine.id), bearer(token)), "alpha");
          expect(b.text).not.toContain("other");
        }),
      );
    },
  );

  it.live(
    "a child's declaration is served under its root, from the child's own working folder",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const kid = yield* Effect.promise(() =>
            w.declare(KID, "k.txt", "kid file", "snapshot", w.kidWork),
          );
          const { token } = yield* issue([FS_READ]);
          ok(yield* get(url(kid.id), bearer(token)), "kid file");
          ok(yield* get(url(kid.id, "?semantics=as-delivered"), bearer(token)), "kid file");
          // The access rule was asked about the declaring session under its root.
          expect(w.calls).toContain("canAccess:pi-kid:pi-a");
        }),
      );
    },
  );

  it.live("a store that is not running is 503 after authentication, never a 404", () => {
    const w = world({ noStore: true });
    return withRoute(w, undefined, ({ get, issue, bearer }) =>
      Effect.gen(function* () {
        const { token } = yield* issue([FS_READ]);
        refused(yield* get(url(unknownId), bearer(token)), "DOWNLOAD_UNAVAILABLE");
      }),
    );
  });
});

describe("as-delivered bytes come only from the attached snapshot", () => {
  it.live(
    "serves the snapshot's bytes after the file changed, closes the stream, and states the digest",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { id, path } = yield* Effect.promise(() =>
            w.declare(ROOT_A, "report.pdf", "version one"),
          );
          const { token } = yield* issue([FS_READ]);
          NodeFS.writeFileSync(path, "version two, longer");
          const delivered = yield* get(url(id, "?semantics=as-delivered"), bearer(token));
          ok(delivered, "version one");
          expect(delivered.headers["x-aetheria-digest"]).toBe(sha("version one"));
          expect(delivered.headers["content-type"]).toBe("application/pdf");
          expect(w.state.destroyed).toBe(1);
          const current = yield* get(url(id), bearer(token));
          ok(current, "version two, longer");
          expect(current.headers["x-aetheria-digest"]).toBe(sha("version two, longer"));
          expect(current.headers["x-aetheria-digest"]).not.toBe(
            delivered.headers["x-aetheria-digest"],
          );
        }),
      );
    },
  );

  it.live(
    "a pending snapshot, an unavailable one, a missing one and an unavailable store are refusals that say so, and close nothing left open",
    () => {
      const w = world();
      const down = world({ snapshotMode: "unavailable" });
      return Effect.gen(function* () {
        yield* withRoute(w, undefined, ({ get, issue, bearer }) =>
          Effect.gen(function* () {
            const pending = yield* Effect.promise(() => w.declare(ROOT_A, "p.txt", "p", "pending"));
            const gone = yield* Effect.promise(() =>
              w.declare(ROOT_A, "u.txt", "u", "unavailable"),
            );
            const lost = yield* Effect.promise(() => w.declare(ROOT_A, "l.txt", "l"));
            w.snapshots.clear();
            const { token } = yield* issue([FS_READ]);
            const q = "?semantics=as-delivered";
            const p = yield* get(url(pending.id, q), bearer(token));
            refused(p, "DOWNLOAD_SNAPSHOT_PENDING");
            const u = yield* get(url(gone.id, q), bearer(token));
            refused(u, "DOWNLOAD_SNAPSHOT_UNAVAILABLE");
            expect(u.json.detail).toContain("SNAPSHOT_CHANGED");
            refused(yield* get(url(lost.id, q), bearer(token)), "DOWNLOAD_SNAPSHOT_MISSING");
            // The current file is still served for each: the refusal is the snapshot's, not the card's.
            ok(yield* get(url(pending.id), bearer(token)), "p");
          }),
        );
        yield* withRoute(down, undefined, ({ get, issue, bearer }) =>
          Effect.gen(function* () {
            const d = yield* Effect.promise(() => down.declare(ROOT_A, "d.txt", "d"));
            const { token } = yield* issue([FS_READ]);
            refused(
              yield* get(url(d.id, "?semantics=as-delivered"), bearer(token)),
              "DOWNLOAD_UNAVAILABLE",
            );
          }),
        );
      });
    },
  );

  it.live(
    "bytes whose digest is not the declared one are refused, never sent, and the stream is closed",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { id } = yield* Effect.promise(() =>
            w.declare(ROOT_A, "m.txt", "declared bytes", "snapshot-other-bytes"),
          );
          const { token } = yield* issue([FS_READ]);
          const reply = yield* get(url(id, "?semantics=as-delivered"), bearer(token));
          refused(reply, "DOWNLOAD_SNAPSHOT_MISMATCH");
          expect(reply.text).not.toContain("XXXX");
          expect(w.state.destroyed).toBe(w.state.opened);
        }),
      );
    },
  );
});

describe("current bytes are judged again at the moment of the read", () => {
  it.live(
    "refuses a symlink in the file's place (to a file outside the root), a directory, a deleted file and a replaced parent folder",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const secret = NodePath.join(w.outside, "secret.txt");
          NodeFS.writeFileSync(secret, "TOP SECRET");
          const { token } = yield* issue([FS_READ]);
          const a = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
          NodeFS.rmSync(a.path);
          NodeFS.symlinkSync(secret, a.path);
          const swapped = yield* get(url(a.id), bearer(token));
          refused(swapped, "DOWNLOAD_FILE_NOT_REGULAR");
          expect(swapped.text).not.toContain("TOP SECRET");

          const d = yield* Effect.promise(() => w.declare(ROOT_A, "d.txt", "dir"));
          NodeFS.rmSync(d.path);
          NodeFS.mkdirSync(d.path);
          refused(yield* get(url(d.id), bearer(token)), "DOWNLOAD_FILE_NOT_REGULAR");

          const gone = yield* Effect.promise(() => w.declare(ROOT_A, "g.txt", "gone"));
          NodeFS.rmSync(gone.path);
          refused(yield* get(url(gone.id), bearer(token)), "DOWNLOAD_FILE_MISSING");
          // The snapshot is still served: the card keeps its as-delivered bytes.
          ok(yield* get(url(gone.id, "?semantics=as-delivered"), bearer(token)), "gone");

          // A folder of the path replaced by a link to another folder that holds the same name.
          const sub = yield* Effect.promise(() => w.declare(ROOT_A, "sub/n.txt", "nested"));
          NodeFS.writeFileSync(NodePath.join(w.outside, "n.txt"), "OUTSIDE NESTED");
          NodeFS.rmSync(NodePath.join(w.work, "sub"), { recursive: true });
          NodeFS.symlinkSync(w.outside, NodePath.join(w.work, "sub"));
          const moved = yield* get(url(sub.id), bearer(token));
          expect(moved.status).toBe(409);
          expect(["DOWNLOAD_FILE_OUTSIDE_ROOT", "DOWNLOAD_FILE_CHANGED"]).toContain(
            moved.json.code,
          );
          expect(moved.text).not.toContain("OUTSIDE NESTED");
        }),
      );
    },
  );

  it.live("a file replaced or changed after it was opened is refused, never sent half-way", () => {
    const w = world();
    let step = 0;
    const hook = (path: string) => () => {
      step += 1;
      if (step === 1) {
        // The file is replaced by another one (a new inode) after it was opened.
        NodeFS.writeFileSync(`${path}.new`, "replacement bytes");
        NodeFS.renameSync(`${path}.new`, path);
      } else {
        NodeFS.appendFileSync(path, " and more");
      }
    };
    return Effect.gen(function* () {
      const a = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
      yield* withRoute(w, { afterOpen: hook(a.path) }, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { token } = yield* issue([FS_READ]);
          const replaced = yield* get(url(a.id), bearer(token));
          refused(replaced, "DOWNLOAD_FILE_CHANGED");
          expect(replaced.text).not.toContain("replacement bytes");
          const grown = yield* get(url(a.id), bearer(token));
          refused(grown, "DOWNLOAD_FILE_CHANGED");
        }),
      );
    });
  });

  it.live("refuses a file over the size cap, current or snapshot, before sending a byte", () => {
    const w = world();
    return Effect.gen(function* () {
      const big = yield* Effect.promise(() => w.declare(ROOT_A, "big.bin", Buffer.alloc(2048, 1)));
      const small = yield* Effect.promise(() => w.declare(ROOT_A, "s.txt", "tiny"));
      yield* withRoute(w, { maxBytes: 1024 }, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { token } = yield* issue([FS_READ]);
          const cur = yield* get(url(big.id), bearer(token));
          refused(cur, "DOWNLOAD_TOO_LARGE");
          refused(
            yield* get(url(big.id, "?semantics=as-delivered"), bearer(token)),
            "DOWNLOAD_TOO_LARGE",
          );
          ok(yield* get(url(small.id), bearer(token)), "tiny");
          expect(w.state.destroyed).toBe(w.state.opened);
        }),
      );
    });
  });

  it.live("a file the process cannot read is refused as unreadable", () => {
    const w = world();
    return withRoute(w, undefined, ({ get, issue, bearer }) =>
      Effect.gen(function* () {
        const a = yield* Effect.promise(() => w.declare(ROOT_A, "r.txt", "readable once"));
        NodeFS.chmodSync(a.path, 0o000);
        const { token } = yield* issue([FS_READ]);
        const reply = yield* get(url(a.id), bearer(token));
        NodeFS.chmodSync(a.path, 0o600);
        if (process.getuid?.() === 0) return;
        refused(reply, "DOWNLOAD_FILE_UNREADABLE");
      }),
    );
  });
});

describe("offered edit paths", () => {
  it.live(
    "serves a path the board still offers, current bytes only, under the root's thread",
    () => {
      const w = world({
        edits: (work) => ({
          status: "known",
          workspace: work,
          paths: [NodePath.join(work, "edited.txt"), NodePath.join(work, "gone.txt")],
        }),
      });
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          w.write("edited.txt", "edited bytes");
          const { token } = yield* issue([FS_READ]);
          const id = offeredIdOf("pi-a", NodePath.join(w.work, "edited.txt"));
          const reply = yield* get(url(id, "?root=t-a"), bearer(token));
          ok(reply, "edited bytes");
          expect(reply.headers["content-disposition"]).toMatch(/^attachment;/);
          // Not offered (never recorded), or offered but missing now.
          const unoffered = offeredIdOf("pi-a", NodePath.join(w.work, "other.txt"));
          refused(yield* get(url(unoffered, "?root=t-a"), bearer(token)), "DOWNLOAD_NOT_FOUND");
          const gone = offeredIdOf("pi-a", NodePath.join(w.work, "gone.txt"));
          refused(yield* get(url(gone, "?root=t-a"), bearer(token)), "DOWNLOAD_FILE_MISSING");
          // The id belongs to its root: another root's thread does not find it.
          refused(yield* get(url(id, "?root=t-other"), bearer(token)), "DOWNLOAD_NOT_FOUND");
          // A client cannot nominate a path: only an id the board's list yields is served.
          refused(
            yield* get(url(offeredIdOf("pi-a", "/etc/passwd"), "?root=t-a"), bearer(token)),
            "DOWNLOAD_NOT_FOUND",
          );
        }),
      );
    },
  );

  it.live(
    "needs the root, refuses as-delivered, an unreachable root, and a board that knows nothing or cannot answer",
    () => {
      const id = offeredIdOf("pi-a", "/x/edited.txt");
      const states: ReadonlyArray<
        [WorldOptions, string, keyof typeof DELIVERABLE_DOWNLOAD_REFUSAL_STATUS]
      > = [
        [{}, "", "DOWNLOAD_BAD_REQUEST"],
        [{}, "?root=t-a&semantics=as-delivered", "DOWNLOAD_BAD_REQUEST"],
        [{}, "?root=t-nobody", "DOWNLOAD_NOT_FOUND"],
        [{ denied: ["pi-a"] }, "?root=t-a", "DOWNLOAD_NOT_FOUND"],
        [{}, "?root=t-a", "DOWNLOAD_OFFERED_UNKNOWN"],
        [
          { edits: () => ({ status: "unavailable", detail: "board down" }) },
          "?root=t-a",
          "DOWNLOAD_UNAVAILABLE",
        ],
      ];
      return Effect.gen(function* () {
        for (const [options, query, code] of states) {
          const w = world(options);
          yield* withRoute(w, undefined, ({ get, issue, bearer }) =>
            Effect.gen(function* () {
              const { token } = yield* issue([FS_READ]);
              refused(yield* get(url(id, query), bearer(token)), code);
            }),
          );
        }
      });
    },
  );

  it.live(
    "a path outside the board's workspace, a symlink and a directory are refused even when offered",
    () => {
      const w = world();
      return Effect.gen(function* () {
        const inside = NodePath.join(w.work, "inside.txt");
        const link = NodePath.join(w.work, "link.txt");
        const dir = NodePath.join(w.work, "folder");
        const outsideFile = NodePath.join(w.outside, "o.txt");
        NodeFS.writeFileSync(outsideFile, "outside-bytes");
        NodeFS.symlinkSync(outsideFile, link);
        NodeFS.mkdirSync(dir);
        const offered = world({
          edits: () => ({
            status: "known",
            workspace: w.work,
            paths: [outsideFile, link, dir, inside],
          }),
        });
        const check = (path: string, code: keyof typeof DELIVERABLE_DOWNLOAD_REFUSAL_STATUS) =>
          withRoute(offered, undefined, ({ get, issue, bearer }) =>
            Effect.gen(function* () {
              const { token } = yield* issue([FS_READ]);
              const reply = yield* get(url(offeredIdOf("pi-a", path), "?root=t-a"), bearer(token));
              refused(reply, code);
              expect(reply.text).not.toContain("outside-bytes");
            }),
          );
        yield* check(outsideFile, "DOWNLOAD_FILE_OUTSIDE_ROOT");
        yield* check(link, "DOWNLOAD_FILE_NOT_REGULAR");
        yield* check(dir, "DOWNLOAD_FILE_NOT_REGULAR");
      });
    },
  );
});

describe("response headers", () => {
  it.live(
    "are attachment-only, never cacheable, typed by extension, with a sanitised file name",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { token } = yield* issue([FS_READ]);
          const cases: ReadonlyArray<[string, string]> = [
            ["page.html", "text/html"],
            ["pic.png", "image/png"],
            ["notes.md", "text/markdown"],
            ["data.unknownext", "application/octet-stream"],
          ];
          for (const [name, type] of cases) {
            const { id } = yield* Effect.promise(() => w.declare(ROOT_A, name, "<b>x</b>"));
            const reply = yield* get(url(id), bearer(token));
            expect(reply.status).toBe(200);
            expect(reply.headers["content-type"]).toContain(type);
            expect(reply.headers["content-disposition"]).toMatch(
              /^attachment; filename="[^"\\\r\n]*"/,
            );
            expect(reply.headers["x-content-type-options"]).toBe("nosniff");
            expect(reply.headers["cache-control"]).toContain("no-store");
            expect(reply.headers["content-security-policy"]).toContain("sandbox");
            expect(reply.headers["content-length"]).toBe(String(Buffer.byteLength("<b>x</b>")));
          }
          // A name with a quote, a semicolon, non-ASCII text and a line break cannot break the header.
          const nasty = 'we"ird; na\u00efve\nname.txt';
          const { id } = yield* Effect.promise(() => w.declare(ROOT_A, nasty, "nasty"));
          const reply = yield* get(url(id), bearer(token));
          ok(reply, "nasty");
          const disposition = reply.headers["content-disposition"] ?? "";
          expect(disposition).not.toMatch(/[\r\n]/);
          expect(disposition.startsWith('attachment; filename="')).toBe(true);
          expect(disposition).toContain("filename*=UTF-8''");
          const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
          expect(ascii).toMatch(/^[A-Za-z0-9._ -]+$/);
        }),
      );
    },
  );

  it.live(
    "a success exposes the digest, size and semantics headers to a cross-origin page, and a refusal exposes none",
    () => {
      const w = world();
      return withRoute(w, undefined, ({ get, issue, bearer }) =>
        Effect.gen(function* () {
          const { token } = yield* issue([FS_READ]);
          const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "page.md", "hello"));
          const reply = yield* get(url(id), bearer(token));
          expect(reply.status).toBe(200);
          const exposed = (reply.headers["access-control-expose-headers"] ?? "")
            .split(",")
            .map((name) => name.trim().toLowerCase())
            .toSorted();
          expect(exposed).toEqual(["x-aetheria-digest", "x-aetheria-semantics", "x-aetheria-size"]);
          // Each exposed header is actually sent, so the page can read the digest it was promised.
          for (const name of exposed) expect(reply.headers[name]).toBeDefined();
          const denied = yield* get(url(id), {});
          expect(denied.status).not.toBe(200);
          expect(denied.headers["access-control-expose-headers"]).toBeUndefined();
        }),
      );
    },
  );
});

describe("no credential in any URL, response or log", () => {
  it.live("a token appears only in the Authorization header of the request", () => {
    const w = world({
      edits: (work) => ({
        status: "known",
        workspace: work,
        paths: [NodePath.join(work, "e.txt")],
      }),
    });
    return withRoute(w, undefined, ({ get, issue, revoke, bearer, seen, logs }) =>
      Effect.gen(function* () {
        w.write("e.txt", "e");
        const { id } = yield* Effect.promise(() => w.declare(ROOT_A, "a.txt", "alpha"));
        const good = yield* issue([FS_READ]);
        const bad = yield* issue([ORCH_READ]);
        const dead = yield* issue([FS_READ]);
        yield* revoke(dead.sessionId);
        const off = offeredIdOf("pi-a", NodePath.join(w.work, "e.txt"));
        const requests: ReadonlyArray<[string, Record<string, string>]> = [
          [url(id), bearer(good.token)],
          [url(id, "?semantics=as-delivered"), bearer(good.token)],
          [url(off, "?root=t-a"), bearer(good.token)],
          [url(id), bearer(bad.token)],
          [url(id), bearer(dead.token)],
          [url(unknownId), bearer("forged-token-value")],
          [url(id), {}],
        ];
        for (const [path, headers] of requests) yield* get(path, headers);
        // What the client sent: every URL is free of every token (the headers are logged separately by the harness).
        const urls = requests.map(([path]) => path);
        for (const token of [good.token, bad.token, dead.token, "forged-token-value"]) {
          for (const u of urls) expect(u).not.toContain(token);
          // Nothing the route answered (headers and bodies) or logged repeats a credential.
          for (const entry of seen) expect(entry).not.toContain(token);
          for (const line of logs) expect(line).not.toContain(token);
        }
      }),
    );
  });
});
