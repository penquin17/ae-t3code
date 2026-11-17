// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M12 DV10 — the search route override of the providers module: `codexBaseUrlOf` reads the run home's Pi routing override and answers only a
// loopback http URL, and the production registration passes it to research search per request.
//
// Boundary: `codexBaseUrlOf` is checked directly over real files in a temporary owner-only directory (loopback only; every other shape answers
// undefined; the file is read on every call). The registration case runs the real installed `@aetheria/providers/backend` archive with a synthetic
// sign-in and a stubbed `globalThis.fetch` (what the archive's default search transport calls): it shows the request URL follows models.json and
// returns to the fixed endpoint when the override is gone, with the same body. It does NOT open a socket, show a real endpoint or metering proxy, or
// run until the pinned providers archive carries `searchRoute` (a stale stamp makes it fail by design).
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { prepareBackend } from "./adapter.ts";
import { BACKEND_COMPOSITION_ID, BACKEND_ENTRY_ALLOWLIST, backendManifest } from "./composition.ts";
import { createAgentAwarenessBackendRegistration } from "./agentAwareness.ts";
import { createHumanControlBackendRegistration } from "./humanControl.ts";
import { createDeliverablesBackendRegistration } from "./deliverables/deliverables.ts";
import { createGoalsBackendRegistration } from "./goals/registration.ts";
import { createGroupsBackendRegistration } from "./groups/groups.ts";
import { createWorkflowsBackendRegistration } from "./workflows/registration.ts";
import { createDiagnosticsBackendRegistration } from "./diagnostics/registration.ts";
import { createInspectBackendRegistration } from "./inspect/inspectRegistration.ts";
import { createOrchestrationBackendRegistration } from "./orchestration.ts";
import { codexBaseUrlOf, createProvidersBackendRegistration } from "./providers.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) NodeFS.rmSync(dir, { recursive: true, force: true });
});
function homeDir(files: Record<string, unknown>): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m12-fork-route-"));
  made.push(dir);
  NodeFS.chmodSync(dir, 0o700);
  for (const [name, data] of Object.entries(files)) {
    const file = NodePath.join(dir, name);
    NodeFS.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data), {
      mode: 0o600,
    });
    NodeFS.chmodSync(file, 0o600);
  }
  return dir;
}
const models = (baseUrl: unknown) => ({ providers: { "openai-codex": { baseUrl } } });
const modelsPath = (dir: string) => NodePath.join(dir, "models.json");

describe("codexBaseUrlOf", () => {
  it("answers a loopback http base URL, with or without a path", () => {
    for (const url of [
      "http://127.0.0.1:45678/openai-codex",
      "http://localhost:3000/openai-codex",
      "http://127.0.0.1:8080",
      "http://localhost:1/a/b",
    ]) {
      expect(codexBaseUrlOf(homeDir({ "models.json": models(url) }))).toBe(url);
    }
  });

  it("answers undefined for a non-loopback host, scheme, port-less or decorated URL", () => {
    for (const url of [
      "https://chatgpt.com/backend-api",
      "http://example.com:80/openai-codex",
      "https://127.0.0.1:4000/openai-codex",
      "http://127.0.0.1/openai-codex",
      "http://127.0.0.1.evil.example:80/x",
      "http://127.0.0.1:80@evil.example/x",
      "http://user:pw@127.0.0.1:80/x",
      "http://localhost:80?next=https://evil.example",
      "http://localhost:80/x#frag",
      "http://[::1]:80/x",
      "http://0.0.0.0:80/x",
      "http://127.0.0.2:80/x",
      "http://localhost.evil.example:80/x",
      " http://127.0.0.1:80/x",
      "",
    ]) {
      expect(codexBaseUrlOf(homeDir({ "models.json": models(url) })), url).toBeUndefined();
    }
  });

  it("answers undefined for a missing, unreadable, unparseable or differently shaped file", () => {
    expect(codexBaseUrlOf(homeDir({}))).toBeUndefined();
    expect(
      codexBaseUrlOf(NodePath.join(NodeOS.tmpdir(), "m12-fork-route-no-such-dir")),
    ).toBeUndefined();
    for (const data of [
      "{ not json",
      "null",
      "[]",
      "{}",
      { providers: null },
      { providers: {} },
      { providers: { "openai-codex": null } },
      { providers: { "openai-codex": {} } },
      { providers: { anthropic: { baseUrl: "http://127.0.0.1:80/x" } } },
      models(42),
      models(["http://127.0.0.1:80/x"]),
    ]) {
      expect(
        codexBaseUrlOf(homeDir({ "models.json": data })),
        JSON.stringify(data),
      ).toBeUndefined();
    }
  });

  it("reads the file on every call", () => {
    const dir = homeDir({ "models.json": models("http://127.0.0.1:1111/openai-codex") });
    expect(codexBaseUrlOf(dir)).toBe("http://127.0.0.1:1111/openai-codex");
    NodeFS.writeFileSync(
      modelsPath(dir),
      JSON.stringify(models("http://localhost:2222/openai-codex")),
    );
    expect(codexBaseUrlOf(dir)).toBe("http://localhost:2222/openai-codex");
    NodeFS.writeFileSync(
      modelsPath(dir),
      JSON.stringify(models("https://chatgpt.com/backend-api")),
    );
    expect(codexBaseUrlOf(dir)).toBeUndefined();
  });
});

const event = (data: unknown) => `event: x\ndata: ${JSON.stringify(data)}\n\n`;
const stream = () =>
  event({
    type: "response.output_item.done",
    item: {
      type: "web_search_call",
      action: { type: "search", sources: [{ type: "url", url: "https://a.example/" }] },
    },
  }) +
  event({
    type: "response.output_item.done",
    item: {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            results: [{ title: "T", url: "https://a.example/", snippet: "S" }],
          }),
          annotations: [],
        },
      ],
    },
  }) +
  event({ type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 2 } } });

describe("production registration search route", () => {
  it("research search follows models.json per request and returns to the fixed endpoint when it is gone", async () => {
    const dir = homeDir({
      "auth.json": {
        "openai-codex": {
          type: "oauth",
          access: "ACCESS-TOKEN-SYNTHETIC-2",
          refresh: "REFRESH-TOKEN-SYNTHETIC-2",
          expires: 4_102_444_800_000,
          accountId: "ACCOUNT-SYNTHETIC-2",
        },
      },
    });
    const calls: Array<{ url: string; body: unknown }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body });
      return new Response(stream(), { status: 200 });
    }) as typeof fetch;
    try {
      const prepared = prepareBackend({
        manifest: backendManifest({ composition: BACKEND_COMPOSITION_ID }),
        composition: BACKEND_COMPOSITION_ID,
        allowlist: BACKEND_ENTRY_ALLOWLIST,
        registrations: [
          createAgentAwarenessBackendRegistration(),
          createProvidersBackendRegistration({
            composition: BACKEND_COMPOSITION_ID,
            providers: { mode: "production", agentDir: dir, warn: () => {} },
          }),
          createHumanControlBackendRegistration({}),
          createOrchestrationBackendRegistration({}),
          createGoalsBackendRegistration(),
          createWorkflowsBackendRegistration({}),
          createGroupsBackendRegistration({}),
          createDeliverablesBackendRegistration({}),
          createInspectBackendRegistration(),
          createDiagnosticsBackendRegistration({}),
        ],
      });
      if (prepared.outcome !== "prepared") throw new Error("refused");
      const backend = prepared.backend;
      expect((await backend.start()).outcome).toBe("started");
      const search = async (n: number) => {
        const reply = (await backend.operations()["research.search"]!({
          caller: { threadId: "t", providerSessionId: "p", providerInstanceId: "i" },
          sessionId: "s",
          kind: "main",
          rootSessionId: "s",
          args: {
            query: "a query",
            limit: 3,
            requestId: `request-id-${String(n).padStart(8, "0")}`,
          },
        } as never)) as {
          status?: string;
          settle?: Promise<{ result: { kind: string } }>;
          result?: { kind: string };
        };
        return reply.status === "pending" ? (await reply.settle!).result : reply.result!;
      };
      expect((await search(1)).kind).toBe("ok");
      NodeFS.writeFileSync(
        modelsPath(dir),
        JSON.stringify(models("http://127.0.0.1:45678/openai-codex")),
      );
      expect((await search(2)).kind).toBe("ok");
      NodeFS.writeFileSync(
        modelsPath(dir),
        JSON.stringify(models("https://evil.example/backend-api")),
      );
      expect((await search(3)).kind).toBe("ok");
      await backend.dispose("test");
      expect(calls.map((c) => c.url)).toEqual([
        "https://chatgpt.com/backend-api/codex/responses",
        "http://127.0.0.1:45678/openai-codex/codex/responses",
        "https://chatgpt.com/backend-api/codex/responses",
      ]);
      expect(calls[1]!.body).toBe(calls[0]!.body);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
