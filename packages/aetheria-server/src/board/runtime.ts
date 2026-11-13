// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA — the Backend's board runtime (design D9–D12; Plan step 20): one board service per workspace, the caller taken from the bearer's
// identity and the thread binding, liveness read only from this Backend's own run, and the XC-6 operations that use them (M09 step 17 adds
// `board.record-shell`, a shell change shown to peers as not guarded).
// Evidence from before this Backend started is unknown: an observation counts only if its producing event is newer than the replay horizon.
// Unreadable board or liveness is `unavailable`; `assign` asks the owned-child status of XC-10 (M05, `orchestrationChildStatus.ts`) and answers unavailable naming XC-10 when that cannot be read.
// M06 step 26: `resolve` decides on the interaction service's `questionEvidence` (XC-8), called in process with the root, the cited call id and the
// caller as asker; an absent, stopped or unreadable provider is unavailable naming XC-8, and advice that points at `resolve` is told only with a provider.
// Step 22: when liveness reports a bound main session stopped or crashed, its board session is closed by the one close policy (`reconcileBoard`
// with that session as the only one without live evidence): markers only for files still changed, unknown Git defers. The drain stops the
// listener, waits for the operations in flight, closes every session still open (a clean teardown), and reports what it could not close as still live.
import * as NodeCrypto from "node:crypto";

import {
  AWARENESS_ACTION_OPERATION,
  AWARENESS_LIVENESS_UNAVAILABLE_CODE,
  AWARENESS_SUMMARY_OPERATION,
  AWARENESS_UNAVAILABLE_CODE,
  BOARD_CHECK_WRITE_OPERATION,
  BOARD_RECORD_EDIT_OPERATION,
  BOARD_RECORD_SHELL_OPERATION,
  decodeBoardRecordEditArgs,
  decodeBoardRecordShellArgs,
  decodeBoardWriteArgs,
  XC10_CHILD_STATUS_UNAVAILABLE_CODE,
  XC8_DECISION_EVIDENCE_UNAVAILABLE_CODE,
  type Xc6Operation,
  type Xc6OperationContext,
  type Xc6Settled,
} from "@t3tools/aetheria-contracts";

import type { ThreadIndex } from "../identity/threadIndex.ts";
import {
  awarenessAction,
  checkWrite,
  createBoardService,
  createDecisionEvidence,
  createFileBoardStorage,
  createRecordedCalls,
  createViewMemory,
  evidenceFromObservation,
  nodePathFs,
  reconcileBoard,
  recordEdit,
  recordShell,
  resolveWorkspace,
  summarize,
  type ActionCaller,
  type AwarenessConfig,
  type BoardService,
  type ChildStatus,
  type HolderObservation,
  type ReconcileResult,
  type SessionEvidence,
} from "../library.ts";
import type { LivenessObservation, LivenessService } from "../liveness/service.ts";
import type { GitPort } from "./git.ts";

/** XC-8 as `resolve` calls it (the archive's `ActionPorts.questionEvidence`): in process, never an XC-6 round trip. */
export type QuestionEvidenceProvider = NonNullable<
  Parameters<typeof awarenessAction>[2]["questionEvidence"]
>;

export interface BoardRuntimeOptions {
  readonly stateRoot: string;
  readonly index: Pick<ThreadIndex, "bindingOfSession" | "sessions" | "lookup">;
  readonly liveness: Pick<LivenessService, "status" | "observe">;
  /** Test seam: the storage of a workspace's board. Default: the one file adapter beneath the state root. */
  readonly storageFor?:
    | ((workspace: string) => ReturnType<typeof createFileBoardStorage>)
    | undefined;
  readonly config: AwarenessConfig;
  readonly now: () => number;
  readonly git: GitPort;
  /** The owned-child status of XC-10. The service supplies M05's production reader (`orchestrationChildStatus.ts`); absent, `assign` answers unavailable. A test supplies its own. */
  readonly childStatus?:
    | ((rootId: string, childId: string) => ChildStatus | Promise<ChildStatus>)
    | undefined;
  /**
   * The durable verified-human evidence of XC-8 (M06): the running interaction service's `questionEvidence`. Absent: `resolve` answers unavailable naming
   * XC-8 and no refusal advice points at it. Present: `resolve` is offered, and the provider answers unavailable itself while the service is not running.
   */
  readonly questionEvidence?: QuestionEvidenceProvider | undefined;
}

/**
 * What the board holds about one root's edits (M10 step 14, GAP-3). `known` is a record of the root session in the board of the root's workspace: its recorded paths, deduplicated, in the
 * board's own sorted form, an empty list being a known empty. `unknown` says nothing about the root's edits (no binding or workspace, or the board has no record of the root): never an empty list. `unavailable` is a
 * board that cannot be read, or a runtime that has drained. The paths are what the board recorded; each is judged again at the moment bytes are served.
 */
export type EditsRead =
  | {
      readonly status: "known";
      readonly paths: readonly string[];
      /** The workspace whose board holds the record: the containment root of its paths. */
      readonly workspace: string;
    }
  | { readonly status: "unknown"; readonly reason: "no-workspace" | "no-record" }
  | { readonly status: "unavailable"; readonly detail: string };

export interface BoardRuntime {
  /** The XC-6 operations: check-write, record-edit, record-shell, the awareness actions and the summary. */
  operations(): Readonly<Record<string, Xc6Operation>>;
  /** The edit paths recorded for one root session, read in process and never written (M10 step 14). Never throws. */
  editsOf(rootSessionId: string): Promise<EditsRead>;
  /** The highest event sequence that existed before this Backend subscribed; only newer liveness events count as evidence. */
  setReplayHorizon(sequence: number): void;
  /** Reconcile the board of every workspace a bound session works in. Never throws; the results are kept. */
  reconcileAtStart(): Promise<void>;
  reconciled(): readonly { readonly workspace: string; readonly result: ReconcileResult }[];
  /** Resolves when every close-on-stop requested so far has settled. Never rejects. */
  settled(): Promise<void>;
  /**
   * Stop answering, wait for the operations in flight, close every session still open by the one close policy, stop accepting board updates.
   * A board or session it could not close is `stillLive`. Idempotent: every call returns the first result.
   */
  drain(): Promise<{ readonly released: string[]; readonly stillLive: string[] }>;
}

interface WorkspaceBoard {
  readonly workspace: string;
  readonly service: BoardService;
  reconcile: Promise<ReconcileResult> | undefined;
  last: ReconcileResult | undefined;
}

const done = (result: unknown): Xc6Settled => ({ status: "done", result });
const unavailable = (code: string): Xc6Settled => ({ status: "unavailable", code });
const REASON_CODES = {
  board: AWARENESS_UNAVAILABLE_CODE,
  liveness: AWARENESS_LIVENESS_UNAVAILABLE_CODE,
  "child-status": XC10_CHILD_STATUS_UNAVAILABLE_CODE,
  "decision-evidence": XC8_DECISION_EVIDENCE_UNAVAILABLE_CODE,
} as const;
const reasonCode = (reason: keyof typeof REASON_CODES): string => REASON_CODES[reason];

export function createBoardRuntime(options: BoardRuntimeOptions): BoardRuntime {
  const { index, liveness, now, git, config } = options;
  const boards = new Map<string, WorkspaceBoard>();
  const workspaces = new Map<string, Promise<string | undefined>>();
  const pathFs = nodePathFs({ gitTopLevel: git.topLevel });
  const decisions = createDecisionEvidence({ now });
  const memory = createViewMemory();
  const recorded = createRecordedCalls();
  let horizon: number | undefined;
  /** True from the start reconcile until the drain: only then does a stop close a session. */
  let active = false;
  let stopping = false;
  let closings: Promise<void> = Promise.resolve();
  const inflight = new Set<Promise<unknown>>();
  let drained: ReturnType<BoardRuntime["drain"]> | undefined;

  const observationOf = (sessionId: string): HolderObservation | undefined => {
    const binding = index.bindingOfSession(sessionId);
    if (binding === undefined || horizon === undefined) return undefined;
    const observation = liveness.status(binding.threadId);
    if (observation.sequence !== null && observation.sequence <= horizon) return undefined;
    return { kind: observation.kind, observedAt: observation.observedAt };
  };
  const evidenceOf = (sessionId: string): SessionEvidence =>
    index.bindingOfSession(sessionId) === undefined
      ? "unbound"
      : evidenceFromObservation(observationOf(sessionId));

  const workspaceOf = (cwd: string): Promise<string | undefined> => {
    let found = workspaces.get(cwd);
    if (found === undefined) {
      found = resolveWorkspace(pathFs, cwd);
      workspaces.set(cwd, found);
    }
    return found;
  };

  const boardFor = async (workspace: string): Promise<WorkspaceBoard> => {
    let board = boards.get(workspace);
    if (board === undefined) {
      const storage =
        options.storageFor?.(workspace) ??
        createFileBoardStorage({ stateRoot: options.stateRoot, workspace });
      await storage.recoverInterrupted().catch(() => []);
      board = {
        workspace,
        service: createBoardService({ storage }),
        reconcile: undefined,
        last: undefined,
      };
      boards.set(workspace, board);
    }
    return board;
  };

  /** Reconcile once per workspace before its first answer; a board that could not be reconciled is tried again next time. */
  const reconcileOnce = (board: WorkspaceBoard): Promise<ReconcileResult> => {
    board.reconcile ??= reconcileBoard({
      service: board.service,
      workspace: board.workspace,
      changedFiles: git,
      evidenceOf,
      now,
    }).then((result) => {
      board.last = result;
      if (result.status === "unavailable") board.reconcile = undefined;
      return result;
    });
    return board.reconcile;
  };

  /** The caller and its board, from the verified identity and the thread binding — never from an argument. */
  const open = async (context: Xc6OperationContext) => {
    const binding = index.bindingOfSession(context.sessionId);
    const workspace = binding === undefined ? undefined : await workspaceOf(binding.workingFolder);
    if (binding === undefined || workspace === undefined) return undefined;
    const board = await boardFor(workspace);
    await reconcileOnce(board).catch(() => undefined);
    const caller: ActionCaller = {
      sessionId: context.sessionId,
      kind: context.kind === "main" ? "main" : "child",
      rootId: context.rootSessionId,
      workspace,
      cwd: binding.workingFolder,
    };
    return { caller, board };
  };

  const ports = (board: WorkspaceBoard) => ({
    service: board.service,
    decisions,
    memory,
    recorded,
    pathFs,
    observationOf,
    now,
    idleMs: config.idleMs,
    summaryMaxBytes: config.summaryMaxBytes,
    newId: () => NodeCrypto.randomUUID(),
    childStatus: options.childStatus,
    questionEvidence: options.questionEvidence,
    // Advice names `resolve` only where a provider can answer it (one word from one place: no provider, no pointer).
    resolveAvailable: options.questionEvidence !== undefined,
  });

  /** A bound main session's stop or crash closes its board session; every other session keeps the evidence it has. */
  const closeEnded = async (observation: LivenessObservation): Promise<void> => {
    if (observation.kind !== "stopped" && observation.kind !== "crash") return;
    const looked = index.lookup(observation.threadId);
    if (looked.status !== "ok" || looked.binding.subagent === true) return;
    const { sessionId, workingFolder } = looked.binding;
    const workspace = await workspaceOf(workingFolder);
    if (workspace === undefined) return;
    const board = await boardFor(workspace);
    await reconcileOnce(board);
    await reconcileBoard({
      service: board.service,
      workspace,
      changedFiles: git,
      evidenceOf: (id) =>
        id === sessionId ? (observation.kind === "stopped" ? "stopped" : "crashed") : "live",
      now,
    });
  };
  /** Closings run one at a time; a failure of one (an unreadable board, a throwing Git port) is never thrown to liveness. */
  const watch = liveness.observe((observation) => {
    if (!active || stopping) return;
    closings = closings.then(() => closeEnded(observation)).catch(() => undefined);
  });

  /** Operations in flight are counted so the drain can wait for them; once draining, an operation answers unavailable. */
  const tracked =
    (operation: Xc6Operation): Xc6Operation =>
    (context) => {
      if (stopping) return unavailable(AWARENESS_UNAVAILABLE_CODE);
      const running = Promise.resolve(operation(context));
      const forget = (): void => void inflight.delete(running);
      inflight.add(running);
      running.then(forget, forget);
      return running;
    };

  /** At the drain every session still open ends with this Backend: a crash stays a crash, anything else is a clean close. */
  const endEvidence = (sessionId: string): SessionEvidence =>
    index.bindingOfSession(sessionId) === undefined
      ? "unbound"
      : observationOf(sessionId)?.kind === "crash"
        ? "crashed"
        : "stopped";

  const drainAll = async (): Promise<{ released: string[]; stillLive: string[] }> => {
    stopping = true;
    active = false;
    watch.close();
    await closings;
    await Promise.allSettled(inflight);
    const released: string[] = [];
    const stillLive: string[] = [];
    for (const board of boards.values()) {
      const name = `backend-awareness.board:${board.workspace}`;
      let closed: ReconcileResult;
      try {
        closed = await reconcileBoard({
          service: board.service,
          workspace: board.workspace,
          changedFiles: git,
          evidenceOf: endEvidence,
          now,
        });
      } catch (error) {
        closed = {
          status: "unavailable",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      await board.service.drain();
      if (closed.status === "unavailable" || board.service.pending !== 0) stillLive.push(name);
      else released.push(name);
      if (closed.status === "reconciled")
        for (const session of closed.sessions)
          if (session.outcome === "deferred")
            stillLive.push(`backend-awareness.session:${session.sessionId}`);
    }
    return { released, stillLive };
  };

  const checkWriteOp: Xc6Operation = async (context) => {
    const args = decodeBoardWriteArgs(context.args);
    const at = await open(context);
    if (at === undefined) return done({ verdict: "allowed", governed: false, takenOver: 0 });
    const outcome = await checkWrite(at.caller, { path: args.canonicalPath }, ports(at.board));
    if (outcome.status === "unavailable") return unavailable(reasonCode(outcome.reason));
    if (outcome.status === "refused")
      return done({ verdict: "refused", code: outcome.code, detail: outcome.detail });
    return done({ verdict: "allowed", governed: outcome.governed, takenOver: outcome.takenOver });
  };

  const recordEditOp: Xc6Operation = async (context) => {
    const args = decodeBoardRecordEditArgs(context.args);
    const at = await open(context);
    if (at === undefined) return done({ recorded: true, governed: false, duplicate: false });
    const outcome = await recordEdit(
      at.caller,
      { path: args.canonicalPath, callId: args.toolCallId },
      ports(at.board),
    );
    if (outcome.status === "unavailable") return unavailable(reasonCode(outcome.reason));
    return done({ recorded: true, governed: outcome.governed, duplicate: outcome.duplicate });
  };

  /** A session with no workspace has no board to tell, so the answer is unavailable (the Agent warns), never a recorded one. */
  const recordShellOp: Xc6Operation = async (context) => {
    const args = decodeBoardRecordShellArgs(context.args);
    const at = await open(context);
    if (at === undefined) return unavailable(AWARENESS_UNAVAILABLE_CODE);
    const outcome = await recordShell(
      at.caller,
      { paths: [...args.paths], outcome: args.outcome },
      ports(at.board),
    );
    if (outcome.status === "unavailable") return unavailable(reasonCode(outcome.reason));
    if (outcome.status === "refused")
      return done({ recorded: false, code: outcome.code, detail: outcome.detail });
    return done({ recorded: true, count: outcome.count });
  };

  const actionOp: Xc6Operation = async (context) => {
    const at = await open(context);
    if (at === undefined)
      return context.kind === "main"
        ? done({
            ok: false,
            code: "AWARENESS_NO_SESSION",
            message: "This session has no working directory, so it has no board.",
          })
        : done({
            ok: false,
            code: "AWARENESS_NOT_MAIN",
            message: "awareness is for main agents; report to your caller",
          });
    const outcome = await awarenessAction(at.caller, context.args, ports(at.board));
    return outcome.status === "done"
      ? done(outcome.result)
      : unavailable(reasonCode(outcome.reason));
  };

  const summaryOp: Xc6Operation = async (context) => {
    if (Object.keys(context.args).length > 0)
      throw new Error("awareness.summary takes no arguments");
    const at = await open(context);
    if (at === undefined) return done({ text: null, revision: 0, bytes: 0 });
    const outcome = await summarize(
      {
        service: at.board.service,
        workspace: at.caller.workspace,
        callerId: context.sessionId,
        rootId: context.rootSessionId,
        isMain: at.caller.kind === "main",
      },
      { ...ports(at.board), questions: decisions.questions },
    );
    if (outcome.status === "unavailable") return unavailable(reasonCode(outcome.reason));
    return done({ text: outcome.text, revision: outcome.revision, bytes: outcome.bytes });
  };

  return {
    operations: () => ({
      [BOARD_CHECK_WRITE_OPERATION]: tracked(checkWriteOp),
      [BOARD_RECORD_EDIT_OPERATION]: tracked(recordEditOp),
      [BOARD_RECORD_SHELL_OPERATION]: tracked(recordShellOp),
      [AWARENESS_ACTION_OPERATION]: tracked(actionOp),
      [AWARENESS_SUMMARY_OPERATION]: tracked(summaryOp),
    }),
    async editsOf(rootSessionId) {
      if (stopping) return { status: "unavailable", detail: "the board runtime has stopped" };
      try {
        const binding = index.bindingOfSession(rootSessionId);
        const workspace =
          binding === undefined ? undefined : await workspaceOf(binding.workingFolder);
        if (workspace === undefined) return { status: "unknown", reason: "no-workspace" };
        const read = await (await boardFor(workspace)).service.read();
        if (!read.ok) return { status: "unavailable", detail: read.detail };
        const session = read.board.sessions[rootSessionId];
        if (session === undefined) return { status: "unknown", reason: "no-record" };
        return { status: "known", paths: [...session.edits], workspace };
      } catch (error) {
        return {
          status: "unavailable",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    setReplayHorizon: (sequence) => {
      horizon = sequence;
    },
    settled: async () => {
      await closings;
    },
    async reconcileAtStart() {
      active = !stopping;
      for (const sessionId of index.sessions()) {
        try {
          const cwd = index.bindingOfSession(sessionId)?.workingFolder;
          const workspace = cwd === undefined ? undefined : await workspaceOf(cwd);
          if (workspace !== undefined) await reconcileOnce(await boardFor(workspace));
        } catch {
          /* one unreadable workspace does not stop the rest; its board reconciles at first use */
        }
      }
    },
    reconciled: () =>
      Array.from(boards.values()).flatMap((board) =>
        board.last === undefined ? [] : [{ workspace: board.workspace, result: board.last }],
      ),
    drain() {
      drained ??= drainAll();
      return drained;
    },
  };
}
