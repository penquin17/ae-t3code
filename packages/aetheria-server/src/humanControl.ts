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
  type AuthorizationGrantPayload,
  type AuthorizationGrantResult,
  type InteractionActionResult,
  type InteractionAwaitResult,
  type InteractionCreateArgs,
  type InteractionCreateResult,
  type InteractionReleaseResult,
  type InteractionsAnswerPayload,
  type InteractionsCancelPayload,
  type InteractionsClosePayload,
  type InteractionsHoldPayload,
  type InteractionsSnapshotResult,
  type OriginVerifyArgs,
  type OriginVerifyResult,
  type PlanDecidePayload,
  type PlanModeGetResult,
  type PlanModeSetPayload,
  type PlanModeSetResult,
  type TasksGetResult,
  type TasksPublishArgs,
  type TasksPublishResult,
  type Xc6Operation,
  type Xc6OperationContext,
  type Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { BackendRegistration } from "./adapter.ts";
import type { AuditAccess, AuditProject } from "./identity/auditAccess.ts";
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
  /** The carrier-verified kind (`main` or `child`): only a main session may open a plan review, and an absent kind is refused by the service. */
  readonly kind?: string;
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
  /** The client actions below each check the connection's scope and the host's access rule inside the service (C1), then write one conditional commit. */
  cancel(who: ClientIdentity, args: InteractionsCancelPayload): Promise<InteractionActionResult>;
  hold(who: ClientIdentity, args: InteractionsHoldPayload): Promise<InteractionActionResult>;
  close(who: ClientIdentity, args: InteractionsClosePayload): Promise<InteractionActionResult>;
  decidePlan(who: ClientIdentity, args: PlanDecidePayload): Promise<InteractionActionResult>;
  /** A session never set reads inactive at revision 0; an unreadable record is unavailable, never inactive. Serves the client read and XC-6 `plan-mode.get`. */
  getPlanMode(sessionId: string): Promise<PlanModeGetResult>;
  setPlanMode(who: ClientIdentity, args: PlanModeSetPayload): Promise<PlanModeSetResult>;
  /** XC-6 `tasks.publish`: the caller's own session only (the transport's), ordered by `args.order`; the reply is the view the Backend holds. */
  publishTasks(who: AgentIdentity, args: TasksPublishArgs): Promise<TasksPublishResult>;
  /** The client read `tasks.get`: `null` when nothing was published; a damaged view is unavailable, never an empty list. */
  getTasks(sessionId: string): Promise<TasksGetResult>;
  /** Client-only: returns the origin id to the client, never to an Agent. */
  grant(who: ClientIdentity, args: AuthorizationGrantPayload): Promise<AuthorizationGrantResult>;
  /** XC-17, read-only: the verdict on one origin; `{ok:false}` is unavailable, which a caller reads as "not a human decision". Writes nothing. */
  verifyHumanOrigin(
    originId: string,
    expect?: OriginVerifyArgs["expect"],
  ): Promise<OriginVerifyResult | { readonly ok: false; readonly code: string }>;
  /**
   * The host's access rule for a client READ, the same rule the actions use: whether this actor may reach that session and root. The archive service
   * has no actor on its reads, so the Backend's wrapper (`createArchiveInteractionService`) supplies this from the one `canOperate` it was built with.
   */
  canAccess(
    actor: ClientActor,
    target: { readonly sessionId: string; readonly rootSessionId: string },
  ): boolean | Promise<boolean>;
  /** Ends each pending wait no live segment holds (`process-exit` for a session; `backend-restart` for none). Never re-asks. */
  reconcileWaits(sessionId?: string): Promise<
    | {
        readonly ok: true;
        // `unreconciled` is the archive's planned report of interactions it could not reconcile; absent until the archive carries it.
        readonly value: {
          readonly continued: readonly string[];
          readonly unreconciled?: readonly string[];
        };
      }
    | { readonly ok: false; readonly code: string; readonly detail?: string }
  >;
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

/** A session's root as the Backend knows it. `absent` is a session the Backend has no record of; `unavailable` is a record that cannot be read. */
export type SessionLookup =
  | { readonly kind: "found"; readonly sessionId: string; readonly rootSessionId: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly reason: string };
/** The archive's `SessionDirectoryPort`: the service derives a grant's or a mode change's root from it, never from the client. */
export interface SessionDirectory {
  lookup(sessionId: string): Promise<SessionLookup>;
}

/** What a service factory is given: the Backend's own seams, nothing else. */
export interface HumanControlServiceDeps {
  /** Session → root, from the Backend's identity records. Without it the service answers unavailable for grant and mode changes. */
  readonly sessions: SessionDirectory;
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
    ? { sessionId: context.sessionId, rootSessionId: context.rootSessionId, kind: context.kind }
    : undefined;
}

/** The registration, plus the one running service for the client RPC handlers and direct consumers. */
export type HumanControlBackendRegistration = BackendRegistration & {
  /** The running service, or undefined before start and after drain (a handler then answers unavailable, never an invented state). */
  readonly interactions: () => HumanControlService | undefined;
  /**
   * Subscribes to the running service's change pushes. `onEnd` runs when the Backend drains (the service then drops its listeners without a word, so
   * a stream would otherwise hang). Returns the unsubscribe, or undefined when no service runs: the caller ends its stream.
   */
  readonly watch: (
    listener: Parameters<HumanControlService["onChange"]>[0],
    onEnd: () => void,
  ) => (() => void) | undefined;
};

/**
 * The audit evidence's two seams (step 23): the Backend's independent check of the caller, then the read-only evidence over the project that check derived.
 * `access` never throws for a refusal (it returns the M03 code); `history` is the evidence package's fixed operation and takes no repository or path.
 */
export interface AuditPort {
  access(who: AgentIdentity): Promise<AuditAccess>;
  history(input: {
    readonly cycle: string;
    readonly project: AuditProject;
    readonly role: string | null;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface HumanControlRegistrationOptions {
  /** Builds the service. Absent: the module runs unconfigured and every operation answers unavailable. */
  readonly create?: (() => HumanControlService) | undefined;
  /** The audit evidence. Absent: `audit.history` answers unavailable. */
  readonly audit?: AuditPort | undefined;
}

export function createHumanControlBackendRegistration(
  options: HumanControlRegistrationOptions,
): HumanControlBackendRegistration {
  let running: HumanControlService | undefined;
  /** The service that was built, whether or not its start completed: drain must reach it however far start got. */
  let built: HumanControlService | undefined;
  /** Each live subscription's end hook: a drain runs them all, so no stream outlives the service it listens to. */
  const watchers = new Set<() => void>();
  /** Aborted at drain, so a running evidence read (a Git command) is cancelled instead of outliving the Backend. */
  let drainSignal: AbortSignal | undefined;
  let drainController: AbortController | undefined;

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
    // The session is the transport's, never an argument; an unreadable mode record is the service's unavailable, not an inactive mode.
    [PLAN_MODE_GET_OPERATION]: (context) => {
      decodePlanModeGetArgs(context.args);
      return withIdentity(async (service, who) => done(await service.getPlanMode(who.sessionId)))(
        context,
      );
    },
    // M07's Agent-side route to XC-17: a read-only verdict, any identified caller; an unavailable store answers unavailable, never verified.
    [ORIGIN_VERIFY_OPERATION]: (context) => {
      const args = decodeOriginVerifyArgs(context.args);
      return withIdentity(async (service) => {
        const verdict = await service.verifyHumanOrigin(args.originId, args.expect);
        return "ok" in verdict ? unavailable() : done(verdict);
      })(context);
    },
    // The Agent's task list view (D11): the key is the carrier-verified session, never an argument. A service failure is unavailable and never an error:
    // a failed publication must not fail the Agent's task write, and the next publish repairs the view. The reply is the service's, never upgraded.
    [TASKS_PUBLISH_OPERATION]: (context) => {
      const args = decodeTasksPublishArgs(context.args);
      return withIdentity(async (service, who) => {
        try {
          return done(await service.publishTasks(who, args));
        } catch {
          return unavailable();
        }
      })(context);
    },
    // The read-only audit evidence (D12, C6). The only argument is the cycle slug; the caller is the carrier's, the project is derived for THAT session by the
    // Backend's own check (never an argument), and that check — M03's record, role catalog and `authorize` — runs BEFORE any file or Git is touched. A refusal
    // is an XC-6 `refused` with M03's code; a failed check or read is `unavailable`; the evidence itself, `invalid` and `unverified` included, is `done`.
    [AUDIT_HISTORY_OPERATION]: (context) => {
      const args = decodeAuditHistoryArgs(context.args);
      const audit = options.audit;
      return withIdentity(async (_service, who) => {
        if (audit === undefined || drainSignal === undefined) return unavailable();
        try {
          const access = await audit.access(who);
          if (!access.ok) return { status: "refused", code: access.code };
          return done(
            await audit.history({
              cycle: args.cycle,
              project: access.project,
              role: access.role,
              signal: drainSignal,
            }),
          );
        } catch {
          return unavailable();
        }
      })(context);
    },
  };

  return {
    entry: HUMAN_CONTROL_BACKEND_ENTRY,
    activation: {
      start: async () => {
        if (options.create === undefined) return;
        drainController = new AbortController();
        drainSignal = drainController.signal;
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
        drainController?.abort();
        drainController = undefined;
        drainSignal = undefined;
        for (const end of watchers) end();
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
    watch: (listener, onEnd) => {
      const service = running;
      if (service === undefined) return undefined;
      const stop = service.onChange(listener);
      const unsubscribe = () => {
        stop();
        watchers.delete(end);
      };
      const end = () => {
        unsubscribe();
        onEnd();
      };
      watchers.add(end);
      return unsubscribe;
    },
  };
}
