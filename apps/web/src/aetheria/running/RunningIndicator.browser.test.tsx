// The running indicator as drawn from a given shape: the settle hold, the polite announcement, its
// disposal and reduced motion. The shape comes from the backend's facts (status.test.ts); here it is
// supplied, so the timing rules can be driven with fake timers.
// Boundary: a real browser and the real stylesheet; no backend and no T3 timeline.
import { describe, expect, it, vi } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { act, fakeTimers, render, type Screen } from "../../../test/render";
import { RunningIndicator } from "./RunningIndicator";
import type { RunningShape } from "./status";

const HOLD = 800;
const gather: RunningShape = { kind: "phase", phase: "gather" };
const connect: RunningShape = { kind: "phase", phase: "connect" };
const weave: RunningShape = { kind: "phase", phase: "weave" };

const indicator = (shape: RunningShape, createdAt: string | null = null) => (
  <RunningIndicator shape={shape} createdAt={createdAt} holdMs={HOLD} />
);

const live = (screen: Screen) =>
  screen.container.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
const visible = (screen: Screen) =>
  screen.container.querySelector<HTMLElement>("[data-aetheria='running']")!.textContent ?? "";
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe("the settle hold", () => {
  it("shows the first phase at once and a later one only after it has stayed for the whole hold", async () => {
    using _timers = fakeTimers();
    await using screen = await render(indicator(gather), { router: false });
    expect(live(screen).textContent).toBe("Gathering knowledge");
    await screen.rerender(indicator(connect));
    await advance(HOLD - 1);
    expect(live(screen).textContent).toBe("Gathering knowledge");
    await advance(1);
    expect(live(screen).textContent).toBe("Connecting ideas");
  });

  it("a different candidate restarts the wait and returning to the shown phase cancels it", async () => {
    using _timers = fakeTimers();
    await using screen = await render(indicator(gather), { router: false });
    await screen.rerender(indicator(connect));
    await advance(600);
    await screen.rerender(indicator(weave));
    await advance(600);
    expect(live(screen).textContent).toBe("Gathering knowledge");
    await advance(200);
    expect(live(screen).textContent).toBe("Weaving knowledge");
    await screen.rerender(indicator(connect));
    await advance(400);
    await screen.rerender(indicator(weave));
    await advance(HOLD * 2);
    expect(live(screen).textContent).toBe("Weaving knowledge");
  });

  it("backend states are not phases: waiting, stopping, not responding and Working show at once", async () => {
    using _timers = fakeTimers();
    await using screen = await render(indicator(gather), { router: false });
    for (const [shape, words] of [
      [{ kind: "waiting" }, "Waiting for you"],
      [{ kind: "stopping" }, "Stopping…"],
      [{ kind: "unresponsive" }, "Not responding"],
      [{ kind: "working" }, "Working"],
    ] as const) {
      await screen.rerender(indicator(shape));
      expect(live(screen).textContent).toBe(words);
    }
  });

  it("after a state that is not a phase, the next phase shows at once", async () => {
    using _timers = fakeTimers();
    await using screen = await render(indicator(connect), { router: false });
    await screen.rerender(indicator({ kind: "waiting" }));
    await screen.rerender(indicator(weave));
    expect(live(screen).textContent).toBe("Weaving knowledge");
  });
});

describe("the polite announcement", () => {
  it("one turn announces each settled phase word once, never a phase that did not settle", async () => {
    using _timers = fakeTimers();
    await using screen = await render(indicator(gather), { router: false });
    const announced: string[] = [live(screen).textContent ?? ""];
    const observer = new MutationObserver(() => {
      const text = live(screen).textContent ?? "";
      if (announced.at(-1) !== text) announced.push(text);
    });
    observer.observe(live(screen), { childList: true, characterData: true, subtree: true });
    await screen.rerender(indicator(connect));
    await advance(300);
    await screen.rerender(indicator(gather));
    await advance(HOLD);
    await screen.rerender(indicator(weave));
    await advance(HOLD);
    await screen.rerender(indicator(weave));
    await advance(HOLD);
    observer.disconnect();
    expect(announced).toEqual(["Gathering knowledge", "Weaving knowledge"]);
  });

  it("the live region holds the words only; the duration is visible text outside it", async () => {
    using _timers = fakeTimers({ now: new Date("2026-11-12T10:00:12.000Z") });
    await using screen = await render(indicator(gather, "2026-11-12T10:00:00.000Z"), {
      router: false,
    });
    expect(live(screen).textContent).toBe("Gathering knowledge");
    expect(visible(screen)).toContain("Gathering knowledge · 12s");
  });

  it("without a backend turn start there is no duration", async () => {
    await using screen = await render(indicator(gather), { router: false });
    expect(visible(screen)).not.toContain("·");
  });
});

describe("disposal", () => {
  it("unmounting with a phase change pending leaves no timer behind", async () => {
    using _timers = fakeTimers();
    const screen = await render(indicator(gather), { router: false });
    await screen.rerender(indicator(connect));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await screen[Symbol.asyncDispose]();
  });
});

describe("reduced motion", () => {
  const mark = (screen: Screen) =>
    screen.container.querySelector<SVGElement>("[data-ae-run='mark']")!;
  const opacities = (screen: Screen) =>
    [
      ...screen.container.querySelectorAll<SVGElement>(
        "[data-ae-run='grain'], [data-ae-run='body']",
      ),
    ].map((part) => Number.parseFloat(getComputedStyle(part).opacity));

  it("animates the mark by default", async () => {
    await using screen = await render(indicator(gather), { router: false });
    expect(getComputedStyle(mark(screen)).animationName).not.toBe("none");
  });

  it("with reduced motion the mark is whole, full and still", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    try {
      await using screen = await render(indicator(gather), { router: false });
      expect(getComputedStyle(mark(screen)).animationName).toBe("none");
      const all = opacities(screen);
      // 13 grains and 3 body parts (stalk, two blades) per side, plus the spark.
      expect(all).toHaveLength(2 * (13 + 3) + 1);
      expect(all.every((opacity) => opacity === 1)).toBe(true);
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
    }
  });

  it("the mark is decoration: hidden from assistive technology", async () => {
    await using screen = await render(indicator(gather), { router: false });
    expect(mark(screen).getAttribute("aria-hidden")).toBe("true");
  });
});
