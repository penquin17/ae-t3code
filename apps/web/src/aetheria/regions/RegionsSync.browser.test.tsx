// AETHERIA M10 step 23 (D17, XC-19): the mounted reporter and the module's public surface, in a real browser. `RegionsSync` reports the registry's regions to the Backend while it is mounted — the whole set, with a
// rising sequence — and stops sending when it unmounts without sending any cancel or unregister (the Backend drops the client with the connection). The page's registry has a random client id the contract accepts.
// Boundary: React in Chromium with a fake transport; the real RPC transport (commands.ts) is loaded but not called here, and no Backend runs.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { RegionsReportPayload } from "@t3tools/aetheria-contracts";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarProvider } from "~/components/ui/sidebar";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, fakeTimers, render } from "../../../test/render";
import {
  DECLARED_REGION_IDS,
  RegionRegistryProvider,
  RegionsSync,
  declareRegion,
  buildManifest,
  checkDeclaration,
  getAppRegionRegistry,
  manifestJson,
  REGION_DECLARATIONS,
  useRegion,
  useRegionRegistry,
} from "./index";
import { createRegionRegistry } from "./registry";
import type { RegionsReply, RegionsTransport } from "./sync";

// T3's session-generation atom and primary-environment id are replaced by writable ones the test moves: a new generation is a new connection. Everything else in both modules is the real one.
const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Writable<number>,
  primary: null as unknown as Atom.Writable<string | null>,
}));
vi.mock("~/connection/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/connection/catalog")>();
  return {
    ...actual,
    environmentCatalog: {
      ...actual.environmentCatalog,
      sessionGenerationAtom: () => mocks.generation,
    },
  };
});
vi.mock("../../state/environments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/environments")>();
  return { ...actual, usePrimaryEnvironmentId: () => useAtomValue(mocks.primary) };
});
/** A new connection state for one test: session generation 1, and the primary environment known unless the test says otherwise. */
const freshConnection = (primary: string | null = "env-regions") => {
  mocks.generation = Atom.make(1);
  mocks.primary = Atom.make<string | null>(primary);
};
freshConnection();

const CLIENT = "client-0123456789abcdef";
const decodeStrict = Schema.decodeUnknownSync(RegionsReportPayload as never, {
  onExcessProperty: "error",
});
const shell = declareRegion({
  id: "shell",
  kind: "screen",
  owner: "aetheria-ui",
  parent: null,
  description: "The app shell",
});

const T3_SURFACES = 9;

const fakeTransport = () => {
  const calls: Array<Parameters<RegionsTransport["report"]>[0]> = [];
  const transport: RegionsTransport = {
    report: async (payload) => {
      calls.push(structuredClone(payload));
      const reply: RegionsReply = {
        ok: true,
        value: { clientId: payload.clientId, sequence: payload.sequence, regions: [], viewing: [] },
      };
      return reply;
    },
  };
  return { calls, transport };
};

describe("RegionsSync", () => {
  it("reports the whole set while mounted, in the contract's own shape, and sends nothing after unmount", async () => {
    using _timers = fakeTimers();
    const registry = createRegionRegistry({
      clientId: CLIENT,
      now: () => 0,
      readToken: () => undefined,
    });
    const { calls, transport } = fakeTransport();
    const screen = await render(
      <RegionRegistryProvider registry={registry}>
        <SidebarProvider>
          <RegionsSync transport={transport} />
        </SidebarProvider>
      </RegionRegistryProvider>,
    );
    // The reporter registers T3's nine surfaces itself (review 2, F2); the first report carries them all.
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => [c.sequence, c.regions.length])).toEqual([[1, T3_SURFACES]]);
    registry.register(declareRegion({ ...shell, id: "extra" }), () => ({ props: {}, state: {} }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => [c.sequence, c.regions.length])).toEqual([
      [1, T3_SURFACES],
      [2, T3_SURFACES + 1],
    ]);
    for (const call of calls) expect(() => decodeStrict(call)).not.toThrow();
    await screen.unmount();
    registry.register(declareRegion({ ...shell, id: "late" }), () => ({}));
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
    expect(calls).toHaveLength(2);
    await screen[Symbol.asyncDispose]();
  });
});

describe("a new connection", () => {
  async function mountReporter(primary?: string | null) {
    freshConnection(primary);
    const registry = createRegionRegistry({
      clientId: CLIENT,
      now: () => 0,
      readToken: () => undefined,
    });
    const { calls, transport } = fakeTransport();
    const screen = await render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <RegionRegistryProvider registry={registry}>
          <SidebarProvider>
            <RegionsSync transport={transport} />
          </SidebarProvider>
        </RegionRegistryProvider>
      </RegistryContext.Provider>,
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    return { calls, screen };
  }

  it("reports the whole set once more when the primary environment's session starts again, with no route, mount or visibility change", async () => {
    using _timers = fakeTimers();
    const { calls, screen } = await mountReporter();
    expect(calls.map((c) => [c.sequence, c.regions.length])).toEqual([[1, T3_SURFACES]]);
    await act(async () => void appAtomRegistry.set(mocks.generation, 2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => [c.clientId, c.sequence, c.regions.length])).toEqual([
      [CLIENT, 1, T3_SURFACES],
      [CLIENT, 2, T3_SURFACES],
    ]);
    expect(calls[1]!.regions).toEqual(calls[0]!.regions);
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(calls).toHaveLength(2);
    await act(async () => void appAtomRegistry.set(mocks.generation, 3));
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => c.sequence)).toEqual([1, 2, 3]);
    for (const call of calls) expect(() => decodeStrict(call)).not.toThrow();
    await screen[Symbol.asyncDispose]();
  });

  it("reports once the primary environment becomes known, since a report sent before it was known went nowhere", async () => {
    using _timers = fakeTimers();
    const { calls, screen } = await mountReporter(null);
    expect(calls.map((c) => c.sequence)).toEqual([1]);
    await act(async () => void appAtomRegistry.set(mocks.primary, "env-regions"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => c.sequence)).toEqual([1, 2]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));
    expect(calls).toHaveLength(2);
    await screen[Symbol.asyncDispose]();
  });

  it("sends nothing for a new session once the reporter is unmounted", async () => {
    using _timers = fakeTimers();
    const { calls, screen } = await mountReporter();
    await screen.unmount();
    await act(async () => void appAtomRegistry.set(mocks.generation, 2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
    expect(calls).toHaveLength(1);
    await screen[Symbol.asyncDispose]();
  });
});

describe("the page's registry and the manifest", () => {
  it("is one registry with a random client id the contract accepts", () => {
    const registry = getAppRegionRegistry();
    expect(getAppRegionRegistry()).toBe(registry);
    expect(registry.clientId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("generates a manifest of exactly the declared regions", () => {
    const manifest = JSON.parse(manifestJson(REGION_DECLARATIONS)) as {
      regions: Array<{ id: string }>;
    };
    expect(manifest.regions.map((r) => r.id).toSorted()).toEqual(
      [...DECLARED_REGION_IDS].toSorted(),
    );
    expect(buildManifest(REGION_DECLARATIONS).regions).toHaveLength(DECLARED_REGION_IDS.length);
  });

  it("offers the hook and the registry accessor a view uses, and the declaration check a module can ask", async () => {
    expect(checkDeclaration({ ...shell, tokens: ["--ae-no-such-token"] })).toMatchObject({
      ok: false,
      code: "unknown-token",
    });
    const registry = createRegionRegistry({
      clientId: CLIENT,
      now: () => 0,
      readToken: () => undefined,
    });
    function View() {
      useRegion(shell, () => ({ props: {}, state: {} }));
      return <p>{useRegionRegistry().clientId}</p>;
    }
    await using screen = await render(
      <RegionRegistryProvider registry={registry}>
        <View />
      </RegionRegistryProvider>,
      { router: false },
    );
    expect(screen.container.textContent).toBe(CLIENT);
    expect(registry.snapshot().regions.map((r) => r.descriptor.id)).toEqual(["shell"]);
  });
});
