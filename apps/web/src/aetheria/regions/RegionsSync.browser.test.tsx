// AETHERIA M10 step 23 (D17, XC-19): the mounted reporter and the module's public surface, in a real browser. `RegionsSync` reports the registry's regions to the Backend while it is mounted — the whole set, with a
// rising sequence — and stops sending when it unmounts without sending any cancel or unregister (the Backend drops the client with the connection). The page's registry has a random client id the contract accepts.
// Boundary: React in Chromium with a fake transport; the real RPC transport (commands.ts) is loaded but not called here, and no Backend runs.
import { RegionsReportPayload } from "@t3tools/aetheria-contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../../test/render";
import {
  INITIAL_REGION_IDS,
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
        <RegionsSync transport={transport} />
      </RegionRegistryProvider>,
      { router: false },
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => c.sequence)).toEqual([1]);
    registry.register(shell, () => ({ props: {}, state: {} }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
    expect(calls.map((c) => [c.sequence, c.regions.length])).toEqual([
      [1, 0],
      [2, 1],
    ]);
    for (const call of calls) expect(() => decodeStrict(call)).not.toThrow();
    await screen.unmount();
    registry.register(declareRegion({ ...shell, id: "late" }), () => ({}));
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
    expect(calls).toHaveLength(2);
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
      [...INITIAL_REGION_IDS].toSorted(),
    );
    expect(buildManifest(REGION_DECLARATIONS).regions).toHaveLength(INITIAL_REGION_IDS.length);
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
