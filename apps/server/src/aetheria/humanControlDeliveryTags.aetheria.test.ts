// @effect-diagnostics nodeBuiltinImport:off
// AETHERIA M06 Plan step 13 (D5) — the "not accepted" error set of the late-answer delivery is a COPY of `ThreadMessageIntake`'s own set; this test
// fails the day the two differ, so an upstream merge that adds, removes or renames a tag cannot silently turn a definite rejection into an unknown
// outcome (or the reverse).
//
// Boundary: the text of the upstream `ThreadMessageIntake.ts` `dispatchWasNotAccepted` switch, read from disk, against the adapter's exported set.
// It shows the tag lists are equal now. It does NOT show that T3 raises those errors before it commits (the delivery suite over T3's real
// dispatch and the sub-phase 1 probe do); a rewrite of the switch into another shape makes the parser find no tags, and that fails here too.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vitest";

import { NOT_ACCEPTED_TAGS } from "./humanControlDelivery.ts";

const INTAKE = new URL("../orchestration-v2/ThreadMessageIntake.ts", import.meta.url);

/** The case labels of `dispatchWasNotAccepted` whose branch returns true, or undefined when the function's shape is not the one this parser knows. */
const notAcceptedTagsOf = (source: string): readonly string[] | undefined => {
  const start = source.indexOf("function dispatchWasNotAccepted(");
  if (start < 0) return undefined;
  const open = source.indexOf("switch (error._tag) {", start);
  const accept = source.indexOf("return true;", open);
  const fallback = source.indexOf("default:", accept);
  if (open < 0 || accept < 0 || fallback < 0) return undefined;
  const labels = [...source.slice(open, accept).matchAll(/case\s+"([A-Za-z0-9_]+)"\s*:/g)].map(
    (match) => match[1]!,
  );
  return labels.length === 0 ? undefined : labels;
};

describe("the delivery adapter's not-accepted set follows ThreadMessageIntake", () => {
  it("lists exactly the tags the intake treats as raised before the command commits", () => {
    const upstream = notAcceptedTagsOf(NodeFS.readFileSync(INTAKE, "utf8"));
    expect(
      upstream,
      "ThreadMessageIntake.dispatchWasNotAccepted could not be parsed",
    ).toBeDefined();
    expect([...NOT_ACCEPTED_TAGS].sort()).toEqual([...upstream!].sort());
  });

  it("notices an added, removed or renamed upstream tag, and an upstream rewrite it cannot read", () => {
    const real = NodeFS.readFileSync(INTAKE, "utf8");
    const upstream = notAcceptedTagsOf(real)!;
    const added = real.replace(
      'case "ThreadManagementProviderInstanceDisabledError":',
      'case "ThreadManagementProviderInstanceDisabledError":\n    case "SomeNewPreCommitError":',
    );
    expect(notAcceptedTagsOf(added)).toEqual([...upstream, "SomeNewPreCommitError"]);
    expect([...NOT_ACCEPTED_TAGS].sort()).not.toEqual([...notAcceptedTagsOf(added)!].sort());
    const renamed = real.replace(
      "OrchestratorCommandRejectedError",
      "OrchestratorCommandRefusedError",
    );
    expect([...NOT_ACCEPTED_TAGS].sort()).not.toEqual([...notAcceptedTagsOf(renamed)!].sort());
    expect(notAcceptedTagsOf(real.replace("function dispatchWasNotAccepted(", "const x = ("))).toBe(
      undefined,
    );
  });
});
