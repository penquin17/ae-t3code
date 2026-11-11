// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M05 Plan step 6 — the Backend SpawnAuthorizer over M03's real record reader, role catalog (a scratch checkout's authored role files),
// project derivation and `authorize`, with scratch identity records. Shows who may spawn which role, the facts a child is given, and that every unreadable
// input refuses. It does NOT show the children service or T3.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createIdentityReader } from "./identity/backendEntry.ts";
import { childRecord, mainRecord, rootOf, writeEnvelope } from "./identity/testkit.ts";
import { createSpawnAuthorizer, type SpawnLaunchFacts } from "./spawnAuthorizer.ts";

const ROOT = "0197d3c0-bbbb-7000-8000-00000000000a";
const CHILD = "0197d3c0-bbbb-7000-8000-00000000000b";
const scratch = (prefix: string) =>
  NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix)));

const roleFile = (tool: string, tools: string, maxDepth: number) => `---
name: ${tool}
description: A scratch role.
metadata:
  dsh:
    tool: ${tool}
    routes:
      - { provider: openai-codex, model: gpt-6.1-sol, effort: high }
    tools: [${tools}]
    maxDepth: ${maxDepth}
    background: one-shot
---

The job: do the scratch work.
`;

const checkoutWith = (roles: Record<string, [string, number]>) => {
  const checkout = scratch("ae-spawn-checkout-");
  NodeFS.mkdirSync(NodePath.join(checkout, ".git"));
  const agents = NodePath.join(checkout, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  for (const [name, [tools, depth]] of Object.entries(roles))
    NodeFS.writeFileSync(NodePath.join(agents, `${name}.md`), roleFile(name, tools, depth));
  return checkout;
};

const FACTS: SpawnLaunchFacts = {
  routes: [{ provider: "pi", model: "m", effort: "high" }],
  runtimeMode: "full-access",
  interactionMode: "default",
};

const build = (
  options: { checkout?: string | undefined; facts?: SpawnLaunchFacts | undefined } = {},
) => {
  const stateRoot = rootOf();
  const checkout =
    "checkout" in options
      ? options.checkout
      : checkoutWith({ reviewer: ["read", 2], worker: ["read, reviewer", 2] });
  const authorizer = createSpawnAuthorizer({
    reader: createIdentityReader({ stateRoot }),
    checkout,
    launchFacts: async () => ("facts" in options ? options.facts : FACTS),
    env: {},
    homedir: () => scratch("ae-spawn-home-"),
  });
  return { stateRoot, checkout, authorizer };
};
const folder = () => {
  const dir = scratch("ae-spawn-project-");
  NodeFS.mkdirSync(NodePath.join(dir, ".git"));
  return dir;
};

describe("a main session spawns a role or a generic child", () => {
  it("is authorized for a catalog role, with the role's current facts and the parent's chain", async () => {
    const { stateRoot, authorizer } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    const result = await authorizer.authorize({
      callerSessionId: ROOT,
      workingFolder: folder(),
      args: { role: "reviewer", prompt: "look", mode: "one-shot" },
    });
    expect(result).toMatchObject({
      ok: true,
      parent: { sessionId: ROOT, rootSessionId: ROOT, parentChain: [] },
      child: { authoritySource: "role", role: "reviewer", roleOrigin: "checkout" },
      routes: FACTS.routes,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

  it("is authorized for an explicit allow-list through the generic tool", async () => {
    const { stateRoot, authorizer } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    const result = await authorizer.authorize({
      callerSessionId: ROOT,
      workingFolder: folder(),
      args: { allow: ["read"], prompt: "go", mode: "continuable" },
    });
    expect(result).toMatchObject({
      ok: true,
      child: { authoritySource: "spawn-explicit", role: null, explicitAllow: ["read"] },
    });
  });
});

describe("a child's own authority limits what it spawns", () => {
  it("lets a role that lists the target role spawn it, with the chain extended by the caller on the child side", async () => {
    const { stateRoot, authorizer } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, {
      ...childRecord(CHILD, ROOT, [ROOT], "worker"),
      roleOrigin: "checkout",
    });
    const result = await authorizer.authorize({
      callerSessionId: CHILD,
      workingFolder: folder(),
      args: { role: "reviewer", prompt: "look", mode: "one-shot" },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      ok: true,
      parent: { sessionId: CHILD, rootSessionId: ROOT, parentChain: [ROOT] },
    });
  });

  it("refuses with M03's own code a role the caller's definition does not list, and the generic tool below depth zero", async () => {
    const { stateRoot, authorizer } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, {
      ...childRecord(CHILD, ROOT, [ROOT], "reviewer"),
      roleOrigin: "checkout",
    });
    const role = await authorizer.authorize({
      callerSessionId: CHILD,
      workingFolder: folder(),
      args: { role: "worker", prompt: "x", mode: "one-shot" },
    });
    expect(role.ok).toBe(false);
    if (!role.ok) expect(role.code).toMatch(/^(AUTH|ROLE)_/);
    const generic = await authorizer.authorize({
      callerSessionId: CHILD,
      workingFolder: folder(),
      args: { allow: ["read"], prompt: "x", mode: "one-shot" },
    });
    expect(generic.ok).toBe(false);
  });
});

describe("every input that cannot be read refuses", () => {
  const args = { role: "reviewer", prompt: "look", mode: "one-shot" } as const;

  it("an unknown session, a missing checkout and a relative working folder", async () => {
    const lost = build();
    expect(
      (await lost.authorizer.authorize({ callerSessionId: ROOT, workingFolder: folder(), args }))
        .ok,
    ).toBe(false);
    const noCheckout = build({ checkout: undefined });
    writeEnvelope(noCheckout.stateRoot, mainRecord(ROOT));
    expect(
      await noCheckout.authorizer.authorize({
        callerSessionId: ROOT,
        workingFolder: folder(),
        args,
      }),
    ).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    const relative = build();
    writeEnvelope(relative.stateRoot, mainRecord(ROOT));
    expect(
      await relative.authorizer.authorize({
        callerSessionId: ROOT,
        workingFolder: "relative",
        args,
      }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("a role missing from the catalog, and launch facts the Backend cannot read", async () => {
    const { stateRoot, authorizer } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    const missing = await authorizer.authorize({
      callerSessionId: ROOT,
      workingFolder: folder(),
      args: { role: "ghost", prompt: "x", mode: "one-shot" },
    });
    expect(missing.ok).toBe(false);
    const noFacts = build({ facts: undefined });
    writeEnvelope(noFacts.stateRoot, mainRecord(ROOT));
    expect(
      await noFacts.authorizer.authorize({ callerSessionId: ROOT, workingFolder: folder(), args }),
    ).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
  });
});
