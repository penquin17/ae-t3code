// The group store's behaviour: every change ends as one honest outcome, success only from the Backend's reply plus a
// re-read that shows the effect, nothing resent, nothing edited optimistically. Boundary: the store over a transport;
// the transport here is the in-memory fake (testing.ts), so these tests show the web side's handling, not a real Backend.
import { describe, expect, it } from "vite-plus/test";

import type { RunResult } from "../core/outcome";
import { renameBody } from "./operations";
import type { GroupRecord } from "./record";
import { createGroupsStore, type GroupsStore } from "./store";
import { createFakeBackend, emptyRecord, type FakeBackend } from "./testing";
import {
  GROUPS_UNAVAILABLE_REASON,
  unavailableTransport,
  type GroupsReply,
  type GroupsTransport,
} from "./transport";

let counter = 0;
const newRequestId = () => `req-${(counter += 1)}`;
const storeOver = (backend: FakeBackend): GroupsStore =>
  createGroupsStore({ transport: backend.transport, newRequestId });

const seeded: GroupRecord = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
  dismissed: [{ a: "p", b: "q", at: 2 }],
  names: [{ members: ["a", "b"], name: "Old", at: 3 }],
};

interface Mutation {
  readonly label: string;
  readonly run: (store: GroupsStore) => Promise<RunResult<GroupRecord>>;
  /** A start record on which the change has an effect to confirm. */
  readonly from: GroupRecord;
}
const MUTATIONS: readonly Mutation[] = [
  { label: "group", run: (s) => s.group("c", "d"), from: seeded },
  { label: "ungroup", run: (s) => s.ungroup("a", "b"), from: seeded },
  { label: "dismiss", run: (s) => s.dismiss("c", "d"), from: seeded },
  { label: "detach", run: (s) => s.detach("a"), from: seeded },
  { label: "rename", run: (s) => s.rename(["a", "b"], "New"), from: seeded },
];

async function ready(backend: FakeBackend): Promise<GroupsStore> {
  const store = storeOver(backend);
  await store.refresh();
  backend.events.length = 0;
  return store;
}
const recordOf = (store: GroupsStore): GroupRecord | undefined => {
  const state = store.getState().record;
  return state.state === "known" ? state.value : undefined;
};

describe("reading the Backend's record", () => {
  it("is unknown before the first read, never empty", () => {
    const store = storeOver(createFakeBackend());
    expect(store.getState().record.state).toBe("unknown");
  });

  it("is empty only when the Backend's reply says so", async () => {
    const store = storeOver(createFakeBackend(emptyRecord));
    await store.refresh();
    expect(store.getState().record).toEqual({ state: "known", value: emptyRecord });
  });

  it("refuses an unsupported or malformed record without repair or an empty reading", async () => {
    const backend = createFakeBackend();
    backend.readFaults.push("garbage");
    const store = storeOver(backend);
    await store.refresh();
    const state = store.getState();
    expect(state.record.state).toBe("unavailable");
    expect(state.problem?.code).toBe("unsupported");
    expect(JSON.stringify(state)).not.toContain('"links":[]');
  });

  it("the default transport says the store is not connected, as unavailable", async () => {
    const store = createGroupsStore({ transport: unavailableTransport, newRequestId });
    await store.refresh();
    expect(store.getState().record).toEqual({
      state: "unavailable",
      reason: GROUPS_UNAVAILABLE_REASON,
    });
    const run = await store.group("a", "b");
    expect(run.outcome).toEqual({ kind: "unavailable", reason: GROUPS_UNAVAILABLE_REASON });
  });

  it("keeps the last confirmed record when a later read fails, and says so", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    backend.readFaults.push("throw");
    await store.refresh();
    expect(recordOf(store)).toEqual(seeded);
    expect(store.getState().problem).toBeDefined();
    await store.refresh();
    expect(store.getState().problem).toBeUndefined();
  });

  it("a reload (a new store) and a second context over the same Backend read the same record", async () => {
    const backend = createFakeBackend(seeded);
    const first = await ready(backend);
    await first.group("c", "d");
    const reloaded = await ready(backend);
    const other = await ready(backend);
    expect(recordOf(reloaded)).toEqual(backend.record());
    expect(recordOf(other)).toEqual(recordOf(first));
    expect(recordOf(reloaded)).toEqual(recordOf(other));
  });
});

describe("a read that does not answer", () => {
  const never: GroupsTransport = {
    read: () => new Promise(() => {}),
    apply: unavailableTransport.apply,
  };
  const overTimeout = (transport: GroupsTransport) =>
    createGroupsStore({ transport, newRequestId, readTimeoutMs: 20 });

  it("ends within the bound as not read, with the reason, and never waits forever", async () => {
    const store = overTimeout(never);
    await store.refresh();
    const state = store.getState();
    expect(state.record.state).toBe("unknown");
    expect(state.record.state === "unknown" ? state.record.reason : "").toBe(
      "The Backend did not answer the groups read in time.",
    );
    expect(state.problem?.code).toBe("GROUPS_READ_TIMEOUT");
  });

  it("does not hold a change's re-read open: the change still ends as one outcome", async () => {
    const backend = createFakeBackend(seeded);
    const store = overTimeout({ read: never.read, apply: backend.transport.apply });
    const result = await store.group("c", "d");
    expect(result.outcome).toMatchObject({ kind: "confirmed", refreshed: false });
  });

  it("takes a late answer when nothing newer has been read", async () => {
    let answer: (reply: GroupsReply) => void = () => {};
    const late = new Promise<GroupsReply>((resolve) => (answer = resolve));
    const store = overTimeout({ read: () => late, apply: unavailableTransport.apply });
    await store.refresh();
    expect(store.getState().record.state).toBe("unknown");
    answer({ ok: true, value: seeded });
    await expect.poll(() => recordOf(store)).toEqual(seeded);
    expect(store.getState().problem).toBeUndefined();
  });

  it("drops a late answer once a newer read has settled", async () => {
    const backend = createFakeBackend(seeded);
    let answer: (reply: GroupsReply) => void = () => {};
    let calls = 0;
    const store = overTimeout({
      read: () =>
        (calls += 1) === 1
          ? new Promise<GroupsReply>((resolve) => (answer = resolve))
          : backend.transport.read(),
      apply: backend.transport.apply,
    });
    await store.refresh();
    await store.refresh();
    expect(recordOf(store)).toEqual(seeded);
    answer({ ok: true, value: emptyRecord });
    // Let the late answer's promise chain run to its end before looking.
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(recordOf(store)).toEqual(seeded);
  });
});

describe.each(MUTATIONS)("$label ends as exactly one honest outcome", ({ run, from }) => {
  it("confirmed: the Backend accepted it and the re-read shows it", async () => {
    const backend = createFakeBackend(from);
    const store = await ready(backend);
    const result = await run(store);
    expect(result.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    expect(result.current).toBe(true);
    expect(recordOf(store)).toEqual(backend.record());
    expect(backend.events.filter((e) => e.startsWith("apply"))).toHaveLength(1);
    expect(backend.events.at(-1)).toBe("read");
  });

  it("refused: the Backend's own message is carried verbatim and the displayed record is unchanged", async () => {
    const backend = createFakeBackend(from);
    const store = await ready(backend);
    const before = store.getState().record;
    backend.applyFaults.push({
      refuse: "GROUPS_NOT_AUTHORIZED",
      detail: "This device is read-only: ‘no’.",
    });
    const result = await run(store);
    expect(result.outcome).toEqual({
      kind: "refused",
      code: "GROUPS_NOT_AUTHORIZED",
      message: "This device is read-only: ‘no’.",
    });
    expect(store.getState().record).toBe(before);
    expect(backend.events).toEqual([expect.stringMatching(/^apply/)]);
  });

  it("unknown: a lost reply is never resent and the displayed record stays the last confirmed one", async () => {
    const backend = createFakeBackend(from);
    const store = await ready(backend);
    const before = store.getState().record;
    backend.applyFaults.push("throw-after");
    const result = await run(store);
    expect(result.outcome.kind).toBe("unknown");
    expect(backend.events.filter((e) => e.startsWith("apply"))).toHaveLength(1);
    expect(store.getState().record).toBe(before);
    // The write did land; only a read shows it. Nothing was assumed.
    await store.refresh();
    expect(recordOf(store)).toEqual(backend.record());
  });

  it("unavailable: nothing was done and the displayed record is unchanged", async () => {
    const backend = createFakeBackend(from);
    const store = await ready(backend);
    const before = store.getState().record;
    backend.applyFaults.push({ refuse: "GROUPS_UNAVAILABLE" });
    const result = await run(store);
    expect(result.outcome).toEqual({ kind: "unavailable", reason: GROUPS_UNAVAILABLE_REASON });
    expect(store.getState().record).toBe(before);
  });
});

describe("outcomes that depend on the re-read", () => {
  it("accepted but the re-read does not show it: unknown, not success", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    backend.applyFaults.push("lie");
    const result = await store.group("c", "d");
    expect(result.outcome.kind).toBe("unknown");
    expect(recordOf(store)).toEqual(seeded);
  });

  it("accepted but the re-read fails: confirmed, not refreshed, with the reason shown", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    backend.readFaults.push("throw");
    const result = await store.group("c", "d");
    expect(result.outcome).toMatchObject({ kind: "confirmed", refreshed: false });
    expect(result.outcome.kind === "confirmed" && result.outcome.message).toBeTruthy();
    expect(recordOf(store)).toEqual(seeded);
    expect(store.getState().problem).toBeDefined();
  });

  it("a reply that is not a record is a lost reply, not an empty success", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    backend.applyFaults.push("garbage");
    expect((await store.dismiss("c", "d")).outcome.kind).toBe("unknown");
  });

  it("a Backend-reported no-op is confirmed like any change", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    const again = await store.group("a", "b");
    expect(again.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    expect(backend.record().links).toHaveLength(1);
    const absent = await store.ungroup("x", "y");
    expect(absent.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
  });
});

describe("before anything is sent", () => {
  it("an oversized valid-shape rename is refused locally with its reason and never sent", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    const members = Array.from(
      { length: 200 },
      (_, i) => `session-${String(i).padStart(3, "0")}-${"x".repeat(40)}`,
    );
    expect(renameBody(members, "x").ok).toBe(false);
    const result = await store.rename(members, "A topic");
    expect(result.outcome).toMatchObject({ kind: "refused", code: "GROUPS_REQUEST_TOO_LARGE" });
    expect(backend.events).toEqual([]);
  });

  it("a pair of the same session is refused locally and never sent", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    expect((await store.group("a", "a")).outcome).toMatchObject({
      kind: "refused",
      code: "GROUPS_INVALID_REQUEST",
    });
    expect(backend.events).toEqual([]);
  });
});

describe("concurrent calls", () => {
  it("do not interleave: the second is sent only after the first is confirmed", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    const release = backend.holdNextApply();
    const first = store.group("c", "d");
    const second = store.dismiss("e", "f");
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(backend.events).toEqual(["apply:group"]);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(backend.events).toEqual(["apply:group", "read", "apply:dismiss", "read"]);
    expect(one.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    expect(two.outcome).toMatchObject({ kind: "confirmed", refreshed: true });
    expect(recordOf(store)).toEqual(backend.record());
  });

  it("a refresh asked during a change waits for it and then shows the newest record", async () => {
    const backend = createFakeBackend(seeded);
    const store = await ready(backend);
    const release = backend.holdNextApply();
    const change = store.group("c", "d");
    const refresh = store.refresh();
    release();
    await Promise.all([change, refresh]);
    expect(recordOf(store)?.links.some((l) => l.a === "c")).toBe(true);
  });
});

describe("subscribers", () => {
  it("are told when the state changes, and stop after unsubscribing", async () => {
    const backend = createFakeBackend(seeded);
    const store = storeOver(backend);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    await store.refresh();
    expect(calls).toBeGreaterThan(0);
    off();
    const seen = calls;
    await store.refresh();
    expect(calls).toBe(seen);
  });
});
