// AETHERIA M06 step 4: shared vectors for the interaction contracts, decoded by the fork's strict schemas and the outer pure codecs.
// `accept` must decode and `refuse` must not, in both; an unknown key is an error. Data only, no imports; every value is synthetic.
// Each set's key names the schema it is checked against. Frozen rules: no caller, actor, root or repository in Agent arguments;
// `interaction.release` takes cause `abort` only; a settled record carries its resolution; a human origin has only the listed pairs.

export interface InteractionVector {
  readonly name: string;
  readonly value: unknown;
}

export interface InteractionVectorSet {
  readonly accept: readonly InteractionVector[];
  readonly refuse: readonly InteractionVector[];
}

const sha = "0123456789abcdef".repeat(4);
const sha2 = "fedcba9876543210".repeat(4);
const at = "2026-11-10T12:00:00.000Z";
const at2 = "2026-11-10T12:05:00.000Z";

const q1 = {
  id: "q1",
  question: "Which store?",
  header: "Store",
  detail: "## Context\n- raw *Markdown* that is **never** an answer",
  options: [
    { label: "File", description: "plain files", context: "```ts\nconst x = 1;\n```" },
    { label: "Database" },
  ],
  multiSelect: false,
};
const q2 = { id: "q2", question: "Anything else?" };
const batch = { questions: [q1, q2] };
const answers = [
  { id: "q1", selected: ["File"], skipped: false },
  { id: "q2", selected: [], custom: "free text", skipped: false },
];
const answersWithSkip = [
  { id: "q1", selected: ["File", "Database"], custom: "both", skipped: false },
  { id: "q2", selected: [], skipped: true },
];

const subject = { type: "plan-review", id: "int_2", revision: sha };

const base = {
  interactionId: "int_1",
  revision: sha,
  rootSessionId: "root1",
  sessionId: "sess1",
  askCallId: "call1",
  createdAt: at,
  held: false,
};
const questionPending = { ...base, kind: "question", state: "pending", content: batch };
const questionContinued = {
  ...questionPending,
  state: "continued",
  continuedCause: "backend-restart",
};
const questionAnswered = {
  ...questionPending,
  state: "answered",
  resolution: { type: "answers", answers, originId: "org_1" },
  delivery: { status: "delivered", commandId: "interaction-answer-int_1" },
};
const planPending = {
  ...base,
  interactionId: "int_2",
  kind: "plan-review",
  state: "pending",
  content: { plan: "# Plan\n\nDo the thing.", reviewNumber: 1 },
};
const planApproved = {
  ...planPending,
  state: "answered",
  resolution: { type: "decision", decision: "approved", originId: "org_2" },
};
const authPending = {
  interactionId: "int_3",
  kind: "authorization",
  state: "pending",
  revision: sha2,
  rootSessionId: "root1",
  sessionId: "sess1",
  createdAt: at,
  held: false,
  content: {
    text: "Allow the write?",
    subject: { type: "write-proposal", id: "p1", revision: sha2 },
  },
};

const originBase = {
  originId: "org_1",
  interactionId: "int_1",
  subject: { type: "question", id: "int_1", revision: sha },
  payloadDigest: sha2,
  actor: { clientSessionId: "dev1", grantedScopes: ["orchestration:operate"], authenticatedAt: at },
  sessionId: "sess1",
  rootSessionId: "root1",
  at,
};
const originAnswer = { ...originBase, kind: "answer", decision: "answered" };
const originMode = {
  ...originBase,
  kind: "mode-change",
  interactionId: null,
  subject: { type: "plan-mode", id: "sess1", revision: sha },
  decision: "set-active",
  payloadDigest: null,
};
const originGrant = {
  ...originBase,
  kind: "authorization",
  interactionId: null,
  subject: { type: "write-proposal", id: "p1", revision: sha2 },
  decision: "approved",
  payloadDigest: null,
};

const ev = { at, rootSessionId: "root1", sessionId: "sess1" };
const evi = { ...ev, interactionId: "int_1" };

const planMode = { sessionId: "sess1", active: true, modeRevision: 3 };
const taskView = {
  sessionId: "sess1",
  rootSessionId: "root1",
  entryId: "entry_1",
  seq: 2,
  todos: [
    { content: "Write the contracts", status: "completed" },
    { content: "Run the tests", status: "in_progress" },
    { content: "Report", status: "in_progress" },
  ],
  publishedAt: at,
  state: "current",
};
/** The Agent's ordering evidence for one publication: the lifecycle it was issued in (reset on every session start and tree navigation) and its counter. */
const taskOrder = { lifecycle: at, n: 1 };

const ok = (value: unknown) => ({ ok: true, value });
const fail = (code: string) => ({ ok: false, code });

const auditDecided = {
  verdict: "plan-unchanged",
  cycle: "demo",
  record: "cycles/demo/record.md",
  planPath: "cycles/demo/plan.md",
  role: "reviewer",
  suppliedBy: "audit_evidence (fixed read-only git)",
  history: ["abc123 2026-11-10T12:00:00+00:00 Approve the Plan"],
  baselinePointerChanges: ["abc123 2026-11-10T12:00:00+00:00 Pointer"],
  currentPlan: "# Plan",
  currentPlanSha256: sha,
  baseline: "a".repeat(40),
  baselineCommit: `${"a".repeat(40)} 2026-11-10T12:00:00+00:00 Approve the Plan`,
  baselinePlanPath: "cycles/demo/plan.md",
  baselinePlan: "# Plan",
  baselinePlanSha256: sha,
  baselineGateHistory: "## Gate history",
  planApprovalRecorded: true,
  comparison:
    "link targets removed from both Plans before comparing; the texts and hashes above are raw",
  approvalCommit: "a".repeat(40),
  approvalGateEntry: "- Approve the Plan",
  baselinePointerVerified: true,
  firstBaselinePointerCommit: "b".repeat(40),
  historyHead: "c".repeat(40),
};

/** Keys an Agent argument object may never carry: the transport names the caller, its root and its repository. */
export const interactionForbiddenAgentKeys: readonly string[] = [
  "callerId",
  "caller",
  "actor",
  "sessionId",
  "rootSessionId",
  "threadId",
  "role",
  "repository",
  "repo",
  "root",
  "cwd",
];

export const interactionVectors: Readonly<Record<string, InteractionVectorSet>> = {
  questionBatch: {
    accept: [
      { name: "single-select, multi-line Markdown detail and context kept raw", value: batch },
      {
        name: "multi-select question",
        value: {
          questions: [{ id: "m", question: "Pick", options: [{ label: "A" }], multiSelect: true }],
        },
      },
    ],
    refuse: [
      { name: "no questions", value: { questions: [] } },
      { name: "duplicate question ids", value: { questions: [q2, { ...q2, question: "again" }] } },
      {
        name: "duplicate option labels",
        value: {
          questions: [{ id: "q", question: "?", options: [{ label: "A" }, { label: "A" }] }],
        },
      },
      { name: "empty question text", value: { questions: [{ id: "q", question: "" }] } },
      {
        name: "empty option list",
        value: { questions: [{ id: "q", question: "?", options: [] }] },
      },
      { name: "extra question key", value: { questions: [{ ...q2, required: true }] } },
      {
        name: "extra option key",
        value: {
          questions: [{ id: "q", question: "?", options: [{ label: "A", preselected: true }] }],
        },
      },
      { name: "extra batch key", value: { ...batch, sessionId: "s" } },
      {
        name: "options as a string",
        value: { questions: [{ id: "q", question: "?", options: "A" }] },
      },
    ],
  },
  answerBatch: {
    accept: [
      { name: "selected plus custom and free text", value: { answers } },
      { name: "multi-select with custom and a skipped item", value: { answers: answersWithSkip } },
    ],
    refuse: [
      { name: "no answers", value: { answers: [] } },
      {
        name: "duplicate answer ids",
        value: {
          answers: [
            { id: "q1", selected: [], skipped: true },
            { id: "q1", selected: [], skipped: true },
          ],
        },
      },
      { name: "skipped missing", value: { answers: [{ id: "q1", selected: ["File"] }] } },
      { name: "selected missing", value: { answers: [{ id: "q1", skipped: true }] } },
      {
        name: "extra answer key",
        value: { answers: [{ id: "q1", selected: [], skipped: true, by: "agent" }] },
      },
      {
        name: "selected not an array",
        value: { answers: [{ id: "q1", selected: "File", skipped: false }] },
      },
    ],
  },

  interactionCreateArgs: {
    accept: [
      { name: "question batch", value: { kind: "question", callId: "call1", ...batch } },
      {
        name: "question batch with the asker's wait",
        value: { kind: "question", callId: "call1", ...batch, waitMs: 60000 },
      },
      {
        name: "plan review",
        value: { kind: "plan-review", callId: "call2", plan: "# Plan\nbody" },
      },
    ],
    refuse: [
      {
        name: "authorization kind (Backend only)",
        value: { kind: "authorization", callId: "c", text: "ok?" },
      },
      { name: "call id missing", value: { kind: "question", ...batch } },
      { name: "empty plan", value: { kind: "plan-review", callId: "c", plan: "" } },
      { name: "wait of zero", value: { kind: "question", callId: "c", ...batch, waitMs: 0 } },
      { name: "wait fractional", value: { kind: "question", callId: "c", ...batch, waitMs: 1.5 } },
      { name: "actor claimed", value: { kind: "question", callId: "c", ...batch, actor: "human" } },
      {
        name: "root session smuggled",
        value: { kind: "question", callId: "c", ...batch, rootSessionId: "r" },
      },
      {
        name: "asker session smuggled",
        value: { kind: "question", callId: "c", ...batch, sessionId: "s" },
      },
      {
        name: "repository smuggled",
        value: { kind: "plan-review", callId: "c", plan: "p", repository: "/x" },
      },
      {
        name: "revision supplied by the Agent",
        value: { kind: "plan-review", callId: "c", plan: "p", revision: sha },
      },
      { name: "not an object", value: "question" },
    ],
  },
  interactionCreateResult: {
    accept: [
      { name: "the pending record", value: ok(questionPending) },
      { name: "review not permitted", value: fail("INTERACTION_REVIEW_NOT_PERMITTED") },
      { name: "not in plan mode", value: fail("INTERACTION_NOT_IN_PLAN_MODE") },
      {
        name: "answer invalid with detail",
        value: { ok: false, code: "INTERACTION_ANSWER_INVALID", detail: "plan over the limit" },
      },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "a code create never raises", value: fail("INTERACTION_NOT_FOUND") },
      { name: "an origin code", value: fail("ORIGIN_NOT_FOUND") },
      { name: "unknown code", value: fail("INTERACTION_BROKEN") },
      { name: "ok without a value", value: { ok: true } },
      {
        name: "ok with a code",
        value: { ok: true, value: questionPending, code: "INTERACTION_UNAVAILABLE" },
      },
      {
        name: "failure with a value",
        value: { ok: false, code: "INTERACTION_UNAVAILABLE", value: questionPending },
      },
    ],
  },

  interactionAwaitArgs: {
    accept: [{ name: "interaction id", value: { interactionId: "int_1" } }],
    refuse: [
      { name: "id missing", value: {} },
      { name: "empty id", value: { interactionId: "" } },
      { name: "session id smuggled", value: { interactionId: "int_1", sessionId: "s" } },
      { name: "actor claimed", value: { interactionId: "int_1", actor: "human" } },
    ],
  },
  interactionAwaitResult: {
    accept: [
      { name: "pending record", value: ok(questionPending) },
      { name: "continued record", value: ok(questionContinued) },
      { name: "answered record", value: ok(questionAnswered) },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "a record that is not a record", value: ok({ state: "pending" }) },
      {
        name: "already settled (not an await outcome)",
        value: { ok: false, code: "INTERACTION_ALREADY_SETTLED", record: questionAnswered },
      },
      { name: "stale revision", value: fail("INTERACTION_STALE_REVISION") },
    ],
  },

  interactionReleaseArgs: {
    accept: [{ name: "abort release", value: { interactionId: "int_1", cause: "abort" } }],
    refuse: [
      { name: "cause process-exit", value: { interactionId: "int_1", cause: "process-exit" } },
      {
        name: "cause backend-restart",
        value: { interactionId: "int_1", cause: "backend-restart" },
      },
      { name: "cause host-stop", value: { interactionId: "int_1", cause: "host-stop" } },
      { name: "cause missing", value: { interactionId: "int_1" } },
      { name: "id missing", value: { cause: "abort" } },
      {
        name: "root session smuggled",
        value: { interactionId: "int_1", cause: "abort", rootSessionId: "r" },
      },
    ],
  },
  interactionReleaseResult: {
    accept: [
      {
        name: "the continued record",
        value: ok({ ...questionContinued, continuedCause: "abort" }),
      },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "answer invalid", value: fail("INTERACTION_ANSWER_INVALID") },
      { name: "no ok flag", value: questionContinued },
    ],
  },

  tasksPublishArgs: {
    accept: [
      {
        name: "list with parallel in-progress items",
        value: { entryId: "entry_1", seq: 2, order: taskOrder, list: taskView.todos },
      },
      {
        name: "empty list",
        value: { entryId: "entry_1", seq: 0, order: { lifecycle: at, n: 0 }, list: [] },
      },
    ],
    refuse: [
      {
        name: "duplicate content",
        value: {
          entryId: "e",
          seq: 1,
          order: taskOrder,
          list: [
            { content: "a", status: "pending" },
            { content: "a", status: "completed" },
          ],
        },
      },
      {
        name: "empty content",
        value: {
          entryId: "e",
          seq: 1,
          order: taskOrder,
          list: [{ content: "", status: "pending" }],
        },
      },
      {
        name: "unknown status",
        value: {
          entryId: "e",
          seq: 1,
          order: taskOrder,
          list: [{ content: "a", status: "blocked" }],
        },
      },
      {
        name: "extra todo key",
        value: {
          entryId: "e",
          seq: 1,
          order: taskOrder,
          list: [{ content: "a", status: "pending", owner: "x" }],
        },
      },
      { name: "negative seq", value: { entryId: "e", seq: -1, order: taskOrder, list: [] } },
      { name: "entry id missing", value: { seq: 1, order: taskOrder, list: [] } },
      { name: "order missing", value: { entryId: "e", seq: 1, list: [] } },
      {
        name: "order lifecycle not a time",
        value: { entryId: "e", seq: 1, order: { lifecycle: "later", n: 1 }, list: [] },
      },
      {
        name: "order lifecycle without milliseconds (strings must compare in time order)",
        value: {
          entryId: "e",
          seq: 1,
          order: { lifecycle: "2026-11-10T12:00:00Z", n: 1 },
          list: [],
        },
      },
      {
        name: "order counter negative",
        value: { entryId: "e", seq: 1, order: { lifecycle: at, n: -1 }, list: [] },
      },
      {
        name: "order counter missing",
        value: { entryId: "e", seq: 1, order: { lifecycle: at }, list: [] },
      },
      {
        name: "extra order key",
        value: { entryId: "e", seq: 1, order: { ...taskOrder, branch: "b" }, list: [] },
      },
      {
        name: "session id smuggled",
        value: { entryId: "e", seq: 1, order: taskOrder, list: [], sessionId: "s" },
      },
      {
        name: "actor claimed",
        value: { entryId: "e", seq: 1, order: taskOrder, list: [], actor: "human" },
      },
      {
        name: "root claimed",
        value: { entryId: "e", seq: 1, order: taskOrder, list: [], rootSessionId: "r" },
      },
    ],
  },
  tasksPublishResult: {
    accept: [
      { name: "the stored view", value: ok(taskView) },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "view without sessionId", value: ok({ ...taskView, sessionId: undefined }) },
    ],
  },

  planModeGetArgs: {
    accept: [{ name: "no arguments: the session comes from identity", value: {} }],
    refuse: [
      { name: "session id named", value: { sessionId: "sess1" } },
      { name: "root session named", value: { rootSessionId: "root1" } },
      { name: "actor claimed", value: { actor: "human" } },
    ],
  },
  planModeGetResult: {
    accept: [
      { name: "active mode", value: ok(planMode) },
      {
        name: "initial inactive mode",
        value: ok({ sessionId: "sess1", active: false, modeRevision: 0 }),
      },
      { name: "not found (client read)", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "revision negative", value: ok({ ...planMode, modeRevision: -1 }) },
      { name: "active not boolean", value: ok({ ...planMode, active: "yes" }) },
      { name: "extra mode key", value: ok({ ...planMode, guidance: "text" }) },
    ],
  },

  auditHistoryArgs: {
    accept: [
      { name: "cycle slug", value: { cycle: "v1p1-human-control" } },
      {
        name: "a malformed slug still decodes: the Backend answers invalid",
        value: { cycle: "Not A Slug" },
      },
    ],
    refuse: [
      { name: "cycle missing", value: {} },
      { name: "cycle not a string", value: { cycle: 4 } },
      { name: "repository smuggled", value: { cycle: "demo", repository: "/etc" } },
      { name: "repo root smuggled", value: { cycle: "demo", root: "/etc" } },
      { name: "cwd smuggled", value: { cycle: "demo", cwd: "/tmp" } },
      { name: "session id smuggled", value: { cycle: "demo", sessionId: "s" } },
      { name: "git argument smuggled", value: { cycle: "demo", args: ["log"] } },
    ],
  },
  auditHistoryResult: {
    accept: [
      { name: "plan unchanged with full evidence", value: auditDecided },
      { name: "plan changed", value: { ...auditDecided, verdict: "plan-changed" } },
      {
        name: "invalid slug",
        value: { verdict: "invalid", reason: "cycle must be a kebab-case slug" },
      },
      {
        name: "unverified: no record",
        value: {
          verdict: "unverified",
          cycle: "demo",
          reason: "cycles/demo/record.md does not exist in this repository",
        },
      },
      {
        name: "unverified with partial evidence and project problems",
        value: {
          verdict: "unverified",
          cycle: "demo",
          record: "cycles/demo/record.md",
          planPath: "cycles/demo/plan.md",
          history: [],
          baselinePointerChanges: [],
          currentPlan: null,
          currentPlanSha256: null,
          reason: "the current record has no Plan",
          projectProblems: ["settings unreadable"],
        },
      },
    ],
    refuse: [
      { name: "unknown verdict", value: { ...auditDecided, verdict: "approved" } },
      { name: "unverified without a reason", value: { verdict: "unverified", cycle: "demo" } },
      { name: "invalid without a reason", value: { verdict: "invalid" } },
      {
        name: "decided verdict missing the approval commit",
        value: { ...auditDecided, approvalCommit: undefined },
      },
      {
        name: "decided verdict with an unverified pointer",
        value: { ...auditDecided, baselinePointerVerified: false },
      },
      {
        name: "settingsProblems kept from the helper",
        value: { ...auditDecided, settingsProblems: [] },
      },
    ],
  },

  originVerifyArgs: {
    accept: [
      { name: "id only", value: { originId: "org_1" } },
      {
        name: "full expectation",
        value: {
          originId: "org_1",
          expect: {
            kind: "answer",
            subject: { type: "question", id: "int_1", revision: sha },
            sessionId: "sess1",
          },
        },
      },
      { name: "empty expectation", value: { originId: "org_1", expect: {} } },
    ],
    refuse: [
      { name: "id missing", value: { expect: { kind: "answer" } } },
      {
        name: "unknown kind expected",
        value: { originId: "org_1", expect: { kind: "direct-message" } },
      },
      {
        name: "revision not a digest",
        value: { originId: "org_1", expect: { subject: { revision: "r1" } } },
      },
      {
        name: "extra expectation key",
        value: { originId: "org_1", expect: { decision: "approved" } },
      },
      { name: "root session smuggled", value: { originId: "org_1", rootSessionId: "r" } },
      { name: "actor claimed", value: { originId: "org_1", actor: "human" } },
      { name: "write intent smuggled", value: { originId: "org_1", write: true } },
    ],
  },
  originVerifyResult: {
    accept: [
      { name: "verified with the origin", value: { verified: true, origin: originAnswer } },
      { name: "not found", value: { verified: false, code: "ORIGIN_NOT_FOUND" } },
      {
        name: "mismatch names the kind",
        value: { verified: false, code: "ORIGIN_MISMATCH", field: "kind" },
      },
      {
        name: "mismatch names the session",
        value: { verified: false, code: "ORIGIN_MISMATCH", field: "sessionId" },
      },
      { name: "stale revision", value: { verified: false, code: "ORIGIN_STALE" } },
    ],
    refuse: [
      { name: "mismatch without a field", value: { verified: false, code: "ORIGIN_MISMATCH" } },
      {
        name: "mismatch naming the revision (that is ORIGIN_STALE)",
        value: { verified: false, code: "ORIGIN_MISMATCH", field: "subject.revision" },
      },
      {
        name: "mismatch naming an unknown field",
        value: { verified: false, code: "ORIGIN_MISMATCH", field: "decision" },
      },
      { name: "verified without an origin", value: { verified: true } },
      {
        name: "verified with a code",
        value: { verified: true, origin: originAnswer, code: "ORIGIN_STALE" },
      },
      {
        name: "not verified with an origin",
        value: { verified: false, code: "ORIGIN_STALE", origin: originAnswer },
      },
      { name: "an interaction code", value: { verified: false, code: "INTERACTION_NOT_FOUND" } },
    ],
  },

  interactionRecord: {
    accept: [
      { name: "pending question", value: questionPending },
      {
        name: "timed question with a deadline, held",
        value: { ...questionPending, waitMs: 60000, deadlineAt: at2, held: true },
      },
      { name: "continued after backend restart", value: questionContinued },
      {
        name: "continued after expiry",
        value: { ...questionContinued, continuedCause: "timed_out" },
      },
      { name: "answered question delivered", value: questionAnswered },
      {
        // A late answer: the store keeps why the wait ended as history (packages/aetheria-interaction core and codec).
        name: "late-answered question keeps its continued cause",
        value: { ...questionAnswered, continuedCause: "process-exit" },
      },
      {
        name: "late-cancelled question keeps its continued cause",
        value: {
          ...questionPending,
          state: "cancelled",
          resolution: { type: "cancelled", originId: "org_1" },
          continuedCause: "backend-restart",
        },
      },
      {
        name: "answered question whose delivery failed",
        value: { ...questionAnswered, delivery: { status: "failed", code: "DISPATCH_REJECTED" } },
      },
      {
        name: "answered question with delivery still pending",
        value: { ...questionAnswered, delivery: { status: "pending" } },
      },
      {
        name: "cancelled by the human with feedback",
        value: {
          ...questionPending,
          state: "cancelled",
          resolution: { type: "cancelled", feedback: "no thanks", originId: "org_9" },
        },
      },
      {
        name: "cancelled because plan mode went off",
        value: {
          ...planPending,
          state: "cancelled",
          resolution: { type: "cancelled", cause: "mode-off" },
        },
      },
      {
        name: "superseded plan review",
        value: {
          ...planPending,
          state: "superseded",
          resolution: { type: "superseded", by: "int_4" },
        },
      },
      { name: "pending plan review", value: planPending },
      { name: "approved plan review", value: planApproved },
      {
        name: "plan review with changes requested",
        value: {
          ...planApproved,
          resolution: {
            type: "decision",
            decision: "changes_requested",
            feedback: "split step 2",
            originId: "org_3",
          },
        },
      },
      { name: "authorization created by a Backend service (no ask call id)", value: authPending },
      {
        name: "authorization answered",
        value: {
          ...authPending,
          state: "answered",
          resolution: {
            type: "answers",
            answers: [{ id: "decision", selected: ["Approve"], skipped: false }],
            originId: "org_4",
          },
        },
      },
    ],
    refuse: [
      { name: "unknown kind", value: { ...questionPending, kind: "direct-message" } },
      { name: "unknown state", value: { ...questionPending, state: "closed" } },
      { name: "closed is an event, not a state", value: { ...questionPending, state: "ended" } },
      { name: "revision not a SHA-256", value: { ...questionPending, revision: "r1" } },
      {
        name: "kind and content disagree",
        value: { ...questionPending, content: planPending.content },
      },
      {
        name: "pending with a resolution",
        value: { ...questionPending, resolution: { type: "answers", answers, originId: "o" } },
      },
      { name: "answered without a resolution", value: { ...questionPending, state: "answered" } },
      {
        name: "answered question with a plan decision",
        value: {
          ...questionAnswered,
          resolution: { type: "decision", decision: "approved", originId: "o" },
        },
      },
      {
        name: "answered plan review with answers",
        value: { ...planApproved, resolution: { type: "answers", answers, originId: "o" } },
      },
      {
        name: "cancelled with an answers resolution",
        value: {
          ...questionPending,
          state: "cancelled",
          resolution: { type: "answers", answers, originId: "o" },
        },
      },
      {
        name: "superseded with a decision",
        value: {
          ...planPending,
          state: "superseded",
          resolution: { type: "decision", decision: "approved", originId: "o" },
        },
      },
      {
        name: "delivery on a pending record",
        value: { ...questionPending, delivery: { status: "pending" } },
      },
      {
        name: "plan decision of declined",
        value: {
          ...planApproved,
          resolution: { type: "decision", decision: "declined", originId: "o" },
        },
      },
      {
        name: "continued cause not one of the fixed causes",
        value: { ...questionContinued, continuedCause: "user-left" },
      },
      {
        name: "continued without a cause",
        value: { ...questionContinued, continuedCause: undefined },
      },
      {
        name: "a cause on a pending record",
        value: { ...questionPending, continuedCause: "abort" },
      },
      {
        name: "an asked question without its ask call id",
        value: { ...questionPending, askCallId: undefined },
      },
      {
        name: "delivered without a command id",
        value: { ...questionAnswered, delivery: { status: "delivered" } },
      },
      { name: "root session missing", value: { ...questionPending, rootSessionId: undefined } },
      { name: "extra record key", value: { ...questionPending, actor: "human" } },
      { name: "extra content key", value: { ...questionPending, content: { ...batch, extra: 1 } } },
    ],
  },

  interactionEvent: {
    accept: [
      { name: "created", value: { ...evi, type: "created", kind: "question", revision: sha } },
      { name: "closed", value: { ...evi, type: "closed" } },
      { name: "held", value: { ...evi, type: "held" } },
      { name: "timed_out", value: { ...evi, type: "timed_out" } },
      { name: "wait_lost abort", value: { ...evi, type: "wait_lost", cause: "abort" } },
      {
        name: "wait_lost process-exit",
        value: { ...evi, type: "wait_lost", cause: "process-exit" },
      },
      {
        name: "wait_lost backend-restart",
        value: { ...evi, type: "wait_lost", cause: "backend-restart" },
      },
      { name: "wait_lost host-stop", value: { ...evi, type: "wait_lost", cause: "host-stop" } },
      { name: "answered", value: { ...evi, type: "answered", originId: "org_1" } },
      { name: "cancelled by a human", value: { ...evi, type: "cancelled", originId: "org_1" } },
      { name: "cancelled by mode off", value: { ...evi, type: "cancelled", cause: "mode-off" } },
      { name: "superseded", value: { ...evi, type: "superseded", by: "int_4" } },
      {
        name: "delivered",
        value: { ...evi, type: "delivered", commandId: "interaction-answer-int_1" },
      },
      {
        name: "delivery_failed",
        value: { ...evi, type: "delivery_failed", code: "DISPATCH_REJECTED" },
      },
      {
        name: "mode_set on the session journal",
        value: { ...ev, type: "mode_set", active: true, modeRevision: 1, originId: "org_5" },
      },
      {
        name: "granted",
        value: {
          ...ev,
          type: "granted",
          originId: "org_6",
          subject: { type: "write-proposal", id: "p1", revision: sha2 },
        },
      },
    ],
    refuse: [
      { name: "unknown event type", value: { ...evi, type: "reopened" } },
      {
        name: "wait_lost with a cause outside the four",
        value: { ...evi, type: "wait_lost", cause: "timeout" },
      },
      { name: "wait_lost without a cause", value: { ...evi, type: "wait_lost" } },
      { name: "delivered without a command id", value: { ...evi, type: "delivered" } },
      { name: "delivery_failed without a code", value: { ...evi, type: "delivery_failed" } },
      { name: "answered without an origin", value: { ...evi, type: "answered" } },
      {
        name: "created with an unknown kind",
        value: { ...evi, type: "created", kind: "chat", revision: sha },
      },
      {
        name: "mode_set without a revision",
        value: { ...ev, type: "mode_set", active: true, originId: "o" },
      },
      { name: "closed carrying a state", value: { ...evi, type: "closed", state: "continued" } },
      { name: "time missing", value: { ...evi, type: "closed", at: undefined } },
      { name: "time not ISO-8601 UTC", value: { ...evi, type: "closed", at: "yesterday" } },
    ],
  },

  humanOrigin: {
    accept: [
      { name: "answer", value: originAnswer },
      {
        name: "cancel is an answer-kind origin",
        value: { ...originAnswer, decision: "cancelled", payloadDigest: null },
      },
      {
        name: "plan approval",
        value: {
          ...originBase,
          kind: "plan-decision",
          interactionId: "int_2",
          subject,
          decision: "approved",
        },
      },
      {
        name: "plan changes requested",
        value: {
          ...originBase,
          kind: "plan-decision",
          interactionId: "int_2",
          subject,
          decision: "changes_requested",
        },
      },
      {
        name: "authorization answered declined",
        value: {
          ...originBase,
          kind: "authorization",
          interactionId: "int_3",
          decision: "declined",
        },
      },
      { name: "mode change set-active", value: originMode },
      { name: "mode change set-inactive", value: { ...originMode, decision: "set-inactive" } },
      { name: "one-step grant: no interaction", value: originGrant },
    ],
    refuse: [
      {
        name: "direct-message kind does not exist",
        value: { ...originAnswer, kind: "direct-message" },
      },
      {
        name: "answer with an approval decision",
        value: { ...originAnswer, decision: "approved" },
      },
      {
        name: "plan decision answered",
        value: { ...originAnswer, kind: "plan-decision", decision: "answered" },
      },
      { name: "mode change with an interaction", value: { ...originMode, interactionId: "int_1" } },
      { name: "mode change approved", value: { ...originMode, decision: "approved" } },
      { name: "answer with a null interaction", value: { ...originAnswer, interactionId: null } },
      { name: "grant declined", value: { ...originGrant, decision: "declined" } },
      {
        name: "subject revision not a digest",
        value: { ...originAnswer, subject: { type: "question", id: "i", revision: "r1" } },
      },
      { name: "payload digest not a digest", value: { ...originAnswer, payloadDigest: "abc" } },
      {
        name: "actor without scopes",
        value: { ...originAnswer, actor: { clientSessionId: "d", authenticatedAt: at } },
      },
      {
        name: "actor with extra key",
        value: { ...originAnswer, actor: { ...originAnswer.actor, name: "Pat" } },
      },
      { name: "root session missing", value: { ...originAnswer, rootSessionId: undefined } },
      { name: "time not ISO-8601 UTC", value: { ...originAnswer, at: "2026-11-10" } },
      { name: "extra origin key", value: { ...originAnswer, text: "I approve" } },
    ],
  },

  planMode: {
    accept: [
      { name: "active", value: planMode },
      { name: "never set", value: { sessionId: "s", active: false, modeRevision: 0 } },
    ],
    refuse: [
      { name: "revision missing", value: { sessionId: "s", active: true } },
      { name: "revision fractional", value: { ...planMode, modeRevision: 1.5 } },
      { name: "session missing", value: { active: true, modeRevision: 1 } },
    ],
  },

  taskView: {
    accept: [
      { name: "view", value: taskView },
      { name: "empty list", value: { ...taskView, todos: [] } },
      { name: "stale view", value: { ...taskView, state: "stale" } },
      { name: "unknown view", value: { ...taskView, state: "unknown" } },
    ],
    refuse: [
      { name: "published time missing", value: { ...taskView, publishedAt: undefined } },
      { name: "state missing", value: { ...taskView, state: undefined } },
      { name: "state not one of the three", value: { ...taskView, state: "fresh" } },
      { name: "root missing", value: { ...taskView, rootSessionId: undefined } },
      { name: "order is not part of the view", value: { ...taskView, order: taskOrder } },
      {
        name: "duplicate content",
        value: { ...taskView, todos: [taskView.todos[0], taskView.todos[0]] },
      },
      { name: "extra key", value: { ...taskView, stale: true } },
    ],
  },

  questionEvidenceArgs: {
    accept: [
      { name: "root and ask call", value: { rootSessionId: "root1", askCallId: "call1" } },
      {
        name: "with the asker's session",
        value: { rootSessionId: "root1", askCallId: "call1", askerSessionId: "sess1" },
      },
    ],
    refuse: [
      { name: "root missing", value: { askCallId: "call1" } },
      { name: "ask call missing", value: { rootSessionId: "root1" } },
      { name: "extra key", value: { rootSessionId: "root1", askCallId: "call1", actor: "human" } },
    ],
  },
  questionEvidenceResult: {
    accept: [
      {
        name: "answered with a verified origin",
        value: ok({
          state: "answered",
          answered: true,
          startedAt: at,
          answeredAt: at2,
          answers,
          originId: "org_1",
          interactionId: "int_1",
        }),
      },
      {
        name: "still pending",
        value: ok({ state: "pending", answered: false, startedAt: at, interactionId: "int_1" }),
      },
      {
        name: "continued",
        value: ok({ state: "continued", answered: false, startedAt: at, interactionId: "int_1" }),
      },
      {
        name: "cancelled",
        value: ok({ state: "cancelled", answered: false, startedAt: at, interactionId: "int_1" }),
      },
      {
        name: "ambiguous across child sessions",
        value: ok({
          state: "pending",
          answered: false,
          startedAt: at,
          interactionId: "int_1",
          ambiguous: true,
        }),
      },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      {
        name: "answered true in a pending state",
        value: ok({ state: "pending", answered: true, startedAt: at, interactionId: "int_1" }),
      },
      {
        name: "answered true without an origin",
        value: ok({
          state: "answered",
          answered: true,
          startedAt: at,
          answeredAt: at2,
          answers,
          interactionId: "int_1",
        }),
      },
      {
        name: "answered true without answers",
        value: ok({
          state: "answered",
          answered: true,
          startedAt: at,
          answeredAt: at2,
          originId: "o",
          interactionId: "int_1",
        }),
      },
      {
        name: "ambiguous yet answered",
        value: ok({
          state: "answered",
          answered: true,
          startedAt: at,
          answeredAt: at2,
          answers,
          originId: "o",
          interactionId: "int_1",
          ambiguous: true,
        }),
      },
      {
        name: "started time missing",
        value: ok({ state: "pending", answered: false, interactionId: "int_1" }),
      },
      {
        name: "extra evidence key",
        value: ok({
          state: "pending",
          answered: false,
          startedAt: at,
          interactionId: "int_1",
          agentReport: "yes",
        }),
      },
    ],
  },

  interactionsSnapshotPayload: {
    accept: [{ name: "root session", value: { rootSessionId: "root1" } }],
    refuse: [
      { name: "root missing", value: {} },
      { name: "actor in the payload", value: { rootSessionId: "root1", actor: "human" } },
      {
        name: "scopes in the payload",
        value: { rootSessionId: "root1", scopes: ["orchestration:operate"] },
      },
    ],
  },
  interactionsSnapshotResult: {
    accept: [
      {
        name: "records with the version",
        value: ok({
          rootSessionId: "root1",
          version: 7,
          interactions: [questionPending, planApproved],
        }),
      },
      {
        name: "empty snapshot",
        value: ok({ rootSessionId: "root1", version: 0, interactions: [] }),
      },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "version missing", value: ok({ rootSessionId: "root1", interactions: [] }) },
      {
        name: "version negative",
        value: ok({ rootSessionId: "root1", version: -1, interactions: [] }),
      },
      {
        name: "a record that is invalid",
        value: ok({ rootSessionId: "root1", version: 1, interactions: [{ state: "pending" }] }),
      },
    ],
  },
  planModeGetPayload: {
    accept: [{ name: "session", value: { sessionId: "sess1" } }],
    refuse: [
      { name: "session missing", value: {} },
      { name: "extra key", value: { sessionId: "s", actor: "x" } },
    ],
  },
  tasksGetPayload: {
    accept: [{ name: "session", value: { sessionId: "sess1" } }],
    refuse: [
      { name: "session missing", value: {} },
      { name: "extra key", value: { sessionId: "s", rootSessionId: "r" } },
    ],
  },
  tasksGetResult: {
    accept: [
      { name: "a view", value: ok(taskView) },
      { name: "no list published yet", value: ok(null) },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "unreadable read as an empty list", value: ok({ ...taskView, todos: undefined }) },
      { name: "delivery failed (not a read outcome)", value: fail("INTERACTION_DELIVERY_FAILED") },
    ],
  },
  interactionsChangesPayload: {
    accept: [{ name: "root session", value: { rootSessionId: "root1" } }],
    refuse: [
      { name: "root missing", value: {} },
      { name: "from-version smuggled", value: { rootSessionId: "root1", since: 3 } },
    ],
  },
  interactionsChangeEvent: {
    accept: [
      { name: "version one", value: { rootSessionId: "root1", version: 1 } },
      { name: "later version", value: { rootSessionId: "root1", version: 42 } },
    ],
    refuse: [
      { name: "version zero (a change exists)", value: { rootSessionId: "root1", version: 0 } },
      { name: "version fractional", value: { rootSessionId: "root1", version: 1.5 } },
      {
        name: "carries the record",
        value: { rootSessionId: "root1", version: 1, record: questionPending },
      },
      { name: "root missing", value: { version: 1 } },
    ],
  },

  interactionsAnswerPayload: {
    accept: [
      {
        name: "answers for the seen revision",
        value: { interactionId: "int_1", revision: sha, answers },
      },
      {
        name: "a skipped item",
        value: { interactionId: "int_1", revision: sha, answers: answersWithSkip },
      },
    ],
    refuse: [
      { name: "revision missing", value: { interactionId: "int_1", answers } },
      {
        name: "answers as a bare array",
        value: { interactionId: "int_1", revision: sha, answers: "yes" },
      },
      { name: "empty answer list", value: { interactionId: "int_1", revision: sha, answers: [] } },
      {
        name: "actor in the payload",
        value: { interactionId: "int_1", revision: sha, answers, actor: "dev1" },
      },
      {
        name: "scopes in the payload",
        value: { interactionId: "int_1", revision: sha, answers, grantedScopes: [] },
      },
      {
        name: "session id in the payload",
        value: { interactionId: "int_1", revision: sha, answers, sessionId: "s" },
      },
    ],
  },
  interactionsCancelPayload: {
    accept: [
      { name: "cancel", value: { interactionId: "int_1", revision: sha } },
      {
        name: "cancel with feedback",
        value: { interactionId: "int_1", revision: sha, feedback: "not needed" },
      },
    ],
    refuse: [
      { name: "revision missing", value: { interactionId: "int_1" } },
      {
        name: "actor in the payload",
        value: { interactionId: "int_1", revision: sha, actor: "dev1" },
      },
    ],
  },
  interactionsHoldPayload: {
    accept: [{ name: "hold", value: { interactionId: "int_1", revision: sha } }],
    refuse: [
      { name: "revision missing", value: { interactionId: "int_1" } },
      {
        name: "feedback (not a hold field)",
        value: { interactionId: "int_1", revision: sha, feedback: "x" },
      },
    ],
  },
  interactionsClosePayload: {
    accept: [{ name: "close", value: { interactionId: "int_1", revision: sha } }],
    refuse: [
      { name: "revision missing", value: { interactionId: "int_1" } },
      {
        name: "feedback (not a close field)",
        value: { interactionId: "int_1", revision: sha, feedback: "x" },
      },
    ],
  },
  planDecidePayload: {
    accept: [
      { name: "approved", value: { interactionId: "int_2", revision: sha, decision: "approved" } },
      {
        name: "changes requested with feedback",
        value: {
          interactionId: "int_2",
          revision: sha,
          decision: "changes_requested",
          feedback: "split step 2",
        },
      },
    ],
    refuse: [
      {
        name: "declined is not a plan decision",
        value: { interactionId: "int_2", revision: sha, decision: "declined" },
      },
      { name: "decision missing", value: { interactionId: "int_2", revision: sha } },
      {
        name: "revision not a digest",
        value: { interactionId: "int_2", revision: "r1", decision: "approved" },
      },
      {
        name: "actor in the payload",
        value: { interactionId: "int_2", revision: sha, decision: "approved", actor: "dev1" },
      },
    ],
  },
  planModeSetPayload: {
    accept: [
      { name: "turn on", value: { sessionId: "sess1", active: true, expectedModeRevision: 0 } },
      { name: "turn off", value: { sessionId: "sess1", active: false, expectedModeRevision: 3 } },
    ],
    refuse: [
      { name: "expected revision missing", value: { sessionId: "sess1", active: true } },
      {
        name: "expected revision negative",
        value: { sessionId: "sess1", active: true, expectedModeRevision: -1 },
      },
      {
        name: "active not boolean",
        value: { sessionId: "sess1", active: "on", expectedModeRevision: 0 },
      },
      {
        name: "root session claimed",
        value: { sessionId: "sess1", active: true, expectedModeRevision: 0, rootSessionId: "r" },
      },
    ],
  },
  authorizationGrantPayload: {
    accept: [
      {
        name: "subject and session",
        value: {
          subject: { type: "write-proposal", id: "p1", revision: sha2 },
          sessionId: "sess1",
        },
      },
    ],
    refuse: [
      { name: "subject missing", value: { sessionId: "sess1" } },
      {
        name: "session missing",
        value: { subject: { type: "write-proposal", id: "p1", revision: sha2 } },
      },
      {
        name: "revision not a digest",
        value: { subject: { type: "t", id: "i", revision: "r" }, sessionId: "sess1" },
      },
      {
        name: "root session claimed",
        value: {
          subject: { type: "t", id: "i", revision: sha },
          sessionId: "sess1",
          rootSessionId: "r",
        },
      },
      {
        name: "decision named by the client",
        value: {
          subject: { type: "t", id: "i", revision: sha },
          sessionId: "sess1",
          decision: "approved",
        },
      },
    ],
  },

  interactionActionResult: {
    accept: [
      { name: "the updated record", value: ok(questionAnswered) },
      {
        name: "already settled carries the settled record",
        value: { ok: false, code: "INTERACTION_ALREADY_SETTLED", record: questionAnswered },
      },
      {
        name: "delivery failed leaves the answered record",
        value: {
          ok: false,
          code: "INTERACTION_DELIVERY_FAILED",
          record: {
            ...questionAnswered,
            delivery: { status: "failed", code: "DISPATCH_REJECTED" },
          },
        },
      },
      { name: "stale revision", value: fail("INTERACTION_STALE_REVISION") },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "origin not human", value: fail("INTERACTION_ORIGIN_NOT_HUMAN") },
      {
        name: "answer invalid",
        value: { ok: false, code: "INTERACTION_ANSWER_INVALID", detail: "unknown label Zed" },
      },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "already settled without the record", value: fail("INTERACTION_ALREADY_SETTLED") },
      { name: "delivery failed without the record", value: fail("INTERACTION_DELIVERY_FAILED") },
      {
        name: "grant invalid (not an interaction action outcome)",
        value: fail("INTERACTION_GRANT_INVALID"),
      },
      { name: "format unsupported (startup only)", value: fail("INTERACTION_FORMAT_UNSUPPORTED") },
      { name: "an origin code", value: fail("ORIGIN_STALE") },
    ],
  },
  planModeSetResult: {
    accept: [
      { name: "the new mode", value: ok({ sessionId: "sess1", active: true, modeRevision: 4 }) },
      { name: "stale mode revision", value: fail("INTERACTION_STALE_REVISION") },
      { name: "origin not human", value: fail("INTERACTION_ORIGIN_NOT_HUMAN") },
      { name: "not found", value: fail("INTERACTION_NOT_FOUND") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "answer invalid", value: fail("INTERACTION_ANSWER_INVALID") },
      { name: "a record instead of a mode", value: ok(questionPending) },
    ],
  },
  authorizationGrantResult: {
    accept: [
      { name: "origin id for the client to pass to M07", value: ok({ originId: "org_6" }) },
      { name: "grant invalid", value: fail("INTERACTION_GRANT_INVALID") },
      { name: "origin not human", value: fail("INTERACTION_ORIGIN_NOT_HUMAN") },
      { name: "unavailable", value: fail("INTERACTION_UNAVAILABLE") },
    ],
    refuse: [
      { name: "the full origin (only the id is returned)", value: ok(originGrant) },
      { name: "origin id missing", value: ok({}) },
      { name: "stale revision", value: fail("INTERACTION_STALE_REVISION") },
    ],
  },
};
