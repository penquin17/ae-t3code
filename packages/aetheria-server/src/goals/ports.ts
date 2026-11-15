// AETHERIA M07 Plan step 14 — the real adapters from the Backend's own services to the goals service's ports (K6). Each takes a LOOKUP, not a service: M05's direct API and M06's interaction
// service exist only while their modules run, so every call asks again, and a service that is not there is `unavailable` — never absent, never "no decision", never admitted.
// Nothing here decides a goal rule: the goals archive owns them; these only translate shapes and carry the trusted authority the goals service presents.
import type { InteractionRecord, OriginVerifyResult } from "@t3tools/aetheria-contracts";

import type { HumanControlService } from "../humanControl.ts";
import type { IdentityResolution } from "../identity/resolver.ts";
import type { ThreadIndex } from "../identity/threadIndex.ts";
import type { OrchestrationDirectApi } from "../orchestration.ts";
import type { ChildThreadPort } from "../orchestrationPorts.ts";
import type {
  AdmissionPort,
  InteractionPort,
  InteractionView,
  NoticePort,
  RootResolver,
  ThreadReceiptPort,
} from "./goalsEntry.ts";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Root identity (M03 through M04's index).

/**
 * A session's root as M03 and M04 know it, from the same two reads M05 uses: the index's single live thread binding for the session, and the identity resolver's join of that binding with the
 * validated record. Only a validated main session is `main`; a child is `child` (so a goal is refused for it, never keyed by the parent's root); everything else — no single binding, a retired,
 * pending, corrupt or unreadable record — is `unavailable` with its reason.
 */
export function createGoalRootResolver(deps: {
  readonly index: Pick<ThreadIndex, "bindingOfSession">;
  readonly resolve: (
    caller: {
      readonly threadId: string;
      readonly providerSessionId: string;
      readonly providerInstanceId: string;
    },
    claimedSessionId: string,
  ) => IdentityResolution;
}): RootResolver {
  return {
    resolve(sessionId) {
      try {
        const binding = deps.index.bindingOfSession(sessionId);
        if (binding === undefined)
          return { kind: "unavailable", reason: "no-single-thread-binding" };
        const resolved = deps.resolve(
          {
            threadId: binding.threadId,
            providerSessionId: binding.providerSessionId,
            providerInstanceId: binding.providerInstanceId,
          },
          sessionId,
        );
        if (!resolved.ok) return { kind: "unavailable", reason: resolved.reason };
        return resolved.kind === "main"
          ? { kind: "main", rootSessionId: resolved.rootSessionId }
          : { kind: "child", rootSessionId: resolved.rootSessionId };
      } catch (error) {
        return { kind: "unavailable", reason: reasonOf(error) };
      }
    },
  };
}

// M06's interaction service.

type InteractionLookup = () =>
  | Pick<HumanControlService, "createAuthorization" | "awaitInteraction" | "verifyHumanOrigin">
  | undefined;

const UNAVAILABLE_INTERACTION = "INTERACTION_UNAVAILABLE";

/** The origin id a settled interaction carries: the resolution's, when it has one. A pending or continued interaction has none. */
function viewOf(record: InteractionRecord): InteractionView {
  const resolution = record.resolution;
  const originId =
    resolution !== undefined && "originId" in resolution ? resolution.originId : undefined;
  return {
    interactionId: record.interactionId,
    state: record.state,
    ...(originId === undefined ? {} : { originId }),
  };
}

/**
 * M06's direct calls narrowed to what goals use. `verifyHumanOrigin` is M06's read-only verdict (XC-17): a verdict that cannot be had (`{ok:false}`, a thrown error, no running service) is
 * `unavailable`, which the goals service treats as "not a human decision" and changes nothing on.
 */
export function createInteractionPort(lookup: InteractionLookup): InteractionPort {
  return {
    async createAuthorization(input) {
      const service = lookup();
      if (service === undefined) return { ok: false, code: UNAVAILABLE_INTERACTION };
      try {
        const made = await service.createAuthorization(input);
        return made.ok ? { ok: true, value: viewOf(made.value) } : { ok: false, code: made.code };
      } catch {
        return { ok: false, code: UNAVAILABLE_INTERACTION };
      }
    },
    async awaitInteraction(interactionId) {
      const service = lookup();
      if (service === undefined) return { ok: false, code: UNAVAILABLE_INTERACTION };
      try {
        const waited = await service.awaitInteraction(interactionId);
        return waited.ok
          ? { ok: true, value: viewOf(waited.value) }
          : { ok: false, code: waited.code };
      } catch {
        return { ok: false, code: UNAVAILABLE_INTERACTION };
      }
    },
    async verifyHumanOrigin(originId, expect) {
      const service = lookup();
      if (service === undefined)
        return { unavailable: true, reason: "the interaction service is not running" };
      try {
        const verdict = await service.verifyHumanOrigin(originId, expect);
        if ("ok" in verdict) return { unavailable: true, reason: verdict.code };
        const checked: OriginVerifyResult = verdict;
        if (checked.verified)
          return {
            verified: true,
            origin: {
              decision: checked.origin.decision,
              rootSessionId: checked.origin.rootSessionId,
              sessionId: checked.origin.sessionId,
            },
          };
        return checked.code === "ORIGIN_MISMATCH"
          ? { verified: false, code: checked.code, field: checked.field }
          : { verified: false, code: checked.code };
      } catch (error) {
        return { unavailable: true, reason: reasonOf(error) };
      }
    },
  };
}

// M05's admission, settles and notice outbox.

type DirectLookup = () => OrchestrationDirectApi | undefined;

const NO_DIRECT = "the orchestration service is not running";

/**
 * M05's direct turn calls, as the goals service uses them: one admission under its key, the read-only admission-state query, the pause interrupt and the settled subscription. A direct API that
 * is not running, and a call that throws, answer `unavailable`; the goals service keeps the reservation open and never resends.
 */
export function createAdmissionPort(lookup: DirectLookup): AdmissionPort {
  return {
    async admitTurn(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable", detail: NO_DIRECT };
      try {
        return await direct.admitTurn(request);
      } catch (error) {
        return { status: "unavailable", detail: reasonOf(error) };
      }
    },
    async admissionState(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable", detail: NO_DIRECT };
      try {
        return await direct.admissionState(request);
      } catch (error) {
        return { status: "unavailable", detail: reasonOf(error) };
      }
    },
    async interruptTurn(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable", detail: NO_DIRECT };
      try {
        return await direct.interruptTurn(request);
      } catch (error) {
        return { status: "unavailable", detail: reasonOf(error) };
      }
    },
    subscribeSettled(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable" };
      try {
        return direct.subscribeSettled(request);
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

/** M05's fenced goal-notice adapter (DV1) as the goals service's notice port: `goal-notice` only; refused after stop and counted by drain, so a stopped Backend writes no notice. */
export function createNoticePort(lookup: DirectLookup): NoticePort {
  return {
    async enqueue(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable", detail: NO_DIRECT };
      try {
        return await direct.goalNoticeEnqueue(request);
      } catch (error) {
        return { status: "unavailable", detail: reasonOf(error) };
      }
    },
    async deliver(request) {
      const direct = lookup();
      if (direct === undefined) return { status: "unavailable", detail: NO_DIRECT };
      try {
        return await direct.goalNoticeDeliver(request);
      } catch (error) {
        return { status: "unavailable", detail: reasonOf(error) };
      }
    },
    async state(request) {
      const direct = lookup();
      if (direct === undefined) return "unknown";
      try {
        return await direct.goalNoticeState(request);
      } catch {
        return "unknown";
      }
    },
  };
}

// T3's message receipt.

/**
 * T3's own receipt, read from the thread projection through the children service's thread port: does the session's thread hold a message under this id? A session with no known thread, a
 * projection that cannot be read and a port that throws are `unavailable`; none of them is read as absent.
 */
export function createThreadReceiptPort(deps: {
  readonly threads: Pick<ChildThreadPort, "readMessageReceipt">;
  readonly threadOf: (sessionId: string) => string | undefined;
}): ThreadReceiptPort {
  return {
    async hasMessage(sessionId, messageId) {
      const threadId = deps.threadOf(sessionId);
      if (threadId === undefined) return "unavailable";
      try {
        const read = await deps.threads.readMessageReceipt({ threadId, messageId });
        return read.ok ? (read.found ? "present" : "absent") : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}
