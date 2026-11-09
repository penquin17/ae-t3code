// AETHERIA M09 step 12 — shared vectors for the `research.*` operations, decoded by the fork's strict schemas and by the outer
// package's codecs (tests/tools/research/contracts.test.mjs reads this file by path). `accept` must decode and `refuse` must not,
// in both. Data only, no imports; every value is synthetic. The outcome sets use the value `{ marker: string }`, because the ok payloads
// of search and fetch belong to later steps; the non-ok variants are what this step freezes.

export interface ResearchVector {
  readonly name: string;
  readonly value: unknown;
}

export interface ResearchVectorSet {
  readonly accept: readonly ResearchVector[];
  readonly refuse: readonly ResearchVector[];
}

const id = "req_0123456789abcdef";

export const researchVectors: Readonly<Record<string, ResearchVectorSet>> = {
  searchArgs: {
    accept: [
      {
        name: "query, limit and request id",
        value: { query: "effect schema", limit: 5, requestId: id },
      },
      { name: "limit at the cap of eight", value: { query: "q", limit: 8, requestId: id } },
      {
        name: "request id of sixty-four characters",
        value: { query: "q", limit: 1, requestId: "a".repeat(64) },
      },
    ],
    refuse: [
      { name: "request id missing", value: { query: "q", limit: 5 } },
      { name: "limit missing", value: { query: "q", requestId: id } },
      { name: "empty query", value: { query: "", limit: 5, requestId: id } },
      {
        name: "query over two thousand characters",
        value: { query: "q".repeat(2001), limit: 5, requestId: id },
      },
      { name: "limit zero", value: { query: "q", limit: 0, requestId: id } },
      { name: "limit nine", value: { query: "q", limit: 9, requestId: id } },
      { name: "limit not an integer", value: { query: "q", limit: 2.5, requestId: id } },
      { name: "request id too short", value: { query: "q", limit: 5, requestId: "short" } },
      {
        name: "request id with a space",
        value: { query: "q", limit: 5, requestId: "req 0123456789abcdef" },
      },
      {
        name: "request id over sixty-four characters",
        value: { query: "q", limit: 5, requestId: "a".repeat(65) },
      },
      {
        name: "session id smuggled in",
        value: { query: "q", limit: 5, requestId: id, sessionId: "s1" },
      },
      {
        name: "poll token smuggled in",
        value: { query: "q", limit: 5, requestId: id, token: "t" },
      },
      { name: "not an object", value: "q" },
    ],
  },
  fetchArgs: {
    accept: [
      { name: "url and request id", value: { url: "https://example.com/a?b=c", requestId: id } },
      {
        name: "url of 2048 characters",
        value: { url: `https://e.com/${"a".repeat(2034)}`, requestId: id },
      },
    ],
    refuse: [
      { name: "request id missing", value: { url: "https://example.com" } },
      { name: "url missing", value: { requestId: id } },
      { name: "empty url", value: { url: "", requestId: id } },
      {
        name: "url over 2048 characters",
        value: { url: `https://e.com/${"a".repeat(2035)}`, requestId: id },
      },
      { name: "url not a string", value: { url: 7, requestId: id } },
      {
        name: "session id smuggled in",
        value: { url: "https://example.com", requestId: id, sessionId: "s1" },
      },
      {
        name: "limit is a search field",
        value: { url: "https://example.com", requestId: id, limit: 3 },
      },
    ],
  },
  cancelArgs: {
    accept: [{ name: "request id only", value: { requestId: id } }],
    refuse: [
      { name: "request id missing", value: {} },
      { name: "request id malformed", value: { requestId: "no" } },
      { name: "session id smuggled in", value: { requestId: id, sessionId: "s1" } },
      { name: "query smuggled in", value: { requestId: id, query: "q" } },
      { name: "not an object", value: null },
    ],
  },
  researchOutcome: {
    accept: [
      { name: "ok with a value", value: { kind: "ok", value: { marker: "m" } } },
      { name: "refused with a code", value: { kind: "refused", code: "WEB_BLOCKED_URL" } },
      {
        name: "refused duplicate request",
        value: { kind: "refused", code: "WEB_DUPLICATE_REQUEST" },
      },
      { name: "failed with a class", value: { kind: "failed", class: "WEB_PROVIDER_ERROR" } },
      { name: "failed by timeout", value: { kind: "failed", class: "WEB_FETCH_TIMEOUT" } },
      { name: "aborted", value: { kind: "aborted", code: "WEB_ABORTED" } },
      {
        name: "unavailable with a reason",
        value: { kind: "unavailable", code: "WEB_UNAVAILABLE", reason: "XC6_NO_CARRIER" },
      },
    ],
    refuse: [
      { name: "ok without a value", value: { kind: "ok" } },
      {
        name: "ok with a code",
        value: { kind: "ok", value: { marker: "m" }, code: "WEB_BLOCKED_URL" },
      },
      { name: "ok with an invalid value", value: { kind: "ok", value: { marker: 3 } } },
      { name: "refused without a code", value: { kind: "refused" } },
      { name: "refused with an unknown code", value: { kind: "refused", code: "WEB_MADE_UP" } },
      { name: "refused with the aborted code", value: { kind: "refused", code: "WEB_ABORTED" } },
      { name: "failed without a class", value: { kind: "failed" } },
      {
        name: "failed with the unavailable code",
        value: { kind: "failed", class: "WEB_UNAVAILABLE" },
      },
      { name: "aborted with another code", value: { kind: "aborted", code: "WEB_BLOCKED_URL" } },
      { name: "aborted without a code", value: { kind: "aborted" } },
      {
        name: "unavailable without a reason",
        value: { kind: "unavailable", code: "WEB_UNAVAILABLE" },
      },
      {
        name: "unavailable with an empty reason",
        value: { kind: "unavailable", code: "WEB_UNAVAILABLE", reason: "" },
      },
      { name: "unknown kind", value: { kind: "empty" } },
      { name: "a bare success without a kind", value: { marker: "m" } },
      {
        name: "a request id leaked into an outcome",
        value: { kind: "aborted", code: "WEB_ABORTED", requestId: id },
      },
    ],
  },
  cancelResult: {
    accept: [{ name: "accepted", value: { kind: "ok", value: { accepted: true } } }],
    refuse: [
      { name: "accepted false", value: { kind: "ok", value: { accepted: false } } },
      {
        name: "accepted with a detail of the work",
        value: { kind: "ok", value: { accepted: true, found: true } },
      },
      { name: "bare accepted", value: { accepted: true } },
    ],
  },
};
