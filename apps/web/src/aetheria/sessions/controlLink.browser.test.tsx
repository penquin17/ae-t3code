// The human-control link on a session row, over the pure model and a test router (no T3 state, no Backend).
// The router proves the URL navigated to, not the page behind it (control.browser.test.tsx covers that).
// The images are for a person to view; the assertions prove target, keyboard path and no sideways scroll.
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
const LINK_NAME = "Open human control";
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/controlLink-${name}.png`, save: true });

const data = facts([
  at("env-1:thread-wait", ago(5), {
    title: "Draft the grant budget",
    pendingKind: "approval",
  }),
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

const rowOf = (title: string) =>
  [...document.querySelectorAll<HTMLElement>("li")].find(
    (li) => li.querySelector("[data-session-row]")?.textContent?.includes(title) === true,
  )!;
const visibleLinks = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) =>
    (a.getAttribute("aria-label") ?? a.textContent ?? "").startsWith(LINK_NAME),
  );

describe("the human-control link on a session row", () => {
  it.each([1280, 390].flatMap((width) => MODES.map((mode) => [width, mode] as const)))(
    "%i wide, %s: a needs-you row shows the link and nothing overflows sideways",
    async (width, mode) => {
      await setup(width, width === 1280 ? 800 : 844, mode);
      await using _screen = await mountScreen();
      await expect.element(page.getByText("Draft the grant budget")).toBeVisible();
      const [link] = visibleLinks(rowOf("Draft the grant budget"));
      expect(link, "a visible link on the needs-you row").toBeDefined();
      expect(link!.getAttribute("href")).toBe("/aetheria/control/env-1/thread-wait");
      expect(link!.getAttribute("aria-label")).toBe(`${LINK_NAME} for Draft the grant budget`);
      expect(link!.getBoundingClientRect().width).toBeGreaterThan(0);
      const frame = document.querySelector<HTMLElement>("[data-testid='frame']")!;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth + 1);
      expect(link!.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await shot(`${width}-${mode}`);
    },
  );

  it("a quiet row has no inline link; its menu item targets that row's own session", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mountScreen();
    await expect.element(page.getByText("Garden irrigation schedule")).toBeVisible();
    expect(visibleLinks(rowOf("Garden irrigation schedule"))).toHaveLength(0);
    await page.getByRole("button", { name: "Actions for Garden irrigation schedule" }).click();
    const item = page.getByRole("menuitem", {
      name: `${LINK_NAME} for Garden irrigation schedule`,
    });
    await expect.element(item).toBeVisible();
    expect(item.element().getAttribute("href")).toBe("/aetheria/control/env-1/thread-calm");
  });

  it("a needs-you row's menu carries the same item with its own target", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mountScreen();
    await page.getByRole("button", { name: "Actions for Draft the grant budget" }).click();
    const item = page.getByRole("menuitem", { name: `${LINK_NAME} for Draft the grant budget` });
    await expect.element(item).toBeVisible();
    expect(item.element().getAttribute("href")).toBe("/aetheria/control/env-1/thread-wait");
  });

  it("a session that is not a T3 thread gets no link and no menu item", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mountScreen();
    await expect.element(page.getByText("A session with no T3 thread")).toBeVisible();
    expect(visibleLinks(rowOf("A session with no T3 thread"))).toHaveLength(0);
    await page.getByRole("button", { name: "Actions for A session with no T3 thread" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Pin" })).toBeVisible();
    expect(document.querySelectorAll('[role="menuitem"][href]')).toHaveLength(0);
  });

  it("the inline link works by keyboard: Tab reaches it and Enter navigates", async () => {
    await setup(1280, 800, "light");
    await using screen = await mountScreen();
    await expect.element(page.getByText("Draft the grant budget")).toBeVisible();
    const [link] = visibleLinks(rowOf("Draft the grant budget"));
    const sessionRow =
      rowOf("Draft the grant budget").querySelector<HTMLElement>("[data-session-row]")!;
    sessionRow.focus();
    for (let step = 0; step < 4 && document.activeElement !== link; step += 1) {
      await userEvent.keyboard("{Tab}");
    }
    expect(document.activeElement).toBe(link);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => screen.router!.state.location.pathname)
      .toBe("/aetheria/control/env-1/thread-wait");
  });

  it("the menu item works by keyboard: open the menu, arrow to the item, Enter navigates", async () => {
    await setup(1280, 800, "light");
    await using screen = await mountScreen();
    const trigger = page
      .getByRole("button", { name: "Actions for Garden irrigation schedule" })
      .element();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("menuitem", { name: `${LINK_NAME} for Garden irrigation schedule` }))
      .toBeVisible();
    for (
      let step = 0;
      step < 10 && document.activeElement?.textContent?.trim() !== LINK_NAME;
      step += 1
    ) {
      await userEvent.keyboard("{ArrowDown}");
    }
    expect(document.activeElement?.textContent?.trim()).toBe(LINK_NAME);
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => screen.router!.state.location.pathname)
      .toBe("/aetheria/control/env-1/thread-calm");
  });
});
