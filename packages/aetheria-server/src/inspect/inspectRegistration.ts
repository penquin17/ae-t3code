// @effect-diagnostics globalDate:off
// AETHERIA M11 Plan steps 8–10 — the Backend `inspect-backend` module: its registration, now the real one (the step-7 placeholder, same export, is replaced). It serves the two XC-6 operations
// `inspect.list` and `inspect.query` through the inspection service, over one Backend provider registry holding the providers this host owns — `modules`, `compositions`, `config` and
// `backend-services`. The client-region provider joins in the client-query steps, through the same registry.
//
// Unconfigured (no caller check supplied) the module answers `unavailable` to every call: there is no stub success. Inspection is on only when trusted construction or deployment config says
// so (`resolveInspectEnabled`); with it off, both operations answer `unavailable`, no provider is asked, and the module's own inspection state reads `inactive` (disabled) while the raw
// lifecycle is unchanged.
import type { BackendRegistration } from "../adapter.ts";
import type { ClientQueries } from "./clients.ts";
import type { InspectAccessPort } from "./inspectAccess.ts";
import {
  createProviderRegistry,
  type InspectProvider,
  type ProviderRegistry,
} from "./inspectEntry.ts";
import { INSPECT_BACKEND_ENTRY, INSPECT_BACKEND_ID } from "./inspectRow.ts";
import {
  createBackendServicesProvider,
  type BackendServicesMetadataPort,
} from "./metadataProviders.ts";
import {
  createInspectService,
  resolveInspectEnabled,
  timerSchedule,
  type InspectLogEvent,
  type InspectService,
} from "./service.ts";
import {
  createCompositionsProvider,
  createConfigProvider,
  createModulesProvider,
  type StatusSources,
} from "./statusProviders.ts";

export interface InspectBackendOptions {
  /** M03's caller check for the inspect tools. Absent: the module is unconfigured and every call is unavailable. */
  readonly access?: InspectAccessPort | undefined;
  /** Trusted construction or deployment config for `inspect.enabled`: never a model, browser or hostname input. */
  readonly enablement?: { readonly enabled?: unknown; readonly deployment?: unknown } | undefined;
  /** The manifest and live status the composition providers read. Absent: those three providers are not registered. */
  readonly sources?: Omit<StatusSources, "disabled"> | undefined;
  /** The read-only driver/RPC metadata the app server supplies. Absent: `backend-services` is not registered. */
  readonly metadata?: BackendServicesMetadataPort | undefined;
  /** The live client resolver (C5), supplied by the app wiring over M10's registry. Absent: no `client-regions` provider. */
  readonly clients?: ClientQueries | undefined;
  /** The deployment's `showValues` XC-4 setting; absent or malformed shows no value. */
  readonly showValues?: unknown;
  readonly now?: (() => number) | undefined;
  readonly schedule?: ((ms: number, fn: () => void) => () => void) | undefined;
  readonly deadlineMs?: number | undefined;
  readonly capBytes?: number | undefined;
  readonly log?: ((event: InspectLogEvent) => void) | undefined;
}

export interface InspectBackendRegistration extends BackendRegistration {
  /** The one service, for tests and the XC-7 count. */
  readonly service: InspectService;
  readonly registry: ProviderRegistry;
}

export function createInspectBackendRegistration(
  options: InspectBackendOptions = {},
): InspectBackendRegistration {
  const registry = createProviderRegistry({ host: "backend" });
  const enabled = resolveInspectEnabled(options.enablement ?? {});
  const disabled = enabled ? [] : [INSPECT_BACKEND_ID];

  const provide = (provider: InspectProvider): void => void registry.register(provider);
  if (options.sources !== undefined) {
    const sources: StatusSources = { ...options.sources, disabled };
    provide(createModulesProvider(sources));
    provide(createCompositionsProvider(sources));
    provide(createConfigProvider(sources));
  }
  if (options.metadata !== undefined) provide(createBackendServicesProvider(options.metadata));

  const service = createInspectService({
    access: options.access ?? {
      check: async () => ({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE", reason: "unconfigured" }),
    },
    // Unconfigured is not on: without a caller check no call may reach a provider.
    enabled: enabled && options.access !== undefined,
    registries: [{ host: "backend", registry }],
    ...(options.clients === undefined ? {} : { clients: options.clients }),
    showValues: options.showValues,
    now: options.now ?? Date.now,
    schedule: options.schedule ?? timerSchedule,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.capBytes === undefined ? {} : { capBytes: options.capBytes }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  return {
    entry: INSPECT_BACKEND_ENTRY,
    activation: {
      start: () => undefined,
      drain: async () => {
        const { stopped } = service.drain();
        return {
          released: ["backend-inspect.state"],
          stopped: Array.from({ length: stopped }, (_, index) => `inspect-call:${index + 1}`),
          transferred: [],
          stillLive: [],
        };
      },
    },
    operations: service.operations(),
    service,
    registry,
  };
}
