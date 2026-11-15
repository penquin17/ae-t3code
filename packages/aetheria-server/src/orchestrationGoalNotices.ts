// AETHERIA M07 (DV1, D12): the fenced goal-notice adapter of M05's outbox — enqueue, deliver and state for `goal-notice` only, under a trusted Backend authority.
// Merged into the direct API, so the factory's fence refuses it after stop and drain counts it; no raw outbox and no second notice store.
// Not shown here: T3's real inbox delivering the notice.

export interface GoalNoticeAuthority {
  readonly kind: "backend-module";
  readonly module: string;
}

export type GoalNoticeEnqueueAnswer =
  | { readonly status: "queued"; readonly created: boolean }
  | { readonly status: "unavailable"; readonly detail: string };
export type GoalNoticeDeliverAnswer =
  | { readonly status: "delivered" | "held" | "uncertain" | "nothing" }
  | { readonly status: "unavailable"; readonly detail: string };
export type GoalNoticeState =
  | "pending"
  | "attempting"
  | "inserted"
  | "recorded"
  | "abandoned"
  | "unknown";

/** The three members the direct API gains. All are asynchronous so the fence treats them as work. */
export interface GoalNoticeDirect {
  goalNoticeEnqueue(request: {
    readonly authority: unknown;
    readonly sessionId: string;
    readonly key: string;
    readonly text: string;
  }): Promise<GoalNoticeEnqueueAnswer>;
  goalNoticeDeliver(request: {
    readonly authority: unknown;
    readonly sessionId: string;
    readonly key: string;
  }): Promise<GoalNoticeDeliverAnswer>;
  goalNoticeState(request: {
    readonly authority: unknown;
    readonly key: string;
  }): Promise<GoalNoticeState>;
}

/** The part of M05's outbox the adapter touches, as the archive declares it. */
export interface GoalNoticeOutbox {
  enqueue(
    owner: { readonly kind: "main"; readonly sessionId: string },
    spec: {
      readonly key: string;
      readonly targetSessionId: string;
      readonly kind: "goal-notice";
      readonly volatile: boolean;
      readonly text: string;
    },
  ):
    | { readonly ok: true; readonly created: boolean }
    | { readonly ok: false; readonly code: string; readonly detail: string };
  deliver(
    owner: { readonly kind: "main"; readonly sessionId: string },
    keys: readonly string[],
  ): Promise<{ readonly status: string }>;
  state(key: string): string;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const trusted = (authority: unknown): boolean =>
  typeof authority === "object" &&
  authority !== null &&
  (authority as { kind?: unknown }).kind === "backend-module" &&
  isText((authority as { module?: unknown }).module);
const refusedDetail = "the goal notice outbox is not available to this caller";

const NOTICE_STATES: ReadonlySet<string> = new Set([
  "pending",
  "attempting",
  "inserted",
  "recorded",
  "abandoned",
]);

export function createGoalNoticeDirect(outbox: GoalNoticeOutbox): GoalNoticeDirect {
  return {
    goalNoticeEnqueue: async ({ authority, sessionId, key, text }) => {
      if (!trusted(authority) || !isText(sessionId) || !isText(key) || !isText(text))
        return { status: "unavailable", detail: refusedDetail };
      const made = outbox.enqueue(
        { kind: "main", sessionId },
        { key, targetSessionId: sessionId, kind: "goal-notice", volatile: false, text },
      );
      return made.ok
        ? { status: "queued", created: made.created }
        : { status: "unavailable", detail: `${made.code}: ${made.detail}` };
    },
    goalNoticeDeliver: async ({ authority, sessionId, key }) => {
      if (!trusted(authority) || !isText(sessionId) || !isText(key))
        return { status: "unavailable", detail: refusedDetail };
      const result = await outbox.deliver({ kind: "main", sessionId }, [key]);
      switch (result.status) {
        case "inserted":
          return { status: "delivered" };
        case "unrecorded":
        case "uncertain":
          return { status: "uncertain" };
        case "held":
          return { status: "held" };
        case "nothing":
          return { status: "nothing" };
        default:
          return { status: "unavailable", detail: `delivery was ${result.status}` };
      }
    },
    goalNoticeState: async ({ authority, key }) => {
      if (!trusted(authority) || !isText(key)) return "unknown";
      const state = outbox.state(key);
      return NOTICE_STATES.has(state) ? (state as GoalNoticeState) : "unknown";
    },
  };
}
