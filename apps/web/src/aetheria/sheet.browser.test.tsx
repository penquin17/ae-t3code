// The phone sidebar sheet must be opaque, on top of the conversation and settled before it is captured.
// The first group runs T3 alone (the Aetheria stylesheet is imported only by the second), so a difference
// between the two is Aetheria's.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import type { FakeDriver } from "../../test/fakeEnvironment";
import {
  LAST_ANSWER,
  THREAD_PATH,
  awaitSheetSettled,
  mountRoute,
  prepare,
  type Mode,
} from "./harness";
import { resolveColor, surfaceBehind } from "./measure";

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

async function openSheet(mode: Mode) {
  await prepare(390, 844, mode);
  const app = await mountRoute(THREAD_PATH);
  await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
  const trigger = [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.getAttribute("aria-label") === "Toggle main sidebar",
  )!;
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("dialog").first()).toBeVisible();
  return app;
}

/** Everything that decides whether the open sheet reads as a solid layer above the conversation. */
function sheetFacts(dialog: HTMLElement) {
  const rect = dialog.getBoundingClientRect();
  const panel = dialog.closest<HTMLElement>("[data-slot='sidebar']") ?? dialog;
  const surface = surfaceBehind(dialog.querySelector("ul") ?? dialog);
  const points = [
    [rect.left + 24, rect.top + 24],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.right - 24, rect.bottom - 24],
  ] as const;
  return {
    opacity: Number.parseFloat(getComputedStyle(panel).opacity),
    backgroundAlpha: resolveColor(getComputedStyle(panel).backgroundColor).a,
    surfaceAlpha: surface.color.a,
    pointsOnTop: points.map(([x, y]) => dialog.contains(document.elementFromPoint(x, y))),
    left: rect.left,
  };
}

const MODES: readonly Mode[] = ["light", "dark"];

describe("the phone sidebar sheet, T3 alone", () => {
  it.each(MODES)("is opaque and on top once it has settled, %s mode", async (mode) => {
    const app = await openSheet(mode);
    await using _screen = app.screen;
    const dialog = await awaitSheetSettled();
    const facts = sheetFacts(dialog);
    expect(facts.opacity).toBe(1);
    expect(facts.backgroundAlpha).toBeGreaterThanOrEqual(0.999);
    expect(facts.pointsOnTop).toEqual([true, true, true]);
    expect(facts.left).toBeGreaterThanOrEqual(0);
  });
});

describe("the phone sidebar sheet with Aetheria's stylesheet", () => {
  it.each(MODES)("is opaque and on top once it has settled, %s mode", async (mode) => {
    await import("@t3tools/aetheria-design/aetheria.css");
    const app = await openSheet(mode);
    await using _screen = app.screen;
    const dialog = await awaitSheetSettled();
    const facts = sheetFacts(dialog);
    expect(facts.opacity).toBe(1);
    expect(facts.backgroundAlpha).toBeGreaterThanOrEqual(0.999);
    expect(facts.surfaceAlpha).toBeGreaterThanOrEqual(0.999);
    expect(facts.pointsOnTop).toEqual([true, true, true]);
    expect(facts.left).toBeGreaterThanOrEqual(0);
  });

  it("is not yet settled right after opening: the capture must wait for it", async () => {
    const app = await openSheet("light");
    await using _screen = app.screen;
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
    const panel = dialog.closest<HTMLElement>("[data-slot='sidebar']") ?? dialog;
    const early = Number.parseFloat(getComputedStyle(panel).opacity);
    await awaitSheetSettled();
    expect(Number.parseFloat(getComputedStyle(panel).opacity)).toBe(1);
    expect(early).toBeLessThanOrEqual(1);
  });
});
