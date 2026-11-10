// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA — the one import site of the pinned library archives (design M02 D7/C3; M09 A15; M06 step 6).
// It names exactly three specifiers, `@aetheria/awareness/backend`, `@aetheria/providers/backend` and `@aetheria/interaction/backend`,
// the Backend-only entries of the archives declared in package.json; a test checks that no other module imports an `@aetheria/*` package.
import {
  createFxAv,
  createPiAuthPort,
  createProductionAvailability,
  createProductionResearch,
  createProductionSnapshots,
  createProvidersOperations,
  effectiveRoute,
  parameter,
  RoutePolicyError,
  type EffectiveRouteSource,
  type PiAuthPort,
  type ProductionResearchOptions,
  type ProductionSnapshots,
  type EffortValidation,
  type FxAvScript,
  type ProductionAvailabilityOptions,
  type Route,
  type RouteAvailability,
  type RouteCapabilities,
  type RoutePolicyErrorCode,
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
  recordShell,
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
import {
  createFileInteractionStore,
  createInteractionService,
} from "@aetheria/interaction/backend";
import * as NodeCrypto from "node:crypto";

import {
  sessionTurnDispatch,
  type HumanControlService,
  type HumanControlServiceDeps,
  type HumanControlServiceFactory,
} from "./humanControl.ts";

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
  recordShell,
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

export {
  createFxAv,
  createPiAuthPort,
  createProductionAvailability,
  createProductionResearch,
  createProductionSnapshots,
  createProvidersOperations,
  effectiveRoute,
  parameter,
  RoutePolicyError,
};
export type {
  EffectiveRouteSource,
  EffortValidation,
  FxAvScript,
  PiAuthPort,
  ProductionAvailabilityOptions,
  ProductionResearchOptions,
  ProductionSnapshots,
  Route,
  RouteAvailability,
  RouteCapabilities,
  RoutePolicyErrorCode,
};

/** The runtime functions the providers module calls; a test checks each exists on the installed providers archive's Backend entry. */
export const PROVIDERS_LIBRARY_EXPORTS = [
  "createFxAv",
  "createPiAuthPort",
  "createProductionAvailability",
  "createProductionResearch",
  "createProductionSnapshots",
  "createProvidersOperations",
  "effectiveRoute",
  "parameter",
  "RoutePolicyError",
] as const;

/** The runtime functions the human-control module calls; a test checks each exists on the installed interaction archive's Backend entry. */
export const INTERACTION_LIBRARY_EXPORTS = [
  "createFileInteractionStore",
  "createInteractionService",
] as const;

/**
 * The production interaction service over the archive: the file store under the explicit state root (no I/O until `start`), the Backend's clock,
 * random opaque ids, T3's delivery by session, and the host's independent root/session access check.
 */
export const createArchiveInteractionService: HumanControlServiceFactory = (deps) =>
  // The archive's record types and the contracts' strict schemas describe the same wire (the shared vectors prove it); TypeScript cannot see
  // that the kind/content union matches field for field, so this one seam names the service as the wire-typed port the Backend serves.
  asHumanControlService(
    createInteractionService({
      store: createFileInteractionStore(deps.stateRoot),
      clock: {
        now: () => new Date(deps.now()).toISOString(),
        nowMs: () => deps.now(),
      },
      ids: { next: (prefix) => `${prefix}-${NodeCrypto.randomUUID()}` },
      canOperate: deps.canOperate,
      writtenBy: "aetheria-backend",
      ...optionalDispatch(deps),
    }),
  );

const asHumanControlService = (service: unknown): HumanControlService =>
  service as HumanControlService;

function optionalDispatch(deps: HumanControlServiceDeps) {
  const dispatch = sessionTurnDispatch(deps);
  return dispatch === undefined ? {} : { dispatch };
}

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
  "recordShell",
  "register",
  "resolveWorkspace",
  "start",
  "summarize",
] as const;
