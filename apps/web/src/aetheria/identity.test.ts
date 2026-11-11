// @effect-diagnostics nodeBuiltinImport:off - reads the web app's own source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_TAB_TITLE, resolveTabTitle } from "./brand";
import { startTitleSync } from "./titleSync";

const srcDir = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const webDir = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const read = (...parts: string[]) => NodeFS.readFileSync(NodePath.join(srcDir, ...parts), "utf8");
const readWeb = (...parts: string[]) =>
  NodeFS.readFileSync(NodePath.join(webDir, ...parts), "utf8");

// Built from parts: the registry check reads every committed file for the token.
const marker = (id: string) => ["AETHERIA-IP", id].join(":");
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

describe("tab titles", () => {
  it("is exactly 'Aetheria — Knowledge comes together' with no thread open", () => {
    expect(DEFAULT_TAB_TITLE).toBe("Aetheria \u2014 Knowledge comes together");
    expect(resolveTabTitle(null)).toBe(DEFAULT_TAB_TITLE);
  });

  it("is '<session title> — Aetheria' for an open thread, never a guessed title", () => {
    expect(resolveTabTitle("Fix the flaky tests")).toBe("Fix the flaky tests \u2014 Aetheria");
    expect(resolveTabTitle("   ")).toBe(DEFAULT_TAB_TITLE);
    expect(resolveTabTitle("")).toBe(DEFAULT_TAB_TITLE);
  });
});

describe("the title lifecycle", () => {
  function fakeSources(initial: string | null) {
    const listeners = new Set<() => void>();
    const written: string[] = [];
    let open = initial;
    return {
      written,
      set(next: string | null) {
        open = next;
        for (const listener of listeners) listener();
      },
      listenerCount: () => listeners.size,
      sources: {
        readOpenThreadTitle: () => open,
        subscribe: (notify: () => void) => {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        write: (title: string) => written.push(title),
      },
    };
  }

  it("writes the default title at start, then follows open, rename and close", () => {
    const world = fakeSources(null);
    const stop = startTitleSync(world.sources);
    world.set("First");
    world.set("First renamed");
    world.set(null);
    stop();
    expect(world.written).toEqual([
      DEFAULT_TAB_TITLE,
      "First \u2014 Aetheria",
      "First renamed \u2014 Aetheria",
      DEFAULT_TAB_TITLE,
    ]);
  });

  it("does not rewrite an unchanged title, and starts on an already open thread", () => {
    const world = fakeSources("Open now");
    const stop = startTitleSync(world.sources);
    world.set("Open now");
    world.set("Open now");
    stop();
    expect(world.written).toEqual(["Open now \u2014 Aetheria"]);
  });

  it("stops following when disposed", () => {
    const world = fakeSources(null);
    const stop = startTitleSync(world.sources);
    stop();
    expect(world.listenerCount()).toBe(0);
    world.set("Late");
    expect(world.written).toEqual([DEFAULT_TAB_TITLE]);
  });
});

describe("central branding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("names the local web app exactly Aetheria, with no stage suffix", async () => {
    vi.resetModules();
    const branding = await import("../branding");
    expect(branding.APP_BASE_NAME).toBe("Aetheria");
    expect(branding.APP_DISPLAY_NAME).toBe("Aetheria");
  });

  it("keeps the desktop shell's injected branding untouched", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getAppBranding: () => ({
          baseName: "T3 Code",
          stageLabel: "Dev",
          displayName: "T3 Code (Dev)",
        }),
      },
    });
    vi.resetModules();
    const branding = await import("../branding");
    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code (Dev)");
    expect(branding.APP_STAGE_LABEL).toBe("Dev");
  });
});

describe("the registered edit sites", () => {
  const sources: ReadonlyArray<readonly [string, string, () => string]> = [
    ["IP-29", "branding.ts", () => read("branding.ts")],
    ["IP-30", "appInit.tsx", () => read("appInit.tsx")],
    ["IP-31", "SidebarChrome.tsx", () => read("components/sidebar/SidebarChrome.tsx")],
    ["IP-32", "WelcomeWizard.tsx", () => read("components/onboarding/WelcomeWizard.tsx")],
    [
      "IP-33",
      "UpdateEverythingDialog.tsx",
      () => read("components/sidebar/UpdateEverythingDialog.tsx"),
    ],
    ["IP-34", "standalone-page.tsx", () => read("components/ui/standalone-page.tsx")],
    ["IP-35", "DraftHeroHeadline.tsx", () => read("components/chat/DraftHeroHeadline.tsx")],
    ["IP-36", "index.html", () => readWeb("index.html")],
    ["IP-37", "manifest.webmanifest", () => readWeb("public", "manifest.webmanifest")],
    ["IP-38", "threadNotifications.ts", () => read("threadNotifications.ts")],
  ];

  it.each(sources)(
    "%s marks %s exactly once, and no other site carries its token",
    (id, _name, load) => {
      expect(occurrences(load(), marker(id))).toBe(1);
      for (const [otherId, , otherLoad] of sources) {
        if (otherId !== id) expect(occurrences(otherLoad(), marker(id))).toBe(0);
      }
    },
  );

  it("keeps the marker out of this folder", () => {
    const folder = NodePath.join(srcDir, "aetheria");
    for (const entry of NodeFS.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|tsx|css)$/.test(entry.name)) continue;
      const text = NodeFS.readFileSync(NodePath.join(folder, entry.name), "utf8");
      for (const [id] of sources) expect(text, `${entry.name} ${id}`).not.toContain(marker(id));
    }
  });
});

describe("the named shell chrome (R3)", () => {
  it("replaces the sidebar label and wordmark", () => {
    const text = read("components/sidebar/SidebarChrome.tsx");
    expect(text).toContain('aria-label="Aetheria home"');
    expect(text).toContain("AetheriaWordmark");
    expect(text).not.toContain("T3Wordmark");
    expect(text).not.toContain("T3 Code");
  });

  it("replaces the welcome wizard title and identity, and keeps its instructional T3 strings", () => {
    const text = read("components/onboarding/WelcomeWizard.tsx");
    expect(text).toContain('title="Set up Aetheria"');
    expect(text).toContain("AetheriaWordmark");
    expect(text).not.toContain("T3Wordmark");
    expect(text).not.toContain('aria-label="T3 Code"');
    expect(text).toContain("T3 Code collects anonymous usage data");
    expect(text).toContain("Keep T3 Code running.");
    expect(text).toContain("start T3 Code or run");
  });

  it("replaces the update dialog's product name and keeps its actions", () => {
    const text = read("components/sidebar/UpdateEverythingDialog.tsx");
    expect(text).not.toContain("T3 Code");
    expect(text).toContain("<span>Aetheria</span>");
    expect(text).toContain('<span className="font-mono text-xs">{version}</span>');
    // The dialog's own props and handlers are not touched.
    for (const identifier of [
      "AlertDialogTitle",
      "AlertDialogDescription",
      "ScrollArea",
      "providerCount",
    ]) {
      expect(text, identifier).toContain(identifier);
    }
  });

  it("replaces the standalone page header", () => {
    const text = read("components/ui/standalone-page.tsx");
    expect(text).toContain("AetheriaWordmark");
    expect(text).not.toContain("T3Wordmark");
    expect(text).not.toContain("T3 Code");
  });

  it("leaves T3's own wordmark component and the Standard theme card name alone", () => {
    expect(read("components/T3Wordmark.tsx")).toContain("export function T3Wordmark");
    expect(read("components/settings/ThemePreviewCircles.tsx")).toContain('label: "T3 Code"');
  });
});

describe("the title seam in app init", () => {
  const text = read("appInit.tsx");

  it("hands the web title to the Aetheria lifecycle and leaves the desktop shell's alone", () => {
    expect(text).toContain("startAetheriaDocumentTitle");
    expect(text).toMatch(/startDocumentTitle\(router\)/);
    expect(text).toMatch(/if \(!isElectron\) \{[\s\S]{0,200}startAetheriaDocumentTitle/);
    expect(text).toContain("resolveServerBackedAppDisplayName");
  });
});

describe("the page title and manifest (R3, R4)", () => {
  it("gives the page the default tab title before any script runs", () => {
    expect(readWeb("index.html")).toContain(
      "<title>Aetheria \u2014 Knowledge comes together</title>",
    );
  });

  it("names the app Aetheria in the manifest", () => {
    const manifest = JSON.parse(readWeb("public", "manifest.webmanifest")) as Record<
      string,
      unknown
    >;
    expect(manifest.name).toBe("Aetheria");
    expect(manifest.short_name).toBe("Aetheria");
  });

  it("names the splash screen Aetheria", () => {
    const html = readWeb("index.html");
    expect(html).toContain('aria-label="Aetheria splash screen"');
    expect(html).toContain('alt="Aetheria"');
    expect(html).not.toContain("T3 Code");
  });
});
