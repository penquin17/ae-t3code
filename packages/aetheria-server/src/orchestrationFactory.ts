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
  openOrchestrationStore,
  reconcileChildren,
  type BootReport,
  type CallerContext,
  type ChildService,
  type ManagedIdentityWriter,
  type OrchestrationStore,
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
  /** Test seam: attempt ids. Default: random ids that M03's store accepts as attempt names. */
  readonly newAttemptId?: (() => string) | undefined;
  /** Test seam: the Pi session id of a new child. Default: a random UUID, a shape Pi's `--session-id` and M03's store both accept. */
  readonly newSessionId?: (() => string) | undefined;
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
  "children.fork",
  "children.message",
  "children.list",
  "children.interrupt",
  "children.close",
  "children.await-report",
  "children.cancel",
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
      let identity: ManagedIdentityWriter;
      try {
        identity = createChildIdentityWriter(
          createIdentityStore({ stateRoot: deps.stateRoot, writer: CHILD_WRITER }),
        );
      } catch (error) {
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
        clock: { now: deps.now },
        authorizer: deps.spawnAuthorizer,
        availability: null,
        newAttemptId,
        newSessionId,
      });
      state = { store, identity, children, watchers };
      try {
        const report = await reconcileChildren({
          threads,
          lineage: lineageWithRouteGuard(store),
          store,
          identity,
        });
        options.onBoot?.(report);
        for (const thread of bootThreads)
          if (thread.relationshipToParent === "subagent") watchRoot(state, thread.rootThreadId);
      } catch (error) {
        for (const watcher of watchers.values()) watcher.unsubscribe();
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

    /** XC-10: is this Pi session a child of the caller's root, and what is it doing. Owned is false only when the evidence says so; otherwise unknown. */
    const status = async (
      state: Running,
      who: OrchestrationCaller,
      args: unknown,
    ): Promise<OrchestrationOutcome> => {
      const childSessionId = (args as { childSessionId?: unknown }).childSessionId;
      if (!text(childSessionId)) return unavailable("no child session was named");
      const done = (owned: boolean | "unknown", childState: string): OrchestrationOutcome => ({
        ok: true,
        value: { owned, state: childState },
      });
      const read = state.identity.read(childSessionId);
      if (read.state === "absent") return done(false, "unknown");
      if (read.state === "retired") return done(false, "closed");
      if (read.state !== "active") return done("unknown", "unknown");
      const record = read.record as { kind?: unknown; rootSessionId?: unknown } | undefined;
      if (record?.kind !== "child" || !text(record.rootSessionId)) return done(false, "unknown");
      if (record.rootSessionId !== who.rootSessionId) return done(false, "unknown");
      const threadId = deps.threadOfSession(childSessionId);
      if (threadId === undefined) return done(true, "unknown");
      const route = state.store.readChild(threadId);
      if (route.status === "ok" && route.record.closed) return done(true, "closed");
      if (route.status !== "ok") return done(true, "unknown");
      try {
        const answer = await deps.threads.status({ threadId });
        if (!answer.ok) return done(true, "unknown");
        return done(true, answer.status.activity);
      } catch {
        return done(true, "unknown");
      }
    };

    const handle: OrchestrationService["handle"] = (operation, who, args, handleOptions) => {
      const state = running;
      if (draining || state === undefined)
        return Promise.resolve(unavailable("the orchestration service is not running"));
      if (NOT_BUILT.has(operation))
        return Promise.resolve(unavailable(`${operation} is not built yet (Plan steps 10 to 20)`));
      attempts += 1;
      const ticket = attempts;
      const work = (async (): Promise<OrchestrationOutcome> => {
        try {
          return operation === "children.spawn"
            ? await spawn(state, who, args, handleOptions?.signal)
            : await status(state, who, args);
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
        state.store.close();
      }
      return { stopped: [], stillLive };
    };

    return { start, handle, drain };
  };
}
