// AETHERIA M05 Plan step 4: the strict managed-work contracts against the shared vectors (the outer codecs decode the same file).
// Each `accept` vector decodes unchanged and each `refuse` vector throws under `onExcessProperty: "error"`; operation names, the code list and the XC-6
// framing rules are checked too. Handlers, stores, the Backend module and the RPC wiring are later steps and are not exercised.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CHILDREN_AWAIT_REPORT_OPERATION,
  CHILDREN_CANCEL_OPERATION,
  CHILDREN_CLOSE_OPERATION,
  CHILDREN_FORK_OPERATION,
  CHILDREN_INTERRUPT_OPERATION,
  CHILDREN_LIST_OPERATION,
  CHILDREN_MESSAGE_OPERATION,
  CHILDREN_SPAWN_OPERATION,
  CHILDREN_STATUS_OPERATION,
  ChildrenAwaitReportArgs,
  ChildrenAwaitReportResult,
  ChildrenCancelArgs,
  ChildrenCancelResult,
  ChildrenCloseArgs,
  ChildrenCloseResult,
  ChildrenForkArgs,
  ChildrenForkResult,
  ChildrenInterruptArgs,
  ChildrenInterruptResult,
  ChildrenListArgs,
  ChildrenListResult,
  ChildrenMessageArgs,
  ChildrenMessageResult,
  ChildrenSpawnArgs,
  ChildrenSpawnResult,
  ChildrenStatusArgs,
  ChildrenStatusResult,
  JOBS_ADOPTED_OPERATION,
  JOBS_ATTACH_OPERATION,
  JOBS_CANCEL_OPERATION,
  JOBS_EXITED_OPERATION,
  JOBS_KILL_OPERATION,
  JOBS_LIST_OPERATION,
  JOBS_OUTPUT_OPERATION,
  JOBS_RESERVE_OPERATION,
  JobsAdoptedArgs,
  JobsAdoptedResult,
  JobsAttachArgs,
  JobsAttachResult,
  JobsCancelArgs,
  JobsCancelResult,
  JobsExitedArgs,
  JobsExitedResult,
  JobsKillArgs,
  JobsKillResult,
  JobsListArgs,
  JobsListResult,
  JobsOutputArgs,
  JobsOutputResult,
  JobsReserveArgs,
  JobsReserveResult,
  ORCHESTRATION_CODE_CLASSES,
  ORCHESTRATION_OPERATIONS,
  XC6_OPERATION_NAME_PATTERN,
} from "./index.ts";
import {
  orchestrationForbiddenAgentKeys,
  orchestrationVectors,
} from "./orchestrationOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;

const SCHEMAS = {
  childrenSpawnArgs: ChildrenSpawnArgs,
  childrenSpawnResult: ChildrenSpawnResult,
  childrenForkArgs: ChildrenForkArgs,
  childrenForkResult: ChildrenForkResult,
  childrenMessageArgs: ChildrenMessageArgs,
  childrenMessageResult: ChildrenMessageResult,
  childrenListArgs: ChildrenListArgs,
  childrenListResult: ChildrenListResult,
  childrenInterruptArgs: ChildrenInterruptArgs,
  childrenInterruptResult: ChildrenInterruptResult,
  childrenCloseArgs: ChildrenCloseArgs,
  childrenCloseResult: ChildrenCloseResult,
  childrenAwaitReportArgs: ChildrenAwaitReportArgs,
  childrenAwaitReportResult: ChildrenAwaitReportResult,
  childrenStatusArgs: ChildrenStatusArgs,
  childrenStatusResult: ChildrenStatusResult,
  childrenCancelArgs: ChildrenCancelArgs,
  childrenCancelResult: ChildrenCancelResult,
  jobsOutputArgs: JobsOutputArgs,
  jobsOutputResult: JobsOutputResult,
  jobsListArgs: JobsListArgs,
  jobsListResult: JobsListResult,
  jobsKillArgs: JobsKillArgs,
  jobsKillResult: JobsKillResult,
  jobsCancelArgs: JobsCancelArgs,
  jobsCancelResult: JobsCancelResult,
  jobsReserveArgs: JobsReserveArgs,
  jobsReserveResult: JobsReserveResult,
  jobsAttachArgs: JobsAttachArgs,
  jobsAttachResult: JobsAttachResult,
  jobsAdoptedArgs: JobsAdoptedArgs,
  jobsAdoptedResult: JobsAdoptedResult,
  jobsExitedArgs: JobsExitedArgs,
  jobsExitedResult: JobsExitedResult,
} as const;

const decoder = (schema: unknown) =>
  Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict);

describe("children.* and jobs.* XC-6 operations", () => {
  it("are named by the seventeen wire strings, each valid under the XC-6 name pattern, in the design's order", () => {
    expect(ORCHESTRATION_OPERATIONS).toEqual([
      "children.spawn",
      "children.fork",
      "children.message",
      "children.list",
      "children.interrupt",
      "children.close",
      "children.await-report",
      "children.status",
      "children.cancel",
      "jobs.output",
      "jobs.list",
      "jobs.kill",
      "jobs.cancel",
      "jobs.reserve",
      "jobs.attach",
      "jobs.adopted",
      "jobs.exited",
    ]);
    const named = [
      CHILDREN_SPAWN_OPERATION,
      CHILDREN_FORK_OPERATION,
      CHILDREN_MESSAGE_OPERATION,
      CHILDREN_LIST_OPERATION,
      CHILDREN_INTERRUPT_OPERATION,
      CHILDREN_CLOSE_OPERATION,
      CHILDREN_AWAIT_REPORT_OPERATION,
      CHILDREN_STATUS_OPERATION,
      CHILDREN_CANCEL_OPERATION,
      JOBS_OUTPUT_OPERATION,
      JOBS_LIST_OPERATION,
      JOBS_KILL_OPERATION,
      JOBS_CANCEL_OPERATION,
      JOBS_RESERVE_OPERATION,
      JOBS_ATTACH_OPERATION,
      JOBS_ADOPTED_OPERATION,
      JOBS_EXITED_OPERATION,
    ];
    expect(named).toEqual([...ORCHESTRATION_OPERATIONS]);
    for (const name of named) expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });

  it("have no operation for the four direct trusted-Backend calls", () => {
    for (const direct of ["admitTurn", "interruptTurn", "subscribeSettled", "cancelTree"]) {
      expect(ORCHESTRATION_OPERATIONS as readonly string[]).not.toContain(direct);
    }
    for (const name of ORCHESTRATION_OPERATIONS) expect(name).toMatch(/^(children|jobs)\./);
  });

  it("have one argument schema and one result schema per operation", () => {
    const keys = Object.keys(SCHEMAS).sort();
    expect(keys).toEqual(Object.keys(orchestrationVectors).sort());
    expect(keys).toHaveLength(ORCHESTRATION_OPERATIONS.length * 2);
  });

  it("class every code, with the design's twelve C1 codes (AUTH_* aside) and the codes this contract adds", () => {
    const c1 = [
      "CHILD_LIMIT",
      "CHILD_START_FAILED",
      "FORK_FAILED",
      "FORK_PARTIAL",
      "CHILD_NOT_OWNED",
      "CHILD_NOT_ADJACENT",
      "CHILD_NOT_RESUMABLE",
      "CHILD_DELIVERY_UNAVAILABLE",
      "CHILD_PARENT_UNAVAILABLE",
      "NOT_AUTHORIZED",
      "JOB_NOT_FOUND",
    ];
    for (const code of c1) expect(Object.keys(ORCHESTRATION_CODE_CLASSES)).toContain(code);
    expect(Object.keys(ORCHESTRATION_CODE_CLASSES).sort()).toEqual(
      [
        ...c1,
        "JOB_CONFLICT",
        "JOB_IDENTITY_MISMATCH",
        "ORCHESTRATION_UNAVAILABLE",
        "ABORTED",
      ].sort(),
    );
    expect(new Set(Object.values(ORCHESTRATION_CODE_CLASSES))).toEqual(
      new Set(["refusal", "conflict", "absence", "failure", "unavailable", "aborted"]),
    );
  });

  it.each(Object.entries(orchestrationVectors))(
    "%s: every accept vector decodes unchanged and every refuse vector is refused",
    (name, set) => {
      const schema = SCHEMAS[name as keyof typeof SCHEMAS];
      expect(schema, `no schema for ${name}`).toBeDefined();
      const decode = decoder(schema);
      for (const vector of set.accept) {
        expect(decode(structuredClone(vector.value)), `${name}: ${vector.name}`).toEqual(
          vector.value,
        );
      }
      for (const vector of set.refuse) {
        expect(() => decode(structuredClone(vector.value)), `${name}: ${vector.name}`).toThrow();
      }
    },
  );

  it("admit no caller, session, root, parent, authority or thread claim in any Agent argument", () => {
    const base: Record<string, unknown> = {
      childrenSpawnArgs: { role: "reviewer", prompt: "x", mode: "one-shot" },
      childrenForkArgs: { prefix: "all", prompt: "x", allow: ["read"] },
      childrenMessageArgs: { target: "t", content: "x" },
      childrenListArgs: { scope: "children" },
      childrenInterruptArgs: { target: "t" },
      childrenCloseArgs: { target: "t" },
      childrenAwaitReportArgs: { target: "t" },
      childrenStatusArgs: { childSessionId: "s" },
      childrenCancelArgs: { requestId: "r" },
      jobsOutputArgs: { jobId: "j" },
      jobsListArgs: {},
      jobsKillArgs: { jobId: "j" },
      jobsCancelArgs: { requestId: "r" },
      jobsReserveArgs: { runKey: "k", label: "l", mode: "background" },
      jobsAttachArgs: { jobId: "j", pid: 4, pgid: 4, startIdentity: { pid: 4, startTime: "t" } },
      jobsAdoptedArgs: { jobId: "j", via: "background" },
      jobsExitedArgs: { jobId: "j", exit: { code: 0, signal: null } },
    };
    expect(Object.keys(base).sort()).toEqual(
      Object.keys(SCHEMAS)
        .filter((key) => key.endsWith("Args"))
        .sort(),
    );
    for (const [name, value] of Object.entries(base)) {
      const decode = decoder(SCHEMAS[name as keyof typeof SCHEMAS]);
      expect(() => decode(structuredClone(value)), `${name}: the base value decodes`).not.toThrow();
      for (const key of orchestrationForbiddenAgentKeys) {
        expect(
          () => decode({ ...(value as object), [key]: "x" }),
          `${name} admitted ${key}`,
        ).toThrow();
      }
    }
  });

  it("carry neither the unavailable code nor an AUTH code in a done result", () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      if (!name.endsWith("Result")) continue;
      const decode = decoder(schema);
      for (const code of [
        "ORCHESTRATION_UNAVAILABLE",
        "AUTH_IDENTITY_UNAVAILABLE",
        "ROLE_GENERIC_DELEGATION",
      ]) {
        expect(() => decode({ ok: false, code }), `${name} admitted ${code}`).toThrow();
      }
    }
  });

  it("allow ABORTED only on the two waiting operations", () => {
    const allowed = ["childrenAwaitReportResult", "jobsOutputResult"];
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      if (!name.endsWith("Result")) continue;
      const decode = decoder(schema);
      const accepted = (() => {
        try {
          decode({ ok: false, code: "ABORTED" });
          return true;
        } catch {
          return false;
        }
      })();
      expect(accepted, name).toBe(allowed.includes(name));
    }
  });

  it("carry no credential, header, token or account field in an accepted vector", () => {
    const forbidden =
      /^(token|accessToken|refreshToken|apiKey|authorization_header|headers|account|accountId|secret|password|cookie|bearer)$/i;
    const walk = (value: unknown, where: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${where}[${index}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          expect(forbidden.test(key), `${where}.${key}`).toBe(false);
          walk(inner, `${where}.${key}`);
        }
      }
    };
    for (const [name, set] of Object.entries(orchestrationVectors)) {
      set.accept.forEach((vector) => walk(vector.value, `${name}/${vector.name}`));
    }
  });
});
