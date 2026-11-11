// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off preferSchemaOverJson:off
// AETHERIA M05 Plan step 2 (D18, D19) — withholding T3's delegate_task / task_status. A mechanism probe, not an M05 feature.
//
// Question. In the installed Pi 1.5.0 carrying T3's REAL MCP extension (PI_T3_MCP_EXTENSION_SOURCE, unchanged), which mechanism makes both aliases of
// T3's spawn tools (`mcp__t3-code__<name>`, hidden `mcp__t3_code__<name>`) unadvertised and/or unusable: (1) withdrawal from Pi's active set, (2) refusal at
// the `tool_call` name gate — and does each survive T3 re-registering its tools after the withdrawal?
//
// Boundary. The installed Pi (`pi --mode rpc`, offline), T3's real MCP extension source loaded unchanged from the fork, a stub MCP HTTP server that
// lists orchestrator_capabilities / delegate_task / task_status and COUNTS every tools/call (ground truth for "a child would have been spawned"), Pi's
// faux provider as a test extension that records the tool names each request advertises and calls all four aliases, and a stand-in extension
// (tests/orchestration/probes/withhold-candidates.mjs) that applies the candidate mechanisms in isolation. The Aetheria host (packages/aetheria-pi
// host.ts) is NOT loaded: this measures what any host mechanism can achieve beside T3's extension, not what host.ts does today. No model, no credential.
//
// Shows, per configuration: the names advertised to the model, whether each alias reached the stub MCP server, what Pi returned for each call, and
// whether a stand-in re-registration after withdrawal re-advertises the tool.
// Does NOT show: host.ts's own behaviour (read statically: withdrawNotOwned returns early for main), child vs main identity in a real session,
// extension load order inside the real T3 launch (T3 appends its extension to the launch args; here it is first), or Pi on the openai-completions
// api, where T3's reconcileDiscovery re-activates every T3 tool itself (mcpExtensionSource.ts: `required`/setActiveTools).
/* oxlint-disable t3code/no-real-time-wait-in-tests -- A real Pi subprocess must emit agent_settled; no event marks a hang. */
import { assert, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PI_T3_MCP_EXTENSION_SOURCE } from "../../../../packages/provider-pi/src/server/mcpExtensionSource.ts";
import { PI_CLI, PI_DIR } from "./piProbeKit.ts";

const PROBES = NodePath.join(import.meta.dirname, "../../../../../../tests/orchestration/probes");
const FAUX_TOOLS = NodePath.join(PROBES, "faux-tools-trace.mjs");
const WITHHOLD = NodePath.join(PROBES, "withhold-candidates.mjs");
const ALIASES = [
  "mcp__t3-code__delegate_task",
  "mcp__t3_code__delegate_task",
  "mcp__t3-code__task_status",
  "mcp__t3_code__task_status",
];

interface Observed {
  readonly advertised1: ReadonlyArray<string>;
  readonly advertised2: ReadonlyArray<string>;
  readonly blocked: ReadonlyArray<string>;
  readonly activeAfterRegistration: ReadonlyArray<string> | undefined;
  readonly stubCalls: Record<string, number>;
  readonly results: Record<string, { isError: boolean; text: string }>;
  readonly lateExecuted: ReadonlyArray<string>;
  readonly registered: ReadonlyArray<string>;
}

/** A stub MCP server (streamable-HTTP JSON): lists three T3 tools and counts every tools/call by name. */
const startStub = () =>
  new Promise<{ url: string; calls: Record<string, number>; close: () => Promise<void> }>(
    (resolve) => {
      const calls: Record<string, number> = {};
      const tools = ["orchestrator_capabilities", "delegate_task", "task_status"].map((name) => ({
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

/** One Pi run: a single prompt, until agent_settled; returns what was advertised, called and answered. */
const runOnce = async (config: {
  mode: "none" | "gate" | "active" | "both";
  late?: boolean;
  reapply?: boolean;
}): Promise<Observed> => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m05-withhold-"));
  const dirs = {
    workspace: NodePath.join(root, "workspace"),
    agent: NodePath.join(root, "agent"),
    home: NodePath.join(root, "home"),
    cache: NodePath.join(root, "cache"),
  };
  for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });
  const t3Extension = NodePath.join(dirs.cache, "pi-t3-mcp-extension.ts");
  NodeFS.writeFileSync(t3Extension, PI_T3_MCP_EXTENSION_SOURCE);
  const trace = NodePath.join(root, "trace.jsonl");
  const stub = await startStub();
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: dirs.home,
    PI_CODING_AGENT_DIR: dirs.agent,
    PI_DIR,
    FAUX_MODELS: JSON.stringify([{ provider: "faux-probe", id: "faux-1", input: ["text"] }]),
    FAUX_TRACE: trace,
    T3_MCP_URL: stub.url,
    T3_MCP_BEARER_TOKEN: "stub-token-not-a-credential",
    T3_PI_RUNTIME_MODE: "full-access",
    T3_PI_MCP_EXTENSION_PATH: t3Extension,
    WITHHOLD_MODE: config.mode,
    ...(config.late === true ? { LATE_REREGISTER: "1" } : {}),
    ...(config.reapply === true ? { REAPPLY: "1" } : {}),
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
      "--extension",
      t3Extension,
      "--extension",
      FAUX_TOOLS,
      "--extension",
      WITHHOLD,
      "--model",
      "faux-probe/faux-1",
    ],
    { cwd: dirs.workspace, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let buffer = "";
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
          if ((JSON.parse(line) as { type?: string }).type === "agent_settled") {
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
  child.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: "go" })}\n`);
  try {
    await settled;
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise((r) => child.once("close", r));
    await stub.close();
  }
  const lines = NodeFS.readFileSync(trace, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>);
  const results: Observed["results"] = {};
  for (const l of lines.filter((l) => l.kind === "tool_result"))
    results[l.name] = { isError: l.isError, text: l.text };
  const active = lines.filter((l) => l.kind === "active");
  const afterReg =
    active.find((l) => l.at === (config.reapply === true ? "after_reapply" : "after_reregister")) ??
    active.find((l) => l.at === "session_start:after");
  const firstAll = active.find((l) => l.at === "session_start:before");
  const turns = active.filter((l) => l.at === "turn_start");
  return {
    // The faux responder's `context.tools` came back empty (Pi does not pass tools there), so the offered set is Pi's active set at turn_start.
    advertised1: turns[0]?.active ?? [],
    advertised2: turns[1]?.active ?? [],
    blocked: lines.filter((l) => l.kind === "blocked").map((l) => l.name),
    activeAfterRegistration: afterReg?.active,
    stubCalls: { ...stub.calls },
    results,
    lateExecuted: lines.filter((l) => l.kind === "late_tool_executed").map((l) => l.name),
    registered: firstAll?.all ?? [],
  };
};

const names = (list: ReadonlyArray<string>) =>
  list.filter((n) => /delegate_task|task_status/.test(n));
const stubTotal = (o: Observed) => Object.values(o.stubCalls).reduce((a, b) => a + b, 0);

it("T3's extension advertises delegate_task/task_status, both aliases are callable, and each candidate mechanism's reach is measured", async () => {
  const none = await runOnce({ mode: "none" });
  const gate = await runOnce({ mode: "gate" });
  const active = await runOnce({ mode: "active" });
  const activeLate = await runOnce({ mode: "active", late: true });
  const activeLateReapply = await runOnce({ mode: "active", late: true, reapply: true });
  const bothLate = await runOnce({ mode: "both", late: true });
  const table = { none, gate, active, activeLate, activeLateReapply, bothLate };
  // The measured table is kept beside the scratch folders' traces; a failed assertion below prints the values it compares.
  void table;

  const VISIBLE = ["mcp__t3-code__delegate_task", "mcp__t3-code__task_status"];
  const HIDDEN = ["mcp__t3_code__delegate_task", "mcp__t3_code__task_status"];

  // Baseline: the problem exists. T3's real extension registers both aliases of both tools; only the visible aliases are in Pi's active set, so only
  // they are offered to the model and only they reach the MCP server; the hidden aliases are registered but not callable as they stand.
  assert.includeMembers(
    [...none.registered],
    ALIASES,
    "T3's extension registered both aliases of both tools",
  );
  assert.includeMembers(
    [...none.advertised1],
    VISIBLE,
    "the visible aliases are offered to the model",
  );
  assert.deepEqual(
    names(none.advertised1).filter((n) => HIDDEN.includes(n)),
    [],
    "the hidden aliases are not offered",
  );
  assert.deepEqual(
    none.stubCalls,
    { delegate_task: 1, task_status: 1 },
    "a model call spawns through T3's MCP tools, once per visible alias",
  );
  assert.deepEqual(none.lateExecuted, []);

  // (2) The tool_call name gate alone: the tools stay offered, so a model may try them, but no call reaches the MCP server, and the gate saw each.
  assert.includeMembers([...gate.advertised1], VISIBLE, "gate only: still advertised");
  assert.equal(stubTotal(gate), 0, "gate only: no call reaches the MCP server");
  assert.sameMembers(
    [...gate.blocked],
    VISIBLE,
    "the gate refused exactly the visible aliases (hidden ones never reach it: Pi does not run an inactive tool)",
  );

  // (1) Active-set withdrawal alone, alone and after a stand-in re-registration (T3's registerTools() re-run), with and without re-applying it:
  for (const [label, run] of Object.entries({ active, activeLate, activeLateReapply, bothLate })) {
    assert.deepEqual(
      names(run.advertised1),
      [],
      `${label}: nothing of T3's spawn tools is offered to the model`,
    );
    assert.deepEqual(names(run.advertised2), [], `${label}: still none on the next turn`);
    assert.equal(stubTotal(run), 0, `${label}: no call reaches the MCP server`);
    assert.deepEqual(run.lateExecuted, [], `${label}: the re-registered stand-in never ran`);
  }
  // The other T3 tool stays: withdrawal is by name, not the whole T3 namespace.
  assert.include([...active.advertised1], "mcp__t3-code__orchestrator_capabilities");
  // With both mechanisms the gate has nothing to refuse (the model is not offered the tools), which is the intended defence in depth.
  assert.deepEqual(bothLate.blocked, []);
});
