// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - plain Node script: the package build and its tests run it directly.
// Turns tokens/aetheria.tokens.json, the one home of every value, into the files the web app consumes:
//   aetheria.css  the --ae-* variables (dark values on :root.dark) and the mapping onto T3's variables
//   names.ts      every emitted variable name, typed
//   resolved.ts   resolved light/dark values for every variable and for every mapped T3 variable
// Output is deterministic: the same input gives byte-identical files. An unknown or circular alias,
// an unsupported type, a malformed value or a bad mapping fails the run; nothing falls back to a default.
//
// The source keeps its historical font and DSH metadata untouched. The output leaves out the primitive
// tier, every font token and the transcript tokens that follow DSH variables, so the stylesheet loads
// no font and names no DSH variable.
//
// Usage: node scripts/build-tokens.ts [--tokens <file>] [--out <dir>]

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { t3Mapping, type MappingEntry } from "../src/mapping.ts";

const packageRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

type Mode = "light" | "dark";
type Json = Record<string, unknown>;

interface Token {
  readonly path: string;
  readonly tier: string;
  readonly segments: readonly string[];
  readonly type: string;
  readonly value: unknown;
  readonly dark: string | undefined;
  readonly reducedMotion: string | undefined;
}

const TIERS = ["primitive", "semantic", "component"] as const;
const TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "number",
  "shadow",
]);
const SHADOW_FIELDS = ["offsetX", "offsetY", "blur", "spread", "color"] as const;
const ALIAS = /^\{([^{}]+)\}$/;
// Source groups the web app does not consume: type is a font choice (R2), transcript follows DSH variables.
const OMITTED_SEGMENTS = new Set(["font", "transcript"]);
// The default appearance: no palette id, or the empty one. Specificity (0,3,0) beats T3's :root rules in both modes.
const DEFAULT_APPEARANCE = ':root:not([data-theme-id]):not([data-theme-id=""])';

// The slogan in the empty-draft hero (M10a): the accepted size, on one line from 1280 down to 320 px.
const HEADLINE_RULE = `
/* The slogan in the new-thread hero: one line at every width, sized from the viewport. */
[data-aetheria-headline] {
  margin: 0 0 0.5rem;
  font-size: min(26px, calc(8vw - 4px));
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  text-align: center;
  white-space: nowrap;
}
`;

class TokenError extends Error {}
const fail = (message: string): never => {
  throw new TokenError(message);
};

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A var(...) or calc(...) expression that follows a DSH variable: balanced, one line, nothing that could end the declaration. */
function isDshExpression(value: unknown): boolean {
  if (typeof value !== "string" || !/^(?:var|calc)\(.*\)$/.test(value)) return false;
  if (/[;{}<>"'@\\\n\r]|\/\*/.test(value)) return false;
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && /--ds[hw]-/.test(value);
}

const VALUE_CHECKS: Record<string, (value: unknown) => boolean> = {
  color: (value) =>
    (typeof value === "string" &&
      /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) ||
    isDshExpression(value),
  dimension: (value) =>
    (typeof value === "string" && /^-?\d+(?:\.\d+)?(?:px|rem|em)$/.test(value)) ||
    isDshExpression(value),
  duration: (value) => typeof value === "string" && /^\d+(?:\.\d+)?ms$/.test(value),
  fontWeight: (value) =>
    /^\d{1,4}$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 1000,
  number: (value) => typeof value === "number" && Number.isFinite(value),
  fontFamily: (value) => typeof value === "string" && value.length > 0,
};

function collect(source: Json): Map<string, Token> {
  const tokens = new Map<string, Token>();
  for (const tier of TIERS) {
    const group = source[tier];
    if (!isRecord(group)) fail(`missing tier "${tier}"`);
    walk(group as Json, [tier], undefined, tokens);
  }
  for (const key of Object.keys(source)) {
    if (!key.startsWith("$") && !(TIERS as readonly string[]).includes(key)) {
      fail(`unknown top-level group "${key}"`);
    }
  }
  return tokens;
}

function walk(
  node: Json,
  path: string[],
  inheritedType: string | undefined,
  tokens: Map<string, Token>,
): void {
  if ("$value" in node) {
    const dotted = path.join(".");
    for (const key of Object.keys(node)) {
      if (!key.startsWith("$")) {
        fail(`"${dotted}" has a $value and a child "${key}"; use "$root" for a group's own token`);
      }
    }
    const type = (node.$type as string | undefined) ?? inheritedType;
    if (type === undefined || !TYPES.has(type)) {
      fail(`"${dotted}" has an unsupported or missing $type: ${String(type)}`);
    }
    if (tokens.has(dotted)) fail(`duplicate token "${dotted}"`);
    const extensions = isRecord(node.$extensions) ? node.$extensions : {};
    const aetheria = isRecord(extensions.aetheria) ? extensions.aetheria : {};
    tokens.set(dotted, {
      path: dotted,
      tier: path[0]!,
      segments: path.slice(1),
      type: type!,
      value: node.$value,
      dark: aetheria.dark as string | undefined,
      reducedMotion: aetheria.reducedMotion as string | undefined,
    });
    return;
  }
  const type = (node.$type as string | undefined) ?? inheritedType;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") && key !== "$root") continue;
    if (!isRecord(child)) fail(`"${[...path, key].join(".")}" is not a token or a group`);
    walk(child as Json, key === "$root" ? path : [...path, key], type, tokens);
  }
}

function checked(token: Token, field: string | undefined, value: unknown): string {
  const type = token.type === "shadow" ? (field === "color" ? "color" : "dimension") : token.type;
  const where = field ? `${token.path}.${field}` : token.path;
  if (!VALUE_CHECKS[type]!(value))
    fail(`"${where}" holds a malformed ${type} value: ${JSON.stringify(value)}`);
  return String(value);
}

function resolveString(
  token: Token,
  raw: unknown,
  mode: Mode,
  tokens: Map<string, Token>,
  stack: string[],
): unknown {
  const match = typeof raw === "string" ? ALIAS.exec(raw) : null;
  if (!match) return raw;
  const target = tokens.get(match[1]!);
  if (!target) return fail(`"${token.path}" refers to unknown token {${match[1]}}`);
  if (stack.includes(target.path)) fail(`circular alias: ${[...stack, target.path].join(" -> ")}`);
  if (target.type !== token.type) {
    fail(
      `"${token.path}" (${token.type}) aliases "${target.path}" (${target.type}); an alias must keep its type`,
    );
  }
  if (token.tier === "component" && target.tier === "primitive") {
    fail(
      `component token "${token.path}" aliases primitive "${target.path}"; point at a semantic token`,
    );
  }
  const resolved = resolveToken(target, mode, tokens, [...stack, target.path]);
  // A resolved value is text; a number-typed alias keeps its numeric type so its own check can pass.
  return token.type === "number" ? Number(resolved) : resolved;
}

function resolveField(
  token: Token,
  field: string,
  raw: string,
  mode: Mode,
  tokens: Map<string, Token>,
  stack: string[],
): string {
  const match = ALIAS.exec(raw);
  if (!match) return raw;
  const target = tokens.get(match[1]!);
  if (!target) return fail(`"${token.path}.${field}" refers to unknown token {${match[1]}}`);
  if (stack.includes(target.path)) fail(`circular alias: ${[...stack, target.path].join(" -> ")}`);
  const expected = field === "color" ? "color" : "dimension";
  if (target.type !== expected) {
    fail(
      `"${token.path}.${field}" aliases "${target.path}" (${target.type}); expected ${expected}`,
    );
  }
  return resolveToken(target, mode, tokens, [...stack, target.path]);
}

function resolveToken(
  token: Token,
  mode: Mode,
  tokens: Map<string, Token>,
  stack: string[] = [token.path],
): string {
  const raw = mode === "dark" && token.dark !== undefined ? token.dark : token.value;
  if (token.type === "shadow") {
    if (!isRecord(raw)) fail(`"${token.path}" must be an object with ${SHADOW_FIELDS.join(", ")}`);
    const fields = raw as Json;
    const parts = SHADOW_FIELDS.map((field) => {
      const part = fields[field];
      if (typeof part !== "string") fail(`"${token.path}" lacks shadow field "${field}"`);
      return checked(token, field, resolveField(token, field, part as string, mode, tokens, stack));
    });
    return parts.join(" ");
  }
  if (token.tier === "component" && !(typeof raw === "string" && ALIAS.test(raw))) {
    fail(`component token "${token.path}" must be an alias to a semantic token`);
  }
  return checked(token, undefined, resolveString(token, raw, mode, tokens, stack));
}

function cssName(token: Token): string {
  return `--ae-${token.tier === "primitive" ? "p-" : ""}${token.segments.join("-")}`;
}

const isEmitted = (token: Token): boolean =>
  token.tier !== "primitive" && !OMITTED_SEGMENTS.has(token.segments[0] ?? "");

function mappingToken(
  entry: MappingEntry,
  path: string,
  tokens: Map<string, Token>,
  type: "color" | "number",
): Token {
  const token = tokens.get(path);
  if (!token) return fail(`mapping ${entry.variable} refers to unknown token ${path}`);
  if (token.tier !== "semantic" || token.type !== type) {
    fail(
      `mapping ${entry.variable}: ${path} is not a ${type === "color" ? "colour" : "number"} token of the semantic tier`,
    );
  }
  return token;
}

const alphaHex = (opacity: string): string =>
  Math.round(Number(opacity) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");

// The package formatter lower-cases hex colours in CSS and wraps long lines at 100 columns;
// emitting that form keeps the generated files formatter-clean.
const lowerHex = (value: string): string =>
  value.replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => hex.toLowerCase());

const declarations = (entries: ReadonlyArray<readonly [string, string]>): string =>
  entries.map(([name, value]) => `  ${name}: ${lowerHex(value)};`).join("\n");

const pairLiteral = (name: string, light: string, dark: string): string => {
  const single = `  ${JSON.stringify(name)}: { light: ${JSON.stringify(light)}, dark: ${JSON.stringify(dark)} },`;
  if (single.length <= 100) return single;
  return `  ${JSON.stringify(name)}: {\n    light: ${JSON.stringify(light)},\n    dark: ${JSON.stringify(dark)},\n  },`;
};

export function buildOutputs(
  source: Json,
  mapping: readonly MappingEntry[],
): Record<string, string> {
  const tokens = collect(source);
  const list = [...tokens.values()];
  const names = new Map<string, string>();
  for (const token of list) {
    const name = cssName(token);
    const clash = names.get(name);
    if (clash !== undefined) fail(`"${token.path}" and "${clash}" both produce ${name}`);
    names.set(name, token.path);
    if (token.dark !== undefined && !(token.tier === "semantic" && token.type === "color")) {
      fail(`"${token.path}": a dark value is allowed only on a semantic colour`);
    }
    if (token.reducedMotion !== undefined && token.type !== "duration") {
      fail(`"${token.path}": reducedMotion is allowed only on a duration`);
    }
  }
  const light = new Map<Token, string>();
  const dark = new Map<Token, string>();
  for (const token of list) {
    light.set(token, resolveToken(token, "light", tokens));
    dark.set(token, resolveToken(token, "dark", tokens));
  }

  const emitted = list.filter(isEmitted);
  const header =
    "Generated by scripts/build-tokens.ts from tokens/aetheria.tokens.json. Do not edit.";
  const lightEntries = emitted.map((token) => [cssName(token), light.get(token)!] as const);
  const darkEntries = emitted
    .filter((token) => dark.get(token) !== light.get(token))
    .map((token) => [cssName(token), dark.get(token)!] as const);
  const motionEntries = emitted
    .filter((token) => token.reducedMotion !== undefined)
    .map((token) => [cssName(token), token.reducedMotion!] as const);

  const seen = new Set<string>();
  const mapped = mapping.map((entry) => {
    if (!/^--[a-z0-9-]+$/.test(entry.variable) || entry.variable.startsWith("--ae-")) {
      fail(`mapping names a malformed or reserved variable: ${entry.variable}`);
    }
    if (seen.has(entry.variable)) fail(`mapping maps ${entry.variable} twice`);
    seen.add(entry.variable);
    const role = mappingToken(entry, entry.role, tokens, "color");
    const opacity =
      entry.overlay === undefined
        ? undefined
        : mappingToken(entry, entry.overlay, tokens, "number");
    const resolve = (mode: Mode): string => {
      const base = (mode === "dark" ? dark : light).get(role)!;
      if (opacity === undefined) return base;
      if (!/^#[0-9a-fA-F]{6}$/.test(base))
        fail(`mapping ${entry.variable}: an overlay needs an opaque #RRGGBB role, not ${base}`);
      return `${base}${alphaHex(light.get(opacity)!)}`;
    };
    const reference =
      opacity === undefined
        ? `var(${cssName(role)})`
        : `color-mix(\n    in srgb,\n    var(${cssName(role)}) calc(var(${cssName(opacity)}) * 100%),\n    transparent\n  )`;
    return { variable: entry.variable, reference, light: resolve("light"), dark: resolve("dark") };
  });

  let css = `/* ${header} */\n:root {\n${declarations(lightEntries)}\n}\n\n:root.dark {\n${declarations(darkEntries)}\n}\n`;
  if (motionEntries.length > 0) {
    css += `\n@media (prefers-reduced-motion: reduce) {\n  :root {\n${declarations(motionEntries).replace(/^/gm, "  ")}\n  }\n}\n`;
  }
  css +=
    `\n/* T3's own variables, set from the --ae tokens for the default appearance and the sidebar subtree.\n` +
    `   A selected or custom palette matches none of these selectors, so it keeps control. */\n` +
    `${DEFAULT_APPEARANCE},\n${DEFAULT_APPEARANCE} [data-app-sidebar] {\n` +
    `${declarations(mapped.map((entry) => [entry.variable, entry.reference] as const))}\n}\n`;
  css += HEADLINE_RULE;

  const tsHeader = `// ${header}\n`;
  const namesTs = `${tsHeader}export const tokenNames = [\n${emitted.map((token) => `  ${JSON.stringify(cssName(token))},`).join("\n")}\n] as const;\n`;
  const resolvedTs =
    `${tsHeader}export interface ResolvedPair {\n  readonly light: string;\n  readonly dark: string;\n}\n\n` +
    `/** Every emitted --ae variable. */\nexport const tokenValues: Readonly<Record<string, ResolvedPair>> = {\n` +
    `${emitted.map((token) => pairLiteral(cssName(token), light.get(token)!, dark.get(token)!)).join("\n")}\n};\n\n` +
    `/** Every mapped T3 variable; an overlay is the role colour with its opacity as the last byte. */\n` +
    `export const t3Resolved: Readonly<Record<string, ResolvedPair>> = {\n` +
    `${mapped.map((entry) => pairLiteral(entry.variable, entry.light, entry.dark)).join("\n")}\n};\n`;

  return { "aetheria.css": css, "names.ts": namesTs, "resolved.ts": resolvedTs };
}

function main(argv: readonly string[]): void {
  const options: Record<string, string> = {
    tokens: NodePath.join(packageRoot, "tokens", "aetheria.tokens.json"),
    out: NodePath.join(packageRoot, "src", "generated"),
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    const value = argv[index + 1];
    if (!key || !(key in options) || value === undefined) {
      fail("usage: build-tokens.ts [--tokens file] [--out dir]");
    }
    options[key!] = NodePath.resolve(value!);
  }
  let source: Json;
  try {
    source = JSON.parse(NodeFS.readFileSync(options.tokens!, "utf8")) as Json;
  } catch (error) {
    return fail(`cannot read tokens ${options.tokens}: ${(error as Error).message}`);
  }
  const outputs = buildOutputs(source, t3Mapping);
  NodeFS.mkdirSync(options.out!, { recursive: true });
  for (const [file, text] of Object.entries(outputs)) {
    NodeFS.writeFileSync(NodePath.join(options.out!, file), text);
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    console.error(`build-tokens: ${error.message}`);
    process.exit(1);
  }
}
