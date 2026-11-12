// The facts port: the only vocabulary the session policy uses. Ported from DSH's aetheria-ui data
// types; nothing here is a T3 type. facts.ts maps T3's thread shell into it, so a changed T3
// representation is absorbed in one place. A fact T3 may not supply is a Known<T>, never a default.

import type { Known } from "../core/known";

export type SessionId = string;
export type WorkspaceId = string;

/** Precedence order: a pending interaction, running, an unread result or a recent user message, otherwise dormant. */
export type SessionState = "needs-you" | "working" | "ongoing" | "dormant";
/** Label for a known pending kind; absent for an unknown kind. */
export type RowTag = "Approve" | "Review" | "Question";

export type LinkKind = "fork" | "grouped" | "continued" | "reopened" | "mention" | "same-cycle";
export interface SessionLink {
  readonly from: SessionId;
  readonly to: SessionId;
  readonly kind: LinkKind;
}
export interface LinkSource {
  /** Links among the given ids; a link to an id outside the list is ignored by the list. */
  linksFor(ids: readonly SessionId[]): readonly SessionLink[];
}

/** A name the user gave a group, saved with the sessions it was given to. */
export interface GroupName {
  readonly members: readonly SessionId[];
  readonly name: string;
  readonly at: number;
}

export interface SessionFact {
  readonly id: SessionId;
  readonly title: string;
  /** Where the session runs; T3's thread shell carries no cwd, so this is often unavailable. */
  readonly cwd: Known<string>;
  /** The session this one was forked from (or, for a subagent, its parent). */
  readonly parentId: SessionId | undefined;
  readonly subagent: boolean;
  /** T3 has no blank-session flag; unavailable sessions are never hidden. */
  readonly blank: Known<boolean>;
  readonly archived: boolean;
  readonly pinned: boolean;
  /** Snoozed rows keep their policy state and show a tag. */
  readonly snoozed: boolean;
  readonly running: Known<boolean>;
  /** The kind of the pending interaction; absent when nothing waits on the user. */
  readonly pendingKind: string | undefined;
  readonly completionUnread: Known<boolean>;
  /** Epoch ms of the user's last message; absent when the session has none. The 30-minute rule reads it. */
  readonly recentMessageAt: number | undefined;
  /** Epoch ms the list sorts by: the last user message, else creation. */
  readonly sortAt: number;
  /** The session open in the main view. */
  readonly current: boolean;
}
export interface WorkspaceFact {
  readonly id: WorkspaceId;
  readonly title: string;
  readonly sessionIds: readonly SessionId[];
}
export interface ListFacts {
  readonly sessions: readonly SessionFact[];
  readonly workspaces: readonly WorkspaceFact[];
}

export interface TreeRowGroup {
  readonly key: SessionId;
  readonly label: string;
}

export interface TreeRow {
  readonly id: SessionId;
  readonly title: string;
  readonly state: SessionState;
  /** False when a fact the state rests on (running, unread) is not known: show the state as unknown, not as idle. */
  readonly stateKnown: boolean;
  readonly tag: RowTag | undefined;
  readonly snoozed: boolean;
  readonly updatedAt: number;
  readonly pinned: boolean;
  /** The session open in the main view. */
  readonly current: boolean;
  /** True when a confirmed `grouped` link touches this session and its other end is a visible session. */
  readonly grouped: boolean;
  /** The last path segment of a known cwd; set only in Unfiled. */
  readonly folder?: string | undefined;
  /** Set in Unfiled when the cwd is not known or not supplied. */
  readonly folderState?: "unknown" | "unavailable" | undefined;
  readonly group?: TreeRowGroup | undefined;
}

export interface TreeGroup {
  /** The oldest member's id of the full component; stable under search. */
  readonly key: SessionId;
  readonly title: string;
  readonly name: string | undefined;
  readonly label: string;
  /** Every member of the full component, newest first, whatever a search shows. */
  readonly component: readonly SessionId[];
  readonly members: readonly TreeRow[];
  readonly count: number;
  readonly forcedOpen: boolean;
}
export interface TreeSuggestion {
  readonly a: TreeRow;
  readonly b: TreeRow;
  readonly shared: number;
}

export interface TreeStateSection {
  readonly id: SessionState;
  readonly count: number;
  readonly rows: readonly TreeRow[];
  readonly forcedOpen: boolean;
}
export type TreeSection = TreeStateSection;

export interface TreeGroupsSection {
  readonly suggestions: readonly TreeSuggestion[];
  readonly groups: readonly TreeGroup[];
  readonly count: number;
  readonly forcedOpen: boolean;
}

export type ProjectKind = "workspace" | "unfiled";

export interface TreeProject {
  readonly id: string;
  readonly kind: ProjectKind;
  readonly title: string;
  readonly workspaceId: WorkspaceId | undefined;
  readonly current: boolean;
  /** Needs-you sessions after the exclusions, pinned or not, never narrowed by search. */
  readonly needsYou: number;
  /** True when an eligible session of the project is known to run. */
  readonly working: boolean;
  /** False when some eligible session's running fact is not known, so `working` may be an undercount. */
  readonly workingKnown: boolean;
  readonly forcedOpen: boolean;
  readonly pinned: readonly TreeRow[];
  readonly pinnedForcedOpen: boolean;
  readonly sections: readonly TreeSection[];
  readonly groupsSection: TreeGroupsSection | undefined;
}

export interface ProjectAttention {
  readonly projectId: string;
  readonly needsYou: number;
}
/** Attention across all projects, unaffected by folds, pins, search or the store. */
export interface TreeAttention {
  readonly needsYou: number;
  /** Every eligible needs-you and working row, newest first, ties by id; each session once. */
  readonly rows: readonly TreeRow[];
  readonly byProject: readonly ProjectAttention[];
}

export interface TreeModel {
  readonly projects: readonly TreeProject[];
  readonly attention: TreeAttention;
}

export interface TreeOptions {
  /** Epoch milliseconds, supplied by the view's minute clock. */
  readonly now: number;
  /** Search text; trimmed and compared case-insensitively. Empty means no search. */
  readonly query: string;
  /** Confirmed saved group names; absent or empty means every group is called by its newest title. */
  readonly names?: readonly GroupName[] | undefined;
}

export interface SuggestionRow {
  readonly id: SessionId;
  readonly title: string;
  readonly updatedAt: number;
  /** The key of the group the session belongs to, else the row's own id; equal keys mean already joined. */
  readonly groupKey: SessionId;
}
export interface SuggestionPair {
  readonly a: SessionId;
  readonly b: SessionId;
  readonly shared: number;
}
export interface SuggestionSource {
  suggestFor(rows: readonly SuggestionRow[]): readonly SuggestionPair[];
}
