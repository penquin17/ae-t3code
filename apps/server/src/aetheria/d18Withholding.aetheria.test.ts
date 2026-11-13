// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off globalRandom:off
// AETHERIA M05 Plan step 9 (D18 as extended 2026-11-12; IP-4 widened) — T3's thread-creating MCP tools are absent from the FIRST and every later model request on an
// `openai-completions` model, with T3's real load order.
//
// Native round 4: on `openai-completions`, T3's MCP extension re-activates its whole catalog at session_start, model_select, session_tree and before_agent_start (mcpExtensionSource.ts
// `reconcileDiscovery`), after Aetheria's host has withdrawn the names, and Pi snapshots the active tools before `turn_start`; so the first request offered `delegate_task` and
// `task_status` (and every other T3 tool). The fix is in T3's extension: with Aetheria's flag set it re-activates nothing from the withheld set.
//
// Boundary: the installed Pi 1.5.0 (`pi --mode rpc`, offline) with a REAL loopback `openai-completions` provider (the scripted wire the native drivers use; the test reads every
// request body it receives), T3's real MCP extension source loaded unchanged from the fork and talking to a stub MCP server that lists the whole withheld set plus other T3 tools,
// and Aetheria's REAL Pi host (the built @aetheria/pi `createExtension`, empty composition: tests/orchestration/probes/aetheria-host-probe.mjs) loaded FIRST, then T3's extension
// (T3's launch appends its extension after the launch arguments, mcpInjection.ts), then Aetheria's flag. No model, no credential. It is not the shipped Aetheria bundle.
//
// Shows: with Aetheria's host and flag, neither request of a two-request run offers any of the 18 withheld names while the T3 tools outside the set are still offered; without the flag
// and host (bare T3) the same run offers them (the unchanged baseline: the test can fail); a call to a withheld name is refused by the host's gate when something calls it anyway.
// Does NOT show a delegated child's whole launch through T3's server (the native slice does) or any real provider.
/* oxlint-disable t3code/no-real-time-wait-in-tests -- A real Pi subprocess must settle; no event marks a hang. */
import { assert, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { PI_T3_MCP_EXTENSION_SOURCE } from "../../../../packages/provider-pi/src/server/mcpExtensionSource.ts";
import { PI_CLI, PI_DIR } from "./piProbeKit.ts";

const REPO = NodePath.join(import.meta.dirname, "../../../../../..");
const HOST_PROBE = NodePath.join(REPO, "tests/orchestration/probes/aetheria-host-probe.mjs");
const AETHERIA_PI_LIB = NodeURL.pathToFileURL(
  NodePath.join(REPO, "packages/aetheria-pi/lib/index.js"),
).href;
const FLAG = "--aetheria-disable-t3-orchestration";

/** The decided set: every T3 MCP tool that creates, launches or schedules a thread or run (design C6, "Added 2026-11-12"). */
const WITHHELD = [
  "delegate_task",
  "task_status",
  "create_threads",
  "t3_thread_launch",
  "schedule_task",
  "run_scheduled_task_now",
  "t3_thread_send",
  "t3_thread_send_attachments",
  "t3_thread_transfer",
];
const PREFIXES = ["mcp__t3-code__", "mcp__t3_code__"];
const WITHHELD_NAMES = WITHHELD.flatMap((name) => PREFIXES.map((prefix) => `${prefix}${name}`));
/** T3 tools that stay: they read or control a thread without creating, launching or scheduling one. */
const OTHER = [
  "orchestrator_capabilities",
  "t3_thread_list",
  "t3_thread_read",
  "t3_thread_interrupt",
  "task_cancel",
  "t3_worktree_handoff",
];

/** A stub MCP server (streamable-HTTP JSON) listing the whole set and some tools outside it; it counts every tools/call by name. */
const startStub = () =>
  new Promise<{ url: string; calls: Record<string, number>; close: () => Promise<void> }>(
    (resolve) => {
      const calls: Record<string, number> = {};
      const tools = [...WITHHELD, ...OTHER].map((name) => ({
        name,
        description: `stub ${name}`,
        inputSchema: { type: "object", properties: {} },
      }));
      const server = NodeHttp.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const message = body.length > 0 ? JSON.parse(body) : {};
          const reply = (result: unknown) => {
            res.writeHead(200, {
              "content-type": "application/json",
              "mcp-session-id": "stub-session",
            });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
          };
          if (message.method === "initialize")
            return reply({
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "stub", version: "0" },
            });
          if (message.method === "tools/list") return reply({ tools });
          if (message.method === "tools/call") {
            calls[message.params.name] = (calls[message.params.name] ?? 0) + 1;
            return reply({ content: [{ type: "text", text: `stub ran ${message.params.name}` }] });
          }
          res.writeHead(202);
          res.end();
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        resolve({
          url: `http://127.0.0.1:${address.port}/mcp`,
          calls,
          close: () => new Promise((r) => server.close(() => r())),
        });
      });
    },
  );

interface Run {
  /** The tool names each provider request advertised, in order. */
  readonly requests: ReadonlyArray<ReadonlyArray<string>>;
  readonly stubCalls: Record<string, number>;
  readonly toolResults: ReadonlyArray<{ name: string; text: string; isError: boolean }>;
}

const loadOuter = async (relative: string): Promise<any> =>
  import(/* @vite-ignore */ NodeURL.pathToFileURL(NodePath.join(REPO, relative)).href);

/**
 * One Pi run on the `openai-completions` wire: the scripted model calls `callName` once (a T3 tool), then answers in text, so two requests reach the provider.
 * `aetheria` loads the real host first and passes the flag; without it the run is bare T3.
 */
const runOnce = async (config: { aetheria: boolean; callName: string }): Promise<Run> => {
  const piRpc = await loadOuter("tests/compat/drivers/pi-rpc.mjs");
  const wireModule = await loadOuter("tests/awareness/s20/wire.mjs");
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-d18-"));
  const dirs = {
    workspace: NodePath.join(root, "workspace"),
    agent: NodePath.join(root, "agent"),
    home: NodePath.join(root, "home"),
    cache: NodePath.join(root, "cache"),
  };
  for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });
  const t3Extension = NodePath.join(dirs.cache, "pi-t3-mcp-extension.ts");
  NodeFS.writeFileSync(t3Extension, PI_T3_MCP_EXTENSION_SOURCE);
  const stub = await startStub();
  const tag = "m05-d18-1";
  const wire = await wireModule.startDecidingWire({
    tagPattern: /m05-d18-\d+/,
    decide: async (request: { turn: string | null; toolResults: string[] }) =>
      request.turn !== tag
        ? null
        : request.toolResults.length === 0
          ? { toolCalls: [{ name: config.callName, arguments: {} }] }
          : { text: "done" },
  });
  assert.isTrue(wire.ok, `the scripted provider did not start: ${wire.reason ?? ""}`);
  const provider = wire.provider;
  NodeFS.writeFileSync(
    NodePath.join(dirs.agent, "models.json"),
    JSON.stringify(piRpc.buildModelsJson({ baseUrl: provider.baseUrl })),
  );
  NodeFS.writeFileSync(
    NodePath.join(dirs.agent, "settings.json"),
    JSON.stringify(piRpc.buildSettings()),
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: dirs.home,
    PI_CODING_AGENT_DIR: dirs.agent,
    PI_DIR,
    AETHERIA_PI_LIB,
    T3_MCP_URL: stub.url,
    T3_MCP_BEARER_TOKEN: "stub-token-not-a-credential",
    T3_PI_RUNTIME_MODE: "full-access",
    T3_PI_MCP_EXTENSION_PATH: t3Extension,
  };
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      PI_CLI,
      "--mode",
      "rpc",
      "--offline",
      "--approve",
      "--no-context-files",
      "--no-skills",
      "--provider",
      piRpc.PROVIDER_ID,
      "--model",
      piRpc.MODEL_ID,
      // Aetheria's extension first, then T3's (T3's launch appends its extension after the launch arguments), then the flag Aetheria's launch passes.
      ...(config.aetheria ? ["--extension", HOST_PROBE] : []),
      "--extension",
      t3Extension,
      ...(config.aetheria ? [FLAG] : []),
    ],
    { cwd: dirs.workspace, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let buffer = "";
  const toolResults: Array<{ name: string; text: string; isError: boolean }> = [];
  const settled = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no agent_settled in 60 s; stderr: ${stderr.slice(-600)}`)),
      60_000,
    );
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          const event = JSON.parse(line) as Record<string, any>;
          if (event.type === "message_end" && event.message?.role === "toolResult")
            toolResults.push({
              name: String(event.message.toolName),
              isError: event.message.isError === true,
              text: (event.message.content ?? [])
                .map((part: { text?: string }) => part.text ?? "")
                .join(""),
            });
          if (event.type === "agent_settled") {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* not JSON */
        }
      }
    });
    child.once("close", () => {
      clearTimeout(timer);
      reject(new Error(`Pi exited before agent_settled; stderr: ${stderr.slice(-600)}`));
    });
  });
  child.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: `${tag} go` })}\n`);
  try {
    await settled;
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise((r) => child.once("close", r));
    await stub.close();
  }
  const requests = provider.requests().map((entry: { n: number }) =>
    (
      (provider.bodyOf(entry.n)?.tools ?? []) as Array<{
        function?: { name?: string };
        name?: string;
      }>
    ).map((tool) => String(tool.function?.name ?? tool.name ?? "")),
  );
  await provider.close?.();
  return { requests, stubCalls: { ...stub.calls }, toolResults };
};

const present = (names: ReadonlyArray<string>) =>
  names.filter((name) => WITHHELD_NAMES.includes(name));

it("bare T3 on openai-completions offers the thread-creating tools in the first request (the baseline: this test can fail)", async () => {
  const bare = await runOnce({ aetheria: false, callName: "mcp__t3-code__t3_thread_list" });
  assert.isAtLeast(bare.requests.length, 2, "the run reached the provider twice");
  const offered = present(bare.requests[0] ?? []);
  assert.includeMembers(
    offered,
    [
      "mcp__t3-code__delegate_task",
      "mcp__t3-code__task_status",
      "mcp__t3-code__t3_thread_launch",
      "mcp__t3-code__create_threads",
    ],
    "T3's catalog is re-activated on openai-completions",
  );
});

it("with Aetheria's host and flag, NONE of the 18 withheld names is in the first or any later request, and the other T3 tools still are", async () => {
  const run = await runOnce({ aetheria: true, callName: "mcp__t3-code__t3_thread_list" });
  assert.isAtLeast(run.requests.length, 2, "the run reached the provider twice");
  for (const [index, names] of run.requests.entries()) {
    assert.deepEqual(present(names), [], `request ${index + 1} offers none of the withheld set`);
    for (const other of OTHER.filter((name) => name !== "t3_thread_list"))
      assert.include(
        names,
        `mcp__t3-code__${other}`,
        `request ${index + 1} still offers ${other} (outside the set)`,
      );
    assert.include(names, "mcp__t3-code__t3_thread_list");
  }
  assert.equal(run.stubCalls["t3_thread_list"], 1, "the allowed T3 tool ran once");
  for (const name of WITHHELD)
    assert.isUndefined(run.stubCalls[name], `${name} never reached the MCP server`);
});

it("a call to a withheld name is refused by the host's gate (or the name is not found), and the MCP server never sees it", async () => {
  for (const callName of [
    "mcp__t3-code__t3_thread_launch",
    "mcp__t3_code__create_threads",
    "mcp__t3-code__delegate_task",
  ]) {
    const run = await runOnce({ aetheria: true, callName });
    const result = run.toolResults.find((r) => r.name === callName);
    assert.isDefined(result, `${callName}: the call got a result`);
    assert.isTrue(
      result?.isError === true,
      `${callName}: an error result, not a run (${result?.text})`,
    );
    assert.match(result?.text ?? "", /withheld|not found/i);
    assert.deepEqual(run.stubCalls, {}, `${callName}: the MCP server was never called`);
  }
});
