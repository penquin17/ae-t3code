// AETHERIA — the namespaced RPC group T3's WsRpcGroup joins (IP-3): read-only `composition.status` plus the M06 XC-18 methods, scoped by T3 (IP-20),
// served by Aetheria handlers (IP-22), with the actor always from the connection, never a payload; T3's `RpcScopeAuthorization` supplies the auth error.
// This file must not import `@t3tools/contracts`: that package joins this group, so an import back would be a package cycle.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  ClientChildrenCancelTreePayload,
  ClientChildrenCancelTreeResult,
  ClientChildrenClosePayload,
  ClientChildrenCloseResult,
  ClientChildrenInterruptPayload,
  ClientChildrenInterruptResult,
  ClientChildrenListPayload,
  ClientChildrenListResult,
  ClientChildrenReportPayload,
  ClientChildrenReportResult,
} from "./childrenControlOperations.ts";
import { AetheriaCompositionStatus } from "./compositionStatus.ts";
import {
  GroupsApplyPayload,
  GroupsApplyResult,
  GroupsReadPayload,
  GroupsReadResult,
} from "./groupsOperations.ts";
import {
  AuthorizationGrantPayload,
  AuthorizationGrantResult,
  InteractionActionResult,
  InteractionsAnswerPayload,
  InteractionsCancelPayload,
  InteractionsChangeEvent,
  InteractionsChangesPayload,
  InteractionsClosePayload,
  InteractionsHoldPayload,
  InteractionsSnapshotPayload,
  InteractionsSnapshotResult,
  PlanDecidePayload,
  PlanModeGetPayload,
  PlanModeGetResult,
  PlanModeSetPayload,
  PlanModeSetResult,
  TasksGetPayload,
  TasksGetResult,
} from "./interactionOperations.ts";

export const AETHERIA_WS_METHODS = {
  compositionStatus: "aetheria.composition.status",
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
  // M10 step 3 (R1): the user's tree Stop and per-child controls. `list` is a read; the other three need `orchestration:operate`.
  childrenCancelTree: "aetheria.children.cancelTree",
  childrenList: "aetheria.children.list",
  childrenInterrupt: "aetheria.children.interrupt",
  childrenClose: "aetheria.children.close",
  // M10 step 10: the stored report of one child (a read, `orchestration:read`).
  childrenReport: "aetheria.children.report",
  // M10 step 7 (D3): the session-group store. `read` is a read; `apply` (the five-operation union) needs `orchestration:operate`.
  groupsRead: "aetheria.groups.read",
  groupsApply: "aetheria.groups.apply",
} as const;

/** The Backend is not attached or has not produced a status; the caller sees this instead of an invented value. */
export class AetheriaStatusUnavailableError extends Schema.TaggedError<AetheriaStatusUnavailableError>()(
  "AetheriaStatusUnavailableError",
  { message: Schema.String },
) {}

export const AetheriaCompositionStatusRpc = Rpc.make(AETHERIA_WS_METHODS.compositionStatus, {
  payload: Schema.Struct({}),
  success: AetheriaCompositionStatus,
  error: AetheriaStatusUnavailableError,
});

// Reads (`orchestration:read`). A failure is a coded value in the reply, never an empty success.
const AetheriaInteractionsSnapshotRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsSnapshot, {
  payload: InteractionsSnapshotPayload,
  success: InteractionsSnapshotResult,
});
const AetheriaPlanModeGetRpc = Rpc.make(AETHERIA_WS_METHODS.planModeGet, {
  payload: PlanModeGetPayload,
  success: PlanModeGetResult,
});
const AetheriaTasksGetRpc = Rpc.make(AETHERIA_WS_METHODS.tasksGet, {
  payload: TasksGetPayload,
  success: TasksGetResult,
});

// The change stream (`orchestration:read`): each element prompts a fresh snapshot; it carries no record.
const AetheriaInteractionsChangesRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsChanges, {
  payload: InteractionsChangesPayload,
  success: InteractionsChangeEvent,
  stream: true,
});

// The seven human actions (`orchestration:operate`), each replying with the updated record or a code.
const AetheriaInteractionsAnswerRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsAnswer, {
  payload: InteractionsAnswerPayload,
  success: InteractionActionResult,
});
const AetheriaInteractionsCancelRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsCancel, {
  payload: InteractionsCancelPayload,
  success: InteractionActionResult,
});
const AetheriaInteractionsHoldRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsHold, {
  payload: InteractionsHoldPayload,
  success: InteractionActionResult,
});
const AetheriaInteractionsCloseRpc = Rpc.make(AETHERIA_WS_METHODS.interactionsClose, {
  payload: InteractionsClosePayload,
  success: InteractionActionResult,
});
const AetheriaPlanDecideRpc = Rpc.make(AETHERIA_WS_METHODS.planDecide, {
  payload: PlanDecidePayload,
  success: InteractionActionResult,
});
const AetheriaPlanModeSetRpc = Rpc.make(AETHERIA_WS_METHODS.planModeSet, {
  payload: PlanModeSetPayload,
  success: PlanModeSetResult,
});
const AetheriaAuthorizationGrantRpc = Rpc.make(AETHERIA_WS_METHODS.authorizationGrant, {
  payload: AuthorizationGrantPayload,
  success: AuthorizationGrantResult,
});

/**
 * The XC-18 methods as their own group. `AetheriaRpcGroup` merges it (M06 step 6), so T3's one join point (IP-3) carries both and T3's
 * exhaustive scope table, instrumentation map and handler map have a row for each method, the actor always coming from the connection.
 */
export const AetheriaInteractionRpcGroup = RpcGroup.make(
  AetheriaInteractionsSnapshotRpc,
  AetheriaInteractionsChangesRpc,
  AetheriaPlanModeGetRpc,
  AetheriaTasksGetRpc,
  AetheriaInteractionsAnswerRpc,
  AetheriaInteractionsCancelRpc,
  AetheriaInteractionsHoldRpc,
  AetheriaInteractionsCloseRpc,
  AetheriaPlanDecideRpc,
  AetheriaPlanModeSetRpc,
  AetheriaAuthorizationGrantRpc,
);

// The user's children controls (M10 step 3). Payloads name threads only; a failure is a coded value in the reply, never an empty success.
const AetheriaChildrenCancelTreeRpc = Rpc.make(AETHERIA_WS_METHODS.childrenCancelTree, {
  payload: ClientChildrenCancelTreePayload,
  success: ClientChildrenCancelTreeResult,
});
const AetheriaChildrenListRpc = Rpc.make(AETHERIA_WS_METHODS.childrenList, {
  payload: ClientChildrenListPayload,
  success: ClientChildrenListResult,
});
const AetheriaChildrenInterruptRpc = Rpc.make(AETHERIA_WS_METHODS.childrenInterrupt, {
  payload: ClientChildrenInterruptPayload,
  success: ClientChildrenInterruptResult,
});
const AetheriaChildrenCloseRpc = Rpc.make(AETHERIA_WS_METHODS.childrenClose, {
  payload: ClientChildrenClosePayload,
  success: ClientChildrenCloseResult,
});

const AetheriaChildrenReportRpc = Rpc.make(AETHERIA_WS_METHODS.childrenReport, {
  payload: ClientChildrenReportPayload,
  success: ClientChildrenReportResult,
});

export const AetheriaChildrenRpcGroup = RpcGroup.make(
  AetheriaChildrenCancelTreeRpc,
  AetheriaChildrenListRpc,
  AetheriaChildrenInterruptRpc,
  AetheriaChildrenCloseRpc,
  AetheriaChildrenReportRpc,
);

// The session-group store (M10 step 7). Payloads name sessions and a name only; a failure is a coded value in the reply, never an empty success.
const AetheriaGroupsReadRpc = Rpc.make(AETHERIA_WS_METHODS.groupsRead, {
  payload: GroupsReadPayload,
  success: GroupsReadResult,
});
const AetheriaGroupsApplyRpc = Rpc.make(AETHERIA_WS_METHODS.groupsApply, {
  payload: GroupsApplyPayload,
  success: GroupsApplyResult,
});

export const AetheriaGroupsRpcGroup = RpcGroup.make(AetheriaGroupsReadRpc, AetheriaGroupsApplyRpc);

export const AetheriaRpcGroup = RpcGroup.make(AetheriaCompositionStatusRpc)
  .merge(AetheriaInteractionRpcGroup)
  .merge(AetheriaChildrenRpcGroup)
  .merge(AetheriaGroupsRpcGroup);
