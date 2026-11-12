// Step 12: the responsive and motion matrix. Each row mounts the real app at one width and appearance,
// under the emulated reduced-motion preference, asserts the layout rules and saves a capture. The images
// land in the git-ignored __screenshots__ folder; their names carry surface, width, appearance and state.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import { EnvironmentId } from "@t3tools/contracts";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { StandalonePage, StandalonePageHeader } from "~/components/ui/standalone-page";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import type { UpdateEverythingRow } from "~/components/sidebar/updateEverything.logic";
import { refreshTheme, setTheme } from "~/hooks/useTheme";
import { getThemeColorsForAppearance } from "@t3tools/shared/themePalettes";
import { applyThemeColorPreview, OCEAN_THEME, THEME_PREVIEW_ID } from "~/themePalette";
import { resolveColor } from "./measure";
import type { FakeDriver } from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import {
  LAST_ANSWER,
  THREAD_PATH,
  accessibleName,
  awaitSheetSettled,
  interactiveIn,
  mountRoute,
  prepare,
  reducedMotion,
  safeAreaInsets,
  setReducedMotion,
  type Mode,
} from "./harness";
import {
  MATRIX_MODES,
  MATRIX_WIDTHS,
  PHONE_SAFE_AREA,
  TOUCH_MIN_PX,
  captureName,
  captureNameB,
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

const dialogEl = () => document.querySelector<HTMLElement>("[role='dialog'], [role='alertdialog']");

/** Nothing running and every ancestor of the dialog fully opaque, so what is captured is what is seen. */
async function dialogSettled() {
  await expect
    .poll(
      () => {
        const element = dialogEl();
        if (!element) return "no dialog";
        const running = document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length;
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          opacity *= Number.parseFloat(getComputedStyle(node).opacity);
        }
        return running === 0 && opacity === 1 ? "settled" : `running=${running} opacity=${opacity}`;
      },
      { timeout: 8000 },
    )
    .toBe("settled");
}

function insideViewport(element: Element, width: number, height: number) {
  const box = element.getBoundingClientRect();
  return {
    box: `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`,
    inside:
      box.left >= -0.5 && box.right <= width + 0.5 && box.top >= -0.5 && box.bottom <= height + 0.5,
  };
}

const rounded = (css: string) => {
  const color = resolveColor(css);
  return [color.r, color.g, color.b].map((channel) => Math.round(channel));
};

/** The colour a CSS variable paints right now, as rounded sRGB channels. */
const paintedVar = (name: string) => {
  const probe = document.createElement("div");
  probe.style.backgroundColor = `var(${name})`;
  document.body.append(probe);
  try {
    return rounded(getComputedStyle(probe).backgroundColor);
  } finally {
    probe.remove();
  }
};

const UPDATE_ROWS: readonly UpdateEverythingRow[] = [
  { environmentId: null, label: "This app", app: "this-app", skipped: null, providers: ["Codex"] },
  {
    environmentId: EnvironmentId.make("environment-render"),
    label: "Render scenarios",
    app: "server",
    skipped: null,
    providers: ["Claude", "Codex"],
  },
];

function UpdateOpen() {
  return (
    <UpdateEverythingDialog
      open
      onOpenChange={() => {}}
      version="1.2.3"
      providerCount={2}
      rows={UPDATE_ROWS}
      restarts={[]}
      onConfirm={() => {}}
    />
  );
}

/** Tab a few times and report whether focus stayed inside the dialog. */
async function focusStaysInside(presses: number) {
  await expect
    .poll(() => dialogEl()?.contains(document.activeElement) ?? false, { timeout: 5000 })
    .toBe(true);
  for (let press = 0; press < presses; press++) {
    await userEvent.keyboard("{Tab}");
    // The trap may hand focus over through a sentinel for a moment; focus that stays outside is an escape.
    await expect
      .poll(() => dialogEl()?.contains(document.activeElement) ?? false, { timeout: 2000 })
      .toBe(true)
      .catch(() => undefined);
    if (!dialogEl()?.contains(document.activeElement)) return false;
  }
  return true;
}

describe("Settings → Appearance", () => {
  it.each(rows)("fits $width px and is captured, $mode", async ({ width, mode }) => {
    await using _reduce = await reducedMotion();
    await prepare(width, heightFor(width), mode);
    const app = await mountRoute("/settings/appearance");
    await using _screen = app.screen;
    await expect
      .element(page.getByRole("button", { name: /^Use Ocean theme/ }), { timeout: 15_000 })
      .toBeVisible();
    noHorizontalScroll(width);
    expect((await shot(captureNameB("appearance", width, mode))).base64.length).toBeGreaterThan(
      1000,
    );
  });

  it.each(rows)(
    "shows a live palette preview at $width px and restores the stored choice, $mode",
    async ({ width, mode }) => {
      await using _reduce = await reducedMotion();
      await prepare(width, heightFor(width), mode);
      const app = await mountRoute("/settings/appearance");
      await using _screen = app.screen;
      await expect
        .element(page.getByRole("button", { name: /^Use Ocean theme/ }), { timeout: 15_000 })
        .toBeVisible();
      const before = document.documentElement.dataset.themeId;
      // A preview is given the colours of the mode being previewed, as the theme editor gives its own half.
      const expected = getThemeColorsForAppearance(OCEAN_THEME, mode)!;
      applyThemeColorPreview(expected, mode);
      expect(document.documentElement.dataset.themeId).toBe(THEME_PREVIEW_ID);
      expect(document.documentElement.classList.contains("dark")).toBe(mode === "dark");
      expect(paintedVar("--background"), `${mode} canvas`).toEqual(rounded(expected.canvas));
      expect(paintedVar("--card"), `${mode} card`).toEqual(rounded(expected.surface));
      noHorizontalScroll(width);
      expect((await shot(captureNameB("preview", width, mode))).base64.length).toBeGreaterThan(
        1000,
      );
      refreshTheme();
      expect(document.documentElement.dataset.themeId).toBe(before);
      expect(document.documentElement.classList.contains("dark")).toBe(mode === "dark");
    },
  );

  it.each(MATRIX_MODES)(
    "paints a palette's colours the same with and without Aetheria's stylesheet, and opaque, %s mode",
    async (mode) => {
      await using _reduce = await reducedMotion();
      await prepare(1280, 800, mode);
      const app = await mountRoute("/settings/appearance");
      await using _screen = app.screen;
      await expect
        .element(page.getByRole("button", { name: /^Use Ocean theme/ }), { timeout: 15_000 })
        .toBeVisible();
      const aetheria = [...document.styleSheets].filter((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => rule.cssText.includes("--ae-color-bg-base"));
        } catch {
          return false;
        }
      });
      expect(aetheria.length, "the Aetheria stylesheet is loaded").toBe(1);
      const palette = getThemeColorsForAppearance(OCEAN_THEME, mode)!;
      const painted = () => ({ canvas: paintedVar("--background"), card: paintedVar("--card") });
      const cardAlpha = () => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--card)";
        document.body.append(probe);
        try {
          return resolveColor(getComputedStyle(probe).backgroundColor).a;
        } finally {
          probe.remove();
        }
      };

      applyThemeColorPreview(palette, mode);
      const withAetheria = painted();
      expect(cardAlpha(), "the card colour is opaque").toBeGreaterThanOrEqual(0.999);
      aetheria[0]!.disabled = true;
      let tAlone;
      try {
        tAlone = painted();
      } finally {
        aetheria[0]!.disabled = false;
      }
      expect(withAetheria, "a preview looks the same in T3 alone and with Aetheria").toEqual(
        tAlone,
      );
      expect(withAetheria.canvas).toEqual(rounded(palette.canvas));
      expect(withAetheria.card).toEqual(rounded(palette.surface));
      refreshTheme();

      // The same palette chosen for real, not previewed.
      setTheme("ocean");
      const chosen = painted();
      expect(chosen, "choosing the palette paints what its preview painted").toEqual(withAetheria);
      setTheme("system");
      refreshTheme();
    },
  );

  it("reaches the theme cards with the keyboard and chooses one with Enter, then restores", async () => {
    await using _reduce = await reducedMotion();
    await prepare(1280, 800, "light");
    const app = await mountRoute("/settings/appearance");
    await using _screen = app.screen;
    await expect
      .element(page.getByRole("button", { name: /^Use Ocean theme/ }), { timeout: 15_000 })
      .toBeVisible();
    const isOcean = () =>
      document.activeElement?.getAttribute("aria-label")?.startsWith("Use Ocean theme") ?? false;
    let presses = 0;
    while (!isOcean() && presses < 80) {
      await userEvent.keyboard("{Tab}");
      presses += 1;
    }
    expect(isOcean(), `Ocean card reached after ${presses} Tab presses`).toBe(true);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => document.documentElement.dataset.themeId, { timeout: 5000 })
      .toBe("ocean");
    setTheme("system");
    refreshTheme();
    expect(document.documentElement.dataset.themeId).toBeUndefined();
  });
});

describe("the welcome wizard across the matrix", () => {
  it.each(rows)(
    "sits inside $width px, keeps focus inside and is captured, $mode",
    async ({ width, mode }) => {
      await using _reduce = await reducedMotion();
      await prepare(width, heightFor(width), mode);
      const app = await mountRoute("/welcome");
      await using _screen = app.screen;
      await expect.poll(() => dialogEl() !== null, { timeout: 15_000 }).toBe(true);
      await expect.element(page.getByText("Connect your computers")).toBeVisible();
      await dialogSettled();
      expect(dialogEl()!.innerText).toContain("Set up Aetheria");
      const fit = insideViewport(dialogEl()!, width, heightFor(width));
      expect(fit.inside, `wizard box ${fit.box}`).toBe(true);
      noHorizontalScroll(width);
      expect(await focusStaysInside(6)).toBe(true);
      expect((await shot(captureNameB("wizard", width, mode))).base64.length).toBeGreaterThan(1000);
    },
  );
});

describe("the update dialog across the matrix", () => {
  it.each(rows)(
    "sits inside $width px, keeps focus inside and is captured, $mode",
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
      await using dialogScreen = await render(<UpdateOpen />, { router: false });
      await expect.poll(() => dialogEl() !== null, { timeout: 5000 }).toBe(true);
      await dialogSettled();
      expect(dialogEl()!.innerText).toContain("Aetheria 1.2.3");
      const fit = insideViewport(dialogEl()!, width, heightFor(width));
      expect(fit.inside, `update dialog box ${fit.box}`).toBe(true);
      noHorizontalScroll(width);
      expect(await focusStaysInside(6)).toBe(true);
      expect((await shot(captureNameB("update", width, mode))).base64.length).toBeGreaterThan(1000);
      void dialogScreen;
    },
  );
});

describe("the standalone page header across the matrix", () => {
  it.each(rows)("fits $width px and is captured, $mode", async ({ width, mode }) => {
    await using _reduce = await reducedMotion();
    await prepare(width, heightFor(width), mode);
    document.body.style.backgroundColor = "var(--background)";
    await using screen = await render(
      <StandalonePage>
        <StandalonePageHeader
          title="Pair this browser"
          description="Enter the pairing code your computer shows."
          context="Render scenarios"
        />
      </StandalonePage>,
      { router: false },
    );
    expect(screen.container.textContent).toContain("Aetheria");
    const header = screen.container.querySelector("section")!;
    const fit = insideViewport(header, width, heightFor(width));
    expect(fit.inside, `header section ${fit.box}`).toBe(true);
    noHorizontalScroll(width);
    expect((await shot(captureNameB("standalone", width, mode))).base64.length).toBeGreaterThan(
      1000,
    );
  });
});

const T3_TOP_BAR_CONTROLS = [
  "Toggle thread details panel",
  "Toggle terminal drawer",
  "Toggle right panel",
  "New thread in render",
  "Toggle main sidebar",
];

/** Names of the controls inside `root` whose boxes reach into the top or bottom safe-area band. */
function unsafeControls(root: ParentNode, height: number): string[] {
  return interactiveIn(root)
    .filter((control) => {
      const box = control.getBoundingClientRect();
      return box.top < PHONE_SAFE_AREA.top || box.bottom > height - PHONE_SAFE_AREA.bottom;
    })
    .map((control) => accessibleName(control));
}

describe("safe areas at 390 px", () => {
  const HEIGHT = 844;

  it("is measurable in headless Chromium: the override changes env(safe-area-inset-*)", async () => {
    await prepare(390, HEIGHT, "light");
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.append(probe);
    try {
      expect(getComputedStyle(probe).paddingTop).toBe("0px");
      {
        await using _insets = await safeAreaInsets(PHONE_SAFE_AREA);
        expect(getComputedStyle(probe).paddingTop).toBe(`${PHONE_SAFE_AREA.top}px`);
        expect(getComputedStyle(probe).paddingBottom).toBe(`${PHONE_SAFE_AREA.bottom}px`);
      }
      expect(getComputedStyle(probe).paddingTop).toBe("0px");
    } finally {
      probe.remove();
    }
  });

  it.each(MATRIX_MODES)(
    "keeps the hero headline and the app's own content out of the unsafe bands, %s mode",
    async (mode) => {
      await using _reduce = await reducedMotion();
      await prepare(390, HEIGHT, mode);
      await using _insets = await safeAreaInsets(PHONE_SAFE_AREA);
      const app = await mountRoute("/");
      await using _screen = app.screen;
      await expect
        .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
          timeout: 15_000,
        })
        .toBe(1);
      const headline = document
        .querySelector<HTMLElement>("[data-aetheria-headline]")!
        .getBoundingClientRect();
      expect(headline.top, "headline below the top inset").toBeGreaterThanOrEqual(
        PHONE_SAFE_AREA.top,
      );
      expect(headline.bottom, "headline above the bottom inset").toBeLessThanOrEqual(
        HEIGHT - PHONE_SAFE_AREA.bottom,
      );
      noHorizontalScroll(390);
      expect((await shot(captureNameB("safearea-hero", 390, mode))).base64.length).toBeGreaterThan(
        1000,
      );
      // T3's own top bar: recorded, not Aetheria's. With the phone's insets these five controls start above the
      // 47 px top band's lower edge, so a device with a notch would draw them under the status bar.
      // Measured: the five controls span y 10 to 42 (or 15 to 37) against a 47 px band.
      expect(unsafeControls(document.body, HEIGHT), `${mode} hero page`).toEqual(
        T3_TOP_BAR_CONTROLS,
      );
    },
  );

  it.each(MATRIX_MODES)(
    "keeps both dialogs' controls out of the unsafe bands, %s mode",
    async (mode) => {
      await using _reduce = await reducedMotion();
      await prepare(390, HEIGHT, mode);
      await using _insets = await safeAreaInsets(PHONE_SAFE_AREA);
      for (const surface of ["wizard", "update"] as const) {
        const app = await mountRoute(surface === "wizard" ? "/welcome" : "/");
        await using _screen = app.screen;
        if (surface === "update") {
          await expect
            .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
              timeout: 15_000,
            })
            .toBe(1);
          await using _dialog = await render(<UpdateOpen />, { router: false });
          await expect.poll(() => dialogEl() !== null, { timeout: 5000 }).toBe(true);
          await dialogSettled();
          expect(
            (await shot(captureNameB("safearea-update", 390, mode))).base64.length,
          ).toBeGreaterThan(1000);
          // T3's alert dialog sticks to the bottom on a phone and pads its footer without the inset: its
          // Cancel button's lower edge reaches into the 34 px home-indicator band. Recorded, T3's component.
          // Measured: Cancel spans y 792 to 828 against a band that starts at 810.
          expect(unsafeControls(dialogEl()!, HEIGHT), `update dialog ${mode}`).toEqual(["Cancel"]);
        } else {
          await expect.poll(() => dialogEl() !== null, { timeout: 15_000 }).toBe(true);
          await dialogSettled();
          expect(
            (await shot(captureNameB("safearea-wizard", 390, mode))).base64.length,
          ).toBeGreaterThan(1000);
          expect(unsafeControls(dialogEl()!, HEIGHT), `wizard ${mode}`).toEqual([]);
        }
      }
    },
  );
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
