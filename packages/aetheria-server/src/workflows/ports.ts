// AETHERIA M07 Plan steps 26, 28 and 29 — the run service's two ports over M05's direct Backend API (the user's own acts, which the person's Stop is). The service speaks Pi session ids; M05's direct calls name a
// root by its T3 thread, so each call translates the root first and a root with no thread is unavailable, never "no jobs". Nothing here retries, and an unreadable list is never an empty one: a listing
// that reports unreadable records or diagnostics may be hiding the run's own job or child, so it fails closed.
import type { OrchestrationDirectApi } from "../orchestration.ts";
import type { RunsPorts } from "./entry.ts";

export interface WorkflowRunsPortsDeps {
  /** M05's direct API now, or undefined while it is not running (before start, after drain): every call then answers unavailable. */
  readonly direct: () => OrchestrationDirectApi | undefined;
  /** M04's index, as translation only: the thread a root session is bound to; undefined when none is bound or it cannot say. */
  readonly threadOfSession: (sessionId: string) => string | undefined;
}

const USER = { user: true } as const;
const UNAVAILABLE = { ok: false, code: "ORCHESTRATION_UNAVAILABLE" } as const;
const unavailable = (detail: string) => ({
  ok: false as const,
  code: "ORCHESTRATION_UNAVAILABLE",
  detail,
});

export function createWorkflowRunsPorts(deps: WorkflowRunsPortsDeps): RunsPorts {
  const open = (root: string) => {
    const direct = deps.direct();
    const thread = deps.threadOfSession(root);
    return direct === undefined || thread === undefined ? undefined : { direct, thread };
  };
  return {
    async listJobs(root) {
      const at = open(root);
      if (at === undefined) return UNAVAILABLE;
      try {
        const answer = await at.direct.listJobs({
          caller: USER,
          args: { rootThreadId: at.thread },
        });
        if (!answer.ok)
          return {
            ok: false,
            code: answer.code,
            ...(answer.detail === undefined ? {} : { detail: answer.detail }),
          };
        if (answer.value.unreadable > 0)
          return unavailable("a job record cannot be read, so the run's job may be hidden");
        return {
          ok: true,
          value: answer.value.jobs.map((job) => ({
            jobId: job.jobId,
            label: job.label,
            state: job.state,
          })),
        };
      } catch {
        return unavailable("the job list failed");
      }
    },
    async killJob(root, jobId) {
      const at = open(root);
      if (at === undefined) return UNAVAILABLE;
      try {
        const answer = await at.direct.killJob({
          caller: USER,
          args: { rootThreadId: at.thread, jobId },
        });
        return answer.ok
          ? { ok: true, value: { state: answer.value.state } }
          : {
              ok: false,
              code: answer.code,
              ...(answer.detail === undefined ? {} : { detail: answer.detail }),
            };
      } catch {
        return unavailable("the job kill failed, so it is not known whether the job stopped");
      }
    },
    async listChildren(root) {
      const at = open(root);
      if (at === undefined) return UNAVAILABLE;
      try {
        const answer = await at.direct.listChildren({
          caller: USER,
          args: { scope: "descendants", rootThreadId: at.thread },
        });
        if (!answer.ok)
          return {
            ok: false,
            code: answer.code,
            ...(answer.detail === undefined ? {} : { detail: answer.detail }),
          };
        if (answer.value.diagnostics.length > 0)
          return unavailable("a child record cannot be read, so the run's child may be hidden");
        return {
          ok: true,
          value: answer.value.rows.map((row) => ({
            childId: row.childId,
            ...(row.label === undefined ? {} : { label: row.label }),
          })),
        };
      } catch {
        return unavailable("the child list failed");
      }
    },
    async closeChild(root, childId) {
      const at = open(root);
      if (at === undefined) return UNAVAILABLE;
      try {
        const answer = await at.direct.closeChild({ caller: USER, args: { target: childId } });
        return answer.ok
          ? { ok: true, value: answer.value }
          : {
              ok: false,
              code: answer.code,
              ...(answer.detail === undefined ? {} : { detail: answer.detail }),
            };
      } catch {
        return unavailable("the child close failed, so it is not known whether it closed");
      }
    },
  };
}
