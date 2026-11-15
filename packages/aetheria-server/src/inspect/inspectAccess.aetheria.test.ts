// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M11 Plan step 8 (C2 P1; D6, D7; revision D6/D7 amended at 8d44c0c3) — the Backend's independent check of who may inspect.
//
// Boundary: M03's real record reader, validator, role catalog (read from a scratch checkout's authored agent files), project derivation and `authorize` from the installed awareness archive, over
// scratch identity records, a scratch checkout and scratch folders; only the thread index is a stand-in (it supplies each session's working folder). It shows: a main session is authorized as the
// tool it asks about (spawn authorization's main-session rule, not the audit's empty set); a role child holds a tool only through its role's CURRENT allow-list, so a child without `inspect_list` or
// `inspect_query` is refused with M03's AUTH_TOOL_NOT_ALLOWED and one that has it is allowed; the Backend cannot tell a Builder main session from an Aetheria one (the accepted cost); a missing,
// pending, retired, corrupt or role-removed identity, an unbound session, an unreadable checkout and an unknown operation are refused or unavailable, never allowed; the two tools are checked
// separately; and nothing in the identity store changes. It does NOT show the service's use of the verdict (service.aetheria.test.ts) or the XC-6 wire.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createIdentityReader } from "../identity/backendEntry.ts";
import { childRecord, mainRecord, rootOf, snapshot, writeEnvelope } from "../identity/testkit.ts";
import { createInspectAccess } from "./inspectAccess.ts";

const ROOT = "0197d3c0-bbbb-7000-8000-00000000000a";
const SEER = "0197d3c0-bbbb-7000-8000-00000000000b";
const PLAIN = "0197d3c0-bbbb-7000-8000-00000000000c";
const GONE = "0197d3c0-bbbb-7000-8000-00000000000d";
const LISTONLY = "0197d3c0-bbbb-7000-8000-00000000000e";

const scratch = (prefix: string) =>
  NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix)));

const roleFile = (tool: string, tools: string) => `---
name: ${tool}
description: A scratch role.
metadata:
  dsh:
    tool: ${tool}
    routes:
      - { provider: openai-codex, model: gpt-6.1-sol, effort: high }
    tools: [${tools}]
    maxDepth: 1
    background: one-shot
---

The job: do the scratch work.
`;

const makeCheckout = () => {
  const checkout = scratch("ae-inspect-checkout-");
  NodeFS.mkdirSync(NodePath.join(checkout, ".git"));
  const agents = NodePath.join(checkout, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(agents, "seer.md"),
    roleFile("seer", "read, inspect_list, inspect_query"),
  );
  NodeFS.writeFileSync(NodePath.join(agents, "plain.md"), roleFile("plain", "read, grep"));
  NodeFS.writeFileSync(
    NodePath.join(agents, "listonly.md"),
    roleFile("listonly", "read, inspect_list"),
  );
  return checkout;
};

const roleChild = (sessionId: string, role: string) => ({
  ...childRecord(sessionId, ROOT, [ROOT], role),
  roleOrigin: "checkout" as const,
});

const build = (options: { checkout?: string | undefined; bound?: string[] } = {}) => {
  const stateRoot = rootOf();
  const checkout = "checkout" in options ? options.checkout : makeCheckout();
  const folder = scratch("ae-inspect-project-");
  NodeFS.mkdirSync(NodePath.join(folder, ".git"));
  const bound = new Set(options.bound ?? [ROOT, SEER, PLAIN, LISTONLY, GONE]);
  const access = createInspectAccess({
    reader: createIdentityReader({ stateRoot }),
    index: {
      bindingOfSession: (id: string) =>
        bound.has(id) ? ({ workingFolder: folder } as never) : undefined,
    },
    checkout,
    env: {},
    homedir: () => scratch("ae-inspect-home-"),
  });
  return { stateRoot, access };
};

describe("a main session", () => {
  it("is authorized as the tool it asks about, for either operation", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    expect(await access.check(ROOT, "inspect.list")).toEqual({ ok: true });
    expect(await access.check(ROOT, "inspect.query")).toEqual({ ok: true });
  });

  it("is allowed in any composition: the Backend cannot tell a Builder main session from an Aetheria one", async () => {
    // Two main sessions with identical records are indistinguishable here; Builder-only tools are the Agent host's gate.
    const { stateRoot, access } = build({ bound: [ROOT, PLAIN] });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, mainRecord(PLAIN));
    expect(await access.check(ROOT, "inspect.list")).toEqual(
      await access.check(PLAIN, "inspect.list"),
    );
  });
});

describe("a child", () => {
  it("is refused AUTH_TOOL_NOT_ALLOWED when its role's current allow-list lacks the tool", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, roleChild(PLAIN, "plain"));
    for (const op of ["inspect.list", "inspect.query"])
      expect(await access.check(PLAIN, op), op).toMatchObject({
        ok: false,
        code: "AUTH_TOOL_NOT_ALLOWED",
      });
  });

  it("is allowed only the tool its role lists, and each tool is checked on its own", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, roleChild(SEER, "seer"));
    writeEnvelope(stateRoot, roleChild(LISTONLY, "listonly"));
    expect(await access.check(SEER, "inspect.list")).toEqual({ ok: true });
    expect(await access.check(SEER, "inspect.query")).toEqual({ ok: true });
    expect(await access.check(LISTONLY, "inspect.list")).toEqual({ ok: true });
    expect(await access.check(LISTONLY, "inspect.query")).toMatchObject({
      ok: false,
      code: "AUTH_TOOL_NOT_ALLOWED",
    });
  });

  it("is refused AUTH_ROLE_REMOVED when its role left the catalog, whatever its record once allowed", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, roleChild(GONE, "vanished"));
    expect(await access.check(GONE, "inspect.list")).toMatchObject({
      ok: false,
      code: "AUTH_ROLE_REMOVED",
    });
  });
});

describe("an identity that cannot be established", () => {
  it("is refused with M03's own code and never allowed: no record, pending, retired, corrupt", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT), { state: "pending" });
    // A pending record is not an active one: M03's code, whatever it is, and never an allowance.
    expect(await access.check(ROOT, "inspect.list")).toMatchObject({
      ok: false,
      code: expect.stringMatching(/^AUTH_IDENTITY_/),
    });
    expect(await access.check(SEER, "inspect.list")).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    writeEnvelope(stateRoot, mainRecord(PLAIN), { state: "retired" });
    expect(await access.check(PLAIN, "inspect.list")).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    writeEnvelope(stateRoot, mainRecord(LISTONLY), { raw: "{not json" });
    expect(await access.check(LISTONLY, "inspect.list")).toMatchObject({
      ok: false,
      code: expect.stringMatching(/^AUTH_IDENTITY_/),
    });
  });

  it("is unavailable for an unbound session, a missing or relative checkout, an empty session and a thrown failure", async () => {
    const unbound = build({ bound: [] });
    writeEnvelope(unbound.stateRoot, mainRecord(ROOT));
    expect(await unbound.access.check(ROOT, "inspect.list")).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    for (const checkout of [undefined, "relative/checkout", ""]) {
      const { stateRoot, access } = build({ checkout });
      writeEnvelope(stateRoot, mainRecord(ROOT));
      expect(await access.check(ROOT, "inspect.list"), String(checkout)).toMatchObject({
        ok: false,
        code: "AUTH_IDENTITY_UNAVAILABLE",
      });
    }
    const { access } = build();
    expect(await access.check("", "inspect.list")).toMatchObject({
      ok: false,
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    const throwing = createInspectAccess({
      reader: {
        read: () => {
          throw new Error("boom");
        },
      } as never,
      index: { bindingOfSession: () => ({ workingFolder: "/tmp" }) as never },
      checkout: makeCheckout(),
      env: {},
      homedir: () => "/nonexistent-home",
    });
    expect(await throwing.check(ROOT, "inspect.list")).toMatchObject({ ok: false });
  });

  it("refuses an operation that is not one of the two inspect operations, even for a main session", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    for (const op of ["inspect.write", "board.read", "", "toString", "__proto__"])
      expect(await access.check(ROOT, op), op).toMatchObject({
        ok: false,
        code: "AUTH_TOOL_NOT_ALLOWED",
      });
  });

  it("changes nothing in the identity store, whatever the verdict", async () => {
    const { stateRoot, access } = build();
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, roleChild(PLAIN, "plain"));
    const before = snapshot(stateRoot);
    await access.check(ROOT, "inspect.list");
    await access.check(PLAIN, "inspect.query");
    await access.check(GONE, "inspect.list");
    expect(snapshot(stateRoot)).toEqual(before);
  });
});
