// AETHERIA M09 step 11 (IP-17) and the fix round (IP-18): the real adapter over a scripted Pi that records every RPC
// command and captures the model and effort in force when the prompt arrives. The policy is a recording stub; the
// scripted Pi never clamps and keeps only a session file name. Not shown: a real Pi, provider or session file, or the real
// policy (aetheria-server and apps/server tests).
import { assert, describe, it } from "@effect/vitest";
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
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { makePiAdapterV2 } from "./adapter.ts";
import type { PiRpcRecord } from "./rpc.ts";

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const decodeJsonLine = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeJsonLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const PI_INSTANCE_ID = ProviderInstanceId.make("pi");
const THREAD_ID = ThreadId.make("thread-pi-aetheria");
const SESSION_ID = ProviderSessionId.make("provider-session-pi-aetheria");
const FAKE_SESSION_FILE = "/fake/.pi/agent/sessions/--workspace--/0001_aetheria.jsonl";
const FAKE_PID = 999_999_999;
const SLOT = Symbol.for("aetheria.pi.selection-seam");

const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: null,
});

const selection = (model: string, thinking?: string): ModelSelection => ({
  instanceId: PI_INSTANCE_ID,
  model,
  ...(thinking === undefined ? {} : { options: [{ id: "thinking", value: thinking }] }),
});

interface ProviderRequest {
  readonly provider: string;
  readonly model: string;
  readonly thinking: string;
}

const makeScriptedPi = Effect.gen(function* () {
  const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const commands: Array<PiRpcRecord> = [];
  const providerRequests: Array<ProviderRequest> = [];
  const prompts = yield* Queue.unbounded<ProviderRequest>();
  const state = {
    provider: "xai",
    model: "base",
    thinking: "medium",
    sessionFile: FAKE_SESSION_FILE,
    messageCount: 0,
  };
  let buffer = "";
  let failNextState = false;

  const emit = (record: PiRpcRecord) =>
    Queue.offer(stdout, new TextEncoder().encode(`${encodeJsonLine(record)}\n`));

  const answer = (record: PiRpcRecord): PiRpcRecord | null => {
    if (typeof record["id"] !== "string") return null;
    const base = {
      type: "response",
      id: record["id"],
      command: String(record["type"]),
      success: true,
    };
    switch (record["type"]) {
      case "get_state":
        if (failNextState) {
          failNextState = false;
          return { ...base, success: false, error: "state unavailable" };
        }
        return {
          ...base,
          data: {
            model: { provider: state.provider, id: state.model },
            thinkingLevel: state.thinking,
            isStreaming: false,
            isCompacting: false,
            sessionFile: state.sessionFile,
            sessionId: "aetheria-session",
            messageCount: state.messageCount,
            pendingMessageCount: 0,
          },
        };
      case "set_model":
        state.provider = String(record["provider"]);
        state.model = String(record["modelId"]);
        return { ...base, data: { provider: state.provider, id: state.model } };
      case "set_thinking_level":
        state.thinking = String(record["level"]);
        return base;
      case "switch_session":
        state.sessionFile = String(record["sessionPath"]);
        return { ...base, data: { cancelled: false } };
      case "get_entries":
        return { ...base, data: { entries: [], leafId: null } };
      case "get_available_models":
        return { ...base, data: { models: [] } };
      default:
        return base;
    }
  };

  const onChunk = (chunk: Uint8Array) =>
    Effect.gen(function* () {
      buffer += new TextDecoder().decode(chunk);
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const record = decodeJsonLine(line) as PiRpcRecord;
        commands.push(record);
        if (record["type"] === "prompt") {
          const first = { provider: state.provider, model: state.model, thinking: state.thinking };
          providerRequests.push(first);
          yield* Queue.offer(prompts, first);
        }
        const response = answer(record);
        if (response !== null) yield* emit(response);
      }
    });

  const spawner = ChildProcessSpawner.make(() =>
    Effect.sync(() =>
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(FAKE_PID),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach(onChunk),
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    ),
  );

  const settleTurn = Effect.gen(function* () {
    yield* emit({ type: "agent_start" });
    yield* emit({ type: "agent_end", messages: [], willRetry: false });
    yield* emit({ type: "agent_settled" });
  });

  return {
    spawner,
    commands,
    providerRequests,
    /** Waits for the next prompt command; the adapter sends it after startTurn returns. */
    nextPrompt: Queue.take(prompts),
    settleTurn,
    /** Pi leaves the session file the adapter registered, as an in-session command of another extension could. */
    moveTo: (file: string) => {
      state.sessionFile = file;
    },
    /** Pi holds a conversation in memory, as after any turn that wrote a message. */
    holdMessages: (count: number) => {
      state.messageCount = count;
    },
    /** The next get_state answers with an error, once. */
    failNextState: () => {
      failNextState = true;
    },
    /** Every command type in the order sent, without ids. */
    commandTypes: () => commands.map((c) => String(c["type"])),
    switchTargets: () =>
      commands.filter((c) => c["type"] === "switch_session").map((c) => String(c["sessionPath"])),
    /** The model and effort commands, in the order sent, without ids. */
    selectionCommands: () =>
      commands
        .filter((c) => c["type"] === "set_model" || c["type"] === "set_thinking_level")
        .map((c) =>
          c["type"] === "set_model"
            ? `set_model ${String(c["provider"])}/${String(c["modelId"])}`
            : `set_thinking_level ${String(c["level"])}`,
        ),
  };
});

interface SeamAsk {
  readonly provider: string;
  readonly model: string;
  readonly effort?: string;
  readonly child: boolean;
}
type SeamAnswer =
  | { readonly outcome: "resolved"; readonly effort: string | null }
  | { readonly outcome: "refused"; readonly code: string; readonly message: string };

/** Installs a recording stub in the slot for the effect's duration and always empties it. */
const withSeam = <A, E, R>(
  answer: (ask: SeamAsk) => SeamAnswer,
  use: (asks: Array<SeamAsk>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const asks: Array<SeamAsk> = [];
      (globalThis as Record<symbol, unknown>)[SLOT] = {
        resolve: (ask: SeamAsk) => {
          asks.push(ask);
          return answer(ask);
        },
      };
      return asks;
    }),
    use,
    () =>
      Effect.sync(() => {
        delete (globalThis as Record<symbol, unknown>)[SLOT];
      }),
  );

const openRuntime = Effect.fnUntraced(function* (fake: Effect.Success<typeof makeScriptedPi>) {
  const adapter = yield* makePiAdapterV2({
    instanceId: PI_INSTANCE_ID,
    settings: { enabled: true, binaryPath: "pi", launchArgs: "", customModels: [] },
    environment: {},
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, fake.spawner));
  const runtime = yield* adapter.openSession({
    threadId: THREAD_ID,
    providerSessionId: SESSION_ID,
    modelSelection: selection("default"),
    runtimePolicy,
  });
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  yield* runtime.events.pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  );
  const takeTerminal = Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(events);
      if (event.type === "turn.terminal") return event;
    }
  });
  const providerThread = yield* runtime.ensureThread({
    threadId: THREAD_ID,
    modelSelection: selection("default"),
    runtimePolicy,
  });
  return { runtime, providerThread, takeTerminal };
});

const appThreadOf = Effect.fnUntraced(function* (subagent: boolean) {
  const now = yield* DateTime.now;
  return {
    createdBy: "user",
    creationSource: "web",
    id: THREAD_ID,
    projectId: "project:fixture:pi" as OrchestrationV2AppThread["projectId"],
    title: "Pi test thread",
    providerInstanceId: PI_INSTANCE_ID,
    modelSelection: selection("default"),
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: subagent
      ? {
          parentThreadId: ThreadId.make("thread-parent"),
          relationshipToParent: "subagent",
          rootThreadId: ThreadId.make("thread-parent"),
        }
      : { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } as OrchestrationV2AppThread;
});

const startTurn = Effect.fnUntraced(function* (
  runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime,
  providerThread: OrchestrationV2ProviderThread,
  modelSelection: ModelSelection,
  options: {
    readonly ordinal?: number;
    readonly continuation?: boolean;
    readonly subagent?: boolean;
  } = {},
) {
  const ordinal = options.ordinal ?? 1;
  const runId = RunId.make(`run:${THREAD_ID}:${ordinal}`);
  return yield* runtime.startTurn({
    appThread: yield* appThreadOf(options.subagent ?? false),
    threadId: THREAD_ID,
    runId,
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`run-attempt:${runId}:1`),
    rootNodeId: NodeId.make(`node:${runId}:root`),
    providerThread,
    message: {
      messageId: `message:${THREAD_ID}:${ordinal}` as never,
      text: "Hello pi",
      attachments: [],
      createdBy: options.continuation === true ? "agent" : "user",
      creationSource: options.continuation === true ? "provider" : "web",
    },
    modelSelection,
    runtimePolicy,
  });
});

const resolveWith = (effort: string | null) => (): SeamAnswer => ({ outcome: "resolved", effort });

describe("T3's Pi selection seam (IP-17)", () => {
  it.effect("bare T3 sends exactly what upstream sends when no policy is installed", () =>
    Effect.gen(function* () {
      assert.isUndefined((globalThis as Record<symbol, unknown>)[SLOT]);
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      yield* startTurn(runtime, providerThread, selection("anthropic/claude-fable-5-1"));
      yield* fake.nextPrompt;
      assert.deepEqual(fake.selectionCommands(), ["set_model anthropic/claude-fable-5-1"]);
      assert.deepEqual(fake.providerRequests, [
        { provider: "anthropic", model: "claude-fable-5-1", thinking: "medium" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("bare T3 applies an explicit thinking level as before", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      yield* startTurn(runtime, providerThread, selection("xai/grok-4.6", "high"));
      yield* fake.nextPrompt;
      assert.deepEqual(fake.selectionCommands(), [
        "set_model xai/grok-4.6",
        "set_thinking_level high",
      ]);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect(
    "sends the resolved default effort, and the first provider request equals the route",
    () =>
      withSeam(resolveWith("high"), (asks) =>
        Effect.gen(function* () {
          const fake = yield* makeScriptedPi;
          const { runtime, providerThread } = yield* openRuntime(fake);
          yield* startTurn(runtime, providerThread, selection("anthropic/claude-fable-5-1"));
          yield* fake.nextPrompt;
          assert.deepEqual(asks, [
            { provider: "anthropic", model: "claude-fable-5-1", child: false },
          ]);
          assert.deepEqual(fake.selectionCommands(), [
            "set_model anthropic/claude-fable-5-1",
            "set_thinking_level high",
          ]);
          assert.deepEqual(fake.providerRequests, [
            { provider: "anthropic", model: "claude-fable-5-1", thinking: "high" },
          ]);
        }).pipe(Effect.scoped, Effect.provide(layerTest)),
      ),
  );

  it.effect("passes the selection's own effort to the policy and sends what it returns", () =>
    withSeam(resolveWith("low"), (asks) =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread } = yield* openRuntime(fake);
        yield* startTurn(runtime, providerThread, selection("openai-codex/gpt-6-luna", "low"));
        yield* fake.nextPrompt;
        assert.deepEqual(asks, [
          { provider: "openai-codex", model: "gpt-6-luna", effort: "low", child: false },
        ]);
        assert.deepEqual(fake.providerRequests, [
          { provider: "openai-codex", model: "gpt-6-luna", thinking: "low" },
        ]);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );

  it.effect("asks as a child when the thread is a subagent", () =>
    withSeam(resolveWith("medium"), (asks) =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread } = yield* openRuntime(fake);
        yield* startTurn(runtime, providerThread, selection("anthropic/claude-fable-5-1"), {
          subagent: true,
        });
        yield* fake.nextPrompt;
        assert.deepEqual(
          asks.map((ask) => ask.child),
          [true],
        );
        assert.deepEqual(fake.providerRequests, [
          { provider: "anthropic", model: "claude-fable-5-1", thinking: "medium" },
        ]);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );

  it.effect("sends no thinking command when the policy resolves none", () =>
    withSeam(resolveWith(null), () =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread } = yield* openRuntime(fake);
        yield* startTurn(runtime, providerThread, selection("xai/grok-4.6"));
        yield* fake.nextPrompt;
        assert.deepEqual(fake.selectionCommands(), ["set_model xai/grok-4.6"]);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );

  it.effect(
    "fails the turn before any model, effort, name or prompt command when the policy refuses",
    () =>
      withSeam(
        () => ({
          outcome: "refused",
          code: "effort-unsupported",
          message: "openai-codex/gpt-6-luna does not support chat default high",
        }),
        () =>
          Effect.gen(function* () {
            const fake = yield* makeScriptedPi;
            const { runtime, providerThread } = yield* openRuntime(fake);
            const before = fake.commands.length;
            const exit = yield* Effect.exit(
              startTurn(runtime, providerThread, selection("openai-codex/gpt-6-luna")),
            );
            assert.isTrue(Exit.isFailure(exit));
            assert.include(
              String(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""),
              "does not support chat default high",
            );
            const sent = fake.commands.slice(before).map((c) => String(c["type"]));
            for (const type of ["set_model", "set_thinking_level", "set_session_name", "prompt"])
              assert.notInclude(sent, type);
            assert.deepEqual(fake.providerRequests, []);
          }).pipe(Effect.scoped, Effect.provide(layerTest)),
      ),
  );

  it.effect("does not consult the policy or re-send anything on a continuation", () =>
    withSeam(resolveWith("high"), (asks) =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread, takeTerminal } = yield* openRuntime(fake);
        const chosen = selection("anthropic/claude-fable-5-1");
        yield* startTurn(runtime, providerThread, chosen);
        yield* fake.nextPrompt;
        yield* fake.settleTurn;
        yield* takeTerminal;
        const sentBefore = fake.selectionCommands();
        assert.equal(asks.length, 1);
        yield* startTurn(runtime, providerThread, selection("openai-codex/gpt-6-luna", "low"), {
          ordinal: 2,
          continuation: true,
        });
        assert.equal(asks.length, 1);
        assert.deepEqual(fake.selectionCommands(), sentBefore);
        assert.deepEqual(fake.providerRequests.at(-1), {
          provider: "anthropic",
          model: "claude-fable-5-1",
          thinking: "high",
        });
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );

  it.effect("sends nothing new on a later turn whose resolved route is already applied", () =>
    withSeam(resolveWith("high"), (asks) =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread, takeTerminal } = yield* openRuntime(fake);
        const chosen = selection("anthropic/claude-fable-5-1");
        yield* startTurn(runtime, providerThread, chosen);
        yield* fake.nextPrompt;
        yield* fake.settleTurn;
        yield* takeTerminal;
        yield* startTurn(runtime, providerThread, chosen, { ordinal: 2 });
        yield* fake.nextPrompt;
        assert.equal(asks.length, 2);
        assert.deepEqual(fake.selectionCommands(), [
          "set_model anthropic/claude-fable-5-1",
          "set_thinking_level high",
        ]);
        assert.equal(fake.providerRequests.length, 2);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );

  it.effect("leaves the inherit-default selection to Pi without asking the policy", () =>
    withSeam(resolveWith("high"), (asks) =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread } = yield* openRuntime(fake);
        yield* startTurn(runtime, providerThread, selection("default"));
        yield* fake.nextPrompt;
        assert.deepEqual(asks, []);
        assert.deepEqual(fake.selectionCommands(), []);
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
    ),
  );
});

describe("T3's Pi session replay (IP-18)", () => {
  const resumeInput = (existingProviderThread: OrchestrationV2ProviderThread) => ({
    threadId: THREAD_ID,
    modelSelection: selection("default"),
    runtimePolicy,
    existingProviderThread,
  });

  it.effect("sends switch_session when Pi is on the file and holds a conversation", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      fake.holdMessages(3);
      const again = yield* runtime.ensureThread(resumeInput(providerThread));
      assert.deepEqual(fake.switchTargets(), [FAKE_SESSION_FILE]);
      assert.equal(again.nativeThreadRef?.nativeId, FAKE_SESSION_FILE);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("sends switch_session with no extra get_state once a prompt went to the file", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread, takeTerminal } = yield* openRuntime(fake);
      yield* startTurn(runtime, providerThread, selection("default"));
      yield* fake.nextPrompt;
      yield* fake.settleTurn;
      yield* takeTerminal;
      const before = fake.commandTypes().length;
      yield* runtime.ensureThread(resumeInput(providerThread));
      assert.deepEqual(fake.switchTargets(), [FAKE_SESSION_FILE]);
      assert.equal(fake.commandTypes()[before], "switch_session");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("does not send switch_session when Pi is on the file and holds no messages", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      const again = yield* runtime.ensureThread(resumeInput(providerThread));
      assert.deepEqual(fake.switchTargets(), []);
      assert.equal(again.nativeThreadRef?.nativeId, FAKE_SESSION_FILE);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("sends switch_session when Pi has left that session file", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      fake.moveTo("/fake/.pi/agent/sessions/--workspace--/0002_elsewhere.jsonl");
      const again = yield* runtime.ensureThread(resumeInput(providerThread));
      assert.deepEqual(fake.switchTargets(), [FAKE_SESSION_FILE]);
      assert.equal(again.nativeThreadRef?.nativeId, FAKE_SESSION_FILE);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("sends switch_session as upstream does when Pi cannot say which file it is on", () =>
    Effect.gen(function* () {
      const fake = yield* makeScriptedPi;
      const { runtime, providerThread } = yield* openRuntime(fake);
      fake.failNextState();
      yield* runtime.ensureThread(resumeInput(providerThread));
      assert.deepEqual(fake.switchTargets(), [FAKE_SESSION_FILE]);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect(
    "sends switch_session first, with no extra get_state, for a thread this process was never on",
    () =>
      Effect.gen(function* () {
        const fake = yield* makeScriptedPi;
        const { runtime, providerThread } = yield* openRuntime(fake);
        const older = "/fake/.pi/agent/sessions/--workspace--/0000_older.jsonl";
        const before = fake.commandTypes().length;
        yield* runtime.ensureThread(
          resumeInput({
            ...providerThread,
            nativeThreadRef: { ...providerThread.nativeThreadRef!, nativeId: older },
          }),
        );
        assert.deepEqual(fake.switchTargets(), [older]);
        assert.equal(fake.commandTypes()[before], "switch_session");
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
