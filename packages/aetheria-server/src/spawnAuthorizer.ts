// AETHERIA M05 Plan step 6 — the Backend's SpawnAuthorizer: M03's verdict on one spawn, decided from the Backend's own records.
// The caller is a session id from the carrier's context and a working folder from the thread index, never an argument. Per call it reads the stored record,
// the CURRENT role catalog and the derived project; nothing is cached and an unreadable input is a refusal, never an allowance.
import type { ChildrenSpawnArgs } from "@t3tools/aetheria-contracts";

import {
  authorize,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  type IdentityPorts,
  type IdentityReader,
  type RolePort,
} from "./identity/backendEntry.ts";
import { createExplicitAuthorityPort, explicitAllowProblems } from "./library.ts";

/** The generic delegation tool's name: the tool a spawn with an explicit allow-list is authorized as. */
export const GENERIC_SPAWN_TOOL = "subagent";
/** The fork tool: generic delegation too (reachable at depth 0 only). */
const FORK_TOOL = "subagent_fork";

/** M05's one rule for a spawn-explicit identity, over the role catalog this check read. */
const explicitPortFor = (roles: RolePort): NonNullable<IdentityPorts["explicit"]> =>
  createExplicitAuthorityPort({ isRoleTool: (name) => roles.roleOfTool(name) !== null });

export interface SpawnRoute {
  readonly provider: string;
  readonly model: string;
  readonly effort?: string | undefined;
}
/** What the Backend knows about how a child launches. It comes from T3's record of the caller's thread, not from the model. */
export interface SpawnLaunchFacts {
  readonly routes: readonly SpawnRoute[];
  readonly runtimeMode: string;
  readonly interactionMode: string;
}

export type SpawnAuthorization =
  | {
      readonly ok: true;
      readonly parent: {
        readonly sessionId: string;
        readonly rootSessionId: string;
        readonly parentChain: readonly string[];
      };
      readonly child: {
        readonly authoritySource: "role" | "spawn-explicit";
        readonly role: string | null;
        readonly roleOrigin: "checkout" | "home" | null;
        readonly roleDigest: string | null;
        readonly explicitAllow?: readonly string[];
      };
      readonly routes: readonly SpawnRoute[];
      readonly runtimeMode: string;
      readonly interactionMode: string;
    }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export interface SpawnAuthorizerPort {
  authorize(input: {
    readonly callerSessionId: string;
    readonly workingFolder: string;
    readonly args: ChildrenSpawnArgs;
  }): Promise<SpawnAuthorization>;
  /**
   * Step 11: M03's verdict on a fork (the tool `subagent_fork`, depth 0 only). The child is spawn-explicit with exactly `allow`, which is refused when it holds a workflow, goal,
   * delegation or role-spawn tool, is empty or repeats a name.
   */
  authorizeFork(input: {
    readonly callerSessionId: string;
    readonly workingFolder: string;
    readonly allow: readonly string[];
  }): Promise<SpawnAuthorization>;
}

export interface SpawnAuthorizerOptions {
  readonly reader: IdentityReader;
  /** `AETHERIA_CHECKOUT`: the checkout whose roles are current. Missing or relative refuses every spawn. */
  readonly checkout: string | undefined;
  readonly launchFacts: (callerSessionId: string) => Promise<SpawnLaunchFacts | undefined>;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly homedir?: (() => string) | undefined;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const refuse = (code: string, reason: string): SpawnAuthorization =>
  Object.freeze({ ok: false as const, code, reason });
const unavailable = (reason: string): SpawnAuthorization =>
  refuse("AUTH_IDENTITY_UNAVAILABLE", reason);

export function createSpawnAuthorizer(options: SpawnAuthorizerOptions): SpawnAuthorizerPort {
  const { reader, checkout } = options;

  /** The caller's resolved identity and the verdict on `toolName`, from the Backend's own records; or the refusal. Shared by a spawn and a fork. */
  const resolveCaller = async (
    callerSessionId: string,
    workingFolder: string,
    toolName: string,
  ): Promise<
    | { readonly ok: false; readonly answer: SpawnAuthorization }
    | {
        readonly ok: true;
        readonly roles: RolePort;
        readonly facts: SpawnLaunchFacts;
        readonly parent: {
          readonly sessionId: string;
          readonly rootSessionId: string;
          readonly parentChain: readonly string[];
        };
      }
  > => {
    if (typeof callerSessionId !== "string" || callerSessionId === "")
      return { ok: false, answer: unavailable("no session") };
    if (typeof workingFolder !== "string" || !workingFolder.startsWith("/"))
      return { ok: false, answer: unavailable("the caller has no absolute working folder") };
    if (typeof checkout !== "string" || !checkout.startsWith("/"))
      return {
        ok: false,
        answer: unavailable("the Backend has no absolute checkout (AETHERIA_CHECKOUT)"),
      };
    let roles: RolePort;
    try {
      roles = currentRoles(checkout, {
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.homedir === undefined ? {} : { homedir: options.homedir }),
      });
    } catch (error) {
      return {
        ok: false,
        answer: unavailable(`the checkout's roles cannot be read: ${message(error)}`),
      };
    }
    const derived = await deriveProject(nodeFs, workingFolder, checkout);
    // A main session's authority is the composition's callable set; the Backend registers no tools, so it is exactly the tool being asked about.
    const ports: IdentityPorts = {
      read: (id) => reader.read(id),
      roles,
      project: () => {
        if (!derived.ok) throw new Error(derived.problems.join("; "));
        return derived.project;
      },
      callable: [toolName],
      // M05's one rule for a spawn-explicit identity, the same function the Agent host injects, so both resolvers agree on the same parent authority.
      explicit: explicitPortFor(roles),
    };
    const resolved = identityOf(ports, callerSessionId, workingFolder);
    if (!resolved.ok)
      return {
        ok: false,
        answer: refuse(resolved.code, `identity unavailable (${resolved.reason})`),
      };
    const verdict = authorize({ roles }, resolved, toolName);
    if (!verdict.allowed) return { ok: false, answer: refuse(verdict.code, verdict.reason) };
    const facts = await options.launchFacts(callerSessionId);
    if (facts === undefined || facts.routes.length === 0)
      return {
        ok: false,
        answer: unavailable("the caller's launch facts (routes and modes) are unknown"),
      };
    const { identity } = resolved;
    return {
      ok: true,
      roles,
      facts,
      parent: {
        sessionId: identity.sessionId,
        rootSessionId: identity.rootSessionId,
        parentChain: [...identity.parentChain],
      },
    };
  };

  /**
   * Step 11: the verdict on a fork. The tool is `subagent_fork` (generic delegation, depth 0 only); the allow-list is checked against M05's rule including the CURRENT role catalog (no
   * workflow, goal, delegation or role-spawn tool); the child is spawn-explicit with exactly that list. The parent's callable set is the composition's, which the Agent narrows again
   * at the child's start, so the Backend never grants more than was asked.
   */
  const decideFork = async (
    input: Parameters<NonNullable<SpawnAuthorizerPort["authorizeFork"]>>[0],
  ): Promise<SpawnAuthorization> => {
    const caller = await resolveCaller(input.callerSessionId, input.workingFolder, FORK_TOOL);
    if (!caller.ok) return caller.answer;
    const problems = explicitAllowProblems(input.allow, {
      isRoleTool: (name) => caller.roles.roleOfTool(name) !== null,
    });
    if (problems.length > 0)
      return refuse(
        "AUTH_TOOL_NOT_ALLOWED",
        problems.map((p) => (p.name === "" ? p.why : `${p.name}: ${p.why}`)).join("; "),
      );
    return Object.freeze({
      ok: true as const,
      parent: caller.parent,
      child: {
        authoritySource: "spawn-explicit" as const,
        role: null,
        roleOrigin: null,
        roleDigest: null,
        explicitAllow: [...input.allow],
      },
      routes: caller.facts.routes,
      runtimeMode: caller.facts.runtimeMode,
      interactionMode: caller.facts.interactionMode,
    });
  };

  const decide = async (
    input: Parameters<SpawnAuthorizerPort["authorize"]>[0],
  ): Promise<SpawnAuthorization> => {
    const { callerSessionId, workingFolder, args } = input;
    const toolName = "role" in args ? args.role : GENERIC_SPAWN_TOOL;
    const caller = await resolveCaller(callerSessionId, workingFolder, toolName);
    if (!caller.ok) return caller.answer;
    const { roles, facts, parent } = caller;
    if ("allow" in args)
      return Object.freeze({
        ok: true as const,
        parent,
        child: {
          authoritySource: "spawn-explicit" as const,
          role: null,
          roleOrigin: null,
          roleDigest: null,
          explicitAllow: [...args.allow],
        },
        routes: facts.routes,
        runtimeMode: facts.runtimeMode,
        interactionMode: facts.interactionMode,
      });
    const definition = roles.roleOfTool(toolName) ?? roles.lookup(toolName);
    if (definition === null)
      return refuse("ROLE_UNKNOWN", `the role ${toolName} is not in the current catalog`);
    return Object.freeze({
      ok: true as const,
      parent,
      child: {
        authoritySource: "role" as const,
        role: definition.name,
        roleOrigin: definition.origin,
        roleDigest: definition.digest,
      },
      routes: facts.routes,
      runtimeMode: facts.runtimeMode,
      interactionMode: facts.interactionMode,
    });
  };

  const authorizer: SpawnAuthorizerPort = {
    async authorize(input) {
      try {
        return await decide(input);
      } catch (error) {
        // Whatever failed, the answer is "cannot tell", never an allowance.
        return unavailable(`the check failed: ${message(error)}`);
      }
    },
    async authorizeFork(input) {
      try {
        return await decideFork(input);
      } catch (error) {
        return unavailable(`the check failed: ${message(error)}`);
      }
    },
  };
  return Object.freeze(authorizer);
}
