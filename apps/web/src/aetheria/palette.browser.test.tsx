import { compositeOver, parseColor, t3Mapping, t3Resolved } from "@t3tools/aetheria-design";
import type { ThemeDefinition } from "@t3tools/shared/themePalettes";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { applyAppearanceContrast } from "~/appearanceContrast";
import { applyAppearanceFontVariables } from "~/appearanceFonts";
import { Button } from "~/components/ui/button";
import { ThemeLibrary } from "~/components/settings/ThemeSettings";
import { ComposerSurface } from "~/components/chat/ComposerSurface";
import { refreshTheme, setAppearanceMode, setTheme, useTheme } from "~/hooks/useTheme";
import { useCustomThemes } from "~/hooks/useCustomThemes";
import {
  applyThemeColorPreview,
  CUSTOM_THEMES_STORAGE_KEY,
  installCustomTheme,
  OCEAN_THEME,
  removeCustomTheme,
  THEME_PREVIEW_ID,
} from "~/themePalette";
import indexHtml from "../../index.html?raw";
import { render } from "../../test/render";

type Mode = "light" | "dark";
type Pixel = readonly [number, number, number];

const UNDERLAY = { r: 128, g: 128, b: 128, a: 1 };
const root = document.documentElement;

function paint(css: string): Pixel {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "rgb(128 128 128)";
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

function expectedPixel(variable: string, mode: Mode): Pixel {
  const mixed = compositeOver(parseColor(t3Resolved[variable]![mode]), UNDERLAY);
  return [Math.round(mixed.r), Math.round(mixed.g), Math.round(mixed.b)];
}

function rendered(variable: string, host: HTMLElement = document.body): Pixel {
  const probe = document.createElement("div");
  probe.style.backgroundColor = `var(${variable})`;
  host.append(probe);
  try {
    return paint(getComputedStyle(probe).backgroundColor);
  } finally {
    probe.remove();
  }
}

function themeColor(theme: ThemeDefinition, key: "canvas" | "text"): Pixel {
  const probe = document.createElement("div");
  probe.style.backgroundColor = theme.colors[key];
  document.body.append(probe);
  try {
    return paint(getComputedStyle(probe).backgroundColor);
  } finally {
    probe.remove();
  }
}

function sidebarHost() {
  const element = document.createElement("div");
  element.setAttribute("data-app-sidebar", "");
  document.body.append(element);
  return { element, [Symbol.dispose]: () => element.remove() };
}

function expectClose(actual: Pixel, expected: Pixel, tolerance: number, label: string) {
  for (const index of [0, 1, 2] as const) {
    expect(
      Math.abs(actual[index] - expected[index]),
      `${label}: ${actual} vs ${expected}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

function expectAetheria(mode: Mode, host?: HTMLElement) {
  for (const entry of t3Mapping) {
    expectClose(
      rendered(entry.variable, host),
      expectedPixel(entry.variable, mode),
      entry.overlay || entry.mix ? 2 : 1,
      `${mode} ${entry.variable}`,
    );
  }
}

const probeTheme: ThemeDefinition = {
  ...OCEAN_THEME,
  id: "aetheria-probe-theme",
  label: "Aetheria probe",
  appearance: "light",
  colors: { ...OCEAN_THEME.colors, canvas: "#123456", text: "#fedcba" },
};

function resetAppearance() {
  localStorage.clear();
  root.removeAttribute("style");
  delete root.dataset.themeId;
  delete root.dataset.themeSelected;
  root.classList.remove("dark");
  setTheme("system");
  setAppearanceMode("light");
  refreshTheme();
}

/** A fresh standard light appearance, put back when the test ends. */
function freshAppearance() {
  resetAppearance();
  return {
    [Symbol.dispose]: () => {
      try {
        removeCustomTheme(probeTheme.id);
      } catch {}
      resetAppearance();
    },
  };
}

function Appearance() {
  const {
    theme,
    setTheme,
    appearanceMode,
    setAppearanceMode,
    themeHalves,
    setThemeHalf,
    resolvedTheme,
  } = useTheme();
  const customThemes = useCustomThemes();
  return (
    <ThemeLibrary
      theme={theme}
      setTheme={setTheme}
      appearanceMode={appearanceMode}
      setAppearanceMode={setAppearanceMode}
      customThemes={customThemes}
      initialAppearance={resolvedTheme}
      refreshTheme={refreshTheme}
      isImportOpen={false}
      onImportOpenChange={() => {}}
      themeHalves={themeHalves}
      setThemeHalf={setThemeHalf}
    />
  );
}

describe("the default appearance", () => {
  it("renders Aetheria's light values on the root, the sidebar subtree and real controls", async () => {
    using _appearance = freshAppearance();
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("light");
    using sidebar = sidebarHost();
    expectAetheria("light", sidebar.element);
    await using screen = await render(<Button>Send</Button>);
    const button = screen.getByRole("button", { name: "Send" }).element() as HTMLElement;
    const style = getComputedStyle(button);
    expectClose(
      paint(style.backgroundColor),
      expectedPixel("--primary", "light"),
      1,
      "Button fill",
    );
    expectClose(
      paint(style.color),
      expectedPixel("--primary-foreground", "light"),
      1,
      "Button label",
    );
  });

  it("renders Aetheria's dark values after the real mode control", async () => {
    using _appearance = freshAppearance();
    await using screen = await render(<Appearance />);
    await screen.getByRole("button", { name: "Use dark mode" }).click();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("dark");
    using sidebar = sidebarHost();
    expectAetheria("dark", sidebar.element);
  });

  it("keeps Aetheria in the sidebar subtree where T3 redeclares its own dark values", () => {
    using _appearance = freshAppearance();
    setAppearanceMode("dark");
    using sidebar = sidebarHost();
    for (const variable of ["--secondary-label", "--sidebar-row-hover", "--card"]) {
      expectClose(
        rendered(variable, sidebar.element),
        expectedPixel(variable, "dark"),
        1,
        `sidebar ${variable}`,
      );
    }
  });
});

describe("Appearance and custom palettes stay in charge", () => {
  it("lets a built-in palette chosen in Appearance win in both modes, root and sidebar", async () => {
    using _appearance = freshAppearance();
    await using screen = await render(<Appearance />);
    await screen.getByRole("button", { name: /^Use Ocean theme/ }).click();
    expect(root.dataset.themeId).toBe("ocean");
    using sidebar = sidebarHost();
    expectClose(rendered("--background"), themeColor(OCEAN_THEME, "canvas"), 2, "ocean canvas");
    expectClose(rendered("--foreground"), themeColor(OCEAN_THEME, "text"), 2, "ocean text");
    expectClose(
      rendered("--background", sidebar.element),
      themeColor(OCEAN_THEME, "canvas"),
      2,
      "ocean canvas in sidebar",
    );
    expect(rendered("--background")).not.toEqual(expectedPixel("--background", "light"));
    await screen.getByRole("button", { name: "Use dark mode" }).click();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset.themeId).toBe("ocean");
    expect(rendered("--background")).not.toEqual(expectedPixel("--background", "dark"));
  });

  it("lets a custom palette win, including inside the sidebar subtree", () => {
    using _appearance = freshAppearance();
    installCustomTheme(probeTheme);
    expect(setTheme(probeTheme.id)).toBe(true);
    expect(root.dataset.themeId).toBe(probeTheme.id);
    using sidebar = sidebarHost();
    expectClose(rendered("--background"), themeColor(probeTheme, "canvas"), 2, "custom canvas");
    expectClose(
      rendered("--foreground", sidebar.element),
      themeColor(probeTheme, "text"),
      2,
      "custom text in sidebar",
    );
  });

  it("does not clobber a preview, and cancelling it restores the stored selection", () => {
    using _appearance = freshAppearance();
    installCustomTheme(probeTheme);
    setTheme(probeTheme.id);
    applyThemeColorPreview(OCEAN_THEME.colors, "dark");
    expect(root.dataset.themeId).toBe(THEME_PREVIEW_ID);
    expect(root.classList.contains("dark")).toBe(true);
    expectClose(rendered("--background"), themeColor(OCEAN_THEME, "canvas"), 2, "preview canvas");
    refreshTheme();
    expect(root.dataset.themeId).toBe(probeTheme.id);
    expectClose(
      rendered("--background"),
      themeColor(probeTheme, "canvas"),
      2,
      "restored custom canvas",
    );

    setTheme("system");
    applyThemeColorPreview(OCEAN_THEME.colors, "dark");
    expect(rendered("--background")).not.toEqual(expectedPixel("--background", "dark"));
    refreshTheme();
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("light");
  });
});

describe("a change scenario: default, palette, mode, reload, reset", () => {
  it("returns to Aetheria and keeps fonts, size, contrast and the custom theme library", () => {
    using _appearance = freshAppearance();
    applyAppearanceFontVariables(root, {
      sans: "Georgia",
      code: "",
      composer: "",
      sizeInterface: 15,
      sizePrompt: 14,
      sizeCode: 12,
      smoothing: true,
      separate: false,
    });
    applyAppearanceContrast(root, 120);
    const fontStack = root.style.getPropertyValue("--font-sans");
    expect(fontStack).toContain("Georgia");
    const contrast = root.style.getPropertyValue("--appearance-contrast-boost");

    installCustomTheme(probeTheme);
    const storedLibrary = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    setTheme("ocean");
    setAppearanceMode("dark");
    expect(root.dataset.themeId).toBe("ocean");

    setTheme("system");
    setAppearanceMode("light");
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("light");
    expect(root.style.getPropertyValue("--app-theme-canvas")).toBe("");
    expect(root.style.getPropertyValue("--font-sans")).toBe(fontStack);
    expect(root.style.fontSize).toBe("15px");
    expect(root.style.getPropertyValue("--appearance-contrast-boost")).toBe(contrast);
    expect(localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY)).toBe(storedLibrary);
  });

  it("shows the same appearance after a reload: the page's own boot script, then the mounted app", () => {
    using _appearance = freshAppearance();
    const bootScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)![1]!;
    const reload = () => {
      root.removeAttribute("style");
      delete root.dataset.themeId;
      delete root.dataset.themeSelected;
      root.classList.remove("dark");
      new Function(bootScript)();
    };

    setAppearanceMode("dark");
    reload();
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("dark");
    refreshTheme();
    expectAetheria("dark");

    setTheme("ocean");
    reload();
    expect(root.dataset.themeId).toBe("ocean");
    expect(rendered("--background")).not.toEqual(expectedPixel("--background", "dark"));
    refreshTheme();
    expect(root.dataset.themeId).toBe("ocean");

    setTheme("system");
    reload();
    expect(root.dataset.themeId).toBeUndefined();
    expectAetheria("dark");
  });
});

const MODES: readonly Mode[] = ["light", "dark"];

function paintOver(under: string, over: string): Pixel {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = under;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = over;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

describe("variables T3 derives or reads elsewhere follow the mapped roles", () => {
  it("keeps the send button, destructive, update, toolbar, terminal and icon colours on Aetheria", () => {
    using _appearance = freshAppearance();
    const derived: ReadonlyArray<readonly [string, string]> = [
      ["--message-action", "--primary"],
      ["--message-action-foreground", "--primary-foreground"],
      ["--destructive", "--error"],
      ["--update", "--primary"],
      ["--app-chrome-background", "--background"],
      ["--toolbar-background", "--background"],
      ["--terminal-background", "--background"],
      ["--placeholder", "--muted-foreground"],
      ["--icon-muted", "--muted-foreground"],
    ];
    for (const mode of MODES) {
      setAppearanceMode(mode);
      for (const [variable, mapped] of derived) {
        expectClose(
          rendered(variable),
          expectedPixel(mapped, mode),
          1,
          `${mode} ${variable} follows ${mapped}`,
        );
      }
    }
  });
});

describe("the composer surface and the send button", () => {
  // The utility classes ComposerPrimaryActions gives its round send button.
  const SEND_BUTTON =
    "bg-message-action text-message-action-foreground disabled:bg-foreground/12 disabled:text-muted-foreground";

  it.each(MODES)("use Aetheria's raised layer and accent in %s mode", async (mode) => {
    using _appearance = freshAppearance();
    setAppearanceMode(mode);
    await using screen = await render(
      <ComposerSurface.Shell>
        <div data-probe="glass" style={{ backgroundColor: "var(--chat-composer-glass-surface)" }} />
        <button type="button" data-probe="enabled" className={SEND_BUTTON}>
          Send
        </button>
        <button type="button" disabled data-probe="disabled" className={SEND_BUTTON}>
          Send
        </button>
      </ComposerSurface.Shell>,
    );
    const probe = (name: string) =>
      screen.container.querySelector<HTMLElement>(`[data-probe="${name}"]`)!;
    const surface = getComputedStyle(probe("glass")).backgroundColor;
    expectClose(paint(surface), expectedPixel("--surface-raised", mode), 1, "composer glass");

    const enabled = getComputedStyle(probe("enabled"));
    expectClose(
      paint(enabled.backgroundColor),
      expectedPixel("--primary", mode),
      1,
      "enabled send",
    );
    expectClose(paint(enabled.color), expectedPixel("--primary-foreground", mode), 1, "send label");

    // An empty composer disables the button: T3 tints it with the text colour at 12%.
    const disabled = getComputedStyle(probe("disabled"));
    const expected = compositeOver(
      { ...parseColor(t3Resolved["--foreground"]![mode]), a: 0.12 },
      parseColor(t3Resolved["--surface-raised"]![mode]),
    );
    const fill = paintOver(surface, disabled.backgroundColor);
    expectClose(
      fill,
      [Math.round(expected.r), Math.round(expected.g), Math.round(expected.b)],
      2,
      "disabled send",
    );
    expect(fill).not.toEqual(expectedPixel("--primary", mode));
  });
});
