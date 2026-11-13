// The children list is read again when a new session comes up (M10 product fix P2). Boundary: the `useChildren` hook over fake Backend calls, with T3's session-generation atom replaced by a
// writable one the test moves. This shows the hook's reads and their count, not the real socket or session: the native run shows that.
import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import type { SendResult } from "../core/outcome";
import type { ChildrenCalls } from "./calls";

const mocks = vi.hoisted(() => ({ generation: null as unknown as Atom.Writable<number> }));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: {
    sessionGenerationAtom: () => Atom.make((get) => get(mocks.generation)),
  },
}));

import { useChildren } from "./useChildren";

const ENV = "env-children" as EnvironmentId;
const ROOT = "root-1";
const LOST: SendResult<unknown> = { tag: "lost" };
const listed = (label: string): SendResult<unknown> => ({
  tag: "accepted",
  value: {
    ok: true,
    value: {
      rows: [
        {
          childId: "child-a",
          parentId: ROOT,
          depth: 1,
          role: "researcher",
          mode: "continuable",
          label,
          state: "running",
          lastOutcome: null,
          route: 1,
        },
      ],
      diagnostics: [],
    },
  },
});

function setup(replies: Array<SendResult<unknown>>) {
  mocks.generation = Atom.make(1);
  const list = vi.fn(async () => replies.shift() ?? LOST);
  const calls: ChildrenCalls = {
    list,
    interrupt: async () => LOST,
    close: async () => LOST,
  };
  let seen!: ReturnType<typeof useChildren>;
  function Probe() {
    const children = useChildren({ environmentId: ENV, rootThreadId: ROOT, calls });
    useEffect(() => {
      seen = children;
    });
    return null;
  }
  return {
    list,
    Probe: () => (
      <RegistryContext.Provider value={appAtomRegistry}>
        <Probe />
      </RegistryContext.Provider>
    ),
    get view() {
      return seen.list.view;
    },
    newSession: (generation: number) =>
      act(async () => appAtomRegistry.set(mocks.generation, generation)),
  };
}

/** Lets every pending promise step run, so a read that was going to start has started; no clock is waited on. */
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });

it("reads the children again when a new session comes up after a read whose reply was lost (c)", async () => {
  const state = setup([LOST, listed("Researcher")]);
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.view.tag).toBe("unknown"));
  expect(state.list).toHaveBeenCalledTimes(1);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.view.tag).toBe("read"));
  expect(state.list).toHaveBeenCalledTimes(2);
});

it("reads once per new session and never on its own (d)", async () => {
  const state = setup([LOST, LOST, LOST, LOST]);
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.view.tag).toBe("unknown"));
  expect(state.list).toHaveBeenCalledTimes(1);

  // Replies keep being lost: with no new session there is no further read.
  await flush();
  expect(state.list).toHaveBeenCalledTimes(1);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
  await flush();
  expect(state.list).toHaveBeenCalledTimes(2);

  await state.newSession(3);
  await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(3));
  await flush();
  expect(state.list).toHaveBeenCalledTimes(3);
});
