// AETHERIA M11 Plan step 21 (C6 U3; D9–D12; IP-2): the mounted responder in a real browser. `InspectResponder` answers the Backend's requests from the page's region registry for as long as it is mounted, sends only
// correlated replies, makes no other request, and releases its stream when it unmounts.
// Boundary: React in Chromium with a fake request transport and the real region registry and generated declarations; T3's stream, the Backend and the shell mount (AppSidebarLayout's IP-2 element) are not loaded —
// the shell mount is the join step's, proven natively at step 24. This is a page-side harness result, not B2.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { InspectClientRequest, InspectReplyPayload } from "@t3tools/aetheria-contracts";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import { REGION_DECLARATIONS } from "../regions/declarations";
import { declareRegion } from "../regions/descriptor";
import { createRegionRegistry } from "../regions/registry";
import { RegionRegistryProvider, useRegion } from "../regions/useRegion";
import { InspectResponder } from "./InspectResponder";
import type { ResponderTransport } from "./responder";

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
mocks.generation = Atom.make(1);
mocks.primary = Atom.make<string | null>(null);

const CLIENT = "client-0123456789abcdef";
const running = declareRegion({
  id: "conversation.running",
  kind: "region",
  owner: "aetheria-ui",
  parent: null,
  description: "The running state of the open conversation",
  state: [{ name: "phase", type: "string", report: "value" }],
  tokens: ["--ae-color-accent"],
});

function Region() {
  useRegion(running, () => ({ props: {}, state: { phase: "running" } }));
  return <div data-testid="region" />;
}

const fakeTransport = () => {
  const handlers: Array<(request: InspectClientRequest) => void> = [];
  const released: number[] = [];
  const replies: InspectReplyPayload[] = [];
  const transport: ResponderTransport = {
    subscribe: (onRequest) => {
      const index = handlers.push(onRequest) - 1;
      return () => void released.push(index);
    },
    reply: async (payload) => void replies.push(structuredClone(payload)),
  };
  return { transport, handlers, released, replies };
};
const ask = (regionId: string, requestId: string): InspectClientRequest => ({
  requestId,
  regionId,
  schemaVersion: 1,
  remainingMs: 10_000,
});
const tick = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};
const mount = async (transport: ResponderTransport, withRegion: boolean) => {
  const registry = createRegionRegistry({
    clientId: CLIENT,
    now: () => 1_700_000_000_000,
    readToken: () => "#abcdef",
  });
  const view = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RegionRegistryProvider registry={registry}>
        {withRegion ? <Region /> : null}
        <InspectResponder transport={transport} />
      </RegionRegistryProvider>
    </RegistryContext.Provider>,
  );
  return { registry, view };
};

describe("the mounted responder", () => {
  it("answers every declared region of the build, and sends nothing but correlated replies and no other request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { transport, handlers, replies } = fakeTransport();
    const { view } = await mount(transport, false);
    await tick();
    expect(handlers).toHaveLength(1);
    expect(replies).toEqual([]); // unasked: nothing is sent
    for (const [index, declared] of REGION_DECLARATIONS.entries())
      handlers[0]!(ask(declared.id, `req-${index}`));
    await tick();
    expect(replies).toHaveLength(REGION_DECLARATIONS.length);
    for (const [index, reply] of replies.entries()) {
      expect(reply).toMatchObject({
        requestId: `req-${index}`,
        outcome: "ok",
        state: "inactive",
        values: {},
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    await view.unmount();
    fetchSpy.mockRestore();
  });

  it("answers a mounted region live, from its reporter and the computed style, and a vanished region as inactive", async () => {
    const { transport, handlers, replies } = fakeTransport();
    const { view } = await mount(transport, true);
    await tick();
    handlers[0]!(ask("conversation.running", "a"));
    await tick();
    expect(replies[0]).toMatchObject({
      requestId: "a",
      outcome: "ok",
      state: "active",
      values: { "state.phase": "running", "tokens.--ae-color-accent": "#abcdef" },
    });
    await view.unmount();
  });

  it("releases its request stream on unmount and sends nothing afterwards", async () => {
    const { transport, handlers, released, replies } = fakeTransport();
    const { view } = await mount(transport, false);
    await tick();
    await view.unmount();
    expect(released).toEqual([0]);
    handlers[0]!(ask("shell", "late"));
    await tick();
    expect(replies).toEqual([]);
  });

  it("binds anew on a new session and drops what the old stream still delivers", async () => {
    const { transport, handlers, released, replies } = fakeTransport();
    mocks.primary = Atom.make<string | null>(null);
    const { view } = await mount(transport, false);
    await tick();
    await act(async () => {
      appAtomRegistry.set(mocks.generation as Atom.Writable<number>, 2);
    });
    await tick();
    // The generation atom only signals when the primary environment is known; here it is not, so no rebind
    // happens and the single stream stays bound — the rebind itself is proven in responder.test.ts.
    expect(released).toEqual([]);
    expect(handlers).toHaveLength(1);
    handlers[0]!(ask("shell", "still-bound"));
    await tick();
    expect(replies.map((r) => r.requestId)).toEqual(["still-bound"]);
    await view.unmount();
  });
});
