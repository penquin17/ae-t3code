// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDateInEffect:off
// AETHERIA M05 Plan step 2 — shared helpers for the real-Pi probes (piSessionPreBind, piChildSettle). Test support, not a feature.
// A "world" is a scratch folder with its own Pi agent dir and HOME, the installed Pi 1.5.0, and a scripted provider extension. No model, no
// credential: the provider is Pi's own pi-ai faux provider loaded as an extension, and every request it serves is appended to FAUX_SEEN.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { vi } from "vitest";
import {
  ProviderInstanceId,
  ProviderSessionId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type ThreadId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makePiAdapterV2 } from "../../../../packages/provider-pi/src/server/adapter.ts";

const REPO = NodePath.join(import.meta.dirname, "../../../../../..");
export const PI_DIR = NodePath.join(REPO, "node_modules/@earendil-works/pi-coding-agent");
export const PI_CLI = NodePath.join(PI_DIR, "dist/bundle/cli.js");
export const FAUX = NodePath.join(REPO, "tests/tools/installed-pi-world.faux.mjs");
export const PI_INSTANCE_ID = ProviderInstanceId.make("pi");
export const PROVIDER_SESSION_ID = ProviderSessionId.make("provider-session-m05-probe");
export const selection: ModelSelection = { instanceId: PI_INSTANCE_ID, model: "faux-probe/faux-1" };

export interface World {
  readonly root: string;
  readonly workspace: string;
  readonly seen: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Folders, a fast Pi retry policy (`retry.baseDelayMs`), and the faux provider's script. `extraEnv` carries probe-specific variables. */
export const makeWorld = (
  root: string,
  script: ReadonlyArray<unknown>,
  extraEnv: Record<string, string> = {},
  baseDelayMs = 50,
): World => {
  const dirs = {
    workspace: NodePath.join(root, "workspace"),
    agent: NodePath.join(root, "agent"),
    home: NodePath.join(root, "home"),
  };
  for (const dir of Object.values(dirs)) NodeFS.mkdirSync(dir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(dirs.agent, "settings.json"),
    JSON.stringify({ retry: { enabled: true, maxRetries: 3, baseDelayMs } }),
  );
  const seen = NodePath.join(root, "faux-seen.jsonl");
  return {
    root,
    workspace: dirs.workspace,
    seen,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: dirs.home,
      PI_CODING_AGENT_DIR: dirs.agent,
      PI_DIR,
      FAUX_MODELS: JSON.stringify([{ provider: "faux-probe", id: "faux-1", input: ["text"] }]),
      FAUX_SCRIPT: JSON.stringify(script),
      FAUX_SEEN: seen,
      ...extraEnv,
    },
  };
};

/** Requests the faux provider served so far (one JSON line each); an absent file is zero requests. */
export const requestsSeen = (world: World): number =>
  NodeFS.existsSync(world.seen)
    ? NodeFS.readFileSync(world.seen, "utf8")
        .split("\n")
        .filter((line) => line.length > 0).length
    : 0;

/** The real Pi adapter over the installed Pi, with every launched process recorded. `extensions` are loaded in order beside the faux provider. */
export const makePi = Effect.fn("piProbeKit.makePi")(function* (
  world: World,
  extensions: ReadonlyArray<string>,
) {
  const realSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const launches: Array<{ readonly pid: number; readonly args: ReadonlyArray<string> }> = [];
  const spawner = ChildProcessSpawner.make((command) =>
    realSpawner.spawn(command).pipe(
      Effect.tap((handle) =>
        Effect.sync(() => {
          launches.push({
            pid: Number(handle.pid),
            args: ChildProcess.isStandardCommand(command) ? command.args.map(String) : [],
          });
        }),
      ),
    ),
  );
  const adapter = yield* makePiAdapterV2({
    instanceId: PI_INSTANCE_ID,
    settings: {
      enabled: true,
      binaryPath: PI_CLI,
      launchArgs: `--offline --approve --no-context-files --no-skills ${extensions.map((e) => `--extension ${e}`).join(" ")}`,
      customModels: [],
    },
    environment: world.env,
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
  return { adapter, launches };
});

export const runtimePolicyOf = (world: World) =>
  ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    runtimeMode: "full-access",
    interactionMode: "default",
    cwd: world.workspace,
  });

/** An app thread and the not-yet-bound provider-thread row the Orchestrator creates for a held run (nativeThreadRef null). */
export const heldRows = Effect.fn("piProbeKit.heldRows")(function* (threadId: ThreadId) {
  {
    const now = yield* DateTime.now;
    const appThread = {
      createdBy: "agent",
      creationSource: "server",
      id: threadId,
      projectId: "project:m05-probe" as OrchestrationV2AppThread["projectId"],
      title: "held child",
      providerInstanceId: PI_INSTANCE_ID,
      modelSelection: selection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: "subagent", rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    } as unknown as OrchestrationV2AppThread;
    const heldRow = {
      id: `provider-thread:${threadId}`,
      driver: "pi",
      providerInstanceId: PI_INSTANCE_ID,
      providerSessionId: PROVIDER_SESSION_ID,
      appThreadId: threadId,
      ownerNodeId: null,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: null,
      lastRunOrdinal: null,
      handoffIds: [],
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as OrchestrationV2ProviderThread;
    return { appThread, heldRow };
  }
});

/** Waits for a fact only a subprocess can produce. */
export const waitFor = <A>(
  what: string,
  read: () => A | undefined,
  ms = 60_000,
): Effect.Effect<A> =>
  Effect.promise(() =>
    vi.waitFor(
      () => {
        const found = read();
        if (found === undefined) throw new Error(`timed out waiting for ${what}`);
        return found;
      },
      { timeout: ms, interval: 25 },
    ),
  );

/** The session id Pi puts in a session file's name (`<timestamp>_<id>.jsonl`), and the id in its header line when the file exists. */
export const idFromFileName = (file: string): string | undefined =>
  /^[^_]+_([A-Za-z0-9][A-Za-z0-9-]{0,127})\.jsonl$/.exec(NodePath.basename(file))?.[1];
export const idFromHeader = (file: string): string | undefined => {
  const first = NodeFS.readFileSync(file, "utf8").split("\n")[0] ?? "";
  const parsed = JSON.parse(first) as { type?: string; id?: string };
  return parsed.type === "session" ? parsed.id : undefined;
};
