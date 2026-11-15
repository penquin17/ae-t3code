// @effect-diagnostics globalTimers:off globalDate:off
// AETHERIA M11 Plan step 8 (C2 P1; D5–D7, D10–D12) — the Backend inspection service: the two XC-6 operations `inspect.list` and `inspect.query`, and the boundaries every call crosses
// before a provider runs, in this order: draining or inspection off → unavailable; the caller's M03 verdict (refused with M03's code); the closed request (refused as INSPECT_INVALID or
// INSPECT_READONLY); then the providers, under the Backend's one deadline.
//
// A call is HELD: the service answers `done` with an outcome, `refused` or `unavailable` once, at the provider's answer or at the deadline D, and never `pending`, so no inspect call takes
// a carrier poll token. The deadline belongs to the Backend: it fires whether or not the caller still waits, settles the registry's waiting work, and removes the call. Drain stops
// admission and settles every held call unavailable. A provider answers a closed shape (the core's `decodeProviderList` / `decodeProviderQuery`); a configuration value reaches a result only
// through the projector, under the deployment's `showValues`; every result is checked against the core's result codec and cut by whole entries at the result cap. Nothing is stored, and nothing
// is logged but operation names, statuses, codes and outcomes.
import type { Xc6Operation, Xc6OperationContext } from "@t3tools/aetheria-contracts";

import type { InspectAccessPort } from "./inspectAccess.ts";
import {
  INSPECT_LIST_OPERATION,
  INSPECT_PARAMETERS,
  INSPECT_QUERY_OPERATION,
  applySelector,
  compareByHostThenId,
  decodeListRequest,
  decodeListResult,
  decodeProviderList,
  decodeProviderQuery,
  decodeQueryRequest,
  decodeQueryResult,
  fitListResult,
  fitQueryResult,
  listWindow,
  projectConfig,
  type InspectHost,
  type ListEntry,
  type ListResult,
  type Omission,
  type ProviderRegistry,
  type QueryResult,
} from "./inspectEntry.ts";

export type InspectSettled =
  | { readonly status: "done"; readonly result: unknown }
  | { readonly status: "unavailable"; readonly code: string }
  | { readonly status: "refused"; readonly code: string };

/** What a log line sees: the operation, how it ended, a code, an outcome. No argument, id, value or error text. */
export interface InspectLogEvent {
  readonly operation: string;
  readonly status: InspectSettled["status"];
  readonly code?: string;
  readonly outcome?: string;
}

export interface InspectRegistryEntry {
  readonly host: InspectHost;
  readonly registry: ProviderRegistry;
}

export interface InspectServiceOptions {
  readonly access: InspectAccessPort;
  /** Resolved from trusted construction and deployment config by `resolveInspectEnabled`; never from a caller. */
  readonly enabled: boolean;
  readonly registries: readonly InspectRegistryEntry[];
  /** The deployment's `showValues` setting (XC-4 string-list of `module.field` pairs). Anything that is not a list of pairs shows nothing. */
  readonly showValues: unknown;
  readonly now: () => number;
  /** Run `fn` after `ms`; returns the cancel. Supplied so the deadline is the Backend's and tests control time. */
  readonly schedule: (ms: number, fn: () => void) => () => void;
  readonly deadlineMs?: number;
  readonly capBytes?: number;
  readonly log?: (event: InspectLogEvent) => void;
}

export interface InspectService {
  /** Exactly the two XC-6 operations. */
  operations(): Readonly<Record<string, Xc6Operation>>;
  /** Serve one operation by name: an `inspect.*` name the contract does not have is refused as INSPECT_READONLY and reaches nothing. */
  serve(operation: string, context: Xc6OperationContext): Promise<InspectSettled>;
  /** Calls held right now. */
  held(): number;
  /** Stop admission, settle every held call unavailable and dispose the registries. `stopped` is the number of held calls it settled (XC-7). */
  drain(): { readonly stopped: number };
}

/** The real timer, for the production registration. Unreferenced: a held call never keeps the process alive. */
export const timerSchedule = (ms: number, fn: () => void): (() => void) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/**
 * Whether inspection is on, from trusted Backend construction or deployment config only (D7, U1): an explicit boolean wins; with none, a deployment marked `local` is on and anything
 * else — a remote deployment, no marking, an unknown value — is off. A malformed `enabled` or `deployment` fails closed. No model, browser or hostname inference reaches this.
 */
export function resolveInspectEnabled(config: {
  readonly enabled?: unknown;
  readonly deployment?: unknown;
}): boolean {
  if (config.enabled === true) return true;
  if (config.enabled === false) return false;
  if (config.enabled !== undefined) return false;
  return config.deployment === "local";
}

const unavailable = (code: string): InspectSettled => ({ status: "unavailable", code });
const refused = (code: string): InspectSettled => ({ status: "refused", code });
const done = (result: unknown): InspectSettled => ({ status: "done", result });
const isInspectName = (name: string): boolean => name.startsWith("inspect.");

export function createInspectService(options: InspectServiceOptions): InspectService {
  const deadlineMs = options.deadlineMs ?? INSPECT_PARAMETERS.backendDeadlineMs;
  const capBytes = options.capBytes ?? INSPECT_PARAMETERS.resultCapBytes;
  const heldCalls = new Set<{ readonly finish: (settled: InspectSettled) => void }>();
  let draining = false;

  const note = (operation: string, settled: InspectSettled): InspectSettled => {
    try {
      const outcome =
        settled.status === "done" && typeof settled.result === "object" && settled.result !== null
          ? (settled.result as { outcome?: unknown }).outcome
          : undefined;
      options.log?.({
        operation,
        status: settled.status,
        ...("code" in settled ? { code: settled.code } : {}),
        ...(typeof outcome === "string" ? { outcome } : {}),
      });
    } catch {
      /* a failing log never changes a reply */
    }
    return settled;
  };

  const capturedAt = (): string => new Date(options.now()).toISOString();

  /** Providers of every registry in the stable order: host (agent, backend, client), then id. */
  const providers = (): Array<{
    readonly host: InspectHost;
    readonly id: string;
    readonly registry: ProviderRegistry;
  }> =>
    options.registries
      .flatMap(({ host, registry }) => registry.providers().map((id) => ({ host, id, registry })))
      .sort((a, b) => compareByHostThenId({ host: a.host, id: a.id }, { host: b.host, id: b.id }));

  const runList = async (
    request: ReturnType<typeof decodeListRequest> & { ok: true },
    until: Promise<void>,
  ): Promise<InspectSettled> => {
    const window = listWindow(request.value);
    const all = providers();
    const wanted = all.filter(
      (p) =>
        (request.value.providerId === undefined || p.id === request.value.providerId) &&
        (request.value.host === undefined || p.host === request.value.host),
    );
    if (request.value.providerId !== undefined && wanted.length === 0)
      return unavailable(
        all.some((p) => p.id === request.value.providerId)
          ? "INSPECT_UNAVAILABLE"
          : "INSPECT_UNKNOWN_PROVIDER",
      );
    let before = 0;
    const entries: ListEntry[] = [];
    for (const provider of wanted) {
      const handle = provider.registry.get(provider.id);
      if (handle === undefined) return unavailable("INSPECT_UNAVAILABLE");
      const need = window.limit - entries.length;
      const askLimit = need > 0 ? need : 1;
      const answer = await handle.list(
        {
          offset: Math.max(0, window.offset - before),
          limit: askLimit,
          ...(request.value.kind === undefined ? {} : { kind: request.value.kind }),
        },
        { until },
      );
      if (answer.status === "refused") return refused(answer.code);
      if (answer.status === "unavailable") return unavailable(answer.code);
      const page = decodeProviderList(answer.data, { limit: askLimit });
      if (!page.ok) return unavailable("INSPECT_PROVIDER_FAILED");
      before += page.value.total;
      if (need > 0)
        for (const entry of page.value.entries)
          entries.push({
            providerId: provider.id,
            targetId: entry.targetId,
            kind: entry.kind,
            host: provider.host,
            state: entry.state,
            summary: entry.summary,
          });
    }
    const next = window.offset + entries.length;
    const result: ListResult = {
      outcome: "ok",
      capturedAt: capturedAt(),
      entries,
      offset: window.offset,
      limit: window.limit,
      total: before,
      nextOffset: entries.length > 0 && next < before ? next : null,
    };
    if (!decodeListResult(result).ok) return unavailable("INSPECT_PROVIDER_FAILED");
    return done(fitListResult(result, capBytes));
  };

  const runQuery = async (
    request: ReturnType<typeof decodeQueryRequest> & { ok: true },
    until: Promise<void>,
  ): Promise<InspectSettled> => {
    const { providerId, targetId, selector, clientId } = request.value;
    const found = providers().find((p) => p.id === providerId);
    if (found === undefined) return unavailable("INSPECT_UNKNOWN_PROVIDER");
    const handle = found.registry.get(providerId);
    if (handle === undefined) return unavailable("INSPECT_UNAVAILABLE");
    const answer = await handle.query(
      { targetId, ...(clientId === undefined ? {} : { clientId }) },
      { until },
    );
    if (answer.status === "refused") return refused(answer.code);
    if (answer.status === "unavailable") return unavailable(answer.code);
    const decoded = decodeProviderQuery(answer.data);
    if (!decoded.ok) return unavailable("INSPECT_PROVIDER_FAILED");
    const provided = decoded.value;
    const at = capturedAt();
    if (provided.outcome !== "ok")
      return done({ outcome: provided.outcome, capturedAt: at, providerId, targetId });
    let shape: unknown;
    let values: Record<string, unknown> = {};
    let omitted: Omission[] = [];
    if ("config" in provided) {
      try {
        const projected = projectConfig(
          provided.config.module as Parameters<typeof projectConfig>[0],
          provided.config.values,
          options.showValues,
          provided.config.origins === undefined ? {} : { origins: provided.config.origins },
        );
        shape = { module: provided.config.module.id, fields: projected.shape };
        values = projected.values;
        omitted = projected.omitted;
      } catch {
        return unavailable("INSPECT_PROVIDER_FAILED");
      }
    } else shape = provided.shape;
    if (selector !== undefined) {
      const part = applySelector(shape, selector);
      if (!part.ok)
        return done({ outcome: "schema-unsupported", capturedAt: at, providerId, targetId });
      shape = part.value;
    }
    const result = {
      outcome: "ok",
      capturedAt: at,
      providerId,
      targetId,
      state: provided.state,
      ...(selector === undefined ? {} : { selector }),
      ...(clientId === undefined ? {} : { clientId }),
      shape,
      values,
      omitted,
    } as QueryResult;
    if (!decodeQueryResult(result).ok) return unavailable("INSPECT_PROVIDER_FAILED");
    return done(fitQueryResult(result, capBytes));
  };

  const timeoutResult = (operation: string, args: Readonly<Record<string, unknown>>): unknown =>
    operation === INSPECT_LIST_OPERATION
      ? { outcome: "timeout", capturedAt: capturedAt() }
      : {
          outcome: "timeout",
          capturedAt: capturedAt(),
          providerId: args.providerId,
          targetId: args.targetId,
        };

  const hold = (
    operation: string,
    args: Readonly<Record<string, unknown>>,
    work: (until: Promise<void>) => Promise<InspectSettled>,
  ): Promise<InspectSettled> =>
    new Promise<InspectSettled>((resolve) => {
      let finished = false;
      let endWaiting: () => void = () => undefined;
      const until = new Promise<void>((release) => {
        endWaiting = release;
      });
      let cancel: () => void = () => undefined;
      const entry = {
        finish: (settled: InspectSettled) => {
          if (finished) return;
          finished = true;
          cancel();
          heldCalls.delete(entry);
          endWaiting();
          resolve(settled);
        },
      };
      heldCalls.add(entry);
      cancel = options.schedule(deadlineMs, () =>
        entry.finish(done(timeoutResult(operation, args))),
      );
      work(until).then(entry.finish, () => entry.finish(unavailable("INSPECT_PROVIDER_FAILED")));
    });

  const serve = async (
    operation: string,
    context: Xc6OperationContext,
  ): Promise<InspectSettled> => {
    if (operation !== INSPECT_LIST_OPERATION && operation !== INSPECT_QUERY_OPERATION)
      return note(
        operation,
        isInspectName(operation) ? refused("INSPECT_READONLY") : refused("XC6_UNKNOWN_OPERATION"),
      );
    if (draining || !options.enabled) return note(operation, unavailable("INSPECT_UNAVAILABLE"));
    const access = await options.access.check(context.sessionId, operation);
    if (!access.ok) return note(operation, refused(access.code));
    if (draining) return note(operation, unavailable("INSPECT_UNAVAILABLE"));
    if (operation === INSPECT_LIST_OPERATION) {
      const request = decodeListRequest(context.args);
      if (!request.ok) return note(operation, refused(request.code));
      return note(
        operation,
        await hold(operation, context.args, (until) => runList(request, until)),
      );
    }
    const request = decodeQueryRequest(context.args);
    if (!request.ok) return note(operation, refused(request.code));
    return note(
      operation,
      await hold(operation, context.args, (until) => runQuery(request, until)),
    );
  };

  const service: InspectService = {
    operations: () =>
      Object.freeze({
        [INSPECT_LIST_OPERATION]: (context: Xc6OperationContext) =>
          serve(INSPECT_LIST_OPERATION, context),
        [INSPECT_QUERY_OPERATION]: (context: Xc6OperationContext) =>
          serve(INSPECT_QUERY_OPERATION, context),
      }),
    serve,
    held: () => heldCalls.size,
    drain() {
      draining = true;
      const stopping = [...heldCalls];
      for (const call of stopping) call.finish(unavailable("INSPECT_UNAVAILABLE"));
      for (const { registry } of options.registries) registry.dispose();
      return { stopped: stopping.length };
    },
  };
  return Object.freeze(service);
}
