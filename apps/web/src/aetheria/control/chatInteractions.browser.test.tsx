// @effect-diagnostics anyUnknownInErrorContext:off
// The open requests in the chat, above the message box, on the real thread route over the in-process fake environment. Boundary: real router, shell, T3 atoms and the cards' own commands over a FAKE SOCKET
// whose client records every call, answers `aetheria.*` as a scripted in-test model says and carries a controllable change stream. This is NOT the real Backend. The images under __screenshots__/ are evidence
// for a person to view; the assertions prove calls, words and layout.
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { COMPOSITION_STATUS_REPLY, stubBuildDigest } from "../connection/testing";
import { prepare, mountRoute } from "../harness";

stubBuildDigest();

// Each test opens its own thread `thread-c<n>`, whose projection names the Pi session `pi-for-thread-c<n>`; `thread-noident` names none.
const THREAD_COUNT = 20;
installFakeEnvironment([
  threadWithHistory("thread-matrix", 3),
  threadWithHistory("thread-noident", 3),
  ...Array.from({ length: THREAD_COUNT }, (_, n) => threadWithHistory(`thread-c${n + 1}`, 1)),
]);

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; input: unknown }>,
  answer: (async () => ({})) as (method: string, input: unknown) => Promise<unknown>,
  pushChange: (_event: unknown): Promise<void> => Promise.resolve(),
}));

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer, Effect, Data, Stream, Queue] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
      import("effect/Effect"),
      import("effect/Data"),
      import("effect/Stream"),
      import("effect/Queue"),
    ]);
    class ProbeFailure extends Data.TaggedError("ProbeFailure")<{ readonly message: string }> {}
    const wrap = (client: Record<string, (input: unknown) => unknown>) =>
      new Proxy(client, {
        get: (target, method: string) => {
          if (method === "aetheria.interactions.changes") {
            return (input: unknown) => {
              probe.calls.push({ method, input });
              return Stream.unwrap(
                Effect.gen(function* () {
                  const queue = yield* Queue.unbounded<unknown>();
                  probe.pushChange = (event) => {
                    Queue.offerUnsafe(queue, event);
                    return Promise.resolve();
                  };
                  return Stream.fromQueue(queue);
                }),
              );
            };
          }
          if (method.startsWith("aetheria.")) {
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
                              // Pi's native id is its session file; the session id is the name's tail (binding.ts).
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

type Json = Record<string, any>;
const ok = (value: unknown) => ({ ok: true, value });

/** The Pi session id of the current test's thread. */
let ROOT = "pi-for-thread-c0";
let rootCounter = 0;
const rooted = (record: Json): Json => ({ ...record, rootSessionId: ROOT, sessionId: ROOT });
const REV = "a1".repeat(32);
const callsTo = (method: string) => probe.calls.filter((call) => call.method === method);

const baseRecord = {
  state: "pending",
  revision: REV,
  rootSessionId: ROOT,
  sessionId: ROOT,
  createdAt: "2026-01-01T00:00:00Z",
  held: false,
};
const QUESTION = {
  ...baseRecord,
  interactionId: "q-1",
  kind: "question",
  askCallId: "c1",
  content: { questions: [{ id: "why", question: "Why this approach?" }] },
};
const PLAN = {
  ...baseRecord,
  interactionId: "p-1",
  kind: "plan-review",
  askCallId: "c2",
  content: { plan: "# Plan\n\n- one", reviewNumber: 1 },
};
const SETTLED = {
  ...QUESTION,
  interactionId: "q-done",
  state: "cancelled",
  resolution: { type: "cancelled" },
};

/** A scripted Backend: an answer settles the record and pushes a change, as the real one does. */
function backend(records: Json[]) {
  const state = { version: 1, records };
  const find = (input: Json) => state.records.find((r) => r.interactionId === input.interactionId)!;
  const answer = async (method: string, input: Json): Promise<unknown> => {
    if (method === "aetheria.composition.status") return COMPOSITION_STATUS_REPLY;
    if (method === "aetheria.interactions.snapshot") {
      return ok({
        rootSessionId: ROOT,
        version: state.version,
        interactions: structuredClone(state.records),
      });
    }
    if (method === "aetheria.interactions.answer") {
      Object.assign(find(input), {
        state: "answered",
        resolution: { type: "answers", answers: input.answers, originId: "org-1" },
      });
      const reply = ok(structuredClone(find(input)));
      state.version += 1;
      void probe.pushChange({ rootSessionId: ROOT, version: state.version });
      return reply;
    }
    // Methods this file does not script (the children panel's reads) are answered as an unavailable service and change nothing.
    return { ok: false, code: "CHILDREN_UNAVAILABLE", detail: "not scripted in this test" };
  };
  return { state, answer };
}

async function open(records: Json[], width = 1280, mode: "light" | "dark" = "light") {
  probe.calls.length = 0;
  rootCounter += 1;
  ROOT = `pi-for-thread-c${rootCounter}`;
  const model = backend(records.map(rooted));
  probe.answer = (method, input) => model.answer(method, input as Json);
  await prepare(width, width === 1280 ? 800 : 844, mode);
  const app = await mountRoute(`/${ENVIRONMENT_ID}/thread-c${rootCounter}`);
  await expect
    .poll(() => document.querySelector("[data-testid='composer-editor']"), { timeout: 15_000 })
    .not.toBeNull();
  return { app, model };
}

const composer = () => document.querySelector<HTMLElement>("[data-testid='composer-editor']")!;
const chat = () => document.querySelector<HTMLElement>("[data-aetheria='chat-interactions']");
const cards = () => document.querySelectorAll("[data-chat-cards] [data-interaction]");

describe("an open request is answerable from the chat", () => {
  it("shows the card above the composer, with a banner linking to the control page", async () => {
    const { app } = await open([QUESTION]);
    await using _screen = app.screen;
    await expect.poll(() => cards().length, { timeout: 15_000 }).toBe(1);
    expect(document.querySelector("[data-chat-banner]")?.textContent).toContain(
      "A question is waiting for you",
    );
    expect(document.querySelector("[data-chat-banner]")?.textContent).toContain(
      "Answer here or on the Human control page.",
    );
    const link = page.getByRole("link", { name: "Open Human control" });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe(
      `/aetheria/control/${ENVIRONMENT_ID}/thread-c${rootCounter}`,
    );
    expect(cards()[0]?.textContent).toContain("Why this approach?");
    expect(chat()!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      composer().getBoundingClientRect().top,
    );
  });

  it("answering sends exactly the control page's payload, once, and the card leaves the chat", async () => {
    const { app } = await open([QUESTION]);
    await using _screen = app.screen;
    await expect.poll(() => cards().length, { timeout: 15_000 }).toBe(1);
    await page
      .getByRole("textbox", { name: "Your own answer to: Why this approach?" })
      .fill("because");
    await page.getByRole("button", { name: "Send answers" }).click();
    await expect.poll(() => callsTo("aetheria.interactions.answer").length).toBe(1);
    expect(callsTo("aetheria.interactions.answer")[0]?.input).toEqual({
      interactionId: "q-1",
      revision: REV,
      answers: [{ id: "why", selected: [], custom: "because", skipped: false }],
    });
    await expect.poll(() => chat(), { timeout: 8_000 }).toBeNull();
    expect(callsTo("aetheria.interactions.answer").length).toBe(1);
  });

  it.each<[string, Json[]]>([
    ["no records", []],
    ["only a settled record", [SETTLED]],
  ])("%s: no banner and no card", async (_name, records) => {
    const { app } = await open(structuredClone(records));
    await using _screen = app.screen;
    await expect
      .poll(() => callsTo("aetheria.interactions.snapshot").length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(chat()).toBeNull();
    expect(document.querySelector("[data-chat-banner]")).toBeNull();
    expect(cards().length).toBe(0);
    expect(composer().getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("a thread with no strong Pi reference renders nothing and calls no interaction method", async () => {
    probe.calls.length = 0;
    probe.answer = async () => ok({});
    await prepare(1280, 800, "light");
    const app = await mountRoute(`/${ENVIRONMENT_ID}/thread-noident`);
    await using _screen = app.screen;
    await expect
      .poll(() => document.querySelector("[data-testid='composer-editor']"), { timeout: 15_000 })
      .not.toBeNull();
    expect(chat()).toBeNull();
    expect(probe.calls.filter((call) => call.method.startsWith("aetheria.interactions."))).toEqual(
      [],
    );
  });
});

describe("the chat with a question and a plan review open, in both modes at both widths", () => {
  const SHOTS = ([1280, 390] as const).flatMap((width) =>
    (["light", "dark"] as const).map((mode) => [width, mode] as const),
  );
  it.each(SHOTS)("at %s, %s", async (width, mode) => {
    const { app } = await open([QUESTION, PLAN], width, mode);
    await using _screen = app.screen;
    await expect.poll(() => cards().length, { timeout: 15_000 }).toBe(2);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(composer().getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await page.screenshot({
      base64: true,
      path: `__screenshots__/chat-interactions-${width}-${mode}.png`,
      save: true,
    });
  });
});
