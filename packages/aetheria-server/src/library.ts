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
import { auditHistory } from "@aetheria/evidence/backend";
import * as NodeCrypto from "node:crypto";

import {
  sessionTurnDispatch,
  type AuditPort,
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

/** The runtime function the audit evidence operation calls (M06 step 23); a test checks it exists on the installed evidence archive's Backend entry. */
export const EVIDENCE_LIBRARY_EXPORTS = ["auditHistory"] as const;

/**
 * The fixed, read-only audit `history` operation over the real Node file and Git adapters. The Backend passes only the cycle slug, the project facts its
 * own check derived for the caller, the role and a drain signal; no repository, path, Git option or actor reaches it.
 */
export const readAuditHistory: AuditPort["history"] = (input) =>
  auditHistory({
    cycle: input.cycle,
    project: {
      root: input.project.root,
      place: input.project.place,
      settingsPaths: { cycles: input.project.settingsPaths.cycles },
      problems: input.project.problems,
    },
    role: input.role,
    signal: input.signal,
  });

/** The runtime functions the human-control module calls; a test checks each exists on the installed interaction archive's Backend entry. */
export const INTERACTION_LIBRARY_EXPORTS = [
  "createFileInteractionStore",
  "createInteractionService",
] as const;

/**
 * The production interaction service over the archive: the file store under the explicit state root (no I/O until `start`), the Backend's clock,
 * random opaque ids, T3's delivery by session, and the host's independent root/session access check.
 */
export const createArchiveInteractionService: HumanControlServiceFactory = (deps) => {
  // Built as a value, not a literal: the archive's dependency type gains `sessions` with the step-15 repack, and a fresh literal would be
  // rejected for it until then.
  const archiveDeps = {
    store: createFileInteractionStore(deps.stateRoot),
    clock: {
      now: () => new Date(deps.now()).toISOString(),
      nowMs: () => deps.now(),
    },
    ids: { next: (prefix: "int" | "org") => `${prefix}-${NodeCrypto.randomUUID()}` },
    canOperate: deps.canOperate,
    sessions: deps.sessions,
    writtenBy: "aetheria-backend",
    ...optionalDispatch(deps),
  };
  const archive = createInteractionService(archiveDeps);
  // The archive's reads carry no actor, so a client read is access-checked here by the very `canOperate` the archive applies to its actions: one rule.
  return asHumanControlService(
    Object.assign(archive, {
      canAccess: (
        actor: Parameters<HumanControlServiceDeps["canOperate"]>[0],
        target: Parameters<HumanControlServiceDeps["canOperate"]>[1],
      ) => deps.canOperate(actor, target),
    }),
  );
};

// The archive's record types and the contracts' strict schemas describe the same wire (the shared vectors prove it); TypeScript cannot see
// that the kind/content union matches field for field, so this one seam names the service as the wire-typed port the Backend serves.
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
