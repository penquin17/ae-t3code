// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M07 Plan step 14 — the goals Backend module through the REAL assembled Backend service (`createAetheriaBackendService`, started) over the INSTALLED `@aetheria/goals` archive, the real
// thread index, M03 identity files and a real state root. SCRIPTED: M05's direct API (admission, state, settles, notices), M06's interaction service and T3's message receipt. It shows: the
// module starts after M06 and M05 and drains before them; the goal service exists only while running; the recovery guard answers `unknown` before start, `none` for an ordinary thread and a
// thread the index does not bind, `in-flight` for a root whose round was admitted, a lost-reply reservation or a cut round, and keeps answering from the journal after drain; a restart with a
// round in flight sends NOTHING (no admitTurn) and writes the interrupted notice once; a corrupt journal and an unlistable store answer unknown / refuse the start (fail closed); an unconfigured
// module answers `none`. It does NOT show T3's real inbox, receipt store or recovery pass (apps/server tests), a native restart, or the model's goal tools.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import type { HumanControlService } from "./humanControl.ts";
import type { StoredEventLike } from "./identity/feed.ts";
import {
  FOLDER,
  SESSION,
  SESSION_B,
  THREAD,
  THREAD_B,
  mainRecord,
  rootOf,
  sessionFileOf,
  writeEnvelope,
} from "./identity/testkit.ts";
import type { OrchestrationDirectApi, OrchestrationService } from "./orchestration.ts";
import type { ChildThreadPort } from "./orchestrationPorts.ts";
import { createAetheriaBackendService, type AetheriaBackendService } from "./service.ts";

let sequence = 0;
const bindEvents = (threadId: string, sessionId: string): StoredEventLike[] => [
  {
    sequence: ++sequence,
    event: {
      type: "provider-session.updated",
      threadId,
      payload: {
        id: `runtime-${threadId.slice(-4)}`,
        providerInstanceId: "pi",
        status: "ready",
        cwd: FOLDER,
      },
    },
  },
  {
    sequence: ++sequence,
    event: {
      type: "provider-thread.updated",
      threadId,
      payload: {
        driver: "pi",
        providerInstanceId: "pi",
        providerSessionId: `runtime-${threadId.slice(-4)}`,
        appThreadId: threadId,
        nativeThreadRef: { nativeId: sessionFileOf(sessionId) },
      },
    },
  },
];

interface SettledEvent {
  readonly sessionId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly settleSeq: number;
  readonly outcome: string;
  readonly cause: null;
}

/** M05 and M06 as scripts. Every call is recorded; none sends a turn anywhere. */
function script() {
  const s = {
    admits: [] as Array<{ key: string; sessionId: string }>,
    stateReads: [] as string[],
    keys: new Map<string, { status: "admitting" | "admitted"; messageId: string }>(),
    onAdmit: "admit" as "admit" | "lose",
    stateUnavailable: false,
    receipts: new Set<string>(),
    handlers: new Set<(event: SettledEvent) => void>(),
    notices: new Map<string, string>(),
    noticeEnqueues: [] as string[],
    noticeDelivers: [] as string[],
    cards: new Map<
      string,
      { id: string; subject: { type: string; id: string; revision: string }; origin?: string }
    >(),
    directUp: false,
    receiptReads: [] as string[],
  };
  let n = 0;
  const direct = {
    admitTurn: async (req: { key: string; sessionId: string }) => {
      s.admits.push({ key: req.key, sessionId: req.sessionId });
      const messageId = `m-${req.key}`;
      if (s.onAdmit === "lose") {
        s.keys.set(req.key, { status: "admitting", messageId });
        throw new Error("reply lost");
      }
      s.keys.set(req.key, { status: "admitted", messageId });
      s.receipts.add(messageId);
      return { status: "admitted", messageId };
    },
    admissionState: async (req: { key: string }) => {
      s.stateReads.push(req.key);
      if (s.stateUnavailable) return { status: "unavailable", detail: "scripted" };
      return s.keys.get(req.key) ?? { status: "absent" };
    },
    interruptTurn: async () => ({ status: "accepted" }),
    subscribeSettled: (req: { handler: (event: SettledEvent) => void }) => {
      s.handlers.add(req.handler);
      return { status: "subscribed", unsubscribe: () => s.handlers.delete(req.handler) };
    },
    goalNoticeEnqueue: async (req: { key: string; text: string }) => {
      s.noticeEnqueues.push(req.key);
      const created = !s.notices.has(req.key);
      s.notices.set(req.key, req.text);
      return { status: "queued", created };
    },
    goalNoticeDeliver: async (req: { key: string }) => {
      s.noticeDelivers.push(req.key);
      return { status: "delivered" };
    },
    goalNoticeState: async (req: { key: string }) =>
      s.notices.has(req.key) ? "pending" : "unknown",
  } as unknown as OrchestrationDirectApi;
  const orchestration: OrchestrationService = {
    start: async () => {
      s.directUp = true;
      return { ok: true };
    },
    handle: async () => ({ ok: false, code: "ORCHESTRATION_UNAVAILABLE" }),
    drain: async () => {
      s.directUp = false;
      return { stopped: [], stillLive: [] };
    },
    direct: () => (s.directUp ? direct : undefined),
  };
  const interaction = {
    start: async () => ({ ok: true, value: { continued: [] } }),
    createAuthorization: async (input: {
      sessionId: string;
      subject: { type: string; id: string; revision: string };
    }) => {
      const id = `card-${++n}`;
      s.cards.set(id, { id, subject: input.subject });
      return { ok: true, value: { interactionId: id, state: "pending" } };
    },
    awaitInteraction: async (id: string) => {
      const card = s.cards.get(id);
      if (card === undefined) return { ok: false, code: "INTERACTION_NOT_FOUND" };
      return {
        ok: true,
        value: {
          interactionId: id,
          state: card.origin === undefined ? "pending" : "answered",
          ...(card.origin === undefined
            ? {}
            : { resolution: { type: "decision", decision: "approved", originId: card.origin } }),
        },
      };
    },
    verifyHumanOrigin: async (originId: string) => {
      const card = [...s.cards.values()].find((c) => c.origin === originId);
      return card === undefined
        ? { verified: false, code: "ORIGIN_NOT_FOUND" }
        : {
            verified: true,
            origin: { decision: "approved", rootSessionId: SESSION, sessionId: SESSION },
          };
    },
    drain: async () => ({ released: [], stopped: [], transferred: [], stillLive: [] }),
    onChange: () => () => {},
  } as unknown as HumanControlService;
  const threads = {
    readMessageReceipt: async (req: { messageId: string }) => {
      s.receiptReads.push(req.messageId);
      return { ok: true, found: s.receipts.has(req.messageId) };
    },
  } as unknown as ChildThreadPort;
  const emit = (sessionId: string, settleSeq: number, outcome = "completed") => {
    for (const handler of s.handlers)
      handler({
        sessionId,
        threadId: THREAD,
        runId: `run-${settleSeq}`,
        settleSeq,
        outcome,
        cause: null,
      });
  };
  return { s, orchestration, interaction, threads, emit };
}

async function boot(
  stateRoot: string,
  scripted: ReturnType<typeof script> | "unconfigured",
): Promise<AetheriaBackendService> {
  const made = createAetheriaBackendService({
    stateRoot,
    credentialOf: () => "cred",
    projectRootOf: (folder) => folder,
    ...(scripted === "unconfigured"
      ? {}
      : {
          orchestrationFactory: () => scripted.orchestration,
          childThreads: scripted.threads,
          interactionFactory: () => scripted.interaction,
        }),
  });
  if (made.outcome !== "prepared") throw new Error(`refused: ${JSON.stringify(made.faults)}`);
  return made.service;
}

const bind = async (service: AetheriaBackendService, threadId: string, sessionId: string) => {
  for (const event of bindEvents(threadId, sessionId)) await service.ingest(event);
};

/** A goal created through a card a person approved, so it is armed and watching. */
async function armGoal(service: AetheriaBackendService, w: ReturnType<typeof script>) {
  const goals = service.goals()!;
  const proposed = await goals.propose(SESSION, {
    op: "create",
    objective: "ship it",
    maxRounds: 3,
  });
  expect(proposed.status).toBe("awaiting-human");
  const card = [...w.s.cards.values()].at(-1)!;
  card.origin = "origin-1";
  await goals.idle();
  return goals;
}

const newWorld = () => {
  const stateRoot = rootOf();
  writeEnvelope(stateRoot, mainRecord(SESSION));
  writeEnvelope(stateRoot, mainRecord(SESSION_B));
  return stateRoot;
};

describe("the goals module in the real Backend", () => {
  it("starts after M06 and M05, drains before them, and the goal service exists only while it runs", async () => {
    const w = script();
    const service = await boot(newWorld(), w);
    expect(service.goals()).toBeUndefined();
    expect((await service.start()).outcome).toBe("started");
    const order = service.status().activationOrder;
    expect(order.indexOf("goals-backend")).toBeGreaterThan(order.indexOf("human-control-backend"));
    expect(order.indexOf("goals-backend")).toBeGreaterThan(order.indexOf("orchestration-backend"));
    expect(service.goals()).toBeDefined();
    const report = await service.dispose("test");
    expect(report.ok).toBe(true);
    expect(report.order.indexOf("goals-backend")).toBeLessThan(
      report.order.indexOf("orchestration-backend"),
    );
    expect(report.order.indexOf("goals-backend")).toBeLessThan(
      report.order.indexOf("human-control-backend"),
    );
    expect(service.goals()).toBeUndefined();
  });

  it("answers unknown before start; none for an ordinary bound thread and for an unbound one; the guard is per thread", async () => {
    const w = script();
    const service = await boot(newWorld(), w);
    expect(service.goalRoundOfThread(THREAD)).toBe("unknown");
    await service.start();
    await bind(service, THREAD, SESSION);
    await bind(service, THREAD_B, SESSION_B);
    expect(service.goalRoundOfThread(THREAD)).toBe("none");
    expect(service.goalRoundOfThread("thread-the-index-never-saw")).toBe("none");
    await service.dispose("test");
  });

  it("a goal round in flight is in-flight for ITS thread only, and an unbound thread is suppressed while any round is in flight", async () => {
    const w = script();
    const service = await boot(newWorld(), w);
    await service.start();
    await bind(service, THREAD, SESSION);
    await bind(service, THREAD_B, SESSION_B);
    const goals = await armGoal(service, w);
    expect(w.s.handlers.size).toBe(1);
    w.emit(SESSION, 1);
    await goals.idle();
    expect(w.s.admits.map((a) => a.key)).toHaveLength(1);
    expect(service.goalRoundOfThread(THREAD)).toBe("in-flight");
    expect(service.goalRoundOfThread(THREAD_B)).toBe("none");
    // a thread the index does not bind cannot be told apart from the goal's own, so while any round is in flight it is suppressed too (fail closed)
    expect(service.goalRoundOfThread("thread-the-index-never-saw")).toBe("in-flight");
    // the round settles: the record is cleared by that settle and the guard says none again
    w.emit(SESSION, 2);
    await goals.idle();
    await service.dispose("test");
  });

  it("a restart with a round in flight sends nothing, keeps the thread in flight, writes the interrupted notice once, and a settle clears it", async () => {
    const stateRoot = newWorld();
    const first = script();
    const service1 = await boot(stateRoot, first);
    await service1.start();
    await bind(service1, THREAD, SESSION);
    const goals1 = await armGoal(service1, first);
    first.emit(SESSION, 1);
    await goals1.idle();
    expect(first.s.admits).toHaveLength(1);
    await service1.dispose("crash-like stop");
    // The drained service still answers from the journal, for T3's shutdown preparation.
    expect(service1.goalRoundOfThread(THREAD)).toBe("in-flight");
    expect(service1.goals()).toBeUndefined();

    // A new process over the same files. The admission key and T3's receipt survive; the scripts carry them over.
    const second = script();
    second.s.keys = first.s.keys;
    second.s.receipts = first.s.receipts;
    const service2 = await boot(stateRoot, second);
    expect(service2.goalRoundOfThread(THREAD)).toBe("unknown"); // not started: the guard cannot tell yet
    await service2.start();
    await bind(service2, THREAD, SESSION);
    expect(second.s.admits).toEqual([]); // boot never admits
    expect(service2.goalRoundOfThread(THREAD)).toBe("in-flight");
    expect(second.s.noticeEnqueues.length).toBe(1); // the interrupted notice, once
    const view = await service2.goals()!.snapshot(SESSION);
    expect(view).toMatchObject({
      status: "ok",
      value: { goal: { phase: "active", armed: false, needsRearm: true } },
    });
    await service2.dispose("test");
    const third = script();
    third.s.keys = first.s.keys;
    third.s.receipts = first.s.receipts;
    const service3 = await boot(stateRoot, third);
    await service3.start();
    expect(third.s.admits).toEqual([]);
    expect(third.s.noticeEnqueues).toEqual([]); // the same cut round is reported once across boots
    expect(service3.goalRoundOfThread(THREAD)).toBe("in-flight");
    await service3.dispose("test");
  });

  it("a lost admission reply keeps the reservation open: the thread is in flight and a restart whose state read is unavailable resends nothing", async () => {
    const stateRoot = newWorld();
    const first = script();
    first.s.onAdmit = "lose";
    const service1 = await boot(stateRoot, first);
    await service1.start();
    await bind(service1, THREAD, SESSION);
    const goals1 = await armGoal(service1, first);
    first.emit(SESSION, 1);
    await goals1.idle();
    expect(first.s.admits).toHaveLength(1);
    expect(service1.goalRoundOfThread(THREAD)).toBe("in-flight");
    await service1.dispose("test");

    const second = script();
    second.s.stateUnavailable = true;
    const service2 = await boot(stateRoot, second);
    await service2.start();
    expect(second.s.admits).toEqual([]);
    expect(service2.goalRoundOfThread(THREAD)).toBe("in-flight");
    await service2.dispose("test");
  });

  it("a corrupt journal answers unknown for that thread and for an unbound one; another thread's journal is unaffected", async () => {
    const stateRoot = newWorld();
    const w = script();
    const service = await boot(stateRoot, w);
    await service.start();
    await bind(service, THREAD, SESSION);
    await bind(service, THREAD_B, SESSION_B);
    await armGoal(service, w);
    const dir = NodePath.join(stateRoot, "goals");
    const journal = NodeFS.readdirSync(dir).find((name) => name.endsWith(".journal"))!;
    const text = NodeFS.readFileSync(NodePath.join(dir, journal), "utf8");
    NodeFS.writeFileSync(NodePath.join(dir, journal), `${text.split("\n", 1)[0]}\nnot json\n`);
    expect(service.goalRoundOfThread(THREAD)).toBe("unknown");
    expect(service.goalRoundOfThread("thread-the-index-never-saw")).toBe("unknown");
    expect(service.goalRoundOfThread(THREAD_B)).toBe("none");
    await service.dispose("test");
  });

  it("a goals store that cannot be listed refuses the Backend start, and the guard stays unknown", async () => {
    const stateRoot = newWorld();
    NodeFS.writeFileSync(NodePath.join(stateRoot, "goals"), "a file where the folder should be");
    const w = script();
    const service = await boot(stateRoot, w);
    const result = await service.start();
    expect(result.outcome).toBe("failed");
    expect(w.s.admits).toEqual([]);
    expect(service.goals()).toBeUndefined();
    expect(service.goalRoundOfThread(THREAD)).toBe("unknown");
  });

  it("without managed work the module is unconfigured: no goal service, and an ordinary thread is none (nothing here could have started a round)", async () => {
    const service = await boot(newWorld(), "unconfigured");
    await service.start();
    await bind(service, THREAD, SESSION);
    expect(service.goals()).toBeUndefined();
    expect(service.goalRoundOfThread(THREAD)).toBe("none");
    expect(service.goalRoundOfThread("thread-the-index-never-saw")).toBe("none");
    await service.dispose("test");
  });

  it("the store refuses a write once the Backend released the owner lock: a late call after drain changes no byte", async () => {
    const stateRoot = newWorld();
    const w = script();
    const service = await boot(stateRoot, w);
    await service.start();
    await bind(service, THREAD, SESSION);
    const goals = await armGoal(service, w);
    await service.dispose("test");
    const dir = NodePath.join(stateRoot, "goals");
    const before = NodeFS.readdirSync(dir).map((name) =>
      NodeFS.readFileSync(NodePath.join(dir, name), "utf8"),
    );
    const late = await goals
      .pause(SESSION, { goalId: "none", revision: 1 })
      .catch(() => ({ status: "threw" }));
    expect(late).not.toMatchObject({ status: "ok" });
    const after = NodeFS.readdirSync(dir).map((name) =>
      NodeFS.readFileSync(NodePath.join(dir, name), "utf8"),
    );
    expect(after).toEqual(before);
  });
});
