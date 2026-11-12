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
  createJobLifecycle,
  createJobOutput,
  createJobRegistry,
  createJobWakes,
  jobLostKey,
  nodeHostProcessPort,
  nodeJobOutputPort,
  nodeStoreDeps,
  openJobsStore,
  orchestrationParameter,
  openOrchestrationStore,
  reconcileChildren,
  reconcileForkRollbacks,
  retireRolledBackMain,
  type BootReport,
  type HostProcessPort,
  type JobLifecycle,
  type JobOutput,
  type JobsStore,
  type JobWakes,
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
  /** Test seam: the host the job lifecycle checks an attach against. Default: the Node-backed port over M09's process-group primitives and the state root's run folders. */
  readonly hostProcess?: HostProcessPort | undefined;
  /** Test seam: the delay in which completion notices for one owner coalesce into one message. Default 50 ms. */
  readonly wakeCoalesceMs?: number | undefined;
  /** Test seam: the id of each new job. Default: `job-<uuid>`. */
  readonly newJobId?: (() => string) | undefined;
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
const lostJobText = (job: {
  readonly jobId: string;
  readonly label: string | null;
  readonly pid: number | null;
  readonly pgid: number | null;
  readonly lost: {
    readonly livenessIndeterminate: boolean;
    readonly terminationUnconfirmed: boolean;
  } | null;
}): string => {
  const name = job.label === null ? job.jobId : `${job.label} (${job.jobId})`;
  const identity = `pid ${String(job.pid)}, process group ${String(job.pgid)}`;
  const reason =
    job.lost?.livenessIndeterminate === true
      ? `may still be running: M05 could not verify ${identity}, so it sent no signal`
      : job.lost?.terminationUnconfirmed === true
        ? `may still be running: TERM/grace/KILL did not prove ${identity} empty; boot will retry`
        : "was marked lost; no process exit was observed";
  return `Background job ${name} ${reason}. Its output is retained; read it with the job tools.`;
};

/** Operations whose service logic is not built in this slice. They answer unavailable; the module maps that onto the XC-6 `unavailable` reply. */
const NOT_BUILT: ReadonlySet<OrchestrationOperation> = new Set<OrchestrationOperation>([]);

interface Running {
  readonly store: OrchestrationStore;
  readonly jobs: JobsStore;
  readonly lifecycle: JobLifecycle;
  readonly output: JobOutput;
  readonly wakes: JobWakes;
  readonly identity: ManagedIdentityWriter;
  readonly children: ChildService;
  readonly watchers: Map<string, { unsubscribe(): void }>;
  readonly notifyLost: (jobId: string, boot: boolean) => Promise<void>;
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
        // The outbox derives a message id from its keys and T3's command id derives from that id. childThreadPort.aetheria.test.ts proves against T3's real services that a repeated id
        // (same or other mode, fresh adapter) changes nothing: one message, one run, one provider turn. So an unsettled attempt may be retried blind under the same id.
        sha256Hex: nodeStoreDeps().sha256Hex,
        inboxDedupEstablished: true,
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
        killJobs: async (ownerSessionId) => {
          if (state === undefined) throw new Error("job lifecycle is not running");
          const killed = await state.lifecycle.killOwner(ownerSessionId);
          for (const jobId of killed) await state.notifyLost(jobId, false);
          return killed;
        },
      });
      // Step 16: the lifecycle facts the Agent's runner reports. The registry is the only writer of the job records; the host port only reads and probes.
      const registry = createJobRegistry({
        store: jobs,
        now: deps.now,
        newJobId: options.newJobId ?? (() => `job-${NodeCrypto.randomUUID()}`),
      });
      const lifecycle = createJobLifecycle({
        registry,
        host: options.hostProcess ?? nodeHostProcessPort({ stateRoot: deps.stateRoot }),
        now: deps.now,
      });
      // Step 17: completion wakes are bounded and coalesced. The outbox is the service's (it holds the notices in the job, child and main records); the cap is the carried parameter, the
      // resume barrier is M06's, and a human message is read as a change of the newest user-created message on the owner's thread.
      const outbox = children.outbox;
      if (outbox === undefined) {
        jobs.close();
        store.close();
        return {
          ok: false,
          code: "OUTBOX_UNAVAILABLE",
          detail: "the child service built no outbox",
        };
      }
      const notifyLost = async (jobId: string, boot: boolean): Promise<void> => {
        const found = jobs.readJob(jobId);
        if (found.status !== "ok" || found.record.state !== "lost" || found.record.lost === null)
          return;
        const job = found.record;
        const key = jobLostKey(job.jobId);
        const owner = { kind: "job", jobId: job.jobId } as const;
        const existing = job.outbox.find((entry) => entry.key === key);
        if (boot) {
          const threadId = deps.threadOfSession(job.ownerSessionId);
          if (threadId === undefined) {
            if (existing === undefined)
              outbox.enqueue(owner, {
                key,
                targetSessionId: job.ownerSessionId,
                kind: "job-lost",
                volatile: false,
                text: lostJobText(job),
              });
            return;
          }
          let notes: Awaited<ReturnType<ChildThreadPort["readRestartNotes"]>>;
          try {
            notes = await threads.readRestartNotes({ threadId });
          } catch {
            notes = { ok: false, reason: "unavailable" };
          }
          if (!notes.ok) {
            if (existing === undefined)
              outbox.enqueue(owner, {
                key,
                targetSessionId: job.ownerSessionId,
                kind: "job-lost",
                volatile: false,
                text: lostJobText(job),
              });
            return;
          }
          const sameShell =
            job.label !== null &&
            notes.notes.some(
              (note) => note.kind === "shell" && note.id === job.runKey && note.label === job.label,
            );
          if (sameShell) {
            if (existing?.state === "pending" && existing.batchId === null)
              await outbox.withdraw(owner, [key]);
            return;
          }
        }
        if (existing === undefined) {
          const made = outbox.enqueue(owner, {
            key,
            targetSessionId: job.ownerSessionId,
            kind: "job-lost",
            volatile: false,
            text: lostJobText(job),
          });
          if (!made.ok) return;
        }
        try {
          await deps.resume.resumed(job.ownerSessionId);
        } catch {
          return;
        }
        await outbox.deliver(owner, [key]);
      };
      const wakes = createJobWakes({
        outbox,
        wakeCap: () => orchestrationParameter("maxConsecutiveWakes"),
        now: deps.now,
        coalesceMs: options.wakeCoalesceMs ?? 50,
        beforeDeliver: (sessionId) => deps.resume.resumed(sessionId),
        humanMessageId: async (sessionId) => {
          const threadId = deps.threadOfSession(sessionId);
          if (threadId === undefined || deps.threads.readLastHumanMessage === undefined)
            return null;
          const read = await deps.threads.readLastHumanMessage({ threadId });
          return read.ok ? read.messageId : null;
        },
      });
      // A notice queued for an owner (an adopted job's exit) schedules its one coalesced delivery.
      registry.onChange((job) => {
        for (const entry of job.outbox)
          if (
            entry.kind === "job-completion" &&
            entry.state === "pending" &&
            entry.batchId === null
          )
            wakes.noticed(entry.targetSessionId);
      });
      const output = createJobOutput({
        registry,
        port: nodeJobOutputPort({ stateRoot: deps.stateRoot }),
        outbox,
        isDescendant: (ancestor, owner) => {
          const read = identity.read(owner);
          const record =
            read.state === "active"
              ? (read.record as { kind?: unknown; parentChain?: unknown } | undefined)
              : undefined;
          return (
            record?.kind === "child" &&
            Array.isArray(record.parentChain) &&
            record.parentChain.includes(ancestor)
          );
        },
        waitDefaultMs: () => orchestrationParameter("waitDefaultMs"),
        waitCapMs: () => orchestrationParameter("waitCapMs"),
      });
      state = { store, jobs, lifecycle, output, wakes, identity, children, watchers, notifyLost };
      try {
        const report = await reconcileChildren({
          threads,
          lineage: lineageWithRouteGuard(store),
          store,
          identity,
        });
        // `m05-stray-main`: once per boot, M03's own narrow API retires the stray `main` identity of a rolled-back fork (only on M05's tombstone and T3's closed, idle fork thread); then the stale
        // `orchestration/main` records go. A thing boot cannot prove stays and is named in the report, never retried blindly.
        const forkRollback = await reconcileForkRollbacks({
          threads,
          lineage: lineageWithRouteGuard(store),
          store,
          stateRoot: deps.stateRoot,
          identityApi: { retireRolledBackMain },
        });
        report.problems.push(
          ...forkRollback.problems,
          ...forkRollback.unknown.map(
            (held) => `fork rollback ${held.threadId} retained: ${held.why}`,
          ),
        );
        const jobReport = await lifecycle.reconcileBoot();
        if (jobReport.unreadable > 0 || jobReport.problems.length > 0)
          throw new Error(
            `job boot reconciliation is incomplete (${jobReport.unreadable} unreadable, ${jobReport.problems.length} problem(s))`,
          );
        // A job this boot just reconciled gets its one notice (stable key, so a retried boot repeats nothing). A job lost at an earlier boot is offered again only while its notice is still
        // undelivered: a notice M05 suppressed because T3 already tells the owner leaves no entry, and must not be rebuilt once T3's note is gone.
        const reconciledNow = new Set(jobReport.reconciled);
        for (const job of jobReport.lostJobs) {
          const key = jobLostKey(job.jobId);
          const undelivered = job.outbox.some(
            (entry) =>
              entry.key === key && (entry.state === "pending" || entry.state === "attempting"),
          );
          if (reconciledNow.has(job.jobId) || undelivered) await notifyLost(job.jobId, true);
        }
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
        // Step 17: completions a restart left pending (past the cap, or an owner that was absent) are offered again; a bounded, coalesced delivery per owner.
        const waiting = jobs.listJobs();
        if (waiting.ok)
          for (const job of waiting.records)
            for (const entry of job.outbox)
              if (
                entry.kind === "job-completion" &&
                entry.state !== "inserted" &&
                entry.state !== "abandoned"
              )
                wakes.noticed(entry.targetSessionId);
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

    /** Step 16: the four lifecycle facts. The caller is the carrier's (session and root), never an argument; the arguments were decoded strictly by the module. */
    /** Step 17: output, list and the scoped cancel of a wait. The caller is the carrier's; a wait ends on the module's signal (drain) as well as the caller's own cancel. */
    const outputOperation = async (
      state: Running,
      operation: "jobs.output" | "jobs.list" | "jobs.cancel",
      who: OrchestrationCaller,
      args: unknown,
      signal: AbortSignal | undefined,
    ): Promise<OrchestrationOutcome> => {
      const caller = { sessionId: who.sessionId, rootSessionId: who.rootSessionId };
      switch (operation) {
        case "jobs.output":
          return (await state.output.output(caller, args as never, signal)) as OrchestrationOutcome;
        case "jobs.list":
          return (await state.output.list(caller, args as never)) as OrchestrationOutcome;
        case "jobs.cancel":
          return (await state.output.cancel(caller, args as never)) as OrchestrationOutcome;
      }
    };

    const lifecycle = async (
      state: Running,
      operation: "jobs.reserve" | "jobs.attach" | "jobs.adopted" | "jobs.exited" | "jobs.kill",
      who: OrchestrationCaller,
      args: unknown,
    ): Promise<OrchestrationOutcome> => {
      const caller = { sessionId: who.sessionId, rootSessionId: who.rootSessionId };
      switch (operation) {
        case "jobs.reserve":
          return (await state.lifecycle.reserve(caller, args as never)) as OrchestrationOutcome;
        case "jobs.attach":
          return (await state.lifecycle.attach(caller, args as never)) as OrchestrationOutcome;
        case "jobs.adopted":
          return (await state.lifecycle.adopted(caller, args as never)) as OrchestrationOutcome;
        case "jobs.exited":
          return (await state.lifecycle.exited(caller, args as never)) as OrchestrationOutcome;
        case "jobs.kill": {
          const result = await state.lifecycle.kill(caller, args as never);
          if (result.ok && result.value.state === "lost")
            await state.notifyLost(result.value.jobId, false);
          return result as OrchestrationOutcome;
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
          if (
            operation === "jobs.output" ||
            operation === "jobs.list" ||
            operation === "jobs.cancel"
          )
            return await outputOperation(state, operation, who, args, handleOptions?.signal);
          if (
            operation === "jobs.reserve" ||
            operation === "jobs.attach" ||
            operation === "jobs.adopted" ||
            operation === "jobs.exited" ||
            operation === "jobs.kill"
          )
            return await lifecycle(state, operation, who, args);
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
        await state.wakes.drain();
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
