// The truthful connection model (C4/C1, D6–D8). One owner of "what is the connection, and may a person act": it derives a view from supplied facts and invents none.
// Plain TypeScript: no DOM, no socket, no T3 import (D19). The adapter turns T3's and the Backend's wire into these facts; views read only the ViewModel.
import type { Projection } from "../core/resync";
import { known, unavailable, type Known } from "../core/known";
import { lineFor } from "./lines";

export type Locale = "en" | "zh";

/** What this build carries as the Backend composition digest it expects (from the build, never from the server it connects to). */
export type ExpectedDigest =
  | { readonly tag: "present"; readonly value: string }
  | { readonly tag: "absent" }
  | { readonly tag: "malformed" };

/** The transport, as T3's supervisor reports it, reduced to what the model needs. */
export interface TransportFacts {
  readonly network: "unknown" | "offline" | "online";
  readonly phase: "available" | "offline" | "connecting" | "backoff" | "connected" | "blocked";
  readonly stage: "preparing" | "opening" | "synchronizing" | null;
  readonly attempt: number;
  readonly retryAt: number | null;
  /** Set only when T3 itself blocked the connection, with T3's own reason and words. */
  readonly blocked: {
    readonly reason: "authentication" | "configuration" | "permission" | "unsupported";
    readonly detail: string;
  } | null;
}

/** What a refused upgrade told us: the HTTP status, and the body's fields when it had the expected shape. */
export interface UpgradeRefusal {
  readonly status: number;
  readonly code?: string;
  readonly message?: string;
  readonly actualDigest?: string;
  readonly expectedDigest?: string;
}

export interface ModuleFact {
  readonly id: string;
  readonly required: boolean;
  readonly state: string;
}

/** The read-only `aetheria.composition.status` reply, reduced to the facts the model uses. */
export type CompositionRead =
  | {
      readonly tag: "read";
      readonly digest: string;
      readonly phase: string;
      readonly modules: readonly ModuleFact[];
    }
  | { readonly tag: "unavailable"; readonly reason: string };

export type ConnectionEvent =
  | { readonly type: "transport"; readonly generation: number; readonly transport: TransportFacts }
  | { readonly type: "ready"; readonly generation: number }
  | {
      readonly type: "projection";
      readonly generation: number;
      readonly projection: Projection<unknown>;
    }
  | { readonly type: "composition"; readonly generation: number; readonly result: CompositionRead }
  | {
      readonly type: "upgrade-refused";
      readonly generation: number;
      readonly refusal: UpgradeRefusal;
    }
  | { readonly type: "call-refused"; readonly generation: number; readonly code: string };

export interface ConnectionFacts {
  readonly expected: ExpectedDigest;
  readonly generation: number;
  readonly transport: TransportFacts | null;
  readonly ready: boolean;
  readonly projection: Projection<unknown>;
  readonly composition: CompositionRead | null;
  readonly refusal: UpgradeRefusal | null;
  readonly callRefusal: string | null;
  /** True once a generation has been connected; a later loss is then stale data, not a first attempt. */
  readonly everConnected: boolean;
}

export type ConnectionKind =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "unauthorized"
  | "access-ended"
  | "version-mismatch"
  | "unknown";

export type Waiting = "ready" | "baseline" | "composition" | "backend";

export interface ConnectionView {
  readonly kind: ConnectionKind;
  /** Why, within the kind. */
  readonly cause?: string;
  /** Actions are allowed in exactly one state: connected. */
  readonly actions: "allowed" | "blocked";
  readonly offer: "none" | "reload" | "sign-in";
  /** This client's own words for the state, in the chosen language. */
  readonly headline: string;
  /** Someone else's words, verbatim, with whose they are. */
  readonly detail?: { readonly source: "server" | "t3" | "client"; readonly text: string };
  readonly code?: string;
  readonly digests?: { readonly expected?: string; readonly actual?: string };
  /** Read only from the composition status; never guessed from a refusal. */
  readonly modules: Known<readonly ModuleFact[]>;
  readonly waiting?: Waiting;
  /** The last values shown may be out of date. */
  readonly stale: boolean;
  readonly attempt: number;
  readonly retryAt: number | null;
}

export function initialFacts(expected: ExpectedDigest): ConnectionFacts {
  return {
    expected,
    generation: 0,
    transport: null,
    ready: false,
    projection: { phase: "awaiting-baseline" },
    composition: null,
    refusal: null,
    callRefusal: null,
    everConnected: false,
  };
}

/** A new generation starts with nothing read: readiness, projection, status and refusals belong to the generation that produced them. */
function freshGeneration(facts: ConnectionFacts, generation: number): ConnectionFacts {
  return {
    ...facts,
    generation,
    transport: null,
    ready: false,
    projection: { phase: "awaiting-baseline" },
    composition: null,
    refusal: null,
    callRefusal: null,
  };
}

/**
 * The one reducer. A reply from an older generation than the newest seen is dropped (the same object comes back); a newer generation clears what the older one read.
 * Nothing is replayed: a fact applies once, in the generation that produced it.
 */
export function applyEvent(facts: ConnectionFacts, event: ConnectionEvent): ConnectionFacts {
  if (event.generation < facts.generation) return facts;
  const base =
    event.generation > facts.generation ? freshGeneration(facts, event.generation) : facts;
  let next: ConnectionFacts;
  switch (event.type) {
    case "transport":
      next = { ...base, transport: event.transport };
      break;
    case "ready":
      next = { ...base, ready: true };
      break;
    case "projection":
      next = { ...base, projection: event.projection };
      break;
    case "composition":
      next = { ...base, composition: event.result };
      break;
    case "upgrade-refused":
      next = { ...base, refusal: event.refusal };
      break;
    case "call-refused":
      // Only a device-ended code changes the connection; a denied target, a missing thing or an unreadable standing says nothing about the device.
      next = isDeviceEndedCode(event.code) ? { ...base, callRefusal: event.code } : base;
      break;
  }
  return !next.everConnected && viewOf(next).kind === "connected"
    ? { ...next, everConnected: true }
    : next;
}

/**
 * The Backend's per-call device check answers `<METHOD>_DEVICE_REVOKED` for a revoked, missing or expired session; it does not say which. The download route says the same with DOWNLOAD_UNAUTHENTICATED
 * ("does not accept this device's credential: expired, revoked or unknown"); DOWNLOAD_BEARER_REQUIRED says this client sent none, which is not the device's access ending.
 */
export function isDeviceEndedCode(code: string): boolean {
  return /^[A-Z][A-Z0-9]*_DEVICE_REVOKED$/.test(code) || code === "DOWNLOAD_UNAUTHENTICATED";
}

const NO_MODULES =
  "module detail is read from the composition status, which this connection has not supplied";
const STALE_MODULES =
  "the last composition status is not current: the connection was lost or its access ended";

/** The module list explains a verdict about the Backend's build (connected, mismatched, not running); in a state about the link or the device it would be an old reading shown as current. */
const MODULE_KINDS: ReadonlySet<ConnectionKind> = new Set([
  "connected",
  "version-mismatch",
  "unknown",
]);

type Core = Pick<ConnectionView, "kind" | "actions" | "offer"> &
  Partial<Pick<ConnectionView, "cause" | "detail" | "code" | "digests" | "waiting">>;

function digestsOf(
  expected: string | undefined,
  actual: string | undefined,
): NonNullable<ConnectionView["digests"]> {
  return {
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function refusalCore(refusal: UpgradeRefusal, facts: ConnectionFacts): Core {
  const words =
    refusal.message === undefined
      ? {}
      : { detail: { source: "server" as const, text: refusal.message } };
  const code = refusal.code === undefined ? {} : { code: refusal.code };
  const { status } = refusal;
  if (status === 409) {
    const cause = DIGEST_CAUSES[refusal.code ?? ""];
    if (cause !== undefined) {
      return {
        kind: "version-mismatch",
        cause,
        actions: "blocked",
        offer: "reload",
        digests: digestsOf(refusal.expectedDigest, refusal.actualDigest),
        ...words,
        ...code,
      };
    }
  }
  if (status === 426) {
    return {
      kind: "version-mismatch",
      cause: "protocol",
      actions: "blocked",
      offer: "reload",
      ...words,
      ...code,
    };
  }
  if (status === 401 || status === 403) {
    const t3 = facts.transport?.blocked;
    const detail =
      refusal.message !== undefined
        ? words
        : t3
          ? { detail: { source: "t3" as const, text: t3.detail } }
          : {};
    return { kind: "unauthorized", actions: "blocked", offer: "sign-in", ...detail, ...code };
  }
  return {
    kind: "unknown",
    cause: "unrecognised-refusal",
    actions: "blocked",
    offer: "reload",
    ...words,
    ...code,
  };
}

const DIGEST_CAUSES: Readonly<Record<string, string | undefined>> = Object.freeze({
  AETHERIA_BACKEND_DIGEST_MISMATCH: "digest-mismatch",
  AETHERIA_BACKEND_DIGEST_ABSENT: "digest-absent",
  AETHERIA_BACKEND_DIGEST_MALFORMED: "digest-malformed",
});

function blockedCore(blocked: NonNullable<TransportFacts["blocked"]>): Core {
  const detail = { detail: { source: "t3" as const, text: blocked.detail } };
  switch (blocked.reason) {
    case "authentication":
    case "permission":
      return { kind: "unauthorized", actions: "blocked", offer: "sign-in", ...detail };
    case "unsupported":
      return {
        kind: "version-mismatch",
        cause: "protocol",
        actions: "blocked",
        offer: "reload",
        ...detail,
      };
    case "configuration":
      return {
        kind: "unknown",
        cause: "configuration",
        actions: "blocked",
        offer: "reload",
        ...detail,
      };
  }
}

/** Which thing a live socket is still waiting for, or `null` when it has everything and the Backend runs. Also the verdicts that are not "waiting". */
function socketCore(facts: ConnectionFacts): Core {
  const { composition, expected } = facts;
  const wait = (waiting: Waiting): Core => ({
    kind: facts.everConnected ? "reconnecting" : "connecting",
    cause: waiting,
    waiting,
    actions: "blocked",
    offer: "none",
  });
  if (composition?.tag === "unavailable") {
    return {
      kind: "unknown",
      cause: "composition-unread",
      actions: "blocked",
      offer: "reload",
      detail: { source: "client", text: composition.reason },
    };
  }
  if (
    composition?.tag === "read" &&
    expected.tag === "present" &&
    composition.digest !== expected.value
  ) {
    return {
      kind: "version-mismatch",
      cause: "digest-differs",
      actions: "blocked",
      offer: "reload",
      digests: digestsOf(expected.value, composition.digest),
    };
  }
  if (
    composition?.tag === "read" &&
    (composition.phase === "failed" || composition.phase === "disposed")
  ) {
    return { kind: "unknown", cause: "backend-not-running", actions: "blocked", offer: "reload" };
  }
  if (!facts.ready) return wait("ready");
  const p = facts.projection;
  if (p.phase !== "live" || p.needsBaseline || p.stale) return wait("baseline");
  if (composition === null) return wait("composition");
  if (composition.phase !== "running") return wait("backend");
  return { kind: "connected", actions: "allowed", offer: "none" };
}

function coreOf(facts: ConnectionFacts): Core {
  if (facts.expected.tag !== "present") {
    const cause =
      facts.expected.tag === "absent" ? "client-digest-absent" : "client-digest-malformed";
    return {
      kind: "version-mismatch",
      cause,
      actions: "blocked",
      offer: "reload",
      detail: {
        source: "client",
        text:
          facts.expected.tag === "absent"
            ? "no expected digest was embedded at build"
            : "the embedded expected digest is not sha256:<64 hex>",
      },
    };
  }
  if (facts.refusal !== null) return refusalCore(facts.refusal, facts);
  if (facts.callRefusal !== null) {
    return { kind: "access-ended", actions: "blocked", offer: "sign-in", code: facts.callRefusal };
  }
  const t = facts.transport;
  if (t === null) {
    return facts.generation === 0
      ? { kind: "disconnected", actions: "blocked", offer: "none" }
      : {
          kind: facts.everConnected ? "reconnecting" : "connecting",
          actions: "blocked",
          offer: "none",
        };
  }
  if (t.blocked !== null) return blockedCore(t.blocked);
  switch (t.phase) {
    case "available":
      return { kind: "disconnected", actions: "blocked", offer: "none" };
    case "offline":
      return { kind: "disconnected", cause: "offline", actions: "blocked", offer: "none" };
    case "blocked":
      // T3 blocked the connection without naming why: say so rather than guess a reason.
      return { kind: "unknown", cause: "configuration", actions: "blocked", offer: "reload" };
    case "backoff":
      return { kind: "reconnecting", actions: "blocked", offer: "none" };
    case "connecting":
      return {
        kind: facts.everConnected || t.attempt > 1 ? "reconnecting" : "connecting",
        actions: "blocked",
        offer: "none",
      };
    case "connected":
      return socketCore(facts);
  }
}

export function viewOf(facts: ConnectionFacts, locale: Locale = "en"): ConnectionView {
  const core = coreOf(facts);
  const composition = facts.composition;
  const { cause, detail, code, digests, waiting } = core;
  return {
    kind: core.kind,
    actions: core.actions,
    offer: core.offer,
    headline: lineFor(core.kind, cause, locale),
    modules:
      composition?.tag !== "read"
        ? unavailable(NO_MODULES)
        : MODULE_KINDS.has(core.kind)
          ? known(composition.modules)
          : unavailable(STALE_MODULES),
    stale: facts.everConnected && core.kind !== "connected",
    attempt: facts.transport?.attempt ?? 0,
    retryAt: facts.transport?.retryAt ?? null,
    ...(cause === undefined ? {} : { cause }),
    ...(detail === undefined ? {} : { detail }),
    ...(code === undefined ? {} : { code }),
    ...(digests === undefined ? {} : { digests }),
    ...(waiting === undefined ? {} : { waiting }),
  };
}
