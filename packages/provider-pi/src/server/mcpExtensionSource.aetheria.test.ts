// @effect-diagnostics nodeBuiltinImport:off -- Executes the shipped Pi extension at its native JavaScript boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import { assert, describe, it } from "@effect/vitest";

import { PI_T3_MCP_EXTENSION_SOURCE } from "./mcpExtensionSource.ts";

// Aetheria's fork-local contract for the optional orchestration section. The upstream tests in
// mcpExtensionSource.test.ts stay untouched and prove the default; these prove the opt-out.

const FLAG = "aetheria-disable-t3-orchestration";
const MARKER = "orchestrator_capabilities";

type Hook = (event: unknown, ctx: unknown) => unknown;

interface FlagOptions {
  readonly description?: string;
  readonly type: string;
  readonly default?: boolean;
}

interface LoadOptions {
  /** Pi builds without the extension flag API, as the upstream tests' doubles are. */
  readonly withFlagApi?: boolean;
  /** Value Pi applies from the command line after the extension has loaded. */
  readonly cliValue?: boolean | string | undefined;
  readonly runtimeMode?: string;
  readonly argv?: ReadonlyArray<string>;
}

async function loadExtension(options: LoadOptions = {}) {
  const { withFlagApi = true } = options;
  const order: string[] = [];
  const handlers = new Map<string, Hook>();
  // Several handlers share before_agent_start: trust notice first, orchestration last.
  const everyHandler = new Map<string, Hook[]>();
  const flags = new Map<string, FlagOptions>();
  const flagValues = new Map<string, boolean | string>();
  const source = NodeModule.stripTypeScriptTypes(
    PI_T3_MCP_EXTENSION_SOURCE.replace(/^import .*;$/gm, "").replace(
      "export default async function",
      "async function",
    ),
  );
  await NodeVM.runInNewContext(`${source}\nt3McpExtension(pi)`, {
    process: {
      env: {
        T3_MCP_URL: "http://fixture.invalid/mcp",
        T3_MCP_BEARER_TOKEN: "fixture-token",
        T3_PI_MCP_EXTENSION_PATH: "/fixture/pi-t3-extension.ts",
        T3_PI_RUNTIME_MODE: options.runtimeMode,
      },
      argv: ["node", "pi", ...(options.argv ?? [])],
    },
    AbortSignal,
    NodePath,
    NodeFSP,
    Type: { Unsafe: (schema: unknown) => schema },
    stripFrontmatter: (content: string) => content,
    fetch: async (_url: string, transport: { body: string }) => {
      const request = JSON.parse(transport.body) as { id: number; method: string };
      const result = request.method === "tools/list" ? { tools: [] } : {};
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
        headers: { "content-type": "application/json" },
      });
    },
    pi: {
      on: (name: string, handler: Hook) => {
        order.push(name);
        handlers.set(name, handler);
        everyHandler.set(name, [...(everyHandler.get(name) ?? []), handler]);
      },
      registerTool: () => undefined,
      getActiveTools: () => ["read"],
      setActiveTools: () => undefined,
      getAllTools: () => [],
      getCommands: () => [],
      ...(withFlagApi
        ? {
            registerFlag: (name: string, flag: FlagOptions) => {
              flags.set(name, flag);
              if (flag.default !== undefined && !flagValues.has(name)) {
                flagValues.set(name, flag.default);
              }
            },
            // Pi answers only for flags this extension registered.
            getFlag: (name: string) => (flags.has(name) ? flagValues.get(name) : undefined),
          }
        : {}),
    },
  });
  // Pi applies command-line flag values after the extension factory has returned.
  if (options.cliValue !== undefined) flagValues.set(FLAG, options.cliValue);
  const beforeAgentStart = handlers.get("before_agent_start")!;
  assert.isDefined(beforeAgentStart);
  return {
    order,
    handlers,
    everyHandler,
    flags,
    start: (event: Record<string, unknown>) =>
      beforeAgentStart(event, {
        model: { api: "anthropic-messages" },
        ui: { notify: assert.fail },
      }) as { systemPrompt: string } | undefined,
  };
}

const ordinaryEvent = () => ({
  systemPrompt: "base",
  systemPromptOptions: { sections: { project: "keep me" } as Record<string, string> },
});
const forcedEvent = () => ({
  systemPrompt: "forced",
  systemPromptOptions: {
    sections: { project: "keep me" } as Record<string, string>,
    forceSystemPrompt: "forced",
  },
});

describe("Aetheria flag registration", () => {
  it("registers one boolean flag that defaults to false", async () => {
    const extension = await loadExtension();
    assert.deepEqual([...extension.flags.keys()], [FLAG]);
    const flag = extension.flags.get(FLAG)!;
    assert.equal(flag.type, "boolean");
    assert.strictEqual(flag.default, false);
    assert.isString(flag.description);
  });

  it("keeps the upstream default on Pi builds without the flag API", async () => {
    const extension = await loadExtension({ withFlagApi: false });
    assert.equal(extension.flags.size, 0);
    const event = ordinaryEvent();
    extension.start(event);
    assert.include(event.systemPromptOptions.sections.t3_code_orchestration ?? "", MARKER);
  });
});

describe("Aetheria optional orchestration section", () => {
  it.each([
    { name: "the flag is left at its default", cliValue: undefined },
    { name: "the flag is explicitly false", cliValue: false },
    { name: "the flag value is not boolean true", cliValue: "true" },
  ])("sets the section in the ordinary path when $name", async ({ cliValue }) => {
    const extension = await loadExtension({ cliValue });
    const event = ordinaryEvent();
    assert.isUndefined(extension.start(event));
    assert.include(event.systemPromptOptions.sections.t3_code_orchestration ?? "", MARKER);
    assert.equal(event.systemPromptOptions.sections.project, "keep me");
    assert.equal(event.systemPrompt, "base");
  });

  it.each([
    { name: "the flag is left at its default", cliValue: undefined },
    { name: "the flag is explicitly false", cliValue: false },
  ])("appends guidance in the forced-prompt path when $name", async ({ cliValue }) => {
    const extension = await loadExtension({ cliValue });
    const event = forcedEvent();
    const result = extension.start(event);
    assert.isTrue(result!.systemPrompt.startsWith("forced\n\n"));
    assert.include(result!.systemPrompt, MARKER);
    assert.notProperty(event.systemPromptOptions.sections, "t3_code_orchestration");
  });

  it("suppresses only the section in the ordinary path when the flag is true", async () => {
    const extension = await loadExtension({ cliValue: true });
    const event = ordinaryEvent();
    assert.isUndefined(extension.start(event));
    assert.deepEqual(event, ordinaryEvent());
  });

  it("returns no prompt change in the forced-prompt path when the flag is true", async () => {
    const extension = await loadExtension({ cliValue: true });
    const event = forcedEvent();
    assert.isUndefined(extension.start(event));
    assert.deepEqual(event, forcedEvent());
  });

  it.each([
    { name: "no prompt options", event: { systemPrompt: "base" } },
    {
      name: "null sections",
      event: { systemPrompt: "base", systemPromptOptions: { sections: null } },
    },
  ])("adds nothing on Pi builds with $name when the flag is true", async ({ event }) => {
    const extension = await loadExtension({ cliValue: true });
    assert.isUndefined(extension.start(event));
  });

  it("reads the flag at each turn, after Pi has applied the command line", async () => {
    // The flag is registered during loading but its value arrives afterwards.
    const extension = await loadExtension({ cliValue: true });
    assert.isUndefined(extension.start(forcedEvent()));
    assert.isUndefined(extension.start(ordinaryEvent()));
  });
});

describe("Aetheria opt-out leaves the rest of the extension alone", () => {
  it("registers the same handlers in the same order with the flag on or off", async () => {
    const bare = await loadExtension({ withFlagApi: false });
    const off = await loadExtension();
    const on = await loadExtension({ cliValue: true });
    assert.deepEqual(off.order, bare.order);
    assert.deepEqual(on.order, bare.order);
    for (const name of [
      "before_agent_start",
      "input",
      "before_provider_request",
      "tool_call",
      "session_start",
    ]) {
      assert.include(on.order, name);
    }
  });

  it("still sends the project-trust notice once per session with the flag on", async () => {
    const extension = await loadExtension({ cliValue: true });
    const sent: string[] = [];
    const ctx = {
      cwd: "/repo",
      model: { api: "anthropic-messages" },
      isProjectTrusted: () => false,
      ui: { notify: (message: string) => sent.push(message) },
    };
    const hooks = extension.everyHandler.get("before_agent_start")!;
    assert.equal(hooks.length, 2);
    for (const _turn of [1, 2]) for (const hook of hooks) hook(ordinaryEvent(), ctx);
    assert.equal(sent.length, 1);
    assert.include(sent[0] ?? "", "for /repo because the folder is not trusted");
  });

  it("still gates tool calls by runtime mode with the flag on", async () => {
    const extension = await loadExtension({ cliValue: true, runtimeMode: "approval-required" });
    const toolCall = extension.handlers.get("tool_call") as unknown as (
      event: { toolName: string; input: unknown },
      ctx: { ui: { confirm: (title: string) => Promise<boolean> } },
    ) => Promise<{ block: true; reason: string } | undefined>;
    const confirmations: string[] = [];
    const ctx = {
      ui: {
        confirm: async (title: string) => {
          confirmations.push(title);
          return false;
        },
      },
    };
    assert.isUndefined(await toolCall({ toolName: "read", input: {} }, ctx));
    assert.equal((await toolCall({ toolName: "bash", input: {} }, ctx))?.block, true);
    assert.deepEqual(confirmations, ["Allow bash?"]);
  });

  it("does not touch the provider request or user input with the flag on", async () => {
    const extension = await loadExtension({ cliValue: true });
    const request = extension.handlers.get("before_provider_request")!;
    const payload = { max_tokens: 231_969 };
    assert.isUndefined(request({ payload }, { model: { provider: "anthropic" } }));
    const input = extension.handlers.get("input")!;
    assert.isUndefined(await input({ text: "Hello" }, { ui: { notify: assert.fail } }));
  });
});
