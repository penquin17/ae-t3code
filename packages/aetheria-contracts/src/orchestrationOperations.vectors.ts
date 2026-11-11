// AETHERIA M05 step 4: shared vectors for the managed-work shapes, decoded by the fork's strict schemas and the outer codecs; `accept` decodes unchanged, `refuse` throws.
// Data only, synthetic; each set's key names its codec. No argument names a caller, session, root, parent, authority or thread: identity is the bearer's.
// A result carries only its operation's codes; `ABORTED` is for the two waiting operations; `FORK_PARTIAL` says `registered:false` and the step.

export interface OrchestrationVector {
  readonly name: string;
  readonly value: unknown;
}

export interface OrchestrationVectorSet {
  readonly accept: readonly OrchestrationVector[];
  readonly refuse: readonly OrchestrationVector[];
}

/** Keys no Agent argument may carry, whatever the operation: the caller, its root, its parent, authority and the thread/folder facts the Backend derives. */
export const orchestrationForbiddenAgentKeys: readonly string[] = [
  "caller",
  "callerId",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "parentId",
  "parentThreadId",
  "threadId",
  "authority",
  "identity",
  "actor",
  "projectRoot",
  "workingFolder",
  "cwd",
];

const at = "2026-11-11T12:00:00.000Z";
const startTime = "Tue Nov 11 12:00:00 2026";

const ok = (value: unknown) => ({ ok: true, value });
const fail = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false, code, ...extra });

const exitCode = { code: 0, signal: null };
const exitSignal = { code: null, signal: "SIGTERM" };
const report = { status: "completed", text: "all checks pass", route: 1 };
const reportFailed = { status: "failed", cause: "schema-invalid", text: "not json", route: 2 };
const reportClosed = { status: "interrupted", cause: "parent-close", text: "", route: 1 };
const row = {
  childId: "thr_c1",
  parentId: "thr_p",
  depth: 1,
  role: "reviewer",
  mode: "continuable",
  label: "review the API",
  state: "idle",
  lastOutcome: { status: "completed" },
  route: 1,
};
const rowNeverRan = {
  childId: "thr_c2",
  parentId: "thr_p",
  depth: 1,
  role: null,
  mode: "one-shot",
  state: "unknown",
  lastOutcome: null,
  route: null,
};
const stream = { stream: "stdout", from: 0, to: 11, text: "hello world", truncated: false };
const jobRow = {
  jobId: "job_1",
  ownerSessionId: "sess_main",
  label: "unit tests",
  state: "running",
  completion: "none",
};

const outputOk = { jobId: "job_1", state: "running", streams: [stream], waitElapsed: false };

export const orchestrationVectors: Readonly<Record<string, OrchestrationVectorSet>> = {
  childrenSpawnArgs: {
    accept: [
      {
        name: "a role child, one-shot",
        value: { role: "reviewer", prompt: "Review the diff.", mode: "one-shot" },
      },
      {
        name: "a role child with label and output schema",
        value: {
          role: "reviewer",
          prompt: "Review.",
          mode: "continuable",
          label: "api review",
          outputSchema: { type: "object" },
        },
      },
      {
        name: "a record-only one-shot",
        value: { role: "reader", prompt: "Read.", mode: "one-shot", delivery: "record-only" },
      },
      {
        name: "an explicit allow-list child",
        value: { allow: ["read", "grep"], prompt: "Look.", mode: "one-shot" },
      },
    ],
    refuse: [
      { name: "neither role nor allow-list", value: { prompt: "Review.", mode: "one-shot" } },
      {
        name: "both role and allow-list",
        value: { role: "reviewer", allow: ["read"], prompt: "Review.", mode: "one-shot" },
      },
      { name: "an empty allow-list", value: { allow: [], prompt: "Look.", mode: "one-shot" } },
      {
        name: "a duplicate allow-list entry",
        value: { allow: ["read", "read"], prompt: "Look.", mode: "one-shot" },
      },
      { name: "an empty prompt", value: { role: "reviewer", prompt: "", mode: "one-shot" } },
      { name: "an unknown mode", value: { role: "reviewer", prompt: "x", mode: "forever" } },
      {
        name: "record-only on a continuable child",
        value: { role: "reader", prompt: "x", mode: "continuable", delivery: "record-only" },
      },
      {
        name: "another delivery value",
        value: { role: "reader", prompt: "x", mode: "one-shot", delivery: "chat" },
      },
      {
        name: "an output schema that is not an object",
        value: { role: "reader", prompt: "x", mode: "one-shot", outputSchema: "string" },
      },
      { name: "a missing mode", value: { role: "reviewer", prompt: "x" } },
    ],
  },
  childrenSpawnResult: {
    accept: [
      {
        name: "a started child",
        value: ok({ childId: "thr_c1", messageId: "msg_1", route: 1, allRoutesOut: false }),
      },
      {
        name: "a child started with every route out",
        value: ok({ childId: "thr_c1", messageId: "msg_1", route: 1, allRoutesOut: true }),
      },
      { name: "limit reached", value: fail("CHILD_LIMIT") },
      {
        name: "start failed, rolled back",
        value: fail("CHILD_START_FAILED", { cause: "plan-mode-inherit-failed" }),
      },
      {
        name: "start failed with a leftover thread",
        value: fail("CHILD_START_FAILED", {
          cause: "close-failed",
          leftoverThreadId: "thr_left",
          detail: "close timed out",
        }),
      },
    ],
    refuse: [
      {
        name: "a success naming no route",
        value: ok({ childId: "thr_c1", messageId: "msg_1", allRoutesOut: false }),
      },
      {
        name: "a success with route 0",
        value: ok({ childId: "thr_c1", messageId: "msg_1", route: 0, allRoutesOut: false }),
      },
      {
        name: "a success with an extra key",
        value: ok({
          childId: "thr_c1",
          messageId: "msg_1",
          route: 1,
          allRoutesOut: false,
          token: "x",
        }),
      },
      { name: "a code of another operation", value: fail("CHILD_NOT_OWNED") },
      { name: "the unavailable code inside done", value: fail("ORCHESTRATION_UNAVAILABLE") },
      { name: "an AUTH code inside done", value: fail("AUTH_TOOL_NOT_ALLOWED") },
      { name: "a failure carrying a value", value: { ok: false, code: "CHILD_LIMIT", value: {} } },
      {
        name: "a leftover id on a limit refusal",
        value: fail("CHILD_LIMIT", { leftoverThreadId: "thr_left" }),
      },
      {
        name: "a success and a code",
        value: {
          ok: true,
          code: "CHILD_LIMIT",
          value: { childId: "thr_c1", messageId: "msg_1", route: 1, allRoutesOut: false },
        },
      },
    ],
  },
  childrenForkArgs: {
    accept: [
      {
        name: "fork the whole history",
        value: { prefix: "all", prompt: "Try the other approach.", allow: ["read", "grep"] },
      },
      {
        name: "fork up to a run",
        value: {
          prefix: { runId: "run_7" },
          prompt: "Continue from there.",
          allow: ["read"],
          label: "alt path",
        },
      },
      {
        name: "retry reusing an unregistered copy",
        value: {
          prefix: "all",
          prompt: "Again.",
          allow: ["read"],
          reuseForkSessionId: "sess_fork1",
        },
      },
    ],
    refuse: [
      { name: "no allow-list", value: { prefix: "all", prompt: "x" } },
      { name: "an empty allow-list", value: { prefix: "all", prompt: "x", allow: [] } },
      {
        name: "a bare run id as the prefix",
        value: { prefix: "run_7", prompt: "x", allow: ["read"] },
      },
      { name: "an empty run id", value: { prefix: { runId: "" }, prompt: "x", allow: ["read"] } },
      {
        name: "a prefix object with an extra key",
        value: { prefix: { runId: "run_7", entry: "e1" }, prompt: "x", allow: ["read"] },
      },
      { name: "an empty prompt", value: { prefix: "all", prompt: "", allow: ["read"] } },
      {
        name: "a role claim",
        value: { prefix: "all", prompt: "x", allow: ["read"], role: "reviewer" },
      },
    ],
  },
  childrenForkResult: {
    accept: [
      { name: "a registered fork", value: ok({ childId: "thr_f1" }) },
      {
        name: "step 1 failed, nothing remains",
        value: fail("FORK_FAILED", { cause: "prefix-unsupported" }),
      },
      {
        name: "step 2 failed, the copy remains",
        value: fail("FORK_PARTIAL", { forkSessionId: "sess_fork1", registered: false, step: 2 }),
      },
      {
        name: "step 3 failed with a leftover thread",
        value: fail("FORK_PARTIAL", {
          forkSessionId: "sess_fork1",
          registered: false,
          step: 3,
          leftoverThreadId: "thr_left",
        }),
      },
      { name: "limit reached", value: fail("CHILD_LIMIT") },
    ],
    refuse: [
      {
        name: "a partial without the session",
        value: fail("FORK_PARTIAL", { registered: false, step: 2 }),
      },
      {
        name: "a partial claiming registration",
        value: fail("FORK_PARTIAL", { forkSessionId: "sess_fork1", registered: true, step: 2 }),
      },
      {
        name: "a partial at step 1",
        value: fail("FORK_PARTIAL", { forkSessionId: "sess_fork1", registered: false, step: 1 }),
      },
      {
        name: "a partial without a step",
        value: fail("FORK_PARTIAL", { forkSessionId: "sess_fork1", registered: false }),
      },
      {
        name: "a failed fork naming a session",
        value: fail("FORK_FAILED", { forkSessionId: "sess_fork1" }),
      },
      {
        name: "a success naming the session",
        value: ok({ childId: "thr_f1", forkSessionId: "sess_fork1" }),
      },
      { name: "the spawn failure code", value: fail("CHILD_START_FAILED") },
    ],
  },
  childrenMessageArgs: {
    accept: [
      { name: "message a child", value: { target: "thr_c1", content: "also check the tests" } },
    ],
    refuse: [
      { name: "empty content", value: { target: "thr_c1", content: "" } },
      { name: "no target", value: { content: "x" } },
      { name: "a target of the wrong type", value: { target: 7, content: "x" } },
    ],
  },
  childrenMessageResult: {
    accept: [
      { name: "accepted", value: ok({ messageId: "msg_2" }) },
      { name: "not owned", value: fail("CHILD_NOT_OWNED") },
      { name: "not adjacent", value: fail("CHILD_NOT_ADJACENT") },
      { name: "not resumable", value: fail("CHILD_NOT_RESUMABLE") },
      {
        name: "delivery unavailable",
        value: fail("CHILD_DELIVERY_UNAVAILABLE", { detail: "inbox closing" }),
      },
      { name: "parent unavailable", value: fail("CHILD_PARENT_UNAVAILABLE") },
    ],
    refuse: [
      { name: "a success without the id", value: ok({}) },
      { name: "the spawn failure code", value: fail("CHILD_START_FAILED") },
      { name: "a not-found job code", value: fail("JOB_NOT_FOUND") },
      { name: "an unknown code", value: fail("CHILD_GONE") },
    ],
  },
  childrenListArgs: {
    accept: [
      { name: "own children", value: { scope: "children" } },
      { name: "the whole subtree", value: { scope: "descendants" } },
    ],
    refuse: [
      { name: "no scope", value: {} },
      { name: "another scope", value: { scope: "root" } },
    ],
  },
  childrenListResult: {
    accept: [
      { name: "rows only", value: ok({ rows: [row, rowNeverRan], diagnostics: [] }) },
      {
        name: "rows and diagnostics",
        value: ok({
          rows: [row],
          diagnostics: [
            { kind: "corrupt", id: "thr_bad" },
            { kind: "unregistered-fork", id: "sess_fork1", detail: "copy kept as user data" },
            { kind: "unsupported", id: "thr_new" },
            { kind: "unavailable", id: "thr_lost" },
          ],
        }),
      },
      { name: "an empty list", value: ok({ rows: [], diagnostics: [] }) },
    ],
    refuse: [
      {
        name: "a row with an unknown state",
        value: ok({ rows: [{ ...row, state: "sleeping" }], diagnostics: [] }),
      },
      {
        name: "a row with a negative depth",
        value: ok({ rows: [{ ...row, depth: -1 }], diagnostics: [] }),
      },
      {
        name: "a row missing its parent",
        value: ok({
          rows: [
            {
              childId: "thr_c1",
              depth: 1,
              role: null,
              mode: "one-shot",
              state: "idle",
              lastOutcome: null,
              route: null,
            },
          ],
          diagnostics: [],
        }),
      },
      {
        name: "a diagnostic of an unknown kind",
        value: ok({ rows: [], diagnostics: [{ kind: "odd", id: "x" }] }),
      },
      { name: "no diagnostics list", value: ok({ rows: [] }) },
      {
        name: "a row with an unknown outcome status",
        value: ok({ rows: [{ ...row, lastOutcome: { status: "gone" } }], diagnostics: [] }),
      },
    ],
  },
  childrenInterruptArgs: {
    accept: [{ name: "interrupt a child", value: { target: "thr_c1" } }],
    refuse: [
      { name: "no target", value: {} },
      { name: "an empty target", value: { target: "" } },
    ],
  },
  childrenInterruptResult: {
    accept: [
      { name: "accepted", value: ok({ accepted: true }) },
      { name: "not authorized", value: fail("NOT_AUTHORIZED") },
    ],
    refuse: [
      { name: "accepted false", value: ok({ accepted: false }) },
      { name: "not owned", value: fail("CHILD_NOT_OWNED") },
      { name: "an empty success", value: ok({}) },
    ],
  },
  childrenCloseArgs: {
    accept: [{ name: "close a child", value: { target: "thr_c1" } }],
    refuse: [
      { name: "no target", value: {} },
      { name: "an authority claim", value: { target: "thr_c1", authority: "user" } },
    ],
  },
  childrenCloseResult: {
    accept: [
      { name: "closed, nothing running", value: ok({ closed: true, killedJobs: [] }) },
      {
        name: "closed a running one-shot with its jobs",
        value: ok({ closed: true, report: reportClosed, killedJobs: ["job_1", "job_2"] }),
      },
      { name: "not authorized", value: fail("NOT_AUTHORIZED") },
    ],
    refuse: [
      { name: "closed false", value: ok({ closed: false, killedJobs: [] }) },
      { name: "no killed-jobs list", value: ok({ closed: true }) },
      {
        name: "a duplicate killed job",
        value: ok({ closed: true, killedJobs: ["job_1", "job_1"] }),
      },
    ],
  },
  childrenAwaitReportArgs: {
    accept: [
      { name: "await a child", value: { target: "thr_c1" } },
      { name: "await with a request id", value: { target: "thr_c1", requestId: "req_1" } },
    ],
    refuse: [
      { name: "no target", value: { requestId: "req_1" } },
      { name: "an empty request id", value: { target: "thr_c1", requestId: "" } },
    ],
  },
  childrenAwaitReportResult: {
    accept: [
      { name: "a completed report", value: ok(report) },
      { name: "a failed report with its cause", value: ok(reportFailed) },
      {
        name: "a structured report",
        value: ok({ ...report, structured: { verdict: "pass", items: [1, 2] } }),
      },
      { name: "not owned", value: fail("CHILD_NOT_OWNED") },
      { name: "cancelled wait", value: fail("ABORTED") },
    ],
    refuse: [
      { name: "a report with an unknown status", value: ok({ ...report, status: "done" }) },
      { name: "a report without a route", value: ok({ status: "completed", text: "x" }) },
      { name: "a report without text", value: ok({ status: "completed", route: 1 }) },
      { name: "a code of another operation", value: fail("CHILD_NOT_ADJACENT") },
    ],
  },
  childrenStatusArgs: {
    accept: [{ name: "status of a child session", value: { childSessionId: "sess_child1" } }],
    refuse: [
      { name: "no session", value: {} },
      { name: "a root claim", value: { childSessionId: "sess_child1", rootSessionId: "root1" } },
    ],
  },
  childrenStatusResult: {
    accept: [
      { name: "owned and idle", value: ok({ owned: true, state: "idle" }) },
      { name: "not owned", value: ok({ owned: false, state: "unknown" }) },
      { name: "ownership unknown", value: ok({ owned: "unknown", state: "unknown" }) },
      { name: "owned and closed", value: ok({ owned: true, state: "closed" }) },
    ],
    refuse: [
      { name: "owned as a string", value: ok({ owned: "yes", state: "idle" }) },
      { name: "an unknown state", value: ok({ owned: true, state: "dormant" }) },
      { name: "no state", value: ok({ owned: true }) },
      { name: "a failure code", value: fail("CHILD_NOT_OWNED") },
    ],
  },
  childrenCancelArgs: {
    accept: [{ name: "cancel a wait", value: { requestId: "req_1" } }],
    refuse: [
      { name: "no request id", value: {} },
      { name: "a target instead", value: { target: "thr_c1" } },
    ],
  },
  childrenCancelResult: {
    accept: [{ name: "accepted, also for an unknown id", value: ok({ accepted: true }) }],
    refuse: [
      { name: "accepted false", value: ok({ accepted: false }) },
      { name: "a failure code", value: fail("CHILD_NOT_OWNED") },
    ],
  },
  jobsOutputArgs: {
    accept: [
      { name: "read output", value: { jobId: "job_1" } },
      {
        name: "wait with the default bound",
        value: { jobId: "job_1", wait: true, requestId: "req_2" },
      },
      { name: "wait with a timeout", value: { jobId: "job_1", wait: true, timeoutMs: 5000 } },
    ],
    refuse: [
      { name: "a timeout without a wait", value: { jobId: "job_1", timeoutMs: 5000 } },
      { name: "a zero timeout", value: { jobId: "job_1", wait: true, timeoutMs: 0 } },
      { name: "a fractional timeout", value: { jobId: "job_1", wait: true, timeoutMs: 1.5 } },
      { name: "no job id", value: { wait: true } },
      { name: "a cursor claim", value: { jobId: "job_1", cursor: 10 } },
    ],
  },
  jobsOutputResult: {
    accept: [
      { name: "new output of a running job", value: ok(outputOk) },
      {
        name: "a finished job with its exit",
        value: ok({
          jobId: "job_1",
          state: "exited",
          streams: [stream, { stream: "stderr", from: 0, to: 0, text: "", truncated: false }],
          exit: exitCode,
          waitElapsed: false,
        }),
      },
      {
        name: "a killed job",
        value: ok({
          jobId: "job_1",
          state: "killed",
          streams: [],
          exit: exitSignal,
          waitElapsed: false,
        }),
      },
      {
        name: "an elapsed wait leaves the job running",
        value: ok({ ...outputOk, waitElapsed: true }),
      },
      {
        name: "a lost job with an indeterminate process",
        value: ok({
          jobId: "job_1",
          state: "lost",
          streams: [],
          waitElapsed: false,
          livenessIndeterminate: true,
        }),
      },
      {
        name: "truncated output",
        value: ok({ ...outputOk, streams: [{ ...stream, truncated: true }] }),
      },
      { name: "job not found", value: fail("JOB_NOT_FOUND") },
      { name: "cancelled wait", value: fail("ABORTED") },
    ],
    refuse: [
      { name: "an unknown state", value: ok({ ...outputOk, state: "paused" }) },
      {
        name: "a stream going backwards",
        value: ok({ ...outputOk, streams: [{ ...stream, from: 5, to: 2 }] }),
      },
      { name: "two chunks of one stream", value: ok({ ...outputOk, streams: [stream, stream] }) },
      {
        name: "an exit with neither code nor signal",
        value: ok({ ...outputOk, state: "exited", exit: { code: null, signal: null } }),
      },
      {
        name: "an exit with both code and signal",
        value: ok({ ...outputOk, state: "exited", exit: { code: 1, signal: "SIGTERM" } }),
      },
      { name: "no wait flag", value: ok({ jobId: "job_1", state: "running", streams: [] }) },
      { name: "an unavailable code inside done", value: fail("ORCHESTRATION_UNAVAILABLE") },
      { name: "a flag set false", value: ok({ ...outputOk, terminationUnconfirmed: false }) },
    ],
  },
  jobsListArgs: {
    accept: [
      { name: "own jobs by default", value: {} },
      { name: "descendants", value: { scope: "descendants" } },
    ],
    refuse: [
      { name: "another scope", value: { scope: "all" } },
      { name: "an owner claim", value: { scope: "own", ownerSessionId: "sess_other" } },
    ],
  },
  jobsListResult: {
    accept: [
      { name: "no jobs", value: ok({ jobs: [] }) },
      { name: "a running job", value: ok({ jobs: [jobRow] }) },
      {
        name: "a pending completion that is delivery-uncertain",
        value: ok({
          jobs: [
            {
              ...jobRow,
              state: "exited",
              completion: "pending",
              deliveryUncertain: true,
              exit: exitCode,
            },
          ],
        }),
      },
      {
        name: "a collected job",
        value: ok({
          jobs: [
            { ...jobRow, state: "killed", completion: "none", collectedAt: at, exit: exitSignal },
          ],
        }),
      },
      {
        name: "a lost job whose termination is unconfirmed",
        value: ok({
          jobs: [
            { ...jobRow, state: "lost", completion: "inserted", terminationUnconfirmed: true },
          ],
        }),
      },
    ],
    refuse: [
      { name: "an unknown completion", value: ok({ jobs: [{ ...jobRow, completion: "done" }] }) },
      {
        name: "a row without an owner",
        value: ok({ jobs: [{ jobId: "job_1", label: "x", state: "running", completion: "none" }] }),
      },
      {
        name: "a collectedAt that is not a time",
        value: ok({ jobs: [{ ...jobRow, collectedAt: "yesterday" }] }),
      },
      {
        name: "an uncertain flag set false",
        value: ok({ jobs: [{ ...jobRow, deliveryUncertain: false }] }),
      },
    ],
  },
  jobsKillArgs: {
    accept: [{ name: "kill a job", value: { jobId: "job_1" } }],
    refuse: [
      { name: "no job id", value: {} },
      { name: "a signal claim", value: { jobId: "job_1", signal: "SIGKILL" } },
    ],
  },
  jobsKillResult: {
    accept: [
      { name: "killed", value: ok({ jobId: "job_1", state: "killed", exit: exitSignal }) },
      { name: "already finished", value: ok({ jobId: "job_1", state: "exited", exit: exitCode }) },
      {
        name: "termination unconfirmed",
        value: ok({ jobId: "job_1", state: "lost", terminationUnconfirmed: true }),
      },
      { name: "not found", value: fail("JOB_NOT_FOUND") },
    ],
    refuse: [
      {
        name: "a state that is not final or lost",
        value: ok({ jobId: "job_1", state: "starting" }),
      },
      { name: "no state", value: ok({ jobId: "job_1" }) },
      { name: "a not-authorized code", value: fail("NOT_AUTHORIZED") },
    ],
  },
  jobsCancelArgs: {
    accept: [{ name: "cancel a wait", value: { requestId: "req_2" } }],
    refuse: [
      { name: "no request id", value: {} },
      { name: "a job id instead", value: { jobId: "job_1" } },
    ],
  },
  jobsCancelResult: {
    accept: [{ name: "accepted", value: ok({ accepted: true }) }],
    refuse: [
      { name: "accepted false", value: ok({ accepted: false }) },
      { name: "a not-found code", value: fail("JOB_NOT_FOUND") },
    ],
  },
  jobsReserveArgs: {
    accept: [
      {
        name: "reserve a background run",
        value: { runKey: "run_abc", label: "npm test", mode: "background" },
      },
      {
        name: "reserve a promotable foreground run",
        value: { runKey: "run_def", label: "build", mode: "foreground" },
      },
    ],
    refuse: [
      { name: "no run key", value: { label: "x", mode: "background" } },
      { name: "an unknown mode", value: { runKey: "run_abc", label: "x", mode: "detached" } },
      { name: "an empty label", value: { runKey: "run_abc", label: "", mode: "background" } },
      {
        name: "an output path chosen by the agent",
        value: { runKey: "run_abc", label: "x", mode: "background", outputPath: "/etc/passwd" },
      },
      {
        name: "an owner claim",
        value: { runKey: "run_abc", label: "x", mode: "background", ownerSessionId: "sess_other" },
      },
    ],
  },
  jobsReserveResult: {
    accept: [
      { name: "reserved", value: ok({ jobId: "job_1", state: "starting" }) },
      { name: "conflicting replay", value: fail("JOB_CONFLICT") },
    ],
    refuse: [
      { name: "reserved in another state", value: ok({ jobId: "job_1", state: "running" }) },
      { name: "no job id", value: ok({ state: "starting" }) },
      { name: "a not-found code", value: fail("JOB_NOT_FOUND") },
    ],
  },
  jobsAttachArgs: {
    accept: [
      {
        name: "attach the process",
        value: { jobId: "job_1", pid: 4242, pgid: 4242, startIdentity: { pid: 4242, startTime } },
      },
    ],
    refuse: [
      {
        name: "an unreadable start time",
        value: {
          jobId: "job_1",
          pid: 4242,
          pgid: 4242,
          startIdentity: { pid: 4242, startTime: null },
        },
      },
      {
        name: "pid zero",
        value: { jobId: "job_1", pid: 0, pgid: 4242, startIdentity: { pid: 0, startTime } },
      },
      {
        name: "a negative group",
        value: { jobId: "job_1", pid: 4242, pgid: -1, startIdentity: { pid: 4242, startTime } },
      },
      { name: "no start identity", value: { jobId: "job_1", pid: 4242, pgid: 4242 } },
      {
        name: "a start identity of another pid",
        value: { jobId: "job_1", pid: 4242, pgid: 4242, startIdentity: { pid: 7, startTime } },
      },
      {
        name: "a start identity with an extra key",
        value: {
          jobId: "job_1",
          pid: 4242,
          pgid: 4242,
          startIdentity: { pid: 4242, startTime, boot: "x" },
        },
      },
    ],
  },
  jobsAttachResult: {
    accept: [
      { name: "attached", value: ok({ jobId: "job_1", attached: true }) },
      { name: "identity mismatch", value: fail("JOB_IDENTITY_MISMATCH") },
      { name: "conflicting replay", value: fail("JOB_CONFLICT") },
      { name: "unknown job", value: fail("JOB_NOT_FOUND") },
    ],
    refuse: [
      { name: "attached false", value: ok({ jobId: "job_1", attached: false }) },
      { name: "a not-authorized code", value: fail("NOT_AUTHORIZED") },
    ],
  },
  jobsAdoptedArgs: {
    accept: [
      { name: "adopted on a background request", value: { jobId: "job_1", via: "background" } },
      { name: "adopted on a timeout", value: { jobId: "job_1", via: "timeout" } },
    ],
    refuse: [
      { name: "an unknown cause", value: { jobId: "job_1", via: "user" } },
      { name: "no cause", value: { jobId: "job_1" } },
    ],
  },
  jobsAdoptedResult: {
    accept: [
      {
        name: "confirmed after persistence",
        value: ok({ jobId: "job_1", confirmation: "adopted:job_1" }),
      },
      { name: "unknown job", value: fail("JOB_NOT_FOUND") },
      { name: "conflicting replay", value: fail("JOB_CONFLICT") },
    ],
    refuse: [
      { name: "an empty confirmation", value: ok({ jobId: "job_1", confirmation: "" }) },
      { name: "no confirmation", value: ok({ jobId: "job_1" }) },
    ],
  },
  jobsExitedArgs: {
    accept: [
      { name: "exited with a code", value: { jobId: "job_1", exit: exitCode } },
      { name: "exited on a signal", value: { jobId: "job_1", exit: exitSignal } },
    ],
    refuse: [
      {
        name: "neither code nor signal",
        value: { jobId: "job_1", exit: { code: null, signal: null } },
      },
      {
        name: "both code and signal",
        value: { jobId: "job_1", exit: { code: 1, signal: "SIGTERM" } },
      },
      { name: "no exit", value: { jobId: "job_1" } },
      { name: "a fractional code", value: { jobId: "job_1", exit: { code: 1.5, signal: null } } },
    ],
  },
  jobsExitedResult: {
    accept: [
      { name: "recorded", value: ok({ jobId: "job_1", recorded: true, supplemental: false }) },
      {
        name: "late exit beside a lost record",
        value: ok({ jobId: "job_1", recorded: true, supplemental: true }),
      },
      { name: "unknown job", value: fail("JOB_NOT_FOUND") },
      { name: "conflicting replay", value: fail("JOB_CONFLICT") },
    ],
    refuse: [
      { name: "not recorded", value: ok({ jobId: "job_1", recorded: false, supplemental: false }) },
      { name: "no supplemental flag", value: ok({ jobId: "job_1", recorded: true }) },
    ],
  },
};
