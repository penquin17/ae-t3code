// AETHERIA M07 Plan step 17 — shared fixtures for the goal operation and client-RPC tests (not production code; nothing outside tests imports it).
//
// One REAL goal runtime (`createGoalsRuntime`) over the INSTALLED `@aetheria/goals` archive's real goal service and store (a real temporary state root), with its ports scripted: the session resolver (one main
// root, one child, one unreadable session), M06's card (a deferred answer a test settles; the verification compares the full subject), M05's admission and settles, T3's receipt and the notice outbox.
import type {
  GoalParameterValues,
  InteractionPort,
  RootResolver,
  SettledEvent,
} from "./goalsEntry.ts";
import { createGoalsRuntime, type GoalsRuntime } from "./factory.ts";
import { rootOf } from "../identity/testkit.ts";

export const MODULE = { id: "goals-backend" };
export const MAIN = "session-main";
export const CHILD = "session-child";
export const UNREADABLE = "session-unreadable";

interface Card {
  readonly subject: { readonly type: string; readonly id: string; readonly revision: string };
  readonly sessionId: string;
  origin?: string;
  readonly waiters: Array<(view: unknown) => void>;
}

/** M06, M05 and T3 as scripts. Every admitted round is recorded; no card is answered unless the test does it. */
export function world() {
  const cards = new Map<string, Card>();
  const admits: string[] = [];
  const handlers = new Set<(event: SettledEvent) => void>();
  /** Every origin id a verification was asked about, and the subject each asked for. */
  const verified: Array<{ originId: string; subjectId: string; sessionId: string }> = [];
  let sequence = 0;
  const resolver: RootResolver = {
    resolve: (sessionId) =>
      sessionId === MAIN
        ? { kind: "main", rootSessionId: MAIN }
        : sessionId === CHILD
          ? { kind: "child", rootSessionId: MAIN }
          : { kind: "unavailable", reason: "unreadable" },
  };
  const interaction: InteractionPort = {
    createAuthorization: async (input) => {
      const interactionId = `card-${++sequence}`;
      cards.set(interactionId, { subject: input.subject, sessionId: input.sessionId, waiters: [] });
      return { ok: true, value: { interactionId, state: "pending" } };
    },
    awaitInteraction: (interactionId) =>
      new Promise((resolve) => {
        const card = cards.get(interactionId);
        if (card === undefined) return resolve({ ok: false, code: "INTERACTION_NOT_FOUND" });
        card.waiters.push((view) =>
          resolve({ ok: true, value: view as { interactionId: string; state: string } }),
        );
      }),
    verifyHumanOrigin: async (originId, expectation) => {
      verified.push({
        originId,
        subjectId: expectation.subject.id,
        sessionId: expectation.sessionId,
      });
      const card = [...cards.values()].find((c) => c.origin === originId);
      if (card === undefined) return { verified: false, code: "ORIGIN_NOT_FOUND" };
      if (
        card.subject.id !== expectation.subject.id ||
        card.subject.revision !== expectation.subject.revision
      )
        return { verified: false, code: "ORIGIN_MISMATCH", field: "subject" };
      return {
        verified: true,
        origin: { decision: "approved", rootSessionId: MAIN, sessionId: card.sessionId },
      };
    },
  };
  /** A person approves a card: its waiter learns the origin id (which only the Backend ever sees). */
  const approve = (interactionId: string) => {
    const card = cards.get(interactionId)!;
    card.origin = `origin-${interactionId}`;
    for (const waiter of card.waiters.splice(0))
      waiter({ interactionId, state: "answered", originId: card.origin });
  };
  /** A person's own grant for a subject (the Re-arm click): the card exists, is approved, and its origin id is returned to the client only. */
  const grant = (subject: Card["subject"], sessionId = MAIN): string => {
    const interactionId = `grant-${++sequence}`;
    const origin = `origin-${interactionId}`;
    cards.set(interactionId, { subject, sessionId, origin, waiters: [] });
    return origin;
  };
  const release = () => {
    for (const [interactionId, card] of cards)
      for (const waiter of card.waiters.splice(0)) waiter({ interactionId, state: "closed" });
  };
  const deps = {
    resolver,
    interaction,
    admission: {
      admitTurn: async (request: { key: string }) => {
        admits.push(request.key);
        return { status: "admitted" as const, messageId: `m-${request.key}` };
      },
      admissionState: async () => ({ status: "absent" as const }),
      interruptTurn: async () => ({ status: "accepted" as const }),
      subscribeSettled: (request: { handler: (event: SettledEvent) => void }) => {
        handlers.add(request.handler);
        return {
          status: "subscribed" as const,
          unsubscribe: () => void handlers.delete(request.handler),
        };
      },
    },
    receipts: { hasMessage: async () => "present" as const },
    notices: {
      enqueue: async () => ({ status: "queued" as const, created: true }),
      deliver: async () => ({ status: "delivered" as const }),
      state: async () => "pending" as const,
    },
  };
  const settle = (settleSeq: number) => {
    for (const handler of handlers)
      handler({ sessionId: MAIN, settleSeq, outcome: "completed", cause: null });
  };
  return { cards, admits, verified, deps, approve, grant, release, settle };
}

export type World = ReturnType<typeof world>;

/** A real runtime over the scripted ports, with a real temporary state root (removed by the identity testkit's afterAll). */
export const runtimeOf = (
  w: World,
  parameters: GoalParameterValues = { defaultMaxRounds: 5, blockedAfterConsecutiveRounds: 1 },
): GoalsRuntime =>
  createGoalsRuntime({
    stateRoot: rootOf(),
    now: () => 1_700_000_000_000,
    assertHeld: () => {},
    parameters,
    ...w.deps,
  });

/** The person approves the card the last proposal wrote, and the service commits. */
export async function approveLast(w: World, runtime: GoalsRuntime): Promise<void> {
  w.approve([...w.cards.keys()].at(-1)!);
  await runtime.service.idle();
}
