// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M09 Plan step 4 — the Backend `providers` module: the second pinned archive, its manifest row and allowlist entry, and the registration
// that serves the four `providers.*` XC-6 operations over the real archive.
//
// Boundary: the real installed `@aetheria/providers/backend` archive and the real shared validator and lifecycle driver, through this package's
// adapter. It shows: the second archive is declared and stamped as the outer graphs check requires; the module is on the allowlist under its own
// entry; production answers honestly unknown / service-unavailable and never carries the fixture label; arguments outside the strict contract
// throw before the service runs; the module drains once; the fixture refuses a production composition at activation. It does NOT show the
// authenticated XC-6 route, the digest gates or the server layer (apps/server tests), nor any real credential or usage adapter (step 6 onwards).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { prepareBackend } from "./adapter.ts";
import { PROVIDERS_PINNED_ARTIFACT } from "./artifact.ts";
import { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
import {
  AGENT_AWARENESS_BACKEND_ENTRY,
  createAgentAwarenessBackendRegistration,
} from "./agentAwareness.ts";
import {
  HUMAN_CONTROL_BACKEND_ENTRY,
  createHumanControlBackendRegistration,
} from "./humanControl.ts";
import {
  PROVIDERS_BACKEND_ENTRY,
  PROVIDERS_BACKEND_ID,
  createProvidersBackendRegistration,
  providersBackendModuleRow,
} from "./providers.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const pkgDir = NodePath.join(here, "..");
const manifest = JSON.parse(
  NodeFS.readFileSync(NodePath.join(pkgDir, "package.json"), "utf8"),
) as Record<string, any>;

const ROUTE = { provider: "anthropic", model: "claude-sonnet-x" };
const ISO = "2026-11-09T10:00:00.000Z";
const context = (args: Record<string, unknown>) => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "i" },
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const SCRIPTED_ID = "aetheria-backend-scripted";

function prepare(
  composition: string,
  providers: Parameters<typeof createProvidersBackendRegistration>[0]["providers"],
) {
  const result = prepareBackend({
    manifest: backendManifest({ composition }),
    composition,
    allowlist: BACKEND_ENTRY_ALLOWLIST,
    registrations: [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({
        composition,
        ...(providers === undefined ? {} : { providers }),
        now: () => Date.parse(ISO),
      }),
      createHumanControlBackendRegistration({}),
    ],
  });
  if (result.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(result.faults)}`);
  return result.backend;
}

describe("the second pinned archive", () => {
  const declared = manifest.aetheriaArtifacts["@aetheria/providers"];

  it("is declared exactly as the outer graphs check requires, beside awareness", () => {
    expect(manifest.dependencies["@aetheria/providers"]).toBe(
      "file:./artifacts/aetheria-providers-0.1.0.tgz",
    );
    // M06 adds the interaction archive (its own declaration is checked in humanControl.aetheria.test.ts) and the evidence archive (step 22/23).
    expect(Object.keys(manifest.aetheriaArtifacts).sort()).toEqual([
      "@aetheria/awareness",
      "@aetheria/evidence",
      "@aetheria/interaction",
      "@aetheria/providers",
    ]);
    expect(Object.keys(declared).sort()).toEqual(["archive", "stamp", "version"]);
    expect(declared).toMatchObject({
      archive: "artifacts/aetheria-providers-0.1.0.tgz",
      version: "0.1.0",
    });
  });

  it("has the declared stamp as its independently computed SHA-256, the sidecar agrees, and the build reads it", () => {
    const archive = NodeFS.readFileSync(NodePath.join(pkgDir, declared.archive));
    const computed = `sha256:${NodeCrypto.createHash("sha256").update(archive).digest("hex")}`;
    expect(declared.stamp).toBe(computed);
    const sidecar = JSON.parse(
      NodeFS.readFileSync(NodePath.join(pkgDir, "artifacts/aetheria-providers.stamp.json"), "utf8"),
    );
    expect(sidecar).toMatchObject({
      package: "@aetheria/providers",
      version: "0.1.0",
      stamp: computed,
    });
    expect(PROVIDERS_PINNED_ARTIFACT).toEqual({
      package: "@aetheria/providers",
      version: "0.1.0",
      stamp: computed,
    });
  });
});

describe("the providers module's descriptor", () => {
  it("is on the build-time allowlist under its own entry, beside awareness and human control only", () => {
    expect(BACKEND_ENTRY_ALLOWLIST).toEqual([
      AGENT_AWARENESS_BACKEND_ENTRY,
      PROVIDERS_BACKEND_ENTRY,
      HUMAN_CONTROL_BACKEND_ENTRY,
    ]);
    expect(Object.isFrozen(BACKEND_ENTRY_ALLOWLIST)).toBe(true);
    expect(PROVIDERS_BACKEND_ENTRY).toBe("aetheria:providers-backend");
  });

  it("owns its own state and names the archive stamp this build carries", () => {
    const row = providersBackendModuleRow() as Record<string, any>;
    expect(row).toMatchObject({
      id: "providers-backend",
      host: "backend",
      entry: "aetheria:providers-backend",
      required: true,
      mutatesToolInput: false,
      owns: ["backend-providers-state"],
    });
    expect(row.contract.stateOwner).toBe("backend-providers-state");
    expect(row.compat.artifacts).toEqual({
      "@aetheria/providers": { stamp: PROVIDERS_PINNED_ARTIFACT.stamp },
    });
    expect(PROVIDERS_BACKEND_ID).toBe("providers-backend");
  });

  it("is part of the production composition beside awareness, which still has no providers-specific row of its own", () => {
    const m = backendManifest();
    expect(m.modules.map((x: any) => x.id)).toEqual([
      "agent-awareness-backend",
      "providers-backend",
      "human-control-backend",
    ]);
    expect(m.compositions[0]?.modules).toEqual([
      "agent-awareness-backend",
      "providers-backend",
      "human-control-backend",
    ]);
    expect(m.compositions[0]?.id).toBe(BACKEND_COMPOSITION_ID);
  });

  it("is refused when its row declares a stamp other than the one this build carries", () => {
    const stale = backendManifest();
    (stale.modules[1] as any).compat.artifacts["@aetheria/providers"].stamp =
      `sha256:${"1".repeat(64)}`;
    const result = prepareBackend({
      manifest: stale,
      composition: BACKEND_COMPOSITION_ID,
      allowlist: BACKEND_ENTRY_ALLOWLIST,
      registrations: [
        createAgentAwarenessBackendRegistration(),
        createProvidersBackendRegistration({ composition: BACKEND_COMPOSITION_ID }),
        createHumanControlBackendRegistration({}),
      ],
    });
    expect(result.outcome === "refused" && result.faults.map((f) => f.code)).toEqual([
      "stale-stamp",
    ]);
  });
});

describe("production mode over the real archive", () => {
  it("serves nine gated operations (four providers, three research, two attachments), unavailable until the Backend runs and again after it drained", async () => {
    const backend = prepare(BACKEND_COMPOSITION_ID, undefined);
    // The seven human-control operations (M06) are the other module's; this module owns the nine below.
    const names = Object.keys(backend.operations())
      .filter((name) => /^(providers|research|attachments)\./.test(name))
      .sort();
    expect(names).toEqual([
      "attachments.describe-snapshot",
      "attachments.store-snapshot",
      "providers.report-failure",
      "providers.route-capabilities",
      "providers.route-states",
      "providers.usage",
      "research.cancel",
      "research.fetch",
      "research.search",
    ]);
    const call = backend.operations()["providers.route-states"]!;
    const args = { routes: [ROUTE], purpose: "launch" };
    expect(await call(context(args))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
    expect((await backend.start()).outcome).toBe("started");
    expect(await call(context(args))).toMatchObject({ status: "done" });
    await backend.dispose("test");
    expect(await call(context(args))).toEqual({
      status: "unavailable",
      code: "XC6_BACKEND_NOT_RUNNING",
    });
  });

  it("answers unknown / service-unavailable for every purpose, with no fixture label and no usage data", async () => {
    const backend = prepare(BACKEND_COMPOSITION_ID, undefined);
    await backend.start();
    const ops = backend.operations();
    for (const purpose of ["launch", "switch", "display"]) {
      const answer = await ops["providers.route-states"]!(context({ routes: [ROUTE], purpose }));
      const { states } = (answer as { result: { states: Record<string, any>[] } }).result;
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({
        state: "unknown",
        reasonClass: "service-unavailable",
        observedAt: ISO,
      });
      // The basis says what was and was not read: the credential was never read, and nothing positive is claimed.
      expect(states[0]!.basis).toContainEqual({
        signal: "credential",
        result: "not-read",
        at: ISO,
      });
      expect(states[0]).not.toHaveProperty("label");
    }
    const caps = (await ops["providers.route-capabilities"]!(context({ route: ROUTE }))) as {
      result: Record<string, unknown>;
    };
    expect(caps.result).toMatchObject({ images: "unknown", source: "none" });
    const usage = (await ops["providers.usage"]!(context({}))) as {
      result: { readings: unknown[] };
    };
    expect(JSON.stringify(usage)).not.toContain("fixture");
    await backend.dispose("test");
  });

  it("throws before the service runs for an extra field, a caller id or a malformed value, and leaves later answers unchanged", async () => {
    const backend = prepare(BACKEND_COMPOSITION_ID, undefined);
    await backend.start();
    const ops = backend.operations();
    const bad: [string, Record<string, unknown>][] = [
      ["providers.route-states", { routes: [ROUTE], purpose: "launch", sessionId: "s" }],
      ["providers.route-states", { routes: [ROUTE], purpose: "fallback" }],
      [
        "providers.report-failure",
        { route: ROUTE, failure: {}, authorization: "Bearer secret-value" },
      ],
      ["providers.route-capabilities", { route: ROUTE, token: "secret-value" }],
      ["providers.usage", { provider: "" }],
      ["providers.usage", { refresh: true }],
    ];
    for (const [op, args] of bad)
      await expect(ops[op]!(context(args)), JSON.stringify(args)).rejects.toThrow(
        /PROVIDERS_ARGUMENTS_REFUSED/,
      );
    for (const [op, args] of bad)
      await Promise.resolve(ops[op]!(context(args))).catch((error: Error) =>
        expect(error.message).not.toContain("secret-value"),
      );
    // Nothing was remembered by the refused report-failure: the route is still answered as production answers it.
    const after = await ops["providers.route-states"]!(
      context({ routes: [ROUTE], purpose: "launch" }),
    );
    expect(JSON.stringify(after)).toContain("service-unavailable");
    await backend.dispose("test");
  });

  it("drains once and reports what it released, nothing left live", async () => {
    const backend = prepare(BACKEND_COMPOSITION_ID, undefined);
    await backend.start();
    const report = await backend.dispose("test");
    expect(report).toMatchObject({ ok: true, stillLive: [], failed: [], unobserved: [] });
    expect(report.order).toEqual([
      "human-control-backend",
      "providers-backend",
      "agent-awareness-backend",
    ]);
    expect(await backend.dispose("again")).toEqual(report);
  });
});

describe("fixture mode", () => {
  const script = {
    states: () => ({ state: "available", reasonClass: "signed-in-window-ok" }) as const,
  };

  it("serves labelled scripted answers in a scripted composition and never in the production one", async () => {
    const backend = prepare(SCRIPTED_ID, { mode: "fixture", script });
    expect((await backend.start()).outcome).toBe("started");
    const answer = (await backend.operations()["providers.route-states"]!(
      context({ routes: [ROUTE], purpose: "launch" }),
    )) as {
      result: { states: Record<string, unknown>[] };
    };
    expect(answer.result.states[0]).toMatchObject({
      state: "available",
      reasonClass: "signed-in-window-ok",
      label: "fixture",
    });
    await backend.dispose("test");
  });

  it("refuses to start in the production composition, so nothing is served", async () => {
    const backend = prepare(BACKEND_COMPOSITION_ID, { mode: "fixture", script });
    const started = await backend.start();
    expect(started.outcome).not.toBe("started");
    const answer = await backend.operations()["providers.route-states"]!(
      context({ routes: [ROUTE], purpose: "launch" }),
    );
    expect(answer).toEqual({ status: "unavailable", code: "XC6_BACKEND_NOT_RUNNING" });
    await backend.dispose("test");
  });
});
