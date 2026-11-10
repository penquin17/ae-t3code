// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M06 Plan step 23 — the Backend's independent check for the read-only audit evidence operation.
//
// Boundary: M03's real record reader, validator, role catalog (read from a scratch checkout's authored agent files), project derivation and
// `authorize` — all from the installed awareness archive — over scratch identity records, a scratch checkout and scratch project folders. Only the
// thread index is a stand-in (it supplies each session's working folder). It shows: which caller reaches the evidence (a session whose CURRENT checkout role
// holds `audit_evidence`), the actual M03 code for every other caller, the project facts derived per call for THAT session (home or foreign, its own
// cycles folder, its own settings problems), and that nothing in the identity store changes. It does NOT show Git, the evidence logic or the XC-6 wire.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { createAuditAccess } from "./auditAccess.ts";
import { createIdentityReader } from "./backendEntry.ts";
import { childRecord, mainRecord, rootOf, snapshot, writeEnvelope } from "./testkit.ts";

const ROOT = "0197d3c0-aaaa-7000-8000-00000000000a";
const REVIEWER = "0197d3c0-aaaa-7000-8000-00000000000b";
const WORKER = "0197d3c0-aaaa-7000-8000-00000000000c";
const GONE = "0197d3c0-aaaa-7000-8000-00000000000d";
const HOMEROLE = "0197d3c0-aaaa-7000-8000-00000000000e";

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

/** A scratch checkout (a Git marker, authored roles) and an empty home, so no real role set of this machine is read. */
const makeCheckout = () => {
  const checkout = scratch("ae-audit-checkout-");
  NodeFS.mkdirSync(NodePath.join(checkout, ".git"));
  const agents = NodePath.join(checkout, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(agents, "reviewer.md"),
    roleFile("reviewer", "read, grep, audit_evidence"),
  );
  NodeFS.writeFileSync(NodePath.join(agents, "worker.md"), roleFile("worker", "read, grep"));
  return checkout;
};
const makeProject = (settings?: string) => {
  const dir = scratch("ae-audit-project-");
  NodeFS.mkdirSync(NodePath.join(dir, ".git"));
  if (settings !== undefined) {
    NodeFS.mkdirSync(NodePath.join(dir, ".aetheria"));
    NodeFS.writeFileSync(NodePath.join(dir, ".aetheria", "settings.json"), settings);
  }
  return dir;
};

const reviewerOf = (
  sessionId: string,
  role = "reviewer",
  origin: "checkout" | "home" = "checkout",
) => ({ ...childRecord(sessionId, ROOT, [ROOT], role), roleOrigin: origin }) as const;

const build = (
  options: {
    folders?: Record<string, string>;
    checkout?: string | undefined;
    records?: Array<[ReturnType<typeof mainRecord>, Parameters<typeof writeEnvelope>[2]?]>;
  } = {},
) => {
  const stateRoot = rootOf();
  const checkout = "checkout" in options ? options.checkout : makeCheckout();
  const folders = options.folders ?? {};
  const access = createAuditAccess({
    reader: createIdentityReader({ stateRoot }),
    index: {
      bindingOfSession: (sessionId: string) =>
        folders[sessionId] === undefined
          ? undefined
          : ({ workingFolder: folders[sessionId] } as never),
    },
    checkout,
    env: {},
    homedir: () => scratch("ae-audit-home-"),
  });
  return { stateRoot, checkout, access };
};

describe("the caller whose current checkout role holds audit_evidence", () => {
  it("reaches the evidence in the Aetheria checkout, with the home project facts and the role's name", async () => {
    const checkout = makeCheckout();
    const { stateRoot, access } = build({ checkout, folders: { [REVIEWER]: checkout } });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, reviewerOf(REVIEWER));
    const result = await access.check(REVIEWER);
    expect(result).toMatchObject({
      ok: true,
      role: "reviewer",
      project: {
        root: checkout,
        place: "home",
        settingsPaths: { cycles: "cycles/" },
        problems: [],
      },
    });
  });

  it("reads a foreign project's own folder and its own cycles setting, and never the checkout's", async () => {
    const checkout = makeCheckout();
    const project = makeProject(JSON.stringify({ paths: { cycles: "work/cycles/", bogus: "x" } }));
    const { stateRoot, access } = build({ checkout, folders: { [REVIEWER]: project } });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, reviewerOf(REVIEWER));
    const result = await access.check(REVIEWER);
    expect(result).toMatchObject({
      ok: true,
      project: { root: project, place: "foreign", settingsPaths: { cycles: "work/cycles/" } },
    });
    expect(JSON.stringify(result)).not.toContain(checkout);
    // The project's own settings problem travels with the facts, for the evidence role to see.
    expect(
      (result as unknown as { project: { problems: string[] } }).project.problems.join("\n"),
    ).toMatch(/bogus/);
  });

  it("derives the facts anew on every call: an edited setting or a removed role changes the very next answer", async () => {
    const checkout = makeCheckout();
    const project = makeProject(JSON.stringify({ paths: { cycles: "one/" } }));
    const { stateRoot, access } = build({ checkout, folders: { [REVIEWER]: project } });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, reviewerOf(REVIEWER));
    expect(await access.check(REVIEWER)).toMatchObject({
      project: { settingsPaths: { cycles: "one/" } },
    });
    NodeFS.writeFileSync(
      NodePath.join(project, ".aetheria", "settings.json"),
      JSON.stringify({ paths: { cycles: "two/" } }),
    );
    expect(await access.check(REVIEWER)).toMatchObject({
      project: { settingsPaths: { cycles: "two/" } },
    });
    NodeFS.rmSync(NodePath.join(checkout, ".agents", "agents", "ae", "reviewer.md"));
    expect(await access.check(REVIEWER)).toMatchObject({ ok: false, code: "AUTH_ROLE_REMOVED" });
  });
});

describe("every other caller is refused with M03's own code, before any evidence is read", () => {
  const refused = async (
    arrange: (stateRoot: string, checkout: string) => Record<string, string>,
    session: string,
    expected: string,
    extra: { checkout?: string | undefined } = {},
  ) => {
    const checkout = "checkout" in extra ? extra.checkout : makeCheckout();
    const stateRoot = rootOf();
    const folders = arrange(stateRoot, checkout ?? "/nowhere");
    const access = createAuditAccess({
      reader: createIdentityReader({ stateRoot }),
      index: {
        bindingOfSession: (id: string) =>
          folders[id] === undefined ? undefined : ({ workingFolder: folders[id] } as never),
      },
      checkout,
      env: {},
      homedir: () => scratch("ae-audit-home-"),
    });
    const result = await access.check(session);
    expect(result).toMatchObject({ ok: false, code: expected });
    // A refusal carries no project facts: nothing about the repository is derived into the answer.
    expect(result).not.toHaveProperty("project");
    return result;
  };

  it("a main session holds no role binding: AUTH_TOOL_NOT_ALLOWED", async () => {
    await refused(
      (stateRoot, checkout) => {
        writeEnvelope(stateRoot, mainRecord(ROOT));
        return { [ROOT]: checkout };
      },
      ROOT,
      "AUTH_TOOL_NOT_ALLOWED",
    );
  });

  it("a role whose definition lacks the capability: AUTH_TOOL_NOT_ALLOWED", async () => {
    await refused(
      (stateRoot, checkout) => {
        writeEnvelope(stateRoot, mainRecord(ROOT));
        writeEnvelope(stateRoot, reviewerOf(WORKER, "worker"));
        return { [WORKER]: checkout };
      },
      WORKER,
      "AUTH_TOOL_NOT_ALLOWED",
    );
  });

  it("a role removed from the catalog, and a role recorded with another origin: AUTH_ROLE_REMOVED", async () => {
    const arrange = (stateRoot: string, checkout: string) => {
      writeEnvelope(stateRoot, mainRecord(ROOT));
      writeEnvelope(stateRoot, reviewerOf(GONE, "vanished"));
      writeEnvelope(stateRoot, reviewerOf(HOMEROLE, "reviewer", "home"));
      return { [GONE]: checkout, [HOMEROLE]: checkout };
    };
    await refused(arrange, GONE, "AUTH_ROLE_REMOVED");
    await refused(arrange, HOMEROLE, "AUTH_ROLE_REMOVED");
  });

  it("a retired, absent, pending or unreadable record is an unavailable or invalid identity, never main", async () => {
    const arrange = (stateRoot: string, checkout: string) => {
      writeEnvelope(stateRoot, mainRecord(ROOT));
      writeEnvelope(stateRoot, reviewerOf(REVIEWER), { state: "retired" });
      // A staged (pending) attempt lives in its own folder and is not a record yet: WORKER has none, which is absent. A pending envelope misfiled at the
      // active path is corrupt, like unreadable bytes.
      writeEnvelope(stateRoot, reviewerOf(GONE), { raw: "{not json" });
      return { [REVIEWER]: checkout, [WORKER]: checkout, [GONE]: checkout, [HOMEROLE]: checkout };
    };
    await refused(arrange, REVIEWER, "AUTH_IDENTITY_UNAVAILABLE");
    await refused(arrange, WORKER, "AUTH_IDENTITY_UNAVAILABLE");
    await refused(arrange, HOMEROLE, "AUTH_IDENTITY_UNAVAILABLE");
    await refused(arrange, GONE, "AUTH_IDENTITY_INVALID");
  });

  it("a session with no binding, no checkout, a relative checkout or an unreadable checkout is AUTH_IDENTITY_UNAVAILABLE", async () => {
    const arrange = (stateRoot: string) => {
      writeEnvelope(stateRoot, mainRecord(ROOT));
      writeEnvelope(stateRoot, reviewerOf(REVIEWER));
      return {};
    };
    await refused(arrange, REVIEWER, "AUTH_IDENTITY_UNAVAILABLE");
    const bound = (stateRoot: string, checkout: string) => {
      arrange(stateRoot);
      return { [REVIEWER]: checkout };
    };
    await refused(bound, REVIEWER, "AUTH_IDENTITY_UNAVAILABLE", { checkout: undefined });
    await refused(bound, REVIEWER, "AUTH_IDENTITY_UNAVAILABLE", { checkout: "relative/checkout" });
    await refused(bound, REVIEWER, "AUTH_IDENTITY_UNAVAILABLE", {
      checkout: NodePath.join(NodeOS.tmpdir(), "ae-audit-no-such-checkout"),
    });
  });

  it("a working folder that no longer exists still derives M03's facts (foreign, default cycles): the evidence step, not this check, finds nothing there", async () => {
    const checkout = makeCheckout();
    const gone = NodePath.join(NodeOS.tmpdir(), "ae-audit-vanished-folder");
    const { stateRoot, access } = build({ checkout, folders: { [REVIEWER]: gone } });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, reviewerOf(REVIEWER));
    expect(await access.check(REVIEWER)).toMatchObject({
      ok: true,
      project: { root: gone, place: "foreign", settingsPaths: { cycles: "cycles/" } },
    });
  });
});

describe("the check is read-only", () => {
  it("changes nothing in the identity store, whatever the answer", async () => {
    const checkout = makeCheckout();
    const { stateRoot, access } = build({
      checkout,
      folders: { [REVIEWER]: checkout, [ROOT]: checkout, [WORKER]: checkout },
    });
    writeEnvelope(stateRoot, mainRecord(ROOT));
    writeEnvelope(stateRoot, reviewerOf(REVIEWER));
    writeEnvelope(stateRoot, reviewerOf(WORKER, "worker"));
    const before = snapshot(NodePath.join(stateRoot, "identity"));
    for (const session of [REVIEWER, ROOT, WORKER, "unknown-session"]) await access.check(session);
    expect(snapshot(NodePath.join(stateRoot, "identity"))).toEqual(before);
  });
});
