// AETHERIA — the pinned library artifacts this build carries, read from this package's own declaration.
//
// The outer build wrote each archive and its stamp (tools/lib/foundations/artifact.mjs); the manifest's `aetheriaArtifacts` entries are the
// declaration the graphs check compares with the archive bytes. The Backend publishes these stamps as facts of its composition, so a
// module whose row expects another stamp is refused as stale. Nine archives are accepted (M09 A15, M06, M05, M07, M11, M12): awareness, providers, interaction, evidence, orchestration, goals, workflows, inspect and diagnostics.
import manifest from "../package.json" with { type: "json" };

const declaredArtifacts = manifest.aetheriaArtifacts as Record<
  string,
  { version: string; stamp: string } | undefined
>;

function pinned(id: string) {
  const declared = declaredArtifacts[id];
  if (declared === undefined || !/^sha256:[0-9a-f]{64}$/.test(declared.stamp)) {
    throw new Error(`package.json must declare ${id} under aetheriaArtifacts with a sha256 stamp`);
  }
  return Object.freeze({ package: id, version: declared.version, stamp: declared.stamp });
}

/** The awareness archive: the shared runtime, validator and board policy. It is the one the XC-7 status names. */
export const PINNED_ARTIFACT = pinned("@aetheria/awareness");

/** The providers archive: route availability (XC-11), the strict operation handlers, the production adapters and the labelled fixture. */
export const PROVIDERS_PINNED_ARTIFACT = pinned("@aetheria/providers");

/** The interaction archive (M06): the interaction core, its file store and its service. The `human-control-backend` module's row names it. */
export const INTERACTION_PINNED_ARTIFACT = pinned("@aetheria/interaction");

/** The evidence archive (M06 step 22): the read-only audit evidence port `audit.history` runs. The `human-control-backend` row names it too. */
export const EVIDENCE_PINNED_ARTIFACT = pinned("@aetheria/evidence");

/** The orchestration archive (M05 step 9): the children service, its stores and M03's identity store as the child writer. The `orchestration-backend` row names it. */
export const ORCHESTRATION_PINNED_ARTIFACT = pinned("@aetheria/orchestration");

/** The goals archive (M07 step 14): the goal store and service. The `goals-backend` row names it. */
export const GOALS_PINNED_ARTIFACT = pinned("@aetheria/goals");

/** The workflows archive (M07 step 22): the workflow ledger and its three run-record operations. The `workflows-backend` row names it. */
export const WORKFLOWS_PINNED_ARTIFACT = pinned("@aetheria/workflows");

/** The inspect archive (M11 DV5): the read-only inspection core — the closed protocol, strict codecs, the projector and the provider registry. The `inspect-backend` row names it. */
export const INSPECT_PINNED_ARTIFACT = pinned("@aetheria/inspect");

/** The diagnostics archive (M12 step 8): the content-free event, the vocabulary, the recorder and the sink port. The `diagnostics-backend` row names it. */
export const DIAGNOSTICS_PINNED_ARTIFACT = pinned("@aetheria/diagnostics");

/** Every stamp the Backend gives the shared validator, by archive id. */
export const PINNED_ARTIFACT_STAMPS: Readonly<Record<string, string>> = Object.freeze({
  [PINNED_ARTIFACT.package]: PINNED_ARTIFACT.stamp,
  [PROVIDERS_PINNED_ARTIFACT.package]: PROVIDERS_PINNED_ARTIFACT.stamp,
  [INTERACTION_PINNED_ARTIFACT.package]: INTERACTION_PINNED_ARTIFACT.stamp,
  [EVIDENCE_PINNED_ARTIFACT.package]: EVIDENCE_PINNED_ARTIFACT.stamp,
  [ORCHESTRATION_PINNED_ARTIFACT.package]: ORCHESTRATION_PINNED_ARTIFACT.stamp,
  [GOALS_PINNED_ARTIFACT.package]: GOALS_PINNED_ARTIFACT.stamp,
  [WORKFLOWS_PINNED_ARTIFACT.package]: WORKFLOWS_PINNED_ARTIFACT.stamp,
  [INSPECT_PINNED_ARTIFACT.package]: INSPECT_PINNED_ARTIFACT.stamp,
  [DIAGNOSTICS_PINNED_ARTIFACT.package]: DIAGNOSTICS_PINNED_ARTIFACT.stamp,
});

/** Every archive this build pins (package, version, stamp), for the diagnostics health's installed versions. Read from the same declarations as the stamps above. */
export const PINNED_ARCHIVES: readonly {
  readonly package: string;
  readonly version: string;
  readonly stamp: string;
}[] = Object.freeze([
  PINNED_ARTIFACT,
  PROVIDERS_PINNED_ARTIFACT,
  INTERACTION_PINNED_ARTIFACT,
  EVIDENCE_PINNED_ARTIFACT,
  ORCHESTRATION_PINNED_ARTIFACT,
  GOALS_PINNED_ARTIFACT,
  WORKFLOWS_PINNED_ARTIFACT,
  INSPECT_PINNED_ARTIFACT,
  DIAGNOSTICS_PINNED_ARTIFACT,
]);
