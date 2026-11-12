import { describe, expect, it } from "vite-plus/test";

import { known } from "../core/known";
import { projectWorkspaceId, sessionIdOf, shellFactsInput, toListFacts } from "./t3Facts";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

// The structural subset of T3's EnvironmentThreadShell the adapter reads; cast once at the edge.
function shell(over: Record<string, unknown> = {}) {
  return {
    environmentId: "env-1",
    id: "t1",
    projectId: "p1",
    title: "A thread",
    worktreePath: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "t1" },
    latestRun: null,
    runtime: null,
    hasActionableProposedPlan: false,
    latestUserMessageAt: iso(5),
    createdAt: iso(60),
    visibleItemCount: 3,
    archivedAt: null,
    deletedAt: null,
    pinnedAt: null,
    snoozedUntil: null,
    lastVisitedAt: null,
    source: { pendingRuntimeRequest: null },
    ...over,
  } as never;
}
const project = (id: string, over: Record<string, unknown> = {}) =>
  ({ environmentId: "env-1", id, title: `Project ${id}`, archivedAt: null, ...over }) as never;

describe("shellFactsInput", () => {
  it("uses the environment-scoped key as the session id and as the parent id", () => {
    const input = shellFactsInput(
      shell({
        lineage: { parentThreadId: "t0", relationshipToParent: "fork", rootThreadId: "t0" },
      }),
    );
    expect(input.id).toBe("env-1:t1");
    expect(input.parentThreadId).toBe("env-1:t0");
    expect(input.relationshipToParent).toBe("fork");
  });

  it("reads the run status from the runtime summary; a thread that never ran is idle", () => {
    expect(shellFactsInput(shell()).runStatus).toBe("idle");
    expect(shellFactsInput(shell({ runtime: { status: "running" } })).runStatus).toBe("running");
  });

  it("reads the pending request kind from the server's shell and the last completion from the latest run", () => {
    const input = shellFactsInput(
      shell({
        source: { pendingRuntimeRequest: { kind: "command" } },
        latestRun: { completedAt: iso(2) },
        lastVisitedAt: iso(9),
      }),
    );
    expect(input.pendingRequestKind).toBe("command");
    expect(input.latestRunCompletedAt).toBe(iso(2));
    expect(input.lastVisitedAt).toBe(iso(9));
  });

  it("passes an absent visit mark through as undefined, so it stays unavailable downstream", () => {
    expect(shellFactsInput(shell({ lastVisitedAt: undefined })).lastVisitedAt).toBeUndefined();
  });
});

describe("toListFacts", () => {
  it("makes each non-scratch, non-archived project a workspace holding its threads' keys", () => {
    const facts = toListFacts({
      shells: [shell(), shell({ id: "t2", projectId: "p2" }), shell({ id: "t3", projectId: "p1" })],
      projects: [project("p1"), project("p2"), project("p3", { archivedAt: iso(1) })],
      openKey: null,
      now: NOW,
    });
    expect(facts.workspaces.map((w) => [w.id, w.title, w.sessionIds])).toEqual([
      [
        projectWorkspaceId({ environmentId: "env-1" as never, projectId: "p1" as never }),
        "Project p1",
        ["env-1:t1", "env-1:t3"],
      ],
      [
        projectWorkspaceId({ environmentId: "env-1" as never, projectId: "p2" as never }),
        "Project p2",
        ["env-1:t2"],
      ],
    ]);
  });

  it("a scratch project's threads belong to no workspace, so they fall into Unfiled", () => {
    const facts = toListFacts({
      shells: [shell({ projectId: "s1" })],
      projects: [project("s1", { isScratch: true })],
      openKey: null,
      now: NOW,
    });
    expect(facts.workspaces).toEqual([]);
    expect(facts.sessions).toHaveLength(1);
  });

  it("marks only the open session current and keeps every session, deleted ones excluded", () => {
    const facts = toListFacts({
      shells: [shell(), shell({ id: "t2" }), shell({ id: "t3", deletedAt: iso(1) })],
      projects: [project("p1")],
      openKey: sessionIdOf("env-1" as never, "t2" as never),
      now: NOW,
    });
    expect(facts.sessions.map((s) => [s.id, s.current])).toEqual([
      ["env-1:t1", false],
      ["env-1:t2", true],
    ]);
    expect(facts.sessions[0]?.cwd.state).toBe("unavailable");
    expect(facts.sessions[0]?.running).toEqual(known(false));
  });
});
