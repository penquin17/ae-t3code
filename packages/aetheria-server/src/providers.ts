// AETHERIA M09 — the Backend registration of route availability (XC-11), serving the four `providers.*` XC-6 operations.
// `production` answers from an explicit Pi agent directory (a Backend option, never the environment), else unknown; a refused
// directory degrades visibly (unknown plus a path-free warning). `fixture` (FX-AV) refuses the production composition.
// The service is created at module start, so a restart begins with empty failure memory.
import type { Xc6Operation } from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID } from "./compositionId.ts";
import {
  createFxAv,
  createProductionAvailability,
  createProvidersOperations,
  type FxAvScript,
  type ProductionAvailabilityOptions,
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
  | {
      readonly mode: "production";
      /** The explicit isolated Pi agent directory holding auth.json. Nothing ambient is consulted. */
      readonly agentDir: string;
      /** Receives redacted one-line warnings (a refused directory, adapter failures). Required, so a degradation is never silent. */
      readonly warn: (line: string) => void;
      /** Test seams: a synthetic fetch for the quota readers and synthetic OAuth refresh handlers. Never supplied in production. */
      readonly fetch?: typeof fetch;
      readonly oauth?: ProductionAvailabilityOptions["oauth"];
      /** Test seam for existing parameters such as cache lifetime; production uses the package record. */
      readonly parameters?: ProductionAvailabilityOptions["parameters"];
    }
  | { readonly mode: "fixture"; readonly script?: FxAvScript };

const AGENT_DIR_REFUSED =
  "providers: the isolated agent directory was refused (invalid-agent-dir); credential and usage adapters are off and every route answers unknown / service-unavailable";

/** The archive's refusal of an agent directory that is not an absolute, normalised path (a `ProviderAuthError`). */
const isInvalidAgentDir = (error: unknown): boolean =>
  error instanceof Error &&
  error.name === "ProviderAuthError" &&
  (error as Error & { code?: unknown }).code === "invalid-agent-dir";

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
        } else if ("agentDir" in mode) {
          try {
            current = createProductionAvailability({
              clock,
              agentDir: mode.agentDir,
              warn: mode.warn,
              ...(mode.fetch === undefined ? {} : { fetch: mode.fetch }),
              ...(mode.oauth === undefined ? {} : { oauth: mode.oauth }),
              ...(mode.parameters === undefined ? {} : { parameters: mode.parameters }),
            });
          } catch (error) {
            if (!isInvalidAgentDir(error)) throw error;
            // Visible, not silent: the Backend keeps starting, the module answers unknown, and the reason is named without the path.
            try {
              mode.warn(AGENT_DIR_REFUSED);
            } catch {
              // a failing warning sink cannot make the module claim anything; the answers are unknown regardless
            }
            current = createProductionAvailability({ clock });
          }
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
