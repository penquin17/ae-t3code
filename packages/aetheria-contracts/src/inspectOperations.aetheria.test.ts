// AETHERIA M11 Plan step 6: the strict inspect contracts against the shared vectors (the outer codecs of @aetheria/inspect decode the same file). Each `accept` vector decodes
// unchanged and each `refuse` vector throws under `onExcessProperty: "error"`; no request admits a caller, session, root, thread, actor or composition claim; the vocabulary is
// exactly two operations, five states, ten outcomes and three omission reasons; an inspect exchange has no `pending`, `error` or poll. The Backend service, providers and
// transport are later steps and are not exercised here.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  INSPECT_CODE_CLASSES,
  INSPECT_HOSTS,
  INSPECT_OMISSION_REASONS,
  INSPECT_OPERATIONS,
  INSPECT_OUTCOMES,
  INSPECT_STATES,
  InspectCarrierReply,
  InspectListArgs,
  InspectListResult,
  InspectQueryArgs,
  InspectQueryResult,
} from "./inspectOperations.ts";
import { inspectForbiddenArgumentKeys, inspectVectors } from "./inspectOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = (schema: unknown, value: unknown) =>
  Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict)(value);

const SCHEMAS = {
  inspectListArgs: InspectListArgs,
  inspectQueryArgs: InspectQueryArgs,
  inspectListResult: InspectListResult,
  inspectQueryResult: InspectQueryResult,
  inspectCarrierReply: InspectCarrierReply,
} as const;

/** The carrier vector is `{op, reply}`: the schema decodes the reply, and a `done` result must be the one the named operation returns. */
const decodeVector = (set: string, schema: unknown, value: unknown): unknown => {
  if (set !== "inspectCarrierReply") return decode(schema, value);
  const { op, reply } = value as { op: string; reply: unknown };
  const decoded = decode(InspectCarrierReply, reply) as { status: string; result?: unknown };
  if (decoded.status === "done") {
    decode(op === "inspect.list" ? InspectListResult : InspectQueryResult, decoded.result);
  }
  return decoded;
};
const expected = (set: string, value: unknown) =>
  set === "inspectCarrierReply" ? (value as { reply: unknown }).reply : value;

describe("inspect operations", () => {
  it("has exactly the designed vocabulary", () => {
    expect([...INSPECT_OPERATIONS]).toEqual(["inspect.list", "inspect.query"]);
    expect([...INSPECT_HOSTS]).toEqual(["agent", "backend", "client"]);
    expect([...INSPECT_STATES]).toEqual(["active", "inactive", "unsupported", "failed", "absent"]);
    expect(INSPECT_OUTCOMES).toHaveLength(10);
    expect(INSPECT_OUTCOMES).not.toContain("pending");
    expect([...INSPECT_OMISSION_REASONS]).toEqual(["secret", "not-allowed", "credential-store"]);
    expect(Object.keys(INSPECT_CODE_CLASSES).sort()).toEqual([
      "INSPECT_FORBIDDEN",
      "INSPECT_INVALID",
      "INSPECT_PROVIDER_FAILED",
      "INSPECT_READONLY",
      "INSPECT_UNAVAILABLE",
      "INSPECT_UNKNOWN_PROVIDER",
    ]);
  });

  it("has a schema for every vector set and vectors for every schema", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(inspectVectors).sort());
    for (const [name, set] of Object.entries(inspectVectors)) {
      expect(set.accept.length, name).toBeGreaterThanOrEqual(4);
      expect(set.refuse.length, name).toBeGreaterThanOrEqual(8);
      const names = [...set.accept, ...set.refuse].map((v) => v.name);
      expect(new Set(names).size, `${name}: vector names are unique`).toBe(names.length);
    }
  });

  describe.each(Object.entries(SCHEMAS))("%s", (name, schema) => {
    const set = inspectVectors[name as keyof typeof inspectVectors];
    it.each(set.accept.map((v) => [v.name, v.value] as const))(
      "accepts %s unchanged",
      (_title, original) => {
        const value = structuredClone(original);
        expect(decodeVector(name, schema, value)).toEqual(expected(name, value));
      },
    );
    it.each(set.refuse.map((v) => [v.name, v.value] as const))("refuses %s", (_title, original) => {
      expect(() => decodeVector(name, schema, structuredClone(original))).toThrow();
    });
  });

  it("refuses a request that names a caller, session, root, thread, actor or composition, under every forbidden key", () => {
    expect(inspectForbiddenArgumentKeys.length).toBeGreaterThanOrEqual(18);
    for (const key of inspectForbiddenArgumentKeys) {
      expect(() => decode(InspectListArgs, { [key]: "x" }), `list/${key}`).toThrow();
      expect(
        () => decode(InspectQueryArgs, { providerId: "config", targetId: "t", [key]: "x" }),
        `query/${key}`,
      ).toThrow();
    }
  });

  it("refuses a payload on every outcome that carries none", () => {
    const at = "2026-11-15T12:00:00.000Z";
    for (const outcome of INSPECT_OUTCOMES.filter((o) => o !== "ok" && o !== "truncated")) {
      expect(() => decode(InspectListResult, { outcome, capturedAt: at, entries: [] })).toThrow();
      if (outcome !== "ambiguous") {
        const base = { outcome, capturedAt: at, providerId: "p", targetId: "t" };
        expect(decode(InspectQueryResult, base)).toEqual(base);
        expect(() => decode(InspectQueryResult, { ...base, shape: [] })).toThrow();
      }
    }
  });

  it("has no carrier pending, error or poll in an inspect exchange", () => {
    for (const reply of [
      { v: 1, status: "pending", token: "t" },
      { v: 1, status: "error", code: "X" },
      { v: 1, poll: "t" },
    ]) {
      expect(() => decode(InspectCarrierReply, reply)).toThrow();
    }
  });
});
