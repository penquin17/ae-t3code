// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 18 (D14, D20, R3, XC-11; IP-54 to IP-56) — the handler behind `aetheria.usage.read`: the providers' usage readings, and the route availability of the named root's children,
// read from M09 through the Backend's running service (`routeAvailability`, in process; never an XC-6 bridge) and M05's direct API.
//
// Authority: the shared root gate (`rootGate.ts`), in its order: T3's `orchestration:read` before the handler, the actor only from the connection, the device session re-read on EVERY call, the
// scope again, a main root the host's access rule lets the connection reach (a child is never a root). Only then is anything read.
//
// What a reply says. Each section stands alone and says what it could not read. `usage` is M09's readings as supplied (a failed reading is its own `unavailable` reading with no window; an empty
// list is a known empty); if the providers service is not running, throws or answers something outside the contract, it is `unavailable` with a reason, never an empty or zero reading.
// `children` lists M05's user list of the root, each child with the route M05's `currentRoute` names, shown in Pi's vocabulary (`piRouteOfT3`): a known route is asked about once with
// purpose `display` and carries M09's state, or `unavailable` when that could not be had; a child with no recorded route, or one M05 says it cannot read, has no availability. The main thread's
// own route is `not-supplied`: the Backend supplies a route for a role child only, so none is guessed and none is asked about.
import {
  ClientUsageReadResult,
  RouteState,
  UsageReading,
  type ClientUsageReadPayload,
  type UsageCode,
} from "@t3tools/aetheria-contracts";
import {
  piRouteOfT3,
  type AetheriaBackendService,
  type ClientActor,
} from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { READ_SCOPE, guardedRoot, type GateCodes, type GateFailure } from "./rootGate.ts";

type Service = Pick<
  AetheriaBackendService,
  "interactions" | "orchestration" | "index" | "identityKind" | "routeAvailability"
>;
export type Backend = Option.Option<Service>;

const CODES: GateCodes<UsageCode> = {
  notAuthorized: "USAGE_NOT_AUTHORIZED",
  deviceRevoked: "USAGE_DEVICE_REVOKED",
  notFound: "USAGE_NOT_FOUND",
  unavailable: "USAGE_UNAVAILABLE",
  nothing: "read",
};

type Section<A extends object> = A | { readonly status: "unavailable"; readonly detail: string };
const unavailable = (detail: string) => ({ status: "unavailable" as const, detail });

const decodeReadings = Schema.decodeUnknownSync(Schema.Array(UsageReading) as never) as (
  input: unknown,
) => ReadonlyArray<unknown>;
const decodeState = Schema.decodeUnknownSync(RouteState as never) as (input: unknown) => unknown;
const decodeReply = Schema.decodeUnknownSync(ClientUsageReadResult as never) as (
  input: unknown,
) => ClientUsageReadResult;

/** M09's readings as supplied, or why none could be read. */
const readUsage = async (
  service: Service,
): Promise<Section<{ status: "read"; readings: unknown }>> => {
  try {
    return { status: "read", readings: decodeReadings(await service.routeAvailability.usage()) };
  } catch {
    return unavailable("the providers' usage could not be read");
  }
};

type Direct = NonNullable<ReturnType<NonNullable<ReturnType<Service["orchestration"]>>["direct"]>>;
type Known = {
  readonly status: "known";
  readonly index: number;
  readonly provider: string;
  readonly model: string;
  readonly effort?: string;
};
type ChildRoute =
  | Known
  | { readonly status: "none" }
  | { readonly status: "unknown"; readonly detail: string };

const UNREADABLE_ROUTE = "the child's route state cannot be read";
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** What M05's `currentRoute` says of one child: a known route (in Pi's vocabulary), none recorded, or unknown. Never guessed: an answer that does not read is unknown. */
const routeOf = (direct: Direct, childId: string): ChildRoute => {
  let answer: unknown;
  try {
    answer = direct.currentRoute(childId);
  } catch {
    return { status: "unknown", detail: UNREADABLE_ROUTE };
  }
  const said = (typeof answer === "object" && answer !== null ? answer : {}) as {
    readonly kind?: unknown;
    readonly index?: unknown;
    readonly detail?: unknown;
    readonly route?: {
      readonly provider?: unknown;
      readonly model?: unknown;
      readonly effort?: unknown;
    };
  };
  if (said.kind === "none") return { status: "none" };
  if (said.kind === "route") {
    const route = said.route;
    if (
      Number.isInteger(said.index) &&
      (said.index as number) >= 1 &&
      nonEmpty(route?.provider) &&
      nonEmpty(route?.model)
    ) {
      const shown = piRouteOfT3({
        provider: route.provider,
        model: route.model,
        ...(nonEmpty(route.effort) ? { effort: route.effort } : {}),
      });
      return {
        status: "known",
        index: said.index as number,
        provider: shown.provider,
        model: shown.model,
        ...(shown.effort === undefined ? {} : { effort: shown.effort }),
      };
    }
    return { status: "unknown", detail: UNREADABLE_ROUTE };
  }
  return {
    status: "unknown",
    detail: said.kind === "unknown" && nonEmpty(said.detail) ? said.detail : UNREADABLE_ROUTE,
  };
};

const routeKey = (route: { readonly provider: string; readonly model: string }) =>
  `${route.provider}\u0000${route.model}`;

/** M09's display state of each distinct known route, asked once; a route whose answer is missing or outside the contract is `unavailable`. */
const availabilityOf = async (
  service: Service,
  routes: ReadonlyArray<Known>,
): Promise<
  ReadonlyMap<string, { status: "read"; state: unknown } | ReturnType<typeof unavailable>>
> => {
  const distinct = [...new Map(routes.map((route) => [routeKey(route), route])).values()].map(
    (route) => ({ provider: route.provider, model: route.model }),
  );
  const answers = new Map<
    string,
    { status: "read"; state: unknown } | ReturnType<typeof unavailable>
  >();
  if (distinct.length === 0) return answers;
  let states: unknown;
  try {
    states = await service.routeAvailability.routeStates(distinct, "display");
  } catch {
    states = undefined;
  }
  distinct.forEach((route, at) => {
    const raw = Array.isArray(states) && states.length === distinct.length ? states[at] : undefined;
    try {
      if (raw === undefined) throw new Error("no answer");
      answers.set(routeKey(route), { status: "read", state: decodeState(raw) });
    } catch {
      answers.set(routeKey(route), unavailable("the route's availability could not be read"));
    }
  });
  return answers;
};

/** M05's user list of the root's children, each with its route and availability, or why the children could not be listed. */
const readChildren = async (service: Service, rootThreadId: string): Promise<unknown> => {
  const direct = service.orchestration()?.direct();
  if (direct === undefined) return unavailable("the children service is not running");
  let outcome: unknown;
  try {
    outcome = await direct.listChildren({
      caller: { user: true },
      args: { scope: "descendants", rootThreadId },
    });
  } catch {
    return unavailable("the root's children could not be listed");
  }
  const listed = (typeof outcome === "object" && outcome !== null ? outcome : {}) as {
    readonly ok?: unknown;
    readonly value?: { readonly rows?: unknown };
  };
  const rows = listed.ok === true ? listed.value?.rows : undefined;
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (row) =>
        nonEmpty((row as { childId?: unknown })?.childId) &&
        (row as { childId: string }).childId.length <= 200,
    )
  )
    return unavailable("the root's children could not be listed");
  const children = (rows as ReadonlyArray<{ childId: string }>).map((row) => ({
    childThreadId: row.childId,
    route: routeOf(direct, row.childId),
  }));
  const known = children.flatMap((child) => (child.route.status === "known" ? [child.route] : []));
  const availability = await availabilityOf(service, known);
  return {
    status: "listed" as const,
    rows: children.map((child) =>
      child.route.status === "known"
        ? { ...child, availability: availability.get(routeKey(child.route)) }
        : child,
    ),
  };
};

/** A root's usage: the providers' readings and its children's routes and availability, each section stating what it could not read. */
export const usageRead = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientUsageReadPayload,
): Effect.Effect<ClientUsageReadResult> =>
  guardedRoot<Service, UsageCode, ClientUsageReadResult>(
    backend,
    actor,
    READ_SCOPE,
    payload.rootThreadId,
    CODES,
    async (gate): Promise<ClientUsageReadResult | GateFailure<UsageCode>> => {
      const usage = await readUsage(gate.service);
      const children = await readChildren(gate.service, payload.rootThreadId);
      try {
        return decodeReply({
          ok: true,
          value: {
            rootThreadId: payload.rootThreadId,
            usage,
            // The Backend supplies a route for a role child only: the main thread's is never guessed.
            main: { threadId: payload.rootThreadId, route: { status: "not-supplied" } },
            children,
          },
        });
      } catch {
        return {
          ok: false,
          code: "USAGE_UNAVAILABLE",
          detail: "the usage did not fit its contract; nothing was read",
        };
      }
    },
    () => ({
      ok: false,
      code: "USAGE_UNAVAILABLE",
      detail: "the usage call failed; nothing was read",
    }),
  ) as Effect.Effect<ClientUsageReadResult>;
