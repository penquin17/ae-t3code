// AETHERIA M09 Plan step 12: the strict `research.*` operation schemas, checked at their own boundary against the shared vectors.
//
// The same vectors are decoded by the outer package's plain-TypeScript codecs (tests/tools/research/contracts.test.mjs). Here each `accept`
// vector must decode unchanged and each `refuse` vector must throw under `onExcessProperty: "error"`. This shows the schemas' shapes; the
// Backend that fills them and the XC-6 envelope around them are tested elsewhere, and the envelope is not changed by this file.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  RESEARCH_CANCEL_OPERATION,
  RESEARCH_FETCH_OPERATION,
  RESEARCH_SEARCH_OPERATION,
  ResearchCancelArgs,
  ResearchCancelResult,
  ResearchFetchArgs,
  ResearchSearchArgs,
  WEB_CODES,
  XC6_OPERATION_NAME_PATTERN,
  researchOutcome,
} from "./index.ts";
import { researchVectors } from "./researchOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;
const SCHEMAS = {
  searchArgs: ResearchSearchArgs,
  fetchArgs: ResearchFetchArgs,
  cancelArgs: ResearchCancelArgs,
  researchOutcome: researchOutcome(Schema.Struct({ marker: Schema.String })),
  cancelResult: ResearchCancelResult,
} as const;

describe("research.* operations", () => {
  it("are named by the registered strings, each valid under the XC-6 name pattern", () => {
    const names = [RESEARCH_SEARCH_OPERATION, RESEARCH_FETCH_OPERATION, RESEARCH_CANCEL_OPERATION];
    expect(names).toEqual(["research.search", "research.fetch", "research.cancel"]);
    for (const name of names) expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });

  it("carry the design's ten WEB_* codes and two step-12 additions, each prefixed WEB_", () => {
    expect([...WEB_CODES].sort()).toEqual(
      [
        "WEB_ABORTED",
        "WEB_BLOCKED_URL",
        "WEB_DUPLICATE_REQUEST",
        "WEB_FETCH_TIMEOUT",
        "WEB_FETCH_TOO_LARGE",
        "WEB_INVALID_ARGUMENTS",
        "WEB_INVALID_URL",
        "WEB_PROVIDER_CREDENTIAL_MISSING",
        "WEB_PROVIDER_ERROR",
        "WEB_REDIRECT_BLOCKED",
        "WEB_UNAVAILABLE",
        "WEB_UNSUPPORTED_CONTENT_TYPE",
      ].sort(),
    );
  });

  it("have one schema per vector set and one vector set per schema", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(researchVectors).sort());
  });

  const cases = Object.entries(SCHEMAS).flatMap(([codec, schema]) => {
    const decode = Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict);
    return [
      ...(researchVectors[codec]?.accept ?? []).map((vector) => ({
        codec,
        kind: "accepts",
        vector,
        decode,
      })),
      ...(researchVectors[codec]?.refuse ?? []).map((vector) => ({
        codec,
        kind: "refuses",
        vector,
        decode,
      })),
    ];
  });

  it.each(cases)("$codec $kind: $vector.name", ({ kind, vector, decode }) => {
    if (kind === "accepts") expect(decode(structuredClone(vector.value))).toEqual(vector.value);
    else expect(() => decode(structuredClone(vector.value))).toThrow();
  });
});
