// AETHERIA M09 Plan step 2: the strict `providers.*` operation schemas, checked at their own boundary against the shared vectors.
//
// The same vectors are decoded by the outer package's plain-TypeScript codecs (tests/providers/contracts.test.mjs). Here each `accept`
// vector must decode unchanged and each `refuse` vector must throw under `onExcessProperty: "error"`. This shows the schemas' shapes; the
// Backend that fills them and the XC-6 envelope around them are tested elsewhere, and the envelope is not changed by this file.
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  FailureReport,
  PROVIDERS_REPORT_FAILURE_OPERATION,
  PROVIDERS_ROUTE_CAPABILITIES_OPERATION,
  PROVIDERS_ROUTE_STATES_OPERATION,
  PROVIDERS_USAGE_OPERATION,
  ReportFailureArgs,
  RouteCapabilities,
  RouteCapabilitiesArgs,
  RouteStatesArgs,
  RouteStatesResult,
  UsageArgs,
  UsageResult,
  XC6_OPERATION_NAME_PATTERN,
} from "./index.ts";
import { providersVectors } from "./providersOperations.vectors.ts";

const strict = { onExcessProperty: "error" } as const;
const SCHEMAS = {
  routeStatesArgs: RouteStatesArgs,
  routeStatesResult: RouteStatesResult,
  reportFailureArgs: ReportFailureArgs,
  failureReport: FailureReport,
  routeCapabilitiesArgs: RouteCapabilitiesArgs,
  routeCapabilities: RouteCapabilities,
  usageArgs: UsageArgs,
  usageResult: UsageResult,
} as const;

describe("providers.* operations", () => {
  it("are named by the registered strings, each valid under the XC-6 name pattern", () => {
    const names = [
      PROVIDERS_ROUTE_STATES_OPERATION,
      PROVIDERS_REPORT_FAILURE_OPERATION,
      PROVIDERS_ROUTE_CAPABILITIES_OPERATION,
      PROVIDERS_USAGE_OPERATION,
    ];
    expect(names).toEqual([
      "providers.route-states",
      "providers.report-failure",
      "providers.route-capabilities",
      "providers.usage",
    ]);
    for (const name of names) expect(XC6_OPERATION_NAME_PATTERN.test(name)).toBe(true);
  });

  it("have one schema per vector set and one vector set per schema", () => {
    expect(Object.keys(SCHEMAS).sort()).toEqual(Object.keys(providersVectors).sort());
  });

  const cases = Object.entries(SCHEMAS).flatMap(([codec, schema]) => {
    const decode = Schema.decodeUnknownSync(schema as Schema.Decoder<unknown>, strict);
    return [
      ...(providersVectors[codec]?.accept ?? []).map((vector) => ({
        codec,
        kind: "accepts",
        vector,
        decode,
      })),
      ...(providersVectors[codec]?.refuse ?? []).map((vector) => ({
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
