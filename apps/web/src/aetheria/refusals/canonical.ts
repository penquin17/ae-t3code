// The canonical refusal codes the display table must cover (D14, A3), transcribed from packages/aetheria-awareness/src/contracts/{codes,refusals}.ts and, in the fork's aetheria-contracts,
// interactionOperations.ts:15-33 and childrenControlOperations.ts:7-26. Phase 2b makes the packed tables web dependencies (IP-28); the drift test then reads them instead.

/**
 * "refused-unchanged", "failed-unchanged" and "applied-with-warning" are M04's outcome classes: only the first two promise that nothing changed. "refusal", "conflict", "absence" and "failure" are M12's
 * classes for the interaction and children codes and promise nothing about state. "passthrough" is an M05 code the children handler returns unchanged.
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

const row = (code: string, cls: CanonicalClass, owner: CanonicalOwner): CanonicalCode => ({
  code,
  class: cls,
  owner,
});
const m04 = (code: string, cls: CanonicalClass = "refused-unchanged") => row(code, cls, "M04");

export const CANONICAL_CODES: readonly CanonicalCode[] = [
  // M04: A6 readiness
  m04("READINESS_NOT_LOADED"),
  m04("READINESS_CHANGED"),
  m04("READINESS_RETARGETED"),
  m04("READINESS_UNSUPPORTED_SCOPE"),
  m04("READINESS_ANCESTOR_LIMIT"),
  m04("READINESS_UNREADABLE"),
  m04("READINESS_TOO_LARGE"),
  m04("READINESS_UNSTABLE"),
  // M04: T1 freshness and the write's own outcome
  m04("T1_NOT_OBSERVED"),
  m04("T1_STALE"),
  m04("T1_EXISTS"),
  m04("T1_NOT_FOUND"),
  m04("T1_RETARGETED"),
  m04("T1_DANGLING_LINK"),
  m04("T1_WRITE_BUSY"),
  m04("T1_IS_DIRECTORY"),
  m04("T1_LINK_LOOP"),
  m04("T1_OBSERVATION_DROPPED", "applied-with-warning"),
  m04("WRITE_FAILED", "failed-unchanged"),
  // M04: H5 awareness board
  m04("AWARENESS_HELD"),
  m04("AWARENESS_LEFTOVER"),
  m04("AWARENESS_ASSIGNED"),
  m04("AWARENESS_UNAVAILABLE"),
  m04("AWARENESS_OVERLAP"),
  m04("AWARENESS_INVALID"),
  m04("AWARENESS_STALE"),
  m04("AWARENESS_UNVERIFIED"),
  m04("AWARENESS_NO_SESSION"),
  m04("AWARENESS_NO_AGENT"),
  m04("AWARENESS_NOT_MAIN"),
  m04("COORDINATION_UNAVAILABLE", "applied-with-warning"),
  // M03: authority (all refused-unchanged)
  row("AUTH_IDENTITY_UNAVAILABLE", "refused-unchanged", "M03"),
  row("AUTH_IDENTITY_INVALID", "refused-unchanged", "M03"),
  row("AUTH_ROLE_REMOVED", "refused-unchanged", "M03"),
  row("AUTH_TOOL_NOT_ALLOWED", "refused-unchanged", "M03"),
  row("AUTH_DEPTH_EXCEEDED", "refused-unchanged", "M03"),
  row("ROLE_PROJECT_LAYER", "refused-unchanged", "M03"),
  row("ROLE_GENERIC_DELEGATION", "refused-unchanged", "M03"),
  // T3: a decline carries no code (NON_CODE_REFUSALS); the id stands for it
  row("T3_DECLINE", "refused-unchanged", "T3"),
  // M06: the fourteen interaction codes
  row("INTERACTION_ORIGIN_NOT_HUMAN", "refusal", "M06"),
  row("INTERACTION_REVIEW_NOT_PERMITTED", "refusal", "M06"),
  row("INTERACTION_NOT_IN_PLAN_MODE", "refusal", "M06"),
  row("INTERACTION_ANSWER_INVALID", "refusal", "M06"),
  row("INTERACTION_GRANT_INVALID", "refusal", "M06"),
  row("INTERACTION_ALREADY_SETTLED", "conflict", "M06"),
  row("INTERACTION_STALE_REVISION", "conflict", "M06"),
  row("ORIGIN_STALE", "conflict", "M06"),
  row("INTERACTION_NOT_FOUND", "absence", "M06"),
  row("ORIGIN_NOT_FOUND", "absence", "M06"),
  row("ORIGIN_MISMATCH", "absence", "M06"),
  row("INTERACTION_UNAVAILABLE", "failure", "M06"),
  row("INTERACTION_DELIVERY_FAILED", "failure", "M06"),
  row("INTERACTION_FORMAT_UNSUPPORTED", "failure", "M06"),
  // M10: the children controls' own codes
  row("CHILDREN_NOT_AUTHORIZED", "refusal", "M10"),
  row("CHILDREN_DEVICE_REVOKED", "refusal", "M10"),
  row("CHILDREN_NOT_FOUND", "absence", "M10"),
  row("CHILDREN_UNAVAILABLE", "failure", "M10"),
  row("CHILDREN_OUTCOME_UNKNOWN", "failure", "M10"),
  // M05: passed through the children handler unchanged
  row("NOT_AUTHORIZED", "passthrough", "M05"),
  row("CHILD_NOT_OWNED", "passthrough", "M05"),
  row("CHILD_NOT_ADJACENT", "passthrough", "M05"),
  row("CHILD_NOT_RESUMABLE", "passthrough", "M05"),
  row("CHILD_DELIVERY_UNAVAILABLE", "passthrough", "M05"),
  row("CHILD_PARENT_UNAVAILABLE", "passthrough", "M05"),
  row("ORCHESTRATION_UNAVAILABLE", "passthrough", "M05"),
];

/** Ids for refusals that carry no code, so the table can still name them. */
export const NON_CODE_REFUSAL_IDS: readonly string[] = ["T3_DECLINE"];
