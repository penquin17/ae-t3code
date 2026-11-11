// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M06 Review 1, finding 5 (C1 direct API) — the public `HumanControlService` port carries the archive's Backend-only direct API: `inheritPlanMode`,
// `createAuthorization` and `awaitInteraction`, with the archive's signatures (`InteractionDirectApi`), so Backend code (M05's spawn and fork, M07's
// authorizations) calls the one running service through the port WITHOUT a cast.
//
// Boundary: the production factory `createArchiveInteractionService` over the INSTALLED interaction archive and its real file store in a scratch state
// root; the host seams (session directory, access check) are small doubles. Every call below is typed through `HumanControlService` alone, so this file
// fails to type-check if the port omits a method or narrows a signature, and fails at run time if the archive does not honour it. It shows the three
// calls through the port against the installed archive; it does NOT show the archive's own rules (its suites do) or that M05/M07 call them (they do not yet).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type {
  CreateAuthorizationInput,
  HumanControlService,
  HumanControlServiceDeps,
  SessionDirectory,
} from "./humanControl.ts";
import { createArchiveInteractionService } from "./library.ts";

const ROOT = "root-1";
const PARENT = "sess-parent";
const CHILD = "sess-child";
const OPERATOR = {
  actor: {
    clientSessionId: "device-1",
    grantedScopes: ["orchestration:operate"],
    authenticatedAt: "2026-11-11T00:00:00.000Z",
  },
} as const;
const DIGEST = "a".repeat(64);

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const sessions: SessionDirectory = {
  lookup: async (sessionId) =>
    sessionId === PARENT || sessionId === CHILD
      ? { kind: "found", sessionId, rootSessionId: ROOT }
      : { kind: "absent" },
};

/** The production service, typed as the public port and nothing wider. */
const started = async (): Promise<HumanControlService> => {
  const stateRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m06-direct-"));
  scratch.push(stateRoot);
  const deps: HumanControlServiceDeps = {
    sessions,
    stateRoot,
    now: () => Date.parse("2026-11-11T00:00:00.000Z"),
    canOperate: () => true,
    threadOfSession: () => undefined,
  };
  const service: HumanControlService = createArchiveInteractionService(deps);
  const result = await service.start();
  expect(result.ok).toBe(true);
  return service;
};

describe("the public port carries the direct API with the archive's signatures", () => {
  it("inheritPlanMode: a fork copies the parent's mode, a spawn starts inactive, and an unknown child is unavailable", async () => {
    const service = await started();
    const on = await service.setPlanMode(OPERATOR, {
      sessionId: PARENT,
      active: true,
      expectedModeRevision: 0,
    });
    expect(on).toEqual({ ok: true, value: { sessionId: PARENT, active: true, modeRevision: 1 } });

    const forked = await service.inheritPlanMode(PARENT, CHILD, "fork");
    expect(forked).toEqual({
      ok: true,
      value: { sessionId: CHILD, active: true, modeRevision: 1 },
    });
    expect(await service.getPlanMode(CHILD)).toEqual(forked);

    const lost = await service.inheritPlanMode(PARENT, "sess-nowhere", "fork");
    expect(lost.ok).toBe(false);
    if (!lost.ok) expect(lost.code).toBe("INTERACTION_UNAVAILABLE");

    const other = await started();
    expect(
      (
        await other.setPlanMode(OPERATOR, {
          sessionId: PARENT,
          active: true,
          expectedModeRevision: 0,
        })
      ).ok,
    ).toBe(true);
    const spawned = await other.inheritPlanMode(PARENT, CHILD, "spawn");
    expect(spawned).toEqual({
      ok: true,
      value: { sessionId: CHILD, active: false, modeRevision: 0 },
    });
  });

  it("createAuthorization: a Backend service opens an authorization the human then sees; an invalid subject is a grant error", async () => {
    const service = await started();
    const input: CreateAuthorizationInput = {
      sessionId: PARENT,
      text: "Allow the build to run?",
      subject: { type: "build", id: "build-1", revision: DIGEST },
    };
    const created = await service.createAuthorization(input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      kind: "authorization",
      state: "pending",
      sessionId: PARENT,
    });

    const refused = await service.createAuthorization({
      ...input,
      subject: { type: "build", id: "build-1", revision: "not-a-digest" },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("INTERACTION_GRANT_INVALID");

    const unknown = await service.createAuthorization({ ...input, sessionId: "sess-nowhere" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("INTERACTION_GRANT_INVALID");
  });

  it("awaitInteraction: one bounded segment, honouring the abort signal; an unknown id is not found", async () => {
    const service = await started();
    const created = await service.createAuthorization({
      sessionId: PARENT,
      text: "Allow the build to run?",
      subject: { type: "build", id: "build-1", revision: DIGEST },
    });
    if (!created.ok) throw new Error("the authorization was not created");
    const interactionId = created.value.interactionId;

    const controller = new AbortController();
    const waiting = service.awaitInteraction(interactionId, { signal: controller.signal });
    controller.abort();
    const segment = await waiting;
    expect(segment.ok).toBe(true);
    if (segment.ok) expect(segment.value).toMatchObject({ interactionId, state: "pending" });

    const settled = await service.answer(OPERATOR, {
      interactionId,
      revision: created.value.revision,
      answers: [{ id: "authorization", selected: ["Approve"], skipped: false }],
    });
    expect(settled.ok).toBe(true);
    const after = await service.awaitInteraction(interactionId);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.state).toBe("answered");

    const missing = await service.awaitInteraction("int-nowhere");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("INTERACTION_NOT_FOUND");
  });
});
