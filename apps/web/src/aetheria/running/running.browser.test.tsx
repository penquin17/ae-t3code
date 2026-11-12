// The running indicator in the real app (IP-39) on the in-process fake environment, with a running
// run. The images are evidence to view; the assertions prove its words, mark and time.
// Boundary: real router, shell, timeline and T3 atoms over a fake socket; no backend.
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  assistantItem,
  emitThreadEvent,
  isThreadSubscribed,
  runningRun,
  type FakeDriver,
  userItem,
} from "../../../test/fakeEnvironment";
import { act } from "../../../test/render";
import { THREAD_PATH, mountRoute, prepare, reducedMotion, type Mode } from "../harness";
import { sampleText, summarize } from "../measure";

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

const THREAD = ThreadId.make("thread-matrix");
// The clock is fixed twelve seconds after the run's start, so the time reads 12s and never the
// fixture's old date.
const START = Date.parse("2026-11-12T10:00:00.000Z");
/** `startRun` freezes the page's date; `using _clock = frozenDate()` restores it when the test ends. */
function frozenDate(): Disposable {
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}
const freshRun = () => {
  const startedAt = DateTime.makeUnsafe(START);
  return {
    ...runningRun(THREAD, "running-run", 99, "running-user"),
    startedAt,
    requestedAt: startedAt,
  };
};
const running = () => document.querySelector<HTMLElement>("[data-aetheria='running']");
const words = () => running()?.querySelector("[role='status']")?.textContent ?? null;
const shot = (name: string) =>
  page.screenshot({ base64: true, path: `__screenshots__/running-${name}.png`, save: true });
const closeUp = (name: string) =>
  page
    .elementLocator(running()!)
    .screenshot({ base64: true, path: `__screenshots__/running-${name}-closeup.png`, save: true });

async function startRun() {
  await expect.poll(() => isThreadSubscribed(THREAD), { timeout: 15_000 }).toBe(true);
  // Frozen only now, once the app is connected, so its own waits are not held back.
  vi.setSystemTime(START + 12_000);
  const run = freshRun();
  await act(async () => {
    await emitThreadEvent(THREAD, { type: "run.created", payload: run });
    await emitThreadEvent(THREAD, {
      type: "turn-item.updated",
      payload: userItem(THREAD, run.id, "running-user", 100, "Look into the budget"),
    });
  });
  return run;
}

// A running tool item built from the fixture's own assistant item, so every base field is valid.
function toolItem(
  runId: ReturnType<typeof freshRun>["id"],
  ordinal: number,
  type: string,
  extra: Record<string, unknown>,
) {
  const {
    messageId: _m,
    text: _t,
    streaming: _s,
    ...base
  } = assistantItem(THREAD, runId, `tool-${ordinal}`, ordinal, "");
  return { ...base, type, status: "running", completedAt: null, ...extra } as never;
}

const composer = () => document.querySelector('[contenteditable="true"]')?.closest("form") ?? null;

function scrollerOf(element: Element): HTMLElement | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (
      /(auto|scroll)/.test(getComputedStyle(node).overflowY) &&
      node.scrollHeight > node.clientHeight
    ) {
      return node as HTMLElement;
    }
  }
  return null;
}

/** Scrolls the timeline to its end and waits until the running row sits above the composer. */
async function settleAtEnd() {
  await expect
    .poll(
      () => {
        const scroller = running() && scrollerOf(running()!);
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        const row = running()!.getBoundingClientRect();
        return row.bottom <= (composer()?.getBoundingClientRect().top ?? Infinity);
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

const MODES: readonly Mode[] = ["light", "dark"];

describe("the running thread in the real app", () => {
  it("the words follow the thread's own items: a writing tool weaves, a search gathers, asking connects", async () => {
    using _clock = frozenDate();
    await prepare(1280, 800, "light");
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    const run = await startRun();
    await expect.poll(running, { timeout: 15_000 }).not.toBeNull();
    // Nothing reported running yet, so the beginning of a turn gathers.
    await expect.poll(words).toBe("Gathering knowledge");
    expect(document.body.textContent).not.toContain("Working for");
    const emit = (payload: never) =>
      act(() => emitThreadEvent(THREAD, { type: "turn-item.updated", payload }));
    await emit(toolItem(run.id, 101, "file_change", { fileName: "report.md" }));
    // The hold keeps the shown phase steady for a moment; the new one replaces it afterwards.
    await expect.poll(words, { timeout: 5_000 }).toBe("Weaving knowledge");
    await emit(toolItem(run.id, 102, "file_search", { pattern: "budget" }));
    await expect.poll(words, { timeout: 5_000 }).toBe("Gathering knowledge");
    await emit(toolItem(run.id, 103, "dynamic_tool", { toolName: "ask_user_question", input: {} }));
    await expect.poll(words, { timeout: 5_000 }).toBe("Connecting ideas");
    await emit(toolItem(run.id, 104, "dynamic_tool", { toolName: null, input: {} }));
    await expect.poll(words, { timeout: 5_000 }).toBe("Working");
  });

  it.each(MODES)("the indicator's words meet 4.5:1 in %s mode", async (mode) => {
    using _clock = frozenDate();
    await prepare(1280, 800, mode);
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await startRun();
    await expect.poll(running, { timeout: 15_000 }).not.toBeNull();
    const rows = summarize(sampleText(running()!));
    expect(rows.length).toBeGreaterThan(0);
    const failing = rows.filter((row) => row.ratio < 4.5);
    expect(failing.map((row) => `${row.ratio.toFixed(2)} ${row.text}`)).toEqual([]);
  });
});

/** The mark's parts, with the opacity each is painted at. */
const partOpacities = (attribute: "grain" | "body") =>
  [...running()!.querySelectorAll(`[data-ae-run='${attribute}']`)].map((part) =>
    Number.parseFloat(getComputedStyle(part).opacity),
  );

describe("what a person sees", () => {
  const CASES = (["reduced", "mid"] as const).flatMap((frame) =>
    ([1280, 390] as const).flatMap((width) => MODES.map((mode) => [frame, width, mode] as const)),
  );

  it.each(CASES)(
    "%s frame at %s, %s: the mark, the words and a time in seconds",
    async (frame, width, mode) => {
      using _clock = frozenDate();
      await prepare(width, width === 1280 ? 800 : 844, mode);
      // Reduced motion shows the whole, still mark; the mid frame is the build paused part-way.
      await using _motion =
        frame === "reduced" ? await reducedMotion() : { [Symbol.asyncDispose]: async () => {} };
      const app = await mountRoute(THREAD_PATH);
      await using _screen = app.screen;
      await startRun();
      await expect.poll(running, { timeout: 15_000 }).not.toBeNull();
      await settleAtEnd();

      const mark = running()!.querySelector<SVGElement>("[data-ae-run='mark']")!;
      const box = mark.getBoundingClientRect();
      // The design token's size (--ae-running-mark, 14px), as the DSH indicator draws it.
      expect(box.width).toBeGreaterThanOrEqual(13.5);
      expect(box.width).toBeLessThanOrEqual(14.5);
      expect(box.height).toBeCloseTo(box.width, 1);

      if (frame === "mid") {
        // 840ms of the 2400ms loop: about seven of the thirteen grains are lit, the rest are ghosts.
        for (const animation of mark.getAnimations()) {
          animation.pause();
          animation.currentTime = 840;
        }
        await expect
          .poll(() => partOpacities("grain").filter((o) => o > 0.9).length)
          .toBeGreaterThanOrEqual(10);
        const lit = partOpacities("grain").filter((o) => o > 0.9).length;
        const ghosts = partOpacities("grain").filter((o) => o < 0.3).length;
        expect(lit).toBeGreaterThanOrEqual(10);
        expect(ghosts).toBeGreaterThanOrEqual(10);
      } else {
        expect(partOpacities("grain").every((o) => o === 1)).toBe(true);
        expect(partOpacities("body").every((o) => o === 1)).toBe(true);
      }

      // The time runs from the backend's turn start, twelve seconds before the frozen clock.
      expect(running()!.textContent).toMatch(/Gathering knowledge · 12s$/);

      // The row clears the composer and the page does not scroll sideways.
      expect(running()!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        composer()!.getBoundingClientRect().top,
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await shot(`${width}-${mode}-${frame}`);
      await closeUp(`${width}-${mode}-${frame}`);
    },
  );
});
