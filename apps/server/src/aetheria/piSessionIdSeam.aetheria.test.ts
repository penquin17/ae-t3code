// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off
// AETHERIA M05 Plan step 9 (D19/R1, native round 3; IP-25) — the REAL Pi adapter opens a held child's session with a REQUESTED Pi session id, and Aetheria's REAL Agent-host
// identity start then RESUMES the child's active record instead of promoting the session to `main`.
//
// Native round 2: the child's Pi session started with Pi's own fresh id; the Agent host (packages/aetheria-pi/src/identity-start.ts) found no record, saw a fresh session and
// wrote a `main` record for it; M05's later `activate` refused with STORE_SESSION_EXISTS. M05 now chooses the id, activates the child's record under it, and only then opens the
// session with that id.
//
// Boundary: makePiAdapterV2 (the fork's real Pi adapter) launching the installed Pi 1.5.0 (`pi --mode rpc`) with Pi's own faux provider and a probe extension that runs the REAL
// `createAgentIdentityHost(...).start` (the shipped Agent host's code, not a copy) on session_start (tests/orchestration/identity-start-probe.extension.mjs). The child's active
// record is written in M03's on-disk envelope. It does NOT load the whole shipped Aetheria extension (it needs a Backend, a manifest and a composition digest the real stack
// supplies; the native run covers that), and no Backend, T3 persistence or Orchestrator is involved.
//
// Shows: (1) a requested id becomes Pi's session id (`--session-id` reaches the launch, the session file's name carries it) and the host RESUMES the active record, with no `main`
// record written; (2) without a request the same start promotes the fresh session to main (the contrast: the failure the order avoids); (3) a request serves one launch only;
// (4) an id Pi would refuse is never passed (nothing is launched with it); (5) a user's `--session-id` launch argument is still refused.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { resolvePiLaunchArgs } from "../../../../packages/provider-pi/src/server/mcpInjection.ts";
import { forkSlotKey, requestPiSessionId, withdrawPiSessionIdRequest } from "./piSessionIdSeam.ts";
import {
  FAUX,
  PROVIDER_SESSION_ID,
  heldRows,
  idFromFileName,
  makePi,
  makeWorld,
  runtimePolicyOf,
  selection,
  waitFor,
} from "./piProbeKit.ts";

const REPO = NodePath.join(import.meta.dirname, "../../../../../..");
const PROBE = NodePath.join(REPO, "tests/orchestration/identity-start-probe.extension.mjs");
const IDENTITY_START = NodeURL.pathToFileURL(
  NodePath.join(REPO, "packages/aetheria-pi/src/identity-start.ts"),
).href;

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const THREAD = ThreadId.make("thread:m05-session-id-child");

const childEnvelope = (sessionId: string) => ({
  formatVersion: 1,
  state: "active",
  attemptId: "attempt-1",
  writer: "managed-work",
  acceptedPrompt: false,
  record: {
    sessionId,
    kind: "child",
    rootSessionId: "root-session",
    parentChain: ["root-session"],
    role: "reader",
    roleOrigin: "checkout",
    roleDigest: null,
    authoritySource: "role",
  },
});

const identityFiles = (stateRoot: string) =>
  NodeFS.existsSync(NodePath.join(stateRoot, "identity"))
    ? NodeFS.readdirSync(NodePath.join(stateRoot, "identity")).filter((name) =>
        name.endsWith(".json"),
      )
    : [];

/** One scratch world: a state root, the probe's output file, and the real adapter with the faux provider and the identity-start probe. */
const scratch = Effect.fn("piSessionIdSeam.scratch")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "m05-session-id-" });
  const stateRoot = NodeFS.realpathSync(root) + "/state";
  NodeFS.mkdirSync(NodePath.join(stateRoot, "identity"), { recursive: true, mode: 0o700 });
  const out = NodePath.join(NodeFS.realpathSync(root), "probe-out.jsonl");
  const world = makeWorld(NodeFS.realpathSync(root), [{ text: "child done" }], {
    AETHERIA_STATE_ROOT: stateRoot,
    PROBE_IDENTITY_START: IDENTITY_START,
    PROBE_OUT: out,
  });
  const pi = yield* makePi(world, [FAUX, PROBE]);
  const probeLines = () =>
    NodeFS.existsSync(out)
      ? NodeFS.readFileSync(out, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
          .map(
            (line) =>
              JSON.parse(line) as {
                sessionId: string | null;
                state: string;
                reason: string | null;
              },
          )
      : [];
  return { world, stateRoot, probeLines, ...pi };
});

/** Opens the thread's session and ensures the held row, as the Backend adapter does; returns the session id Pi bound. */
const openAndEnsure = Effect.fn("piSessionIdSeam.openAndEnsure")(function* (
  s: Effect.Success<ReturnType<typeof scratch>>,
) {
  const policy = runtimePolicyOf(s.world);
  const { heldRow } = yield* heldRows(THREAD);
  const runtime = yield* s.adapter.openSession({
    threadId: THREAD,
    providerSessionId: PROVIDER_SESSION_ID,
    modelSelection: selection,
    runtimePolicy: policy,
  });
  const ensured = yield* runtime.ensureThread({
    threadId: THREAD,
    modelSelection: selection,
    runtimePolicy: policy,
    providerSessionId: PROVIDER_SESSION_ID,
    existingProviderThread: heldRow,
  });
  const file = ensured.nativeThreadRef?.nativeId;
  assert.isString(file);
  return idFromFileName(file as string);
});

describe("real Pi: a held child's session opens with the requested id, and the Agent host resumes its record", () => {
  it.live(
    "the requested id is Pi's session id and the host resumes the active child record (no main record)",
    () =>
      Effect.gen(function* () {
        const s = yield* scratch();
        const chosen = NodeCrypto.randomUUID();
        NodeFS.writeFileSync(
          NodePath.join(s.stateRoot, "identity", `${chosen}.json`),
          JSON.stringify(childEnvelope(chosen)),
          { mode: 0o600 },
        );
        requestPiSessionId(THREAD, chosen);
        const bound = yield* openAndEnsure(s);
        assert.equal(bound, chosen, "the session Pi opened is the one that was asked for");
        assert.deepEqual(s.launches[0]?.args.slice(-2), ["--session-id", chosen]);
        const lines = yield* waitFor("the identity start", () =>
          s.probeLines().length > 0 ? s.probeLines() : undefined,
        );
        assert.equal(lines[0]?.sessionId, chosen);
        assert.equal(lines[0]?.state, "resumed", JSON.stringify(lines[0]));
        assert.deepEqual(
          identityFiles(s.stateRoot),
          [`${chosen}.json`],
          "no main record was written for the session",
        );
      }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live(
    "without a request the same start promotes the fresh session to main (the failure the order avoids)",
    () =>
      Effect.gen(function* () {
        const s = yield* scratch();
        const bound = yield* openAndEnsure(s);
        assert.isString(bound);
        const lines = yield* waitFor("the identity start", () =>
          s.probeLines().length > 0 ? s.probeLines() : undefined,
        );
        assert.equal(lines[0]?.state, "active", JSON.stringify(lines[0]));
        assert.deepEqual(identityFiles(s.stateRoot), [`${bound}.json`]);
        const envelope = JSON.parse(
          NodeFS.readFileSync(NodePath.join(s.stateRoot, "identity", `${bound}.json`), "utf8"),
        ) as { record: { kind: string } };
        assert.equal(envelope.record.kind, "main");
        assert.notInclude(s.launches[0]?.args ?? [], "--session-id");
      }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live("a request serves one launch only: the next session of the thread gets Pi's own id", () =>
    Effect.gen(function* () {
      const s = yield* scratch();
      const chosen = NodeCrypto.randomUUID();
      requestPiSessionId(THREAD, chosen);
      assert.equal(yield* openAndEnsure(s), chosen);
      // No request is left: a second launch for the same thread is an ordinary one.
      const second = yield* scratch();
      const other = yield* openAndEnsure(second);
      assert.notEqual(other, chosen);
      assert.notInclude(second.launches[0]?.args ?? [], "--session-id");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live("an id Pi would refuse is never passed, and a withdrawn request is never used", () =>
    Effect.gen(function* () {
      const s = yield* scratch();
      requestPiSessionId(THREAD, "not a valid id!");
      const bound = yield* openAndEnsure(s);
      assert.notInclude(s.launches[0]?.args ?? [], "--session-id");
      assert.notEqual(bound, "not a valid id!");
      const t = yield* scratch();
      requestPiSessionId(THREAD, NodeCrypto.randomUUID());
      withdrawPiSessionIdRequest(THREAD);
      yield* openAndEnsure(t);
      assert.notInclude(t.launches[0]?.args ?? [], "--session-id");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.live(
    "a fork's request (key `fork:<threadId>`) is not consumed by the same thread's own open launch, and is withdrawable",
    () =>
      Effect.gen(function* () {
        const s = yield* scratch();
        const chosen = NodeCrypto.randomUUID();
        requestPiSessionId(forkSlotKey(THREAD), chosen);
        yield* openAndEnsure(s);
        assert.notInclude(
          s.launches[0]?.args ?? [],
          "--session-id",
          "the thread's own launch asks for its plain key",
        );
        const seam = (
          globalThis as Record<symbol, { take(id: string): string | undefined } | undefined>
        )[Symbol.for("aetheria.pi.session-id-seam")];
        assert.equal(seam?.take(forkSlotKey(THREAD)), chosen, "the fork's request was still there");
        requestPiSessionId(forkSlotKey(THREAD), chosen);
        withdrawPiSessionIdRequest(forkSlotKey(THREAD));
        assert.isUndefined(seam?.take(forkSlotKey(THREAD)));
      }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it("a user's own --session-id launch argument is still refused (the block is for users and stays)", () => {
    const refused = resolvePiLaunchArgs("--session-id 11111111-2222-3333-4444-555555555555");
    assert.isFalse(refused.ok);
  });
});
