// The route availability and usage panel in a real browser with the real stylesheet (M10 Plan step 18, D14, D20, XC-11). Boundary: the public `UsagePanel` over a fake `UsageTransport` supplied
// through its context (no T3 socket, no real Backend), so these show the panel's behaviour and words, not the wire. The images are evidence for a person to view; the assertions prove the words,
// the call counts, the layout and the names.
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { act, render } from "../../../../test/render";
import type { Reply } from "../jobs/reply";
import { over, ratio, resolveColor, surfaceBehind } from "../../measure";
import { UsagePanel } from "./UsagePanel";
import { UNAVAILABLE_USAGE, UsageTransportContext, type UsageTransport } from "./transport";

type Mode = "light" | "dark";
const ENV = "env-1";

const probe = {
  calls: [] as Array<Record<string, unknown>>,
  answer: (async () => ({ ok: true, value: { routes: [], readings: [] } })) as (
    input: Record<string, unknown>,
  ) => Promise<Reply<unknown>>,
};
const ok = (value: unknown): Promise<Reply<unknown>> => Promise.resolve({ ok: true, value });
const fail = (code: string, detail?: string): Promise<Reply<unknown>> =>
  Promise.resolve({ ok: false, code, ...(detail === undefined ? {} : { detail }) });

const state = (over: Record<string, unknown> = {}) => ({
  state: "available",
  reasonClass: "signed-in-window-ok",
  observedAt: "2026-11-13T10:00:00Z",
  basis: [{ signal: "window", result: "ok", at: "2026-11-13T09:59:00Z", windowId: "5h" }],
  ...over,
});
const ROUTES = [
  { route: { provider: "anthropic", model: "opus" }, childLabel: "Researcher", state: state() },
  {
    route: { provider: "openai", model: "gpt-5" },
    childLabel: "Reviewer",
    state: state({
      state: "out",
      reasonClass: "limit-remembered",
      resetsAt: "2026-11-13T15:00:00Z",
    }),
  },
  {
    route: { provider: "google", model: "gemini" },
    childLabel: "Reader",
    state: state({ state: "unknown", reasonClass: "no-signal", basis: [] }),
  },
];
const READINGS = [
  {
    provider: "anthropic",
    observedAt: "2026-11-13T10:00:00Z",
    fetchedAt: "2026-11-13T10:00:00Z",
    status: "ok",
    stale: false,
    lastGoodAt: "2026-11-13T10:00:00Z",
    windows: [{ id: "5h", usedPercent: 42, resetsAt: "2026-11-13T15:00:00Z" }],
  },
  {
    provider: "openai",
    observedAt: "2026-11-13T10:00:00Z",
    fetchedAt: "2026-11-13T10:00:00Z",
    status: "unavailable",
    stale: false,
    lastGoodAt: null,
    failure: "no-credential",
    windows: [],
  },
  {
    provider: "google",
    observedAt: "2026-11-13T10:00:00Z",
    fetchedAt: "2026-11-13T10:00:00Z",
    status: "stale",
    stale: true,
    lastGoodAt: "2026-11-13T09:50:00Z",
    ageSeconds: 600,
    failure: "timeout",
    windows: [{ id: "daily", usedPercent: "unknown" }],
  },
];
const FULL = { routes: ROUTES, readings: READINGS };

const reset = () => {
  probe.calls.length = 0;
  probe.answer = () => ok(FULL);
};
const transport: UsageTransport = {
  read: (request) => {
    probe.calls.push({ ...request });
    return probe.answer({ ...request });
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
const held = () => {
  let release: (value: Reply<unknown>) => void = () => {};
  const promise = new Promise<Reply<unknown>>((resolve) => (release = resolve));
  return { promise, release };
};

function Shell(props: { readonly root?: string; readonly connected?: boolean }) {
  const panel: ReactNode = <UsagePanel environmentId={ENV} threadId={props.root ?? "root-1"} />;
  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto w-full max-w-2xl p-4" data-testid="sheet">
        <UsageTransportContext value={props.connected === false ? UNAVAILABLE_USAGE : transport}>
          {panel}
        </UsageTransportContext>
      </main>
    </div>
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
  await expect.poll(() => text()).toContain("Researcher");
  return screen;
}

describe("with no connection", () => {
  it("says usage is not connected; no route is out or available and no usage is shown", async () => {
    await setup(1280, 800, "light");
    await using screen = await render(<Shell connected={false} />, { router: false });
    await expect
      .poll(() => text())
      .toContain("Route availability and usage are not connected yet (M09 read).");
    expect(screen.container.querySelector("[data-route]")).toBe(null);
    expect(screen.container.querySelector("[data-provider]")).toBe(null);
    expect(text()).not.toContain("0%");
    expect(text()).not.toContain("lists no");
  });

  it("still says the main thread's route is not supplied by the Backend", async () => {
    await setup(1280, 800, "light");
    await using _screen = await render(<Shell connected={false} />, { router: false });
    await expect
      .poll(() => text())
      .toContain("The main thread's route is not supplied by the Backend.");
  });
});

describe("what the Backend could not read", () => {
  it("says an unread usage section and an unread children section are unknown, never an empty list or a usage of 0", async () => {
    await setup(1280, 800, "light");
    probe.answer = () =>
      ok({
        routes: [],
        readings: [],
        notes: { readings: "the usage reader is down", routes: "the child records are unreadable" },
      });
    await using screen = await render(<Shell />, { router: false });
    await expect
      .poll(() => text())
      .toContain(
        "Usage could not be read, so it is not known (this is not zero usage): the usage reader is down",
      );
    expect(text()).toContain(
      "The child routes could not be read, so they are not known: the child records are unreadable",
    );
    expect(screen.container.querySelector("[data-testid='routes-empty']")).toBe(null);
    expect(screen.container.querySelector("[data-testid='readings-empty']")).toBe(null);
  });

  it("names a child whose route has no state to show, beside the routes that do", async () => {
    await setup(1280, 800, "light");
    probe.answer = () =>
      ok({
        routes: ROUTES.slice(0, 1),
        readings: [],
        notes: { children: ["Child kid-a: no route is recorded for it."] },
      });
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("Child kid-a: no route is recorded for it.");
    expect(screen.container.querySelectorAll("[data-route]")).toHaveLength(1);
  });
});

describe("routes", () => {
  it("reads once and shows each child route's state, reason class, reason and basis as supplied", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(probe.calls).toEqual([{ environmentId: ENV, rootThreadId: "root-1" }]);
    const rows = [...screen.container.querySelectorAll<HTMLElement>("[data-route]")];
    expect(rows.map((row) => row.dataset.route)).toEqual([
      "anthropic/opus",
      "openai/gpt-5",
      "google/gemini",
    ]);
    expect(rows.map((row) => row.dataset.state)).toEqual(["available", "out", "unknown"]);
    expect(rows[0]?.textContent).toContain("Researcher");
    expect(rows[0]?.textContent).toContain("Available");
    expect(rows[0]?.textContent).toContain("signed-in-window-ok");
    expect(rows[0]?.textContent).toContain("Signed in, and its usage window has room.");
    expect(rows[0]?.textContent).toContain("window: ok at 2026-11-13T09:59:00Z (window 5h)");
    expect(rows[1]?.textContent).toContain("Out");
    expect(rows[1]?.textContent).toContain("limit-remembered");
    expect(rows[1]?.textContent).toContain("Resets 2026-11-13T15:00:00Z");
    expect(rows[2]?.textContent).toContain("Unknown");
    expect(rows[2]?.textContent).toContain("No basis was supplied for this state.");
  });

  it("the main thread's route is said not to be supplied by the Backend", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(screen.container.querySelector("[data-testid='main-route']")?.textContent).toBe(
      "The main thread's route is not supplied by the Backend.",
    );
  });

  it("no routes is said only when the Backend said so; an unreadable answer is unknown, not empty", async () => {
    await setup(1280, 800, "light");
    probe.answer = () => ok({ routes: [], readings: [] });
    await using _empty = await render(<Shell />, { router: false });
    await expect
      .poll(() => text())
      .toContain("The Backend lists no child routes for this session.");
    reset();
    probe.answer = () =>
      ok({
        routes: [{ route: { provider: "a", model: "b" }, state: { state: "busy" } }],
        readings: [],
      });
    await using bad = await render(<Shell />, { router: false });
    await expect
      .poll(() => text())
      .toContain("could not be read, so route availability and usage are not known");
    expect(bad.container.querySelector("[data-route]")).toBe(null);
  });
});

describe("usage readings", () => {
  it("shows each provider's reading as supplied; unavailable and unknown are never 0", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const rows = [...screen.container.querySelectorAll<HTMLElement>("[data-provider]")];
    expect(rows.map((row) => row.dataset.provider)).toEqual(["anthropic", "openai", "google"]);
    expect(rows[0]?.textContent).toContain("Current");
    expect(rows[0]?.textContent).toContain("5h: 42% used");
    expect(rows[1]?.textContent).toContain("Unavailable");
    expect(rows[1]?.textContent).toContain("No usage was read: no credential for this provider.");
    expect(rows[1]?.textContent).not.toMatch(/\d+%/);
    expect(rows[2]?.textContent).toContain("Stale");
    expect(rows[2]?.textContent).toContain("daily: usage unknown");
    expect(rows[2]?.textContent).not.toMatch(/\b0%/);
    expect(rows[2]?.textContent).toContain("the latest read failed: the read timed out.");
  });

  it("no readings says none were supplied and that this is not zero usage", async () => {
    await setup(1280, 800, "light");
    probe.answer = () => ok({ routes: ROUTES, readings: [] });
    await using _screen = await mount();
    await expect
      .poll(() => text())
      .toContain("The Backend supplied no usage readings. That is not zero usage.");
  });

  it("a fixture-labelled answer is marked as fixture data", async () => {
    await setup(1280, 800, "light");
    probe.answer = () =>
      ok({
        routes: [{ ...ROUTES[0], state: state({ label: "fixture" }) }],
        readings: [{ ...READINGS[0], label: "fixture" }],
      });
    await using screen = await mount();
    expect(screen.container.querySelectorAll("[data-fixture='true']").length).toBe(2);
  });
});

describe("reads", () => {
  it("a refusal shows the Backend's words and code, not empty routes", async () => {
    await setup(1280, 800, "light");
    probe.answer = () => fail("USAGE_DEVICE_REVOKED", "revoked at 09:41");
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("revoked at 09:41");
    expect(screen.container.querySelector("[data-refusal-code='USAGE_DEVICE_REVOKED']")).not.toBe(
      null,
    );
    expect(screen.container.querySelector("[data-route]")).toBe(null);
  });

  it("a read whose reply never came is unknown, never an empty answer", async () => {
    await setup(1280, 800, "light");
    probe.answer = () => Promise.reject(new Error("socket closed"));
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("are not known");
    expect(screen.container.querySelector("[data-route]")).toBe(null);
    expect(text()).not.toContain("lists no");
  });

  it("Refresh reads again, and a stale reply never replaces a newer one", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const old = held();
    let reads = 0;
    probe.answer = () => {
      reads += 1;
      return reads === 1
        ? old.promise
        : ok({ routes: [{ ...ROUTES[0], childLabel: "Fresh child" }], readings: [] });
    };
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await screen.getByRole("button", { name: "Refresh usage" }).click();
    await expect.poll(() => text()).toContain("Fresh child");
    old.release({
      ok: true,
      value: { routes: [{ ...ROUTES[0], childLabel: "Stale child" }], readings: [] },
    });
    await pause();
    expect(text()).toContain("Fresh child");
    expect(text()).not.toContain("Stale child");
  });

  it("two roots never mix: a late reply for the first root does not land under the second", async () => {
    await setup(1280, 800, "light");
    const first = held();
    probe.answer = (input) =>
      input.rootThreadId === "root-1"
        ? first.promise
        : ok({ routes: [{ ...ROUTES[0], childLabel: "Second root child" }], readings: [] });
    await using screen = await render(<Shell />, { router: false });
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("Second root child");
    first.release({
      ok: true,
      value: { routes: [{ ...ROUTES[0], childLabel: "First root child" }], readings: [] },
    });
    await pause();
    expect(text()).toContain("Second root child");
    expect(text()).not.toContain("First root child");
  });
});

describe("captured at 1280 and 390, light and dark", () => {
  const surfaces = ["full", "unavailable", "refusal"] as const;
  const cases = surfaces.flatMap((surface) =>
    ([1280, 390] as const).flatMap((width) =>
      (["light", "dark"] as const).map((mode) => [surface, width, mode] as const),
    ),
  );
  it.each(cases)("%s at %i px, %s", async (surface, width, mode) => {
    await setup(width, width === 390 ? 844 : 900, mode);
    if (surface === "refusal")
      probe.answer = () => fail("USAGE_DEVICE_REVOKED", "revoked at 09:41");
    await using screen =
      surface === "full"
        ? await mount()
        : await render(<Shell connected={surface !== "unavailable"} />, { router: false });
    if (surface === "unavailable") await expect.poll(() => text()).toContain("not connected yet");
    if (surface === "refusal")
      await expect.poll(() => document.querySelector("[data-refusal-code]")).not.toBe(null);
    for (const selector of ["h2", "header button"]) {
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
      "li, [data-refusal-code]",
    )) {
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    for (const control of screen.container.querySelectorAll<HTMLElement>("button")) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim()).not.toBe("");
    }
    await page.screenshot({
      base64: true,
      path: `__screenshots__/usage-${surface}-${width}-${mode}.png`,
      save: true,
    });
  });
});
