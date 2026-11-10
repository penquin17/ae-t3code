// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11) — the XC-6 carrier core: the Agent-to-Backend request/reply operations channel.
// Pure of HTTP and of T3: a request is a validated JSON body plus two facts the transport supplies (the bearer-derived caller and the
// session id the Agent adapter attached). The core never reads identity from the body or arguments; it asks the identity port, which
// the Backend backs with M03's active record. Replies are explicit: done, pending (repollable token), unavailable (a result the caller
// must handle), refused (a stable code) or error. Logs and observer snapshots carry operation, status and code only.
//
// Contract owners: the transport (xc6Route.ts) owns bearer resolution; the identity port owns the thread/session binding; operations
// own their meaning. This file owns the shape of every reply and the pending table.

import * as NodeCrypto from "node:crypto";

/** What the bearer proves (T3's provider-session scope): never taken from the request. */
export interface Xc6Caller {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
}

export type Xc6Identity =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly kind: string;
      readonly rootSessionId: string;
    }
  | { readonly ok: false; readonly outcome: "unavailable" | "refused"; readonly code: string };

export type Xc6Settled =
  | { readonly status: "done"; readonly result: unknown }
  | { readonly status: "unavailable"; readonly code: string }
  | { readonly status: "refused"; readonly code: string };

export type Xc6OperationResult =
  | Xc6Settled
  | { readonly status: "pending"; readonly settle: Promise<Xc6Settled> };

export interface Xc6Context {
  readonly caller: Xc6Caller;
  /** Verified against the identity port; the only session id an operation may treat as the caller. */
  readonly sessionId: string;
  readonly kind: string;
  readonly rootSessionId: string;
  /** Untrusted data. Never identity: an operation that names a session in its arguments is naming a subject, not the caller. */
  readonly args: Readonly<Record<string, unknown>>;
}

export type Xc6Operation = (
  context: Xc6Context,
) => Xc6OperationResult | Promise<Xc6OperationResult>;

export type Xc6Reply =
  | { readonly v: 1; readonly status: "done"; readonly result: unknown }
  | { readonly v: 1; readonly status: "pending"; readonly token: string }
  | { readonly v: 1; readonly status: "unavailable"; readonly code: string }
  | { readonly v: 1; readonly status: "refused"; readonly code: string }
  | { readonly v: 1; readonly status: "error"; readonly code: string };

export interface Xc6Response {
  readonly http: number;
  readonly body: Xc6Reply;
}

/** What a log line or an observer sees. No arguments, results, tokens, session ids or bearer. */
export interface Xc6Event {
  readonly kind: "call" | "poll";
  readonly op?: string;
  readonly status: Xc6Reply["status"];
  readonly code?: string;
}

export interface Xc6Deps {
  readonly identity: (
    caller: Xc6Caller,
    claimedSessionId: string | null,
  ) => Xc6Identity | Promise<Xc6Identity>;
  readonly operations: Readonly<Record<string, Xc6Operation>>;
  readonly newToken: () => string;
  readonly log: (event: Xc6Event) => void;
  readonly maxPending: number;
}

export interface Xc6Observer {
  /** The whole handle: an observer can stop listening and nothing else. */
  readonly close: () => void;
}

export interface Xc6Backend {
  readonly handle: (input: {
    readonly caller: Xc6Caller;
    readonly claimedSessionId: string | null;
    readonly body: unknown;
  }) => Promise<Xc6Response>;
  readonly observe: (listener: (event: Xc6Event) => void | Promise<void>) => Xc6Observer;
}

const OP_NAME = /^[a-z][a-z0-9._-]{0,63}$/;
const ALLOWED_KEYS = new Set(["v", "op", "args", "poll"]);
const MAX_TOKEN_CHARS = 200;

const reply = (http: number, body: Xc6Reply): Xc6Response =>
  Object.freeze({ http, body: Object.freeze(body) });
const refused = (http: number, code: string) => reply(http, { v: 1, status: "refused", code });
const hashToken = (token: string) => NodeCrypto.createHash("sha256").update(token).digest("hex");
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

type Parsed =
  | { readonly kind: "call"; readonly op: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly kind: "poll"; readonly token: string };

const parse = (body: unknown): Parsed | undefined => {
  if (!isPlainObject(body)) return undefined;
  for (const key of Object.keys(body)) if (!ALLOWED_KEYS.has(key)) return undefined;
  if (body.v !== 1) return undefined;
  const hasOp = "op" in body;
  const hasPoll = "poll" in body;
  if (hasOp === hasPoll) return undefined;
  if (hasPoll) {
    if ("args" in body) return undefined;
    return typeof body.poll === "string" &&
      body.poll.length > 0 &&
      body.poll.length <= MAX_TOKEN_CHARS
      ? { kind: "poll", token: body.poll }
      : undefined;
  }
  if (typeof body.op !== "string" || !OP_NAME.test(body.op)) return undefined;
  const args = body.args === undefined ? {} : body.args;
  return isPlainObject(args) ? { kind: "call", op: body.op, args } : undefined;
};

interface PendingEntry {
  readonly sessionId: string;
  readonly providerSessionId: string;
  readonly threadId: string;
  readonly op: string;
  settled: Xc6Settled | undefined;
}

export function createXc6Backend(deps: Xc6Deps): Xc6Backend {
  const pending = new Map<string, PendingEntry>();
  const listeners = new Set<(event: Xc6Event) => void | Promise<void>>();

  const emit = (event: Xc6Event) => {
    const frozen = Object.freeze({ ...event });
    try {
      deps.log(frozen);
    } catch {
      /* a failing log never changes a reply */
    }
    for (const listener of listeners) {
      try {
        void Promise.resolve(listener(frozen)).catch(() => {});
      } catch {
        /* observer errors are swallowed and never reach the caller */
      }
    }
  };
  const done = (
    kind: Xc6Event["kind"],
    op: string | undefined,
    response: Xc6Response,
  ): Xc6Response => {
    const body = response.body;
    emit({
      kind,
      ...(op === undefined ? {} : { op }),
      status: body.status,
      ...("code" in body ? { code: body.code } : {}),
    });
    return response;
  };
  const identityFailure = (failure: Extract<Xc6Identity, { ok: false }>): Xc6Response =>
    failure.outcome === "unavailable"
      ? reply(200, { v: 1, status: "unavailable", code: failure.code })
      : refused(403, failure.code);

  const verify = async (caller: Xc6Caller, claimed: string | null): Promise<Xc6Identity> => {
    try {
      return await deps.identity(caller, claimed);
    } catch {
      return { ok: false, outcome: "unavailable", code: "XC6_IDENTITY_UNAVAILABLE" };
    }
  };

  const settledReply = (settled: Xc6Settled): Xc6Reply => {
    switch (settled.status) {
      case "done":
        return { v: 1, status: "done", result: settled.result };
      case "refused":
        return { v: 1, status: "refused", code: settled.code };
      case "unavailable":
        return { v: 1, status: "unavailable", code: settled.code };
    }
  };
  /** A refusal is a 403 like the carrier's own; a done or unavailable answer is a 200. */
  const settledResponse = (settled: Xc6Settled): Xc6Response =>
    reply(settled.status === "refused" ? 403 : 200, settledReply(settled));

  const backend: Xc6Backend = {
    async handle({ caller, claimedSessionId, body }) {
      const request = parse(body);
      if (request === undefined) return done("call", undefined, refused(400, "XC6_BAD_REQUEST"));
      const kind = request.kind;
      const op = request.kind === "call" ? request.op : undefined;
      const who = await verify(caller, claimedSessionId);
      if (!who.ok) return done(kind, op, identityFailure(who));

      if (request.kind === "poll") {
        const key = hashToken(request.token);
        const entry = pending.get(key);
        // One answer for an unknown token and another caller's token: a poll never confirms that a token exists.
        if (
          entry === undefined ||
          entry.sessionId !== who.sessionId ||
          entry.providerSessionId !== caller.providerSessionId ||
          entry.threadId !== caller.threadId
        ) {
          return done("poll", undefined, refused(403, "XC6_POLL_REFUSED"));
        }
        if (entry.settled === undefined) {
          return done(
            "poll",
            entry.op,
            reply(200, { v: 1, status: "pending", token: request.token }),
          );
        }
        pending.delete(key);
        return done("poll", entry.op, settledResponse(entry.settled));
      }

      const operation = Object.hasOwn(deps.operations, request.op)
        ? deps.operations[request.op]
        : undefined;
      if (operation === undefined)
        return done("call", request.op, refused(404, "XC6_UNKNOWN_OPERATION"));
      let outcome: Xc6OperationResult;
      try {
        outcome = await operation({
          caller,
          sessionId: who.sessionId,
          kind: who.kind,
          rootSessionId: who.rootSessionId,
          args: request.args,
        });
      } catch {
        return done(
          "call",
          request.op,
          reply(500, { v: 1, status: "error", code: "XC6_OPERATION_FAILED" }),
        );
      }
      if (outcome.status !== "pending") return done("call", request.op, settledResponse(outcome));
      if (pending.size >= deps.maxPending) {
        return done(
          "call",
          request.op,
          reply(200, { v: 1, status: "unavailable", code: "XC6_PENDING_FULL" }),
        );
      }
      const token = deps.newToken();
      const entry: PendingEntry = {
        sessionId: who.sessionId,
        providerSessionId: caller.providerSessionId,
        threadId: caller.threadId,
        op: request.op,
        settled: undefined,
      };
      pending.set(hashToken(token), entry);
      outcome.settle.then(
        (settled) => {
          entry.settled = settled;
        },
        () => {
          entry.settled = { status: "unavailable", code: "XC6_OPERATION_FAILED" };
        },
      );
      return done("call", request.op, reply(200, { v: 1, status: "pending", token }));
    },

    observe(listener) {
      listeners.add(listener);
      return Object.freeze({ close: () => void listeners.delete(listener) });
    },
  };
  return Object.freeze(backend);
}
