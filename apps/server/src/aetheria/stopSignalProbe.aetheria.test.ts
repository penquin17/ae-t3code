// @effect-diagnostics nodeBuiltinImport:off effectSucceedWithVoid:off globalConsoleInEffect:off
// AETHERIA M06 Stop probe: the real adapter drives the installed Pi 1.5.0 (faux provider, no model) running a tool
// (tests/human-control/probes/stop/stop-signal-tool.mjs) that only waits on its execute signal and logs what it sees.
// "t3-stop" sends interruptTurn as T3's Stop does (requestRuntimeRestart: true); "abort-rpc" sends only the abort RPC.
// Not shown: the thread.stop route above ProviderTurnControlService, a real model, or an M06 interaction tool.
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  NodeId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type ProviderTurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { makePiAdapterV2 } from "../../../../packages/provider-pi/src/server/adapter.ts";

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

// apps/t3code/apps/server/src/aetheria -> repository root (same depth as provider-pi/src/server)
const REPO = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../../../..",
);
const PI_DIR = NodePath.join(REPO, "node_modules/@earendil-works/pi-coding-agent");
const PI_BIN = NodePath.join(REPO, "node_modules/.bin/pi");
const FAUX_EXTENSION = NodePath.join(REPO, "tests/tools/installed-pi-world.faux.mjs");
const STOP_EXTENSION = NodePath.join(REPO, "tests/human-control/probes/stop/stop-signal-tool.mjs");
const TOOL_NAME = "stop_probe_wait";
const MODEL_PROVIDER = "faux-stop";
const MODEL_ID = "faux-stop-model";

const PI_INSTANCE_ID = ProviderInstanceId.make("pi");
const SESSION_ID = ProviderSessionId.make("provider-session-pi-stop-probe");

const selection: ModelSelection = { instanceId: PI_INSTANCE_ID, model: "default" };

/** One line of the tool's log. */
interface ProbeRecord {
  readonly kind: string;
  readonly t: number;
  readonly pid: number;
  readonly [key: string]: unknown;
}

const readLog = (file: string): ReadonlyArray<ProbeRecord> =>
  NodeFS.existsSync(file)
    ? NodeFS.readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ProbeRecord)
    : [];

/** Waits for a fact only a subprocess's log file or exit can show; undefined if it never appears within `ms`. */
const until = <A>(probe: () => A | undefined, ms: number): Effect.Effect<A | undefined> =>
  Effect.promise(() =>
    vi
      .waitFor(
        () => {
          const found = probe();
          if (found === undefined) throw new Error("not yet");
          return found;
        },
        { timeout: ms, interval: 25 },
      )
      .catch(() => undefined),
  );

/** Progress trace, off unless STOP_PROBE_TRACE is set. */
const stage = (mode: string, what: string) => {
  if (process.env["STOP_PROBE_TRACE"] !== undefined)
    process.stderr.write(`[stop-probe] ${mode}: ${what}\n`);
};

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
};

interface Observation {
  readonly mode: "t3-stop" | "abort-rpc";
  readonly records: ReadonlyArray<ProbeRecord>;
  readonly interruptExit: "success" | string;
  readonly eventTypes: ReadonlyArray<string>;
  readonly terminalStatus: string | null;
  readonly piPid: number | null;
  readonly piExited: boolean;
  readonly worldFiles: ReadonlyArray<string>;
}

const runScenario = (mode: Observation["mode"]) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "stop-probe-"))),
    (root) =>
      Effect.gen(function* () {
        {
          const dirs = Object.fromEntries(
            ["workspace", "agent", "home", "sessions"].map((name) => [
              name,
              NodePath.join(root, name),
            ]),
          ) as Record<"workspace" | "agent" | "home" | "sessions", string>;
          for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });
          const logFile = NodePath.join(root, "stop-probe.jsonl");
          const threadId = ThreadId.make(`thread-stop-probe-${mode}`);
          const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: dirs.workspace,
          });
          const launchArgs = [
            "--offline",
            "--approve",
            "--session-dir",
            dirs.sessions,
            "--extension",
            FAUX_EXTENSION,
            "--extension",
            STOP_EXTENSION,
            "--no-context-files",
            "--no-skills",
            "--no-extensions",
            "--provider",
            MODEL_PROVIDER,
            "--model",
            MODEL_ID,
          ].join(" ");
          const environment: NodeJS.ProcessEnv = {
            PATH: process.env["PATH"] ?? "",
            HOME: dirs.home,
            PI_CODING_AGENT_DIR: dirs.agent,
            PI_DIR,
            FAUX_MODELS: JSON.stringify([
              { provider: MODEL_PROVIDER, id: MODEL_ID, input: ["text"] },
            ]),
            FAUX_SCRIPT: JSON.stringify([{ tool: TOOL_NAME, args: {} }, { text: "done" }]),
            STOP_PROBE_LOG: logFile,
            STOP_PROBE_WAIT_MS: "20000",
          };

          const events: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
          const interruptExit = yield* Effect.gen(function* () {
            const adapter = yield* makePiAdapterV2({
              instanceId: PI_INSTANCE_ID,
              settings: { enabled: true, binaryPath: PI_BIN, launchArgs, customModels: [] },
              environment,
            });
            const runtime = yield* adapter.openSession({
              threadId,
              providerSessionId: SESSION_ID,
              modelSelection: selection,
              runtimePolicy,
            });
            yield* runtime.events.pipe(
              Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
              Effect.forkScoped,
            );
            const providerThread = yield* runtime.ensureThread({
              threadId,
              modelSelection: selection,
              runtimePolicy,
            });
            const now = yield* DateTime.now;
            const runId = RunId.make(`run:${threadId}:1`);
            yield* runtime.startTurn({
              appThread: {
                createdBy: "user",
                creationSource: "web",
                id: threadId,
                projectId: "project:fixture:pi" as OrchestrationV2AppThread["projectId"],
                title: "Stop probe",
                providerInstanceId: PI_INSTANCE_ID,
                modelSelection: selection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                activeProviderThreadId: null,
                lineage: {
                  parentThreadId: null,
                  relationshipToParent: null,
                  rootThreadId: threadId,
                },
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                settledOverride: null,
                settledAt: null,
                lastVisitedAt: null,
                deletedAt: null,
              } as OrchestrationV2AppThread,
              threadId,
              runId,
              runOrdinal: 1,
              providerTurnOrdinal: 1,
              attemptId: RunAttemptId.make(`run-attempt:${runId}:1`),
              rootNodeId: NodeId.make(`node:${runId}:root`),
              providerThread,
              message: {
                messageId: `message:${threadId}:1` as never,
                text: "wait for the human",
                attachments: [],
                createdBy: "user",
                creationSource: "web",
              },
              modelSelection: selection,
              runtimePolicy,
            });

            // The tool is running and waiting once it has logged `start`.
            const started = yield* until(
              () => readLog(logFile).find((record) => record.kind === "start"),
              60_000,
            );
            assert.isDefined(
              started,
              `the tool never started; events: ${events.map((e) => e.type)}`,
            );
            const runningTurn = events.find(
              (event) =>
                event.type === "provider_turn.updated" && event.providerTurn.status === "running",
            );
            assert.isDefined(runningTurn, "no running provider turn was published");
            const providerTurnId: ProviderTurnId =
              runningTurn!.type === "provider_turn.updated"
                ? runningTurn!.providerTurn.id
                : (undefined as never);

            stage(mode, "tool started; interrupting");
            const exit = yield* Effect.exit(
              runtime.interruptTurn({
                providerThread,
                providerTurnId,
                ...(mode === "t3-stop" ? { requestRuntimeRestart: true } : {}),
              }),
            );
            stage(mode, "interruptTurn returned");
            yield* until(() => readLog(logFile).find((record) => record.kind === "abort"), 15_000);
            stage(mode, "abort wait over");
            yield* until(() => events.find((event) => event.type === "turn.terminal"), 15_000);
            stage(mode, "terminal wait over; closing scope");
            return Exit.isSuccess(exit) ? ("success" as const) : String(exit.cause);
          }).pipe(Effect.scoped);

          stage(mode, "scope closed");
          const records = readLog(logFile);
          const piPid = records.find((record) => record.kind === "start")?.pid ?? null;
          // The scope has closed: the adapter owned Pi's process and must have reaped it.
          const gone =
            piPid === null
              ? yield* Effect.succeed(undefined)
              : yield* until(() => (processAlive(piPid) ? undefined : true), 10_000);
          const terminal = events.find((event) => event.type === "turn.terminal");
          return {
            mode,
            records,
            interruptExit,
            eventTypes: events.map((event) => event.type),
            terminalStatus:
              terminal !== undefined && terminal.type === "turn.terminal" ? terminal.status : null,
            piPid,
            piExited: piPid === null ? false : gone === true,
            worldFiles: NodeFS.readdirSync(root).sort(),
          } satisfies Observation;
        }
      }),
    (root) => Effect.sync(() => NodeFS.rmSync(root, { recursive: true, force: true })),
  );

const kinds = (observed: Observation) => observed.records.map((record) => record.kind);

/** What the tool saw, in the order it saw it: the report line for a failure message. */
const describeObservation = (observed: Observation) =>
  JSON.stringify({
    mode: observed.mode,
    interruptExit: observed.interruptExit,
    terminalStatus: observed.terminalStatus,
    piExited: observed.piExited,
    records: observed.records.map(({ kind, t: _t, ...rest }) => ({ kind, ...rest })),
  });

const assertSignalLiveThenAborted = (observed: Observation) => {
  const note = describeObservation(observed);
  const start = observed.records.find((record) => record.kind === "start");
  assert.isDefined(start, `no start record: ${note}`);
  // Live when the wait began: a real AbortSignal, not yet aborted.
  assert.equal(start!["isAbortSignal"], true, note);
  assert.equal(start!["aborted"], false, note);
  assert.equal(typeof start!["toolCallId"], "string", note);
  // Then aborted, after the start, with no timeout and nothing written as a decision.
  const abortIndex = kinds(observed).indexOf("abort");
  assert.isAbove(abortIndex, kinds(observed).indexOf("start"), `signal never aborted: ${note}`);
  assert.notInclude(kinds(observed), "timeout", note);
  assert.notInclude(kinds(observed), "decision", note);
  const exitIndex = kinds(observed).indexOf("process_exit");
  if (exitIndex !== -1) assert.isBelow(abortIndex, exitIndex, `abort came after exit: ${note}`);
  assert.deepEqual(
    observed.worldFiles,
    ["agent", "home", "sessions", "stop-probe.jsonl", "workspace"],
    note,
  );
  // The adapter's own Pi process is gone once its scope closed.
  assert.isTrue(observed.piExited, `Pi pid ${observed.piPid} still alive: ${note}`);
};

describe("T3 Stop against the installed Pi: the waiting tool's execute signal", () => {
  // it.live: the adapter's process-termination grace is a real-time sleep, which it.effect's TestClock never advances.
  it.live(
    "T3 Stop (interruptTurn with requestRuntimeRestart) aborts the signal a waiting tool holds",
    () =>
      Effect.gen(function* () {
        const observed = yield* runScenario("t3-stop");
        console.info(`[stop-probe] ${describeObservation(observed)}`);
        assertSignalLiveThenAborted(observed);
      }).pipe(Effect.provide(layerTest)),
  );

  it.live("the abort RPC alone (interruptTurn without a restart) aborts the same signal", () =>
    Effect.gen(function* () {
      const observed = yield* runScenario("abort-rpc");
      console.info(`[stop-probe] ${describeObservation(observed)}`);
      assertSignalLiveThenAborted(observed);
    }).pipe(Effect.provide(layerTest)),
  );
});
