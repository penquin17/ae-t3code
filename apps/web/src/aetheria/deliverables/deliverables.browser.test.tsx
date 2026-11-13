// The deliverables page content in a real browser with the real stylesheet (M10 Plan step 16, D9–D13, C5/C6). Boundary: the public `DeliverablesView` over FAKE Backend reads and a FAKE fetcher supplied
// through their contexts; no T3 socket, no Backend and no network, so these show the view's words, the requests it makes and what it does with the answers, not the wire (the page test and step 17's
// native run cover that). The images are evidence for a person to view; the assertions prove words, call counts, layout, names and cleanup.
import type { DeliverableCard } from "@t3tools/aetheria-contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { act, render } from "../../../test/render";
import { DeliverableFetcherContext, type DeliverableFetcher } from "../files/fetcher";
import { over, ratio, resolveColor, surfaceBehind } from "../measure";
import type { SendResult } from "../core/outcome";
import { DeliverablesCallsContext, type DeliverablesCalls } from "./calls";
import { DeliverablesView } from "./DeliverablesView";
import type { DownloadRequest, DownloadResult } from "./download";

type Mode = "light" | "dark";
const ENV = "env-1";
const D1 = `sha256:${"a".repeat(64)}`;
const D2 = `sha256:${"b".repeat(64)}`;
const dlv = (n: number) => `dlv_${String(n).repeat(32)}`;
const off = (n: number) => `off_${String(n).repeat(32)}`;
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const card = (n: number, overrides: Partial<DeliverableCard> = {}): DeliverableCard => ({
  id: dlv(n),
  threadId: "root-1",
  turnId: `run-${n}`,
  canonicalPath: `/work/file-${n}.md`,
  title: `Card ${n}`,
  kind: "markdown",
  size: 2048,
  digest: D1,
  declaredAt: Date.UTC(2026, 10, 13, 9, n),
  snapshot: { state: "attached", digest: D1, size: 2048 },
  supersededBy: null,
  ...overrides,
});
const CARDS: DeliverableCard[] = [
  card(1, { title: "Quarterly report", canonicalPath: "/work/report.md" }),
  card(2, {
    title: "Landing page",
    kind: "html",
    canonicalPath: "/work/site/index.html",
    snapshot: { state: "unavailable", code: "SNAPSHOT_TOO_LARGE" },
    supersededBy: dlv(5),
  }),
  card(3, {
    title: "Budget workbook",
    kind: "office",
    canonicalPath: "/work/budget.xlsx",
    threadId: "child-9",
    snapshot: { state: "pending" },
  }),
  card(4, { title: "Chart", kind: "image", canonicalPath: "/work/chart.png", size: PNG.length }),
  card(5, { title: "Landing page v2", kind: "html", canonicalPath: "/work/site/index.html" }),
];

const ok = (value: unknown): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value },
});
const fail = (code: string, detail?: string): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: false, code, ...(detail === undefined ? {} : { detail }) },
});
const listOf = (cards: DeliverableCard[], root = "root-1") =>
  ok({ rootThreadId: root, deliverables: cards });
const editsOf = (edits: unknown, root = "root-1") => ok({ rootThreadId: root, edits });

const probe = {
  list: [] as Array<{ rootThreadId: string }>,
  offered: [] as Array<{ rootThreadId: string }>,
  fetches: [] as Array<DownloadRequest & { environmentId: string }>,
  saves: [] as Array<{ name: string; size: number }>,
  answerList: (async () => listOf(CARDS)) as (root: string) => Promise<SendResult<unknown>>,
  answerOffered: (async () => editsOf({ status: "known", paths: [] })) as (
    root: string,
  ) => Promise<SendResult<unknown>>,
  answerFetch: (async () => bytes("x")) as (request: DownloadRequest) => Promise<DownloadResult>,
};
const bytes = (
  content: string | Uint8Array,
  digest: string | null = D1,
  type = "",
): DownloadResult => ({
  tag: "bytes",
  blob: new Blob([content as BlobPart], type === "" ? {} : { type }),
  digest,
});
const reset = () => {
  probe.list.length = 0;
  probe.offered.length = 0;
  probe.fetches.length = 0;
  probe.saves.length = 0;
  probe.answerList = async () => listOf(CARDS);
  probe.answerOffered = async () => editsOf({ status: "known", paths: [] });
  probe.answerFetch = async () => bytes("x");
};

const calls: DeliverablesCalls = {
  list: ({ rootThreadId }) => {
    probe.list.push({ rootThreadId });
    return probe.answerList(rootThreadId);
  },
  offeredPaths: ({ rootThreadId }) => {
    probe.offered.push({ rootThreadId });
    return probe.answerOffered(rootThreadId);
  },
};
const fetcher: DeliverableFetcher = {
  fetch: (environmentId, request) => {
    probe.fetches.push({ environmentId, ...request });
    return probe.answerFetch(request);
  },
  save: (blob, name) => {
    probe.saves.push({ name, size: blob.size });
  },
};

const text = () => document.body.textContent ?? "";
const pause = async () => {
  for (let turn = 0; turn < 40; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const held = <T,>() => {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
};

function Shell(props: { readonly root?: string }) {
  const view: ReactNode = (
    <DeliverablesView environmentId={ENV} threadId={props.root ?? "root-1"} />
  );
  return (
    <DeliverablesCallsContext value={calls}>
      <DeliverableFetcherContext value={fetcher}>
        {/* The page behind the content is the app's own surface (`SidebarInset` is `bg-background`): the test page's body is white in dark mode, which the real app never shows. */}
        <div className="min-h-svh bg-background">
          <main className="mx-auto w-full max-w-2xl p-4" data-testid="sheet">
            {view}
          </main>
        </div>
      </DeliverableFetcherContext>
    </DeliverablesCallsContext>
  );
}

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  reset();
}
async function mount(ui: ReactNode = <Shell />) {
  const screen = await render(ui, { router: false });
  await expect.poll(() => text()).toContain("Quarterly report");
  return screen;
}
const cardOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-deliverable-id='${id}']`)!;
const fetchesOf = (id: string) => probe.fetches.filter((f) => f.id === id);
/** Spies made by a test are undone when its `using` scope ends. */
const restoringMocks = () => ({ [Symbol.dispose]: () => vi.restoreAllMocks() });

describe("the cards", () => {
  it("reads once per section and shows cards newest first with the facts as declared", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(probe.list).toEqual([{ rootThreadId: "root-1" }]);
    expect(probe.offered).toEqual([{ rootThreadId: "root-1" }]);
    const ids = [...screen.container.querySelectorAll<HTMLElement>("[data-deliverable-id]")].map(
      (e) => e.dataset.deliverableId,
    );
    expect(ids).toEqual([dlv(5), dlv(4), dlv(3), dlv(2), dlv(1)]);
    const first = cardOf(dlv(1));
    expect(first.textContent).toContain("Quarterly report");
    expect(first.textContent).toContain("Markdown");
    expect(first.textContent).toContain("2.0 KiB");
    expect(first.textContent).toContain("2026-11-13 09:01 UTC");
    expect(first.textContent).toContain("Turn run-1");
    expect(first.textContent).toContain("/work/report.md");
    expect(first.querySelector("[data-testid='snapshot-state']")?.textContent).toContain(
      "Copy kept",
    );
  });

  it("supersession, snapshot states and a child's delivery are each said in words", async () => {
    await setup(1280, 800, "light");
    await using _screen = await mount();
    const replaced = cardOf(dlv(2));
    expect(replaced.querySelector("[data-testid='superseded']")?.textContent).toBe(
      "Replaced by a later version",
    );
    expect(cardOf(dlv(5)).querySelector("[data-testid='superseded']")).toBe(null);
    expect(replaced.querySelector("[data-testid='snapshot-state']")?.textContent).toContain(
      "No copy kept: the file is too large to keep a copy of (SNAPSHOT_TOO_LARGE)",
    );
    expect(cardOf(dlv(3)).querySelector("[data-testid='snapshot-state']")?.textContent).toBe(
      "Copy not settled yet",
    );
    expect(cardOf(dlv(3)).textContent).toContain("From session child-9");
    expect(cardOf(dlv(1)).textContent).not.toContain("From session");
  });

  it("a known empty list says so; a lost reply is unknown and never says empty", async () => {
    await setup(1280, 800, "light");
    probe.answerList = async () => listOf([]);
    await using _empty = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("The Backend lists no delivered files");
    reset();
    probe.answerList = async () => ({ tag: "lost" });
    await using _lost = await render(<Shell />, { router: false });
    await expect.poll(() => document.querySelector("[data-testid='list-unknown']")).not.toBe(null);
    expect(document.querySelector("[data-testid='list-unknown']")?.textContent).toContain(
      "so what exists is not known",
    );
  });

  it("a refusal shows its plain line, its code and the Backend's words verbatim", async () => {
    await setup(1280, 800, "light");
    probe.answerList = async () => fail("DELIVERABLES_NOT_AUTHORIZED", "read-only device 7");
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("read-only device 7");
    const notice = screen.container.querySelector(
      "[data-refusal-code='DELIVERABLES_NOT_AUTHORIZED']",
    )!;
    expect(notice.textContent).toContain("not allowed to read the deliverables");
    expect(notice.querySelector("[data-verbatim='backend']")?.textContent).toBe(
      "read-only device 7",
    );
    expect(text()).not.toContain("lists no delivered files");
  });

  it("an unavailable store is unavailable with the Backend's words, not empty", async () => {
    await setup(1280, 800, "light");
    probe.answerList = async () =>
      fail("DELIVERABLES_STORE_UNUSABLE", "deliverables.json: bad JSON at 12");
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("bad JSON at 12");
    const notice = screen.container.querySelector("[data-list-state='unavailable']")!;
    expect(notice.textContent).toContain("The deliverables are unavailable");
    expect(notice.textContent).toContain("DELIVERABLES_STORE_UNUSABLE");
  });

  it("a stale reply never replaces a newer one, and two roots never mix", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const old = held<SendResult<unknown>>();
    let reads = 0;
    probe.answerList = async () => {
      reads += 1;
      return reads === 1 ? old.promise : listOf([card(7, { title: "Fresh card" })]);
    };
    await screen.getByRole("button", { name: "Refresh delivered files" }).click();
    await screen.getByRole("button", { name: "Refresh delivered files" }).click();
    await expect.poll(() => text()).toContain("Fresh card");
    old.release(listOf([card(8, { title: "Stale card" })]));
    await pause();
    expect(text()).toContain("Fresh card");
    expect(text()).not.toContain("Stale card");

    reset();
    const first = held<SendResult<unknown>>();
    probe.answerList = async (root) =>
      root === "root-1"
        ? first.promise
        : listOf([card(9, { title: "Second root card", threadId: "root-2" })], "root-2");
    await using other = await render(<Shell />, { router: false });
    await other.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Second root card");
    first.release(listOf([card(10, { title: "First root card" })]));
    await pause();
    expect(text()).toContain("Second root card");
    expect(text()).not.toContain("First root card");
  });
});

describe("download", () => {
  it("the current file is the default: one request, its name, and a matching digest said so", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes("# report", D1);
    await using screen = await mount();
    await screen.getByRole("button", { name: "Download current file of Quarterly report" }).click();
    await expect.poll(() => probe.saves.length).toBe(1);
    expect(fetchesOf(dlv(1))).toEqual([{ environmentId: ENV, id: dlv(1), semantics: "current" }]);
    expect(probe.saves[0]).toEqual({ name: "report.md", size: 8 });
    await expect.poll(() => cardOf(dlv(1)).textContent).toContain("Saved report.md");
    const comparison = cardOf(dlv(1)).querySelector("[data-testid='comparison']")!;
    expect(comparison.getAttribute("data-comparison")).toBe("same");
    expect(comparison.textContent).toContain("matches the digest declared");
  });

  it("a changed current file says it changed since delivered", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes("# edited", D2);
    await using screen = await mount();
    await screen.getByRole("button", { name: "Download current file of Quarterly report" }).click();
    await expect.poll(() => cardOf(dlv(1)).textContent).toContain("Changed since delivered");
    expect(cardOf(dlv(1)).querySelector("[data-comparison]")?.getAttribute("data-comparison")).toBe(
      "differs",
    );
  });

  it("as delivered is offered only when a copy is kept, and asks for that semantics", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes("# v1", D1);
    await using screen = await mount();
    expect(
      cardOf(dlv(1)).querySelector(
        "button[aria-label='Download as delivered of Quarterly report']",
      ),
    ).not.toBe(null);
    for (const id of [dlv(2), dlv(3)]) {
      expect(cardOf(id).querySelector("button[aria-label^='Download as delivered']")).toBe(null);
    }
    await screen.getByRole("button", { name: "Download as delivered of Quarterly report" }).click();
    await expect.poll(() => probe.saves.length).toBe(1);
    expect(fetchesOf(dlv(1))[0]).toMatchObject({ semantics: "as-delivered" });
    // A copy whose digest differs is a warning, not the "changed since delivered" marker.
    reset();
    probe.answerFetch = async () => bytes("# other", D2);
    await screen.getByRole("button", { name: "Download as delivered of Quarterly report" }).click();
    await expect
      .poll(() => cardOf(dlv(1)).textContent)
      .toContain("does not match the one declared");
    expect(cardOf(dlv(1)).textContent).not.toContain("Changed since delivered");
  });

  it("a refusal saves nothing and shows the Backend's code and words", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => ({
      tag: "refused",
      status: 409,
      code: "DOWNLOAD_FILE_CHANGED",
      detail: "inode moved during open",
      known: true,
    });
    await using screen = await mount();
    await screen.getByRole("button", { name: "Download current file of Quarterly report" }).click();
    await expect.poll(() => cardOf(dlv(1)).querySelector("[data-refusal-code]")).not.toBe(null);
    const notice = cardOf(dlv(1)).querySelector("[data-refusal-code]")!;
    expect(notice.textContent).toContain("changed while the Backend was opening it");
    expect(notice.textContent).toContain("DOWNLOAD_FILE_CHANGED");
    expect(notice.querySelector("[data-verbatim='backend']")?.textContent).toBe(
      "inode moved during open",
    );
    expect(probe.saves).toHaveLength(0);
  });

  it("an unknown refusal code shows the Backend's words, and no credential, failure and lost request each say so", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const button1 = () =>
      screen.getByRole("button", { name: "Download current file of Quarterly report" });
    probe.answerFetch = async () => ({
      tag: "refused",
      status: 418,
      code: "NEW_CODE",
      detail: "a newer Backend said this",
      known: false,
    });
    await button1().click();
    await expect.poll(() => text()).toContain("a newer Backend said this");
    expect(cardOf(dlv(1)).querySelector("[data-refusal-known='false']")).not.toBe(null);

    probe.answerFetch = async () => ({
      tag: "no-credential",
      reason: "This connection holds no Bearer credential.",
    });
    await button1().click();
    await expect
      .poll(() => cardOf(dlv(1)).querySelector("[data-problem='no-credential']"))
      .not.toBe(null);
    expect(text()).toContain("holds no Bearer credential");

    probe.answerFetch = async () => ({
      tag: "failed",
      reason: "The request did not complete, so nothing was received.",
    });
    await button1().click();
    await expect.poll(() => cardOf(dlv(1)).querySelector("[data-problem='failed']")).not.toBe(null);
    expect(probe.saves).toHaveLength(0);
  });

  it("a second click while one is running makes no second request", async () => {
    await setup(1280, 800, "light");
    const gate = held<DownloadResult>();
    probe.answerFetch = () => gate.promise;
    await using screen = await mount();
    const download = screen.getByRole("button", {
      name: "Download current file of Quarterly report",
    });
    await download.click();
    await expect.poll(() => probe.fetches.length).toBe(1);
    expect((download.element() as HTMLButtonElement).disabled).toBe(true);
    gate.release(bytes("# r", D1));
    await expect.poll(() => probe.saves.length).toBe(1);
    expect(probe.fetches).toHaveLength(1);
  });
});

describe("preview", () => {
  it("markdown is shown as source with a note that links are not followed", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes("# Title\n\n[a link](/etc/passwd)", D1);
    await using screen = await mount();
    await screen.getByRole("button", { name: "Preview current file of Quarterly report" }).click();
    await expect
      .poll(() => cardOf(dlv(1)).querySelector("[data-preview='markdown']"))
      .not.toBe(null);
    const pane = cardOf(dlv(1)).querySelector("[data-preview='markdown']")!;
    expect(pane.querySelector("pre")?.textContent).toBe("# Title\n\n[a link](/etc/passwd)");
    expect(pane.querySelector("a")).toBe(null);
    expect(pane.textContent).toContain("links in it are not followed");
    expect(fetchesOf(dlv(1))).toEqual([{ environmentId: ENV, id: dlv(1), semantics: "current" }]);
  });

  it("HTML opens in a sandboxed frame on a blob URL, without same-origin rights", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes("<h1>Hi</h1>", D1);
    await using screen = await mount();
    await screen.getByRole("button", { name: "Preview current file of Landing page v2" }).click();
    await expect.poll(() => cardOf(dlv(5)).querySelector("iframe")).not.toBe(null);
    const frame = cardOf(dlv(5)).querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("src")).toMatch(/^blob:/);
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toBe("");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  it("an image decodes from a blob URL, and the blob carries its type", async () => {
    await setup(1280, 800, "light");
    probe.answerFetch = async () => bytes(PNG, D1);
    await using screen = await mount();
    await screen.getByRole("button", { name: "Preview current file of Chart" }).click();
    await expect.poll(() => cardOf(dlv(4)).querySelector("img")).not.toBe(null);
    const image = cardOf(dlv(4)).querySelector<HTMLImageElement>("img")!;
    expect(image.src).toMatch(/^blob:/);
    await expect.poll(() => image.naturalWidth).toBe(1);
    const blob = await (await fetch(image.src)).blob();
    expect(blob.type).toBe("image/png");
  });

  it("Office cannot be previewed: no preview control, the words say download only, and it can be downloaded", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const office = cardOf(dlv(3));
    expect(office.querySelector("button[aria-label^='Preview']")).toBe(null);
    expect(office.querySelector("[data-testid='preview-unavailable']")?.textContent).toBe(
      "Cannot preview — download only.",
    );
    await screen.getByRole("button", { name: "Download current file of Budget workbook" }).click();
    await expect.poll(() => probe.saves.length).toBe(1);
    expect(probe.saves[0]?.name).toBe("budget.xlsx");
  });

  it("a text file over the limit is not previewed and is not fetched when its size is known", async () => {
    await setup(1280, 800, "light");
    reset();
    probe.answerList = async () =>
      listOf([card(1, { title: "Huge log", kind: "text", size: 2 * 1024 * 1024 })]);
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("Huge log");
    expect(screen.container.querySelector("button[aria-label^='Preview']")).toBe(null);
    expect(text()).toContain("Too large to preview here (limit 1 MiB); download it.");
    expect(probe.fetches).toHaveLength(0);
  });

  it("a text file that grew past the limit since delivery is refused after the fetch", async () => {
    await setup(1280, 800, "light");
    reset();
    probe.answerList = async () =>
      listOf([card(1, { title: "Small log", kind: "text", size: 10 })]);
    probe.answerFetch = async () => bytes(new Uint8Array(1024 * 1024 + 1), D1);
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("Small log");
    await screen.getByRole("button", { name: "Preview current file of Small log" }).click();
    await expect.poll(() => text()).toContain("larger than the preview limit");
    expect(document.querySelector("[data-preview]")).toBe(null);
  });

  it("closing a preview revokes its object URL; so does leaving the page; a late answer then lands nowhere", async () => {
    await setup(1280, 800, "light");
    using _mocks = restoringMocks();
    const created: string[] = [];
    const revoked: string[] = [];
    const make = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = make(blob);
      created.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
    probe.answerFetch = async () => bytes(PNG, D1);
    const screen = await mount();
    await screen.getByRole("button", { name: "Preview current file of Chart" }).click();
    await expect.poll(() => created.length).toBe(1);
    await screen.getByRole("button", { name: "Close preview of Chart" }).click();
    expect(revoked).toEqual([created[0]]);
    expect(cardOf(dlv(4)).querySelector("img")).toBe(null);

    await screen.getByRole("button", { name: "Preview current file of Chart" }).click();
    await expect.poll(() => created.length).toBe(2);
    await screen.unmount();
    expect(revoked).toContain(created[1]);

    // A request still away when the page goes: its answer makes no URL.
    reset();
    const gate = held<DownloadResult>();
    probe.answerFetch = () => gate.promise;
    const again = await mount();
    await again.getByRole("button", { name: "Preview current file of Chart" }).click();
    await expect.poll(() => probe.fetches.length).toBe(1);
    await again.unmount();
    gate.release(bytes(PNG, D1));
    await pause();
    expect(created).toHaveLength(2);
  });

  it("a newer preview request wins over an older one still away", async () => {
    await setup(1280, 800, "light");
    const slow = held<DownloadResult>();
    let n = 0;
    probe.answerFetch = async () => {
      n += 1;
      return n === 1 ? slow.promise : bytes("# second", D1);
    };
    await using screen = await mount();
    const preview = () =>
      screen.getByRole("button", { name: "Preview as delivered of Quarterly report" });
    await screen.getByRole("button", { name: "Preview current file of Quarterly report" }).click();
    await expect.poll(() => probe.fetches.length).toBe(1);
    // The first request disabled its own button; the as-delivered one is a different request on the same item.
    await preview().click();
    await expect.poll(() => cardOf(dlv(1)).querySelector("pre")?.textContent).toBe("# second");
    slow.release(bytes("# first", D1));
    await pause();
    expect(cardOf(dlv(1)).querySelector("pre")?.textContent).toBe("# second");
  });
});

describe("the edited files", () => {
  const PATHS = [
    { id: off(1), canonicalPath: "/work/src/app.ts" },
    { id: off(2), canonicalPath: "/work/notes/summary.md" },
    { id: off(3), canonicalPath: "/work/data/model.xlsx" },
  ];

  it("lists the recorded paths under the per-session label, and downloads by id with the root", async () => {
    await setup(1280, 800, "light");
    probe.answerOffered = async () => editsOf({ status: "known", paths: PATHS });
    await using screen = await mount();
    await expect.poll(() => document.querySelectorAll("[data-offered-id]").length).toBe(3);
    expect(document.querySelector("[data-testid='offered-label']")?.textContent).toBe(
      "Edited files: per session, not per turn; shell writes not tracked.",
    );
    expect(document.querySelector("[data-testid='turn-diff-note']")?.textContent).toContain("Git");
    const row = document.querySelector<HTMLElement>(`[data-offered-id='${off(1)}']`)!;
    expect(row.querySelector("button[aria-label^='Download as delivered']")).toBe(null);
    await screen.getByRole("button", { name: "Download current file of app.ts" }).click();
    await expect.poll(() => probe.saves.length).toBe(1);
    expect(probe.fetches[0]).toEqual({
      environmentId: ENV,
      id: off(1),
      semantics: "current",
      rootThreadId: "root-1",
    });
    expect(probe.saves[0]?.name).toBe("app.ts");
    // No declared digest exists for an edit record, so nothing is compared, and the view says so.
    await expect.poll(() => row.textContent).toContain("carries no declared digest");
  });

  it("Office among the edits is download only; code previews as text", async () => {
    await setup(1280, 800, "light");
    probe.answerOffered = async () => editsOf({ status: "known", paths: PATHS });
    probe.answerFetch = async () => bytes("export const a = 1;", null);
    await using screen = await mount();
    await expect.poll(() => document.querySelectorAll("[data-offered-id]").length).toBe(3);
    const office = document.querySelector<HTMLElement>(`[data-offered-id='${off(3)}']`)!;
    expect(office.querySelector("button[aria-label^='Preview']")).toBe(null);
    expect(office.textContent).toContain("Cannot preview — download only.");
    await screen.getByRole("button", { name: "Preview current file of app.ts" }).click();
    await expect
      .poll(() => document.querySelector(`[data-offered-id='${off(1)}'] pre`)?.textContent)
      .toBe("export const a = 1;");
  });

  it.each([
    ["known empty", { status: "known", paths: [] }, "[data-testid='offered-empty']"],
    ["unknown", { status: "unknown" }, "[data-testid='list-unknown']"],
    ["unavailable", { status: "unavailable" }, "[data-list-state='unavailable']"],
  ])(
    "the board's %s answer is shown as itself and not as another",
    async (_name, edits, selector) => {
      await setup(1280, 800, "light");
      probe.answerOffered = async () => editsOf(edits);
      await using screen = await mount();
      const section = screen.container.querySelector("[data-aetheria='offered-paths']")!;
      await expect.poll(() => section.querySelector(selector)).not.toBe(null);
      const states = [
        "[data-testid='offered-empty']",
        "[data-testid='list-unknown']",
        "[data-list-state='unavailable']",
      ];
      expect(states.filter((s) => section.querySelector(s) !== null)).toEqual([selector]);
    },
  );

  it("a refused or failed read of the edits is not an empty list, and the cards still show", async () => {
    await setup(1280, 800, "light");
    probe.answerOffered = async () => fail("DELIVERABLES_DEVICE_REVOKED", "revoked at 09:41");
    await using screen = await mount();
    const section = screen.container.querySelector("[data-aetheria='offered-paths']")!;
    await expect.poll(() => section.textContent).toContain("revoked at 09:41");
    expect(section.textContent).not.toContain("recorded no edited files");
    expect(cardOf(dlv(1))).not.toBe(null);
  });
});

describe("the terminal statement", () => {
  it("says where the terminal is, and who a terminal runs as", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const notice = screen.container.querySelector("[data-aetheria='terminal-notice']")!;
    expect(notice.textContent).toContain(
      "The terminal is in the chat view of a session: open the session and use Toggle terminal drawer.",
    );
    expect(notice.textContent).toContain("run as the Backend user");
    expect(notice.querySelector("button, textarea, input")).toBe(null);
  });
});

describe("by keyboard", () => {
  it("Tab reaches a Download button and Enter downloads", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const target = screen
      .getByRole("button", { name: "Download current file of Quarterly report" })
      .element() as HTMLButtonElement;
    (screen.container.querySelector("h2") as HTMLElement).tabIndex = -1;
    (screen.container.querySelector("h2") as HTMLElement).focus();
    for (let step = 0; step < 40 && document.activeElement !== target; step += 1) {
      await userEvent.keyboard("{Tab}");
    }
    expect(document.activeElement).toBe(target);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => probe.saves.length).toBe(1);
  });
});

describe("how it looks", () => {
  it.each(
    [1280, 390].flatMap((width) =>
      (["light", "dark"] as const).flatMap((mode) =>
        (["cards", "preview", "states"] as const).map((surface) => [surface, width, mode] as const),
      ),
    ),
  )("%s at %i wide, %s: readable, named, not overflowing", async (surface, width, mode) => {
    await setup(width, width === 1280 ? 900 : 844, mode);
    probe.answerOffered = async () =>
      editsOf({
        status: "known",
        paths: [{ id: off(1), canonicalPath: "/work/a/very/long/path/to/a/recorded/edit/app.ts" }],
      });
    probe.answerFetch = async () => bytes("# Title\n\nSome **markdown** source.", D2);
    if (surface === "states") {
      probe.answerList = async () =>
        fail("DELIVERABLES_STORE_UNUSABLE", "deliverables.json: bad JSON at 12");
      probe.answerOffered = async () => ({ tag: "lost" });
    }
    await using screen = await render(<Shell />, { router: false });
    await expect
      .poll(() => text())
      .toContain(surface === "states" ? "bad JSON at 12" : "Quarterly report");
    if (surface === "preview") {
      await screen
        .getByRole("button", { name: "Preview current file of Quarterly report" })
        .click();
      await expect.poll(() => document.querySelector("[data-preview]")).not.toBe(null);
      await screen
        .getByRole("button", { name: "Download current file of Quarterly report" })
        .click();
      await expect.poll(() => text()).toContain("Saved report.md");
    }
    for (const selector of ["h2", "header button", "li h3, [data-list-state] "]) {
      const element = screen.container.querySelector<HTMLElement>(selector);
      if (element === null) continue;
      const behind = surfaceBehind(element);
      const paint = resolveColor(getComputedStyle(element).color);
      expect(
        ratio(over(paint, behind.color), behind.color),
        `${selector} on ${JSON.stringify(behind.color)} in ${mode}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const element of screen.container.querySelectorAll<HTMLElement>(
      "li, pre, [data-list-state]",
    )) {
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    for (const control of screen.container.querySelectorAll<HTMLElement>("button")) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim()).not.toBe("");
      const box = control.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    await page.screenshot({
      base64: true,
      path: `__screenshots__/deliverables-${surface}-${width}-${mode}.png`,
      save: true,
    });
  });
});
