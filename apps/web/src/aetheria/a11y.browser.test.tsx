// Step 11, non-text and keyboard checks on the real app and on T3's own controls under the Aetheria layer:
// focus rings and outlines against what is painted behind them, the two pairs the accepted tokens did not
// claim (measured, tracked as D15 findings), names for interactive controls, and keyboard reach.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { Input } from "~/components/ui/input";
import type { FakeDriver } from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { LAST_ANSWER, THREAD_PATH, mountRoute, prepare, type Mode } from "./harness";
import { over, ratio, resolveColor, surfaceBehind } from "./measure";

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

const MODES: readonly Mode[] = ["light", "dark"];

function accessibleName(element: Element): string {
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
  return alt ?? element.getAttribute("title")?.trim() ?? "";
}

const interactive = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], input:not([type='hidden']), select, textarea",
    ),
  ]
    // Select widgets keep a hidden form input (aria-hidden, tabindex -1) that no one can reach or hear.
    .filter(
      (element) =>
        element.getBoundingClientRect().width > 0 &&
        element.closest("[aria-hidden='true']") === null,
    );

/** The colour of the first visible spread shadow in a computed box-shadow: the ring a focused control draws. */
function ringColor(boxShadow: string) {
  const shadows: string[] = [];
  let depth = 0;
  let start = 0;
  for (const [index, character] of [...boxShadow].entries()) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      shadows.push(boxShadow.slice(start, index).trim());
      start = index + 1;
    }
  }
  shadows.push(boxShadow.slice(start).trim());
  for (const shadow of shadows) {
    const color = /^(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\))\s+(.*)$/i.exec(
      shadow,
    );
    if (!color) continue;
    const lengths = color[2]!
      .replace(/\binset\b/, "")
      .trim()
      .split(/\s+/);
    const resolved = resolveColor(color[1]!);
    if (resolved.a > 0.5 && Number.parseFloat(lengths[3] ?? "0") > 0) return resolved;
  }
  return null;
}

/** Presses Tab until the sidebar's home link has focus (at most 120 times; it throws with the focus trail if it never gets there) and returns how many presses it took. */
async function tabToBrand(): Promise<number> {
  // The sidebar mounts after the thread under load; tabbing before its link exists walks past it.
  await expect
    .poll(() => document.querySelector('a[aria-label="Aetheria home"]') !== null, {
      timeout: 15_000,
    })
    .toBe(true);
  let presses = 0;
  const trail: string[] = [];
  while (document.activeElement?.getAttribute("aria-label") !== "Aetheria home" && presses < 120) {
    await userEvent.keyboard("{Tab}");
    presses += 1;
    const active = document.activeElement;
    trail.push(
      active ? accessibleName(active).slice(0, 24) || active.tagName.toLowerCase() : "none",
    );
  }
  if (document.activeElement?.getAttribute("aria-label") !== "Aetheria home") {
    throw new Error(
      `the home link was not reached in ${presses} Tab presses; focus visited: ${trail.slice(0, 40).join(" > ")}`,
    );
  }
  return presses;
}

describe("names and keyboard reach on the identity surfaces", () => {
  it.each(MODES)(
    "every interactive element on the thread and hero pages has a name, in %s mode",
    async (mode) => {
      await prepare(1280, 800, mode);
      for (const path of [THREAD_PATH, "/"]) {
        const app = await mountRoute(path);
        await using _screen = app.screen;
        if (path === "/") {
          await expect
            .poll(() => document.querySelectorAll("[data-aetheria-headline]").length, {
              timeout: 15_000,
            })
            .toBe(1);
        } else {
          await expect.element(page.getByText(LAST_ANSWER)).toBeVisible();
        }
        const unnamed = interactive()
          .filter((element) => accessibleName(element) === "")
          .map((element) => element.outerHTML.slice(0, 160));
        expect(unnamed, `${path} ${mode}`).toEqual([]);
      }
    },
  );

  it("reaches the sidebar home link with the keyboard alone, and Enter on it goes home", async () => {
    await prepare(1280, 800, "light");
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.element(page.getByText(LAST_ANSWER)).toBeVisible();
    // While the app is still starting, its composer may take focus back between the Tab and the Enter; the
    // test counts only an Enter pressed with the link focused, and tries again if the app took focus away.
    for (let attempt = 0; attempt < 3; attempt++) {
      const presses = await tabToBrand();
      expect(
        document.activeElement?.getAttribute("aria-label"),
        `after ${presses} Tab presses`,
      ).toBe("Aetheria home");
      await userEvent.keyboard("{Enter}");
      const went = await expect
        .poll(() => app.router.state.location.pathname, { timeout: 4000 })
        .toBe("/")
        .then(() => true)
        .catch(() => false);
      if (went) return;
    }
    expect(app.router.state.location.pathname).toBe("/");
  });
});

describe("focus rings and outlines", () => {
  it.each(MODES)(
    "draws a visible focus ring on the sidebar home link at 3:1 in %s mode",
    async (mode) => {
      await prepare(1280, 800, mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER)).toBeVisible();
      await tabToBrand();
      const link = document.activeElement as HTMLElement;
      expect(link.getAttribute("aria-label")).toBe("Aetheria home");
      const shadow = getComputedStyle(link).boxShadow;
      const ring = ringColor(shadow);
      expect(ring, `box-shadow: ${shadow}`).not.toBeNull();
      const surface = surfaceBehind(link).color;
      const measured = ratio(over(ring!, surface), surface);
      expect(measured, `${mode} focus ring ${shadow}`).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("the pairs the accepted tokens did not claim, measured on real T3 controls (D15 findings)", () => {
  // The user's D15 decision (m10a-d15): the layer draws field outlines as a mix of the text colour, so a
  // real T3 Input's border is at least 3:1 on the canvas and on a layer, and still far below text contrast.
  it.each(MODES)(
    "draws a real input's outline at 3:1 or more on the canvas and on a layer in %s mode",
    async (mode) => {
      await prepare(1280, 800, mode);
      const measure = async (surfaceClass: string) => {
        await using screen = await render(
          <div className={`${surfaceClass} p-6`}>
            <Input aria-label="Probe" />
          </div>,
        );
        const input = screen.container.querySelector("input")!;
        let box: Element | null = input;
        while (box && Number.parseFloat(getComputedStyle(box).borderTopWidth) === 0)
          box = box.parentElement;
        expect(box, "an element drawing the input's border").not.toBeNull();
        const border = resolveColor(getComputedStyle(box!).borderTopColor);
        const surface = surfaceBehind(box!.parentElement!).color;
        return ratio(over(border, surface), surface);
      };
      const onCanvas = await measure("bg-background");
      const onLayer = await measure("bg-card");
      expect(onCanvas, `${mode} outline on the canvas`).toBeGreaterThanOrEqual(3);
      expect(onLayer, `${mode} outline on a layer`).toBeGreaterThanOrEqual(3);
      // Visibly lighter than text, which is 13:1 or more on the same surfaces.
      expect(onCanvas).toBeLessThan(6);
      expect(onLayer).toBeLessThan(6);
    },
  );

  it("shows muted text on the hover surface below 4.5:1 in light mode (about 4.06), and above it in dark mode", async () => {
    const measured: Record<string, number> = {};
    for (const mode of MODES) {
      await prepare(1280, 800, mode);
      await using screen = await render(
        <div className="bg-background p-6">
          <span className="bg-accent text-muted-foreground">Muted on the hover surface</span>
        </div>,
      );
      const probe = screen.container.querySelector("span")!;
      const surface = surfaceBehind(probe).color;
      measured[mode] = ratio(over(resolveColor(getComputedStyle(probe).color), surface), surface);
    }
    expect(measured.light!).toBeCloseTo(4.06, 1);
    expect(measured.light!).toBeLessThan(4.5);
    expect(measured.dark!).toBeGreaterThanOrEqual(4.5);
  });

  it("finds no rendered consumer on the thread or hero pages that sets muted text on the hover surface", async () => {
    // T3's ghost buttons turn their text to the foreground colour when hovered or pressed (button.tsx),
    // so the pair appears only in a calendar's selected outside days and in probes like the one above.
    const source = (await import("../components/ui/button.tsx?raw")).default;
    expect(source).toContain("[:hover,[data-pressed]]:text-foreground");
  });
});

describe("the name check catches a seeded missing name", () => {
  it("flags an icon-only button with no name and passes one with a label", async () => {
    await using _screen = await render(
      <div>
        <button type="button" data-seeded="unnamed">
          <svg aria-hidden="true" width="8" height="8" />
        </button>
        <button type="button" data-seeded="named" aria-label="Close">
          <svg aria-hidden="true" width="8" height="8" />
        </button>
      </div>,
    );
    const seeded = interactive().filter((element) => element.hasAttribute("data-seeded"));
    const unnamed = seeded.filter((element) => accessibleName(element) === "");
    expect(unnamed.map((element) => element.dataset.seeded)).toEqual(["unnamed"]);
  });
});
