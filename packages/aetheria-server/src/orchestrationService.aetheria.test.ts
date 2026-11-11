// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M05 Plan step 6 (C10) — the assembled Backend service with the orchestration module: the production project root reaching the thread index, the module
// registered but unavailable until a children service is injected, and the injected service started after the owner lock with the Backend's own seams.
//
// Boundary. The real Backend service (owner lock, composition validation, ordered start, reverse drain), the real thread index and identity feed, and the real
// awareness archive's `deriveProject` over real temporary folders. The ONLY doubles are the children service and T3's thread port (neither exists as a real
// implementation here: steps 5 and 7 build the service, apps/server's threadPort.ts adapts T3). The test shows the wiring, not any child behaviour.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ORCHESTRATION_OPERATIONS } from "@t3tools/aetheria-contracts";

import type { OrchestrationService, OrchestrationServiceDeps } from "./orchestration.ts";
import type { ChildThreadPort } from "./orchestrationPorts.ts";
import { createAetheriaBackendService } from "./service.ts";
import type { StoredEventLike } from "./identity/feed.ts";
import { SESSION, THREAD, sessionFileOf } from "./identity/testkit.ts";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});
const tmp = (): string => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-svc-")));
  cleanup.push(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const RUNTIME = "provider-session:provider-instance:pi:thread:t:abc";
let sequence = 100;
const sessionEvent = (cwd: string): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-session.updated",
    threadId: THREAD,
    payload: { id: RUNTIME, providerInstanceId: "pi", status: "ready", cwd },
  },
});
const threadEvent = (): StoredEventLike => ({
  sequence: ++sequence,
  event: {
    type: "provider-thread.updated",
    threadId: THREAD,
    payload: {
      driver: "pi",
      providerInstanceId: "pi",
      providerSessionId: RUNTIME,
      appThreadId: THREAD,
      nativeThreadRef: { nativeId: sessionFileOf(SESSION) },
    },
  },
});

const noThreads = {} as ChildThreadPort;

const build = (options: Parameters<typeof createAetheriaBackendService>[0]) => {
  const made = createAetheriaBackendService(options);
  if (made.outcome !== "prepared") throw new Error(JSON.stringify(made.faults));
  cleanup.push(() => made.service.dispose("test"));
  return made.service;
};

const baseOptions = () => ({
  stateRoot: tmp(),
  credentialOf: () => "cred-1",
});

describe("production project root reaches the thread index", () => {
  it("derives the canonical root of a working folder before the index binds it (an alias resolves to the real project)", async () => {
    const base = tmp();
    const project = NodePath.join(base, "project");
    NodeFS.mkdirSync(NodePath.join(project, ".git"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(project, "src"));
    const alias = NodePath.join(base, "alias");
    NodeFS.symlinkSync(project, alias);
    const service = build({ ...baseOptions(), checkout: tmp() });
    expect((await service.start()).outcome).toBe("started");
    await service.ingest(sessionEvent(NodePath.join(alias, "src")));
    await service.ingest(threadEvent());
    const found = service.index.lookup(THREAD);
    expect(found.status).toBe("ok");
    if (found.status === "ok") expect(found.binding.projectRoot).toBe(project);
  });

  it("binds with no project root (lineage unverifiable, never a guess) when no checkout lets the root be derived", async () => {
    const folder = tmp();
    const service = build(baseOptions());
    await service.start();
    await service.ingest(sessionEvent(folder));
    await service.ingest(threadEvent());
    const found = service.index.lookup(THREAD);
    expect(found.status).toBe("ok");
    if (found.status === "ok") expect(found.binding.projectRoot).toBeNull();
  });
});

describe("the orchestration module in the assembled Backend", () => {
  it("registers all seventeen operations and answers unavailable while no children service is injected", async () => {
    const service = build(baseOptions());
    expect((await service.start()).outcome).toBe("started");
    const operations = service.operations();
    for (const name of ORCHESTRATION_OPERATIONS) expect(operations[name], name).toBeDefined();
    expect(service.orchestration()).toBeUndefined();
    const answer = await operations["children.list"]!({
      caller: { threadId: THREAD, providerSessionId: "c", providerInstanceId: "pi" },
      sessionId: "s",
      kind: "main",
      rootSessionId: "s",
      args: { scope: "children" },
    });
    expect(answer).toEqual({ status: "unavailable", code: "ORCHESTRATION_UNAVAILABLE" });
  });

  it("a factory without T3's thread port stays unconfigured", async () => {
    let built = 0;
    const service = build({
      ...baseOptions(),
      orchestrationFactory: () => {
        built += 1;
        throw new Error("must not be built");
      },
    });
    await service.start();
    expect(built).toBe(0);
    expect(service.orchestration()).toBeUndefined();
  });

  it("builds the injected service once, after the owner lock, with the Backend's own seams, and drains it once", async () => {
    const seen: OrchestrationServiceDeps[] = [];
    let starts = 0;
    let drains = 0;
    const injected: OrchestrationService = {
      start: async () => {
        starts += 1;
        return { ok: true };
      },
      handle: async () => ({ ok: true, value: { rows: [], diagnostics: [] } }),
      drain: async () => {
        drains += 1;
        return { stopped: [], stillLive: [] };
      },
    };
    const options = baseOptions();
    const service = build({
      ...options,
      childThreads: noThreads,
      orchestrationFactory: (deps) => {
        seen.push(deps);
        return injected;
      },
    });
    expect((await service.start()).outcome).toBe("started");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.threads).toBe(noThreads);
    expect(seen[0]!.stateRoot).toBe(options.stateRoot);
    expect(starts).toBe(1);
    expect(service.orchestration()).toBe(injected);
    // Plan mode is M06's: the port forwards to the ONE running interaction service (the archive's real one here) and answers its outcome.
    expect(typeof (await seen[0]!.planMode.inheritPlanMode("a", "b", "spawn")).ok).toBe("boolean");
    await seen[0]!.resume.resumed("unknown-session");
    expect(seen[0]!.threadOfSession("nobody")).toBeUndefined();
    expect(seen[0]!.sessionOfThread("nobody")).toBeUndefined();
    const answer = await service.operations()["children.list"]!({
      caller: { threadId: THREAD, providerSessionId: "c", providerInstanceId: "pi" },
      sessionId: "s",
      kind: "main",
      rootSessionId: "s",
      args: { scope: "children" },
    });
    expect(answer).toMatchObject({ status: "done" });
    const report = await service.dispose("test");
    expect(report.ok).toBe(true);
    expect(drains).toBe(1);
    expect(service.orchestration()).toBeUndefined();
  });

  it("a children service that does not start refuses the Backend start", async () => {
    const service = build({
      ...baseOptions(),
      childThreads: noThreads,
      orchestrationFactory: () => ({
        start: async () => ({ ok: false, code: "STORE_UNSUPPORTED" }),
        handle: async () => ({ ok: true, value: {} }),
        drain: async () => ({ stopped: [], stillLive: [] }),
      }),
    });
    expect((await service.start()).outcome).not.toBe("started");
  });
});
