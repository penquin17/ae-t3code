// The declared M10 regions (D17, XC-19): the manifest's one source and each view's descriptor. Only regions an Aetheria component mounts are declared; T3's own shell, drawer, rail, transcript,
// composer, diff, settings and terminal are not. A region two mounts can show at once has one id per mount. A field reports its shape unless it says `value`, which is only for a closed status
// word, a count or a flag, never for anything a person wrote or the Backend named. Tokens are the design names the view draws with, through the stylesheet mapping (cards: layer, border, labels).
import { declareRegion, type FieldDeclaration, type RegionDeclaration } from "./descriptor";

const OWNER = "aetheria-ui";

const region = (
  id: string,
  kind: RegionDeclaration["kind"],
  parent: string | null,
  description: string,
  more: Pick<RegionDeclaration, "props" | "state" | "tokens"> = {},
) => declareRegion({ id, kind, owner: OWNER, parent, description, ...more });

const shape = (name: string, type: FieldDeclaration["type"] = "string"): FieldDeclaration => ({
  name,
  type,
});
const value = (name: string, type: FieldDeclaration["type"]): FieldDeclaration => ({
  name,
  type,
  report: "value",
});

const PAGE = ["--ae-color-bg-base", "--ae-color-label-primary"] as const;
const CARDS = [
  "--ae-color-bg-layer",
  "--ae-color-border",
  "--ae-color-label-primary",
  "--ae-color-label-secondary",
] as const;
const ALERTS = ["--ae-color-state-warning", "--ae-color-state-error"] as const;
const RUNNING = [
  "--ae-color-brand-ink-top",
  "--ae-color-brand-ink-bottom",
  "--ae-color-brand-stalk-bottom",
  "--ae-color-brand-deep-bottom",
  "--ae-color-brand-spark",
  "--ae-running-mark",
  "--ae-running-faint",
  "--ae-motion-grain",
  "--ae-motion-loop",
  "--ae-motion-settle",
] as const;

/** The connection line's one status word: connected, connecting, reconnecting, disconnected, unauthorized, access-ended, version-mismatch or unknown. */
const connection = (id: string, parent: string, where: string) =>
  region(
    id,
    "region",
    parent,
    `The connection status line in ${where}; visible only when not connected`,
    { state: [value("status", "string")], tokens: ALERTS },
  );

/** What a session list reports: whether the saved groups were read, how many projects it shows, whether a search narrows it, and the search text by shape alone. */
const sessionList = {
  state: [
    value("groups", "string"),
    value("projects", "number"),
    value("filtered", "boolean"),
    shape("search"),
  ],
  tokens: CARDS,
} as const;

/** A panel that reads the Backend: its read's outcome word and whether it is reading again. */
const readState = [value("list", "string"), value("refreshing", "boolean")] as const;

export const REGION = {
  sidebar: region(
    "sidebar",
    "panel",
    null,
    "The Aetheria sidebar: connection status and the session list",
    { state: [value("mobile", "boolean")], tokens: CARDS },
  ),
  sidebarConnection: connection("sidebar.connection", "sidebar", "the sidebar"),
  sidebarSessions: region(
    "sidebar.sessions",
    "panel",
    "sidebar",
    "The session list in the sidebar, with its saved groups",
    sessionList,
  ),
  sessions: region("sessions", "screen", null, "The sessions page", { tokens: PAGE }),
  sessionsList: region(
    "sessions.list",
    "panel",
    "sessions",
    "The session list on the sessions page, with its saved groups",
    sessionList,
  ),
  control: region("control", "screen", null, "The human-control page of one root session", {
    props: [shape("environmentId"), shape("threadId")],
    state: [value("identity", "string")],
    tokens: PAGE,
  }),
  controlConnection: connection("control.connection", "control", "the control page"),
  controlInteractions: region(
    "control.interactions",
    "panel",
    "control",
    "The questions, plans, authorizations, plan mode and tasks the Backend holds for the session",
    {
      props: [shape("rootSessionId")],
      state: [value("view", "string"), value("open", "number"), value("settled", "number")],
      tokens: CARDS,
    },
  ),
  controlChildren: region(
    "control.children",
    "panel",
    "control",
    "The session's children, their reports and a Stop for each",
    { props: [shape("threadId")], state: readState, tokens: CARDS },
  ),
  controlJobs: region(
    "control.jobs",
    "panel",
    "control",
    "The session's jobs, their output, a Kill for each, and the completion notices",
    { props: [shape("threadId")], state: readState, tokens: CARDS },
  ),
  controlUsage: region(
    "control.usage",
    "panel",
    "control",
    "Which routes the children can use and what usage each provider reports",
    { props: [shape("threadId")], state: readState, tokens: CARDS },
  ),
  controlGoals: region(
    "control.goals",
    "panel",
    "control",
    "The statement that goals and workflows are not built yet",
    { tokens: CARDS },
  ),
  deliverables: region(
    "deliverables",
    "screen",
    null,
    "The deliverables page of one root session",
    {
      props: [shape("environmentId"), shape("threadId")],
      tokens: PAGE,
    },
  ),
  deliverablesConnection: connection(
    "deliverables.connection",
    "deliverables",
    "the deliverables page",
  ),
  deliverablesCards: region(
    "deliverables.cards",
    "panel",
    "deliverables",
    "The delivery cards the Backend lists for the session",
    {
      props: [shape("rootThreadId")],
      state: [
        value("list", "string"),
        value("cardCount", "number"),
        value("refreshing", "boolean"),
      ],
      tokens: CARDS,
    },
  ),
  deliverablesFiles: region(
    "deliverables.files",
    "panel",
    "deliverables",
    "The files the board recorded as edited in the session, each offered for download",
    {
      props: [shape("rootThreadId")],
      state: [
        value("list", "string"),
        value("editedCount", "number"),
        value("refreshing", "boolean"),
      ],
      tokens: CARDS,
    },
  ),
  deliverablesTerminal: region(
    "deliverables.terminal",
    "panel",
    "deliverables",
    "The statement that the terminal page is not mounted",
    { tokens: CARDS },
  ),
  conversationRunning: region(
    "conversation.running",
    "region",
    null,
    "The running indicator in the open conversation while a turn runs",
    { state: [value("shape", "string"), value("phase", "string")], tokens: RUNNING },
  ),
} as const;

export const REGION_DECLARATIONS = Object.values(REGION);

export const DECLARED_REGION_IDS = REGION_DECLARATIONS.map((descriptor) => descriptor.id);
