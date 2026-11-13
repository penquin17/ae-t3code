// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
// AETHERIA M04 Plan step 13 — the Backend's thread/provider-session -> Pi-session index.
//
// Boundary: the real index over a real temporary folder, with Node's real filesystem (fault injection only where a test names it).
// Shows: ids that are not path-safe are encoded; the file is owner-only and replaced atomically; an interrupted write leaves the earlier
// binding whole and no temporary file; a truncated, linked, loose or misfiled file is reported, never trusted; the index never touches M03's
// identity folder and never carries into it. Does not show: durability across power loss (no directory fsync) or a second Backend process.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createThreadIndex, type BindInput, type ThreadIndexFs } from "./threadIndex.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  mainRecord,
  rootOf,
  sessionFileOf,
  snapshot,
  writeEnvelope,
} from "./testkit.ts";

const input = (over: Partial<BindInput> = {}): BindInput => ({
  threadId: THREAD,
  providerSessionId: "prov-1",
  providerInstanceId: "pi",
  sessionFile: sessionFileOf(SESSION),
  workingFolder: FOLDER,
  ...over,
});

const make = (
  options: { fs?: Partial<ThreadIndexFs>; projectRootOf?: (folder: string) => string | null } = {},
) => {
  const stateRoot = rootOf();
  const index = createThreadIndex({
    stateRoot,
    projectRootOf: options.projectRootOf ?? ((folder) => folder),
    now: () => 1000,
    ...(options.fs === undefined ? {} : { fs: options.fs }),
  });
  return { stateRoot, index, dir: NodePath.join(stateRoot, "thread-index") };
};
const digestName = (threadId: string) =>
  `${NodeCrypto.createHash("sha256").update(threadId).digest("hex")}.json`;
const files = (dir: string) => NodeFS.readdirSync(dir).sort();

describe("binding a thread", () => {
  it("encodes a thread id that is not path-safe as a digest-named, owner-only file", () => {
    const { index, dir } = make();
    const result = index.bind(input());
    expect(result).toMatchObject({ ok: true, change: "created" });
    expect(THREAD).toContain(":");
    expect(files(dir)).toEqual([digestName(THREAD)]);
    expect(NodeFS.lstatSync(dir).mode & 0o777).toBe(0o700);
    expect(NodeFS.lstatSync(NodePath.join(dir, digestName(THREAD))).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, digestName(THREAD)), "utf8"));
    expect(stored).toMatchObject({
      v: 1,
      threadId: THREAD,
      providerInstanceId: "pi",
      providerSessionId: "prov-1",
      sessionId: SESSION,
      evidence: "filename",
      projectRoot: FOLDER,
      boundAt: 1000,
    });
    const found = index.lookup(THREAD);
    expect(found.status === "ok" && found.binding.sessionId).toBe(SESSION);
  });

  it("never writes into, or reads state from, M03's identity folder, and adds no thread id to a record", () => {
    const { index, stateRoot } = make();
    writeEnvelope(stateRoot, mainRecord(SESSION));
    const before = snapshot(NodePath.join(stateRoot, "identity"));
    index.bind(input());
    index.boot();
    expect(snapshot(NodePath.join(stateRoot, "identity"))).toEqual(before);
    expect(
      NodeFS.readFileSync(NodePath.join(stateRoot, "identity", `${SESSION}.json`), "utf8"),
    ).not.toContain("mcp:");
  });

  it("answers an identical re-bind without writing again", () => {
    let renames = 0;
    const { index } = make({
      fs: {
        renameSync: (from, to) => {
          renames += 1;
          NodeFS.renameSync(from, to);
        },
      },
    });
    expect(index.bind(input())).toMatchObject({ ok: true, change: "created" });
    expect(index.bind(input())).toMatchObject({ ok: true, change: "unchanged" });
    expect(renames).toBe(1);
  });

  it("replaces the binding when the provider session or the Pi session changes, and the reverse view follows", () => {
    const { index } = make();
    index.bind(input());
    expect(index.bind(input({ providerSessionId: "prov-2" }))).toMatchObject({
      ok: true,
      change: "replaced",
    });
    expect(index.threadsOf(SESSION)).toEqual([THREAD]);
    expect(
      index.bind(input({ providerSessionId: "prov-2", sessionFile: sessionFileOf(SESSION_B) })),
    ).toMatchObject({ ok: true, change: "replaced" });
    expect(index.threadsOf(SESSION)).toEqual([]);
    expect(index.threadsOf(SESSION_B)).toEqual([THREAD]);
    const found = index.lookup(THREAD);
    expect(found.status === "ok" && found.binding.providerSessionId).toBe("prov-2");
  });

  it("refuses a Pi session that another thread already holds, and leaves both as they were", () => {
    const { index, dir } = make();
    index.bind(input());
    const refused = index.bind(input({ threadId: THREAD_B, providerSessionId: "prov-9" }));
    expect(refused).toMatchObject({ ok: false, code: "INDEX_SESSION_BOUND_ELSEWHERE" });
    expect(index.lookup(THREAD_B)).toEqual({ status: "absent" });
    expect(files(dir)).toEqual([digestName(THREAD)]);
  });

  it("projects an unresolvable folder to an unknown project root, not a guess", () => {
    const { index } = make({
      projectRootOf: () => {
        throw new Error("no marker");
      },
    });
    expect(index.bind(input())).toMatchObject({ ok: true });
    const found = index.lookup(THREAD);
    expect(found.status === "ok" && found.binding.projectRoot).toBeNull();
  });

  it.each([
    ["an empty thread id", { threadId: "" }],
    ["a thread id with a NUL", { threadId: "mcp:a\0b" }],
    ["a thread id over 256 characters", { threadId: "t".repeat(257) }],
    ["an empty provider session id", { providerSessionId: "" }],
    ["a non-string provider instance", { providerInstanceId: 7 as unknown as string }],
    ["a relative working folder", { workingFolder: "project" }],
    ["a relative session file", { sessionFile: "2026-11-08T08-00-00-000Z_x.jsonl" }],
  ] as const)("refuses %s before creating anything", (_name, over) => {
    const { index, dir } = make();
    expect(index.bind(input(over as Partial<BindInput>))).toMatchObject({
      ok: false,
      code: "INDEX_BAD_INPUT",
    });
    expect(NodeFS.existsSync(dir)).toBe(false);
  });

  it("refuses an index folder that is loose or a link", () => {
    const loose = make();
    NodeFS.mkdirSync(loose.dir, { mode: 0o755 });
    NodeFS.chmodSync(loose.dir, 0o755);
    expect(loose.index.bind(input())).toMatchObject({ ok: false, code: "INDEX_UNSAFE_PATH" });
    const linked = make();
    const target = rootOf();
    NodeFS.symlinkSync(target, linked.dir);
    expect(linked.index.bind(input())).toMatchObject({ ok: false, code: "INDEX_UNSAFE_PATH" });
    expect(NodeFS.readdirSync(target)).toEqual([]);
  });
});

describe("the Pi session identity comes from the session file", () => {
  const sessionDir = () => {
    const dir = rootOf();
    return dir;
  };
  const header = (id: string) =>
    `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-11-08T08:00:00.000Z", cwd: FOLDER })}\n{"type":"message"}\n`;

  it("prefers the header's id and records that evidence", () => {
    const { index } = make();
    const dir = sessionDir();
    const file = sessionFileOf(SESSION, dir);
    NodeFS.writeFileSync(file, header(SESSION));
    expect(index.bind(input({ sessionFile: file }))).toMatchObject({ ok: true });
    const found = index.lookup(THREAD);
    expect(found.status === "ok" && found.binding.evidence).toBe("header");
  });

  it("refuses a header that disagrees with the file name", () => {
    const { index, dir } = make();
    const sdir = sessionDir();
    const file = sessionFileOf(SESSION, sdir);
    NodeFS.writeFileSync(file, header(SESSION_B));
    expect(index.bind(input({ sessionFile: file }))).toMatchObject({
      ok: false,
      code: "INDEX_SESSION_CONFLICT",
    });
    expect(NodeFS.existsSync(dir)).toBe(false);
  });

  it("refuses a first line that is not a session header", () => {
    const { index } = make();
    const sdir = sessionDir();
    const file = sessionFileOf(SESSION, sdir);
    NodeFS.writeFileSync(file, `${JSON.stringify({ type: "message", id: SESSION })}\n`);
    expect(index.bind(input({ sessionFile: file }))).toMatchObject({
      ok: false,
      code: "INDEX_SESSION_CONFLICT",
    });
  });

  it("takes the id from a header when the file name is not Pi's usual form", () => {
    const { index } = make();
    const sdir = sessionDir();
    const file = NodePath.join(sdir, "custom.jsonl");
    NodeFS.writeFileSync(file, header(SESSION));
    expect(index.bind(input({ sessionFile: file }))).toMatchObject({ ok: true });
    expect(index.threadsOf(SESSION)).toEqual([THREAD]);
  });

  it("uses the file name when Pi has not written the file yet, and refuses a name it cannot read an id from", () => {
    const { index } = make();
    expect(index.bind(input({ sessionFile: "/sessions/not-yet/custom.jsonl" }))).toMatchObject({
      ok: false,
      code: "INDEX_SESSION_UNRECOGNISED",
    });
    expect(index.bind(input())).toMatchObject({ ok: true });
  });

  it("reads a link as nothing at all", () => {
    const { index } = make();
    const sdir = sessionDir();
    const real = NodePath.join(sdir, "real.jsonl");
    NodeFS.writeFileSync(real, header(SESSION_B));
    const file = sessionFileOf(SESSION, sdir);
    NodeFS.symlinkSync(real, file);
    expect(index.bind(input({ sessionFile: file }))).toMatchObject({ ok: false });
  });
});

describe("an interrupted write", () => {
  it("leaves the earlier binding whole and no temporary file when the rename fails", () => {
    let fail = false;
    const { index, dir } = make({
      fs: {
        renameSync: (from, to) => {
          if (fail) throw new Error("injected rename failure");
          NodeFS.renameSync(from, to);
        },
      },
    });
    index.bind(input());
    const before = NodeFS.readFileSync(NodePath.join(dir, digestName(THREAD)), "utf8");
    fail = true;
    expect(index.bind(input({ providerSessionId: "prov-2" }))).toMatchObject({
      ok: false,
      code: "INDEX_IO",
    });
    expect(NodeFS.readFileSync(NodePath.join(dir, digestName(THREAD)), "utf8")).toBe(before);
    expect(files(dir)).toEqual([digestName(THREAD)]);
    expect(index.threadsOf(SESSION)).toEqual([THREAD]);
  });

  it("leaves nothing when the temporary file cannot be completed", () => {
    const { index, dir } = make({
      fs: {
        writeSync: () => {
          throw new Error("injected write failure");
        },
      },
    });
    expect(index.bind(input())).toMatchObject({ ok: false, code: "INDEX_IO" });
    expect(files(dir)).toEqual([]);
    expect(index.lookup(THREAD)).toEqual({ status: "absent" });
  });

  it("keeps the earlier binding when a crash left a half-written temporary file; boot removes only that file", () => {
    const { index, dir, stateRoot } = make();
    index.bind(input());
    NodeFS.writeFileSync(NodePath.join(dir, ".tmp-dead"), '{"v":1,"threadId":"mcp:half', {
      mode: 0o600,
    });
    const cold = createThreadIndex({
      stateRoot,
      projectRootOf: (folder) => folder,
      now: () => 2000,
    });
    const report = cold.boot();
    expect(report).toMatchObject({ loaded: 1, removedTemps: 1, corrupt: [], duplicates: [] });
    expect(files(dir)).toEqual([digestName(THREAD)]);
    expect(cold.lookup(THREAD)).toMatchObject({ status: "ok" });
  });

  it("reports a truncated binding as corrupt without repairing it, and the next bind replaces it", () => {
    const { index, dir } = make();
    index.bind(input());
    const path = NodePath.join(dir, digestName(THREAD));
    NodeFS.writeFileSync(path, '{"v":1,"threadId":"mcp:6f1c', { mode: 0o600 });
    expect(index.lookup(THREAD)).toMatchObject({ status: "corrupt" });
    expect(NodeFS.readFileSync(path, "utf8")).toBe('{"v":1,"threadId":"mcp:6f1c');
    expect(index.boot().corrupt).toHaveLength(1);
    expect(index.bind(input())).toMatchObject({ ok: true, change: "replaced" });
    expect(index.lookup(THREAD)).toMatchObject({ status: "ok" });
  });
});

describe("a stored binding that cannot be trusted", () => {
  it("is corrupt when it is loose, a link, or names another thread than its file does", () => {
    const { index, dir } = make();
    index.bind(input());
    const path = NodePath.join(dir, digestName(THREAD));
    NodeFS.chmodSync(path, 0o644);
    expect(index.lookup(THREAD)).toMatchObject({ status: "corrupt" });
    NodeFS.chmodSync(path, 0o600);
    expect(index.lookup(THREAD)).toMatchObject({ status: "ok" });
    // the same bytes filed under the other thread's name
    NodeFS.writeFileSync(NodePath.join(dir, digestName(THREAD_B)), NodeFS.readFileSync(path), {
      mode: 0o600,
    });
    expect(index.lookup(THREAD_B)).toMatchObject({ status: "corrupt" });
    // a link in place of the file
    NodeFS.unlinkSync(NodePath.join(dir, digestName(THREAD_B)));
    NodeFS.symlinkSync(path, NodePath.join(dir, digestName(THREAD_B)));
    expect(index.lookup(THREAD_B)).toMatchObject({ status: "corrupt" });
  });

  it("is corrupt when its fields are not the ones a binding has", () => {
    const { index, dir } = make();
    index.bind(input());
    const path = NodePath.join(dir, digestName(THREAD));
    const good = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    for (const bad of [
      { ...good, v: 2 },
      { ...good, sessionId: "../escape" },
      { ...good, providerInstanceId: 5 },
      { ...good, extra: true },
      { ...good, evidence: "guess" },
    ]) {
      NodeFS.writeFileSync(path, JSON.stringify(bad), { mode: 0o600 });
      expect(index.lookup(THREAD)).toMatchObject({ status: "corrupt" });
    }
  });
});

describe("a cold start", () => {
  it("rebuilds the reverse view from disk and reports two threads holding one session", () => {
    const { index, dir, stateRoot } = make();
    index.bind(input());
    const cold = createThreadIndex({
      stateRoot,
      projectRootOf: (folder) => folder,
      now: () => 2000,
    });
    expect(cold.threadsOf(SESSION)).toEqual([THREAD]);
    // a hand-made second claim on the same session (the index never writes one)
    const stored = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, digestName(THREAD)), "utf8"));
    NodeFS.writeFileSync(
      NodePath.join(dir, digestName(THREAD_B)),
      JSON.stringify({ ...stored, threadId: THREAD_B }),
      { mode: 0o600 },
    );
    const again = createThreadIndex({
      stateRoot,
      projectRootOf: (folder) => folder,
      now: () => 3000,
    });
    const report = again.boot();
    expect(report.duplicates).toEqual([
      { sessionId: SESSION, threadIds: [THREAD, THREAD_B].sort() },
    ]);
    expect([...again.threadsOf(SESSION)].sort()).toEqual([THREAD, THREAD_B].sort());
  });

  it("reads an absent folder as an empty index and creates nothing", () => {
    const { index, dir } = make();
    expect(index.boot()).toMatchObject({ loaded: 0, removedTemps: 0 });
    expect(index.lookup(THREAD)).toEqual({ status: "absent" });
    expect(NodeFS.existsSync(dir)).toBe(false);
  });
});

const SESSION_C = "0197d3c0-3333-7000-8000-000000000003";

describe("a replaced session stays a read-only alias of its thread", () => {
  const rebound = (index: ReturnType<typeof make>["index"]) => {
    index.bind(input());
    return index.bind(
      input({ providerSessionId: "prov-2", sessionFile: sessionFileOf(SESSION_B) }),
    );
  };

  it("keeps the strict live reads unchanged: the replaced session is no one's live binding", () => {
    const { index } = make();
    rebound(index);
    expect(index.bindingOfSession(SESSION)).toBeUndefined();
    expect(index.threadsOf(SESSION)).toEqual([]);
    expect(index.sessions()).toEqual([SESSION_B]);
    expect(index.bindingOfSession(SESSION_B)?.threadId).toBe(THREAD);
  });

  it("resolves the replaced session to the thread's current binding, marked retired, with when and by what it was replaced", () => {
    const { index } = make();
    rebound(index);
    const alias = index.aliasOfSession(SESSION);
    expect(alias).toMatchObject({
      retired: true,
      binding: { threadId: THREAD, sessionId: SESSION_B },
      retiredSession: {
        sessionId: SESSION,
        providerSessionId: "prov-1",
        providerInstanceId: "pi",
        evidence: "filename",
        replacedBy: SESSION_B,
        retiredAt: 1000,
      },
    });
    expect(index.aliasOfSession(SESSION_B)).toMatchObject({
      retired: false,
      binding: { sessionId: SESSION_B },
    });
    expect(index.aliasOfSession("0197d3c0-9999-7000-8000-000000000009")).toBeUndefined();
  });

  it("keeps every replaced session of a chain, and a session that came back is live again", () => {
    const { index } = make();
    rebound(index);
    index.bind(input({ providerSessionId: "prov-3", sessionFile: sessionFileOf(SESSION_C) }));
    expect(index.aliasOfSession(SESSION)).toMatchObject({ retired: true });
    expect(index.aliasOfSession(SESSION_B)).toMatchObject({ retired: true });
    expect(index.aliasOfSession(SESSION_C)).toMatchObject({ retired: false });
    index.bind(input({ providerSessionId: "prov-4", sessionFile: sessionFileOf(SESSION) }));
    expect(index.aliasOfSession(SESSION)).toMatchObject({ retired: false });
    expect(index.bindingOfSession(SESSION)?.threadId).toBe(THREAD);
    expect(index.aliasOfSession(SESSION_C)).toMatchObject({ retired: true });
    expect(index.aliasOfSession(SESSION_B)).toMatchObject({ retired: true });
  });

  it("does not retire a session when only its provider session changes", () => {
    const { index } = make();
    index.bind(input());
    index.bind(input({ providerSessionId: "prov-2" }));
    const found = index.lookup(THREAD);
    expect(found.status === "ok" && found.binding.retired).toBeUndefined();
  });

  it("refuses another thread's claim on a replaced session", () => {
    const { index } = make();
    rebound(index);
    const refused = index.bind(
      input({
        threadId: THREAD_B,
        providerSessionId: "prov-9",
        sessionFile: sessionFileOf(SESSION),
      }),
    );
    expect(refused).toMatchObject({ ok: false, code: "INDEX_SESSION_BOUND_ELSEWHERE" });
    expect(index.aliasOfSession(SESSION)).toMatchObject({ retired: true });
  });

  it("is persisted with the thread's one file, so a cold start and a boot keep the alias", () => {
    const { index, stateRoot, dir } = make();
    rebound(index);
    expect(files(dir)).toEqual([digestName(THREAD)]);
    const cold = createThreadIndex({ stateRoot, now: () => 5000 });
    expect(cold.aliasOfSession(SESSION)).toMatchObject({
      retired: true,
      binding: { sessionId: SESSION_B },
      retiredSession: { retiredAt: 1000 },
    });
    expect(cold.bindingOfSession(SESSION)).toBeUndefined();
    const booted = createThreadIndex({ stateRoot, now: () => 6000 });
    expect(booted.boot()).toMatchObject({ loaded: 1, corrupt: [] });
    expect(booted.aliasOfSession(SESSION)).toMatchObject({ retired: true });
  });

  it("loads an older file that has no retired field, and writes none until a session is replaced", () => {
    const { index, stateRoot, dir } = make();
    index.bind(input());
    const path = NodePath.join(dir, digestName(THREAD));
    const stored = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    expect("retired" in stored).toBe(false);
    const older = createThreadIndex({ stateRoot, now: () => 2000 });
    const found = older.lookup(THREAD);
    expect(found).toMatchObject({ status: "ok", binding: { sessionId: SESSION } });
    expect(older.aliasOfSession(SESSION)).toMatchObject({ retired: false });
    older.bind(input({ providerSessionId: "prov-2", sessionFile: sessionFileOf(SESSION_B) }));
    expect(older.aliasOfSession(SESSION)).toMatchObject({
      retired: true,
      retiredSession: { retiredAt: 2000 },
    });
  });

  it("reads a damaged retired list as corrupt, never as an alias", () => {
    const { index, stateRoot, dir } = make();
    rebound(index);
    const path = NodePath.join(dir, digestName(THREAD));
    const good = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    const entry = good.retired[0];
    for (const bad of [
      { ...good, retired: "x" },
      { ...good, retired: [{ ...entry, extra: 1 }] },
      { ...good, retired: [{ ...entry, sessionId: "../escape" }] },
      { ...good, retired: [{ ...entry, retiredAt: "later" }] },
      { ...good, retired: [{ ...entry, sessionId: good.sessionId }] },
      { ...good, retired: [entry, entry] },
    ]) {
      NodeFS.writeFileSync(path, JSON.stringify(bad), { mode: 0o600 });
      expect(index.lookup(THREAD)).toMatchObject({ status: "corrupt" });
      const cold = createThreadIndex({ stateRoot, now: () => 1 });
      expect(cold.aliasOfSession(SESSION)).toBeUndefined();
    }
  });
});
