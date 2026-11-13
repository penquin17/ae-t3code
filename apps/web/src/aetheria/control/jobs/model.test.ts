import { describe, expect, it } from "vite-plus/test";

import type { ActionOutcome } from "../../core/outcome";
import {
  applyOutput,
  initialOutput,
  jobRowView,
  killConfirm,
  killNotice,
  killSendFromReply,
  offsetsOf,
  parseJobList,
  parseOutbox,
  outboxRowView,
  streamStatus,
  type JobRowValue,
  type KillValue,
} from "./model";

const row = (overrides: Partial<JobRowValue> = {}): JobRowValue => ({
  jobId: "job-1",
  ownerSessionId: "sess-a",
  label: "npm test",
  state: "running",
  completion: "pending",
  ...overrides,
});

describe("the job list is read strictly", () => {
  it("a list of valid rows is read in the Backend's order", () => {
    const parsed = parseJobList({ jobs: [row(), row({ jobId: "job-2", state: "exited" })] });
    expect(parsed.ok && parsed.value.rows.map((r) => r.jobId)).toEqual(["job-1", "job-2"]);
  });

  it("an empty list is an empty list, complete unless the Backend counts records it could not read", () => {
    expect(parseJobList({ jobs: [] })).toEqual({ ok: true, value: { rows: [], unreadable: 0 } });
    expect(parseJobList({ jobs: [], unreadable: 0 })).toEqual({
      ok: true,
      value: { rows: [], unreadable: 0 },
    });
    expect(parseJobList({ jobs: [row()], unreadable: 2 })).toMatchObject({
      ok: true,
      value: { unreadable: 2 },
    });
  });

  it("a count of unreadable records that is not a count makes the list unreadable, never complete", () => {
    expect(parseJobList({ jobs: [], unreadable: -1 }).ok).toBe(false);
    expect(parseJobList({ jobs: [], unreadable: "2" }).ok).toBe(false);
  });

  it.each([
    ["no jobs array", {}],
    ["a state outside the six", { jobs: [row({ state: "paused" as never })] }],
    ["a completion outside the three", { jobs: [row({ completion: "done" as never })] }],
    ["a missing label", { jobs: [{ ...row(), label: undefined }] }],
    ["a row that is not an object", { jobs: [3] }],
    ["an exit that is not code/signal", { jobs: [row({ exit: { code: "0" } as never })] }],
  ])("%s is unreadable, and no row is dropped silently", (_name, value) => {
    expect(parseJobList(value).ok).toBe(false);
  });
});

describe("a job row says each fact as supplied", () => {
  it("a running job: state, label, owner, no exit yet, notice pending, killable", () => {
    const view = jobRowView(row());
    expect(view.stateText).toBe("Running");
    expect(view.label).toBe("npm test");
    expect(view.ownerText).toBe("Owner session sess-a");
    expect(view.exitText).toBe("Not exited yet");
    expect(view.noticeText).toBe("Completion notice pending");
    expect(view.canKill).toBe(true);
  });

  it("start and end times that were not supplied are said not to be supplied, never blank or now", () => {
    const view = jobRowView(row({ state: "exited", exit: { code: 0, signal: null } }));
    expect(view.startedText).toBe("Start time not supplied");
    expect(view.endedText).toBe("End time not supplied");
    expect(view.canKill).toBe(false);
  });

  it("supplied times are shown as supplied", () => {
    const view = jobRowView(
      row({
        state: "exited",
        startedAt: "2026-11-13T10:00:00Z",
        endedAt: "2026-11-13T10:05:00Z",
        exit: { code: 0, signal: null },
      }),
    );
    expect(view.startedText).toBe("Started 2026-11-13T10:00:00Z");
    expect(view.endedText).toBe("Ended 2026-11-13T10:05:00Z");
  });

  it.each([
    [{ code: 0, signal: null }, "Exit code 0"],
    [{ code: 2, signal: null }, "Exit code 2"],
    [{ code: null, signal: "SIGKILL" }, "Ended by signal SIGKILL"],
    [{ code: 1, signal: "SIGTERM" }, "Exit code 1, signal SIGTERM"],
  ])("an exit of %j reads %s", (exit, text) => {
    expect(jobRowView(row({ state: "exited", exit })).exitText).toBe(text);
  });

  it("a terminal job with no exit says none was observed, and a lost job is not exited", () => {
    expect(jobRowView(row({ state: "lost" })).exitText).toBe("No exit was observed");
    expect(jobRowView(row({ state: "killed" })).exitText).toBe("No exit was observed");
  });

  it("an exit of 0 is a number that is shown, not an absent exit", () => {
    expect(jobRowView(row({ state: "exited", exit: { code: 0, signal: null } })).exitText).toBe(
      "Exit code 0",
    );
  });

  it("the notice reads pending, inserted or none, and an uncertain delivery says so", () => {
    expect(jobRowView(row({ completion: "inserted" })).noticeText).toBe(
      "Completion notice inserted",
    );
    expect(jobRowView(row({ completion: "none" })).noticeText).toBe("No completion notice");
    expect(jobRowView(row({ deliveryUncertain: true })).noticeText).toBe(
      "Completion notice pending; its delivery is uncertain",
    );
  });

  it("the Backend's two doubt flags are carried as words", () => {
    const view = jobRowView(row({ livenessIndeterminate: true, terminationUnconfirmed: true }));
    expect(view.flagTexts).toEqual([
      "Whether this job is still running is not known",
      "Its termination was not confirmed",
    ]);
  });
});

describe("output is read by explicit offset", () => {
  const chunk = (
    stream: "stdout" | "stderr",
    from: number,
    to: number,
    text: string,
    truncated = false,
  ) => ({
    stream,
    from,
    to,
    text,
    truncated,
  });
  const value = (streams: unknown[], state = "running") => ({
    jobId: "job-1",
    state,
    streams,
  });

  it("the first read asks for byte 0 of each stream", () => {
    expect(offsetsOf(initialOutput("job-1"))).toEqual({ stdout: 0, stderr: 0 });
  });

  it("a chunk at the requested offset is appended and moves that stream's offset to its end", () => {
    const first = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      value([chunk("stdout", 0, 5, "hello")]),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(offsetsOf(first.state)).toEqual({ stdout: 5, stderr: 0 });
    const second = applyOutput(
      first.state,
      { stdout: 5, stderr: 0 },
      value([chunk("stdout", 5, 11, " world")]),
    );
    expect(second.ok && second.state.stdout.text).toBe("hello world");
    expect(second.ok && offsetsOf(second.state)).toEqual({ stdout: 11, stderr: 0 });
  });

  it("a chunk that does not start at the requested offset is not appended; the view says so", () => {
    const result = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      value([chunk("stdout", 10, 15, "later")]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.stdout.text).toBe("");
    expect(offsetsOf(result.state).stdout).toBe(0);
    expect(result.state.notes.join(" ")).toContain("bytes 10–15 of stdout");
  });

  it("a chunk's stream size (the contract's `size`) is kept and said, so a viewer can tell how much is left", () => {
    const sized = (to: number, size: number, truncated: boolean) =>
      value([{ ...chunk("stdout", 0, to, "x".repeat(to), truncated), size }]);
    const result = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      sized(4, 100, true),
    );
    expect(result.ok && result.state.stdout.size).toBe(100);
    if (!result.ok) return;
    expect(streamStatus(result.state.stdout, "running")).toContain("Bytes 0–4 of 100 shown");
    // A size that is not a count is unreadable, never guessed.
    expect(
      applyOutput(initialOutput("job-1"), { stdout: 0, stderr: 0 }, sized(4, -1, true)).ok,
    ).toBe(false);
  });

  it("a truncated chunk marks the stream as having more waiting", () => {
    const result = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      value([chunk("stdout", 0, 4, "abcd", true)]),
    );
    expect(result.ok && result.state.stdout.more).toBe(true);
  });

  it("a read with no chunk for a stream keeps its text and offset", () => {
    const first = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      value([chunk("stdout", 0, 3, "abc")]),
    );
    if (!first.ok) throw new Error("setup");
    const again = applyOutput(first.state, { stdout: 3, stderr: 0 }, value([]));
    expect(again.ok && again.state.stdout.text).toBe("abc");
    expect(again.ok && offsetsOf(again.state).stdout).toBe(3);
    expect(again.ok && again.state.stdout.more).toBe(false);
  });

  it("the job's state and exit as of the read are kept", () => {
    const result = applyOutput(
      initialOutput("job-1"),
      { stdout: 0, stderr: 0 },
      {
        ...value([], "exited"),
        exit: { code: 3, signal: null },
      },
    );
    expect(result.ok && result.state.jobState).toBe("exited");
    expect(result.ok && result.state.exit).toEqual({ code: 3, signal: null });
  });

  it.each([
    ["another job's output", { ...value([]), jobId: "job-9" }],
    [
      "a chunk with a bad stream",
      value([{ stream: "stdin", from: 0, to: 1, text: "x", truncated: false }]),
    ],
    ["a chunk that ends before it starts", value([chunk("stdout", 5, 2, "x")])],
    ["a non-integer offset", value([chunk("stdout", 0.5, 2, "x")])],
    ["no streams array", { jobId: "job-1", state: "running" }],
  ])("%s is unreadable and changes nothing", (_name, bad) => {
    expect(applyOutput(initialOutput("job-1"), { stdout: 0, stderr: 0 }, bad).ok).toBe(false);
  });

  it("no status line ever says all the output was shown", () => {
    const every = [
      streamStatus({ text: "", next: 0, more: false }, "running"),
      streamStatus({ text: "abc", next: 3, more: true }, "running"),
      streamStatus({ text: "abc", next: 3, more: false }, "running"),
      streamStatus({ text: "abc", next: 3, more: false }, "exited"),
    ];
    for (const line of every)
      expect(line).not.toMatch(/\ball (the )?output\b|\bcomplete\b|\beverything\b/i);
    expect(every[1]).toContain("More output is waiting");
    expect(every[2]).toContain("may still write more");
    expect(every[3]).toContain("at this read");
  });
});

describe("kill", () => {
  const killed: KillValue = { jobId: "job-1", state: "killed" };

  it("an accepted reply with a final state is accepted", () => {
    expect(killSendFromReply({ ok: true, value: killed })).toEqual({
      tag: "accepted",
      value: killed,
    });
  });

  it("a refusal keeps the Backend's code and words", () => {
    expect(killSendFromReply({ ok: false, code: "JOB_NOT_FOUND", detail: "no such job" })).toEqual({
      tag: "refused",
      code: "JOB_NOT_FOUND",
      message: "no such job",
    });
  });

  it("an unavailable code is unavailable; an outcome-unknown code or a non-reply is lost", () => {
    expect(killSendFromReply({ ok: false, code: "JOBS_UNAVAILABLE", detail: "x" })).toEqual({
      tag: "unavailable",
      reason: "x",
    });
    expect(killSendFromReply({ ok: false, code: "JOBS_OUTCOME_UNKNOWN" })).toEqual({ tag: "lost" });
    expect(killSendFromReply("nonsense")).toEqual({ tag: "lost" });
    expect(killSendFromReply({ ok: true, value: { jobId: "job-1", state: "running" } })).toEqual({
      tag: "lost",
    });
  });

  it("the re-read shows the kill only when the list shows that job in a final state", () => {
    const read = (jobs: JobRowValue[]) =>
      ({ tag: "read", value: { rows: jobs, unreadable: 0 } }) as const;
    expect(killConfirm(read([row({ state: "killed" })]), "job-1")).toEqual({ tag: "shows" });
    expect(killConfirm(read([row({ state: "running" })]), "job-1")).toEqual({ tag: "absent" });
    expect(killConfirm(read([]), "job-1")).toEqual({ tag: "absent" });
    expect(killConfirm({ tag: "unknown", reason: "lost" }, "job-1")).toEqual({
      tag: "failed",
      reason: "lost",
    });
  });

  const confirmed = (over: Partial<ActionOutcome<KillValue> & { kind: "confirmed" }> = {}) =>
    ({ kind: "confirmed", value: killed, refreshed: true, ...over }) as ActionOutcome<KillValue>;

  it("a done kill says what the Backend said the job's state is now", () => {
    expect(killNotice("npm test", confirmed())).toEqual({
      tone: "ok",
      text: "Kill done for npm test: the job is now killed.",
    });
  });

  it("an unconfirmed termination is said, and a kill never read back is not called settled", () => {
    const notice = killNotice(
      "npm test",
      confirmed({ value: { ...killed, terminationUnconfirmed: true }, refreshed: false }),
    );
    expect(notice?.text).toContain("The Backend could not confirm that the process ended.");
    expect(notice?.tone).toBe("warn");
  });

  it("a failed re-read after an accepted kill arrives as unknown with the runner's reason, kept in the words", () => {
    const reason =
      '"Kill" was accepted, but reading the backend\'s projection back failed (could not read the list); it is not known whether it shows.';
    const notice = killNotice("npm test", { kind: "unknown", reason });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("could not read the list");
    expect(notice?.text).toContain("not sent again");
  });

  it("an unknown outcome says it may have landed and was not sent again", () => {
    const notice = killNotice("npm test", { kind: "unknown", reason: "no reply" });
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("not known");
    expect(notice?.text).toContain("not sent again");
  });

  it("unavailable says nothing was killed; a refusal is left to the refusal notice", () => {
    expect(
      killNotice("npm test", { kind: "unavailable", reason: "not connected" })?.text,
    ).toContain("Nothing was killed");
    expect(killNotice("npm test", { kind: "refused", code: "JOB_NOT_FOUND", message: "m" })).toBe(
      null,
    );
  });
});

describe("the outbox list", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    key: "job:job-1:completion",
    kind: "job-completion",
    delivery: "pending",
    attempts: 0,
    uncertainSince: null,
    nextAttemptAt: null,
    ...over,
  });

  it("valid entries are read in order, from the contract's `rows`", () => {
    const parsed = parseOutbox({ rows: [entry(), entry({ key: "k2", delivery: "inserted" })] });
    expect(parsed.ok && parsed.value.rows.map((e) => e.key)).toEqual([
      "job:job-1:completion",
      "k2",
    ]);
    expect(parsed.ok && parsed.value.unreadable).toBe(0);
  });

  it("carries the Backend's count of notices it could not read", () => {
    expect(parseOutbox({ rows: [], unreadable: 3 })).toEqual({
      ok: true,
      value: { rows: [], unreadable: 3 },
    });
  });

  it.each([
    ["no rows array", {}],
    ["the old `entries` name", { entries: [entry()] }],
    ["a delivery outside the six", { rows: [entry({ delivery: "sent" })] }],
    ["attempts that are not a count", { rows: [entry({ attempts: -1 })] }],
    ["an entry without a key", { rows: [entry({ key: "" })] }],
    ["an unreadable count that is not a count", { rows: [], unreadable: -1 }],
  ])("%s is unreadable", (_name, value) => {
    expect(parseOutbox(value).ok).toBe(false);
  });

  it.each([
    ["pending", "Pending: not delivered yet"],
    ["attempting", "Being delivered"],
    ["inserted", "Inserted into the conversation"],
    ["recorded", "Recorded only: a stored report that is never inserted"],
    ["abandoned", "Abandoned: it will not be delivered"],
    ["delivery-uncertain", "Delivery uncertain: it may or may not have arrived"],
  ])("a %s entry reads %s", (delivery, text) => {
    const parsed = parseOutbox({ rows: [entry({ delivery })] });
    if (!parsed.ok) throw new Error("setup");
    expect(outboxRowView(parsed.value.rows[0]!).deliveryText).toBe(text);
  });

  it("attempts and a next-attempt time are shown as supplied", () => {
    const parsed = parseOutbox({
      rows: [entry({ attempts: 2, nextAttemptAt: Date.UTC(2026, 10, 13, 10, 0, 0) })],
    });
    if (!parsed.ok) throw new Error("setup");
    const view = outboxRowView(parsed.value.rows[0]!);
    expect(view.attemptsText).toBe("2 attempts");
    expect(view.nextText).toBe("Next attempt not before 2026-11-13T10:00:00.000Z");
  });
});
