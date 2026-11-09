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

/** The key the Pi adapter reads (`Symbol.for`, so both sides share it without importing each other). */
export const PI_SELECTION_SEAM_SLOT: unique symbol = Symbol.for("aetheria.pi.selection-seam");

export interface PiSelectionRequest {
  readonly provider: string;
  readonly model: string;
  /** The effort the selection carries. Absent means the policy's default for the model applies. */
  readonly effort?: string;
  /** A spawned (subagent) thread takes the child column of the default table. */
  readonly child: boolean;
}

export type PiSelectionRefusal =
  | RoutePolicyErrorCode
  | "default-effort-unverifiable"
  | "policy-failed";

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
      try {
        const resolved = effectiveRoute({
          kind: request.child ? "child" : "chat",
          explicit: {
            provider: request.provider,
            model: request.model,
            ...(request.effort === undefined ? {} : { effort: request.effort }),
          },
          capabilities,
        });
        // An effort the policy chose itself and the catalog cannot vouch for is not sent: Pi would clamp it without saying so.
        if (resolved.validation === "unknown-capability" && resolved.effortSource !== "explicit")
          return {
            outcome: "refused",
            code: "default-effort-unverifiable",
            message: `${resolved.provider}/${resolved.model}: the default effort ${String(resolved.effort)} cannot be verified against the model's catalog, so it was not sent`,
          };
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
        if (error instanceof RoutePolicyError)
          return { outcome: "refused", code: error.code, message: error.message };
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
