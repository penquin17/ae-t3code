// The seven human-control actions as honest outcomes (D4, D14, C7, A2). Each one is sent once through the transport, ends as exactly one of the five outcomes (`core/outcome.ts`), and is
// confirmed only by the Backend's own projection: a snapshot re-read for a record action, a mode re-read for plan mode. A lost or unavailable reply is `unknown` and is NEVER resent. A second action
// on a target still in flight sends nothing. Nothing is edited optimistically: the view changes only when a re-read shows the change. Plain TypeScript; the effect is the supplied transport.
import {
  createActionRunner,
  type ActionOutcome,
  type ConfirmResult,
  type OutcomeStep,
} from "../core/outcome";
import { classifyTransport, sendResultOf, type ClassifiedReply } from "./reply";
import type { SnapshotRead } from "./resync";
import type {
  AnswerPayload,
  CancelPayload,
  ControlTransport,
  GrantPayload,
  InteractionRecord,
  PlanDecidePayload,
  PlanMode,
  PlanModeSetPayload,
  RevisionPayload,
  TransportResult,
} from "./types";

export type { SnapshotRead } from "./resync";

export interface ControlActionsDeps {
  readonly transport: ControlTransport;
  readonly environmentId: string;
  readonly rootSessionId: string;
  /** A fresh request id per action, supplied by the host. */
  readonly newRequestId: () => string;
  /** One sequenced re-read of the root's snapshot, owned by the view: it updates the view and reports what it found. */
  readonly readSnapshot: () => Promise<SnapshotRead>;
}

export type ActionReport<V> =
  /** An action on this target was already in flight: nothing was sent. */
  | { readonly sent: false }
  | {
      readonly sent: true;
      readonly requestId: string;
      readonly outcome: ActionOutcome<V>;
      /** What the Backend said, with the record it supplied (already-settled, delivery-failed) and its own words. */
      readonly reply: ClassifiedReply<V>;
      /** False when a newer action on the same target started before this one settled. */
      readonly current: boolean;
    };

export interface ControlActions {
  answer(payload: AnswerPayload): Promise<ActionReport<InteractionRecord>>;
  cancel(payload: CancelPayload): Promise<ActionReport<InteractionRecord>>;
  hold(payload: RevisionPayload): Promise<ActionReport<InteractionRecord>>;
  close(payload: RevisionPayload): Promise<ActionReport<InteractionRecord>>;
  planDecide(payload: PlanDecidePayload): Promise<ActionReport<InteractionRecord>>;
  planModeSet(payload: PlanModeSetPayload): Promise<ActionReport<PlanMode>>;
  grant(payload: GrantPayload): Promise<ActionReport<{ readonly originId: string }>>;
}

export function createControlActions(deps: ControlActionsDeps): ControlActions {
  const { transport, environmentId } = deps;
  const runner = createActionRunner({ newRequestId: deps.newRequestId });
  const inFlight = new Set<string>();

  async function perform<V>(
    key: string,
    label: string,
    send: () => Promise<TransportResult>,
    confirm?: (accepted: V) => Promise<ConfirmResult>,
  ): Promise<ActionReport<V>> {
    if (inFlight.has(key)) return { sent: false };
    inFlight.add(key);
    try {
      let reply: ClassifiedReply<V> = { class: "unknown", reread: true };
      let confirmRead = false;
      const step: OutcomeStep<V> = {
        label,
        send: async () => {
          reply = classifyTransport<V>(await send());
          return sendResultOf(reply);
        },
        ...(confirm === undefined
          ? {}
          : {
              confirm: (accepted: V) => {
                confirmRead = true;
                return confirm(accepted);
              },
            }),
      };
      const run = await runner.run(key, step);
      // Whatever the reply, the view re-reads unless a confirming read already did: it never trusts the reply to change it.
      if (reply.reread && !confirmRead) await deps.readSnapshot();
      return {
        sent: true,
        requestId: run.requestId,
        outcome: run.outcome,
        reply,
        current: run.current,
      };
    } finally {
      inFlight.delete(key);
    }
  }

  /** A record action is confirmed when the snapshot's record, found by its exact id, matches what the Backend said it became. */
  const confirmRecord =
    (
      interactionId: string,
      shown: (record: InteractionRecord, accepted: InteractionRecord) => boolean,
    ) =>
    async (accepted: InteractionRecord): Promise<ConfirmResult> => {
      const read = await deps.readSnapshot();
      if (read.tag === "failed") return { tag: "failed", reason: read.reason };
      const found = read.snapshot.interactions.find(
        (record) => record.interactionId === interactionId,
      );
      return found !== undefined && shown(found, accepted) ? { tag: "shows" } : { tag: "absent" };
    };

  const settled = (record: InteractionRecord, accepted: InteractionRecord) =>
    record.state === accepted.state;
  const held = (record: InteractionRecord) => record.held;

  return {
    answer: (p) =>
      perform(
        `record:${p.interactionId}`,
        "Answer",
        () => transport.answer(environmentId, p),
        confirmRecord(p.interactionId, settled),
      ),
    cancel: (p) =>
      perform(
        `record:${p.interactionId}`,
        "Cancel",
        () => transport.cancel(environmentId, p),
        confirmRecord(p.interactionId, settled),
      ),
    hold: (p) =>
      perform(
        `record:${p.interactionId}`,
        "Hold",
        () => transport.hold(environmentId, p),
        confirmRecord(p.interactionId, held),
      ),
    // `closed` changes no record state, so a snapshot cannot show it: there is no confirming read, and the outcome says so.
    close: (p) =>
      perform(`record:${p.interactionId}`, "Close", () => transport.close(environmentId, p)),
    planDecide: (p) =>
      perform(
        `record:${p.interactionId}`,
        "Plan decision",
        () => transport.planDecide(environmentId, p),
        confirmRecord(p.interactionId, settled),
      ),
    planModeSet: (p) =>
      perform<PlanMode>(
        `mode:${p.sessionId}`,
        "Plan mode",
        () => transport.planModeSet(environmentId, p),
        async (accepted) => {
          const read = classifyTransport<PlanMode>(
            await transport.planModeGet(environmentId, p.sessionId),
          );
          if (read.class !== "accepted") {
            return { tag: "failed", reason: read.detail ?? "the mode could not be read back" };
          }
          const mode = read.value as PlanMode;
          return mode.active === accepted.active && mode.modeRevision === accepted.modeRevision
            ? { tag: "shows" }
            : { tag: "absent" };
        },
      ),
    // A grant answers with an origin id only; no projection shows it, so it is never "refreshed".
    grant: (p) =>
      perform<{ readonly originId: string }>(`grant:${p.subject.id}`, "Grant", () =>
        transport.authorizationGrant(environmentId, p),
      ),
  };
}
