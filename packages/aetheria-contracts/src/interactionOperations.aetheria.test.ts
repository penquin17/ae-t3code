// AETHERIA M06 step 4: the strict interaction contracts against the shared vectors (the outer codecs decode the same file).
// Each `accept` vector decodes unchanged and each `refuse` vector throws under `onExcessProperty: "error"`; the code list and RPC
// declarations are checked too. Handlers, the scope table and the Backend are later steps and are not exercised.
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AUDIT_HISTORY_OPERATION,
  AetheriaInteractionRpcGroup,
  AetheriaRpcGroup,
  AuditHistoryArgs,
  AuditHistoryResult,
  AuthorizationGrantPayload,
  AuthorizationGrantResult,
  AnswerBatch,
  HumanOrigin,
  INTERACTION_AWAIT_OPERATION,
  INTERACTION_CODE_CLASSES,
  INTERACTION_CODES,
  INTERACTION_CREATE_OPERATION,
  INTERACTION_RELEASE_OPERATION,
  InteractionActionResult,
  InteractionAwaitArgs,
  InteractionAwaitResult,
  InteractionsCancelPayload,
  InteractionsChangeEvent,
  InteractionsChangesPayload,
  InteractionsClosePayload,
  InteractionCreateArgs,
  InteractionCreateResult,
  InteractionEvent,
  InteractionsHoldPayload,
  InteractionRecord,
  InteractionReleaseArgs,
  InteractionReleaseResult,
  InteractionsAnswerPayload,
  InteractionsSnapshotPayload,
  InteractionsSnapshotResult,
  ORIGIN_VERIFY_OPERATION,
  OriginVerifyArgs,
  OriginVerifyResult,
  PLAN_MODE_GET_OPERATION,
  PlanDecidePayload,
  PlanMode,
  PlanModeGetArgs,
  PlanModeGetPayload,
  PlanModeGetResult,
  PlanModeSetPayload,
  PlanModeSetResult,
  QuestionBatch,
  QuestionEvidenceArgs,
  QuestionEvidenceResult,
  TASKS_PUBLISH_OPERATION,
  TasksGetPayload,
  TasksGetResult,
  TasksPublishArgs,
  TasksPublishResult,
  TaskView,
  WAIT_LOST_CAUSES,
  XC6_OPERATION_NAME_PATTERN,
} from "./index.ts";
import {
  interactionForbiddenAgentKeys,
  interactionVectors,
} from "./interactionOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;

const SCHEMAS = {
  questionBatch: QuestionBatch,
  answerBatch: AnswerBatch,
  interactionCreateArgs: InteractionCreateArgs,
  interactionCreateResult: InteractionCreateResult,
  interactionAwaitArgs: InteractionAwaitArgs,
  interactionAwaitResult: InteractionAwaitResult,
  interactionReleaseArgs: InteractionReleaseArgs,
  interactionReleaseResult: InteractionReleaseResult,
  tasksPublishArgs: TasksPublishArgs,
  tasksPublishResult: TasksPublishResult,
  planModeGetArgs: PlanModeGetArgs,
  planModeGetResult: PlanModeGetResult,
  auditHistoryArgs: AuditHistoryArgs,
  auditHistoryResult: AuditHistoryResult,
  originVerifyArgs: OriginVerifyArgs,
  originVerifyResult: OriginVerifyResult,
  interactionRecord: InteractionRecord,
  interactionEvent: InteractionEvent,
  humanOrigin: HumanOrigin,
  planMode: PlanMode,
  taskView: TaskView,
  questionEvidenceArgs: QuestionEvidenceArgs,
  questionEvidenceResult: QuestionEvidenceResult,
  interactionsSnapshotPayload: InteractionsSnapshotPayload,
  interactionsSnapshotResult: InteractionsSnapshotResult,
  planModeGetPayload: PlanModeGetPayload,
  tasksGetPayload: TasksGetPayload,
  tasksGetResult: TasksGetResult,
  interactionsChangesPayload: InteractionsChangesPayload,
  interactionsChangeEvent: InteractionsChangeEvent,
  interactionsAnswerPayload: InteractionsAnswerPayload,
  interactionsCancelPayload: InteractionsCancelPayload,
  interactionsHoldPayload: InteractionsHoldPayload,
  interactionsClosePayload: InteractionsClosePayload,
  planDecidePayload: PlanDecidePayload,
  planModeSetPayload: PlanModeSetPayload,
  authorizationGrantPayload: AuthorizationGrantPayload,
  interactionActionResult: InteractionActionResult,
  planModeSetResult: PlanModeSetResult,
  authorizationGrantResult: AuthorizationGrantResult,
} as const;

/** The Agent-side argument schemas: their callers are named by the transport, never by a field. */
const AGENT_ARGS = {
  interactionCreateArgs: InteractionCreateArgs,
  interactionAwaitArgs: InteractionAwaitArgs,
  interactionReleaseArgs: InteractionReleaseArgs,
  tasksPublishArgs: TasksPublishArgs,
  planModeGetArgs: PlanModeGetArgs,
  auditHistoryArgs: AuditHistoryArgs,
  originVerifyArgs: OriginVerifyArgs,
} as const;

const decoder = (schema: unknown) =>
  Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict);

describe("interaction.* and companion XC-6 operations", () => {
  it("are named by the seven registered strings, each valid under the XC-6 name pattern", () => {
    const names = [
      INTERACTION_CREATE_OPERATION,
      INTERACTION_AWAIT_OPERATION,
      INTERACTION_RELEASE_OPERATION,
      TASKS_PUBLISH_OPERATION,
      PLAN_MODE_GET_OPERATION,
      AUDIT_HISTORY_OPERATION,
      ORIGIN_VERIFY_OPERATION,
    ];
    expect(names).toEqual([
      "interaction.create",
      "interaction.await",
      "interaction.release",
      "tasks.publish",
      "plan-mode.get",
      "audit.history",
      "origin.verify",
    ]);
    for (const name of names) expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });

  it("have no operation that decides: none is named answer, decide, grant, cancel or set", () => {
    expect(Object.keys(AGENT_ARGS).sort()).toEqual(
      [
        "auditHistoryArgs",
        "interactionAwaitArgs",
        "interactionCreateArgs",
        "interactionReleaseArgs",
        "originVerifyArgs",
        "planModeGetArgs",
        "tasksPublishArgs",
      ].sort(),
    );
  });
});

describe("the canonical code list", () => {
  it("carries the fourteen codes with the classes Plan step 4 fixes", () => {
    expect(INTERACTION_CODE_CLASSES).toEqual({
      INTERACTION_ORIGIN_NOT_HUMAN: "refusal",
      INTERACTION_REVIEW_NOT_PERMITTED: "refusal",
      INTERACTION_NOT_IN_PLAN_MODE: "refusal",
      INTERACTION_ANSWER_INVALID: "refusal",
      INTERACTION_GRANT_INVALID: "refusal",
      INTERACTION_ALREADY_SETTLED: "conflict",
      INTERACTION_STALE_REVISION: "conflict",
      ORIGIN_STALE: "conflict",
      INTERACTION_NOT_FOUND: "absence",
      ORIGIN_NOT_FOUND: "absence",
      ORIGIN_MISMATCH: "absence",
      INTERACTION_UNAVAILABLE: "failure",
      INTERACTION_DELIVERY_FAILED: "failure",
      INTERACTION_FORMAT_UNSUPPORTED: "failure",
    });
    expect([...INTERACTION_CODES].sort()).toEqual(Object.keys(INTERACTION_CODE_CLASSES).sort());
  });

  it("names exactly the four wait-lost causes", () => {
    expect([...WAIT_LOST_CAUSES]).toEqual([
      "abort",
      "process-exit",
      "backend-restart",
      "host-stop",
    ]);
  });
});

describe("interaction vectors", () => {
  it("have one schema per vector set and one vector set per schema", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(interactionVectors).sort());
  });

  const cases = Object.entries(SCHEMAS).flatMap(([codec, schema]) => {
    const decode = decoder(schema);
    const set = interactionVectors[codec];
    return [
      ...(set?.accept ?? []).map((vector) => ({ codec, kind: "accepts", vector, decode })),
      ...(set?.refuse ?? []).map((vector) => ({ codec, kind: "refuses", vector, decode })),
    ];
  });

  it.each(cases)("$codec $kind: $vector.name", ({ kind, vector, decode }) => {
    if (kind === "accepts") expect(decode(structuredClone(vector.value))).toEqual(vector.value);
    else expect(() => decode(structuredClone(vector.value))).toThrow();
  });

  it("give every set at least one accept and one refuse case", () => {
    for (const [codec, set] of Object.entries(interactionVectors)) {
      expect(set.accept.length, `${codec} accept`).toBeGreaterThan(0);
      expect(set.refuse.length, `${codec} refuse`).toBeGreaterThan(0);
    }
  });
});

describe("an Agent argument object never carries who is calling", () => {
  const keys = interactionForbiddenAgentKeys;

  it("lists the identity, actor, root and repository keys the transport owns", () => {
    for (const key of ["actor", "rootSessionId", "sessionId", "repository", "root", "role"]) {
      expect(keys).toContain(key);
    }
  });

  const cases = Object.entries(AGENT_ARGS).flatMap(([codec, schema]) => {
    const decode = decoder(schema);
    const valid = interactionVectors[codec]?.accept[0]?.value as Record<string, unknown>;
    return keys.map((key) => ({ codec, key, decode, valid }));
  });

  it.each(cases)("$codec refuses an extra $key", ({ decode, valid, key }) => {
    // The valid base decodes; adding the key (not already part of the schema) must not.
    expect(() => decode(structuredClone(valid))).not.toThrow();
    const claimed = { ...valid, [key]: "claimed" };
    if (key in valid) return;
    expect(() => decode(claimed)).toThrow();
  });
});

describe("the XC-18 RPC declarations", () => {
  const expected = {
    interactionsSnapshot: "aetheria.interactions.snapshot",
    interactionsChanges: "aetheria.interactions.changes",
    planModeGet: "aetheria.planMode.get",
    tasksGet: "aetheria.tasks.get",
    interactionsAnswer: "aetheria.interactions.answer",
    interactionsCancel: "aetheria.interactions.cancel",
    interactionsHold: "aetheria.interactions.hold",
    interactionsClose: "aetheria.interactions.close",
    planDecide: "aetheria.plan.decide",
    planModeSet: "aetheria.planMode.set",
    authorizationGrant: "aetheria.authorization.grant",
  } as const;

  it("adds the three reads, the change stream and seven human actions beside composition.status", () => {
    expect(AETHERIA_WS_METHODS).toMatchObject(expected);
    expect(AETHERIA_WS_METHODS.compositionStatus).toBe("aetheria.composition.status");
    expect([...AetheriaInteractionRpcGroup.requests.keys()].sort()).toEqual(
      Object.values(expected).sort(),
    );
    // Step 6 merged the XC-18 group into the group T3 joins (IP-3): status first, then the eleven methods.
    expect([...AetheriaRpcGroup.requests.keys()].sort()).toEqual(
      Object.values(AETHERIA_WS_METHODS).sort(),
    );
    for (const tag of Object.values(AETHERIA_WS_METHODS))
      expect(tag.startsWith("aetheria.")).toBe(true);
  });

  it("makes the change stream, and only it, a stream", () => {
    const streams = [...AetheriaInteractionRpcGroup.requests.values()]
      .filter((rpc) => RpcSchema.isStreamSchema(rpc.successSchema))
      .map((rpc) => rpc._tag);
    expect(streams).toEqual([expected.interactionsChanges]);
  });

  it("names no action that reads context and no Agent decision", () => {
    for (const tag of AetheriaInteractionRpcGroup.requests.keys()) {
      expect(tag).not.toMatch(/context|agent/i);
    }
  });
});

describe("the snapshot's additive `retiredRoots` (M10 review 1, follow-up 4a)", () => {
  const decode = decoder(InteractionsSnapshotResult);
  const base = { rootSessionId: "root-live", version: 3, interactions: [] };

  it("an older reply without it still decodes; with it, the replaced roots are named by id", () => {
    expect(() => decode({ ok: true, value: base })).not.toThrow();
    expect(() =>
      decode({ ok: true, value: { ...base, retiredRoots: ["root-old-1", "root-old-2"] } }),
    ).not.toThrow();
  });

  it("refuses a replaced root that is not an id, and any other extra field", () => {
    expect(() => decode({ ok: true, value: { ...base, retiredRoots: [""] } })).toThrow();
    expect(() => decode({ ok: true, value: { ...base, retiredRoots: [7] } })).toThrow();
    expect(() => decode({ ok: true, value: { ...base, replaced: ["root-old"] } })).toThrow();
  });
});
