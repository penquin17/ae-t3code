// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M09 — the Backend registration of route availability (XC-11), research and snapshots, serving the `providers.*`, `research.*` and
// `attachments.*` XC-6 operations.
// `production` answers from an explicit Pi agent directory (a Backend option, never the environment), else unknown; a refused
// directory degrades visibly (unknown plus a path-free warning). `fixture` (FX-AV) refuses the production composition.
// The service is created at module start, so a restart begins with empty failure memory.
import * as NodePath from "node:path";

import {
  SNAPSHOT_DESCRIBE_OPERATION,
  SNAPSHOT_STORE_OPERATION,
  type Xc6Operation,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID } from "./compositionId.ts";
import {
  createFxAv,
  createPiAuthPort,
  createProductionAvailability,
  createProductionResearch,
  createProductionSnapshots,
  createProvidersOperations,
  parameter,
  type FxAvScript,
  type PiAuthPort,
  type ProductionAvailabilityOptions,
  type ProductionResearchOptions,
  type ProductionSnapshots,
  type Route,
  type RouteAvailability,
  type RouteCapabilities,
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

/** Test seams for research: the search transport and a replacement fetch work. Never supplied in production, never model-controlled. */
export type ProvidersResearchSeams = Pick<ProductionResearchOptions, "fetch" | "fetchWork">;

/** The three research operations this module serves beside the four `providers.*` ones. */
const RESEARCH_OPERATIONS = ["research.search", "research.fetch", "research.cancel"] as const;
/** The two snapshot operations, served over T3's attachments directory. */
const SNAPSHOT_OPERATIONS = [SNAPSHOT_STORE_OPERATION, SNAPSHOT_DESCRIBE_OPERATION] as const;
/** Where the search records live: a private folder of this module inside the Aetheria state root. */
const SEARCH_RECORDS_FOLDER = ["backend-providers", "search-records"] as const;

export interface ProvidersRegistrationOptions {
  /** The id of the composition this registration lives in; a fixture refuses the production one. */
  readonly composition: string;
  /** The Aetheria state root; the search records go to a private folder inside it. Absent: search is not recorded. */
  readonly stateRoot?: string;
  /** T3's attachments directory (explicit, never ambient); snapshots live in its `deliverables/` folder, outside the state root. Absent: snapshots are off. */
  readonly attachmentsDir?: string;
  readonly research?: ProvidersResearchSeams;
  /** Default: production. */
  readonly providers?: ProvidersMode;
  readonly now?: () => number;
}

/** The registration, plus the in-process capability answer the Pi selection seam uses (it throws while the service is not running). */
export type ProvidersBackendRegistration = BackendRegistration & {
  readonly routeCapabilities: (route: Route) => RouteCapabilities;
  /**
   * M05 steps 21 and 22: M09's route states and failure report, in-process, for the children service's fallback. Each throws while the service is not running; the reader turns a throw into
   * `unknown` / `other`, never into `out` or a switch (the module's fallback/consult.ts). M10 step 18 adds `usage` for the client usage read; it throws the same way.
   */
  readonly availability: Pick<RouteAvailability, "routeStates" | "reportFailure" | "usage">;
  /** Open a snapshot for its owning session (M10's download route); unavailable while snapshots are not running. */
  readonly openSnapshot: ProductionSnapshots["openSnapshot"];
  /** Remove a Pi session's snapshots; unavailable while snapshots are not running. */
  readonly forgetSession: ProductionSnapshots["forgetSession"];
};

/**
 * The module's registration. The service exists only between start and drain; the operations are declared once and reach it through a proxy
 * that refuses, rather than invents an answer, when it does not exist.
 */
export function createProvidersBackendRegistration(
  options: ProvidersRegistrationOptions,
): ProvidersBackendRegistration {
  const mode: ProvidersMode = options.providers ?? { mode: "production" };
  const clock = { now: options.now ?? Date.now };
  let current: RouteAvailability | undefined;
  let research: ReturnType<typeof createProductionResearch> | undefined;
  let researchAuth: PiAuthPort | undefined;
  let snapshots: ProductionSnapshots | undefined;

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
  // Research handlers take the carrier-verified session id and the untrusted arguments; they reach the instance that exists between start and drain.
  for (const name of RESEARCH_OPERATIONS) {
    operations[name] = async (context) => {
      const handler = research?.operations[name];
      if (handler === undefined) throw new Error("research is not running");
      return handler({ sessionId: context.sessionId, args: context.args });
    };
  }
  // Snapshot handlers take the same verified session id; they exist between start and drain, and only when an attachments directory was supplied.
  for (const name of SNAPSHOT_OPERATIONS) {
    operations[name] = async (context) => {
      const handler = snapshots?.operations[name];
      if (handler === undefined) throw new Error("snapshots are not running");
      return handler({ sessionId: context.sessionId, args: context.args });
    };
  }
  const unavailable = { ok: false, code: "unavailable" } as const;

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
        // Research search uses the same sign-in store (the same agent directory, Pi's own lock) through a port of its own; a directory the archive
        // refuses was already reported above and leaves search without a store (credential-missing). Fetch needs no credential.
        if (mode.mode === "production" && "agentDir" in mode) {
          try {
            researchAuth = createPiAuthPort({
              agentDir: mode.agentDir,
              warn: mode.warn,
              ...(mode.oauth === undefined ? {} : { oauth: mode.oauth }),
            });
          } catch (error) {
            if (!isInvalidAgentDir(error)) throw error;
          }
        }
        research = createProductionResearch({
          now: clock.now,
          ...(researchAuth === undefined ? {} : { auth: researchAuth }),
          ...(options.stateRoot === undefined
            ? {}
            : { recordsDir: NodePath.join(options.stateRoot, ...SEARCH_RECORDS_FOLDER) }),
          ...(mode.mode === "production" && "warn" in mode ? { warn: mode.warn } : {}),
          ...(options.research?.fetch === undefined ? {} : { fetch: options.research.fetch }),
          ...(options.research?.fetchWork === undefined
            ? {}
            : { fetchWork: options.research.fetchWork }),
        });
        if (options.attachmentsDir !== undefined) {
          snapshots = createProductionSnapshots({
            attachmentsDir: options.attachmentsDir,
            maxBytes: parameter("sourceImageMaxBytes"),
            ...(mode.mode === "production" && "warn" in mode ? { warn: mode.warn } : {}),
          });
        }
      },
      drain: async () => {
        const service = current;
        const running = research;
        const auth = researchAuth;
        const copies = snapshots;
        current = undefined;
        research = undefined;
        researchAuth = undefined;
        snapshots = undefined;
        await copies?.dispose();
        await running?.dispose();
        await auth?.dispose();
        await service?.dispose();
        return {
          released: [
            ...(service === undefined ? [] : ["backend-providers.availability"]),
            ...(running === undefined ? [] : ["backend-providers.research"]),
            ...(copies === undefined ? [] : ["backend-providers.snapshots"]),
          ],
          stopped: [],
          transferred: [],
          stillLive: [],
        };
      },
    },
    operations,
    routeCapabilities: (route) => proxy.routeCapabilities(route),
    availability: {
      routeStates: (routes, purpose) => proxy.routeStates(routes, purpose),
      reportFailure: (route, failure) => proxy.reportFailure(route, failure),
      usage: (provider) => proxy.usage(provider),
    },
    openSnapshot: (sessionId, snapshotId) =>
      snapshots === undefined
        ? Promise.resolve(unavailable)
        : snapshots.openSnapshot(sessionId, snapshotId),
    forgetSession: (sessionId) =>
      snapshots === undefined ? Promise.resolve(unavailable) : snapshots.forgetSession(sessionId),
  };
}
