// AETHERIA — the Backend's own composition and published digest, with the real validator and lifecycle from the pinned archive.
// The digest changes when the composition row, composition identity or artifact stamp changes. Peer comparison is covered by the server tests;
// equality with the pinned build's expected digest by tests/foundations/backend-digest.test.mjs.
import { decodeAetheriaCompositionStatus } from "@t3tools/aetheria-contracts";
import { describe, expect, it } from "vite-plus/test";

import { BACKEND_COMPOSITION_ID, backendManifest } from "./composition.ts";
import { prepareAetheriaBackend } from "./aetheriaBackend.ts";
import { AGENT_AWARENESS_BACKEND_ID, agentAwarenessBackendModuleRow } from "./agentAwareness.ts";
import { humanControlBackendModuleRow } from "./humanControlRow.ts";
import { providersBackendModuleRow } from "./providers.ts";
import { PINNED_ARTIFACT } from "./index.ts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Manifest = ReturnType<typeof backendManifest>;
const digestOf = (manifest: Manifest, stamp?: string) => {
  const result = prepareAetheriaBackend({ manifest });
  if (result.outcome !== "prepared") return { refused: result.faults.map((f) => f.code) };
  void stamp;
  return { digest: result.backend.status().digest.value };
};

describe("the Backend composition", () => {
  it("is a root composition of its own selecting only the Backend agent-awareness and providers modules", () => {
    const manifest = backendManifest();
    expect(manifest.compositions).toEqual([
      expect.objectContaining({
        id: BACKEND_COMPOSITION_ID,
        modules: [AGENT_AWARENESS_BACKEND_ID, "providers-backend", "human-control-backend"],
      }),
    ]);
    expect(manifest.compositions[0]).not.toHaveProperty("extends");
    expect(manifest.modules).toEqual([
      agentAwarenessBackendModuleRow(),
      providersBackendModuleRow(),
      humanControlBackendModuleRow(),
    ]);
    expect(BACKEND_COMPOSITION_ID).toBe("aetheria-backend");
  });

  it("is validated for host backend by the shared validator and publishes its digest in the safe status", async () => {
    const result = prepareAetheriaBackend();
    expect(result.outcome).toBe("prepared");
    if (result.outcome !== "prepared") return;
    const status = decodeAetheriaCompositionStatus(
      JSON.parse(JSON.stringify(result.backend.status())),
    );
    expect(status).toMatchObject({
      composition: "aetheria-backend",
      host: "backend",
      phase: "prepared",
      digest: { version: 1, algorithm: "sha256" },
    });
    expect(status.artifact.stamp).toBe(PINNED_ARTIFACT.stamp);
    expect((await result.backend.start()).outcome).toBe("started");
    expect(result.backend.status().digest).toEqual(status.digest);
    await result.backend.dispose("test");
  });

  it("gives the same digest for the same build, every time", () => {
    expect(digestOf(backendManifest())).toEqual(digestOf(backendManifest()));
  });
});

describe("combinations that must not share a digest or must refuse", () => {
  const base = digestOf(backendManifest());

  it("changes the digest when the module row's contract, ownership, entry-independent fields or the composition identity change", () => {
    const edits: Record<string, (m: Manifest) => void> = {
      contract: (m) =>
        void ((m.modules[0] as { contract: { success: string } }).contract.success = "changed"),
      required: (m) => void ((m.modules[0] as { required: boolean }).required = false),
      identity: (m) =>
        void ((m.compositions[0] as { identity: { description: string } }).identity.description =
          "changed"),
      order: (m) =>
        void ((m.compositions[0] as { identity: { order: number } }).identity.order = 9),
    };
    for (const [name, edit] of Object.entries(edits)) {
      const changed = clone(backendManifest());
      edit(changed);
      const result = digestOf(changed);
      expect(result.digest, name).toBeDefined();
      expect(result.digest, name).not.toBe(base.digest);
    }
  });

  it("refuses a stale manifest row (the artifact stamp it declares is not the archive this build carries)", () => {
    const stale = clone(backendManifest());
    (
      stale.modules[0] as { compat: { artifacts: Record<string, { stamp: string }> } }
    ).compat.artifacts[PINNED_ARTIFACT.package] = { stamp: `sha256:${"1".repeat(64)}` };
    expect(digestOf(stale)).toEqual({ refused: ["stale-stamp"] });
  });

  it("refuses an entry that is not on the build-time allowlist, and a composition selecting an unregistered module", () => {
    const entry = clone(backendManifest());
    (entry.modules[0] as { entry: string }).entry = "aetheria:something-else";
    expect(digestOf(entry).refused).toContain("entry-not-allowlisted");
    const extra = clone(backendManifest());
    (extra.modules as unknown[]).push({
      ...agentAwarenessBackendModuleRow(),
      id: "second",
      entry: "aetheria:agent-awareness-backend",
    });
    (extra.compositions[0] as { modules: string[] }).modules.push("second");
    expect(digestOf(extra).refused).toBeDefined();
  });

  it("refuses a manifest that selects an Agent module on the Backend host", () => {
    const agent = clone(backendManifest());
    (agent.modules[0] as { host: string }).host = "agent";
    expect(digestOf(agent).refused).toContain("host-not-hosted");
  });
});
