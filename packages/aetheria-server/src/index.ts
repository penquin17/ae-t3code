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
  BACKEND_ENTRY_ALLOWLIST,
  agentAwarenessBackendModuleRow,
  createAgentAwarenessBackendRegistration,
} from "./agentAwareness.ts";
export { PINNED_ARTIFACT } from "./artifact.ts";
export { prepareAetheriaBackend, type AetheriaBackendOptions } from "./aetheriaBackend.ts";
export { BACKEND_COMPOSITION_ID, backendManifest } from "./composition.ts";
export type { StoredEventLike } from "./identity/feed.ts";
export type { IdentityCaller, IdentityResolution } from "./identity/resolver.ts";
export {
  createAetheriaBackendService,
  type AetheriaBackendService,
  type AetheriaBackendServiceOptions,
  type CreateServiceResult,
} from "./service.ts";
