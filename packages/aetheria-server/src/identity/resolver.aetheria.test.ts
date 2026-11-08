// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 13 — the Backend's read-only caller-identity resolver (R2).
//
// Boundary: the real resolver over the real read-only reader from the pinned archive, the real thread index, and M03-format record files
// on a real temporary folder. Shows: a bearer's thread/provider facts resolve to the right Pi session only when the index, the active
// record and the ordered lineage agree; every disagreement is `refused` and every unknown is `unavailable`, never main; a resolution leaves
// identity bytes, modes and times unchanged. Does not show: the HTTP transport's bearer resolution (step 11's route tests), the Agent
// host's writer, or authority (the resolver returns identity facts; M03's `identityOf` derives authority in the Agent host).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createIdentityReader, type IdentityReader } from "./backendEntry.ts";
import {
  createIdentityResolver,
  XC6_IDENTITY_INCONSISTENT,
  XC6_IDENTITY_MISMATCH,
  XC6_IDENTITY_RETIRED,
  XC6_IDENTITY_UNAVAILABLE,
  type IdentityCaller,
} from "./resolver.ts";
import { createThreadIndex, type BindInput } from "./threadIndex.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  childRecord,
  mainRecord,
  rootOf,
  sessionFileOf,
  snapshot,
  writeEnvelope,
} from "./testkit.ts";

const THREAD_C = "mcp:99999999-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const SESSION_C = "0197d3c0-3333-7000-8000-000000000003";
const SESSION_D = "0197d3c0-4444-7000-8000-000000000004";

function world(
  options: { maxDepth?: number; reader?: (real: IdentityReader) => IdentityReader } = {},
) {
  const stateRoot = rootOf();
  const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder, now: () => 1 });
  const real = createIdentityReader({ stateRoot });
  const resolver = createIdentityResolver({
    reader: options.reader?.(real) ?? real,
    index,
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
  });
  const bind = (threadId: string, sessionId: string, over: Partial<BindInput> = {}) => {
    const result = index.bind({
      threadId,
      providerSessionId: `prov-${threadId.slice(-4)}`,
      providerInstanceId: "pi",
      sessionFile: sessionFileOf(sessionId),
      workingFolder: FOLDER,
      ...over,
    });
    if (!result.ok) throw new Error(`bind failed: ${result.code}`);
  };
  const callerOf = (threadId: string, over: Partial<IdentityCaller> = {}): IdentityCaller => ({
    threadId,
    providerSessionId: `prov-${threadId.slice(-4)}`,
    providerInstanceId: "pi",
    ...over,
  });
  return { stateRoot, index, resolver, bind, callerOf };
}
type World = ReturnType<typeof world>;

/** A main session in THREAD with an active record, resolvable by its own caller. */
function mainWorld(options: Parameters<typeof world>[0] = {}): World {
  const w = world(options);
  writeEnvelope(w.stateRoot, mainRecord(SESSION));
  w.bind(THREAD, SESSION);
  return w;
}

describe("a main session", () => {
  it("resolves from the bearer's thread and provider facts to the right Pi session", () => {
    const w = mainWorld();
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toEqual({
      ok: true,
      sessionId: SESSION,
      kind: "main",
      rootSessionId: SESSION,
      parentChain: [],
      role: null,
    });
  });

  it("resolves without a claimed session id, from the index alone", () => {
    const w = mainWorld();
    expect(w.resolver.resolve(w.callerOf(THREAD), null)).toMatchObject({
      ok: true,
      sessionId: SESSION,
    });
  });

  it("returns a frozen result that cannot be edited into another identity", () => {
    const w = mainWorld();
    const result = w.resolver.resolve(w.callerOf(THREAD), SESSION);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as { sessionId: string }).sessionId = "other";
    }).toThrow();
  });

  it("leaves identity and index bytes, modes and times unchanged, in every outcome", () => {
    const w = mainWorld();
    writeEnvelope(w.stateRoot, mainRecord(SESSION_B), { state: "retired" });
    writeEnvelope(w.stateRoot, mainRecord(SESSION_C), { raw: "not json" });
    w.bind(THREAD_B, SESSION_B);
    w.bind(THREAD_C, SESSION_C);
    const before = snapshot(w.stateRoot);
    const answers = [
      w.resolver.resolve(w.callerOf(THREAD), SESSION),
      w.resolver.resolve(w.callerOf(THREAD_B), SESSION_B),
      w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C),
      w.resolver.resolve(w.callerOf("mcp:unbound"), null),
      w.resolver.resolve(w.callerOf(THREAD), SESSION_B),
    ];
    expect(answers.map((a) => (a.ok ? "ok" : a.code))).toEqual([
      "ok",
      XC6_IDENTITY_RETIRED,
      XC6_IDENTITY_UNAVAILABLE,
      XC6_IDENTITY_UNAVAILABLE,
      XC6_IDENTITY_MISMATCH,
    ]);
    expect(snapshot(w.stateRoot)).toEqual(before);
  });

  it("takes nothing from extra properties a caller object carries", () => {
    const w = mainWorld();
    const hostile = {
      ...w.callerOf(THREAD),
      sessionId: SESSION_B,
      kind: "main",
      rootSessionId: SESSION_B,
      role: "root",
    } as unknown as IdentityCaller;
    expect(w.resolver.resolve(hostile, SESSION)).toMatchObject({
      ok: true,
      sessionId: SESSION,
      kind: "main",
      rootSessionId: SESSION,
    });
    expect(w.resolver.resolve(hostile, SESSION_B)).toMatchObject({
      ok: false,
      code: XC6_IDENTITY_MISMATCH,
    });
  });
});

describe("a caller that does not match", () => {
  it("is unavailable when its thread has no binding (a launch that has not been indexed), never main", () => {
    const w = mainWorld();
    expect(w.resolver.resolve(w.callerOf(THREAD_B), null)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      code: XC6_IDENTITY_UNAVAILABLE,
      reason: "no-binding",
    });
    expect(w.resolver.resolve(w.callerOf(THREAD_B), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
    });
  });

  it("is refused for a wrong provider instance", () => {
    const w = mainWorld();
    expect(
      w.resolver.resolve(w.callerOf(THREAD, { providerInstanceId: "other" }), SESSION),
    ).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_MISMATCH,
      reason: "provider-instance",
    });
  });

  it("is unavailable, not trusted, for a provider session the index does not hold (a resume that is not yet indexed)", () => {
    const w = mainWorld();
    expect(
      w.resolver.resolve(w.callerOf(THREAD, { providerSessionId: "prov-old" }), SESSION),
    ).toMatchObject({ ok: false, outcome: "unavailable", reason: "provider-session-stale" });
    w.bind(THREAD, SESSION, { providerSessionId: "prov-old" });
    expect(
      w.resolver.resolve(w.callerOf(THREAD, { providerSessionId: "prov-old" }), SESSION),
    ).toMatchObject({ ok: true, sessionId: SESSION });
  });

  it("is refused when the claimed Pi session is not the one its thread is bound to", () => {
    const w = mainWorld();
    writeEnvelope(w.stateRoot, mainRecord(SESSION_B));
    w.bind(THREAD_B, SESSION_B);
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION_B)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_MISMATCH,
      reason: "session-claim",
    });
  });

  it("is unavailable, not refused, for a claim that is not a session id at all", () => {
    const w = mainWorld();
    for (const claim of ["", "../x", "a/b", "x".repeat(200)])
      expect(w.resolver.resolve(w.callerOf(THREAD), claim)).toMatchObject({
        ok: false,
        outcome: "unavailable",
      });
  });

  it.each([
    ["empty thread id", { threadId: "" }],
    ["thread id over 256 characters", { threadId: "t".repeat(257) }],
    ["empty provider session id", { providerSessionId: "" }],
    ["non-string provider instance", { providerInstanceId: 4 as unknown as string }],
  ])("is unavailable for a %s", (_name, over) => {
    const w = mainWorld();
    expect(
      w.resolver.resolve(w.callerOf(THREAD, over as Partial<IdentityCaller>), SESSION),
    ).toMatchObject({ ok: false, outcome: "unavailable", reason: "bad-caller" });
  });

  it("is refused when the bearer's subagent flag contradicts the one recorded at launch, and passes when they agree or one is unknown", () => {
    const w = world();
    writeEnvelope(w.stateRoot, mainRecord(SESSION));
    w.bind(THREAD, SESSION, { subagent: false });
    expect(w.resolver.resolve(w.callerOf(THREAD, { subagent: true }), SESSION)).toMatchObject({
      ok: false,
      code: XC6_IDENTITY_MISMATCH,
      reason: "subagent-flag",
    });
    expect(w.resolver.resolve(w.callerOf(THREAD, { subagent: false }), SESSION)).toMatchObject({
      ok: true,
    });
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({ ok: true });
  });

  it("is refused when two threads hold one Pi session", () => {
    const w = mainWorld();
    const dir = NodePath.join(w.stateRoot, "thread-index");
    // a hand-made second claim: the index itself refuses to write one
    const first = w.index.lookup(THREAD);
    if (first.status !== "ok") throw new Error("bound");
    const name = `${NodeCrypto.createHash("sha256").update(THREAD_B).digest("hex")}.json`;
    NodeFS.writeFileSync(
      NodePath.join(dir, name),
      JSON.stringify({ ...first.binding, threadId: THREAD_B, providerSessionId: "prov-B" }),
      { mode: 0o600 },
    );
    NodeFS.chmodSync(NodePath.join(dir, name), 0o600);
    const reloaded = createIdentityResolver({
      reader: createIdentityReader({ stateRoot: w.stateRoot }),
      index: createThreadIndex({ stateRoot: w.stateRoot }),
    });
    expect(reloaded.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
      reason: "session-bound-to-many",
    });
  });

  it("is unavailable when the stored binding is corrupt", () => {
    const w = mainWorld();
    NodeFS.writeFileSync(
      NodePath.join(
        w.stateRoot,
        "thread-index",
        `${NodeCrypto.createHash("sha256").update(THREAD).digest("hex")}.json`,
      ),
      "{",
      { mode: 0o600 },
    );
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "binding-corrupt",
    });
  });
});

describe("the identity record", () => {
  it("is unavailable while the launch awaits Pi's record, and never main", () => {
    const w = world();
    w.bind(THREAD, SESSION);
    const answer = w.resolver.resolve(w.callerOf(THREAD), SESSION);
    expect(answer).toMatchObject({
      ok: false,
      outcome: "unavailable",
      code: XC6_IDENTITY_UNAVAILABLE,
      reason: "record-awaited",
    });
    expect("kind" in answer).toBe(false);
  });

  it("is refused once retired, so a retired session cannot act", () => {
    const w = world();
    writeEnvelope(w.stateRoot, mainRecord(SESSION), { state: "retired" });
    w.bind(THREAD, SESSION);
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_RETIRED,
    });
  });

  it("is unavailable when corrupt, loose or misfiled", () => {
    const corrupt = world();
    writeEnvelope(corrupt.stateRoot, mainRecord(SESSION), { raw: "{" });
    corrupt.bind(THREAD, SESSION);
    expect(corrupt.resolver.resolve(corrupt.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-corrupt",
    });

    const loose = world();
    const path = writeEnvelope(loose.stateRoot, mainRecord(SESSION));
    NodeFS.chmodSync(path, 0o644);
    loose.bind(THREAD, SESSION);
    expect(loose.resolver.resolve(loose.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-corrupt",
    });

    const misfiled = world();
    writeEnvelope(misfiled.stateRoot, mainRecord(SESSION_B), { fileStem: SESSION });
    misfiled.bind(THREAD, SESSION);
    expect(misfiled.resolver.resolve(misfiled.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-corrupt",
    });
  });

  it("is unavailable when the stored record fails M03's validation, including a main record that claims a parent", () => {
    const w = world();
    writeEnvelope(w.stateRoot, { ...mainRecord(SESSION), parentChain: [SESSION_B] });
    w.bind(THREAD, SESSION);
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-invalid",
    });
  });

  it("is unavailable, not trusted, when the reader throws or answers for another session", () => {
    const throwing = mainWorld({
      reader: () => ({
        read: () => {
          throw new Error("disk");
        },
      }),
    });
    expect(throwing.resolver.resolve(throwing.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-unreadable",
    });
    const swapped = mainWorld({
      reader: (real) => ({ read: (id) => real.read(id === SESSION ? SESSION_B : id) }),
    });
    writeEnvelope(swapped.stateRoot, mainRecord(SESSION_B));
    expect(swapped.resolver.resolve(swapped.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "record-invalid",
    });
  });

  it("is refused when the binding asserts a role the record does not have", () => {
    const w = world();
    writeEnvelope(w.stateRoot, mainRecord(SESSION));
    w.bind(THREAD, SESSION, { expectedRole: "worker" });
    expect(w.resolver.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_MISMATCH,
      reason: "role-mismatch",
    });
  });

  it("survives a cold start: a new index and reader over the same folders resolve the same identity", () => {
    const w = mainWorld();
    const cold = createIdentityResolver({
      reader: createIdentityReader({ stateRoot: w.stateRoot }),
      index: createThreadIndex({ stateRoot: w.stateRoot }),
    });
    expect(cold.resolve(w.callerOf(THREAD), SESSION)).toMatchObject({
      ok: true,
      sessionId: SESSION,
    });
  });
});

/** Root SESSION (thread THREAD) -> child SESSION_B (THREAD_B) -> grandchild SESSION_C (THREAD_C). */
function family(
  over: {
    child?: Partial<ReturnType<typeof childRecord>>;
    grand?: Partial<ReturnType<typeof childRecord>>;
    root?: ReturnType<typeof mainRecord> | ReturnType<typeof childRecord>;
  } = {},
) {
  const w = world();
  writeEnvelope(w.stateRoot, over.root ?? mainRecord(SESSION));
  writeEnvelope(w.stateRoot, { ...childRecord(SESSION_B, SESSION, [SESSION]), ...over.child });
  writeEnvelope(w.stateRoot, {
    ...childRecord(SESSION_C, SESSION, [SESSION, SESSION_B]),
    ...over.grand,
  });
  w.bind(THREAD, SESSION);
  w.bind(THREAD_B, SESSION_B);
  w.bind(THREAD_C, SESSION_C);
  return w;
}

describe("the lineage of a child", () => {
  it("resolves with its ordered chain, root and role when every ancestor agrees", () => {
    const w = family();
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toEqual({
      ok: true,
      sessionId: SESSION_C,
      kind: "child",
      rootSessionId: SESSION,
      parentChain: [SESSION, SESSION_B],
      role: "worker",
    });
    expect(w.resolver.resolve(w.callerOf(THREAD_B), SESSION_B)).toMatchObject({
      ok: true,
      parentChain: [SESSION],
    });
  });

  it("is unavailable when an ancestor's record is missing (a missing parent proves nothing)", () => {
    const w = family();
    NodeFS.unlinkSync(NodePath.join(w.stateRoot, "identity", `${SESSION_B}.json`));
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "lineage-unverifiable",
    });
  });

  it("is unavailable when an ancestor's record is corrupt, and refused when it is retired", () => {
    const corrupt = family();
    writeEnvelope(corrupt.stateRoot, mainRecord(SESSION_B), { raw: "{" });
    expect(corrupt.resolver.resolve(corrupt.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "lineage-unverifiable",
    });
    const retired = family();
    writeEnvelope(retired.stateRoot, childRecord(SESSION_B, SESSION, [SESSION]), {
      state: "retired",
    });
    expect(retired.resolver.resolve(retired.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
      reason: "lineage-ancestor-retired",
    });
  });

  it("is refused when the root named by the record is not the first of its chain", () => {
    const w = family({ grand: { rootSessionId: SESSION_D } });
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
      reason: "lineage-root",
    });
  });

  it("is refused when the root's record is not a main record", () => {
    const w = family({ root: childRecord(SESSION, SESSION, [SESSION_D]) });
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
    });
  });

  it("is refused when an ancestor's own chain is not the prefix of the child's chain", () => {
    const w = family({ child: { parentChain: [SESSION_D], rootSessionId: SESSION_D } });
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
      reason: "lineage-chain",
    });
  });

  it("is refused for a chain that repeats a session, names itself, or loops back", () => {
    const repeated = family({ grand: { parentChain: [SESSION, SESSION] } });
    expect(repeated.resolver.resolve(repeated.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      reason: "lineage-cycle",
    });
    const self = family({ grand: { parentChain: [SESSION, SESSION_C] } });
    expect(self.resolver.resolve(self.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      reason: "lineage-cycle",
    });
    // A names B as its parent while B names A: neither chain is a prefix of the other's
    const loop = world();
    writeEnvelope(loop.stateRoot, childRecord(SESSION, SESSION_B, [SESSION_B]));
    writeEnvelope(loop.stateRoot, childRecord(SESSION_B, SESSION, [SESSION]));
    loop.bind(THREAD, SESSION);
    loop.bind(THREAD_B, SESSION_B);
    expect(loop.resolver.resolve(loop.callerOf(THREAD), SESSION)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
    });
  });

  it("is refused when the chain is deeper than the resolver's bound, before any ancestor is read", () => {
    const w = world({ maxDepth: 2 });
    writeEnvelope(w.stateRoot, childRecord(SESSION_C, SESSION, [SESSION, SESSION_B, SESSION_D]));
    w.bind(THREAD_C, SESSION_C);
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      reason: "lineage-too-deep",
    });
  });

  it("is refused when the binding asserts a different role than the record", () => {
    const w = family();
    w.bind(THREAD_C, SESSION_C, { expectedRole: "reviewer" });
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_MISMATCH,
      reason: "role-mismatch",
    });
    w.bind(THREAD_C, SESSION_C, { expectedRole: "worker" });
    expect(w.resolver.resolve(w.callerOf(THREAD_C), SESSION_C)).toMatchObject({ ok: true });
  });

  it("is refused when an ancestor is in another project, and unavailable when its project cannot be checked", () => {
    const other = family();
    other.bind(THREAD_B, SESSION_B, { workingFolder: "/work/elsewhere" });
    expect(other.resolver.resolve(other.callerOf(THREAD_C), SESSION_C)).toMatchObject({
      ok: false,
      outcome: "refused",
      code: XC6_IDENTITY_INCONSISTENT,
      reason: "project-lineage-mismatch",
    });

    const unbound = world();
    writeEnvelope(unbound.stateRoot, mainRecord(SESSION));
    writeEnvelope(unbound.stateRoot, childRecord(SESSION_B, SESSION, [SESSION]));
    unbound.bind(THREAD_B, SESSION_B);
    expect(unbound.resolver.resolve(unbound.callerOf(THREAD_B), SESSION_B)).toMatchObject({
      ok: false,
      outcome: "unavailable",
      reason: "lineage-unverifiable",
    });
  });

  it("is unavailable when the child's own project root is unknown", () => {
    const stateRoot = rootOf();
    const index = createThreadIndex({ stateRoot, projectRootOf: () => null });
    writeEnvelope(stateRoot, mainRecord(SESSION));
    writeEnvelope(stateRoot, childRecord(SESSION_B, SESSION, [SESSION]));
    for (const [thread, session] of [
      [THREAD, SESSION],
      [THREAD_B, SESSION_B],
    ] as const) {
      index.bind({
        threadId: thread,
        providerSessionId: `prov-${thread.slice(-4)}`,
        providerInstanceId: "pi",
        sessionFile: sessionFileOf(session),
        workingFolder: FOLDER,
      });
    }
    const resolver = createIdentityResolver({ reader: createIdentityReader({ stateRoot }), index });
    expect(
      resolver.resolve(
        {
          threadId: THREAD_B,
          providerSessionId: `prov-${THREAD_B.slice(-4)}`,
          providerInstanceId: "pi",
        },
        SESSION_B,
      ),
    ).toMatchObject({ ok: false, outcome: "unavailable", reason: "lineage-unverifiable" });
    expect(
      resolver.resolve(
        {
          threadId: THREAD,
          providerSessionId: `prov-${THREAD.slice(-4)}`,
          providerInstanceId: "pi",
        },
        SESSION,
      ),
    ).toMatchObject({ ok: true });
  });
});
