// AETHERIA M11 Plan step 7 — the Backend `inspect-backend` module's registration, PLACEHOLDER. The Backend refuses to prepare while a module its composition selects has no
// registration, so this one exists to seat the row. It registers NO operation: inspect.list and inspect.query reach nothing, and the carrier answers an unknown operation.
// Sub-phase 3 replaces this body with the real module (the operations, the providers and the projector). Nothing here reads, holds or serves any data.
import type { BackendRegistration } from "../adapter.ts";
import { INSPECT_BACKEND_ENTRY } from "./inspectRow.ts";

export function createInspectBackendRegistration(): BackendRegistration {
  return {
    entry: INSPECT_BACKEND_ENTRY,
    activation: {
      start: () => undefined,
      drain: async () => ({ released: [], stopped: [], transferred: [], stillLive: [] }),
    },
  };
}
