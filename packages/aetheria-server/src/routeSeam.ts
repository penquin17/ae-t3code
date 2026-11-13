// AETHERIA M09 step 11 (C3, D6): the policy half of T3's Pi selection seam. `effectiveRoute` (via library.ts) owns precedence
// and the capability check; this adds the unverifiable-default refusal and the process slot the adapter reads, because the
// adapter cannot import the Backend, which sits above the provider layers. Filled after start, emptied before drain.
import {
  effectiveRoute,
  RoutePolicyError,
  type EffectiveRouteSource,
  type EffortValidation,
  type Route,
  type RouteCapabilities,
  type RoutePolicyErrorCode,
} from "./library.ts";
import { piRouteOfT3 } from "./routeVocabulary.ts";

/** The key the Pi adapter reads (`Symbol.for`, so both sides share it without importing each other). */
export const PI_SELECTION_SEAM_SLOT: unique symbol = Symbol.for("aetheria.pi.selection-seam");

export interface PiSelectionRequest {
  readonly provider: string;
  readonly model: string;
  /** The effort the selection carries. Absent means the policy's default for the model applies. */
  readonly effort?: string;
  /** A spawned (subagent) thread takes the child column of the default table. */
  readonly child: boolean;
  /**
   * AETHERIA M05 step 23: the T3 thread the turn runs on, from T3's own turn input (never model input), sent for a child only. The Backend answers with the route a role child's persisted state names
   * (`childRoute`), which then replaces the requested provider, model and effort for this turn.
   */
  readonly threadId?: string;
}

export type PiSelectionRefusal =
  | RoutePolicyErrorCode
  | "default-effort-unverifiable"
  | "route-state-unknown"
  | "policy-failed";

/** What the Backend says a child's next turn runs on (M05's `currentRoute`). */
export type PiChildRoute =
  | { readonly kind: "none" }
  | {
      readonly kind: "route";
      readonly index: number;
      readonly route: {
        readonly provider: string;
        readonly model: string;
        readonly effort?: string;
      };
    }
  | { readonly kind: "unknown"; readonly detail: string };

/** A refusal of a route the persisted state chose carries this marker, so the failed run's text lets M05 count THAT route as failing (children/route.ts). */
const routeRefusedMarker = (code: string): string => `[aetheria-route-refused:${code}]`;

export type PiSelectionOutcome =
  | {
      readonly outcome: "resolved";
      readonly provider: string;
      readonly model: string;
      /** The effort to send, or null when none applies (Pi then keeps its own). */
      readonly effort: string | null;
      readonly source: EffectiveRouteSource;
      readonly effortSource: EffectiveRouteSource;
      readonly validation: EffortValidation;
    }
  | { readonly outcome: "refused"; readonly code: PiSelectionRefusal; readonly message: string };

export interface PiSelectionSeam {
  /** Never throws; a refusal is a value, decided before any Pi command exists. */
  resolve(request: PiSelectionRequest): PiSelectionOutcome;
}

export interface PiSelectionSeamOptions {
  /** The Backend's capability answer for a route; a throw (service not running) counts as unknown. */
  readonly capabilities: (route: Route) => RouteCapabilities | undefined;
  /** Step 23: the route a child thread's next turn runs on, by thread id. Absent (bare T3, no orchestration): nothing is overridden. A throw counts as unknown. */
  readonly childRoute?: ((threadId: string) => PiChildRoute) | undefined;
}

export function createPiSelectionSeam(options: PiSelectionSeamOptions): PiSelectionSeam {
  const capabilities = (route: Route): RouteCapabilities | undefined => {
    try {
      return options.capabilities(route);
    } catch {
      return undefined;
    }
  };
  return Object.freeze({
    resolve(request: PiSelectionRequest): PiSelectionOutcome {
      // Step 23: a role child's persisted route decides this turn. The policy below stays the only owner of precedence and effort: the route is passed to it as the explicit selection.
      let explicit: { provider: string; model: string; effort?: string } = {
        provider: request.provider,
        model: request.model,
        ...(request.effort === undefined ? {} : { effort: request.effort }),
      };
      let fromRoute = false;
      if (request.child && request.threadId !== undefined && options.childRoute !== undefined) {
        let answer: PiChildRoute | undefined;
        try {
          answer = options.childRoute(request.threadId);
        } catch {
          answer = {
            kind: "unknown",
            detail: "the Backend could not be asked for the child's route",
          };
        }
        if (answer?.kind !== "none" && answer?.kind !== "route")
          return {
            outcome: "refused",
            code: "route-state-unknown",
            message: `the child's route state is unknown (${answer?.kind === "unknown" ? answer.detail : "no readable answer"}), so no model command was sent`,
          };
        if (answer.kind === "route") {
          // The stored route is in T3's form (the instance pi and a slug); the policy and Pi take the provider and the bare model it names.
          const route = piRouteOfT3(answer.route);
          explicit = {
            provider: route.provider,
            model: route.model,
            ...(route.effort === undefined ? {} : { effort: route.effort }),
          };
          fromRoute = true;
        }
      }
      const refusal = (code: PiSelectionRefusal, message: string): PiSelectionOutcome => ({
        outcome: "refused",
        code,
        message: fromRoute ? `${message} ${routeRefusedMarker(code)}` : message,
      });
      try {
        const resolved = effectiveRoute({
          kind: request.child ? "child" : "chat",
          explicit,
          capabilities,
        });
        // An effort the policy chose itself and the catalog cannot vouch for is not sent: Pi would clamp it without saying so.
        if (resolved.validation === "unknown-capability" && resolved.effortSource !== "explicit")
          return refusal(
            "default-effort-unverifiable",
            `${resolved.provider}/${resolved.model}: the default effort ${String(resolved.effort)} cannot be verified against the model's catalog, so it was not sent`,
          );
        return {
          outcome: "resolved",
          provider: resolved.provider,
          model: resolved.model,
          effort: resolved.effort,
          source: resolved.source,
          effortSource: resolved.effortSource,
          validation: resolved.validation,
        };
      } catch (error) {
        if (error instanceof RoutePolicyError) return refusal(error.code, error.message);
        return {
          outcome: "refused",
          code: "policy-failed",
          message: "the route policy could not resolve the selection",
        };
      }
    },
  });
}

/** Fill the slot; an occupied slot throws (one Backend per process). The release empties it only if this seam is still installed. */
export function installPiSelectionSeam(
  seam: PiSelectionSeam,
  host: Record<symbol, unknown> = globalThis as Record<symbol, unknown>,
): () => void {
  if (host[PI_SELECTION_SEAM_SLOT] !== undefined)
    throw new Error("the Pi selection slot is already filled; one Aetheria Backend per process");
  host[PI_SELECTION_SEAM_SLOT] = seam;
  return () => {
    if (host[PI_SELECTION_SEAM_SLOT] === seam) delete host[PI_SELECTION_SEAM_SLOT];
  };
}
