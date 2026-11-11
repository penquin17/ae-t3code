// AETHERIA M05 step 6 (D13, XC-10): production `childStatus` for the board's `assign`, asked as `children.status` for the root session (session ids, not thread ids).
// It never guesses: an unbound root, no service, a failure, a lost or malformed reply, or an unknown ownership THROWS, which the board reports as unavailable.
import type { ChildStatus } from "./library.ts";
import type { OrchestrationService } from "./orchestration.ts";

const STATES: ReadonlySet<string> = new Set(["running", "idle", "closed", "unknown"]);

export function createChildStatus(options: {
  /** M04's thread index, for the one question "is the root session bound": a root that is not bound is not asked about. */
  readonly index: { bindingOfSession(sessionId: string): unknown };
  /** The running children service, or undefined before start and after drain. */
  readonly service: () => OrchestrationService | undefined;
}): (rootSessionId: string, childSessionId: string) => Promise<ChildStatus> {
  return async (rootSessionId, childSessionId) => {
    const service = options.service();
    if (service === undefined) throw new Error("the orchestration service is not running");
    if (options.index.bindingOfSession(rootSessionId) === undefined)
      throw new Error("the root session is not bound to a thread");
    const reply = (await service.handle(
      "children.status",
      { sessionId: rootSessionId, rootSessionId, kind: "main" },
      { childSessionId },
    )) as { ok?: unknown; value?: { owned?: unknown; state?: unknown }; code?: unknown } | null;
    if (reply === null || typeof reply !== "object" || reply.ok !== true)
      throw new Error(`the child status is unavailable (${String(reply?.code ?? "no reply")})`);
    const { owned, state } = reply.value ?? {};
    if (typeof owned !== "boolean" || typeof state !== "string" || !STATES.has(state))
      throw new Error("the child status could not be read");
    return { owned, state: state as ChildStatus["state"] };
  };
}
