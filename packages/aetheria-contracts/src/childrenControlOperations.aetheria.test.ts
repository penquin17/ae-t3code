// AETHERIA M10 Plan step 3 (R1, R3, XC-15): the strict client contracts for the user's tree Stop and per-child controls. A payload names a thread and nothing about the caller:
// no actor, user flag, scope or Pi session. A reply is a value or a coded refusal; every code is one the Backend can raise.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaChildrenRpcGroup,
  AetheriaRpcGroup,
  CHILDREN_CONTROL_CODE_CLASSES,
  ClientChildrenCancelTreePayload,
  ClientChildrenCancelTreeResult,
  ClientChildrenClosePayload,
  ClientChildrenCloseResult,
  ClientChildrenInterruptPayload,
  ClientChildrenInterruptResult,
  ClientChildrenListPayload,
  ClientChildrenListResult,
  CHILDREN_PASSTHROUGH_CODES,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];

describe("the children-control client methods", () => {
  it("adds four methods under aetheria.children. after the XC-18 methods, in group order", () => {
    expect(AETHERIA_WS_METHODS).toMatchObject({
      childrenCancelTree: "aetheria.children.cancelTree",
      childrenList: "aetheria.children.list",
      childrenInterrupt: "aetheria.children.interrupt",
      childrenClose: "aetheria.children.close",
    });
    expect([...AetheriaChildrenRpcGroup.requests.keys()]).toEqual([
      "aetheria.children.cancelTree",
      "aetheria.children.list",
      "aetheria.children.interrupt",
      "aetheria.children.close",
    ]);
    expect([...AetheriaRpcGroup.requests.keys()]).toEqual(Object.values(AETHERIA_WS_METHODS));
  });

  it("names a thread and nothing about the caller", () => {
    expect(decode(ClientChildrenCancelTreePayload)({ rootThreadId: "t-root" })).toEqual({
      rootThreadId: "t-root",
    });
    expect(decode(ClientChildrenListPayload)({ rootThreadId: "t-root" })).toEqual({
      rootThreadId: "t-root",
    });
    for (const schema of [ClientChildrenInterruptPayload, ClientChildrenClosePayload])
      expect(decode(schema)({ rootThreadId: "t-root", childThreadId: "t-child" })).toEqual({
        rootThreadId: "t-root",
        childThreadId: "t-child",
      });
    for (const forged of [
      { caller: { user: true } },
      { user: true },
      { actor: { clientSessionId: "x" } },
      { sessionId: "s" },
      { scopes: ["orchestration:operate"] },
    ]) {
      expect(() =>
        decode(ClientChildrenCancelTreePayload)({ rootThreadId: "t-root", ...forged }),
      ).toThrow();
      expect(() =>
        decode(ClientChildrenInterruptPayload)({
          rootThreadId: "t",
          childThreadId: "c",
          ...forged,
        }),
      ).toThrow();
    }
    expect(() => decode(ClientChildrenCancelTreePayload)({})).toThrow();
    expect(() => decode(ClientChildrenCancelTreePayload)({ rootThreadId: "" })).toThrow();
    expect(() => decode(ClientChildrenClosePayload)({ rootThreadId: "t-root" })).toThrow();
  });

  it("decodes the M05 tree-cancel value with a row per child and a completeness flag", () => {
    const value = {
      rootThreadId: "t-root",
      rows: [
        { childId: "c1", action: "interrupted" },
        { childId: "c2", action: "closed" },
        { childId: "c3", action: "left-idle" },
        { childId: "c4", action: "failed", detail: "the close was not confirmed (X)" },
      ],
      rootStopped: true,
      complete: false,
    };
    expect(decode(ClientChildrenCancelTreeResult)({ ok: true, value })).toEqual({
      ok: true,
      value,
    });
    expect(() =>
      decode(ClientChildrenCancelTreeResult)({
        ok: true,
        value: { ...value, rows: [{ childId: "c", action: "vanished" }] },
      }),
    ).toThrow();
    expect(() =>
      decode(ClientChildrenCancelTreeResult)({ ok: true, value: { ...value, extra: 1 } }),
    ).toThrow();
  });

  it("decodes the list, interrupt and close values", () => {
    const row = {
      childId: "c1",
      parentId: "t-root",
      depth: 1,
      role: null,
      mode: "continuable",
      state: "running",
      lastOutcome: null,
      route: null,
    };
    expect(
      decode(ClientChildrenListResult)({ ok: true, value: { rows: [row], diagnostics: [] } }),
    ).toBeTruthy();
    expect(() =>
      decode(ClientChildrenListResult)({
        ok: true,
        value: { rows: [{ ...row, mode: "x" }], diagnostics: [] },
      }),
    ).toThrow();
    expect(
      decode(ClientChildrenInterruptResult)({ ok: true, value: { accepted: true } }),
    ).toBeTruthy();
    expect(() =>
      decode(ClientChildrenInterruptResult)({ ok: true, value: { accepted: false } }),
    ).toThrow();
    expect(
      decode(ClientChildrenCloseResult)({ ok: true, value: { closed: true, killedJobs: [] } }),
    ).toBeTruthy();
  });

  it("accepts a refusal only with a code the Backend can raise: its own five or the M05 codes these operations can return", () => {
    for (const code of [
      ...Object.keys(CHILDREN_CONTROL_CODE_CLASSES),
      ...CHILDREN_PASSTHROUGH_CODES,
    ])
      for (const schema of [
        ClientChildrenCancelTreeResult,
        ClientChildrenListResult,
        ClientChildrenInterruptResult,
        ClientChildrenCloseResult,
      ])
        expect(decode(schema)({ ok: false, code, detail: "d" })).toBeTruthy();
    expect(Object.keys(CHILDREN_CONTROL_CODE_CLASSES).sort()).toEqual([
      "CHILDREN_DEVICE_REVOKED",
      "CHILDREN_NOT_AUTHORIZED",
      "CHILDREN_NOT_FOUND",
      "CHILDREN_OUTCOME_UNKNOWN",
      "CHILDREN_UNAVAILABLE",
    ]);
    expect(CHILDREN_PASSTHROUGH_CODES).toContain("NOT_AUTHORIZED");
    expect(CHILDREN_PASSTHROUGH_CODES).toContain("ORCHESTRATION_UNAVAILABLE");
    // A code that carries data (a fork's leftovers) or none of these operations raises is not on the wire.
    for (const code of ["SOMETHING_ELSE", "FORK_PARTIAL", "JOB_NOT_FOUND"])
      expect(() => decode(ClientChildrenCancelTreeResult)({ ok: false, code })).toThrow();
    expect(() =>
      decode(ClientChildrenCancelTreeResult)({ ok: false, code: "CHILDREN_NOT_FOUND", user: true }),
    ).toThrow();
  });
});
