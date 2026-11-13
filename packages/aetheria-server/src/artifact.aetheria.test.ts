// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M04 Plan step 12 — the pinned library artifact and the Backend `agent-awareness` module.
//
// Boundary: the archive file on disk and the manifest that declares it; the Backend entry as installed (the real archive); this
// package's own sources. Shows: the declared stamp is the archive's actual SHA-256; the sidecar agrees; the package imports the
// artifact through its Backend entry only, with no outer-source path; the shared validator accepts the Backend module's row.
// Does not show: pnpm's lock integrity (the graphs check reads that), or the archive imported with the outer source unavailable
// (a separate scratch run in the step's report).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import * as backendEntry from "@aetheria/awareness/backend";

import { prepareBackend } from "./adapter.ts";
import {
  AGENT_AWARENESS_BACKEND_ENTRY,
  AGENT_AWARENESS_BACKEND_ID,
  agentAwarenessBackendModuleRow,
  createAgentAwarenessBackendRegistration,
} from "./agentAwareness.ts";
import { PINNED_ARTIFACT } from "./artifact.ts";
import { BACKEND_ENTRY_ALLOWLIST } from "./composition.ts";
import {
  EVIDENCE_LIBRARY_EXPORTS,
  INTERACTION_LIBRARY_EXPORTS,
  LIBRARY_EXPORTS,
  ORCHESTRATION_LIBRARY_EXPORTS,
  PROVIDERS_LIBRARY_EXPORTS,
} from "./library.ts";
import * as evidenceEntry from "@aetheria/evidence/backend";
import * as interactionEntry from "@aetheria/interaction/backend";
import * as orchestrationEntry from "@aetheria/orchestration/backend";
import * as providersEntry from "@aetheria/providers/backend";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const pkgDir = NodePath.join(here, "..");
const manifest = JSON.parse(
  NodeFS.readFileSync(NodePath.join(pkgDir, "package.json"), "utf8"),
) as Record<string, any>;
const sources = NodeFS.readdirSync(here).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
);

describe("the pinned archive", () => {
  const declared = manifest.aetheriaArtifacts["@aetheria/awareness"];
  const archive = NodeFS.readFileSync(NodePath.join(pkgDir, declared.archive));

  it("is declared exactly as the outer graphs check requires", () => {
    expect(manifest.dependencies["@aetheria/awareness"]).toBe(
      "file:./artifacts/aetheria-awareness-0.1.0.tgz",
    );
    // M09 A15: awareness and the pinned providers archive (checked in providers.aetheria.test.ts); M06 adds the interaction archive.
    expect(Object.keys(manifest.aetheriaArtifacts).sort()).toEqual([
      "@aetheria/awareness",
      "@aetheria/evidence",
      "@aetheria/interaction",
      "@aetheria/orchestration",
      "@aetheria/providers",
    ]);
    // M05 step 9: the fifth archive is a dependency by file and declared with the same three fields.
    expect(manifest.dependencies["@aetheria/orchestration"]).toBe(
      "file:./artifacts/aetheria-orchestration-0.1.0.tgz",
    );
    expect(manifest.aetheriaArtifacts["@aetheria/orchestration"]).toMatchObject({
      archive: "artifacts/aetheria-orchestration-0.1.0.tgz",
      version: "0.1.0",
    });
    expect(Object.keys(declared).sort()).toEqual(["archive", "stamp", "version"]);
    expect(declared).toMatchObject({
      archive: "artifacts/aetheria-awareness-0.1.0.tgz",
      version: "0.1.0",
    });
    expect(declared.stamp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("has the declared stamp as its independently computed SHA-256, and the sidecar record agrees", () => {
    const computed = `sha256:${NodeCrypto.createHash("sha256").update(archive).digest("hex")}`;
    expect(declared.stamp).toBe(computed);
    const sidecar = JSON.parse(
      NodeFS.readFileSync(NodePath.join(pkgDir, "artifacts/aetheria-awareness.stamp.json"), "utf8"),
    );
    expect(sidecar).toEqual({
      schema: 1,
      package: "@aetheria/awareness",
      version: "0.1.0",
      archive: "aetheria-awareness-0.1.0.tgz",
      sha256: computed.slice("sha256:".length),
      stamp: computed,
    });
    expect(PINNED_ARTIFACT).toEqual({
      package: "@aetheria/awareness",
      version: "0.1.0",
      stamp: computed,
    });
  });
});

describe("the artifact boundary", () => {
  it("is reached through the Backend entry only, from the library module only, with no outer-source path", () => {
    const specifierPattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
    for (const file of sources) {
      const text = NodeFS.readFileSync(NodePath.join(here, file), "utf8");
      const specifiers = [...text.matchAll(specifierPattern)].map((m) => m[1]!);
      for (const specifier of specifiers) {
        if (specifier.startsWith("@aetheria/")) {
          // Two accepted archives (M09 A15), each through its Backend entry, both from the one library module.
          expect(file).toBe("library.ts");
          expect([
            "@aetheria/awareness/backend",
            "@aetheria/providers/backend",
            "@aetheria/interaction/backend",
            "@aetheria/evidence/backend",
            "@aetheria/orchestration/backend",
          ]).toContain(specifier);
        }
        expect(specifier).not.toMatch(/packages\/aetheria-|apps\/aetheria|(\.\.\/){3,}/);
      }
    }
  });

  it("finds every name the adapter re-exports on the real archive's Backend entry", () => {
    for (const name of LIBRARY_EXPORTS)
      expect(typeof (backendEntry as Record<string, unknown>)[name]).toBe("function");
    expect(backendEntry.DIGEST_VERSION).toBe(1);
  });

  it("finds every name the providers module re-exports on the real providers archive's Backend entry", () => {
    for (const name of INTERACTION_LIBRARY_EXPORTS)
      expect(typeof (interactionEntry as Record<string, unknown>)[name], name).toBe("function");
    for (const name of EVIDENCE_LIBRARY_EXPORTS)
      expect(typeof (evidenceEntry as Record<string, unknown>)[name], name).toBe("function");
    for (const name of PROVIDERS_LIBRARY_EXPORTS)
      expect(typeof (providersEntry as Record<string, unknown>)[name]).toBe("function");
    expect(providersEntry.PROVIDERS_BACKEND_ENTRY).toBe("@aetheria/providers/backend");
  });

  it("finds every name the orchestration module takes on the real orchestration archive's Backend entry", () => {
    for (const name of ORCHESTRATION_LIBRARY_EXPORTS)
      expect(typeof (orchestrationEntry as Record<string, unknown>)[name], name).toBe("function");
    expect(orchestrationEntry.MANAGED_WORK_BACKEND_ENTRY).toBe("aetheria:orchestration-backend");
  });

  it("does not export the Agent host adapters or any identity writer through the Backend entry", () => {
    const names = Object.keys(backendEntry);
    for (const forbidden of [
      "createIdentityStore",
      "createResourceRegistrations",
      "createPiHost",
      "installPiExtension",
    ])
      expect(names).not.toContain(forbidden);
  });
});

describe("the Backend agent-awareness module", () => {
  const selection = {
    schema: 1,
    modules: [agentAwarenessBackendModuleRow()],
    compositions: [
      {
        id: "backend",
        identity: { name: "Backend", description: "test", order: 0 },
        modules: [AGENT_AWARENESS_BACKEND_ID],
      },
    ],
  };

  it("is on the build-time allowlist under its own entry, and the allowlist holds only the Backend modules' entries", () => {
    expect(BACKEND_ENTRY_ALLOWLIST).toEqual([
      AGENT_AWARENESS_BACKEND_ENTRY,
      "aetheria:providers-backend",
      "aetheria:human-control-backend",
      "aetheria:orchestration-backend",
      "aetheria:groups-backend",
      "aetheria:deliverables-backend",
    ]);
    expect(Object.isFrozen(BACKEND_ENTRY_ALLOWLIST)).toBe(true);
    expect(agentAwarenessBackendModuleRow()).toMatchObject({
      id: "agent-awareness-backend",
      host: "backend",
      entry: "aetheria:agent-awareness-backend",
      mutatesToolInput: false,
    });
  });

  it("is accepted by the shared validator, started, and drained with nothing left live", async () => {
    const result = prepareBackend({
      manifest: selection,
      composition: "backend",
      allowlist: BACKEND_ENTRY_ALLOWLIST,
      registrations: [createAgentAwarenessBackendRegistration()],
    });
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") return;
    expect((await result.backend.start()).outcome).toBe("started");
    const report = await result.backend.dispose("test");
    expect(report).toMatchObject({
      ok: true,
      order: [AGENT_AWARENESS_BACKEND_ID],
      stillLive: [],
      failed: [],
      unobserved: [],
    });
  });

  it("registers operations through the seam and keeps them unavailable once disposed", async () => {
    const op = () => ({ status: "done", result: 1 }) as const;
    const result = prepareBackend({
      manifest: selection,
      composition: "backend",
      allowlist: BACKEND_ENTRY_ALLOWLIST,
      registrations: [
        createAgentAwarenessBackendRegistration({ operations: { "awareness.ping": op } }),
      ],
    });
    if (result.outcome !== "prepared") throw new Error("prepared expected");
    expect(Object.keys(result.backend.operations())).toEqual(["awareness.ping"]);
    await result.backend.dispose("never started");
    const answer = await result.backend.operations()["awareness.ping"]!({
      caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "i" },
      sessionId: "s",
      kind: "main",
      rootSessionId: "s",
      args: {},
    });
    expect(answer).toEqual({ status: "unavailable", code: "XC6_BACKEND_NOT_RUNNING" });
  });

  it("is refused when its row declares a stamp other than the one this build carries", () => {
    const stale = {
      ...selection,
      modules: [agentAwarenessBackendModuleRow({ stamp: `sha256:${"1".repeat(64)}` })],
    };
    const result = prepareBackend({
      manifest: stale,
      composition: "backend",
      allowlist: BACKEND_ENTRY_ALLOWLIST,
      registrations: [createAgentAwarenessBackendRegistration()],
    });
    expect(result.outcome === "refused" && result.faults.map((f) => f.code)).toEqual([
      "stale-stamp",
    ]);
  });
});
