// AETHERIA M11 steps 9–10 (C4 K6) — the `modules`, `compositions` and `config` providers: DECLARED rows from the Backend manifest joined by the core's `joinModules` to the OBSERVED live status, no second module list.
// Declared and observed stay apart, the digest stays the host's with its source named, and unreadable is `unsupported`, never `absent`. `config` only offers candidates (exact XC-4 fields and the row's
// declared values) for the service's projector; it reads no environment, credential store, Pi auth, service option or file.
import type { AetheriaCompositionStatus } from "@t3tools/aetheria-contracts";

import {
  joinModules,
  pageOf,
  translateLifecycle,
  type DeclaredModule,
  type HostObservation,
  type InspectHost,
  type InspectProvider,
  type InspectState,
  type ListPage,
  type ModuleJoin,
  type QueryTarget,
} from "./inspectEntry.ts";

const MODULES_PROVIDER_ID = "modules";
const COMPOSITIONS_PROVIDER_ID = "compositions";
const CONFIG_PROVIDER_ID = "config";

export interface StatusSources {
  /** The Backend's raw schema-v1 manifest. A throw, or a manifest without a `modules` list, is unreadable. */
  readonly manifest: () => unknown;
  /** The live Backend status (the safe shape the read-only RPC serves). A throw is unreadable. */
  readonly status: () => AetheriaCompositionStatus;
  /** Inspection is off: only the inspect module's own state reads `inactive` (`disabled`). */
  readonly disabled?: readonly string[];
  /** Where a module's declared values came from, by field. Absent means the manifest, which is never a credential store. */
  readonly origins?: (moduleId: string) => Readonly<Record<string, string>>;
}

interface Row {
  readonly id: string;
  readonly host: InspectHost;
  readonly required: boolean;
  readonly raw: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hosts: readonly string[] = ["agent", "backend", "client"];

/** The declared module rows, or `undefined` when the manifest cannot be read. */
function declaredRows(sources: StatusSources): Row[] | undefined {
  try {
    const manifest = sources.manifest();
    if (!isRecord(manifest) || !Array.isArray(manifest.modules)) return undefined;
    const rows: Row[] = [];
    for (const raw of manifest.modules) {
      if (!isRecord(raw) || typeof raw.id !== "string" || !hosts.includes(raw.host as string))
        return undefined;
      rows.push({
        id: raw.id,
        host: raw.host as InspectHost,
        required: raw.required === true,
        raw,
      });
    }
    return rows;
  } catch {
    return undefined;
  }
}

function observation(sources: StatusSources): HostObservation {
  try {
    const status = sources.status();
    return {
      status: "observed",
      modules: status.modules.map((m) => ({ id: m.id, state: m.state })),
      digest: {
        version: status.digest.version,
        algorithm: status.digest.algorithm,
        value: status.digest.value,
      },
    };
  } catch {
    return { status: "unreadable" };
  }
}

const unreadableAnswer = (reason: string) => ({
  total: 1,
  entries: [
    {
      targetId: "unreadable",
      kind: "status",
      state: "unsupported" as InspectState,
      summary: reason,
    },
  ],
});

function joined(
  sources: StatusSources,
  rows: readonly Row[],
): { readonly modules: ModuleJoin[]; readonly observed: HostObservation } {
  const observed = observation(sources);
  const declared: DeclaredModule[] = rows.map((r) => ({
    id: r.id,
    host: r.host,
    required: r.required,
  }));
  return {
    modules: joinModules(declared, { backend: observed }, { disabled: sources.disabled ?? [] }),
    observed,
  };
}

const summaryOf = (module: ModuleJoin): string =>
  `${module.host} module${module.required ? ", required" : ""}${module.reason === null ? "" : `: ${module.reason}`}`;

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The `modules` provider: the manifest's modules with honest states. */
export function createModulesProvider(sources: StatusSources): InspectProvider {
  return {
    providerId: MODULES_PROVIDER_ID,
    host: "backend",
    list(page: ListPage) {
      const rows = declaredRows(sources);
      if (rows === undefined) return unreadableAnswer("the manifest is unreadable");
      if (page.kind !== undefined && page.kind !== "module") return { total: 0, entries: [] };
      const all = joined(sources, rows).modules;
      const window = pageOf(all, page.offset, page.limit);
      return {
        total: window.total,
        entries: window.entries.map((m) => ({
          targetId: m.id,
          kind: "module",
          state: m.state,
          summary: summaryOf(m),
        })),
      };
    },
    query(request: QueryTarget) {
      const rows = declaredRows(sources);
      if (rows === undefined) return { outcome: "schema-unsupported" };
      const row = rows.find((r) => r.id === request.targetId);
      if (row === undefined) return { outcome: "unavailable" };
      const module = joined(sources, rows).modules.find((m) => m.id === row.id) as ModuleJoin;
      const provides = isRecord(row.raw.provides) ? row.raw.provides : {};
      return {
        outcome: "ok",
        state: module.state,
        shape: {
          id: module.id,
          host: module.host,
          required: module.required,
          declared: {
            entry: typeof row.raw.entry === "string" ? row.raw.entry : null,
            mutatesToolInput: row.raw.mutatesToolInput === true,
            services: stringList(provides.services),
            tools: stringList(provides.tools),
            owns: stringList(row.raw.owns),
            contract: isRecord(row.raw.contract) ? row.raw.contract : null,
          },
          observed: { state: module.state, reason: module.reason },
          provenance: module.provenance,
        },
      };
    },
  };
}

const PHASE_STATE: Readonly<Record<string, { state: InspectState; reason: string | null }>> = {
  running: { state: "active", reason: null },
  prepared: { state: "inactive", reason: "prepared" },
  starting: { state: "inactive", reason: "starting" },
  disposed: { state: "inactive", reason: "disposed" },
  failed: { state: "failed", reason: "failed" },
};

/** The `compositions` provider: the Backend's composition(s) as declared, with the host status observed beside them. */
export function createCompositionsProvider(sources: StatusSources): InspectProvider {
  const declaredCompositions = (): Record<string, unknown>[] | undefined => {
    try {
      const manifest = sources.manifest();
      if (!isRecord(manifest) || !Array.isArray(manifest.compositions)) return undefined;
      const rows = manifest.compositions;
      return rows.every((c) => isRecord(c) && typeof c.id === "string")
        ? (rows as Record<string, unknown>[])
        : undefined;
    } catch {
      return undefined;
    }
  };
  const stateOf = (
    id: string,
    observed: AetheriaCompositionStatus | undefined,
  ): { state: InspectState; reason: string | null } => {
    if (observed === undefined) return { state: "unsupported", reason: "status-unreadable" };
    if (observed.composition !== id) return { state: "absent", reason: "not-in-status" };
    return PHASE_STATE[observed.phase] ?? translateLifecycle(observed.phase);
  };
  const read = (): AetheriaCompositionStatus | undefined => {
    try {
      return sources.status();
    } catch {
      return undefined;
    }
  };
  return {
    providerId: COMPOSITIONS_PROVIDER_ID,
    host: "backend",
    list(page: ListPage) {
      const declared = declaredCompositions();
      if (declared === undefined) return unreadableAnswer("the manifest is unreadable");
      if (page.kind !== undefined && page.kind !== "composition") return { total: 0, entries: [] };
      const observed = read();
      const ids = declared.map((c) => c.id as string).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const window = pageOf(ids, page.offset, page.limit);
      return {
        total: window.total,
        entries: window.entries.map((id) => {
          const { state, reason } = stateOf(id, observed);
          return {
            targetId: id,
            kind: "composition",
            state,
            summary: `backend composition${reason === null ? "" : `: ${reason}`}`,
          };
        }),
      };
    },
    query(request: QueryTarget) {
      const declared = declaredCompositions();
      if (declared === undefined) return { outcome: "schema-unsupported" };
      const row = declared.find((c) => c.id === request.targetId);
      if (row === undefined) return { outcome: "unavailable" };
      const observed = read();
      const { state } = stateOf(request.targetId, observed);
      const identity = isRecord(row.identity) ? row.identity : {};
      const matches = observed !== undefined && observed.composition === request.targetId;
      return {
        outcome: "ok",
        state,
        shape: {
          id: request.targetId,
          host: "backend",
          declared: {
            name: typeof identity.name === "string" ? identity.name : null,
            description: typeof identity.description === "string" ? identity.description : null,
            order: typeof identity.order === "number" ? identity.order : null,
            modules: stringList(row.modules),
          },
          observed: matches
            ? {
                phase: observed.phase,
                activationOrder: [...observed.activationOrder],
                modules: observed.modules.map((m) => ({
                  id: m.id,
                  required: m.required,
                  state: m.state,
                })),
                disposal: observed.disposal,
              }
            : null,
          provenance: {
            declared: "manifest",
            observed: matches ? "host-status" : null,
            hostDigest: matches
              ? { host: "backend", ...observed.digest, artifact: observed.artifact }
              : null,
          },
        },
      };
    },
  };
}

const configOf = (
  row: Row,
): { fields: Record<string, unknown>; values: Record<string, unknown> } | undefined => {
  const config = row.raw.config;
  if (!isRecord(config) || !isRecord(config.fields) || Object.keys(config.fields).length === 0)
    return undefined;
  return { fields: config.fields, values: isRecord(config.values) ? config.values : {} };
};

/** The `config` provider: each module's exact XC-4 fields and its declared values as CANDIDATES. The service projects them under `showValues`; nothing here decides what is shown. */
export function createConfigProvider(sources: StatusSources): InspectProvider {
  return {
    providerId: CONFIG_PROVIDER_ID,
    host: "backend",
    list(page: ListPage) {
      const rows = declaredRows(sources);
      if (rows === undefined) return unreadableAnswer("the manifest is unreadable");
      if (page.kind !== undefined && page.kind !== "module-config")
        return { total: 0, entries: [] };
      const withConfig = new Set(rows.filter((r) => configOf(r) !== undefined).map((r) => r.id));
      const all = joined(sources, rows).modules.filter((m) => withConfig.has(m.id));
      const window = pageOf(all, page.offset, page.limit);
      return {
        total: window.total,
        entries: window.entries.map((m) => ({
          targetId: m.id,
          kind: "module-config",
          state: m.state,
          summary: `${Object.keys((configOf(rows.find((r) => r.id === m.id) as Row) as { fields: object }).fields).length} configuration field(s)`,
        })),
      };
    },
    query(request: QueryTarget) {
      const rows = declaredRows(sources);
      if (rows === undefined) return { outcome: "schema-unsupported" };
      const row = rows.find((r) => r.id === request.targetId);
      const config = row === undefined ? undefined : configOf(row);
      if (row === undefined || config === undefined) return { outcome: "unavailable" };
      const module = joined(sources, rows).modules.find((m) => m.id === row.id) as ModuleJoin;
      const origins = sources.origins?.(row.id);
      return {
        outcome: "ok",
        state: module.state,
        config: {
          module: { id: row.id, fields: config.fields },
          values: config.values,
          ...(origins === undefined ? {} : { origins }),
        },
      };
    },
  };
}
