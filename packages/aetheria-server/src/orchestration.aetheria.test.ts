// AETHERIA M05 step 6 (C10, D20): the `orchestration-backend` module's 17 strict XC-6 operations over one injected service, driven through its operation table.
// The ONLY double is a scripted children service. Shows strict decoding, carrier identity, reply-class mapping, lifecycle and `unavailable`; no child behaviour.
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ORCHESTRATION_OPERATIONS,
  type Xc6OperationContext,
  type Xc6OperationResult,
} from "@t3tools/aetheria-contracts";

import {
  createOrchestrationBackendRegistration,
  ORCHESTRATION_UNAVAILABLE_CODE,
  type OrchestrationService,
} from "./orchestration.ts";
import { ORCHESTRATION_PINNED_ARTIFACT, PINNED_ARTIFACT_STAMPS } from "./artifact.ts";
import { ORCHESTRATION_BACKEND_ENTRY, orchestrationBackendModuleRow } from "./orchestrationRow.ts";

const context = (
  args: Record<string, unknown> = {},
  overrides: Partial<Xc6OperationContext> = {},
): Xc6OperationContext => ({
  caller: { threadId: "thread-1", providerSessionId: "cred-1", providerInstanceId: "pi" },
  sessionId: "session-1",
  kind: "main",
  rootSessionId: "root-1",
  args,
  ...overrides,
});

/** Valid arguments per operation, so an unavailable answer is not confused with a rejected argument. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  "children.spawn": { role: "reviewer", prompt: "look", mode: "one-shot" },
  "children.fork": { prefix: "all", prompt: "go", allow: ["read"] },
  "children.message": { target: "t-1", content: "hi" },
  "children.list": { scope: "children" },
  "children.interrupt": { target: "t-1" },
  "children.close": { target: "t-1" },
  "children.await-report": { target: "t-1" },
  "children.status": { childSessionId: "s-9" },
  "children.cancel": { requestId: "r-1" },
  "jobs.output": { jobId: "j-1" },
  "jobs.list": {},
  "jobs.kill": { jobId: "j-1" },
  "jobs.cancel": { requestId: "r-1" },
  "jobs.reserve": { runKey: "k-1", label: "build", mode: "background" },
  "jobs.attach": {
    jobId: "j-1",
    pid: 10,
    pgid: 10,
    startIdentity: { pid: 10, startTime: "Mon 1" },
  },
  "jobs.adopted": { jobId: "j-1", via: "background" },
  "jobs.exited": { jobId: "j-1", exit: { code: 0, signal: null } },
};

const drained = { stopped: [], stillLive: [] };

interface Fake {
  readonly service: OrchestrationService;
  readonly calls: Array<{ operation: string; who: unknown; args: unknown }>;
  readonly starts: () => number;
  readonly drains: () => number;
}
const makeFake = (
  handle: (operation: string, who: unknown, args: unknown) => Promise<unknown> = async () => ({
    ok: true,
    value: {},
  }),
  start: OrchestrationService["start"] = async () => ({ ok: true }),
): Fake => {
  const calls: Fake["calls"] = [];
  let starts = 0;
  let drains = 0;
  const service: OrchestrationService = {
    start: async () => {
      starts += 1;
      return start();
    },
    handle: (async (operation: string, who: unknown, args: unknown) => {
      calls.push({ operation, who, args });
      return handle(operation, who, args);
    }) as OrchestrationService["handle"],
    drain: async () => {
      drains += 1;
      return drained;
    },
    direct: () => undefined,
  };
  return { service, calls, starts: () => starts, drains: () => drains };
};

const run = async (
  operations: ReturnType<typeof createOrchestrationBackendRegistration>["operations"],
  name: string,
  ctx: Xc6OperationContext,
): Promise<Xc6OperationResult> => {
  const operation = operations?.[name];
  if (operation === undefined) throw new Error(`operation ${name} is not registered`);
  return operation(ctx);
};

describe("orchestration Backend module — registration", () => {
  it("serves exactly the seventeen managed-work operations and names the allowlisted entry", () => {
    const registration = createOrchestrationBackendRegistration({});
    expect(registration.entry).toBe(ORCHESTRATION_BACKEND_ENTRY);
    expect(Object.keys(registration.operations ?? {}).sort()).toEqual(
      [...ORCHESTRATION_OPERATIONS].sort(),
    );
    expect(ORCHESTRATION_OPERATIONS).toHaveLength(17);
    // Direct Backend calls never become operations.
    for (const direct of ["admitTurn", "interruptTurn", "subscribeSettled", "cancelTree"])
      expect(registration.operations).not.toHaveProperty(direct);
  });

  it("the row names the fifth archive this build carries by default, and carries another stamp when given", () => {
    const bare = orchestrationBackendModuleRow() as {
      compat: { artifacts: Record<string, { stamp: string }> };
    };
    expect(bare.compat.artifacts).toEqual({
      "@aetheria/orchestration": {
        stamp: "sha256:e4f52060c1e7e5a2750d4b649f1adb45666cb78b8894785254660692ca454b45",
      },
    });
    expect(ORCHESTRATION_PINNED_ARTIFACT.stamp).toBe(
      bare.compat.artifacts["@aetheria/orchestration"]!.stamp,
    );
    expect(PINNED_ARTIFACT_STAMPS["@aetheria/orchestration"]).toBe(
      ORCHESTRATION_PINNED_ARTIFACT.stamp,
    );
    const stamp = `sha256:${"b".repeat(64)}`;
    const stamped = orchestrationBackendModuleRow({ stamp }) as {
      compat: { artifacts: Record<string, { stamp: string }> };
    };
    expect(stamped.compat.artifacts["@aetheria/orchestration"]).toEqual({ stamp });
  });
});

describe("orchestration Backend module — unavailable until a service is injected", () => {
  it("answers unavailable for every operation when no service is configured, never a success", async () => {
    const registration = createOrchestrationBackendRegistration({});
    await registration.activation.start({ id: "orchestration-backend" });
    for (const name of ORCHESTRATION_OPERATIONS) {
      const answer = await run(registration.operations!, name, context(VALID_ARGS[name]));
      expect(answer, name).toEqual({ status: "unavailable", code: ORCHESTRATION_UNAVAILABLE_CODE });
    }
    expect(registration.service()).toBeUndefined();
  });

  it("answers unavailable before start and after drain even with a service configured", async () => {
    const fake = makeFake();
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    expect(
      await run(registration.operations!, "children.list", context({ scope: "children" })),
    ).toEqual({ status: "unavailable", code: ORCHESTRATION_UNAVAILABLE_CODE });
    await registration.activation.start({ id: "orchestration-backend" });
    expect(
      (await run(registration.operations!, "children.list", context({ scope: "children" }))).status,
    ).toBe("done");
    await registration.activation.drain("test");
    expect(
      await run(registration.operations!, "children.list", context({ scope: "children" })),
    ).toEqual({ status: "unavailable", code: ORCHESTRATION_UNAVAILABLE_CODE });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("orchestration Backend module — strict arguments and identity", () => {
  it("rejects an unknown or identity-claiming key before the service runs, for every operation", async () => {
    const fake = makeFake();
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });
    for (const name of ORCHESTRATION_OPERATIONS) {
      for (const key of ["sessionId", "rootSessionId", "parentId", "caller", "authority"]) {
        await expect(
          Promise.resolve().then(() =>
            run(registration.operations!, name, context({ ...VALID_ARGS[name], [key]: "x" })),
          ),
          `${name} accepted ${key}`,
        ).rejects.toThrow();
      }
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a malformed argument even while the service is not running", async () => {
    const registration = createOrchestrationBackendRegistration({});
    await expect(
      Promise.resolve().then(() =>
        run(registration.operations!, "children.spawn", context({ prompt: "x" })),
      ),
    ).rejects.toThrow();
  });

  it("passes the carrier's verified identity, not the arguments, to the service", async () => {
    const fake = makeFake();
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });
    await run(
      registration.operations!,
      "children.spawn",
      context(VALID_ARGS["children.spawn"], {
        sessionId: "child-session",
        rootSessionId: "the-root",
        kind: "child",
      }),
    );
    expect(fake.calls).toEqual([
      {
        operation: "children.spawn",
        who: { sessionId: "child-session", rootSessionId: "the-root", kind: "child" },
        args: VALID_ARGS["children.spawn"],
      },
    ]);
  });

  it("answers unavailable, without calling the service, when the verified identity is partial", async () => {
    const fake = makeFake();
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });
    for (const partial of [{ kind: "" }, { rootSessionId: "" }, { sessionId: "" }]) {
      expect(
        await run(
          registration.operations!,
          "children.list",
          context({ scope: "children" }, partial),
        ),
      ).toEqual({ status: "unavailable", code: ORCHESTRATION_UNAVAILABLE_CODE });
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe("orchestration Backend module — reply classes", () => {
  const answerFor = async (reply: unknown) => {
    const fake = makeFake(async () => reply);
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });
    return run(registration.operations!, "children.interrupt", context({ target: "t-1" }));
  };

  it("carries success and operation failures in done, M03 codes as refused, and the unavailable code as unavailable", async () => {
    expect(await answerFor({ ok: true, value: { accepted: true } })).toEqual({
      status: "done",
      result: { ok: true, value: { accepted: true } },
    });
    expect(await answerFor({ ok: false, code: "NOT_AUTHORIZED" })).toEqual({
      status: "done",
      result: { ok: false, code: "NOT_AUTHORIZED" },
    });
    expect(await answerFor({ ok: false, code: "AUTH_IDENTITY_UNAVAILABLE" })).toEqual({
      status: "refused",
      code: "AUTH_IDENTITY_UNAVAILABLE",
    });
    expect(await answerFor({ ok: false, code: "ROLE_NOT_ALLOWED" })).toEqual({
      status: "refused",
      code: "ROLE_NOT_ALLOWED",
    });
    expect(await answerFor({ ok: false, code: ORCHESTRATION_UNAVAILABLE_CODE })).toEqual({
      status: "unavailable",
      code: ORCHESTRATION_UNAVAILABLE_CODE,
    });
  });

  it("never reports success for a lost or malformed service reply", async () => {
    const lost = makeFake(async () => {
      throw new Error("channel lost");
    });
    const registration = createOrchestrationBackendRegistration({ create: () => lost.service });
    await registration.activation.start({ id: "orchestration-backend" });
    expect(
      await run(registration.operations!, "children.interrupt", context({ target: "t-1" })),
    ).toEqual({ status: "unavailable", code: ORCHESTRATION_UNAVAILABLE_CODE });
    expect(await answerFor("fine")).toEqual({
      status: "unavailable",
      code: ORCHESTRATION_UNAVAILABLE_CODE,
    });
    expect(await answerFor({ ok: false })).toEqual({
      status: "unavailable",
      code: ORCHESTRATION_UNAVAILABLE_CODE,
    });
  });
});

describe("orchestration Backend module — long waits", () => {
  it("answers pending with a settle promise for children.await-report and jobs.output with wait; a plain jobs.output is done", async () => {
    const fake = makeFake(async () => ({ ok: true, value: { waited: true } }));
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });

    const awaited = await run(
      registration.operations!,
      "children.await-report",
      context({ target: "t-1", requestId: "r-1" }),
    );
    expect(awaited.status).toBe("pending");
    if (awaited.status === "pending")
      expect(await awaited.settle).toEqual({
        status: "done",
        result: { ok: true, value: { waited: true } },
      });

    const waited = await run(
      registration.operations!,
      "jobs.output",
      context({ jobId: "j-1", wait: true, requestId: "r-2" }),
    );
    expect(waited.status).toBe("pending");
    const plain = await run(registration.operations!, "jobs.output", context({ jobId: "j-1" }));
    expect(plain.status).toBe("done");
  });

  it("a pending wait whose service call fails settles unavailable, and drain aborts the waits it passed a signal to", async () => {
    let seen: AbortSignal | undefined;
    const service: OrchestrationService = {
      start: async () => ({ ok: true }),
      handle: ((_op: string, _who: unknown, _args: unknown, options?: { signal?: AbortSignal }) => {
        seen = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }) as OrchestrationService["handle"],
      drain: async () => drained,
      direct: () => undefined,
    };
    const registration = createOrchestrationBackendRegistration({ create: () => service });
    await registration.activation.start({ id: "orchestration-backend" });
    const waiting = await run(
      registration.operations!,
      "children.await-report",
      context({ target: "t-1" }),
    );
    expect(waiting.status).toBe("pending");
    await registration.activation.drain("test");
    expect(seen?.aborted).toBe(true);
    if (waiting.status === "pending")
      expect(await waiting.settle).toEqual({
        status: "unavailable",
        code: ORCHESTRATION_UNAVAILABLE_CODE,
      });
  });
});

describe("orchestration Backend module — lifecycle", () => {
  it("starts the service once and drains once, returning its report", async () => {
    const fake = makeFake();
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await registration.activation.start({ id: "orchestration-backend" });
    expect(fake.starts()).toBe(1);
    expect(registration.service()).toBe(fake.service);
    expect(await registration.activation.drain("test")).toMatchObject(drained);
    await registration.activation.drain("test");
    expect(fake.drains()).toBe(1);
    expect(registration.service()).toBeUndefined();
  });

  it("a service that does not start refuses the module's start and leaves it not running, and drain still reaches it", async () => {
    const fake = makeFake(undefined, async () => ({
      ok: false,
      code: "STORE_UNSUPPORTED",
      detail: "newer",
    }));
    const registration = createOrchestrationBackendRegistration({ create: () => fake.service });
    await expect(registration.activation.start({ id: "orchestration-backend" })).rejects.toThrow(
      /STORE_UNSUPPORTED/,
    );
    expect(registration.service()).toBeUndefined();
    await registration.activation.drain("test");
    expect(fake.drains()).toBe(1);
  });

  it("a module with no service drains to an empty report", async () => {
    const registration = createOrchestrationBackendRegistration({});
    await registration.activation.start({ id: "orchestration-backend" });
    const spy = vi.fn();
    expect(await registration.activation.drain("test")).toEqual({
      released: [],
      stopped: [],
      transferred: [],
      stillLive: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
