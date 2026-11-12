// Shared set-up for the browser tests that mount the real app on the in-process fake environment.
// Each test file keeps its own vi.mock of the connection driver (see test/appScenarios.renders.tsx); this
// module supplies the fixture thread, the mount helper and the appearance and motion switches.
import { createMemoryHistory } from "@tanstack/react-router";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect } from "vite-plus/test";
import { cdp, page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

export type Mode = "light" | "dark";

const THREAD = threadWithHistory("thread-matrix", 3);
const THREAD_ID = THREAD.id as ThreadId;
export const THREAD_PATH = `/${ENVIRONMENT_ID}/${THREAD_ID}`;
export const LAST_ANSWER = `Answer 2 for ${THREAD_ID}.`;

installFakeEnvironment([THREAD]);

/** Emulates the browser's reduced-motion preference (or removes the emulation). */
export async function setReducedMotion(reduce: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
  });
}

/**
 * Waits until the phone sheet has finished opening: its animations are done, it is fully opaque and it has
 * slid fully on screen. Capturing earlier shows it ghosted over the conversation, mid-slide.
 */
export async function awaitSheetSettled(): Promise<HTMLElement> {
  const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
  await expect
    .poll(
      () => {
        const element = dialog();
        if (!element) return "no dialog";
        const running = document
          .getAnimations()
          .filter((animation) => animation.playState === "running");
        const panel = element.closest<HTMLElement>("[data-slot='sidebar']") ?? element;
        const opacity = Number.parseFloat(getComputedStyle(panel).opacity);
        const left = element.getBoundingClientRect().left;
        return running.length === 0 && opacity === 1 && left >= 0
          ? "settled"
          : `running=${running.length} opacity=${opacity} left=${left}`;
      },
      { timeout: 8000 },
    )
    .toBe("settled");
  return dialog()!;
}

/** Reduced motion on until the test ends. */
export async function reducedMotion() {
  await setReducedMotion(true);
  return { [Symbol.asyncDispose]: () => setReducedMotion(false) };
}

export function mountRoute(path: string) {
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
  return router.load().then(async () => {
    const container = document.createElement("div");
    container.style.cssText = "height: 100%; width: 100%;";
    const screen = await render(<AppRoot router={router} />, { container, router: false });
    return { router, screen };
  });
}

let warmedUp = false;

/** Sets viewport, appearance and settings, and connects the environment once so every mount finds its projects. */
export async function prepare(width: number, height: number, mode: Mode): Promise<void> {
  await page.viewport(width, height);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    // Release-style: no T3 Dev-stage artwork on the send button or the sidebar.
    environmentIdentificationMode: "none",
  });
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  if (!warmedUp) {
    const warm = await mountRoute(THREAD_PATH);
    await using _warm = warm.screen;
    await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
    warmedUp = true;
  }
}
