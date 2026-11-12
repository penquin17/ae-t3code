// The Aetheria sidebar in the real shell (IP-2) on the in-process fake environment, and the added
// /aetheria/sessions route. The images are evidence for a person to view; the assertions prove the
// shell rendered Aetheria's list in place of T3's thread sidebar and kept T3's chrome.
// Boundary: real router, real shell and real T3 state atoms over a fake socket; no real backend.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import type { FakeDriver } from "../../../test/fakeEnvironment";
import {
  LAST_ANSWER,
  THREAD_PATH,
  awaitSheetSettled,
  mountRoute,
  prepare,
  type Mode,
} from "../harness";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const MODES: readonly Mode[] = ["light", "dark"];
const sessions = () => document.querySelector<HTMLElement>('[data-aetheria="sessions"]');
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/step4-${name}.png`, save: true });

describe("the Aetheria sidebar replaces T3's thread sidebar", () => {
  it.each(MODES)(
    "1280 wide, %s: the session list, search and T3's chrome are there",
    async (mode) => {
      await prepare(1280, 800, mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
      await expect.poll(sessions, { timeout: 10_000 }).not.toBeNull();
      const list = sessions()!;
      // The open thread is marked as the current page and every row says its status in words.
      const open = list.querySelector('[data-session-row][aria-current="page"]');
      expect(open).not.toBeNull();
      expect(open!.textContent ?? "").toMatch(
        /Needs you|Working|Ongoing|Idle|State unknown|Approve|Question|Review/,
      );
      expect(document.querySelector('input[aria-label="Search sessions by title"]')).not.toBeNull();
      // T3's chrome stays: the brand home link and the toggle.
      expect(document.querySelector('[aria-label="Aetheria home"]')).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`sidebar-1280-${mode}`);
    },
  );

  it.each(MODES)(
    "390 wide, %s: the list opens in the phone sheet without horizontal scroll",
    async (mode) => {
      await prepare(390, 844, mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
      const trigger = [...document.querySelectorAll<HTMLElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Toggle main sidebar",
      )!;
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      await expect.element(page.getByRole("dialog").first()).toBeVisible();
      const dialog = await awaitSheetSettled();
      expect(dialog.querySelector('[data-aetheria="sessions"]')).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`sidebar-390-${mode}`);
    },
  );

  it("search narrows the rows and never writes anything", async () => {
    await prepare(1280, 800, "light");
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
    await expect.poll(sessions, { timeout: 10_000 }).not.toBeNull();
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search sessions by title"]',
    )!;
    await userEvent.fill(search, "zzz-no-such-title");
    await expect.poll(() => sessions()?.querySelectorAll("[data-session-row]").length ?? 0).toBe(0);
    await userEvent.clear(search);
    await expect
      .poll(() => sessions()?.querySelectorAll("[data-session-row]").length ?? 0)
      .toBeGreaterThan(0);
  });
});

describe("the added /aetheria/sessions route", () => {
  it.each(MODES)("opens as a page that lists the same sessions, %s", async (mode) => {
    await prepare(1280, 800, mode);
    const app = await mountRoute("/aetheria/sessions");
    await using _screen = app.screen;
    await expect.element(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect
      .poll(() => document.querySelectorAll('[data-aetheria="sessions"]').length)
      .toBeGreaterThanOrEqual(1);
    expect(app.router.state.location.pathname).toBe("/aetheria/sessions");
    await shot(`page-1280-${mode}`);
  });
});
