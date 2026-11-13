// The saved groups are read again when the connection comes up (M10 product fix P3). Boundary: the `useGroups` hook, (a) over the fake Backend transport (testing.ts) with T3's session-generation
// atom replaced by a writable one the test moves, and (b) over the production transport (commands.ts) with the primary environment id replaced by a writable atom and T3's command call replaced
// by a recording function. This shows the hook's reads, their count and the state they leave; it does not show the real socket, session or RPC: the native run does.
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import type { GroupRecord } from "./record";
import { createFakeBackend, type FakeBackend } from "./testing";
import { GroupsTransportProvider } from "./transport";

const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Writable<number>,
  primary: null as unknown as Atom.Writable<string | null>,
  readCommand: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: {
    sessionGenerationAtom: () => mocks.generation,
  },
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => useAtomValue(mocks.primary),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => mocks.readCommand,
}));

import { useGroups } from "./useGroups";

const ENV = "env-groups" as EnvironmentId;
const saved: GroupRecord = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
  dismissed: [],
  names: [],
};

function setup(input: { readonly primary: string | null; readonly backend?: FakeBackend }) {
  mocks.generation = Atom.make(1);
  mocks.primary = Atom.make<string | null>(input.primary);
  mocks.readCommand = vi.fn(async () => ({
    _tag: "Success",
    value: { ok: true, value: saved },
  }));
  let seen!: ReturnType<typeof useGroups>;
  function Probe() {
    const groups = useGroups();
    useEffect(() => {
      seen = groups;
    });
    return null;
  }
  const probe = (
    <RegistryContext.Provider value={appAtomRegistry}>
      {input.backend === undefined ? (
        <Probe />
      ) : (
        <GroupsTransportProvider value={input.backend.transport}>
          <Probe />
        </GroupsTransportProvider>
      )}
    </RegistryContext.Provider>
  );
  return {
    probe,
    get record() {
      return seen.state.record;
    },
    newSession: (generation: number) =>
      act(async () => appAtomRegistry.set(mocks.generation, generation)),
    primaryKnown: (id: string) => act(async () => appAtomRegistry.set(mocks.primary, id)),
  };
}

/** Lets every pending promise step run, so a read that was going to start has started; no clock is waited on. */
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });

it("reads the groups again when a new session comes up after a read that was lost (a)", async () => {
  const backend = createFakeBackend(saved);
  backend.readFaults.push("throw");
  const state = setup({ primary: ENV, backend });
  // The hook probe does not navigate.
  await using _screen = await render(state.probe, { router: false });
  await vi.waitFor(() => expect(state.record.state).toBe("unknown"));
  expect(backend.events).toEqual(["read"]);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.record.state).toBe("known"));
  expect(backend.events).toEqual(["read", "read"]);
});

it("reads once per new session and never on its own (b)", async () => {
  const backend = createFakeBackend(saved);
  backend.readFaults.push("throw", "throw", "throw", "throw");
  const state = setup({ primary: ENV, backend });
  await using _screen = await render(state.probe, { router: false });
  await vi.waitFor(() => expect(backend.events).toHaveLength(1));

  // Reads keep failing: with no new session there is no further read.
  await flush();
  expect(backend.events).toHaveLength(1);

  await state.newSession(2);
  await vi.waitFor(() => expect(backend.events).toHaveLength(2));
  await flush();
  expect(backend.events).toHaveLength(2);

  await state.newSession(3);
  await vi.waitFor(() => expect(backend.events).toHaveLength(3));
  await flush();
  expect(backend.events).toHaveLength(3);
});

it("a store made before the primary environment is known reads with its id once it is (c)", async () => {
  const state = setup({ primary: null });
  await using _screen = await render(state.probe, { router: false });
  await vi.waitFor(() => expect(state.record.state).toBe("unavailable"));
  expect(mocks.readCommand).not.toHaveBeenCalled();

  await state.primaryKnown(ENV);
  await vi.waitFor(() => expect(state.record.state).toBe("known"));
  expect(mocks.readCommand).toHaveBeenCalledTimes(1);
  expect(mocks.readCommand).toHaveBeenCalledWith({ environmentId: ENV, input: {} });

  // Knowing the environment is one read, not a stream of them.
  await flush();
  expect(mocks.readCommand).toHaveBeenCalledTimes(1);
});
