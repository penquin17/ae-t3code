// AETHERIA — the one identity module that touches the pinned library artifact (`@aetheria/awareness/backend`, the Backend-only entry).
// It takes exactly two values from it: M03's read-only identity reader and M03's record validator. No stage, activate, retire, discard or sweep is reachable.
// Every other module here imports this file, never the archive, and a test checks that.
import {
  createIdentityReader,
  validateRecord,
  type IdentityReader,
  type IdentityRecord,
  type StoreRead,
} from "@aetheria/awareness/backend";

export { createIdentityReader, validateRecord };
export type { IdentityReader, IdentityRecord, StoreRead };

/** The runtime values taken from the archive; a test checks each exists on the installed Backend entry. */
export const BACKEND_ENTRY_NAMES = ["createIdentityReader", "validateRecord"] as const;
