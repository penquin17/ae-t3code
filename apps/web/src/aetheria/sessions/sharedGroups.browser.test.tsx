// One saved-groups record for every mounted session list (M10 product fix P4). The sessions page draws SessionsPanel twice, in the sidebar and in the page; a change made in one must show in the other
// without a reload. Boundary: two real SessionsPanels (and the groups hook and view under them) over the in-memory fake Backend (groups/testing.ts), with T3's session list, session actions, sidebar
// state, primary environment id and session generation replaced by plain values. It shows that the two lists agree after Dismiss, Group, Rename and Detach and that they read once; it does not show
// the real T3 data, the real socket or the real Backend: the native run does.
import { RegistryContext } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { render } from "../../../test/render";
import type { GroupRecord } from "../groups/record";
import { createFakeBackend } from "../groups/testing";
import { GroupsTransportProvider } from "../groups/transport";
import { SessionsPanel } from "./SessionsPanel";

const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Atom<number>,
  primary: null as unknown as Atom.Atom<string | null>,
}));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: { sessionGenerationAtom: () => mocks.generation },
}));
vi.mock("../../state/environments", async () => {
  const { useAtomValue } = await import("@effect/atom-react");
  return { usePrimaryEnvironmentId: () => useAtomValue(mocks.primary) };
});
vi.mock("../../components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: false, setOpenMobile: () => {} }),
}));
vi.mock("./useSessionActions", () => ({
  useSessionActions: () => ({
    open: () => {},
    pin: async () => ({ tag: "idle" }),
    archive: async () => ({ tag: "idle" }),
    rename: async () => ({ tag: "idle" }),
    fork: async () => ({ tag: "idle" }),
    forkAndRename: async () => ({ tag: "idle" }),
    startSession: async () => ({ tag: "idle" }),
  }),
}));
vi.mock("./useSessionTree", async () => {
  const [{ groupSources }, { forkLinkSource }, { toTreeModel }, { ago, at, facts, NOW }] =
    await Promise.all([
      import("./groupSources"),
      import("./links"),
      import("./model"),
      import("./testing"),
    ]);
  const DAY = 24 * 60;
  const data = facts([
    at("a", ago(3 * DAY), { title: "Quarterly revenue forecast model" }),
    at("b", ago(4 * DAY), { title: "Quarterly revenue forecast review" }),
    at("c", ago(5 * DAY), { title: "Garden irrigation schedule draft" }),
    at("d", ago(6 * DAY), { title: "Garden irrigation schedule notes" }),
  ]);
  return {
    useSessionTree: (query: string, record: Parameters<typeof groupSources>[1]) => {
      const sources = groupSources(forkLinkSource(data), record);
      const model = toTreeModel(data, sources.links, sources.suggestions, {
        now: NOW,
        query,
        names: sources.names,
      });
      return { model, now: NOW };
    },
  };
});

const saved: GroupRecord = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
  dismissed: [],
  names: [{ members: ["a", "b"], name: "Reading list", at: 2 }],
};
const SUGGESTED = "Suggested: Garden irrigation schedule draft + Garden irrigation schedule notes";
const PAIR = "Garden irrigation schedule draft and Garden irrigation schedule notes";

async function mountTwo() {
  mocks.generation = Atom.make(1);
  mocks.primary = Atom.make<string | null>("env-shared");
  const backend = createFakeBackend(saved);
  const screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <GroupsTransportProvider value={backend.transport}>
        <div data-testid="sidebar">
          <SessionsPanel />
        </div>
        <div data-testid="page">
          <SessionsPanel />
        </div>
      </GroupsTransportProvider>
    </RegistryContext.Provider>,
    { router: false },
  );
  const text = (id: string) => document.querySelector(`[data-testid='${id}']`)!.textContent ?? "";
  const sidebar = page.getByTestId("sidebar");
  await expect.poll(() => text("page")).toContain("Reading list");
  expect(text("sidebar")).toContain(SUGGESTED);
  expect(text("page")).toContain(SUGGESTED);
  return { backend, screen, text, sidebar };
}

describe("two session lists share one record", () => {
  it("a dismissed suggestion goes from both lists, and the Backend was read once to start", async () => {
    const { backend, screen, text, sidebar } = await mountTwo();
    await using _screen = screen;
    expect(backend.events).toEqual(["read"]);
    await sidebar.getByRole("button", { name: `Dismiss the suggestion for ${PAIR}` }).click();
    await expect.poll(() => text("page")).not.toContain("Suggested:");
    expect(text("sidebar")).not.toContain("Suggested:");
    expect(backend.record().dismissed).toHaveLength(1);
  });

  it("a grouped pair stops being a suggestion in both lists", async () => {
    const { backend, screen, text, sidebar } = await mountTwo();
    await using _screen = screen;
    await sidebar.getByRole("button", { name: `Group ${PAIR}` }).click();
    await expect.poll(() => text("page")).not.toContain("Suggested:");
    expect(text("sidebar")).not.toContain("Suggested:");
    expect(backend.record().links).toHaveLength(2);
  });

  it("a renamed group has its new name in both lists", async () => {
    const { backend, screen, text, sidebar } = await mountTwo();
    await using _screen = screen;
    await sidebar.getByRole("button", { name: "Rename group Reading list" }).click();
    await userEvent.fill(page.getByRole("textbox", { name: "Group name" }), "Forecasts");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect.poll(() => text("page")).toContain("Forecasts");
    expect(text("sidebar")).toContain("Forecasts");
    expect(text("page")).not.toContain("Reading list");
    expect(backend.record().names[0]?.name).toBe("Forecasts");
  });

  it("a detached session leaves its group in both lists", async () => {
    const { backend, screen, text, sidebar } = await mountTwo();
    await using _screen = screen;
    await sidebar.getByRole("button", { name: /^Reading list/ }).click();
    await sidebar
      .getByRole("button", { name: "Actions for Quarterly revenue forecast model" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Detach from group" }).click();
    await expect.poll(() => text("page")).not.toContain("Reading list");
    expect(text("sidebar")).not.toContain("Reading list");
    expect(backend.record().links).toEqual([]);
  });
});
