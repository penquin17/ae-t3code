// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M09 Plan step 8 (fork part) — the providers module with an explicit isolated Pi agent directory, over the real installed archive.
//
// Boundary: the real installed `@aetheria/providers/backend` archive (its bundled Pi auth code, quota readers and catalog), the real shared validator
// and lifecycle driver through this package's adapter, a synthetic auth.json in a temporary owner-only directory, and an injected fetch. No real
// auth file, endpoint, credential or model exists in this file. It shows: with an agent directory the module answers from the sign-in store, the
// meter and the catalog; a directory the archive refuses leaves the Backend running, answers unknown / service-unavailable, and is visible through a
// redacted warning that names the reason and not the path; the module drains clean. It does NOT show the authenticated XC-6 route (apps/server's
// providersAdaptersXc6 test does), cross-process locking (the outer suite does), or how a real server obtains the directory (step 24).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { prepareBackend } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
import {
  AGENT_AWARENESS_BACKEND_ENTRY,
  createAgentAwarenessBackendRegistration,
} from "./agentAwareness.ts";
import { createHumanControlBackendRegistration } from "./humanControl.ts";
import { createDeliverablesBackendRegistration } from "./deliverables/deliverables.ts";
import { createGroupsBackendRegistration } from "./groups/groups.ts";
import { createOrchestrationBackendRegistration } from "./orchestration.ts";
import { createProvidersBackendRegistration, type ProvidersMode } from "./providers.ts";

void AGENT_AWARENESS_BACKEND_ENTRY;
const ISO = "2026-11-09T10:00:00.000Z";
const SONNET = { provider: "anthropic", model: "claude-sonnet-5" };
const context = (args: Record<string, unknown>) => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "i" },
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const made: string[] = [];
afterAll(() => {
  for (const dir of made) NodeFS.rmSync(dir, { recursive: true, force: true });
});
function agentDir(data: unknown): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m09-fork-agent-"));
  made.push(dir);
  NodeFS.chmodSync(dir, 0o700);
  const file = NodePath.join(dir, "auth.json");
  NodeFS.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data), {
    mode: 0o600,
  });
  NodeFS.chmodSync(file, 0o600);
  return dir;
}
const oauth = () => ({
  type: "oauth",
  access: "ACCESS-TOKEN-SYNTHETIC-1",
  refresh: "REFRESH-TOKEN-SYNTHETIC-1",
  expires: 4_102_444_800_000, // 2100-01-01: a fixed far-future expiry, so no refresh is due
  accountId: "ACCOUNT-SYNTHETIC-1",
});

function prepare(providers: ProvidersMode) {
  const result = prepareBackend({
    manifest: backendManifest({ composition: BACKEND_COMPOSITION_ID }),
    composition: BACKEND_COMPOSITION_ID,
    allowlist: BACKEND_ENTRY_ALLOWLIST,
    registrations: [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({
        composition: BACKEND_COMPOSITION_ID,
        providers,
        now: () => Date.parse(ISO),
      }),
      createHumanControlBackendRegistration({}),
      createOrchestrationBackendRegistration({}),
      createGroupsBackendRegistration({}),
      createDeliverablesBackendRegistration({}),
    ],
  });
  if (result.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(result.faults)}`);
  return result.backend;
}
const result = (answer: unknown) => (answer as { result: any }).result;

describe("production mode with an isolated agent directory", () => {
  it("answers from the sign-in store, the meter and the catalog, requests only the fixed endpoints, and drains clean", async () => {
    const dir = agentDir({ anthropic: oauth() });
    const urls: string[] = [];
    const warnings: string[] = [];
    const backend = prepare({
      mode: "production",
      agentDir: dir,
      warn: (line) => warnings.push(line),
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ five_hour: { utilization: 12 } }), { status: 200 });
      },
    });
    expect((await backend.start()).outcome).toBe("started");
    const ops = backend.operations();
    const states = result(
      await ops["providers.route-states"]!(context({ routes: [SONNET], purpose: "launch" })),
    ).states;
    expect(states[0]).toMatchObject({ state: "available", reasonClass: "signed-in-window-ok" });
    expect(states[0]).not.toHaveProperty("label");
    const usage = result(await ops["providers.usage"]!(context({ provider: "anthropic" })));
    expect(usage.readings[0]).toMatchObject({ status: "ok" });
    expect(usage.readings[0].windows[0]).toMatchObject({ id: "five-hour", usedPercent: 12 });
    const caps = result(await ops["providers.route-capabilities"]!(context({ route: SONNET })));
    expect(caps).toMatchObject({ source: "catalog", images: "yes" });
    expect(urls).toEqual(["https://api.anthropic.com/api/oauth/usage"]);
    expect(warnings).toEqual([]);
    expect(await backend.dispose("test")).toMatchObject({ ok: true, stillLive: [], failed: [] });
  });

  it("an agent directory the archive refuses keeps the Backend running, answers unknown, and warns with the reason but not the path", async () => {
    for (const bad of ["relative/secret-dir", "/a/../b/secret-dir"]) {
      const warnings: string[] = [];
      let fetched = 0;
      const backend = prepare({
        mode: "production",
        agentDir: bad,
        warn: (line) => warnings.push(line),
        fetch: async () => {
          fetched += 1;
          return new Response("{}");
        },
      });
      expect((await backend.start()).outcome).toBe("started");
      const states = result(
        await backend.operations()["providers.route-states"]!(
          context({ routes: [SONNET], purpose: "launch" }),
        ),
      ).states;
      expect(states[0]).toMatchObject({ state: "unknown", reasonClass: "service-unavailable" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/invalid-agent-dir/);
      expect(warnings[0]).not.toContain("secret-dir");
      expect(fetched).toBe(0);
      await backend.dispose("test");
    }
  });

  it("a corrupt store is unknown, never no-sign-in, and no warning carries the store's content", async () => {
    const dir = agentDir("{ not json SYNTHETIC-CANARY-CONTENT-123456");
    const warnings: string[] = [];
    const backend = prepare({
      mode: "production",
      agentDir: dir,
      warn: (line) => warnings.push(line),
      fetch: async () => new Response("{}"),
    });
    await backend.start();
    const states = result(
      await backend.operations()["providers.route-states"]!(
        context({ routes: [SONNET], purpose: "launch" }),
      ),
    ).states;
    expect(states[0].state).toBe("unknown");
    expect(states[0].reasonClass).not.toBe("no-sign-in");
    expect(JSON.stringify(warnings)).not.toContain("SYNTHETIC-CANARY-CONTENT");
    await backend.dispose("test");
  });
});
