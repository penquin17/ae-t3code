// AETHERIA M04 Plan step 15 (B5) — the pre-upgrade gate: a connection that declares the Backend digest it expects is refused unless this
// server's actual Backend digest is present and equal. A connection that declares nothing is not an Aetheria connection and is untouched.
//
// Pure: the caller (ws.ts, IP-9) passes the request URL and the optional composition service, and answers with the returned status and body.
// The body names a code, a fixed message and digest/version facts only: never the raw declaration, a path or a module id.
import type * as Option from "effect/Option";

import {
  EXPECTED_BACKEND_DIGEST_QUERY,
  decideBackendConnection,
  type BackendDigest,
  type DigestRefusalCode,
} from "./backendDigest.ts";

export interface BackendDigestRefusal {
  readonly status: 409;
  readonly body: {
    readonly code: DigestRefusalCode;
    readonly message: string;
    readonly actualDigest?: BackendDigest;
    readonly expectedDigest?: BackendDigest;
  };
}

const MESSAGES: Record<DigestRefusalCode, string> = {
  AETHERIA_BACKEND_DIGEST_MISMATCH:
    "This server's Aetheria Backend was built from a different composition than this client expects.",
  AETHERIA_BACKEND_DIGEST_ABSENT: "This server publishes no Aetheria Backend composition digest.",
  AETHERIA_BACKEND_DIGEST_MALFORMED:
    "The expected Aetheria Backend digest is not a valid digest-v1 value.",
};

type Composition = Option.Option<{ readonly digest: BackendDigest }>;

/** The ws upgrade: only a request that declares an expectation is gated. A repeated declaration is ambiguous, so it is malformed, not first-wins. */
export function backendDigestRefusal(
  url: URL,
  composition: Composition,
): BackendDigestRefusal | undefined {
  const values = url.searchParams.getAll(EXPECTED_BACKEND_DIGEST_QUERY);
  if (values.length === 0) return undefined;
  return refusalOf(values.length === 1 ? (values[0] as string) : "", composition);
}

/**
 * The XC-6 route: an Agent-to-Backend request is an Aetheria connection by definition, so once the Backend composition is provided the
 * declaration is REQUIRED (absent is a refusal). Without the Backend (the B9 probe layer) nothing is enforced and the route is as before.
 */
export function xc6DigestRefusal(
  header: string | readonly string[] | undefined,
  composition: Composition,
): BackendDigestRefusal | undefined {
  if (header === undefined && composition._tag === "None") return undefined;
  return refusalOf(typeof header === "string" ? header : "", composition);
}

function refusalOf(declared: string, composition: Composition): BackendDigestRefusal | undefined {
  const actual = composition._tag === "Some" ? composition.value.digest : undefined;
  const decision = decideBackendConnection(declared, actual);
  if (decision.allow) return undefined;
  return {
    status: 409,
    body: {
      code: decision.code,
      message: MESSAGES[decision.code],
      ...(decision.facts.actual === undefined ? {} : { actualDigest: decision.facts.actual }),
      ...(decision.facts.expected === undefined ? {} : { expectedDigest: decision.facts.expected }),
    },
  };
}
