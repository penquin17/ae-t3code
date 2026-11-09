// AETHERIA — the XC-6 operations the guarded write/edit tools call: `board.check-write` before a write, `board.record-edit` after it; and the
// shell tool's `board.record-shell` (M09 step 17). The caller is the bearer's identity, never a field here; all are strict. Board unreadable or liveness unreadable is the XC-6
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

/** M09 step 17: a shell command's final observation. Visibility only: it carries no version token and takes no claim. */
export const BOARD_RECORD_SHELL_OPERATION = "board.record-shell";
/** The most paths one shell record carries; the Agent's sink cuts to the same number. */
const BOARD_RECORD_SHELL_MAX_PATHS = 100;

/** `changed` carries 1 to 100 unique absolute paths; `unknown` carries none. The caller is the bearer's identity, never a field. */
export const BoardRecordShellArgs = Schema.Union([
  Schema.Struct({
    paths: Schema.Array(AbsolutePath).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(BOARD_RECORD_SHELL_MAX_PATHS),
      Schema.isUnique(),
    ),
    outcome: Schema.Literal("changed"),
  }),
  Schema.Struct({
    paths: Schema.Array(AbsolutePath).check(Schema.isMaxLength(0)),
    outcome: Schema.Literal("unknown"),
  }),
]);
export type BoardRecordShellArgs = typeof BoardRecordShellArgs.Type;
const decodeRecordShell = Schema.decodeUnknownSync(BoardRecordShellArgs, strict);
export const decodeBoardRecordShellArgs = (args: unknown): BoardRecordShellArgs =>
  decodeRecordShell(args);

/** A small acknowledgement; a path the Backend will not store (outside the workspace, not canonical) is a refusal with its registry code. */
export const BoardRecordShellResult = Schema.Union([
  Schema.Struct({
    recorded: Schema.Literal(true),
    count: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    recorded: Schema.Literal(false),
    code: Schema.Literal("AWARENESS_INVALID"),
    detail: Schema.String,
  }),
]);
export type BoardRecordShellResult = typeof BoardRecordShellResult.Type;
