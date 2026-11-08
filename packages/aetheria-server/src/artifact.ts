// AETHERIA — the pinned library artifact this build carries, read from this package's own declaration.
//
// The outer build wrote the archive and its stamp (tools/lib/foundations/artifact.mjs); the manifest's `aetheriaArtifacts` entry is the
// declaration the graphs check compares with the archive bytes. The Backend publishes this stamp as a fact of its composition, so a
// module whose row expects another stamp is refused as stale.
import manifest from "../package.json" with { type: "json" };

const ID = "@aetheria/awareness";

const declared = (
  manifest.aetheriaArtifacts as Record<string, { version: string; stamp: string } | undefined>
)[ID];
if (declared === undefined || !/^sha256:[0-9a-f]{64}$/.test(declared.stamp)) {
  throw new Error(`package.json must declare ${ID} under aetheriaArtifacts with a sha256 stamp`);
}

export const PINNED_ARTIFACT = Object.freeze({
  package: ID,
  version: declared.version,
  stamp: declared.stamp,
});
