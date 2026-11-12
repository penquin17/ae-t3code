// AETHERIA M05 step 4: strict XC-6 schemas of the managed-work operations (XC-15 children and jobs, D22 job lifecycle); equivalent outer codecs share the vectors.
// Identity is never an argument (excess keys error). A `done` result is `{ok:true,value}` or `{ok:false,code}`; ORCHESTRATION_UNAVAILABLE and AUTH_*/ROLE_* never ride it.
import * as Schema from "effect/Schema";

export const CHILDREN_SPAWN_OPERATION = "children.spawn";
export const CHILDREN_FORK_OPERATION = "children.fork";
export const CHILDREN_MESSAGE_OPERATION = "children.message";
export const CHILDREN_LIST_OPERATION = "children.list";
export const CHILDREN_INTERRUPT_OPERATION = "children.interrupt";
export const CHILDREN_CLOSE_OPERATION = "children.close";
export const CHILDREN_AWAIT_REPORT_OPERATION = "children.await-report";
export const CHILDREN_STATUS_OPERATION = "children.status";
export const CHILDREN_CANCEL_OPERATION = "children.cancel";
export const JOBS_OUTPUT_OPERATION = "jobs.output";
export const JOBS_LIST_OPERATION = "jobs.list";
export const JOBS_KILL_OPERATION = "jobs.kill";
export const JOBS_CANCEL_OPERATION = "jobs.cancel";
export const JOBS_RESERVE_OPERATION = "jobs.reserve";
export const JOBS_ATTACH_OPERATION = "jobs.attach";
export const JOBS_ADOPTED_OPERATION = "jobs.adopted";
export const JOBS_EXITED_OPERATION = "jobs.exited";

export const ORCHESTRATION_OPERATIONS = [
  CHILDREN_SPAWN_OPERATION,
  CHILDREN_FORK_OPERATION,
  CHILDREN_MESSAGE_OPERATION,
  CHILDREN_LIST_OPERATION,
  CHILDREN_INTERRUPT_OPERATION,
  CHILDREN_CLOSE_OPERATION,
  CHILDREN_AWAIT_REPORT_OPERATION,
  CHILDREN_STATUS_OPERATION,
  CHILDREN_CANCEL_OPERATION,
  JOBS_OUTPUT_OPERATION,
  JOBS_LIST_OPERATION,
  JOBS_KILL_OPERATION,
  JOBS_CANCEL_OPERATION,
  JOBS_RESERVE_OPERATION,
  JOBS_ATTACH_OPERATION,
  JOBS_ADOPTED_OPERATION,
  JOBS_EXITED_OPERATION,
] as const;
export type OrchestrationOperation = (typeof ORCHESTRATION_OPERATIONS)[number];

/** The canonical code list with each code's class. M03's `AUTH_*`/`ROLE_*` codes travel as the XC-6 `refused` reply and are not repeated. */
export const ORCHESTRATION_CODE_CLASSES = {
  CHILD_LIMIT: "refusal",
  CHILD_NOT_OWNED: "refusal",
  CHILD_NOT_ADJACENT: "refusal",
  CHILD_NOT_RESUMABLE: "refusal",
  NOT_AUTHORIZED: "refusal",
  JOB_IDENTITY_MISMATCH: "refusal",
  JOB_CONFLICT: "conflict",
  JOB_NOT_FOUND: "absence",
  CHILD_START_FAILED: "failure",
  FORK_FAILED: "failure",
  FORK_PARTIAL: "failure",
  CHILD_DELIVERY_UNAVAILABLE: "unavailable",
  CHILD_PARENT_UNAVAILABLE: "unavailable",
  ORCHESTRATION_UNAVAILABLE: "unavailable",
  ABORTED: "aborted",
} as const;
export type OrchestrationCode = keyof typeof ORCHESTRATION_CODE_CLASSES;

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMinLength(1));
const Nat = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const IsoUtc = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/),
);

const uniqueBy = <T>(key: (item: T) => string, message: string) =>
  Schema.makeFilter<ReadonlyArray<T>>(
    (items) => new Set(items.map(key)).size === items.length || message,
  );
const IdList = Schema.Array(Id).check(uniqueBy((id: string) => id, "ids must be unique"));
const AllowList = Schema.Array(Id).check(
  Schema.isMinLength(1),
  uniqueBy((tool: string) => tool, "allow-list entries must be unique"),
);

const Mode = Schema.Literals(["one-shot", "continuable"]);
const ChildState = Schema.Literals(["running", "idle", "closed", "unknown"]);
const JobState = Schema.Literals(["starting", "running", "exited", "killed", "failed", "lost"]);
const FinalJobState = Schema.Literals(["exited", "killed", "failed", "lost"]);
const SettleStatus = Schema.Literals(["completed", "failed", "interrupted"]);

/** Exactly one of an exit code or a terminating signal, as the runner observed it. */
const Exit = Schema.Struct({
  code: Schema.NullOr(Schema.Number.check(Schema.isInt())),
  signal: Schema.NullOr(Text),
}).check(
  Schema.makeFilter<{ code: number | null; signal: string | null }>(
    (exit) =>
      (exit.code === null) !== (exit.signal === null) ||
      "an exit has exactly one of code and signal",
  ),
);

const Report = Schema.Struct({
  status: SettleStatus,
  cause: Schema.optionalKey(Text),
  text: Schema.String,
  structured: Schema.optionalKey(Schema.Unknown),
  route: PositiveInt,
});

const jobFlags = {
  livenessIndeterminate: Schema.optionalKey(Schema.Literal(true)),
  terminationUnconfirmed: Schema.optionalKey(Schema.Literal(true)),
} as const;

const strict = { onExcessProperty: "error" } as const;

/**
 * `{ok:true,value}` or `{ok:false,code,...}`. A failure may use only the codes the operation can raise. Three codes carry data: `CHILD_START_FAILED`
 * (the cause and a leftover thread), `FORK_FAILED` (the cause) and `FORK_PARTIAL` (the session left behind and the failed step).
 */
const reply = <S extends Schema.Top>(value: S, codes: readonly OrchestrationCode[]) => {
  const plain = codes.filter(
    (code) => code !== "CHILD_START_FAILED" && code !== "FORK_FAILED" && code !== "FORK_PARTIAL",
  );
  const variants: Schema.Top[] = [Schema.Struct({ ok: Schema.Literal(true), value })];
  if (plain.length > 0) {
    variants.push(
      Schema.Struct({
        ok: Schema.Literal(false),
        code: Schema.Literals(plain),
        detail: Schema.optionalKey(Schema.String),
      }),
    );
  }
  if (codes.includes("CHILD_START_FAILED")) {
    variants.push(
      Schema.Struct({
        ok: Schema.Literal(false),
        code: Schema.Literal("CHILD_START_FAILED"),
        cause: Schema.optionalKey(Text),
        leftoverThreadId: Schema.optionalKey(Id),
        detail: Schema.optionalKey(Schema.String),
      }),
    );
  }
  if (codes.includes("FORK_FAILED")) {
    variants.push(
      Schema.Struct({
        ok: Schema.Literal(false),
        code: Schema.Literal("FORK_FAILED"),
        cause: Schema.optionalKey(Text),
        detail: Schema.optionalKey(Schema.String),
      }),
    );
  }
  if (codes.includes("FORK_PARTIAL")) {
    variants.push(
      Schema.Struct({
        ok: Schema.Literal(false),
        code: Schema.Literal("FORK_PARTIAL"),
        forkSessionId: Id,
        registered: Schema.Literal(false),
        step: Schema.Literals([2, 3]),
        leftoverThreadId: Schema.optionalKey(Id),
        detail: Schema.optionalKey(Schema.String),
      }),
    );
  }
  return Schema.Union(variants as [Schema.Top, ...Schema.Top[]]);
};

const spawnBase = {
  prompt: Text,
  mode: Mode,
  label: Schema.optionalKey(Text),
  outputSchema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  delivery: Schema.optionalKey(Schema.Literal("record-only")),
} as const;
const recordOnlyIsOneShot = Schema.makeFilter<{ mode: string; delivery?: string | undefined }>(
  (args) =>
    args.delivery === undefined ||
    args.mode === "one-shot" ||
    "record-only delivery is for a one-shot child only",
);

/** A role child, or a child with an explicit allow-list: exactly one of `role` and `allow`. */
export const ChildrenSpawnArgs = Schema.Union([
  Schema.Struct({ role: Id, ...spawnBase }).check(recordOnlyIsOneShot),
  Schema.Struct({ allow: AllowList, ...spawnBase }).check(recordOnlyIsOneShot),
]);
export type ChildrenSpawnArgs = typeof ChildrenSpawnArgs.Type;
export const ChildrenSpawnResult = reply(
  Schema.Struct({ childId: Id, messageId: Id, route: PositiveInt, allRoutesOut: Schema.Boolean }),
  ["CHILD_LIMIT", "CHILD_START_FAILED"],
);
export type ChildrenSpawnResult = typeof ChildrenSpawnResult.Type;

export const ChildrenForkArgs = Schema.Struct({
  prefix: Schema.Union([Schema.Literal("all"), Schema.Struct({ runId: Id })]),
  prompt: Text,
  allow: AllowList,
  label: Schema.optionalKey(Text),
});
export type ChildrenForkArgs = typeof ChildrenForkArgs.Type;
export const ChildrenForkResult = reply(Schema.Struct({ childId: Id }), [
  "CHILD_LIMIT",
  "FORK_FAILED",
  "FORK_PARTIAL",
]);
export type ChildrenForkResult = typeof ChildrenForkResult.Type;

export const ChildrenMessageArgs = Schema.Struct({ target: Id, content: Text });
export type ChildrenMessageArgs = typeof ChildrenMessageArgs.Type;
export const ChildrenMessageResult = reply(Schema.Struct({ messageId: Id }), [
  "CHILD_NOT_OWNED",
  "CHILD_NOT_ADJACENT",
  "CHILD_NOT_RESUMABLE",
  "CHILD_DELIVERY_UNAVAILABLE",
  "CHILD_PARENT_UNAVAILABLE",
]);
export type ChildrenMessageResult = typeof ChildrenMessageResult.Type;

export const ChildrenListArgs = Schema.Struct({
  scope: Schema.Literals(["children", "descendants"]),
});
export type ChildrenListArgs = typeof ChildrenListArgs.Type;
const ChildRow = Schema.Struct({
  childId: Id,
  parentId: Id,
  depth: Nat,
  role: Schema.NullOr(Id),
  mode: Mode,
  label: Schema.optionalKey(Text),
  state: ChildState,
  lastOutcome: Schema.NullOr(
    Schema.Struct({ status: SettleStatus, cause: Schema.optionalKey(Text) }),
  ),
  route: Schema.NullOr(PositiveInt),
});
const ChildDiagnostic = Schema.Struct({
  kind: Schema.Literals(["corrupt", "unsupported", "unavailable", "unregistered-fork"]),
  id: Id,
  detail: Schema.optionalKey(Text),
});
export const ChildrenListResult = reply(
  Schema.Struct({ rows: Schema.Array(ChildRow), diagnostics: Schema.Array(ChildDiagnostic) }),
  [],
);
export type ChildrenListResult = typeof ChildrenListResult.Type;

export const ChildrenInterruptArgs = Schema.Struct({ target: Id });
export type ChildrenInterruptArgs = typeof ChildrenInterruptArgs.Type;
export const ChildrenInterruptResult = reply(Schema.Struct({ accepted: Schema.Literal(true) }), [
  "NOT_AUTHORIZED",
]);
export type ChildrenInterruptResult = typeof ChildrenInterruptResult.Type;

export const ChildrenCloseArgs = Schema.Struct({ target: Id });
export type ChildrenCloseArgs = typeof ChildrenCloseArgs.Type;
export const ChildrenCloseResult = reply(
  Schema.Struct({
    closed: Schema.Literal(true),
    report: Schema.optionalKey(Report),
    killedJobs: IdList,
  }),
  ["NOT_AUTHORIZED"],
);
export type ChildrenCloseResult = typeof ChildrenCloseResult.Type;

export const ChildrenAwaitReportArgs = Schema.Struct({
  target: Id,
  requestId: Schema.optionalKey(Id),
});
export type ChildrenAwaitReportArgs = typeof ChildrenAwaitReportArgs.Type;
export const ChildrenAwaitReportResult = reply(Report, ["CHILD_NOT_OWNED", "ABORTED"]);
export type ChildrenAwaitReportResult = typeof ChildrenAwaitReportResult.Type;

/** The XC-10 session id of a child, never a thread id; the root comes from the caller's identity. */
export const ChildrenStatusArgs = Schema.Struct({ childSessionId: Id });
export type ChildrenStatusArgs = typeof ChildrenStatusArgs.Type;
export const ChildrenStatusResult = reply(
  Schema.Struct({
    owned: Schema.Union([Schema.Boolean, Schema.Literal("unknown")]),
    state: ChildState,
  }),
  [],
);
export type ChildrenStatusResult = typeof ChildrenStatusResult.Type;

export const ChildrenCancelArgs = Schema.Struct({ requestId: Id });
export type ChildrenCancelArgs = typeof ChildrenCancelArgs.Type;
export const ChildrenCancelResult = reply(Schema.Struct({ accepted: Schema.Literal(true) }), []);
export type ChildrenCancelResult = typeof ChildrenCancelResult.Type;

export const JobsOutputArgs = Schema.Struct({
  jobId: Id,
  wait: Schema.optionalKey(Schema.Boolean),
  timeoutMs: Schema.optionalKey(PositiveInt),
  requestId: Schema.optionalKey(Id),
}).check(
  Schema.makeFilter<{ wait?: boolean | undefined; timeoutMs?: number | undefined }>(
    (args) => args.timeoutMs === undefined || args.wait === true || "a timeout needs wait: true",
  ),
);
export type JobsOutputArgs = typeof JobsOutputArgs.Type;
const OutputChunk = Schema.Struct({
  stream: Schema.Literals(["stdout", "stderr"]),
  from: Nat,
  to: Nat,
  text: Schema.String,
  truncated: Schema.Boolean,
}).check(
  Schema.makeFilter<{ from: number; to: number }>(
    (chunk) => chunk.to >= chunk.from || "a chunk's end is not before its start",
  ),
);
export const JobsOutputResult = reply(
  Schema.Struct({
    jobId: Id,
    state: JobState,
    streams: Schema.Array(OutputChunk).check(
      uniqueBy((chunk: typeof OutputChunk.Type) => chunk.stream, "one chunk per stream"),
    ),
    exit: Schema.optionalKey(Exit),
    waitElapsed: Schema.Boolean,
    ...jobFlags,
  }),
  ["JOB_NOT_FOUND", "ABORTED"],
);
export type JobsOutputResult = typeof JobsOutputResult.Type;

export const JobsListArgs = Schema.Struct({
  scope: Schema.optionalKey(Schema.Literals(["own", "descendants"])),
});
export type JobsListArgs = typeof JobsListArgs.Type;
const JobRow = Schema.Struct({
  jobId: Id,
  ownerSessionId: Id,
  label: Text,
  state: JobState,
  completion: Schema.Literals(["pending", "inserted", "none"]),
  collectedAt: Schema.optionalKey(IsoUtc),
  deliveryUncertain: Schema.optionalKey(Schema.Literal(true)),
  exit: Schema.optionalKey(Exit),
  ...jobFlags,
});
export const JobsListResult = reply(Schema.Struct({ jobs: Schema.Array(JobRow) }), []);
export type JobsListResult = typeof JobsListResult.Type;

export const JobsKillArgs = Schema.Struct({ jobId: Id });
export type JobsKillArgs = typeof JobsKillArgs.Type;
export const JobsKillResult = reply(
  Schema.Struct({ jobId: Id, state: FinalJobState, exit: Schema.optionalKey(Exit), ...jobFlags }),
  ["JOB_NOT_FOUND"],
);
export type JobsKillResult = typeof JobsKillResult.Type;

export const JobsCancelArgs = Schema.Struct({ requestId: Id });
export type JobsCancelArgs = typeof JobsCancelArgs.Type;
export const JobsCancelResult = reply(Schema.Struct({ accepted: Schema.Literal(true) }), []);
export type JobsCancelResult = typeof JobsCancelResult.Type;

/** Before the spawn. The output location is derived by the Backend from the run key, never chosen by the Agent. */
export const JobsReserveArgs = Schema.Struct({
  runKey: Id,
  label: Text,
  mode: Schema.Literals(["background", "foreground"]),
});
export type JobsReserveArgs = typeof JobsReserveArgs.Type;
export const JobsReserveResult = reply(
  Schema.Struct({ jobId: Id, state: Schema.Literal("starting") }),
  ["JOB_CONFLICT"],
);
export type JobsReserveResult = typeof JobsReserveResult.Type;

/** Before the runner releases the gated command. An unreadable start time is not representable. */
export const JobsAttachArgs = Schema.Struct({
  jobId: Id,
  pid: PositiveInt,
  pgid: PositiveInt,
  startIdentity: Schema.Struct({ pid: PositiveInt, startTime: Text }),
}).check(
  Schema.makeFilter<{ pid: number; startIdentity: { pid: number } }>(
    (args) => args.startIdentity.pid === args.pid || "the start identity names another pid",
  ),
);
export type JobsAttachArgs = typeof JobsAttachArgs.Type;
export const JobsAttachResult = reply(
  Schema.Struct({ jobId: Id, attached: Schema.Literal(true) }),
  ["JOB_NOT_FOUND", "JOB_CONFLICT", "JOB_IDENTITY_MISMATCH"],
);
export type JobsAttachResult = typeof JobsAttachResult.Type;

export const JobsAdoptedArgs = Schema.Struct({
  jobId: Id,
  via: Schema.Literals(["background", "timeout"]),
});
export type JobsAdoptedArgs = typeof JobsAdoptedArgs.Type;
/** The confirmation is returned only after the adoption is persisted. */
export const JobsAdoptedResult = reply(Schema.Struct({ jobId: Id, confirmation: Text }), [
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
]);
export type JobsAdoptedResult = typeof JobsAdoptedResult.Type;

export const JobsExitedArgs = Schema.Struct({ jobId: Id, exit: Exit });
export type JobsExitedArgs = typeof JobsExitedArgs.Type;
export const JobsExitedResult = reply(
  Schema.Struct({ jobId: Id, recorded: Schema.Literal(true), supplemental: Schema.Boolean }),
  ["JOB_NOT_FOUND", "JOB_CONFLICT"],
);
export type JobsExitedResult = typeof JobsExitedResult.Type;

export const decodeChildrenSpawnArgs = Schema.decodeUnknownSync(ChildrenSpawnArgs, strict);
export const decodeChildrenForkArgs = Schema.decodeUnknownSync(ChildrenForkArgs, strict);
export const decodeChildrenMessageArgs = Schema.decodeUnknownSync(ChildrenMessageArgs, strict);
export const decodeChildrenListArgs = Schema.decodeUnknownSync(ChildrenListArgs, strict);
export const decodeChildrenInterruptArgs = Schema.decodeUnknownSync(ChildrenInterruptArgs, strict);
export const decodeChildrenCloseArgs = Schema.decodeUnknownSync(ChildrenCloseArgs, strict);
export const decodeChildrenAwaitReportArgs = Schema.decodeUnknownSync(
  ChildrenAwaitReportArgs,
  strict,
);
export const decodeChildrenStatusArgs = Schema.decodeUnknownSync(ChildrenStatusArgs, strict);
export const decodeChildrenCancelArgs = Schema.decodeUnknownSync(ChildrenCancelArgs, strict);
export const decodeJobsOutputArgs = Schema.decodeUnknownSync(JobsOutputArgs, strict);
export const decodeJobsListArgs = Schema.decodeUnknownSync(JobsListArgs, strict);
export const decodeJobsKillArgs = Schema.decodeUnknownSync(JobsKillArgs, strict);
export const decodeJobsCancelArgs = Schema.decodeUnknownSync(JobsCancelArgs, strict);
export const decodeJobsReserveArgs = Schema.decodeUnknownSync(JobsReserveArgs, strict);
export const decodeJobsAttachArgs = Schema.decodeUnknownSync(JobsAttachArgs, strict);
export const decodeJobsAdoptedArgs = Schema.decodeUnknownSync(JobsAdoptedArgs, strict);
export const decodeJobsExitedArgs = Schema.decodeUnknownSync(JobsExitedArgs, strict);
