// The quality matrix (M10 Plan step 26): each Aetheria view in its states at seven widths, both themes, reduced motion on and off, under the ./checks rules; images and the index land in __screenshots__/.
// Boundary: the routes' own components over supplied values and scripted calls, without the router, shell or socket, in Chromium; not Safari, not a phone, not the Backend.
// The route-level tests are control.browser.test.tsx and page.browser.test.tsx, and ../matrix.browser.test.tsx for the shell.
import type { DeliverableCard } from "@t3tools/aetheria-contracts";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { commands, page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { SidebarInset } from "~/components/ui/sidebar";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { render } from "../../../test/render";
import { ChildrenCallsContext, type ChildrenCalls } from "../children/calls";
import { ChildrenPanel } from "../children/ChildrenPanel";
import { ReportsTransportContext, type ReportsTransport } from "../children/reports";
import { ConnectionStatusView } from "../connection/ConnectionStatus";
import { initialFacts, viewOf, type ConnectionFacts } from "../connection/state";
import type { ActionReport, ControlActions } from "../control/actions";
import { createDraftStore, type DraftStorage } from "../control/drafts";
import { GoalsCard } from "../control/goals/GoalsCard";
import { InteractionCard } from "../control/InteractionCard";
import { JobsPanel } from "../control/jobs/JobsPanel";
import {
  JobsTransportContext,
  UNAVAILABLE_JOBS,
  type JobsTransport,
} from "../control/jobs/transport";
import { PlanModeCard } from "../control/PlanModeCard";
import type { ReadView } from "../control/reads";
import { TasksView } from "../control/TasksView";
import type { InteractionRecord, PlanMode, TaskView } from "../control/types";
import { UsagePanel } from "../control/usage/UsagePanel";
import {
  UNAVAILABLE_USAGE,
  UsageTransportContext,
  type UsageTransport,
} from "../control/usage/transport";
import { known } from "../core/known";
import { createActionRunner, type SendResult } from "../core/outcome";
import { DeliverablesCallsContext, type DeliverablesCalls } from "../deliverables/calls";
import { DeliverablesView } from "../deliverables/DeliverablesView";
import { DeliverableFetcherContext, type DeliverableFetcher } from "../files/fetcher";
import { createFakeBackend } from "../groups/testing";
import { GroupsTransportProvider } from "../groups/transport";
import { useGroups } from "../groups/useGroups";
import { RunningIndicator } from "../running/RunningIndicator";
import type { RunningShape } from "../running/status";
import { forkThenRename } from "../sessions/forkSequence";
import { groupSources } from "../sessions/groupSources";
import { forkLinkSource } from "../sessions/links";
import { toTreeModel } from "../sessions/model";
import { SessionsView } from "../sessions/SessionsView";
import { ago, at, facts, NOW } from "../sessions/testing";
import type { ListFacts } from "../sessions/types";
import type { SessionActions } from "../sessions/useSessionActions";
import {
  KNOWN_DEFECTS,
  QUALITY_MOTIONS,
  QUALITY_STATES,
  splitFindings,
  QUALITY_THEMES,
  QUALITY_WIDTHS,
  captureFile,
  expectedCombos,
  indexMarkdown,
  shouldCapture,
  validateIndex,
  type IndexEntry,
  type QualityState,
} from "./plan";
import {
  contrastReport,
  controlReport,
  focusFindings,
  motionFindings,
  overflowFindings,
  setReducedMotion,
  sidewaysScrollers,
} from "./checks";

type Mode = "light" | "dark";
const ENV = "env-1";
const heightFor = (width: number) => (width <= 767 ? 844 : 800);
const text = () => document.body.textContent ?? "";

const ok = (value: unknown): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value },
});
const fail = (code: string, detail?: string): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: false, code, ...(detail === undefined ? {} : { detail }) },
});

class MemoryStorage implements DraftStorage {
  readonly map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
  keys = () => [...this.map.keys()];
}

const DAY = 24 * 60;
const SESSIONS: ListFacts = facts([
  at("a", ago(3 * DAY), { title: "Quarterly revenue forecast model" }),
  at("b", ago(4 * DAY), { title: "Quarterly revenue forecast review" }),
  at("c", ago(5 * DAY), { title: "Garden irrigation schedule draft" }),
  at("d", ago(6 * DAY), { title: "Garden irrigation schedule notes" }),
  at("e", ago(2 * DAY), {
    title: "Waiting on a new kind of request",
    pendingKind: "something-new",
  }),
  at("f", ago(7 * DAY), { title: "Snoozed idea", snoozed: true }),
  at("g", ago(10), { title: "Pinned planning notes", pinned: true }),
  at("h", ago(2), { title: "Literature search, still running", running: known(true) }),
  at("i", ago(20), { title: "Finished while you were away", completionUnread: known(true) }),
]);
const SAVED_GROUPS = {
  version: 2 as const,
  links: [{ a: "a", b: "b", kind: "grouped" as const, at: 1 }],
  dismissed: [],
  names: [{ members: ["a", "b"], name: "Reading list", at: 2 }],
};

function sessionActions(): SessionActions {
  const runner = createActionRunner({ newRequestId: () => "r" });
  const done = (label: string) =>
    runner.run(label, { label, send: async () => ({ tag: "accepted", value: null }) });
  return {
    open: () => {},
    pin: () => done("Pin"),
    archive: () => done("Archive"),
    rename: () => done("Rename"),
    fork: () => done("Fork"),
    startSession: () => done("New session"),
    forkAndRename: (id) =>
      forkThenRename(
        runner,
        id,
        { label: "Fork", send: async () => ({ tag: "accepted", value: "child" }) },
        () => ({ label: "Rename", send: async () => ({ tag: "accepted", value: null }) }),
      ),
  };
}

function SessionsFrame() {
  const groups = useGroups();
  const [query, setQuery] = useState("");
  const sources = groupSources(forkLinkSource(SESSIONS), groups.state.record);
  const model = toTreeModel(SESSIONS, sources.links, sources.suggestions, {
    now: NOW,
    query,
    names: sources.names,
  });
  const [actions] = useState(sessionActions);
  return (
    <div className="flex min-h-svh bg-background">
      <div
        data-quality-frame="sidebar"
        className="h-svh w-full max-w-[20rem] shrink-0 overflow-y-auto bg-sidebar text-sidebar-foreground"
      >
        <SessionsView
          model={model}
          now={NOW}
          query={query}
          onQuery={setQuery}
          actions={actions}
          groups={groups}
        />
      </div>
    </div>
  );
}

const REV = "e".repeat(64);
const base = {
  state: "pending",
  revision: REV,
  rootSessionId: "root",
  sessionId: "root",
  createdAt: "2026-11-13T09:00:00Z",
  held: false,
} as const;
const QUESTION = {
  ...base,
  interactionId: "q-1",
  kind: "question",
  content: {
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Which sources should the literature search cover?",
        options: [
          { label: "Peer-reviewed only", description: "Narrower" },
          { label: "Include preprints" },
        ],
      },
      { id: "why", question: "Anything the search should avoid?" },
    ],
  },
} as unknown as InteractionRecord;
const PLAN = {
  ...base,
  interactionId: "p-1",
  kind: "plan-review",
  content: {
    plan: "# Plan\n\n1. Collect sources\n2. Summarise each\n3. Draft the synthesis",
    reviewNumber: 1,
  },
} as unknown as InteractionRecord;
const AUTH = {
  ...base,
  interactionId: "a-1",
  kind: "authorization",
  content: {
    text: "Allow the build tool to write outside the workspace?",
    subject: { type: "tool-call", id: "call-77", revision: "f".repeat(64) },
  },
} as unknown as InteractionRecord;
const ANSWERED = {
  ...QUESTION,
  interactionId: "q-0",
  state: "answered",
  resolution: {
    type: "answers",
    answers: [{ id: "scope", selected: ["Include preprints"], skipped: false }],
    originId: "origin-0001",
  },
} as unknown as InteractionRecord;
const CANCELLED = {
  ...PLAN,
  interactionId: "p-0",
  state: "cancelled",
  resolution: { type: "cancelled", cause: "mode-off" },
} as unknown as InteractionRecord;
const DELIVERY_FAILED = {
  ...AUTH,
  interactionId: "a-0",
  state: "answered",
  resolution: {
    type: "answers",
    answers: [{ id: "authorization", selected: ["Approve"], skipped: false }],
    originId: "origin-0002",
  },
  delivery: { status: "failed", code: "DELIVERY_REFUSED" },
} as unknown as InteractionRecord;

const confirmed: ActionReport<unknown> = {
  sent: true,
  requestId: "r",
  current: true,
  outcome: { kind: "confirmed", value: {}, refreshed: true },
  reply: { class: "accepted", reread: true },
};
const scriptedActions = new Proxy({} as ControlActions, { get: () => async () => confirmed });
const MODE_ON: PlanMode = { sessionId: "root", active: true, modeRevision: 4 };
const tasks = (state: TaskView["state"]): TaskView => ({
  sessionId: "root",
  rootSessionId: "root",
  entryId: "e",
  seq: 3,
  state,
  publishedAt: "2026-11-13T09:30:00Z",
  todos: [
    { content: "Write the failing test", status: "completed" },
    { content: "Make it pass", status: "in_progress" },
    { content: "Review", status: "pending" },
  ],
});
const knownView = <T,>(value: T, stale = false): ReadView<T> => ({
  state: "known",
  value,
  stale,
  ...(stale ? { reason: "the connection ended" } : {}),
});

const child = (over: Record<string, unknown> = {}) => ({
  childId: "child-a",
  parentId: "root-1",
  depth: 1,
  role: "researcher",
  mode: "continuable",
  label: "Researcher",
  state: "running",
  lastOutcome: null,
  route: 1,
  ...over,
});
const CHILD_ROWS = [
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
const childrenCalls = (list: () => SendResult<unknown>): ChildrenCalls => ({
  list: async () => list(),
  interrupt: async () => ok({ accepted: true }),
  close: async () => ok({ closed: true, killedJobs: [] }),
});
const reportsTransport: ReportsTransport = {
  read: async () => ({ ok: true, value: { state: "pending" } }),
};

const job = (over: Record<string, unknown> = {}) => ({
  jobId: "job-a",
  ownerSessionId: "sess-a",
  label: "npm test",
  state: "running",
  completion: "pending",
  ...over,
});
const jobsTransport: JobsTransport = {
  list: async () => ({
    ok: true,
    value: {
      jobs: [
        job(),
        job({
          jobId: "job-b",
          label: "build docs",
          state: "exited",
          completion: "inserted",
          exit: { code: 0, signal: null },
          startedAt: "2026-11-13T10:00:00Z",
          endedAt: "2026-11-13T10:05:00Z",
        }),
        job({
          jobId: "job-c",
          label: "sync",
          state: "lost",
          completion: "none",
          livenessIndeterminate: true,
        }),
      ],
    },
  }),
  outbox: async () => ({
    ok: true,
    value: {
      rows: [
        {
          key: "job:job-b:completion",
          kind: "job-completion",
          delivery: "inserted",
          attempts: 1,
          uncertainSince: null,
          nextAttemptAt: null,
        },
        {
          key: "job:job-c:lost",
          kind: "job-lost",
          delivery: "delivery-uncertain",
          attempts: 2,
          uncertainSince: 1,
          nextAttemptAt: null,
        },
      ],
    },
  }),
  output: async () => ({
    ok: true,
    value: {
      jobId: "job-a",
      state: "running",
      streams: [{ stream: "stdout", from: 0, to: 5, text: "hello", truncated: false, size: 5 }],
    },
  }),
  kill: async () => ({ ok: true, value: { jobId: "job-a", state: "killed" } }),
};
const windowState = (over: Record<string, unknown> = {}) => ({
  state: "available",
  reasonClass: "signed-in-window-ok",
  observedAt: "2026-11-13T10:00:00Z",
  basis: [{ signal: "window", result: "ok", at: "2026-11-13T09:59:00Z", windowId: "5h" }],
  ...over,
});
const usageTransport: UsageTransport = {
  read: async () => ({
    ok: true,
    value: {
      routes: [
        {
          route: { provider: "anthropic", model: "opus" },
          childLabel: "Researcher",
          state: windowState(),
        },
        {
          route: { provider: "openai", model: "gpt-5" },
          childLabel: "Reviewer",
          state: windowState({
            state: "out",
            reasonClass: "limit-remembered",
            resetsAt: "2026-11-13T15:00:00Z",
          }),
        },
        {
          route: { provider: "google", model: "gemini" },
          childLabel: "Reader",
          state: windowState({ state: "unknown", reasonClass: "no-signal", basis: [] }),
        },
      ],
      readings: [
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
      ],
    },
  }),
};

const EXPECTED = `sha256:${"a1".repeat(32)}`;
const ACTUAL = `sha256:${"b2".repeat(32)}`;
const FACTS = initialFacts({ tag: "present", value: EXPECTED });
const transportFacts = (phase: "backoff" | "offline", over: object = {}) => ({
  network: phase === "offline" ? ("offline" as const) : ("online" as const),
  phase,
  stage: null,
  attempt: 1,
  retryAt: null,
  blocked: null,
  ...over,
});
const factsOf = (over: Partial<ConnectionFacts>): ConnectionFacts => ({
  ...FACTS,
  generation: 2,
  ...over,
});
const VIEWS = {
  reconnecting: viewOf(
    factsOf({ everConnected: true, transport: transportFacts("backoff", { attempt: 2 }) }),
  ),
  disconnected: viewOf(factsOf({ transport: transportFacts("offline") })),
  unauthorized: viewOf(
    factsOf({ refusal: { status: 401, message: "This device's sign-in is no longer accepted." } }),
  ),
  accessEnded: viewOf(factsOf({ everConnected: true, callRefusal: "DEVICE_REVOKED" })),
  mismatch: viewOf(
    factsOf({
      refusal: {
        status: 409,
        code: "AETHERIA_BACKEND_DIGEST_MISMATCH",
        message: "This Backend was built from a different composition than this client expects.",
        expectedDigest: EXPECTED,
        actualDigest: ACTUAL,
      },
    }),
  ),
  unknown: viewOf(
    factsOf({
      refusal: { status: 500, message: "The Backend answered in a way this client does not know." },
    }),
  ),
};
const RUNNING_SHAPES: readonly RunningShape[] = [
  { kind: "phase", phase: "gather" },
  { kind: "phase", phase: "connect" },
  { kind: "phase", phase: "weave" },
  { kind: "working" },
  { kind: "waiting" },
  { kind: "stopping" },
  { kind: "unresponsive" },
];

const D1 = `sha256:${"a".repeat(64)}`;
const dlv = (n: number) => `dlv_${String(n).repeat(32)}`;
const off = (n: number) => `off_${String(n).repeat(32)}`;
const card = (n: number, over: Partial<DeliverableCard> = {}): DeliverableCard => ({
  id: dlv(n),
  threadId: "root-1",
  turnId: `run-${n}`,
  canonicalPath: `/work/file-${n}.md`,
  title: `Card ${n}`,
  kind: "markdown",
  size: 2048,
  digest: D1,
  declaredAt: Date.UTC(2026, 10, 13, 9, n),
  snapshot: { state: "attached", digest: D1, size: 2048 },
  supersededBy: null,
  ...over,
});
const CARDS: DeliverableCard[] = [
  card(1, { title: "Quarterly report", canonicalPath: "/work/report.md" }),
  card(2, {
    title: "Landing page",
    kind: "html",
    canonicalPath: "/work/site/index.html",
    snapshot: { state: "unavailable", code: "SNAPSHOT_TOO_LARGE" },
    supersededBy: dlv(5),
  }),
  card(3, {
    title: "Budget workbook",
    kind: "office",
    canonicalPath: "/work/budget.xlsx",
    threadId: "child-9",
    snapshot: { state: "pending" },
  }),
  card(4, { title: "Chart", kind: "image", canonicalPath: "/work/chart.png", size: 1024 }),
  card(5, { title: "Landing page v2", kind: "html", canonicalPath: "/work/site/index.html" }),
];
const EDITS = [
  {
    id: off(1),
    canonicalPath: "/work/a/very/long/path/to/a/recorded/edit/that/keeps/going/and/going/app.ts",
  },
  { id: off(2), canonicalPath: "/work/notes/summary.md" },
  { id: off(3), canonicalPath: "/work/data/model.xlsx" },
];
const MARKDOWN =
  "# Quarterly report\n\nRevenue rose in every region.\n\n[a link](/etc/passwd) is shown, not followed.";
const deliverableCalls = (
  list: SendResult<unknown>,
  offered: SendResult<unknown>,
): DeliverablesCalls => ({
  list: async () => list,
  offeredPaths: async () => offered,
});
const fetcher: DeliverableFetcher = {
  fetch: async () => ({ tag: "bytes", blob: new Blob([MARKDOWN]), digest: D1 }),
  save: () => {},
};

/** The page frame of ControlPage and DeliverablesPage: the inset surface and its column, with the page's own safe-area padding. The route's inner scroll box is dropped so the whole page is on one capture. */
function PageFrame(props: {
  readonly title: string;
  readonly region: string;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="min-h-dvh scrollbar-gutter-both">
      <main
        data-aetheria={props.region}
        className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-3 px-4 pt-16 pb-8"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <h1 className="text-lg font-medium text-foreground">{props.title}</h1>
        {props.children}
      </main>
    </SidebarInset>
  );
}

const noop = () => {};
const drafts = () => createDraftStore(new MemoryStorage());

function ControlFull() {
  const [store] = useState(drafts);
  return (
    <ChildrenCallsContext value={childrenCalls(() => ok({ rows: CHILD_ROWS, diagnostics: [] }))}>
      <ReportsTransportContext value={reportsTransport}>
        <JobsTransportContext value={jobsTransport}>
          <UsageTransportContext value={usageTransport}>
            <PageFrame title="Human control" region="control">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-3">
                  <InteractionCard record={QUESTION} actions={scriptedActions} drafts={store} />
                  <InteractionCard record={PLAN} actions={scriptedActions} drafts={store} />
                  <InteractionCard record={AUTH} actions={scriptedActions} drafts={store} />
                </div>
                <PlanModeCard
                  sessionId="root"
                  view={knownView(MODE_ON)}
                  actions={scriptedActions}
                  onRefresh={async () => {}}
                />
                <TasksView view={knownView<TaskView | null>(tasks("current"))} />
              </div>
              <ChildrenPanel environmentId={ENV} threadId="root-1" />
              <JobsPanel environmentId={ENV} threadId="root-1" />
              <UsagePanel environmentId={ENV} threadId="root-1" />
              <GoalsCard />
            </PageFrame>
          </UsageTransportContext>
        </JobsTransportContext>
      </ReportsTransportContext>
    </ChildrenCallsContext>
  );
}

function ControlDegraded() {
  const [store] = useState(drafts);
  return (
    <ChildrenCallsContext
      value={childrenCalls(() =>
        fail("CHILDREN_UNAVAILABLE", "the children service is not accepting work"),
      )}
    >
      <JobsTransportContext value={UNAVAILABLE_JOBS}>
        <UsageTransportContext value={UNAVAILABLE_USAGE}>
          <PageFrame title="Human control" region="control">
            <ConnectionStatusView view={VIEWS.reconnecting} onReload={noop} onSignIn={noop} />
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 flex-col gap-3">
                <h2 className="pt-2 text-sm font-medium text-muted-foreground">Settled</h2>
                <InteractionCard record={ANSWERED} actions={scriptedActions} drafts={store} />
                <InteractionCard record={CANCELLED} actions={scriptedActions} drafts={store} />
                <InteractionCard
                  record={DELIVERY_FAILED}
                  actions={scriptedActions}
                  drafts={store}
                />
              </div>
              <PlanModeCard
                sessionId="root"
                view={{
                  state: "unavailable",
                  reason: "the Backend did not answer the plan-mode read",
                }}
                actions={scriptedActions}
                onRefresh={async () => {}}
              />
              <TasksView view={knownView<TaskView | null>(tasks("stale"), true)} />
            </div>
            <ChildrenPanel environmentId={ENV} threadId="root-1" />
            <JobsPanel environmentId={ENV} threadId="root-1" />
            <UsagePanel environmentId={ENV} threadId="root-1" />
            <GoalsCard />
          </PageFrame>
        </UsageTransportContext>
      </JobsTransportContext>
    </ChildrenCallsContext>
  );
}

function DeliverablesFull() {
  return (
    <DeliverablesCallsContext
      value={deliverableCalls(
        ok({ rootThreadId: "root-1", deliverables: CARDS }),
        ok({ rootThreadId: "root-1", edits: { status: "known", paths: EDITS } }),
      )}
    >
      <DeliverableFetcherContext value={fetcher}>
        <PageFrame title="Deliverables" region="deliverables-page">
          <DeliverablesView environmentId={ENV} threadId="root-1" />
        </PageFrame>
      </DeliverableFetcherContext>
    </DeliverablesCallsContext>
  );
}

function DeliverablesUnavailable() {
  return (
    <DeliverablesCallsContext
      value={deliverableCalls(
        fail("DELIVERABLES_DEVICE_REVOKED", "This device's access ended at 09:41."),
        ok({ rootThreadId: "root-1", edits: { status: "unknown" } }),
      )}
    >
      <DeliverableFetcherContext value={fetcher}>
        <PageFrame title="Deliverables" region="deliverables-page">
          <ConnectionStatusView view={VIEWS.accessEnded} onReload={noop} onSignIn={noop} />
          <DeliverablesView environmentId={ENV} threadId="root-1" />
        </PageFrame>
      </DeliverableFetcherContext>
    </DeliverablesCallsContext>
  );
}

function StatusPage() {
  return (
    <PageFrame title="Connection and running states" region="status">
      {Object.values(VIEWS).map((view) => (
        <ConnectionStatusView key={view.kind} view={view} onReload={noop} onSignIn={noop} />
      ))}
      <div
        className="flex flex-col gap-1 border-t border-border/60 pt-3"
        data-testid="running-states"
      >
        {RUNNING_SHAPES.map((shape) => (
          <div
            key={shape.kind === "phase" ? shape.phase : shape.kind}
            className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums"
          >
            <RunningIndicator shape={shape} createdAt="2026-11-13T10:00:00Z" holdMs={0} />
          </div>
        ))}
      </div>
    </PageFrame>
  );
}

interface Scene {
  readonly ui: () => ReactNode;
  readonly ready: () => boolean;
  /** Runs after the page is ready, before the checks (a click that opens a preview, say). */
  readonly after?: (screen: Awaited<ReturnType<typeof render>>) => Promise<void>;
}

const SCENES: Record<string, Scene> = {
  "sessions/groups": {
    ui: () => {
      const backend = createFakeBackend(SAVED_GROUPS);
      return (
        <GroupsTransportProvider value={backend.transport}>
          <SessionsFrame />
        </GroupsTransportProvider>
      );
    },
    ready: () =>
      text().includes("in Reading list") && text().includes("Literature search, still running"),
  },
  "control/full": {
    ui: () => <ControlFull />,
    ready: () =>
      ["Researcher", "build docs", "Reviewer", "Goals and workflows"].every((word) =>
        text().includes(word),
      ),
  },
  "control/degraded": {
    ui: () => <ControlDegraded />,
    ready: () => text().includes("Goals and workflows") && text().includes("not accepting work"),
  },
  "deliverables/cards": {
    ui: () => <DeliverablesFull />,
    ready: () => text().includes("Quarterly report") && text().includes("summary.md"),
    after: async (screen) => {
      await screen
        .getByRole("button", { name: "Preview current file of Quarterly report" })
        .click();
      await expect.poll(() => document.querySelector("[data-preview='markdown']")).not.toBeNull();
    },
  },
  "deliverables/unavailable": {
    ui: () => <DeliverablesUnavailable />,
    ready: () => text().includes("access ended at 09:41") || text().includes("09:41"),
  },
  "status/banners-and-running": {
    ui: () => <StatusPage />,
    ready: () =>
      document.querySelectorAll("[data-connection-kind]").length === 6 &&
      document.querySelectorAll("[data-aetheria='running']").length === RUNNING_SHAPES.length,
  },
};

/** Grows the viewport until the page's own height fits in it (the page's `min-h-svh` follows the viewport, so this settles in a few rounds). */
async function fitViewportToPage(width: number, root: HTMLElement): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    const need = Math.max(
      heightFor(width),
      Math.ceil(root.scrollHeight),
      document.documentElement.scrollHeight,
    );
    if (need === window.innerHeight) break;
    await page.viewport(width, need);
    await expect.poll(() => window.innerHeight, { timeout: 5000 }).toBe(need);
  }
  await document.fonts.ready;
}

/**
 * Reads the picture back and says what is wrong with it: not as tall as the page, or no drawn content near the top or the bottom of what the page's elements span.
 * "Drawn" means a pixel unlike the background colour (the top-left pixel, which the page's own background paints).
 */
async function blankFindings(base64: string, root: HTMLElement): Promise<string[]> {
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${base64}`)).blob(),
  );
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const scale = bitmap.width / Math.max(1, root.getBoundingClientRect().width);
  const rootTop = root.getBoundingClientRect().top;
  // Where the page's elements actually are, from the root's top (CSS px).
  let bottom = 0;
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom - rootTop);
  }
  const problems: string[] = [];
  if (bitmap.height < Math.floor(root.scrollHeight * scale) - 2) {
    problems.push(
      `the image is ${bitmap.height}px tall, the page ${Math.round(root.scrollHeight * scale)}px`,
    );
  }
  const differs = (x: number, y: number) => {
    const i = (y * bitmap.width + x) * 4;
    return (
      Math.abs(data[i]! - data[0]!) +
        Math.abs(data[i + 1]! - data[1]!) +
        Math.abs(data[i + 2]! - data[2]!) >
      24
    );
  };
  let first = -1;
  let last = -1;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 2) {
      if (differs(x, y)) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  const span = Math.max(1, bottom * scale);
  if (first < 0) problems.push("the image is one flat colour");
  else {
    if (first > span * 0.25)
      problems.push(`nothing is drawn until row ${first} of ${Math.round(span)}`);
    if (last < span * 0.75)
      problems.push(`nothing is drawn after row ${last} of ${Math.round(span)}`);
  }
  return problems;
}

const results: IndexEntry[] = [];
const rows = (state: QualityState) =>
  QUALITY_WIDTHS.flatMap((width) =>
    QUALITY_THEMES.flatMap((theme) => QUALITY_MOTIONS.map((motion) => ({ width, theme, motion }))),
  ).map((row) => ({ ...row, state }));

async function runCombo(
  state: QualityState,
  width: number,
  theme: Mode,
  motion: "reduce" | "motion",
) {
  const scene = SCENES[`${state.view}/${state.state}`]!;
  await setReducedMotion(motion === "reduce");
  await page.viewport(width, heightFor(width));
  setTheme("system");
  setAppearanceMode(theme);
  refreshTheme();
  await using screen = await render(
    <div className="min-h-svh bg-background text-foreground">{scene.ui()}</div>,
    { router: false },
  );
  await expect
    .poll(
      () => (scene.ready() ? "ready" : `not ready: ${text().replace(/\s+/g, " ").slice(0, 400)}`),
      { timeout: 10_000 },
    )
    .toBe("ready");
  await scene.after?.(screen);
  // Finite transitions and entrances are allowed to finish; an endless one (the running mark) is judged by the motion rule.
  await expect
    .poll(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity,
          ).length,
      { timeout: 5000 },
    )
    .toBe(0);
  await document.fonts.ready;

  const root = screen.container;
  const controls = controlReport(root, width);
  const contrast = contrastReport(root);
  const scrollers = sidewaysScrollers(root);
  // Motion is judged at rest, before the keyboard walk: a short fade that a focus change starts is T3's own transition and is reported as an advisory afterwards.
  const atRest = motionFindings(root, motion === "reduce");
  const focus = await focusFindings(root);
  const afterFocus = motionFindings(root, motion === "reduce").filter((f) => !atRest.includes(f));
  const findings = [
    ...overflowFindings(width, root).map((f) => `overflow: ${f}`),
    ...scrollers.findings.map((f) => `overflow: ${f}`),
    ...contrast.findings.map((f) => `contrast: ${f}`),
    ...controls.findings.map((f) => `control: ${f}`),
    ...focus.map((f) => `focus: ${f}`),
    ...atRest.map((f) => `motion: ${f}`),
  ];
  const advisories = [
    ...contrast.advisories,
    ...controls.advisories,
    ...scrollers.advisories,
    ...afterFocus.map((f) => `after a focus change: ${f}`),
  ];

  const combo = { view: state.view, state: state.state, width, theme, motion };
  let file: string | null = null;
  if (shouldCapture(motion, width)) {
    file = captureFile(combo);
    // The caret and any focus ring left by the Tab walk are not part of the picture.
    (document.activeElement as HTMLElement | null)?.blur();
    // The whole view is the picture: the viewport grows to the page's own height first, because an element taller than the viewport is otherwise painted only in part.
    await fitViewportToPage(width, root);
    const shot = await page.screenshot({
      element: root,
      base64: true,
      path: `__screenshots__/${file}`,
      save: true,
    });
    const blank = await blankFindings(shot.base64, root);
    expect(blank, `${file} is not a picture of the whole view`).toEqual([]);
  }
  const split = splitFindings(state.view, state.state, findings);
  results.push({ ...combo, file, findings: split.findings, advisories, known: split.known });
  expect(split.findings, `${state.view}/${state.state} ${width} ${theme} ${motion}`).toEqual([]);
}

describe.each(QUALITY_STATES.map((state) => [`${state.view}/${state.state}`, state] as const))(
  "%s",
  (_name, state) => {
    it.each(rows(state).map((row) => [row.width, row.theme, row.motion] as const))(
      "at %i px, %s, motion %s: fits, reads, is named and reachable, and honours the motion setting",
      async (width, theme, motion) => runCombo(state, width, theme, motion),
    );
  },
);

describe("the index", () => {
  it("is written beside the images, in plan order", async () => {
    await setReducedMotion(false);
    const order = new Map(
      expectedCombos().map((c, i) => [`${c.view}/${c.state}/${c.width}/${c.theme}/${c.motion}`, i]),
    );
    const key = (e: IndexEntry) =>
      order.get(`${e.view}/${e.state}/${e.width}/${e.theme}/${e.motion}`) ?? 0;
    const sorted = [...results].toSorted((a, b) => key(a) - key(b));
    // The command resolves paths from the project root (apps/web), unlike `page.screenshot`, which resolves from this file.
    const dir = "src/aetheria/quality/__screenshots__";
    await commands.writeFile(`${dir}/quality-index.json`, `${JSON.stringify(sorted, null, 2)}\n`);
    await commands.writeFile(`${dir}/quality-index.md`, indexMarkdown(sorted));
    expect(sorted.length).toBe(results.length);
  });

  it("still meets every known defect it sets aside: a fixed one is removed from the list", () => {
    const hit = new Set(results.flatMap((entry) => entry.known));
    expect(KNOWN_DEFECTS.filter((d) => !hit.has(d.id)).map((d) => d.id)).toEqual([]);
  });

  it("lists every combination exactly once, with the planned file for each image", () => {
    expect(validateIndex(results)).toEqual([]);
  });
});
