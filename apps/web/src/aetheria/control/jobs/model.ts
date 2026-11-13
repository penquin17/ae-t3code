// What a root's jobs, their output, a Kill and the completion-notice outbox mean on screen (M10 Plan step 18, D14, D4, XC-15/16). Everything here is derived from the Backend's last answer: a value
// that cannot be read is refused as a whole and never repaired or dropped, a time or exit the Backend did not supply is said not to be supplied, output is read by an explicit byte offset and never
// described as complete, a Kill is one send with an honest outcome, and the outbox is shown read-only. Plain TypeScript: no DOM, no T3 import. The field names mirror M05's `JobRow`,
// `JobsOutputValue`, `JobsKillValue` and `OutboxRow` (packages/aetheria-orchestration); `startedAt`/`endedAt` are optional because M05's `JobRow` carries neither.
import type { ActionOutcome, ConfirmResult, SendResult } from "../../core/outcome";
import { classifyReply, type Parsed, type ReadView } from "./reply";

const JOB_STATES = ["starting", "running", "exited", "killed", "failed", "lost"] as const;
export type JobState = (typeof JOB_STATES)[number];
const FINAL_STATES: readonly JobState[] = ["exited", "killed", "failed", "lost"];
const isFinal = (state: JobState | null): boolean => state !== null && FINAL_STATES.includes(state);

export interface JobExitValue {
  readonly code: number | null;
  readonly signal: string | null;
}
export interface JobRowValue {
  readonly jobId: string;
  readonly ownerSessionId: string;
  /** The command's label as the Backend recorded it. */
  readonly label: string;
  readonly state: JobState;
  readonly completion: "pending" | "inserted" | "none";
  readonly collectedAt?: string;
  readonly deliveryUncertain?: true;
  readonly exit?: JobExitValue;
  readonly livenessIndeterminate?: true;
  readonly terminationUnconfirmed?: true;
  readonly startedAt?: string;
  readonly endedAt?: string;
}
export interface KillValue {
  readonly jobId: string;
  readonly state: JobState;
  readonly exit?: JobExitValue;
  readonly livenessIndeterminate?: true;
  readonly terminationUnconfirmed?: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isState = (value: unknown): value is JobState =>
  typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseExit(value: unknown): Parsed<JobExitValue | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return { ok: false, reason: "an exit is not an object" };
  const { code, signal } = value;
  const codeOk = code === null || (typeof code === "number" && Number.isSafeInteger(code));
  const signalOk = signal === null || (typeof signal === "string" && signal !== "");
  if (!codeOk || !signalOk) return { ok: false, reason: "an exit is not a code and a signal" };
  return { ok: true, value: { code, signal } };
}

/** Optional doubt flags and text carried through only when they are what the contract says they are. */
function flagsOf(value: Record<string, unknown>) {
  return {
    ...(value.livenessIndeterminate === true ? { livenessIndeterminate: true as const } : {}),
    ...(value.terminationUnconfirmed === true ? { terminationUnconfirmed: true as const } : {}),
  };
}

function parseJobRow(value: unknown): Parsed<JobRowValue> {
  if (!isRecord(value)) return { ok: false, reason: "a job row is not an object" };
  const { jobId, ownerSessionId, label, state, completion } = value;
  if (typeof jobId !== "string" || jobId === "")
    return { ok: false, reason: "a job row has no id" };
  if (typeof ownerSessionId !== "string" || typeof label !== "string") {
    return { ok: false, reason: `job ${jobId} has no owner or label` };
  }
  if (!isState(state))
    return { ok: false, reason: `job ${jobId} has a state this view does not know` };
  if (completion !== "pending" && completion !== "inserted" && completion !== "none") {
    return { ok: false, reason: `job ${jobId} has a completion state this view does not know` };
  }
  const exit = parseExit(value.exit);
  if (!exit.ok) return { ok: false, reason: `job ${jobId}: ${exit.reason}` };
  for (const field of ["collectedAt", "startedAt", "endedAt"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      return { ok: false, reason: `job ${jobId}: ${field} is not text` };
    }
  }
  return {
    ok: true,
    value: {
      jobId,
      ownerSessionId,
      label,
      state,
      completion,
      ...(typeof value.collectedAt === "string" ? { collectedAt: value.collectedAt } : {}),
      ...(value.deliveryUncertain === true ? { deliveryUncertain: true as const } : {}),
      ...(exit.value === undefined ? {} : { exit: exit.value }),
      ...flagsOf(value),
      ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
      ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
    },
  };
}

/**
 * A list as the Backend answered it: its rows, and how many records it could not read. Above zero the list is NOT complete (a job or a notice of this root may be missing), and the view says so
 * rather than show it as the whole. An answer that omits the count reads as zero.
 */
export interface Listed<T> {
  readonly rows: readonly T[];
  readonly unreadable: number;
}

/** The Backend's `unreadable` count: absent is zero, a count is kept, anything else cannot be trusted so the whole list is unreadable. */
function unreadableOf(value: Record<string, unknown>): Parsed<number> {
  if (value.unreadable === undefined) return { ok: true, value: 0 };
  return isCount(value.unreadable)
    ? { ok: true, value: value.unreadable }
    : { ok: false, reason: "the count of records the Backend could not read is not a count" };
}

/** Rows in the Backend's order. One row this view cannot read makes the whole list unreadable: no row is dropped quietly. */
export function parseJobList(value: unknown): Parsed<Listed<JobRowValue>> {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    return { ok: false, reason: "the Backend's answer was not a job list" };
  }
  const unreadable = unreadableOf(value);
  if (!unreadable.ok) return unreadable;
  const rows: JobRowValue[] = [];
  for (const entry of value.jobs as unknown[]) {
    const parsed = parseJobRow(entry);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    rows.push(parsed.value);
  }
  return { ok: true, value: { rows, unreadable: unreadable.value } };
}

export interface JobRowView {
  readonly jobId: string;
  readonly label: string;
  readonly state: JobState;
  readonly stateText: string;
  readonly ownerText: string;
  readonly startedText: string;
  readonly endedText: string;
  readonly exitText: string;
  readonly noticeText: string;
  readonly flagTexts: readonly string[];
  /** Only a job that has not reached a final state can be killed. */
  readonly canKill: boolean;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function exitText(state: JobState, exit: JobExitValue | undefined): string {
  if (exit !== undefined) {
    if (exit.code !== null && exit.signal === null) return `Exit code ${exit.code}`;
    if (exit.code === null && exit.signal !== null) return `Ended by signal ${exit.signal}`;
    return `Exit code ${exit.code}, signal ${exit.signal}`;
  }
  if (state === "starting" || state === "running") return "Not exited yet";
  return "No exit was observed";
}

export function jobRowView(row: JobRowValue): JobRowView {
  const final = isFinal(row.state);
  const notice =
    row.completion === "pending"
      ? "Completion notice pending"
      : row.completion === "inserted"
        ? "Completion notice inserted"
        : "No completion notice";
  const flagTexts: string[] = [];
  if (row.livenessIndeterminate === true) {
    flagTexts.push("Whether this job is still running is not known");
  }
  if (row.terminationUnconfirmed === true) flagTexts.push("Its termination was not confirmed");
  return {
    jobId: row.jobId,
    label: row.label,
    state: row.state,
    stateText: capitalise(row.state),
    ownerText: `Owner session ${row.ownerSessionId}`,
    startedText:
      row.startedAt === undefined ? "Start time not supplied" : `Started ${row.startedAt}`,
    endedText: !final
      ? "Not ended"
      : row.endedAt === undefined
        ? "End time not supplied"
        : `Ended ${row.endedAt}`,
    exitText: exitText(row.state, row.exit),
    noticeText: row.deliveryUncertain === true ? `${notice}; its delivery is uncertain` : notice,
    flagTexts,
    canKill: !final,
  };
}

// ── Output, read by explicit offset ──────────────────────────────────────────────────────────────

export interface StreamView {
  readonly text: string;
  /** The byte offset the next read asks for: the end of the last chunk added. */
  readonly next: number;
  /** The Backend said more of this stream was waiting when it was last read. */
  readonly more: boolean;
  /** The stream's size in bytes at the last read, when the Backend said (the contract's `size`). */
  readonly size?: number;
}
export interface OutputState {
  readonly jobId: string;
  readonly stdout: StreamView;
  readonly stderr: StreamView;
  /** The job's state and exit as of the last read; null before any read. */
  readonly jobState: JobState | null;
  readonly exit: JobExitValue | null;
  /** Things the last reads said about themselves (a chunk that was not added). */
  readonly notes: readonly string[];
}
export type Offsets = { readonly stdout: number; readonly stderr: number };
export type OutputApplied =
  | { readonly ok: true; readonly state: OutputState }
  | { readonly ok: false; readonly reason: string };

const EMPTY_STREAM: StreamView = { text: "", next: 0, more: false };
export const initialOutput = (jobId: string): OutputState => ({
  jobId,
  stdout: EMPTY_STREAM,
  stderr: EMPTY_STREAM,
  jobState: null,
  exit: null,
  notes: [],
});
export const offsetsOf = (state: OutputState): Offsets => ({
  stdout: state.stdout.next,
  stderr: state.stderr.next,
});

/**
 * One output answer added to what is shown. A chunk is added only when it starts at the offset the read asked for; one that does not is left out and said so, so the text never has a hidden gap.
 * An answer this view cannot read changes nothing.
 */
export function applyOutput(state: OutputState, requested: Offsets, value: unknown): OutputApplied {
  const unreadable = (reason: string): OutputApplied => ({ ok: false, reason });
  if (!isRecord(value) || value.jobId !== state.jobId) {
    return unreadable("the Backend's answer was not this job's output");
  }
  if (!isState(value.state))
    return unreadable("the output answer carries a job state this view does not know");
  if (!Array.isArray(value.streams)) return unreadable("the output answer carries no streams");
  const exit = parseExit(value.exit);
  if (!exit.ok) return unreadable(exit.reason);
  const next: Record<"stdout" | "stderr", StreamView> = {
    stdout: { ...state.stdout, more: false },
    stderr: { ...state.stderr, more: false },
  };
  const notes: string[] = [];
  for (const chunk of value.streams as unknown[]) {
    if (
      !isRecord(chunk) ||
      (chunk.stream !== "stdout" && chunk.stream !== "stderr") ||
      !isCount(chunk.from) ||
      !isCount(chunk.to) ||
      chunk.to < chunk.from ||
      typeof chunk.text !== "string" ||
      typeof chunk.truncated !== "boolean" ||
      (chunk.size !== undefined && !isCount(chunk.size))
    ) {
      return unreadable("an output chunk is not a stream, an offset range and text");
    }
    const stream = chunk.stream;
    if (chunk.from !== requested[stream]) {
      notes.push(
        `The Backend returned bytes ${chunk.from}–${chunk.to} of ${stream}, but the view asked for offset ${requested[stream]}; that chunk was not added, so the text shown may be incomplete.`,
      );
      continue;
    }
    next[stream] = {
      text: next[stream].text + chunk.text,
      next: chunk.to,
      more: chunk.truncated,
      ...(typeof chunk.size === "number" ? { size: chunk.size } : {}),
    };
  }
  return {
    ok: true,
    state: {
      jobId: state.jobId,
      stdout: next.stdout,
      stderr: next.stderr,
      jobState: value.state,
      exit: exit.value ?? null,
      notes,
    },
  };
}

/** What a stream's offset and the last read say. It never says the output is complete: a read only says what came back at that moment. */
export function streamStatus(stream: StreamView, jobState: JobState | null): string {
  const of = stream.size === undefined ? "" : ` of ${stream.size}`;
  const shown = stream.next === 0 ? "Nothing shown yet." : `Bytes 0–${stream.next}${of} shown.`;
  if (stream.more) return `${shown} More output is waiting; read more to continue.`;
  if (isFinal(jobState)) {
    return stream.next === 0
      ? "Nothing was returned for this stream at this read."
      : `${shown} Nothing further was returned at this read.`;
  }
  return stream.next === 0
    ? "Nothing has been returned for this stream at this read; the job may still write more."
    : `${shown} Nothing further was returned at this read; the job may still write more.`;
}

// ── Kill ─────────────────────────────────────────────────────────────────────────────────────────

/** One kill reply as the one send's result. A reply that is not a kill answer is `lost`: the kill may or may not have landed, and nothing resends it. */
export function killSendFromReply(reply: unknown): SendResult<KillValue> {
  const classified = classifyReply(reply);
  switch (classified.tag) {
    case "refused":
      return { tag: "refused", code: classified.code, message: classified.detail ?? "" };
    case "unavailable":
      return { tag: "unavailable", reason: classified.reason };
    case "unknown":
      return { tag: "lost" };
    case "ok": {
      const value = classified.value;
      if (!isRecord(value) || typeof value.jobId !== "string" || !isState(value.state)) {
        return { tag: "lost" };
      }
      if (!isFinal(value.state)) return { tag: "lost" };
      const exit = parseExit(value.exit);
      if (!exit.ok) return { tag: "lost" };
      return {
        tag: "accepted",
        value: {
          jobId: value.jobId,
          state: value.state,
          ...(exit.value === undefined ? {} : { exit: exit.value }),
          ...flagsOf(value),
        },
      };
    }
  }
}

/** The re-read after an accepted kill shows it only when that job is listed in a final state. */
export function killConfirm(list: ReadView<Listed<JobRowValue>>, jobId: string): ConfirmResult {
  if (list.tag === "read") {
    const found = list.value.rows.find((row) => row.jobId === jobId);
    return found !== undefined && isFinal(found.state) ? { tag: "shows" } : { tag: "absent" };
  }
  if (list.tag === "reading") return { tag: "failed", reason: "the list is still being read" };
  if (list.tag === "refused") {
    return { tag: "failed", reason: list.detail ?? list.code };
  }
  return { tag: "failed", reason: list.reason };
}

export interface KillNotice {
  readonly tone: "ok" | "warn" | "error";
  readonly text: string;
}

/** The words for a kill's outcome. A refusal returns null: the view shows it as a refusal notice, with the Backend's own words. */
export function killNotice(label: string, outcome: ActionOutcome<KillValue>): KillNotice | null {
  switch (outcome.kind) {
    case "confirmed": {
      const parts = [`Kill done for ${label}: the job is now ${outcome.value.state}.`];
      if (outcome.value.exit !== undefined) {
        parts.push(`${exitText(outcome.value.state, outcome.value.exit)}.`);
      }
      if (outcome.value.terminationUnconfirmed === true) {
        parts.push("The Backend could not confirm that the process ended.");
      }
      if (outcome.value.livenessIndeterminate === true) {
        parts.push("The Backend could not tell whether the process is still running.");
      }
      if (!outcome.refreshed && outcome.message !== undefined) {
        parts.push(`The list could not be read again: ${outcome.message}`);
      }
      const doubtful =
        outcome.value.terminationUnconfirmed === true ||
        outcome.value.livenessIndeterminate === true ||
        !outcome.refreshed;
      return { tone: doubtful ? "warn" : "ok", text: parts.join(" ") };
    }
    case "unknown":
      return {
        tone: "warn",
        text: `Whether ${label} was killed is not known: ${outcome.reason} The kill was not sent again; read the list again to see the job's state.`,
      };
    case "unavailable":
      return { tone: "error", text: `Nothing was killed: ${outcome.reason}` };
    case "refused":
      return null;
    case "partial":
      return {
        tone: "warn",
        text: `Part of the kill for ${label} applied (${outcome.applied.join(", ")}); the rest did not.`,
      };
  }
}

// ── The outbox, read-only ────────────────────────────────────────────────────────────────────────

const OUTBOX_DELIVERIES = [
  "pending",
  "attempting",
  "inserted",
  "recorded",
  "abandoned",
  "delivery-uncertain",
] as const;
export type OutboxDelivery = (typeof OUTBOX_DELIVERIES)[number];

export interface OutboxRowValue {
  readonly key: string;
  readonly kind: string;
  readonly delivery: OutboxDelivery;
  readonly attempts: number;
  readonly uncertainSince: number | null;
  readonly nextAttemptAt: number | null;
}

function parseOutboxRow(value: unknown): Parsed<OutboxRowValue> {
  if (!isRecord(value)) return { ok: false, reason: "an outbox entry is not an object" };
  const { key, kind, delivery, attempts } = value;
  if (typeof key !== "string" || key === "")
    return { ok: false, reason: "an outbox entry has no key" };
  if (typeof kind !== "string" || kind === "")
    return { ok: false, reason: `entry ${key} has no kind` };
  if (
    typeof delivery !== "string" ||
    !(OUTBOX_DELIVERIES as readonly string[]).includes(delivery)
  ) {
    return { ok: false, reason: `entry ${key} has a delivery state this view does not know` };
  }
  if (!isCount(attempts)) return { ok: false, reason: `entry ${key} has no attempt count` };
  const time = (field: "uncertainSince" | "nextAttemptAt"): number | null | undefined => {
    const at = value[field];
    return at === undefined || at === null ? null : isCount(at) ? at : undefined;
  };
  const uncertainSince = time("uncertainSince");
  const nextAttemptAt = time("nextAttemptAt");
  if (uncertainSince === undefined || nextAttemptAt === undefined) {
    return { ok: false, reason: `entry ${key} has a time that is not a time` };
  }
  return {
    ok: true,
    value: {
      key,
      kind,
      delivery: delivery as OutboxDelivery,
      attempts,
      uncertainSince,
      nextAttemptAt,
    },
  };
}

export function parseOutbox(value: unknown): Parsed<Listed<OutboxRowValue>> {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return { ok: false, reason: "the Backend's answer was not an outbox list" };
  }
  const unreadable = unreadableOf(value);
  if (!unreadable.ok) return unreadable;
  const rows: OutboxRowValue[] = [];
  for (const entry of value.rows as unknown[]) {
    const parsed = parseOutboxRow(entry);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    rows.push(parsed.value);
  }
  return { ok: true, value: { rows, unreadable: unreadable.value } };
}

/** The words for a list the Backend could not read all of; null when it read everything. */
export function incompleteText(what: string, unreadable: number): string | null {
  return unreadable === 0
    ? null
    : `${what} may be incomplete: the Backend could not read ${unreadable} ${unreadable === 1 ? "record" : "records"}.`;
}

const DELIVERY_TEXT: Record<OutboxDelivery, string> = {
  pending: "Pending: not delivered yet",
  attempting: "Being delivered",
  inserted: "Inserted into the conversation",
  recorded: "Recorded only: a stored report that is never inserted",
  abandoned: "Abandoned: it will not be delivered",
  "delivery-uncertain": "Delivery uncertain: it may or may not have arrived",
};

export interface OutboxRowView {
  readonly key: string;
  readonly kind: string;
  readonly delivery: OutboxDelivery;
  readonly deliveryText: string;
  readonly attemptsText: string;
  readonly nextText: string | null;
}

export function outboxRowView(row: OutboxRowValue): OutboxRowView {
  return {
    key: row.key,
    kind: row.kind,
    delivery: row.delivery,
    deliveryText: DELIVERY_TEXT[row.delivery],
    attemptsText: `${row.attempts} ${row.attempts === 1 ? "attempt" : "attempts"}`,
    nextText:
      row.nextAttemptAt === null
        ? null
        : `Next attempt not before ${new Date(row.nextAttemptAt).toISOString()}`,
  };
}

/** Said beside the outbox, as a fact about this view and not about the Backend. */
export const OUTBOX_READ_ONLY_NOTE =
  "This list is read-only. Viewing it acknowledges nothing: no notice is marked delivered, seen or collected by being listed here.";
