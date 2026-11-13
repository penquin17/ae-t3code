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

// P4: every panel mounted at once shares one store (the sidebar and the sessions page both draw the session list).
function twoPanels(backend: FakeBackend) {
  const seen: Record<string, ReturnType<typeof useGroups>> = {};
  function Panel({ name }: { readonly name: string }) {
    const groups = useGroups();
    useEffect(() => {
      seen[name] = groups;
    });
    return null;
  }
  const tree = (names: readonly string[]) => (
    <RegistryContext.Provider value={appAtomRegistry}>
      <GroupsTransportProvider value={backend.transport}>
        {names.map((name) => (
          <Panel key={name} name={name} />
        ))}
      </GroupsTransportProvider>
    </RegistryContext.Provider>
  );
  return { seen, tree };
}

it("two panels share one store: a change in one is the other's state, and a session is one read (P4)", async () => {
  const backend = createFakeBackend(saved);
  const state = setup({ primary: ENV, backend });
  const { seen, tree } = twoPanels(backend);
  await using _screen = await render(tree(["sidebar", "page"]), { router: false });
  await vi.waitFor(() => expect(seen["page"]?.state.record.state).toBe("known"));
  expect(seen["sidebar"]?.store).toBe(seen["page"]?.store);
  // One read when they mounted, not one each.
  expect(backend.events).toEqual(["read"]);

  await act(async () => void (await seen["sidebar"]!.store.dismiss("a", "c")));
  const record = seen["page"]!.state.record;
  expect(record.state === "known" && record.value.dismissed).toHaveLength(1);
  expect(backend.events).toEqual(["read", "apply:dismiss", "read"]);

  // A new session is one read in total, however many panels are mounted.
  await state.newSession(2);
  await vi.waitFor(() => expect(backend.events).toHaveLength(4));
  await flush();
  expect(backend.events).toHaveLength(4);
});

it("the store lives while any panel does, and is dropped when the last one unmounts (P4)", async () => {
  const backend = createFakeBackend(saved);
  const state = setup({ primary: ENV, backend });
  const { seen, tree } = twoPanels(backend);
  const screen = await render(tree(["sidebar", "page"]), { router: false });
  await using _screen = screen;
  await vi.waitFor(() => expect(seen["page"]?.state.record.state).toBe("known"));
  const first = seen["page"]!.store;

  // One panel leaves: the other keeps the store and the one subscription to new sessions.
  await screen.rerender(tree(["page"]));
  await state.newSession(2);
  await vi.waitFor(() => expect(backend.events).toHaveLength(2));
  await flush();
  expect(backend.events).toHaveLength(2);
  expect(seen["page"]!.store).toBe(first);

  // The last panel leaves: nothing listens, so a new session reads nothing.
  await screen.rerender(tree([]));
  await state.newSession(3);
  await flush();
  expect(backend.events).toHaveLength(2);

  // A panel mounted after that gets a fresh store that reads for itself.
  await screen.rerender(tree(["again"]));
  await vi.waitFor(() => expect(seen["again"]?.state.record.state).toBe("known"));
  expect(seen["again"]!.store).not.toBe(first);
  expect(backend.events).toHaveLength(3);
});
