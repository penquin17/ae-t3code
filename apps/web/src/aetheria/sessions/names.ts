import type { GroupName, SessionId } from "./types";

// Group names. A saved name is {members, name, at}: the sessions it was given to. A group's
// membership changes, so a name follows whichever group still holds most of its members. Pure:
// two inputs, no I/O, and saved names that match no group are not pruned (the store owns the file).

export interface NameableGroup {
  readonly key: SessionId;
  /** Every member of the group's full component, whatever a search shows. */
  readonly members: readonly SessionId[];
  /** The newest member's title: what an unnamed group is called. */
  readonly title: string;
}

export interface GroupLabel {
  readonly name: string | undefined;
  readonly label: string;
}

/** Ascending by code unit, never by locale. */
const ascending = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

interface Candidate {
  readonly group: number;
  readonly saved: number;
  readonly overlap: number;
  readonly at: number;
  /** JSON of the saved name's sorted members: ids containing any delimiter cannot collide. */
  readonly membersKey: string;
  readonly groupKey: SessionId;
  readonly name: string;
}

/**
 * Give each group the saved name it overlaps most. Every (group, saved name) pair sharing an id
 * is ranked by overlap (more first), `at` (later first), the saved members as JSON, the group key,
 * then the name; pairs are taken greedily, skipping a used group or name. One saved name names at
 * most one group. The result has one entry per group, by key.
 */
export function nameGroups(
  groups: readonly NameableGroup[],
  names: readonly GroupName[],
): ReadonlyMap<SessionId, GroupLabel> {
  const groupsOfMember = new Map<SessionId, number[]>();
  groups.forEach((group, index) => {
    for (const id of new Set(group.members)) {
      const held = groupsOfMember.get(id);
      if (held === undefined) groupsOfMember.set(id, [index]);
      else held.push(index);
    }
  });

  const candidates: Candidate[] = [];
  names.forEach((saved, savedIndex) => {
    const overlaps = new Map<number, number>();
    for (const id of new Set(saved.members)) {
      for (const index of groupsOfMember.get(id) ?? []) {
        overlaps.set(index, (overlaps.get(index) ?? 0) + 1);
      }
    }
    const membersKey = JSON.stringify([...saved.members].toSorted(ascending));
    for (const [index, overlap] of overlaps) {
      candidates.push({
        group: index,
        saved: savedIndex,
        overlap,
        at: saved.at,
        membersKey,
        groupKey: (groups[index] as NameableGroup).key,
        name: saved.name,
      });
    }
  });
  candidates.sort(
    (left, right) =>
      right.overlap - left.overlap ||
      right.at - left.at ||
      ascending(left.membersKey, right.membersKey) ||
      ascending(left.groupKey, right.groupKey) ||
      ascending(left.name, right.name),
  );

  const takenGroups = new Set<number>();
  const takenNames = new Set<number>();
  const matched = new Map<number, string>();
  for (const candidate of candidates) {
    if (takenGroups.has(candidate.group) || takenNames.has(candidate.saved)) continue;
    takenGroups.add(candidate.group);
    takenNames.add(candidate.saved);
    matched.set(candidate.group, candidate.name);
  }

  const labels = new Map<SessionId, GroupLabel>();
  groups.forEach((group, index) => {
    const name = matched.get(index);
    labels.set(group.key, { name, label: name ?? group.title });
  });
  return labels;
}
