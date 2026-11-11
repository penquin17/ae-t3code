// AETHERIA M04 Plan step 12 — the package's public surface, as the server layer graph (step 16) will import it.
// Shows: the names step 16 joins at IP-1 exist on the package entry and are the ones the adapter modules define; nothing else is public.
import { describe, expect, it } from "vite-plus/test";

import * as entry from "./index.ts";

describe("the public entry", () => {
  it("exposes exactly the Backend assembly surface", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "AGENT_AWARENESS_BACKEND_ENTRY",
      "AGENT_AWARENESS_BACKEND_ID",
      "BACKEND_COMPOSITION_ID",
      "BACKEND_ENTRY_ALLOWLIST",
      "GENERIC_SPAWN_TOOL",
      "HUMAN_CONTROL_BACKEND_ENTRY",
      "HUMAN_CONTROL_BACKEND_ID",
      "INTERACTION_PINNED_ARTIFACT",
      "OPERATION_NOT_RUNNING",
      "ORCHESTRATION_BACKEND_ENTRY",
      "ORCHESTRATION_BACKEND_ID",
      "ORCHESTRATION_UNAVAILABLE_CODE",
      "PINNED_ARTIFACT",
      "PI_SELECTION_SEAM_SLOT",
      "PROVIDERS_BACKEND_ENTRY",
      "PROVIDERS_BACKEND_ID",
      "PROVIDERS_PINNED_ARTIFACT",
      "THREAD_PORT_CALLS",
      "agentAwarenessBackendModuleRow",
      "backendManifest",
      "createAetheriaBackendService",
      "createAgentAwarenessBackendRegistration",
      "createHumanControlBackendRegistration",
      "createOrchestrationBackendRegistration",
      "createOrchestrationFactory",
      "createPiSelectionSeam",
      "createProductionProjectRootCache",
      "createProjectRootCache",
      "createProvidersBackendRegistration",
      "createSpawnAuthorizer",
      "humanControlBackendModuleRow",
      "installPiSelectionSeam",
      "orchestrationBackendModuleRow",
      "prepareAetheriaBackend",
      "prepareBackend",
      "providersBackendModuleRow",
      "sessionTurnDispatch",
    ]);
  });

  it("names the unavailable code the Agent-side client must handle", () => {
    expect(entry.OPERATION_NOT_RUNNING).toBe("XC6_BACKEND_NOT_RUNNING");
  });

  it("keeps the pinned artifact immutable", () => {
    expect(Object.isFrozen(entry.PINNED_ARTIFACT)).toBe(true);
    expect(Object.isFrozen(entry.BACKEND_ENTRY_ALLOWLIST)).toBe(true);
    expect(entry.agentAwarenessBackendModuleRow().id).toBe(entry.AGENT_AWARENESS_BACKEND_ID);
    expect(entry.createAgentAwarenessBackendRegistration().entry).toBe(
      entry.AGENT_AWARENESS_BACKEND_ENTRY,
    );
    expect(typeof entry.prepareBackend).toBe("function");
  });
});
