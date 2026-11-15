// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 Plan step 2 — probe: what the EXISTING Backend composition lets a prospective M07 module read about a session's root, and what it can be authorized to do.
//
// Boundary: the real assembled Backend service (`createAetheriaBackendService`, started) over the real M03 reader/validator from the pinned awareness archive, the real thread
// index and M03-format record files on a real temporary folder; for the workflow verdict, M03's real `identityOf` and `authorize` over a scratch checkout. The probe builds the
// module's read only from the service's PUBLIC surface (`index.bindingOfSession` + `identity()`), exactly the call a Backend module registered through composition could make.
// It shows: (1) a real bound Pi session resolves to a validated main root only through `identity()`; a child, retired, pending, corrupt, unreadable, ambiguous, unbound or
// not-running case never does and the identity store is unchanged; (2) `identityKind()` answers "not-child" for absent and retired sessions, so it is NOT proof of main;
// (3) M03's `authorize(...,"workflow",...)` is issued only from a resolver-built resolution, refuses a child (`AUTH_TOOL_NOT_ALLOWED`) and a forged resolution, and — an
// open decision — refuses a MAIN session when the Backend supplies an empty callable set (as `auditAccess` does); it allows main only when the Backend names `workflow`.
// It does NOT show: the composition row that would register M07's module (composition.ts is a shared file), the goal service, Pi's own identity writer, or any authority:
// `identity()` returns facts, never permission. The probe's read helper lives in this file; production code for it is step 7/14's.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  authorize,
  createIdentityReader,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  type IdentityPorts,
} from "./identity/backendEntry.ts";
import type { StoredEventLike } from "./identity/feed.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  childRecord,
  mainRecord,
  rootOf,
  sessionFileOf,
  snapshot,
  writeEnvelope,
} from "./identity/testkit.ts";
import { createAetheriaBackendService } from "./service.ts";
import type { AetheriaBackendService } from "./service.ts";

const THREAD_C = "mcp:cccccccc-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const THREAD_D = "mcp:dddddddd-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
const CHILD = "0197d3c0-3333-7000-8000-000000000003";
const RETIRED = "0197d3c0-4444-7000-8000-000000000004";
const PENDING = "0197d3c0-5555-7000-8000-000000000005";
const CORRUPT = "0197d3c0-6666-7000-8000-000000000006";
const UNREADABLE = "0197d3c0-7777-7000-8000-000000000007";
const UNBOUND = "0197d3c0-8888-7000-8000-000000000008";

let sequence = 0;
const bindEvents = (threadId: string, sessionId: string): StoredEventLike[] => [
  {
    sequence: ++sequence,
    event: {
      type: "provider-session.updated",
      threadId,
      payload: {
        id: `runtime-${threadId.slice(-4)}`,
        providerInstanceId: "pi",
        status: "ready",
        cwd: FOLDER,
      },
    },
  },
  {
    sequence: ++sequence,
    event: {
      type: "provider-thread.updated",
      threadId,
      payload: {
        driver: "pi",
        providerInstanceId: "pi",
        providerSessionId: `runtime-${threadId.slice(-4)}`,
        appThreadId: threadId,
        nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
      },
    },
  },
];

type Outcome =
  | { readonly outcome: "main-root"; readonly sessionId: string; readonly rootSessionId: string }
  | { readonly outcome: "not-main"; readonly kind: "child" }
  | { readonly outcome: "refused"; readonly code: string }
  | { readonly outcome: "unavailable"; readonly reason: string };

/**
 * The probe's prospective M07 read, built ONLY from the running service's public surface: the index names the session's thread facts (T3 events, never a model argument) and
 * `identity()` joins them with M03's validated record. Only `ok && kind === "main"` is a main root; every other answer changes nothing.
 */
function mainRootOf(service: AetheriaBackendService, sessionId: string): Outcome {
  const binding = service.index.bindingOfSession(sessionId);
  if (binding === undefined) return { outcome: "unavailable", reason: "no-single-thread-binding" };
  const resolved = service.identity(
    {
      threadId: binding.threadId,
      providerSessionId: binding.providerSessionId,
      providerInstanceId: binding.providerInstanceId,
    },
    sessionId,
  );
  if (!resolved.ok)
    return resolved.outcome === "refused"
      ? { outcome: "refused", code: resolved.code }
      : { outcome: "unavailable", reason: resolved.reason };
  if (resolved.kind !== "main") return { outcome: "not-main", kind: "child" };
  return {
    outcome: "main-root",
    sessionId: resolved.sessionId,
    rootSessionId: resolved.rootSessionId,
  };
}

async function world() {
  const stateRoot = rootOf();
  const threads = [THREAD, THREAD_B, THREAD_C, THREAD_D];
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) =>
      threads.includes(threadId) ? `cred-${threadId.slice(-4)}` : undefined,
    projectRootOf: (folder) => folder,
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  const service = made.service;
  writeEnvelope(stateRoot, mainRecord(SESSION));
  writeEnvelope(stateRoot, mainRecord(SESSION_B));
  writeEnvelope(stateRoot, childRecord(CHILD, SESSION, [SESSION]));
  writeEnvelope(stateRoot, mainRecord(RETIRED), { state: "retired" });
  writeEnvelope(stateRoot, mainRecord(PENDING), { state: "pending" });
  writeEnvelope(stateRoot, mainRecord(CORRUPT), { raw: "not json" });
  expect((await service.start()).outcome).toBe("started");
  const bind = async (threadId: string, sessionId: string) => {
    for (const event of bindEvents(threadId, sessionId)) await service.ingest(event);
  };
  return { stateRoot, service, bind };
}

describe("probe 2a: the session → validated main root read the existing Backend composition supplies", () => {
  it("resolves a real bound main session to its own root, and two roots stay separate", async () => {
    const w = await world();
    await w.bind(THREAD, SESSION);
    await w.bind(THREAD_B, SESSION_B);
    expect(mainRootOf(w.service, SESSION)).toEqual({
      outcome: "main-root",
      sessionId: SESSION,
      rootSessionId: SESSION,
    });
    expect(mainRootOf(w.service, SESSION_B)).toEqual({
      outcome: "main-root",
      sessionId: SESSION_B,
      rootSessionId: SESSION_B,
    });
  });

  it("never reads a child as a main root: the child resolves to kind child under its parent's root", async () => {
    const w = await world();
    await w.bind(THREAD, SESSION);
    await w.bind(THREAD_C, CHILD);
    expect(mainRootOf(w.service, CHILD)).toEqual({ outcome: "not-main", kind: "child" });
    // The same read, unfiltered, names the root the child belongs to — which is why C1 must test `kind`, not only the root.
    const binding = w.service.index.bindingOfSession(CHILD)!;
    expect(
      w.service.identity(
        {
          threadId: binding.threadId,
          providerSessionId: binding.providerSessionId,
          providerInstanceId: binding.providerInstanceId,
        },
        CHILD,
      ),
    ).toMatchObject({ ok: true, kind: "child", rootSessionId: SESSION });
  });

  it("refuses or reports unavailable for retired, pending, corrupt and unreadable records — never main", async () => {
    const w = await world();
    const unreadable = writeEnvelope(w.stateRoot, mainRecord(UNREADABLE));
    NodeFS.chmodSync(unreadable, 0o000);
    try {
      for (const [thread, session] of [
        [THREAD_D, RETIRED],
        [THREAD_C, PENDING],
        [THREAD_B, CORRUPT],
        [THREAD, UNREADABLE],
      ] as const)
        await w.bind(thread, session);
      expect(mainRootOf(w.service, RETIRED)).toMatchObject({
        outcome: "refused",
        code: "XC6_IDENTITY_RETIRED",
      });
      // The testkit's `pending` envelope is read as a bad record by the reader (not "awaited"); either way it is unavailable and never main. The real pending layout is M03's writer's.
      expect(mainRootOf(w.service, PENDING)).toMatchObject({ outcome: "unavailable" });
      expect(mainRootOf(w.service, CORRUPT)).toMatchObject({ outcome: "unavailable" });
      // chmod 000 makes the record unreadable by its owner; as root that would not hold, so the assertion would only state what it saw.
      const result = mainRootOf(w.service, UNREADABLE);
      if (process.getuid?.() === 0) expect(["main-root", "unavailable"]).toContain(result.outcome);
      else expect(result).toMatchObject({ outcome: "unavailable" });
    } finally {
      NodeFS.chmodSync(unreadable, 0o600);
    }
  });

  it("is unavailable for a session with no thread binding, and ambiguous when two threads hold one session", async () => {
    const w = await world();
    await w.bind(THREAD, SESSION);
    expect(mainRootOf(w.service, UNBOUND)).toEqual({
      outcome: "unavailable",
      reason: "no-single-thread-binding",
    });
    // A second thread tries to bind the same Pi session. Either the index refuses it (one holder stays: the answer is unchanged) or two threads hold it
    // and `bindingOfSession` answers undefined (unavailable). In neither case may the session read as main for a thread that is not its sole holder.
    await w.bind(THREAD_D, SESSION);
    const holders = w.service.index.threadsOf(SESSION);
    const answer = mainRootOf(w.service, SESSION);
    if (holders.length === 1) {
      expect(holders[0]).toBe(THREAD); // the second bind was refused by the index; ambiguity cannot be built from T3 events
      expect(answer).toMatchObject({ outcome: "main-root", rootSessionId: SESSION });
    } else {
      expect(holders.length).toBeGreaterThan(1);
      expect(answer).toEqual({ outcome: "unavailable", reason: "no-single-thread-binding" });
    }
    // The resolver's own ambiguity branch, driven directly with a caller from the second thread: never main either way.
    const second = w.service.index.lookup(THREAD_D);
    if (second.status === "ok")
      expect(
        w.service.identity(
          {
            threadId: THREAD_D,
            providerSessionId: second.binding.providerSessionId,
            providerInstanceId: "pi",
          },
          SESSION,
        ),
      ).toMatchObject({ ok: false });
  });

  it("refuses a claimed session that is not the bound one (the carrier's claim is a cross-check only)", async () => {
    const w = await world();
    await w.bind(THREAD, SESSION);
    const binding = w.service.index.bindingOfSession(SESSION)!;
    const caller = {
      threadId: binding.threadId,
      providerSessionId: binding.providerSessionId,
      providerInstanceId: binding.providerInstanceId,
    };
    expect(w.service.identity(caller, SESSION_B)).toMatchObject({ ok: false, outcome: "refused" });
  });

  it("is unavailable after drain, and a read changes no identity byte, mode or time", async () => {
    const w = await world();
    await w.bind(THREAD, SESSION);
    const before = snapshot(NodePath.join(w.stateRoot, "identity"));
    mainRootOf(w.service, SESSION);
    mainRootOf(w.service, CHILD);
    expect(snapshot(NodePath.join(w.stateRoot, "identity"))).toEqual(before);
    expect((await w.service.dispose("probe")).ok).toBe(true);
    expect(mainRootOf(w.service, SESSION)).toMatchObject({ outcome: "unavailable" });
  });

  it("shows `identityKind` is not proof of main: absent and retired sessions both read `not-child`", async () => {
    const w = await world();
    expect(w.service.identityKind(SESSION)).toBe("not-child"); // a real main
    expect(w.service.identityKind(UNBOUND)).toBe("not-child"); // no record at all
    expect(w.service.identityKind(RETIRED)).toBe("not-child"); // retired
    expect(w.service.identityKind(CHILD)).toBe("child");
    expect(w.service.identityKind(CORRUPT)).toBe("unavailable");
  });
});

const scratch = (prefix: string) =>
  NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix)));
const roleFile = `---
name: worker
description: A scratch role.
metadata:
  dsh:
    tool: worker
    routes:
      - { provider: openai-codex, model: gpt-6.1-sol, effort: high }
    tools: [read, grep]
    maxDepth: 1
    background: one-shot
---

The job: do the scratch work.
`;

function authWorld(callable: readonly string[]) {
  const checkout = scratch("ae-m07-checkout-");
  NodeFS.mkdirSync(NodePath.join(checkout, ".git"));
  const agents = NodePath.join(checkout, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(agents, "worker.md"), roleFile);
  const stateRoot = rootOf();
  const reader = createIdentityReader({ stateRoot });
  const roles = currentRoles(checkout, { env: {}, homedir: () => scratch("ae-m07-home-") });
  const verdictFor = async (sessionId: string, tool: string) => {
    const derived = await deriveProject(nodeFs, checkout, checkout);
    const ports: IdentityPorts = {
      read: (id) => reader.read(id),
      roles,
      project: () => {
        if (!derived.ok) throw new Error(derived.problems.join("; "));
        return derived.project;
      },
      callable,
    };
    const resolved = identityOf(ports, sessionId, checkout);
    return { resolved, verdict: authorize({ roles }, resolved, tool), ports, roles };
  };
  return { stateRoot, checkout, verdictFor, roles };
}

describe('probe 2b: resolver-issued authorize(..., "workflow", ...)', () => {
  it("refuses a MAIN session when the Backend supplies an empty callable set (the auditAccess shape) — a decision for the caller", async () => {
    const w = authWorld([]);
    writeEnvelope(w.stateRoot, mainRecord(SESSION));
    const { verdict } = await w.verdictFor(SESSION, "workflow");
    expect(verdict).toMatchObject({ allowed: false, code: "AUTH_TOOL_NOT_ALLOWED" });
  });

  it("allows a main session only when the Backend names `workflow` in the callable set, and refuses a child whatever its allow-list says", async () => {
    const w = authWorld(["workflow"]);
    writeEnvelope(w.stateRoot, mainRecord(SESSION));
    writeEnvelope(w.stateRoot, {
      ...childRecord(CHILD, SESSION, [SESSION], "worker"),
      roleOrigin: "checkout",
    });
    expect((await w.verdictFor(SESSION, "workflow")).verdict).toEqual({ allowed: true });
    expect((await w.verdictFor(CHILD, "workflow")).verdict).toMatchObject({
      allowed: false,
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
    // A goal tool is held back from a child by the same rule.
    expect((await w.verdictFor(CHILD, "create_goal")).verdict).toMatchObject({
      allowed: false,
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
  });

  it("refuses a resolution the resolver did not issue, and every unreadable or unknown record", async () => {
    const w = authWorld(["workflow"]);
    writeEnvelope(w.stateRoot, mainRecord(SESSION));
    const { resolved, roles } = await w.verdictFor(SESSION, "workflow");
    if (!resolved.ok) throw new Error("the main session must resolve");
    const forged = { ok: true as const, identity: { ...resolved.identity } };
    expect(authorize({ roles }, forged, "workflow")).toMatchObject({
      allowed: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    writeEnvelope(w.stateRoot, mainRecord(RETIRED), { state: "retired" });
    writeEnvelope(w.stateRoot, mainRecord(CORRUPT), { raw: "not json" });
    for (const id of [RETIRED, CORRUPT, UNBOUND]) {
      const { verdict } = await w.verdictFor(id, "workflow");
      expect(verdict.allowed, id).toBe(false);
    }
  });
});
