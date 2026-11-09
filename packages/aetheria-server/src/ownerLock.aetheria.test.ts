// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA — the Backend's state-root owner lock (user decision F1, step 29): exclusive owner-only file, fail-closed refusal, proven-dead takeover.
// Boundary: real files under a real temporary state root, a scripted process probe and an injected clock; the real probe is exercised on this
// machine's own process and on a spawned child that is killed. Does not show: the Linux /proc branch, a network file system, a live crash.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { rootOf } from "./identity/testkit.ts";
import {
  OWNER_LOCK_FILE,
  acquireOwnerLock,
  nodeProcessProbe,
  type OwnerIdentity,
  type ProcessProbe,
  type ProcessState,
} from "./ownerLock.ts";

const HOST = "test-host";
const ME: OwnerIdentity = { pid: 1000, startToken: "t-me", host: HOST };
const NOW = 5_000_000;
const OLD = NOW - 10_000;
const lockOf = (root: string): string => NodePath.join(root, OWNER_LOCK_FILE);

const probeOf = (states: Record<number, ProcessState>): ProcessProbe => ({
  inspect: async (pid) => states[pid] ?? { state: "gone" },
});
const alive = (startToken: string | null): ProcessState => ({ state: "alive", startToken });
const base = { now: () => NOW, self: ME, probe: probeOf({ [ME.pid]: alive("t-me") }) };

function seed(
  root: string,
  holder: Partial<OwnerIdentity> & { createdAtMs?: number; nonce?: string },
): string {
  const text = JSON.stringify({
    v: 1,
    kind: "aetheria-backend-owner",
    nonce: holder.nonce ?? "old-nonce",
    createdAtMs: holder.createdAtMs ?? OLD,
    owner: {
      pid: holder.pid ?? 2000,
      startToken: "startToken" in holder ? holder.startToken : "t-old",
      host: holder.host ?? HOST,
    },
    digest: "sha256:seed",
  });
  NodeFS.writeFileSync(lockOf(root), text, { mode: 0o600 });
  return text;
}
const nonceOf = (root: string): string =>
  JSON.parse(NodeFS.readFileSync(lockOf(root), "utf8")).nonce;

describe("taking the lock", () => {
  it("creates an owner-only file naming this process, the start token, the host and the digest", async () => {
    const root = rootOf();
    const taken = await acquireOwnerLock({ stateRoot: root, digest: "sha256:abc", ...base });
    expect(taken.ok).toBe(true);
    const stat = NodeFS.lstatSync(lockOf(root));
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(NodeFS.readFileSync(lockOf(root), "utf8"))).toMatchObject({
      v: 1,
      kind: "aetheria-backend-owner",
      createdAtMs: NOW,
      owner: { pid: 1000, startToken: "t-me", host: HOST },
      digest: "sha256:abc",
    });
    expect(NodeFS.readdirSync(root)).toEqual([OWNER_LOCK_FILE]);
  });

  it("creates the state root when it is absent", async () => {
    const root = NodePath.join(rootOf(), "fresh", "state");
    expect((await acquireOwnerLock({ stateRoot: root, ...base })).ok).toBe(true);
    expect(NodeFS.existsSync(lockOf(root))).toBe(true);
  });

  it("refuses while the first holder lives, with state-root-owned, and leaves the file as it was", async () => {
    const root = rootOf();
    expect((await acquireOwnerLock({ stateRoot: root, ...base })).ok).toBe(true);
    const before = NodeFS.readFileSync(lockOf(root), "utf8");
    const second = await acquireOwnerLock({ stateRoot: root, ...base });
    expect(second).toMatchObject({ ok: false, code: "state-root-owned" });
    if (!second.ok) expect(second.detail).toContain("pid 1000");
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(before);
  });
});

describe("releasing the lock", () => {
  it("removes the file when it is still ours, and is idempotent", async () => {
    const root = rootOf();
    const taken = await acquireOwnerLock({ stateRoot: root, ...base });
    if (!taken.ok) throw new Error("must take");
    taken.lock.release();
    taken.lock.release();
    expect(NodeFS.existsSync(lockOf(root))).toBe(false);
    expect((await acquireOwnerLock({ stateRoot: root, ...base })).ok).toBe(true);
  });

  it("never removes a successor's lock", async () => {
    const root = rootOf();
    const taken = await acquireOwnerLock({ stateRoot: root, ...base });
    if (!taken.ok) throw new Error("must take");
    NodeFS.unlinkSync(lockOf(root));
    const theirs = seed(root, { nonce: "successor", pid: 3000, createdAtMs: NOW });
    taken.lock.release();
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(theirs);
  });
});

describe("a holder that is not proven dead keeps the lock", () => {
  const cases: [string, ProcessState, Partial<OwnerIdentity>][] = [
    ["alive with the recorded start token", alive("t-old"), {}],
    ["alive with no start token to compare", alive(null), {}],
    ["alive but the lock recorded no start token", alive("t-new"), { startToken: null }],
    ["unobservable", { state: "unknown" }, {}],
    ["gone, but on another host", { state: "gone" }, { host: "elsewhere" }],
  ];
  it.each(cases)("%s: refused, the file is untouched", async (_name, state, holder) => {
    const root = rootOf();
    const text = seed(root, holder);
    const result = await acquireOwnerLock({
      stateRoot: root,
      ...base,
      probe: probeOf({ [ME.pid]: alive("t-me"), 2000: state }),
    });
    expect(result).toMatchObject({ ok: false, code: "state-root-owned" });
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(text);
  });

  it("a non-Backend process holding a well-formed lock is just a live holder", async () => {
    const root = rootOf();
    seed(root, { pid: 4000, startToken: "t-other" });
    const result = await acquireOwnerLock({
      stateRoot: root,
      ...base,
      probe: probeOf({ [ME.pid]: alive("t-me"), 4000: alive("t-other") }),
    });
    expect(result).toMatchObject({ ok: false, code: "state-root-owned" });
  });
});

describe("a holder proven dead is taken over after 10 s", () => {
  it("takes over a gone holder whose lock is 10 000 ms old", async () => {
    const root = rootOf();
    seed(root, { createdAtMs: OLD });
    const result = await acquireOwnerLock({ stateRoot: root, ...base });
    expect(result.ok).toBe(true);
    expect(JSON.parse(NodeFS.readFileSync(lockOf(root), "utf8")).owner.pid).toBe(1000);
    expect(NodeFS.readdirSync(root)).toEqual([OWNER_LOCK_FILE]);
  });

  it("refuses a gone holder whose lock is 9 999 ms old", async () => {
    const root = rootOf();
    const text = seed(root, { createdAtMs: OLD + 1 });
    const result = await acquireOwnerLock({ stateRoot: root, ...base });
    expect(result).toMatchObject({ ok: false, code: "state-root-owned" });
    if (!result.ok) expect(result.detail).toContain("9999 ms");
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(text);
  });

  it("takes over when the pid is alive with another start token (the pid was reused)", async () => {
    const root = rootOf();
    seed(root, { startToken: "t-old" });
    const result = await acquireOwnerLock({
      stateRoot: root,
      ...base,
      probe: probeOf({ [ME.pid]: alive("t-me"), 2000: alive("t-reused") }),
    });
    expect(result.ok).toBe(true);
  });

  it("with two takers over one stale lock exactly one wins, and the loser leaves the winner's lock", async () => {
    const root = rootOf();
    seed(root, { createdAtMs: OLD });
    let asked = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const probe: ProcessProbe = {
      inspect: async (pid) => {
        if (pid !== 2000) return alive("t-me");
        asked += 1;
        if (asked === 2) open();
        await gate;
        return { state: "gone" };
      },
    };
    const a = acquireOwnerLock({ stateRoot: root, ...base, probe, self: { ...ME, pid: 1001 } });
    const b = acquireOwnerLock({ stateRoot: root, ...base, probe, self: { ...ME, pid: 1002 } });
    const results = await Promise.all([a, b]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toMatchObject({ ok: false, code: "state-root-owned" });
    const winner = results.find((r) => r.ok);
    if (winner === undefined || !winner.ok) throw new Error("one must win");
    expect(nonceOf(root)).toBe(winner.lock.nonce);
    expect(NodeFS.readdirSync(root)).toEqual([OWNER_LOCK_FILE]);
  });
});

describe("the reclaim guard", () => {
  const guardOf = (root: string): string => `${lockOf(root)}.reclaim`;
  const guardText = (createdAtMs: number, pid: number): string =>
    JSON.stringify({
      v: 1,
      kind: "aetheria-backend-owner",
      nonce: "guard-nonce",
      createdAtMs,
      owner: { pid, startToken: "t-g", host: HOST },
      digest: "",
    });

  it("a guard left by a crashed reclaimer (gone, 10 s old) is cleared and the takeover proceeds", async () => {
    const root = rootOf();
    seed(root, { createdAtMs: OLD });
    NodeFS.writeFileSync(guardOf(root), guardText(OLD, 2500), { mode: 0o600 });
    const result = await acquireOwnerLock({ stateRoot: root, ...base });
    expect(result.ok).toBe(true);
    expect(NodeFS.readdirSync(root)).toEqual([OWNER_LOCK_FILE]);
  });

  it("a guard held by a live reclaimer refuses the takeover and both files stay", async () => {
    const root = rootOf();
    const text = seed(root, { createdAtMs: OLD });
    NodeFS.writeFileSync(guardOf(root), guardText(NOW, 2500), { mode: 0o600 });
    const result = await acquireOwnerLock({
      stateRoot: root,
      ...base,
      probe: probeOf({ [ME.pid]: alive("t-me"), 2500: alive("t-g") }),
    });
    expect(result).toMatchObject({ ok: false, code: "state-root-owned" });
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(text);
    expect(NodeFS.existsSync(guardOf(root))).toBe(true);
  });
});

describe("an unusable lock is not a dead holder", () => {
  const bad: [string, () => string][] = [
    ["empty", () => ""],
    ["not JSON", () => "{broken"],
    [
      "another version",
      () =>
        JSON.stringify({ v: 2, nonce: "n", createdAtMs: OLD, owner: { pid: 2000, host: HOST } }),
    ],
    [
      "no owner",
      () => JSON.stringify({ v: 1, kind: "aetheria-backend-owner", nonce: "n", createdAtMs: OLD }),
    ],
    [
      "another kind",
      () =>
        JSON.stringify({
          v: 1,
          kind: "other",
          nonce: "n",
          createdAtMs: OLD,
          owner: { pid: 2000, host: HOST },
        }),
    ],
  ];
  it.each(bad)("%s: refused as state-root-lock-unusable and left in place", async (_name, text) => {
    const root = rootOf();
    NodeFS.writeFileSync(lockOf(root), text(), { mode: 0o600 });
    const result = await acquireOwnerLock({ stateRoot: root, ...base });
    expect(result).toMatchObject({ ok: false, code: "state-root-lock-unusable" });
    expect(NodeFS.readFileSync(lockOf(root), "utf8")).toBe(text());
  });

  it("a symbolic link or a folder at the lock name is refused and not followed", async () => {
    const link = rootOf();
    const target = NodePath.join(rootOf(), "elsewhere");
    NodeFS.writeFileSync(target, seed(link, {}));
    NodeFS.unlinkSync(lockOf(link));
    NodeFS.symlinkSync(target, lockOf(link));
    expect(await acquireOwnerLock({ stateRoot: link, ...base })).toMatchObject({
      ok: false,
      code: "state-root-lock-unusable",
    });
    const folder = rootOf();
    NodeFS.mkdirSync(lockOf(folder));
    expect(await acquireOwnerLock({ stateRoot: folder, ...base })).toMatchObject({
      ok: false,
      code: "state-root-lock-unusable",
    });
  });

  it("a state root that cannot be created is refused as unusable", async () => {
    const blocker = NodePath.join(rootOf(), "file");
    NodeFS.writeFileSync(blocker, "x");
    expect(
      await acquireOwnerLock({ stateRoot: NodePath.join(blocker, "state"), ...base }),
    ).toMatchObject({ ok: false, code: "state-root-lock-unusable" });
  });
});

describe("the real process probe", () => {
  it("sees this process alive with a start token", async () => {
    const seen = await nodeProcessProbe().inspect(process.pid);
    expect(seen.state).toBe("alive");
    if (seen.state === "alive") expect(seen.startToken).toMatch(/^(proc|ps):.+/);
  });

  it("sees a live child alive with a token, and the same child gone once it is killed", async () => {
    const child = NodeChildProcess.spawn(process.execPath, ["-e", "process.stdin.resume()"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const pid = child.pid as number;
    const probe = nodeProcessProbe();
    const theirs = await probe.inspect(pid);
    expect(theirs.state).toBe("alive");
    if (theirs.state === "alive") expect(theirs.startToken).toMatch(/^(proc|ps):.+/);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    expect(await probe.inspect(pid)).toEqual({ state: "gone" });
  });

  it("an invalid pid is unknown, never gone", async () => {
    expect(await nodeProcessProbe().inspect(0)).toEqual({ state: "unknown" });
    expect(await nodeProcessProbe().inspect(Number.NaN)).toEqual({ state: "unknown" });
  });
});
