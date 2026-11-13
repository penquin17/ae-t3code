// AETHERIA M10 Plan step 18 (D14, D20, XC-11; IP-54 to IP-56) — the strict contract of `aetheria.usage.read`: the providers' usage readings and the route availability of one root's children.
// The payload names a root thread only. The reply keeps three answers apart wherever a value can be missing: a reading or state that was read, one the Backend could not read, and a route
// the Backend does not supply. A failed or missing reading is `unavailable`, never a window at 0 percent; the main thread's own route is "not supplied", never guessed.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ClientUsageReadPayload,
  ClientUsageReadResult,
  USAGE_CODE_CLASSES,
  USAGE_MAIN_ROUTE_TEXT,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];

const AT = "2026-11-14T10:00:00Z";
const OK = {
  provider: "anthropic",
  observedAt: AT,
  fetchedAt: AT,
  status: "ok",
  stale: false,
  lastGoodAt: AT,
  windows: [{ id: "5h", usedPercent: 42.5, resetsAt: AT }],
} as const;
const UNAVAILABLE = {
  provider: "openai-codex",
  observedAt: AT,
  fetchedAt: AT,
  status: "unavailable",
  stale: false,
  lastGoodAt: null,
  failure: "timeout",
  windows: [],
} as const;
const STATE = {
  state: "available",
  reasonClass: "signed-in-window-ok",
  observedAt: AT,
  basis: [{ signal: "credential", result: "signed-in", at: AT }],
} as const;
const value = (over: object = {}) => ({
  rootThreadId: "thread-root",
  usage: { status: "read", readings: [OK, UNAVAILABLE] },
  main: { threadId: "thread-root", route: { status: "not-supplied" } },
  children: {
    status: "listed",
    rows: [
      {
        childThreadId: "thread-child",
        route: { status: "known", index: 1, provider: "anthropic", model: "claude-x" },
        availability: { status: "read", state: STATE },
      },
    ],
  },
  ...over,
});

describe("the usage payload", () => {
  it("names a root thread only: no actor, scope, session, provider filter or route", () => {
    expect(decode(ClientUsageReadPayload)({ rootThreadId: "thread-1" })).toEqual({
      rootThreadId: "thread-1",
    });
    expect(() => decode(ClientUsageReadPayload)({})).toThrow();
    expect(() => decode(ClientUsageReadPayload)({ rootThreadId: "" })).toThrow();
    for (const extra of [
      { caller: { user: true } },
      { actor: { clientSessionId: "x" } },
      { scope: "orchestration:read" },
      { sessionId: "s" },
      { provider: "anthropic" },
      { routes: [] },
    ])
      expect(() => decode(ClientUsageReadPayload)({ rootThreadId: "t", ...extra })).toThrow();
  });
});

describe("the usage reply", () => {
  const result = decode(ClientUsageReadResult);

  it("carries the providers' readings as M09 supplies them, a failed one as unavailable with no windows", () => {
    expect(result({ ok: true, value: value() })).toBeDefined();
    // A stale reading keeps its age and its last good time.
    expect(
      result({
        ok: true,
        value: value({
          usage: {
            status: "read",
            readings: [
              {
                ...OK,
                status: "stale",
                stale: true,
                ageSeconds: 900,
                failure: "network",
              },
            ],
          },
        }),
      }),
    ).toBeDefined();
    // No reading is not a zero: an unavailable reading that names a window, or a window with a missing percent, is not a value.
    expect(() =>
      result({
        ok: true,
        value: value({
          usage: {
            status: "read",
            readings: [{ ...UNAVAILABLE, windows: [{ id: "5h", usedPercent: 0 }] }],
          },
        }),
      }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: value({
          usage: { status: "read", readings: [{ ...OK, windows: [{ id: "5h" }] }] },
        }),
      }),
    ).toThrow();
    expect(
      result({
        ok: true,
        value: value({
          usage: {
            status: "read",
            readings: [{ ...OK, windows: [{ id: "5h", usedPercent: "unknown" }] }],
          },
        }),
      }),
    ).toBeDefined();
  });

  it("says a reading the Backend could not make is unavailable with a reason, never an empty or zero reading", () => {
    expect(
      result({
        ok: true,
        value: value({
          usage: { status: "unavailable", detail: "the providers service is not running" },
        }),
      }),
    ).toBeDefined();
    expect(() =>
      result({ ok: true, value: value({ usage: { status: "unavailable" } }) }),
    ).toThrow();
    expect(() =>
      result({ ok: true, value: value({ usage: { status: "unavailable", readings: [] } }) }),
    ).toThrow();
  });

  it("keeps the main thread's own route as not supplied, with the Backend's wording", () => {
    expect(USAGE_MAIN_ROUTE_TEXT).toBe("not supplied by the Backend");
    expect(() =>
      result({
        ok: true,
        value: value({
          main: {
            threadId: "thread-root",
            route: { status: "known", index: 1, provider: "a", model: "b" },
          },
        }),
      }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: value({ main: { threadId: "thread-root", route: { status: "available" } } }),
      }),
    ).toThrow();
  });

  it("gives each child a route that is known, none or unknown, and an availability only for a known route", () => {
    const child = (over: object) => ({ childThreadId: "c1", ...over });
    const listed = (rows: object[]) => value({ children: { status: "listed", rows } });
    expect(
      result({
        ok: true,
        value: listed([
          child({ route: { status: "none" } }),
          child({ route: { status: "unknown", detail: "the route state cannot be read" } }),
          child({
            route: { status: "known", index: 2, provider: "a", model: "b", effort: "high" },
            availability: { status: "unavailable", detail: "the providers service is not running" },
          }),
          child({
            route: { status: "known", index: 1, provider: "a", model: "b" },
            availability: {
              status: "read",
              state: {
                state: "out",
                reasonClass: "limit-remembered",
                observedAt: AT,
                basis: [],
                resetsAt: AT,
              },
            },
          }),
        ]),
      }),
    ).toBeDefined();
    // A route the Backend gave no answer for has no state; a state with a reason class outside M09's table is not a value.
    expect(() =>
      result({
        ok: true,
        value: listed([
          child({ route: { status: "none" }, availability: { status: "read", state: STATE } }),
        ]),
      }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: listed([
          child({
            route: { status: "known", index: 1, provider: "a", model: "b" },
            availability: {
              status: "read",
              state: { ...STATE, state: "out", reasonClass: "signed-in-window-ok" },
            },
          }),
        ]),
      }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: listed([child({ route: { status: "known", index: 0, provider: "a", model: "b" } })]),
      }),
    ).toThrow();
    expect(() =>
      result({ ok: true, value: listed([child({ route: { status: "none" }, sessionId: "s" })]) }),
    ).toThrow();
  });

  it("says the children could not be listed instead of showing none", () => {
    expect(
      result({
        ok: true,
        value: value({
          children: { status: "unavailable", detail: "the children service is not running" },
        }),
      }),
    ).toBeDefined();
    expect(() =>
      result({ ok: true, value: value({ children: { status: "unavailable" } }) }),
    ).toThrow();
  });

  it("classes the Backend's codes and accepts only those as refusals; a read has no unknown outcome", () => {
    expect(USAGE_CODE_CLASSES).toEqual({
      USAGE_NOT_AUTHORIZED: "refusal",
      USAGE_DEVICE_REVOKED: "refusal",
      USAGE_NOT_FOUND: "absence",
      USAGE_UNAVAILABLE: "failure",
    });
    for (const code of Object.keys(USAGE_CODE_CLASSES))
      expect(result({ ok: false, code, detail: "why" })).toBeDefined();
    expect(() => result({ ok: false, code: "USAGE_OUTCOME_UNKNOWN" })).toThrow();
    expect(() => result({ ok: false, code: "JOBS_UNAVAILABLE" })).toThrow();
  });
});
