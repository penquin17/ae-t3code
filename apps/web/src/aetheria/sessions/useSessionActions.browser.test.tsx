// The session actions are gated on the connection (M10 review 1, follow-up 2; D4, D6). Boundary: the `useSessionActions` hook with T3's commands, projection reads and the connection's published view replaced
// by recording functions and the model's real views (connection/testing.ts). It shows that every mutating step is judged when it is sent — a blocked one sends nothing and ends `unavailable`, a connected one sends
// once — and that a Backend refusal code in a command's reply reaches the connection. It does not show T3's real command transport or projection.
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { subscribeCallRefusals } from "../connection/callRefusals";
import { connectedView, notConnectedView, showConnection } from "../connection/testing";
import type { SessionActions } from "./useSessionActions";

const ok = { _tag: "Success", value: { ok: true } };
const mocks = vi.hoisted(() => ({
  pin: null as unknown as ReturnType<typeof vi.fn>,
  unpin: null as unknown as ReturnType<typeof vi.fn>,
  archive: null as unknown as ReturnType<typeof vi.fn>,
  updateMetadata: null as unknown as ReturnType<typeof vi.fn>,
  forkFromRun: null as unknown as ReturnType<typeof vi.fn>,
  startNew: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({
    pinThread: mocks.pin,
    unpinThread: mocks.unpin,
    archiveThread: mocks.archive,
  }),
}));
vi.mock("../../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => mocks.startNew }));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => mocks.updateMetadata,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.forkFromRun }));
vi.mock("../../state/entities", () => ({
  readThreadShell: () => ({ title: "Plan", latestRun: { runId: "run-1" } }),
  waitForThreadShell: async () => true,
}));
vi.mock("../../state/waitForAtomValue", () => ({ waitForAtomValue: async () => true }));

import { useSessionActions } from "./useSessionActions";

const ENV = "env-sessions" as EnvironmentId;
const SESSION = scopedThreadKey(scopeThreadRef(ENV, "thread-1" as never));
const WORKSPACE = scopedProjectKey(scopeProjectRef(ENV, "project-1" as never));

/** Makes `view` the connection the action sites see, until disposed. */
const shown = (view: typeof connectedView) => ({ [Symbol.dispose]: showConnection(view) });

async function mountActions() {
  mocks.pin = vi.fn(async () => ok);
  mocks.unpin = vi.fn(async () => ok);
  mocks.archive = vi.fn(async () => ok);
  mocks.updateMetadata = vi.fn(async () => ok);
  mocks.forkFromRun = vi.fn(async () => ok);
  mocks.startNew = vi.fn(async () => "thread-new");
  let actions!: SessionActions;
  function Probe() {
    const value = useSessionActions();
    useEffect(() => {
      actions = value;
    });
    return null;
  }
  const screen = await render(<Probe />);
  await vi.waitFor(() => expect(actions).toBeDefined());
  return {
    screen,
    get actions() {
      return actions;
    },
  };
}

const sentNothing = () => {
  for (const fn of [
    mocks.pin,
    mocks.unpin,
    mocks.archive,
    mocks.updateMetadata,
    mocks.forkFromRun,
    mocks.startNew,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
};

describe("while the connection does not allow actions", () => {
  it.each([
    ["pin", (a: SessionActions) => a.pin(SESSION, true)],
    ["unpin", (a: SessionActions) => a.pin(SESSION, false)],
    ["archive", (a: SessionActions) => a.archive(SESSION)],
    ["rename", (a: SessionActions) => a.rename(SESSION, "New title")],
    ["fork", (a: SessionActions) => a.fork(SESSION)],
    ["start a session", (a: SessionActions) => a.startSession(WORKSPACE)],
  ] as const)(
    "%s is blocked: nothing is sent and the outcome is unavailable",
    async (_name, run) => {
      using _connection = shown(notConnectedView);
      const mounted = await mountActions();
      await using _screen = mounted.screen;
      const result = await act(async () => run(mounted.actions));
      expect(result.outcome.kind).toBe("unavailable");
      sentNothing();
    },
  );

  it("fork and rename is blocked at its first step: neither the fork nor the rename is sent", async () => {
    using _connection = shown(notConnectedView);
    const mounted = await mountActions();
    await using _screen = mounted.screen;
    const result = await act(async () => mounted.actions.forkAndRename(SESSION, "Named"));
    expect(result.outcome.kind).toBe("unavailable");
    sentNothing();
  });
});

describe("while connected", () => {
  it("a pin is sent once", async () => {
    using _connection = shown(connectedView);
    const mounted = await mountActions();
    await using _screen = mounted.screen;
    const result = await act(async () => mounted.actions.pin(SESSION, true));
    expect(mocks.pin).toHaveBeenCalledTimes(1);
    expect(result.outcome.kind).toBe("confirmed");
  });

  it("a Backend refusal code in a command reply reaches the connection", async () => {
    using _connection = shown(connectedView);
    const seen: string[] = [];
    using _listening = { [Symbol.dispose]: subscribeCallRefusals((code) => seen.push(code)) };
    const mounted = await mountActions();
    await using _screen = mounted.screen;
    mocks.archive.mockResolvedValue({
      _tag: "Success",
      value: { ok: false, code: "SESSIONS_DEVICE_REVOKED", detail: "revoked" },
    });
    await act(async () => mounted.actions.archive(SESSION));
    expect(seen).toEqual(["SESSIONS_DEVICE_REVOKED"]);
  });
});
