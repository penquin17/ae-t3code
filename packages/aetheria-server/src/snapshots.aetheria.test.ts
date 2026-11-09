// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M09 Plan step 21 — snapshots in the assembled Backend: the two `attachments.*` operations, the in-process `openSnapshot` M10 will use, and
// the retention that follows a thread deletion on the stored-event stream.
//
// Boundary: the real assembly over the real thread index, the real installed `@aetheria/providers` archive (its snapshot store included) and real temporary
// folders for the state root, the attachments directory and the declared files; events are fed by hand. It shows: both operations are always registered and
// fail closed when no attachments directory was given; a stored snapshot opens, in process, only for its own session; a `thread.deleted` event removes the
// session's snapshots and no other session's; a session with two holders keeps its snapshots until the second holder is deleted; a drained Backend refuses.
// It does NOT show T3's real attachments directory, the authenticated route (apps/server tests) or Linux.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createThreadIndex } from "./identity/threadIndex.ts";
import { createAetheriaBackendService } from "./service.ts";
import type { StoredEventLike } from "./identity/feed.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  mainRecord,
  rootOf,
  sessionFileOf,
  writeEnvelope,
} from "./identity/testkit.ts";

const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";
const STORE = "attachments.store-snapshot";
const DESCRIBE = "attachments.describe-snapshot";
let sequence = 0;
const sessionEvent = (threadId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-session.updated",
    threadId,
    payload: { id: RUNTIME, providerInstanceId: "pi", status: "ready", cwd: FOLDER },
  },
});
const threadEvent = (threadId: string, sessionId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-thread.updated",
    threadId,
    payload: {
      driver: "pi",
      providerInstanceId: "pi",
      providerSessionId: RUNTIME,
      appThreadId: threadId,
      nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
    },
  },
});
const deleted = (threadId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: { type: "thread.deleted", threadId, payload: {} },
});
const context = (sessionId: string, args: Record<string, unknown>) => ({
  caller: { threadId: THREAD, providerSessionId: "cred-1", providerInstanceId: "pi" },
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args,
});
const sha = (data: string) =>
  `sha256:${NodeCrypto.createHash("sha256").update(data).digest("hex")}`;

function build(options: { attachments: boolean; beforeStart?: (stateRoot: string) => void }) {
  const stateRoot = rootOf();
  const attachmentsDir = NodePath.join(rootOf(), "attachments");
  const work = rootOf();
  writeEnvelope(stateRoot, mainRecord(SESSION));
  writeEnvelope(stateRoot, mainRecord(SESSION_B));
  options.beforeStart?.(stateRoot);
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => ({ [THREAD]: "cred-1", [THREAD_B]: "cred-2" })[threadId],
    projectRootOf: (folder) => folder,
    ...(options.attachments ? { attachmentsDir } : {}),
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  const { service } = made;
  const file = (name: string, content: string) => {
    const path = NodePath.join(work, name);
    NodeFS.writeFileSync(path, content);
    return path;
  };
  const store = async (sessionId: string, name: string, content: string) => {
    const reply = (await service.operations()[STORE]!(
      context(sessionId, { sourcePath: file(name, content), declaredDigest: sha(content) }),
    )) as { result: { ok: boolean; snapshotId: string } };
    expect(reply.result.ok).toBe(true);
    return reply.result.snapshotId;
  };
  const bindBoth = async () => {
    await service.ingest(sessionEvent(THREAD));
    await service.ingest(threadEvent(THREAD, SESSION));
    await service.ingest(threadEvent(THREAD_B, SESSION_B));
  };
  return { service, stateRoot, store, bindBoth };
}

// Whether a snapshot opens; the stream is closed at once, because nothing here reads it.
const opens = async (
  pending: Promise<{ readonly ok: boolean; readonly stream?: { destroy(): void } }>,
) => {
  const opened = await pending;
  opened.stream?.destroy();
  return opened.ok;
};

const bytesOf = async (opened: { ok: boolean; stream?: AsyncIterable<Buffer> }) => {
  const parts: Buffer[] = [];
  for await (const chunk of opened.stream ?? []) parts.push(chunk);
  return Buffer.concat(parts).toString("utf8");
};

describe("snapshots in the assembled Backend", () => {
  it("registers both operations always, and fails closed when no attachments directory was given", async () => {
    const w = build({ attachments: false });
    expect(Object.keys(w.service.operations())).toEqual(expect.arrayContaining([STORE, DESCRIBE]));
    expect((await w.service.start()).outcome).toBe("started");
    await expect(
      w.service.operations()[DESCRIBE]!(context(SESSION, { snapshotId: `snap_${"a".repeat(64)}` })),
    ).rejects.toThrow(/snapshots are not running/);
    expect(await w.service.openSnapshot(SESSION, `snap_${"a".repeat(64)}`)).toEqual({
      ok: false,
      code: "unavailable",
    });
    await w.service.dispose("test");
  });

  it("stores a declared file for the verified session; describe is metadata only and openSnapshot returns the bytes only to the owner", async () => {
    const w = build({ attachments: true });
    expect((await w.service.start()).outcome).toBe("started");
    const id = await w.store(SESSION, "report.txt", "the delivered report\n");
    const described = (await w.service.operations()[DESCRIBE]!(
      context(SESSION, { snapshotId: id }),
    )) as { result: unknown };
    expect(described.result).toEqual({
      ok: true,
      snapshotId: id,
      digest: sha("the delivered report\n"),
      size: 21,
    });
    expect(await bytesOf((await w.service.openSnapshot(SESSION, id)) as never)).toBe(
      "the delivered report\n",
    );
    expect(await w.service.openSnapshot(SESSION_B, id)).toEqual({
      ok: false,
      code: "ATTACHMENT_MISSING",
    });
    const other = (await w.service.operations()[DESCRIBE]!(
      context(SESSION_B, { snapshotId: id }),
    )) as { result: unknown };
    expect(other.result).toEqual({ ok: false, code: "ATTACHMENT_MISSING" });
    await w.service.dispose("test");
  });

  it("removes a deleted thread's session snapshots and no other session's", async () => {
    const w = build({ attachments: true });
    expect((await w.service.start()).outcome).toBe("started");
    await w.bindBoth();
    const mine = await w.store(SESSION, "a.txt", "one\n");
    const theirs = await w.store(SESSION_B, "b.txt", "two\n");
    await w.service.ingest(deleted(THREAD));
    expect(await w.service.openSnapshot(SESSION, mine)).toEqual({
      ok: false,
      code: "ATTACHMENT_MISSING",
    });
    expect(await opens(w.service.openSnapshot(SESSION_B, theirs))).toBe(true);
    await w.service.dispose("test");
  });

  it("keeps a session's snapshots until its last holder is deleted", async () => {
    const w = build({
      attachments: true,
      beforeStart: (stateRoot) => {
        // Two threads holding one Pi session can only come from disk (a bind refuses the second): bind both, then point the second at the first's session.
        const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
        for (const [thread, session] of [
          [THREAD, SESSION],
          [THREAD_B, SESSION_B],
        ] as const)
          index.bind({
            threadId: thread,
            providerSessionId: `cred-${thread}`,
            providerInstanceId: "pi",
            sessionFile: sessionFileOf(session),
            workingFolder: FOLDER,
          });
        const second = NodePath.join(
          stateRoot,
          "thread-index",
          `${NodeCrypto.createHash("sha256").update(THREAD_B).digest("hex")}.json`,
        );
        const binding = JSON.parse(NodeFS.readFileSync(second, "utf8")) as Record<string, unknown>;
        NodeFS.writeFileSync(second, `${JSON.stringify({ ...binding, sessionId: SESSION })}\n`);
      },
    });
    expect((await w.service.start()).outcome).toBe("started");
    expect(w.service.index.threadsOf(SESSION)).toEqual([THREAD, THREAD_B].sort());
    const id = await w.store(SESSION, "shared.txt", "shared\n");
    await w.service.ingest(deleted(THREAD));
    expect(await opens(w.service.openSnapshot(SESSION, id))).toBe(true);
    await w.service.ingest(deleted(THREAD_B));
    expect(await w.service.openSnapshot(SESSION, id)).toEqual({
      ok: false,
      code: "ATTACHMENT_MISSING",
    });
    await w.service.dispose("test");
  });

  it("refuses after the Backend drained", async () => {
    const w = build({ attachments: true });
    expect((await w.service.start()).outcome).toBe("started");
    const id = await w.store(SESSION, "a.txt", "one\n");
    await w.service.dispose("test");
    expect(await w.service.operations()[DESCRIBE]!(context(SESSION, { snapshotId: id }))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
    expect(await w.service.openSnapshot(SESSION, id)).toEqual({ ok: false, code: "unavailable" });
  });
});
