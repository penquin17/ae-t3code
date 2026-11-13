// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off globalDate:off
// AETHERIA M10 Plan step 14 (D7, D11, D12, R3, R8, XC-20; IP-50) — the authenticated download route: `GET /api/aetheria/deliverables/<id>[?semantics=current|as-delivered][&root=<rootThreadId>]`.
// It replaces T3's asset URLs for delivered files (disabled by step 15: a credential in the path, no authentication, absolute media escapes).
//
// Authority, in the order the checks run — each before anything about the id is answered, so an unauthenticated caller learns nothing about which ids exist.
//   1. A `Authorization: Bearer` header is required. The credential is read from that header alone: a token in the query or a cookie is no credential (T3's own request authentication would
//      otherwise prefer a cookie). No credential is ever in a URL, a redirect, a response or a log line.
//   2. `EnvironmentAuth.authenticateHttpRequest` runs on EVERY request. It re-reads the persisted session row by its key, with no cache, so a revoked or expired device session is refused on the very
//      next request. (T3's raw-route helper admits orchestration scopes only, so this route cannot use it.)
//   3. The route checks `filesystem:read` itself.
//   4. The id is closed: `dlv_…` names a declaration, `off_…` a recorded edit path the board still offers (and names its root by `?root=`, a thread id, not a credential). A client never names a path.
//   5. Reachability: the declaration's root must be a main root that M03's identity record does not show to be a child, and the host's access rule (`interactions().canAccess`) must let the connection reach
//      both the root and the declaring session. An unknown id, another root's id and an unreachable one all answer the same 404.
// Bytes. `as-delivered` comes only from the attached snapshot, opened in process for the declaring Pi session (`openSnapshot`), read whole under the size cap, and refused when its digest is not the declared
// one; a pending, unavailable or missing snapshot is a refusal that says so. `current` re-judges the file at the moment of the read: the folder part of its path is resolved and must still lead to the
// declared path inside the session's working folder; the file itself is never followed (judged by `lstat`, opened with O_NOFOLLOW) and must be the same regular file (device and inode) before and after the
// read, with the size and time it had. The bytes are read whole under the cap and sent with their digest in `x-aetheria-digest`, so a client can say "changed since delivered" by comparing it with the
// card's. Every response is an attachment, never cacheable, never sniffed. What this cannot do: Node offers no openat, so a folder swapped and restored inside the few milliseconds of one read is not seen.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type * as NodeStream from "node:stream";

import {
  DELIVERABLE_DOWNLOAD_MAX_BYTES,
  DELIVERABLE_DOWNLOAD_PATH,
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
  DELIVERABLE_DOWNLOAD_SEMANTICS,
  type DeliverableDownloadRefusalCode,
  type DeliverableDownloadSemantics,
} from "@t3tools/aetheria-contracts";
import type { ClientActor } from "@t3tools/aetheria-server";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { AetheriaBackend } from "./aetheriaBackend.ts";
import { offeredIdOf, openRoot, type Backend } from "./deliverablesRpc.ts";

const FILESYSTEM_READ_SCOPE = "filesystem:read";
const ID_PATTERN = /^(dlv|off)_[0-9a-f]{32}$/;

export interface DownloadRouteOptions {
  /** The size cap (default `DELIVERABLE_DOWNLOAD_MAX_BYTES`). */
  readonly maxBytes?: number | undefined;
  /** Test seam: called after the current file was opened and before it is read, to swap it. */
  readonly afterOpen?: (() => void | Promise<void>) | undefined;
}

class Refusal extends Error {
  readonly code: DeliverableDownloadRefusalCode;
  readonly detail: string;
  constructor(code: DeliverableDownloadRefusalCode, detail: string) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}
const refusal = (code: DeliverableDownloadRefusalCode, detail: string): Refusal =>
  new Refusal(code, detail);

const respondRefusal = (code: DeliverableDownloadRefusalCode, detail: string) =>
  HttpServerResponse.jsonUnsafe(
    { ok: false, code, detail },
    {
      status: DELIVERABLE_DOWNLOAD_REFUSAL_STATUS[code],
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    },
  );

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const contentTypeOf = (name: string): string =>
  CONTENT_TYPES[NodePath.extname(name).toLowerCase()] ?? "application/octet-stream";

/** An ASCII fallback name and the RFC 5987 UTF-8 name: neither can carry a quote, a separator or a line break. */
const dispositionOf = (name: string): string => {
  const ascii =
    name
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 100) || "download";
  const utf8 = encodeURIComponent(name.slice(0, 200)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
};

const digestOf = (bytes: Buffer): string =>
  `sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}`;
const errnoOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;
const inside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(NodePath.sep) ? root : root + NodePath.sep);

interface Served {
  readonly bytes: Buffer;
  readonly name: string;
  readonly digest: string;
  readonly semantics: DeliverableDownloadSemantics;
}

/**
 * The file at `path`, judged again now: still the path that was declared or offered, inside `rootFolder`, a regular file, the same one before and after the read. Whole bytes under `maxBytes`.
 */
const readCurrent = async (
  path: string,
  rootFolder: string,
  maxBytes: number,
  afterOpen: (() => void | Promise<void>) | undefined,
): Promise<Served> => {
  let root: string;
  try {
    root = await NodeFSP.realpath(rootFolder);
  } catch {
    throw refusal("DOWNLOAD_UNAVAILABLE", "the session's working folder cannot be resolved");
  }
  const resolved = NodePath.resolve(path);
  const base = NodePath.basename(resolved);
  const parent = NodePath.dirname(resolved);
  if (base === "" || parent === resolved)
    throw refusal("DOWNLOAD_FILE_NOT_REGULAR", "the path names no file");
  let realParent: string;
  try {
    realParent = await NodeFSP.realpath(parent);
  } catch (error) {
    throw errnoOf(error) === "EACCES" || errnoOf(error) === "EPERM"
      ? refusal("DOWNLOAD_FILE_UNREADABLE", "the file's folder cannot be read")
      : refusal("DOWNLOAD_FILE_MISSING", "the file does not exist");
  }
  const canonical = NodePath.join(realParent, base);
  if (!inside(canonical, root))
    throw refusal("DOWNLOAD_FILE_OUTSIDE_ROOT", "the file is outside the session's working folder");
  if (canonical !== resolved)
    throw refusal(
      "DOWNLOAD_FILE_CHANGED",
      "a folder on the file's path no longer leads where it did",
    );

  let before: NodeFS.Stats;
  try {
    before = await NodeFSP.lstat(canonical);
  } catch (error) {
    throw errnoOf(error) === "EACCES" || errnoOf(error) === "EPERM"
      ? refusal("DOWNLOAD_FILE_UNREADABLE", "the file cannot be examined")
      : refusal("DOWNLOAD_FILE_MISSING", "the file does not exist");
  }
  if (!before.isFile())
    throw refusal("DOWNLOAD_FILE_NOT_REGULAR", "the path is not a regular file");
  if (before.size > maxBytes) throw refusal("DOWNLOAD_TOO_LARGE", "the file is over the size cap");

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(
      canonical,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = errnoOf(error);
    if (code === "ELOOP") throw refusal("DOWNLOAD_FILE_NOT_REGULAR", "the path is a link");
    if (code === "ENOENT") throw refusal("DOWNLOAD_FILE_MISSING", "the file does not exist");
    throw refusal("DOWNLOAD_FILE_UNREADABLE", "the file cannot be opened for reading");
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile())
      throw refusal("DOWNLOAD_FILE_NOT_REGULAR", "the path is not a regular file");
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw refusal("DOWNLOAD_FILE_CHANGED", "the file was replaced while it was opened");
    if (opened.size > maxBytes)
      throw refusal("DOWNLOAD_TOO_LARGE", "the file is over the size cap");
    await afterOpen?.();
    const chunks: Buffer[] = [];
    let total = 0;
    const chunk = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      let read: number;
      try {
        read = (await handle.read(chunk, 0, chunk.length, null)).bytesRead;
      } catch {
        throw refusal("DOWNLOAD_FILE_UNREADABLE", "the file cannot be read");
      }
      if (read === 0) break;
      total += read;
      if (total > maxBytes) throw refusal("DOWNLOAD_TOO_LARGE", "the file is over the size cap");
      chunks.push(Buffer.from(chunk.subarray(0, read)));
    }
    const after = await handle.stat();
    let now: NodeFS.Stats;
    let parentNow: string;
    try {
      now = await NodeFSP.lstat(canonical);
      parentNow = await NodeFSP.realpath(parent);
    } catch {
      throw refusal("DOWNLOAD_FILE_CHANGED", "the file was removed while it was read");
    }
    if (
      total !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      !now.isFile() ||
      now.dev !== opened.dev ||
      now.ino !== opened.ino ||
      parentNow !== realParent
    )
      throw refusal("DOWNLOAD_FILE_CHANGED", "the file changed while it was read");
    const bytes = Buffer.concat(chunks);
    return { bytes, name: base, digest: digestOf(bytes), semantics: "current" };
  } finally {
    await handle.close().catch(() => {});
  }
};

/** The stream's bytes, whole, under the cap; the stream is closed whatever happens. */
const readStream = async (stream: NodeStream.Readable, maxBytes: number): Promise<Buffer> => {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const piece of stream) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as Uint8Array);
      total += chunk.length;
      if (total > maxBytes)
        throw refusal("DOWNLOAD_TOO_LARGE", "the snapshot is over the size cap");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
};

type Service = Backend extends Option.Option<infer S> ? S : never;

/** The declaration a connection may reach, or a refusal. Unknown, another root's and unreachable ids are the same 404. */
const reachableDeclaration = async (service: Service, actor: ClientActor, id: string) => {
  const store = service.deliverables();
  if (store === undefined)
    throw refusal("DOWNLOAD_UNAVAILABLE", "the deliverables store is not running");
  const got = await store.get(id);
  if (!got.ok) throw refusal("DOWNLOAD_UNAVAILABLE", "the declaration store cannot be used");
  const entry = got.value;
  const notFound = () => refusal("DOWNLOAD_NOT_FOUND", "not available to this connection");
  if (entry === null) throw notFound();
  if (service.index.bindingOfSession(entry.rootSessionId) === undefined) throw notFound();
  const kind = service.identityKind(entry.rootSessionId);
  if (kind === "child") throw notFound();
  if (kind === "unavailable")
    throw refusal("DOWNLOAD_UNAVAILABLE", "the root's identity record cannot be read");
  const interactions = service.interactions();
  if (interactions === undefined)
    throw refusal("DOWNLOAD_UNAVAILABLE", "the host's access rule is not running");
  const may = async (sessionId: string): Promise<boolean> =>
    interactions.canAccess(actor, { sessionId, rootSessionId: entry.rootSessionId });
  if (!(await may(entry.rootSessionId))) throw notFound();
  if (entry.sessionId !== entry.rootSessionId && !(await may(entry.sessionId))) throw notFound();
  return entry;
};

const serveDeclaration = async (
  service: Service,
  actor: ClientActor,
  id: string,
  semantics: DeliverableDownloadSemantics,
  options: DownloadRouteOptions,
): Promise<Served> => {
  const maxBytes = options.maxBytes ?? DELIVERABLE_DOWNLOAD_MAX_BYTES;
  const entry = await reachableDeclaration(service, actor, id);
  if (semantics === "current") {
    const folder = service.index.bindingOfSession(entry.sessionId)?.workingFolder;
    if (folder === undefined)
      throw refusal("DOWNLOAD_NOT_FOUND", "not available to this connection");
    return readCurrent(entry.canonicalPath, folder, maxBytes, options.afterOpen);
  }
  const snapshot = entry.snapshot;
  if (snapshot.state === "pending")
    throw refusal("DOWNLOAD_SNAPSHOT_PENDING", "the as-delivered copy has not been stored yet");
  if (snapshot.state === "unavailable")
    throw refusal(
      "DOWNLOAD_SNAPSHOT_UNAVAILABLE",
      `no as-delivered copy exists (${snapshot.code}); the current file may still be offered`,
    );
  if (snapshot.size > maxBytes)
    throw refusal("DOWNLOAD_TOO_LARGE", "the snapshot is over the size cap");
  const opened = await service.openSnapshot(entry.sessionId, snapshot.snapshotId);
  if (!opened.ok)
    throw opened.code === "unavailable"
      ? refusal("DOWNLOAD_UNAVAILABLE", "the snapshot store is not running")
      : refusal("DOWNLOAD_SNAPSHOT_MISSING", "the snapshot store holds no such copy");
  const bytes = await readStream(opened.stream, maxBytes);
  // Only the declared bytes are sent: the stored copy must be the one the declaration named.
  if (opened.digest !== entry.digest || digestOf(bytes) !== entry.digest)
    throw refusal("DOWNLOAD_SNAPSHOT_MISMATCH", "the stored copy is not the declared file");
  return {
    bytes,
    name: NodePath.basename(entry.canonicalPath),
    digest: entry.digest,
    semantics: "as-delivered",
  };
};

const serveOffered = async (
  backend: Backend,
  actor: ClientActor,
  id: string,
  rootThreadId: string | null,
  options: DownloadRouteOptions,
): Promise<Served> => {
  if (rootThreadId === null || rootThreadId === "")
    throw refusal("DOWNLOAD_BAD_REQUEST", "an offered path names its root with ?root=");
  const gate = await openRoot(backend, actor, rootThreadId);
  if ("ok" in gate)
    throw gate.code === "DELIVERABLES_NOT_FOUND"
      ? refusal("DOWNLOAD_NOT_FOUND", "not available to this connection")
      : refusal("DOWNLOAD_UNAVAILABLE", "the root could not be checked");
  const edits = await gate.service.board.editsOf(gate.rootSessionId);
  if (edits.status === "unknown")
    throw refusal("DOWNLOAD_OFFERED_UNKNOWN", "the board says nothing about this root's edits");
  if (edits.status === "unavailable")
    throw refusal("DOWNLOAD_UNAVAILABLE", "the board could not be read");
  const path = edits.paths.find((candidate) => offeredIdOf(gate.rootSessionId, candidate) === id);
  if (path === undefined) throw refusal("DOWNLOAD_NOT_FOUND", "not available to this connection");
  return readCurrent(
    path,
    edits.workspace,
    options.maxBytes ?? DELIVERABLE_DOWNLOAD_MAX_BYTES,
    options.afterOpen,
  );
};

/** What the request names, judged after authentication and the scope check. */
const parseTarget = (rawUrl: string) => {
  let url: URL;
  try {
    url = new URL(rawUrl, "http://aetheria.invalid");
  } catch {
    throw refusal("DOWNLOAD_BAD_REQUEST", "the request URL cannot be read");
  }
  const prefix = `${DELIVERABLE_DOWNLOAD_PATH}/`;
  let id = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  try {
    id = decodeURIComponent(id);
  } catch {
    id = "";
  }
  if (!ID_PATTERN.test(id)) throw refusal("DOWNLOAD_NOT_FOUND", "not available to this connection");
  const semanticsParam = url.searchParams.get("semantics");
  if (
    semanticsParam !== null &&
    !(DELIVERABLE_DOWNLOAD_SEMANTICS as readonly string[]).includes(semanticsParam)
  )
    throw refusal("DOWNLOAD_BAD_REQUEST", "semantics is current or as-delivered");
  return {
    id,
    explicitSemantics: semanticsParam as DeliverableDownloadSemantics | null,
    semantics: (semanticsParam ?? "current") as DeliverableDownloadSemantics,
    root: url.searchParams.get("root"),
  };
};

/** The route, over a Backend lookup. Without a Backend answering it is 503 after authentication. */
export const routeLayer = (backend: Backend, options: DownloadRouteOptions = {}) =>
  HttpRouter.add(
    "GET",
    `${DELIVERABLE_DOWNLOAD_PATH}/*`,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      // 1. The credential is the Bearer header and nothing else.
      if (EnvironmentAuth.parseBearerToken(request) === null)
        return respondRefusal(
          "DOWNLOAD_BEARER_REQUIRED",
          "send the device credential as an Authorization Bearer header",
        );
      // 2. Authentication on every request: the persisted session is read again, so a revoked or expired one is refused now.
      const authenticated = yield* serverAuth.authenticateHttpRequest(request).pipe(
        Effect.map((session) => ({ kind: "session" as const, session })),
        Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, () =>
          Effect.succeed({ kind: "invalid" as const }),
        ),
        Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, () =>
          Effect.succeed({ kind: "internal" as const }),
        ),
      );
      if (authenticated.kind === "invalid")
        return respondRefusal(
          "DOWNLOAD_UNAUTHENTICATED",
          "the device credential is invalid, expired or revoked",
        );
      if (authenticated.kind === "internal")
        return respondRefusal("DOWNLOAD_UNAVAILABLE", "the credential could not be checked");
      const session = authenticated.session;
      // 3. The route's own scope check.
      if (!session.scopes.includes(FILESYSTEM_READ_SCOPE))
        return respondRefusal(
          "DOWNLOAD_NOT_AUTHORIZED",
          `this credential lacks ${FILESYSTEM_READ_SCOPE}`,
        );
      const actor: ClientActor = {
        clientSessionId: session.sessionId,
        grantedScopes: [...session.scopes],
        authenticatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      const rawUrl = request.url;
      const served = yield* Effect.promise(async () => {
        try {
          const target = parseTarget(rawUrl);
          if (Option.isNone(backend))
            throw refusal("DOWNLOAD_UNAVAILABLE", "the Backend is not running");
          if (target.id.startsWith("off_")) {
            if (target.explicitSemantics === "as-delivered")
              throw refusal("DOWNLOAD_BAD_REQUEST", "an offered path has no as-delivered copy");
            return await serveOffered(backend, actor, target.id, target.root, options);
          }
          return await serveDeclaration(backend.value, actor, target.id, target.semantics, options);
        } catch (error) {
          return error instanceof Refusal
            ? error
            : refusal("DOWNLOAD_UNAVAILABLE", "the download could not be served");
        }
      });
      if (served instanceof Refusal) {
        yield* Effect.logWarning("deliverable download refused", { code: served.code });
        return respondRefusal(served.code, served.detail);
      }
      return HttpServerResponse.uint8Array(served.bytes, {
        status: 200,
        contentType: contentTypeOf(served.name),
        headers: {
          "content-disposition": dispositionOf(served.name),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'",
          "x-aetheria-digest": served.digest,
          "x-aetheria-size": String(served.bytes.length),
          "x-aetheria-semantics": served.semantics,
        },
      });
    }),
  );

/**
 * The seam entry (IP-50): with the Aetheria Backend registered (IP-1) the route serves its declarations, snapshots and board; without it no route is registered, so a plain T3 is unchanged.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const backend = yield* Effect.serviceOption(AetheriaBackend);
    return Option.match(backend, {
      onNone: (): ReturnType<typeof routeLayer> => Layer.empty,
      onSome: (service) => routeLayer(Option.some(service)),
    });
  }),
);
