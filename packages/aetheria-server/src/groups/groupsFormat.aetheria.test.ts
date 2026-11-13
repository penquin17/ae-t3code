// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M10 Plan step 27 (D3, D8, XC-22) — the session-group record's FORMAT contract, the part a recovery or a backup depends on: the declared format is readable and named without opening the
// data; a file of another or later format, a foreign file, one with a field the code does not know and a corrupt one are each refused, and the file is left byte for byte (and untouched in time); a
// refusal is not sticky (a restored file is read at once); a cold copy of the record reads back identically and a restored copy equals it.
// Boundary: real files under real temporary state roots, no network. The cases already in groups.aetheria.test.ts (the twelve unusable shapes, the version-1 backup) are not repeated here; this file
// adds the format declaration, foreign and truncated files, unknown fields at every nesting level, the version field's own type, restart, restore and the cold copy. Does not show: the Backend's RPC
// layer (apps/server groupsRpc tests) or a crash of the operating system's rename.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  GROUPS_BACKUP_FILE,
  GROUPS_FILE_RELATIVE,
  createGroupsStore,
  parseGroupsRecord,
  type GroupsOutcome,
} from "./groups.ts";

const roots: string[] = [];
const rootOf = (): string => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m10-groups-format-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const fileOf = (root: string): string => NodePath.join(root, GROUPS_FILE_RELATIVE);
const folderOf = (root: string): string => NodePath.dirname(fileOf(root));
const plant = (root: string, body: string | Buffer): void => {
  NodeFS.mkdirSync(folderOf(root), { recursive: true });
  NodeFS.writeFileSync(fileOf(root), body);
};
const listing = (root: string): string[] =>
  NodeFS.existsSync(folderOf(root)) ? NodeFS.readdirSync(folderOf(root)).sort() : [];
let clock = 5000;
const storeOf = (root: string) => createGroupsStore({ stateRoot: root, now: () => (clock += 1) });
const ok = (outcome: GroupsOutcome) => {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as Extract<GroupsOutcome, { ok: true }>).value;
};
const refusal = (outcome: GroupsOutcome) => {
  expect(outcome.ok).toBe(false);
  return outcome as Extract<GroupsOutcome, { ok: false }>;
};

/**
 * What a backup or a recovery tool can read WITHOUT parsing the data: the first key and value of the top-level object, taken from the first 64 bytes. `null` when the head names no format.
 */
const formatOfHead = (bytes: Buffer): { field: string; value: number } | null => {
  const match = /^\s*\{\s*"(version|formatVersion)"\s*:\s*(\d+)\s*[,}]/.exec(
    bytes.subarray(0, 64).toString("utf8"),
  );
  return match === null ? null : { field: match[1] as string, value: Number(match[2]) };
};

describe("the declared format is named and readable without opening the data", () => {
  it("every record the store writes begins with its `version` key, so the head of the file names the format", async () => {
    const root = rootOf();
    const store = storeOf(root);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    expect(formatOfHead(NodeFS.readFileSync(fileOf(root)))).toEqual({ field: "version", value: 2 });
    // After later writes (a dismissal, a rename, an ungroup) the head still names it: the declaration is not a first-write accident.
    ok(await store.apply({ op: "dismiss", a: "c", b: "d" }));
    ok(await store.apply({ op: "rename", members: ["a", "b"], name: "Named" }));
    ok(await store.apply({ op: "ungroup", a: "a", b: "b" }));
    expect(formatOfHead(NodeFS.readFileSync(fileOf(root)))).toEqual({ field: "version", value: 2 });
  });

  it("the declared version is the one the code reads as its own: version 2 reads, and parseGroupsRecord answers a version-2 record for both known versions", () => {
    expect(parseGroupsRecord({ version: 2, links: [], dismissed: [], names: [] })).toMatchObject({
      ok: true,
      sourceVersion: 2,
    });
    expect(parseGroupsRecord({ version: 1, links: [], dismissed: [] })).toMatchObject({
      ok: true,
      sourceVersion: 1,
    });
  });

  it("the one-time version-1 copy keeps the head of the original, so the older format stays nameable after the upgrade", async () => {
    const root = rootOf();
    const v1 = `${JSON.stringify({ version: 1, links: [{ a: "a", b: "b", kind: "grouped", at: 3 }], dismissed: [] })}\n`;
    plant(root, v1);
    ok(await storeOf(root).apply({ op: "dismiss", a: "x", b: "y" }));
    const backup = NodeFS.readFileSync(NodePath.join(folderOf(root), GROUPS_BACKUP_FILE));
    expect(formatOfHead(backup)).toEqual({ field: "version", value: 1 });
    expect(backup.toString("utf8")).toBe(v1);
    expect(formatOfHead(NodeFS.readFileSync(fileOf(root)))).toEqual({ field: "version", value: 2 });
  });
});

describe("a file of another format is refused unread, and nothing about it changes", () => {
  const goodV2 = JSON.stringify({
    version: 2,
    links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
    dismissed: [],
    names: [],
  });
  const foreign: ReadonlyArray<readonly [string, string | Buffer]> = [
    ["the declaration store's shape at the groups path", '{"formatVersion":1,"declarations":[]}'],
    ["a DSH-shaped file of another name and shape", '{"sessions":[{"id":"x"}],"order":[]}'],
    ["a version that is a string", '{"version":"2","links":[],"dismissed":[],"names":[]}'],
    ["a fractional version", '{"version":2.5,"links":[],"dismissed":[],"names":[]}'],
    ["a null version", '{"version":null,"links":[],"dismissed":[],"names":[]}'],
    ["no version at all", '{"links":[],"dismissed":[],"names":[]}'],
    [
      "a far newer version carrying fields this code has never seen",
      '{"version":99,"future":{"shape":true}}',
    ],
    [
      "a version-1 file carrying names (a field version 1 never had)",
      '{"version":1,"links":[],"dismissed":[],"names":[]}',
    ],
    [
      "a version-1 file with an unknown field",
      '{"version":1,"links":[],"dismissed":[],"extra":true}',
    ],
    [
      "an unknown field inside a link",
      '{"version":2,"links":[{"a":"a","b":"b","kind":"grouped","at":1,"why":"x"}],"dismissed":[],"names":[]}',
    ],
    [
      "a kind on a dismissal",
      '{"version":2,"links":[],"dismissed":[{"a":"a","b":"b","kind":"grouped","at":1}],"names":[]}',
    ],
    [
      "an unknown field inside a name",
      '{"version":2,"links":[],"dismissed":[],"names":[{"members":["a","b"],"name":"n","at":1,"colour":"red"}]}',
    ],
    ["names that is not a list", '{"version":2,"links":[],"dismissed":[],"names":{}}'],
    ["an empty file", ""],
    ["only whitespace", "  \n\t \n"],
    ["a byte-order mark before a good record", `\uFEFF${goodV2}`],
    ["a good record followed by more text", `${goodV2}\n{"version":2}`],
    ["a good record cut off in the middle", goodV2.slice(0, Math.floor(goodV2.length / 2))],
    ["bytes that are not text", Buffer.from([0x00, 0xff, 0xfe, 0x7b, 0x80])],
    ["JSON null", "null"],
    ["a JSON string", '"version 2"'],
  ];

  it.each(foreign)(
    "%s: read and apply answer GROUPS_STORE_UNUSABLE naming the store, and the bytes, the folder and the file's time are unchanged",
    async (_name, body) => {
      const root = rootOf();
      plant(root, body);
      const before = NodeFS.readFileSync(fileOf(root));
      const stamp = NodeFS.statSync(fileOf(root)).mtimeMs;
      const names = listing(root);
      const store = storeOf(root);
      const read = refusal(await store.read());
      expect(read.code).toBe("GROUPS_STORE_UNUSABLE");
      // The store is named in the words the Backend shows, and no path is.
      expect(read.detail).toMatch(/session group/i);
      expect(read.detail).not.toContain(root);
      for (const operation of [
        { op: "group", a: "p", b: "q" },
        { op: "ungroup", a: "a", b: "b" },
        { op: "detach", a: "a" },
        { op: "rename", members: ["a", "b"], name: "N" },
      ] as const)
        expect(refusal(await store.apply(operation)).code).toBe("GROUPS_STORE_UNUSABLE");
      expect(NodeFS.readFileSync(fileOf(root)).equals(before)).toBe(true);
      expect(NodeFS.statSync(fileOf(root)).mtimeMs).toBe(stamp);
      expect(listing(root)).toEqual(names);
    },
  );

  it("a restart of the store does not change the answer: a second store on the same bytes refuses the same way and writes nothing", async () => {
    const root = rootOf();
    plant(root, '{"version":3,"links":[],"dismissed":[],"names":[]}');
    const before = NodeFS.readFileSync(fileOf(root));
    for (let i = 0; i < 3; i += 1) {
      const store = storeOf(root);
      expect(refusal(await store.read()).code).toBe("GROUPS_STORE_UNUSABLE");
      expect(refusal(await store.apply({ op: "group", a: "a", b: "b" })).code).toBe(
        "GROUPS_STORE_UNUSABLE",
      );
      await store.close();
    }
    expect(NodeFS.readFileSync(fileOf(root)).equals(before)).toBe(true);
    expect(listing(root)).toEqual(["session-groups.json"]);
  });

  it("a refused newer-format file creates no version-1 copy and no temporary file", async () => {
    const root = rootOf();
    plant(root, '{"version":3,"links":[],"dismissed":[],"names":[]}');
    await storeOf(root).apply({ op: "group", a: "a", b: "b" });
    expect(listing(root)).toEqual(["session-groups.json"]);
  });
});

describe("a refusal is not sticky, and a restored file is the file", () => {
  it("the same store reads a good file at once after the refused bytes were replaced (nothing is cached across a refusal)", async () => {
    const root = rootOf();
    plant(root, "{not json");
    const store = storeOf(root);
    expect(refusal(await store.read()).code).toBe("GROUPS_STORE_UNUSABLE");
    plant(
      root,
      JSON.stringify({ version: 2, links: [], dismissed: [{ a: "a", b: "b", at: 2 }], names: [] }),
    );
    expect(ok(await store.read()).dismissed).toEqual([{ a: "a", b: "b", at: 2 }]);
  });

  it("a cold copy of the folder, read by a store on a fresh state root, is the same record byte for byte, and a no-op on it writes nothing", async () => {
    const source = rootOf();
    const store = storeOf(source);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    ok(await store.apply({ op: "group", a: "b", b: "c" }));
    ok(await store.apply({ op: "dismiss", a: "x", b: "y" }));
    ok(await store.apply({ op: "rename", members: ["a", "b", "c"], name: "Trio" }));
    const record = ok(await store.read());
    await store.close();

    const copy = rootOf();
    NodeFS.cpSync(folderOf(source), folderOf(copy), { recursive: true });
    const same = storeOf(copy);
    expect(ok(await same.read())).toEqual(record);
    expect(NodeFS.readFileSync(fileOf(copy)).equals(NodeFS.readFileSync(fileOf(source)))).toBe(
      true,
    );
    const stamp = NodeFS.statSync(fileOf(copy)).mtimeMs;
    ok(await same.apply({ op: "group", a: "a", b: "b" }));
    expect(NodeFS.statSync(fileOf(copy)).mtimeMs).toBe(stamp);
    expect(listing(copy)).toEqual(listing(source));
  });

  it("restoring the cold copy over a later state gives back exactly the copied record, and the later change is gone", async () => {
    const root = rootOf();
    const store = storeOf(root);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    const copied = NodeFS.readFileSync(fileOf(root));
    const record = ok(await store.read());
    ok(await store.apply({ op: "group", a: "c", b: "d" }));
    expect(ok(await store.read()).links).toHaveLength(2);
    await store.close();

    NodeFS.writeFileSync(fileOf(root), copied);
    const restored = storeOf(root);
    expect(ok(await restored.read())).toEqual(record);
    expect(NodeFS.readFileSync(fileOf(root)).equals(copied)).toBe(true);
  });

  it("a newer-format file refuses, and restoring the good copy over it makes the store usable again with the copy's record", async () => {
    const root = rootOf();
    const first = storeOf(root);
    ok(await first.apply({ op: "group", a: "a", b: "b" }));
    const good = NodeFS.readFileSync(fileOf(root));
    const record = ok(await first.read());
    await first.close();

    const newer = Buffer.from('{"version":3,"links":[],"dismissed":[],"names":[],"future":1}');
    NodeFS.writeFileSync(fileOf(root), newer);
    const refused = storeOf(root);
    expect(refusal(await refused.read()).code).toBe("GROUPS_STORE_UNUSABLE");
    expect(NodeFS.readFileSync(fileOf(root)).equals(newer)).toBe(true);
    await refused.close();

    NodeFS.writeFileSync(fileOf(root), good);
    expect(ok(await storeOf(root).read())).toEqual(record);
  });
});
