// Mounts the whole app on a fake-environment thread in Aetheria's default appearance and
// captures it. The screenshots are evidence for a person to view; the assertions prove the
// app rendered Aetheria's values. The images land in the git-ignored __screenshots__ folder.
import { createMemoryHistory } from "@tanstack/react-router";
import { compositeOver, parseColor, t3Resolved } from "@t3tools/aetheria-design";
import type { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

// The socket is the only fake layer, as in test/appScenarios.renders.tsx.
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

const HISTORY_TURNS = 6;
const THREAD = threadWithHistory("thread-capture", HISTORY_TURNS);
const THREAD_ID = THREAD.id as ThreadId;
const root = document.documentElement;

type Mode = "light" | "dark";
// The test build runs as T3's Dev stage, whose artwork replaces the send button's fill and the
// sidebar's top backdrop. A release build has no stage art; "none" shows what that looks like.
type Identification = "artwork" | "none";

installFakeEnvironment([THREAD]);

function canvasPixel(color: string, over?: string): readonly [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  if (over !== undefined) context.fillStyle = over;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

async function capture(width: number, height: number, mode: Mode, identification: Identification) {
  await page.viewport(width, height);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    environmentIdentificationMode: identification,
  });
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${THREAD_ID}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = `height: ${height}px; width: ${width}px;`;
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect
    .element(page.getByText(`Answer ${HISTORY_TURNS - 1} for ${THREAD_ID}.`))
    .toBeVisible();
  expect(root.dataset.themeId).toBeUndefined();
  expect(root.classList.contains("dark")).toBe(mode === "dark");
  // The app syncs the browser chrome from its main surface once that has mounted.
  refreshTheme();
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const base = compositeOver(parseColor(t3Resolved["--background"]![mode]), black);
  const surface = document.querySelector("main[data-slot='sidebar-inset']")!;
  expect(canvasPixel(getComputedStyle(surface).backgroundColor)).toEqual([base.r, base.g, base.b]);
  expect(canvasPixel(getComputedStyle(root).backgroundColor)).toEqual([base.r, base.g, base.b]);

  // The composer reads --surface-raised in dark mode and --card in light mode; both are Aetheria's layer.
  const shell = document.querySelector<HTMLElement>('[data-slot="composer-shell"]');
  expect(shell, "composer shell").not.toBeNull();
  const glass = getComputedStyle(shell!).getPropertyValue("--chat-composer-glass-surface").trim();
  const layer = compositeOver(parseColor(t3Resolved["--surface-raised"]![mode]), black);
  expect(canvasPixel(glass), "composer glass surface").toEqual([layer.r, layer.g, layer.b]);

  // The phone layout collapses the composer into its own control, without a send button.
  if (width >= 768) {
    const send = shell!.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(send, "send button").not.toBeNull();
    // The fixture's composer is empty, so the button is disabled.
    expect(send!.disabled).toBe(true);
    const style = getComputedStyle(send!);
    const hasStageArt = send!.querySelector("span[aria-hidden]") !== null;
    expect(hasStageArt).toBe(identification === "artwork");
    if (identification === "artwork") {
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.opacity).toBe("0.64");
    } else {
      // Release build: the text colour at 12% over the composer.
      const tint = compositeOver(
        { ...parseColor(t3Resolved["--foreground"]![mode]), a: 0.12 },
        layer,
      );
      const fill = canvasPixel(glass, style.backgroundColor);
      for (const [index, channel] of [tint.r, tint.g, tint.b].entries()) {
        expect(
          Math.abs(fill[index]! - channel),
          `disabled send channel ${index}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  }
  void screen;
  const shot = await page.screenshot({
    base64: true,
    path: `__screenshots__/conversation-${width}-${mode}-${identification === "none" ? "release" : "dev-stage"}.png`,
    save: true,
  });
  expect(shot.base64.length).toBeGreaterThan(1000);
}

describe("the real app in Aetheria's default appearance", () => {
  it.each([
    { width: 1280, height: 800, mode: "light", identification: "artwork" },
    { width: 1280, height: 800, mode: "dark", identification: "artwork" },
    { width: 390, height: 844, mode: "light", identification: "artwork" },
    { width: 390, height: 844, mode: "dark", identification: "artwork" },
    { width: 1280, height: 800, mode: "light", identification: "none" },
    { width: 1280, height: 800, mode: "dark", identification: "none" },
    { width: 390, height: 844, mode: "light", identification: "none" },
    { width: 390, height: 844, mode: "dark", identification: "none" },
  ] as const)(
    "renders the conversation and sidebar at $width px, $mode, stage identification $identification",
    async ({ width, height, mode, identification }) => {
      await capture(width, height, mode, identification);
    },
  );
});
