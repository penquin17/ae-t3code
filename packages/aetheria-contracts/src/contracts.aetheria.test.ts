// AETHERIA M04 Plan step 12: the wire shapes Aetheria adds beside T3's contracts — the XC-6 operation envelope and the read-only
// composition/lifecycle status. These tests check the schemas at their own boundary (what decodes, what is refused); the Backend that
// fills them is tested in @t3tools/aetheria-server, and the RPC join is step 16.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaCompositionStatus,
  AetheriaCompositionStatusRpc,
  AetheriaRpcGroup,
  XC6_OPERATION_NAME_PATTERN,
  XC6_VERSION,
  Xc6Reply,
  Xc6Request,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decodeReply = Schema.decodeUnknownSync(Xc6Reply, strict);
const decodeRequest = Schema.decodeUnknownSync(Xc6Request, strict);
const decodeStatus = Schema.decodeUnknownSync(AetheriaCompositionStatus, strict);

const status = {
  composition: "aetheria-backend",
  host: "backend",
  phase: "running",
  digest: { version: 1, algorithm: "sha256", value: `sha256:${"a".repeat(64)}` },
  artifact: { package: "@aetheria/awareness", version: "0.1.0", stamp: `sha256:${"b".repeat(64)}` },
  activationOrder: ["agent-awareness-backend"],
  modules: [{ id: "agent-awareness-backend", required: true, state: "running" }],
  disposal: null,
} as const;

describe("XC-6 operation envelope", () => {
  it("decodes a call and a poll, and refuses anything else", () => {
    expect(decodeRequest({ v: 1, op: "board.read", args: { x: 1 } })).toEqual({
      v: 1,
      op: "board.read",
      args: { x: 1 },
    });
    expect(decodeRequest({ v: 1, op: "board.read" })).toEqual({ v: 1, op: "board.read" });
    expect(decodeRequest({ v: 1, poll: "token" })).toEqual({ v: 1, poll: "token" });
    expect(() => decodeRequest({ v: 2, op: "board.read" })).toThrow();
    expect(() => decodeRequest({ v: 1, op: "Board Read" })).toThrow();
    expect(() => decodeRequest({ v: 1, op: "board.read", sessionId: "s1" })).toThrow();
    expect(() => decodeRequest({ v: 1, poll: "" })).toThrow();
    expect(() => decodeRequest({ v: 1 })).toThrow();
  });

  it("is version 1, in requests and replies alike", () => {
    expect(XC6_VERSION).toBe(1);
    expect(decodeRequest({ v: XC6_VERSION, poll: "t" }).v).toBe(1);
  });

  it("names operations with one pattern", () => {
    expect(XC6_OPERATION_NAME_PATTERN.test("board.read")).toBe(true);
    expect(XC6_OPERATION_NAME_PATTERN.test("../x")).toBe(false);
    expect(XC6_OPERATION_NAME_PATTERN.test("")).toBe(false);
  });

  it("carries the five explicit replies and no sixth", () => {
    expect(decodeReply({ v: 1, status: "done", result: { ok: true } }).status).toBe("done");
    expect(decodeReply({ v: 1, status: "pending", token: "t" }).status).toBe("pending");
    expect(decodeReply({ v: 1, status: "unavailable", code: "XC6_NOT_RUNNING" }).status).toBe(
      "unavailable",
    );
    expect(decodeReply({ v: 1, status: "refused", code: "XC6_BAD_REQUEST" }).status).toBe(
      "refused",
    );
    expect(decodeReply({ v: 1, status: "error", code: "XC6_INTERNAL" }).status).toBe("error");
    expect(() => decodeReply({ v: 1, status: "maybe", code: "x" })).toThrow();
    expect(() => decodeReply({ v: 1, status: "pending" })).toThrow();
    expect(() => decodeReply({ v: 1, status: "unavailable" })).toThrow();
  });
});

describe("composition and lifecycle status", () => {
  it("decodes the safe status of a running Backend", () => {
    expect(decodeStatus(status).phase).toBe("running");
  });

  it("decodes a disposed Backend with a disposal summary that carries counts and module ids only", () => {
    const disposed = {
      ...status,
      phase: "disposed",
      disposal: {
        ok: false,
        order: ["agent-awareness-backend"],
        released: 1,
        stopped: 0,
        transferred: 0,
        stillLive: 1,
        failedModules: [],
        unobservedModules: [],
      },
    };
    expect(decodeStatus(disposed).disposal?.stillLive).toBe(1);
  });

  it("refuses a status that smuggles a field the safe shape does not name", () => {
    expect(() =>
      decodeStatus({
        ...status,
        modules: [{ id: "m", required: true, state: "failed", failure: "ENOENT /Users/x/secret" }],
      }),
    ).toThrow();
    expect(() => decodeStatus({ ...status, phase: "exploding" })).toThrow();
    expect(() =>
      decodeStatus({ ...status, digest: { ...status.digest, value: "md5:abc" } }),
    ).toThrow();
  });
});

describe("the namespaced RPC", () => {
  it("joins the read-only status method first, then the XC-18 methods, all under the aetheria. namespace", () => {
    // The XC-18 methods (M06) are declared in AetheriaInteractionRpcGroup (checked in interactionOperations.aetheria.test.ts) and merged here.
    expect(Object.values(AETHERIA_WS_METHODS)[0]).toBe("aetheria.composition.status");
    for (const tag of Object.values(AETHERIA_WS_METHODS))
      expect(tag.startsWith("aetheria.")).toBe(true);
    expect(AetheriaCompositionStatusRpc._tag).toBe(AETHERIA_WS_METHODS.compositionStatus);
    expect([...AetheriaRpcGroup.requests.keys()]).toEqual(Object.values(AETHERIA_WS_METHODS));
  });
});
