// The splash the page paints before the app mounts, in the default appearance, must use Aetheria's
// values, so a dark load does not flash T3's black before the Aetheria canvas.
import { tokenValues } from "@t3tools/aetheria-design";
import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../../index.html?raw";

type Mode = "light" | "dark";

const root = document.documentElement;
const bootScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)![1]!;
const bootStyle = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;

function pixel(css: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(",");
}

const token = (name: string, mode: Mode) => pixel(tokenValues[name]![mode]);

function freshPage(stored: Record<string, string>) {
  localStorage.clear();
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  root.removeAttribute("style");
  root.removeAttribute("class");
  delete root.dataset.themeId;
  delete root.dataset.themeSelected;
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = bootStyle;
  return {
    [Symbol.dispose]: () => {
      style.remove();
      localStorage.clear();
      root.removeAttribute("style");
      root.removeAttribute("class");
      delete root.dataset.themeSelected;
    },
  };
}

const modes: readonly Mode[] = ["light", "dark"];

describe("the boot script and splash style, default appearance", () => {
  it.each(modes)(
    "sets the %s chrome and splash variables to Aetheria's base, text and accent",
    (mode) => {
      using _page = freshPage({
        "t3code:theme": "system",
        "t3code:theme-appearance-mode": mode,
      });
      new Function(bootScript)();
      expect(root.classList.contains("dark")).toBe(mode === "dark");
      expect(root.dataset.themeId).toBeUndefined();
      expect(pixel(root.style.backgroundColor)).toBe(token("--ae-color-bg-base", mode));
      const variable = (name: string) => pixel(root.style.getPropertyValue(name).trim());
      expect(variable("--boot-background")).toBe(token("--ae-color-bg-base", mode));
      expect(variable("--boot-foreground")).toBe(token("--ae-color-label-primary", mode));
      expect(variable("--boot-accent")).toBe(token("--ae-color-accent", mode));
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor)
        expect(pixel(themeColor.getAttribute("content")!)).toBe(token("--ae-color-bg-base", mode));
    },
  );

  it.each(modes)(
    "styles the bare %s page before any theme is stored with the same values",
    (mode) => {
      using _page = freshPage({ "t3code:theme-appearance-mode": mode });
      new Function(bootScript)();
      const body = getComputedStyle(document.body);
      expect(pixel(body.backgroundColor)).toBe(token("--ae-color-bg-base", mode));
      expect(pixel(body.color)).toBe(token("--ae-color-label-primary", mode));
    },
  );

  it("leaves a selected palette's own splash colours alone", () => {
    using _page = freshPage({
      "t3code:theme": "ocean",
      "t3code:theme-appearance-mode": "dark",
    });
    new Function(bootScript)();
    expect(root.dataset.themeId).toBe("ocean");
    expect(pixel(root.style.getPropertyValue("--boot-background").trim())).not.toBe(
      token("--ae-color-bg-base", "dark"),
    );
  });
});
