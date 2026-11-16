import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../test/render";

const LIGHT_MARK = "/aetheria/aetheria-mark-light.svg";
const DARK_MARK = "/aetheria/aetheria-mark-dark.svg";
// The app's accent as the browser resolves it: the mark's own blue, lighter in dark mode (#2563eb, #60a5fa).
const ACCENT = { light: "rgb(37, 99, 235)", dark: "rgb(96, 165, 250)" } as const;

const BUILDER = "[data-aetheria-builder-mark]";

function shownImage(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLImageElement>("img")].find(
    (image) => getComputedStyle(image).display !== "none",
  );
}

function shownMarks(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLImageElement>("img")]
    .filter((image) => getComputedStyle(image).display !== "none")
    .map((image) => new URL(image.src).pathname);
}

function shownMarkWidth(container: HTMLElement) {
  return shownImage(container)?.getBoundingClientRect().width ?? null;
}

/** The T3 corner badge is the one `rounded-full` span; it holds the instance initials. */
const cornerBadge = (container: HTMLElement) => container.querySelector("span.rounded-full");

function icon(
  driver: string,
  extra: {
    readonly displayName?: string;
    readonly size?: "default" | "compact";
    readonly showBadge?: boolean;
  } = {},
) {
  const { displayName = driver, ...rest } = extra;
  return (
    <ProviderInstanceIcon
      driverKind={ProviderDriverKind.make(driver)}
      displayName={displayName}
      {...rest}
    />
  );
}

const aetheria = (
  extra: { readonly size?: "default" | "compact"; readonly showBadge?: boolean } = {},
) => icon("pi", { displayName: "Aetheria", ...extra });
const builder = (
  extra: { readonly size?: "default" | "compact"; readonly showBadge?: boolean } = {},
) => icon("pi", { displayName: "Aetheria Builder", ...extra });
const other = (
  extra: { readonly size?: "default" | "compact"; readonly showBadge?: boolean } = {},
) => icon("codex", { displayName: "Codex", ...extra });

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

describe("the Aetheria instance's icon is the plain Aetheria mark (IP-68)", () => {
  it("shows the light mark in light mode, in place of Pi's own glyph, with nothing inside", async () => {
    await inAppearance("light", async () => {
      await using screen = await render(aetheria());
      expect(shownMarks(screen.container)).toEqual([LIGHT_MARK]);
      expect(screen.container.querySelector("svg")).toBeNull();
      expect(screen.container.querySelector(BUILDER)).toBeNull();
      expect(screen.container.querySelector("[data-provider-package-icon]")).toBeNull();
    });
  });

  it("shows the dark mark in dark mode", async () => {
    await inAppearance("dark", async () => {
      await using screen = await render(aetheria());
      expect(shownMarks(screen.container)).toEqual([DARK_MARK]);
      expect(screen.container.querySelector("svg")).toBeNull();
    });
  });

  it("carries no corner badge and no initials, even where the caller asks for the badge", async () => {
    await using screen = await render(aetheria({ showBadge: true }));
    expect(cornerBadge(screen.container)).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("is decorative, so the provider's label is read where it is shown, as for the other icons", async () => {
    await using screen = await render(aetheria());
    const images = [...screen.container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("takes the size the other provider icons take, default and compact", async () => {
    await using wide = await render(aetheria());
    await using sibling = await render(other());
    const mark = shownMarkWidth(wide.container);
    const glyph = sibling.container.querySelector("svg")?.getBoundingClientRect().width;
    expect(mark).toBe(20);
    expect(mark).toBe(glyph);
    await using compact = await render(aetheria({ size: "compact" }));
    expect(shownMarkWidth(compact.container)).toBe(14);
  });
});

describe("the Builder instance's icon is the mark with a hammer inside it (IP-68)", () => {
  it.each(["light", "dark"] as const)(
    "shows the %s mark with the hammer centred in the wreath, in the accent colour",
    async (mode) => {
      await inAppearance(mode, async () => {
        await using screen = await render(builder());
        expect(shownMarks(screen.container)).toEqual([mode === "light" ? LIGHT_MARK : DARK_MARK]);
        const wrapper = screen.container.querySelector<HTMLElement>(BUILDER)!;
        expect(wrapper).not.toBeNull();
        const hammer = wrapper.querySelector<SVGElement>("svg")!;
        expect(wrapper.querySelectorAll("svg")).toHaveLength(1);
        expect(hammer.getAttribute("aria-hidden")).toBe("true");
        expect(getComputedStyle(hammer).color).toBe(ACCENT[mode]);

        // Inside the mark's box, on its vertical axis, a little below the middle (the wreath's open middle, under the spark).
        const mark = shownImage(screen.container)!.getBoundingClientRect();
        const glyph = hammer.getBoundingClientRect();
        expect(glyph.left).toBeGreaterThanOrEqual(mark.left);
        expect(glyph.right).toBeLessThanOrEqual(mark.right);
        expect(glyph.top).toBeGreaterThanOrEqual(mark.top);
        expect(glyph.bottom).toBeLessThanOrEqual(mark.bottom);
        const across = (glyph.left + glyph.right) / 2 - (mark.left + mark.right) / 2;
        expect(Math.abs(across)).toBeLessThan(0.5);
        const down = ((glyph.top + glyph.bottom) / 2 - mark.top) / mark.height;
        expect(down).toBeGreaterThan(0.5);
        expect(down).toBeLessThan(0.62);
        expect(glyph.width / mark.width).toBeLessThan(0.5);
      });
    },
  );

  it("carries no corner badge and no initials, even where the caller asks for the badge", async () => {
    await using screen = await render(builder({ showBadge: true }));
    expect(cornerBadge(screen.container)).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("is decorative: empty alt and aria-hidden on both images", async () => {
    await using screen = await render(builder());
    const images = [...screen.container.querySelectorAll("img")];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("takes the size of the plain mark, default and compact", async () => {
    await using wide = await render(builder());
    expect(shownMarkWidth(wide.container)).toBe(20);
    expect(wide.container.querySelector<HTMLElement>(BUILDER)!.getBoundingClientRect().width).toBe(
      20,
    );
    await using compact = await render(builder({ size: "compact" }));
    expect(shownMarkWidth(compact.container)).toBe(14);
    expect(
      compact.container.querySelector<HTMLElement>(BUILDER)!.getBoundingClientRect().width,
    ).toBe(14);
  });

  it("is told by its display name: the exact name, in any case or padding; any other Pi name is the plain mark", async () => {
    for (const name of ["aetheria builder", "  Aetheria Builder "]) {
      await using screen = await render(icon("pi", { displayName: name }));
      expect(screen.container.querySelector(BUILDER), name).not.toBeNull();
    }
    for (const name of ["Aetheria", "Pi", "Builder", "Aetheria Builder Two"]) {
      await using screen = await render(icon("pi", { displayName: name }));
      expect(screen.container.querySelector(BUILDER), name).toBeNull();
    }
    await using notPi = await render(icon("codex", { displayName: "Aetheria Builder" }));
    expect(notPi.container.querySelector(BUILDER)).toBeNull();
    expect(notPi.container.querySelector("img")).toBeNull();
  });
});

describe("the other providers keep their own icons and badges", () => {
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

  it("keeps its corner badge with the instance initials", async () => {
    await using screen = await render(other({ showBadge: true }));
    expect(cornerBadge(screen.container)).not.toBeNull();
    expect(screen.container.textContent).not.toBe("");
    await using noBadge = await render(other());
    expect(cornerBadge(noBadge.container)).toBeNull();
  });
});

/** Aetheria, Builder and one other provider, each at 20 px and compact, with the badge asked for on all of them. */
function lineup() {
  const row = (size: "default" | "compact") => (
    <div className="flex items-center gap-5">
      {aetheria({ size, showBadge: true })}
      {builder({ size, showBadge: true })}
      {other({ size, showBadge: true })}
    </div>
  );
  return (
    <div
      id="provider-mark-lineup"
      className="inline-flex flex-col gap-4 bg-background p-4 text-foreground"
    >
      {row("default")}
      {row("compact")}
    </div>
  );
}

describe("captures of the three icons", () => {
  it.each(["light", "dark"] as const)(
    "saves the %s lineup at true size and enlarged",
    async (mode) => {
      await inAppearance(mode, async () => {
        await using screen = await render(lineup());
        const frame = screen.container.querySelector<HTMLElement>("#provider-mark-lineup")!;
        await page.elementLocator(frame).screenshot({
          base64: true,
          path: `__screenshots__/providerMark-${mode}.png`,
          save: true,
        });
        // The same frame enlarged, as far as the page is wide: the true-size image is 20 and 14 px, too small to judge the glyph by eye.
        // A capture is cut off at the viewport's edge, so the frame must end inside it, or the right-hand icons would be blank.
        const available = document.documentElement.clientWidth;
        const zoom = Math.max(1, Math.min(8, Math.floor(available / frame.offsetWidth)));
        frame.style.zoom = String(zoom);
        const shown = frame.getBoundingClientRect();
        expect(zoom).toBeGreaterThan(1);
        expect(shown.left).toBeGreaterThanOrEqual(0);
        expect(shown.right).toBeLessThanOrEqual(available);
        expect(shown.bottom).toBeLessThanOrEqual(window.innerHeight);
        await page.elementLocator(frame).screenshot({
          base64: true,
          path: `__screenshots__/providerMark-${mode}-zoom.png`,
          save: true,
        });
        expect(frame.querySelectorAll(BUILDER)).toHaveLength(2);
      });
    },
  );
});
