// M11 step 19 (C6 U3): the schemas and Rpc definitions of `aetheria.inspect.requests` / `.reply`, decoded as the server does (`onExcessProperty: "error"`): closed shapes, any extra key refused,
// an empty subscription, region-id spelling equal to the declared-region contract's, strict annotations, classified codes.
// Not shown: the joined group, T3's scope middleware, handlers or behaviour (apps/server inspectRpc/inspectIsolation tests).
import { describe, expect, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcSchema from "effect/rpc/RpcSchema";

import {
  AetheriaInspectRpcGroup,
  INSPECT_CLIENT_CODE_CLASSES,
  INSPECT_CLIENT_METHODS,
  InspectClientRequest,
  InspectReplyPayload,
  InspectReplyResult,
  InspectRequestsPayload,
} from "./inspectClient.ts";
import { RegionDescriptor } from "./regionsOperations.ts";

const strict = <S extends Schema.Top>(schema: S) => {
  const decode = Schema.decodeUnknownSync(schema as never, { onExcessProperty: "error" });
  return (input: unknown) => decode(input);
};
const decodeRequest = strict(InspectClientRequest);
const decodeReply = strict(InspectReplyPayload);
const decodeResult = strict(InspectReplyResult);
const decodeRequests = strict(InspectRequestsPayload);

const request = {
  requestId: "req-1",
  regionId: "conversation.running",
  schemaVersion: 1,
  remainingMs: 9_000,
};

describe("the request to a page", () => {
  it("decodes the closed shape and refuses any other key, bad id or non-positive number", () => {
    expect(decodeRequest(request)).toEqual(request);
    for (const extra of ["principal", "threadId", "clientId", "actor", "connectionId", "call"])
      expect(() => decodeRequest({ ...request, [extra]: "x" })).toThrow();
    for (const bad of [
      { regionId: "Bad Id" },
      { regionId: "x".repeat(65) },
      { requestId: "" },
      { requestId: "has space" },
      { schemaVersion: 0 },
      { remainingMs: -1 },
      { remainingMs: 1.5 },
    ])
      expect(() => decodeRequest({ ...request, ...bad })).toThrow();
  });

  it("spells a region id exactly as the declared-region contract does", () => {
    const declared = Schema.decodeUnknownOption(RegionDescriptor as never);
    const base = {
      kind: "region",
      owner: "ui",
      parent: null,
      description: "d",
      schemaVersion: 1,
      props: [],
      state: [],
      tokens: [],
    };
    for (const id of [
      "shell",
      "a.b-c",
      "A",
      "a..b",
      "1a",
      "a.",
      "x".repeat(64),
      "x".repeat(65),
      "a_b",
    ]) {
      const asDescriptor = declared({ ...base, id })._tag === "Some";
      const asRequest = (() => {
        try {
          decodeRequest({ ...request, regionId: id });
          return true;
        } catch {
          return false;
        }
      })();
      expect([id, asRequest]).toEqual([id, asDescriptor]);
    }
  });
});

describe("the page's reply", () => {
  const ok = {
    requestId: "req-1",
    outcome: "ok",
    state: "active",
    shape: { id: "x" },
    values: { "props.title": "T" },
  };

  it("decodes an ok reply with plain shape and values, and each of the three outcomes only the page knows", () => {
    expect(decodeReply(ok)).toEqual(ok);
    expect(decodeReply({ ...ok, state: "inactive", values: {} })).toMatchObject({
      state: "inactive",
    });
    for (const outcome of ["region-not-found", "schema-unsupported", "unavailable"])
      expect(decodeReply({ requestId: "req-1", outcome })).toEqual({ requestId: "req-1", outcome });
  });

  it("refuses an extra key at the top, an outcome the Backend owns, a missing correlation id and a payload on an empty outcome", () => {
    for (const extra of ["principal", "threadId", "clientId", "actor", "sessionId", "connectionId"])
      expect(() => decodeReply({ ...ok, [extra]: "x" })).toThrow();
    for (const bad of [
      { ...ok, outcome: "no-client" },
      { ...ok, outcome: "timeout" },
      { ...ok, state: "failed" },
      { ...ok, values: "not-a-record" },
      { outcome: "region-not-found" },
      { requestId: "req-1", outcome: "region-not-found", values: {} },
      { requestId: "req-1", outcome: "ok", state: "active", shape: {} },
    ])
      expect(() => decodeReply(bad)).toThrow();
  });

  it("answers accepted or a coded refusal, and classifies every code", () => {
    expect(decodeResult({ ok: true, value: { accepted: false } })).toEqual({
      ok: true,
      value: { accepted: false },
    });
    for (const code of Object.keys(INSPECT_CLIENT_CODE_CLASSES))
      expect(decodeResult({ ok: false, code, detail: "d" })).toMatchObject({ ok: false, code });
    expect(() => decodeResult({ ok: false, code: "SOMETHING_ELSE" })).toThrow();
    expect(() => decodeResult({ ok: true, value: { accepted: true, extra: 1 } })).toThrow();
    expect(
      Object.values(INSPECT_CLIENT_CODE_CLASSES).every((c) => c === "refusal" || c === "failure"),
    ).toBe(true);
  });
});

describe("the subscription and the group", () => {
  it("takes no field: the empty payload decodes and any key is refused", () => {
    expect(decodeRequests({})).toEqual({});
    expect(() => decodeRequests({ clientId: "client-aaaaaaaaaaaaaaaa" })).toThrow();
    expect(() => decodeRequests({ threadId: "t" })).toThrow();
  });

  it("holds exactly two strict methods, the request one a stream, with the names the server and the page use", () => {
    expect([...AetheriaInspectRpcGroup.requests.keys()].toSorted()).toEqual([
      "aetheria.inspect.reply",
      "aetheria.inspect.requests",
    ]);
    expect(INSPECT_CLIENT_METHODS).toEqual({
      requests: "aetheria.inspect.requests",
      reply: "aetheria.inspect.reply",
    });
    for (const rpc of AetheriaInspectRpcGroup.requests.values()) {
      expect(Context.get(rpc.annotations, Rpc.ParseOptions)).toEqual({
        onExcessProperty: "error",
      });
    }
    const streamed = (tag: string) =>
      RpcSchema.isStreamSchema(AetheriaInspectRpcGroup.requests.get(tag)!.successSchema);
    expect(streamed("aetheria.inspect.requests")).toBe(true);
    expect(streamed("aetheria.inspect.reply")).toBe(false);
  });
});
