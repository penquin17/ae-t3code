// Builders shared by the sessions tests. Not imported by production code.

import { known } from "../core/known";
import { noLinks } from "./links";
import { noSuggestions, toTreeModel } from "./model";
import type {
  GroupName,
  LinkSource,
  ListFacts,
  SessionFact,
  SessionLink,
  SuggestionSource,
  TreeModel,
  WorkspaceFact,
} from "./types";

/** An ordinary, unpinned, not-current session whose last user message was long ago. */
export function fact(id: string, over: Partial<SessionFact> = {}): SessionFact {
  return {
    id,
    title: `Session ${id}`,
    cwd: known(""),
    parentId: undefined,
    subagent: false,
    blank: known(false),
    archived: false,
    pinned: false,
    snoozed: false,
    running: known(false),
    pendingKind: undefined,
    completionUnread: known(false),
    recentMessageAt: 1000,
    sortAt: 1000,
    current: false,
    ...over,
  };
}

/** A fact whose recency is one time: both the 30-minute rule and the sort order read it. */
export function at(id: string, time: number, over: Partial<SessionFact> = {}): SessionFact {
  return fact(id, { recentMessageAt: time, sortAt: time, ...over });
}

export const withCwd = (cwd: string): Partial<SessionFact> => ({ cwd: known(cwd) });

export function workspace(id: string, title: string, sessionIds: string[]): WorkspaceFact {
  return { id, title, sessionIds };
}

export function facts(sessions: SessionFact[], workspaces: WorkspaceFact[] = []): ListFacts {
  return { sessions, workspaces };
}

/** A fixed clock far later than every default time, so defaults are dormant. */
export const NOW = 1_700_000_000_000;
export const MINUTE = 60_000;
export const ago = (minutes: number): number => NOW - minutes * MINUTE;

export interface TreeCase {
  readonly links?: LinkSource;
  readonly suggestions?: SuggestionSource;
  readonly now?: number;
  readonly query?: string;
  readonly names?: readonly GroupName[];
}

export function tree(data: ListFacts, over: TreeCase = {}): TreeModel {
  return toTreeModel(data, over.links ?? noLinks, over.suggestions ?? noSuggestions, {
    now: over.now ?? NOW,
    query: over.query ?? "",
    names: over.names,
  });
}

export const linksOf = (...links: SessionLink[]): LinkSource => ({ linksFor: () => links });
export const fork = (from: string, to: string): SessionLink => ({ from, to, kind: "fork" });
export const grouped = (from: string, to: string): SessionLink => ({ from, to, kind: "grouped" });
