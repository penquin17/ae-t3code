// @effect-diagnostics nodeBuiltinImport:off - reads the mounting sites' own source.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Boundary: the source text of the two T3 files that mount the Aetheria Stop (IP-43, IP-44). It shows where the markers sit, that the button and the `thread.stop` shortcut share one
// function, and that no native cascading Stop is left reachable from either file. It does not show how the Stop behaves (stop.browser.test.tsx, useAetheriaStop in the real app).
const read = (relative: string) =>
  NodeFS.readFileSync(NodeURL.fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const chatView = read("../../components/ChatView.tsx");
const relationships = read("../../components/chat/ThreadRelationshipsControl.tsx");
// Built from parts: the registry check reads every committed file for the token.
const marker = (id: string) => ["AETHERIA-IP", id].join(":");
const count = (text: string, token: string) => text.split(token).length - 1;

describe("ChatView (IP-43)", () => {
  it("carries the IP-43 marker in its three hunks, and only there", () => {
    expect(count(chatView, marker("IP-43"))).toBe(3);
  });

  it("the button and the thread.stop shortcut are the same function, and it is the Aetheria Stop", () => {
    expect(chatView).toContain("onInterrupt={onInterruptStable}");
    expect(chatView).toMatch(
      /"thread\.stop": \(\{ event \}\) => \{[^}]*void onInterruptStable\(\)/s,
    );
    const onInterrupt = chatView.slice(
      chatView.indexOf("const onInterrupt = async () => {"),
      chatView.indexOf("const onInterruptStable"),
    );
    expect(onInterrupt).toContain("await aetheriaStop({");
    expect(onInterrupt).toContain(
      'isSubagent: activeThread.lineage.relationshipToParent === "subagent"',
    );
  });

  it("leaves no native Stop in the file", () => {
    expect(chatView).not.toContain("threadEnvironment.interruptTurn");
    expect(chatView).not.toContain("interruptThreadTurn");
    expect(chatView).not.toContain("forceStop");
  });
});

describe("ThreadRelationshipsControl (IP-44)", () => {
  it("carries the IP-44 marker in its three hunks, and only there", () => {
    expect(count(relationships, marker("IP-44"))).toBe(3);
  });

  it("an app-owned child is stopped by the Backend; only a provider-native subagent keeps T3's single-subagent interrupt", () => {
    const stopSubagent = relationships.slice(
      relationships.indexOf("const stopSubagent = async ("),
      relationships.indexOf("const stopWorkflow = async"),
    );
    expect(stopSubagent).toContain('agent.origin === "app_owned"');
    expect(stopSubagent.indexOf("aetheriaStop(")).toBeLessThan(
      stopSubagent.indexOf("interruptTurn("),
    );
    expect(stopSubagent).toContain("isSubagent: true");
  });

  it("leaves T3's workflow Stop as it was (an M07 scope note, Plan step 5)", () => {
    expect(relationships).toContain("stopWorkflowCommand");
  });
});

describe("useThreadLifecycle (IP-45)", () => {
  const lifecycle = read("../../components/chat/useThreadLifecycle.tsx");

  it("carries the IP-45 marker in its three hunks, and only there", () => {
    expect(count(lifecycle, marker("IP-45"))).toBe(3);
  });

  it("stops background work with the Aetheria Stop and leaves no native Stop in the file", () => {
    expect(lifecycle).toContain("await aetheriaStop({");
    expect(lifecycle).not.toContain("interruptThreadTurn");
    expect(lifecycle).not.toContain("threadEnvironment.interruptTurn");
  });
});
