// What route availability and usage readings mean on screen (M10 Plan step 18, D14, XC-11). A route is available, out or unknown with the Backend's reason class and basis; a usage reading is a
// reading, a stale reading or no reading, and an absent or unreadable value is never shown as 0 or as credit. The main thread's route is not supplied by the Backend, and is said so. Plain TypeScript:
// no DOM, no T3 import. The shapes mirror M09's `RouteState` and `UsageReading` (packages/aetheria-contracts/src/providersOperations.ts); the state/reason-class pairs are that contract's table, so a
// pair outside it is refused as a whole and never repaired.
import type { Parsed } from "../jobs/reply";

const ROUTE_STATES = ["available", "out", "unknown"] as const;
export type RouteStateName = (typeof ROUTE_STATES)[number];

const REASON_CLASSES: Record<RouteStateName, readonly string[]> = {
  out: [
    "limit-remembered",
    "sign-in-remembered",
    "extra-usage-refused",
    "no-sign-in",
    "api-key-not-eligible",
    "usage-window-full",
  ],
  available: ["signed-in-window-ok", "signed-in-no-quota-reader"],
  unknown: ["no-signal", "read-late", "read-failed", "service-unavailable", "restarted"],
};

const REASON_TEXT: Record<string, string> = {
  "limit-remembered": "A usage limit was hit and is remembered until it expires.",
  "sign-in-remembered": "A sign-in failure was seen and is remembered until it expires.",
  "extra-usage-refused": "Extra usage was refused for this route.",
  "no-sign-in": "No sign-in is present for this provider.",
  "api-key-not-eligible": "An API key cannot be used for this route.",
  "usage-window-full": "A usage window reports it is full.",
  "signed-in-window-ok": "Signed in, and its usage window has room.",
  "signed-in-no-quota-reader":
    "Signed in, but no quota reader exists for it, so how much quota is left is not measured.",
  "no-signal": "Nothing has been observed about this route.",
  "read-late": "The last read of this route arrived too late to use.",
  "read-failed": "The last read of this route failed.",
  "service-unavailable": "The usage service could not be reached.",
  restarted: "The Backend restarted, so its memory of this route is empty.",
};

const FAILURE_TEXT: Record<string, string> = {
  "no-credential": "no credential for this provider",
  auth: "the provider did not accept the credential",
  timeout: "the read timed out",
  network: "a network error",
  malformed: "the provider's answer was malformed",
  redirect: "the provider redirected the read",
  unsupported: "this provider has no usage reader",
  "reader-threw": "the usage reader failed",
  late: "the read arrived too late",
};

export const MAIN_ROUTE_TEXT = "The main thread's route is not supplied by the Backend.";

export interface BasisValue {
  readonly signal: "memory" | "credential" | "window";
  readonly result: string;
  readonly at: string;
  readonly windowId?: string;
}
export interface RouteStateValue {
  readonly state: RouteStateName;
  readonly reasonClass: string;
  readonly observedAt: string;
  readonly basis: readonly BasisValue[];
  readonly resetsAt?: string;
  readonly memoryEmptySince?: string;
  readonly label?: "fixture";
}
export interface RouteRowValue {
  readonly route: { readonly provider: string; readonly model: string };
  /** The child this route belongs to, when the Backend names one. */
  readonly childLabel?: string;
  readonly state: RouteStateValue;
}
export interface UsageWindowValue {
  readonly id: string;
  readonly usedPercent: number | "unknown";
  readonly resetsAt?: string;
}
export interface UsageReadingValue {
  readonly provider: string;
  readonly observedAt: string;
  readonly fetchedAt: string;
  readonly status: "ok" | "stale" | "unavailable";
  readonly lastGoodAt: string | null;
  readonly ageSeconds?: number;
  readonly failure?: string;
  readonly windows: readonly UsageWindowValue[];
  readonly label?: "fixture";
}
/** What the Backend could not supply, in its own words: a section it could not read (so its list below is not an empty answer) and the children whose route or availability has no state to show. */
export interface UsageNotes {
  readonly readings?: string;
  readonly routes?: string;
  readonly children?: readonly string[];
}
export interface UsageValue {
  readonly routes: readonly RouteRowValue[];
  readonly readings: readonly UsageReadingValue[];
  readonly notes?: UsageNotes;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value !== "";
const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function parseBasis(value: unknown): Parsed<BasisValue> {
  if (!isRecord(value)) return bad("a basis entry is not an object");
  const { signal, result, at, windowId } = value;
  if (signal !== "memory" && signal !== "credential" && signal !== "window") {
    return bad("a basis entry has a signal this view does not know");
  }
  if (!text(result) || !text(at)) return bad("a basis entry has no result or time");
  if (windowId !== undefined && !text(windowId)) return bad("a basis entry has a bad window id");
  return {
    ok: true,
    value: { signal, result, at, ...(windowId === undefined ? {} : { windowId }) },
  };
}

function parseRoute(value: unknown): Parsed<RouteRowValue> {
  if (!isRecord(value) || !isRecord(value.route) || !isRecord(value.state)) {
    return bad("a route row is not a route and a state");
  }
  const { provider, model } = value.route;
  if (!text(provider) || !text(model)) return bad("a route has no provider or model");
  const { state, reasonClass, observedAt, basis } = value.state;
  if (state !== "available" && state !== "out" && state !== "unknown") {
    return bad(`the route ${provider}/${model} has a state this view does not know`);
  }
  if (!text(reasonClass) || !REASON_CLASSES[state].includes(reasonClass)) {
    return bad(
      `the route ${provider}/${model} has a reason class that does not belong to "${state}"`,
    );
  }
  if (!text(observedAt)) return bad(`the route ${provider}/${model} has no observation time`);
  if (!Array.isArray(basis)) return bad(`the route ${provider}/${model} has no basis list`);
  const entries: BasisValue[] = [];
  for (const entry of basis as unknown[]) {
    const parsed = parseBasis(entry);
    if (!parsed.ok) return parsed;
    entries.push(parsed.value);
  }
  const { resetsAt, memoryEmptySince, label } = value.state;
  if (reasonClass === "restarted" && !text(memoryEmptySince)) {
    return bad(
      `the route ${provider}/${model} restarted without saying since when its memory is empty`,
    );
  }
  if (value.childLabel !== undefined && typeof value.childLabel !== "string") {
    return bad("a route's child label is not text");
  }
  return {
    ok: true,
    value: {
      route: { provider, model },
      ...(typeof value.childLabel === "string" ? { childLabel: value.childLabel } : {}),
      state: {
        state,
        reasonClass,
        observedAt,
        basis: entries,
        ...(text(resetsAt) ? { resetsAt } : {}),
        ...(text(memoryEmptySince) ? { memoryEmptySince } : {}),
        ...(label === "fixture" ? { label: "fixture" as const } : {}),
      },
    },
  };
}

function parseWindow(value: unknown): Parsed<UsageWindowValue> {
  if (!isRecord(value) || !text(value.id)) return bad("a usage window has no id");
  const used = value.usedPercent;
  const usable =
    used === "unknown" || (typeof used === "number" && Number.isFinite(used) && used >= 0);
  if (!usable)
    return bad(`the usage window ${value.id} has a percent that is neither a number nor "unknown"`);
  return {
    ok: true,
    value: {
      id: value.id,
      usedPercent: used as number | "unknown",
      ...(text(value.resetsAt) ? { resetsAt: value.resetsAt } : {}),
    },
  };
}

function parseReading(value: unknown): Parsed<UsageReadingValue> {
  if (!isRecord(value) || !text(value.provider)) return bad("a usage reading has no provider");
  const { provider, status, observedAt, fetchedAt, windows } = value;
  if (status !== "ok" && status !== "stale" && status !== "unavailable") {
    return bad(`the usage reading for ${provider} has a status this view does not know`);
  }
  if (!text(observedAt) || !text(fetchedAt))
    return bad(`the usage reading for ${provider} has no time`);
  if (!Array.isArray(windows)) return bad(`the usage reading for ${provider} has no window list`);
  const list: UsageWindowValue[] = [];
  for (const entry of windows as unknown[]) {
    const parsed = parseWindow(entry);
    if (!parsed.ok) return parsed;
    list.push(parsed.value);
  }
  const lastGoodAt = value.lastGoodAt;
  if (lastGoodAt !== null && !text(lastGoodAt))
    return bad(`the usage reading for ${provider} has a bad last-good time`);
  if (status !== "ok" && (typeof value.failure !== "string" || !(value.failure in FAILURE_TEXT))) {
    return bad(`the usage reading for ${provider} has a failure this view does not know`);
  }
  if (
    status === "stale" &&
    (typeof value.ageSeconds !== "number" ||
      !Number.isSafeInteger(value.ageSeconds) ||
      value.ageSeconds < 0 ||
      lastGoodAt === null)
  ) {
    return bad(`the stale reading for ${provider} has no age or last-good time`);
  }
  if (status === "ok" && lastGoodAt === null)
    return bad(`the current reading for ${provider} has no last-good time`);
  return {
    ok: true,
    value: {
      provider,
      observedAt,
      fetchedAt,
      status,
      lastGoodAt,
      ...(typeof value.ageSeconds === "number" ? { ageSeconds: value.ageSeconds } : {}),
      ...(typeof value.failure === "string" ? { failure: value.failure } : {}),
      // An unavailable reading has no windows, whatever else was sent with it.
      windows: status === "unavailable" ? [] : list,
      ...(value.label === "fixture" ? { label: "fixture" as const } : {}),
    },
  };
}

/** Routes and readings in the Backend's order. One entry this view cannot read makes the whole answer unreadable: no entry is dropped quietly. */
export function parseUsage(value: unknown): Parsed<UsageValue> {
  if (!isRecord(value) || !Array.isArray(value.routes) || !Array.isArray(value.readings)) {
    return bad("the Backend's answer was not a usage answer");
  }
  const routes: RouteRowValue[] = [];
  for (const entry of value.routes as unknown[]) {
    const parsed = parseRoute(entry);
    if (!parsed.ok) return parsed;
    routes.push(parsed.value);
  }
  const readings: UsageReadingValue[] = [];
  for (const entry of value.readings as unknown[]) {
    const parsed = parseReading(entry);
    if (!parsed.ok) return parsed;
    readings.push(parsed.value);
  }
  const notes = parseNotes(value.notes);
  if (!notes.ok) return notes;
  return {
    ok: true,
    value: { routes, readings, ...(notes.value === undefined ? {} : { notes: notes.value }) },
  };
}

function parseNotes(value: unknown): Parsed<UsageNotes | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return bad("the notes of a usage answer are not an object");
  const { readings, routes, children } = value;
  if (readings !== undefined && !text(readings)) return bad("a usage note is not text");
  if (routes !== undefined && !text(routes)) return bad("a usage note is not text");
  if (children !== undefined && !(Array.isArray(children) && children.every(text)))
    return bad("a usage note is not text");
  return {
    ok: true,
    value: {
      ...(readings === undefined ? {} : { readings: readings as string }),
      ...(routes === undefined ? {} : { routes: routes as string }),
      ...(children === undefined ? {} : { children: children as string[] }),
    },
  };
}

export interface RouteRowView {
  readonly routeText: string;
  readonly childText: string | null;
  readonly state: RouteStateName;
  readonly stateText: string;
  readonly reasonClass: string;
  readonly reasonText: string;
  readonly observedText: string;
  readonly basisTexts: readonly string[];
  readonly basisNote: string | null;
  readonly resetsText: string | null;
  readonly emptySinceText: string | null;
  readonly fixture: boolean;
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export function routeRowView(row: RouteRowValue): RouteRowView {
  const { state } = row;
  return {
    routeText: `${row.route.provider} / ${row.route.model}`,
    childText: row.childLabel ?? null,
    state: state.state,
    stateText: capitalise(state.state),
    reasonClass: state.reasonClass,
    reasonText: REASON_TEXT[state.reasonClass] ?? state.reasonClass,
    observedText: `Observed ${state.observedAt}`,
    basisTexts: state.basis.map(
      (entry) =>
        `${entry.signal}: ${entry.result} at ${entry.at}${entry.windowId === undefined ? "" : ` (window ${entry.windowId})`}`,
    ),
    basisNote: state.basis.length === 0 ? "No basis was supplied for this state." : null,
    resetsText: state.resetsAt === undefined ? null : `Resets ${state.resetsAt}`,
    emptySinceText:
      state.memoryEmptySince === undefined
        ? null
        : `Its memory has been empty since ${state.memoryEmptySince}`,
    fixture: state.label === "fixture",
  };
}

export interface UsageWindowView {
  readonly id: string;
  readonly text: string;
  readonly resetsText: string | null;
}
export interface UsageReadingView {
  readonly provider: string;
  readonly status: UsageReadingValue["status"];
  readonly statusText: string;
  readonly windows: readonly UsageWindowView[];
  readonly note: string | null;
  readonly fixture: boolean;
}

export function readingView(reading: UsageReadingValue): UsageReadingView {
  const failure =
    reading.failure === undefined ? "" : (FAILURE_TEXT[reading.failure] ?? reading.failure);
  const windows = reading.windows.map((window) => ({
    id: window.id,
    text:
      window.usedPercent === "unknown"
        ? `${window.id}: usage unknown`
        : `${window.id}: ${window.usedPercent}% used`,
    resetsText: window.resetsAt === undefined ? null : `Resets ${window.resetsAt}`,
  }));
  const note =
    reading.status === "unavailable"
      ? `No usage was read: ${failure}.`
      : reading.status === "stale"
        ? `Last good reading ${reading.lastGoodAt} (${reading.ageSeconds} seconds ago); the latest read failed: ${failure}.`
        : windows.length === 0
          ? "This reading carries no usage windows."
          : null;
  return {
    provider: reading.provider,
    status: reading.status,
    statusText: reading.status === "ok" ? "Current" : capitalise(reading.status),
    windows,
    note,
    fixture: reading.label === "fixture",
  };
}
