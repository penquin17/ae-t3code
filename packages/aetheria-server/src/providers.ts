// AETHERIA M09 step 4 — the Backend registration of route availability (XC-11), serving the four `providers.*` XC-6 operations.
// Mode `production` (default) never produces fixture data and answers unknown until credentials are wired (step 8);
// mode `fixture` (FX-AV, every answer labelled) refuses to start in the production composition.
// The service is created at module start, so a restart begins with empty failure memory; the module drains it once.
import type { Xc6Operation } from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID } from "./compositionId.ts";
import {
  createFxAv,
  createProductionAvailability,
  createProvidersOperations,
  type FxAvScript,
  type RouteAvailability,
} from "./library.ts";
import { PROVIDERS_BACKEND_ENTRY } from "./providersRow.ts";

// The ids and the manifest row are data (providersRow.ts); they are re-exported so this module is the one surface of the providers module.
export {
  PROVIDERS_BACKEND_ENTRY,
  PROVIDERS_BACKEND_ID,
  providersBackendModuleRow,
} from "./providersRow.ts";

/** The explicit selection: the honest production service, or the labelled scripted fixture (never in the production composition). */
export type ProvidersMode =
  | { readonly mode: "production" }
  | { readonly mode: "fixture"; readonly script?: FxAvScript };

export interface ProvidersRegistrationOptions {
  /** The id of the composition this registration lives in; a fixture refuses the production one. */
  readonly composition: string;
  /** Default: production. */
  readonly providers?: ProvidersMode;
  readonly now?: () => number;
}

/**
 * The module's registration. The service exists only between start and drain; the operations are declared once and reach it through a proxy
 * that refuses, rather than invents an answer, when it does not exist.
 */
export function createProvidersBackendRegistration(
  options: ProvidersRegistrationOptions,
): BackendRegistration {
  const mode: ProvidersMode = options.providers ?? { mode: "production" };
  const clock = { now: options.now ?? Date.now };
  let current: RouteAvailability | undefined;

  const live = (): RouteAvailability => {
    if (current === undefined) throw new Error("providers service is not running");
    return current;
  };
  const proxy: RouteAvailability = {
    routeStates: (routes, purpose) => live().routeStates(routes, purpose),
    reportFailure: (route, failure) => live().reportFailure(route, failure),
    routeCapabilities: (route) => live().routeCapabilities(route),
    usage: (provider) => live().usage(provider),
    dispose: async () => {},
  };
  const handlers = createProvidersOperations(proxy);
  const operations: Record<string, Xc6Operation> = {};
  for (const [name, handler] of Object.entries(handlers)) {
    operations[name] = async (context) => ({ status: "done", result: await handler(context.args) });
  }

  return {
    entry: PROVIDERS_BACKEND_ENTRY,
    activation: {
      start: () => {
        if (mode.mode === "fixture") {
          const production = options.composition === BACKEND_COMPOSITION_ID;
          if (production)
            throw new Error(
              "FX-AV refused: a fixture cannot start in the production Backend composition",
            );
          current = createFxAv({
            clock,
            composition: { id: options.composition, production },
            ...(mode.script === undefined ? {} : { script: mode.script }),
          });
        } else {
          current = createProductionAvailability({ clock });
        }
      },
      drain: async () => {
        const service = current;
        current = undefined;
        await service?.dispose();
        return {
          released: service === undefined ? [] : ["backend-providers.availability"],
          stopped: [],
          transferred: [],
          stillLive: [],
        };
      },
    },
    operations,
  };
}
