// AETHERIA M05/M10 — what M03's identity record says of a Pi session, through the same reader and validator the resolver uses. The thread index cannot tell a child (its `subagent` flag is never
// set for an M05 child), so a handler that must refuse a child as a root asks here. Read-only; it never throws; unknown stays unknown: only an active, valid record of that session proves a child
// or a main, a record M03 reports absent or retired proves nothing (`not-child`), and everything unreadable, pending, corrupt, invalid or filed under another id is `unavailable`.
import { validateRecord, type IdentityReader } from "./backendEntry.ts";

export type SessionKind = "child" | "not-child" | "unavailable";

export function createSessionKind(reader: IdentityReader): (sessionId: string) => SessionKind {
  return (sessionId) => {
    let stored: ReturnType<IdentityReader["read"]>;
    try {
      stored = reader.read(sessionId);
    } catch {
      return "unavailable";
    }
    switch (stored?.status) {
      case "active": {
        const checked = validateRecord(stored.record);
        if (!checked.ok || checked.record.sessionId !== sessionId) return "unavailable";
        return checked.record.kind === "child" ? "child" : "not-child";
      }
      case "absent":
      case "retired":
        return "not-child";
      default:
        return "unavailable";
    }
  };
}
