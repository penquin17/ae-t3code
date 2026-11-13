// The jobs panel in a real browser with the real stylesheet (M10 Plan step 18, D14, D20, XC-15/16). Boundary: the public `JobsPanel` over a fake `JobsTransport` supplied through its context
// (no T3 socket, no real Backend), so these show the panel's behaviour and words, not the wire. The images are evidence for a person to view; the assertions prove the words, the call counts,
// the layout and the names.
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import "@t3tools/aetheria-design/aetheria.css";
import { refreshTheme, setAppearanceMode, setTheme } from "~/hooks/useTheme";
import { act, render } from "../../../../test/render";
import { over, ratio, resolveColor, surfaceBehind } from "../../measure";
import { JobsPanel } from "./JobsPanel";
import type { Reply } from "./reply";
import { JobsTransportContext, UNAVAILABLE_JOBS, type JobsTransport } from "./transport";

type Mode = "light" | "dark";
type Method = "list" | "output" | "outbox" | "kill";
const ENV = "env-1";

const probe = {
  calls: [] as Array<{ method: Method; input: Record<string, unknown> }>,
  answer: {} as Record<Method, (input: Record<string, unknown>) => Promise<Reply<unknown>>>,
};
const ok = (value: unknown): Promise<Reply<unknown>> => Promise.resolve({ ok: true, value });
const fail = (code: string, detail?: string): Promise<Reply<unknown>> =>
  Promise.resolve({ ok: false, code, ...(detail === undefined ? {} : { detail }) });

const job = (overrides: Record<string, unknown> = {}) => ({
  jobId: "job-a",
  ownerSessionId: "sess-a",
  label: "npm test",
  state: "running",
  completion: "pending",
  ...overrides,
});
const JOBS = [
  job(),
  job({
    jobId: "job-b",
    label: "build docs",
    state: "exited",
    completion: "inserted",
    exit: { code: 0, signal: null },
    startedAt: "2026-11-13T10:00:00Z",
    endedAt: "2026-11-13T10:05:00Z",
  }),
  job({
    jobId: "job-c",
    label: "sync",
    state: "lost",
    completion: "none",
    livenessIndeterminate: true,
  }),
];
const ENTRIES = [
  {
    key: "job:job-b:completion",
    kind: "job-completion",
    delivery: "inserted",
    attempts: 1,
    uncertainSince: null,
    nextAttemptAt: null,
  },
  {
    key: "job:job-a:completion",
    kind: "job-completion",
    delivery: "pending",
    attempts: 0,
    uncertainSince: null,
    nextAttemptAt: null,
  },
  {
    key: "job:job-c:lost",
    kind: "job-lost",
    delivery: "delivery-uncertain",
    attempts: 2,
    uncertainSince: 1,
    nextAttemptAt: null,
  },
];
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
  size: to,
});
const outputOf = (streams: unknown[], state = "running") => ({
  jobId: "job-a",
  state,
  streams,
});

const reset = () => {
  probe.calls.length = 0;
  probe.answer = {
    list: () => ok({ jobs: JOBS }),
    outbox: () => ok({ rows: ENTRIES }),
    output: () => ok(outputOf([chunk("stdout", 0, 5, "hello")])),
    kill: () => ok({ jobId: "job-a", state: "killed" }),
  };
};
const record =
  <Request extends object>(method: Method) =>
  (request: Request) => {
    const input: Record<string, unknown> = Object.fromEntries(Object.entries(request));
    probe.calls.push({ method, input: structuredClone(input) });
    return probe.answer[method](input);
  };
const transport: JobsTransport = {
  list: record<Parameters<JobsTransport["list"]>[0]>("list"),
  output: record<Parameters<JobsTransport["output"]>[0]>("output"),
  outbox: record<Parameters<JobsTransport["outbox"]>[0]>("outbox"),
  kill: record<Parameters<JobsTransport["kill"]>[0]>("kill"),
};
const callsTo = (method: Method) => probe.calls.filter((call) => call.method === method);
const text = () => document.body.textContent ?? "";
const pause = async () => {
  for (let turn = 0; turn < 40; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};
const held = () => {
  let release: (value: Reply<unknown>) => void = () => {};
  const promise = new Promise<Reply<unknown>>((resolve) => (release = resolve));
  return { promise, release };
};

function Shell(props: { readonly root?: string; readonly connected?: boolean }) {
  const panel: ReactNode = <JobsPanel environmentId={ENV} threadId={props.root ?? "root-1"} />;
  return (
    <div className="min-h-svh bg-background">
      <main className="mx-auto w-full max-w-2xl p-4" data-testid="sheet">
        <JobsTransportContext value={props.connected === false ? UNAVAILABLE_JOBS : transport}>
          {panel}
        </JobsTransportContext>
      </main>
    </div>
  );
}

async function setup(width: number, height: number, mode: Mode) {
  await page.viewport(width, height);
  setTheme("system");
  setAppearanceMode(mode);
  refreshTheme();
  reset();
}
async function mount(ui: ReactNode = <Shell />) {
  const screen = await render(ui, { router: false });
  await expect.poll(() => text()).toContain("build docs");
  return screen;
}
type Screen = Awaited<ReturnType<typeof mount>>;
const killButton = (screen: Screen, label: string) =>
  screen.getByRole("button", { name: `Kill ${label}`, exact: true });

describe("with no connection", () => {
  it("says jobs are not connected and never shows an empty list, an outbox of nothing, or a Kill", async () => {
    await setup(1280, 800, "light");
    await using screen = await render(<Shell connected={false} />, { router: false });
    await expect.poll(() => text()).toContain("Jobs are not connected yet (M05 user read).");
    expect(screen.container.querySelector("[data-testid='jobs-unavailable']")).not.toBe(null);
    expect(screen.container.querySelector("[data-testid='outbox-unavailable']")).not.toBe(null);
    expect(text()).not.toContain("lists no jobs");
    expect(text()).not.toContain("lists no notices");
    expect(screen.container.querySelectorAll("button[aria-label^='Kill ']")).toHaveLength(0);
  });
});

describe("the list", () => {
  it("reads once on mount and shows each job's facts as supplied, in the Backend's order", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(callsTo("list")).toHaveLength(1);
    expect(callsTo("list")[0]?.input).toEqual({ environmentId: ENV, rootThreadId: "root-1" });
    const rows = [...screen.container.querySelectorAll<HTMLElement>("[data-job-id]")];
    expect(rows.map((row) => row.dataset.jobId)).toEqual(["job-a", "job-b", "job-c"]);
    expect(rows[0]?.textContent).toContain("npm test");
    expect(rows[0]?.textContent).toContain("Running");
    expect(rows[0]?.textContent).toContain("Owner session sess-a");
    expect(rows[0]?.textContent).toContain("Not exited yet");
    expect(rows[0]?.textContent).toContain("Completion notice pending");
    expect(rows[0]?.textContent).toContain("Start time not supplied");
    expect(rows[1]?.textContent).toContain("Exit code 0");
    expect(rows[1]?.textContent).toContain("Started 2026-11-13T10:00:00Z");
    expect(rows[1]?.textContent).toContain("Ended 2026-11-13T10:05:00Z");
    expect(rows[1]?.textContent).toContain("Completion notice inserted");
    expect(rows[2]?.textContent).toContain("Lost");
    expect(rows[2]?.textContent).toContain("No exit was observed");
    expect(rows[2]?.textContent).toContain("Whether this job is still running is not known");
    expect(rows[2]?.textContent).toContain("No completion notice");
  });

  it("an empty list is said to be empty only when the Backend said so; a lost read is never empty", async () => {
    await setup(1280, 800, "light");
    probe.answer.list = () => ok({ jobs: [] });
    await using _empty = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("The Backend lists no jobs for this session.");
    reset();
    probe.answer.list = () => Promise.reject(new Error("socket closed"));
    await using _lost = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("what they are doing is not known");
    expect(document.querySelectorAll("[data-testid='jobs-empty']")).toHaveLength(1);
  });

  it("a list the panel cannot read is unknown, not empty", async () => {
    await setup(1280, 800, "light");
    probe.answer.list = () => ok({ jobs: [job({ state: "paused" })] });
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("what they are doing is not known");
    expect(screen.container.querySelector("[data-job-id]")).toBe(null);
    expect(screen.container.querySelector("[data-testid='jobs-empty']")).toBe(null);
  });

  it("a read refused by the Backend shows its words and its code", async () => {
    await setup(1280, 800, "light");
    probe.answer.list = () => fail("JOBS_DEVICE_REVOKED", "revoked at 09:41");
    await using screen = await render(<Shell />, { router: false });
    await expect.poll(() => text()).toContain("revoked at 09:41");
    expect(screen.container.querySelector("[data-refusal-code='JOBS_DEVICE_REVOKED']")).not.toBe(
      null,
    );
    expect(screen.container.querySelector("[data-job-id]")).toBe(null);
  });

  it("Refresh reads the list again, and a stale reply never replaces a newer one", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const old = held();
    let reads = 0;
    probe.answer.list = () => {
      reads += 1;
      return reads === 1
        ? old.promise
        : ok({ jobs: [job({ jobId: "new-1", label: "fresh job" })] });
    };
    await screen.getByRole("button", { name: "Refresh jobs" }).click();
    await screen.getByRole("button", { name: "Refresh jobs" }).click();
    await expect.poll(() => text()).toContain("fresh job");
    old.release({ ok: true, value: { jobs: [job({ jobId: "old-1", label: "stale job" })] } });
    await pause();
    expect(text()).toContain("fresh job");
    expect(text()).not.toContain("stale job");
  });

  it("two roots never mix: a late reply for the first root does not land under the second", async () => {
    await setup(1280, 800, "light");
    const first = held();
    probe.answer.list = (input) =>
      input.rootThreadId === "root-1"
        ? first.promise
        : ok({ jobs: [job({ jobId: "of-2", label: "second root job" })] });
    await using screen = await render(<Shell />, { router: false });
    await screen.rerender(<Shell root="root-2" />);
    await expect.poll(() => text()).toContain("second root job");
    first.release({ ok: true, value: { jobs: [job({ jobId: "of-1", label: "first root job" })] } });
    await pause();
    expect(text()).toContain("second root job");
    expect(text()).not.toContain("first root job");
  });
});

describe("output", () => {
  const openOutput = async (screen: Screen, label = "npm test") => {
    await screen.getByRole("button", { name: `Output of ${label}`, exact: true }).click();
  };

  it("the first read asks for byte 0 of each stream and shows what came back with its offsets", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await openOutput(screen);
    await expect.poll(() => text()).toContain("Bytes 0–5 of 5 shown.");
    expect(callsTo("output")).toHaveLength(1);
    expect(callsTo("output")[0]?.input).toEqual({
      environmentId: ENV,
      rootThreadId: "root-1",
      jobId: "job-a",
      offsets: { stdout: 0, stderr: 0 },
    });
    expect(screen.container.querySelector("pre[data-stream='stdout']")?.textContent).toBe("hello");
    expect(text()).not.toMatch(/all (the )?output|complete output/i);
  });

  it("a truncated read says more is waiting, and Read more asks from the end of what was shown", async () => {
    await setup(1280, 800, "light");
    let step = 0;
    probe.answer.output = () => {
      step += 1;
      return ok(
        step === 1
          ? outputOf([chunk("stdout", 0, 5, "hello", true)])
          : outputOf([chunk("stdout", 5, 11, " world")]),
      );
    };
    await using screen = await mount();
    await openOutput(screen);
    await expect.poll(() => text()).toContain("More output is waiting");
    await screen.getByRole("button", { name: "Read more output of npm test" }).click();
    await expect.poll(() => text()).toContain("Bytes 0–11 of 11 shown.");
    expect(callsTo("output")[1]?.input.offsets).toEqual({ stdout: 5, stderr: 0 });
    expect(screen.container.querySelector("pre[data-stream='stdout']")?.textContent).toBe(
      "hello world",
    );
    expect(text()).not.toContain("More output is waiting");
    expect(text()).toContain("may still write more");
  });

  it("a chunk that does not start where the read asked is not added and is said", async () => {
    await setup(1280, 800, "light");
    probe.answer.output = () => ok(outputOf([chunk("stdout", 10, 15, "later")]));
    await using screen = await mount();
    await openOutput(screen);
    await expect.poll(() => text()).toContain("bytes 10–15 of stdout");
    expect(screen.container.querySelector("pre[data-stream='stdout']")?.textContent ?? "").toBe("");
  });

  it("output that cannot be read is unavailable, never an empty read", async () => {
    await setup(1280, 800, "light");
    probe.answer.output = () =>
      fail("ORCHESTRATION_UNAVAILABLE", "the output was removed after its retention");
    await using screen = await mount();
    await openOutput(screen);
    await expect.poll(() => text()).toContain("the output was removed after its retention");
    expect(screen.container.querySelector("pre[data-stream]")).toBe(null);
    expect(text()).not.toContain("Nothing was returned");
  });

  it("a refused read shows the Backend's words and code", async () => {
    await setup(1280, 800, "light");
    probe.answer.output = () => fail("JOB_NOT_FOUND", "no such job for this session");
    await using screen = await mount();
    await openOutput(screen);
    await expect
      .poll(() => screen.container.querySelector("[data-refusal-code='JOB_NOT_FOUND']"))
      .not.toBe(null);
    expect(text()).toContain("no such job for this session");
  });

  it("a read whose reply never came is unknown, never an empty read", async () => {
    await setup(1280, 800, "light");
    probe.answer.output = () => Promise.reject(new Error("socket closed"));
    await using screen = await mount();
    await openOutput(screen);
    await expect.poll(() => text()).toContain("what the job printed is not known");
    expect(callsTo("output")).toHaveLength(1);
  });
});

describe("Kill", () => {
  it("one click only asks to confirm; Cancel sends nothing", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await killButton(screen, "npm test").click();
    await expect.poll(() => text()).toContain("Kill npm test?");
    expect(callsTo("kill")).toHaveLength(0);
    await screen.getByRole("button", { name: "Cancel kill of npm test" }).click();
    await pause();
    expect(callsTo("kill")).toHaveLength(0);
    expect(text()).not.toContain("Kill npm test?");
  });

  it("a finished job offers no Kill", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    expect(
      screen.container.querySelector("[data-job-id='job-b'] button[aria-label^='Kill ']"),
    ).toBe(null);
    expect(
      screen.container.querySelector("[data-job-id='job-c'] button[aria-label^='Kill ']"),
    ).toBe(null);
  });

  it("confirming sends exactly one kill for that job, re-reads the list, and says what the Backend answered", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await killButton(screen, "npm test").click();
    probe.answer.list = () =>
      ok({ jobs: [job({ state: "killed", completion: "inserted" }), ...JOBS.slice(1)] });
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect.poll(() => text()).toContain("Kill done for npm test: the job is now killed.");
    expect(callsTo("kill")).toHaveLength(1);
    expect(callsTo("kill")[0]?.input).toEqual({
      environmentId: ENV,
      rootThreadId: "root-1",
      jobId: "job-a",
    });
    expect(callsTo("list")).toHaveLength(2);
    await expect
      .poll(() =>
        screen.container.querySelector("[data-job-id='job-a']")?.getAttribute("data-state"),
      )
      .toBe("killed");
    expect(
      screen.container.querySelector("[data-job-id='job-a'] button[aria-label^='Kill ']"),
    ).toBe(null);
  });

  it("while the kill is away, a second confirm cannot send another", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    const away = held();
    probe.answer.kill = () => away.promise;
    probe.answer.list = () => ok({ jobs: [job({ state: "killed" }), ...JOBS.slice(1)] });
    await killButton(screen, "npm test").click();
    const confirm = screen.getByRole("button", { name: "Confirm kill of npm test" });
    await confirm.click();
    await expect.poll(() => text()).toContain("Killing");
    await pause();
    expect(callsTo("kill")).toHaveLength(1);
    away.release({ ok: true, value: { jobId: "job-a", state: "killed" } });
    await expect.poll(() => text()).toContain("Kill done for npm test");
    expect(callsTo("kill")).toHaveLength(1);
  });

  it("a lost reply is unknown, is never sent again, and a refresh only reads", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer.kill = () => Promise.reject(new Error("socket closed"));
    await killButton(screen, "npm test").click();
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect.poll(() => text()).toContain("Whether npm test was killed is not known");
    expect(text()).toContain("not sent again");
    await screen.getByRole("button", { name: "Refresh jobs" }).click();
    await pause();
    expect(callsTo("kill")).toHaveLength(1);
  });

  it("a refusal shows the Backend's code and words and says nothing was killed by this panel's claim", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer.kill = () => fail("JOB_NOT_FOUND", "no such job for this session");
    await killButton(screen, "npm test").click();
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect
      .poll(() => screen.container.querySelector("[data-refusal-code='JOB_NOT_FOUND']"))
      .not.toBe(null);
    expect(text()).toContain("no such job for this session");
    expect(text()).not.toContain("Kill done");
    expect(callsTo("kill")).toHaveLength(1);
  });

  it("an unconfirmed termination is said, not hidden", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    probe.answer.kill = () => ok({ jobId: "job-a", state: "killed", terminationUnconfirmed: true });
    probe.answer.list = () => ok({ jobs: [job({ state: "killed" }), ...JOBS.slice(1)] });
    await killButton(screen, "npm test").click();
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect
      .poll(() => text())
      .toContain("The Backend could not confirm that the process ended.");
  });

  it("an accepted kill that the re-read does not show is unknown, not done", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    // The list still shows the job running after the Backend said it was killed.
    await killButton(screen, "npm test").click();
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect.poll(() => text()).toContain("Whether npm test was killed is not known");
    expect(text()).not.toContain("Kill done");
    expect(callsTo("kill")).toHaveLength(1);
  });

  it("with no connection nothing is killed and it says so", async () => {
    await setup(1280, 800, "light");
    // A host that supplies only the list: the unavailable default answers the kill.
    const partial: JobsTransport = {
      ...transport,
      kill: () => fail("JOBS_UNAVAILABLE", "Jobs are not connected yet (M05 user read)."),
    };
    await using screen = await render(
      <JobsTransportContext value={partial}>
        <JobsPanel environmentId={ENV} threadId="root-1" />
      </JobsTransportContext>,
      { router: false },
    );
    await expect.poll(() => text()).toContain("build docs");
    await killButton(screen, "npm test").click();
    await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
    await expect.poll(() => text()).toContain("Nothing was killed: Jobs are not connected yet");
  });
});

describe("the outbox", () => {
  it("lists each notice with its delivery state, and says viewing acknowledges nothing", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await expect.poll(() => screen.container.querySelectorAll("[data-outbox-key]").length).toBe(3);
    const rows = [...screen.container.querySelectorAll<HTMLElement>("[data-outbox-key]")];
    expect(rows.map((row) => row.dataset.delivery)).toEqual([
      "inserted",
      "pending",
      "delivery-uncertain",
    ]);
    expect(rows[0]?.textContent).toContain("Inserted into the conversation");
    expect(rows[1]?.textContent).toContain("Pending: not delivered yet");
    expect(rows[2]?.textContent).toContain("Delivery uncertain: it may or may not have arrived");
    expect(rows[2]?.textContent).toContain("2 attempts");
    expect(screen.container.querySelector("[data-testid='outbox-note']")?.textContent).toContain(
      "Viewing it acknowledges nothing",
    );
  });

  it("viewing and refreshing it only reads: no kill and no output call, and the list is not re-read by it", async () => {
    await setup(1280, 800, "light");
    await using screen = await mount();
    await expect.poll(() => callsTo("outbox").length).toBe(1);
    await screen.getByRole("button", { name: "Refresh notices" }).click();
    await expect.poll(() => callsTo("outbox").length).toBe(2);
    expect(callsTo("kill")).toHaveLength(0);
    expect(callsTo("output")).toHaveLength(0);
    expect(callsTo("list")).toHaveLength(1);
  });

  it("an outbox the Backend could not give is unavailable or unknown, never empty", async () => {
    await setup(1280, 800, "light");
    probe.answer.outbox = () => fail("JOBS_UNAVAILABLE", "the outbox is not readable");
    await using screen = await mount();
    await expect
      .poll(() => text())
      .toContain("The outbox is unavailable: the outbox is not readable");
    expect(screen.container.querySelector("[data-outbox-key]")).toBe(null);
    expect(text()).not.toContain("lists no notices");
  });

  it("an empty outbox is said to be empty only when the Backend said so", async () => {
    await setup(1280, 800, "light");
    probe.answer.outbox = () => ok({ rows: [] });
    await using _screen = await mount();
    await expect.poll(() => text()).toContain("The Backend lists no notices in the outbox.");
  });

  it("a list the Backend could not read all of says it may be incomplete, for the jobs and for the notices, even when empty", async () => {
    await setup(1280, 800, "light");
    probe.answer.list = () => ok({ jobs: JOBS, unreadable: 2 });
    probe.answer.outbox = () => ok({ rows: [], unreadable: 1 });
    await using screen = await mount();
    await expect
      .poll(() => text())
      .toContain("This list of jobs may be incomplete: the Backend could not read 2 records.");
    expect(screen.container.querySelector("[data-job-id]")).not.toBe(null);
    await expect
      .poll(() => text())
      .toContain("This list of notices may be incomplete: the Backend could not read 1 record.");
    expect(text()).toContain("but not every record could be read");
    expect(text()).not.toContain("The Backend lists no notices in the outbox.");
  });
});

describe("captured at 1280 and 390, light and dark", () => {
  const surfaces = ["list", "output", "kill-confirm", "refusal", "unavailable"] as const;
  const cases = surfaces.flatMap((surface) =>
    ([1280, 390] as const).flatMap((width) =>
      (["light", "dark"] as const).map((mode) => [surface, width, mode] as const),
    ),
  );
  it.each(cases)("%s at %i px, %s", async (surface, width, mode) => {
    await setup(width, width === 390 ? 844 : 900, mode);
    if (surface === "refusal")
      probe.answer.kill = () => fail("JOB_NOT_FOUND", "no such job for this session");
    await using screen =
      surface === "unavailable"
        ? await render(<Shell connected={false} />, { router: false })
        : await mount();
    if (surface === "unavailable") {
      await expect.poll(() => text()).toContain("Jobs are not connected yet");
    }
    if (surface === "output") {
      probe.answer.output = () =>
        ok(
          outputOf([
            chunk("stdout", 0, 40, "PASS src/app.test.ts\nPASS src/jobs.test.ts\n", true),
            chunk("stderr", 0, 12, "warning: x\n"),
          ]),
        );
      await screen.getByRole("button", { name: "Output of npm test", exact: true }).click();
      await expect.poll(() => text()).toContain("More output is waiting");
    }
    if (surface === "kill-confirm") {
      await killButton(screen, "npm test").click();
      await expect.poll(() => text()).toContain("Kill npm test?");
    }
    if (surface === "refusal") {
      await killButton(screen, "npm test").click();
      await screen.getByRole("button", { name: "Confirm kill of npm test" }).click();
      await expect.poll(() => document.querySelector("[data-refusal-code]")).not.toBe(null);
    }
    for (const selector of ["h2", "header button"]) {
      const element = screen.container.querySelector<HTMLElement>(selector)!;
      const behind = surfaceBehind(element);
      const paint = resolveColor(getComputedStyle(element).color);
      expect(
        ratio(over(paint, behind.color), behind.color),
        `${selector} on ${JSON.stringify(behind.color)} in ${mode}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const element of screen.container.querySelectorAll<HTMLElement>(
      "li, pre, [data-refusal-code]",
    )) {
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    for (const control of screen.container.querySelectorAll<HTMLElement>("button")) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim()).not.toBe("");
    }
    await page.screenshot({
      base64: true,
      path: `__screenshots__/jobs-${surface}-${width}-${mode}.png`,
      save: true,
    });
  });
});
