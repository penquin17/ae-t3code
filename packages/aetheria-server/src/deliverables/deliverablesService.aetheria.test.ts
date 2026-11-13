// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M10 Plan step 13 (XC-1, XC-6, XC-7, XC-20) — the deliverable declaration module inside the assembled Backend, over the REAL snapshot store.
//
// Boundary: the real assembly (`createAetheriaBackendService`: the owner lock, the adapter's gated operation table, ordered start and drain), the real installed `@aetheria/providers` archive with its
// snapshot store, and real temporary folders for the state root, the attachments directory and the declared files. The caller's run is a function (T3's projection is apps/server's, tested there). It
// shows: `present`'s three calls run through the service's own operation table and end with an as-delivered snapshot the real store opens; a snapshot of another session, a changed file's refusal and a
// missing run each leave the card on the current file with its reason; one process holds the state root and so is the store's one writer; a drained Backend refuses and a new one reads the same file.
// It does NOT show T3's real run projection, the HTTP route or Linux.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DELIVERABLES_ATTACH_SNAPSHOT_OPERATION as ATTACH,
  DELIVERABLES_DECLARE_OPERATION as DECLARE,
} from "@t3tools/aetheria-contracts";

import { SESSION, SESSION_B, THREAD, rootOf } from "../identity/testkit.ts";
import type { CallerContextPort } from "../orchestrationFactory.ts";
import { createAetheriaBackendService } from "../service.ts";
import { DELIVERABLES_FILE_RELATIVE } from "./deliverables.ts";

const STORE = "attachments.store-snapshot";
const sha = (data: string) =>
  `sha256:${NodeCrypto.createHash("sha256").update(data).digest("hex")}`;
const context = (sessionId: string, args: Record<string, unknown>) => ({
  caller: { threadId: THREAD, providerSessionId: "cred-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});

function build(
  options: {
    attachments?: boolean;
    callerContext?: boolean;
    stateRoot?: string;
    work?: string;
    run?: () => ReturnType<CallerContextPort>;
  } = {},
) {
  const stateRoot = options.stateRoot ?? rootOf();
  const work = options.work ?? rootOf();
  const attachmentsDir = NodePath.join(rootOf(), "attachments");
  const run: CallerContextPort =
    options.run ??
    (async () => ({
      ok: true,
      threadId: THREAD,
      runId: "run-7",
      nodeId: "node-1",
      workingFolder: work,
    }));
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: () => "cred-1",
    projectRootOf: (folder) => folder,
    ...(options.attachments === false ? {} : { attachmentsDir }),
    ...(options.callerContext === false ? {} : { callerContext: run }),
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  const { service } = made;
  const file = (name: string, content: string) => {
    const path = NodePath.join(work, name);
    NodeFS.writeFileSync(path, content);
    return path;
  };
  const call = async (name: string, sessionId: string, args: Record<string, unknown>) =>
    (await service.operations()[name]!(context(sessionId, args))) as any;
  return {
    service,
    stateRoot,
    work,
    file,
    call,
    storeFile: NodePath.join(stateRoot, DELIVERABLES_FILE_RELATIVE),
  };
}

const bytesOf = async (opened: { ok: boolean; stream?: AsyncIterable<Buffer> }) => {
  const parts: Buffer[] = [];
  for await (const chunk of opened.stream ?? []) parts.push(chunk);
  return Buffer.concat(parts).toString("utf8");
};

describe("the deliverable declaration module in the assembled Backend", () => {
  it("is a running module of the Backend composition, serving the two operations beside the snapshot operations", async () => {
    const w = build();
    expect((await w.service.start()).outcome).toBe("started");
    expect(w.service.status().modules).toContainEqual({
      id: "deliverables-backend",
      required: true,
      state: "running",
    });
    expect(Object.keys(w.service.operations())).toEqual(
      expect.arrayContaining([DECLARE, ATTACH, STORE]),
    );
    expect(w.service.deliverables()).toBeDefined();
    await w.service.dispose("test");
    expect(w.service.deliverables()).toBeUndefined();
  });

  it("runs present's three calls and ends with an as-delivered snapshot the real store opens for that session only", async () => {
    const w = build();
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("report.md", "# The report\n");
    const declared = await w.call(DECLARE, SESSION, { requestId: "tool-1", path, title: "Report" });
    expect(declared.status).toBe("done");
    expect(declared.result).toMatchObject({
      ok: true,
      replayed: false,
      declaration: {
        turnId: "run-7",
        title: "Report",
        kind: "markdown",
        size: 13,
        digest: sha("# The report\n"),
        snapshot: { state: "pending" },
      },
    });
    const id = declared.result.declaration.id as string;
    const stored = await w.call(STORE, SESSION, {
      sourcePath: path,
      declaredDigest: declared.result.declaration.digest,
    });
    expect(stored.result.ok).toBe(true);
    const attached = await w.call(ATTACH, SESSION, {
      declarationId: id,
      snapshotId: stored.result.snapshotId,
    });
    expect(attached.result).toMatchObject({
      ok: true,
      replayed: false,
      declaration: {
        id,
        snapshot: {
          state: "attached",
          snapshotId: stored.result.snapshotId,
          digest: sha("# The report\n"),
          size: 13,
        },
      },
    });
    // The bytes the card's "as delivered" choice will serve are the file's bytes at declaration, even after the file changes.
    NodeFS.writeFileSync(path, "# Rewritten\n");
    expect(
      await bytesOf((await w.service.openSnapshot(SESSION, stored.result.snapshotId)) as never),
    ).toBe("# The report\n");
    expect(await w.service.openSnapshot(SESSION_B, stored.result.snapshotId)).toEqual({
      ok: false,
      code: "ATTACHMENT_MISSING",
    });
    // The in-process read the client handlers will use sees the same record.
    const listed = await w.service.deliverables()!.list(SESSION);
    expect(listed).toMatchObject({
      ok: true,
      value: [{ id, sessionId: SESSION, supersededBy: null, snapshot: { state: "attached" } }],
    });
    // Retrying every call after a lost reply writes nothing and says so.
    const before = NodeFS.readFileSync(w.storeFile, "utf8");
    expect(
      (await w.call(DECLARE, SESSION, { requestId: "tool-1", path, title: "Report" })).result,
    ).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      (await w.call(ATTACH, SESSION, { declarationId: id, snapshotId: stored.result.snapshotId }))
        .result,
    ).toMatchObject({ ok: true, replayed: true });
    expect(NodeFS.readFileSync(w.storeFile, "utf8")).toBe(before);
    await w.service.dispose("test");
  });

  it("refuses another session's snapshot and another session's declaration, which the real store does not hold for the caller", async () => {
    const w = build();
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("a.txt", "one\n");
    const mine = await w.call(DECLARE, SESSION, { requestId: "r", path });
    const theirs = await w.call(DECLARE, SESSION_B, { requestId: "r", path });
    const snapshot = await w.call(STORE, SESSION, {
      sourcePath: path,
      declaredDigest: sha("one\n"),
    });
    // B's own declaration names A's snapshot id: the store opens snapshots only for their owner.
    expect(
      (
        await w.call(ATTACH, SESSION_B, {
          declarationId: theirs.result.declaration.id,
          snapshotId: snapshot.result.snapshotId,
        })
      ).result,
    ).toMatchObject({ ok: false, code: "DELIVERABLE_SNAPSHOT_MISSING" });
    // B cannot settle A's declaration at all.
    expect(
      (
        await w.call(ATTACH, SESSION_B, {
          declarationId: mine.result.declaration.id,
          snapshotId: snapshot.result.snapshotId,
        })
      ).result,
    ).toMatchObject({ ok: false, code: "DELIVERABLE_UNKNOWN" });
    const list = await w.service.deliverables()!.list(SESSION);
    expect((list as any).value[0].snapshot).toEqual({ state: "pending" });
    await w.service.dispose("test");
  });

  it("a snapshot the store refuses leaves the declaration on the current file, with the reason the caller reports", async () => {
    const w = build();
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("a.txt", "one\n");
    const declared = await w.call(DECLARE, SESSION, { requestId: "r", path });
    NodeFS.writeFileSync(path, "two\n");
    const stored = await w.call(STORE, SESSION, {
      sourcePath: path,
      declaredDigest: declared.result.declaration.digest,
    });
    expect(stored.result).toEqual({ ok: false, code: "SNAPSHOT_CHANGED" });
    const attached = await w.call(ATTACH, SESSION, {
      declarationId: declared.result.declaration.id,
      unavailable: stored.result.code,
    });
    expect(attached.result).toMatchObject({
      ok: true,
      declaration: { snapshot: { state: "unavailable", code: "SNAPSHOT_CHANGED" } },
    });
    await w.service.dispose("test");
  });

  it("without an attachments directory the snapshot store is down: attach answers unavailable and the declaration still works", async () => {
    const w = build({ attachments: false });
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("a.txt", "one\n");
    const declared = await w.call(DECLARE, SESSION, { requestId: "r", path });
    expect(declared.result.ok).toBe(true);
    expect(
      await w.call(ATTACH, SESSION, {
        declarationId: declared.result.declaration.id,
        snapshotId: `snap_${"a".repeat(64)}`,
      }),
    ).toEqual({ status: "unavailable", code: "DELIVERABLES_NOT_RUNNING" });
    await w.service.dispose("test");
  });

  it("no one active run is no card, and a host that supplies no run port answers unavailable", async () => {
    const w = build({
      run: async () => ({ ok: false, detail: "the caller thread has no active run" }),
    });
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("a.txt", "one\n");
    expect((await w.call(DECLARE, SESSION, { requestId: "r", path })).result).toEqual({
      ok: false,
      code: "DELIVERABLE_TURN_UNKNOWN",
      detail: "the caller thread has no active run",
    });
    expect(NodeFS.existsSync(w.storeFile)).toBe(false);
    await w.service.dispose("test");

    const bare = build({ callerContext: false });
    expect((await bare.service.start()).outcome).toBe("started");
    expect(
      await bare.call(DECLARE, SESSION, { requestId: "r", path: bare.file("a.txt", "x") }),
    ).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_NOT_RUNNING",
    });
    await bare.service.dispose("test");
  });

  it("a second process cannot write: the state root's owner lock admits one Backend, whose module is the store's one writer", async () => {
    const first = build();
    expect((await first.service.start()).outcome).toBe("started");
    const second = build({ stateRoot: first.stateRoot, work: first.work });
    const refused = await second.service.start();
    expect(refused.outcome).toBe("refused");
    expect(second.service.deliverables()).toBeUndefined();
    expect(
      await second.call(DECLARE, SESSION, { requestId: "r", path: first.file("a.txt", "x") }),
    ).toEqual({ status: "unavailable", code: "XC6_BACKEND_NOT_RUNNING" });
    expect(NodeFS.existsSync(first.storeFile)).toBe(false);
    await first.service.dispose("test");
  });

  it("a drained Backend refuses, and a new one over the same state root reads the same declarations", async () => {
    const w = build();
    expect((await w.service.start()).outcome).toBe("started");
    const path = w.file("a.txt", "one\n");
    const declared = await w.call(DECLARE, SESSION, { requestId: "r", path });
    expect((await w.service.dispose("test")).ok).toBe(true);
    expect(await w.call(DECLARE, SESSION, { requestId: "r2", path })).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
    const reborn = build({ stateRoot: w.stateRoot, work: w.work });
    expect((await reborn.service.start()).outcome).toBe("started");
    expect(await reborn.service.deliverables()!.list(SESSION)).toMatchObject({
      ok: true,
      value: [{ id: declared.result.declaration.id }],
    });
    expect((await reborn.call(DECLARE, SESSION, { requestId: "r", path })).result).toMatchObject({
      ok: true,
      replayed: true,
    });
    await reborn.service.dispose("test");
  });

  it("a store file of a newer format does not stop the Backend: it starts, and every call is refused with the file untouched", async () => {
    const stateRoot = rootOf();
    const file = NodePath.join(stateRoot, DELIVERABLES_FILE_RELATIVE);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, '{"formatVersion":2,"future":true}\n');
    const w = build({ stateRoot });
    expect((await w.service.start()).outcome).toBe("started");
    expect(await w.call(DECLARE, SESSION, { requestId: "r", path: w.file("a.txt", "x") })).toEqual({
      status: "unavailable",
      code: "DELIVERABLES_FORMAT_NEWER",
    });
    expect(NodeFS.readFileSync(file, "utf8")).toBe('{"formatVersion":2,"future":true}\n');
    await w.service.dispose("test");
  });
});
