// AETHERIA M11 Plan step 6: shared vectors for the read-only inspection shapes, decoded by the fork's strict schemas and the outer codecs of @aetheria/inspect;
// `accept` decodes unchanged, `refuse` fails. Data only, synthetic; each set's key names its codec. No argument names a caller, session, root, thread, actor or
// composition: identity is the bearer's. Every canary below is a made-up string, never a real credential.

export interface InspectVector {
  readonly name: string;
  readonly value: unknown;
}

export interface InspectVectorSet {
  readonly accept: readonly InspectVector[];
  readonly refuse: readonly InspectVector[];
}

/** Keys no inspect argument may carry, whatever the operation. The outer package holds the same list; a test compares them. */
export const inspectForbiddenArgumentKeys: readonly string[] = [
  "caller",
  "callerId",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "threadId",
  "actor",
  "identity",
  "authority",
  "principal",
  "userId",
  "deviceId",
  "composition",
  "compositionId",
  "root",
  "projectRoot",
  "workingFolder",
  "cwd",
];

const at = "2026-11-15T12:00:00.000Z";
const client = "client_0123456789abcdef";
const client2 = "client_fedcba9876543210";

const entry = {
  providerId: "config",
  targetId: "deliverables",
  kind: "config",
  host: "backend",
  state: "active",
  summary: "two fields",
};
const entry2 = { ...entry, targetId: "groups", state: "inactive", summary: "no fields" };

const shapeFields = [
  { name: "showValues", type: "string-list", required: false, secret: false },
  { name: "token", type: "string", required: true, secret: true },
];
const okQuery = {
  outcome: "ok",
  capturedAt: at,
  providerId: "config",
  targetId: "inspect-backend",
  state: "active",
  shape: shapeFields,
  values: { showValues: ["deliverables.mode"] },
  omitted: [{ path: "token", reason: "secret" }],
};
const okList = {
  outcome: "ok",
  capturedAt: at,
  entries: [entry, entry2],
  offset: 0,
  limit: 100,
  total: 2,
  nextOffset: null,
};
const truncation = { capBytes: 4096, missing: { entries: 3, bytes: 900 } };

const inspectListArgs: InspectVectorSet = {
  accept: [
    { name: "empty request", value: {} },
    { name: "one provider", value: { providerId: "config" } },
    {
      name: "every field",
      value: { providerId: "modules", host: "backend", kind: "module", offset: 0, limit: 100 },
    },
    { name: "last page of one", value: { offset: 100, limit: 1 } },
  ],
  refuse: [
    { name: "not an object", value: "list" },
    { name: "null", value: null },
    { name: "an array", value: [] },
    { name: "a session claim", value: { sessionId: "s1" } },
    { name: "a thread claim", value: { threadId: "t1" } },
    { name: "a composition claim", value: { composition: "builder" } },
    { name: "an unknown key", value: { foo: 1 } },
    { name: "negative offset", value: { offset: -1 } },
    { name: "fractional offset", value: { offset: 1.5 } },
    { name: "zero limit", value: { limit: 0 } },
    { name: "limit over the page bound", value: { limit: 101 } },
    { name: "unknown host", value: { host: "browser" } },
    { name: "upper-case kind", value: { kind: "Module" } },
    { name: "provider id with a space", value: { providerId: "agent tools" } },
  ],
};

const inspectQueryArgs: InspectVectorSet = {
  accept: [
    { name: "one target", value: { providerId: "config", targetId: "deliverables" } },
    {
      name: "a field path selector",
      value: {
        providerId: "backend-services",
        targetId: "orchestration.launchThread",
        selector: "shape.fields",
      },
    },
    {
      name: "an indexed selector",
      value: { providerId: "agent-tools", targetId: "bash", selector: "parameters.properties[2]" },
    },
    {
      name: "an explicit client",
      value: { providerId: "client-regions", targetId: "conversation.running", clientId: client },
    },
  ],
  refuse: [
    { name: "not an object", value: 3 },
    { name: "missing target", value: { providerId: "config" } },
    { name: "missing provider", value: { targetId: "deliverables" } },
    { name: "empty target", value: { providerId: "config", targetId: "" } },
    { name: "a thread claim", value: { providerId: "config", targetId: "x", threadId: "t1" } },
    { name: "an actor claim", value: { providerId: "config", targetId: "x", actor: "root" } },
    {
      name: "a call-shaped selector",
      value: { providerId: "config", targetId: "x", selector: "start(1)" },
    },
    {
      name: "an assignment selector",
      value: { providerId: "config", targetId: "x", selector: "a=1" },
    },
    {
      name: "a verb selector",
      value: { providerId: "config", targetId: "x", selector: "delete fields" },
    },
    {
      name: "an over-long selector",
      value: { providerId: "config", targetId: "x", selector: `a${"b".repeat(300)}` },
    },
    {
      name: "a short client id",
      value: { providerId: "client-regions", targetId: "x", clientId: "c1" },
    },
  ],
};

const inspectListResult: InspectVectorSet = {
  accept: [
    { name: "a full page", value: okList },
    {
      name: "an empty end page",
      value: { ...okList, entries: [], offset: 200, limit: 100, total: 150, nextOffset: null },
    },
    {
      name: "a truncated page with its next offset",
      value: {
        ...okList,
        outcome: "truncated",
        entries: [entry],
        total: 5,
        nextOffset: 1,
        truncation,
      },
    },
    { name: "no client", value: { outcome: "no-client", capturedAt: at } },
    { name: "forbidden", value: { outcome: "forbidden", capturedAt: at } },
    { name: "unavailable", value: { outcome: "unavailable", capturedAt: at } },
  ],
  refuse: [
    { name: "ok without entries", value: { outcome: "ok", capturedAt: at } },
    {
      name: "no-client carrying entries",
      value: { outcome: "no-client", capturedAt: at, entries: [entry] },
    },
    {
      name: "timeout carrying a payload",
      value: { outcome: "timeout", capturedAt: at, shape: {} },
    },
    { name: "pending is not an outcome", value: { outcome: "pending", capturedAt: at } },
    { name: "an unknown state", value: { ...okList, entries: [{ ...entry, state: "paused" }] } },
    { name: "an entry with a handle", value: { ...okList, entries: [{ ...entry, handle: "h" }] } },
    {
      name: "an entry with a callable-looking value",
      value: { ...okList, entries: [{ ...entry, summary: 1 }] },
    },
    {
      name: "more entries than the limit",
      value: { ...okList, limit: 1, total: 2, nextOffset: 1 },
    },
    {
      name: "truncated without its truncation",
      value: { ...okList, outcome: "truncated", nextOffset: 1 },
    },
    { name: "ok carrying a truncation", value: { ...okList, truncation } },
    { name: "a bad capture time", value: { ...okList, capturedAt: "yesterday" } },
    { name: "a negative total", value: { ...okList, total: -1 } },
  ],
};

const inspectQueryResult: InspectVectorSet = {
  accept: [
    { name: "an exact config shape with an omission", value: okQuery },
    {
      name: "a truncated shape with its truncation",
      value: { ...okQuery, outcome: "truncated", shape: [shapeFields[0]], truncation },
    },
    {
      name: "a client reply",
      value: {
        ...okQuery,
        providerId: "client-regions",
        targetId: "conversation.running",
        clientId: client,
        selector: "props",
        shape: [],
        values: {},
        omitted: [],
      },
    },
    {
      name: "no client",
      value: {
        outcome: "no-client",
        capturedAt: at,
        providerId: "client-regions",
        targetId: "conversation.running",
      },
    },
    {
      name: "ambiguous with ids and last-seen times only",
      value: {
        outcome: "ambiguous",
        capturedAt: at,
        providerId: "client-regions",
        targetId: "conversation.running",
        clients: [
          { clientId: client, lastSeen: at },
          { clientId: client2, lastSeen: at },
        ],
      },
    },
    {
      name: "timeout",
      value: { outcome: "timeout", capturedAt: at, providerId: "client-regions", targetId: "x" },
    },
    {
      name: "disconnected",
      value: {
        outcome: "disconnected",
        capturedAt: at,
        providerId: "client-regions",
        targetId: "x",
      },
    },
    {
      name: "region not found",
      value: {
        outcome: "region-not-found",
        capturedAt: at,
        providerId: "client-regions",
        targetId: "x",
      },
    },
    {
      name: "schema unsupported",
      value: {
        outcome: "schema-unsupported",
        capturedAt: at,
        providerId: "backend-services",
        targetId: "x",
      },
    },
  ],
  refuse: [
    {
      name: "no-client carrying a shape",
      value: { outcome: "no-client", capturedAt: at, providerId: "p", targetId: "t", shape: [] },
    },
    {
      name: "timeout carrying values",
      value: {
        outcome: "timeout",
        capturedAt: at,
        providerId: "p",
        targetId: "t",
        values: { a: 1 },
      },
    },
    { name: "ok without omissions", value: { ...okQuery, omitted: undefined } },
    { name: "ok without values", value: { ...okQuery, values: undefined } },
    {
      name: "an old omission reason",
      value: { ...okQuery, omitted: [{ path: "token", reason: "unmarked" }] },
    },
    {
      name: "an empty omission path",
      value: { ...okQuery, omitted: [{ path: "", reason: "secret" }] },
    },
    {
      name: "ambiguous without clients",
      value: { outcome: "ambiguous", capturedAt: at, providerId: "p", targetId: "t" },
    },
    {
      name: "ambiguous with one client",
      value: {
        outcome: "ambiguous",
        capturedAt: at,
        providerId: "p",
        targetId: "t",
        clients: [{ clientId: client, lastSeen: at }],
      },
    },
    {
      name: "ambiguous clients carrying a viewed thread",
      value: {
        outcome: "ambiguous",
        capturedAt: at,
        providerId: "p",
        targetId: "t",
        clients: [
          { clientId: client, lastSeen: at, viewing: ["thread-1"] },
          { clientId: client2, lastSeen: at },
        ],
      },
    },
    {
      name: "clients on a non-ambiguous outcome",
      value: {
        outcome: "no-client",
        capturedAt: at,
        providerId: "p",
        targetId: "t",
        clients: [{ clientId: client, lastSeen: at }],
      },
    },
    { name: "truncated without its truncation", value: { ...okQuery, outcome: "truncated" } },
    { name: "ok carrying a truncation", value: { ...okQuery, truncation } },
    { name: "a thread claim in a result", value: { ...okQuery, threadId: "t1" } },
  ],
};

/** `{op, reply}`: the operation a call named and the XC-6 reply to it. An inspect call never answers `pending`, `error` or a poll: it holds until `done`, `refused` or `unavailable`. */
const inspectCarrierReply: InspectVectorSet = {
  accept: [
    {
      name: "a done list",
      value: { op: "inspect.list", reply: { v: 1, status: "done", result: okList } },
    },
    {
      name: "a done query with an outcome",
      value: {
        op: "inspect.query",
        reply: {
          v: 1,
          status: "done",
          result: {
            outcome: "timeout",
            capturedAt: at,
            providerId: "client-regions",
            targetId: "x",
          },
        },
      },
    },
    {
      name: "a done query",
      value: { op: "inspect.query", reply: { v: 1, status: "done", result: okQuery } },
    },
    {
      name: "an authorization refusal",
      value: {
        op: "inspect.list",
        reply: { v: 1, status: "refused", code: "AUTH_TOOL_NOT_ALLOWED" },
      },
    },
    {
      name: "a read-only refusal",
      value: { op: "inspect.query", reply: { v: 1, status: "refused", code: "INSPECT_READONLY" } },
    },
    {
      name: "unavailable",
      value: {
        op: "inspect.query",
        reply: { v: 1, status: "unavailable", code: "INSPECT_UNAVAILABLE" },
      },
    },
  ],
  refuse: [
    {
      name: "pending",
      value: { op: "inspect.list", reply: { v: 1, status: "pending", token: "tok-1" } },
    },
    {
      name: "a carrier error",
      value: { op: "inspect.list", reply: { v: 1, status: "error", code: "BOOM" } },
    },
    {
      name: "a poll request, not a reply",
      value: { op: "inspect.list", reply: { v: 1, poll: "tok-1" } },
    },
    {
      name: "a done list answering a query",
      value: { op: "inspect.query", reply: { v: 1, status: "done", result: okList } },
    },
    {
      name: "a done query answering a list",
      value: { op: "inspect.list", reply: { v: 1, status: "done", result: okQuery } },
    },
    {
      name: "a done with an unknown result",
      value: { op: "inspect.list", reply: { v: 1, status: "done", result: { x: 1 } } },
    },
    {
      name: "a lower-case refusal code",
      value: { op: "inspect.list", reply: { v: 1, status: "refused", code: "forbidden" } },
    },
    {
      name: "an extra key on a done",
      value: { op: "inspect.list", reply: { v: 1, status: "done", result: okList, token: "t" } },
    },
    {
      name: "another version",
      value: { op: "inspect.list", reply: { v: 2, status: "done", result: okList } },
    },
  ],
};

export const inspectVectors = {
  inspectListArgs,
  inspectQueryArgs,
  inspectListResult,
  inspectQueryResult,
  inspectCarrierReply,
} as const;
