// What the running indicator shows, derived only from the backend's facts about the active run (D5).
// Running, waiting, stopping and not responding come from T3's run status and stop presentation;
// the phase from the active run's items. No client timer decides any of it, silence is never idle,
// and a fact that is withdrawn or contradicts another gives the neutral "Working". Plain TypeScript.

/** What the model is doing: gathering sources, connecting ideas, or weaving an answer. */
export type Phase = "gather" | "connect" | "weave";

export type RunningShape =
  | { readonly kind: "phase"; readonly phase: Phase }
  /** The run is going but what it is doing is not known: no phase is claimed. */
  | { readonly kind: "working" }
  | { readonly kind: "waiting" }
  | { readonly kind: "stopping" }
  | { readonly kind: "unresponsive" };

export interface RunItem {
  readonly type: string;
  readonly status: string;
  readonly ordinal: number;
  readonly runId: string | null;
  readonly toolName?: string | null | undefined;
  readonly streaming?: boolean | undefined;
}

export interface RunFacts {
  /** The active run's status; null when the backend lists no active run. */
  readonly runStatus: string | null;
  readonly activeRunId: string | null;
  /** T3's stop presentation for the run, if a Stop is unanswered. */
  readonly stop: "stopping" | "unresponsive" | null;
  readonly items: readonly RunItem[];
}

const WEAVE_TOOLS: ReadonlySet<string> = new Set(["edit", "apply_patch", "write"]);
const CONNECT_TOOLS: ReadonlySet<string> = new Set(["ask_user_question", "request_user_input"]);

/** Item types that are not tool work; a running item of any other type is a tool. */
const NOT_TOOLS: ReadonlySet<string> = new Set([
  "user_message",
  "assistant_message",
  "reasoning",
  "proposed_plan",
  "todo_list",
  "user_input_request",
  "approval_request",
  "checkpoint",
  "notification",
  "run_interrupt_request",
  "run_interrupt_result",
  "system_notice",
  "error",
  "compaction",
  "handoff",
  "fork",
  "thread_created",
]);

/** Tool item types whose identity is their type; every other tool is identified by `toolName`. */
const TOOL_TYPES: Readonly<Record<string, Phase>> = {
  command_execution: "gather",
  file_search: "gather",
  web_search: "gather",
  subagent: "gather",
  file_change: "weave",
};

/** A tool's phase, or null when its identity is not known. */
function phaseOfTool(item: RunItem): Phase | null {
  const byType = TOOL_TYPES[item.type];
  if (byType !== undefined) return byType;
  if (item.type !== "dynamic_tool") return null;
  const name = item.toolName;
  if (name === null || name === undefined || name === "") return null;
  if (WEAVE_TOOLS.has(name)) return "weave";
  if (CONNECT_TOOLS.has(name)) return "connect";
  return "gather";
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

export const isActiveRunStatus = (status: string): boolean => ACTIVE_RUN_STATUSES.has(status);

const latest = (items: readonly RunItem[]): RunItem | undefined =>
  items.reduce<RunItem | undefined>(
    (best, candidate) =>
      best === undefined || candidate.ordinal >= best.ordinal ? candidate : best,
    undefined,
  );

export function runningShapeOf(facts: RunFacts | null): RunningShape {
  if (facts === null) return { kind: "working" };
  if (facts.stop !== null) return { kind: facts.stop };

  if (facts.runStatus === "waiting") return { kind: "waiting" };
  // The row exists because T3 says the thread is working. If the run list does not show an active
  // run, claim nothing: not a phase, and never idle.
  if (facts.runStatus === null || !ACTIVE_RUN_STATUSES.has(facts.runStatus)) {
    return { kind: "working" };
  }

  const inRun = facts.items.filter(
    (item) => facts.activeRunId === null || item.runId === facts.activeRunId,
  );
  const running = inRun.filter((item) => item.status === "running");
  const tool = latest(running.filter((item) => !NOT_TOOLS.has(item.type)));
  if (tool !== undefined) {
    const phase = phaseOfTool(tool);
    return phase === null ? { kind: "working" } : { kind: "phase", phase };
  }
  const step = latest(
    running.filter(
      (item) =>
        (item.type === "reasoning" || item.type === "assistant_message") && item.streaming === true,
    ),
  );
  if (step !== undefined) {
    return { kind: "phase", phase: step.type === "reasoning" ? "connect" : "weave" };
  }
  return { kind: "phase", phase: "gather" };
}

const PHASE_WORDS: Readonly<Record<Phase, string>> = {
  gather: "Gathering knowledge",
  connect: "Connecting ideas",
  weave: "Weaving knowledge",
};

export function wordsOf(shape: RunningShape): string {
  switch (shape.kind) {
    case "phase":
      return PHASE_WORDS[shape.phase];
    case "working":
      return "Working";
    case "waiting":
      return "Waiting for you";
    case "stopping":
      return "Stopping…";
    case "unresponsive":
      return "Not responding";
  }
}

/** Whole seconds, at least one: `12s`, `1m 5s`, `1h 0m 3s`. Hours from one hour, minutes from sixty seconds. */
export function formatRunDuration(ms: number): string {
  const total = Math.max(1, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  let text = "";
  if (hours > 0) text += `${hours}h `;
  if (total >= 60) text += `${minutes}m `;
  return `${text}${seconds}s`;
}

/** Elapsed time since the backend's turn start; undefined when there is none or it is unreadable. */
export function elapsedText(createdAt: string | null, nowMs: number): string | undefined {
  if (createdAt === null) return undefined;
  const started = Date.parse(createdAt);
  if (Number.isNaN(started)) return undefined;
  return formatRunDuration(nowMs - started);
}
