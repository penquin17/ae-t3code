// The workflow runs view and its one-click Cancel in a real browser with the real stylesheet (M07 Plan step 29, M10 run controls). Boundary: the provider and view over a SCRIPTED Backend (the
// WorkflowsTransport), with T3's session-generation atom replaced by an atom the test moves. This shows what the page reads, sends and says, not the real socket, the real Backend or the real run service:
// the built-app run shows those. The images under __screenshots__/ are evidence for a person to view; the assertions prove the words, the calls, the focus and the layout.
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, fakeTimers, render } from "../../../test/render";
import { over, ratio, resolveColor, surfaceBehind } from "../measure";
import { GoalsCard } from "./goals/GoalsCard";
import { GoalsProvider } from "./goals/GoalsProvider";
import { GoalsTransportContext } from "./goals/transport";
import type { GoalsTransport } from "./goals/types";
import { cardClass } from "./parts";
import type { TransportResult } from "./types";
import type { WorkflowRunView } from "./workflows/reply";
import { WorkflowsTransportContext } from "./workflows/transport";
import type { WorkflowsTransport } from "./workflows/types";
import { WorkflowRuns } from "./workflows/WorkflowRuns";
import { WorkflowsProvider } from "./workflows/WorkflowsProvider";

const mocks = vi.hoisted(() => ({
  generation: null as unknown as Atom.Writable<number>,
  signal: null as unknown as Atom.Writable<unknown>,
}));
// The page's other components read the rest of the real catalog; only the session generation is the test's.
vi.mock("~/connection/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/connection/catalog")>();
  return {
    ...original,
    environmentCatalog: {
      ...original.environmentCatalog,
      sessionGenerationAtom: () => Atom.make((get) => get(mocks.generation)),
    },
  };
});
vi.mock("./goals/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./goals/commands")>()),
  goalChanges: () => Atom.make((get) => get(mocks.signal)),
}));

type Mode = "light" | "dark";
const ENV = "env-workflows";
const ROOT = "pi-root-1";
const IDLE_POLL = 600_000;
const CASES = ([1280, 390] as const).flatMap((width) =>
  (["light", "dark"] as const).map((mode) => [width, mode] as const),
);

const NONE = {
  pending: 0,
  started: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  cancelled: 0,
  closed: 0,
};
const run = (over: Partial<WorkflowRunView> = {}): WorkflowRunView => ({
  runId: "run-1",
  name: "research-sweep",
  state: "running",
  phase: "gather",
  agentsStarted: 3,
  members: { ...NONE, started: 2, completed: 1 },
  startedAt: "2026-05-01T10:00:00.000Z",
  ...over,
});

const reply = (value: unknown): TransportResult => ({ tag: "reply", reply: value });
const ok = (value: unknown) => reply({ ok: true, value });
const fail = (code: string, extra: object = {}) => reply({ ok: false, code, ...extra });
const LOST: TransportResult = { tag: "lost" };

type Call = { readonly method: string; readonly payload: unknown };
type Step = () => Promise<TransportResult> | TransportResult;

/** A scripted Backend: the runs and version it holds, every call it saw, and per-call scripts that run first. A cancel it accepts marks that run `cancelRequested` and raises the version. */
function world(initial: readonly WorkflowRunView[], version = 3, unreadable = 0) {
  const state = { runs: [...initial], version, unreadable };
  const log: Call[] = [];
  const script = { runs: [] as Step[], cancel: [] as Step[] };
  const listing = () =>
    ok({
      runs: state.runs,
      version: state.version,
      ...(state.unreadable > 0 ? { unreadable: state.unreadable } : {}),
    });
  const asked = (runId: string) => {
    state.runs = state.runs.map((r) => (r.runId === runId ? { ...r, cancelRequested: true } : r));
    state.version += 1;
    return state.runs.find((r) => r.runId === runId);
  };
  const transport: WorkflowsTransport = {
    runs: async (_env, root) => {
      log.push({ method: "runs", payload: { root } });
      const next = script.runs.shift();
      return next ? next() : listing();
    },
    cancel: async (_env, root, runId) => {
      log.push({ method: "cancel", payload: { root, runId } });
      const next = script.cancel.shift();
      return next ? next() : ok({ run: asked(runId) });
    },
  };
  return { state, log, script, transport, asked };
}
type World = ReturnType<typeof world>;
const callsOf = (w: World, method: string) => w.log.filter((call) => call.method === method);

function setupAtoms() {
  mocks.generation = Atom.make(1);
  mocks.signal = Atom.make<unknown>(AsyncResult.success({ tag: "opened" }));
}
const newSession = (generation: number) =>
  act(async () => appAtomRegistry.set(mocks.generation, generation));

function Page(props: {
  readonly w: World;
  readonly pollMs?: number;
  readonly children?: ReactNode;
}) {
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <WorkflowsTransportContext value={props.w.transport}>
        <WorkflowsProvider
          key={ROOT}
          environmentId={ENV}
          rootSessionId={ROOT}
          pollMs={props.pollMs ?? IDLE_POLL}
        >
          <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 p-4">
            <section data-aetheria="workflows-test" className={cardClass}>
              {props.children ?? <WorkflowRuns />}
            </section>
          </main>
        </WorkflowsProvider>
      </WorkflowsTransportContext>
    </RegistryContext.Provider>
  );
}

async function appear(width: number, mode: Mode) {
  await page.viewport(width, width === 390 ? 844 : 900);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}
const group = () => document.querySelector<HTMLElement>("[data-workflow-runs]")!;
const view = () => group().getAttribute("data-workflow-view");
const row = (runId: string) => group().querySelector<HTMLElement>(`[data-run-id='${runId}']`)!;
const rowState = (runId: string) => row(runId).getAttribute("data-run-state");
const cancelButton = (runId = "run-1") =>
  document.querySelector<HTMLButtonElement>(`[data-run-id='${runId}'] [data-cancel='ready']`);
const status = (runId = "run-1") =>
  document
    .querySelector(`[data-run-id='${runId}'] [data-cancel-status]`)
    ?.getAttribute("data-cancel-status");
const shot = (name: string, width: number, mode: Mode) =>
  page.screenshot({
    base64: true,
    path: `__screenshots__/workflows-${name}-${width}-${mode}.png`,
    save: true,
  });
const flush = () =>
  act(async () => {
    for (let step = 0; step < 25; step++) await Promise.resolve();
  });
const noOverflow = () =>
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
/** The tab reports this visibility until the returned value is disposed. */
function tabIs(state: "visible" | "hidden"): Disposable {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return { [Symbol.dispose]: () => void Reflect.deleteProperty(document, "visibilityState") };
}
const tabChanged = () =>
  act(async () => void document.dispatchEvent(new Event("visibilitychange")));

describe("the runs view shows the Backend's runs honestly", () => {
  it.each(CASES)(
    "each run state is told apart, with no overflow, at %i px, %s",
    async (width, mode) => {
      await appear(width, mode);
      setupAtoms();
      const w = world(
        [
          run(),
          run({ runId: "run-2", name: "asked", cancelRequested: true }),
          run({
            runId: "run-3",
            name: "done",
            state: "completed",
            endedAt: "2026-05-01T10:05:00.000Z",
            cause: "all members completed",
          }),
          run({
            runId: "run-4",
            name: "broke",
            state: "failed",
            endedAt: "2026-05-01T10:06:00.000Z",
            cause: "member m-2 failed",
          }),
          run({ runId: "run-5", name: "stopped", state: "cancelled" }),
          run({ runId: "run-6", name: "orphan", state: "lost" }),
        ],
        3,
        1,
      );
      await using _screen = await render(<Page w={w} />, { router: false });
      await expect.poll(() => view()).toBe("live");
      expect(
        ["run-1", "run-2", "run-3", "run-4", "run-5", "run-6"].map((id) => rowState(id)),
      ).toEqual(["running", "cancel-requested", "completed", "failed", "cancelled", "lost"]);
      expect(
        [...group().querySelectorAll("[data-run-chip]")].map((chip) => chip.textContent),
      ).toEqual(["Running", "Cancel requested", "Completed", "Failed", "Cancelled", "Lost"]);
      expect(row("run-2").textContent).toMatch(/Cancel requested\. The run is still running/);
      expect(row("run-4").textContent).toContain("How it ended: member m-2 failed");
      expect(row("run-6").textContent).toMatch(/Backend was stopped while this run was running/);
      // Unreadable records are said, and the list is not claimed complete.
      expect(group().querySelector("[data-workflow-unreadable]")?.textContent).toMatch(
        /1 run record could not be read\. It may belong to this session, so this list may not be complete/,
      );
      // Only the one running run with no cancel asked for offers a Cancel.
      expect(group().querySelectorAll("[data-cancel='ready']")).toHaveLength(1);
      expect(cancelButton("run-1")?.getAttribute("aria-label")).toBe("Cancel research-sweep");
      noOverflow();
      for (const id of ["run-1", "run-2", "run-3", "run-4", "run-5", "run-6"]) {
        const text = row(id).querySelector<HTMLElement>("p.text-sm")!;
        const behind = surfaceBehind(text);
        expect(
          ratio(over(resolveColor(getComputedStyle(text).color), behind.color), behind.color),
        ).toBeGreaterThanOrEqual(4.5);
      }
      await shot("states", width, mode);
    },
  );

  it.each(CASES)(
    "hostile text and long ids stay inside the card at %i px, %s",
    async (width, mode) => {
      await appear(width, mode);
      setupAtoms();
      const w = world([
        run({
          runId: `run-${"x".repeat(90)}`,
          name: '<img src=x onerror="window.__pwned=1"> **not bold**',
          phase: `phase-${"very-long-token-".repeat(10)}`,
          cause: `cause-${"y".repeat(120)}`,
        }),
      ]);
      await using _screen = await render(<Page w={w} />, { router: false });
      await expect.poll(() => view()).toBe("live");
      // Markup in a name is shown as text: it never became an element and never ran.
      expect(group().textContent).toContain("<img src=x");
      expect(group().querySelectorAll("img, script")).toHaveLength(0);
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
      noOverflow();
    },
  );

  it("no runs and unreadable records are not the same statement", async () => {
    await appear(1280, "light");
    setupAtoms();
    const none = world([]);
    {
      await using _screen = await render(<Page w={none} />, { router: false });
      await expect.poll(() => view()).toBe("live");
      expect(group().querySelector("[data-workflow-empty]")?.textContent).toBe(
        "The Backend lists no workflow runs for this session.",
      );
    }
    setupAtoms();
    const unreadable = world([], 3, 2);
    await using _again = await render(<Page w={unreadable} />, { router: false });
    await expect.poll(() => view()).toBe("live");
    expect(group().querySelector("[data-workflow-empty]")).toBeNull();
    expect(group().textContent).not.toMatch(/lists no workflow runs/);
    expect(group().querySelector("[data-workflow-unreadable]")?.textContent).toMatch(
      /2 run records could not be read\. They may belong to this session/,
    );
  });

  it.each([
    ["WORKFLOWS_UNAVAILABLE", "unavailable", /workflow runs are unavailable/i],
    ["WORKFLOWS_OUTCOME_UNKNOWN", "unknown", /not known/i],
  ] as const)(
    "%s is unavailable or unknown and never says there are no runs",
    async (code, shown, words) => {
      await appear(390, "light");
      setupAtoms();
      const w = world([run()]);
      w.script.runs.push(() => fail(code, { detail: "the module is not running" }));
      await using _screen = await render(<Page w={w} />, { router: false });
      await expect.poll(() => view()).toBe("unavailable");
      expect(
        group().querySelector("[data-workflow-problem]")?.getAttribute("data-workflow-problem"),
      ).toBe(shown);
      expect(group().textContent).toMatch(words);
      expect(group().textContent).toContain("the module is not running");
      expect(group().querySelector("[data-workflow-empty]")).toBeNull();
      expect(group().querySelector("[data-cancel='ready']")).toBeNull();
      await shot(`problem-${code}`, 390, "light");
    },
  );

  it("a refusal shows the code and no runs", async () => {
    await appear(1280, "dark");
    setupAtoms();
    const w = world([run()]);
    w.script.runs.push(() =>
      fail("WORKFLOWS_DEVICE_REVOKED", { detail: "this device was revoked" }),
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => view()).toBe("refused");
    expect(group().querySelector("[data-refusal-code]")?.getAttribute("data-refusal-code")).toBe(
      "WORKFLOWS_DEVICE_REVOKED",
    );
    expect(group().querySelector("[data-run-id]")).toBeNull();
    expect(group().querySelector("[data-cancel='ready']")).toBeNull();
  });

  it("without a provider the runs say so, read nothing and offer no control", async () => {
    await appear(1280, "light");
    await using screen = await render(<WorkflowRuns />, { router: false });
    expect(screen.container.querySelector("[data-workflow-runs-none]")?.textContent).toBe(
      "Workflow runs cannot be read here: this page has no Backend session for them.",
    );
    expect(screen.container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("reads: polling, visibility, a new session and the newest version", () => {
  it("polls while visible, stops while hidden, and reads again when visible returns", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    using _timers = fakeTimers();
    await using _screen = await render(<Page w={w} pollMs={5000} />, { router: false });
    await flush();
    expect(callsOf(w, "runs")).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await flush();
    expect(callsOf(w, "runs")).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await flush();
    expect(callsOf(w, "runs")).toHaveLength(4);
    {
      using _hidden = tabIs("hidden");
      await tabChanged();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await flush();
      expect(callsOf(w, "runs")).toHaveLength(4);
    }
    // Visible again: one read at once, then the poll goes on.
    await tabChanged();
    await flush();
    expect(callsOf(w, "runs")).toHaveLength(5);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await flush();
    expect(callsOf(w, "runs")).toHaveLength(6);
  });

  it("a poll shows a run the Backend changed, and the runs are read when the network or a new session returns", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => rowState("run-1")).toBe("running");
    expect(callsOf(w, "runs")).toHaveLength(1);
    w.state.runs = [run({ state: "completed", cause: "all members completed" })];
    w.state.version = 4;
    await act(async () => void window.dispatchEvent(new Event("online")));
    await expect.poll(() => rowState("run-1")).toBe("completed");
    expect(callsOf(w, "runs")).toHaveLength(2);
    await newSession(2);
    await expect.poll(() => callsOf(w, "runs").length).toBe(3);
  });

  it("an older reply that lands after a newer one never replaces it", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run({ name: "five" })], 5);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => view()).toBe("live");
    // A slow read for an older version lands after a newer read was applied.
    let release!: (value: TransportResult) => void;
    w.script.runs.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    await act(async () => void window.dispatchEvent(new Event("online")));
    await expect.poll(() => callsOf(w, "runs").length).toBe(2);
    release(ok({ runs: [run({ name: "four" })], version: 4 }));
    await flush();
    expect(row("run-1").textContent).toContain("five");
    expect(row("run-1").textContent).not.toContain("four");
  });

  it("a read that fails after a good one keeps the runs marked stale and offers no Cancel until it reads again", async () => {
    await appear(390, "dark");
    setupAtoms();
    const w = world([run()]);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    w.script.runs.push(() => LOST);
    await act(async () => void window.dispatchEvent(new Event("online")));
    await expect.poll(() => view()).toBe("stale");
    expect(group().textContent).toMatch(/may be out of date/);
    expect(group().textContent).toMatch(/Cancel is not offered until the runs are read again/);
    expect(cancelButton()).toBeNull();
    expect(rowState("run-1")).toBe("running");
    await shot("stale", 390, "dark");
    await newSession(2);
    await expect.poll(() => view()).toBe("live");
    expect(cancelButton()).not.toBeNull();
  });
});

describe("one-click Cancel", () => {
  it("sends one cancel for the run shown, says cancel requested only after the read-back, and returns focus", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    await using screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    await screen.getByRole("button", { name: "Cancel research-sweep" }).click();
    await expect.poll(() => status()).toBe("confirmed");
    expect(w.log.map((call) => call.method)).toEqual(["runs", "cancel", "runs"]);
    expect(callsOf(w, "cancel")[0]?.payload).toEqual({ root: ROOT, runId: "run-1" });
    expect(rowState("run-1")).toBe("cancel-requested");
    expect(row("run-1").textContent).toMatch(/Cancel asked for: the Backend's runs read back show/);
    // Nothing says it is cancelled: only the run's own terminal fact would.
    expect(row("run-1").querySelector("[data-run-chip]")?.textContent).toBe("Cancel requested");
    expect(cancelButton()).toBeNull();
    // The run changed under the button: focus went to the group that says what happened.
    await expect.poll(() => document.activeElement).toBe(group());
    await shot("cancel-requested", 1280, "light");
  });

  it("success waits for the read-back: while it is pending the run is busy and nothing says it worked", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    let release!: (value: TransportResult) => void;
    w.script.runs.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    cancelButton()!.click();
    await expect.poll(() => callsOf(w, "runs").length).toBe(2);
    expect(callsOf(w, "cancel")).toHaveLength(1);
    expect(cancelButton()?.getAttribute("aria-busy")).toBe("true");
    expect(row("run-1").getAttribute("aria-busy")).toBe("true");
    expect(group().getAttribute("aria-busy")).toBe("true");
    expect(group().textContent).not.toMatch(/Cancel asked for/);
    release(ok({ runs: w.state.runs, version: w.state.version }));
    await expect.poll(() => status()).toBe("confirmed");
    expect(group().getAttribute("aria-busy")).toBe("false");
  });

  it("an accepted cancel the read-back does not show is unknown, not success", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    // The Backend accepts, but its list still shows a plain running run.
    w.script.cancel.push(() => ok({ run: run({ cancelRequested: true }) }));
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    cancelButton()!.click();
    await expect.poll(() => status()).toBe("unknown");
    expect(group().textContent).not.toMatch(/Cancel asked for/);
    expect(callsOf(w, "cancel")).toHaveLength(1);
  });

  it("works from the keyboard: focus the button, Enter once, one cancel", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world([run()]);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    const button = cancelButton()!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => callsOf(w, "cancel").length).toBe(1);
    await expect.poll(() => status()).toBe("confirmed");
    await flush();
    expect(callsOf(w, "cancel")).toHaveLength(1);
    expect(group().getAttribute("aria-busy")).toBe("false");
  });

  it("is at least 44 px to touch on the phone and keeps a visible focus ring", async () => {
    await appear(390, "light");
    setupAtoms();
    const w = world([run()]);
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    const rect = cancelButton()!.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.width).toBeGreaterThanOrEqual(44);
    await userEvent.tab();
    const focused = document.activeElement as HTMLElement;
    expect(focused.matches("[data-cancel='ready']")).toBe(true);
    const ring = getComputedStyle(focused);
    expect(ring.outlineStyle !== "none" || ring.boxShadow !== "none").toBe(true);
  });

  it("a double click sends one cancel, and the button stays focusable and says busy", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run(), run({ runId: "run-2", name: "second" })]);
    let release!: (value: TransportResult) => void;
    w.script.cancel.push(() => new Promise<TransportResult>((resolve) => (release = resolve)));
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    const button = cancelButton()!;
    button.focus();
    button.click();
    button.click();
    await expect.poll(() => button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toBe("Cancelling…");
    expect(document.activeElement).toBe(button);
    // Another run's Cancel is its own action.
    expect(cancelButton("run-2")?.getAttribute("aria-disabled")).toBe("false");
    release(ok({ run: w.asked("run-1") }));
    await expect.poll(() => status()).toBe("confirmed");
    await flush();
    expect(callsOf(w, "cancel")).toHaveLength(1);
  });

  it.each([
    ["a lost reply", () => LOST],
    [
      "WORKFLOWS_OUTCOME_UNKNOWN",
      () =>
        fail("WORKFLOWS_OUTCOME_UNKNOWN", { detail: "the cancel was asked for but not finished" }),
    ],
    [
      "a cancel that threw",
      () => {
        throw new Error("socket closed");
      },
    ],
  ] as const)(
    "%s is unknown, is never sent again, reads the runs and offers a new deliberate click",
    async (_name, step) => {
      await appear(390, "light");
      setupAtoms();
      const w = world([run()]);
      w.script.cancel.push(step);
      await using _screen = await render(<Page w={w} pollMs={60} />, { router: false });
      await expect.poll(() => cancelButton()).not.toBeNull();
      cancelButton()!.click();
      await expect.poll(() => status()).toBe("unknown");
      expect(group().textContent).toMatch(/not sent again/);
      expect(group().textContent).not.toMatch(/Cancel asked for/);
      expect(callsOf(w, "cancel")).toHaveLength(1);
      // The runs were read again (the Backend never applied it here) and still offer Cancel; polling goes on, and nothing repeats by itself.
      const reads = callsOf(w, "runs").length;
      await expect.poll(() => callsOf(w, "runs").length).toBeGreaterThan(reads + 2);
      expect(callsOf(w, "cancel")).toHaveLength(1);
      await shot("cancel-unknown", 390, "light");
      // The person's own second click is a new action.
      expect(cancelButton()).not.toBeNull();
      cancelButton()!.click();
      await expect.poll(() => callsOf(w, "cancel").length).toBe(2);
    },
  );

  it("a refusal shows the code and the Backend's words and changes nothing", async () => {
    await appear(1280, "dark");
    setupAtoms();
    const w = world([run()]);
    w.script.cancel.push(() =>
      fail("WORKFLOWS_NOT_AUTHORIZED", { detail: "this device may not operate workflows" }),
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    cancelButton()!.click();
    await expect.poll(() => status()).toBe("refused");
    expect(group().querySelector("[data-refusal-code]")?.getAttribute("data-refusal-code")).toBe(
      "WORKFLOWS_NOT_AUTHORIZED",
    );
    expect(group().querySelector("[data-refusal-code]")?.textContent).toContain(
      "this device may not operate workflows",
    );
    expect(rowState("run-1")).toBe("running");
    await shot("cancel-refused", 1280, "dark");
  });

  it("an unavailable Backend did nothing and says so", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    w.script.cancel.push(() =>
      fail("WORKFLOWS_UNAVAILABLE", {
        detail: "the workflow module is not running; nothing was done",
      }),
    );
    await using _screen = await render(<Page w={w} />, { router: false });
    await expect.poll(() => cancelButton()).not.toBeNull();
    cancelButton()!.click();
    await expect.poll(() => status()).toBe("unavailable");
    expect(group().textContent).toMatch(/could not take the cancel and did nothing/);
    expect(callsOf(w, "cancel")).toHaveLength(1);
  });
});

describe("the runs inside the goal card", () => {
  it("replace the static statement, and a card shown alone still reads nothing", async () => {
    await appear(1280, "light");
    setupAtoms();
    const w = world([run()]);
    const goals: GoalsTransport = {
      snapshot: async () => ok({ goal: null, version: 1 }),
      grant: async () => LOST,
      rearm: async () => LOST,
    };
    {
      await using _screen = await render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <GoalsTransportContext value={goals}>
            <GoalsProvider environmentId={ENV} rootSessionId={ROOT}>
              <WorkflowsTransportContext value={w.transport}>
                <WorkflowsProvider environmentId={ENV} rootSessionId={ROOT} pollMs={IDLE_POLL}>
                  <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 p-4">
                    <GoalsCard />
                  </main>
                </WorkflowsProvider>
              </WorkflowsTransportContext>
            </GoalsProvider>
          </GoalsTransportContext>
        </RegistryContext.Provider>,
        { router: false },
      );
      await expect.poll(() => view()).toBe("live");
      const card = document.querySelector<HTMLElement>("[data-aetheria='goals']")!;
      expect(card.contains(group())).toBe(true);
      expect(card.textContent).not.toContain("not shown on this page yet");
      expect(callsOf(w, "runs")).toHaveLength(1);
    }
    await using _alone = await render(<GoalsCard />, { router: false });
    expect(document.body.textContent).not.toContain("not shown on this page yet");
    expect(document.querySelector("[data-workflow-runs]")).toBeNull();
  });
});
