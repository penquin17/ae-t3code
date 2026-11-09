// AETHERIA M09 step 2 — shared vectors for the four `providers.*` operations, decoded by the fork's strict schemas and by the
// outer package's codecs (tests/providers/contracts.test.mjs reads this file by path). `accept` must decode and `refuse` must not,
// in both. Data only, no imports; every value is synthetic.

export interface ProvidersVector {
  readonly name: string;
  readonly value: unknown;
}

export interface ProvidersVectorSet {
  readonly accept: readonly ProvidersVector[];
  readonly refuse: readonly ProvidersVector[];
}

const T0 = "2026-11-09T10:00:00.000Z";
const T1 = "2026-11-09T11:00:00.000Z";
const route = { provider: "anthropic", model: "claude-sonnet-x" };

export const providersVectors: Readonly<Record<string, ProvidersVectorSet>> = {
  routeStatesArgs: {
    accept: [
      { name: "one route, launch", value: { routes: [route], purpose: "launch" } },
      {
        name: "two routes, display",
        value: {
          routes: [route, { provider: "openai-codex", model: "gpt-x" }],
          purpose: "display",
        },
      },
      { name: "no routes, switch", value: { routes: [], purpose: "switch" } },
    ],
    refuse: [
      { name: "unknown purpose", value: { routes: [route], purpose: "fallback" } },
      { name: "purpose missing", value: { routes: [route] } },
      { name: "routes missing", value: { purpose: "launch" } },
      { name: "routes not a list", value: { routes: route, purpose: "launch" } },
      {
        name: "caller field smuggled in",
        value: { routes: [route], purpose: "launch", sessionId: "s1" },
      },
      {
        name: "route with an extra field",
        value: { routes: [{ ...route, effort: "high" }], purpose: "launch" },
      },
      {
        name: "empty provider",
        value: { routes: [{ provider: "", model: "m" }], purpose: "launch" },
      },
      {
        name: "non-string model",
        value: { routes: [{ provider: "p", model: 7 }], purpose: "launch" },
      },
      { name: "not an object", value: "launch" },
    ],
  },
  routeStatesResult: {
    accept: [
      {
        name: "available with a fresh window",
        value: {
          states: [
            {
              state: "available",
              reasonClass: "signed-in-window-ok",
              observedAt: T0,
              basis: [
                { signal: "credential", result: "oauth", at: T0 },
                { signal: "window", result: "below-full", at: T0, windowId: "five-hour" },
              ],
            },
          ],
        },
      },
      {
        name: "out by remembered limit with a reset",
        value: {
          states: [
            {
              state: "out",
              reasonClass: "limit-remembered",
              observedAt: T0,
              basis: [{ signal: "memory", result: "live-failure", at: T0 }],
              resetsAt: T1,
              memoryEmptySince: T0,
            },
          ],
        },
      },
      {
        name: "out by a full window names it",
        value: {
          states: [
            {
              state: "out",
              reasonClass: "usage-window-full",
              observedAt: T0,
              basis: [{ signal: "window", result: "full", at: T0, windowId: "five-hour" }],
              resetsAt: T1,
            },
          ],
        },
      },
      {
        name: "out because an API key is not eligible",
        value: {
          states: [
            {
              state: "out",
              reasonClass: "api-key-not-eligible",
              observedAt: T0,
              basis: [{ signal: "credential", result: "api-key", at: T0 }],
            },
          ],
        },
      },
      {
        name: "unknown after a restart says since when",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "restarted",
              observedAt: T0,
              basis: [],
              memoryEmptySince: T0,
            },
          ],
        },
      },
      {
        name: "unknown, read late",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "read-late",
              observedAt: T0,
              basis: [{ signal: "window", result: "late", at: T0 }],
            },
          ],
        },
      },
      { name: "an empty answer for no routes", value: { states: [] } },
      {
        name: "a fixture state carries its label",
        value: {
          states: [
            {
              state: "available",
              reasonClass: "signed-in-window-ok",
              observedAt: T0,
              basis: [],
              label: "fixture",
            },
          ],
        },
      },
      {
        name: "a fixture restarted state carries its label",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "restarted",
              observedAt: T0,
              basis: [],
              memoryEmptySince: T0,
              label: "fixture",
            },
          ],
        },
      },
    ],
    refuse: [
      {
        name: "a label other than fixture",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "no-signal",
              observedAt: T0,
              basis: [],
              label: "live",
            },
          ],
        },
      },
      {
        name: "available with an out reason",
        value: {
          states: [
            { state: "available", reasonClass: "usage-window-full", observedAt: T0, basis: [] },
          ],
        },
      },
      {
        name: "out with an unknown reason",
        value: { states: [{ state: "out", reasonClass: "read-late", observedAt: T0, basis: [] }] },
      },
      {
        name: "restarted without memoryEmptySince",
        value: {
          states: [{ state: "unknown", reasonClass: "restarted", observedAt: T0, basis: [] }],
        },
      },
      {
        name: "a fourth state",
        value: {
          states: [{ state: "maybe", reasonClass: "no-signal", observedAt: T0, basis: [] }],
        },
      },
      {
        name: "basis signal outside the three",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "no-signal",
              observedAt: T0,
              basis: [{ signal: "header", result: "x", at: T0 }],
            },
          ],
        },
      },
      {
        name: "time not ISO",
        value: {
          states: [
            { state: "unknown", reasonClass: "no-signal", observedAt: "yesterday", basis: [] },
          ],
        },
      },
      {
        name: "a token field",
        value: {
          states: [
            { state: "unknown", reasonClass: "no-signal", observedAt: T0, basis: [], token: "x" },
          ],
        },
      },
      {
        name: "an account field in a basis entry",
        value: {
          states: [
            {
              state: "unknown",
              reasonClass: "no-signal",
              observedAt: T0,
              basis: [{ signal: "credential", result: "oauth", at: T0, accountId: "a" }],
            },
          ],
        },
      },
      { name: "result wrapper has an extra key", value: { states: [], authorization: "Bearer x" } },
      { name: "states not a list", value: { states: "none" } },
    ],
  },
  reportFailureArgs: {
    accept: [
      { name: "message only", value: { route, failure: { message: "rate limited" } } },
      {
        name: "code, status and message",
        value: { route, failure: { code: "QUOTA", status: 429, message: "x" } },
      },
      { name: "an empty failure", value: { route, failure: {} } },
    ],
    refuse: [
      { name: "failure missing", value: { route } },
      { name: "route missing", value: { failure: {} } },
      {
        name: "failure with a header field",
        value: { route, failure: { message: "x", headers: {} } },
      },
      { name: "status not an integer", value: { route, failure: { status: "429" } } },
      { name: "extra top-level key", value: { route, failure: {}, sessionId: "s" } },
    ],
  },
  failureReport: {
    accept: [
      {
        name: "a limit with reset and wait hint",
        value: {
          class: "limit",
          remembered: true,
          rememberedUntil: T1,
          resetsAt: T1,
          waitHintMinutes: 5,
        },
      },
      {
        name: "a limit with no reset",
        value: { class: "limit", remembered: true, rememberedUntil: T1 },
      },
      {
        name: "an extra-usage refusal",
        value: {
          class: "limit",
          remembered: true,
          rememberedUntil: T1,
          reason: "extra-usage-refused",
        },
      },
      {
        name: "a sign-in failure",
        value: { class: "sign-in", remembered: true, rememberedUntil: T1 },
      },
      { name: "a struggling provider", value: { class: "struggling", remembered: false } },
      { name: "an unclassified failure", value: { class: "other", remembered: false } },
      {
        name: "a fixture limit carries its label",
        value: { class: "limit", remembered: true, rememberedUntil: T1, label: "fixture" },
      },
      {
        name: "a fixture non-remembered report carries its label",
        value: { class: "other", remembered: false, label: "fixture" },
      },
    ],
    refuse: [
      {
        name: "a label other than fixture",
        value: { class: "other", remembered: false, label: "production" },
      },
      {
        name: "other but remembered",
        value: { class: "other", remembered: true, rememberedUntil: T1 },
      },
      { name: "a limit that is not remembered", value: { class: "limit", remembered: false } },
      { name: "a limit with no expiry", value: { class: "limit", remembered: true } },
      {
        name: "not remembered but with an expiry",
        value: { class: "other", remembered: false, rememberedUntil: T1 },
      },
      {
        name: "a wait hint on a sign-in",
        value: { class: "sign-in", remembered: true, rememberedUntil: T1, waitHintMinutes: 3 },
      },
      {
        name: "a reason on a sign-in",
        value: {
          class: "sign-in",
          remembered: true,
          rememberedUntil: T1,
          reason: "extra-usage-refused",
        },
      },
      {
        name: "an unknown reason",
        value: { class: "limit", remembered: true, rememberedUntil: T1, reason: "billing" },
      },
      {
        name: "a negative wait hint",
        value: { class: "limit", remembered: true, rememberedUntil: T1, waitHintMinutes: -1 },
      },
      {
        name: "a fractional wait hint",
        value: { class: "limit", remembered: true, rememberedUntil: T1, waitHintMinutes: 1.5 },
      },
      { name: "class missing", value: { remembered: false } },
      { name: "remembered missing", value: { class: "other" } },
      {
        name: "a fifth class",
        value: { class: "extra-usage", remembered: true, rememberedUntil: T1 },
      },
      { name: "an extra field", value: { class: "other", remembered: false, message: "raw text" } },
    ],
  },
  routeCapabilitiesArgs: {
    accept: [{ name: "a route", value: { route } }],
    refuse: [
      { name: "route missing", value: {} },
      { name: "extra key", value: { route, effort: "high" } },
      { name: "route with extra key", value: { route: { ...route, extra: 1 } } },
    ],
  },
  routeCapabilities: {
    accept: [
      {
        name: "a catalog entry with efforts and images",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "known", supported: ["low", "high"], default: "low" },
          source: "catalog",
        },
      },
      {
        name: "a catalog entry with no listed default",
        value: {
          route,
          observedAt: T0,
          images: "no",
          efforts: { state: "known", supported: [], default: null },
          source: "catalog",
        },
      },
      {
        name: "a catalog entry that lists no modalities or efforts",
        value: {
          route,
          observedAt: T0,
          images: "unknown",
          efforts: { state: "unknown" },
          source: "catalog",
        },
      },
      {
        name: "no catalog entry",
        value: {
          route,
          observedAt: T0,
          images: "unknown",
          efforts: { state: "unknown" },
          source: "none",
        },
      },
      {
        name: "a fixture capability carries its label",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "unknown" },
          source: "catalog",
          label: "fixture",
        },
      },
    ],
    refuse: [
      {
        name: "a label other than fixture",
        value: {
          route,
          observedAt: T0,
          images: "unknown",
          efforts: { state: "unknown" },
          source: "none",
          label: "real",
        },
      },
      {
        name: "no catalog but images claimed",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "unknown" },
          source: "none",
        },
      },
      {
        name: "no catalog but efforts claimed",
        value: {
          route,
          observedAt: T0,
          images: "unknown",
          efforts: { state: "known", supported: ["low"], default: null },
          source: "none",
        },
      },
      {
        name: "known efforts without a list",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "known" },
          source: "catalog",
        },
      },
      {
        name: "unknown efforts that carry a list",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "unknown", supported: ["low"] },
          source: "catalog",
        },
      },
      {
        name: "images outside yes/no/unknown",
        value: {
          route,
          observedAt: T0,
          images: true,
          efforts: { state: "unknown" },
          source: "catalog",
        },
      },
      {
        name: "a credential field",
        value: {
          route,
          observedAt: T0,
          images: "yes",
          efforts: { state: "unknown" },
          source: "catalog",
          apiKey: "x",
        },
      },
      {
        name: "source missing",
        value: { route, observedAt: T0, images: "yes", efforts: { state: "unknown" } },
      },
    ],
  },
  usageArgs: {
    accept: [
      { name: "all providers", value: {} },
      { name: "one provider", value: { provider: "openai-codex" } },
    ],
    refuse: [
      { name: "empty provider", value: { provider: "" } },
      { name: "extra key", value: { provider: "p", refresh: true } },
      { name: "provider not a string", value: { provider: 3 } },
    ],
  },
  usageResult: {
    accept: [
      {
        name: "a fresh reading with a known and an unknown window",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [
                { id: "five-hour", usedPercent: 40, resetsAt: T1 },
                { id: "seven-day", usedPercent: "unknown" },
              ],
            },
          ],
        },
      },
      {
        name: "a fixture reading carries its label",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [],
              label: "fixture",
            },
          ],
        },
      },
      {
        name: "a real zero is a number",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [{ id: "five-hour", usedPercent: 0 }],
            },
          ],
        },
      },
      {
        name: "a stale reading is labelled with age and failure",
        value: {
          readings: [
            {
              provider: "openai-codex",
              status: "stale",
              observedAt: T1,
              fetchedAt: T1,
              stale: true,
              lastGoodAt: T0,
              ageSeconds: 3600,
              failure: "timeout",
              windows: [{ id: "provider:5-hour", usedPercent: 100, resetsAt: T1 }],
            },
          ],
        },
      },
      {
        name: "an unavailable reading is empty, not zero",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "unavailable",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: null,
              failure: "no-credential",
              windows: [],
            },
          ],
        },
      },
    ],
    refuse: [
      {
        name: "a label other than fixture",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [],
              label: "production",
            },
          ],
        },
      },
      {
        name: "unavailable carrying windows",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "unavailable",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: null,
              failure: "timeout",
              windows: [{ id: "five-hour", usedPercent: 0 }],
            },
          ],
        },
      },
      {
        name: "unavailable with no failure class",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "unavailable",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: null,
              windows: [],
            },
          ],
        },
      },
      {
        name: "stale without a failure",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "stale",
              observedAt: T0,
              fetchedAt: T0,
              stale: true,
              lastGoodAt: T0,
              ageSeconds: 5,
              windows: [],
            },
          ],
        },
      },
      {
        name: "stale without lastGoodAt",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "stale",
              observedAt: T0,
              fetchedAt: T0,
              stale: true,
              lastGoodAt: null,
              ageSeconds: 5,
              failure: "network",
              windows: [],
            },
          ],
        },
      },
      {
        name: "ok with a failure",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              failure: "network",
              windows: [],
            },
          ],
        },
      },
      {
        name: "ok but marked stale",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: true,
              lastGoodAt: T0,
              windows: [],
            },
          ],
        },
      },
      {
        name: "a negative percent",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [{ id: "five-hour", usedPercent: -1 }],
            },
          ],
        },
      },
      {
        name: "a percent that is a word other than unknown",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [{ id: "five-hour", usedPercent: "zero" }],
            },
          ],
        },
      },
      {
        name: "an account field",
        value: {
          readings: [
            {
              provider: "openai-codex",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              accountId: "acct",
              windows: [],
            },
          ],
        },
      },
      {
        name: "a header field on a window",
        value: {
          readings: [
            {
              provider: "anthropic",
              status: "ok",
              observedAt: T0,
              fetchedAt: T0,
              stale: false,
              lastGoodAt: T0,
              windows: [{ id: "w", usedPercent: 1, header: "x" }],
            },
          ],
        },
      },
    ],
  },
};
