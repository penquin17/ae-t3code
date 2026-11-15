// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M11 Plan steps 9–10 (C4 K6; D1–D4, D11, D12) — the `modules`, `compositions` and `config` providers against their real owners.
//
// Boundary: the real production Backend manifest (`backendManifest()`) and the real Backend adapter's live `status()` — prepared, started and disposed — read through the real inspection service and
// registration, with the real core join and projector from the installed `@aetheria/inspect` archive; only the caller check is scripted. It shows: the modules listed are exactly the manifest's, with
// no second list; each state is the core's translation of the adapter's own lifecycle (registered, running, disposed, and failed or skipped through a scripted status); a manifest module the status does
// not list is `absent`, an unreadable status or manifest is `unsupported`, never absent; the composition's digest stays the host's with its source named and equals the adapter's; inspection off reads
// the inspect module `inactive`/disabled and no other module changes; a replaced source (a different manifest) is followed with no residue; and the config provider offers the real exact XC-4 fields
// while the projector shows a value only for a listed non-secret pair. It does NOT show real Backend module behavior, the XC-6 wire, or an Agent-host status (step 13's).
import { describe, expect, it } from "vite-plus/test";

import type { AetheriaCompositionStatus } from "@t3tools/aetheria-contracts";
import { createAgentAwarenessBackendRegistration } from "../agentAwareness.ts";
import { prepareAetheriaBackend } from "../aetheriaBackend.ts";
import { backendManifest } from "../composition.ts";
import { BACKEND_COMPOSITION_ID } from "../compositionId.ts";
import { createDeliverablesBackendRegistration } from "../deliverables/deliverables.ts";
import { createGoalsBackendRegistration } from "../goals/registration.ts";
import { createGroupsBackendRegistration } from "../groups/groups.ts";
import { createWorkflowsBackendRegistration } from "../workflows/registration.ts";
import { createHumanControlBackendRegistration } from "../humanControl.ts";
import { createOrchestrationBackendRegistration } from "../orchestration.ts";
import { createProvidersBackendRegistration } from "../providers.ts";
import { INSPECT_BACKEND_ID } from "./inspectRow.ts";
import {
  createInspectBackendRegistration,
  type InspectBackendOptions,
} from "./inspectRegistration.ts";
import type { InspectSettled } from "./service.ts";

const ctx = (args: Record<string, unknown>) => ({
  caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "pi" },
  sessionId: "s",
  kind: "main",
  rootSessionId: "s",
  args,
});
const result = (settled: InspectSettled) => (settled as { result: Record<string, any> }).result;

/** The production Backend with the real inspect registration over the real manifest and the adapter's own status. */
function world(over: Partial<InspectBackendOptions> = {}) {
  let status: (() => AetheriaCompositionStatus) | undefined;
  const registration = createInspectBackendRegistration({
    access: { check: async () => ({ ok: true }) },
    enablement: { enabled: true },
    sources: {
      manifest: () => backendManifest(),
      status: () => (status as () => AetheriaCompositionStatus)(),
    },
    ...over,
  });
  // The other six production registrations, unconfigured exactly as `prepareAetheriaBackend` defaults them.
  const prepared = prepareAetheriaBackend({
    registrations: [
      createAgentAwarenessBackendRegistration(),
      createProvidersBackendRegistration({ composition: BACKEND_COMPOSITION_ID }),
      createHumanControlBackendRegistration({}),
      createOrchestrationBackendRegistration({}),
      createGoalsBackendRegistration(),
      createWorkflowsBackendRegistration({}),
      createGroupsBackendRegistration({}),
      createDeliverablesBackendRegistration({}),
      registration,
    ],
  });
  if (prepared.outcome !== "prepared") throw new Error("the Backend did not prepare");
  status = () => prepared.backend.status();
  return { backend: prepared.backend, registration, serve: registration.service.serve };
}

const manifestIds = () =>
  backendManifest()
    .modules.map((m) => m.id)
    .sort();

describe("the modules provider over the real manifest and the real Backend status", () => {
  it("lists exactly the manifest's modules in id order, each in the core's translation of the adapter's lifecycle", async () => {
    const { backend, serve } = world();
    const before = result(await serve("inspect.list", ctx({ providerId: "modules" })));
    expect(before.entries.map((e: any) => e.targetId)).toEqual(manifestIds());
    expect(new Set(before.entries.map((e: any) => `${e.state}`))).toEqual(new Set(["inactive"]));
    expect(before.entries[0].summary).toContain("registered");
    await backend.start();
    const running = result(await serve("inspect.list", ctx({ providerId: "modules" })));
    expect(running.total).toBe(manifestIds().length);
    for (const entry of running.entries) {
      expect(entry).toMatchObject({
        providerId: "modules",
        kind: "module",
        host: "backend",
        state: "active",
      });
    }
    await backend.dispose("test over");
    // The drained service answers unavailable and its registry is disposed; the lifecycle the provider would have read is the adapter's own.
    expect(await serve("inspect.list", ctx({ providerId: "modules" }))).toEqual({
      status: "unavailable",
      code: "INSPECT_UNAVAILABLE",
    });
    expect(backend.status().modules.every((m) => m.state === "disposed")).toBe(true);
  });

  it("describes one module's declared row apart from its observed state, with the host's digest and no per-module digest", async () => {
    const { backend, serve } = world();
    await backend.start();
    const answer = result(
      await serve("inspect.query", ctx({ providerId: "modules", targetId: INSPECT_BACKEND_ID })),
    );
    expect(answer).toMatchObject({ outcome: "ok", state: "active" });
    const shape = answer.shape;
    expect(shape).toMatchObject({ id: INSPECT_BACKEND_ID, host: "backend", required: true });
    expect(shape.declared.services).toContain("inspect.config");
    expect(shape.declared.owns).toEqual(["backend-inspect-state"]);
    expect(shape.observed).toEqual({ state: "active", reason: null });
    expect(shape.provenance).toEqual({
      declared: "manifest",
      observed: "host-status",
      hostDigest: { host: "backend", ...backend.status().digest },
    });
    expect(JSON.stringify(shape)).not.toContain('"digest"');
    expect(
      result(
        await serve("inspect.query", ctx({ providerId: "modules", targetId: "no-such-module" })),
      ),
    ).toMatchObject({ outcome: "unavailable" });
  });

  it("follows a replaced manifest with no residue: a module the status does not list is absent, never invented as active", async () => {
    const extra = { ...(backendManifest().modules[0] as object), id: "ghost" };
    const { backend, serve } = world({
      sources: {
        manifest: () => ({ ...backendManifest(), modules: [...backendManifest().modules, extra] }),
        status: () => backend.status(),
      },
    });
    await backend.start();
    const listed = result(await serve("inspect.list", ctx({ providerId: "modules" })));
    expect(listed.entries.find((e: any) => e.targetId === "ghost")).toMatchObject({
      state: "absent",
    });
    expect(listed.entries.find((e: any) => e.targetId === INSPECT_BACKEND_ID)).toMatchObject({
      state: "active",
    });
  });

  it("translates failed and skipped to failed with the lifecycle as the reason, from a scripted status", async () => {
    const real = world();
    await real.backend.start();
    const base = real.backend.status();
    const scripted = (state: string): AetheriaCompositionStatus => ({
      ...base,
      modules: base.modules.map((m, i) => ({ ...m, state: (i === 0 ? state : m.state) as never })),
    });
    for (const [state, expected] of [
      ["failed", "failed"],
      ["skipped", "failed"],
      ["starting", "inactive"],
      ["registered", "inactive"],
    ] as const) {
      const { serve } = world({
        sources: { manifest: () => backendManifest(), status: () => scripted(state) },
      });
      const listed = result(await serve("inspect.list", ctx({ providerId: "modules" })));
      const first = listed.entries.find((e: any) => e.targetId === base.modules[0]?.id);
      expect(first, state).toMatchObject({ state: expected });
      expect(first.summary).toContain(state);
    }
  });

  it("reads an unreadable status or manifest as unsupported, never absent and never empty-active", async () => {
    const noStatus = world({
      sources: {
        manifest: () => backendManifest(),
        status: () => {
          throw new Error("canary-status-failure");
        },
      },
    });
    const listed = result(await noStatus.serve("inspect.list", ctx({ providerId: "modules" })));
    expect(new Set(listed.entries.map((e: any) => e.state))).toEqual(new Set(["unsupported"]));
    expect(JSON.stringify(listed)).not.toContain("canary");
    const noManifest = world({
      sources: {
        manifest: () => {
          throw new Error("canary-manifest-failure");
        },
        status: () => noStatus.backend.status(),
      },
    });
    const entries = result(
      await noManifest.serve("inspect.list", ctx({ providerId: "modules" })),
    ).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: "unsupported", kind: "status" });
    expect(JSON.stringify(entries)).not.toContain("canary");
  });

  it("with inspection off, the inspect module reads inactive and disabled and no other module changes; the raw lifecycle is untouched", async () => {
    const { backend, registration } = world({ enablement: { enabled: false } });
    await backend.start();
    expect(backend.status().modules.find((m) => m.id === INSPECT_BACKEND_ID)?.state).toBe(
      "running",
    );
    // The service answers unavailable when off, so the enumeration is read through the registry's own handle, as an operator-side enumeration would.
    const handle = registration.registry.get("modules");
    const answer = (await handle?.list({ offset: 0, limit: 100 })) as {
      data: { entries: Array<{ targetId: string; state: string; summary: string }> };
    };
    const inspect = answer.data.entries.find((e) => e.targetId === INSPECT_BACKEND_ID);
    expect(inspect).toMatchObject({ state: "inactive" });
    expect(inspect?.summary).toContain("disabled");
    for (const other of answer.data.entries.filter((e) => e.targetId !== INSPECT_BACKEND_ID))
      expect(other.state).toBe("active");
  });
});

describe("the compositions provider", () => {
  it("lists the Backend composition and shows the adapter's own digest, phase and modules with their sources named", async () => {
    const { backend, serve } = world();
    await backend.start();
    const listed = result(await serve("inspect.list", ctx({ providerId: "compositions" })));
    expect(listed.entries).toEqual([
      expect.objectContaining({
        targetId: backend.status().composition,
        kind: "composition",
        state: "active",
      }),
    ]);
    const answer = result(
      await serve(
        "inspect.query",
        ctx({ providerId: "compositions", targetId: backend.status().composition }),
      ),
    );
    expect(answer.shape.provenance.hostDigest).toMatchObject({
      host: "backend",
      ...backend.status().digest,
    });
    expect(answer.shape.observed.phase).toBe("running");
    expect(answer.shape.observed.modules).toHaveLength(manifestIds().length);
    expect(answer.shape.declared.modules.sort()).toEqual(manifestIds());
    expect(JSON.stringify(answer.shape)).not.toMatch(/\/Users|failure|secret/i);
  });

  it("reads unsupported when the status cannot be read, and a declared composition the status is not is absent", async () => {
    const { serve, backend } = world({
      sources: {
        manifest: () => backendManifest({ composition: "other-composition" }),
        status: () => undefined as never,
      },
    });
    await backend.start();
    expect(
      result(await serve("inspect.list", ctx({ providerId: "compositions" }))).entries[0],
    ).toMatchObject({ targetId: "other-composition", state: "unsupported" });
    const live = world({
      sources: {
        manifest: () => backendManifest({ composition: "other-composition" }),
        status: () => live.backend.status(),
      },
    });
    await live.backend.start();
    expect(
      result(await live.serve("inspect.list", ctx({ providerId: "compositions" }))).entries[0],
    ).toMatchObject({ targetId: "other-composition", state: "absent" });
  });
});

describe("the config provider over the real rows", () => {
  it("lists the modules that declare fields and offers the exact XC-4 fields; the default shows no value", async () => {
    const { backend, serve } = world();
    await backend.start();
    const listed = result(await serve("inspect.list", ctx({ providerId: "config" })));
    expect(listed.entries.map((e: any) => e.targetId)).toContain(INSPECT_BACKEND_ID);
    const answer = result(
      await serve("inspect.query", ctx({ providerId: "config", targetId: INSPECT_BACKEND_ID })),
    );
    expect(answer.shape).toEqual({
      module: INSPECT_BACKEND_ID,
      fields: [{ name: "showValues", type: "string-list", required: false, secret: false }],
    });
    expect(answer.values).toEqual({});
    expect(answer.omitted).toEqual([{ path: "showValues", reason: "not-allowed" }]);
  });

  it("shows the declared value only when the deployment lists that module.field pair", async () => {
    const { backend, serve } = world({ showValues: [`${INSPECT_BACKEND_ID}.showValues`] });
    await backend.start();
    const answer = result(
      await serve("inspect.query", ctx({ providerId: "config", targetId: INSPECT_BACKEND_ID })),
    );
    expect(answer.values).toEqual({ showValues: [] });
    expect(answer.omitted).toEqual([]);
  });

  it("never shows a credential-store origin even when listed, and reads no value from anywhere but the manifest row", async () => {
    const row = {
      ...(backendManifest().modules[0] as object),
      id: "vault",
      config: {
        fields: {
          apiKey: { type: "string", required: false, secret: true },
          label: { type: "string", required: false, secret: false },
        },
        values: { apiKey: "canary-api-key", label: "canary-label" },
      },
    };
    const { backend, serve } = world({
      sources: {
        manifest: () => ({ ...backendManifest(), modules: [...backendManifest().modules, row] }),
        status: () => backend.status(),
        origins: () => ({ label: "credential-store" }),
      },
      showValues: ["vault.apiKey", "vault.label"],
    });
    await backend.start();
    const answer = result(
      await serve("inspect.query", ctx({ providerId: "config", targetId: "vault" })),
    );
    expect(answer.values).toEqual({});
    expect(answer.omitted).toEqual([
      { path: "apiKey", reason: "secret" },
      { path: "label", reason: "credential-store" },
    ]);
    expect(JSON.stringify(answer)).not.toContain("canary");
  });
});
