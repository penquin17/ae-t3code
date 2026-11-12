// The T3 adapter of the session policy: T3's thread shells and projects in, the policy's facts out.
// Reads T3's shapes only here and in facts.ts's input. Nothing is written back to T3 (D2, R7).

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";

import { toSessionFact, type ShellFactsInput } from "./facts";
import type { ListFacts, SessionFact, WorkspaceFact } from "./types";

/** The policy's session id: T3's environment-scoped thread key. */
export const sessionIdOf = (environmentId: EnvironmentId, threadId: ThreadId): string =>
  scopedThreadKey({ environmentId, threadId });

/** The policy's workspace id for a T3 project. */
export const projectWorkspaceId = (ref: ScopedProjectRef): string =>
  `${ref.environmentId}:${ref.projectId}`;

export function shellFactsInput(shell: EnvironmentThreadShell): ShellFactsInput {
  const parent = shell.lineage.parentThreadId;
  return {
    id: sessionIdOf(shell.environmentId, shell.id),
    title: shell.title,
    parentThreadId: parent === null ? null : sessionIdOf(shell.environmentId, parent),
    relationshipToParent: shell.lineage.relationshipToParent,
    worktreePath: shell.worktreePath,
    archivedAt: shell.archivedAt,
    pinnedAt: shell.pinnedAt,
    snoozedUntil: shell.snoozedUntil,
    // A thread that never ran has no runtime summary: it is idle, not unknown.
    runStatus: shell.runtime === null ? "idle" : shell.runtime.status,
    pendingRequestKind: shell.source.pendingRuntimeRequest?.kind ?? null,
    hasActionableProposedPlan: shell.hasActionableProposedPlan,
    latestRunCompletedAt: shell.latestRun === null ? null : shell.latestRun.completedAt,
    lastVisitedAt: shell.lastVisitedAt,
    latestUserMessageAt: shell.latestUserMessageAt,
    createdAt: shell.createdAt,
    visibleItemCount: shell.visibleItemCount,
  };
}

export interface ToListFactsInput {
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  /** The session key of the open thread route; null when none is open. */
  readonly openKey: string | null;
  readonly now: number;
}

/**
 * Projects become workspaces; a scratch project's threads, and those of an archived or unknown
 * project, belong to no workspace and fall into Unfiled. Deleted threads are left out.
 */
export function toListFacts(input: ToListFactsInput): ListFacts {
  const live = input.shells.filter((shell) => shell.deletedAt === null);
  const sessions: SessionFact[] = live.map((shell) => {
    const mapped = shellFactsInput(shell);
    return toSessionFact(mapped, { now: input.now, current: mapped.id === input.openKey });
  });
  const workspaces: WorkspaceFact[] = [];
  for (const project of input.projects) {
    if (project.isScratch === true || (project.archivedAt ?? null) !== null) continue;
    workspaces.push({
      id: projectWorkspaceId({ environmentId: project.environmentId, projectId: project.id }),
      title: project.title,
      sessionIds: live
        .filter(
          (shell) =>
            shell.environmentId === project.environmentId && shell.projectId === project.id,
        )
        .map((shell) => sessionIdOf(shell.environmentId, shell.id)),
    });
  }
  return { sessions, workspaces };
}
