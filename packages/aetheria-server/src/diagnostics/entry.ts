// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M12 Plan step 8 — the one import site of the pinned `@aetheria/diagnostics` archive, through its Backend entry (the content-free event, the vocabulary, the recorder and the sink port). Every other
// file under `diagnostics/` takes these names from here, so a test can check that no other file reaches the archive and that no outer-source path is used.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";

export {
  EVENT_FIELDS,
  SINK_RELEASED,
  WRITER_EXISTS,
  buildEvent,
  createRecorder,
  parseVocabulary,
} from "@aetheria/diagnostics/backend";
export type {
  AppendReceipt,
  BuildResult,
  DiagnosticEvent,
  DiagnosticsSink,
  DiagnosticsStore,
  FlushReport,
  Health,
  OpenResult,
  Producer,
  ReadResult,
  Recorder,
  ReleaseReport,
  SinkResult,
  Vocabulary,
} from "@aetheria/diagnostics/backend";

/**
 * The text of the vocabulary file the archive carries (`vocabulary.yml`, exported by the package). Read from the installed archive, never from the outer checkout. Throws when it cannot be read: the
 * caller (the registration) reports that as an unavailable recorder and never lets it stop the Backend.
 */
export function readPackagedVocabulary(): string {
  const path = NodeModule.createRequire(import.meta.url).resolve(
    "@aetheria/diagnostics/vocabulary.yml",
  );
  return NodeFS.readFileSync(path, "utf8");
}
