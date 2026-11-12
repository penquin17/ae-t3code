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

/** A control's accessible name: its label, labelled-by text, own text, image alt or title. */
export function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  const text = (element.textContent ?? "").trim();
  if (text) return text;
  const alt = element.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt")?.trim();
  if (alt) return alt;
  // A native input is named by a <label> that wraps it or points at it.
  const id = element.getAttribute("id");
  const wrapping = element.closest("label")?.textContent?.trim();
  const pointing = id
    ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim()
    : undefined;
  return wrapping || pointing || element.getAttribute("title")?.trim() || "";
}

/** The controls a person or a screen reader can reach inside `root`: visible, not aria-hidden. */
export function interactiveIn(root: ParentNode): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], [role='checkbox'], input:not([type='hidden']), select, textarea",
    ),
  ].filter(
    (element) =>
      element.getBoundingClientRect().width > 0 && element.closest("[aria-hidden='true']") === null,
  );
}

interface Insets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Insets the browser reports through `env(safe-area-inset-*)`, as on a notched phone; undone when the returned value is disposed. */
export async function safeAreaInsets(insets: Insets): Promise<AsyncDisposable> {
  await cdp().send("Emulation.setSafeAreaInsetsOverride", { insets });
  return {
    [Symbol.asyncDispose]: async () => {
      await cdp().send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
      });
    },
  };
}

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
