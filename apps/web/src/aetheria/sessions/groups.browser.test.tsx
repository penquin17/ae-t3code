// Persistent groups in the session list, drawn in a real browser from supplied values: saved names, suggestions with dismissal,
// the rename dialog, detach and ungroup, fork-as, and the honest notices. Boundary: SessionsView and the tree over the pure
// model and the in-memory fake Backend (groups/testing.ts); no T3 state, no real Backend. The images are evidence for a person
// to view; the assertions prove the words, the requests sent, focus and that nothing overflows sideways.
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { createActionRunner } from "../core/outcome";
import type { GroupRecord } from "../groups/record";
import { createFakeBackend, type FakeBackend } from "../groups/testing";
import { GroupsTransportProvider } from "../groups/transport";
import { useGroups, type GroupsHandle } from "../groups/useGroups";
import { forkThenRename } from "./forkSequence";
import { groupSources } from "./groupSources";
import { forkLinkSource } from "./links";
import { toTreeModel } from "./model";
import { SessionsView } from "./SessionsView";
import { ago, at, facts, NOW } from "./testing";
import type { ListFacts } from "./types";
import type { SessionActions } from "./useSessionActions";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const DAY = 24 * 60;
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/groups-${name}.png`, save: true });

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}

const data: ListFacts = facts([
  at("a", ago(3 * DAY), { title: "Quarterly revenue forecast model" }),
  at("b", ago(4 * DAY), { title: "Quarterly revenue forecast review" }),
  at("c", ago(5 * DAY), { title: "Garden irrigation schedule draft" }),
  at("d", ago(6 * DAY), { title: "Garden irrigation schedule notes" }),
  at("e", ago(2 * DAY), {
    title: "Waiting on a new kind of request",
    pendingKind: "something-new",
  }),
  at("f", ago(7 * DAY), { title: "Snoozed idea", snoozed: true }),
]);
const saved: GroupRecord = {
  version: 2,
  links: [{ a: "a", b: "b", kind: "grouped", at: 1 }],
  dismissed: [],
  names: [{ members: ["a", "b"], name: "Reading list", at: 2 }],
};

function fakeActions(log: string[]): SessionActions {
  const runner = createActionRunner({ newRequestId: () => "r" });
  const done = (label: string) =>
    runner.run(label, { label, send: async () => ({ tag: "accepted", value: null }) });
  return {
    open: (id) => void log.push(`open:${id}`),
    pin: () => done("Pin"),
    archive: () => done("Archive"),
    rename: () => done("Rename"),
    fork: () => done("Fork"),
    startSession: () => done("New session"),
    forkAndRename: (id, title) => {
      log.push(`forkAndRename:${id}:${title}`);
      return forkThenRename(
        runner,
        id,
        { label: "Fork", send: async () => ({ tag: "accepted", value: "child" }) },
        () => ({
          label: "Rename",
          send: async () => ({
            tag: "refused",
            code: "RENAME_REFUSED",
            message: "That title is already used.",
          }),
        }),
      );
    },
  };
}

function Screen(props: {
  readonly facts: ListFacts;
  readonly log: string[];
  readonly onGroups?: (groups: GroupsHandle) => void;
}) {
  const groups = useGroups();
  props.onGroups?.(groups);
  const [query, setQuery] = useState("");
  const sources = groupSources(forkLinkSource(props.facts), groups.state.record);
  const model = toTreeModel(props.facts, sources.links, sources.suggestions, {
    now: NOW,
    query,
    names: sources.names,
  });
  return (
    <div
      data-testid="frame"
      className="h-screen w-full max-w-[20rem] overflow-y-auto bg-sidebar text-sidebar-foreground"
    >
      <SessionsView
        model={model}
        now={NOW}
        query={query}
        onQuery={setQuery}
        actions={fakeActions(props.log)}
        groups={groups}
      />
    </div>
  );
}

function mount(backend: FakeBackend | undefined, over: Partial<Parameters<typeof Screen>[0]> = {}) {
  const screen = <Screen facts={data} log={[]} {...over} />;
  return render(
    backend === undefined ? (
      screen
    ) : (
      <GroupsTransportProvider value={backend.transport}>{screen}</GroupsTransportProvider>
    ),
    { router: false },
  );
}

const text = () => document.querySelector<HTMLElement>("[data-testid='frame']")!.textContent ?? "";
const noSidewaysScroll = () => {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  const frame = document.querySelector<HTMLElement>("[data-testid='frame']")!;
  expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth + 1);
};
const opened = async (label: string) => {
  await page.getByRole("button", { name: label }).click();
};

describe("saved groups in the list", () => {
  it.each([1280, 390].flatMap((width) => MODES.map((mode) => [width, mode] as const)))(
    "%i wide, %s: a named group, a suggestion and honest row words",
    async (width, mode) => {
      await setup(width, width === 1280 ? 800 : 844, mode);
      const backend = createFakeBackend(saved);
      await using _screen = await mount(backend);
      await expect
        .element(page.getByRole("button", { name: "Rename group Reading list" }))
        .toBeVisible();
      expect(text()).toContain("Reading list");
      expect(text()).toContain(
        "Suggested: Garden irrigation schedule draft + Garden irrigation schedule notes",
      );
      expect(document.querySelector("[data-groups-status]")).toBeNull();
      // An unknown pending kind says Needs you and invents no tag; a snoozed row keeps its state and says so.
      expect(text()).toMatch(/Waiting on a new kind of request\s*Needs you/);
      expect(text()).not.toMatch(/Needs you · (Approve|Review|Question)|Approve|Question/);
      expect(text()).toMatch(/Snoozed idea\s*(Idle|State unknown)[^A-Za-z]*·[^A-Za-z]*snoozed/);
      noSidewaysScroll();
      await shot(`section-${width}-${mode}`);
    },
  );

  it("every control has an accessible name", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount(createFakeBackend(saved));
    await expect
      .element(page.getByRole("button", { name: "Rename group Reading list" }))
      .toBeVisible();
    for (const control of screen.container.querySelectorAll<HTMLElement>("button, input")) {
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "";
      expect(name, control.outerHTML).not.toBe("");
    }
  });

  it("accepting a suggestion sends one group request and shows the Backend's record after a re-read", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    await using _screen = await mount(backend);
    await opened("Group Garden irrigation schedule draft and Garden irrigation schedule notes");
    await expect.poll(() => text()).toContain("Group done.");
    expect(backend.bodies).toEqual([{ op: "group", a: "c", b: "d" }]);
    expect(backend.events).toEqual(["read", "apply:group", "read"]);
    expect(text()).not.toContain("Suggested:");
    expect(backend.record().links).toHaveLength(2);
  });

  it("a dismissed suggestion does not come back after a reload", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    {
      await using _first = await mount(backend);
      await opened(
        "Dismiss the suggestion for Garden irrigation schedule draft and Garden irrigation schedule notes",
      );
      await expect.poll(() => text()).toContain("Dismiss suggestion done.");
      expect(text()).not.toContain("Suggested:");
    }
    await using _reloaded = await mount(backend);
    await expect
      .element(page.getByRole("button", { name: "Rename group Reading list" }))
      .toBeVisible();
    expect(text()).not.toContain("Suggested:");
    expect(backend.record().dismissed).toHaveLength(1);
  });

  it("a refused change shows the Backend's own message and code, and the list stays as it was", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    backend.applyFaults.push({
      refuse: "GROUPS_NOT_AUTHORIZED",
      detail: "This device is read-only; ask the owner.",
    });
    await using _screen = await mount(backend);
    await opened("Group Garden irrigation schedule draft and Garden irrigation schedule notes");
    await expect
      .poll(() => document.querySelector("[data-refusal-code='GROUPS_NOT_AUTHORIZED']"))
      .not.toBeNull();
    expect(document.body.textContent).toContain("This device is read-only; ask the owner.");
    expect(text()).toContain("Suggested:");
    expect(backend.record()).toEqual(saved);
  });

  it("a lost reply is shown as not known, and nothing is sent again", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    backend.applyFaults.push("throw-after");
    await using _screen = await mount(backend);
    await opened("Group Garden irrigation schedule draft and Garden irrigation schedule notes");
    await expect.poll(() => text()).toContain("not known whether it applied");
    expect(text()).toContain("it was not sent again");
    expect(backend.bodies).toHaveLength(1);
  });

  it.each([1280, 390].flatMap((width) => MODES.map((mode) => [width, mode] as const)))(
    "%i wide, %s: a failed write notice",
    async (width, mode) => {
      await setup(width, width === 1280 ? 800 : 844, mode);
      const backend = createFakeBackend(saved);
      backend.applyFaults.push({
        refuse: "GROUPS_NOT_AUTHORIZED",
        detail: "This device is read-only; ask the owner of the Backend to change its access.",
      });
      await using _screen = await mount(backend);
      await opened("Group Garden irrigation schedule draft and Garden irrigation schedule notes");
      await expect.poll(() => document.querySelector("[data-refusal-code]")).not.toBeNull();
      noSidewaysScroll();
      await shot(`failed-write-${width}-${mode}`);
    },
  );
});

describe("detach, ungroup and fork as", () => {
  it("the row menu ungroups one pair and detaches a session, each as one request", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    await using _screen = await mount(backend);
    await expect
      .element(page.getByRole("button", { name: "Rename group Reading list" }))
      .toBeVisible();
    // Groups are folded by default; open this one so its members show.
    await page.getByRole("button", { name: /^Reading list/ }).click();
    await page
      .getByRole("button", { name: "Actions for Quarterly revenue forecast model" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Detach from group" }).click();
    await expect.poll(() => backend.bodies).toEqual([{ op: "detach", a: "a" }]);
    await expect.poll(() => text()).toContain("Detach done.");
    expect(backend.record().links).toEqual([]);
  });

  it("Fork as… names the fork; a fork that applied with a refused rename reads as partly done", async () => {
    await setup(1280, 800, "light");
    const log: string[] = [];
    await using _screen = await mount(createFakeBackend(saved), { log });
    await page
      .getByRole("button", { name: "Actions for Garden irrigation schedule draft" })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Fork as…" }).click();
    const field = page.getByRole("textbox", {
      name: "Title for the fork of Garden irrigation schedule draft",
    });
    await userEvent.fill(field, "Drip plan");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => text())
      .toContain("partly done: Fork applied; Rename refused: That title is already used.");
    expect(log).toEqual(["forkAndRename:c:Drip plan"]);
  });
});

describe("the rename dialog", () => {
  const open = async () => {
    await page.getByRole("button", { name: "Rename group Reading list" }).click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
  };

  it("renames the whole group even when a search shows one member, and stays until confirmed", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    await using _screen = await mount(backend);
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Search sessions by title" }),
      "forecast model",
    );
    await open();
    expect((document.querySelector("[aria-label='Group name']") as HTMLInputElement).value).toBe(
      "Reading list",
    );
    await userEvent.fill(page.getByRole("textbox", { name: "Group name" }), "  Forecasts  ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect
      .poll(() => backend.bodies)
      .toEqual([{ op: "rename", members: ["a", "b"], name: "Forecasts" }]);
    await expect.poll(() => document.querySelector("[role='dialog']")).toBeNull();
    expect(backend.record().names[0]?.name).toBe("Forecasts");
  });

  it("submitting the offered name writes nothing; an empty name clears", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    await using _screen = await mount(backend);
    await open();
    await page.getByRole("button", { name: "Save name" }).click();
    await expect.poll(() => document.querySelector("[role='dialog']")).toBeNull();
    expect(backend.bodies).toEqual([]);
    await open();
    await userEvent.fill(page.getByRole("textbox", { name: "Group name" }), "   ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect
      .poll(() => backend.bodies)
      .toEqual([{ op: "rename", members: ["a", "b"], name: "" }]);
    await expect.poll(() => backend.record().names).toEqual([]);
  });

  it("a refusal keeps the dialog open with the draft and the Backend's message", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    backend.applyFaults.push({
      refuse: "GROUPS_STORE_UNUSABLE",
      detail: "The group file is unreadable; nothing was changed.",
    });
    await using _screen = await mount(backend);
    await open();
    await userEvent.fill(page.getByRole("textbox", { name: "Group name" }), "Kept draft");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect
      .poll(() => document.querySelector("[role='dialog'] [data-refusal-code]"))
      .not.toBeNull();
    expect(document.querySelector("[role='dialog']")!.textContent).toContain(
      "The group file is unreadable; nothing was changed.",
    );
    expect((document.querySelector("[aria-label='Group name']") as HTMLInputElement).value).toBe(
      "Kept draft",
    );
  });

  it("a newer read does not erase what is being typed", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    let latest: GroupsHandle | undefined;
    await using _screen = await mount(backend, { onGroups: (groups) => void (latest = groups) });
    await open();
    await userEvent.fill(page.getByRole("textbox", { name: "Group name" }), "My unsent draft");
    backend.set({ ...saved, names: [{ members: ["a", "b"], name: "Renamed elsewhere", at: 9 }] });
    await latest!.store.refresh();
    await expect.poll(() => document.body.textContent).toContain("Renamed elsewhere");
    expect((document.querySelector("[aria-label='Group name']") as HTMLInputElement).value).toBe(
      "My unsent draft",
    );
  });

  it("Escape closes it and focus returns to the button that opened it; Tab stays inside", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mount(createFakeBackend(saved));
    await open();
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Group name");
    for (let i = 0; i < 6; i += 1) {
      await userEvent.keyboard("{Tab}");
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Rename group Reading list");
  });

  const SIZES = [
    [1280, 800],
    [1023, 800],
    [768, 800],
    [767, 800],
    [390, 844],
  ] as const;
  it.each(SIZES.flatMap(([w, h]) => MODES.map((mode) => [w, h, mode] as const)))(
    "%i wide (%i high), %s: the open dialog fits the screen",
    async (width, height, mode) => {
      await setup(width, height, mode);
      await using _screen = await mount(createFakeBackend(saved));
      await open();
      const popup = document.querySelector<HTMLElement>("[data-slot='dialog-popup']")!;
      const box = popup.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`dialog-${width}-${mode}`);
    },
  );
});

describe("when the groups are not connected or not readable", () => {
  it("with the default transport, fork groups show as today and a quiet line says why", async () => {
    await setup(1280, 800, "light");
    const forked: ListFacts = facts([
      at("a", ago(3 * DAY), { title: "Parent session" }),
      at("b", ago(4 * DAY), { title: "Child session", parentId: "a" }),
      at("c", ago(5 * DAY), { title: "Garden irrigation schedule draft" }),
      at("d", ago(6 * DAY), { title: "Garden irrigation schedule notes" }),
    ]);
    await using _screen = await mount(undefined, { facts: forked });
    await expect
      .poll(() => text())
      .toContain("Groups unavailable: The groups store is not connected in this build yet");
    expect(text()).toContain("Parent session");
    expect(document.querySelector("[aria-label^='Rename group']")).toBeNull();
    expect(text()).not.toContain("Suggested:");
    // The fork group is still a group of two.
    expect(document.querySelector("[data-aetheria='sessions']")!.textContent).toMatch(/Groups\s*1/);
  });

  it("an unsupported record is refused, not shown as no groups", async () => {
    await setup(1280, 800, "light");
    const backend = createFakeBackend(saved);
    backend.readFaults.push("garbage");
    await using _screen = await mount(backend);
    await expect
      .poll(() => text())
      .toContain("Groups unavailable: The saved groups are in a form this client does not read");
    expect(text()).not.toContain("Reading list");
  });
});

describe("folding and search", () => {
  it("folding still works in the page when browser storage fails", async () => {
    await setup(1280, 800, "light");
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    try {
      await using _screen = await mount(createFakeBackend(saved));
      const heading = page.getByRole("button", { name: /^Reading list/ });
      await expect.element(heading).toBeVisible();
      await expect.element(heading).toHaveAttribute("aria-expanded", "false");
      await heading.click();
      await expect.element(heading).toHaveAttribute("aria-expanded", "true");
      await expect.poll(() => text()).toContain("Quarterly revenue forecast model");
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("a search narrows rows but not the needs-you count", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mount(createFakeBackend(saved));
    await expect
      .element(page.getByRole("button", { name: "Rename group Reading list" }))
      .toBeVisible();
    expect(text()).toContain("1 needs you");
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Search sessions by title" }),
      "garden",
    );
    await expect.poll(() => text()).not.toContain("Snoozed idea");
    expect(text()).toContain("1 needs you");
  });
});
