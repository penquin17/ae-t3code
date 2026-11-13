// @effect-diagnostics anyUnknownInErrorContext:off
// The control page in the real app (M10 Plan step 11, D14, C7) on the in-process fake environment. Boundary: real router, shell, T3 atoms and the page's own commands over a FAKE SOCKET whose client is
// wrapped to record every call, answer `aetheria.*` as a scripted in-test model says, and carry a controllable change stream. This is NOT the real Backend: the real boundary is phase 2b / step 12.
// The images under __screenshots__/ are evidence for a person to view; the assertions prove calls, words and layout.
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type * as Context from "effect/Context";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { prepare, mountRoute } from "../harness";

// T3 keeps a thread's projection and a root's change-stream atom alive across tests, so each test opens its own thread `thread-c<n>`, whose projection names the Pi session `pi-for-thread-c<n>`.
// `thread-noident` names none. Installed once, for the file's life.
const THREAD_COUNT = 90;
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
                              nativeId: `pi-for-${item.projection.thread.id}`,
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

/** The Pi session id of the current test's thread. */
let ROOT = "pi-for-thread-c0";
let rootCounter = 0;
const rooted = (record: Json): Json => ({ ...record, rootSessionId: ROOT, sessionId: ROOT });
const REV = "a1".repeat(32);
const callsTo = (method: string) => probe.calls.filter((call) => call.method === method);
const order = () => probe.calls.map((call) => call.method);

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
const AUTH = {
  ...baseRecord,
  interactionId: "a-1",
  kind: "authorization",
  content: {
    text: "Allow the write?",
    subject: { type: "tool-call", id: "call-1", revision: REV },
  },
};

type Json = Record<string, any>;
const ok = (value: unknown) => ({ ok: true, value });

const ACTION_METHODS = new Set([
  "aetheria.interactions.answer",
  "aetheria.interactions.cancel",
  "aetheria.interactions.hold",
  "aetheria.interactions.close",
  "aetheria.plan.decide",
  "aetheria.planMode.set",
  "aetheria.authorization.grant",
]);

/** A scripted Backend: it applies an action only when no override answers for it, and pushes a change after applying. */
function backend(records: Json[]) {
  const state = {
    version: 1,
    records,
    mode: { sessionId: ROOT, active: false, modeRevision: 1 },
    override: null as null | ((method: string, input: Json) => unknown | Promise<unknown>),
    tasks: null as Json | null,
  };
  const find = (input: Json) => state.records.find((r) => r.interactionId === input.interactionId)!;
  const settle = (input: Json, patch: Json) => {
    Object.assign(find(input), patch);
    return ok(structuredClone(find(input)));
  };
  const answer = async (method: string, input: Json): Promise<unknown> => {
    if (method === "aetheria.interactions.snapshot") {
      return ok({
        rootSessionId: ROOT,
        version: state.version,
        interactions: structuredClone(state.records),
      });
    }
    if (method === "aetheria.planMode.get") return ok(state.mode);
    if (method === "aetheria.tasks.get") return ok(state.tasks);
    // Methods this file does not script (the children panel's reads) are answered as an unavailable service and change nothing.
    if (!ACTION_METHODS.has(method))
      return { ok: false, code: "CHILDREN_UNAVAILABLE", detail: "not scripted in this test" };
    if (state.override !== null) return state.override(method, input);
    let reply: unknown;
    switch (method) {
      case "aetheria.interactions.answer":
        reply = settle(input, {
          state: "answered",
          resolution: { type: "answers", answers: input.answers, originId: "org-1" },
        });
        break;
      case "aetheria.interactions.cancel":
        reply = settle(input, { state: "cancelled", resolution: { type: "cancelled" } });
        break;
      case "aetheria.interactions.hold":
        reply = settle(input, { held: true });
        break;
      case "aetheria.interactions.close":
        reply = ok(structuredClone(find(input)));
        break;
      case "aetheria.plan.decide":
        reply = settle(input, {
          state: "answered",
          resolution: { type: "decision", decision: input.decision, originId: "org-2" },
        });
        break;
      case "aetheria.planMode.set":
        state.mode = {
          sessionId: ROOT,
          active: input.active,
          modeRevision: input.expectedModeRevision + 1,
        };
        reply = ok(state.mode);
        break;
      default:
        reply = ok({ originId: "org-grant-1" });
    }
    state.version += 1;
    void probe.pushChange({ rootSessionId: ROOT, version: state.version });
    return reply;
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
  const app = await mountRoute(`/aetheria/control/${ENVIRONMENT_ID}/thread-c${rootCounter}`);
  await expect
    .poll(() => document.querySelector("[data-control-panel][data-view='live']"), {
      timeout: 15_000,
    })
    .not.toBeNull();
  return { app, model };
}
const text = () => document.body.textContent ?? "";
/** Every card and the mode switch have finished their action: each marks itself busy until its re-reads are done. */
const idle = () =>
  vi.waitFor(() => expect(document.querySelector("[aria-busy='true']")).toBeNull());

describe("the page finds its Pi session id, or says it cannot", () => {
  it("asks the Backend about the thread's strong Pi native id and nothing else", async () => {
    const { app } = await open([QUESTION]);
    await using _screen = app.screen;
    expect(callsTo("aetheria.interactions.snapshot")[0]?.input).toEqual({ rootSessionId: ROOT });
    expect(callsTo("aetheria.interactions.changes")[0]?.input).toEqual({ rootSessionId: ROOT });
    expect(callsTo("aetheria.planMode.get")[0]?.input).toEqual({ sessionId: ROOT });
    expect(callsTo("aetheria.tasks.get")[0]?.input).toEqual({ sessionId: ROOT });
  });

  it.each([
    [1280, 800, "light"],
    [1280, 800, "dark"],
    [390, 844, "light"],
    [390, 844, "dark"],
  ] as const)(
    "a thread with no strong Pi reference shows nothing and calls nothing (%s, %s)",
    async (width, height, mode) => {
      probe.calls.length = 0;
      probe.answer = async () => ok({});
      await prepare(width, height, mode);
      const app = await mountRoute(`/aetheria/control/${ENVIRONMENT_ID}/thread-noident`);
      await using _screen = app.screen;
      await expect.poll(() => document.querySelector("[data-identity='unknown']")).not.toBeNull();
      expect(text()).toContain(
        "This session's identity is not known to the browser; nothing can be shown.",
      );
      expect(document.querySelector("[data-control-panel]")).toBeNull();
      expect(
        probe.calls.filter((call) =>
          /^aetheria\.(interactions|planMode|tasks|plan|authorization)\./.test(call.method),
        ),
      ).toEqual([]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      await page.screenshot({
        base64: true,
        path: `__screenshots__/control-page-identity-unknown-${width}-${mode}.png`,
        save: true,
      });
    },
  );
});

describe("subscribe first, then read; pushes only prompt reads", () => {
  it("opens the change stream before the first snapshot read", async () => {
    const { app } = await open([QUESTION]);
    await using _screen = app.screen;
    const methods = order();
    expect(methods.indexOf("aetheria.interactions.changes")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("aetheria.interactions.changes")).toBeLessThan(
      methods.indexOf("aetheria.interactions.snapshot"),
    );
  });

  it("a push for a newer version re-reads once; a duplicate push does not", async () => {
    const { app, model } = await open([QUESTION]);
    await using _screen = app.screen;
    const before = callsTo("aetheria.interactions.snapshot").length;
    model.state.records.push({
      ...rooted(QUESTION),
      interactionId: "q-2",
      content: { questions: [{ id: "n", question: "A second question?" }] },
    });
    model.state.version = 2;
    await probe.pushChange({ rootSessionId: ROOT, version: 2 });
    await expect.poll(() => text(), { timeout: 8_000 }).toContain("A second question?");
    expect(callsTo("aetheria.interactions.snapshot").length).toBe(before + 1);
    await probe.pushChange({ rootSessionId: ROOT, version: 2 });
    await probe.pushChange({ rootSessionId: ROOT, version: 1 });
    // A genuinely newer push after them: if either had read, the count would pass before + 2.
    model.state.version = 3;
    await probe.pushChange({ rootSessionId: ROOT, version: 3 });
    await vi.waitFor(() =>
      expect(callsTo("aetheria.interactions.snapshot").length).toBeGreaterThanOrEqual(before + 2),
    );
    expect(callsTo("aetheria.interactions.snapshot").length).toBe(before + 2);
  });

  it("a card that leaves the Backend's list is said to have disappeared, never to have completed", async () => {
    const { app, model } = await open([QUESTION, PLAN]);
    await using _screen = app.screen;
    model.state.records.splice(0, 1);
    model.state.version = 2;
    await probe.pushChange({ rootSessionId: ROOT, version: 2 });
    await expect
      .poll(() => document.querySelector("[data-vanished]"), { timeout: 8_000 })
      .not.toBeNull();
    expect(document.querySelector("[data-vanished]")?.textContent).toMatch(
      /No longer in the Backend's list: q-1/,
    );
    expect(document.querySelector("[data-vanished]")?.textContent).toMatch(
      /does not mean it was answered or completed/,
    );
    expect(document.querySelector("[data-interaction='q-1']")).toBeNull();
  });

  it("an empty live list says the Backend holds nothing; it is not shown before the first read", async () => {
    const { app } = await open([]);
    await using _screen = app.screen;
    expect(document.querySelector("[data-empty='interactions']")?.textContent).toContain(
      "The Backend holds no questions",
    );
  });

  it("a Backend that cannot be read shows unavailable, never an empty list", async () => {
    const { app, model } = await open([QUESTION]);
    await using _screen = app.screen;
    model.state.version = 2;
    probe.answer = async (method) =>
      method === "aetheria.interactions.snapshot"
        ? {
            ok: false,
            code: "INTERACTION_UNAVAILABLE",
            detail: "the interaction service is not accepting work",
          }
        : ok(null);
    await probe.pushChange({ rootSessionId: ROOT, version: 2 });
    await expect
      .poll(() => document.querySelector("[data-control-panel]")?.getAttribute("data-view"), {
        timeout: 8_000,
      })
      .toBe("stale");
    expect(text()).toContain("the interaction service is not accepting work");
    expect(document.querySelector("[data-empty='interactions']")).toBeNull();
    expect(document.querySelector("[data-interaction='q-1']")).not.toBeNull();
  });
});

interface ActionCase {
  readonly name: string;
  readonly method: string;
  readonly records: Json[];
  readonly trigger: () => Promise<void>;
  /** What re-reads the projection after this action. */
  readonly reread: "aetheria.interactions.snapshot" | "aetheria.planMode.get";
  readonly done: RegExp;
  readonly payload: Json;
}
const click = (name: string) => page.getByRole("button", { name }).click();
const ACTIONS: readonly ActionCase[] = [
  {
    name: "answer",
    method: "aetheria.interactions.answer",
    records: [QUESTION],
    trigger: async () => {
      await page
        .getByRole("textbox", { name: "Your own answer to: Why this approach?" })
        .fill("because");
      await click("Send answers");
    },
    reread: "aetheria.interactions.snapshot",
    done: /Answer done\./,
    payload: {
      interactionId: "q-1",
      revision: REV,
      answers: [{ id: "why", selected: [], custom: "because", skipped: false }],
    },
  },
  {
    name: "cancel",
    method: "aetheria.interactions.cancel",
    records: [QUESTION],
    trigger: () => click("Cancel question"),
    reread: "aetheria.interactions.snapshot",
    done: /Cancel done\./,
    payload: { interactionId: "q-1", revision: REV },
  },
  {
    name: "hold",
    method: "aetheria.interactions.hold",
    records: [QUESTION],
    trigger: () => click("Hold for later"),
    reread: "aetheria.interactions.snapshot",
    done: /Hold done\./,
    payload: { interactionId: "q-1", revision: REV },
  },
  {
    name: "close",
    method: "aetheria.interactions.close",
    records: [QUESTION],
    trigger: () => click("Close"),
    reread: "aetheria.interactions.snapshot",
    done: /Close sent;/,
    payload: { interactionId: "q-1", revision: REV },
  },
  {
    name: "plan.decide",
    method: "aetheria.plan.decide",
    records: [PLAN],
    trigger: () => click("Approve plan"),
    reread: "aetheria.interactions.snapshot",
    done: /Approval done\./,
    payload: { interactionId: "p-1", revision: REV, decision: "approved" },
  },
  {
    name: "planMode.set",
    method: "aetheria.planMode.set",
    records: [],
    trigger: () => click("Turn plan mode on"),
    reread: "aetheria.planMode.get",
    done: /Plan mode done\./,
    get payload() {
      return { sessionId: ROOT, active: true, expectedModeRevision: 1 };
    },
  },
  {
    name: "authorization.grant",
    method: "aetheria.authorization.grant",
    records: [AUTH],
    trigger: () => click("Grant for this subject only"),
    reread: "aetheria.interactions.snapshot",
    done: /Grant sent;/,
    get payload() {
      return { subject: { type: "tool-call", id: "call-1", revision: REV }, sessionId: ROOT };
    },
  },
];

interface Variant {
  readonly name: string;
  readonly override: ((method: string) => unknown | Promise<unknown>) | null;
  readonly shows: RegExp;
  readonly rereads: boolean;
  readonly forbids?: RegExp;
}
const SETTLED_RECORD = {
  ...QUESTION,
  state: "cancelled",
  resolution: { type: "cancelled", feedback: "someone else cancelled it" },
};
const VARIANTS: readonly Variant[] = [
  { name: "confirmed", override: null, shows: /./, rereads: true },
  {
    name: "refused (read-only device)",
    override: () => ({
      ok: false,
      code: "INTERACTION_ORIGIN_NOT_HUMAN",
      detail: "the connection's scopes do not allow operating",
    }),
    shows: /the connection's scopes do not allow operating/,
    rereads: false,
    forbids: /done\./,
  },
  {
    name: "stale revision",
    override: () => ({
      ok: false,
      code: "INTERACTION_STALE_REVISION",
      detail: "the content changed since the human saw it",
    }),
    shows: /changed after you saw it/,
    rereads: true,
    forbids: /done\./,
  },
  {
    name: "already settled",
    override: () => ({ ok: false, code: "INTERACTION_ALREADY_SETTLED", record: SETTLED_RECORD }),
    shows: /already settled/,
    rereads: true,
    forbids: /done\./,
  },
  {
    name: "lost reply",
    override: () => {
      throw new Error("SocketCloseError: the socket closed before the reply");
    },
    shows: /not known whether it applied/,
    rereads: true,
    forbids: /done\./,
  },
  {
    name: "unavailable",
    override: () => ({ ok: false, code: "INTERACTION_UNAVAILABLE", detail: "nothing was done" }),
    shows: /not known whether it applied/,
    rereads: true,
    forbids: /done\./,
  },
];
const MATRIX = ACTIONS.flatMap((action) =>
  VARIANTS.map((variant) => [`${action.name} — ${variant.name}`, action, variant] as const),
);

describe("all seven actions end honestly at the service boundary (a scripted fake socket, not the Backend)", () => {
  it.each(MATRIX)("%s", async (_name, action, variant) => {
    const { app, model } = await open(structuredClone(action.records));
    await using _screen = app.screen;
    if (variant.override !== null) {
      const override = variant.override;
      model.state.override = (method) => override(method);
    }
    const sentBefore = callsTo(action.method).length;
    const rereadsBefore = callsTo(action.reread).length;
    await action.trigger();
    await expect
      .poll(() => text(), { timeout: 8_000 })
      .toMatch(variant.name === "confirmed" ? action.done : variant.shows);
    // Exactly one send with exactly the payload, whatever the reply: nothing is ever resent.
    await idle();
    expect(callsTo(action.method).length).toBe(sentBefore + 1);
    expect(callsTo(action.method).at(-1)?.input).toEqual(action.payload);
    if (variant.forbids !== undefined) expect(text()).not.toMatch(variant.forbids);
    if (variant.rereads) expect(callsTo(action.reread).length).toBeGreaterThan(rereadsBefore);
    else expect(callsTo(action.reread).length).toBe(rereadsBefore);
    if (variant.name === "already settled" && action.records.length > 0) {
      expect(document.querySelector("[data-supplied-record]")?.textContent).toContain(
        "someone else cancelled it",
      );
    }
    if (variant.name.startsWith("refused")) {
      expect(document.querySelector("[data-verbatim='backend']")?.textContent).toBe(
        "the connection's scopes do not allow operating",
      );
    }
  });
});

describe("a stale answer is a conflict: the old draft is kept as an earlier version", () => {
  it("after the content changes, the typed text is readable as from an earlier version and is not resent", async () => {
    const { app, model } = await open([QUESTION]);
    await using _screen = app.screen;
    await page
      .getByRole("textbox", { name: "Your own answer to: Why this approach?" })
      .fill("my reasoning");
    model.state.override = () => ({
      ok: false,
      code: "INTERACTION_STALE_REVISION",
      detail: "the content changed since the human saw it",
    });
    model.state.records[0] = {
      ...rooted(QUESTION),
      revision: "b2".repeat(32),
      content: { questions: [{ id: "why", question: "Why this approach, now with more detail?" }] },
    };
    await click("Send answers");
    await expect
      .poll(() => document.querySelector("[data-earlier-draft]")?.textContent ?? "")
      .toContain("my reasoning");
    expect(text()).toContain("Why this approach, now with more detail?");
    expect(callsTo("aetheria.interactions.answer").length).toBe(1);
  });
});

describe("the page, whole, in both modes at both widths", () => {
  const SHOTS = ([1280, 390] as const).flatMap((width) =>
    (["light", "dark"] as const).map((mode) => [width, mode] as const),
  );
  it.each(SHOTS)("question, plan, authorization, mode and tasks at %s, %s", async (width, mode) => {
    const { app, model } = await open([QUESTION, PLAN, AUTH], width, mode);
    await using _screen = app.screen;
    model.state.tasks = {
      sessionId: ROOT,
      rootSessionId: ROOT,
      entryId: "e",
      seq: 2,
      state: "stale",
      publishedAt: "2026-01-01T00:00:00Z",
      todos: [{ content: "Write the test", status: "in_progress" }],
    };
    await probe.pushChange({ rootSessionId: ROOT, version: 1 });
    await expect.poll(() => document.querySelectorAll("[data-interaction]").length).toBe(3);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({
      base64: true,
      path: `__screenshots__/control-page-${width}-${mode}.png`,
      save: true,
    });
  });

  it("answers by keyboard alone on the real page and focus returns to the card", async () => {
    const { app } = await open([QUESTION]);
    await using _screen = app.screen;
    const box = document.querySelector('textarea[aria-label^="Your own answer to"]') as HTMLElement;
    box.focus();
    await userEvent.keyboard("by keyboard");
    for (
      let presses = 0;
      presses < 8 && (document.activeElement as HTMLElement | null)?.textContent !== "Send answers";
      presses += 1
    ) {
      await userEvent.tab();
    }
    expect(document.activeElement?.textContent).toBe("Send answers");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => callsTo("aetheria.interactions.answer").length).toBe(1);
    await expect
      .poll(() =>
        document.activeElement?.closest("[data-interaction]")?.getAttribute("data-interaction"),
      )
      .toBe("q-1");
  });
});
