// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M05 Plan step 9 (C2, C10): the join from the Backend's seams to the archive's children service. It is the `orchestrationFactory` the Backend calls
// inside the module's start (after the owner lock): it opens the orchestration store, builds M03's identity store with the writer `managed-work`, builds
// the real children service, reconciles what a crash left, and answers the operations that are built.
//
//  - `children.spawn` runs `spawnChild`; `children.status` answers the XC-10 question. Every other operation answers ORCHESTRATION_UNAVAILABLE
//    (steps 10 to 20 build them): never a made-up success.
//  - The caller is the carrier-verified session id and nothing else. The thread, working folder and active run and node come from the injected
//    `callerContext` port (T3's projections and M04's index); an argument can name none of them.
//  - Boot: a thread the index has not re-ingested yet reads as "no session bound". When the route state holds a record for that thread, a session WAS bound
//    (the record is written only after activation), so the thread is reported as unknown rather than closed: lag in the index must never close an accepted child.
import * as NodeCrypto from "node:crypto";

import type {
  ChildLineageReader,
  ChildLineageThread,
  ChildThreadPort,
} from "./orchestrationPorts.ts";
import type {
  OrchestrationCaller,
  OrchestrationOperation,
  OrchestrationOutcome,
  OrchestrationService,
  OrchestrationServiceDeps,
  OrchestrationServiceFactory,
} from "./orchestration.ts";
import {
  CHILD_WRITER,
  createChildIdentityWriter,
  createChildService,
  createIdentityStore,
  nodeStoreDeps,
  openJobsStore,
  openOrchestrationStore,
  reconcileChildren,
  type BootReport,
  type JobsStore,
  type CallerContext,
  type ChildService,
  type ManagedIdentityWriter,
  type OrchestrationStore,
  type RestartReport,
} from "./library.ts";

const ORCHESTRATION_UNAVAILABLE = "ORCHESTRATION_UNAVAILABLE";
/** How long a drain waits for spawns already in flight before it reports them as possibly still live. */
const DRAIN_WAIT_MS = 5000;

export type CallerContextResult =
  | {
      readonly ok: true;
      readonly threadId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly workingFolder: string;
    }
  | { readonly ok: false; readonly detail: string };

/**
 * The caller's thread, working folder and ACTIVE run and node, from T3 and M04's index. Unknown, ambiguous or missing is `ok: false`, never a guess:
 * the children service is not called with a partial caller.
 */
export type CallerContextPort = (sessionId: string) => Promise<CallerContextResult>;

export interface OrchestrationFactoryOptions {
  readonly callerContext: CallerContextPort;
  /** Told what boot reconciliation did (and that it could not read lineage, if so). Never required for the service to run. */
  readonly onBoot?: ((report: BootReport) => void) | undefined;
  /**
   * Told what restart reconciliation did (step 13): which children's runs the restart cut and how each notice stands. Never required for the service to run.
   */
  readonly onRestart?: ((report: RestartReport) => void) | undefined;
  /**
   * The restart-notice delivery seam: the outbox of step 15. Absent until step 15 is integrated, so every notice stays pending under its key and the next boot retries it.
   */
  readonly notifyRestart?:
    | ((notice: {
        readonly key: string;
        readonly childThreadId: string;
        readonly parentThreadId: string;
        readonly text: string;
      }) => Promise<{ readonly ok: boolean }>)
    | undefined;
  /** Test seam: attempt ids. Default: random ids that M03's store accepts as attempt names. */
  readonly newAttemptId?: (() => string) | undefined;
  /** Test seam: the Pi session id of a new child. Default: a random UUID, a shape Pi's `--session-id` and M03's store both accept. */
  readonly newSessionId?: (() => string) | undefined;
  /** Test seam: the id of each message a control operation sends. Default: random. */
  readonly newMessageId?: (() => string) | undefined;
  /** Test seam: the T3 thread id of each fork's copy. Default: random. */
  readonly newThreadId?: (() => string) | undefined;
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const unavailable = (detail: string): OrchestrationOutcome => ({
  ok: false,
  code: ORCHESTRATION_UNAVAILABLE,
  detail,
});
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Operations whose service logic is not built in this slice. They answer unavailable; the module maps that onto the XC-6 `unavailable` reply. */
const NOT_BUILT: ReadonlySet<OrchestrationOperation> = new Set<OrchestrationOperation>([
  "jobs.output",
  "jobs.list",
  "jobs.kill",
  "jobs.cancel",
  "jobs.reserve",
  "jobs.attach",
  "jobs.adopted",
  "jobs.exited",
]);

interface Running {
  readonly store: OrchestrationStore;
  readonly jobs: JobsStore;
  readonly identity: ManagedIdentityWriter;
  readonly children: ChildService;
  readonly watchers: Map<string, { unsubscribe(): void }>;
}

export function createOrchestrationFactory(
  options: OrchestrationFactoryOptions,
): OrchestrationServiceFactory {
  return (deps: OrchestrationServiceDeps): OrchestrationService => {
    let running: Running | undefined;
    let draining = false;
    let attempts = 0;
    const inflight = new Map<number, Promise<unknown>>();
    /** The last lineage listing boot read, to subscribe the roots of the children it found. */
    let bootThreads: readonly ChildLineageThread[] = [];

    const newAttemptId = options.newAttemptId ?? (() => `attempt-${NodeCrypto.randomUUID()}`);
    const newSessionId = options.newSessionId ?? (() => NodeCrypto.randomUUID());
    const newMessageId = options.newMessageId ?? (() => `m05-message-${NodeCrypto.randomUUID()}`);
    const newThreadId =
      options.newThreadId ?? (() => `thread:aetheria-fork:${NodeCrypto.randomUUID()}`);

    const watchRoot = (state: Running, rootThreadId: string): void => {
      if (state.watchers.has(rootThreadId)) return;
      state.watchers.set(rootThreadId, state.children.watch(rootThreadId));
    };

    /** The ThreadPort as the service sees it: the same port, plus a settle subscription on the root of every child it creates. */
    const watchedThreads = (state: () => Running | undefined): ChildThreadPort => ({
      ...deps.threads,
      createChildThread: async (input) => {
        const created = await deps.threads.createChildThread(input);
        const current = state();
        if (created.ok && current !== undefined) watchRoot(current, created.lineage.rootThreadId);
        return created;
      },
      // A fork's runs settle through the same watch. Only a depth-0 session can fork (M03: `subagent_fork` is generic delegation), so its thread is the root.
      forkThread: async (input) => {
        const forked = await deps.threads.forkThread(input);
        const current = state();
        if (forked.ok && current !== undefined) watchRoot(current, input.parentThreadId);
        return forked;
      },
    });

    const lineageWithRouteGuard = (store: OrchestrationStore): ChildLineageReader => ({
      listChildThreads: async () => {
        const listing = await deps.lineage.listChildThreads();
        if (!listing.ok) return listing;
        bootThreads = listing.threads;
        return {
          ok: true as const,
          threads: listing.threads.map((thread) =>
            thread.sessionId === null && store.readChild(thread.threadId).status !== "absent"
              ? { ...thread, sessionId: "unknown" as const }
              : thread,
          ),
        };
      },
    });

    const start = async (): ReturnType<OrchestrationService["start"]> => {
      if (running !== undefined) return { ok: true };
      const opened = openOrchestrationStore(nodeStoreDeps(), { stateRoot: deps.stateRoot });
      if (!opened.ok) return { ok: false, code: opened.code, detail: opened.reason };
      const { store } = opened;
      // The job store (C9, step 15): the same refusal rules as the orchestration store. It holds the jobs' records and their embedded outbox entries; it is opened here so the outbox can
      // deliver a job's notice, and the `jobs.*` operations stay unavailable until step 16 builds them.
      const jobsOpened = openJobsStore(nodeStoreDeps(), { stateRoot: deps.stateRoot });
      if (!jobsOpened.ok) {
        store.close();
        return { ok: false, code: jobsOpened.code, detail: jobsOpened.reason };
      }
      const jobs = jobsOpened.store;
      let identity: ManagedIdentityWriter;
      try {
        identity = createChildIdentityWriter(
          createIdentityStore({ stateRoot: deps.stateRoot, writer: CHILD_WRITER }),
        );
      } catch (error) {
        jobs.close();
        store.close();
        return { ok: false, code: "IDENTITY_STORE_UNAVAILABLE", detail: message(error) };
      }
      const watchers = new Map<string, { unsubscribe(): void }>();
      let state: Running | undefined;
      const threads = watchedThreads(() => state);
      const children = createChildService({
        threads,
        identity,
        planMode: deps.planMode,
        store,
        jobs,
        // The outbox derives a message id from its keys. T3's command id derives from that id, but the adapter has no test of the replay against T3's real services yet, so an unsettled
        // attempt is not retried blind: it waits for a receipt (see the outbox) and stays `delivery-uncertain` until then.
        sha256Hex: nodeStoreDeps().sha256Hex,
        inboxDedupEstablished: false,
        clock: { now: deps.now },
        authorizer: deps.spawnAuthorizer,
        availability: null,
        newAttemptId,
        newSessionId,
        sessionOfThread: deps.sessionOfThread,
        threadOfSession: deps.threadOfSession,
        lineage: deps.lineage,
        newMessageId,
        newThreadId,
      });
      state = { store, jobs, identity, children, watchers };
      try {
        const report = await reconcileChildren({
          threads,
          lineage: lineageWithRouteGuard(store),
          store,
          identity,
        });
        options.onBoot?.(report);
        // Step 15: a volatile outbox entry that never became final is dropped before anything is delivered.
        children.reconcileOutbox();
        // Step 13: a child T3 cut at the restart becomes idle (interrupted, backend-restarted) and its parent is told once. Boot's own pre-acceptance cleanup ran first. The delivery
        // seam is the outbox (step 15): the notice is an entry of the child under child:<id>:restart:<bootEpoch>, repeat-safe.
        const restarted = await children.reconcileRestarts({
          bootEpoch: deps.now(),
          afterResume: (sessionId) => deps.resume.resumed(sessionId),
          notify: options.notifyRestart ?? children.restartNotify,
        });
        options.onRestart?.(restarted);
        for (const thread of bootThreads)
          if (thread.relationshipToParent === "subagent" || thread.relationshipToParent === "fork")
            watchRoot(state, thread.rootThreadId);
      } catch (error) {
        for (const watcher of watchers.values()) watcher.unsubscribe();
        jobs.close();
        store.close();
        return { ok: false, code: "BOOT_RECONCILIATION_FAILED", detail: message(error) };
      }
      running = state;
      return { ok: true };
    };

    const callerOf = async (
      who: OrchestrationCaller,
    ): Promise<
      | { readonly ok: true; readonly caller: CallerContext }
      | { readonly ok: false; readonly outcome: OrchestrationOutcome }
    > => {
      let found: CallerContextResult;
      try {
        found = await options.callerContext(who.sessionId);
      } catch (error) {
        return {
          ok: false,
          outcome: unavailable(`the caller's context could not be read: ${message(error)}`),
        };
      }
      if (!found.ok) return { ok: false, outcome: unavailable(found.detail) };
      return {
        ok: true,
        caller: {
          sessionId: who.sessionId,
          threadId: found.threadId,
          runId: found.runId,
          nodeId: found.nodeId,
          workingFolder: found.workingFolder,
        },
      };
    };

    const spawn = async (
      state: Running,
      who: OrchestrationCaller,
      args: unknown,
      signal: AbortSignal | undefined,
    ): Promise<OrchestrationOutcome> => {
      const caller = await callerOf(who);
      if (!caller.ok) return caller.outcome;
      const result = await state.children.spawnChild({
        caller: caller.caller,
        args: args as Parameters<ChildService["spawnChild"]>[0]["args"],
        signal,
      });
      return result as OrchestrationOutcome;
    };

    /**
     * Step 11: a native fork. The caller is the carrier's session with the trusted T3 context of its thread (never an argument); the allow-list was decoded strictly and the authorizer
     * (M03's verdict, M05's rule) decides what it may hold. The user's own authority and the caller's depth are the authorizer's: a delegated session cannot reach `subagent_fork`.
     */
    const fork = async (
      state: Running,
      who: OrchestrationCaller,
      args: unknown,
      signal: AbortSignal | undefined,
    ): Promise<OrchestrationOutcome> => {
      const caller = await callerOf(who);
      if (!caller.ok) return caller.outcome;
      const result = await state.children.forkChild({
        caller: caller.caller,
        args: args as Parameters<ChildService["forkChild"]>[0]["args"],
        signal,
      });
      return result as OrchestrationOutcome;
    };

    /**
     * The control operations (step 10) run in the archive's service, decided from M03's records and T3's lineage and status. The caller is the carrier's session and root
     * and nothing else; the arguments were decoded strictly by the module and name neither.
     */
    const control = async (
      state: Running,
      operation:
        | "children.message"
        | "children.list"
        | "children.interrupt"
        | "children.close"
        | "children.await-report"
        | "children.cancel"
        | "children.status",
      who: OrchestrationCaller,
      args: unknown,
      signal: AbortSignal | undefined,
    ): Promise<OrchestrationOutcome> => {
      const caller = { sessionId: who.sessionId, rootSessionId: who.rootSessionId };
      switch (operation) {
        case "children.await-report":
          // Event-driven and bounded in the service; the module's signal (drain) and `children.cancel` by request id end it. The caller is the carrier's.
          return (await state.children.awaitReport({
            caller,
            args: args as { target: string; requestId?: string },
            signal,
          })) as OrchestrationOutcome;
        case "children.cancel":
          return (await state.children.cancelWait({
            caller,
            args: args as { requestId: string },
          })) as OrchestrationOutcome;
        case "children.message":
          return (await state.children.messageChild({
            caller,
            args: args as { target: string; content: string },
          })) as OrchestrationOutcome;
        case "children.list":
          return (await state.children.listChildren({
            caller,
            args: args as { scope: "children" | "descendants" },
          })) as OrchestrationOutcome;
        case "children.close":
          // An exact ancestor only: the user's own close is a direct Backend call (M10), never this XC-6 operation.
          return (await state.children.closeChild({
            caller,
            args: args as { target: string },
          })) as OrchestrationOutcome;
        case "children.interrupt":
          return (await state.children.interruptChild({
            caller,
            args: args as { target: string },
          })) as OrchestrationOutcome;
        case "children.status": {
          // XC-10: asked about a child's Pi session id; the root is the carrier's.
          const childSessionId = (args as { childSessionId?: unknown }).childSessionId;
          if (!text(childSessionId)) return unavailable("no child session was named");
          return (await state.children.childStatus({
            rootSessionId: who.rootSessionId,
            childSessionId,
          })) as OrchestrationOutcome;
        }
      }
    };

    const handle: OrchestrationService["handle"] = (operation, who, args, handleOptions) => {
      const state = running;
      if (draining || state === undefined)
        return Promise.resolve(unavailable("the orchestration service is not running"));
      if (NOT_BUILT.has(operation))
        return Promise.resolve(unavailable(`${operation} is not built yet (Plan steps 11 to 20)`));
      attempts += 1;
      const ticket = attempts;
      const work = (async (): Promise<OrchestrationOutcome> => {
        try {
          if (operation === "children.fork")
            return await fork(state, who, args, handleOptions?.signal);
          return operation === "children.spawn"
            ? await spawn(state, who, args, handleOptions?.signal)
            : await control(
                state,
                operation as Parameters<typeof control>[1],
                who,
                args,
                handleOptions?.signal,
              );
        } catch (error) {
          return unavailable(`${operation} failed: ${message(error)}`);
        }
      })();
      inflight.set(ticket, work);
      const forget = () => void inflight.delete(ticket);
      void work.then(forget, forget);
      return work;
    };

    const drain: OrchestrationService["drain"] = async () => {
      draining = true;
      const state = running;
      running = undefined;
      const pending = [...inflight.entries()];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), DRAIN_WAIT_MS);
        (timer as { unref?: () => void }).unref?.();
      });
      const settled = await Promise.race([
        Promise.allSettled(pending.map(([, work]) => work)).then(() => "settled" as const),
        timeout,
      ]);
      clearTimeout(timer);
      const stillLive =
        settled === "timeout" ? pending.map(([ticket]) => `operation-${ticket}`) : [];
      if (state !== undefined) {
        for (const watcher of state.watchers.values()) {
          try {
            watcher.unsubscribe();
          } catch {
            // An unsubscribe that throws leaves nothing live that this service started.
          }
        }
        state.watchers.clear();
        state.jobs.close();
        state.store.close();
      }
      return { stopped: [], stillLive };
    };

    // The direct API for trusted Backend modules (step 14): the running archive service, nothing wrapped, nothing registered as an XC-6 operation.
    const direct: OrchestrationService["direct"] = () => (draining ? undefined : running?.children);

    return { start, handle, drain, direct };
  };
}
