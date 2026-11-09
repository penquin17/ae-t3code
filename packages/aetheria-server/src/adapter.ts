// AETHERIA — the Backend adapter: T3's server as the Backend host of Aetheria's composition. The shared runtime from the pinned artifact owns validation, the digest, ordered start, reverse idempotent drain and the XC-7 report.
// `prepareBackend` checks registrations against the build-time allowlist and refuses with every fault before any module is called.
// The adapter takes the host, the allowlist and the artifact stamps itself; a caller cannot supply them through `facts`.
import type { Xc6Operation, AetheriaCompositionStatus } from "@t3tools/aetheria-contracts";
import { XC6_OPERATION_NAME_PATTERN } from "@t3tools/aetheria-contracts";

import { PINNED_ARTIFACT, PINNED_ARTIFACT_STAMPS } from "./artifact.ts";
import {
  compareFaults,
  createHost,
  dispose,
  evaluate,
  hostStatus,
  register,
  start,
  type Activation,
  type DigestReport,
  type DisposalReport,
  type Fault,
  type LifecycleHost,
  type StartResult,
} from "./library.ts";

/** One explicit registration: the module's entry (matched to the manifest row's `entry`), its activation, and the XC-6 operations it serves. */
export interface BackendRegistration {
  readonly entry: string;
  readonly activation: Activation;
  readonly operations?: Readonly<Record<string, Xc6Operation>>;
}

/** Facts only the caller can know. The host, allowlist, composition id and artifact stamps are the adapter's. */
export interface BackendFacts {
  readonly installed?: Readonly<Record<string, { readonly version: string } | null>>;
  readonly builtinTools?: readonly string[];
  readonly designs?: Readonly<
    Record<string, { readonly path: string; readonly headings: readonly string[] } | null>
  >;
}

export interface PrepareOptions {
  /** The raw manifest (schema v1). */
  readonly manifest: unknown;
  readonly composition: string;
  /** The build-time allowlist of module entries. Explicit on purpose: the assembly passes the constant, never a default. */
  readonly allowlist: readonly string[];
  readonly registrations: readonly BackendRegistration[];
  readonly facts?: BackendFacts;
}

/** What an observer sees. Ids, order, digest and ok flags only: no argument, path, message, item name or token. */
export type BackendEvent =
  | { readonly kind: "started"; readonly order: readonly string[]; readonly digest: string }
  | { readonly kind: "start-failed"; readonly module: string }
  | { readonly kind: "start-refused"; readonly codes: readonly string[] }
  | { readonly kind: "disposed"; readonly ok: boolean; readonly order: readonly string[] };

/** The whole observer handle: it can stop listening and do nothing else. */
export interface BackendObserver {
  readonly close: () => void;
}

export interface BackendAdapter {
  /** Validate-then-start in dependency order. A second call returns the first call's result without starting anything again. */
  start(): Promise<StartResult>;
  /** Drain in reverse start order, once. Every later call returns the first report. A reason is required. */
  dispose(reason: string): Promise<DisposalReport>;
  /** The safe composition and lifecycle status (the shape the read-only RPC serves). */
  status(): AetheriaCompositionStatus;
  /** The XC-6 operations of the registered modules. Each answers `unavailable` unless its module and the Backend are running. */
  operations(): Readonly<Record<string, Xc6Operation>>;
  /** Observer-only registration: frozen events, errors swallowed, nothing returned that can mutate or register. */
  observe(listener: (event: BackendEvent) => void | Promise<void>): BackendObserver;
}

export type PrepareResult =
  | { readonly outcome: "refused"; readonly faults: readonly Fault[] }
  | { readonly outcome: "prepared"; readonly backend: BackendAdapter };

type Lifecycle = AetheriaCompositionStatus["phase"];

export const OPERATION_NOT_RUNNING = "XC6_BACKEND_NOT_RUNNING";

const fault = (code: string, subject: string, message: string, field?: string): Fault =>
  field === undefined ? { code, subject, message } : { code, subject, field, message };

const freezeEvent = (event: BackendEvent): BackendEvent => {
  const copy = { ...event } as Record<string, unknown>;
  for (const key of Object.keys(copy))
    if (Array.isArray(copy[key])) copy[key] = Object.freeze([...(copy[key] as unknown[])]);
  return Object.freeze(copy) as unknown as BackendEvent;
};

function registrationFaults(
  registrations: readonly BackendRegistration[],
  allowlist: ReadonlySet<string>,
): { faults: Fault[]; byEntry: Map<string, BackendRegistration> } {
  const faults: Fault[] = [];
  const byEntry = new Map<string, BackendRegistration>();
  const owners = new Map<string, string>();
  for (const registration of registrations) {
    const { entry } = registration;
    if (!allowlist.has(entry))
      faults.push(
        fault(
          "registration-not-allowlisted",
          `entry:${entry}`,
          `registration of entry \`${entry}\` is not on the build-time allowlist`,
          "entry",
        ),
      );
    if (byEntry.has(entry))
      faults.push(
        fault(
          "registration-duplicate",
          `entry:${entry}`,
          `entry \`${entry}\` is registered more than once`,
          "entry",
        ),
      );
    else byEntry.set(entry, registration);
    for (const name of Object.keys(registration.operations ?? {})) {
      if (!XC6_OPERATION_NAME_PATTERN.test(name))
        faults.push(
          fault(
            "operation-name-invalid",
            `operation:${name}`,
            `operation name ${JSON.stringify(name)} does not match ${XC6_OPERATION_NAME_PATTERN}`,
            "operations",
          ),
        );
      else if (owners.has(name))
        faults.push(
          fault(
            "operation-duplicate",
            `operation:${name}`,
            `operation \`${name}\` is registered by entries \`${owners.get(name)}\` and \`${entry}\`; exactly one owner is allowed`,
            "operations",
          ),
        );
      else owners.set(name, entry);
    }
  }
  return { faults, byEntry };
}

export function prepareBackend(options: PrepareOptions): PrepareResult {
  const allowlist = [...options.allowlist];
  const factsForRuntime = {
    composition: options.composition,
    host: "backend" as const,
    allowlist,
    artifactStamps: PINNED_ARTIFACT_STAMPS,
    builtinTools: options.facts?.builtinTools ?? [],
    ...(options.facts?.installed === undefined ? {} : { installed: options.facts.installed }),
    ...(options.facts?.designs === undefined ? {} : { designs: options.facts.designs }),
  };
  const evaluation = evaluate(options.manifest, factsForRuntime);
  const { faults, byEntry } = registrationFaults(options.registrations, new Set(allowlist));
  if (evaluation.outcome === "refused") faults.push(...evaluation.faults);
  else {
    const selected = new Map(evaluation.effective.modules.map((m) => [m.entry, m]));
    for (const module of evaluation.effective.modules) {
      if (!byEntry.has(module.entry))
        faults.push(
          fault(
            "module-not-registered",
            `module:${module.id}`,
            `module \`${module.id}\` (entry \`${module.entry}\`) is selected by composition \`${options.composition}\` but has no registration`,
          ),
        );
    }
    for (const entry of byEntry.keys()) {
      if (!selected.has(entry))
        faults.push(
          fault(
            "registration-not-selected",
            `entry:${entry}`,
            `registration of entry \`${entry}\` matches no module that composition \`${options.composition}\` selects`,
          ),
        );
    }
  }
  if (evaluation.outcome === "refused" || faults.length > 0)
    return { outcome: "refused", faults: Object.freeze([...faults].sort(compareFaults)) };

  const host = createHost({ host: "backend" });
  const moduleOfEntry = new Map(evaluation.effective.modules.map((m) => [m.entry, m.id]));
  for (const module of evaluation.effective.modules)
    register(host, module, (byEntry.get(module.entry) as BackendRegistration).activation);
  return {
    outcome: "prepared",
    backend: makeAdapter({
      host,
      manifest: options.manifest,
      facts: factsForRuntime,
      composition: options.composition,
      digest: evaluation.digest,
      activationOrder: evaluation.effective.activationOrder,
      byEntry,
      moduleOfEntry,
    }),
  };
}

interface Parts {
  readonly host: LifecycleHost;
  readonly manifest: unknown;
  readonly facts: Parameters<typeof start>[2];
  readonly composition: string;
  readonly digest: DigestReport;
  readonly activationOrder: readonly string[];
  readonly byEntry: ReadonlyMap<string, BackendRegistration>;
  readonly moduleOfEntry: ReadonlyMap<string, string>;
}

function makeAdapter(parts: Parts): BackendAdapter {
  const { host } = parts;
  let lifecycle: Lifecycle = "prepared";
  let startPromise: Promise<StartResult> | undefined;
  let finalized: Promise<void> | undefined;
  let disposalReport: DisposalReport | undefined;
  const listeners = new Set<(event: BackendEvent) => void | Promise<void>>();

  const emit = (raw: BackendEvent): void => {
    const event = freezeEvent(raw);
    for (const listener of Array.from(listeners)) {
      try {
        void Promise.resolve(listener(event)).catch(() => {});
      } catch {
        /* an observer's failure never reaches the lifecycle */
      }
    }
  };

  let disposedEmitted = false;
  const emitDisposed = (report: DisposalReport): void => {
    if (disposedEmitted) return;
    disposedEmitted = true;
    emit({ kind: "disposed", ok: report.ok, order: report.order });
  };

  const moduleState = (id: string): string | undefined =>
    hostStatus(host).modules.find((m) => m.id === id)?.state;

  const gated =
    (moduleId: string, operation: Xc6Operation): Xc6Operation =>
    (context) =>
      lifecycle === "running" && moduleState(moduleId) === "running"
        ? operation(context)
        : { status: "unavailable", code: OPERATION_NOT_RUNNING };

  const table: Record<string, Xc6Operation> = Object.create(null);
  for (const [entry, registration] of parts.byEntry) {
    const moduleId = parts.moduleOfEntry.get(entry) as string;
    for (const [name, operation] of Object.entries(registration.operations ?? {}))
      table[name] = gated(moduleId, operation);
  }
  const operations = Object.freeze(table);

  const adapter: BackendAdapter = {
    start() {
      startPromise ??= (async () => {
        lifecycle = "starting";
        const result = await start(host, parts.manifest, parts.facts);
        if (result.outcome === "started") {
          lifecycle = "running";
          emit({ kind: "started", order: result.activationOrder, digest: parts.digest.value });
        } else if (result.outcome === "stopped") {
          lifecycle = "disposed";
          disposalReport = result.disposal;
          emitDisposed(result.disposal);
        } else if (result.outcome === "failed") {
          lifecycle = "failed";
          disposalReport = result.disposal;
          emit({ kind: "start-failed", module: result.cause.module });
        } else {
          lifecycle = "failed";
          emit({ kind: "start-refused", codes: result.faults.map((f) => f.code) });
        }
        return result;
      })();
      return startPromise;
    },

    dispose(reason) {
      // The runtime throws on an empty reason before it caches anything, and returns the one cached report on every later call.
      const report = dispose(host, reason);
      finalized ??= report.then((done) => {
        disposalReport = done;
        if (lifecycle !== "failed") lifecycle = "disposed";
        emitDisposed(done);
      });
      return finalized.then(() => report);
    },

    status() {
      const modules = hostStatus(host).modules.map((m) => ({
        id: m.id,
        required: m.required,
        state: m.state,
      }));
      const report = disposalReport;
      return {
        composition: parts.composition,
        host: "backend",
        phase: lifecycle,
        digest: {
          version: parts.digest.version,
          algorithm: parts.digest.algorithm,
          value: parts.digest.value,
        },
        artifact: {
          package: PINNED_ARTIFACT.package,
          version: PINNED_ARTIFACT.version,
          stamp: PINNED_ARTIFACT.stamp,
        },
        activationOrder: [...parts.activationOrder],
        modules,
        disposal:
          report === undefined
            ? null
            : {
                ok: report.ok,
                order: [...report.order],
                released: report.released.length,
                stopped: report.stopped.length,
                transferred: report.transferred.length,
                stillLive: report.stillLive.length,
                failedModules: report.failed.map((f) => f.module),
                unobservedModules: report.unobserved.map((u) => u.module),
              },
      };
    },

    operations: () => operations,

    observe(listener) {
      listeners.add(listener);
      return Object.freeze({ close: () => void listeners.delete(listener) });
    },
  };
  return adapter;
}
