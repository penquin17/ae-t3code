// AETHERIA M07 Plan step 14 — the one import site of the pinned `@aetheria/goals` archive, through its Backend entry. Every other module under `goals/` takes the goal service's names from
// here, so a test can check that no other file reaches the archive and that no outer-source path is used.
export {
  GOAL_PARAMETERS,
  createGoalService,
  openGoalStore,
  validateGoalParameters,
} from "@aetheria/goals/backend";
export type {
  AdmissionPort,
  AdmissionState,
  BootReport,
  Clock,
  GoalParameterValues,
  GoalService,
  GoalStore,
  InteractionPort,
  InteractionView,
  NoticePort,
  RootResolver,
  SettledEvent,
  ThreadReceiptPort,
  TrustedAuthority,
} from "@aetheria/goals/backend";
