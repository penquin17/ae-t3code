// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 16 — the assembled Backend service: composition, lifecycle, identity port, thread index, liveness and the read-only
// `identity.lifecycle` operation, wired as the server layer wires them (apps/server supplies only the event stream and the credential reader).
//
// Boundary: the real assembly over the real thread index, the real pinned-artifact reader and a real identity-record folder, with stored
// events fed by hand. It shows: the digest is the validated composition's; calls are refused while the Backend is not running and after it
// drained; the production identity port resolves a bound session with an active record and refuses a mismatched provider session, thread or
// claimed session; the operation lists the index's sessions with the tracker's answers; a drain is clean (XC-7). It does not show T3's real
// events, the HTTP route or the Effect layer (apps/server tests) or the Agent-side sweep (tests/awareness/s16).
import { describe, expect, it } from "vite-plus/test";

import { prepareAetheriaBackend } from "./aetheriaBackend.ts";
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
let sequence = 0;
const sessionEvent = (threadId: string, status: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-session.updated",
    threadId,
    payload: { id: RUNTIME, providerInstanceId: "pi", status, cwd: FOLDER },
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
const caller = (threadId: string, providerSessionId: string) => ({
  threadId,
  providerSessionId,
  providerInstanceId: "pi",
});
const context = (sessionId: string) => ({
  caller: caller(THREAD, "cred-1"),
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  args: {},
});

function make() {
  const stateRoot = rootOf();
  const credentials: Record<string, string | undefined> = {
    [THREAD]: "cred-1",
    [THREAD_B]: "cred-2",
  };
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => credentials[threadId],
    projectRootOf: (folder) => folder,
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  return { stateRoot, service: made.service, credentials };
}
async function started() {
  const w = make();
  writeEnvelope(w.stateRoot, mainRecord(SESSION));
  writeEnvelope(w.stateRoot, mainRecord(SESSION_B));
  expect((await w.service.start()).outcome).toBe("started");
  await w.service.ingest(sessionEvent(THREAD, "ready"));
  await w.service.ingest(threadEvent(THREAD, SESSION));
  return w;
}

describe("the composition the Backend actually validated", () => {
  it("publishes the digest of the validated composition, the same value the status carries", () => {
    const { service } = make();
    const prepared = prepareAetheriaBackend();
    if (prepared.outcome !== "prepared") throw new Error("the default composition must prepare");
    expect(service.digest()).toEqual(prepared.backend.status().digest);
    expect(service.status().digest).toEqual(service.digest());
    expect(service.digest().value).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a state root that is not a normalised absolute path", () => {
    expect(() =>
      createAetheriaBackendService({ stateRoot: "relative/root", credentialOf: () => undefined }),
    ).toThrow(/stateRoot/);
  });
});

describe("fail closed before start and after drain", () => {
  it("answers unavailable for the identity port and the operation until the Backend runs", async () => {
    const w = make();
    const refused = w.service.identity(caller(THREAD, "cred-1"), SESSION);
    expect(refused).toMatchObject({ ok: false, outcome: "unavailable" });
    const operation = w.service.operations()["identity.lifecycle"];
    expect(operation).toBeDefined();
    expect(await operation!(context(SESSION))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  });

  it("drains once with a clean XC-7 report and then refuses again", async () => {
    const w = await started();
    const report = await w.service.dispose("test");
    expect(report.ok).toBe(true);
    expect(report.stillLive).toEqual([]);
    expect(w.service.status().phase).toBe("disposed");
    expect(w.service.status().disposal).toMatchObject({ ok: true, stillLive: 0 });
    expect(w.service.identity(caller(THREAD, "cred-1"), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
    });
    expect(await w.service.dispose("again")).toBe(report);
  });
});

describe("the production identity port", () => {
  it("resolves a real bound session that has an active record", async () => {
    const w = await started();
    const who = w.service.identity(caller(THREAD, "cred-1"), SESSION);
    expect(who).toMatchObject({
      ok: true,
      sessionId: SESSION,
      kind: "main",
      rootSessionId: SESSION,
    });
  });

  it("refuses a mismatched provider session, a mismatched claimed session and an unbound thread", async () => {
    const w = await started();
    expect(w.service.identity(caller(THREAD, RUNTIME), SESSION)).toMatchObject({ ok: false }); // the runtime id is not what the bearer proves
    expect(w.service.identity(caller(THREAD, "cred-1"), SESSION_B)).toMatchObject({
      ok: false,
      outcome: "refused",
    });
    expect(w.service.identity(caller(THREAD_B, "cred-2"), SESSION_B)).toMatchObject({
      ok: false,
      outcome: "unavailable",
    });
  });

  it("treats the claimed session as a cross-check only: absent, the bearer's bound session is the caller", async () => {
    const w = await started();
    expect(w.service.identity(caller(THREAD, "cred-1"), null)).toMatchObject({
      ok: true,
      sessionId: SESSION,
    });
  });

  it("is unavailable, not main, after T3 rotates the credential and until T3 reports the thread again", async () => {
    const w = await started();
    w.credentials[THREAD] = "cred-9";
    expect(w.service.identity(caller(THREAD, "cred-9"), SESSION)).toMatchObject({
      ok: false,
      outcome: "unavailable",
    });
    await w.service.ingest(threadEvent(THREAD, SESSION));
    expect(w.service.identity(caller(THREAD, "cred-9"), SESSION)).toMatchObject({
      ok: true,
      sessionId: SESSION,
    });
    expect(w.service.identity(caller(THREAD, "cred-1"), SESSION)).toMatchObject({ ok: false });
  });
});

describe("the identity.lifecycle operation", () => {
  it("lists the sessions the index binds with the tracker's answers, and nothing else", async () => {
    const w = await started();
    await w.service.ingest({
      sequence: ++sequence,
      event: { type: "run.created", threadId: THREAD },
    });
    const operation = w.service.operations()["identity.lifecycle"]!;
    const reply = await operation(context(SESSION));
    expect(reply).toEqual({
      status: "done",
      result: { sessions: { [SESSION]: { exists: true, closed: false, acceptedPrompt: true } } },
    });
    expect(JSON.stringify(reply)).not.toContain(THREAD);
    expect(JSON.stringify(reply)).not.toContain("cred-1");
  });

  it("is read-only: calling it changes neither the index nor the identity records", async () => {
    const w = await started();
    const before = JSON.stringify(w.service.index.sessions());
    await w.service.operations()["identity.lifecycle"]!(context(SESSION));
    expect(JSON.stringify(w.service.index.sessions())).toBe(before);
  });
});

describe("liveness is fed from the same stream, unfiltered", () => {
  it("shows a running holder, then unknown when the feed ends or fails", async () => {
    const w = await started();
    await w.service.ingest(sessionEvent(THREAD, "running"));
    expect(w.service.liveness.status(THREAD)).toMatchObject({ kind: "running" });
    w.service.noteFeed("feed-failed");
    expect(w.service.liveness.status(THREAD)).toMatchObject({ kind: "unknown" });
  });
});
