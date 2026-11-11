// Captures for a person to view: the new-thread hero and the sidebar in the real app (release-style, no
// T3 stage artwork), plus a mock tab strip drawn with the real title strings and the generated marks.
// The images land in the git-ignored __screenshots__ folder; the assertions prove what they show.
import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
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

const THREAD = threadWithHistory("thread-identity", 3);
const THREAD_ID = THREAD.id as ThreadId;
installFakeEnvironment([THREAD]);

type Mode = "light" | "dark";

function mountRoute(path: string) {
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  return router.load().then(async () => {
    const container = document.createElement("div");
    container.style.cssText = "height: 100%; width: 100%;";
    const screen = await render(<AppRoot router={router} />, { container, router: false });
    return { router, screen };
  });
}

let warmedUp = false;

async function prepare(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    environmentIdentificationMode: "none",
  });
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  if (!warmedUp) {
    const warm = await mountRoute(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
    await using _warm = warm.screen;
    await expect
      .element(page.getByText(`Answer 2 for ${THREAD_ID}.`), { timeout: 15_000 })
      .toBeVisible();
    warmedUp = true;
  }
}

const shot = (name: string, width: number, mode: Mode) =>
  page.screenshot({
    base64: true,
    path: `__screenshots__/${name}-${width}-${mode}.png`,
    save: true,
  });

describe("identity captures", () => {
  it.each([
    { width: 1280, height: 800, mode: "light" },
    { width: 1280, height: 800, mode: "dark" },
    { width: 390, height: 844, mode: "light" },
    { width: 390, height: 844, mode: "dark" },
  ] as const)("the new-thread hero at $width px, $mode", async ({ width, height, mode }) => {
    await prepare(width, height, mode);
    const original = document.title;
    const app = await mountRoute("/");
    await using _screen = app.screen;
    const stop = startAetheriaDocumentTitle(appAtomRegistry, app.router);
    try {
      await expect
        .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
          timeout: 15_000,
        })
        .toBe(1);
      expect(document.title).toBe(DEFAULT_TAB_TITLE);
      const headline = document.querySelector<HTMLElement>("[data-aetheria-headline]")!;
      expect(headline.scrollWidth).toBeLessThanOrEqual(headline.clientWidth);
      expect((await shot("hero", width, mode)).base64.length).toBeGreaterThan(1000);
    } finally {
      stop();
      document.title = original;
    }
  });

  it.each([
    { width: 1280, height: 800, mode: "light" },
    { width: 1280, height: 800, mode: "dark" },
  ] as const)(
    // T3 shows no brand link below 768 px (its sidebar becomes a sheet), so the wordmark is captured at desktop width.
    "the sidebar with the Aetheria wordmark at $width px, $mode",
    async ({ width, height, mode }) => {
      await prepare(width, height, mode);
      const original = document.title;
      const app = await mountRoute(`/${ENVIRONMENT_ID}/${THREAD_ID}`);
      await using _screen = app.screen;
      const stop = startAetheriaDocumentTitle(appAtomRegistry, app.router);
      try {
        await expect.element(page.getByText(`Answer 2 for ${THREAD_ID}.`)).toBeVisible();
        await expect
          .poll(() => document.title, { timeout: 8000 })
          .toBe(`${THREAD.title} \u2014 Aetheria`);
        await expect
          .element(page.getByRole("link", { name: "Aetheria home" }).first())
          .toBeVisible();
        expect((await shot("sidebar", width, mode)).base64.length).toBeGreaterThan(1000);
      } finally {
        stop();
        document.title = original;
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "a mock tab strip with the real titles and marks, %s",
    async (mode) => {
      await prepare(720, 220, mode);
      const strip = (
        <div className="flex flex-col gap-3 bg-background p-4 text-foreground">
          {[DEFAULT_TAB_TITLE, `${THREAD.title} \u2014 Aetheria`].map((title) => (
            <div
              key={title}
              className="flex w-fit items-center gap-2 rounded-t-lg border bg-card px-3 py-2 text-sm"
            >
              <img alt="" className="size-4" src={`/aetheria/aetheria-mark-${mode}.svg`} />
              <span>{title}</span>
            </div>
          ))}
        </div>
      );
      await using _screen = await render(strip);
      expect(document.body.textContent).toContain("Aetheria \u2014 Knowledge comes together");
      expect((await shot("tab-titles", 720, mode)).base64.length).toBeGreaterThan(1000);
    },
  );
});
