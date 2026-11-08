// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 16 — T3's stored events become the Backend's identity facts: the thread index binding and the lifecycle observations.
//
// Boundary: the real feed over the real thread index and tracker, driven with stored events shaped like T3's `provider-session.updated`,
// `provider-thread.updated`, `run.created` and `thread.deleted` records (the shapes are the contracts' domain events, taken structurally).
// It shows what the feed binds and observes from them, and that a missing credential, a mismatched provider instance, a missing working
// folder or a non-Pi driver binds nothing. It does not show that real T3 emits these events in this order or with these ids; the native
// run (tests/awareness/s16) shows that, and it is where the credential id is compared with the bearer's.
import { describe, expect, it } from "vite-plus/test";

import { createIdentityFeed, type StoredEventLike } from "./feed.ts";
import { createLifecycleTracker } from "./lifecycle.ts";
import { createThreadIndex } from "./threadIndex.ts";
import { FOLDER, SESSION, SESSION_B, THREAD, THREAD_B, rootOf, sessionFileOf } from "./testkit.ts";

const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";
const RUNTIME_B = "provider-session:provider-instance:pi:thread:u:def";

let sequence = 0;
const sessionEvent = (
  threadId: string,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-session.updated",
    threadId,
    payload: { id, providerInstanceId: "pi", status, cwd: FOLDER, ...extra },
  },
});
const threadEvent = (
  threadId: string,
  runtimeSession: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-thread.updated",
    threadId,
    payload: {
      driver: "pi",
      providerInstanceId: "pi",
      providerSessionId: runtimeSession,
      appThreadId: threadId,
      nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
      ...extra,
    },
  },
});
const plain = (type: string, threadId: string): StoredEventLike => ({
  sequence: ++sequence,
  event: { type, threadId },
});

function world(
  credentials: Record<string, string | undefined> = { [THREAD]: "cred-1", [THREAD_B]: "cred-2" },
) {
  const stateRoot = rootOf();
  const index = createThreadIndex({ stateRoot, projectRootOf: (folder) => folder });
  const tracker = createLifecycleTracker({ index });
  const creds = { ...credentials };
  const feed = createIdentityFeed({ index, tracker, credentialOf: (threadId) => creds[threadId] });
  return { stateRoot, index, tracker, feed, creds };
}

describe("binding the thread index from T3's events", () => {
  it("binds the BEARER's credential id, the Pi session from the file, and the working folder from the provider session", async () => {
    const { feed, index } = world();
    await feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
    const found = index.lookup(THREAD);
    expect(found.status).toBe("ok");
    if (found.status !== "ok") return;
    expect(found.binding).toMatchObject({
      threadId: THREAD,
      providerSessionId: "cred-1",
      providerInstanceId: "pi",
      sessionId: SESSION,
      workingFolder: FOLDER,
    });
    // the runtime provider-session id is T3's own and is never the key the bearer proves
    expect(found.binding.providerSessionId).not.toBe(RUNTIME);
  });

  it("binds when the provider session arrives after the thread record", async () => {
    const { feed, index } = world();
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
    expect(index.lookup(THREAD).status).toBe("absent");
    await feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    expect(index.lookup(THREAD).status).toBe("ok");
  });

  it("binds nothing without a credential for the thread", async () => {
    const { feed, index } = world({});
    await feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    const outcomes = await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
    expect(index.lookup(THREAD).status).toBe("absent");
    expect(outcomes).toEqual([{ threadId: THREAD, bound: false, reason: "no-credential" }]);
  });

  it("binds nothing for a non-Pi driver, a different provider instance, or no working folder", async () => {
    const { feed, index } = world();
    await feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION, { driver: "codex" }));
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION, { providerInstanceId: "other" }));
    expect(index.lookup(THREAD).status).toBe("absent");
    await feed.ingest(sessionEvent(THREAD_B, RUNTIME_B, "ready", { cwd: "relative/folder" }));
    await feed.ingest(threadEvent(THREAD_B, RUNTIME_B, SESSION_B));
    expect(index.lookup(THREAD_B).status).toBe("absent");
  });

  it("rebinds to the new credential when T3 rotates it and reports the thread again", async () => {
    const { feed, index, creds } = world();
    await feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
    creds[THREAD] = "cred-9";
    const before = index.lookup(THREAD);
    expect(before.status === "ok" && before.binding.providerSessionId).toBe("cred-1"); // stale until T3 reports again: a mismatch, never a guess
    await feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
    const after = index.lookup(THREAD);
    expect(after.status === "ok" && after.binding.providerSessionId).toBe("cred-9");
  });

  it("ignores malformed events without throwing and without binding", async () => {
    const { feed, index } = world();
    await feed.ingest({
      sequence: 1,
      event: { type: "provider-thread.updated", threadId: THREAD, payload: null },
    });
    await feed.ingest({
      sequence: 2,
      event: { type: "provider-thread.updated", threadId: THREAD, payload: { driver: "pi" } },
    });
    await feed.ingest(null as unknown as StoredEventLike);
    await feed.ingest({ sequence: 3, event: { type: 7 } } as unknown as StoredEventLike);
    expect(index.lookup(THREAD).status).toBe("absent");
  });
});

describe("lifecycle observations from T3's events", () => {
  const facts = (w: ReturnType<typeof world>) => w.tracker.observer().session?.(SESSION);
  const bound = async (w: ReturnType<typeof world>) => {
    await w.feed.ingest(sessionEvent(THREAD, RUNTIME, "ready"));
    await w.feed.ingest(threadEvent(THREAD, RUNTIME, SESSION));
  };

  it("reads a running or settled session as existing and not closed", async () => {
    const w = world();
    await bound(w);
    expect(facts(w)).toEqual({ exists: true, closed: false, acceptedPrompt: null });
    await w.feed.ingest(sessionEvent(THREAD, RUNTIME, "running"));
    expect(facts(w)).toEqual({ exists: true, closed: false, acceptedPrompt: null });
  });

  it("marks a prompt accepted from a run, permanently, and never infers that none was accepted", async () => {
    const w = world();
    await bound(w);
    await w.feed.ingest(plain("run.created", THREAD));
    expect(facts(w)?.acceptedPrompt).toBe(true);
    await w.feed.ingest(sessionEvent(THREAD, RUNTIME, "stopped"));
    expect(facts(w)).toEqual({ exists: true, closed: true, acceptedPrompt: true });
  });

  it("reads a stop with no run seen as closed with the prompt UNKNOWN, not false", async () => {
    const w = world();
    await bound(w);
    await w.feed.ingest(sessionEvent(THREAD, RUNTIME, "stopped"));
    expect(facts(w)).toEqual({ exists: true, closed: true, acceptedPrompt: null });
  });

  it("reads an error as unknown and a thread deletion as gone", async () => {
    const w = world();
    await bound(w);
    await w.feed.ingest(sessionEvent(THREAD, RUNTIME, "error"));
    expect(facts(w)).toEqual({ exists: null, closed: null, acceptedPrompt: null });
    await w.feed.ingest(plain("thread.deleted", THREAD));
    expect(facts(w)?.exists).toBe(false);
  });
});
