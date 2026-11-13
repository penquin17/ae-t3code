// AETHERIA M05 step 24 — the one vocabulary of a child's routes: stored in T3's form (instance `pi`, slug `provider/model`; `t3RouteOfPi`),
// read back in Pi's form (provider, bare model id; `piRouteOfT3`) by the selection seam and the availability adapter before M09.
// A route not in T3's Pi form (another instance, a model with no provider part) passes through unchanged.
// Pure, with no provider knowledge beyond the one instance name.

/** T3's instance id for a Pi session. Not a Pi provider name: a route whose provider is this is in T3's form. */
const PI_INSTANCE = "pi";

export interface VocabRoute {
  readonly provider: string;
  readonly model: string;
  readonly effort?: string | undefined;
}

const withEffort = <R extends VocabRoute>(
  route: VocabRoute,
  base: { provider: string; model: string },
): R => (route.effort === undefined ? base : { ...base, effort: route.effort }) as R;

/** A Pi-vocabulary route (a provider and a bare model) as T3 names it: the instance `pi` and the slug. */
export function t3RouteOfPi(route: VocabRoute): VocabRoute {
  return withEffort(route, { provider: PI_INSTANCE, model: `${route.provider}/${route.model}` });
}

/** A stored route in T3's Pi form as Pi and M09 name it. A route that is not in that form is returned unchanged. */
export function piRouteOfT3<R extends VocabRoute>(route: R): R | VocabRoute {
  if (route.provider !== PI_INSTANCE) return route;
  const slash = route.model.indexOf("/");
  if (slash <= 0 || slash === route.model.length - 1) return route;
  return withEffort(route, {
    provider: route.model.slice(0, slash),
    model: route.model.slice(slash + 1),
  });
}

interface MinimalAvailability {
  routeStates(
    routes: readonly { readonly provider: string; readonly model: string }[],
    purpose: "launch" | "switch" | "display",
  ): Promise<unknown>;
  reportFailure(
    route: { readonly provider: string; readonly model: string },
    failure: { readonly message: string },
  ): Promise<unknown>;
}

/** M09's availability as the children service calls it: routes in T3's form are asked about as the Pi provider they name. Answers and failures pass through untouched. */
export function adaptAvailability<A extends MinimalAvailability>(
  availability: A,
): MinimalAvailability {
  const asPi = (route: { readonly provider: string; readonly model: string }) => {
    const converted = piRouteOfT3(route);
    return { provider: converted.provider, model: converted.model };
  };
  return {
    routeStates: (routes, purpose) => availability.routeStates(routes.map(asPi), purpose),
    reportFailure: (route, failure) => availability.reportFailure(asPi(route), failure),
  };
}
