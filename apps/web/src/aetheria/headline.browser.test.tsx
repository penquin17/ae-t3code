// The slogan in the existing empty-draft hero: one line at every width, once, and only there.
import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { AetheriaHeadline } from "./AetheriaHeadline";

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

const HISTORY = threadWithHistory("thread-with-history", 2);
installFakeEnvironment([HISTORY]);

const SLOGAN = "Knowledge comes together";
const WIDTHS = [1280, 390, 375, 360, 320] as const;
const headlines = () => document.querySelectorAll<HTMLElement>("[data-aetheria-headline]");

/** Lines of text the element's own text occupies, read from its client rects. */
function lineCount(element: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
  return tops.size;
}

describe("the headline's size and layout", () => {
  it.each(WIDTHS)("fits on one line, unclipped, at %ipx at the accepted size", async (width) => {
    await page.viewport(width, 700);
    await using screen = await render(
      <div className="mx-auto w-full max-w-5xl px-3">
        <AetheriaHeadline />
      </div>,
    );
    const headline = screen.container.querySelector<HTMLElement>("[data-aetheria-headline]")!;
    expect(headline.textContent).toBe(SLOGAN);
    const size = Number.parseFloat(getComputedStyle(headline).fontSize);
    expect(size).toBeCloseTo(Math.min(26, width * 0.08 - 4), 1);
    expect(lineCount(headline)).toBe(1);
    expect(headline.scrollWidth).toBeLessThanOrEqual(headline.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  });
});

function mountRoute(path: string) {
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  return router.load().then(() => {
    const container = document.createElement("div");
    container.style.cssText = "height: 800px; width: 100%;";
    return render(<AppRoot router={router} />, { container, router: false });
  });
}

let warmedUp = false;

/** The first mount connects the environment and loads its projects; the index route needs them to start a draft. */
async function mountApp(path: string) {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  if (!warmedUp) {
    await using _warm = await mountRoute(`/${ENVIRONMENT_ID}/${HISTORY.id as ThreadId}`);
    await expect
      .element(page.getByText(`Answer 1 for ${HISTORY.id}.`), { timeout: 15_000 })
      .toBeVisible();
    warmedUp = true;
  }
  return mountRoute(path);
}

describe("the headline in the real new-thread hero", () => {
  it("appears once on the empty draft, without a Preview badge, beside the project control", async () => {
    await page.viewport(1280, 800);
    await using screen = await mountApp("/");
    // The first mount loads the app's lazy chunks and the draft before the hero shows.
    await expect
      .poll(() => document.body.innerText.trim().length, { timeout: 15_000 })
      .toBeGreaterThan(20);
    expect(headlines().length, document.body.innerText.slice(0, 500)).toBe(1);
    const headline = headlines()[0]!;
    await expect
      .poll(() => headline.parentElement?.textContent ?? "", { timeout: 8000 })
      .toContain("render");
    expect(headline.textContent).toBe(SLOGAN);
    expect(screen.container.textContent).not.toMatch(/preview/i);
    // The project selection the hero already had is still there to use.
    await expect.poll(() => document.querySelector("[data-draft-project-trigger]")).not.toBeNull();
    expect(lineCount(headline)).toBe(1);
  });

  it("keeps the project picker usable from the keyboard", async () => {
    await page.viewport(1280, 800);
    await using _screen = await mountApp("/");
    await expect
      .poll(() => document.querySelector("[data-draft-project-trigger]"), { timeout: 15_000 })
      .not.toBeNull();
    const trigger = document.querySelector<HTMLElement>("[data-draft-project-trigger]")!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => document.querySelector("[role='listbox'], [role='option']"), { timeout: 5000 })
      .not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.querySelector("[role='listbox']"), { timeout: 5000 })
      .toBeNull();
  });

  it.each(WIDTHS)("stays on one line, unclipped, in the app at %ipx", async (width) => {
    await page.viewport(width, 800);
    await using _screen = await mountApp("/");
    await expect.poll(() => headlines().length).toBe(1);
    const headline = headlines()[0]!;
    expect(lineCount(headline)).toBe(1);
    expect(headline.scrollWidth).toBeLessThanOrEqual(headline.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  });

  it("is absent once a thread has content", async () => {
    await page.viewport(1280, 800);
    await using _screen = await mountApp(`/${ENVIRONMENT_ID}/${HISTORY.id as ThreadId}`);
    await expect.element(page.getByText(`Answer 1 for ${HISTORY.id}.`)).toBeVisible();
    expect(headlines()).toHaveLength(0);
  });
});
