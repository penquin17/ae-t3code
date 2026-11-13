// A root's deliverables list is read again when a new session comes up (M10 Plan step 16; the P2 pattern of `children/useChildren.browser.test.tsx`). Boundary: the `useRootRead` hook over a fake read,
// with T3's session-generation atom replaced by a writable one the test moves. This shows the hook's reads and their count, not the real socket or session: the native run shows that.
import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({ generation: null as unknown as Atom.Writable<number> }));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: {
    sessionGenerationAtom: () => Atom.make((get) => get(mocks.generation)),
  },
}));

import { useRootRead } from "./useRootRead";

type View = { readonly tag: "known"; readonly n: number } | { readonly tag: "unknown" };
const ENV = "env-deliverables" as EnvironmentId;
const ROOT = "root-1";
const UNKNOWN: View = { tag: "unknown" };

function setup(replies: View[]) {
  mocks.generation = Atom.make(1);
  const read = vi.fn(async (_root: string) => replies.shift() ?? UNKNOWN);
  let seen!: ReturnType<typeof useRootRead<View>>;
  function Probe() {
    const result = useRootRead<View>({ environmentId: ENV, rootThreadId: ROOT, read });
    useEffect(() => {
      seen = result;
    });
    return null;
  }
  return {
    read,
    Probe: () => (
      <RegistryContext.Provider value={appAtomRegistry}>
        <Probe />
      </RegistryContext.Provider>
    ),
    get view() {
      return seen.state.view;
    },
    refresh: () => act(async () => seen.refresh()),
    newSession: (generation: number) =>
      act(async () => appAtomRegistry.set(mocks.generation, generation)),
  };
}

/** Lets every pending promise step run, so a read that was going to start has started; no clock is waited on. */
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });

it("reads again when a new session comes up after a read whose answer was unknown", async () => {
  const state = setup([UNKNOWN, { tag: "known", n: 1 }]);
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.view.tag).toBe("unknown"));
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(state.read).toHaveBeenCalledWith(ROOT);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.view.tag).toBe("known"));
  expect(state.read).toHaveBeenCalledTimes(2);
});

it("reads once per new session and never on its own", async () => {
  const state = setup([UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.view.tag).toBe("unknown"));
  expect(state.read).toHaveBeenCalledTimes(1);

  // Answers keep being unknown: with no new session there is no further read.
  await flush();
  expect(state.read).toHaveBeenCalledTimes(1);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  await flush();
  expect(state.read).toHaveBeenCalledTimes(2);

  await state.newSession(3);
  await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(3));
  await flush();
  expect(state.read).toHaveBeenCalledTimes(3);
});

it("Refresh reads once more, and the newest answer is the one kept", async () => {
  const state = setup([
    { tag: "known", n: 1 },
    { tag: "known", n: 2 },
  ]);
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.view).toEqual({ tag: "known", n: 1 }));
  await state.refresh();
  await vi.waitFor(() => expect(state.view).toEqual({ tag: "known", n: 2 }));
  expect(state.read).toHaveBeenCalledTimes(2);
});
