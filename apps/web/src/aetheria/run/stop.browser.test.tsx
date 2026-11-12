// @effect-diagnostics anyUnknownInErrorContext:off
// The Stop button in the real app (IP-43) on the in-process fake environment: it sends exactly one Aetheria tree Stop and never T3's cascading Stop, whatever the reply.
// Boundary: real router, shell, ChatView and T3 atoms over a fake socket whose client is wrapped to record every call and to answer `aetheria.children.*` as the test says; no backend.
// The `thread.stop` shortcut shares the button's function (stop.mount.test.ts); the fake config binds no shortcut, so it is not pressed here.
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import * as DateTime from "effect/DateTime";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  assistantItem,
  emitThreadEvent,
  isThreadSubscribed,
  runningRun,
  userItem,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act } from "../../../test/render";
import { THREAD_PATH, mountRoute, prepare } from "../harness";

/** Every call the app made to the socket, and the way the test answers the Aetheria ones. */
const probe = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; input: unknown }>,
  answer: (async () => ({})) as (method: string, input: unknown) => Promise<unknown>,
  /**
   * Whether the shell stream reports the open thread's run as active. The fake shell is static (its thread is completed) and T3 keeps the first shell it reads for the whole file, so this is
   * fixed for the file: here the shell always says a run is active, as the server's shell does while a run goes on.
   */
  shell: true,
}));

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer, Effect, Data, Stream] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
      import("effect/Effect"),
      import("effect/Data"),
      import("effect/Stream"),
    ]);
    /** What a failed fake call fails with; the app reads its message. */
    class ProbeFailure extends Data.TaggedError("ProbeFailure")<{ readonly message: string }> {}
    const wrap = (client: Record<string, (input: unknown) => unknown>) =>
      new Proxy(client, {
        get: (target, method: string) => {
          if (method.startsWith("aetheria.children.")) {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return Effect.tryPromise({
                try: () => probe.answer(method, input),
                catch: (error) =>
                  new ProbeFailure({
                    message: error instanceof Error ? error.message : String(error),
                  }),
              });
            };
          }
          if (method === "orchestration.subscribeShell" && probe.shell) {
            // What the server's shell says while a run is active: the activity run, the active run id and, for a Stop, the stop request.
            return (input: unknown) =>
              Stream.map(target[method]!(input) as never, (item: any) =>
                item.kind === "snapshot"
                  ? {
                      ...item,
                      snapshot: {
                        ...item.snapshot,
                        threads: item.snapshot.threads.map((thread: object) => ({
                          ...thread,
                          status: "running",
                          activityRunStatus: "running",
                          activeRunId: "running-run",
                          latestRunId: "running-run",
                        })),
                      },
                    }
                  : item,
              );
          }
          if (method === "orchestration.dispatchCommand") {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return target[method]!(input);
            };
          }
          return target[method];
        },
      });
    const driver = {
      ...fakeDriver,
      connect: (entry: Parameters<FakeDriver["connect"]>[0]) =>
        fakeDriver.connect(entry).pipe(
          Effect.map((lease) => ({
            ...lease,
            session: {
              ...lease.session,
              client: wrap(lease.session.client as never) as never,
            },
          })),
        ),
    };
    return {
      ...actual,
      layer: Layer.succeed(actual.ConnectionDriver, driver as unknown as FakeDriver),
    };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const THREAD = ThreadId.make("thread-matrix");
const TREE = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  value: { rootThreadId: THREAD, rows: [], rootStopped: true, complete: true, ...overrides },
});
const callsTo = (prefix: string) => probe.calls.filter((call) => call.method.startsWith(prefix));
const NATIVE_STOPS = new Set(["thread.stop", "run.interrupt", "subagent.stop"]);
const nativeStops = () =>
  callsTo("orchestration.dispatchCommand").filter((call) =>
    NATIVE_STOPS.has((call.input as { type?: string } | undefined)?.type ?? ""),
  );

async function openRunningThread() {
  probe.calls.length = 0;
  await prepare(1280, 800, "light");
  const app = await mountRoute(THREAD_PATH);
  await expect.poll(() => isThreadSubscribed(THREAD), { timeout: 15_000 }).toBe(true);
  const run = runningRun(THREAD, "running-run", 99, "running-user");
  await act(async () => {
    await emitThreadEvent(THREAD, { type: "run.created", payload: run });
    await emitThreadEvent(THREAD, {
      type: "turn-item.updated",
      payload: userItem(THREAD, run.id, "running-user", 100, "Look into the budget"),
    });
  });
  const stopButton = () => page.getByRole("button", { name: "Stop generation" });
  await expect.poll(() => stopButton().elements().length, { timeout: 15_000 }).toBeGreaterThan(0);
  return { app, stopButton };
}

describe("Stop in the real app sends the Aetheria tree Stop once and never T3's cascading Stop", () => {
  it("one click is exactly one cancelTree call for the open thread, and no native stop", async () => {
    probe.answer = async () => TREE();
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => callsTo("aetheria.children.cancelTree").length).toBe(1);
    expect(callsTo("aetheria.children.cancelTree")[0]?.input).toEqual({ rootThreadId: THREAD });
    expect(callsTo("aetheria.children").length).toBe(1);
    // Nothing else stopped: neither the cascading thread.stop nor a run interrupt nor a subagent stop.
    expect(nativeStops()).toEqual([]);
  });

  it("repeated clicks while the Stop is in flight send nothing more", async () => {
    let release: (value: unknown) => void = () => {};
    probe.answer = () => new Promise((resolve) => (release = resolve));
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    const button = stopButton();
    await button.click();
    await button.click();
    await button.click();
    await expect.poll(() => callsTo("aetheria.children.cancelTree").length).toBe(1);
    expect(callsTo("aetheria.children.cancelTree").length).toBe(1);
    release(TREE());
    expect(nativeStops()).toEqual([]);
  });

  it("a refusal is shown as a refusal and nothing is sent again", async () => {
    probe.answer = async () => ({ ok: false, code: "CHILDREN_NOT_AUTHORIZED" });
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("Stop refused");
    expect(document.body.textContent).toContain("cannot stop work");
    expect(callsTo("aetheria.children.cancelTree").length).toBe(1);
    expect(nativeStops()).toEqual([]);
  });

  it("a revoked device is told so", async () => {
    probe.answer = async () => ({ ok: false, code: "CHILDREN_DEVICE_REVOKED" });
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("revoked or has expired");
  });

  it("a lost reply is shown as not known and is not sent again", async () => {
    probe.answer = async () => {
      throw new Error("SocketCloseError: the socket closed before the reply");
    };
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("not known whether it applied");
    expect(document.body.textContent).toContain("not sent again");
    expect(callsTo("aetheria.children.cancelTree").length).toBe(1);
    expect(nativeStops()).toEqual([]);
  });

  it("a Backend answer that may have landed is not shown as stopped", async () => {
    probe.answer = async () => ({ ok: false, code: "CHILDREN_OUTCOME_UNKNOWN", detail: "x" });
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("not known whether it applied");
    expect(document.body.textContent).not.toContain("Stop sent");
  });

  it("a Backend that did nothing says so", async () => {
    probe.answer = async () => ({
      ok: false,
      code: "CHILDREN_UNAVAILABLE",
      detail: "the children service is not running; nothing was done",
    });
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("nothing was done");
  });

  it("a tree M05 could not finish is partly done, naming the child it could not handle", async () => {
    probe.answer = async () =>
      TREE({
        rows: [
          { childId: "child-a", action: "interrupted" },
          { childId: "child-b", action: "failed", detail: "the close was not confirmed (X)" },
        ],
        complete: false,
      });
    const { app, stopButton } = await openRunningThread();
    await using _screen = app.screen;
    await stopButton().click();
    await expect.poll(() => document.body.textContent).toContain("partly done");
    expect(document.body.textContent).toContain("child-b");
    expect(document.body.textContent).toContain("interrupted child-a");
  });
});

// What a person sees while a Stop is under way: the indicator's words come from T3's own run-stop presentation (a run_interrupt_request item, with `unresponsiveAt` once the provider
// stops answering), never from a client timer. The images are evidence to view; the assertions prove the words.
const START = Date.parse("2026-11-12T10:00:00.000Z");
const running = () => document.querySelector<HTMLElement>("[data-aetheria='running']");
const words = () => running()?.querySelector("[role='status']")?.textContent ?? null;
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

const openRowText = () =>
  document.querySelector('[data-aetheria="sessions"] [data-session-row][aria-current="page"]')
    ?.textContent ?? "";
const userBubble = () =>
  [...document.querySelectorAll<HTMLElement>("*")]
    .filter((node) => node.children.length === 0 && node.textContent === "Look into the budget")
    .at(-1) ?? null;

/**
 * Scrolls the timeline to its end and waits until the indicator row AND the last message sit above the composer, and stay there: a banner that appears later (a Stop under way, Force stop)
 * moves the composer, so the check must hold for several polls in a row before a capture.
 */
async function settleAtEnd() {
  let steady = 0;
  await expect
    .poll(
      () => {
        const scroller = running() && scrollerOf(running()!);
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        const above = composer()?.getBoundingClientRect().top ?? Infinity;
        const row = running()!.getBoundingClientRect();
        const bubble = userBubble()?.getBoundingClientRect();
        const clear =
          row.bottom <= above && bubble !== undefined && bubble.top >= 0 && bubble.bottom <= above;
        steady = clear ? steady + 1 : 0;
        return steady >= 6;
      },
      { timeout: 8_000 },
    )
    .toBe(true);
}

describe("the Stop states a person sees", () => {
  const CASES = (["running", "stopping", "unresponsive"] as const).flatMap((state) =>
    ([1280, 390] as const).flatMap((width) =>
      (["light", "dark"] as const).map((mode) => [state, width, mode] as const),
    ),
  );

  it.each(CASES)("%s at %s, %s", async (state, width, mode) => {
    probe.answer = async () => TREE();
    probe.calls.length = 0;
    await prepare(width, width === 1280 ? 800 : 844, mode);
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.poll(() => isThreadSubscribed(THREAD), { timeout: 15_000 }).toBe(true);
    vi.setSystemTime(START + 12_000);
    try {
      const startedAt = DateTime.makeUnsafe(START);
      const run = {
        ...runningRun(THREAD, "running-run", 99, "running-user"),
        startedAt,
        requestedAt: startedAt,
      };
      await act(async () => {
        await emitThreadEvent(THREAD, { type: "run.created", payload: run });
        await emitThreadEvent(THREAD, {
          type: "turn-item.updated",
          payload: userItem(THREAD, run.id, "running-user", 100, "Look into the budget"),
        });
      });
      if (state !== "running") {
        const {
          messageId: _m,
          text: _t,
          streaming: _s,
          ...base
        } = assistantItem(THREAD, run.id, "interrupt", 101, "");
        const request = {
          ...base,
          type: "run_interrupt_request",
          status: "completed",
          title: "Interrupt",
          message: "Stopped by user",
          startedAt,
          completedAt: startedAt,
          ...(state === "unresponsive" ? { unresponsiveAt: startedAt } : {}),
        } as never;
        await act(() => emitThreadEvent(THREAD, { type: "turn-item.updated", payload: request }));
      }
      await expect.poll(running, { timeout: 15_000 }).not.toBeNull();
      await expect
        .poll(words, { timeout: 5_000 })
        .toBe(
          state === "running"
            ? "Gathering knowledge"
            : state === "stopping"
              ? "Stopping…"
              : "Not responding",
        );
      await settleAtEnd();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      // The wide layout has the session list beside the conversation: its row for this thread says the run is active, never Idle.
      if (width === 1280) {
        await expect.poll(openRowText, { timeout: 5_000 }).toMatch(/Working/);
        expect(openRowText()).not.toMatch(/Idle/);
      }
      await page.screenshot({
        base64: true,
        path: `__screenshots__/stop-${state}-${width}-${mode}.png`,
        save: true,
      });
      // Nothing in the view sent a stop of its own: showing a state is not an action.
      expect(callsTo("aetheria.children")).toEqual([]);
      expect(nativeStops()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the session row of a thread with an active run", () => {
  it("says Working, never Idle, from the shell's own run status", async () => {
    probe.calls.length = 0;
    await prepare(1280, 800, "light");
    const app = await mountRoute(THREAD_PATH);
    await using _screen = app.screen;
    await expect.poll(openRowText, { timeout: 15_000 }).toMatch(/Working/);
    expect(openRowText()).not.toMatch(/Idle/);
  });
});
