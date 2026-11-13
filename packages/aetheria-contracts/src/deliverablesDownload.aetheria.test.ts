// AETHERIA M10 Plan step 14 (D7, D11, D12) — the contracts of the offered-paths read and of the download route: the offered ids are closed (a client never names a path), the read's reply keeps
// known, unknown and unavailable apart, no snapshot id is a browser fact, and the route's refusal codes each carry one HTTP status.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  ClientOfferedPathsPayload,
  ClientOfferedPathsResult,
  DELIVERABLE_DOWNLOAD_MAX_BYTES,
  DELIVERABLE_DOWNLOAD_PATH,
  DELIVERABLE_DOWNLOAD_REFUSAL_STATUS,
  DELIVERABLE_DOWNLOAD_SEMANTICS,
  AetheriaRpcGroup,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];
const offeredId = `off_${"d".repeat(32)}`;

describe("the offered-paths read", () => {
  it("is one method in the Aetheria group, beside the deliverables list", () => {
    expect(AETHERIA_WS_METHODS.deliverablesList).toBe("aetheria.deliverables.list");
    expect(AETHERIA_WS_METHODS.deliverablesOfferedPaths).toBe("aetheria.deliverables.offeredPaths");
    for (const tag of [
      AETHERIA_WS_METHODS.deliverablesList,
      AETHERIA_WS_METHODS.deliverablesOfferedPaths,
    ])
      expect(AetheriaRpcGroup.requests.has(tag)).toBe(true);
  });

  it("takes a thread id and nothing else: no path, session, root or actor", () => {
    const payload = decode(ClientOfferedPathsPayload);
    expect(payload({ rootThreadId: "thread-1" })).toEqual({ rootThreadId: "thread-1" });
    expect(() => payload({})).toThrow();
    expect(() => payload({ rootThreadId: "t", path: "/etc/passwd" })).toThrow();
    expect(() => payload({ rootThreadId: "t", rootSessionId: "s" })).toThrow();
  });

  it("answers known (with stable ids and labels), unknown or unavailable, and a coded failure", () => {
    const result = decode(ClientOfferedPathsResult);
    const ok = (edits: unknown) => ({ ok: true, value: { rootThreadId: "t", edits } });
    expect(
      result(ok({ status: "known", paths: [{ id: offeredId, canonicalPath: "/w/a.txt" }] })),
    ).toBeDefined();
    expect(result(ok({ status: "known", paths: [] }))).toBeDefined();
    expect(result(ok({ status: "unknown" }))).toBeDefined();
    expect(result(ok({ status: "unavailable" }))).toBeDefined();
    expect(result({ ok: false, code: "DELIVERABLES_NOT_FOUND" })).toBeDefined();
    // An id that is not an offered id, an unknown status, or a missing status are refused.
    expect(() =>
      result(ok({ status: "known", paths: [{ id: "/w/a.txt", canonicalPath: "/w/a.txt" }] })),
    ).toThrow();
    expect(() => result(ok({ status: "unknown", paths: [] }))).toThrow();
    expect(() => result(ok({ status: "maybe" }))).toThrow();
    expect(() => result(ok({}))).toThrow();
    expect(() => result({ ok: false, code: "SOMETHING_ELSE" })).toThrow();
  });
});

describe("the download route's contract", () => {
  it("has a path that carries no credential, and two semantics with current the default", () => {
    expect(DELIVERABLE_DOWNLOAD_PATH).toBe("/api/aetheria/deliverables");
    expect(DELIVERABLE_DOWNLOAD_SEMANTICS).toEqual(["current", "as-delivered"]);
    expect(DELIVERABLE_DOWNLOAD_MAX_BYTES).toBeGreaterThan(0);
  });

  it("gives every refusal code one HTTP status, authentication 401 and scope 403", () => {
    const status = DELIVERABLE_DOWNLOAD_REFUSAL_STATUS;
    expect(status.DOWNLOAD_BEARER_REQUIRED).toBe(401);
    expect(status.DOWNLOAD_UNAUTHENTICATED).toBe(401);
    expect(status.DOWNLOAD_NOT_AUTHORIZED).toBe(403);
    expect(status.DOWNLOAD_NOT_FOUND).toBe(404);
    expect(status.DOWNLOAD_TOO_LARGE).toBe(413);
    expect(status.DOWNLOAD_UNAVAILABLE).toBe(503);
    for (const code of Object.keys(status)) expect(code).toMatch(/^DOWNLOAD_[A-Z_]+$/);
    for (const value of Object.values(status)) expect(value).toBeGreaterThanOrEqual(400);
  });
});
