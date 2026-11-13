// The Aetheria sidebar in the real shell with the production groups transport, whose read the fake socket never answers:
// the list still shows and, within the read's bound, a quiet line says the groups were not read and why.
// Boundary: real router, shell and T3 state atoms over a fake socket that answers no groups call; no real Backend.
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
const WIDTHS = [1023, 768, 767] as const;
const NOT_READ = "Groups not read yet: The Backend did not answer the groups read in time.";
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/groups-sidebar-${name}.png`, save: true });

describe("the sidebar when the groups read gets no answer", () => {
  it.each(WIDTHS.flatMap((width) => MODES.map((mode) => [width, mode] as const)))(
    "%i wide, %s: the list shows and says the groups were not read",
    async (width, mode) => {
      await prepare(width, 800, mode);
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await expect.element(page.getByText(LAST_ANSWER), { timeout: 15_000 }).toBeVisible();
      let scope: ParentNode = document;
      if (width <= 767) {
        const trigger = [...document.querySelectorAll<HTMLElement>("button")].find(
          (button) => button.getAttribute("aria-label") === "Toggle main sidebar",
        )!;
        trigger.focus();
        await userEvent.keyboard("{Enter}");
        scope = await awaitSheetSettled();
      }
      await expect
        .poll(() => scope.querySelector("[data-groups-status]")?.textContent, { timeout: 15_000 })
        .toBe(NOT_READ);
      expect(scope.querySelector("[data-aetheria='sessions']")).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`${width}-${mode}`);
    },
  );
});
