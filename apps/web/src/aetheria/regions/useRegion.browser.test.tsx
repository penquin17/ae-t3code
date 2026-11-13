// AETHERIA M10 step 23 (D17, XC-19): `useRegion` in a real browser — a region is registered while its component is mounted and removed when it unmounts, also under React's double
// effects; the reporter always reads the current props without re-registering; and nothing it does touches the network.
// Boundary: React in Chromium with a registry the test supplies; no Backend and no T3 app (the sync to the Backend is sync.test.ts and the Backend's own tests).
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { declareRegion } from "./descriptor";
import { createRegionRegistry } from "./registry";
import { RegionRegistryProvider, useRegion } from "./useRegion";

const CLIENT = "client-0123456789abcdef";
const running = declareRegion({
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: "shell",
  description: "The running state of the open conversation",
  props: [{ name: "title", type: "string", report: "value" }],
  state: [{ name: "phase", type: "string", report: "value" }],
});

const makeRegistry = () =>
  createRegionRegistry({ clientId: CLIENT, now: () => 0, readToken: () => undefined });

function Running({ title, visible }: { readonly title: string; readonly visible?: boolean }) {
  const [phase] = useState("gather");
  useRegion(running, () => ({ props: { title }, state: { phase } }), { visible });
  return <p>{title}</p>;
}

function Optional({ region }: { readonly region: typeof running | null }) {
  useRegion(region, () => ({ props: { title: "x" }, state: { phase: "p" } }));
  return <p>optional</p>;
}

describe("useRegion", () => {
  it("registers nothing for a view that was given no region, and registers once one is given", async () => {
    const registry = makeRegistry();
    const screen = await render(
      <RegionRegistryProvider registry={registry}>
        <Optional region={null} />
      </RegionRegistryProvider>,
      { router: false },
    );
    expect(registry.snapshot().regions).toEqual([]);
    await screen.rerender(
      <RegionRegistryProvider registry={registry}>
        <Optional region={running} />
      </RegionRegistryProvider>,
    );
    expect(registry.snapshot().regions.map((r) => r.descriptor.id)).toEqual([
      "conversation.running",
    ]);
    await screen.rerender(
      <RegionRegistryProvider registry={registry}>
        <Optional region={null} />
      </RegionRegistryProvider>,
    );
    expect(registry.snapshot().regions).toEqual([]);
    await screen[Symbol.asyncDispose]();
  });

  it("registers on mount and removes the region on unmount", async () => {
    const registry = makeRegistry();
    const screen = await render(
      <RegionRegistryProvider registry={registry}>
        <Running title="one" />
      </RegionRegistryProvider>,
      { router: false },
    );
    expect(registry.snapshot().regions.map((r) => r.descriptor.id)).toEqual([
      "conversation.running",
    ]);
    await screen.unmount();
    expect(registry.snapshot().regions).toEqual([]);
    await screen[Symbol.asyncDispose]();
  });

  it("holds exactly one registration under React's double effects, and none after unmount", async () => {
    const registry = makeRegistry();
    const changes = vi.fn();
    registry.subscribe(changes);
    const screen = await render(
      <StrictMode>
        <RegionRegistryProvider registry={registry}>
          <Running title="one" />
        </RegionRegistryProvider>
      </StrictMode>,
      { router: false },
    );
    expect(registry.snapshot().regions).toHaveLength(1);
    await screen.unmount();
    expect(registry.snapshot().regions).toHaveLength(0);
    await screen[Symbol.asyncDispose]();
  });

  it("answers a query from the current props without registering again", async () => {
    const registry = makeRegistry();
    await using screen = await render(
      <RegionRegistryProvider registry={registry}>
        <Running title="one" />
      </RegionRegistryProvider>,
      { router: false },
    );
    const changes = vi.fn();
    registry.subscribe(changes);
    const first = registry.query("conversation.running");
    expect(first.ok && first.props).toEqual([{ name: "title", status: "value", value: "one" }]);
    await act(() =>
      screen.rerender(
        <RegionRegistryProvider registry={registry}>
          <Running title="two" />
        </RegionRegistryProvider>,
      ),
    );
    const second = registry.query("conversation.running");
    expect(second.ok && second.props).toEqual([{ name: "title", status: "value", value: "two" }]);
    expect(changes).not.toHaveBeenCalled();
  });

  it("follows the visibility the component says, and is visible by default", async () => {
    const registry = makeRegistry();
    await using screen = await render(
      <RegionRegistryProvider registry={registry}>
        <Running title="one" />
      </RegionRegistryProvider>,
      { router: false },
    );
    expect(registry.snapshot().regions[0]?.visible).toBe(true);
    await act(() =>
      screen.rerender(
        <RegionRegistryProvider registry={registry}>
          <Running title="one" visible={false} />
        </RegionRegistryProvider>,
      ),
    );
    expect(registry.snapshot().regions[0]?.visible).toBe(false);
    await act(() =>
      screen.rerender(
        <RegionRegistryProvider registry={registry}>
          <Running title="one" visible />
        </RegionRegistryProvider>,
      ),
    );
    expect(registry.snapshot().regions[0]?.visible).toBe(true);
  });

  it("makes no request and calls no action while registering, rendering, querying or unmounting", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const sockets = vi.fn();
    vi.stubGlobal("WebSocket", sockets);
    const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(false);
    const registry = makeRegistry();
    const screen = await render(
      <RegionRegistryProvider registry={registry}>
        <Running title="one" />
      </RegionRegistryProvider>,
      { router: false },
    );
    registry.query("conversation.running");
    await screen.unmount();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sockets).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    await screen[Symbol.asyncDispose]();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
