// @effect-diagnostics globalTimers:off
// AETHERIA M06 step 6: the `human-control-backend` XC-6 operations over ONE interaction service. Arguments decode strictly (an extra key throws
// before the service runs); the identity is the carrier-verified context only; no decision operation exists. `interaction.await` never returns
// an XC-6 pending result (the carrier mints a token only after the operation settles). The service starts after the owner lock and drains first.
import {
  AUDIT_HISTORY_OPERATION,
  decodeAuditHistoryArgs,
  decodeInteractionAwaitArgs,
  decodeInteractionCreateArgs,
  decodeInteractionReleaseArgs,
  decodeOriginVerifyArgs,
  decodePlanModeGetArgs,
  decodeTasksPublishArgs,
  INTERACTION_AWAIT_OPERATION,
  INTERACTION_CREATE_OPERATION,
  INTERACTION_RELEASE_OPERATION,
  ORIGIN_VERIFY_OPERATION,
  PLAN_MODE_GET_OPERATION,
  TASKS_PUBLISH_OPERATION,
  type InteractionActionResult,
  type InteractionAwaitResult,
  type InteractionCreateArgs,
  type InteractionCreateResult,
  type InteractionReleaseResult,
  type InteractionsAnswerPayload,
  type InteractionsSnapshotResult,
  type Xc6Operation,
  type Xc6OperationContext,
  type Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import { HUMAN_CONTROL_BACKEND_ENTRY } from "./humanControlRow.ts";

export {
  HUMAN_CONTROL_BACKEND_ENTRY,
  HUMAN_CONTROL_BACKEND_ID,
  humanControlBackendModuleRow,
} from "./humanControlRow.ts";

/** The caller as the carrier verified it. The only identity the Agent operations pass on. */
export interface AgentIdentity {
  readonly sessionId: string;
  readonly rootSessionId: string;
}

/** The connection's authenticated client session (T3's `AuthenticatedSession`): never a payload field. */
export interface ClientActor {
  readonly clientSessionId: string;
  readonly grantedScopes: readonly string[];
  readonly authenticatedAt: string;
}
export interface ClientIdentity {
  readonly actor: ClientActor;
}

export interface HumanControlDrainReport {
  readonly released: readonly string[];
  readonly stopped: readonly string[];
  readonly transferred: readonly string[];
  readonly stillLive: readonly string[];
}

/**
 * The interaction service as the step-5 archive announces it (`@aetheria/interaction/backend` `InteractionService`), restricted to what the Backend
 * wiring calls. Replies are the wire shapes of the contracts, which the archive's outcomes match field for field.
 */
export interface HumanControlService {
  /** Once, after the owner lock; admission opens only after `ok`. */
  start(): Promise<
    | { readonly ok: true; readonly value: { readonly continued: readonly string[] } }
    | { readonly ok: false; readonly code: string; readonly detail?: string }
  >;
  create(who: AgentIdentity, args: InteractionCreateArgs): Promise<InteractionCreateResult>;
  awaitSegment(
    who: AgentIdentity,
    args: { readonly interactionId: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<InteractionAwaitResult>;
  release(
    who: AgentIdentity,
    args: { readonly interactionId: string; readonly cause: "abort" },
  ): Promise<InteractionReleaseResult>;
  snapshot(rootSessionId: string): Promise<InteractionsSnapshotResult>;
  answer(
    who: ClientIdentity,
    args: Pick<InteractionsAnswerPayload, "interactionId" | "revision" | "answers">,
  ): Promise<InteractionActionResult>;
  redeliver(sessionId?: string): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly delivered: number;
          readonly failed: number;
          readonly pending: number;
        };
      }
    | { readonly ok: false; readonly code: string; readonly detail?: string }
  >;
  onChange(
    listener: (change: { readonly rootSessionId: string; readonly version: number }) => void,
  ): () => void;
  drain(): Promise<HumanControlDrainReport>;
}

/** What a service factory is given: the Backend's own seams, nothing else. */
export interface HumanControlServiceDeps {
  readonly stateRoot: string;
  readonly now: () => number;
  /** The T3 delivery seam, by thread. Absent: a late answer stays `pending` delivery (the service's own rule). */
  readonly turnDispatch?: ThreadTurnDispatch;
  /** The client RPC's operate check beyond its scope: whether this actor may act on that session and root. */
  readonly canOperate: (
    actor: ClientActor,
    target: { readonly sessionId: string; readonly rootSessionId: string },
  ) => boolean | Promise<boolean>;
  /** The thread a Pi session is bound to, or undefined when it is unknown or ambiguous (never a guess). */
  readonly threadOfSession: (sessionId: string) => string | undefined;
}
export type HumanControlServiceFactory = (deps: HumanControlServiceDeps) => HumanControlService;

/** T3's message intake and receipt store as the Backend sees them, by thread; the apps/server wrapper implements it with the captured Effect runtime. */
export interface ThreadTurnDispatch {
  dispatch(request: {
    readonly commandId: string;
    readonly threadId: string;
    readonly text: string;
  }): Promise<
    | { readonly kind: "accepted" }
    | { readonly kind: "rejected"; readonly error: string }
    | { readonly kind: "unknown"; readonly reason: string }
  >;
  receipt(
    commandId: string,
  ): Promise<
    | { readonly kind: "accepted" }
    | { readonly kind: "rejected"; readonly error: string }
    | { readonly kind: "absent" }
    | { readonly kind: "unavailable"; readonly reason: string }
  >;
}

/** The interaction core's turn-dispatch port (`TurnDispatchPort` of the archive): by the asker's session, which selects the thread. */
export interface SessionTurnDispatch {
  dispatch(request: {
    readonly commandId: string;
    readonly sessionId: string;
    readonly rootSessionId: string;
    readonly text: string;
  }): Promise<
    | { readonly kind: "accepted" }
    | { readonly kind: "rejected"; readonly error: string }
    | { readonly kind: "unknown"; readonly reason: string }
  >;
  receipt: ThreadTurnDispatch["receipt"];
}

/**
 * Adapts T3's by-thread delivery to the core's by-session port. A session with no single bound thread is `rejected` (nothing can receive the
 * message; the card shows the failure), never delivered to a guessed thread. Absent T3 delivery: absent, so a late answer stays pending.
 */
export function sessionTurnDispatch(
  deps: Pick<HumanControlServiceDeps, "turnDispatch" | "threadOfSession">,
): SessionTurnDispatch | undefined {
  const t3 = deps.turnDispatch;
  if (t3 === undefined) return undefined;
  return {
    dispatch: async (request) => {
      const threadId = deps.threadOfSession(request.sessionId);
      if (threadId === undefined)
        return { kind: "rejected", error: "the asking session is bound to no single thread" };
      return t3.dispatch({ commandId: request.commandId, threadId, text: request.text });
    },
    receipt: (commandId) => t3.receipt(commandId),
  };
}

/** The segment bound (Plan D2). The module's own guard adds a grace so it never races the service's own timer. */
const AWAIT_SEGMENT_MS = 5000;
const AWAIT_GUARD_GRACE_MS = 500;

const UNAVAILABLE_CODE = "INTERACTION_UNAVAILABLE";
const unavailable = (): Xc6Settled => ({ status: "unavailable", code: UNAVAILABLE_CODE });
const done = (result: unknown): Xc6Settled => ({ status: "done", result });
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** The identity the carrier verified, or undefined when any part is missing: the service is not called with a partial caller. */
function identityOf(context: Xc6OperationContext): AgentIdentity | undefined {
  return text(context.sessionId) && text(context.rootSessionId) && text(context.kind)
    ? { sessionId: context.sessionId, rootSessionId: context.rootSessionId }
    : undefined;
}

/** The registration, plus the one running service for the client RPC handlers and direct consumers. */
export type HumanControlBackendRegistration = BackendRegistration & {
  /** The running service, or undefined before start and after drain (a handler then answers unavailable, never an invented state). */
  readonly interactions: () => HumanControlService | undefined;
};

export interface HumanControlRegistrationOptions {
  /** Builds the service. Absent: the module runs unconfigured and every operation answers unavailable. */
  readonly create?: (() => HumanControlService) | undefined;
}

export function createHumanControlBackendRegistration(
  options: HumanControlRegistrationOptions,
): HumanControlBackendRegistration {
  let running: HumanControlService | undefined;
  /** The service that was built, whether or not its start completed: drain must reach it however far start got. */
  let built: HumanControlService | undefined;

  const withService =
    (run: (service: HumanControlService, context: Xc6OperationContext) => Promise<Xc6Settled>) =>
    async (context: Xc6OperationContext): Promise<Xc6Settled> => {
      const service = running;
      return service === undefined ? unavailable() : run(service, context);
    };
  const withIdentity = (
    run: (
      service: HumanControlService,
      who: AgentIdentity,
      context: Xc6OperationContext,
    ) => Promise<Xc6Settled>,
  ) =>
    withService((service, context) => {
      const who = identityOf(context);
      return who === undefined ? Promise.resolve(unavailable()) : run(service, who, context);
    });

  /** Decode first, always: a malformed argument is an error even while the operation is not yet built. */
  const operations: Record<string, Xc6Operation> = {
    [INTERACTION_CREATE_OPERATION]: (context) => {
      const args = decodeInteractionCreateArgs(context.args);
      return withIdentity(async (service, who) => done(await service.create(who, args)))(context);
    },
    [INTERACTION_AWAIT_OPERATION]: (context) => {
      const args = decodeInteractionAwaitArgs(context.args);
      return withIdentity(async (service, who) => {
        const guard = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<InteractionAwaitResult>((resolve) => {
          timer = setTimeout(() => {
            guard.abort();
            resolve({
              ok: false,
              code: UNAVAILABLE_CODE,
              detail: "the wait segment did not settle within its bound",
            });
          }, AWAIT_SEGMENT_MS + AWAIT_GUARD_GRACE_MS);
        });
        try {
          return done(
            await Promise.race([
              service.awaitSegment(who, args, { signal: guard.signal }),
              expired,
            ]),
          );
        } finally {
          clearTimeout(timer);
        }
      })(context);
    },
    [INTERACTION_RELEASE_OPERATION]: (context) => {
      const args = decodeInteractionReleaseArgs(context.args);
      return withIdentity(async (service, who) => done(await service.release(who, args)))(context);
    },
    // The four below answer unavailable until their steps (19, 15, 22, 15); they decode first so the strict contract already holds.
    [TASKS_PUBLISH_OPERATION]: (context) => {
      decodeTasksPublishArgs(context.args);
      return withService(async () => unavailable())(context);
    },
    [PLAN_MODE_GET_OPERATION]: (context) => {
      decodePlanModeGetArgs(context.args);
      return withService(async () => unavailable())(context);
    },
    [AUDIT_HISTORY_OPERATION]: (context) => {
      decodeAuditHistoryArgs(context.args);
      return withService(async () => unavailable())(context);
    },
    [ORIGIN_VERIFY_OPERATION]: (context) => {
      decodeOriginVerifyArgs(context.args);
      return withService(async () => unavailable())(context);
    },
  };

  return {
    entry: HUMAN_CONTROL_BACKEND_ENTRY,
    activation: {
      start: async () => {
        if (options.create === undefined) return;
        const service = options.create();
        built = service;
        const started = await service.start();
        if (!started.ok)
          throw new Error(
            `the interaction store did not start: ${started.code}${started.detail === undefined ? "" : ` (${started.detail})`}`,
          );
        running = service;
      },
      drain: async () => {
        const service = built;
        running = undefined;
        built = undefined;
        if (service === undefined)
          return { released: [], stopped: [], transferred: [], stillLive: [] };
        const report = await service.drain();
        return {
          released: [...report.released],
          stopped: [...report.stopped],
          transferred: [...report.transferred],
          stillLive: [...report.stillLive],
        };
      },
    },
    operations,
    interactions: () => running,
  };
}
