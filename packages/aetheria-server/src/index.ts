export {
  OPERATION_NOT_RUNNING,
  prepareBackend,
  type BackendAdapter,
  type BackendEvent,
  type BackendFacts,
  type BackendObserver,
  type BackendRegistration,
  type PrepareOptions,
  type PrepareResult,
} from "./adapter.ts";
export {
  AGENT_AWARENESS_BACKEND_ENTRY,
  AGENT_AWARENESS_BACKEND_ID,
  agentAwarenessBackendModuleRow,
  createAgentAwarenessBackendRegistration,
} from "./agentAwareness.ts";
export {
  PROVIDERS_BACKEND_ENTRY,
  PROVIDERS_BACKEND_ID,
  createProvidersBackendRegistration,
  providersBackendModuleRow,
  type ProvidersMode,
  type ProvidersRegistrationOptions,
} from "./providers.ts";
export {
  HUMAN_CONTROL_BACKEND_ENTRY,
  HUMAN_CONTROL_BACKEND_ID,
  createHumanControlBackendRegistration,
  humanControlBackendModuleRow,
  sessionTurnDispatch,
  type AgentIdentity,
  type AuditPort,
  type ClientActor,
  type ClientIdentity,
  type HumanControlBackendRegistration,
  type HumanControlDrainReport,
  type HumanControlService,
  type HumanControlServiceDeps,
  type HumanControlServiceFactory,
  type SessionTurnDispatch,
  type ThreadTurnDispatch,
} from "./humanControl.ts";
export {
  ORCHESTRATION_BACKEND_ENTRY,
  ORCHESTRATION_BACKEND_ID,
  ORCHESTRATION_UNAVAILABLE_CODE,
  createOrchestrationBackendRegistration,
  orchestrationBackendModuleRow,
  type OrchestrationBackendRegistration,
  type OrchestrationCaller,
  type OrchestrationDrainReport,
  type OrchestrationOutcome,
  type OrchestrationRegistrationOptions,
  type OrchestrationService,
  type OrchestrationServiceDeps,
  type OrchestrationServiceFactory,
} from "./orchestration.ts";
export {
  createOrchestrationFactory,
  type CallerContextPort,
  type CallerContextResult,
  type OrchestrationFactoryOptions,
} from "./orchestrationFactory.ts";
export {
  THREAD_PORT_CALLS,
  type ChildLineageReader,
  type ChildLineageThread,
  type ChildModelSelection,
  type ChildRestartNote,
  type ChildThreadLineage,
  type ChildThreadPort,
  type ChildThreadStatus,
  type ChildTurnCompletedEvent,
  type ChildTurnOutcome,
  type CompletionWake,
  type CreateChildThreadInput,
  type DelegatedCompletionState,
  type PlanModeInheritPort,
  type PortResult,
  type ResumeBarrierPort,
} from "./orchestrationPorts.ts";
export {
  GENERIC_SPAWN_TOOL,
  createSpawnAuthorizer,
  type SpawnAuthorization,
  type SpawnAuthorizerOptions,
  type SpawnAuthorizerPort,
  type SpawnLaunchFacts,
  type SpawnRoute,
} from "./spawnAuthorizer.ts";
export {
  createProductionProjectRootCache,
  createProjectRootCache,
  type ProjectRootCache,
} from "./projectRoot.ts";
/** A stored T3-form route (instance `pi`, slug) as Pi and M09 name it; the client usage read (M10 step 18) shows and asks about routes in this form. */
export { piRouteOfT3 } from "./routeVocabulary.ts";
export {
  PI_SELECTION_SEAM_SLOT,
  createPiSelectionSeam,
  installPiSelectionSeam,
  type PiSelectionOutcome,
  type PiSelectionRefusal,
  type PiSelectionRequest,
  type PiSelectionSeam,
} from "./routeSeam.ts";
export {
  GOALS_PINNED_ARTIFACT,
  INTERACTION_PINNED_ARTIFACT,
  PINNED_ARTIFACT,
  PROVIDERS_PINNED_ARTIFACT,
  WORKFLOWS_PINNED_ARTIFACT,
} from "./artifact.ts";
// M07 step 22: the workflows module — its row and the registration of the three run-record operations over the workflow ledger.
export {
  WORKFLOWS_BACKEND_ENTRY,
  WORKFLOWS_BACKEND_ID,
  workflowsBackendModuleRow,
} from "./workflows/row.ts";
export {
  createWorkflowsBackendRegistration,
  type WorkflowsBackendRegistration,
  type WorkflowsRegistrationOptions,
} from "./workflows/registration.ts";
// M07 step 14: the goals module — its row, registration, factory over the real ports, and the workflow authorization port (DV3) the workflow tool of a later step calls.
export {
  GOALS_MODULE_NAME,
  createGoalsRuntime,
  type GoalRoundState,
  type GoalsFactory,
  type GoalsFactoryDeps,
  type GoalsRuntime,
} from "./goals/factory.ts";
export { GOALS_BACKEND_ENTRY, GOALS_BACKEND_ID, goalsBackendModuleRow } from "./goals/goalsRow.ts";
// M07 step 19: the one implementation of a typed `/goal` (parse → operation → goal service) the app server binds to its command route; the archive stays imported at one site.
export { runGoalCommand, type GoalCommandPort, type TypedGoalOutcome } from "./goals/goalsEntry.ts";
export {
  createAdmissionPort,
  createGoalRootResolver,
  createInteractionPort,
  createNoticePort,
  createThreadReceiptPort,
} from "./goals/ports.ts";
export {
  createGoalsBackendRegistration,
  type GoalsBackendRegistration,
  type GoalsRegistrationOptions,
} from "./goals/registration.ts";
export {
  WORKFLOW_TOOL,
  createWorkflowAuthorizer,
  type WorkflowAuthorization,
  type WorkflowAuthorizerOptions,
  type WorkflowAuthorizerPort,
} from "./goals/workflowAuthorize.ts";
export {
  GROUPS_BACKEND_ENTRY,
  GROUPS_BACKEND_ID,
  createGroupsBackendRegistration,
  createGroupsStore,
  filterGroupsRecord,
  groupsBackendModuleRow,
  prepareGroupOperation,
  type GroupOperation,
  type GroupsBackendRegistration,
  type GroupsOutcome,
  type GroupsRecord,
  type GroupsService,
} from "./groups/groups.ts";
// M12 step 8: the diagnostics module's registration, for hosts and tests that assemble the Backend's registrations themselves.
export {
  createDiagnosticsBackendRegistration,
  type DiagnosticsAccess,
  type DiagnosticsBackendRegistration,
  type DiagnosticsHealth,
  type DiagnosticsRegistrationOptions,
} from "./diagnostics/registration.ts";
// M11 steps 8–10: the inspection module's registration, its caller check and the read-only metadata port the app server supplies.
export { createInspectAccess, type InspectAccessPort } from "./inspect/inspectAccess.ts";
// M11 step 11: the client-region query port (one request to the viewing page per query) the app server binds to the inspection module.
export {
  createClientQueries,
  type ClientLogEvent,
  type ClientPort,
  type ClientQueries,
  type ClientQueriesOptions,
  type ClientQueryAnswer,
  type ClientRegionInfo,
  type ClientRequest,
  type ClientView,
} from "./inspect/clients.ts";
export {
  createInspectBackendRegistration,
  type InspectBackendOptions,
  type InspectBackendRegistration,
} from "./inspect/inspectRegistration.ts";
export type {
  BackendServicesMetadataPort,
  DriverMetadata,
  MetadataFacet,
  RpcMetadata,
} from "./inspect/metadataProviders.ts";
export {
  DELIVERABLES_BACKEND_ENTRY,
  DELIVERABLES_BACKEND_ID,
  DELIVERABLES_FILE_RELATIVE,
  DELIVERABLES_MAX_RECORDS,
  createDeliverablesBackendRegistration,
  createDeliverablesStore,
  deliverableIdOf,
  deliverableKindOf,
  deliverablesBackendModuleRow,
  type DeliverableEntry,
  type DeliverableRecord,
  type DeliverablesBackendRegistration,
  type DeliverablesCaller,
  type DeliverablesOutcome,
  type DeliverablesRead,
  type DeliverablesService,
  type SnapshotOpener,
} from "./deliverables/deliverables.ts";
export type { EditsRead } from "./board/runtime.ts";
export { prepareAetheriaBackend, type AetheriaBackendOptions } from "./aetheriaBackend.ts";
export { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
export type { StoredEventLike } from "./identity/feed.ts";
export type { IdentityCaller, IdentityResolution } from "./identity/resolver.ts";
export {
  createAetheriaBackendService,
  type AetheriaBackendService,
  type AetheriaBackendServiceOptions,
  type CreateServiceResult,
} from "./service.ts";
