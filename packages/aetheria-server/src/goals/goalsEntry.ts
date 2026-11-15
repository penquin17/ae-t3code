// oxlint-disable-next-line typescript/triple-slash-reference -- the archive's ./tools entry ships no declarations; this declares the part used
/// <reference path="./goalsTools.d.ts" />
// AETHERIA M07 Plan step 14 — the one import site of the pinned `@aetheria/goals` archive, through its Backend entry. Every other module under `goals/` takes the goal service's names from
// here, so a test can check that no other file reaches the archive and that no outer-source path is used.
export {
  GOAL_PARAMETERS,
  createGoalService,
  openGoalStore,
  runGoalCommand,
  validateGoalParameters,
} from "@aetheria/goals/backend";
// The model's three goal operations (XC-6, DV10): their names, strict argument codecs and the strict reply codec, from the archive's narrow tools entry (no store and no authority gate).
export {
  GOAL_OPERATIONS,
  decodeCreateGoalArgs,
  decodeGetGoalArgs,
  decodeGoalToolReply,
  decodeUpdateGoalArgs,
} from "@aetheria/goals/tools";
export type { GoalToolReply, ToolGoal } from "@aetheria/goals/tools";
export type {
  AdmissionPort,
  AdmissionState,
  BootReport,
  Clock,
  GoalCommandPlan,
  GoalCommandPort,
  GoalParameterValues,
  GoalResult,
  GoalService,
  GoalStore,
  GoalView,
  InteractionPort,
  InteractionView,
  NoticePort,
  RootResolver,
  SettledEvent,
  T3Goal,
  T3GoalCommand,
  T3GoalStatus,
  ThreadReceiptPort,
  TrustedAuthority,
  TypedGoalOutcome,
} from "@aetheria/goals/backend";
