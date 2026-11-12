// @effect-diagnostics nodeBuiltinImport:off - the generator is a plain Node script, tested through its files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { buildOutputs } from "../scripts/build-tokens.ts";
import { t3Mapping } from "../src/mapping.ts";

const packageRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const script = NodePath.join(packageRoot, "scripts", "build-tokens.ts");
const sourceFile = NodePath.join(packageRoot, "tokens", "aetheria.tokens.json");
const generatedFiles = ["aetheria.css", "names.ts", "resolved.ts"];

type Source = Record<string, any>;

const scratch: string[] = [];
function tempDir(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ae-design-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) NodeFS.rmSync(dir, { recursive: true, force: true });
});

function readSource(): Source {
  return JSON.parse(NodeFS.readFileSync(sourceFile, "utf8"));
}
function edited(edit: (source: Source) => void): Source {
  const source = readSource();
  edit(source);
  return source;
}
function build(source: Source) {
  return buildOutputs(source, t3Mapping);
}

describe("token build", () => {
  it("is deterministic", () => {
    const first = build(readSource());
    const second = build(readSource());
    expect(second).toEqual(first);
    expect(Object.keys(first).sort()).toEqual([...generatedFiles].sort());
  });

  it("matches the committed outputs when run as the package build", () => {
    const out = tempDir();
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [script, "--tokens", sourceFile, "--out", out],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    for (const file of generatedFiles) {
      const committed = NodeFS.readFileSync(
        NodePath.join(packageRoot, "src", "generated", file),
        "utf8",
      );
      expect(NodeFS.readFileSync(NodePath.join(out, file), "utf8"), `${file} is stale`).toBe(
        committed,
      );
    }
  });

  it("exits 1 with the reason for an invalid source instead of writing defaults", () => {
    const bad = NodePath.join(tempDir(), "tokens.json");
    NodeFS.writeFileSync(
      bad,
      JSON.stringify(
        edited((source) => {
          source.semantic.color.accent.fg.$value = "{primitive.blue.999}";
        }),
      ),
    );
    const out = tempDir();
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [script, "--tokens", bad, "--out", out],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown token {primitive.blue.999}");
    expect(NodeFS.readdirSync(out)).toEqual([]);
  });
});

describe("strict validation", () => {
  it("fails on an unknown alias", () => {
    const source = edited((s) => {
      s.semantic.color.accent.fg.$value = "{primitive.blue.999}";
    });
    expect(() => build(source)).toThrow(/unknown token \{primitive\.blue\.999\}/);
  });

  it("fails on a missing tier", () => {
    const source = edited((s) => {
      delete s.component;
    });
    expect(() => build(source)).toThrow(/missing tier "component"/);
  });

  it("fails on a circular alias", () => {
    const source = edited((s) => {
      s.semantic.color.border.$value = "{semantic.color.label.primary}";
      s.semantic.color.label.primary.$value = "{semantic.color.border}";
      delete s.semantic.color.label.primary.$extensions.aetheria.dark;
      delete s.semantic.color.border.$extensions.aetheria.dark;
    });
    expect(() => build(source)).toThrow(/circular alias/);
  });

  it("fails when an alias changes type", () => {
    const source = edited((s) => {
      s.semantic.color.border.$value = "{semantic.space.1}";
    });
    expect(() => build(source)).toThrow(/must keep its type/);
  });

  it("fails when a component token skips the semantic tier", () => {
    const source = edited((s) => {
      s.component["status-dot"].done.$value = "{primitive.green.500}";
    });
    expect(() => build(source)).toThrow(/semantic token/);
  });

  it("fails on a malformed colour", () => {
    const source = edited((s) => {
      s.primitive.blue["600"].$value = "blue";
    });
    expect(() => build(source)).toThrow(/malformed color/);
  });

  it("keeps a number alias numeric and refuses a number that is not one", () => {
    const aliased = edited((s) => {
      s.component.probe = { level: { $type: "number", $value: "{semantic.opacity.disabled}" } };
    });
    expect(build(aliased)["aetheria.css"]).toContain("--ae-probe-level: 0.5;");
    const literal = edited((s) => {
      s.semantic.opacity.hover.$value = "0.1";
    });
    expect(() => build(literal)).toThrow(/malformed number/);
  });

  it("accepts a DSH-following expression in the source but refuses every other expression", () => {
    const accepted = edited((s) => {
      s.semantic.probe = {
        size: { $type: "dimension", $value: "var(--dsh-probe-size, 3px)" },
      };
    });
    expect(() => build(accepted)).not.toThrow();
    const refused: ReadonlyArray<readonly [string, string, string]> = [
      ["no DSH variable", "dimension", "var(--ae-space-3, 8px)"],
      ["a declaration end", "dimension", "var(--dsh-x, 1px); color: red"],
      ["a block", "color", "var(--dsw-x, red) } body { color: red"],
      ["unbalanced parentheses", "dimension", "calc(24px + var(--dsh-x, 0px)"],
      ["a comment", "dimension", "var(--dsh-x, 1px) /* x */"],
      ["a duration expression", "duration", "var(--dsh-x, 1ms)"],
      ["a plain malformed literal", "dimension", "24 pixels"],
    ];
    for (const [label, type, value] of refused) {
      const source = edited((s) => {
        s.semantic.probe = { x: { $type: type, $value: value } };
      });
      expect(() => build(source), label).toThrow(/malformed/);
    }
  });

  it("fails when the mapping names a token the source lacks, or one that is not a colour", () => {
    const missing = [{ ...t3Mapping[0]!, role: "semantic.color.bg.nowhere" }];
    expect(() => buildOutputs(readSource(), missing)).toThrow(/unknown token/);
    const notColour = [{ ...t3Mapping[0]!, role: "semantic.space.1" }];
    expect(() => buildOutputs(readSource(), notColour)).toThrow(/not a colour/);
  });

  it("fails when the mapping repeats a T3 variable", () => {
    const twice = [t3Mapping[0]!, t3Mapping[0]!];
    expect(() => buildOutputs(readSource(), twice)).toThrow(/twice/);
  });
});

describe("reduced-motion overrides", () => {
  const withOverride = (value: unknown) =>
    edited((s) => {
      s.semantic.motion.fast.$extensions.aetheria.reducedMotion = value;
    });

  const BAD: ReadonlyArray<readonly [string, unknown]> = [
    ["a malformed duration", "not-a-duration"],
    ["a number", 0],
    ["null", null],
    ["a list", ["0ms"]],
    ["an object", { value: "0ms" }],
    ["a declaration-breaking string", "0ms; color: red"],
    ["a block-breaking string", "0ms} body { color: red"],
    ["a duration with trailing text", "0ms /* x */"],
    ["an empty string", ""],
  ];

  it.each(BAD)("refuses %s with a reason naming the token", (_label, value) => {
    expect(() => build(withOverride(value))).toThrow(/semantic\.motion\.fast.*reducedMotion/);
  });

  it.each(BAD)("writes nothing when %s is the override", (_label, value) => {
    const bad = NodePath.join(tempDir(), "tokens.json");
    NodeFS.writeFileSync(bad, JSON.stringify(withOverride(value)));
    const out = tempDir();
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [script, "--tokens", bad, "--out", out],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reducedMotion");
    expect(NodeFS.readdirSync(out)).toEqual([]);
  });

  it("accepts another valid duration, and emits it as given", () => {
    const outputs = build(withOverride("30ms"));
    expect(outputs["aetheria.css"]).toContain("--ae-motion-fast: 30ms;");
    expect(outputs["aetheria.css"]).toContain("--ae-motion-fast: 120ms;");
  });

  it("still generates the committed motion block byte for byte from the accepted 0ms tokens", () => {
    const css = build(readSource())["aetheria.css"]!;
    const committed = NodeFS.readFileSync(
      NodePath.join(packageRoot, "src", "generated", "aetheria.css"),
      "utf8",
    );
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toBe(committed);
  });
});

describe("a changed source reaches both modes and the mapping without touching consumers", () => {
  it("carries a changed accent into the variables and the resolved pairs", () => {
    const source = edited((s) => {
      s.semantic.color.accent.$root.$value = "{primitive.blue.500}";
      s.semantic.color.accent.$root.$extensions.aetheria.dark = "{primitive.blue.300}";
    });
    const outputs = build(source);
    expect(outputs["aetheria.css"]).toContain("--ae-color-accent: #3b82f6;");
    expect(outputs["aetheria.css"]).toContain("--ae-color-accent: #93c5fd;");
    expect(outputs["resolved.ts"]).toContain('"--primary": { light: "#3B82F6", dark: "#93C5FD" }');
    expect(outputs["resolved.ts"]).toContain('"--ring": { light: "#3B82F6", dark: "#93C5FD" }');
  });
});
