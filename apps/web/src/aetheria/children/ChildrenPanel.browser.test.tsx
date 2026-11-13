// The children view and stored reports in a real browser with the real stylesheet (M10 Plan step 10, D2, C7). Boundary: the public `ChildrenPanel` over fake Backend calls and a fake report
// transport supplied through its contexts; no T3 socket and no real Backend, so these show the view's behaviour and words, not the wire. The images are evidence for a person to view; the
// assertions prove the words, the call counts, the layout and the names.
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { act, render } from "../../../test/render";
import { over, ratio, resolveColor, surfaceBehind } from "../measure";
import type { SendResult } from "../core/outcome";
import { ChildrenCallsContext, type ChildrenCalls } from "./calls";
import { ChildrenPanel } from "./ChildrenPanel";
import { ReportsTransportContext, type ReportReply, type ReportsTransport } from "./reports";

type Mode = "light" | "dark";
const ENV = "env-1";

const probe = {
  calls: [] as Array<{ method: "list" | "interrupt" | "close"; input: Record<string, unknown> }>,
  reads: [] as Array<{ rootThreadId: string; target: string }>,
  answer: (async () => ok({ rows: [], diagnostics: [] })) as (
    method: "list" | "interrupt" | "close",
    input: Record<string, unknown>,
  ) => Promise<SendResult<unknown>>,
  report: (async () => ({ ok: true, value: { state: "pending" } })) as (request: {
    rootThreadId: string;
    target: string;
  }) => Promise<ReportReply>,
};

const ok = (value: unknown): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value },
});
const fail = (code: string, detail?: string): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: false, code, ...(detail === undefined ? {} : { detail }) },
});
const child = (overrides: Record<string, unknown> = {}) => ({
  childId: "child-a",
  parentId: "root-1",
  depth: 1,
  role: "researcher",
  mode: "continuable",
  label: "Researcher",
  state: "running",
  lastOutcome: null,
  route: 1,
  ...overrides,
});
const ROWS = [
  child(),
  child({
    childId: "child-b",
    mode: "one-shot",
    label: "Budget check",
    state: "idle",
    role: "analyst",
    lastOutcome: { status: "completed" },
  }),
  child({ childId: "child-c", label: "Reader", state: "unknown", role: null, route: null }),
];
const listOf = (rows: unknown[], diagnostics: unknown[] = []) => ok({ rows, diagnostics });
const reset = () => {
  probe.calls.length = 0;
  probe.reads.length = 0;
  probe.answer = async (method) =>
    method === "list"
      ? listOf(ROWS)
      : method === "interrupt"
        ? ok({ accepted: true })
        : ok({ closed: true, killedJobs: [] });
  probe.report = async () => ({ ok: true, value: { state: "pending" } });
};

const calls: ChildrenCalls = {
  list: (target) => {
    const input = { ...target };
    probe.calls.push({ method: "list", input });
    return probe.answer("list", input);
  },
  interrupt: (target) => {
    const input = { ...target };
    probe.calls.push({ method: "interrupt", input });
    return probe.answer("interrupt", input);
  },
  close: (target) => {
    const input = { ...target };
    probe.calls.push({ method: "close", input });
    return probe.answer("close", input);
  },
};
const transport: ReportsTransport = {
  read: (request) => {
    probe.reads.push({ ...request });
    return probe.report(request);
  },
};
const callsTo = (method: string) => probe.calls.filter((call) => call.method === method);
const stops = () => callsTo("interrupt").length + callsTo("close").length;
const text = () => document.body.textContent ?? "";
/** Lets every already-resolved fake answer and its React update run, so a "nothing more happened" check is made after the work that would have happened. No timers: the fakes settle in microtasks. */
const pause = async () => {
  for (let turn = 0; turn < 40; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const held = () => {
  let release: (value: SendResult<unknown>) => void = () => {};
  const promise = new Promise<SendResult<unknown>>((resolve) => (release = resolve));
  return { promise, release };
};

function Shell(props: { readonly root?: string; readonly withReports?: boolean }) {
  const panel: ReactNode = <ChildrenPanel environmentId={ENV} threadId={props.root ?? "root-1"} />;
  return (
    <ChildrenCallsContext value={calls}>
      {/* The page behind the panel is the app's own surface (`SidebarInset` is `bg-background`): the test page's body is white in dark mode, which the real app never shows. */}
      <div className="min-h-svh bg-background">
        <main className="mx-auto w-full max-w-2xl p-4" data-testid="sheet">
          {props.withReports === false ? (
            panel
          ) : (
            <ReportsTransportContext value={transport}>{panel}</ReportsTransportContext>
          )}
        </main>
      </div>
    </ChildrenCallsContext>
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
  await expect.poll(() => text()).toContain("Budget check");
  return screen;
}
const stopButton = (screen: Awaited<ReturnType<typeof mount>>, name: string) =>
  screen.getByRole("button", { name: `Stop ${name}` });

describe("the list", () => {
  it("reads once on mount and shows rows in the Backend's order with mode and state as supplied", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(callsTo("list")).toHaveLength(1);
    expect(callsTo("list")[0]?.input).toEqual({ environmentId: ENV, rootThreadId: "root-1" });
    const rows = [...screen.container.querySelectorAll<HTMLElement>("[data-child-id]")];
    expect(rows.map((row) => row.dataset.childId)).toEqual(["child-a", "child-b", "child-c"]);
    expect(rows[0]?.textContent).toContain("Continuable");
    expect(rows[0]?.textContent).toContain("Running");
    expect(rows[1]?.textContent).toContain("One-shot");
    expect(rows[1]?.textContent).toContain("Idle");
    expect(rows[1]?.textContent).toContain("Last turn: completed");
  });

  it("a state the Backend could not read is Unknown, never Idle or Closed", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const unknown = screen.container.querySelector<HTMLElement>("[data-child-id='child-c']")!;
    expect(unknown.querySelector("[data-testid='child-state']")?.textContent).toBe("Unknown");
    expect(unknown.textContent).toContain("it is not known whether it is running, idle or closed");
    expect(unknown.dataset.state).toBe("unknown");
  });

  it("an empty list is said to be empty only when the Backend said so; a failed read is never empty", async () => {
    await setup(1280, 800, "light");
    probe.answer = async () => listOf([]);
    await using _empty = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("lists no open children");
    reset();
    probe.answer = async () => ({ tag: "lost" });
    await using _lost = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("what they are doing is not known");
    expect(text()).not.toContain("lists no open children for this session.None");
  });

  it("diagnostics are shown as the Backend gave them, on the row they name and on their own", async () => {
    await setup(1280, 800, "light");
    probe.answer = async () =>
      listOf(
        [child()],
        [
          { kind: "corrupt", id: "child-a", detail: "route record: bad JSON at 12" },
          { kind: "unsupported", id: "ghost", detail: "a newer format" },
        ],
      );
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("route record: bad JSON at 12");
    expect(
      screen.container.querySelector("[data-child-id='child-a'] [data-testid='child-diagnostic']")
        ?.textContent,
    ).toBe("corrupt: route record: bad JSON at 12");
    expect(text()).toContain("unsupported: ghost (a newer format)");
  });

  it("Refresh reads again, and a stale reply never replaces a newer one", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const old = held();
    let reads = 0;
    probe.answer = async () => {
      reads += 1;
      return reads === 1 ? old.promise : listOf([child({ childId: "new-1", label: "Fresh row" })]);
    };
    await screen.getByRole("button", { name: "Refresh" }).click();
    await screen.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => text()).toContain("Fresh row");
    old.release(listOf([child({ childId: "old-1", label: "Stale row" })]));
    await pause();
    expect(text()).toContain("Fresh row");
    expect(text()).not.toContain("Stale row");
  });

  it("a read refused by the Backend shows its words and its code, not an empty list", async () => {
    await setup(1280, 800, "light");
    probe.answer = async () => fail("CHILDREN_DEVICE_REVOKED", "revoked at 09:41");
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("revoked at 09:41");
    expect(
      screen.container.querySelector("[data-refusal-code='CHILDREN_DEVICE_REVOKED']"),
    ).not.toBe(null);
    expect(text()).not.toContain("lists no open children");
  });

  it("two roots never mix: a late reply for the first root does not land under the second", async () => {
    await setup(1280, 800, "light");
    const first = held();
    probe.answer = async (_method, input) =>
      input.rootThreadId === "root-1"
        ? first.promise
        : listOf([child({ childId: "of-2", label: "Second root child", parentId: "root-2" })]);
    await using screen = await render(<Shell />, { router: false });
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Second root child");
    first.release(listOf([child({ childId: "of-1", label: "First root child" })]));
    await pause();
    expect(text()).toContain("Second root child");
    expect(text()).not.toContain("First root child");
    expect(screen.container.querySelector("[data-root]")?.getAttribute("data-root")).toBe("root-2");
  });
});

describe("Stop", () => {
  it("one click on a continuable child is exactly one interrupt and no close", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await stopButton(screen, "Researcher").click();
    await expect.poll(() => text()).toContain("Interrupt accepted for Researcher.");
    expect(callsTo("interrupt")).toHaveLength(1);
    expect(callsTo("interrupt")[0]?.input).toEqual({
      environmentId: ENV,
      rootThreadId: "root-1",
      childThreadId: "child-a",
    });
    expect(callsTo("close")).toHaveLength(0);
    // The list was read on mount, once for the child's mode and once to show what the Backend now says.
    await expect.poll(() => callsTo("list").length).toBe(3);
  });

  it("one click on a one-shot child is exactly one close and no interrupt, and names the jobs it killed", async () => {
    await setup(1280, 800, "light");
    probe.answer = async (method) =>
      method === "list" ? listOf(ROWS) : ok({ closed: true, killedJobs: ["job-7"] });
    await using screen = await mount();
    await stopButton(screen, "Budget check").click();
    await expect.poll(() => text()).toContain("Closed Budget check. Jobs killed: job-7.");
    expect(callsTo("close")).toHaveLength(1);
    expect(callsTo("interrupt")).toHaveLength(0);
  });

  it("clicks while the Stop is in flight send nothing more", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const flight = held();
    probe.answer = async (method) => (method === "interrupt" ? flight.promise : listOf(ROWS));
    const button = stopButton(screen, "Researcher");
    await button.click();
    await expect.poll(() => callsTo("interrupt").length).toBe(1);
    // The control says it is busy (aria-disabled) but stays focusable, so a person or a script can still activate it: the view must send nothing.
    await expect.poll(() => button.element().getAttribute("aria-disabled")).toBe("true");
    (button.element() as HTMLElement).click();
    (button.element() as HTMLElement).click();
    await pause();
    expect(stops()).toBe(1);
    flight.release(ok({ accepted: true }));
    await expect.poll(() => text()).toContain("Interrupt accepted");
    expect(stops()).toBe(1);
  });

  it("a refusal shows the display line, the words and the code, and sends nothing again", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer = async (method) =>
      method === "list" ? listOf(ROWS) : fail("CHILDREN_NOT_AUTHORIZED");
    await stopButton(screen, "Researcher").click();
    await expect
      .poll(() => screen.container.querySelector("[data-refusal-code='CHILDREN_NOT_AUTHORIZED']"))
      .not.toBe(null);
    expect(text()).toContain("cannot stop work");
    await pause();
    expect(stops()).toBe(1);
  });

  it("a revoked device is told so", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer = async (method) =>
      method === "list" ? listOf(ROWS) : fail("CHILDREN_DEVICE_REVOKED");
    await stopButton(screen, "Budget check").click();
    await expect.poll(() => text()).toContain("revoked or has expired");
  });

  it("a lost reply is not known whether it applied, is not sent again, and the list is re-read", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer = async (method) => (method === "list" ? listOf(ROWS) : { tag: "lost" });
    await stopButton(screen, "Researcher").click();
    await expect.poll(() => text()).toContain("not known whether it applied");
    expect(text()).toContain("it was not sent again");
    expect(text()).not.toContain("Interrupt accepted");
    await pause();
    expect(stops()).toBe(1);
    expect(callsTo("list").length).toBe(3);
  });

  it("a Backend that did nothing says so", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer = async (method) =>
      method === "list" ? listOf(ROWS) : fail("CHILDREN_UNAVAILABLE", "the service is stopped");
    await stopButton(screen, "Researcher").click();
    await expect.poll(() => text()).toContain("unavailable: the service is stopped");
  });

  it("an answer that may have landed is not shown as stopped", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer = async (method) =>
      method === "list" ? listOf(ROWS) : fail("CHILDREN_OUTCOME_UNKNOWN", "x");
    await stopButton(screen, "Researcher").click();
    await expect.poll(() => text()).toContain("not known whether it applied");
    expect(text()).not.toContain("Interrupt accepted");
    expect(text()).not.toContain("Stop sent");
  });

  it("a close the Backend accepted whose list could not be re-read shows both results", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    let lists = 0;
    probe.answer = async (method) => {
      if (method !== "list") return ok({ closed: true, killedJobs: [] });
      lists += 1;
      return lists === 1 ? listOf(ROWS) : { tag: "lost" };
    };
    await stopButton(screen, "Budget check").click();
    await expect.poll(() => text()).toContain("partly done");
    expect(text()).toContain("closed child-b applied");
    expect(text()).toContain("the list re-read not known whether it applied");
    expect(callsTo("close")).toHaveLength(1);
    // The list is now honestly unread, not the old rows.
    expect(text()).toContain("what they are doing is not known");
  });

  it("a Stop for the first root never reports under the second root", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const flight = held();
    probe.answer = async (method, input) => {
      if (method === "interrupt") return flight.promise;
      return input.rootThreadId === "root-1"
        ? listOf(ROWS)
        : listOf([child({ childId: "of-2", label: "Second root child" })]);
    };
    await stopButton(screen, "Researcher").click();
    await expect.poll(() => callsTo("interrupt").length).toBe(1);
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Second root child");
    const listsBefore = callsTo("list").length;
    flight.release(ok({ accepted: true }));
    await pause();
    expect(text()).not.toContain("Interrupt accepted");
    expect(callsTo("list").length).toBe(listsBefore);
    expect(stops()).toBe(1);
  });

  it("a closed child's Stop sends nothing", async () => {
    await setup(1280, 800, "light");
    probe.answer = async () => listOf([child({ state: "closed" })]);
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("Already closed.");
    const button = stopButton(screen, "Researcher");
    expect(button.element().getAttribute("aria-disabled")).toBe("true");
    (button.element() as HTMLElement).click();
    await pause();
    expect(stops()).toBe(0);
    expect(callsTo("list")).toHaveLength(1);
  });

  it("leaving the page cancels nothing", async () => {
    await setup(1280, 800, "light");
    const screen = await mount();
    await screen.unmount();
    expect(stops()).toBe(0);
    await screen[Symbol.asyncDispose]();
  });

  it("is operable by keyboard in a sensible order, and focus stays on the control it used", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const names: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await userEvent.tab();
      names.push(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "",
      );
    }
    expect(names).toEqual([
      "Refresh",
      "Stop Researcher",
      "Report of Researcher",
      "Stop Budget check",
    ]);
    await userEvent.keyboard("{Shift>}{Tab}{Tab}{/Shift}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Stop Researcher");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => text()).toContain("Interrupt accepted");
    expect(stops()).toBe(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Stop Researcher");
    void screen;
  });
});

describe("stored reports", () => {
  const REPORT_TEXT = "Found 3 items.\n\n  * indented, with <b>tags</b> and *markdown* left alone.";
  it("a report is read through the transport when opened, once, and shown verbatim", async () => {
    await setup(1280, 800, "light");
    probe.report = async () => ({
      ok: true,
      value: {
        state: "reported",
        report: {
          status: "failed",
          cause: "the provider said: 429",
          text: REPORT_TEXT,
          structured: { found: [1, 2, 3] },
          route: 2,
        },
      },
    });
    await using screen = await mount();
    const toggle = screen.getByRole("button", { name: "Report of Researcher" });
    expect(toggle.element().getAttribute("aria-expanded")).toBe("false");
    await toggle.click();
    await expect.poll(() => text()).toContain("Found 3 items.");
    expect(probe.reads).toEqual([{ rootThreadId: "root-1", target: "child-a" }]);
    expect(toggle.element().getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-verbatim='report-text']")?.textContent).toBe(REPORT_TEXT);
    expect(document.querySelector("[data-verbatim='report-structured']")?.textContent).toBe(
      '{\n  "found": [\n    1,\n    2,\n    3\n  ]\n}',
    );
    expect(text()).toContain("Status: failed (the provider said: 429)");
    // Closing and opening again does not read again; "Read again" does.
    await toggle.click();
    await toggle.click();
    expect(probe.reads).toHaveLength(1);
    await screen.getByRole("button", { name: "Read again" }).click();
    await expect.poll(() => probe.reads.length).toBe(2);
  });

  it.each([
    ["pending", { ok: true, value: { state: "pending" } }, "No report yet"],
    ["not-record-only", { ok: true, value: { state: "not-record-only" } }, "No stored report"],
    ["missing", { ok: false, code: "CHILD_NOT_OWNED", detail: "not under this root" }, "Missing"],
    [
      "unreadable",
      { ok: false, code: "ORCHESTRATION_UNAVAILABLE", detail: "the route record cannot be used" },
      "Unreadable",
    ],
    [
      "unavailable",
      { ok: false, code: "CHILDREN_UNAVAILABLE", detail: "report read offline" },
      "Unavailable: report read offline",
    ],
  ] as const)("a %s report says %s and nothing else", async (tag, reply, words) => {
    await setup(1280, 800, "light");
    probe.report = async () => reply as ReportReply;
    await using screen = await mount();
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => document.querySelector(`[data-report='${tag}']`)).not.toBe(null);
    expect(document.querySelector(`[data-report='${tag}']`)?.textContent).toContain(words);
    expect(document.querySelectorAll("[data-report]")).toHaveLength(1);
  });

  it("an unreadable report keeps the Backend's reason and does not read as missing", async () => {
    await setup(1280, 800, "light");
    probe.report = async () => ({
      ok: false,
      code: "ORCHESTRATION_UNAVAILABLE",
      detail: "the route record cannot be used (corrupt)",
    });
    await using screen = await mount();
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => text()).toContain("the route record cannot be used (corrupt)");
    expect(text()).not.toContain("Missing");
  });

  it("a refusal of the read shows the Backend's words and its code", async () => {
    await setup(1280, 800, "light");
    probe.report = async () => ({
      ok: false,
      code: "CHILDREN_NOT_AUTHORIZED",
      detail: "read-only device",
    });
    await using screen = await mount();
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => text()).toContain("read-only device");
    expect(document.querySelector("[data-refusal-code='CHILDREN_NOT_AUTHORIZED']")).not.toBe(null);
  });

  it("a transport that throws is unreadable, not missing or empty", async () => {
    await setup(1280, 800, "light");
    probe.report = async () => {
      throw new Error("socket closed");
    };
    await using screen = await mount();
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => text()).toContain("the read failed before an answer (socket closed)");
  });

  it("without a transport the report is unavailable, said plainly", async () => {
    await setup(1280, 800, "light");
    await using screen = await render(<Shell withReports={false} />, { router: false });
    await expect.poll(() => text()).toContain("Budget check");
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => text()).toContain("Unavailable: The report read is not connected");
  });

  it("a report still being read offers no second read, and its late reply is dropped once the root changed", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const late = held() as unknown as {
      promise: Promise<ReportReply>;
      release: (v: unknown) => void;
    };
    probe.report = ({ rootThreadId }) =>
      rootThreadId === "root-1"
        ? late.promise
        : Promise.resolve({
            ok: true,
            value: {
              state: "reported",
              report: { status: "completed", text: "SECOND ROOT", route: 1 },
            },
          });
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => probe.reads.length).toBe(1);
    expect(document.querySelector("[data-report='reading']")).not.toBe(null);
    expect(screen.getByRole("button", { name: "Read again" }).elements()).toHaveLength(0);
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Budget check");
    await screen.getByRole("button", { name: "Report of Researcher" }).click();
    await expect.poll(() => text()).toContain("SECOND ROOT");
    late.release({
      ok: true,
      value: { state: "reported", report: { status: "completed", text: "FIRST ROOT", route: 1 } },
    });
    await pause();
    expect(text()).toContain("SECOND ROOT");
    expect(text()).not.toContain("FIRST ROOT");
  });

  it("the same child id under two roots does not share a report", async () => {
    await setup(1280, 800, "light");
    probe.report = async ({ rootThreadId }) => ({
      ok: true,
      value: {
        state: "reported",
        report: { status: "completed", text: `report for ${rootThreadId}`, route: 1 },
      },
    });
    probe.answer = async () => listOf([child({ label: "Shared id" })]);
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("Shared id");
    await screen.getByRole("button", { name: "Report of Shared id" }).click();
    await expect.poll(() => text()).toContain("report for root-1");
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Shared id");
    expect(text()).not.toContain("report for root-1");
  });

  it("the rollback notice is labelled as M05's reported limit", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const note = screen.container.querySelector("[data-testid='rollback-limit']")!;
    expect(note.textContent).toContain("Reported by M05");
    expect(note.textContent).toContain("accepted limit");
    expect(note.textContent).toContain("M05's own statement");
  });
});

const SURFACES = ["list", "report", "refusal", "missing"] as const;
const CASES = SURFACES.flatMap((surface) =>
  ([1280, 390] as const).flatMap((width) =>
    (["light", "dark"] as const).map((mode) => [surface, width, mode] as const),
  ),
);

describe("the screens", () => {
  it.each(CASES)(
    "%s at %i, %s: nothing overflows, every control is named",
    async (surface, width, mode) => {
      await setup(width, width === 1280 ? 800 : 844, mode);
      probe.report = async () =>
        surface === "missing"
          ? { ok: false, code: "CHILD_NOT_OWNED", detail: "no report is held for child-a" }
          : {
              ok: true,
              value: {
                state: "reported",
                report: {
                  status: "completed",
                  text: "Reading the budget notes found three open items.\n\n- Travel is over by a wide margin.\n- The vendor quote has no end date.\n- A very long unbroken path /Users/someone/projects/a-very-long-project-name/src/components/deeply/nested/Budget.tsx was cited.",
                  structured: { openItems: 3, cited: ["Budget.tsx"] },
                  route: 1,
                },
              },
            };
      await using screen = await mount();
      if (surface === "report" || surface === "missing") {
        await screen.getByRole("button", { name: "Report of Researcher" }).click();
        await expect
          .poll(() => document.querySelector("[data-report]:not([data-report='reading'])"))
          .not.toBe(null);
      }
      if (surface === "refusal") {
        probe.answer = async (method) =>
          method === "list" ? listOf(ROWS) : fail("CHILDREN_NOT_AUTHORIZED");
        await stopButton(screen, "Researcher").click();
        await expect.poll(() => document.querySelector("[data-refusal-code]")).not.toBe(null);
      }
      for (const selector of ["h2", "header button", "button[aria-label='Stop Researcher']"]) {
        const element = screen.container.querySelector<HTMLElement>(selector)!;
        const behind = surfaceBehind(element);
        const paint = resolveColor(getComputedStyle(element).color);
        expect(
          ratio(over(paint, behind.color), behind.color),
          `${selector} on ${JSON.stringify(behind.color)} in ${mode}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      for (const element of screen.container.querySelectorAll<HTMLElement>(
        "li, pre, [data-refusal-code]",
      )) {
        expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
      }
      for (const control of screen.container.querySelectorAll<HTMLElement>("button")) {
        const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
        expect(name.trim()).not.toBe("");
      }
      await page.screenshot({
        base64: true,
        path: `__screenshots__/children-${surface}-${width}-${mode}.png`,
        save: true,
      });
    },
  );
});
