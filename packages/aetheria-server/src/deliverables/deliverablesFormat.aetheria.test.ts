// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M10 Plan step 27 (D9, D10, XC-22) — the declaration store's FORMAT contract and M10's backup scope, the parts a recovery or a backup depends on: the declared `formatVersion` is named and
// readable from the head of the file without parsing the data; a newer, older, foreign, extra-field, truncated or corrupt file is refused on every call and left byte for byte (and untouched in time);
// a refusal is not sticky; a cold copy reads back identically and a restored copy equals it; and the two stores together keep exactly the persistent paths the backup scope lists, nothing else.
// Boundary: real files under real temporary state roots and a real working folder; the run (callerContext) is a double that names the working folder. The cases already in
// deliverables.aetheria.test.ts (the unusable shapes, the newer-format table, the atomic replacement) are not repeated; this file adds the format declaration, the older/foreign/extra-field/cut-off
// files, restart, restore, the cold copy and the scope. Does not show: the Backend's RPC layer, the snapshot store's own files (M09's, outside the state root), or the bytes of any snapshot.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { DELIVERABLES_FORMAT_VERSION } from "@t3tools/aetheria-contracts";

import { GROUPS_BACKUP_FILE, GROUPS_FILE_RELATIVE, createGroupsStore } from "../groups/groups.ts";
import { rootOf } from "../identity/testkit.ts";
import {
  DELIVERABLES_FILE_RELATIVE,
  DELIVERABLES_BACKEND_ID,
  createDeliverablesBackendRegistration,
  createDeliverablesStore,
  type DeliverablesCaller,
} from "./deliverables.ts";

const A: DeliverablesCaller = { sessionId: "sess-A", rootSessionId: "sess-A", kind: "main" };

function world() {
  const stateRoot = rootOf();
  const work = rootOf();
  const file = NodePath.join(stateRoot, DELIVERABLES_FILE_RELATIVE);
  const folder = NodePath.dirname(file);
  const options = {
    stateRoot,
    now: () => 1_700_000_000_000,
    callerContext: async () => ({
      ok: true as const,
      threadId: "thread-A",
      runId: "run-1",
      nodeId: "n-1",
      workingFolder: work,
    }),
  };
  return {
    stateRoot,
    work,
    file,
    folder,
    options,
    store: () => createDeliverablesStore(options),
    plant: (body: string | Buffer) => {
      NodeFS.mkdirSync(folder, { recursive: true });
      NodeFS.writeFileSync(file, body);
    },
    deliverable: (name: string, content: string) => {
      const path = NodePath.join(work, name);
      NodeFS.writeFileSync(path, content);
      return path;
    },
    names: () => (NodeFS.existsSync(folder) ? NodeFS.readdirSync(folder).sort() : []),
    bytes: () => NodeFS.readFileSync(file),
  };
}
type World = ReturnType<typeof world>;

/** The first key and value of the top-level object, from the first 64 bytes alone: what a backup tool reads without parsing the data. */
const formatOfHead = (bytes: Buffer): { field: string; value: number } | null => {
  const match = /^\s*\{\s*"(version|formatVersion)"\s*:\s*(\d+)\s*[,}]/.exec(
    bytes.subarray(0, 64).toString("utf8"),
  );
  return match === null ? null : { field: match[1] as string, value: Number(match[2]) };
};

const countOf = async (store: ReturnType<World["store"]>) => {
  const out = await store.list("sess-A");
  return out.ok ? out.value.length : -1;
};

const declareOne = async (w: World, store = w.store(), requestId = "r1", name = "a.txt") => {
  const path = w.deliverable(name, `content of ${name}`);
  const out = await store.declare(A, { requestId, path });
  expect(out).toMatchObject({ status: "done", result: { ok: true } });
  return out as { status: "done"; result: { ok: true; declaration: { id: string } } };
};

const goodEmpty = JSON.stringify({ formatVersion: 1, declarations: [] });

describe("the declared format is named and readable without opening the data", () => {
  it("the store declares formatVersion 1, and every file it writes begins with that key, so the head of the file names the format", async () => {
    expect(DELIVERABLES_FORMAT_VERSION).toBe(1);
    const w = world();
    const store = w.store();
    await declareOne(w, store, "r1", "a.txt");
    expect(formatOfHead(w.bytes())).toEqual({ field: "formatVersion", value: 1 });
    // A later write (the second declaration, then the settling of the first) keeps the head.
    await declareOne(w, store, "r2", "b.txt");
    expect(formatOfHead(w.bytes())).toEqual({ field: "formatVersion", value: 1 });
  });
});

describe("a file of another format is refused on every call and nothing about it changes", () => {
  const goodRecord = {
    id: "dlv_x",
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
    digest: `sha256:${"0".repeat(64)}`,
    declaredAt: 1,
    snapshot: { state: "pending" },
  };
  const unusable: ReadonlyArray<readonly [string, string | Buffer]> = [
    [
      "the group record's shape at the declaration path",
      '{"version":2,"links":[],"dismissed":[],"names":[]}',
    ],
    ["a DSH-shaped file of another name and shape", '{"sessions":[{"id":"x"}],"order":[]}'],
    ["a negative formatVersion", '{"formatVersion":-1,"declarations":[]}'],
    [
      "a fractional formatVersion above the supported one (not a newer integer)",
      '{"formatVersion":2.5,"declarations":[]}',
    ],
    ["a null formatVersion", '{"formatVersion":null,"declarations":[]}'],
    ["a formatVersion of the wrong type", '{"formatVersion":true,"declarations":[]}'],
    [
      "a declaration with an unknown field",
      JSON.stringify({ formatVersion: 1, declarations: [{ ...goodRecord, extra: 1 }] }),
    ],
    [
      "a snapshot with an unknown field",
      JSON.stringify({
        formatVersion: 1,
        declarations: [{ ...goodRecord, snapshot: { state: "pending", extra: 1 } }],
      }),
    ],
    [
      "a declaration of a missing field",
      JSON.stringify({ formatVersion: 1, declarations: [{ id: "dlv_x" }] }),
    ],
    ["only whitespace", "  \n\t \n"],
    ["a byte-order mark before a good file", `\uFEFF${goodEmpty}`],
    ["a good file followed by more text", `${goodEmpty}\n{"formatVersion":1}`],
    ["a good file cut off in the middle", goodEmpty.slice(0, 20)],
    ["bytes that are not text", Buffer.from([0x00, 0xff, 0xfe, 0x7b, 0x80])],
    ["a JSON string", '"formatVersion 1"'],
  ];

  const refusesEverywhere = async (w: World, code: string) => {
    const store = w.store();
    const path = w.deliverable("c.txt", "c");
    const before = w.bytes();
    const stamp = NodeFS.statSync(w.file).mtimeMs;
    const names = w.names();
    expect(await store.declare(A, { requestId: "r-new", path })).toEqual({
      status: "unavailable",
      code,
    });
    expect(
      await store.attachSnapshot(A, {
        declarationId: `dlv_${"1".repeat(32)}`,
        unavailable: "unavailable",
      }),
    ).toEqual({ status: "unavailable", code });
    expect(await store.list("sess-A")).toEqual({ ok: false, code });
    expect(await store.get(`dlv_${"1".repeat(32)}`)).toEqual({ ok: false, code });
    expect(w.bytes().equals(before)).toBe(true);
    expect(NodeFS.statSync(w.file).mtimeMs).toBe(stamp);
    expect(w.names()).toEqual(names);
    await store.close();
  };

  it.each(unusable)(
    "%s: every call answers DELIVERABLES_STORE_UNUSABLE; the bytes, the folder and the file's time are unchanged",
    async (_name, body) => {
      const w = world();
      w.plant(body);
      await refusesEverywhere(w, "DELIVERABLES_STORE_UNUSABLE");
    },
  );

  it("a newer format is refused unread as DELIVERABLES_FORMAT_NEWER, however far, and leaves the same marks", async () => {
    for (const body of [
      '{"formatVersion":2,"declarations":[]}',
      '{"formatVersion":2,"declarations":[],"newField":{"a":1}}',
      '{"formatVersion":1000000}',
    ]) {
      const w = world();
      w.plant(body);
      await refusesEverywhere(w, "DELIVERABLES_FORMAT_NEWER");
    }
  });

  it("a restart does not change the answer: a second store, and the module's start, find the same bytes and refuse the same way", async () => {
    const w = world();
    w.plant('{"formatVersion":2,"declarations":[]}');
    const before = w.bytes();
    for (let i = 0; i < 3; i += 1) await refusesEverywhere(w, "DELIVERABLES_FORMAT_NEWER");
    const causes: unknown[] = [];
    const registration = createDeliverablesBackendRegistration({
      ...w.options,
      onError: (error) => causes.push(error),
    });
    // The Backend starts over an unusable file (it is not worth the sessions), names the cause in its own log, and then refuses each call.
    await registration.activation.start({ id: DELIVERABLES_BACKEND_ID });
    expect(causes.length).toBeGreaterThan(0);
    expect(await registration.deliverables()?.list("sess-A")).toEqual({
      ok: false,
      code: "DELIVERABLES_FORMAT_NEWER",
    });
    await registration.activation.drain("test");
    expect(w.bytes().equals(before)).toBe(true);
    expect(w.names()).toEqual(["deliverables.json"]);
  });
});

describe("a refusal is not sticky, and a restored file is the file", () => {
  it("the same store reads a good file at once after the refused bytes were replaced", async () => {
    const w = world();
    w.plant("{not json");
    const store = w.store();
    expect(await store.list("sess-A")).toEqual({ ok: false, code: "DELIVERABLES_STORE_UNUSABLE" });
    w.plant(goodEmpty);
    expect(await store.list("sess-A")).toEqual({ ok: true, value: [] });
  });

  it("a cold copy of the folder, read by a store on a fresh state root, lists the same declarations byte for byte, and a replayed request writes nothing", async () => {
    const w = world();
    const store = w.store();
    await declareOne(w, store, "r1", "a.txt");
    await declareOne(w, store, "r2", "b.txt");
    const listed = await store.list("sess-A");
    expect(listed).toMatchObject({ ok: true });
    await store.close();

    const fresh = world();
    NodeFS.mkdirSync(fresh.folder, { recursive: true });
    NodeFS.cpSync(w.folder, fresh.folder, { recursive: true });
    const copy = fresh.store();
    expect(await copy.list("sess-A")).toEqual(listed);
    expect(fresh.bytes().equals(w.bytes())).toBe(true);
    // The same request id again names the record that exists and writes nothing (no second card).
    const stamp = NodeFS.statSync(fresh.file).mtimeMs;
    const again = await copy.declare(A, { requestId: "r1", path: w.deliverable("a.txt", "x") });
    expect(again).toMatchObject({ status: "done", result: { ok: true, replayed: true } });
    expect(NodeFS.statSync(fresh.file).mtimeMs).toBe(stamp);
    expect(await countOf(copy)).toBe(2);
  });

  it("restoring the cold copy over a later state gives back exactly the copied declarations, and the later declaration is gone", async () => {
    const w = world();
    const store = w.store();
    await declareOne(w, store, "r1", "a.txt");
    const copied = w.bytes();
    const listed = await store.list("sess-A");
    await declareOne(w, store, "r2", "b.txt");
    expect(await countOf(store)).toBe(2);
    await store.close();

    NodeFS.writeFileSync(w.file, copied);
    const restored = w.store();
    expect(await restored.list("sess-A")).toEqual(listed);
    expect(w.bytes().equals(copied)).toBe(true);
  });

  it("a newer-format file refuses, and restoring the good copy over it makes the store usable again with the copy's declarations", async () => {
    const w = world();
    const first = w.store();
    await declareOne(w, first, "r1", "a.txt");
    const good = w.bytes();
    const listed = await first.list("sess-A");
    await first.close();

    const newer = Buffer.from('{"formatVersion":2,"declarations":[],"future":1}');
    w.plant(newer);
    const refused = w.store();
    expect(await refused.list("sess-A")).toEqual({ ok: false, code: "DELIVERABLES_FORMAT_NEWER" });
    expect(w.bytes().equals(newer)).toBe(true);
    await refused.close();

    NodeFS.writeFileSync(w.file, good);
    expect(await w.store().list("sess-A")).toEqual(listed);
  });
});

describe("M10's backup scope is exactly its persistent paths", () => {
  /** The scope: the paths under the state root that M10 keeps, relative to it. The snapshot copies are M09's, in T3's attachments directory, outside this list and outside the state root. */
  const SCOPE = [
    NodePath.join("aetheria-ui", "deliverables.json"),
    NodePath.join("aetheria-ui", "session-groups.json"),
    NodePath.join("aetheria-ui", "session-groups.v1.json"),
  ].sort();

  const everyFile = (root: string, base = root): string[] =>
    NodeFS.readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
      const path = NodePath.join(base, entry.name);
      return entry.isDirectory() ? everyFile(root, path) : [NodePath.relative(root, path)];
    });

  it("the constants the stores export name exactly the scope's three paths", () => {
    expect(
      [
        DELIVERABLES_FILE_RELATIVE,
        GROUPS_FILE_RELATIVE,
        NodePath.join("aetheria-ui", GROUPS_BACKUP_FILE),
      ].sort(),
    ).toEqual(SCOPE);
  });

  it("after the groups store upgraded a version-1 file and the declaration store declared, the state root holds those three files and nothing else", async () => {
    const w = world();
    const groupsFile = NodePath.join(w.stateRoot, GROUPS_FILE_RELATIVE);
    NodeFS.mkdirSync(NodePath.dirname(groupsFile), { recursive: true });
    NodeFS.writeFileSync(
      groupsFile,
      `${JSON.stringify({ version: 1, links: [{ a: "a", b: "b", kind: "grouped", at: 1 }], dismissed: [] })}\n`,
    );
    const groups = createGroupsStore({ stateRoot: w.stateRoot });
    expect((await groups.apply({ op: "dismiss", a: "x", b: "y" })).ok).toBe(true);
    await groups.close();
    const store = w.store();
    await declareOne(w, store, "r1", "a.txt");
    await store.close();
    expect(everyFile(w.stateRoot).sort()).toEqual(SCOPE);
  });

  it("a state root that only ever read (an absent store, a refused store) holds nothing of M10's beyond the file it was given", async () => {
    const w = world();
    const groups = createGroupsStore({ stateRoot: w.stateRoot });
    expect((await groups.read()).ok).toBe(true);
    expect(await w.store().list("sess-A")).toEqual({ ok: true, value: [] });
    expect(everyFile(w.stateRoot)).toEqual([]);
  });
});
