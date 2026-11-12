// @effect-diagnostics globalTimers:off
// AETHERIA M05 step 6 (C10, D20): the 17 managed-work XC-6 operations over ONE injected children service; arguments decode strictly before it runs.
// Identity is the carrier's context only. Without a started service every operation answers `unavailable`; AUTH_/ROLE_ codes ride `refused`, the rest `done`.
// Long waits (`children.await-report`, `jobs.output` with `wait`) answer `pending` and are cancelled by request id (D20).
import {
  CHILDREN_AWAIT_REPORT_OPERATION,
  decodeChildrenAwaitReportArgs,
  decodeChildrenCancelArgs,
  decodeChildrenCloseArgs,
  decodeChildrenForkArgs,
  decodeChildrenInterruptArgs,
  decodeChildrenListArgs,
  decodeChildrenMessageArgs,
  decodeChildrenSpawnArgs,
  decodeChildrenStatusArgs,
  decodeJobsAdoptedArgs,
  decodeJobsAttachArgs,
  decodeJobsCancelArgs,
  decodeJobsExitedArgs,
  decodeJobsKillArgs,
  decodeJobsListArgs,
  decodeJobsOutputArgs,
  decodeJobsReserveArgs,
  JOBS_OUTPUT_OPERATION,
  ORCHESTRATION_OPERATIONS,
  type OrchestrationOperation,
  type Xc6Operation,
  type Xc6OperationContext,
  type Xc6OperationResult,
  type Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import type { ChildService } from "./library.ts";
import type {
  ChildLineageReader,
  ChildThreadPort,
  PlanModeInheritPort,
  ResumeBarrierPort,
} from "./orchestrationPorts.ts";
import type { SpawnAuthorizerPort } from "./spawnAuthorizer.ts";
import { ORCHESTRATION_BACKEND_ENTRY } from "./orchestrationRow.ts";

export type { OrchestrationOperation };
export {
  ORCHESTRATION_BACKEND_ENTRY,
  ORCHESTRATION_BACKEND_ID,
  orchestrationBackendModuleRow,
} from "./orchestrationRow.ts";

export const ORCHESTRATION_UNAVAILABLE_CODE = "ORCHESTRATION_UNAVAILABLE";

/** The caller as the carrier verified it: the only identity an operation passes on. Never an argument. */
export interface OrchestrationCaller {
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly kind: string;
}

/** The service's reply: a value, or a canonical code with optional data (leftover thread, fork session, step, cause, detail). */
export type OrchestrationOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: string; readonly [field: string]: unknown };

export interface OrchestrationDrainReport {
  readonly stopped: readonly string[];
  readonly stillLive: readonly string[];
  readonly released?: readonly string[];
  readonly transferred?: readonly string[];
}

/**
 * The children service as the archive announces it (Plan steps 5 and 7), restricted to what the Backend wiring calls. One entry point, `handle`, because the
 * module decodes every operation's arguments strictly and the service owns what each means; the module owns no child, job or route state.
 */
export interface OrchestrationService {
  /** Once, after the owner lock; operations are admitted only after `ok`. A failure refuses the Backend start. */
  start(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly code: string; readonly detail?: string }
  >;
  /** `args` are the strictly decoded arguments of `operation`. The signal is aborted at drain. */
  handle(
    operation: OrchestrationOperation,
    who: OrchestrationCaller,
    args: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<OrchestrationOutcome>;
  /** Ends every wait and stops accepting work; reports what was stopped and what may still be live. */
  drain(): Promise<OrchestrationDrainReport>;
  /**
   * The direct Backend API (Plan step 14): what trusted Backend modules call, never XC-6 and never model input. `undefined` before start and after drain. Turn admission, interruption
   * and settled events need a backend module's authority argument; the user's close, tree cancel, list and report read are for M10, which has already checked the device and names
   * the root. None of these is registered as an XC-6 operation.
   */
  direct(): OrchestrationDirectApi | undefined;
}

export type OrchestrationDirectApi = Pick<
  ChildService,
  | "admitTurn"
  | "interruptTurn"
  | "subscribeSettled"
  | "closeChild"
  | "cancelTree"
  | "cancelParentTurn"
  | "listChildren"
  | "readReport"
>;

/** What a service factory is given: the Backend's own seams, nothing else. The identity store, job registry and outbox are the service's, under `stateRoot`. */
export interface OrchestrationServiceDeps {
  readonly stateRoot: string;
  readonly now: () => number;
  /** T3 as the children service sees it. Always present: without it the module is not configured. */
  readonly threads: ChildThreadPort;
  /** M06's `inheritPlanMode`, resolved at each call: not running answers `INTERACTION_UNAVAILABLE`, never a guess. */
  readonly planMode: PlanModeInheritPort;
  /** Opens once M06's resume handling of a session has finished. */
  readonly resume: ResumeBarrierPort;
  /** M04's thread index, as translation only: the Pi session a thread holds, and the thread a Pi session is bound to (undefined when unknown or ambiguous). */
  readonly sessionOfThread: (threadId: string) => string | undefined;
  readonly threadOfSession: (sessionId: string) => string | undefined;
  /** For boot's lineage: the session a thread holds, `null` when the index holds no binding for it, `"unknown"` when the index cannot answer. */
  readonly lineageSessionOf: (threadId: string) => string | null | "unknown";
  /** M03's verdict on a spawn (identity, role catalog, depth, project layer), from the carrier-verified caller. */
  readonly spawnAuthorizer: SpawnAuthorizerPort;
  /** Boot's lineage listing; `unavailable` when T3's shells cannot be read, never an empty list. */
  readonly lineage: ChildLineageReader;
}
export type OrchestrationServiceFactory = (deps: OrchestrationServiceDeps) => OrchestrationService;

export interface OrchestrationRegistrationOptions {
  /** Builds the service. Absent: the module runs unconfigured and every operation answers unavailable. */
  readonly create?: (() => OrchestrationService) | undefined;
}

export type OrchestrationBackendRegistration = BackendRegistration & {
  /** The running service, or undefined before start and after drain (an operation then answers unavailable, never an invented state). */
  readonly service: () => OrchestrationService | undefined;
};

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const unavailable = (): Xc6Settled => ({
  status: "unavailable",
  code: ORCHESTRATION_UNAVAILABLE_CODE,
});
const AUTHORITY_CODE = /^(AUTH|ROLE)_[A-Z0-9_]+$/;

/** The identity the carrier verified, or undefined when any part is missing: the service is not called with a partial caller. */
function identityOf(context: Xc6OperationContext): OrchestrationCaller | undefined {
  return text(context.sessionId) && text(context.rootSessionId) && text(context.kind)
    ? { sessionId: context.sessionId, rootSessionId: context.rootSessionId, kind: context.kind }
    : undefined;
}

/** Maps the service's reply onto an XC-6 reply. A reply that is not an outcome is a lost one: unavailable, never success. */
function settle(reply: unknown): Xc6Settled {
  if (reply === null || typeof reply !== "object") return unavailable();
  const outcome = reply as { readonly ok?: unknown; readonly code?: unknown };
  if (outcome.ok === true) return { status: "done", result: reply };
  if (outcome.ok !== false || !text(outcome.code)) return unavailable();
  if (outcome.code === ORCHESTRATION_UNAVAILABLE_CODE) return unavailable();
  if (AUTHORITY_CODE.test(outcome.code)) return { status: "refused", code: outcome.code };
  return { status: "done", result: reply };
}

type Decoder = (args: unknown) => unknown;
const DECODERS: Readonly<Record<OrchestrationOperation, Decoder>> = Object.freeze({
  "children.spawn": decodeChildrenSpawnArgs,
  "children.fork": decodeChildrenForkArgs,
  "children.message": decodeChildrenMessageArgs,
  "children.list": decodeChildrenListArgs,
  "children.interrupt": decodeChildrenInterruptArgs,
  "children.close": decodeChildrenCloseArgs,
  "children.await-report": decodeChildrenAwaitReportArgs,
  "children.status": decodeChildrenStatusArgs,
  "children.cancel": decodeChildrenCancelArgs,
  "jobs.output": decodeJobsOutputArgs,
  "jobs.list": decodeJobsListArgs,
  "jobs.kill": decodeJobsKillArgs,
  "jobs.cancel": decodeJobsCancelArgs,
  "jobs.reserve": decodeJobsReserveArgs,
  "jobs.attach": decodeJobsAttachArgs,
  "jobs.adopted": decodeJobsAdoptedArgs,
  "jobs.exited": decodeJobsExitedArgs,
});

/** A wait that can outlive one carrier call: always a report wait, and a job-output call that asked to wait. */
const isLongWait = (operation: OrchestrationOperation, args: unknown): boolean =>
  operation === CHILDREN_AWAIT_REPORT_OPERATION ||
  (operation === JOBS_OUTPUT_OPERATION && (args as { wait?: unknown }).wait === true);

export function createOrchestrationBackendRegistration(
  options: OrchestrationRegistrationOptions,
): OrchestrationBackendRegistration {
  let running: OrchestrationService | undefined;
  /** The service that was built, whether or not its start completed: drain must reach it however far start got. */
  let built: OrchestrationService | undefined;
  let drainController: AbortController | undefined;

  const call = async (
    service: OrchestrationService,
    operation: OrchestrationOperation,
    who: OrchestrationCaller,
    args: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Xc6Settled> => {
    try {
      return settle(
        await service.handle(operation, who, args, signal === undefined ? undefined : { signal }),
      );
    } catch {
      return unavailable();
    }
  };

  const operation =
    (name: OrchestrationOperation): Xc6Operation =>
    (context): Xc6OperationResult | Promise<Xc6OperationResult> => {
      // Decode first, always: a malformed argument is an error even while the module is not yet built.
      const args = DECODERS[name](context.args);
      const service = running;
      const who = identityOf(context);
      if (service === undefined || who === undefined) return unavailable();
      const signal = drainController?.signal;
      const answer = call(service, name, who, args, signal);
      return isLongWait(name, args) ? { status: "pending", settle: answer } : answer;
    };

  const operations: Record<string, Xc6Operation> = {};
  for (const name of ORCHESTRATION_OPERATIONS) operations[name] = operation(name);

  return {
    entry: ORCHESTRATION_BACKEND_ENTRY,
    activation: {
      start: async () => {
        if (options.create === undefined) return;
        drainController = new AbortController();
        const service = options.create();
        built = service;
        const started = await service.start();
        if (!started.ok)
          throw new Error(
            `the orchestration service did not start: ${started.code}${started.detail === undefined ? "" : ` (${started.detail})`}`,
          );
        running = service;
      },
      drain: async () => {
        const service = built;
        running = undefined;
        built = undefined;
        drainController?.abort();
        drainController = undefined;
        if (service === undefined)
          return { released: [], stopped: [], transferred: [], stillLive: [] };
        const report = await service.drain();
        return {
          released: [...(report.released ?? [])],
          stopped: [...report.stopped],
          transferred: [...(report.transferred ?? [])],
          stillLive: [...report.stillLive],
        };
      },
    },
    operations,
    service: () => running,
  };
}
