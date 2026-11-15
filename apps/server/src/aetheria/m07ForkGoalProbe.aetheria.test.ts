// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectFailure:off
// AETHERIA M07 Plan step 4 (fork half) — probe of the fork-observation and typed-ingress seams (B6, B7), as facts about the tree at fork 5bd72c71.
//
// Boundary: T3's real `parseGoalCommand` run on text, and the real Orchestrator / ProviderTurnStartService / lineage reader source read as text. It shows: (1) `/goal set|resume|pause|clear|show`
// parse to typed commands for any thread's text (so a typed command is parseable ingress for a Pi thread, where an adapter could turn set/resume into `goal.propose`); (2) T3's native
// handling of that command is gated to the codex and claude drivers only, in BOTH the Orchestrator (goalDriverFor) and the turn start (goalDriver), so for a Pi thread `/goal` is ordinary
// prompt text that a native driver does NOT consume — the typed command reaches Pi as a message, never as authority; (3) the lineage reader supplies parent lineage but no fork EVENT.
// It does NOT show: that a backend-written goal field on a Pi thread is accepted or rendered (no write seam was exercised), a gap-free fork observation, or any event-feed behaviour. Those are
// recorded as NOT PROVEN by the caller's report; B7's accepted fallback (the XC-23 strip alone, no native driver, no goal text as authority) is what the tree supports today.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { parseGoalCommand } from "@t3tools/contracts";

import { makeLineageReader } from "./lineageReader.ts";

const SERVER = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => NodeFS.readFileSync(NodePath.join(SERVER, relative), "utf8");

describe("probe 4 (fork half): typed /goal ingress and the fork observation point", () => {
  it("parses the typed commands M07 would adapt (set and resume → propose; pause and clear → root authority; show → get), and ignores attachments", () => {
    expect(parseGoalCommand({ text: "/goal set ship it" })).toEqual({
      type: "set",
      objective: "set ship it",
    });
    expect(parseGoalCommand({ text: "/goal ship it" })).toEqual({
      type: "set",
      objective: "ship it",
    });
    expect(parseGoalCommand({ text: "/goal resume" })).toEqual({ type: "resume" });
    expect(parseGoalCommand({ text: "/goal pause" })).toEqual({ type: "pause" });
    expect(parseGoalCommand({ text: "/goal clear" })).toEqual({ type: "clear" });
    expect(parseGoalCommand({ text: "/goal" })).toEqual({ type: "show" });
    expect(parseGoalCommand({ text: "/goal clear", attachments: [{}] })).toBeNull();
    expect(parseGoalCommand({ text: "please /goal clear" })).toBeNull();
  });

  it("gates T3's native /goal handling to codex and claude in both the Orchestrator and the turn start: for a Pi thread the command is ordinary text", () => {
    const orchestrator = source("orchestration-v2/Orchestrator.ts");
    expect(orchestrator).toMatch(
      /return driver === "codex" \|\| driver === "claudeAgent" \? driver : undefined;/,
    );
    expect(orchestrator).toMatch(
      /\(yield\* goalDriverFor\(command, modelSelection\.instanceId\)\) === undefined\s*\?\s*null/,
    );
    const start = source("orchestration-v2/ProviderTurnStartService.ts");
    expect(start).toMatch(
      /const goalDriver = session\.driver === "codex" \|\| session\.driver === "claudeAgent";/,
    );
  });

  it("the lineage reader supplies a thread's parent lineage and no fork event", () => {
    const reader = source("aetheria/lineageReader.ts");
    expect(reader).toMatch(/relationshipToParent/);
    expect(reader).not.toMatch(/fork(ed)?\.(created|event)|onSessionForked|subscribe/i);
  });

  it("B7 write seam: T3's shell `goal` is READ from the active provider thread's own `goal` (written only by provider adapters' events); nothing Aetheria-owned writes one, so the Backend has no supported write — the strip-only fallback holds", () => {
    const store = source("orchestration-v2/ProjectionStore.ts");
    expect(store).toMatch(
      /providerThreads\.find\(\(thread\) => thread\.id === activeProviderThreadId\)\?\.goal \?\? null/,
    );
    // No Aetheria-owned (apps/server/src/aetheria) non-test file mentions a goal write.
    const dir = NodePath.join(SERVER, "aetheria");
    const writers = NodeFS.readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.includes(".test.") && !name.startsWith("m07"))
      .filter((name) => {
        const text = NodeFS.readFileSync(NodePath.join(dir, name), "utf8");
        // M07 step 14: the Backend wiring and the round guard speak of the goal ROUND (M07's own concept), never of T3's thread `goal`; those two files name no property or field called `goal`.
        if (name === "aetheriaBackend.ts" || name === "goalRoundGuard.ts")
          return /\.goal\b|\bgoal\s*[:=]|\bgoal\?\./.test(text);
        return /\bgoal\b/i.test(text);
      });
    expect(writers).toEqual([]);
    // The orchestration command surface names `goal` only as T3's own /goal handling (CommandPolicy / Orchestrator / turn start), gated to codex and claude above.
    const commandWriters = [
      "orchestration-v2/CommandPolicy.ts",
      "orchestration-v2/Orchestrator.ts",
      "orchestration-v2/ProviderTurnStartService.ts",
      "orchestration-v2/RunExecutionService.ts",
    ].filter((f) => /goal:\s*\{|goal:\s*(Option|null|input|state)/.test(source(f)));
    expect(commandWriters).toEqual([]);
  });
});

describe("probe 4 (fork half): B6 — what the lineage reader shows of a newly appearing root fork", () => {
  const shell = (id: string, relationship: "fork" | "subagent" | null, parent: string | null) => ({
    id,
    archivedAt: null,
    lineage: {
      relationshipToParent: relationship,
      parentThreadId: parent,
      rootThreadId: parent ?? id,
    },
  });

  effectIt.effect(
    "a newly appearing fork shell is visible to the next pull (a snapshot diff, no event), with the Pi session the index bound — and it looks the same as an M05 fork child",
    () =>
      Effect.gen(function* () {
        let shells = [shell("t-root", null, null), shell("t-m05-fork", "fork", "t-root")];
        const bound = new Map<string, string | null | "unknown">([["t-m05-fork", "pi-child-1"]]);
        const reader = yield* makeLineageReader(
          { listProjectThreads: () => Effect.succeed(shells) } as never,
          (id) => bound.get(id) ?? null,
        );
        const before = yield* Effect.promise(() => reader.listChildThreads());
        assert.isTrue(before.ok);
        if (!before.ok) return;
        const knownBefore = new Set(before.threads.map((t) => t.threadId));
        // A user's fork of the root appears. The reader is pull-only: nothing tells M07; it must diff successive listings.
        shells = [...shells, shell("t-user-fork", "fork", "t-root")];
        const during = yield* Effect.promise(() => reader.listChildThreads());
        assert.isTrue(during.ok);
        if (!during.ok) return;
        const fresh = during.threads.filter((t) => !knownBefore.has(t.threadId));
        assert.deepEqual(
          fresh.map((t) => [t.threadId, t.relationshipToParent, t.sessionId]),
          [["t-user-fork", "fork", null]],
          "seen on the next pull, session not yet bound (null): M07 must wait for the M03 identity",
        );
        // Once the index binds it, the SAME call shows the session; but `relationshipToParent` is "fork" for both, so only M03's identity kind (main vs child) tells a user fork from M05's.
        bound.set("t-user-fork", "pi-fork-9");
        const after = yield* Effect.promise(() => reader.listChildThreads());
        if (!after.ok) return assert.fail("the listing should answer");
        assert.equal(
          after.threads.find((t) => t.threadId === "t-user-fork")?.sessionId,
          "pi-fork-9",
        );
        assert.equal(
          after.threads.find((t) => t.threadId === "t-m05-fork")?.relationshipToParent,
          after.threads.find((t) => t.threadId === "t-user-fork")?.relationshipToParent,
        );
        // A new MAIN root (no lineage) is never listed: this reader cannot show it at all.
        shells = [...shells, shell("t-new-main", null, null)];
        const withMain = yield* Effect.promise(() => reader.listChildThreads());
        assert.isTrue(withMain.ok && !withMain.threads.some((t) => t.threadId === "t-new-main"));
      }),
  );

  effectIt.effect(
    "an unreadable listing is `unavailable`, never an empty list (so a missed fork is unknown, not absent)",
    () =>
      Effect.gen(function* () {
        const reader = yield* makeLineageReader(
          { listProjectThreads: () => Effect.fail(new Error("db")) } as never,
          () => null,
        );
        const result = yield* Effect.promise(() => reader.listChildThreads());
        assert.deepEqual(result, { ok: false, reason: "unavailable" });
      }),
  );
});
