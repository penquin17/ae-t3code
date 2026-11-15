// Aetheria render scenarios: the app mounted with the Aetheria sessions tree in T3's sidebar slot (IP-2).
// They answer the T3 scenarios the swap makes unmeasurable: appScenarios.renders.tsx counts T3's
// SidebarThreadRow, which the shell no longer mounts, so the same bound is asserted here on Aetheria's own
// SessionRow. Counting rules and the fake environment are those of appScenarios.renders.tsx.
import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  emitTerminalMetadata,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "./fakeEnvironment";
import { commitsSoFar, startCounting, stopCounting, type RenderReport } from "./renderCounter";
import { act, fakeTimers, render } from "./render";

vi.mock("../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("./fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const HISTORY_TURNS = 20;
const TERMINAL_UPDATES = 20;
const THREADS = ["thread-warm", "thread-a", "thread-b"].map((name) =>
  threadWithHistory(name, HISTORY_TURNS),
);
const [WARM, A, B] = THREADS.map((thread) => thread.id) as [ThreadId, ThreadId, ThreadId];

installFakeEnvironment(THREADS);
await page.viewport(1400, 900);
__setClientSettingsForTests({
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
});

async function quiet() {
  let seen = -1;
  await vi.waitFor(
    () => {
      const now = commitsSoFar();
      const settled = now === seen;
      seen = now;
      expect(settled).toBe(true);
    },
    { interval: 100, timeout: 15_000 },
  );
}

// Only Date is frozen; timers run for real (relative ages would otherwise tick inside a window).
const frozenClock = () =>
  fakeTimers({ toFake: ["Date"], now: new Date("2026-03-18T09:00:30.000Z") });

async function openThread(threadId: ThreadId) {
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${threadId}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 900px; width: 1400px;";
  const screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect
    .element(page.getByText(`Answer ${HISTORY_TURNS - 1} for ${threadId}.`))
    .toBeVisible();
  await quiet();
  return screen;
}

async function measure(action: () => Promise<void>) {
  await quiet();
  startCounting();
  await action();
  await quiet();
  return stopCounting();
}

// One throwaway mount settles lazy chunks, fonts and the connection before any window is counted.
it("warm up", async () => {
  using _clock = frozenClock();
  await using _app = await openThread(WARM);
  await document.fonts.ready;
  await quiet();
});

// Counterpart of app-terminal-updates-in-other-thread (expected divergence: that one counts T3's
// SidebarThreadRow, which the Aetheria sidebar replaces). T3's bound: the open thread does not render.
it("aetheria-terminal-updates-in-other-thread", async () => {
  using _clock = frozenClock();
  await using _app = await openThread(A);
  await expect.element(page.getByText("Thread thread-b").first()).toBeVisible();
  const counted = await measure(async () => {
    for (let update = 0; update < TERMINAL_UPDATES; update++) {
      await act(() =>
        emitTerminalMetadata({
          type: "upsert",
          terminal: {
            threadId: B,
            terminalId: "default",
            cwd: "/repo",
            worktreePath: null,
            status: "running",
            pid: 42,
            exitCode: null,
            exitSignal: null,
            hasRunningSubprocess: true,
            label: `command ${update}`,
            updatedAt: `2026-03-18T09:01:${String(update).padStart(2, "0")}.000Z`,
          },
        }),
      );
    }
  });
  // Terminal metadata is not shown by the sessions tree, so no row renders at all: tighter than T3's
  // bound of one row render per update, which T3's SidebarThreadRow needs to draw the terminal marker.
  expect(counted.components.ChatView).toBeUndefined();
  expect(counted.components.SessionsPanel).toBeUndefined();
  expect(counted.components.SessionRow).toBeUndefined();
  await report("aetheria-terminal-updates-in-other-thread", counted);
});

// The control for the scenario above: SessionRow is the name the counter reports for a row, so the
// scenario above is not passing for want of a name that never matches.
it("aetheria-search-sessions", async () => {
  using _clock = frozenClock();
  await using _app = await openThread(A);
  const search = page.getByLabelText("Search sessions by title");
  const counted = await measure(async () => {
    await userEvent.type(search, "thread-b");
    await expect.element(page.getByText("Thread thread-b").first()).toBeVisible();
  });
  expect(counted.components.SessionRow).toBeGreaterThan(0);
  expect(counted.components.ChatView).toBeUndefined();
  await report("aetheria-search-sessions", counted);
});

async function report(scenario: string, counted: RenderReport) {
  await commands.writeRenderReport(
    scenario,
    JSON.stringify({
      commits: counted.commits,
      renders: counted.renders,
      components: counted.components,
    }),
  );
}
