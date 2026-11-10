// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDate:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// M06 step 23: `audit.history` over the real Backend, installed awareness and evidence archives, real Git repositories and a scratch checkout.
// Shows: only a current checkout role reads its OWN project's evidence (never the checkout's for a foreign one); other callers get M03's code as `refused`;
// extra arguments throw; the identity store is unchanged. Does NOT show the Agent tool, a WebSocket or the T3 identity transport (the context stands in).
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuditHistoryResult } from "@t3tools/aetheria-contracts";
import {
  createAetheriaBackendService,
  type AetheriaBackendService,
} from "@t3tools/aetheria-server";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vitest";

type Json = Record<string, any>; // replies are checked field by field; the wire shapes are the contracts' own
const MAIN = "main-1";
const REVIEWER_HOME = "reviewer-home";
const REVIEWER_FOREIGN = "reviewer-foreign";
const REVIEWER_EMPTY = "reviewer-empty";
const REVIEWER_NOGIT = "reviewer-nogit";
const REVIEWER_LOCKED = "reviewer-locked";
const REVIEWER_MISSING = "reviewer-missing";
const WORKER = "worker-1";
const RETIRED = "reviewer-retired";
const REMOVED = "reviewer-removed";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});
const live: AetheriaBackendService[] = [];
afterEach(async () => {
  for (const service of live.splice(0)) await service.dispose("test").catch(() => undefined);
});

const scratch = (prefix: string, base = NodeOS.tmpdir()): string => {
  NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(base, prefix)));
  cleanup.push(() => {
    for (const path of unreadable.splice(0)) {
      try {
        NodeFS.chmodSync(path, 0o755);
      } catch {
        /* already gone */
      }
    }
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};
const unreadable: string[] = [];

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (repo: string, ...args: string[]) =>
  NodeChildProcess.execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8", env: GIT_ENV },
  ).trim();
const commit = (dir: string, files: Record<string, string>, message: string) => {
  for (const [file, text] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, file), text);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
};
const GATES = '- 2026-09-30 — User approved the Plan: "go".';
const record = (extra = "") =>
  `---\nphase: execute\n---\n\n# Demo\n\n## Gate history\n\n${GATES}\n\n${extra}\n\n## Deviations\n\nNone.\n`;
/** An approved cycle `slug` under `folder` in a fresh repository: plan and record in one commit, then the baseline pointer. */
const repository = (tag: string, folder: string, body: string, slug = "demo") => {
  const dir = scratch("ae-audit-e2e-repo-");
  git(dir, "init", "-q", "-b", "main");
  commit(dir, { "README.md": "fixture\n" }, "fixture");
  const oid = commit(
    dir,
    {
      [`${folder}${slug}/plan.md`]: `# Demo — Plan\n\n${body}\n`,
      [`${folder}${slug}/record.md`]: record(),
    },
    `${tag}: plan`,
  );
  commit(
    dir,
    { [`${folder}${slug}/record.md`]: record(`plan-baseline: ${oid}`) },
    `${tag}: baseline`,
  );
  return { dir, oid };
};
const settings = (dir: string, cycles: string) => {
  NodeFS.mkdirSync(NodePath.join(dir, ".aetheria"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(dir, ".aetheria", "settings.json"),
    JSON.stringify({ paths: { cycles } }),
  );
};

const roleFile = (tool: string, tools: string) =>
  `---\nname: ${tool}\ndescription: A scratch role.\nmetadata:\n  dsh:\n    tool: ${tool}\n    routes:\n      - { provider: openai-codex, model: gpt-6.1-sol, effort: high }\n    tools: [${tools}]\n    maxDepth: 1\n    background: one-shot\n---\n\nThe job: do the scratch work.\n`;

/** The Aetheria checkout: a real repository with the demo cycle, authored roles, and no home sets (the scratch home is empty). */
const checkoutRepository = () => {
  const made = repository("checkout", "cycles/", "1. The CHECKOUT plan.");
  const agents = NodePath.join(made.dir, ".agents", "agents", "ae");
  NodeFS.mkdirSync(agents, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(agents, "reviewer.md"),
    roleFile("reviewer", "read, grep, audit_evidence"),
  );
  NodeFS.writeFileSync(NodePath.join(agents, "worker.md"), roleFile("worker", "read, grep"));
  return made;
};

const envelope = (record: Json, state = "active") =>
  `${JSON.stringify({
    formatVersion: 1,
    state,
    attemptId: "attempt-1",
    writer: "agent-authority",
    acceptedPrompt: false,
    ...(state === "retired" ? { retiredReason: "test" } : {}),
    record,
  })}\n`;
const writeRecord = (stateRoot: string, record: Json, state = "active") => {
  const dir = NodePath.join(stateRoot, "identity");
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  NodeFS.chmodSync(dir, 0o700);
  const file = NodePath.join(dir, `${record.sessionId}.json`);
  NodeFS.writeFileSync(file, envelope(record, state), { mode: 0o600 });
  NodeFS.chmodSync(file, 0o600);
};
const mainRecord = (sessionId: string): Json => ({
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  parentChain: [],
  role: null,
  roleOrigin: null,
  roleDigest: null,
  authoritySource: "main",
});
const childRecord = (sessionId: string, role: string): Json => ({
  sessionId,
  kind: "child",
  rootSessionId: MAIN,
  parentChain: [MAIN],
  role,
  roleOrigin: "checkout",
  roleDigest: null,
  authoritySource: "role",
});

const identityDigest = (stateRoot: string): string => {
  const dir = NodePath.join(stateRoot, "identity");
  const hash = NodeCrypto.createHash("sha256");
  for (const name of NodeFS.readdirSync(dir).sort()) {
    hash.update(name);
    hash.update(NodeFS.readFileSync(NodePath.join(dir, name)));
    hash.update(String(NodeFS.statSync(NodePath.join(dir, name)).mtimeMs));
  }
  return hash.digest("hex");
};

interface World {
  readonly service: AetheriaBackendService;
  readonly stateRoot: string;
  readonly checkout: { readonly dir: string; readonly oid: string };
  readonly call: (session: string, args: Record<string, unknown>) => Promise<Json>;
}

/** Sessions: each is a thread bound to a Pi session whose working folder is `folders[session]`. */
const world = async (options: {
  folders: Record<string, string>;
  checkout?: string | null;
  arrange?: (stateRoot: string, checkoutDir: string) => void;
}): Promise<World> => {
  const stateRoot = scratch(
    "m06-s23-audit-",
    NodePath.join(NodeOS.homedir(), ".aetheria", "candidate-envs"),
  );
  const checkout = checkoutRepository();
  const emptyHome = scratch("ae-audit-e2e-home-");
  writeRecord(stateRoot, mainRecord(MAIN));
  writeRecord(stateRoot, childRecord(REVIEWER_HOME, "reviewer"));
  for (const session of [
    REVIEWER_FOREIGN,
    REVIEWER_EMPTY,
    REVIEWER_NOGIT,
    REVIEWER_LOCKED,
    REVIEWER_MISSING,
  ])
    writeRecord(stateRoot, childRecord(session, "reviewer"));
  writeRecord(stateRoot, childRecord(WORKER, "worker"));
  writeRecord(stateRoot, childRecord(RETIRED, "reviewer"), "retired");
  writeRecord(stateRoot, childRecord(REMOVED, "vanished"));
  options.arrange?.(stateRoot, checkout.dir);
  const folders = Object.fromEntries(
    Object.entries(options.folders).map(([session, folder]) => [
      session,
      folder === "$CHECKOUT" ? checkout.dir : folder,
    ]),
  );
  const threads = Object.keys(folders).map((session) => ({
    threadId: `thread:${session}`,
    runtime: `provider-session:${session}`,
    session,
    cwd: folders[session] as string,
  }));
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: (threadId) => threads.find((t) => t.threadId === threadId)?.runtime,
    projectRootOf: (folder) => folder,
    ...(options.checkout === null ? {} : { checkout: options.checkout ?? checkout.dir }),
    auditRoles: { env: {}, homedir: () => emptyHome },
  });
  if (made.outcome !== "prepared") throw new Error("the Backend must prepare");
  live.push(made.service);
  const started = await made.service.start();
  if (started.outcome !== "started")
    throw new Error(`the Backend did not start: ${started.outcome}`);
  let sequence = 0;
  for (const { threadId, runtime, session, cwd } of threads) {
    await made.service.ingest({
      sequence: (sequence += 1),
      event: {
        type: "provider-session.updated",
        threadId,
        payload: { id: runtime, providerInstanceId: "pi", status: "ready", cwd },
      },
    });
    await made.service.ingest({
      sequence: (sequence += 1),
      event: {
        type: "provider-thread.updated",
        threadId,
        payload: {
          driver: "pi",
          providerInstanceId: "pi",
          providerSessionId: runtime,
          appThreadId: threadId,
          nativeThreadRef: { nativeId: `/s/2026-11-08T08-00-00-000Z_${session}.jsonl` },
        },
      },
    });
  }
  return {
    service: made.service,
    stateRoot,
    checkout,
    call: (session, args) =>
      Promise.resolve(
        made.service.operations()["audit.history"]!({
          caller: {
            threadId: `thread:${session}`,
            providerSessionId: `provider-session:${session}`,
            providerInstanceId: "pi",
          },
          sessionId: session,
          kind: session === MAIN ? "main" : "child",
          rootSessionId: MAIN,
          args,
        }),
      ) as Promise<Json>,
  };
};
const decodeEvidence = Schema.decodeUnknownSync(AuditHistoryResult as never, {
  onExcessProperty: "error",
});
const decodes = (value: unknown) => decodeEvidence(value);

describe("a reviewer reads the evidence of its own project only", () => {
  it("at home: the checkout's cycle, through the real Git history, as the wire contract's result", async () => {
    const w = await world({ folders: { [MAIN]: "$CHECKOUT", [REVIEWER_HOME]: "$CHECKOUT" } });
    const reply = await w.call(REVIEWER_HOME, { cycle: "demo" });
    expect(reply).toMatchObject({
      status: "done",
      result: {
        verdict: "plan-unchanged",
        record: "cycles/demo/record.md",
        baseline: w.checkout.oid,
        role: "reviewer",
      },
    });
    expect(reply.result.currentPlan).toMatch(/CHECKOUT plan/);
    expect(() => decodes(reply.result)).not.toThrow();
    expect("projectProblems" in reply.result).toBe(false);
  });

  it("in a foreign project: its own repository and custom cycles folder, with the same slug giving different content, and never the checkout", async () => {
    const foreign = repository("project", "work/plans/", "1. The PROJECT plan.");
    settings(foreign.dir, "work/plans/");
    git(foreign.dir, "add", "-A");
    git(foreign.dir, "commit", "-q", "-m", "settings");
    const w = await world({
      folders: {
        [MAIN]: "$CHECKOUT",
        [REVIEWER_HOME]: "$CHECKOUT",
        [REVIEWER_FOREIGN]: foreign.dir,
      },
    });
    const home = await w.call(REVIEWER_HOME, { cycle: "demo" });
    const away = await w.call(REVIEWER_FOREIGN, { cycle: "demo" });
    expect(away).toMatchObject({
      status: "done",
      result: {
        verdict: "plan-unchanged",
        record: "work/plans/demo/record.md",
        planPath: "work/plans/demo/plan.md",
        baseline: foreign.oid,
      },
    });
    expect(away.result.currentPlan).toMatch(/PROJECT plan/);
    expect(JSON.stringify(away)).not.toContain("CHECKOUT");
    expect(JSON.stringify(home)).not.toContain("PROJECT");
    expect(away.result.baseline).not.toBe(home.result.baseline);
    expect(() => decodes(away.result)).not.toThrow();
  });

  it("a foreign project that lacks the cycle, has no Git, is missing, or has an unreadable cycles folder is unverified — never the checkout's answer", async () => {
    const empty = scratch("ae-audit-e2e-empty-");
    git(empty, "init", "-q", "-b", "main");
    commit(empty, { "README.md": "x\n" }, "fixture");
    const noGit = scratch("ae-audit-e2e-nogit-");
    const locked = repository("locked", "cycles/", "1. The LOCKED plan.");
    const lockedFolder = NodePath.join(locked.dir, "cycles");
    unreadable.push(lockedFolder);
    NodeFS.chmodSync(lockedFolder, 0o000);
    const w = await world({
      folders: {
        [REVIEWER_EMPTY]: empty,
        [REVIEWER_NOGIT]: noGit,
        [REVIEWER_LOCKED]: locked.dir,
        [REVIEWER_MISSING]: NodePath.join(noGit, "no-such-project"),
      },
    });
    for (const session of [REVIEWER_EMPTY, REVIEWER_NOGIT, REVIEWER_LOCKED, REVIEWER_MISSING]) {
      const reply = await w.call(session, { cycle: "demo" });
      expect(reply, session).toMatchObject({ status: "done", result: { verdict: "unverified" } });
      expect(reply.result.reason, session).toMatch(/\S/);
      expect(JSON.stringify(reply), session).not.toContain("CHECKOUT");
      expect(() => decodes(reply.result), session).not.toThrow();
    }
  });

  it("answers a malformed slug as invalid evidence, not a refusal", async () => {
    const w = await world({ folders: { [REVIEWER_HOME]: "$CHECKOUT" } });
    expect(await w.call(REVIEWER_HOME, { cycle: "../etc" })).toMatchObject({
      status: "done",
      result: { verdict: "invalid" },
    });
  });
});

describe("every other caller is refused with M03's own code", () => {
  it("a main session, a role without the capability, a retired record and a removed role", async () => {
    const w = await world({
      folders: {
        [MAIN]: "$CHECKOUT",
        [WORKER]: "$CHECKOUT",
        [RETIRED]: "$CHECKOUT",
        [REMOVED]: "$CHECKOUT",
        [REVIEWER_HOME]: "$CHECKOUT",
      },
    });
    const expected: Array<[string, string]> = [
      [MAIN, "AUTH_TOOL_NOT_ALLOWED"],
      [WORKER, "AUTH_TOOL_NOT_ALLOWED"],
      [RETIRED, "AUTH_IDENTITY_UNAVAILABLE"],
      [REMOVED, "AUTH_ROLE_REMOVED"],
    ];
    for (const [session, code] of expected) {
      const reply = await w.call(session, { cycle: "demo" });
      expect(reply, session).toEqual({ status: "refused", code });
    }
    // The role a reviewer holds is the CURRENT definition: deleting it refuses the very next call.
    NodeFS.rmSync(NodePath.join(w.checkout.dir, ".agents", "agents", "ae", "reviewer.md"));
    expect(await w.call(REVIEWER_HOME, { cycle: "demo" })).toEqual({
      status: "refused",
      code: "AUTH_ROLE_REMOVED",
    });
  });

  it("a session with no thread binding, and a Backend with no checkout, are AUTH_IDENTITY_UNAVAILABLE for this operation only", async () => {
    const w = await world({ folders: { [MAIN]: "$CHECKOUT" } });
    expect(await w.call(REVIEWER_HOME, { cycle: "demo" })).toEqual({
      status: "refused",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    const noCheckout = await world({ folders: { [REVIEWER_HOME]: "$CHECKOUT" }, checkout: null });
    expect(await noCheckout.call(REVIEWER_HOME, { cycle: "demo" })).toEqual({
      status: "refused",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    const relative = await world({
      folders: { [REVIEWER_HOME]: "$CHECKOUT" },
      checkout: "relative/path",
    });
    expect(await relative.call(REVIEWER_HOME, { cycle: "demo" })).toEqual({
      status: "refused",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    // Other operations of the module are unaffected by a missing checkout.
    expect(
      await noCheckout.service.operations()["plan-mode.get"]!({
        caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" },
        sessionId: MAIN,
        kind: "main",
        rootSessionId: MAIN,
        args: {},
      }),
    ).toMatchObject({ status: "done" });
  });
});

describe("no argument chooses a repository, a path, an actor or a role, and nothing is written", () => {
  it("refuses extra keys before any check, and leaves the identity store byte-for-byte unchanged across every outcome", async () => {
    const foreign = repository("project", "cycles/", "1. The PROJECT plan.");
    const w = await world({
      folders: {
        [MAIN]: "$CHECKOUT",
        [REVIEWER_HOME]: "$CHECKOUT",
        [REVIEWER_FOREIGN]: foreign.dir,
        [WORKER]: "$CHECKOUT",
      },
    });
    const before = identityDigest(w.stateRoot);
    for (const extra of [
      { repo: foreign.dir },
      { repository: "/etc" },
      { path: "../../etc" },
      { project: { root: foreign.dir } },
      { actor: "human" },
      { role: "reviewer" },
      { sessionId: REVIEWER_FOREIGN },
      { rootSessionId: "other-root" },
    ])
      await expect(
        Promise.resolve().then(() => w.call(REVIEWER_HOME, { cycle: "demo", ...extra })),
      ).rejects.toThrow();
    await expect(Promise.resolve().then(() => w.call(REVIEWER_HOME, {}))).rejects.toThrow();
    for (const session of [REVIEWER_HOME, REVIEWER_FOREIGN, WORKER, MAIN, "nobody"])
      await w.call(session, { cycle: "demo" }).catch(() => undefined);
    expect(identityDigest(w.stateRoot)).toBe(before);
  });
});
