import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { StandalonePageHeader } from "~/components/ui/standalone-page";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../test/render";
import { AetheriaWordmark } from "./AetheriaWordmark";

function shownMarks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLImageElement>("img")]
    .filter((image) => getComputedStyle(image).display !== "none")
    .map((image) => new URL(image.src).pathname);
}

describe("the Aetheria wordmark", () => {
  it("shows the name as text and the light mark in light mode", async () => {
    setTheme("system");
    setAppearanceMode("light");
    refreshTheme();
    await using screen = await render(<AetheriaWordmark />);
    expect(screen.container.textContent).toBe("Aetheria");
    expect(shownMarks(screen.container)).toEqual(["/aetheria/aetheria-mark-light.svg"]);
  });

  it("follows the app's dark appearance, not the system's", async () => {
    setTheme("system");
    setAppearanceMode("dark");
    refreshTheme();
    try {
      await using screen = await render(<AetheriaWordmark />);
      expect(shownMarks(screen.container)).toEqual(["/aetheria/aetheria-mark-dark.svg"]);
    } finally {
      setAppearanceMode("light");
      refreshTheme();
    }
  });

  it("hides the mark from assistive technology so the name is read once", async () => {
    await using screen = await render(<AetheriaWordmark />);
    for (const image of screen.container.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("the standalone page header", () => {
  it("shows Aetheria instead of T3 Code and keeps its title, description and context", async () => {
    await using screen = await render(
      <StandalonePageHeader
        title="Pair this browser"
        description="Enter the code."
        context="ctx"
      />,
    );
    expect(screen.container.textContent).toContain("Aetheria");
    expect(screen.container.textContent).not.toContain("T3");
    expect(screen.container.querySelector("h1")?.textContent).toBe("Pair this browser");
    expect(screen.container.textContent).toContain("Enter the code.");
    expect(screen.container.textContent).toContain("ctx");
  });
});
