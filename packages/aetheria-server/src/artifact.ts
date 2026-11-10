// AETHERIA — the pinned library artifacts this build carries, read from this package's own declaration.
//
// The outer build wrote each archive and its stamp (tools/lib/foundations/artifact.mjs); the manifest's `aetheriaArtifacts` entries are the
// declaration the graphs check compares with the archive bytes. The Backend publishes these stamps as facts of its composition, so a
// module whose row expects another stamp is refused as stale. Three archives are accepted (M09 A15, M06): awareness, providers and interaction.
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

/** Every stamp the Backend gives the shared validator, by archive id. */
export const PINNED_ARTIFACT_STAMPS: Readonly<Record<string, string>> = Object.freeze({
  [PINNED_ARTIFACT.package]: PINNED_ARTIFACT.stamp,
  [PROVIDERS_PINNED_ARTIFACT.package]: PROVIDERS_PINNED_ARTIFACT.stamp,
  [INTERACTION_PINNED_ARTIFACT.package]: INTERACTION_PINNED_ARTIFACT.stamp,
});
