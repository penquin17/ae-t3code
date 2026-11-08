// AETHERIA — the Backend's read-only caller-identity resolver: it joins the thread binding with M03's active identity record and can only confirm or refuse the claimed session.
// `ok` carries identity facts and no authority; `unavailable` means the facts are missing or unreadable and is never treated as main; `refused` means two facts contradict or the record is retired.
// Nothing here reads a tool argument; unknown is never promoted to success or refusal-by-guess.

import { validateRecord, type IdentityReader, type IdentityRecord } from "./backendEntry.ts";
import type { ThreadBinding, ThreadIndex } from "./threadIndex.ts";

export const XC6_IDENTITY_UNAVAILABLE = "XC6_IDENTITY_UNAVAILABLE";
export const XC6_IDENTITY_MISMATCH = "XC6_IDENTITY_MISMATCH";
export const XC6_IDENTITY_RETIRED = "XC6_IDENTITY_RETIRED";
export const XC6_IDENTITY_INCONSISTENT = "XC6_IDENTITY_INCONSISTENT";

/** What the transport proves from the bearer (`McpSessionRegistry` scope). Structurally the XC-6 contract's caller, plus the scope's subagent flag. */
export interface IdentityCaller {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
  /** From the bearer's scope when the transport knows it; omitted means unknown. */
  readonly subagent?: boolean;
}

export interface ResolvedIdentity {
  readonly ok: true;
  readonly sessionId: string;
  readonly kind: "main" | "child";
  readonly rootSessionId: string;
  readonly parentChain: readonly string[];
  readonly role: string | null;
}

export interface UnresolvedIdentity {
  readonly ok: false;
  readonly outcome: "unavailable" | "refused";
  /** The stable wire code. */
  readonly code: string;
  /** A finer reason for logs and tests; not for the model. */
  readonly reason: string;
}

export type IdentityResolution = ResolvedIdentity | UnresolvedIdentity;

export interface IdentityResolver {
  /** `claimedSessionId` is the Pi session id the Agent adapter attached, or `null` when none was. Same shape as the XC-6 identity port. */
  resolve(caller: IdentityCaller, claimedSessionId: string | null): IdentityResolution;
}

export interface IdentityResolverOptions {
  readonly reader: IdentityReader;
  readonly index: Pick<ThreadIndex, "lookup" | "threadsOf" | "bindingOfSession">;
  /** The longest parent chain accepted. Default 32. */
  readonly maxDepth?: number;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const idString = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.length <= 256 && !v.includes("\0");

const unavailable = (reason: string): UnresolvedIdentity =>
  Object.freeze({
    ok: false as const,
    outcome: "unavailable" as const,
    code: XC6_IDENTITY_UNAVAILABLE,
    reason,
  });
const refused = (code: string, reason: string): UnresolvedIdentity =>
  Object.freeze({ ok: false as const, outcome: "refused" as const, code, reason });
const inconsistent = (reason: string): UnresolvedIdentity =>
  refused(XC6_IDENTITY_INCONSISTENT, reason);

type Loaded =
  | { readonly state: "active"; readonly record: IdentityRecord }
  | { readonly state: "absent" }
  | { readonly state: "retired" }
  | {
      readonly state: "bad";
      readonly reason: "record-corrupt" | "record-invalid" | "record-unreadable";
    };

export function createIdentityResolver(options: IdentityResolverOptions): IdentityResolver {
  const { reader, index } = options;
  const maxDepth = options.maxDepth ?? 32;

  /** One read of one session's record, judged by M03's own validator. Never throws. */
  const load = (sessionId: string): Loaded => {
    let stored: ReturnType<IdentityReader["read"]>;
    try {
      stored = reader.read(sessionId);
    } catch {
      return { state: "bad", reason: "record-unreadable" };
    }
    switch (stored?.status) {
      case "active": {
        const checked = validateRecord(stored.record);
        if (!checked.ok || checked.record.sessionId !== sessionId)
          return { state: "bad", reason: "record-invalid" };
        return { state: "active", record: checked.record };
      }
      case "absent":
      case "pending":
        return { state: "absent" };
      case "retired":
        return { state: "retired" };
      case "corrupt":
        return { state: "bad", reason: "record-corrupt" };
      default:
        return { state: "bad", reason: "record-invalid" };
    }
  };

  const sameChain = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  /** The checks a child's record needs beyond its own validity. Returns a failure or `null`. */
  const lineage = (record: IdentityRecord, binding: ThreadBinding): UnresolvedIdentity | null => {
    const chain = record.parentChain;
    if (chain.length > maxDepth) return inconsistent("lineage-too-deep");
    if (new Set(chain).size !== chain.length || chain.includes(record.sessionId))
      return inconsistent("lineage-cycle");
    if (chain[0] !== record.rootSessionId) return inconsistent("lineage-root");
    for (let i = 0; i < chain.length; i += 1) {
      const ancestorId = chain[i] as string;
      const loaded = load(ancestorId);
      if (loaded.state === "retired") return inconsistent("lineage-ancestor-retired");
      if (loaded.state !== "active") return unavailable("lineage-unverifiable");
      const ancestor = loaded.record;
      if (
        ancestor.kind !== (i === 0 ? "main" : "child") ||
        !sameChain(ancestor.parentChain, chain.slice(0, i))
      )
        return inconsistent("lineage-chain");
      if (ancestor.rootSessionId !== record.rootSessionId) return inconsistent("lineage-root");
    }
    // Project lineage: every session on the chain was launched in the same project. A project that cannot be established is unknown, not equal.
    if (binding.projectRoot === null) return unavailable("lineage-unverifiable");
    for (const ancestorId of chain) {
      const ancestorBinding = index.bindingOfSession(ancestorId);
      if (ancestorBinding === undefined || ancestorBinding.projectRoot === null)
        return unavailable("lineage-unverifiable");
      if (ancestorBinding.projectRoot !== binding.projectRoot)
        return inconsistent("project-lineage-mismatch");
    }
    return null;
  };

  const decide = (caller: IdentityCaller, claimedSessionId: string | null): IdentityResolution => {
    // The caller is bearer-derived, but its shape is still checked: nothing unusable reaches the filesystem.
    if (
      caller === null ||
      typeof caller !== "object" ||
      !idString(caller.threadId) ||
      !idString(caller.providerSessionId) ||
      !idString(caller.providerInstanceId)
    )
      return unavailable("bad-caller");
    if (
      claimedSessionId !== null &&
      (typeof claimedSessionId !== "string" || !NAME.test(claimedSessionId))
    )
      return unavailable("bad-claim");

    const found = index.lookup(caller.threadId);
    if (found.status === "absent") return unavailable("no-binding");
    if (found.status === "corrupt") return unavailable("binding-corrupt");
    const binding = found.binding;
    if (binding.threadId !== caller.threadId) return unavailable("binding-corrupt");
    if (binding.providerInstanceId !== caller.providerInstanceId)
      return refused(XC6_IDENTITY_MISMATCH, "provider-instance");
    // A different provider session of the same thread is a resume the index has not caught up with, or a stale bearer: no authority either way.
    if (binding.providerSessionId !== caller.providerSessionId)
      return unavailable("provider-session-stale");
    if (claimedSessionId !== null && claimedSessionId !== binding.sessionId)
      return refused(XC6_IDENTITY_MISMATCH, "session-claim");
    if (
      caller.subagent !== undefined &&
      binding.subagent !== null &&
      caller.subagent !== binding.subagent
    )
      return refused(XC6_IDENTITY_MISMATCH, "subagent-flag");

    const holders = index.threadsOf(binding.sessionId);
    if (holders.length !== 1 || holders[0] !== caller.threadId)
      return inconsistent("session-bound-to-many");

    const loaded = load(binding.sessionId);
    if (loaded.state === "absent") return unavailable("record-awaited");
    if (loaded.state === "bad") return unavailable(loaded.reason);
    if (loaded.state === "retired") return refused(XC6_IDENTITY_RETIRED, "record-retired");
    const record = loaded.record;

    if (binding.expectedRole !== null && binding.expectedRole !== record.role)
      return refused(XC6_IDENTITY_MISMATCH, "role-mismatch");
    if (record.kind === "child") {
      const failure = lineage(record, binding);
      if (failure !== null) return failure;
    }
    return Object.freeze({
      ok: true as const,
      sessionId: record.sessionId,
      kind: record.kind,
      rootSessionId: record.rootSessionId,
      parentChain: Object.freeze([...record.parentChain]),
      role: record.role,
    });
  };

  return Object.freeze({
    resolve(caller: IdentityCaller, claimedSessionId: string | null): IdentityResolution {
      try {
        return decide(caller, claimedSessionId);
      } catch {
        // Whatever failed, the answer is "cannot tell", never an identity.
        return unavailable("resolver-failed");
      }
    },
  });
}
