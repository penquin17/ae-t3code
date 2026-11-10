// AETHERIA — the one identity module that touches the pinned artifact (`@aetheria/awareness/backend`); every other module here imports this file, and a test checks that.
// It takes M03's read-only reader and validator, and (step 23) `identityOf`, `authorize`, `deriveProject`, `nodeFs`, `currentRoles` for the audit check.
// No stage, activate, retire, discard or sweep is reachable.
import {
  authorize,
  createIdentityReader,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  validateRecord,
  type IdentityPorts,
  type IdentityReader,
  type IdentityRecord,
  type ProjectFacts,
  type RolePort,
  type StoreRead,
} from "@aetheria/awareness/backend";

export {
  authorize,
  createIdentityReader,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  validateRecord,
};
export type { IdentityPorts, IdentityReader, IdentityRecord, ProjectFacts, RolePort, StoreRead };

/** The runtime functions taken from the archive; a test checks each exists on the installed Backend entry. */
export const BACKEND_ENTRY_NAMES = [
  "createIdentityReader",
  "validateRecord",
  "authorize",
  "currentRoles",
  "deriveProject",
  "identityOf",
] as const;
