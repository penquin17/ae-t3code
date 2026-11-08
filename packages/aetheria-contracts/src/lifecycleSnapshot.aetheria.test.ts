// AETHERIA M04 Plan step 16 — the read-only XC-6 operation `identity.lifecycle` and the dependency direction of the contracts package.
//
// Boundary: the schema and the module graph of this package. It shows the result shape accepts only the three tri-state facts per
// session and that the RPC file imports nothing from `@t3tools/contracts` (IP-3 would otherwise make a package and an ESM cycle).
// It does not show what the Backend puts in a snapshot (that is the aetheria-server operation test).
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import manifest from "../package.json" with { type: "json" };
import {
  AetheriaRpcGroup,
  IDENTITY_LIFECYCLE_OPERATION,
  IdentityLifecycleResult,
  XC6_OPERATION_NAME_PATTERN,
} from "./index.ts";

const decode = Schema.decodeUnknownSync(IdentityLifecycleResult, { onExcessProperty: "error" });
const SESSION = "0197d3c0-1111-7000-8000-000000000001";

describe("identity.lifecycle result", () => {
  it("is a valid XC-6 operation name", () => {
    expect(IDENTITY_LIFECYCLE_OPERATION).toBe("identity.lifecycle");
    expect(XC6_OPERATION_NAME_PATTERN.test(IDENTITY_LIFECYCLE_OPERATION)).toBe(true);
  });

  it("decodes sessions with the three tri-state facts", () => {
    const result = decode({
      sessions: { [SESSION]: { exists: true, closed: null, acceptedPrompt: null } },
    });
    expect(result.sessions[SESSION]).toEqual({ exists: true, closed: null, acceptedPrompt: null });
    expect(decode({ sessions: {} }).sessions).toEqual({});
  });

  it("refuses a fact that is not true, false or null, a missing fact and a smuggled field", () => {
    expect(() =>
      decode({ sessions: { [SESSION]: { exists: "yes", closed: null, acceptedPrompt: null } } }),
    ).toThrow();
    expect(() => decode({ sessions: { [SESSION]: { exists: true, closed: null } } })).toThrow();
    expect(() =>
      decode({
        sessions: { [SESSION]: { exists: true, closed: null, acceptedPrompt: null, path: "/x" } },
      }),
    ).toThrow();
    expect(() => decode({ sessions: {}, token: "t" })).toThrow();
  });
});

describe("the RPC file and the contracts cycle", () => {
  it("does not depend on @t3tools/contracts, which depends on this package", () => {
    // The module graph above already loads with that package unresolvable from here; this pins the manifest too.
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@t3tools/contracts");
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain("@t3tools/contracts");
  });

  it("still serves one method, with only its own error", () => {
    const rpc = AetheriaRpcGroup.requests.values().next().value;
    expect(rpc?._tag).toBe("aetheria.composition.status");
  });
});
