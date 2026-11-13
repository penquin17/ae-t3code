// The goals and workflows card in a real browser (M10 Plan step 18, D14, XC-23). It is a static statement: M07 is not built, so the card makes no request, offers no control and invents no goal,
// workflow or progress. The images are evidence for a person to view; the assertions prove the words, the absence of controls, the layout and the contrast.
import { describe, expect, it } from "vitest";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../../test/render";
import { over, ratio, resolveColor, surfaceBehind } from "../../measure";
import { GoalsCard } from "./GoalsCard";

type Mode = "light" | "dark";

const cases = ([1280, 390] as const).flatMap((width) =>
  (["light", "dark"] as const).map((mode) => [width, mode] as const),
);

describe("the goals and workflows card", () => {
  it.each(cases)(
    "says goals and workflows are not built yet, with no control, at %i px, %s",
    async (width, mode: Mode) => {
      await page.viewport(width, width === 390 ? 844 : 900);
      setTheme("system");
      setAppearanceMode(mode);
      refreshTheme();
      await using screen = await render(
        <div className="min-h-svh bg-background">
          <main className="mx-auto w-full max-w-2xl p-4">
            <GoalsCard />
          </main>
        </div>,
        { router: false },
      );
      await expect
        .poll(() => document.body.textContent ?? "")
        .toContain("Goals and workflows are not built yet (M07).");
      const card = screen.container.querySelector<HTMLElement>("[data-aetheria='goals']")!;
      expect(card.querySelector("h2")?.textContent).toBe("Goals and workflows");
      expect(
        card.querySelectorAll("button, a, input, select, textarea, [role='button']"),
      ).toHaveLength(0);
      expect(card.textContent).not.toMatch(/\b(armed|paused|blocked|complete|pending|progress)\b/i);
      const heading = card.querySelector<HTMLElement>("h2")!;
      const behind = surfaceBehind(heading);
      expect(
        ratio(over(resolveColor(getComputedStyle(heading).color), behind.color), behind.color),
      ).toBeGreaterThanOrEqual(4.5);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await page.screenshot({
        base64: true,
        path: `__screenshots__/goals-${width}-${mode}.png`,
        save: true,
      });
    },
  );
});
