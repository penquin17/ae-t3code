// AETHERIA M04 Plan step 20 (and M09 step 17 for board.record-shell, against shared vectors): the frozen wire shapes of the board and awareness
// operations, checked at their own boundary — what decodes and what is refused. The Backend that answers them is tested in @t3tools/aetheria-server; the Agent that calls them is outside the fork.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AWARENESS_ACTIONS,
  AWARENESS_ACTION_OPERATION,
  AWARENESS_SUMMARY_OPERATION,
  AwarenessActionArgs,
  AwarenessSummaryResult,
  BOARD_CHECK_WRITE_OPERATION,
  BOARD_RECORD_EDIT_OPERATION,
  BOARD_RECORD_SHELL_OPERATION,
  BoardCheckWriteResult,
  BoardRecordEditArgs,
  BoardRecordEditResult,
  BoardRecordShellArgs,
  BoardRecordShellResult,
  BoardWriteArgs,
  XC10_CHILD_STATUS_UNAVAILABLE_CODE,
  XC6_OPERATION_NAME_PATTERN,
  XC8_DECISION_EVIDENCE_UNAVAILABLE_CODE,
} from "./index.ts";
import { boardShellVectors } from "./boardShellOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;
const decodeWrite = Schema.decodeUnknownSync(BoardWriteArgs, strict);
const decodeRecord = Schema.decodeUnknownSync(BoardRecordEditArgs, strict);
const decodeCheck = Schema.decodeUnknownSync(BoardCheckWriteResult, strict);
const decodeRecorded = Schema.decodeUnknownSync(BoardRecordEditResult, strict);
const decodeShell = Schema.decodeUnknownSync(BoardRecordShellArgs, strict);
const decodeShellResult = Schema.decodeUnknownSync(BoardRecordShellResult, strict);
const decodeAction = Schema.decodeUnknownSync(AwarenessActionArgs, strict);
const decodeSummary = Schema.decodeUnknownSync(AwarenessSummaryResult, strict);

const write = {
  toolCallId: "call-1",
  operation: "edit",
  canonicalPath: "/w/a.txt",
  mode: "replace",
} as const;

describe("unavailable codes that name the missing owner", () => {
  it("are the frozen strings", () => {
    expect(XC10_CHILD_STATUS_UNAVAILABLE_CODE).toBe("XC10_CHILD_STATUS_UNAVAILABLE");
    expect(XC8_DECISION_EVIDENCE_UNAVAILABLE_CODE).toBe("XC8_DECISION_EVIDENCE_UNAVAILABLE");
  });
});

describe("operation names", () => {
  it("are valid XC-6 names", () => {
    for (const name of [
      BOARD_CHECK_WRITE_OPERATION,
      BOARD_RECORD_EDIT_OPERATION,
      AWARENESS_ACTION_OPERATION,
      AWARENESS_SUMMARY_OPERATION,
    ])
      expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });
});

describe("board.check-write and board.record-edit", () => {
  it("decode the call and refuse a caller field, a relative path and a bad mode", () => {
    expect(decodeWrite(write)).toEqual(write);
    expect(() => decodeWrite({ ...write, sessionId: "x" })).toThrow();
    expect(() => decodeWrite({ ...write, canonicalPath: "a.txt" })).toThrow();
    expect(() => decodeWrite({ ...write, mode: "append" })).toThrow();
    expect(decodeRecord({ ...write, token: { size: 3, digest: "sha256:a" } }).token.size).toBe(3);
    expect(() => decodeRecord({ ...write, token: { size: -1, digest: "d" } })).toThrow();
    expect(() => decodeRecord(write)).toThrow();
  });

  it("answer allowed, refused with a registry code and the recorded outcome — and nothing else", () => {
    expect(decodeCheck({ verdict: "allowed", governed: true, takenOver: 0 }).verdict).toBe(
      "allowed",
    );
    expect(
      decodeCheck({ verdict: "refused", code: "AWARENESS_HELD", detail: "held by session x" })
        .verdict,
    ).toBe("refused");
    expect(() =>
      decodeCheck({ verdict: "refused", code: "T1_NOT_OBSERVED", detail: "x" }),
    ).toThrow();
    expect(() =>
      decodeCheck({ verdict: "refused", code: "AWARENESS_HELD", detail: "x", holders: [] }),
    ).toThrow();
    expect(decodeRecorded({ recorded: true, governed: false, duplicate: true }).duplicate).toBe(
      true,
    );
    expect(() => decodeRecorded({ recorded: false, governed: true, duplicate: false })).toThrow();
  });
});

describe("board.record-shell", () => {
  it("is a valid XC-6 name", () => {
    expect(BOARD_RECORD_SHELL_OPERATION).toBe("board.record-shell");
    expect(XC6_OPERATION_NAME_PATTERN.test(BOARD_RECORD_SHELL_OPERATION)).toBe(true);
  });

  it("decodes every accepted vector unchanged", () => {
    for (const vector of boardShellVectors.recordShellArgs!.accept)
      expect(decodeShell(vector.value), vector.name).toEqual(vector.value);
  });

  it("refuses every refused vector, including a caller field", () => {
    for (const vector of boardShellVectors.recordShellArgs!.refuse)
      expect(() => decodeShell(vector.value), vector.name).toThrow();
  });

  it("refuses a path past 4096 characters, which the vectors leave to the schema", () => {
    expect(() => decodeShell({ paths: [`/w/${"a".repeat(4100)}`], outcome: "changed" })).toThrow();
  });

  it("answers a small acknowledgement or an AWARENESS_INVALID refusal — and nothing else", () => {
    expect(decodeShellResult({ recorded: true, count: 2 })).toEqual({ recorded: true, count: 2 });
    expect(
      decodeShellResult({ recorded: false, code: "AWARENESS_INVALID", detail: "paths: x" })
        .recorded,
    ).toBe(false);
    expect(() => decodeShellResult({ recorded: true, count: -1 })).toThrow();
    expect(() => decodeShellResult({ recorded: true, count: 1, paths: [] })).toThrow();
    expect(() =>
      decodeShellResult({ recorded: false, code: "AWARENESS_HELD", detail: "x" }),
    ).toThrow();
    expect(() => decodeShellResult({ recorded: false, count: 0 })).toThrow();
  });
});

describe("awareness.action and awareness.summary", () => {
  it("name the nine DSH actions and take the model's fields only", () => {
    expect(AWARENESS_ACTIONS).toHaveLength(9);
    expect(decodeAction({ action: "claim", path: "src/a.ts", idea: "lexing" }).action).toBe(
      "claim",
    );
    expect(() => decodeAction({ action: "claim", sessionId: "x" })).toThrow();
    expect(() => decodeAction({ action: "delete" })).toThrow();
  });

  it("return the summary text or null with its revision and byte size", () => {
    expect(decodeSummary({ text: null, revision: 3, bytes: 0 }).text).toBeNull();
    expect(() => decodeSummary({ text: "x", revision: 3 })).toThrow();
  });
});
