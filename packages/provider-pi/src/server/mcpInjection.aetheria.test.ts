import { assert, describe, it } from "@effect/vitest";
import { buildPiRpcLaunch } from "./mcpInjection.ts";

describe("Aetheria IP-5 discovery flags", () => {
  it.each([
    "--aetheria-disable-t3-orchestration",
    "--aetheria-disable-t3-orchestration=true",
    "--aetheria-disable-t3-orchestration=false",
  ])("does not leave the T3-only orchestration flag %s orphaned during discovery", (flag) => {
    const launchArgs = [
      "--offline",
      "--extension",
      "/fixture/aetheria-extension.js",
      "--no-context-files",
      "--no-skills",
      flag,
      "--unrelated-extension-flag=true",
      "--aetheria-disable-t3-orchestration-extra=true",
    ];
    const discovery = buildPiRpcLaunch({
      launchArgs,
      environment: {},
      mcpSession: undefined,
      extensionPath: undefined,
      ephemeral: true,
      shortLived: true,
    });
    assert.include(discovery.args, "/fixture/aetheria-extension.js");
    assert.notInclude(discovery.args, flag);
    assert.include(discovery.args, "--unrelated-extension-flag=true");
    assert.include(discovery.args, "--aetheria-disable-t3-orchestration-extra=true");
    const live = buildPiRpcLaunch({
      launchArgs,
      environment: {},
      mcpSession: undefined,
      extensionPath: "/fixture/t3-extension.js",
    });
    assert.include(live.args, flag);
    assert.include(live.args, "/fixture/t3-extension.js");
  });
});
