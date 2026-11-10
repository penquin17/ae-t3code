// AETHERIA M06 step 16 — session → root for the interaction service's grant and mode writes, read from M03's active identity records through the same
// reader and validator the resolver uses. The root is never a client's claim. Unknown stays unknown: an unreadable, corrupt, invalid or still-pending
// record is unavailable; only a record M03 reports absent or retired is absent.
import type { SessionDirectory } from "../humanControl.ts";
import { validateRecord, type IdentityReader } from "./backendEntry.ts";

export function createSessionDirectory(reader: IdentityReader): SessionDirectory {
  return {
    lookup: async (sessionId) => {
      let stored: ReturnType<IdentityReader["read"]>;
      try {
        stored = reader.read(sessionId);
      } catch {
        return { kind: "unavailable", reason: "record-unreadable" };
      }
      switch (stored?.status) {
        case "active": {
          const checked = validateRecord(stored.record);
          return checked.ok && checked.record.sessionId === sessionId
            ? { kind: "found", sessionId, rootSessionId: checked.record.rootSessionId }
            : { kind: "unavailable", reason: "record-invalid" };
        }
        case "absent":
        case "retired":
          return { kind: "absent" };
        case "pending":
          return { kind: "unavailable", reason: "record-awaited" };
        default:
          return { kind: "unavailable", reason: "record-corrupt" };
      }
    },
  };
}
