// AETHERIA — the one import site of the pinned library archives (design M02 D7/C3; M09 A15).
// It names exactly two specifiers, `@aetheria/awareness/backend` and `@aetheria/providers/backend`, the Backend-only
// entries of the archives declared in package.json; a test checks that no other module imports an `@aetheria/*` package.
import {
  createFxAv,
  createProductionAvailability,
  createProvidersOperations,
  type FxAvScript,
  type ProductionAvailabilityOptions,
  type RouteAvailability,
} from "@aetheria/providers/backend";
import {
  awarenessAction,
  boardFileFor,
  checkWrite,
  compareFaults,
  createBoardService,
  createDecisionEvidence,
  createFileBoardStorage,
  createHost,
  createRecordedCalls,
  createViewMemory,
  dispose,
  evaluate,
  evidenceFromObservation,
  hostStatus,
  nodePathFs,
  parseAwarenessConfig,
  parsePorcelain,
  reconcileBoard,
  recordEdit,
  register,
  resolveWorkspace,
  start,
  summarize,
  type ActionCaller,
  type Activation,
  type AwarenessConfig,
  type BoardService,
  type ChangedFiles,
  type ChangedFilesPort,
  type ChildStatus,
  type DigestReport,
  type DisposalReport,
  type HolderObservation,
  type LifecycleHost,
  type ModuleStatus,
  type ReconcileResult,
  type SessionEvidence,
  type StartResult,
} from "@aetheria/awareness/backend";

export {
  awarenessAction,
  boardFileFor,
  checkWrite,
  compareFaults,
  createBoardService,
  createDecisionEvidence,
  createFileBoardStorage,
  createHost,
  createRecordedCalls,
  createViewMemory,
  dispose,
  evaluate,
  evidenceFromObservation,
  hostStatus,
  nodePathFs,
  parseAwarenessConfig,
  parsePorcelain,
  reconcileBoard,
  recordEdit,
  register,
  resolveWorkspace,
  start,
  summarize,
};
export type {
  ActionCaller,
  Activation,
  AwarenessConfig,
  BoardService,
  ChangedFiles,
  ChangedFilesPort,
  ChildStatus,
  DigestReport,
  DisposalReport,
  HolderObservation,
  LifecycleHost,
  ModuleStatus,
  ReconcileResult,
  SessionEvidence,
  StartResult,
};

export { createFxAv, createProductionAvailability, createProvidersOperations };
export type { FxAvScript, ProductionAvailabilityOptions, RouteAvailability };

/** The runtime functions the providers module calls; a test checks each exists on the installed providers archive's Backend entry. */
export const PROVIDERS_LIBRARY_EXPORTS = [
  "createFxAv",
  "createProductionAvailability",
  "createProvidersOperations",
] as const;

/** A reportable problem, as the shared validator and lifecycle driver return it. */
export type Fault = Extract<StartResult, { readonly outcome: "refused" }>["faults"][number];

/** The runtime functions the adapter calls; a test checks each exists on the installed archive's Backend entry. */
export const LIBRARY_EXPORTS = [
  "awarenessAction",
  "boardFileFor",
  "checkWrite",
  "compareFaults",
  "createBoardService",
  "createDecisionEvidence",
  "createFileBoardStorage",
  "createHost",
  "createRecordedCalls",
  "createViewMemory",
  "dispose",
  "evaluate",
  "evidenceFromObservation",
  "hostStatus",
  "nodePathFs",
  "parseAwarenessConfig",
  "parsePorcelain",
  "reconcileBoard",
  "recordEdit",
  "register",
  "resolveWorkspace",
  "start",
  "summarize",
] as const;
