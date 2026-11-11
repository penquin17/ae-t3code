// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off
// AETHERIA M05 Plan step 2 (R1, D4, D14; conservative reading (a)) — pre-release Pi session binding probe. A mechanism probe, not an M05 feature.
//
// Question. With the REAL Pi adapter over the installed Pi 1.5.0, is the child's Pi session id knowable, and bindable by M04's thread index, after
// open-session + ensureThread and BEFORE any prompt — with the provider serving no request until release, and release reusing that same session?
//
// Boundary. makePiAdapterV2 (the fork's real Pi adapter) launching the installed Pi (`pi --mode rpc`), Pi's own faux provider as a scripted extension
// (tests/tools/installed-pi-world.faux.mjs; FAUX_SEEN logs every request it serves), and M04's real createThreadIndex().bind on a scratch state root.
// No model, no credential, no network. The adapter is driven directly (openSession, ensureThread, resumeThread, startTurn) in the order a Backend
// adapter would use around a held run; the Orchestrator is NOT involved (see heldChild.aetheria.test.ts for that half, with a scripted adapter).
//
// Shows: (1) after ensureThread with the held row (nativeThreadRef null) a Pi session file path with a session id in its name exists, Pi wrote no
// file yet, and createThreadIndex().bind accepts it with evidence "filename"; (2) the faux provider served zero requests; (3) after release
// (resumeThread on the bound row, then startTurn) exactly one request is served, one Pi process served the whole sequence, the file now exists and
// its header id equals the id bound before release; (4) contrast: ensureThread called twice on the unbound held row makes TWO different Pi session
// ids, which is why the bound thread must be persisted before release.
// Does NOT show: T3's persistence of the bound thread, the Aetheria extension or identity in the Pi session, or any real provider.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { MessageId, NodeId, RunAttemptId, RunId, ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import { createThreadIndex } from "../../../../packages/aetheria-server/src/identity/threadIndex.ts";
import {
  FAUX,
  PROVIDER_SESSION_ID,
  heldRows,
  idFromFileName,
  idFromHeader,
  makePi,
  makeWorld,
  requestsSeen,
  runtimePolicyOf,
  selection,
  waitFor,
} from "./piProbeKit.ts";

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const THREAD = ThreadId.make("thread:m05-prebind-child");

describe("real Pi: the child's session id is bindable before the first prompt", () => {
  it.live(
    "binds by file name before release, serves no request, and release reuses the same session",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "m05-prebind-" });
        const world = makeWorld(root, [{ text: "child done" }]);
        const stateRoot = NodePath.join(root, "state");
        NodeFS.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });

        const { adapter, launches } = yield* makePi(world, [FAUX]);
        const policy = runtimePolicyOf(world);
        const { appThread, heldRow } = yield* heldRows(THREAD);
        const events: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
        const runtime = yield* adapter.openSession({
          threadId: THREAD,
          providerSessionId: PROVIDER_SESSION_ID,
          modelSelection: selection,
          runtimePolicy: policy,
        });
        yield* runtime.events.pipe(
          Stream.runForEach((event) => Effect.sync(() => void events.push(event))),
          Effect.forkScoped,
        );

        // The pre-release step: ensureThread on the held row, no turn.
        const ensured = yield* runtime.ensureThread({
          threadId: THREAD,
          modelSelection: selection,
          runtimePolicy: policy,
          providerSessionId: PROVIDER_SESSION_ID,
          existingProviderThread: heldRow,
        });
        const file = ensured.nativeThreadRef?.nativeId;
        assert.isString(file);
        const sessionFile = file as string;
        assert.isTrue(NodePath.isAbsolute(sessionFile));
        const sessionId = idFromFileName(sessionFile);
        assert.isString(sessionId, `no session id in the file name ${sessionFile}`);
        // Observed: Pi has not written the file (it writes one with the first assistant message), so only the name carries the id.
        assert.isFalse(NodeFS.existsSync(sessionFile));
        // M04's index binds it from the name.
        const index = createThreadIndex({ stateRoot });
        const bound = index.bind({
          threadId: THREAD,
          providerSessionId: "credential-id-m05",
          providerInstanceId: "pi",
          sessionFile,
          workingFolder: world.workspace,
        });
        assert.isTrue(bound.ok, JSON.stringify(bound));
        if (bound.ok) {
          assert.equal(bound.binding.sessionId, sessionId);
          assert.equal(bound.binding.evidence, "filename");
        }
        assert.equal(index.bindingOfSession(sessionId as string)?.threadId, THREAD);
        // No provider request, no turn event, one Pi process so far.
        assert.equal(requestsSeen(world), 0);
        assert.isUndefined(events.find((event) => event.type === "provider_turn.updated"));
        assert.lengthOf(launches, 1);

        // Release: resume the bound row (what T3 does once nativeThreadRef is persisted), then start the first turn.
        const resumed = yield* runtime.resumeThread({
          providerThread: ensured,
          threadId: THREAD,
          modelSelection: selection,
          runtimePolicy: policy,
        });
        assert.equal(resumed.nativeThreadRef?.nativeId, sessionFile);
        const runId = RunId.make("run:m05-prebind");
        const attemptId = RunAttemptId.make("attempt:m05-prebind");
        yield* runtime.startTurn({
          appThread,
          threadId: THREAD,
          runId,
          runOrdinal: 1,
          providerTurnOrdinal: 1,
          attemptId,
          rootNodeId: NodeId.make("node:m05-prebind:root"),
          providerThread: resumed,
          message: {
            messageId: MessageId.make("message:m05-prebind"),
            text: "the held task",
            attachments: [],
            createdBy: "agent",
            creationSource: "server",
          },
          modelSelection: selection,
          runtimePolicy: policy,
        });
        yield* waitFor("the first turn to complete", () =>
          events.find(
            (event) =>
              event.type === "provider_turn.updated" &&
              event.providerTurn.runAttemptId === attemptId &&
              event.providerTurn.status === "completed",
          ),
        );
        assert.equal(requestsSeen(world), 1);
        assert.lengthOf(launches, 1);
        // One Pi session id in total: the file Pi wrote is the bound one, and its header agrees with the name.
        assert.isTrue(NodeFS.existsSync(sessionFile));
        assert.equal(idFromHeader(sessionFile), sessionId);
        const sessionFiles = NodeFS.readdirSync(NodePath.join(root, "agent"), { recursive: true })
          .map(String)
          .filter((name) => name.endsWith(".jsonl"));
        assert.lengthOf(sessionFiles, 1, `Pi session files: ${sessionFiles.join(", ")}`);
        // Binding again is unchanged (idempotent), now with the header as evidence or the same id.
        const again = index.bind({
          threadId: THREAD,
          providerSessionId: "credential-id-m05",
          providerInstanceId: "pi",
          sessionFile,
          workingFolder: world.workspace,
        });
        assert.isTrue(again.ok && again.binding.sessionId === sessionId, JSON.stringify(again));
      }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.live("contrast: ensureThread twice on the unbound held row makes two Pi session ids", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "m05-double-" });
      const world = makeWorld(root, [{ text: "unused" }]);
      const { adapter } = yield* makePi(world, [FAUX]);
      const policy = runtimePolicyOf(world);
      const { heldRow } = yield* heldRows(THREAD);
      const runtime = yield* adapter.openSession({
        threadId: THREAD,
        providerSessionId: PROVIDER_SESSION_ID,
        modelSelection: selection,
        runtimePolicy: policy,
      });
      const input = {
        threadId: THREAD,
        modelSelection: selection,
        runtimePolicy: policy,
        providerSessionId: PROVIDER_SESSION_ID,
        existingProviderThread: heldRow,
      };
      const first = yield* runtime.ensureThread(input);
      // What T3's turn start does at release when the bound thread was not persisted: the row it reads still has nativeThreadRef null.
      const second = yield* runtime.ensureThread(input);
      const a = first.nativeThreadRef?.nativeId as string;
      const b = second.nativeThreadRef?.nativeId as string;
      assert.notEqual(a, b);
      assert.notEqual(idFromFileName(a), idFromFileName(b));
      assert.equal(requestsSeen(world), 0);
      // Both ids are bindable by file name: a second bind for the same thread would REPLACE the first, so the identity staged for the first
      // id would no longer match the thread. Persisting the bound thread before release is what prevents it.
      const stateRoot = NodePath.join(root, "state");
      NodeFS.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
      const index = createThreadIndex({ stateRoot });
      const bind = (file: string) =>
        index.bind({
          threadId: THREAD,
          providerSessionId: "credential-id-m05",
          providerInstanceId: "pi",
          sessionFile: file,
          workingFolder: world.workspace,
        });
      assert.isTrue(bind(a).ok);
      const replaced = bind(b);
      assert.isTrue(replaced.ok && replaced.change === "replaced", JSON.stringify(replaced));
      assert.equal(index.bindingOfSession(idFromFileName(a) as string), undefined);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
