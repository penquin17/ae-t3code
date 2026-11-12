// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off
// AETHERIA M06 native-fork probe: the real Pi adapter forkThread over installed Pi 1.5.0 (faux provider, no model) keeps the custom
// entries before the fork point, drops those after it, and leaves the parent file untouched. The real CommandPolicy picks native_fork.
// Not shown: the Orchestrator, ThreadForkService or projections, a real model, a latest-turn, uncaptured-turn or subagent fork.
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  CommandId,
  NodeId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as CommandPolicy from "../orchestration-v2/CommandPolicy.ts";
import { makePiAdapterV2 } from "../../../../packages/provider-pi/src/server/adapter.ts";
import { forkSlotKey, requestPiSessionId } from "./piSessionIdSeam.ts";

const REPO = NodePath.join(import.meta.dirname, "../../../../../..");
const PI_DIR = NodePath.join(REPO, "node_modules/@earendil-works/pi-coding-agent");
const PI_CLI = NodePath.join(PI_DIR, "dist/bundle/cli.js");
const FAUX = NodePath.join(REPO, "tests/tools/installed-pi-world.faux.mjs");
const PROBE = NodePath.join(REPO, "tests/human-control/probes/fork/probe-entries.mjs");
const PROBE_TYPE = "aetheria.probe.fork";

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const PI_INSTANCE_ID = ProviderInstanceId.make("pi");
const THREAD_ID = ThreadId.make("thread-native-fork-parent");
const TARGET_THREAD_ID = ThreadId.make("thread-native-fork-target");
const SESSION_ID = ProviderSessionId.make("provider-session-native-fork");

const selection: ModelSelection = { instanceId: PI_INSTANCE_ID, model: "faux-probe/faux-1" };

interface SessionEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly customType?: string;
  readonly data?: { readonly tag?: string };
  readonly message?: { readonly role?: string; readonly content?: unknown };
}

const sha256 = (file: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex");

/** Lines of a Pi session file, in file order: the `session` header first, then the tree entries. */
const readSessionFile = (file: string): ReadonlyArray<SessionEntry> =>
  NodeFS.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionEntry)
    .filter((entry) => typeof entry.id === "string");

/** Pi's getBranch: from the leaf, follow parentId to the root, then reverse to root-first order. */
const branchOf = (
  entries: ReadonlyArray<SessionEntry>,
  leafId: string | null,
): ReadonlyArray<SessionEntry> => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: Array<SessionEntry> = [];
  for (let id = leafId; id !== null;) {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error(`broken parent chain at ${id}`);
    path.push(entry);
    id = entry.parentId;
  }
  return path.reverse();
};

const probeTags = (branch: ReadonlyArray<SessionEntry>) =>
  branch
    .filter((entry) => entry.type === "custom" && entry.customType === PROBE_TYPE)
    .map((entry) => entry.data?.tag);

const roles = (branch: ReadonlyArray<SessionEntry>) =>
  branch
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message?.role)
    .filter((role) => role === "user" || role === "assistant");

interface PiInspection {
  readonly entries: ReadonlyArray<SessionEntry>;
  readonly leafId: string | null;
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly pid: number;
}

/** Opens a session file in a separate installed Pi (extensions off), asks RPC get_entries, and proves that Pi exited. */
const inspectWithPi = (
  sessionFile: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<PiInspection> =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        PI_CLI,
        "--mode",
        "rpc",
        "--offline",
        "--no-extensions",
        "--no-tools",
        "--session",
        sessionFile,
      ],
      { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let buffer = "";
    let stderr = "";
    let answer: { entries: ReadonlyArray<SessionEntry>; leafId: string | null } | null = null;
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (line.length === 0) continue;
        let record: { type?: string; id?: string; success?: boolean; data?: typeof answer };
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record.type === "response" && record.id === "inspect") {
          if (record.success !== true || record.data == null) {
            child.kill("SIGKILL");
            reject(new Error(`get_entries failed: ${line}`));
            return;
          }
          answer = record.data;
          child.stdin.end();
        }
      }
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (answer === null) reject(new Error(`Pi exited without an answer: ${stderr.slice(-500)}`));
      else
        resolve({
          entries: answer.entries,
          leafId: answer.leafId,
          exit: { code, signal },
          pid: child.pid ?? -1,
        });
    });
    child.stdin.write(`${JSON.stringify({ id: "inspect", type: "get_entries" })}\n`);
  });

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

/** Waits for a fact only a subprocess can produce; fails with `what` if it never appears within `ms`. */
const waitFor = <A>(what: string, read: () => A | undefined, ms = 60_000): Effect.Effect<A> =>
  Effect.promise(() =>
    vi.waitFor(
      () => {
        const found = read();
        if (found === undefined) throw new Error(`timed out waiting for ${what}`);
        return found;
      },
      { timeout: ms, interval: 25 },
    ),
  );

describe("T3's native Pi fork carries Pi custom entries at the fork prefix", () => {
  it.live(
    "keeps the entries before the fork point, drops those after it, and leaves the parent untouched",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "native-fork-probe-" });
        const dirs = {
          workspace: NodePath.join(root, "workspace"),
          agent: NodePath.join(root, "agent"),
          home: NodePath.join(root, "home"),
        };
        for (const dir of Object.values(dirs))
          yield* fileSystem.makeDirectory(dir, { recursive: true });
        const env: NodeJS.ProcessEnv = {
          PATH: process.env["PATH"] ?? "",
          HOME: dirs.home,
          PI_CODING_AGENT_DIR: dirs.agent,
          PI_DIR,
          FAUX_MODELS: JSON.stringify([{ provider: "faux-probe", id: "faux-1", input: ["text"] }]),
          FAUX_SCRIPT: JSON.stringify([{ text: "first reply" }, { text: "second reply" }]),
        };

        // Every Pi process the adapter launches goes through the real spawner; record argv and pid to prove the route and the exits.
        const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const launches: Array<{ readonly pid: number; readonly args: ReadonlyArray<string> }> = [];
        const spawner = ChildProcessSpawner.make((command) =>
          realSpawner.spawn(command).pipe(
            Effect.tap((handle) =>
              Effect.sync(() => {
                launches.push({
                  pid: Number(handle.pid),
                  args: ChildProcess.isStandardCommand(command) ? command.args.map(String) : [],
                });
              }),
            ),
          ),
        );

        const evidence = yield* Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* makePiAdapterV2({
              instanceId: PI_INSTANCE_ID,
              settings: {
                enabled: true,
                binaryPath: PI_CLI,
                launchArgs: `--offline --approve --no-context-files --no-skills --extension ${PROBE} --extension ${FAUX}`,
                customModels: [],
              },
              environment: env,
            }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
            const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: dirs.workspace,
            });
            const runtime = yield* adapter.openSession({
              threadId: THREAD_ID,
              providerSessionId: SESSION_ID,
              modelSelection: selection,
              runtimePolicy,
            });
            const events: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
            yield* runtime.events.pipe(
              Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
              Effect.forkScoped,
            );
            const source: OrchestrationV2ProviderThread = yield* runtime.ensureThread({
              threadId: THREAD_ID,
              modelSelection: selection,
              runtimePolicy,
            });

            const now = yield* DateTime.now;
            const appThread = {
              createdBy: "user",
              creationSource: "web",
              id: THREAD_ID,
              projectId: "project:fixture:pi" as OrchestrationV2AppThread["projectId"],
              title: "Native fork probe parent",
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
                rootThreadId: THREAD_ID,
              },
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            } as OrchestrationV2AppThread;

            // Two real turns on the installed Pi; the probe extension appends a custom entry at start and after each run.
            const completedTurns: Array<OrchestrationV2ProviderTurn> = [];
            for (const ordinal of [1, 2]) {
              const runId = RunId.make(`run:${THREAD_ID}:${ordinal}`);
              const attemptId = RunAttemptId.make(`run-attempt:${runId}:1`);
              yield* runtime.startTurn({
                appThread,
                threadId: THREAD_ID,
                runId,
                runOrdinal: ordinal,
                providerTurnOrdinal: ordinal,
                attemptId,
                rootNodeId: NodeId.make(`node:${runId}:root`),
                providerThread: source,
                message: {
                  messageId: `message:${THREAD_ID}:${ordinal}` as never,
                  text: `probe prompt ${ordinal}`,
                  attachments: [],
                  createdBy: "user",
                  creationSource: "web",
                },
                modelSelection: selection,
                runtimePolicy,
              });
              const turn = yield* waitFor(`turn ${ordinal} to complete`, () => {
                for (const event of events.toReversed()) {
                  if (
                    event.type === "provider_turn.updated" &&
                    event.providerTurn.runAttemptId === attemptId &&
                    event.providerTurn.status === "completed"
                  )
                    return event.providerTurn;
                }
                return undefined;
              });
              completedTurns.push(turn);
            }
            const [turn1, turn2] = completedTurns as [
              OrchestrationV2ProviderTurn,
              OrchestrationV2ProviderTurn,
            ];

            const parentFile = source.nativeThreadRef?.nativeId;
            assert.isString(parentFile);
            const parentPath = parentFile as string;
            const parentBefore = {
              sha: sha256(parentPath),
              size: NodeFS.statSync(parentPath).size,
            };
            const parentBranch = branchOf(
              readSessionFile(parentPath),
              readSessionFile(parentPath).at(-1)?.id ?? null,
            );

            // Route decision: the real policy, the adapter's real capabilities, the facts the Orchestrator passes (Orchestrator.ts ~6816-6832).
            const policy = yield* CommandPolicy.CommandPolicyV2.pipe(
              Effect.provide(CommandPolicy.layer),
            );
            const decision = yield* policy.decideForkExecution({
              commandId: CommandId.make("command:native-fork-probe"),
              threadId: TARGET_THREAD_ID,
              providerInstanceId: PI_INSTANCE_ID,
              capabilities: yield* adapter.getCapabilities(),
              sameProvider: true,
              hasStrongNativeSource: source.nativeThreadRef?.strength === "strong",
              sourceRunStatus: "completed",
              fromSpecificTurn: true,
              sourceBusy: false,
            });

            // The fork: the adapter's forkThread, at turn 1 of 2 (a later turn exists, so the RPC `fork` runs; at the latest turn only --fork would).
            const forked = yield* runtime.forkThread({
              sourceProviderThread: source,
              sourceProviderTurns: [turn1, turn2],
              providerTurnId: turn1.id,
              targetThreadId: TARGET_THREAD_ID,
            });
            const parentAfterFork = {
              sha: sha256(parentPath),
              size: NodeFS.statSync(parentPath).size,
            };
            const launchesBefore = launches.length;

            // Identity-first fork (native round 2): the Backend's chosen Pi session id, asked for under `fork:<threadId>`, is passed as `--session-id` beside `--fork`.
            const seam = (
              globalThis as Record<symbol, { take(id: string): string | undefined } | undefined>
            )[Symbol.for("aetheria.pi.session-id-seam")];
            // (a) at the LATEST turn only `--fork` runs: the copy carries the chosen id, in its file name and its header.
            const chosen = NodeCrypto.randomUUID();
            const latestTarget = ThreadId.make("thread-native-fork-latest");
            requestPiSessionId(forkSlotKey(latestTarget), chosen);
            const latest = yield* runtime.forkThread({
              sourceProviderThread: source,
              sourceProviderTurns: [turn1, turn2],
              providerTurnId: turn2.id,
              targetThreadId: latestTarget,
            });
            const latestSeen = { slotLeft: seam?.take(forkSlotKey(latestTarget)) };
            // (b) inside the history Pi's RPC `fork` opens a session of its own: the adapter refuses a copy under another id rather than run it.
            const insideTarget = ThreadId.make("thread-native-fork-inside");
            requestPiSessionId(forkSlotKey(insideTarget), NodeCrypto.randomUUID());
            const inside = yield* Effect.exit(
              runtime.forkThread({
                sourceProviderThread: source,
                sourceProviderTurns: [turn1, turn2],
                providerTurnId: turn1.id,
                targetThreadId: insideTarget,
              }),
            );
            return {
              launchesBefore,
              chosen,
              latest,
              latestSeen,
              inside,
              parentAfterExtras: sha256(parentPath),
              decision,
              source,
              forked,
              turn1,
              turn2,
              parentPath,
              parentBefore,
              parentAfterFork,
              parentBranch,
            };
          }),
        );

        // After the adapter scope closed: no Pi process of this probe may survive.
        const parentAfterClose = sha256(evidence.parentPath);
        const survivors: Array<number> = [];
        for (const launch of launches) {
          const gone = yield* Effect.promise(() =>
            vi
              .waitFor(
                () => {
                  if (isAlive(launch.pid)) throw new Error("still running");
                },
                { timeout: 5_000, interval: 25 },
              )
              .then(
                () => true,
                () => false,
              ),
          );
          if (!gone) survivors.push(launch.pid);
        }
        assert.deepEqual(survivors, [], `Pi processes still running: ${JSON.stringify(launches)}`);

        // Which route ran.
        assert.equal(evidence.decision, "native_fork");
        assert.equal(
          evidence.launchesBefore,
          2,
          `launches: ${JSON.stringify(launches.map((l) => l.args))}`,
        );

        // Identity-first fork: the chosen id (asked for under `fork:<threadId>`) reaches `--session-id` beside `--fork`, the copy carries it, the slot is consumed once. Inside the history Pi's RPC fork opens another session, so the adapter refuses it.
        const asked = launches.filter((launch) => launch.args.includes("--session-id"));
        assert.deepEqual(
          asked.map((launch) => launch.args[launch.args.indexOf("--session-id") + 1]).slice(0, 1),
          [evidence.chosen],
        );
        assert.isTrue(asked[0]!.args.includes("--fork"));
        const latestFile = evidence.latest.nativeThreadRef?.nativeId ?? "";
        assert.include(NodePath.basename(latestFile), `_${evidence.chosen}.jsonl`);
        assert.equal(
          (JSON.parse(NodeFS.readFileSync(latestFile, "utf8").split("\n")[0]!) as { id: string })
            .id,
          evidence.chosen,
        );
        assert.deepEqual(evidence.latestSeen, { slotLeft: undefined });
        assert.isTrue(
          evidence.inside._tag === "Failure",
          "a copy under another session id is refused",
        );
        assert.equal(
          evidence.parentAfterExtras,
          evidence.parentAfterFork.sha,
          "the parent is still untouched",
        );
        const forkLaunch = launches.find((launch) => launch.args.includes("--fork"));
        assert.isDefined(forkLaunch);
        const forkArgs = forkLaunch!.args;
        assert.equal(forkArgs[forkArgs.indexOf("--fork") + 1], evidence.parentPath);
        assert.include(forkArgs, "--no-extensions");
        assert.isFalse(
          launches.filter((launch) => launch !== forkLaunch)[0]!.args.includes("--fork"),
        );
        assert.deepEqual(evidence.forked.forkedFrom, {
          providerThreadId: evidence.source.id,
          providerTurnId: evidence.turn1.id,
        });
        assert.equal(evidence.forked.appThreadId, TARGET_THREAD_ID);

        // The parent: before the fork it holds start, turn 1, after-turn-1, turn 2, after-turn-2; the fork changed no byte of it.
        assert.deepEqual(probeTags(evidence.parentBranch), [
          "start",
          "after-turn-1",
          "after-turn-2",
        ]);
        assert.deepEqual(roles(evidence.parentBranch), ["user", "assistant", "user", "assistant"]);
        assert.deepEqual(evidence.parentAfterFork, evidence.parentBefore);
        assert.equal(parentAfterClose, evidence.parentBefore.sha);

        // The fork: its own session file, read as raw JSONL and again through a separate installed Pi's get_entries.
        const forkFile = evidence.forked.nativeThreadRef?.nativeId;
        assert.isString(forkFile);
        assert.notEqual(forkFile, evidence.parentPath);
        // Pi writes a session file only once it holds an assistant message, so a fork that kept no prefix leaves no file at all.
        assert.isTrue(
          NodeFS.existsSync(forkFile as string),
          "the fork's session file was never written: it kept no prefix",
        );
        const rawEntries = readSessionFile(forkFile as string);
        const rawBranch = branchOf(rawEntries, rawEntries.at(-1)?.id ?? null);
        const inspected = yield* Effect.promise(() =>
          inspectWithPi(forkFile as string, dirs.workspace, env),
        );
        launches.push({ pid: inspected.pid, args: ["(inspection)"] });
        assert.deepEqual(inspected.exit, { code: 0, signal: null });
        assert.isFalse(isAlive(inspected.pid));
        const piBranch = branchOf(inspected.entries, inspected.leafId);

        const describeBranch = (branch: ReadonlyArray<SessionEntry>) =>
          branch
            .map((e) =>
              e.type === "custom"
                ? `custom:${e.data?.tag}`
                : e.type === "message"
                  ? `message:${e.message?.role}`
                  : e.type,
            )
            .join(" > ");
        // The whole shape, so a change in what the fork keeps shows as a diff (Pi 1.5.0 with the T3 extension also writes model, thinking,
        // session-name and system-message entries ahead of the first user message).
        const PREFIX =
          "model_change > thinking_level_change > custom:start > model_change > session_info > message:system > message:user > message:assistant > custom:after-turn-1";
        assert.equal(describeBranch(rawBranch), PREFIX);
        assert.equal(describeBranch(piBranch), PREFIX);
        assert.equal(
          describeBranch(evidence.parentBranch),
          `${PREFIX} > message:user > message:assistant > custom:after-turn-2`,
        );
        assert.equal(describeBranch(rawEntries), `session > ${PREFIX}`);
        for (const [label, branch] of [
          ["raw session file", rawBranch],
          ["Pi get_entries", piBranch],
        ] as const) {
          assert.deepEqual(
            probeTags(branch),
            ["start", "after-turn-1"],
            `${label}: fork branch custom entries`,
          );
          assert.deepEqual(roles(branch), ["user", "assistant"], `${label}: fork branch messages`);
        }
        // The after-prefix entry exists nowhere in the fork file, not only off its active branch.
        assert.notInclude(probeTags(rawEntries), "after-turn-2");
        // The kept entries are the parent's own entries, not re-created ones.
        const parentIds = new Set(evidence.parentBranch.map((entry) => entry.id));
        assert.isTrue(
          rawBranch.every((entry) => parentIds.has(entry.id) || entry.type === "session"),
        );
        // The raw file and Pi agree on the active branch.
        assert.deepEqual(
          rawBranch.map((entry) => entry.id),
          piBranch.map((entry) => entry.id),
        );
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
