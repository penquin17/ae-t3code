// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M10 Plan step 13 (D9, D10, XC-1/5/6/20/22) — the Backend's deliverable declaration store and its module.
//
// Boundary: the real store over real temporary folders (the state root, a working folder and real files, links, a FIFO and a file with no read permission). The snapshot store and T3's run
// projection are doubles (a map of snapshots per session; a function answering the caller's run): what they stand for is shown by `deliverablesService.aetheria.test.ts`, which runs the real snapshot
// store in the assembled Backend. It shows: what a declaration records and from where; each refusal writes nothing; a retry of either call writes nothing; the snapshot settles once and only for a
// snapshot the store opens for that session with the declared digest; the file is never repaired and a newer format is refused unread; every write is a whole-file replacement and a failed one leaves
// the previous file; the sequence declare → store → attach survives a lost reply or a stop at each boundary; drain waits for the call in flight. It does NOT show Linux, a second process writing the file
// (the owner lock is the Backend's, shown in the assembled test), or the bytes of any snapshot.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DELIVERABLES_ATTACH_SNAPSHOT_OPERATION,
  DELIVERABLES_DECLARE_OPERATION,
  DELIVERABLES_FORMAT_VERSION,
} from "@t3tools/aetheria-contracts";

import { rootOf } from "../identity/testkit.ts";
import {
  DELIVERABLES_BACKEND_ENTRY,
  DELIVERABLES_BACKEND_ID,
  DELIVERABLES_FILE_RELATIVE,
  createDeliverablesBackendRegistration,
  createDeliverablesStore,
  deliverableIdOf,
  deliverableKindOf,
  deliverablesBackendModuleRow,
  type DeliverablesCaller,
  type DeliverablesStoreOptions,
} from "./deliverables.ts";

const sha = (data: string | Buffer) =>
  `sha256:${NodeCrypto.createHash("sha256").update(data).digest("hex")}`;
const snapId = (letter: string) => `snap_${letter.repeat(64)}`;

const A: DeliverablesCaller = { sessionId: "sess-A", rootSessionId: "sess-A", kind: "main" };
const CHILD: DeliverablesCaller = { sessionId: "sess-C", rootSessionId: "sess-A", kind: "child" };
const B: DeliverablesCaller = { sessionId: "sess-B", rootSessionId: "sess-B", kind: "main" };

type Run =
  | { ok: true; threadId: string; runId: string; nodeId: string; workingFolder: string }
  | { ok: false; detail: string };

/** A map of snapshots per session standing in for the providers snapshot store: it opens only for its owner and closes nothing but the stream it hands out. */
function snapshotDouble() {
  const held = new Map<string, { digest: string; size: number }>();
  const state = { mode: "ok" as "ok" | "unavailable" | "throws", destroyed: 0, opened: 0 };
  return {
    state,
    put: (session: string, id: string, digest: string, size: number) =>
      held.set(`${session}|${id}`, { digest, size }),
    open: async (session: string, id: string) => {
      state.opened += 1;
      if (state.mode === "throws") throw new Error("boom");
      if (state.mode === "unavailable") return { ok: false as const, code: "unavailable" };
      const found = held.get(`${session}|${id}`);
      if (found === undefined) return { ok: false as const, code: "ATTACHMENT_MISSING" };
      return {
        ok: true as const,
        snapshotId: id,
        digest: found.digest,
        size: found.size,
        stream: {
          destroy: () => {
            state.destroyed += 1;
          },
        },
      };
    },
  };
}

function world(overrides: Partial<DeliverablesStoreOptions> = {}) {
  const stateRoot = rootOf();
  const work = rootOf();
  const outside = rootOf();
  const snapshots = snapshotDouble();
  const clock = { now: 1_700_000_000_000 };
  const run: { value: Run } = {
    value: { ok: true, threadId: "thread-A", runId: "run-1", nodeId: "n-1", workingFolder: work },
  };
  const options: DeliverablesStoreOptions = {
    stateRoot,
    now: () => clock.now,
    callerContext: async () => run.value,
    openSnapshot: snapshots.open,
    ...overrides,
  };
  const file = NodePath.join(stateRoot, DELIVERABLES_FILE_RELATIVE);
  const write = (name: string, content: string | Buffer, root = work) => {
    const path = NodePath.join(root, name);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, content);
    return path;
  };
  return {
    stateRoot,
    work,
    outside,
    snapshots,
    clock,
    run,
    file,
    write,
    store: createDeliverablesStore(options),
    reopen: (more: Partial<DeliverablesStoreOptions> = {}) =>
      createDeliverablesStore({ ...options, ...more }),
    bytes: () => (NodeFS.existsSync(file) ? NodeFS.readFileSync(file, "utf8") : null),
    leftovers: () =>
      NodeFS.existsSync(NodePath.dirname(file))
        ? NodeFS.readdirSync(NodePath.dirname(file)).filter((name) => name.endsWith(".tmp"))
        : [],
  };
}
type World = ReturnType<typeof world>;

const declared = async (
  w: World,
  who: DeliverablesCaller,
  args: { requestId: string; path: string; title?: string },
) => {
  const out = await w.store.declare(who, args);
  expect(out.status).toBe("done");
  return (out as { result: any }).result;
};
const okDeclared = async (
  w: World,
  who: DeliverablesCaller,
  args: { requestId: string; path: string; title?: string },
) => {
  const result = await declared(w, who, args);
  expect(result.ok).toBe(true);
  return result as { ok: true; replayed: boolean; declaration: any };
};
const listOf = async (w: World, root: string) => {
  const out = await w.store.list(root);
  expect(out.ok).toBe(true);
  return (out as { ok: true; value: any[] }).value;
};
const records = (w: World) => JSON.parse(w.bytes() ?? "null")?.declarations ?? [];

describe("the declaration store: what a declaration records", () => {
  it("lives under the state root's aetheria-ui folder; an absent file reads as empty and creates nothing", async () => {
    expect(DELIVERABLES_FILE_RELATIVE).toBe(NodePath.join("aetheria-ui", "deliverables.json"));
    const w = world();
    expect(await listOf(w, "sess-A")).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(w.stateRoot, "aetheria-ui"))).toBe(false);
  });

  it("records the carrier's session and root, the one active run as the turn, and the facts of the reopened file", async () => {
    const w = world();
    const path = w.write("out/report.md", "# Report\n");
    w.clock.now = 1_700_000_001_234;
    const reply = await okDeclared(w, CHILD, { requestId: "call-1", path, title: "  The report " });
    expect(reply.replayed).toBe(false);
    const declaration = reply.declaration;
    expect(declaration).toEqual({
      id: deliverableIdOf("sess-C", "call-1"),
      turnId: "run-1",
      canonicalPath: NodeFS.realpathSync(path),
      title: "The report",
      kind: "markdown",
      size: 9,
      digest: sha("# Report\n"),
      declaredAt: 1_700_000_001_234,
      snapshot: { state: "pending" },
    });
    // The Agent's reply never names the session or root; the store holds them.
    expect(JSON.stringify(reply)).not.toMatch(/sess-C|sess-A/);
    const file = JSON.parse(w.bytes() as string);
    expect(Object.keys(file)[0]).toBe("formatVersion");
    expect(file.formatVersion).toBe(DELIVERABLES_FORMAT_VERSION);
    expect(file.declarations).toHaveLength(1);
    expect(file.declarations[0]).toMatchObject({
      ...declaration,
      sessionId: "sess-C",
      rootSessionId: "sess-A",
      requestId: "call-1",
    });
    // The digest and size are those of the bytes on disk now, read independently.
    expect(declaration.digest).toBe(sha(NodeFS.readFileSync(path)));
    expect(NodeFS.statSync(path).size).toBe(declaration.size);
    expect(w.leftovers()).toEqual([]);
  });

  it("titles a declaration by its file name when none is given or the title is only blanks", async () => {
    const w = world();
    const path = w.write("notes.txt", "n");
    expect((await okDeclared(w, A, { requestId: "r1", path })).declaration.title).toBe("notes.txt");
    expect(
      (await okDeclared(w, A, { requestId: "r2", path, title: "   " })).declaration.title,
    ).toBe("notes.txt");
  });

  it("derives the kind from the extension, never from the model", () => {
    const kinds: Record<string, string> = {
      "a.txt": "text",
      "a.log": "text",
      "a.md": "markdown",
      "a.MARKDOWN": "markdown",
      "a.html": "html",
      "a.htm": "html",
      "a.pdf": "pdf",
      "a.png": "image",
      "a.JPG": "image",
      "a.svg": "image",
      "a.mp3": "audio",
      "a.wav": "audio",
      "a.mp4": "video",
      "a.mov": "video",
      "a.docx": "office",
      "a.xlsx": "office",
      "a.pptx": "office",
      "a.zip": "other",
      noext: "other",
      ".hidden": "other",
    };
    for (const [name, kind] of Object.entries(kinds))
      expect([name, deliverableKindOf(name)]).toEqual([name, kind]);
  });

  it("accepts a path that reaches the file through a linked folder, and records the file's real path", async () => {
    const w = world();
    const real = w.write("real/doc.txt", "x");
    NodeFS.symlinkSync(NodePath.dirname(real), NodePath.join(w.work, "alias"));
    const reply = await okDeclared(w, A, {
      requestId: "r1",
      path: NodePath.join(w.work, "alias", "doc.txt"),
    });
    expect(reply.declaration.canonicalPath).toBe(NodeFS.realpathSync(real));
  });
});

describe("the declaration store: what is refused, and writes nothing", () => {
  const refusal = async (w: World, args: { requestId: string; path: string; title?: string }) => {
    const result = await declared(w, A, args);
    expect(result.ok).toBe(false);
    expect(w.bytes()).toBeNull();
    expect(w.leftovers()).toEqual([]);
    return result.code as string;
  };

  it("a path that is not an absolute string, or holds a NUL, and a title with a control character", async () => {
    const w = world();
    expect(await refusal(w, { requestId: "r", path: "relative/report.md" })).toBe(
      "DELIVERABLE_REQUEST_INVALID",
    );
    expect(await refusal(w, { requestId: "r", path: "./report.md" })).toBe(
      "DELIVERABLE_REQUEST_INVALID",
    );
    expect(await refusal(w, { requestId: "r", path: `${w.work}/a\u0000b` })).toBe(
      "DELIVERABLE_REQUEST_INVALID",
    );
    const path = w.write("a.txt", "a");
    expect(await refusal(w, { requestId: "r", path, title: "line\nbreak" })).toBe(
      "DELIVERABLE_REQUEST_INVALID",
    );
    expect(await refusal(w, { requestId: "r", path, title: "bell\u0007" })).toBe(
      "DELIVERABLE_REQUEST_INVALID",
    );
  });

  it("a missing file, a missing folder and a path through a file", async () => {
    const w = world();
    expect(await refusal(w, { requestId: "r", path: NodePath.join(w.work, "nope.md") })).toBe(
      "DELIVERABLE_NOT_FOUND",
    );
    expect(await refusal(w, { requestId: "r", path: NodePath.join(w.work, "x/y/nope.md") })).toBe(
      "DELIVERABLE_NOT_FOUND",
    );
    const file = w.write("f.txt", "f");
    expect(await refusal(w, { requestId: "r", path: NodePath.join(file, "inside") })).toBe(
      "DELIVERABLE_NOT_FOUND",
    );
  });

  it("a directory, the working folder itself, a FIFO and a link to a file (even one inside the folder)", async () => {
    const w = world();
    NodeFS.mkdirSync(NodePath.join(w.work, "dir"));
    expect(await refusal(w, { requestId: "r", path: NodePath.join(w.work, "dir") })).toBe(
      "DELIVERABLE_NOT_REGULAR",
    );
    expect(await refusal(w, { requestId: "r", path: w.work })).toBe("DELIVERABLE_NOT_REGULAR");
    const fifo = NodePath.join(w.work, "pipe");
    NodeChildProcess.execFileSync("mkfifo", [fifo]);
    expect(await refusal(w, { requestId: "r", path: fifo })).toBe("DELIVERABLE_NOT_REGULAR");
    const target = w.write("target.txt", "t");
    const link = NodePath.join(w.work, "link.txt");
    NodeFS.symlinkSync(target, link);
    expect(await refusal(w, { requestId: "r", path: link })).toBe("DELIVERABLE_NOT_REGULAR");
    const dangling = NodePath.join(w.work, "dangling.txt");
    NodeFS.symlinkSync(NodePath.join(w.work, "gone"), dangling);
    expect(await refusal(w, { requestId: "r", path: dangling })).toBe("DELIVERABLE_NOT_REGULAR");
  });

  it.skipIf(process.getuid?.() === 0)("a file the Backend cannot read", async () => {
    const w = world();
    const path = w.write("secret.txt", "s");
    NodeFS.chmodSync(path, 0o000);
    try {
      expect(await refusal(w, { requestId: "r", path })).toBe("DELIVERABLE_UNREADABLE");
    } finally {
      NodeFS.chmodSync(path, 0o600);
    }
  });

  it("a file outside the caller's working folder, by path, by a linked folder and by a sibling that shares its prefix", async () => {
    const w = world();
    const elsewhere = w.write("other.txt", "o", w.outside);
    expect(await refusal(w, { requestId: "r", path: elsewhere })).toBe("DELIVERABLE_OUTSIDE_ROOT");
    NodeFS.symlinkSync(w.outside, NodePath.join(w.work, "escape"));
    expect(
      await refusal(w, { requestId: "r", path: NodePath.join(w.work, "escape", "other.txt") }),
    ).toBe("DELIVERABLE_OUTSIDE_ROOT");
    const sibling = `${w.work}-more`;
    NodeFS.mkdirSync(sibling);
    NodeFS.writeFileSync(NodePath.join(sibling, "x.txt"), "x");
    try {
      expect(await refusal(w, { requestId: "r", path: NodePath.join(sibling, "x.txt") })).toBe(
        "DELIVERABLE_OUTSIDE_ROOT",
      );
      expect(
        await refusal(w, {
          requestId: "r",
          path: `${w.work}/../${NodePath.basename(sibling)}/x.txt`,
        }),
      ).toBe("DELIVERABLE_OUTSIDE_ROOT");
    } finally {
      NodeFS.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("no one active run is no card: unknown, ambiguous or unreadable is the caller context's refusal", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    w.run.value = { ok: false, detail: "the caller thread has more than one active run" };
    const result = await declared(w, A, { requestId: "r", path });
    expect(result).toEqual({
      ok: false,
      code: "DELIVERABLE_TURN_UNKNOWN",
      detail: "the caller thread has more than one active run",
    });
    expect(w.bytes()).toBeNull();
    const throwing = world({
      callerContext: async () => {
        throw new Error("projection down");
      },
    });
    const again = await throwing.store.declare(A, {
      requestId: "r",
      path: throwing.write("a.txt", "a"),
    });
    expect(again).toMatchObject({
      status: "done",
      result: { ok: false, code: "DELIVERABLE_TURN_UNKNOWN" },
    });
    expect(throwing.bytes()).toBeNull();
  });

  it("answers unavailable, not refused, when the run cannot be asked at all", async () => {
    const w = world({ callerContext: undefined });
    const out = await w.store.declare(A, { requestId: "r", path: w.write("a.txt", "a") });
    expect(out).toEqual({ status: "unavailable", code: "DELIVERABLES_NOT_RUNNING" });
    expect(w.bytes()).toBeNull();
  });

  it("a file that changes while it is read is refused as changed, and nothing is recorded", async () => {
    // The hook runs after the first chunk has been read: the file grows, or is swapped for another file of the same name, before the read ends.
    let hook: () => void = () => {};
    const w = world({ onFileRead: () => hook() });
    const path = w.write("big.bin", Buffer.alloc(300_000, 1));
    hook = () => NodeFS.appendFileSync(path, "more");
    expect(await declared(w, A, { requestId: "r1", path })).toMatchObject({
      ok: false,
      code: "DELIVERABLE_CHANGED",
    });
    expect(w.bytes()).toBeNull();
    hook = () => {
      NodeFS.rmSync(path);
      NodeFS.writeFileSync(path, Buffer.alloc(300_000, 2));
    };
    expect(await declared(w, A, { requestId: "r2", path })).toMatchObject({
      ok: false,
      code: "DELIVERABLE_CHANGED",
    });
    expect(w.bytes()).toBeNull();
    // Unchanged, the same file declares.
    hook = () => {};
    expect((await declared(w, A, { requestId: "r3", path })).ok).toBe(true);
  });

  it("refuses at the store's limit with a code, writing nothing", async () => {
    const w = world({ maxRecords: 2 });
    const path = w.write("a.txt", "a");
    await okDeclared(w, A, { requestId: "r1", path });
    await okDeclared(w, A, { requestId: "r2", path });
    const before = w.bytes();
    const result = await declared(w, A, { requestId: "r3", path });
    expect(result).toMatchObject({ ok: false, code: "DELIVERABLE_STORE_FULL" });
    expect(w.bytes()).toBe(before);
    // A replay of a recorded request is not a new record and still answers.
    expect((await okDeclared(w, A, { requestId: "r2", path })).replayed).toBe(true);
  });
});

describe("the declaration store: retries write nothing", () => {
  it("the same request id repeats the recorded declaration, even after the file changed or the run ended", async () => {
    const w = world();
    const path = w.write("a.txt", "first");
    const first = await okDeclared(w, A, { requestId: "r1", path, title: "T" });
    const bytes = w.bytes();
    const inode = NodeFS.statSync(w.file).ino;
    NodeFS.writeFileSync(path, "second, longer");
    w.run.value = { ok: false, detail: "no active run" };
    const again = await okDeclared(w, A, { requestId: "r1", path, title: "T" });
    expect(again.replayed).toBe(true);
    expect(again.declaration).toEqual(first.declaration);
    expect(again.declaration.digest).toBe(sha("first"));
    expect(w.bytes()).toBe(bytes);
    expect(NodeFS.statSync(w.file).ino).toBe(inode);
  });

  it("the same request id with another path or title is a conflict, not a second card", async () => {
    const w = world();
    const a = w.write("a.txt", "a");
    const b = w.write("b.txt", "b");
    await okDeclared(w, A, { requestId: "r1", path: a, title: "T" });
    const bytes = w.bytes();
    expect(await declared(w, A, { requestId: "r1", path: b, title: "T" })).toMatchObject({
      ok: false,
      code: "DELIVERABLE_REQUEST_CONFLICT",
    });
    expect(await declared(w, A, { requestId: "r1", path: a, title: "Other" })).toMatchObject({
      ok: false,
      code: "DELIVERABLE_REQUEST_CONFLICT",
    });
    expect(await declared(w, A, { requestId: "r1", path: a })).toMatchObject({
      ok: false,
      code: "DELIVERABLE_REQUEST_CONFLICT",
    });
    expect(w.bytes()).toBe(bytes);
  });

  it("another session's identical request id is its own declaration", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    const mine = await okDeclared(w, A, { requestId: "r1", path });
    const theirs = await okDeclared(w, B, { requestId: "r1", path });
    expect(theirs.replayed).toBe(false);
    expect(theirs.declaration.id).not.toBe(mine.declaration.id);
    expect(records(w)).toHaveLength(2);
  });

  it("concurrent calls are serialised: distinct requests all land, and one request repeated at once is recorded once", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    const many = await Promise.all(
      Array.from({ length: 12 }, (_, i) => w.store.declare(A, { requestId: `r${i}`, path })),
    );
    expect(many.every((out) => (out as any).result.ok)).toBe(true);
    expect(records(w)).toHaveLength(12);
    const same = await Promise.all(
      Array.from({ length: 6 }, () => w.store.declare(A, { requestId: "same", path })),
    );
    const replays = same.map((out) => (out as any).result.replayed);
    expect(replays.filter((r) => r === false)).toHaveLength(1);
    expect(records(w)).toHaveLength(13);
    expect(new Set(same.map((out) => (out as any).result.declaration.id)).size).toBe(1);
  });
});

describe("supersession and the per-root read", () => {
  it("a later declaration of the same file in the same session supersedes the earlier one; the older record stays", async () => {
    const w = world();
    const path = w.write("a.txt", "v1");
    const other = w.write("b.txt", "b");
    const first = await okDeclared(w, A, { requestId: "r1", path });
    await okDeclared(w, A, { requestId: "r2", path: other });
    NodeFS.writeFileSync(path, "v2!");
    w.clock.now += 5;
    const third = await okDeclared(w, A, { requestId: "r3", path });
    const listed = await listOf(w, "sess-A");
    expect(listed.map((e: any) => e.id)).toEqual([
      first.declaration.id,
      deliverableIdOf("sess-A", "r2"),
      third.declaration.id,
    ]);
    expect(listed.map((e: any) => e.supersededBy)).toEqual([third.declaration.id, null, null]);
    expect(listed[0].digest).toBe(sha("v1"));
    expect(listed[2].digest).toBe(sha("v2!"));
  });

  it("another session declaring the same path does not supersede it, and the list is that root's alone, with each session's id", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    await okDeclared(w, A, { requestId: "r1", path });
    await okDeclared(w, CHILD, { requestId: "r1", path });
    await okDeclared(w, B, { requestId: "r1", path });
    const listed = await listOf(w, "sess-A");
    expect(listed.map((e: any) => [e.sessionId, e.supersededBy])).toEqual([
      ["sess-A", null],
      ["sess-C", null],
    ]);
    expect(await listOf(w, "sess-B")).toHaveLength(1);
    expect(await listOf(w, "sess-none")).toEqual([]);
  });

  it("gets one declaration by id, with its session and root, or null", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    const first = await okDeclared(w, CHILD, { requestId: "r1", path });
    const got = await w.store.get(first.declaration.id);
    expect(got).toMatchObject({
      ok: true,
      value: {
        id: first.declaration.id,
        sessionId: "sess-C",
        rootSessionId: "sess-A",
        supersededBy: null,
      },
    });
    expect(await w.store.get(`dlv_${"0".repeat(32)}`)).toEqual({ ok: true, value: null });
  });
});

describe("attaching the snapshot", () => {
  const prepared = async (w: World, content = "doc") => {
    const path = w.write("doc.txt", content);
    const reply = await okDeclared(w, A, { requestId: "r1", path });
    return { path, id: reply.declaration.id as string, digest: sha(content), size: content.length };
  };
  const attach = (w: World, who: DeliverablesCaller, args: Record<string, unknown>) =>
    w.store.attachSnapshot(who, args as never);

  it("settles a pending declaration once, for a snapshot the store opens for that session with the declared digest, and closes the stream it opened", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-A", snapId("a"), p.digest, p.size);
    const out = await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") });
    expect(out).toMatchObject({
      status: "done",
      result: {
        ok: true,
        replayed: false,
        declaration: {
          id: p.id,
          snapshot: { state: "attached", snapshotId: snapId("a"), digest: p.digest, size: p.size },
        },
      },
    });
    expect(w.snapshots.state.destroyed).toBe(1);
    expect(records(w)[0].snapshot).toEqual({
      state: "attached",
      snapshotId: snapId("a"),
      digest: p.digest,
      size: p.size,
    });
  });

  it("repeats an identical attach without a write; another snapshot or a later failure report is a conflict", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-A", snapId("a"), p.digest, p.size);
    w.snapshots.put("sess-A", snapId("b"), p.digest, p.size);
    await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") });
    const bytes = w.bytes();
    const inode = NodeFS.statSync(w.file).ino;
    expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") })).toMatchObject({
      result: { ok: true, replayed: true },
    });
    expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("b") })).toMatchObject({
      result: { ok: false, code: "DELIVERABLE_SNAPSHOT_CONFLICT" },
    });
    expect(await attach(w, A, { declarationId: p.id, unavailable: "unavailable" })).toMatchObject({
      result: { ok: false, code: "DELIVERABLE_SNAPSHOT_CONFLICT" },
    });
    expect(w.bytes()).toBe(bytes);
    expect(NodeFS.statSync(w.file).ino).toBe(inode);
  });

  it("refuses a snapshot whose digest or size differs from the declaration's, leaving the declaration pending", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-A", snapId("a"), sha("another file"), 12);
    w.snapshots.put("sess-A", snapId("b"), p.digest, p.size + 1);
    const before = w.bytes();
    for (const id of [snapId("a"), snapId("b")])
      expect(await attach(w, A, { declarationId: p.id, snapshotId: id })).toMatchObject({
        result: { ok: false, code: "DELIVERABLE_SNAPSHOT_MISMATCH" },
      });
    expect(w.bytes()).toBe(before);
    expect(w.snapshots.state.destroyed).toBe(2);
  });

  it("refuses a snapshot the store does not hold for this session, a foreign session's included, and writes nothing", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-B", snapId("f"), p.digest, p.size);
    const before = w.bytes();
    for (const id of [snapId("0"), snapId("f")])
      expect(await attach(w, A, { declarationId: p.id, snapshotId: id })).toMatchObject({
        result: { ok: false, code: "DELIVERABLE_SNAPSHOT_MISSING" },
      });
    expect(w.bytes()).toBe(before);
  });

  it("a declaration of another session, or one that does not exist, is unknown: nothing about it is disclosed", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-B", snapId("a"), p.digest, p.size);
    const before = w.bytes();
    expect(await attach(w, B, { declarationId: p.id, snapshotId: snapId("a") })).toMatchObject({
      result: { ok: false, code: "DELIVERABLE_UNKNOWN" },
    });
    expect(
      await attach(w, A, { declarationId: `dlv_${"1".repeat(32)}`, snapshotId: snapId("a") }),
    ).toMatchObject({ result: { ok: false, code: "DELIVERABLE_UNKNOWN" } });
    // The root's other sessions may not settle it either: only the declaring session.
    expect(
      await attach(
        w,
        { ...CHILD, rootSessionId: "sess-A" },
        { declarationId: p.id, unavailable: "unavailable" },
      ),
    ).toMatchObject({ result: { ok: false, code: "DELIVERABLE_UNKNOWN" } });
    expect(w.bytes()).toBe(before);
    // None of the three reached the snapshot store.
    expect(w.snapshots.state.opened).toBe(0);
  });

  it("records the one reason no snapshot exists, without asking the snapshot store, and never an attachment", async () => {
    const w = world();
    const p = await prepared(w);
    const out = await attach(w, A, { declarationId: p.id, unavailable: "SNAPSHOT_TOO_LARGE" });
    expect(out).toMatchObject({
      result: {
        ok: true,
        replayed: false,
        declaration: { snapshot: { state: "unavailable", code: "SNAPSHOT_TOO_LARGE" } },
      },
    });
    expect(w.snapshots.state.opened).toBe(0);
    expect(
      await attach(w, A, { declarationId: p.id, unavailable: "SNAPSHOT_TOO_LARGE" }),
    ).toMatchObject({
      result: { ok: true, replayed: true },
    });
    expect(
      await attach(w, A, { declarationId: p.id, unavailable: "SNAPSHOT_CHANGED" }),
    ).toMatchObject({
      result: { ok: false, code: "DELIVERABLE_SNAPSHOT_CONFLICT" },
    });
    w.snapshots.put("sess-A", snapId("a"), p.digest, p.size);
    expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") })).toMatchObject({
      result: { ok: false, code: "DELIVERABLE_SNAPSHOT_CONFLICT" },
    });
    expect(records(w)[0].snapshot).toEqual({ state: "unavailable", code: "SNAPSHOT_TOO_LARGE" });
  });

  it("an unavailable or failing snapshot store is unavailable, not a refusal: the declaration stays pending and a retry settles it", async () => {
    const w = world();
    const p = await prepared(w);
    w.snapshots.put("sess-A", snapId("a"), p.digest, p.size);
    const before = w.bytes();
    for (const mode of ["unavailable", "throws"] as const) {
      w.snapshots.state.mode = mode;
      expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") })).toEqual({
        status: "unavailable",
        code: "DELIVERABLES_NOT_RUNNING",
      });
      expect(w.bytes()).toBe(before);
    }
    w.snapshots.state.mode = "ok";
    expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") })).toMatchObject({
      result: { ok: true, replayed: false },
    });
  });

  it("without a snapshot store the attach is unavailable and the declare still works", async () => {
    const w = world({ openSnapshot: undefined });
    const p = await prepared(w);
    expect(await attach(w, A, { declarationId: p.id, snapshotId: snapId("a") })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_NOT_RUNNING",
    });
    // A failure report needs no snapshot store: it records a reason only.
    expect(await attach(w, A, { declarationId: p.id, unavailable: "unavailable" })).toMatchObject({
      result: { ok: true },
    });
  });
});

describe("the store file: format, refusal, atomic replacement", () => {
  const plant = (w: World, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(w.file), { recursive: true });
    NodeFS.writeFileSync(w.file, text);
    return text;
  };
  const refusedEverywhere = async (w: World, code: string) => {
    const path = w.work + "/a.txt";
    NodeFS.writeFileSync(path, "a");
    const before = w.bytes();
    expect(await w.store.declare(A, { requestId: "r", path })).toEqual({
      status: "unavailable",
      code,
    });
    expect(
      await w.store.attachSnapshot(A, {
        declarationId: `dlv_${"2".repeat(32)}`,
        unavailable: "unavailable",
      }),
    ).toEqual({ status: "unavailable", code });
    expect(await w.store.list("sess-A")).toMatchObject({ ok: false, code });
    expect(await w.store.get(`dlv_${"2".repeat(32)}`)).toMatchObject({ ok: false, code });
    expect(w.bytes()).toBe(before);
    expect(w.leftovers()).toEqual([]);
  };

  it("refuses a newer format unread, whatever else the file holds, on every call", async () => {
    for (const text of [
      '{"formatVersion":2,"declarations":[]}\n',
      '{"formatVersion":99,"future":{"shape":true}}',
      '{"formatVersion":2,"declarations":"not even a list"}',
    ]) {
      const w = world();
      plant(w, text);
      await refusedEverywhere(w, "DELIVERABLES_FORMAT_NEWER");
    }
  });

  it("refuses a corrupt, unversioned or malformed file as unusable, left byte for byte, never read as empty", async () => {
    const goodRecord = {
      id: deliverableIdOf("s", "r"),
      requestId: "r",
      requestedPath: "/p",
      requestedTitle: null,
      sessionId: "s",
      rootSessionId: "s",
      turnId: "t",
      canonicalPath: "/p",
      title: "T",
      kind: "text",
      size: 1,
      digest: sha("x"),
      declaredAt: 1,
      snapshot: { state: "pending" },
    };
    const bad: string[] = [
      "",
      "not json",
      "[]",
      "null",
      "{}",
      '{"formatVersion":"1","declarations":[]}',
      '{"formatVersion":0,"declarations":[]}',
      '{"formatVersion":1.5,"declarations":[]}',
      '{"formatVersion":1}',
      '{"formatVersion":1,"declarations":{}}',
      '{"formatVersion":1,"declarations":[],"extra":1}',
      JSON.stringify({ formatVersion: 1, declarations: [{ ...goodRecord, extra: 1 }] }),
      JSON.stringify({ formatVersion: 1, declarations: [{ ...goodRecord, kind: "spreadsheet" }] }),
      JSON.stringify({ formatVersion: 1, declarations: [{ ...goodRecord, digest: "md5:1" }] }),
      JSON.stringify({ formatVersion: 1, declarations: [{ ...goodRecord, size: -1 }] }),
      JSON.stringify({
        formatVersion: 1,
        declarations: [{ ...goodRecord, id: `dlv_${"f".repeat(32)}` }],
      }),
      JSON.stringify({ formatVersion: 1, declarations: [goodRecord, goodRecord] }),
      JSON.stringify({
        formatVersion: 1,
        declarations: [{ ...goodRecord, snapshot: { state: "attached" } }],
      }),
      JSON.stringify({
        formatVersion: 1,
        declarations: [{ ...goodRecord, snapshot: { state: "unavailable", code: "other" } }],
      }),
    ];
    for (const text of bad) {
      const w = world();
      plant(w, text);
      await refusedEverywhere(w, "DELIVERABLES_STORE_UNUSABLE");
    }
    // The sound record of the same shape reads.
    const w = world();
    plant(w, JSON.stringify({ formatVersion: 1, declarations: [goodRecord] }));
    expect(await listOf(w, "s")).toHaveLength(1);
  });

  it("an unreadable file (a folder where the file belongs) is unusable and untouched", async () => {
    const w = world();
    NodeFS.mkdirSync(w.file, { recursive: true });
    const path = w.write("a.txt", "a");
    expect(await w.store.declare(A, { requestId: "r", path })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_STORE_UNUSABLE",
    });
    expect(NodeFS.statSync(w.file).isDirectory()).toBe(true);
  });

  it("reports the cause of an unusable store to the Backend's own log, never to the caller", async () => {
    const causes: unknown[] = [];
    const w = world({ onError: (error) => causes.push(error) });
    plant(w, "not json");
    const out = await w.store.list("sess-A");
    expect(out).toMatchObject({ ok: false, code: "DELIVERABLES_STORE_UNUSABLE" });
    expect(JSON.stringify(out)).not.toMatch(/Unexpected|SyntaxError|JSON/);
    expect(causes.length).toBeGreaterThan(0);
  });

  it("replaces the whole file through a private temporary file in the same folder, owner-only, leaving none behind", async () => {
    const renames: Array<[string, string]> = [];
    const w = world({
      rename: async (from, to) => {
        renames.push([from, to]);
        expect(NodePath.dirname(from)).toBe(NodePath.dirname(to));
        expect(NodeFS.statSync(from).mode & 0o777).toBe(0o600);
        await NodeFS.promises.rename(from, to);
      },
    });
    const path = w.write("a.txt", "a");
    await okDeclared(w, A, { requestId: "r1", path });
    await okDeclared(w, A, { requestId: "r2", path });
    expect(renames).toHaveLength(2);
    expect(renames.every(([, to]) => to === w.file)).toBe(true);
    expect(w.leftovers()).toEqual([]);
    expect(records(w)).toHaveLength(2);
  });

  it("a failed replacement leaves the previous file byte for byte, no temporary file, and no record; the same request then lands once", async () => {
    let fail = false;
    const w = world({
      rename: async (from, to) => {
        if (fail) throw new Error("disk full");
        await NodeFS.promises.rename(from, to);
      },
    });
    const path = w.write("a.txt", "a");
    // First write fails: no file at all, the call is unavailable (nothing was recorded).
    fail = true;
    expect(await w.store.declare(A, { requestId: "r1", path })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_STORE_UNUSABLE",
    });
    expect(w.bytes()).toBeNull();
    expect(w.leftovers()).toEqual([]);
    fail = false;
    const landed = await okDeclared(w, A, { requestId: "r1", path });
    expect(landed.replayed).toBe(false);
    // A later write fails: the file stays as it was.
    const before = w.bytes();
    fail = true;
    expect(await w.store.declare(A, { requestId: "r2", path })).toMatchObject({
      status: "unavailable",
    });
    expect(w.bytes()).toBe(before);
    expect(w.leftovers()).toEqual([]);
    fail = false;
    await okDeclared(w, A, { requestId: "r2", path });
    expect(records(w).map((r: any) => r.requestId)).toEqual(["r1", "r2"]);
  });

  it("a temporary file left by a crashed write is ignored on read and does not stop the next write", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    await okDeclared(w, A, { requestId: "r1", path });
    NodeFS.writeFileSync(`${w.file}.dead-beef.tmp`, "{half a record");
    expect(await listOf(w, "sess-A")).toHaveLength(1);
    await okDeclared(w, A, { requestId: "r2", path });
    expect(records(w)).toHaveLength(2);
  });
});

describe("interruption at each boundary of declare → store → attach", () => {
  it("(1) the declare reply is lost after the write: the retry finds the record and writes nothing", async () => {
    const w = world();
    const path = w.write("a.txt", "a");
    // The reply is dropped by the caller: the store has no notion of it, only the record.
    await w.store.declare(A, { requestId: "r1", path });
    const bytes = w.bytes();
    const retry = await okDeclared(w, A, { requestId: "r1", path });
    expect(retry.replayed).toBe(true);
    expect(w.bytes()).toBe(bytes);
  });

  it("(2) the stop falls between declare and store: the record is pending, and a new run of the store settles it later", async () => {
    const w = world();
    const path = w.write("a.txt", "doc");
    const { declaration } = await okDeclared(w, A, { requestId: "r1", path });
    await w.store.close();
    expect(await w.store.declare(A, { requestId: "r2", path })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_NOT_RUNNING",
    });
    const reborn = w.reopen();
    expect(((await reborn.list("sess-A")) as any).value[0].snapshot).toEqual({ state: "pending" });
    w.snapshots.put("sess-A", snapId("a"), sha("doc"), 3);
    expect(
      await reborn.attachSnapshot(A, { declarationId: declaration.id, snapshotId: snapId("a") }),
    ).toMatchObject({ result: { ok: true, replayed: false } });
  });

  it("(3) the snapshot was stored but the attach never arrived: the card stays on the current file until an attach lands", async () => {
    const w = world();
    const path = w.write("a.txt", "doc");
    const { declaration } = await okDeclared(w, A, { requestId: "r1", path });
    w.snapshots.put("sess-A", snapId("a"), sha("doc"), 3);
    expect(((await listOf(w, "sess-A"))[0] as any).snapshot).toEqual({ state: "pending" });
    await w.store.attachSnapshot(A, { declarationId: declaration.id, snapshotId: snapId("a") });
    expect(((await listOf(w, "sess-A"))[0] as any).snapshot.state).toBe("attached");
  });

  it("(4) the attach write is lost: a failed replacement leaves it pending, the retry settles it, a repeat after that is a replay", async () => {
    let fail = false;
    const w = world({
      rename: async (from, to) => {
        if (fail) throw new Error("io");
        await NodeFS.promises.rename(from, to);
      },
    });
    const path = w.write("a.txt", "doc");
    const { declaration } = await okDeclared(w, A, { requestId: "r1", path });
    w.snapshots.put("sess-A", snapId("a"), sha("doc"), 3);
    fail = true;
    expect(
      await w.store.attachSnapshot(A, { declarationId: declaration.id, snapshotId: snapId("a") }),
    ).toEqual({ status: "unavailable", code: "DELIVERABLES_STORE_UNUSABLE" });
    expect(records(w)[0].snapshot).toEqual({ state: "pending" });
    fail = false;
    expect(
      await w.store.attachSnapshot(A, { declarationId: declaration.id, snapshotId: snapId("a") }),
    ).toMatchObject({ result: { ok: true, replayed: false } });
    expect(
      await w.store.attachSnapshot(A, { declarationId: declaration.id, snapshotId: snapId("a") }),
    ).toMatchObject({ result: { ok: true, replayed: true } });
  });

  it("(5) a stale attach for a superseded declaration still settles that older record and never touches the newer card", async () => {
    const w = world();
    const path = w.write("a.txt", "v1");
    const first = await okDeclared(w, A, { requestId: "r1", path });
    NodeFS.writeFileSync(path, "v2");
    const second = await okDeclared(w, A, { requestId: "r2", path });
    w.snapshots.put("sess-A", snapId("a"), sha("v1"), 2);
    await w.store.attachSnapshot(A, {
      declarationId: first.declaration.id,
      snapshotId: snapId("a"),
    });
    const listed = await listOf(w, "sess-A");
    expect(listed[0].snapshot.state).toBe("attached");
    expect(listed[1].id).toBe(second.declaration.id);
    expect(listed[1].snapshot).toEqual({ state: "pending" });
  });
});

describe("drain", () => {
  it("refuses new calls at once and waits for the write in flight, which lands", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered: () => void = () => {};
    const inWrite = new Promise<void>((resolve) => (entered = resolve));
    const w = world({
      rename: async (from, to) => {
        entered();
        await gate;
        await NodeFS.promises.rename(from, to);
      },
    });
    const path = w.write("a.txt", "a");
    const pending = w.store.declare(A, { requestId: "r1", path });
    await inWrite;
    let closed = false;
    const closing = w.store.close().then(() => (closed = true));
    await Promise.resolve();
    expect(await w.store.declare(A, { requestId: "r2", path })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_NOT_RUNNING",
    });
    expect(await w.store.list("sess-A")).toMatchObject({
      ok: false,
      code: "DELIVERABLES_NOT_RUNNING",
    });
    expect(closed).toBe(false);
    release();
    await closing;
    expect(await pending).toMatchObject({ status: "done", result: { ok: true } });
    expect(records(w).map((r: any) => r.requestId)).toEqual(["r1"]);
    // Closing twice is harmless.
    await w.store.close();
  });
});

describe("the module and its two XC-6 operations", () => {
  const context = (who: DeliverablesCaller, args: Record<string, unknown>) => ({
    caller: { threadId: "thread-A", providerSessionId: "cred", providerInstanceId: "pi" },
    sessionId: who.sessionId,
    kind: who.kind ?? "main",
    rootSessionId: who.rootSessionId,
    args,
  });
  const registered = async (w: World, more: Record<string, unknown> = {}) => {
    const registration = createDeliverablesBackendRegistration({
      stateRoot: w.stateRoot,
      now: () => w.clock.now,
      callerContext: async () => w.run.value,
      openSnapshot: w.snapshots.open,
      ...more,
    });
    await registration.activation.start({ id: DELIVERABLES_BACKEND_ID });
    return registration;
  };

  it("is the module the manifest row names, serving exactly the two operations", async () => {
    const w = world();
    const registration = await registered(w);
    expect(registration.entry).toBe(DELIVERABLES_BACKEND_ENTRY);
    expect(DELIVERABLES_BACKEND_ID).toBe("deliverables-backend");
    expect(Object.keys(registration.operations ?? {}).sort()).toEqual(
      [DELIVERABLES_ATTACH_SNAPSHOT_OPERATION, DELIVERABLES_DECLARE_OPERATION].sort(),
    );
    const row = deliverablesBackendModuleRow();
    expect(row).toMatchObject({
      id: "deliverables-backend",
      host: "backend",
      entry: "aetheria:deliverables-backend",
      required: true,
      mutatesToolInput: false,
      owns: ["backend-deliverables-state"],
    });
    expect((row as any).contract.stateOwner).toBe("backend-deliverables-state");
    expect(row).not.toHaveProperty("compat");
  });

  it("declares for the session the carrier verified, with the arguments decoded strictly first", async () => {
    const w = world();
    const registration = await registered(w);
    const operations = registration.operations!;
    const path = w.write("a.txt", "a");
    const out = (await operations[DELIVERABLES_DECLARE_OPERATION]!(
      context(CHILD, { requestId: "c1", path }),
    )) as any;
    expect(out).toMatchObject({ status: "done", result: { ok: true } });
    expect(records(w)[0]).toMatchObject({ sessionId: "sess-C", rootSessionId: "sess-A" });
    // A claimed identity, turn or any extra key throws before anything runs.
    for (const extra of [
      { sessionId: "sess-B" },
      { rootSessionId: "x" },
      { turnId: "t" },
      { kind: "pdf" },
    ]) {
      const before = w.bytes();
      await expect(
        Promise.resolve().then(() =>
          operations[DELIVERABLES_DECLARE_OPERATION]!(
            context(CHILD, { requestId: "c2", path, ...extra }),
          ),
        ),
      ).rejects.toThrow();
      expect(w.bytes()).toBe(before);
    }
    await expect(
      Promise.resolve().then(() =>
        operations[DELIVERABLES_ATTACH_SNAPSHOT_OPERATION]!(context(CHILD, { declarationId: "x" })),
      ),
    ).rejects.toThrow();
  });

  it("answers unavailable for a caller the carrier did not fully verify", async () => {
    const w = world();
    const registration = await registered(w);
    const path = w.write("a.txt", "a");
    for (const broken of [
      { ...context(A, { requestId: "r", path }), sessionId: "" },
      { ...context(A, { requestId: "r", path }), rootSessionId: "" },
      { ...context(A, { requestId: "r", path }), kind: "" },
    ])
      expect(await registration.operations![DELIVERABLES_DECLARE_OPERATION]!(broken)).toEqual({
        status: "unavailable",
        code: "XC6_IDENTITY_UNAVAILABLE",
      });
    expect(w.bytes()).toBeNull();
  });

  it("runs the whole sequence through the operations, and the service the handlers share reads the same file", async () => {
    const w = world();
    const registration = await registered(w);
    const operations = registration.operations!;
    const path = w.write("a.txt", "doc");
    const declare = (await operations[DELIVERABLES_DECLARE_OPERATION]!(
      context(A, { requestId: "r1", path }),
    )) as any;
    w.snapshots.put("sess-A", snapId("a"), sha("doc"), 3);
    const attach = (await operations[DELIVERABLES_ATTACH_SNAPSHOT_OPERATION]!(
      context(A, { declarationId: declare.result.declaration.id, snapshotId: snapId("a") }),
    )) as any;
    expect(attach.result.declaration.snapshot.state).toBe("attached");
    const read = await registration.deliverables()!.list("sess-A");
    expect(read).toMatchObject({ ok: true, value: [{ id: declare.result.declaration.id }] });
  });

  it("is unconfigured without a state root: it starts, serves nothing and every operation answers unavailable", async () => {
    const registration = createDeliverablesBackendRegistration({});
    await registration.activation.start({ id: DELIVERABLES_BACKEND_ID });
    expect(registration.deliverables()).toBeUndefined();
    expect(
      await registration.operations![DELIVERABLES_DECLARE_OPERATION]!(
        context(A, { requestId: "r", path: "/x" }),
      ),
    ).toEqual({ status: "unavailable", code: "DELIVERABLES_NOT_RUNNING" });
    expect(await registration.activation.drain("test")).toEqual({
      released: [],
      stopped: [],
      transferred: [],
      stillLive: [],
    });
  });

  it("starts over an unusable file without stopping the Backend: it reports the cause and refuses each call", async () => {
    const w = world();
    NodeFS.mkdirSync(NodePath.dirname(w.file), { recursive: true });
    NodeFS.writeFileSync(w.file, "garbage");
    const causes: unknown[] = [];
    const registration = await registered(w, { onError: (error: unknown) => causes.push(error) });
    expect(causes.length).toBeGreaterThan(0);
    expect(
      await registration.operations![DELIVERABLES_DECLARE_OPERATION]!(
        context(A, { requestId: "r", path: w.write("a.txt", "a") }),
      ),
    ).toEqual({ status: "unavailable", code: "DELIVERABLES_STORE_UNUSABLE" });
    expect(NodeFS.readFileSync(w.file, "utf8")).toBe("garbage");
  });

  it("drains once: the store is released, later calls and reads find no service, a second drain reports nothing more", async () => {
    const w = world();
    const registration = await registered(w);
    expect(registration.deliverables()).toBeDefined();
    expect(await registration.activation.drain("test")).toEqual({
      released: ["backend-deliverables.store"],
      stopped: [],
      transferred: [],
      stillLive: [],
    });
    expect(registration.deliverables()).toBeUndefined();
    expect(
      await registration.operations![DELIVERABLES_DECLARE_OPERATION]!(
        context(A, { requestId: "r", path: "/x" }),
      ),
    ).toEqual({ status: "unavailable", code: "DELIVERABLES_NOT_RUNNING" });
    expect(await registration.activation.drain("test")).toEqual({
      released: [],
      stopped: [],
      transferred: [],
      stillLive: [],
    });
  });
});
