// The title lifecycle against the real router and the app's real thread-shell data, served by the
// in-process fake environment (see test/appScenarios.renders.tsx for the same set-up).
import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { DEFAULT_TAB_TITLE } from "./brand";
import { startAetheriaDocumentTitle } from "./documentTitle";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const FIRST = threadWithHistory("thread-first", 2);
const SECOND = threadWithHistory("thread-second", 2);
installFakeEnvironment([FIRST, SECOND]);

async function mountApp() {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(createMemoryHistory({ initialEntries: ["/settings/general"] }));
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height: 800px; width: 1280px;";
  const screen = await render(<AppRoot router={router} />, { container, router: false });
  return { router, screen };
}

const openThread = (router: Awaited<ReturnType<typeof mountApp>>["router"], threadId: ThreadId) =>
  router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId },
  });

describe("the document title in the running app", () => {
  it("shows the default title, then each open thread's own title, then the default again", async () => {
    const original = document.title;
    const app = await mountApp();
    await using _screen = app.screen;
    const stop = startAetheriaDocumentTitle(appAtomRegistry, app.router);
    try {
      expect(document.title).toBe(DEFAULT_TAB_TITLE);
      await openThread(app.router, FIRST.id as ThreadId);
      await expect.poll(() => document.title).toBe("Thread thread-first \u2014 Aetheria");
      await openThread(app.router, SECOND.id as ThreadId);
      await expect.poll(() => document.title).toBe("Thread thread-second \u2014 Aetheria");
      await app.router.navigate({ to: "/settings/general" });
      await expect.poll(() => document.title).toBe(DEFAULT_TAB_TITLE);
    } finally {
      stop();
      document.title = original;
    }
  });

  it("stops writing after its stop is called", async () => {
    const original = document.title;
    const app = await mountApp();
    await using _screen = app.screen;
    const stop = startAetheriaDocumentTitle(appAtomRegistry, app.router);
    expect(document.title).toBe(DEFAULT_TAB_TITLE);
    stop();
    await openThread(app.router, FIRST.id as ThreadId);
    await expect.poll(() => app.router.state.location.pathname).toContain(String(FIRST.id));
    expect(document.title).toBe(DEFAULT_TAB_TITLE);
    document.title = original;
  });
});
