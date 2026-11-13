// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M10 Plan step 7 (D3, D4, XC-22) — the Backend's one session-group store: `<state-root>/aetheria-ui/session-groups.json`, DSH's version-2 record, the five-operation union, the 8 KiB
// body cap and the 200-id bound, one writer, whole-file same-directory atomic replacement, and refusal (never repair) of a file it cannot read.
// Boundary: real files under a real temporary state root, an injected clock and an injected `rename` that fails at a chosen publication. Does not show: the RPC layer's device and session checks
// (apps/server groupsRpc tests), the Backend lifecycle ordering (the adapter's tests), crash safety of the operating system's rename, a network file system.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  GROUPS_BACKUP_FILE,
  GROUPS_FILE_RELATIVE,
  applyGroupOperation,
  createGroupsBackendRegistration,
  createGroupsStore,
  filterGroupsRecord,
  parseGroupsRecord,
  prepareGroupOperation,
  type GroupsOutcome,
} from "./groups.ts";

const roots: string[] = [];
const rootOf = (): string => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m10-groups-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const fileOf = (root: string): string => NodePath.join(root, GROUPS_FILE_RELATIVE);
const backupOf = (root: string): string =>
  NodePath.join(NodePath.dirname(fileOf(root)), GROUPS_BACKUP_FILE);
const text = (path: string): string => NodeFS.readFileSync(path, "utf8");
const listing = (root: string): string[] =>
  NodeFS.existsSync(NodePath.dirname(fileOf(root)))
    ? NodeFS.readdirSync(NodePath.dirname(fileOf(root))).sort()
    : [];
const seed = (root: string, body: string): void => {
  NodeFS.mkdirSync(NodePath.dirname(fileOf(root)), { recursive: true });
  NodeFS.writeFileSync(fileOf(root), body);
};
const EMPTY = { version: 2, links: [], dismissed: [], names: [] } as const;
let clock = 1000;
const now = () => (clock += 1);
const storeOf = (root: string, options: Partial<Parameters<typeof createGroupsStore>[0]> = {}) =>
  createGroupsStore({ stateRoot: root, now, ...options });
const ok = (outcome: GroupsOutcome) => {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as Extract<GroupsOutcome, { ok: true }>).value;
};
const refusal = (outcome: GroupsOutcome) => {
  expect(outcome.ok).toBe(false);
  return outcome as Extract<GroupsOutcome, { ok: false }>;
};

describe("the stored record", () => {
  it("lives under the state root's aetheria-ui folder and an absent file reads as the empty version-2 record without creating anything", async () => {
    expect(GROUPS_FILE_RELATIVE).toBe(NodePath.join("aetheria-ui", "session-groups.json"));
    const root = rootOf();
    expect(ok(await storeOf(root).read())).toEqual(EMPTY);
    expect(NodeFS.existsSync(NodePath.join(root, "aetheria-ui"))).toBe(false);
  });

  it("group stores the pair with a < b and its time, ungroup removes it, dismiss keeps a separate list, detach removes every link of one session", async () => {
    const root = rootOf();
    const store = storeOf(root);
    const grouped = ok(await store.apply({ op: "group", a: "b", b: "a" }));
    expect(grouped.links).toEqual([{ a: "a", b: "b", kind: "grouped", at: expect.any(Number) }]);
    ok(await store.apply({ op: "group", a: "a", b: "c" }));
    ok(await store.apply({ op: "dismiss", a: "z", b: "y" }));
    const afterDetach = ok(await store.apply({ op: "detach", a: "a" }));
    expect(afterDetach.links).toEqual([]);
    expect(afterDetach.dismissed).toEqual([{ a: "y", b: "z", at: expect.any(Number) }]);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    expect(ok(await store.apply({ op: "ungroup", a: "b", b: "a" })).links).toEqual([]);
    // The file on disk is the confirmed record, as the store reads it back.
    expect(JSON.parse(text(fileOf(root)))).toEqual(ok(await storeOf(root).read()));
  });

  it("a rename sorts and de-duplicates the members, trims the name, replaces every name that overlaps, and clears with an empty name", async () => {
    const store = storeOf(rootOf());
    let record = ok(
      await store.apply({ op: "rename", members: ["c", "a", "a", "b"], name: "  Plans  " }),
    );
    expect(record.names).toEqual([
      { members: ["a", "b", "c"], name: "Plans", at: expect.any(Number) },
    ]);
    record = ok(await store.apply({ op: "rename", members: ["c", "d"], name: "Other" }));
    expect(record.names).toEqual([{ members: ["c", "d"], name: "Other", at: expect.any(Number) }]);
    record = ok(await store.apply({ op: "rename", members: ["d", "c"], name: "   " }));
    expect(record.names).toEqual([]);
  });

  it("an operation that changes nothing writes nothing: a repeat keeps its time, a clear of nothing and an ungroup of an absent pair leave the file alone", async () => {
    const root = rootOf();
    const store = storeOf(root);
    ok(await store.apply({ op: "ungroup", a: "a", b: "b" }));
    ok(await store.apply({ op: "detach", a: "a" }));
    ok(await store.apply({ op: "rename", members: ["a", "b"], name: "" }));
    expect(NodeFS.existsSync(fileOf(root))).toBe(false);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    const before = NodeFS.statSync(fileOf(root));
    const bytes = text(fileOf(root));
    ok(await store.apply({ op: "group", a: "b", b: "a" }));
    ok(await store.apply({ op: "rename", members: ["a", "b"], name: "" }));
    expect(text(fileOf(root))).toBe(bytes);
    expect(NodeFS.statSync(fileOf(root)).ino).toBe(before.ino);
    ok(await store.apply({ op: "rename", members: ["a", "b"], name: "N" }));
    const named = text(fileOf(root));
    ok(await store.apply({ op: "rename", members: ["b", "a"], name: "N" }));
    expect(text(fileOf(root))).toBe(named);
  });

  it("applyGroupOperation is pure and returns the same object when nothing changes", () => {
    const record = parseGroupsRecord({
      version: 2,
      links: [{ a: "a", b: "b", kind: "grouped", at: 5 }],
      dismissed: [],
      names: [],
    });
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    const same = applyGroupOperation(record.record, { op: "group", a: "a", b: "b" }, 99);
    expect(same).toBe(record.record);
    const changed = applyGroupOperation(record.record, { op: "group", a: "a", b: "c" }, 99);
    expect(changed).not.toBe(record.record);
    expect(record.record.links).toHaveLength(1);
  });
});

describe("a request the store judges before it touches a file", () => {
  it("refuses an operation outside the five exact shapes as GROUPS_INVALID_REQUEST and creates nothing", async () => {
    const root = rootOf();
    const store = storeOf(root);
    for (const bad of [
      null,
      "group",
      [],
      {},
      { op: "merge", a: "a", b: "b" },
      { op: "group", a: "a" },
      { op: "group", a: "a", b: "a" },
      { op: "group", a: "a", b: "b", at: 1 },
      { op: "detach", a: "a", b: "b" },
      { op: "detach", a: "" },
      { op: "group", a: "x".repeat(513), b: "b" },
      { op: "rename", members: ["a"], name: "n" },
      { op: "rename", members: ["a", "a"], name: "n" },
      { op: "rename", members: ["a", "b"], name: "x".repeat(81) },
      { op: "rename", members: ["a", "b"], name: 5 },
      { op: "rename", members: ["a", "b"] },
      { op: "rename", members: ["a", "b"], name: "n", extra: 1 },
    ])
      expect(refusal(await store.apply(bad)).code, JSON.stringify(bad)).toBe(
        "GROUPS_INVALID_REQUEST",
      );
    expect(NodeFS.existsSync(NodePath.join(root, "aetheria-ui"))).toBe(false);
  });

  it("a 200-member rename whose body fits 8 KiB is accepted; one whose valid-shape body is over 8 KiB is refused GROUPS_REQUEST_TOO_LARGE before any file access", async () => {
    const root = rootOf();
    const store = storeOf(root);
    const short = Array.from({ length: 200 }, (_, i) => `s${String(i).padStart(4, "0")}`);
    const fitting = { op: "rename", members: short, name: "Big" } as const;
    expect(new TextEncoder().encode(JSON.stringify(fitting)).length).toBeLessThanOrEqual(8192);
    expect(ok(await store.apply(fitting)).names[0]?.members).toHaveLength(200);

    const longIds = Array.from(
      { length: 200 },
      (_, i) => `${String(i).padStart(4, "0")}-${"x".repeat(40)}`,
    );
    const oversized = { op: "rename", members: longIds, name: "Big" } as const;
    expect(new TextEncoder().encode(JSON.stringify(oversized)).length).toBeGreaterThan(8192);
    const before = text(fileOf(root));
    const spy = createRecorder();
    const guarded = storeOf(root, { rename: spy.rename });
    const refused = refusal(await guarded.apply(oversized));
    expect(refused.code).toBe("GROUPS_REQUEST_TOO_LARGE");
    expect(spy.calls).toBe(0);
    expect(text(fileOf(root))).toBe(before);
    // The cap is on UTF-8 bytes, not characters: a body of multi-byte ids is over 8 KiB sooner than its character count says.
    const wide = Array.from(
      { length: 120 },
      (_, i) => `${String(i).padStart(3, "0")}${"é".repeat(40)}`,
    );
    const wideBody = JSON.stringify({ op: "rename", members: wide, name: "W" });
    expect(wideBody.length).toBeLessThan(8192);
    expect(new TextEncoder().encode(wideBody).length).toBeGreaterThan(8192);
    expect(refusal(await guarded.apply({ op: "rename", members: wide, name: "W" })).code).toBe(
      "GROUPS_REQUEST_TOO_LARGE",
    );
  });

  it("prepareGroupOperation names every session id a request refers to, for the host's per-session check", () => {
    const pair = prepareGroupOperation({ op: "dismiss", a: "q", b: "p" });
    expect(pair).toMatchObject({ ok: true, ids: ["p", "q"] });
    expect(prepareGroupOperation({ op: "detach", a: "x" })).toMatchObject({ ok: true, ids: ["x"] });
    expect(
      prepareGroupOperation({ op: "rename", members: ["c", "a", "a", "b"], name: " n " }),
    ).toMatchObject({
      ok: true,
      ids: ["a", "b", "c"],
      operation: { op: "rename", members: ["a", "b", "c"], name: "n" },
    });
    expect(prepareGroupOperation({ op: "group", a: "a", b: "a" })).toMatchObject({
      ok: false,
      code: "GROUPS_INVALID_REQUEST",
    });
  });
});

describe("a file the store cannot use is refused and left exactly as it was", () => {
  const unusable: ReadonlyArray<readonly [string, string]> = [
    ["not JSON", "{not json"],
    ["not an object", "[]"],
    ["a newer version", JSON.stringify({ version: 3, links: [], dismissed: [], names: [] })],
    ["version 0", JSON.stringify({ version: 0, links: [], dismissed: [], names: [] })],
    [
      "an unknown field",
      JSON.stringify({ version: 2, links: [], dismissed: [], names: [], extra: 1 }),
    ],
    ["missing names", JSON.stringify({ version: 2, links: [], dismissed: [] })],
    [
      "a pair not stored with a < b",
      JSON.stringify({
        version: 2,
        links: [{ a: "b", b: "a", kind: "grouped", at: 1 }],
        dismissed: [],
        names: [],
      }),
    ],
    [
      "a duplicate link",
      JSON.stringify({
        version: 2,
        links: [
          { a: "a", b: "b", kind: "grouped", at: 1 },
          { a: "a", b: "b", kind: "grouped", at: 2 },
        ],
        dismissed: [],
        names: [],
      }),
    ],
    [
      "an unknown link kind",
      JSON.stringify({
        version: 2,
        links: [{ a: "a", b: "b", kind: "forked", at: 1 }],
        dismissed: [],
        names: [],
      }),
    ],
    [
      "unsorted name members",
      JSON.stringify({
        version: 2,
        links: [],
        dismissed: [],
        names: [{ members: ["b", "a"], name: "n", at: 1 }],
      }),
    ],
    [
      "an untrimmed name",
      JSON.stringify({
        version: 2,
        links: [],
        dismissed: [],
        names: [{ members: ["a", "b"], name: " n", at: 1 }],
      }),
    ],
    [
      "a non-finite time",
      '{"version":2,"links":[{"a":"a","b":"b","kind":"grouped","at":null}],"dismissed":[],"names":[]}',
    ],
  ];
  it.each(unusable)(
    "%s: read and apply both answer GROUPS_STORE_UNUSABLE and the bytes are unchanged",
    async (_name, body) => {
      const root = rootOf();
      seed(root, body);
      const store = storeOf(root);
      expect(refusal(await store.read()).code).toBe("GROUPS_STORE_UNUSABLE");
      expect(refusal(await store.apply({ op: "group", a: "a", b: "b" })).code).toBe(
        "GROUPS_STORE_UNUSABLE",
      );
      expect(text(fileOf(root))).toBe(body);
      expect(listing(root)).toEqual(["session-groups.json"]);
    },
  );

  it("an unreadable path (a directory where the file should be) is refused, not read as empty", async () => {
    const root = rootOf();
    NodeFS.mkdirSync(fileOf(root), { recursive: true });
    expect(refusal(await storeOf(root).read()).code).toBe("GROUPS_STORE_UNUSABLE");
  });

  it("the refusal's detail never names a path", async () => {
    const root = rootOf();
    seed(root, "{not json");
    expect(refusal(await storeOf(root).read()).detail).not.toContain(root);
  });
});

describe("a version-1 file", () => {
  const v1 = JSON.stringify({
    version: 1,
    links: [{ a: "a", b: "b", kind: "grouped", at: 7 }],
    dismissed: [],
  });

  it("reads as a version-2 record with no names and is not rewritten by a read or by a no-op", async () => {
    const root = rootOf();
    seed(root, v1);
    const store = storeOf(root);
    expect(ok(await store.read())).toEqual({
      version: 2,
      links: [{ a: "a", b: "b", kind: "grouped", at: 7 }],
      dismissed: [],
      names: [],
    });
    ok(await store.apply({ op: "group", a: "b", b: "a" }));
    expect(text(fileOf(root))).toBe(v1);
    expect(NodeFS.existsSync(backupOf(root))).toBe(false);
  });

  it("the first change publishes the file's exact original bytes as the one backup, then version 2 replaces it; a later change never touches the backup", async () => {
    const root = rootOf();
    seed(root, v1);
    const store = storeOf(root);
    const changed = ok(await store.apply({ op: "dismiss", a: "x", b: "y" }));
    expect(changed.version).toBe(2);
    expect(text(backupOf(root))).toBe(v1);
    expect(JSON.parse(text(fileOf(root)))).toEqual(changed);
    NodeFS.writeFileSync(backupOf(root), "kept");
    ok(await store.apply({ op: "dismiss", a: "p", b: "q" }));
    expect(text(backupOf(root))).toBe("kept");
  });

  it("a failed backup publication leaves the version-1 file as it was and the change is refused", async () => {
    const root = rootOf();
    seed(root, v1);
    const failing = storeOf(root, {
      rename: async (from, to) => {
        if (to.endsWith(GROUPS_BACKUP_FILE)) throw new Error("injected");
        NodeFS.renameSync(from, to);
      },
    });
    // Only a complete backup lets version 2 replace version 1.
    const outcome = refusal(await failing.apply({ op: "dismiss", a: "x", b: "y" }));
    expect(outcome.code).toBe("GROUPS_STORE_UNUSABLE");
    expect(text(fileOf(root))).toBe(v1);
    expect(NodeFS.existsSync(backupOf(root))).toBe(false);
    expect(listing(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("a write that fails leaves the previous record in place", () => {
  it("a failure at the publishing rename is a refusal, the file keeps its bytes, and no temporary file is left", async () => {
    const root = rootOf();
    const store = storeOf(root);
    ok(await store.apply({ op: "group", a: "a", b: "b" }));
    const before = text(fileOf(root));
    const failing = storeOf(root, {
      rename: async () => {
        throw new Error("injected rename failure");
      },
    });
    const refused = refusal(await failing.apply({ op: "group", a: "a", b: "c" }));
    expect(refused.code).toBe("GROUPS_STORE_UNUSABLE");
    expect(refused.detail).toContain("previous record is unchanged");
    expect(text(fileOf(root))).toBe(before);
    expect(listing(root)).toEqual(["session-groups.json"]);
    // The next call, with the real rename, works: a failed write left no lock behind.
    expect(ok(await storeOf(root).apply({ op: "group", a: "a", b: "c" })).links).toHaveLength(2);
  });

  it("replaces the whole file through a temporary file in the same folder, owner-only", async () => {
    const root = rootOf();
    const spy = createRecorder();
    ok(await storeOf(root, { rename: spy.rename }).apply({ op: "group", a: "a", b: "b" }));
    expect(spy.pairs).toHaveLength(1);
    const [from, to] = spy.pairs[0]!;
    expect(NodePath.dirname(from)).toBe(NodePath.dirname(to));
    expect(to).toBe(fileOf(root));
    expect(from).not.toBe(to);
    expect(NodeFS.statSync(fileOf(root)).mode & 0o777).toBe(0o600);
  });

  it("concurrent calls are applied one at a time, so none loses another's change", async () => {
    const root = rootOf();
    const store = storeOf(root);
    const ids = Array.from({ length: 24 }, (_, i) => `s${String(i).padStart(2, "0")}`);
    const outcomes = await Promise.all(
      ids.map((id) => store.apply({ op: "group", a: "hub", b: id })),
    );
    for (const outcome of outcomes) ok(outcome);
    expect(ok(await store.read()).links).toHaveLength(24);
  });
});

describe("the disclosed view", () => {
  it("filterGroupsRecord keeps a pair only when both sessions are kept and a name only when every member is", () => {
    const parsed = parseGroupsRecord({
      version: 2,
      links: [
        { a: "a", b: "b", kind: "grouped", at: 1 },
        { a: "a", b: "z", kind: "grouped", at: 2 },
      ],
      dismissed: [
        { a: "a", b: "z", at: 3 },
        { a: "b", b: "c", at: 4 },
      ],
      names: [
        { members: ["a", "b"], name: "Keep", at: 5 },
        { members: ["a", "z"], name: "Drop", at: 6 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const view = filterGroupsRecord(parsed.record, (id) => id !== "z");
    expect(view.links.map((l) => `${l.a}${l.b}`)).toEqual(["ab"]);
    expect(view.dismissed.map((d) => `${d.a}${d.b}`)).toEqual(["bc"]);
    expect(view.names.map((n) => n.name)).toEqual(["Keep"]);
    expect(filterGroupsRecord(parsed.record, () => true)).toEqual(parsed.record);
  });
});

describe("the module registration", () => {
  it("is absent before start, serves while started, and after drain refuses a handle it handed out", async () => {
    const root = rootOf();
    const registration = createGroupsBackendRegistration({ stateRoot: root, now });
    expect(registration.groups()).toBeUndefined();
    await registration.activation.start({ id: "groups-backend" });
    const service = registration.groups();
    expect(service).toBeDefined();
    ok(await service!.apply({ op: "group", a: "a", b: "b" }));
    expect(ok(await service!.read()).links).toHaveLength(1);
    const report = (await registration.activation.drain("test")) as { released: string[] };
    expect(report).toMatchObject({ stillLive: [], stopped: [], transferred: [] });
    expect(report.released).toContain("backend-groups.store");
    expect(registration.groups()).toBeUndefined();
    expect(refusal(await service!.read()).code).toBe("GROUPS_UNAVAILABLE");
    expect(refusal(await service!.apply({ op: "group", a: "c", b: "d" })).code).toBe(
      "GROUPS_UNAVAILABLE",
    );
    expect(ok(await storeOf(root).read()).links).toHaveLength(1);
  });

  it("starting does not read or create the file: a store that is unusable does not stop the Backend, it refuses each call", async () => {
    const root = rootOf();
    seed(root, "{not json");
    const registration = createGroupsBackendRegistration({ stateRoot: root, now });
    await registration.activation.start({ id: "groups-backend" });
    expect(refusal(await registration.groups()!.read()).code).toBe("GROUPS_STORE_UNUSABLE");
    await registration.activation.drain("test");
    expect(text(fileOf(root))).toBe("{not json");
  });

  it("drain waits for the call in flight, then closes; it reports once and again the same", async () => {
    const root = rootOf();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const registration = createGroupsBackendRegistration({
      stateRoot: root,
      now,
      rename: async (from, to) => {
        await gate;
        NodeFS.renameSync(from, to);
      },
    });
    await registration.activation.start({ id: "groups-backend" });
    const pending = registration.groups()!.apply({ op: "group", a: "a", b: "b" });
    const draining = registration.activation.drain("test");
    release();
    expect(ok(await pending).links).toHaveLength(1);
    await draining;
    expect(await registration.activation.drain("test")).toMatchObject({ stillLive: [] });
  });
});

function createRecorder() {
  const recorder = {
    calls: 0,
    pairs: [] as Array<[string, string]>,
    rename: async (from: string, to: string) => {
      recorder.calls += 1;
      recorder.pairs.push([from, to]);
      NodeFS.renameSync(from, to);
    },
  };
  return recorder;
}
