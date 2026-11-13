// @effect-diagnostics anyUnknownInErrorContext:off
// AETHERIA M10 step 24 (D17, XC-7, XC-19): the regions the REAL mounted Aetheria routes register, against the manifest. Boundary: real router, shell, T3 atoms and every Aetheria page over a FAKE SOCKET whose
// client is wrapped to record each call and answer `aetheria.*` (the region report is answered as accepted); no Backend runs, so what the Backend stores for a report is step 23's own test. What this
// proves: the union of regions registered across the routes equals the manifest (a missing and an extra region both fail), only declared value fields are queryable, nothing a person wrote reaches a
// query, every region is removed when its page unmounts, and answering a query sends nothing. The reporter is mounted by the shell layout beside the sidebar, so it also runs at phone width with the drawer closed.
// T3's own surfaces (shell, rail, drawer, transcript, composer, files, terminal, diff, settings) are registered by one Aetheria component that reads T3's route, sidebar and panel state (review 2, F2): each is
// always registered, and `visible` follows what T3 shows — checked here at 1280 and 390, with the drawer closed and open, over the real router and T3's own stores.
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import type * as Context from "effect/Context";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  emitThreadEvent,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  isThreadSubscribed,
  runningRun,
  threadWithHistory,
  userItem,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act } from "../../../test/render";
import { currentConnectionView } from "../connection/current";
import { gateOnConnection } from "../connection/gate";
import { createActionRunner } from "../core/outcome";
import { useRightPanelStore } from "~/rightPanelStore";
import { useTerminalUiStateStore } from "~/terminalUiStateStore";
import { mountRoute, prepare, THREAD_PATH } from "../harness";
import { DECLARED_REGION_IDS, getAppRegionRegistry, REGION_DECLARATIONS } from "./index";

const THREAD_COUNT = 40;
installFakeEnvironment([
  threadWithHistory("thread-matrix", 3),
  threadWithHistory("thread-noident", 3),
  ...Array.from({ length: THREAD_COUNT }, (_, n) => threadWithHistory(`thread-c${n + 1}`, 1)),
]);

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; input: unknown }>,
}));

// Threads named `thread-c<n>` carry a strong Pi native reference, so the control page can bind; every `aetheria.*` call is recorded and answered as unavailable, except the region report.
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
    class ProbeFailure extends Data.TaggedError("ProbeFailure")<{ readonly message: string }> {}
    const wrap = (client: Record<string, (input: unknown) => unknown>) =>
      new Proxy(client, {
        get: (target, method: string) => {
          if (method === "aetheria.interactions.changes") {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return Stream.never;
            };
          }
          if (method.startsWith("aetheria.")) {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return Effect.tryPromise({
                try: async () =>
                  method === "aetheria.regions.report"
                    ? {
                        ok: true,
                        value: {
                          clientId: (input as { clientId: string }).clientId,
                          sequence: (input as { sequence: number }).sequence,
                          regions: [],
                          viewing: [],
                        },
                      }
                    : {
                        ok: false,
                        code: "CHILDREN_UNAVAILABLE",
                        detail: "not scripted in this test",
                      },
                catch: (error) =>
                  new ProbeFailure({
                    message: error instanceof Error ? error.message : String(error),
                  }),
              });
            };
          }
          if (method === "orchestration.subscribeThread") {
            return (input: unknown) =>
              Stream.map(target[method]!(input) as never, (item: any) =>
                item.kind === "snapshot" && String(item.projection.thread.id).startsWith("thread-c")
                  ? {
                      ...item,
                      projection: {
                        ...item.projection,
                        thread: {
                          ...item.projection.thread,
                          activeProviderThreadId: "provider-thread-pi",
                        },
                        providerThreads: [
                          {
                            id: "provider-thread-pi",
                            driver: "pi",
                            providerInstanceId: "pi",
                            providerSessionId: null,
                            appThreadId: item.projection.thread.id,
                            ownerNodeId: null,
                            nativeThreadRef: {
                              driver: "pi",
                              nativeId: `/home/u/.pi/agent/sessions/--work--/2026-11-13T00-00-00-000Z_pi-for-${item.projection.thread.id}.jsonl`,
                              strength: "strong",
                            },
                            nativeConversationHeadRef: null,
                            status: "idle",
                            firstRunOrdinal: null,
                            lastRunOrdinal: null,
                            handoffIds: [],
                            forkedFrom: null,
                            createdAt: item.projection.thread.createdAt,
                            updatedAt: item.projection.thread.updatedAt,
                          },
                        ],
                      },
                    }
                  : item,
              );
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
            session: { ...lease.session, client: wrap(lease.session.client as never) as never },
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

const registry = () => getAppRegionRegistry();
const mountedIds = () =>
  registry()
    .snapshot()
    .regions.map((entry) => entry.descriptor.id);
const reportsSent = () => probe.calls.filter((call) => call.method === "aetheria.regions.report");

let counter = 0;
const nextThread = () => `thread-c${++counter}`;
const SIDEBAR = ["sidebar", "sidebar.connection", "sidebar.sessions"] as const;
/** T3's own surfaces: registered by one Aetheria component on every page the shell frames, visible only while T3 shows them. */
const T3 = [
  "shell",
  "shell.rail",
  "shell.drawer",
  "conversation.transcript",
  "conversation.composer",
  "panel.files",
  "panel.terminal",
  "panel.diff",
  "settings",
] as const;
const sorted = (ids: readonly string[]) => ids.toSorted((a, b) => (a < b ? -1 : 1));
const visibleT3 = () =>
  registry()
    .snapshot()
    .regions.filter((r) => r.visible && (T3 as readonly string[]).includes(r.descriptor.id))
    .map((r) => r.descriptor.id)
    .toSorted();
const CONTROL = [
  "control",
  "control.connection",
  "control.interactions",
  "control.children",
  "control.jobs",
  "control.usage",
  "control.goals",
] as const;
const DELIVERABLES = [
  "deliverables",
  "deliverables.connection",
  "deliverables.cards",
  "deliverables.files",
  "deliverables.terminal",
] as const;

async function openRoute(path: string, ready: string, width = 1280) {
  probe.calls.length = 0;
  await prepare(width, width === 1280 ? 800 : 844, "light");
  const app = await mountRoute(path);
  await expect.poll(mountedIds, { timeout: 15_000 }).toContain(ready);
  return app;
}
const controlPath = (thread: string) => `/aetheria/control/${ENVIRONMENT_ID}/${thread}`;
const deliverablesPath = (thread: string) => `/aetheria/deliverables/${ENVIRONMENT_ID}/${thread}`;

/** The conversation route with a running turn, so the running indicator is mounted. */
async function openRunning() {
  probe.calls.length = 0;
  await prepare(1280, 800, "light");
  const app = await mountRoute(THREAD_PATH);
  const thread = ThreadId.make("thread-matrix");
  await expect.poll(() => isThreadSubscribed(thread), { timeout: 15_000 }).toBe(true);
  const run = runningRun(thread, "running-run", 99, "running-user");
  await act(async () => {
    await emitThreadEvent(thread, { type: "run.created", payload: run });
    await emitThreadEvent(thread, {
      type: "turn-item.updated",
      payload: userItem(thread, run.id, "running-user", 100, "Look into the budget"),
    });
  });
  await expect.poll(mountedIds, { timeout: 15_000 }).toContain("conversation.running");
  return app;
}

describe("what each real route registers", () => {
  it("the sessions page registers its own regions and the sidebar's", async () => {
    const app = await openRoute("/aetheria/sessions", "sessions.list");
    await using _screen = app.screen;
    expect(mountedIds()).toEqual(sorted([...SIDEBAR, ...T3, "sessions", "sessions.list"]));
    // Desktop, the sidebar open, no conversation: the shell and its rail are what T3 shows.
    expect(visibleT3()).toEqual(["shell", "shell.rail"]);
  });

  it("the control page registers a panel for each Aetheria card group", async () => {
    const app = await openRoute(controlPath(nextThread()), "control.interactions");
    await using _screen = app.screen;
    expect(mountedIds()).toEqual(sorted([...SIDEBAR, ...T3, ...CONTROL]));
    expect(visibleT3()).toEqual(["shell", "shell.rail"]);
  });

  it("a thread with no strong Pi reference registers no interactions panel and reports its identity as unknown", async () => {
    const app = await openRoute(controlPath("thread-noident"), "control");
    await using _screen = app.screen;
    await expect.poll(() => document.querySelector("[data-identity='unknown']")).not.toBeNull();
    expect(mountedIds()).not.toContain("control.interactions");
    const reply = registry().query("control");
    expect(reply.ok && reply.state.find((f) => f.name === "identity")).toEqual({
      name: "identity",
      status: "value",
      value: "unknown",
    });
  });

  it("the deliverables page registers its cards, edited files and terminal statement", async () => {
    const app = await openRoute(deliverablesPath("thread-d1"), "deliverables.files");
    await using _screen = app.screen;
    expect(mountedIds()).toEqual(sorted([...SIDEBAR, ...T3, ...DELIVERABLES]));
    expect(visibleT3()).toEqual(["shell", "shell.rail"]);
  });

  it("the conversation registers the running indicator while a turn runs", async () => {
    const app = await openRunning();
    await using _screen = app.screen;
    expect(mountedIds()).toEqual(sorted([...SIDEBAR, ...T3, "conversation.running"]));
    // The open conversation: its transcript and composer, and no panel, no drawer, no settings.
    expect(visibleT3()).toEqual([
      "conversation.composer",
      "conversation.transcript",
      "shell",
      "shell.rail",
    ]);
    const reply = registry().query("conversation.running");
    expect(reply.ok && reply.state).toEqual([
      { name: "shape", status: "value", value: "phase" },
      { name: "phase", status: "value", value: "gather" },
    ]);
  });

  it("at phone width with the drawer closed, the sidebar's regions are absent but the reporter is mounted and reports the page's own", async () => {
    const app = await openRoute("/aetheria/sessions", "sessions.list", 390);
    await using _screen = app.screen;
    expect(mountedIds()).toEqual(sorted([...T3, "sessions", "sessions.list"]));
    // Phone width, the drawer closed: the shell is shown; the rail and the drawer are not.
    expect(visibleT3()).toEqual(["shell"]);
    await expect
      .poll(() => {
        const last = reportsSent().at(-1)?.input as {
          regions: Array<{ descriptor: { id: string }; visible: boolean }>;
        };
        return last?.regions.map((r) => r.descriptor.id).toSorted();
      })
      .toEqual(sorted([...T3, "sessions", "sessions.list"]));
    const last = reportsSent().at(-1)?.input as {
      regions: Array<{ descriptor: { id: string }; visible: boolean }>;
    };
    expect(
      last.regions
        .filter((r) => r.visible && (T3 as readonly string[]).includes(r.descriptor.id))
        .map((r) => r.descriptor.id),
    ).toEqual(["shell"]);
  });

  it("at phone width the drawer region is visible while the drawer is open and the rail never is", async () => {
    const app = await openRoute("/aetheria/sessions", "sessions.list", 390);
    await using _screen = app.screen;
    const trigger = [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.getAttribute("aria-label") === "Toggle main sidebar",
    )!;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(visibleT3, { timeout: 15_000 }).toEqual(["shell", "shell.drawer"]);
    // The drawer's own sidebar regions mount with it.
    await expect.poll(mountedIds).toContain("sidebar.sessions");
    await userEvent.keyboard("{Escape}");
    await expect.poll(visibleT3, { timeout: 15_000 }).toEqual(["shell"]);
  });

  it("T3's panels, terminal drawer and settings are visible exactly while T3 shows them", async () => {
    const app = await openRoute(THREAD_PATH, "conversation.transcript");
    await using _screen = app.screen;
    const ref = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("thread-matrix"));
    const base = ["conversation.composer", "conversation.transcript", "shell", "shell.rail"];
    await expect.poll(visibleT3).toEqual(base);
    await act(async () => {
      useRightPanelStore.getState().open(ref, "diff");
    });
    await expect.poll(visibleT3).toEqual(sorted([...base, "panel.diff"]));
    await act(async () => {
      useRightPanelStore.getState().open(ref, "files");
    });
    await expect.poll(visibleT3).toEqual(sorted([...base, "panel.files"]));
    await act(async () => {
      useRightPanelStore.getState().close(ref);
      useTerminalUiStateStore.getState().setTerminalOpen(ref, true);
    });
    await expect.poll(visibleT3).toEqual(sorted([...base, "panel.terminal"]));
    await act(async () => {
      useTerminalUiStateStore.getState().setTerminalOpen(ref, false);
    });
    await expect.poll(visibleT3).toEqual(base);
    // Settings opens over the thread: T3 keeps the conversation mounted behind it, but shows the settings.
    await act(async () => {
      await app.router.navigate({ to: "/settings" });
    });
    await expect.poll(visibleT3).toEqual(["settings", "shell", "shell.rail"]);
    expect(mountedIds()).toEqual(expect.arrayContaining([...T3]));
  });

  it("answers a T3 surface by shape alone: no value, no title, no path", async () => {
    const app = await openRoute(THREAD_PATH, "conversation.transcript");
    await using _screen = app.screen;
    for (const id of T3) {
      const reply = registry().query(id);
      expect(reply.ok, id).toBe(true);
      if (!reply.ok) continue;
      expect(reply.props, id).toEqual([]);
      expect(reply.tokens, id).toEqual([]);
      for (const reading of reply.state)
        expect(reading.status, `${id}.${reading.name}`).toBe("shape");
    }
    expect(JSON.stringify(T3.map((id) => registry().query(id)))).not.toMatch(
      /thread-matrix|Answer|\/home|\.jsonl/,
    );
  });

  it("at phone width with the drawer closed, a send while not connected is blocked: the reporter's own connection monitor is mounted (review 1, follow-up 3)", async () => {
    const app = await openRoute("/aetheria/sessions", "sessions.list", 390);
    await using _screen = app.screen;
    // The sidebar's status line is not mounted, so only the always-mounted monitor can have published a view.
    expect(mountedIds()).not.toContain("sidebar.connection");
    await expect.poll(currentConnectionView, { timeout: 15_000 }).not.toBeNull();
    const send = vi.fn(async () => ({ tag: "accepted", value: null }) as const);
    const run = await createActionRunner({ newRequestId: () => "r1" }).run(
      "k",
      gateOnConnection({ label: "Stop", send }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(run.outcome.kind).toBe("unavailable");
  });

  it("the connection region is visible exactly when the status line shows a state other than connected", async () => {
    const app = await openRoute(deliverablesPath("thread-d2"), "deliverables.connection");
    await using _screen = app.screen;
    const status = () => {
      const reply = registry().query("deliverables.connection");
      const reading = reply.ok ? reply.state[0] : undefined;
      return reading?.status === "value" ? String(reading.value) : undefined;
    };
    const visible = () =>
      registry()
        .snapshot()
        .regions.find((r) => r.descriptor.id === "deliverables.connection")?.visible;
    // The fake environment's connection is settled by the time the page is up: its word is one of the closed list, and the region's visibility follows it.
    await expect
      .poll(status)
      .toMatch(
        /^(connected|connecting|reconnecting|disconnected|unauthorized|access-ended|version-mismatch|unknown)$/,
      );
    await expect.poll(() => visible() === (status() !== "connected")).toBe(true);
  });
});

describe("the manifest against the page", () => {
  it("is exactly the union of what every real route registers: nothing missing and nothing extra", async () => {
    const union = new Set<string>();
    const visit = async (path: string, ready: string) => {
      const app = await openRoute(path, ready);
      await using _screen = app.screen;
      for (const id of mountedIds()) union.add(id);
    };
    await visit("/aetheria/sessions", "sessions.list");
    await visit(controlPath(nextThread()), "control.interactions");
    await visit(controlPath("thread-noident"), "control");
    await visit(deliverablesPath("thread-d3"), "deliverables.files");
    await visit(THREAD_PATH, "conversation.transcript");
    await visit("/settings", "settings");
    {
      const app = await openRunning();
      await using _screen = app.screen;
      for (const id of mountedIds()) union.add(id);
    }
    expect([...union].toSorted()).toEqual([...DECLARED_REGION_IDS].toSorted());
    // Every registered descriptor is the declared one, field for field.
    const declared = new Map(REGION_DECLARATIONS.map((d) => [d.id, d] as const));
    const app = await openRoute(controlPath(nextThread()), "control.interactions");
    await using _screen = app.screen;
    for (const { descriptor } of registry().snapshot().regions)
      expect(descriptor).toEqual(declared.get(descriptor.id));
  });
});

describe("what a query can show", () => {
  it("answers declared fields only: no id, path or session name appears, and a value only where one is declared", async () => {
    const thread = nextThread();
    const app = await openRoute(controlPath(thread), "control.interactions");
    await using _screen = app.screen;
    const declared = new Map(REGION_DECLARATIONS.map((d) => [d.id, d] as const));
    const replies = mountedIds().map((id) => registry().query(id));
    const text = JSON.stringify(replies);
    for (const secret of [
      thread,
      `pi-for-${thread}`,
      ENVIRONMENT_ID,
      "/home/u",
      ".jsonl",
      "--work--",
    ])
      expect(text).not.toContain(secret);
    for (const reply of replies) {
      expect(reply.ok).toBe(true);
      if (!reply.ok) continue;
      const descriptor = declared.get(reply.regionId)!;
      const valued = new Set(
        [...descriptor.props, ...descriptor.state]
          .filter((f) => f.report === "value")
          .map((f) => f.name),
      );
      for (const reading of [...reply.props, ...reply.state])
        if (reading.status === "value") expect(valued.has(reading.name)).toBe(true);
    }
    // The ids the page was opened with are reported by shape alone.
    const control = registry().query("control");
    expect(control.ok && control.props).toEqual([
      { name: "environmentId", status: "shape", type: "string" },
      { name: "threadId", status: "shape", type: "string" },
    ]);
  });

  it("sends nothing when it answers: no call to the Backend, no fetch", async () => {
    const app = await openRoute(controlPath(nextThread()), "control.interactions");
    await using _screen = app.screen;
    await expect.poll(() => reportsSent().length).toBeGreaterThan(0);
    // The loop below is synchronous, so no report from the page itself can fall inside it.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = probe.calls.length;
    for (let round = 0; round < 3; round += 1) for (const id of mountedIds()) registry().query(id);
    expect(probe.calls.length).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("the reporter and disposal", () => {
  it("sends the whole mounted set with a rising sequence and no value, and nothing else for the registry", async () => {
    const app = await openRoute(controlPath(nextThread()), "control.interactions");
    await using _screen = app.screen;
    await expect
      .poll(() => {
        const last = reportsSent().at(-1)?.input as {
          regions: Array<{ descriptor: { id: string } }>;
        };
        return last?.regions.map((r) => r.descriptor.id).toSorted();
      })
      .toEqual([...mountedIds()].toSorted());
    const sent = reportsSent().map((call) => call.input as Record<string, unknown>);
    for (const body of sent) {
      expect(Object.keys(body).toSorted()).toEqual(["clientId", "regions", "sequence"]);
      expect(body.clientId).toBe(registry().clientId);
      // A report carries descriptors and visibility only: no reading, and nothing the page was opened with.
      for (const entry of body.regions as Array<Record<string, unknown>>)
        expect(Object.keys(entry).toSorted()).toEqual(["descriptor", "visible"]);
      expect(JSON.stringify(body)).not.toMatch(/pi-for-|\.jsonl|thread-c\d/);
    }
    const sequences = sent.map((body) => body.sequence as number);
    expect(sequences).toEqual([...sequences].toSorted((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    // Only the report is the registry's: every other Aetheria call is a page's own read.
    expect(reportsSent().length).toBeGreaterThan(0);
  });

  it("removes every region when the page unmounts", async () => {
    const app = await openRoute(deliverablesPath("thread-d4"), "deliverables.files");
    expect(mountedIds().length).toBeGreaterThan(0);
    await app.screen[Symbol.asyncDispose]();
    await expect.poll(mountedIds).toEqual([]);
  });

  it("removes a page's regions when the router leaves it, and keeps the sidebar's", async () => {
    const app = await openRoute(deliverablesPath("thread-d5"), "deliverables.files");
    await using _screen = app.screen;
    await act(async () => {
      await app.router.navigate({ to: "/aetheria/sessions" });
    });
    await expect.poll(mountedIds).toEqual(sorted([...SIDEBAR, ...T3, "sessions", "sessions.list"]));
  });
});
