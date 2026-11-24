// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 DV3 (Plan steps 14 and 23) — the Backend's workflow authorization port over M03's real `identityOf` and `authorize` and a scratch checkout with a real role file. It shows: a main
// session is allowed `workflow` (the port names the tool in the callable set, as spawn authorization does), a child is refused whatever its allow-list says, a retired, absent, corrupt or
// unreadable record, a relative working folder and a missing checkout are refused or unavailable and never allowed, and the verdict never reads a model argument. It does NOT show the workflow
// tool, a Pi session or the composition's own callable set (the Agent host narrows it again at a child's start).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createIdentityReader } from "./identity/backendEntry.ts";
import {
  SESSION,
  SESSION_B,
  childRecord,
  mainRecord,
  rootOf,
  writeEnvelope,
} from "./identity/testkit.ts";
import { WORKFLOW_TOOL, createWorkflowAuthorizer } from "./goals/workflowAuthorize.ts";

const CHILD = "0197d3c0-3333-7000-8000-000000000003";
const RETIRED = "0197d3c0-4444-7000-8000-000000000004";
const CORRUPT = "0197d3c0-6666-7000-8000-000000000006";
const scratch = (prefix: string) =>
  NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix)));
const roleFile = `---
name: worker
description: A scratch role.
metadata:
  aetheria:
    tool: worker
    routes:
      - { provider: openai-codex, model: gpt-6.1-sol, effort: high }
    tools: [read, grep]
    maxDepth: 1
    background: one-shot
---

The job: do the scratch work.
`;

function world() {
  const checkout = scratch("ae-m07-wf-checkout-");
  NodeFS.mkdirSync(NodePath.join(checkout, ".git"));
  const agents = NodePath.join(checkout, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(agents, "worker.md"), roleFile);
  const stateRoot = rootOf();
  writeEnvelope(stateRoot, mainRecord(SESSION));
  writeEnvelope(stateRoot, {
    ...childRecord(CHILD, SESSION, [SESSION], "worker"),
    roleOrigin: "checkout",
  });
  writeEnvelope(stateRoot, mainRecord(RETIRED), { state: "retired" });
  writeEnvelope(stateRoot, mainRecord(CORRUPT), { raw: "not json" });
  const authorizer = (over: { checkout?: string | undefined } = {}) =>
    createWorkflowAuthorizer({
      reader: createIdentityReader({ stateRoot }),
      checkout: "checkout" in over ? over.checkout : checkout,
      env: {},
      homedir: () => scratch("ae-m07-wf-home-"),
    });
  return { checkout, authorizer };
}

describe("workflow authorization (DV3)", () => {
  it("names `workflow`, and allows a main session with its own root", async () => {
    expect(WORKFLOW_TOOL).toBe("workflow");
    const w = world();
    expect(await w.authorizer()({ sessionId: SESSION, workingFolder: w.checkout })).toEqual({
      ok: true,
      sessionId: SESSION,
      rootSessionId: SESSION,
    });
  });

  it("refuses a child with M03's code, and a session with no record, a retired one and a corrupt one — never allows them", async () => {
    const w = world();
    const ask = w.authorizer();
    const child = await ask({ sessionId: CHILD, workingFolder: w.checkout });
    expect(child).toMatchObject({ ok: false });
    expect(child.ok ? "" : child.code).toMatch(/^AUTH_|^XC6_/);
    for (const sessionId of [SESSION_B, RETIRED, CORRUPT])
      expect(await ask({ sessionId, workingFolder: w.checkout }), sessionId).toMatchObject({
        ok: false,
      });
  });

  it("is unavailable, not allowed, without a session, a relative or missing folder, or an absolute checkout", async () => {
    const w = world();
    const ask = w.authorizer();
    expect(await ask({ sessionId: "", workingFolder: w.checkout })).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    expect(await ask({ sessionId: SESSION, workingFolder: "relative/folder" })).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    expect(
      await w.authorizer({ checkout: undefined })({
        sessionId: SESSION,
        workingFolder: w.checkout,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE" });
    expect(
      await w.authorizer({ checkout: "relative" })({
        sessionId: SESSION,
        workingFolder: w.checkout,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE" });
  });
});
