// AETHERIA — the one rule comparing a Backend's actual composition digest with the digest a peer expects from the same pinned build. Pure: no I/O.
// Only a present, well-formed, equal digest is compatible; absent, malformed and different are refusals.
// A refusal names only digest values and the digest version (no path, message, module id or raw input), so reporting one cannot leak.
// The ws upgrade and the XC-6 route apply `decideBackendConnection` before any state changes.

export interface BackendDigest {
  readonly version: number;
  readonly algorithm: "sha256";
  readonly value: string;
}

/** How a peer declares the Backend digest it expects: a request header (XC-6 route) or a query parameter (ws upgrade). */
export const EXPECTED_BACKEND_DIGEST_HEADER = "x-aetheria-expected-backend-digest";
export const EXPECTED_BACKEND_DIGEST_QUERY = "aetheriaExpectedBackendDigest";

const VALUE = /^sha256:[0-9a-f]{64}$/;
const KEYS = ["algorithm", "value", "version"];

function digestOf(raw: unknown): BackendDigest | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const keys = Object.keys(raw).sort();
  if (keys.length !== KEYS.length || keys.some((key, i) => key !== KEYS[i])) return undefined;
  const { version, algorithm, value } = raw as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
  if (algorithm !== "sha256" || typeof value !== "string" || !VALUE.test(value)) return undefined;
  return { version, algorithm, value };
}

/** A declared digest is the digest-v1 value text, `sha256:<64 hex>`, exactly. */
export function digestFromDeclaration(text: string): BackendDigest | undefined {
  return VALUE.test(text) ? { version: 1, algorithm: "sha256", value: text } : undefined;
}

export type DigestComparison =
  | { readonly outcome: "match" }
  | { readonly outcome: "absent" }
  | { readonly outcome: "malformed" }
  | { readonly outcome: "expected-invalid" }
  | {
      readonly outcome: "mismatch";
      readonly actual: BackendDigest;
      readonly expected: BackendDigest;
    };

export function compareBackendDigest(actual: unknown, expected: unknown): DigestComparison {
  const wanted = digestOf(expected);
  if (wanted === undefined) return { outcome: "expected-invalid" };
  if (actual === undefined || actual === null) return { outcome: "absent" };
  const found = digestOf(actual);
  if (found === undefined) return { outcome: "malformed" };
  if (
    found.version === wanted.version &&
    found.algorithm === wanted.algorithm &&
    found.value === wanted.value
  )
    return { outcome: "match" };
  return { outcome: "mismatch", actual: found, expected: wanted };
}

export type DigestRefusalCode =
  | "AETHERIA_BACKEND_DIGEST_ABSENT"
  | "AETHERIA_BACKEND_DIGEST_MALFORMED"
  | "AETHERIA_BACKEND_DIGEST_MISMATCH";

export type ConnectionDecision =
  | { readonly allow: true; readonly aetheria: boolean }
  | {
      readonly allow: false;
      readonly code: DigestRefusalCode;
      readonly facts: { readonly actual?: BackendDigest; readonly expected?: BackendDigest };
    };

/**
 * Decide a connection from what it declares and what this server's descriptor publishes. A connection that declares no expectation is not an
 * Aetheria connection and is left as it was. One that declares an expectation is allowed only by a present, matching actual digest.
 */
export function decideBackendConnection(
  declared: string | null | undefined,
  actual: unknown,
): ConnectionDecision {
  if (declared === undefined || declared === null) return { allow: true, aetheria: false };
  const expected = digestFromDeclaration(declared);
  if (expected === undefined)
    return { allow: false, code: "AETHERIA_BACKEND_DIGEST_MALFORMED", facts: {} };
  const result = compareBackendDigest(actual, expected);
  switch (result.outcome) {
    case "match":
      return { allow: true, aetheria: true };
    case "mismatch":
      return {
        allow: false,
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        facts: { actual: result.actual, expected: result.expected },
      };
    case "absent":
      return { allow: false, code: "AETHERIA_BACKEND_DIGEST_ABSENT", facts: { expected } };
    default:
      return { allow: false, code: "AETHERIA_BACKEND_DIGEST_MALFORMED", facts: { expected } };
  }
}
