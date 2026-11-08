// AETHERIA M04 Plan step 15 (B5) — the composition digest on the server's side of a connection, tested at its pure boundary.
//
// What this shows: `compareBackendDigest` and `decideBackendConnection` (the one comparison rule) over every outcome, and that a refusal carries only
// safe facts. The descriptor, the ws upgrade and the XC-6 route that apply this rule are checked in their own tests.
import { describe, expect, it } from "@effect/vitest";

import {
  EXPECTED_BACKEND_DIGEST_HEADER,
  EXPECTED_BACKEND_DIGEST_QUERY,
  compareBackendDigest,
  decideBackendConnection,
  digestFromDeclaration,
} from "./backendDigest.ts";

const v = `sha256:${"a".repeat(64)}`;
const w = `sha256:${"b".repeat(64)}`;
const digest = (value: string) => ({ version: 1, algorithm: "sha256", value }) as const;

describe("compareBackendDigest", () => {
  it("matches only an equal, well-formed digest", () => {
    expect(compareBackendDigest(digest(v), digest(v))).toEqual({ outcome: "match" });
  });

  it("refuses a different digest, reporting both sides' digest/version facts and nothing else", () => {
    expect(compareBackendDigest(digest(w), digest(v))).toEqual({
      outcome: "mismatch",
      actual: digest(w),
      expected: digest(v),
    });
    expect(compareBackendDigest({ ...digest(v), version: 2 }, digest(v)).outcome).toBe("mismatch");
  });

  it("treats an absent digest as absent, not as compatible", () => {
    expect(compareBackendDigest(undefined, digest(v))).toEqual({ outcome: "absent" });
    expect(compareBackendDigest(null, digest(v))).toEqual({ outcome: "absent" });
  });

  it("refuses a malformed digest without echoing it", () => {
    const bad = [
      {},
      "x",
      7,
      { version: 1, algorithm: "md5", value: v },
      { version: 1, algorithm: "sha256", value: "sha256:zz" },
      { version: 1.5, algorithm: "sha256", value: v },
      { ...digest(v), extra: "/home/user/.secret" },
    ];
    for (const value of bad) {
      const result = compareBackendDigest(value, digest(v));
      expect(result).toEqual({ outcome: "malformed" });
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  it("refuses when the EXPECTED digest is itself unusable", () => {
    expect(compareBackendDigest(digest(v), undefined)).toEqual({ outcome: "expected-invalid" });
    expect(
      compareBackendDigest(digest(v), { version: 1, algorithm: "sha256", value: "nope" }),
    ).toEqual({ outcome: "expected-invalid" });
  });
});

describe("digestFromDeclaration", () => {
  it("reads the digest-v1 value a peer declares", () => {
    expect(digestFromDeclaration(v)).toEqual(digest(v));
  });
  it("does not accept anything but sha256:<64 hex>", () => {
    for (const bad of [
      "",
      "sha256:short",
      `md5:${"a".repeat(64)}`,
      ` ${v}`,
      `${v}\n`,
      "[object Object]",
    ])
      expect(digestFromDeclaration(bad)).toBeUndefined();
  });
  it("names the transport fields once", () => {
    expect(EXPECTED_BACKEND_DIGEST_HEADER).toBe("x-aetheria-expected-backend-digest");
    expect(EXPECTED_BACKEND_DIGEST_QUERY).toBe("aetheriaExpectedBackendDigest");
  });
});

describe("decideBackendConnection", () => {
  it("leaves a connection that declares no expectation untouched (bare T3 and bare clients)", () => {
    expect(decideBackendConnection(undefined, digest(v))).toEqual({ allow: true, aetheria: false });
    expect(decideBackendConnection(undefined, undefined)).toEqual({ allow: true, aetheria: false });
  });

  it("allows an Aetheria connection whose declared expected digest equals the Backend's actual digest", () => {
    expect(decideBackendConnection(v, digest(v))).toEqual({ allow: true, aetheria: true });
  });

  it("refuses a declared expectation the Backend does not meet: mismatch, absent Backend digest, malformed declaration", () => {
    expect(decideBackendConnection(w, digest(v))).toEqual({
      allow: false,
      code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
      facts: { actual: digest(v), expected: digest(w) },
    });
    expect(decideBackendConnection(v, undefined)).toEqual({
      allow: false,
      code: "AETHERIA_BACKEND_DIGEST_ABSENT",
      facts: { expected: digest(v) },
    });
    expect(decideBackendConnection("garbage /etc/passwd", digest(v))).toEqual({
      allow: false,
      code: "AETHERIA_BACKEND_DIGEST_MALFORMED",
      facts: {},
    });
    expect(decideBackendConnection("", digest(v))).toEqual({
      allow: false,
      code: "AETHERIA_BACKEND_DIGEST_MALFORMED",
      facts: {},
    });
  });
});
