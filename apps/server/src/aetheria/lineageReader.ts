// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M05 Plan step 6 (C2 boot) — the LineageReaderPort the children service's boot reconciliation reads: every subagent and fork thread T3 holds, from T3's
// thread shells, with the Pi session M04's thread index bound to it. An unreadable listing is `unavailable` (never an empty list); a session the index cannot
// answer is `"unknown"`, a thread it holds no binding for is `null`. `closed` is T3's archived mark only: a stopped thread stays listed as open, and closing it again is harmless.
import type { ChildLineageThread, ChildLineageReader } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

export const makeLineageReader = Effect.fn("makeLineageReader")(function* (
  threads: ThreadManagementService.ThreadManagementService["Service"],
  sessionOf: (threadId: string) => string | null | "unknown",
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const reader: ChildLineageReader = {
    listChildThreads: () =>
      runPromise(
        threads.listProjectThreads({ includeSubagents: true }).pipe(
          Effect.map((shells) => {
            const listed: ChildLineageThread[] = [];
            for (const shell of shells) {
              const { relationshipToParent, parentThreadId } = shell.lineage;
              if (relationshipToParent === null || parentThreadId === null) continue;
              listed.push({
                threadId: String(shell.id),
                parentThreadId: String(parentThreadId),
                rootThreadId: String(shell.lineage.rootThreadId),
                relationshipToParent,
                sessionId: sessionOf(String(shell.id)),
                closed: shell.archivedAt !== null && shell.archivedAt !== undefined,
              });
            }
            return { ok: true as const, threads: listed };
          }),
          Effect.catchCause(() =>
            Effect.succeed({ ok: false as const, reason: "unavailable" as const }),
          ),
        ),
      ).catch(() => ({ ok: false as const, reason: "unavailable" as const })),
  };
  return reader;
});
