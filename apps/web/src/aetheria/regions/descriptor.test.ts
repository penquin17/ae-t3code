// AETHERIA M10 step 23 (D17, XC-19): authoring a region declaration. The registry's one descriptor is the contract's `RegionDescriptor`; this layer only fills the defaults an author may omit
// (a field reports its shape unless it says value, the schema version is 1) and refuses what the contract cannot see: a token the design package does not list, and a schema version this client
// does not speak.
import { tokenNames } from "@t3tools/aetheria-design";
import { describe, expect, it } from "vite-plus/test";

import { checkDeclaration, declareRegion } from "./descriptor";

const base = {
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: "shell",
  description: "The running state of the open conversation",
} as const;

describe("a declaration becomes the contract's descriptor", () => {
  it("defaults the schema version to 1 and every omitted list to empty", () => {
    const result = checkDeclaration(base);
    expect(result).toEqual({
      ok: true,
      descriptor: { ...base, schemaVersion: 1, props: [], state: [], tokens: [] },
    });
  });

  it("defaults a field with no report rule to shape-only, and keeps an explicit value rule", () => {
    const result = checkDeclaration({
      ...base,
      props: [{ name: "threadKey", type: "string" }],
      state: [{ name: "phase", type: "string", report: "value" }],
    });
    expect(result.ok && result.descriptor.props).toEqual([
      { name: "threadKey", type: "string", report: "shape" },
    ]);
    expect(result.ok && result.descriptor.state).toEqual([
      { name: "phase", type: "string", report: "value" },
    ]);
  });

  it("accepts the design package's token names and refuses any other", () => {
    const known = tokenNames[0]!;
    expect(checkDeclaration({ ...base, tokens: [known] }).ok).toBe(true);
    expect(checkDeclaration({ ...base, tokens: ["--ae-no-such-token"] })).toMatchObject({
      ok: false,
      code: "unknown-token",
    });
    expect(checkDeclaration({ ...base, tokens: ["--t3-raw"] })).toMatchObject({
      ok: false,
      code: "unknown-token",
    });
  });

  it("answers schema-unsupported for a version this client does not speak, never a silent downgrade", () => {
    expect(checkDeclaration({ ...base, schemaVersion: 2 })).toMatchObject({
      ok: false,
      code: "schema-unsupported",
    });
    expect(checkDeclaration({ ...base, schemaVersion: 1 }).ok).toBe(true);
  });

  it("refuses what the contract refuses, with its reason", () => {
    for (const bad of [
      { ...base, id: "Not.An.Id" },
      { ...base, kind: "page" },
      { ...base, parent: base.id },
      { ...base, description: "" },
      { ...base, props: [{ name: "a", type: "bigint" }] },
    ])
      expect(checkDeclaration(bad as never)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("fails fast when a module declares a bad region, so a build or test run stops there", () => {
    expect(() => declareRegion({ ...base, tokens: ["--ae-no-such-token"] })).toThrow(
      /unknown-token/,
    );
    expect(declareRegion(base).id).toBe("conversation.running");
  });

  it("does not let a declaration carry a value for a field: the descriptor has no such place", () => {
    const result = checkDeclaration({
      ...base,
      props: [{ name: "a", type: "string", report: "shape", value: "leak" } as never],
    });
    expect(result.ok).toBe(false);
  });
});
