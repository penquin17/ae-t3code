// The human-control cards in a real browser with the real stylesheet (M10 Plan steps 10 and 11, D14, C7). Boundary: each card over supplied records and SCRIPTED actions; no Backend, no socket.
// The images under __screenshots__/ are evidence for a person to view; the assertions prove the words, the focus, the draft rules, the layout and the accessible names.
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { ReactNode } from "react";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import type { ActionReport, ControlActions } from "./actions";
import { createDraftStore, type DraftStorage } from "./drafts";
import { InteractionCard } from "./InteractionCard";
import { PlanModeCard } from "./PlanModeCard";
import { TasksView } from "./TasksView";
import type { ReadView } from "./reads";
import type { InteractionRecord, PlanMode, TaskView } from "./types";

type Mode = "light" | "dark";
const MODES: readonly Mode[] = ["light", "dark"];
const REV = "e".repeat(64);
const REV2 = "f".repeat(64);

const base = {
  state: "pending",
  revision: REV,
  rootSessionId: "root",
  sessionId: "root",
  createdAt: "2026-01-01T00:00:00Z",
  held: false,
} as const;
const HOSTILE =
  '<img src=x onerror="window.__pwned=1"> **not bold** <script>window.__pwned=1</script>';
const QUESTION = {
  ...base,
  interactionId: "q-1",
  kind: "question",
  content: {
    questions: [
      {
        id: "colour",
        header: "Design",
        question:
          "Which colour should the long project name /Users/someone/projects/a-very-long-project-name/src/components use?",
        detail: HOSTILE,
        options: [
          { label: "Red", description: "Warm", context: "## context\n`raw`" },
          { label: "Blue" },
        ],
      },
      {
        id: "extras",
        question: "Which extras?",
        multiSelect: true,
        options: [{ label: "A" }, { label: "B" }],
      },
      { id: "why", question: "Why?" },
    ],
  },
} as unknown as InteractionRecord;
const PLAN = {
  ...base,
  interactionId: "p-1",
  kind: "plan-review",
  content: {
    plan:
      "# Plan\n\n- step **one** <b>raw</b>\n- step two with a very long unbroken token " +
      "x".repeat(120),
    reviewNumber: 2,
  },
} as unknown as InteractionRecord;
const AUTH = {
  ...base,
  interactionId: "a-1",
  kind: "authorization",
  content: {
    text: "Allow the build tool to write outside the workspace?",
    subject: { type: "tool-call", id: "call-77", revision: REV2 },
  },
} as unknown as InteractionRecord;
const AUTH_ANSWERED = {
  ...AUTH,
  state: "answered",
  resolution: {
    type: "answers",
    answers: [{ id: "authorization", selected: ["Approve"], skipped: false }],
    originId: "origin-ZZ-9001",
  },
} as unknown as InteractionRecord;
const ORIGIN = "origin-ZZ-9001";

const known = <T,>(value: T, stale = false): ReadView<T> => ({
  state: "known",
  value,
  stale,
  ...(stale ? { reason: "the connection ended" } : {}),
});
const MODE_ON: PlanMode = { sessionId: "root", active: true, modeRevision: 4 };
const tasks = (state: TaskView["state"]): TaskView => ({
  sessionId: "root",
  rootSessionId: "root",
  entryId: "e",
  seq: 3,
  state,
  publishedAt: "2026-01-01T00:00:00Z",
  todos: [
    { content: "Write the failing test", status: "completed" },
    { content: "Make it pass", status: "in_progress" },
    { content: "Review", status: "pending" },
  ],
});

interface Calls {
  readonly log: Array<{ method: string; payload: unknown }>;
}
/** Scripted actions: each method records its payload and answers as `reportFor` says. */
function scripted(reportFor: (method: string) => ActionReport<unknown>): {
  actions: ControlActions;
  calls: Calls;
} {
  const log: Calls["log"] = [];
  const actions = new Proxy({} as ControlActions, {
    get: (_t, method: string) => async (payload: unknown) => {
      log.push({ method, payload });
      return reportFor(method);
    },
  });
  return { actions, calls: { log } };
}
const confirmed = (value: unknown = {}, refreshed = true): ActionReport<unknown> => ({
  sent: true,
  requestId: "r",
  current: true,
  outcome: { kind: "confirmed", value, refreshed },
  reply: { class: "accepted", reread: true },
});
const refusedReport = (
  code: string,
  message: string,
  cls = "refused",
  extra: object = {},
): ActionReport<unknown> => ({
  sent: true,
  requestId: "r",
  current: true,
  outcome: { kind: "refused", code, message },
  reply: { class: cls, code, detail: message, reread: cls !== "refused", ...extra } as never,
});
const unknownReport: ActionReport<unknown> = {
  sent: true,
  requestId: "r",
  current: true,
  outcome: { kind: "unknown", reason: "The reply never arrived" },
  reply: { class: "unknown", reread: true },
};

class MemoryStorage implements DraftStorage {
  readonly map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
  keys = () => [...this.map.keys()];
}
const freshDrafts = () => createDraftStore(new MemoryStorage());

async function appear(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
}
const sheet = (children: ReactNode) => (
  <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 p-4" data-testid="sheet">
    {children}
  </main>
);
const shot = (name: string, width: number, mode: Mode) =>
  page.screenshot({
    base64: true,
    path: `__screenshots__/control-${name}-${width}-${mode}.png`,
    save: true,
  });

function nameOf(element: Element): string {
  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;
  const wrapping = element.closest("label")?.textContent?.trim();
  return (
    wrapping || (element.textContent ?? "").trim() || element.getAttribute("title")?.trim() || ""
  );
}
const unnamedControls = () =>
  [...document.querySelectorAll<HTMLElement>("button, input:not([type=hidden]), textarea, select")]
    .filter((element) => element.getBoundingClientRect().width > 0 && nameOf(element) === "")
    .map((element) => element.outerHTML.slice(0, 80));

/** A disabled control for assistive tech (the `disabled` property) and for the eye: dimmed by the shared Button's own disabled style and not clickable. */
function expectDisabledLook(button: HTMLButtonElement) {
  expect(button.disabled).toBe(true);
  const style = getComputedStyle(button);
  expect(Number.parseFloat(style.opacity)).toBeLessThan(1);
  expect(style.pointerEvents).toBe("none");
}

const record = (r: InteractionRecord) => r;
const SURFACES: ReadonlyArray<readonly [string, () => ReactNode]> = [
  [
    "question",
    () => (
      <InteractionCard
        record={record(QUESTION)}
        actions={scripted(() => confirmed()).actions}
        drafts={freshDrafts()}
      />
    ),
  ],
  [
    "plan-review",
    () => (
      <InteractionCard
        record={record(PLAN)}
        actions={scripted(() => confirmed()).actions}
        drafts={freshDrafts()}
      />
    ),
  ],
  [
    "authorization",
    () => (
      <InteractionCard
        record={record(AUTH)}
        actions={scripted(() => confirmed()).actions}
        drafts={freshDrafts()}
      />
    ),
  ],
  [
    "authorization-rearm-waiting",
    () => (
      <InteractionCard
        record={record(AUTH_ANSWERED)}
        actions={scripted(() => confirmed()).actions}
        drafts={freshDrafts()}
      />
    ),
  ],
  [
    "plan-mode",
    () => (
      <PlanModeCard
        sessionId="root"
        view={known(MODE_ON)}
        actions={scripted(() => confirmed()).actions}
        onRefresh={async () => {}}
      />
    ),
  ],
  ["tasks-current", () => <TasksView view={known<TaskView | null>(tasks("current"))} />],
  ["tasks-stale", () => <TasksView view={known<TaskView | null>(tasks("stale"), true)} />],
  ["tasks-unknown", () => <TasksView view={known<TaskView | null>(tasks("unknown"))} />],
  [
    "tasks-unavailable",
    () => <TasksView view={{ state: "unavailable", reason: "the task view could not be read" }} />,
  ],
];
const CASES = SURFACES.flatMap(([name, view]) =>
  ([1280, 390] as const).flatMap((width) =>
    MODES.map((mode) => [name, view, width, mode] as const),
  ),
);

describe("every card surface at both widths and modes", () => {
  it.each(CASES)("%s at %s, %s", async (name, view, width, mode) => {
    await appear(width, width === 1280 ? 800 : 844, mode);
    await using _screen = await render(sheet(view()), { router: false });
    await expect.element(page.getByTestId("sheet")).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(unnamedControls()).toEqual([]);
    await shot(name, width, mode);
  });
});

describe("a refusal and the states a person must not misread", () => {
  const STATES = [
    [
      "refusal",
      () =>
        refusedReport(
          "INTERACTION_ORIGIN_NOT_HUMAN",
          "the connection's scopes do not allow operating (read-only device)",
        ),
    ],
    ["unknown", () => unknownReport],
    [
      "stale-revision",
      () =>
        refusedReport(
          "INTERACTION_STALE_REVISION",
          "the content changed since the human saw it",
          "stale-revision",
        ),
    ],
    [
      "delivery-failed",
      () =>
        refusedReport("INTERACTION_DELIVERY_FAILED", "the session is gone", "delivery-failed", {
          record: {
            ...QUESTION,
            state: "answered",
            resolution: { type: "answers", answers: [], originId: "o-1" },
            delivery: { status: "failed", code: "SESSION_GONE" },
          },
        }),
    ],
  ] as const;
  const MATRIX = STATES.flatMap(([name, make]) =>
    ([1280, 390] as const).flatMap((width) =>
      MODES.map((mode) => [name, make, width, mode] as const),
    ),
  );

  it.each(MATRIX)("%s at %s, %s", async (name, make, width, mode) => {
    await appear(width, width === 1280 ? 800 : 844, mode);
    const { actions } = scripted(make);
    await using screen = await render(
      sheet(<InteractionCard record={record(PLAN)} actions={actions} drafts={freshDrafts()} />),
      { router: false },
    );
    await screen.getByRole("button", { name: "Approve plan" }).click();
    await expect.element(page.getByText(/./, { exact: false }).first()).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-report]")?.getAttribute("data-report"))
      .not.toBeNull();
    if (name === "refusal") {
      expect(document.querySelector("[data-verbatim='backend']")?.textContent).toBe(
        "the connection's scopes do not allow operating (read-only device)",
      );
    }
    if (name === "delivery-failed")
      expect(document.querySelector("[data-supplied-record]")?.textContent).toContain(
        "Delivery failed (SESSION_GONE).",
      );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await shot(`state-${name}`, width, mode);
  });
});

describe("question card behaviour", () => {
  it("shows Markdown detail and context as raw text and never executes it", async () => {
    await appear(1280, 800, "light");
    await using _screen = await render(
      sheet(
        <InteractionCard
          record={QUESTION}
          actions={scripted(() => confirmed()).actions}
          drafts={freshDrafts()}
        />,
      ),
      { router: false },
    );
    const raw = [...document.querySelectorAll("[data-raw-text]")].map((node) => node.textContent);
    expect(raw).toContain(HOSTILE);
    expect(raw).toContain("## context\n`raw`");
    expect(
      document.querySelector("[data-raw-text] img, [data-raw-text] script, [data-raw-text] b"),
    ).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("refuses an incomplete batch without sending, then sends exactly the validated answers by keyboard alone and returns focus", async () => {
    await appear(1280, 800, "light");
    const { actions, calls } = scripted(() => confirmed({}, true));
    const drafts = freshDrafts();
    await using screen = await render(
      sheet(<InteractionCard record={QUESTION} actions={actions} drafts={drafts} />),
      { router: false },
    );
    const send = screen.getByRole("button", { name: "Send answers" });
    (send.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelectorAll("[role=alert]").length).toBeGreaterThan(0);
    expect(calls.log).toEqual([]);
    (document.querySelector("input[type=radio]") as HTMLElement).focus();
    await userEvent.keyboard(" ");
    const multi = document.querySelectorAll<HTMLInputElement>("input[type=checkbox][name]");
    (multi[0] as HTMLElement).focus();
    await userEvent.keyboard(" ");
    (
      document.querySelector('textarea[aria-label^="Your own answer to: Why?"]') as HTMLElement
    ).focus();
    await userEvent.keyboard("because");
    (send.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => calls.log.length).toBe(1);
    expect(calls.log[0]).toEqual({
      method: "answer",
      payload: {
        interactionId: "q-1",
        revision: REV,
        answers: [
          { id: "colour", selected: ["Red"], skipped: false },
          { id: "extras", selected: ["A"], skipped: false },
          { id: "why", selected: [], custom: "because", skipped: false },
        ],
      },
    });
    await expect
      .poll(() =>
        document.activeElement?.closest("[data-interaction]")?.getAttribute("data-interaction"),
      )
      .toBe("q-1");
    // Confirmed by the Backend's own re-read: the draft is cleared, and only now.
    expect(drafts.read({ sessionId: "root", interactionId: "q-1", revision: REV })).toEqual({
      status: "none",
    });
  });

  it("two cards with similar ids: the answer reaches only its own interaction", async () => {
    await appear(1280, 800, "light");
    const { actions, calls } = scripted(() => confirmed());
    const other = {
      ...QUESTION,
      interactionId: "q-10",
      content: { questions: [{ id: "n", question: "Number?" }] },
    } as unknown as InteractionRecord;
    await using _screen = await render(
      sheet(
        <>
          <InteractionCard record={QUESTION} actions={actions} drafts={freshDrafts()} />
          <InteractionCard record={other} actions={actions} drafts={freshDrafts()} />
        </>,
      ),
      { router: false },
    );
    await page.getByRole("textbox", { name: "Your own answer to: Number?" }).fill("42");
    const card = document.querySelector("[data-interaction='q-10']") as HTMLElement;
    (card.querySelector("button[type=submit]") as HTMLElement).click();
    await expect.poll(() => calls.log.length).toBe(1);
    expect(calls.log[0]?.payload).toMatchObject({
      interactionId: "q-10",
      answers: [{ id: "n", custom: "42" }],
    });
  });

  it("keeps the draft on a refusal and says what it is", async () => {
    await appear(1280, 800, "light");
    const { actions } = scripted(() =>
      refusedReport("INTERACTION_ANSWER_INVALID", "answers[why]: nothing"),
    );
    const drafts = freshDrafts();
    await using _screen = await render(
      sheet(<InteractionCard record={QUESTION} actions={actions} drafts={drafts} />),
      { router: false },
    );
    await page.getByRole("textbox", { name: "Your own answer to: Why?" }).fill("kept");
    await page.getByRole("checkbox", { name: "Skip this question" }).first().click();
    await page.getByRole("checkbox", { name: "Skip this question" }).nth(1).click();
    await page.getByRole("button", { name: "Send answers" }).click();
    await expect.poll(() => document.querySelector("[data-report]")).not.toBeNull();
    const kept = drafts.read({ sessionId: "root", interactionId: "q-1", revision: REV });
    expect(kept.status).toBe("current");
    expect(kept.status === "current" && kept.value).toContain("kept");
  });

  it("a superseded revision shows the old text as from an earlier version, and cannot be sent", async () => {
    await appear(1280, 800, "light");
    const storage = new MemoryStorage();
    createDraftStore(storage).write(
      { sessionId: "root", interactionId: "q-1", revision: REV },
      JSON.stringify({
        colour: { selected: ["Red"], custom: "", skipped: false },
        extras: { selected: [], custom: "", skipped: true },
        why: { selected: [], custom: "old reasoning", skipped: false },
      }),
    );
    const { actions, calls } = scripted(() => confirmed());
    const next = { ...QUESTION, revision: REV2 } as InteractionRecord;
    await using screen = await render(
      sheet(<InteractionCard record={next} actions={actions} drafts={createDraftStore(storage)} />),
      { router: false },
    );
    const earlier = document.querySelector("[data-earlier-draft]");
    expect(earlier?.textContent).toContain("From an earlier version");
    expect(earlier?.textContent).toContain("old reasoning");
    await screen.getByRole("button", { name: "Send answers" }).click();
    expect(calls.log).toEqual([]);
  });

  it("a reply to an older action never replaces what a newer one said", async () => {
    await appear(1280, 800, "light");
    const stale: ActionReport<unknown> = {
      ...unknownReport,
      current: false,
    } as ActionReport<unknown>;
    const { actions } = scripted(() => stale);
    await using screen = await render(
      sheet(<InteractionCard record={PLAN} actions={actions} drafts={freshDrafts()} />),
      { router: false },
    );
    await screen.getByRole("button", { name: "Approve plan" }).click();
    await expect
      .poll(() => (document.querySelector("[data-interaction]") as HTMLElement).tabIndex)
      .toBe(-1);
    expect(document.querySelector("[data-report]")).toBeNull();
  });
});

describe("plan review, authorization and plan mode", () => {
  it("plan review shows the exact text, and a decision carries the revision and feedback", async () => {
    await appear(1280, 800, "light");
    const { actions, calls } = scripted(() => confirmed());
    await using screen = await render(
      sheet(<InteractionCard record={PLAN} actions={actions} drafts={freshDrafts()} />),
      { router: false },
    );
    expect(document.querySelector("[data-raw-text]")?.textContent).toBe(
      (PLAN as { content: { plan: string } }).content.plan,
    );
    expect(document.body.textContent).toContain("Review 2");
    await screen.getByRole("textbox", { name: "Feedback on the plan" }).fill("tighter");
    await screen.getByRole("button", { name: "Request changes" }).click();
    await expect.poll(() => calls.log.length).toBe(1);
    expect(calls.log[0]).toEqual({
      method: "planDecide",
      payload: {
        interactionId: "p-1",
        revision: REV,
        decision: "changes_requested",
        feedback: "tighter",
      },
    });
  });

  it("authorization: the grant names the subject shown, the origin is shown once and Re-arm is disabled and honestly labelled", async () => {
    await appear(1280, 800, "light");
    const { actions, calls } = scripted(() => confirmed({ originId: ORIGIN }, false));
    await using screen = await render(
      sheet(<InteractionCard record={AUTH} actions={actions} drafts={freshDrafts()} />),
      { router: false },
    );
    await screen.getByRole("button", { name: "Grant for this subject only" }).click();
    await expect.poll(() => calls.log.length).toBe(1);
    expect(calls.log[0]).toEqual({
      method: "grant",
      payload: { subject: { type: "tool-call", id: "call-77", revision: REV2 }, sessionId: "root" },
    });
    await expect.poll(() => document.querySelector("[data-origin]")).not.toBeNull();
    const rearm = page.getByRole("button", { name: "Re-arm" });
    await expect.element(rearm).toBeDisabled();
    expectDisabledLook(document.querySelector("[data-rearm]") as HTMLButtonElement);
    expect(document.body.textContent).toContain(
      "Waiting for a Re-arm call that is not built yet (M07)",
    );
    // The origin id is on the display and nowhere else: no attribute, no second copy.
    expect(document.body.innerHTML.split(ORIGIN).length - 1).toBe(1);
  });

  it("a settled authorization shows its origin once, in the origin box, beside a visibly disabled Re-arm", async () => {
    await appear(390, 844, "light");
    const { actions } = scripted(() => confirmed());
    await using _screen = await render(
      sheet(<InteractionCard record={AUTH_ANSWERED} actions={actions} drafts={freshDrafts()} />),
      { router: false },
    );
    expect(document.body.textContent?.split(ORIGIN).length).toBe(2);
    expect(document.querySelector("[data-origin]")?.textContent).toContain(ORIGIN);
    expect(document.querySelector("[data-record-state]")?.textContent).not.toContain(ORIGIN);
    expectDisabledLook(document.querySelector("[data-rearm]") as HTMLButtonElement);
  });

  it("plan mode: the switch carries the revision it saw and a conflict is shown verbatim", async () => {
    await appear(1280, 800, "light");
    const { actions, calls } = scripted(() =>
      refusedReport("INTERACTION_STALE_REVISION", "mode revision 5 is current", "stale-revision"),
    );
    let refreshed = 0;
    await using screen = await render(
      sheet(
        <PlanModeCard
          sessionId="root"
          view={known(MODE_ON)}
          actions={actions}
          onRefresh={async () => void (refreshed += 1)}
        />,
      ),
      { router: false },
    );
    await screen.getByRole("button", { name: "Turn plan mode off" }).click();
    await expect.poll(() => calls.log.length).toBe(1);
    expect(calls.log[0]).toEqual({
      method: "planModeSet",
      payload: { sessionId: "root", active: false, expectedModeRevision: 4 },
    });
    await expect
      .poll(() => document.querySelector("[data-verbatim='backend']")?.textContent)
      .toBe("mode revision 5 is current");
    expect(refreshed).toBe(1);
  });

  it("tasks: nothing published, stale, unknown and unavailable each say so and none is an empty list", async () => {
    await appear(1280, 800, "light");
    await using screen = await render(
      sheet(
        <>
          <TasksView view={known<TaskView | null>(null)} />
          <TasksView view={known<TaskView | null>(tasks("stale"), true)} />
          <TasksView view={known<TaskView | null>(tasks("unknown"))} />
          <TasksView view={{ state: "unavailable", reason: "unreadable" }} />
        </>,
      ),
      { router: false },
    );
    const marks = [...document.querySelectorAll("[data-tasks]")].map((node) =>
      node.getAttribute("data-tasks"),
    );
    expect(marks).toEqual(["none", "stale", "unknown", "unavailable"]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Nothing has been published yet.");
    expect(text).toContain("from an earlier Backend run");
    expect(text).toContain("cannot say which list is this session's");
    expect(text).toContain("The task list is unavailable");
    expect(screen.container.querySelectorAll("[data-tasks='unknown'] li").length).toBe(0);
  });
});
