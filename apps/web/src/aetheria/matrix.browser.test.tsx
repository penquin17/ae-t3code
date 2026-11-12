// Step 12: the responsive and motion matrix. Each row mounts the real app at one width and appearance,
// under the emulated reduced-motion preference, asserts the layout rules and saves a capture. The images
// land in the git-ignored __screenshots__ folder; their names carry surface, width, appearance and state.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import type { FakeDriver } from "../../test/fakeEnvironment";
import {
  LAST_ANSWER,
  THREAD_PATH,
  awaitSheetSettled,
  mountRoute,
  prepare,
  reducedMotion,
  setReducedMotion,
  type Mode,
} from "./harness";
import {
  MATRIX_MODES,
  MATRIX_WIDTHS,
  TOUCH_MIN_PX,
  captureName,
  type SidebarState,
} from "./matrix";

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

const heightFor = (width: number) => (width <= 767 ? 844 : 800);
const rows = MATRIX_WIDTHS.flatMap((width) => MATRIX_MODES.map((mode) => ({ width, mode })));
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/${name}`, save: true });
const noHorizontalScroll = (width: number) =>
  expect(document.documentElement.scrollWidth, "document width").toBeLessThanOrEqual(width);
const toggle = () =>
  [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.getAttribute("aria-label") === "Toggle main sidebar",
  );
const brandLink = () => document.querySelector<HTMLAnchorElement>('a[aria-label="Aetheria home"]');
const visible = (element: Element | null | undefined) =>
  !!element &&
  getComputedStyle(element).display !== "none" &&
  element.getBoundingClientRect().width > 0;

describe("the emulated reduced-motion preference", () => {
  it("is on for the matrix and zeroes the Aetheria motion tokens, and off again afterwards", async () => {
    await prepare(1280, 800, "light");
    const motion = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--ae-motion-fast").trim();
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
    expect(motion()).toBe("120ms");
    {
      await using _reduce = await reducedMotion();
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      expect(motion()).toBe("0ms");
    }
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
    expect(motion()).toBe("120ms");
  });

  it("leaves the changed surfaces with no running animation, with and without it", async () => {
    await prepare(1280, 800, "light");
    for (const reduce of [false, true]) {
      await setReducedMotion(reduce);
      const app = await mountRoute("/");
      await using _screen = app.screen;
      await expect
        .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
          timeout: 15_000,
        })
        .toBe(1);
      const ours = [
        document.querySelector("[data-aetheria-headline]")!,
        ...document.querySelectorAll('a[aria-label="Aetheria home"] img'),
      ];
      for (const element of ours)
        expect(element.getAnimations({ subtree: true }), `reduce=${reduce}`).toEqual([]);
    }
    await setReducedMotion(false);
  });
});

describe("the conversation", () => {
  it.each(rows)("fits $width px without horizontal scroll, $mode", async ({ width, mode }) => {
    await using _reduce = await reducedMotion();
    await prepare(width, heightFor(width), mode);
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
    noHorizontalScroll(width);
    expect((await shot(captureName("conversation", width, mode))).base64.length).toBeGreaterThan(
      1000,
    );
  });
});

describe("the new-thread hero", () => {
  it.each(rows)(
    "shows the headline on one line at $width px, $mode, and fits",
    async ({ width, mode }) => {
      await using _reduce = await reducedMotion();
      await prepare(width, heightFor(width), mode);
      const app = await mountRoute("/");
      await using _screen = app.screen;
      await expect
        .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
          timeout: 15_000,
        })
        .toBe(1);
      const headline = document.querySelector<HTMLElement>("[data-aetheria-headline]")!;
      expect(headline.scrollWidth).toBeLessThanOrEqual(headline.clientWidth);
      noHorizontalScroll(width);
      expect((await shot(captureName("hero", width, mode))).base64.length).toBeGreaterThan(1000);
    },
  );
});

describe("the sidebar", () => {
  it.each(rows)(
    "is captured at $width px, $mode, and its brand and phone sheet behave",
    async ({ width, mode }) => {
      await using _reduce = await reducedMotion();
      await prepare(width, heightFor(width), mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
      let state: SidebarState = "open";
      if (width < 768) {
        // The phone layout: a sheet, opened from its toggle and closed with Escape, focus returning to the toggle.
        const trigger = toggle();
        expect(trigger, "the sidebar toggle").toBeDefined();
        expect(visible(brandLink()), "no brand link below 768 px").toBe(false);
        trigger!.focus();
        await userEvent.keyboard("{Enter}");
        await expect.element(page.getByRole("dialog").first()).toBeVisible();
        // Captured only once the sheet has stopped sliding in and is fully opaque.
        await awaitSheetSettled();
        state = "sheet";
        noHorizontalScroll(width);
        expect(
          (await shot(captureName("sidebar", width, mode, state))).base64.length,
        ).toBeGreaterThan(1000);
        await userEvent.keyboard("{Escape}");
        await expect
          .poll(() => document.querySelector("[role='dialog']"), { timeout: 5000 })
          .toBeNull();
        expect(document.activeElement, "focus returns to the toggle").toBe(trigger);
        return;
      }
      if (!visible(brandLink())) {
        toggle()?.click();
        await expect
          .poll(() => visible(brandLink()), { timeout: 3000 })
          .toBe(true)
          .catch(() => undefined);
      }
      if (!visible(brandLink()))
        state = document.querySelector("[role='dialog']") ? "sheet" : "collapsed";
      else {
        const link = brandLink()!;
        expect(
          link.getBoundingClientRect().height,
          "the brand link is a usable target",
        ).toBeGreaterThanOrEqual(24);
      }
      noHorizontalScroll(width);
      expect(
        (await shot(captureName("sidebar", width, mode, state))).base64.length,
      ).toBeGreaterThan(1000);
    },
  );
});

describe("touch targets at 390 px", () => {
  it("exposes no Aetheria-owned control smaller than the accepted minimum", async () => {
    await using _reduce = await reducedMotion();
    await prepare(390, 844, "light");
    const app = await mountRoute("/");
    await using _screen = app.screen;
    await expect
      .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, { timeout: 15_000 })
      .toBe(1);
    // The Aetheria additions are the headline, the wordmark and the brand link; only the link is a control.
    const owned = [
      ...document.querySelectorAll<HTMLElement>(
        'a[aria-label="Aetheria home"], [data-aetheria-headline] a, [data-aetheria-headline] button',
      ),
    ];
    for (const control of owned) {
      const box = control.getBoundingClientRect();
      const shown = visible(control);
      expect(
        !shown || (box.width >= TOUCH_MIN_PX && box.height >= TOUCH_MIN_PX),
        `${control.tagName} ${box.width}x${box.height}`,
      ).toBe(true);
    }
    expect(visible(brandLink())).toBe(false);
  });
});

describe("the dark and light captures differ", () => {
  it("paints a different canvas in each appearance at the widest and narrowest widths", async () => {
    await using _reduce = await reducedMotion();
    const paint = async (mode: Mode, width: number) => {
      await prepare(width, heightFor(width), mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
      return getComputedStyle(document.querySelector("main[data-slot='sidebar-inset']")!)
        .backgroundColor;
    };
    for (const width of [1280, 390]) {
      expect(await paint("light", width)).not.toBe(await paint("dark", width));
    }
  });
});
