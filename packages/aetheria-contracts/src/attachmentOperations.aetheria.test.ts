// AETHERIA M09 Plan step 21: the strict `attachments.*` operation schemas, checked at their own boundary against the shared vectors.
//
// The same argument vectors are run through the Backend's decoders in the outer providers package (tests/providers/snapshots/vectors.test.mjs).
// Here each `accept` vector must decode unchanged and each `refuse` vector must throw under `onExcessProperty: "error"`. This shows the schemas'
// shapes; the Backend that fills them and the XC-6 envelope around them are tested elsewhere, and the envelope is not changed by this file.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  SNAPSHOT_DESCRIBE_OPERATION,
  SNAPSHOT_STORE_OPERATION,
  SnapshotDescribeArgs,
  SnapshotResult,
  SnapshotStoreArgs,
  XC6_OPERATION_NAME_PATTERN,
} from "./index.ts";
import { attachmentVectors } from "./attachmentOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;
const SCHEMAS = {
  storeArgs: SnapshotStoreArgs,
  describeArgs: SnapshotDescribeArgs,
  snapshotResult: SnapshotResult,
} as const;

describe("attachments.* operations", () => {
  it("are named by the registered strings, each valid under the XC-6 name pattern", () => {
    const names = [SNAPSHOT_STORE_OPERATION, SNAPSHOT_DESCRIBE_OPERATION];
    expect(names).toEqual(["attachments.store-snapshot", "attachments.describe-snapshot"]);
    for (const name of names) expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });

  it("have one schema per vector set and one vector set per schema", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(attachmentVectors).sort());
  });

  const cases = Object.entries(SCHEMAS).flatMap(([codec, schema]) => {
    const decode = Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict);
    return [
      ...(attachmentVectors[codec]?.accept ?? []).map((vector) => ({
        codec,
        kind: "accepts",
        vector,
        decode,
      })),
      ...(attachmentVectors[codec]?.refuse ?? []).map((vector) => ({
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
