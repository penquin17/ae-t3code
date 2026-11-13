// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off globalDate:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off runEffectInsideEffect:off
/* oxlint-disable t3code/no-manual-effect-runtime-in-tests -- the handler's Effect is run to a value the way humanControlClient.aetheria.test.ts runs it: plain async tests over fakes, no layers to provide. */
// M10 review 1, 4a: a live root's snapshot names the roots its thread replaced (only those the connection may read); a replaced root's own names none.
// Boundary: the real handler and contract encoding over a FAKE interaction service and a FAKE index shaped like `aliasOfSession`; the assembled Backend is not run.
// An index that cannot answer is unavailable, never an empty list.
import { InteractionsSnapshotResult } from "@t3tools/aetheria-contracts";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { connectionActor, interactionsSnapshot } from "./humanControlRpc.ts";

const encodeReply = Schema.encodeUnknownSync(InteractionsSnapshotResult);
type Json = Record<string, any>; // replies are checked field by field; the wire shapes are the contracts' own

const THREAD = "thread-1";
/** The thread's live root, then the two roots it replaced (oldest first, as the index lists them). */
const LIVE = "root-live";
const OLD_1 = "root-old-1";
const OLD_2 = "root-old-2";

const aliasIndex = (retired: readonly string[], fails = false) => ({
  aliasOfSession: (sessionId: string) => {
    if (fails) throw new Error("index down");
    const binding = {
      threadId: THREAD,
      sessionId: LIVE,
      ...(retired.length === 0 ? {} : { retired: retired.map((id) => ({ sessionId: id })) }),
    };
    if (sessionId === LIVE) return { retired: false as const, binding };
    return retired.includes(sessionId)
      ? { retired: true as const, binding, retiredSession: { sessionId } }
      : undefined;
  },
});

const world = (options: {
  readonly retired?: readonly string[];
  readonly denied?: readonly string[];
  readonly index?: boolean;
  readonly indexFails?: boolean;
}) => {
  const snapshots: string[] = [];
  const service = {
    canAccess: async (_actor: unknown, target: { sessionId: string; rootSessionId: string }) =>
      !(options.denied ?? []).includes(target.rootSessionId),
    snapshot: async (root: string) => {
      snapshots.push(root);
      return { ok: true as const, value: { rootSessionId: root, version: 3, interactions: [] } };
    },
  };
  const backend = Option.some({
    interactions: () => service,
    ...(options.index === false
      ? {}
      : { index: aliasIndex(options.retired ?? [], options.indexFails) }),
  }) as never;
  return { backend, snapshots };
};

const actor = () =>
  Effect.runPromise(
    connectionActor({ sessionId: "client-1", scopes: [AuthOrchestrationReadScope] }),
  );
const read = async (w: ReturnType<typeof world>, root: string) =>
  (await Effect.runPromise(
    interactionsSnapshot(w.backend, await actor(), { rootSessionId: root }),
  )) as Json;

describe("the live root's snapshot names the roots its thread replaced", () => {
  it("lists each replaced root the connection may reach, in the index's order, and the reply fits the contract", async () => {
    const w = world({ retired: [OLD_1, OLD_2] });
    const reply = await read(w, LIVE);
    expect(reply).toMatchObject({ ok: true, value: { rootSessionId: LIVE, version: 3 } });
    expect(reply.value.retiredRoots).toEqual([OLD_1, OLD_2]);
    expect(() => encodeReply(reply)).not.toThrow();
    // Only the live root's own snapshot was read: the replaced roots' are read by the client, one call each.
    expect(w.snapshots).toEqual([LIVE]);
  });

  it("leaves out a replaced root the connection may not reach, and says nothing about it", async () => {
    const w = world({ retired: [OLD_1, OLD_2], denied: [OLD_1] });
    const reply = await read(w, LIVE);
    expect(reply.value.retiredRoots).toEqual([OLD_2]);
    expect(JSON.stringify(reply)).not.toContain(OLD_1);
  });

  it("a replaced root's own snapshot lists none: the alias does not chain", async () => {
    const w = world({ retired: [OLD_1, OLD_2] });
    const reply = await read(w, OLD_1);
    expect(reply).toMatchObject({ ok: true, value: { rootSessionId: OLD_1 } });
    expect("retiredRoots" in reply.value).toBe(false);
  });

  it("a thread that replaced nothing, and a backend with no index, keep the old reply exactly", async () => {
    for (const w of [world({ retired: [] }), world({ retired: [OLD_1], index: false })]) {
      const reply = await read(w, LIVE);
      expect(reply).toEqual({
        ok: true,
        value: { rootSessionId: LIVE, version: 3, interactions: [] },
      });
    }
  });

  it("an index that cannot answer is unavailable, never an empty list of replaced roots", async () => {
    const reply = await read(world({ retired: [OLD_1], indexFails: true }), LIVE);
    expect(reply).toMatchObject({ ok: false, code: "INTERACTION_UNAVAILABLE" });
  });
});
