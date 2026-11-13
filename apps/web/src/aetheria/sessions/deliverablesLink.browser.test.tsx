// The "Deliverables" item in a session row's actions menu (M10 Plan step 16, D9), over the pure model and a test router (no T3 state, no Backend). The router proves the URL navigated to, not the page
// behind it (deliverables/*.browser.test.tsx cover that). The images are for a person to view; the assertions prove target, name, keyboard path and the menu's fit at 1280 and 390.
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { createActionRunner } from "../core/outcome";
import { createFakeBackend } from "../groups/testing";
import { GroupsTransportProvider } from "../groups/transport";
import { useGroups } from "../groups/useGroups";
import { noSuggestions, toTreeModel } from "./model";
import { noLinks } from "./links";
import { SessionsView } from "./SessionsView";
import { ago, at, facts, NOW } from "./testing";
import type { SessionActions } from "./useSessionActions";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const ITEM = "Deliverables";
const shot = (name: string) =>
  page.screenshot({
    base64: true,
    path: `__screenshots__/deliverablesLink-${name}.png`,
    save: true,
  });

const data = facts([
  at("env-1:thread-calm", ago(3 * 24 * 60), { title: "Garden irrigation schedule" }),
  at("not-a-thread", ago(4 * 24 * 60), { title: "A session with no T3 thread" }),
]);

function actions(): SessionActions {
  const runner = createActionRunner({ newRequestId: () => "r" });
  const done = (label: string) =>
    runner.run(label, { label, send: async () => ({ tag: "accepted", value: null }) });
  return {
    open: () => {},
    pin: () => done("Pin"),
    archive: () => done("Archive"),
    rename: () => done("Rename"),
    fork: () => done("Fork"),
    startSession: () => done("New session"),
    forkAndRename: () => done("Fork as"),
  };
}

function Screen() {
  const groups = useGroups();
  const model = toTreeModel(data, noLinks, noSuggestions, { now: NOW, query: "" });
  return (
    <div
      data-testid="frame"
      className="h-screen w-full max-w-[20rem] overflow-y-auto bg-sidebar text-sidebar-foreground"
    >
      <SessionsView
        model={model}
        now={NOW}
        query=""
        onQuery={() => {}}
        actions={actions()}
        groups={groups}
      />
    </div>
  );
}

const backend = createFakeBackend({ version: 2, links: [], dismissed: [], names: [] });
const mountScreen = () =>
  render(
    <GroupsTransportProvider value={backend.transport}>
      <Screen />
    </GroupsTransportProvider>,
  );

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}

describe("the Deliverables item on a session row", () => {
  it.each([1280, 390].flatMap((width) => MODES.map((mode) => [width, mode] as const)))(
    "%i wide, %s: the menu offers it with the row's own name and target, inside the screen",
    async (width, mode) => {
      await setup(width, width === 1280 ? 800 : 844, mode);
      await using _screen = await mountScreen();
      await expect.element(page.getByText("Garden irrigation schedule")).toBeVisible();
      await page.getByRole("button", { name: "Actions for Garden irrigation schedule" }).click();
      const item = page.getByRole("menuitem", { name: `${ITEM} for Garden irrigation schedule` });
      await expect.element(item).toBeVisible();
      expect(item.element().textContent?.trim()).toBe(ITEM);
      expect(item.element().getAttribute("href")).toBe("/aetheria/deliverables/env-1/thread-calm");
      const box = item.element().getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`${width}-${mode}`);
    },
  );

  it("a session that is not a T3 thread gets no Deliverables item", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mountScreen();
    await expect.element(page.getByText("A session with no T3 thread")).toBeVisible();
    await page.getByRole("button", { name: "Actions for A session with no T3 thread" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Pin" })).toBeVisible();
    expect(
      document.querySelectorAll('[role="menuitem"][href*="/aetheria/deliverables/"]'),
    ).toHaveLength(0);
  });

  it("the item works by keyboard: open the menu, arrow to it, Enter navigates", async () => {
    await setup(1280, 800, "light");
    await using screen = await mountScreen();
    const trigger = page
      .getByRole("button", { name: "Actions for Garden irrigation schedule" })
      .element();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("menuitem", { name: `${ITEM} for Garden irrigation schedule` }))
      .toBeVisible();
    for (
      let step = 0;
      step < 10 && document.activeElement?.textContent?.trim() !== ITEM;
      step += 1
    ) {
      await userEvent.keyboard("{ArrowDown}");
    }
    expect(document.activeElement?.textContent?.trim()).toBe(ITEM);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => screen.router!.state.location.pathname)
      .toBe("/aetheria/deliverables/env-1/thread-calm");
  });
});
