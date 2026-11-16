import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../test/render";

const LIGHT_MARK = "/aetheria/aetheria-mark-light.svg";
const DARK_MARK = "/aetheria/aetheria-mark-dark.svg";

function shownMarks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLImageElement>("img")]
    .filter((image) => getComputedStyle(image).display !== "none")
    .map((image) => new URL(image.src).pathname);
}

function shownMarkWidth(container: HTMLElement) {
  const shown = [...container.querySelectorAll<HTMLImageElement>("img")].find(
    (image) => getComputedStyle(image).display !== "none",
  );
  return shown ? shown.getBoundingClientRect().width : null;
}

function icon(driver: string, extra: { readonly size?: "default" | "compact" } = {}) {
  return (
    <ProviderInstanceIcon
      driverKind={ProviderDriverKind.make(driver)}
      displayName={driver}
      {...extra}
    />
  );
}

async function inAppearance<T>(mode: "light" | "dark", run: () => Promise<T>): Promise<T> {
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  try {
    return await run();
  } finally {
    setAppearanceMode("light");
    refreshTheme();
  }
}

describe("the Pi provider's icon is the Aetheria mark (IP-68)", () => {
  it("shows the light mark in light mode, in place of Pi's own glyph", async () => {
    await inAppearance("light", async () => {
      await using screen = await render(icon("pi"));
      expect(shownMarks(screen.container)).toEqual([LIGHT_MARK]);
      expect(screen.container.querySelector("svg")).toBeNull();
      expect(screen.container.querySelector("[data-provider-package-icon]")).toBeNull();
    });
  });

  it("shows the dark mark in dark mode", async () => {
    await inAppearance("dark", async () => {
      await using screen = await render(icon("pi"));
      expect(shownMarks(screen.container)).toEqual([DARK_MARK]);
    });
  });

  it("is decorative, so the provider's label is read where it is shown, as for the other icons", async () => {
    await using screen = await render(icon("pi"));
    const images = [...screen.container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("takes the size the other provider icons take, default and compact", async () => {
    await using wide = await render(icon("pi"));
    await using other = await render(icon("codex"));
    const mark = shownMarkWidth(wide.container);
    const glyph = other.container.querySelector("svg")?.getBoundingClientRect().width;
    expect(mark).toBe(20);
    expect(mark).toBe(glyph);
    await using compact = await render(icon("pi", { size: "compact" }));
    expect(shownMarkWidth(compact.container)).toBe(14);
  });
});

describe("the other providers keep their own icons", () => {
  it("keeps a built-in icon", async () => {
    await using screen = await render(icon("codex"));
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("svg")).not.toBeNull();
  });

  it("keeps a package icon", async () => {
    await using screen = await render(icon("opencode"));
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("[data-provider-package-icon]")).not.toBeNull();
  });

  it("keeps the initials of a driver with no icon", async () => {
    await using screen = await render(icon("unknownDriver"));
    expect(screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("svg")).toBeNull();
    expect(screen.container.textContent).not.toBe("");
  });
});
