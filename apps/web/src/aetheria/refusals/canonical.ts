// The canonical refusal codes the display table must cover (D14, A3), READ from the real tables, never transcribed: M04's and M03's rows and the T3 decline from the packed awareness archive's
// `./permissions` subpath (the same archive bytes the Backend consumes, IP-28), and M06's fourteen interaction codes, M10's children and group codes and M05's passed-through codes from
// `@t3tools/aetheria-contracts`. A code added to any of those tables is canonical here at once, so the drift test fails until it has an English and a Chinese line.
import { NON_CODE_REFUSALS, REFUSAL_TABLE } from "@aetheria/awareness/permissions";
import {
  CHILDREN_CONTROL_CODE_CLASSES,
  CHILDREN_PASSTHROUGH_CODES,
  GROUPS_CODE_CLASSES,
  INTERACTION_CODE_CLASSES,
} from "@t3tools/aetheria-contracts";

/**
 * "refused-unchanged", "failed-unchanged" and "applied-with-warning" are M04's outcome classes: only the first two promise that nothing changed. "refusal", "conflict", "absence" and "failure" are M12's
 * classes for the interaction, children and group codes and promise nothing about state. "passthrough" is an M05 code the children handler returns unchanged.
 */
export type CanonicalClass =
  | "refused-unchanged"
  | "failed-unchanged"
  | "applied-with-warning"
  | "refusal"
  | "conflict"
  | "absence"
  | "failure"
  | "passthrough";

export type CanonicalOwner = "M04" | "M03" | "M06" | "M10" | "M05" | "T3";

export interface CanonicalCode {
  readonly code: string;
  readonly class: CanonicalClass;
  readonly owner: CanonicalOwner;
}

const classed = (
  table: Readonly<Record<string, CanonicalClass>>,
  owner: CanonicalOwner,
): CanonicalCode[] => Object.entries(table).map(([code, cls]) => ({ code, class: cls, owner }));

export const CANONICAL_CODES: readonly CanonicalCode[] = [
  // M04 and M03: the awareness archive's refusal table, in its order (readiness, freshness, the write's own outcome, the board, then authority)
  ...REFUSAL_TABLE.map((entry): CanonicalCode => ({
    code: entry.code,
    class: entry.class,
    owner: entry.owner,
  })),
  // T3: a decline carries no code (NON_CODE_REFUSALS); the id stands for it
  ...NON_CODE_REFUSALS.map((entry): CanonicalCode => ({
    code: entry.id,
    class: entry.class,
    owner: "T3",
  })),
  // M06: the fourteen interaction codes
  ...classed(INTERACTION_CODE_CLASSES, "M06"),
  // M10: the children controls' own codes, then the group store's
  ...classed(CHILDREN_CONTROL_CODE_CLASSES, "M10"),
  ...classed(GROUPS_CODE_CLASSES, "M10"),
  // M05: passed through the children handler unchanged
  ...CHILDREN_PASSTHROUGH_CODES.map((code): CanonicalCode => ({
    code,
    class: "passthrough",
    owner: "M05",
  })),
];

/** Ids for refusals that carry no code, so the table can still name them. */
export const NON_CODE_REFUSAL_IDS: readonly string[] = NON_CODE_REFUSALS.map((entry) => entry.id);
