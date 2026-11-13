// AETHERIA M10 Plan step 18 (D14, D20, XC-15, XC-16; IP-54 to IP-56) — the strict contracts of the four client job methods: `aetheria.jobs.list`, `.output`, `.outbox.list` and `.kill`.
// A payload names a root thread (and a job, and explicit offsets) and never an actor, user flag, scope, session or path. A reply is `{ok:true,value}` or a coded refusal; a read's value
// reuses M05's job row and output chunks unchanged, so truncation, running and the live-versus-final state stay visible.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AETHERIA_WS_METHODS,
  AetheriaRpcGroup,
  ClientJobsKillPayload,
  ClientJobsKillResult,
  ClientJobsListPayload,
  ClientJobsListResult,
  ClientJobsOutboxListPayload,
  ClientJobsOutboxListResult,
  ClientJobsOutputPayload,
  ClientJobsOutputResult,
  JOBS_CONTROL_CODE_CLASSES,
  JOBS_PASSTHROUGH_CODES,
} from "./index.ts";

const strict = { onExcessProperty: "error" } as const;
const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(schema as never, strict) as (input: unknown) => S["Type"];

const ROW = {
  jobId: "job-1",
  ownerSessionId: "pi-child",
  label: "npm test",
  state: "running",
  completion: "pending",
} as const;

describe("the job methods are methods of the Aetheria group", () => {
  it("names the five client methods and joins each to the group once", () => {
    expect(AETHERIA_WS_METHODS.jobsList).toBe("aetheria.jobs.list");
    expect(AETHERIA_WS_METHODS.jobsOutput).toBe("aetheria.jobs.output");
    expect(AETHERIA_WS_METHODS.jobsOutboxList).toBe("aetheria.jobs.outbox.list");
    expect(AETHERIA_WS_METHODS.jobsKill).toBe("aetheria.jobs.kill");
    expect(AETHERIA_WS_METHODS.usageRead).toBe("aetheria.usage.read");
    for (const tag of [
      AETHERIA_WS_METHODS.jobsList,
      AETHERIA_WS_METHODS.jobsOutput,
      AETHERIA_WS_METHODS.jobsOutboxList,
      AETHERIA_WS_METHODS.jobsKill,
      AETHERIA_WS_METHODS.usageRead,
    ])
      expect(AetheriaRpcGroup.requests.has(tag)).toBe(true);
    // Every method name in the table has a request in the group, and no other request exists: the inventory is exact.
    expect(new Set(AetheriaRpcGroup.requests.keys())).toEqual(
      new Set(Object.values(AETHERIA_WS_METHODS)),
    );
  });
});

describe("the job payloads", () => {
  it("name a root thread, a job and explicit offsets, and nothing else", () => {
    expect(decode(ClientJobsListPayload)({ rootThreadId: "thread-1" })).toEqual({
      rootThreadId: "thread-1",
    });
    expect(decode(ClientJobsOutboxListPayload)({ rootThreadId: "thread-1" })).toEqual({
      rootThreadId: "thread-1",
    });
    expect(decode(ClientJobsKillPayload)({ rootThreadId: "thread-1", jobId: "job-1" })).toEqual({
      rootThreadId: "thread-1",
      jobId: "job-1",
    });
    expect(
      decode(ClientJobsOutputPayload)({
        rootThreadId: "thread-1",
        jobId: "job-1",
        offsets: { stdout: 0, stderr: 128 },
      }),
    ).toEqual({
      rootThreadId: "thread-1",
      jobId: "job-1",
      offsets: { stdout: 0, stderr: 128 },
    });
  });

  it("refuse a missing field, an empty id, a negative or fractional offset and an offset that is not explicit", () => {
    expect(() => decode(ClientJobsListPayload)({})).toThrow();
    expect(() => decode(ClientJobsListPayload)({ rootThreadId: "" })).toThrow();
    expect(() => decode(ClientJobsKillPayload)({ rootThreadId: "t" })).toThrow();
    const output = decode(ClientJobsOutputPayload);
    expect(() => output({ rootThreadId: "t", jobId: "j" })).toThrow();
    expect(() => output({ rootThreadId: "t", jobId: "j", offsets: { stdout: 0 } })).toThrow();
    expect(() =>
      output({ rootThreadId: "t", jobId: "j", offsets: { stdout: -1, stderr: 0 } }),
    ).toThrow();
    expect(() =>
      output({ rootThreadId: "t", jobId: "j", offsets: { stdout: 1.5, stderr: 0 } }),
    ).toThrow();
    // M05's own cursor, a wait and a timeout are not the browser's to set: the read never moves the agent's cursor and never waits.
    for (const extra of [{ wait: true }, { timeoutMs: 100 }, { cursor: 5 }, { requestId: "r" }])
      expect(() =>
        output({ rootThreadId: "t", jobId: "j", offsets: { stdout: 0, stderr: 0 }, ...extra }),
      ).toThrow();
  });

  it("never carry an actor, a user flag, a scope, a session or a path", () => {
    for (const extra of [
      { caller: { user: true } },
      { user: true },
      { actor: { clientSessionId: "x" } },
      { scope: "orchestration:operate" },
      { sessionId: "s" },
      { path: "/tmp/out.log" },
    ]) {
      expect(() => decode(ClientJobsListPayload)({ rootThreadId: "t", ...extra })).toThrow();
      expect(() => decode(ClientJobsOutboxListPayload)({ rootThreadId: "t", ...extra })).toThrow();
      expect(() =>
        decode(ClientJobsKillPayload)({ rootThreadId: "t", jobId: "j", ...extra }),
      ).toThrow();
      expect(() =>
        decode(ClientJobsOutputPayload)({
          rootThreadId: "t",
          jobId: "j",
          offsets: { stdout: 0, stderr: 0 },
          ...extra,
        }),
      ).toThrow();
    }
  });
});

describe("the job replies", () => {
  it("list: M05's job rows, with the completion and the uncertain flags as supplied", () => {
    const result = decode(ClientJobsListResult);
    expect(result({ ok: true, value: { jobs: [] } })).toEqual({ ok: true, value: { jobs: [] } });
    // `unreadable` is M05's count of records it could not read: above zero the list is not complete, and the field travels instead of being hidden.
    expect(result({ ok: true, value: { jobs: [], unreadable: 2 } })).toEqual({
      ok: true,
      value: { jobs: [], unreadable: 2 },
    });
    expect(() => result({ ok: true, value: { jobs: [], unreadable: -1 } })).toThrow();
    expect(
      result({
        ok: true,
        value: {
          jobs: [
            ROW,
            {
              ...ROW,
              jobId: "job-2",
              state: "lost",
              completion: "none",
              livenessIndeterminate: true,
              terminationUnconfirmed: true,
              deliveryUncertain: true,
            },
            {
              ...ROW,
              jobId: "job-3",
              state: "exited",
              completion: "inserted",
              collectedAt: "2026-11-14T10:00:00Z",
              exit: { code: 0, signal: null },
            },
          ],
        },
      }),
    ).toBeDefined();
    // A row with an unknown state, an unknown completion or both an exit code and a signal is not a value.
    expect(() => result({ ok: true, value: { jobs: [{ ...ROW, state: "paused" }] } })).toThrow();
    expect(() =>
      result({ ok: true, value: { jobs: [{ ...ROW, completion: "later" }] } }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: { jobs: [{ ...ROW, exit: { code: 0, signal: "SIGTERM" } }] },
      }),
    ).toThrow();
    expect(() => result({ ok: true, value: { jobs: [{ ...ROW, command: "rm -rf" }] } })).toThrow();
  });

  it("output: chunks keep where they lie and whether the read was truncated, never an empty success for a failure", () => {
    const result = decode(ClientJobsOutputResult);
    const value = {
      jobId: "job-1",
      state: "running",
      streams: [
        { stream: "stdout", from: 0, to: 12, text: "hello world\n", truncated: false, size: 12 },
        { stream: "stderr", from: 128, to: 128, text: "", truncated: true, size: 4096 },
      ],
    };
    expect(result({ ok: true, value })).toBeDefined();
    expect(
      result({
        ok: true,
        value: {
          ...value,
          state: "failed",
          exit: { code: 2, signal: null },
          livenessIndeterminate: true,
        },
      }),
    ).toBeDefined();
    // A chunk whose end precedes its start, two chunks of one stream and an unknown stream are not values.
    expect(() =>
      result({
        ok: true,
        value: { ...value, streams: [{ ...value.streams[0]!, from: 5, to: 2 }] },
      }),
    ).toThrow();
    // The user's read has no wait, so a wait flag is not part of it; a chunk states its stream's size, so a viewer can tell how much is left.
    expect(() => result({ ok: true, value: { ...value, waitElapsed: false } })).toThrow();
    const { size: _size, ...noSize } = value.streams[0]!;
    expect(() => result({ ok: true, value: { ...value, streams: [noSize] } })).toThrow();
    expect(() =>
      result({ ok: true, value: { ...value, streams: [value.streams[0], value.streams[0]] } }),
    ).toThrow();
    expect(() =>
      result({
        ok: true,
        value: { ...value, streams: [{ ...value.streams[0]!, stream: "stdin" }] },
      }),
    ).toThrow();
  });

  it("outbox: rows say each notice's state and whether its delivery is uncertain, and carry no text, message or session", () => {
    const result = decode(ClientJobsOutboxListResult);
    const row = {
      key: "job:job-1:completion",
      kind: "job-completion",
      state: "pending",
      delivery: "pending",
      attempts: 0,
      uncertainSince: null,
      nextAttemptAt: null,
    };
    expect(result({ ok: true, value: { rows: [] } })).toBeDefined();
    expect(result({ ok: true, value: { rows: [], unreadable: 1 } })).toEqual({
      ok: true,
      value: { rows: [], unreadable: 1 },
    });
    // The owner M05 names for a row is not part of the client's row.
    expect(() =>
      result({ ok: true, value: { rows: [{ ...row, owner: { kind: "job", jobId: "job-1" } }] } }),
    ).toThrow();
    expect(
      result({
        ok: true,
        value: {
          rows: [
            row,
            {
              ...row,
              key: "job:job-2:lost",
              kind: "job-lost",
              state: "attempting",
              delivery: "delivery-uncertain",
              attempts: 3,
              uncertainSince: 1700000000000,
              nextAttemptAt: 1700000001000,
            },
            {
              ...row,
              key: "child:c:report",
              kind: "child-report",
              state: "recorded",
              delivery: "recorded",
            },
          ],
        },
      }),
    ).toBeDefined();
    for (const bad of [
      { ...row, kind: "chat" },
      { ...row, state: "unknown" },
      { ...row, delivery: "sent" },
      { ...row, attempts: -1 },
      { ...row, text: "the notice body" },
      { ...row, targetSessionId: "pi-root" },
      { ...row, messageId: "m" },
    ])
      expect(() => result({ ok: true, value: { rows: [bad] } })).toThrow();
  });

  it("kill: the final state with its exit and the unconfirmed-termination flags as supplied; a live state is not a kill result", () => {
    const result = decode(ClientJobsKillResult);
    expect(result({ ok: true, value: { jobId: "job-1", state: "killed" } })).toBeDefined();
    expect(
      result({
        ok: true,
        value: {
          jobId: "job-1",
          state: "lost",
          exit: { code: null, signal: "SIGKILL" },
          terminationUnconfirmed: true,
        },
      }),
    ).toBeDefined();
    expect(() => result({ ok: true, value: { jobId: "job-1", state: "running" } })).toThrow();
  });

  it("classes every Backend code once and accepts exactly those codes and M05's passed-through ones as refusals", () => {
    expect(JOBS_CONTROL_CODE_CLASSES).toEqual({
      JOBS_NOT_AUTHORIZED: "refusal",
      JOBS_DEVICE_REVOKED: "refusal",
      JOBS_NOT_FOUND: "absence",
      JOBS_UNAVAILABLE: "failure",
      JOBS_OUTCOME_UNKNOWN: "failure",
    });
    expect(JOBS_PASSTHROUGH_CODES).toEqual([
      "NOT_AUTHORIZED",
      "JOB_NOT_FOUND",
      "JOB_CONFLICT",
      "JOB_IDENTITY_MISMATCH",
      "ORCHESTRATION_UNAVAILABLE",
    ]);
    for (const schema of [
      ClientJobsListResult,
      ClientJobsOutputResult,
      ClientJobsOutboxListResult,
      ClientJobsKillResult,
    ]) {
      for (const code of [...Object.keys(JOBS_CONTROL_CODE_CLASSES), ...JOBS_PASSTHROUGH_CODES])
        expect(decode(schema)({ ok: false, code, detail: "why" })).toBeDefined();
      expect(() => decode(schema)({ ok: false, code: "CHILDREN_UNAVAILABLE" })).toThrow();
      expect(() => decode(schema)({ ok: false, code: "OTHER" })).toThrow();
    }
  });
});
