// AETHERIA — the XC-6 operations the guarded write/edit tools call: `board.check-write` before a write, `board.record-edit` after it.
// The caller is the bearer's identity, never a field here; both are strict structs. Board unreadable or liveness unreadable is the XC-6
// `unavailable` reply with one of the codes below (the Agent applies failOpen); a refusal is a `done` value with its AWARENESS_* code.
import * as Schema from "effect/Schema";

export const BOARD_CHECK_WRITE_OPERATION = "board.check-write";
export const BOARD_RECORD_EDIT_OPERATION = "board.record-edit";

/** The board cannot be read or written, the Backend has no workspace for the thread, or the Backend is not running. */
export const AWARENESS_UNAVAILABLE_CODE = "AWARENESS_UNAVAILABLE";
/** The Backend's liveness evidence could not be read, so no holder can be judged. */
export const AWARENESS_LIVENESS_UNAVAILABLE_CODE = "AWARENESS_LIVENESS_UNAVAILABLE";

const CallId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const AbsolutePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.isPattern(/^\//),
);

export const BoardWriteArgs = Schema.Struct({
  toolCallId: CallId,
  operation: Schema.Literals(["write", "edit"]),
  canonicalPath: AbsolutePath,
  mode: Schema.Literals(["create", "replace"]),
});
export type BoardWriteArgs = typeof BoardWriteArgs.Type;

export const BoardCheckWriteResult = Schema.Union([
  Schema.Struct({
    verdict: Schema.Literal("allowed"),
    governed: Schema.Boolean,
    takenOver: Schema.Number,
  }),
  Schema.Struct({
    verdict: Schema.Literal("refused"),
    code: Schema.Literals(["AWARENESS_HELD", "AWARENESS_LEFTOVER", "AWARENESS_ASSIGNED"]),
    detail: Schema.String,
  }),
]);
export type BoardCheckWriteResult = typeof BoardCheckWriteResult.Type;

export const BoardRecordEditArgs = Schema.Struct({
  ...BoardWriteArgs.fields,
  token: Schema.Struct({
    size: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    digest: Schema.String.check(Schema.isMinLength(1)),
  }),
});
export type BoardRecordEditArgs = typeof BoardRecordEditArgs.Type;

const strict = { onExcessProperty: "error" } as const;
const decodeWrite = Schema.decodeUnknownSync(BoardWriteArgs, strict);
const decodeRecordEdit = Schema.decodeUnknownSync(BoardRecordEditArgs, strict);

/** Decode a request's untrusted arguments; any extra key (a caller id among them) or wrong shape throws. */
export const decodeBoardWriteArgs = (args: unknown): BoardWriteArgs => decodeWrite(args);
export const decodeBoardRecordEditArgs = (args: unknown): BoardRecordEditArgs =>
  decodeRecordEdit(args);

export const BoardRecordEditResult = Schema.Struct({
  recorded: Schema.Literal(true),
  governed: Schema.Boolean,
  duplicate: Schema.Boolean,
});
export type BoardRecordEditResult = typeof BoardRecordEditResult.Type;
