import { describe, expect, it } from "vite-plus/test";

import { MAIN_ROUTE_TEXT, parseUsage, readingView, routeRowView } from "./model";

const state = (over: Record<string, unknown> = {}) => ({
  state: "available",
  reasonClass: "signed-in-window-ok",
  observedAt: "2026-11-13T10:00:00Z",
  basis: [{ signal: "window", result: "ok", at: "2026-11-13T09:59:00Z", windowId: "5h" }],
  ...over,
});
const route = (over: Record<string, unknown> = {}, stateOver: Record<string, unknown> = {}) => ({
  route: { provider: "anthropic", model: "opus" },
  childLabel: "Researcher",
  state: state(stateOver),
  ...over,
});
const reading = (over: Record<string, unknown> = {}) => ({
  provider: "anthropic",
  observedAt: "2026-11-13T10:00:00Z",
  fetchedAt: "2026-11-13T10:00:00Z",
  status: "ok",
  stale: false,
  lastGoodAt: "2026-11-13T10:00:00Z",
  windows: [{ id: "5h", usedPercent: 42, resetsAt: "2026-11-13T15:00:00Z" }],
  ...over,
});
const parsed = (routes: unknown[], readings: unknown[]) => {
  const result = parseUsage({ routes, readings });
  if (!result.ok) throw new Error(`setup: ${result.reason}`);
  return result.value;
};

describe("the usage answer is read strictly", () => {
  it("routes and readings are kept in the Backend's order", () => {
    const value = parsed(
      [route(), route({ route: { provider: "openai", model: "gpt" } })],
      [reading(), reading({ provider: "openai" })],
    );
    expect(value.routes.map((r) => r.route.provider)).toEqual(["anthropic", "openai"]);
    expect(value.readings.map((r) => r.provider)).toEqual(["anthropic", "openai"]);
  });

  it("an answer with no routes and no readings is empty, not an error", () => {
    expect(parseUsage({ routes: [], readings: [] })).toEqual({
      ok: true,
      value: { routes: [], readings: [] },
    });
  });

  it.each([
    ["no routes array", { readings: [] }],
    ["no readings array", { routes: [] }],
    ["a state outside the three", { routes: [route({}, { state: "busy" })], readings: [] }],
    [
      "a reason class that does not belong to its state",
      { routes: [route({}, { state: "out", reasonClass: "signed-in-window-ok" })], readings: [] },
    ],
    [
      "a restart without since-when",
      { routes: [route({}, { state: "unknown", reasonClass: "restarted" })], readings: [] },
    ],
    [
      "a basis entry with an unknown signal",
      { routes: [route({}, { basis: [{ signal: "vibes", result: "x", at: "t" }] })], readings: [] },
    ],
    ["a route without a model", { routes: [route({ route: { provider: "a" } })], readings: [] }],
    ["a reading with an unknown status", { routes: [], readings: [reading({ status: "fine" })] }],
    [
      "a negative percent",
      { routes: [], readings: [reading({ windows: [{ id: "w", usedPercent: -1 }] })] },
    ],
    [
      "a percent that is not a number or unknown",
      { routes: [], readings: [reading({ windows: [{ id: "w", usedPercent: "0" }] })] },
    ],
    [
      "a non-finite percent",
      { routes: [], readings: [reading({ windows: [{ id: "w", usedPercent: Number.NaN }] })] },
    ],
  ])("%s is unreadable as a whole", (_name, value) => {
    expect(parseUsage(value).ok).toBe(false);
  });
});

describe("a route's availability is said with its reason class and basis", () => {
  it.each([
    ["available", "signed-in-window-ok", "Available", "Signed in, and its usage window has room."],
    [
      "available",
      "signed-in-no-quota-reader",
      "Available",
      "Signed in, but no quota reader exists for it, so how much quota is left is not measured.",
    ],
    ["out", "limit-remembered", "Out", "A usage limit was hit and is remembered until it expires."],
    ["out", "usage-window-full", "Out", "A usage window reports it is full."],
    ["out", "no-sign-in", "Out", "No sign-in is present for this provider."],
    ["unknown", "no-signal", "Unknown", "Nothing has been observed about this route."],
    ["unknown", "read-failed", "Unknown", "The last read of this route failed."],
  ])("%s / %s", (stateName, reasonClass, stateText, reasonText) => {
    const view = routeRowView(
      parsed([route({}, { state: stateName, reasonClass })], []).routes[0]!,
    );
    expect(view.stateText).toBe(stateText);
    expect(view.reasonText).toBe(reasonText);
    expect(view.reasonClass).toBe(reasonClass);
  });

  it("the route, the child it belongs to and each basis entry are shown", () => {
    const view = routeRowView(parsed([route()], []).routes[0]!);
    expect(view.routeText).toBe("anthropic / opus");
    expect(view.childText).toBe("Researcher");
    expect(view.basisTexts).toEqual(["window: ok at 2026-11-13T09:59:00Z (window 5h)"]);
    expect(view.observedText).toBe("Observed 2026-11-13T10:00:00Z");
  });

  it("a route with no basis says no basis was supplied; a restart says since when its memory is empty", () => {
    const bare = routeRowView(parsed([route({}, { basis: [] })], []).routes[0]!);
    expect(bare.basisTexts).toEqual([]);
    expect(bare.basisNote).toBe("No basis was supplied for this state.");
    const restarted = routeRowView(
      parsed(
        [
          route(
            {},
            {
              state: "unknown",
              reasonClass: "restarted",
              memoryEmptySince: "2026-11-13T09:00:00Z",
            },
          ),
        ],
        [],
      ).routes[0]!,
    );
    expect(restarted.emptySinceText).toBe("Its memory has been empty since 2026-11-13T09:00:00Z");
  });

  it("a reset time is shown when supplied, and the fixture label is carried", () => {
    const view = routeRowView(
      parsed(
        [
          route(
            {},
            {
              state: "out",
              reasonClass: "limit-remembered",
              resetsAt: "2026-11-13T15:00:00Z",
              label: "fixture",
            },
          ),
        ],
        [],
      ).routes[0]!,
    );
    expect(view.resetsText).toBe("Resets 2026-11-13T15:00:00Z");
    expect(view.fixture).toBe(true);
  });

  it("the main thread's route is not supplied by the Backend, and is said so", () => {
    expect(MAIN_ROUTE_TEXT).toBe("The main thread's route is not supplied by the Backend.");
  });
});

describe("a usage reading never turns an absent value into zero", () => {
  it("a current reading lists each window's percent as supplied", () => {
    const view = readingView(parsed([], [reading()]).readings[0]!);
    expect(view.statusText).toBe("Current");
    expect(view.windows).toEqual([
      { id: "5h", text: "5h: 42% used", resetsText: "Resets 2026-11-13T15:00:00Z" },
    ]);
  });

  it("a zero that the Backend supplied is shown as 0%, because it is a reading", () => {
    const view = readingView(
      parsed([], [reading({ windows: [{ id: "5h", usedPercent: 0 }] })]).readings[0]!,
    );
    expect(view.windows[0]?.text).toBe("5h: 0% used");
  });

  it('a window whose percent is "unknown" says usage is unknown, not 0%', () => {
    const view = readingView(
      parsed([], [reading({ windows: [{ id: "5h", usedPercent: "unknown" }] })]).readings[0]!,
    );
    expect(view.windows[0]?.text).toBe("5h: usage unknown");
  });

  it("an unavailable reading shows no windows and says why, even if windows were sent", () => {
    const view = readingView(
      parsed(
        [],
        [
          reading({
            status: "unavailable",
            lastGoodAt: null,
            failure: "no-credential",
            windows: [{ id: "5h", usedPercent: 0 }],
          }),
        ],
      ).readings[0]!,
    );
    expect(view.statusText).toBe("Unavailable");
    expect(view.windows).toEqual([]);
    expect(view.note).toBe("No usage was read: no credential for this provider.");
    expect(JSON.stringify(view)).not.toContain("0%");
  });

  it("a stale reading says when the last good one was and why the latest failed", () => {
    const view = readingView(
      parsed([], [reading({ status: "stale", stale: true, ageSeconds: 600, failure: "timeout" })])
        .readings[0]!,
    );
    expect(view.statusText).toBe("Stale");
    expect(view.note).toBe(
      "Last good reading 2026-11-13T10:00:00Z (600 seconds ago); the latest read failed: the read timed out.",
    );
  });

  it("a reading with no windows says it carries none", () => {
    const view = readingView(parsed([], [reading({ windows: [] })]).readings[0]!);
    expect(view.windows).toEqual([]);
    expect(view.note).toBe("This reading carries no usage windows.");
  });
});
