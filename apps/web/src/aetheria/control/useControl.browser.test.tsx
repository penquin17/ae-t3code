// The control page's reads are issued again when a new session comes up (M10 product fix P2). Boundary: the `useInteractions`, `usePlanMode` and `useTasks` hooks over a FAKE transport, with T3's
// session-generation atom and the change stream replaced by writable atoms the test moves. This shows the hooks' reads, their count and the view they leave, not the real socket: the native run does.
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import type { ControlTransport, TransportResult } from "./types";

const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Writable<number>,
  signal: null as unknown as Atom.Writable<unknown>,
}));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: {
    sessionGenerationAtom: () => Atom.make((get) => get(mocks.generation)),
  },
}));
vi.mock("./transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transport")>()),
  interactionChanges: () => Atom.make((get) => get(mocks.signal)),
}));

import { useInteractions, usePlanMode, useTasks } from "./useControl";

const ENV = "env-control";
const ROOT = "pi-root-1";
const LOST: TransportResult = { tag: "lost" };
const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: { ok: true, value } });
const snapshot = (version: number): TransportResult =>
  reply({ rootSessionId: ROOT, version, interactions: [] });
const planMode = reply({ sessionId: ROOT, mode: "off" });
const tasks = reply(null);

function setup(input: { readonly snapshots: Array<TransportResult>; readonly started?: boolean }) {
  mocks.generation = Atom.make(1);
  mocks.signal = Atom.make<unknown>(
    input.started === false ? AsyncResult.initial() : AsyncResult.success({ tag: "opened" }),
  );
  const snapshotCall = vi.fn(async () => input.snapshots.shift() ?? LOST);
  const planModeCall = vi.fn(async () => (planModeCall.mock.calls.length === 1 ? LOST : planMode));
  const tasksCall = vi.fn(async () => (tasksCall.mock.calls.length === 1 ? LOST : tasks));
  const transport = {
    snapshot: snapshotCall,
    planModeGet: planModeCall,
    tasksGet: tasksCall,
  } as unknown as ControlTransport;
  let handle!: ReturnType<typeof useInteractions>;
  let modeView!: ReturnType<typeof usePlanMode>["view"];
  let tasksView!: ReturnType<typeof useTasks>["view"];
  function Probe() {
    const interactions = useInteractions(transport, ENV, ROOT);
    const version =
      interactions.view.status === "live" || interactions.view.status === "stale"
        ? interactions.view.version
        : 0;
    const mode = usePlanMode(transport, ENV, ROOT, version);
    const taskList = useTasks(transport, ENV, ROOT, version);
    useEffect(() => {
      handle = interactions;
      modeView = mode.view;
      tasksView = taskList.view;
    });
    return null;
  }
  return {
    snapshotCall,
    planModeCall,
    tasksCall,
    Probe: () => (
      <RegistryContext.Provider value={appAtomRegistry}>
        <Probe />
      </RegistryContext.Provider>
    ),
    get status() {
      return handle.view.status;
    },
    get modeView() {
      return modeView;
    },
    get tasksView() {
      return tasksView;
    },
    readNow: () => act(async () => void (await handle.readSnapshot())),
    newSession: (generation: number) =>
      act(async () => appAtomRegistry.set(mocks.generation, generation)),
  };
}

/** Lets every pending promise step run, so a read that was going to start has started; no clock is waited on. */
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });

it("reads again when a new session comes up after the first reads' replies were lost (a)", async () => {
  const state = setup({ snapshots: [LOST, snapshot(4)] });
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => {
    expect(state.status).toBe("unavailable");
    expect(state.modeView.state).toBe("unavailable");
    expect(state.tasksView.state).toBe("unavailable");
  });
  expect(state.snapshotCall).toHaveBeenCalledTimes(1);

  await state.newSession(2);
  await vi.waitFor(() => {
    expect(state.status).toBe("live");
    expect(state.modeView.state).toBe("known");
    expect(state.tasksView.state).toBe("known");
  });
  expect(state.snapshotCall).toHaveBeenCalledTimes(2);
  expect(state.planModeCall).toHaveBeenCalledTimes(2);
  expect(state.tasksCall).toHaveBeenCalledTimes(2);
});

it("issues exactly one re-read for a view that says it is being read again (b)", async () => {
  const state = setup({ snapshots: [snapshot(4), LOST, snapshot(4)] });
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.status).toBe("live"));

  // A dropped reply leaves the last value marked stale, which the page words as "is being read again".
  await state.readNow();
  expect(state.status).toBe("stale");
  expect(state.snapshotCall).toHaveBeenCalledTimes(2);

  // With no new session nothing reads it: the promise is kept by the connection coming back.
  await flush();
  expect(state.snapshotCall).toHaveBeenCalledTimes(2);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.status).toBe("live"));
  await flush();
  expect(state.snapshotCall).toHaveBeenCalledTimes(3);
});

it("does not storm: one new session is one read per view, and failures do not loop (d)", async () => {
  const state = setup({ snapshots: [LOST, LOST, LOST, LOST, LOST] });
  // The hook probe does not navigate.
  await using _screen = await render(<state.Probe />, { router: false });
  await vi.waitFor(() => expect(state.status).toBe("unavailable"));
  expect(state.snapshotCall).toHaveBeenCalledTimes(1);

  await state.newSession(2);
  await vi.waitFor(() => expect(state.snapshotCall).toHaveBeenCalledTimes(2));
  // The reply was lost again: the view stays unavailable and nothing re-reads it by itself.
  await flush();
  expect(state.snapshotCall).toHaveBeenCalledTimes(2);
  expect(state.planModeCall).toHaveBeenCalledTimes(2);
  expect(state.tasksCall).toHaveBeenCalledTimes(2);
  expect(state.status).toBe("unavailable");
});
