// AETHERIA M10 Plan step 23 (D17, R3, XC-19): the strict client contracts for the declared region registry — the region descriptor, the client's report of which regions are mounted and visible,
// and the read of what the Backend holds for this connection. A payload carries no principal, session or "viewing" field: the Backend binds the principal to the connection and observes the viewed session itself.
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaRegionsRpcGroup,
  AetheriaRpcGroup,
  REGIONS_CODE_CLASSES,
  REGIONS_MAX_DESCRIPTION,
  REGIONS_MAX_FIELDS,
  REGIONS_MAX_REGIONS,
  REGIONS_MAX_TOKENS,
  REGIONS_SCHEMA_VERSION,
  RegionDescriptor,
  RegionsReadPayload,
  RegionsReadResult,
  RegionsReportPayload,
  RegionsReportResult,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];
const refuses = <S extends Schema.Top>(schema: S, input: unknown) =>
  expect(() => decode(schema)(input)).toThrow();

const descriptor = {
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: "shell",
  description: "The running state of the open conversation",
  schemaVersion: 1,
  props: [{ name: "threadKey", type: "string", report: "shape" }],
  state: [{ name: "phase", type: "string", report: "value" }],
  tokens: ["--ae-color-accent"],
} as const;

const report = {
  clientId: "c-0123456789abcdef",
  sequence: 1,
  regions: [{ descriptor, visible: true }],
} as const;

describe("the region registry methods", () => {
  it("adds aetheria.regions.report and aetheria.regions.read to the joined group, in method order", () => {
    expect(AETHERIA_WS_METHODS).toMatchObject({
      regionsReport: "aetheria.regions.report",
      regionsRead: "aetheria.regions.read",
    });
    expect([...AetheriaRegionsRpcGroup.requests.keys()]).toEqual([
      "aetheria.regions.report",
      "aetheria.regions.read",
    ]);
    expect([...AetheriaRpcGroup.requests.keys()]).toEqual(Object.values(AETHERIA_WS_METHODS));
  });

  it("states the limits the Backend and the web client share", () => {
    expect(REGIONS_SCHEMA_VERSION).toBe(1);
    expect(REGIONS_MAX_REGIONS).toBe(64);
    expect(REGIONS_MAX_FIELDS).toBe(32);
    expect(REGIONS_MAX_TOKENS).toBe(32);
    expect(REGIONS_MAX_DESCRIPTION).toBe(200);
  });

  it("gives every code a class and has no write-unknown code: a report is a whole replacement, so a lost reply is repeated safely", () => {
    expect(Object.keys(REGIONS_CODE_CLASSES).toSorted()).toEqual([
      "REGIONS_CLIENT_CONFLICT",
      "REGIONS_DEVICE_REVOKED",
      "REGIONS_INVALID_REPORT",
      "REGIONS_NOT_AUTHORIZED",
      "REGIONS_RATE_LIMITED",
      "REGIONS_SCHEMA_UNSUPPORTED",
      "REGIONS_STALE",
      "REGIONS_TOO_LARGE",
      "REGIONS_UNAVAILABLE",
    ]);
  });
});

describe("the declared region descriptor", () => {
  it("accepts a full descriptor and a root descriptor with no parent, props, state or tokens", () => {
    expect(decode(RegionDescriptor)(descriptor)).toEqual(descriptor);
    const root = {
      id: "shell",
      kind: "screen",
      owner: "aetheria-ui",
      parent: null,
      description: "The app shell",
      schemaVersion: 1,
      props: [],
      state: [],
      tokens: [],
    };
    expect(decode(RegionDescriptor)(root)).toEqual(root);
  });

  it("admits every kind and only those", () => {
    for (const kind of ["screen", "panel", "region", "control-group"])
      expect(decode(RegionDescriptor)({ ...descriptor, kind }).kind).toBe(kind);
    refuses(RegionDescriptor, { ...descriptor, kind: "page" });
  });

  it("refuses an id that is not a stable dotted name, a parent that is not an id, and an unknown key", () => {
    for (const id of ["", "Shell", "a..b", ".a", "a.", "a b", "a/b", "1a", "x".repeat(65)])
      refuses(RegionDescriptor, { ...descriptor, id });
    refuses(RegionDescriptor, { ...descriptor, parent: "Not An Id" });
    refuses(RegionDescriptor, { ...descriptor, secret: "x" });
    refuses(RegionDescriptor, { ...descriptor, parent: descriptor.id });
  });

  it("keeps a schema version a number, so the Backend can answer schema-unsupported instead of failing to decode", () => {
    expect(decode(RegionDescriptor)({ ...descriptor, schemaVersion: 7 }).schemaVersion).toBe(7);
    refuses(RegionDescriptor, { ...descriptor, schemaVersion: 0 });
    refuses(RegionDescriptor, { ...descriptor, schemaVersion: "1" });
  });

  it("requires every field to say what it reports, value or shape; the default shape is the web registry's, never implied on the wire", () => {
    refuses(RegionDescriptor, { ...descriptor, props: [{ name: "a", type: "string" }] });
    refuses(RegionDescriptor, {
      ...descriptor,
      props: [{ name: "a", type: "string", report: "all" }],
    });
    refuses(RegionDescriptor, {
      ...descriptor,
      props: [{ name: "a", type: "string", report: "shape", value: "leak" }],
    });
  });

  it("bounds names, types, field counts, duplicates, tokens and the description", () => {
    refuses(RegionDescriptor, {
      ...descriptor,
      props: [{ name: "", type: "string", report: "shape" }],
    });
    refuses(RegionDescriptor, {
      ...descriptor,
      props: [{ name: "a", type: "bigint", report: "shape" }],
    });
    const many = Array.from({ length: REGIONS_MAX_FIELDS + 1 }, (_, i) => ({
      name: `f${i}`,
      type: "string",
      report: "shape",
    }));
    refuses(RegionDescriptor, { ...descriptor, props: many });
    refuses(RegionDescriptor, { ...descriptor, state: many });
    expect(
      decode(RegionDescriptor)({ ...descriptor, props: many.slice(0, REGIONS_MAX_FIELDS) }).props,
    ).toHaveLength(REGIONS_MAX_FIELDS);
    const twice = { name: "a", type: "string", report: "shape" };
    refuses(RegionDescriptor, { ...descriptor, props: [twice, twice] });
    refuses(RegionDescriptor, { ...descriptor, tokens: ["color-accent"] });
    refuses(RegionDescriptor, { ...descriptor, tokens: ["--ae-a", "--ae-a"] });
    refuses(RegionDescriptor, {
      ...descriptor,
      tokens: Array.from({ length: REGIONS_MAX_TOKENS + 1 }, (_, i) => `--ae-t${i}`),
    });
    refuses(RegionDescriptor, {
      ...descriptor,
      description: "x".repeat(REGIONS_MAX_DESCRIPTION + 1),
    });
    refuses(RegionDescriptor, { ...descriptor, description: "" });
  });
});

describe("the client's report of its mounted regions", () => {
  it("accepts one whole replacement: a client id, a rising sequence and every mounted region with its visibility", () => {
    expect(decode(RegionsReportPayload)(report)).toEqual(report);
    const empty = { clientId: report.clientId, sequence: 2, regions: [] };
    expect(decode(RegionsReportPayload)(empty)).toEqual(empty);
  });

  it("carries no principal, session, viewing or value field: the Backend binds and observes those itself", () => {
    for (const extra of [
      { principal: "someone" },
      { subject: "someone" },
      { sessionId: "s1" },
      { threadId: "t1" },
      { viewing: "s1" },
      { viewing: ["s1"] },
      { deviceSessionId: "d1" },
    ])
      refuses(RegionsReportPayload, { ...report, ...extra });
    refuses(RegionsReportPayload, {
      ...report,
      regions: [{ descriptor, visible: true, value: "leak" }],
    });
  });

  it("refuses a client id that is not an opaque random token, a sequence that is not a positive integer, a missing visibility and a duplicate region", () => {
    for (const clientId of ["", "short", "has space in it 0123", "x".repeat(129)])
      refuses(RegionsReportPayload, { ...report, clientId });
    for (const sequence of [0, -1, 1.5, Number.NaN, "1"])
      refuses(RegionsReportPayload, { ...report, sequence });
    refuses(RegionsReportPayload, { ...report, regions: [{ descriptor }] });
    refuses(RegionsReportPayload, {
      ...report,
      regions: [
        { descriptor, visible: true },
        { descriptor, visible: false },
      ],
    });
  });

  it("holds at most the region cap", () => {
    const at = (n: number) => ({
      ...report,
      regions: Array.from({ length: n }, (_, i) => ({
        descriptor: { ...descriptor, id: `r.n${i}`, parent: null },
        visible: false,
      })),
    });
    expect(decode(RegionsReportPayload)(at(REGIONS_MAX_REGIONS)).regions).toHaveLength(
      REGIONS_MAX_REGIONS,
    );
    refuses(RegionsReportPayload, at(REGIONS_MAX_REGIONS + 1));
  });

  it("replies with what the Backend now holds, or a coded refusal; nothing else", () => {
    const held = {
      ok: true,
      value: {
        clientId: report.clientId,
        sequence: 1,
        regions: [{ id: "conversation.running", visible: true }],
        viewing: ["thread-1"],
      },
    };
    expect(decode(RegionsReportResult)(held)).toEqual(held);
    expect(decode(RegionsReportResult)({ ok: false, code: "REGIONS_STALE", detail: "x" })).toEqual({
      ok: false,
      code: "REGIONS_STALE",
      detail: "x",
    });
    refuses(RegionsReportResult, { ok: false, code: "REGIONS_MADE_UP" });
    refuses(RegionsReportResult, { ok: true });
  });
});

describe("the read of this connection's own client", () => {
  it("reads with an empty payload and replies with the stored client, or a known none", () => {
    expect(decode(RegionsReadPayload)({})).toEqual({});
    const none = { ok: true, value: { client: null } };
    expect(decode(RegionsReadResult)(none)).toEqual(none);
    const some = {
      ok: true,
      value: {
        client: {
          clientId: report.clientId,
          sequence: 3,
          regions: [
            {
              id: "shell",
              kind: "screen",
              owner: "aetheria-ui",
              parent: null,
              schemaVersion: 1,
              visible: true,
            },
          ],
          viewing: [],
        },
      },
    };
    expect(decode(RegionsReadResult)(some)).toEqual(some);
    refuses(RegionsReadResult, { ok: true, value: {} });
  });
});

// The wire. T3's RPC server decodes a payload with the parse options its Rpc carries (`Rpc.ParseOptions`); an Rpc that names none ignores an unknown key and drops it. The cases below decode as the server does: with the options
// read off the Rpc definition in the joined group, not with options written here, so they show what the wire applies.
describe("the wire decode refuses what the contract says a strict decode refuses (M10 slice-2 finding)", () => {
  const wire = (tag: string, schema: Schema.Top) => {
    const rpc = AetheriaRpcGroup.requests.get(tag);
    if (rpc === undefined) throw new Error(`${tag} is not in the group`);
    const options = Context.get(rpc.annotations, Rpc.ParseOptions);
    return (input: unknown) => Schema.decodeUnknownSync(schema as never, options)(input);
  };
  const wireReport = wire(AETHERIA_WS_METHODS.regionsReport, RegionsReportPayload);

  it("names the strict option on both region Rpcs", () => {
    for (const tag of [AETHERIA_WS_METHODS.regionsReport, AETHERIA_WS_METHODS.regionsRead])
      expect(
        Context.get(AetheriaRpcGroup.requests.get(tag)!.annotations, Rpc.ParseOptions)
          .onExcessProperty,
      ).toBe("error");
  });

  it("decodes a valid report as before", () => {
    expect(wireReport(report)).toEqual(report);
    expect(wireReport({ clientId: report.clientId, sequence: 2, regions: [] })).toEqual({
      clientId: report.clientId,
      sequence: 2,
      regions: [],
    });
  });

  it("refuses a report that carries a principal, a viewing, a value or any unknown key, at the top", () => {
    for (const extra of [
      { principal: { subject: "bob" } },
      { viewing: ["thread-1"] },
      { value: "leak" },
      { unknown: 1 },
    ])
      expect(() => wireReport({ ...report, ...extra })).toThrow();
  });

  it("refuses an unknown key inside a region entry, its descriptor and a declared field", () => {
    expect(() =>
      wireReport({ ...report, regions: [{ descriptor, visible: true, value: "leak" }] }),
    ).toThrow();
    expect(() =>
      wireReport({
        ...report,
        regions: [{ descriptor: { ...descriptor, principal: "bob" }, visible: true }],
      }),
    ).toThrow();
    expect(() =>
      wireReport({
        ...report,
        regions: [
          {
            descriptor: {
              ...descriptor,
              props: [{ name: "a", type: "string", report: "value", value: "leak" }],
            },
            visible: true,
          },
        ],
      }),
    ).toThrow();
  });
});
