// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M10 Plan step 14 (D11, D12, XC-20; GAP-3) — the board runtime's in-process read of one root's recorded edit paths, `editsOf(rootSessionId)`.
// Boundary: the real board runtime over the real file board under a real state root, the real thread index and the real liveness service; Git is a named double ("outside git").
// It shows the three answers apart: `known` (the board holds a record of the root session, its paths deduplicated, an empty list being a known empty), `unknown` (no binding, no
// workspace, or the board holds no record of the root: nothing is said about its edits) and `unavailable` (the board cannot be read, or the runtime has drained). It shows that a
// child's edit lands on its root's record, and that the read writes nothing. It does NOT show the client RPC, the route, or a workspace the root's children used that differs from the root's.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createThreadIndex } from "../identity/threadIndex.ts";
import { createLivenessService } from "../liveness/service.ts";
import { boardFileFor, parseAwarenessConfig } from "../library.ts";
import { createBoardRuntime } from "./runtime.ts";
import {
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  rootOf,
  sessionFileOf,
} from "../identity/testkit.ts";

const created: string[] = [];
afterAll(() => {
  for (const dir of created.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});
const workspaceDir = (): string => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-edits-")));
  created.push(dir);
  return dir;
};
const outsideGit = {
  topLevel: async () => undefined,
  changedFiles: async () => ({ status: "outside-git" as const }),
};
const config = (() => {
  const parsed = parseAwarenessConfig(undefined);
  if (!parsed.ok) throw new Error("config");
  return parsed.config;
})();

function setup(options: { readonly bindRoot?: boolean } = {}) {
  const stateRoot = rootOf();
  const workspace = workspaceDir();
  const index = createThreadIndex({ stateRoot, now: () => 5_000_000, projectRootOf: (f) => f });
  if (options.bindRoot !== false) {
    const bound = index.bind({
      threadId: THREAD,
      providerInstanceId: "pi",
      providerSessionId: "c1",
      sessionFile: sessionFileOf(SESSION),
      workingFolder: workspace,
    });
    expect(bound.ok).toBe(true);
  }
  const childBound = index.bind({
    threadId: THREAD_B,
    providerInstanceId: "pi",
    providerSessionId: "c2",
    sessionFile: sessionFileOf(SESSION_B),
    workingFolder: workspace,
  });
  expect(childBound.ok).toBe(true);
  const liveness = createLivenessService({ now: () => 5_000_000 });
  const runtime = createBoardRuntime({
    stateRoot,
    index,
    liveness,
    config,
    now: () => 5_000_000,
    git: outsideGit,
  });
  runtime.setReplayHorizon(0);
  const ctx = (who: "root" | "child", args: Record<string, unknown>) => ({
    caller: {
      threadId: who === "root" ? THREAD : THREAD_B,
      providerSessionId: who === "root" ? "c1" : "c2",
      providerInstanceId: "pi",
    },
    sessionId: who === "root" ? SESSION : SESSION_B,
    kind: who === "root" ? ("main" as const) : ("child" as const),
    rootSessionId: SESSION,
    args,
  });
  const recordEdit = (who: "root" | "child", name: string, callId: string) =>
    runtime.operations()["board.record-edit"]!(
      ctx(who, {
        toolCallId: callId,
        operation: "write",
        canonicalPath: NodePath.join(workspace, name),
        mode: "create",
        token: { size: 1, digest: "d" },
      }),
    );
  return { stateRoot, workspace, runtime, ctx, recordEdit };
}

describe("editsOf(rootSessionId)", () => {
  it("is unknown for a session the index does not bind, and says nothing else", async () => {
    const w = setup({ bindRoot: false });
    expect(await w.runtime.editsOf(SESSION)).toEqual({ status: "unknown", reason: "no-workspace" });
    expect(await w.runtime.editsOf("0197d3c0-9999-7000-8000-000000000009")).toEqual({
      status: "unknown",
      reason: "no-workspace",
    });
  });

  it("is unknown, not an empty list, while the board holds no record of the root", async () => {
    const w = setup();
    expect(await w.runtime.editsOf(SESSION)).toEqual({ status: "unknown", reason: "no-record" });
  });

  it("is known with the root's recorded paths, once each and in the board's sorted form, a child's edit landing on its root", async () => {
    const w = setup();
    await w.recordEdit("root", "b.txt", "e1");
    await w.recordEdit("root", "a.txt", "e2");
    await w.recordEdit("root", "b.txt", "e3");
    await w.recordEdit("child", "c.txt", "e4");
    expect(await w.runtime.editsOf(SESSION)).toEqual({
      status: "known",
      workspace: w.workspace,
      paths: [
        NodePath.join(w.workspace, "a.txt"),
        NodePath.join(w.workspace, "b.txt"),
        NodePath.join(w.workspace, "c.txt"),
      ],
    });
    // The child is no root: the board holds edits against its root's record only.
    expect(await w.runtime.editsOf(SESSION_B)).toEqual({ status: "unknown", reason: "no-record" });
  });

  it("is a known empty list once the root's session is recorded and has recorded no edit", async () => {
    const w = setup();
    const goal = await w.runtime.operations()["awareness.action"]!(
      w.ctx("root", { action: "goal", text: "work" }),
    );
    expect(goal).toMatchObject({ status: "done" });
    expect(await w.runtime.editsOf(SESSION)).toEqual({
      status: "known",
      workspace: w.workspace,
      paths: [],
    });
  });

  it("is unavailable while the board cannot be read, and known again once it can", async () => {
    const w = setup();
    await w.recordEdit("root", "a.txt", "e1");
    const file = boardFileFor(w.stateRoot, w.workspace);
    const good = NodeFS.readFileSync(file, "utf8");
    NodeFS.writeFileSync(file, "{ not json");
    const down = await w.runtime.editsOf(SESSION);
    expect(down.status).toBe("unavailable");
    NodeFS.writeFileSync(file, good);
    expect(await w.runtime.editsOf(SESSION)).toMatchObject({ status: "known" });
  });

  it("writes nothing: the board file is byte for byte as it was", async () => {
    const w = setup();
    await w.recordEdit("root", "a.txt", "e1");
    const file = boardFileFor(w.stateRoot, w.workspace);
    const before = NodeFS.readFileSync(file, "utf8");
    await w.runtime.editsOf(SESSION);
    await w.runtime.editsOf(SESSION_B);
    expect(NodeFS.readFileSync(file, "utf8")).toBe(before);
  });

  it("is unavailable after the drain", async () => {
    const w = setup();
    await w.recordEdit("root", "a.txt", "e1");
    await w.runtime.drain();
    expect((await w.runtime.editsOf(SESSION)).status).toBe("unavailable");
  });
});
