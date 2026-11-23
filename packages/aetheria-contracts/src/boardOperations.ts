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
    // AWARENESS_ASSIGNED: the path is claimed by the writer's tree and lies outside the writer's own write scope (an unscoped subagent has none).
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

// In-process Backend operations only: not XC-6 and not model-reachable, so they carry no caller field; the Backend supplies the resolved identity.
// Paths are workspace-relative; the board canonicalizes them and refuses the workspace itself and anything outside it.
export const BOARD_SCOPE_RECORD_OPERATION = "scope.record";
export const BOARD_SCOPE_RELEASE_OPERATION = "scope.release";

/** The most entries one scope carries; the board's own limit. */
export const BOARD_SCOPE_MAX_ENTRIES = 64;

const ScopePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  // Not absolute (a leading `/` or `\`) and no `..` step: the spawn codecs refuse both before a request gets here.
  Schema.isPattern(/^(?![/\\])(?![A-Za-z]:)(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))/),
);
const ScopeSession = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const BoardScopeRecordArgs = Schema.Struct({
  childSessionId: ScopeSession,
  writeScope: Schema.Array(
    Schema.Struct({ path: ScopePath, kind: Schema.Literals(["file", "folder"]) }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(BOARD_SCOPE_MAX_ENTRIES)),
});
export type BoardScopeRecordArgs = typeof BoardScopeRecordArgs.Type;

/**
 * `recorded`: the scope is on the board (`existing`: the same scope was already there, a retry). `refused`: nothing was written; an invalid scope
 * (malformed, outside the caller's own scope, the whole workspace) is AWARENESS_INVALID, a sibling or active foreign holding AWARENESS_OVERLAP.
 * `unavailable`: the board or liveness could not answer, so the child must not start.
 */
export const BoardScopeRecordResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("recorded"),
    existing: Schema.Boolean,
    ranges: Schema.Array(
      Schema.Struct({ path: AbsolutePath, kind: Schema.Literals(["file", "folder"]) }),
    ),
    claimed: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    takenOver: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    status: Schema.Literal("refused"),
    code: Schema.Literals(["AWARENESS_INVALID", "AWARENESS_OVERLAP"]),
    detail: Schema.String,
    field: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    reason: Schema.Literals(["board", "liveness"]),
    detail: Schema.String,
  }),
]);
export type BoardScopeRecordResult = typeof BoardScopeRecordResult.Type;

export const BoardScopeReleaseArgs = Schema.Struct({ childSessionId: ScopeSession });
export type BoardScopeReleaseArgs = typeof BoardScopeReleaseArgs.Type;

/** A released record (`existed` false: none was there, so a repeat is a success) or the board could not answer. */
export const BoardScopeReleaseResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("released"), existed: Schema.Boolean }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    reason: Schema.Literal("board"),
    detail: Schema.String,
  }),
]);
export type BoardScopeReleaseResult = typeof BoardScopeReleaseResult.Type;
