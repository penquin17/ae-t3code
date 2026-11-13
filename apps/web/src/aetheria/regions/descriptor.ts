// Authoring a region declaration (D17, XC-19). The one descriptor is the contract's `RegionDescriptor` (the Backend decodes the same schema), so this file holds no second copy of its rules: it fills what an
// author may leave out — a field reports its SHAPE unless it says `value`, the schema version is 1 — then decodes through the contract, and adds the two checks the contract cannot make: a token must be one the
// design package lists, and the schema version must be one this client speaks. A declaration has no place for a value; values exist only in a query's answer (registry.ts).
import {
  REGIONS_SCHEMA_VERSION,
  RegionDescriptor,
  type RegionDescriptor as RegionDescriptorType,
} from "@t3tools/aetheria-contracts";
import { tokenNames } from "@t3tools/aetheria-design";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type { RegionDescriptorType as RegionDescriptor };
export type RegionKind = RegionDescriptorType["kind"];
export type FieldType = RegionDescriptorType["props"][number]["type"];
export type ReportMode = "value" | "shape";

export interface FieldDeclaration {
  readonly name: string;
  readonly type: FieldType;
  /** Absent means `shape`: a value is reported only when the author writes `value`. */
  readonly report?: ReportMode;
}

export interface RegionDeclaration {
  readonly id: string;
  readonly kind: RegionKind;
  /** The module id that owns the region. */
  readonly owner: string;
  readonly parent: string | null;
  readonly description: string;
  readonly schemaVersion?: number;
  readonly props?: readonly FieldDeclaration[];
  readonly state?: readonly FieldDeclaration[];
  /** Names from the design package's token list; their live values are read at a query. */
  readonly tokens?: readonly string[];
}

export type DeclarationFailure = "invalid" | "unknown-token" | "schema-unsupported";
export type DeclarationResult =
  | { readonly ok: true; readonly descriptor: RegionDescriptorType }
  | { readonly ok: false; readonly code: DeclarationFailure; readonly reason: string };

const known: ReadonlySet<string> = new Set(tokenNames);
const decode = Schema.decodeUnknownOption(RegionDescriptor as never, {
  onExcessProperty: "error",
}) as (input: unknown) => Option.Option<RegionDescriptorType>;

const withReport = (fields: readonly FieldDeclaration[] | undefined) =>
  (fields ?? []).map((field) => ({ ...field, report: field.report ?? "shape" }));

/** The descriptor a declaration stands for, or why it is not one. */
export function checkDeclaration(declaration: RegionDeclaration): DeclarationResult {
  const schemaVersion = declaration.schemaVersion ?? REGIONS_SCHEMA_VERSION;
  if (schemaVersion !== REGIONS_SCHEMA_VERSION)
    return {
      ok: false,
      code: "schema-unsupported",
      reason: `region "${declaration.id}" declares schema version ${String(schemaVersion)}; this client speaks ${REGIONS_SCHEMA_VERSION}`,
    };
  const unknownToken = (declaration.tokens ?? []).find((name) => !known.has(name));
  if (unknownToken !== undefined)
    return {
      ok: false,
      code: "unknown-token",
      reason: `region "${declaration.id}" names token ${unknownToken}, which the design package does not list`,
    };
  const decoded = decode({
    ...declaration,
    schemaVersion,
    props: withReport(declaration.props),
    state: withReport(declaration.state),
    tokens: [...(declaration.tokens ?? [])],
  });
  if (Option.isNone(decoded))
    return {
      ok: false,
      code: "invalid",
      reason: `region "${declaration.id}" is not a valid descriptor`,
    };
  return { ok: true, descriptor: decoded.value };
}

/** Declares a region at module load: a bad declaration throws there, so a build or a test run stops at it. */
export function declareRegion(declaration: RegionDeclaration): RegionDescriptorType {
  const result = checkDeclaration(declaration);
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  return result.descriptor;
}
