// AETHERIA M05 review 8, F1: the admission fence of the direct Backend API.
// Every asynchronous member runs under the factory's own admission and in-flight accounting, as a `handle()` operation does:
// refused once the service no longer runs, tracked while it runs, so a drain never reports clean over a direct call still in flight.
import type { OrchestrationDirectApi } from "./orchestration.ts";

/**
 * What the factory lends the fence: whether new work is still admitted, and a way to put an admitted call among the work a drain waits for.
 * `admit` returns `undefined` when the service no longer admits work; otherwise it runs `call` as tracked work under `name` and returns its promise, which is the caller's answer.
 */
export interface DirectAdmission {
  readonly admit: <T>(name: string, call: () => Promise<T>) => Promise<T> | undefined;
  /** The detail of the refusal: the one a channel operation gets once the service no longer runs. */
  readonly refusalDetail: string;
}

/** The two members whose answer is a status, not an `ok` result; a refusal keeps the member's own answer shape. */
const TURN_MEMBERS: ReadonlySet<string> = new Set([
  "admitTurn",
  "admissionState",
  "interruptTurn",
  // M07 DV1: the goal-notice adapter's answers are status unions too, never `ok` results
  "goalNoticeEnqueue",
  "goalNoticeDeliver",
]);

/**
 * The members that answer at once and own no store or T3 call: a subscription (the archive's own stop drops it at drain) and the synchronous, never-throwing route read. They stay as they
 * are. Every other member is treated as asynchronous work and fenced, so a member the archive adds later is fenced by default.
 */
const SYNCHRONOUS_MEMBERS: ReadonlySet<string> = new Set(["subscribeSettled", "currentRoute"]);

const unavailable = (member: string, detail: string): unknown =>
  TURN_MEMBERS.has(member)
    ? { status: "unavailable", detail }
    : { ok: false, code: "ORCHESTRATION_UNAVAILABLE", detail };

/** The direct API with every asynchronous member behind `admission`; the type is the one callers already hold. */
export function fenceDirectApi(
  api: OrchestrationDirectApi,
  admission: DirectAdmission,
): OrchestrationDirectApi {
  const fenced: Record<string, unknown> = {};
  for (const [member, value] of Object.entries(api)) {
    if (typeof value !== "function" || SYNCHRONOUS_MEMBERS.has(member)) {
      fenced[member] = value;
      continue;
    }
    const call = value as (...args: unknown[]) => Promise<unknown>;
    fenced[member] = (...args: unknown[]): Promise<unknown> =>
      admission.admit(`direct-${member}`, async () => await call(...args)) ??
      Promise.resolve(unavailable(member, admission.refusalDetail));
  }
  return Object.freeze(fenced) as unknown as OrchestrationDirectApi;
}
