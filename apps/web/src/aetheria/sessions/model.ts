import { nameGroups } from "./names";
import type {
  LinkSource,
  ListFacts,
  ProjectAttention,
  ProjectKind,
  RowTag,
  SessionFact,
  SessionId,
  SessionLink,
  SessionState,
  SuggestionRow,
  SuggestionSource,
  TreeAttention,
  TreeGroup,
  TreeGroupsSection,
  TreeModel,
  TreeOptions,
  TreeProject,
  TreeRow,
  TreeRowGroup,
  TreeSection,
  TreeSuggestion,
  WorkspaceFact,
} from "./types";

// The derived project tree: a pure function of its inputs. No T3 import, no clock of its own (the
// caller passes `now`), no state. It holds the session state rule and every assignment, grouping
// and search rule in one place. Ported from DSH's aetheria-ui model.

const TAGS: Readonly<Record<string, RowTag>> = {
  approval: "Approve",
  "plan-review": "Review",
  question: "Question",
};

/** A session whose last user message is at most this old is ongoing: 30 minutes. */
export const ONGOING_MS = 30 * 60 * 1000;

/**
 * The session state rule, tried in order: a pending interaction is needs-you; running is working;
 * an unread completion or a user message within ONGOING_MS of `now` is ongoing; otherwise dormant.
 * `known` is false when a fact the answer rests on (running, or unread for a dormant result) is not
 * known, so a view can say "unknown" instead of showing idle.
 */
export function classify(fact: SessionFact, now: number): { state: SessionState; known: boolean } {
  if (fact.pendingKind !== undefined) return { state: "needs-you", known: true };
  const { running, completionUnread } = fact;
  if (running.state === "known" && running.value) return { state: "working", known: true };
  const unread = completionUnread.state === "known" && completionUnread.value;
  const recent = fact.recentMessageAt !== undefined && now - fact.recentMessageAt <= ONGOING_MS;
  const runningKnown = running.state === "known";
  if (unread || recent) return { state: "ongoing", known: runningKnown };
  return { state: "dormant", known: runningKnown && completionUnread.state === "known" };
}

export function stateOf(fact: SessionFact, now: number): SessionState {
  return classify(fact, now).state;
}

/** The tag for a known pending kind; an unknown kind is needs-you with no tag. */
export function tagOf(pendingKind: string | undefined): RowTag | undefined {
  return pendingKind === undefined ? undefined : TAGS[pendingKind];
}

/** The last folder of a path, whichever separator it uses; empty when there is none. */
function lastFolder(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? "";
}

type Ordered = { readonly updatedAt: number; readonly id: SessionId };
/** Newest first, ties by id ascending. */
function newerFirst(left: Ordered, right: Ordered): number {
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Union-find over ids: links join rows into undirected groups, cycles included. */
function groupsOf(
  ids: readonly SessionId[],
  links: readonly SessionLink[],
): Map<SessionId, SessionId[]> {
  const parent = new Map<SessionId, SessionId>(ids.map((id) => [id, id]));
  const find = (id: SessionId): SessionId => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as SessionId;
    let walk = id;
    while (walk !== root) {
      const next = parent.get(walk) as SessionId;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  for (const link of links) {
    const a = find(link.from);
    const b = find(link.to);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }
  const groups = new Map<SessionId, SessionId[]>();
  for (const id of ids) {
    const root = find(id);
    const members = groups.get(root);
    if (members === undefined) groups.set(root, [id]);
    else members.push(id);
  }
  return groups;
}

export const noSuggestions: SuggestionSource = { suggestFor: () => [] };

const UNFILED_ID = "unfiled";
const SECTION_ORDER = ["needs-you", "working", "ongoing", "dormant"] as const;

interface Bucket {
  readonly id: string;
  readonly kind: ProjectKind;
  readonly title: string;
  readonly workspaceId: string | undefined;
  readonly facts: SessionFact[];
}

/** A topic group before search: the facts of its full component, newest first (two or more). */
interface Component {
  readonly members: readonly SessionFact[];
}

const sortOf = (fact: SessionFact): Ordered => ({ id: fact.id, updatedAt: fact.sortAt });

/** A component's key: its oldest member's id. */
function keyOf(component: Component): SessionId {
  return (component.members[component.members.length - 1] as SessionFact).id;
}

/**
 * Assign each eligible session to one project, once: the first workspace whose `sessionIds` holds
 * it; else the one `unfiled` project. Workspaces keep their order and are kept when empty.
 */
function assignProjects(
  eligible: readonly SessionFact[],
  workspaces: readonly WorkspaceFact[],
): Bucket[] {
  const buckets: Bucket[] = workspaces.map((workspace) => ({
    id: workspace.id,
    kind: "workspace",
    title: workspace.title,
    workspaceId: workspace.id,
    facts: [],
  }));
  const firstHolder = new Map<SessionId, Bucket>();
  workspaces.forEach((workspace, index) => {
    for (const id of workspace.sessionIds) {
      if (!firstHolder.has(id)) firstHolder.set(id, buckets[index] as Bucket);
    }
  });
  let unfiled: Bucket | undefined;
  for (const fact of eligible) {
    const held = firstHolder.get(fact.id);
    if (held !== undefined) {
      held.facts.push(fact);
      continue;
    }
    unfiled ??= {
      id: UNFILED_ID,
      kind: "unfiled",
      title: "Unfiled",
      workspaceId: undefined,
      facts: [],
    };
    unfiled.facts.push(fact);
  }
  return [...buckets, ...(unfiled === undefined ? [] : [unfiled])];
}

/**
 * Derive the project tree: exclude, assign projects, derive states, group, name, suggest, count,
 * and only then search. A search changes neither a group's identity nor any count.
 */
export function toTreeModel(
  facts: ListFacts,
  links: LinkSource,
  suggestions: SuggestionSource,
  options: TreeOptions,
): TreeModel {
  const { now } = options;
  const query = options.query.trim().toLowerCase();
  const searching = query !== "";
  const matches = (title: string): boolean => !searching || title.toLowerCase().includes(query);

  // A blank flag that is unknown or unavailable never hides a session.
  const eligible = facts.sessions.filter(
    (fact) =>
      !fact.subagent && !(fact.blank.state === "known" && fact.blank.value) && !fact.archived,
  );
  const eligibleIds = new Set(eligible.map((fact) => fact.id));
  const visibleLinks = links
    .linksFor([...eligibleIds])
    .filter(
      (link) => link.from !== link.to && eligibleIds.has(link.from) && eligibleIds.has(link.to),
    );
  const groupedIds = new Set<SessionId>();
  for (const link of visibleLinks) {
    if (link.kind === "grouped") {
      groupedIds.add(link.from);
      groupedIds.add(link.to);
    }
  }

  const classified = new Map(eligible.map((fact) => [fact.id, classify(fact, now)] as const));
  const buckets = assignProjects(eligible, facts.workspaces);

  // The current project: the newest session held in the main view, else the newest session.
  const byNewest = [...eligible].sort((l, r) => newerFirst(sortOf(l), sortOf(r)));
  const currentFact = byNewest.find((fact) => fact.current) ?? byNewest[0];
  const currentId =
    currentFact === undefined
      ? undefined
      : buckets.find((bucket) => bucket.facts.includes(currentFact))?.id;

  // Stage 1: groups. Undirected components of two or more among one project's eligible sessions.
  const componentsOf = buckets.map((bucket): Component[] => {
    const ids = new Set(bucket.facts.map((fact) => fact.id));
    const joining = visibleLinks.filter((link) => ids.has(link.from) && ids.has(link.to));
    const factById = new Map(bucket.facts.map((fact) => [fact.id, fact] as const));
    return [
      ...groupsOf(
        bucket.facts.map((fact) => fact.id),
        joining,
      ).values(),
    ]
      .filter((members) => members.length > 1)
      .map((members) => ({
        members: members
          .map((id) => factById.get(id) as SessionFact)
          .sort((l, r) => newerFirst(sortOf(l), sortOf(r))),
      }));
  });

  // Stage 2: saved names are matched once across all projects, from each full group.
  const labels = nameGroups(
    componentsOf.flat().map((component) => ({
      key: keyOf(component),
      members: component.members.map((member) => member.id),
      title: (component.members[0] as SessionFact).title,
    })),
    options.names ?? [],
  );
  const groupOfId = new Map<SessionId, TreeRowGroup>();
  for (const component of componentsOf.flat()) {
    const key = keyOf(component);
    const group: TreeRowGroup = {
      key,
      label: labels.get(key)?.label ?? (component.members[0] as SessionFact).title,
    };
    for (const member of component.members) groupOfId.set(member.id, group);
  }

  // Stage 3: one row per session, shared by every place it appears.
  const rowById = new Map<SessionId, TreeRow>();
  for (const bucket of buckets) {
    for (const fact of bucket.facts) {
      const cwd = fact.cwd;
      const folder =
        bucket.kind === "unfiled" && cwd.state === "known" ? lastFolder(cwd.value) : "";
      const folderState =
        bucket.kind === "unfiled" && cwd.state !== "known" ? cwd.state : undefined;
      const group = groupOfId.get(fact.id);
      const verdict = classified.get(fact.id) as { state: SessionState; known: boolean };
      rowById.set(fact.id, {
        id: fact.id,
        title: fact.title,
        state: verdict.state,
        stateKnown: verdict.known,
        tag: tagOf(fact.pendingKind),
        snoozed: fact.snoozed,
        updatedAt: fact.sortAt,
        pinned: fact.pinned,
        current: fact.current,
        grouped: groupedIds.has(fact.id),
        ...(folder === "" ? {} : { folder }),
        ...(folderState === undefined ? {} : { folderState }),
        ...(group === undefined ? {} : { group }),
      });
    }
  }
  const rowOf = (id: SessionId): TreeRow => rowById.get(id) as TreeRow;

  // Stage 4: counts, search and sections per project.
  const projects: TreeProject[] = [];
  const byProject: ProjectAttention[] = [];
  buckets.forEach((bucket, bucketIndex) => {
    const rows = bucket.facts.map((fact) => rowOf(fact.id));
    // Counted before any search, so a project a search hides still reports its count.
    const needsYou = rows.filter((row) => row.state === "needs-you").length;
    byProject.push({ projectId: bucket.id, needsYou });

    const pinned = rows.filter((row) => row.pinned).sort(newerFirst);
    const unpinned = rows.filter((row) => !row.pinned);
    const inState = (state: SessionState): TreeRow[] =>
      unpinned.filter((row) => row.state === state).sort(newerFirst);

    const sections: TreeSection[] = [];
    for (const id of SECTION_ORDER) {
      const shown = inState(id).filter((row) => matches(row.title));
      if (shown.length > 0)
        sections.push({ id, count: shown.length, rows: shown, forcedOpen: searching });
    }
    const shownPinned = pinned.filter((row) => matches(row.title));

    // Groups: every full group stays a group; a search narrows only the members shown.
    const shownGroups: { readonly newest: TreeRow; readonly group: TreeGroup }[] = [];
    for (const component of componentsOf[bucketIndex] as Component[]) {
      const shown = component.members
        .map((member) => rowOf(member.id))
        .filter((member) => matches(member.title));
      if (shown.length === 0) continue;
      const key = keyOf(component);
      const newest = rowOf((component.members[0] as SessionFact).id);
      shownGroups.push({
        newest,
        group: {
          key,
          title: newest.title,
          name: labels.get(key)?.name,
          label: labels.get(key)?.label ?? newest.title,
          component: component.members.map((member) => member.id),
          members: shown,
          count: shown.length,
          forcedOpen: searching,
        },
      });
    }
    // Ordered by each full group's newest member, not by what a search leaves showing.
    shownGroups.sort((left, right) => newerFirst(left.newest, right.newest));
    const groups = shownGroups.map((entry) => entry.group);

    // Suggestions: from the project's unpinned dormant rows before search; shown only when both match.
    const dormant = inState("dormant");
    const suggestionRows: SuggestionRow[] = dormant.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      groupKey: groupOfId.get(row.id)?.key ?? row.id,
    }));
    const dormantById = new Map(dormant.map((row) => [row.id, row] as const));
    const shownSuggestions: TreeSuggestion[] = [];
    if (suggestionRows.length >= 2) {
      for (const pair of suggestions.suggestFor(suggestionRows)) {
        const a = dormantById.get(pair.a);
        const b = dormantById.get(pair.b);
        if (a === undefined || b === undefined || a.id === b.id) continue;
        if ((groupOfId.get(a.id)?.key ?? a.id) === (groupOfId.get(b.id)?.key ?? b.id)) continue;
        if (matches(a.title) && matches(b.title))
          shownSuggestions.push({ a, b, shared: pair.shared });
      }
    }
    const groupsSection: TreeGroupsSection | undefined =
      shownSuggestions.length > 0 || groups.length > 0
        ? { suggestions: shownSuggestions, groups, count: groups.length, forcedOpen: searching }
        : undefined;

    if (
      searching &&
      shownPinned.length === 0 &&
      sections.length === 0 &&
      groupsSection === undefined
    ) {
      return;
    }

    projects.push({
      id: bucket.id,
      kind: bucket.kind,
      title: bucket.title,
      workspaceId: bucket.workspaceId,
      current: bucket.id === currentId,
      needsYou,
      working: bucket.facts.some((fact) => fact.running.state === "known" && fact.running.value),
      workingKnown: bucket.facts.every((fact) => fact.running.state === "known"),
      forcedOpen: searching,
      pinned: shownPinned,
      pinnedForcedOpen: searching && shownPinned.length > 0,
      sections,
      groupsSection,
    });
  });

  const attentionRows = byNewest
    .filter((fact) => {
      const state = (classified.get(fact.id) as { state: SessionState }).state;
      return state === "needs-you" || state === "working";
    })
    .map((fact) => rowOf(fact.id));
  const attention: TreeAttention = {
    needsYou: attentionRows.filter((row) => row.state === "needs-you").length,
    rows: attentionRows,
    byProject,
  };
  return { projects, attention };
}
