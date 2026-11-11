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

/** The generic delegation tool's name: the tool a spawn with an explicit allow-list is authorized as. */
export const GENERIC_SPAWN_TOOL = "subagent";

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

  const decide = async (
    input: Parameters<SpawnAuthorizerPort["authorize"]>[0],
  ): Promise<SpawnAuthorization> => {
    const { callerSessionId, workingFolder, args } = input;
    if (typeof callerSessionId !== "string" || callerSessionId === "")
      return unavailable("no session");
    if (typeof workingFolder !== "string" || !workingFolder.startsWith("/"))
      return unavailable("the caller has no absolute working folder");
    if (typeof checkout !== "string" || !checkout.startsWith("/"))
      return unavailable("the Backend has no absolute checkout (AETHERIA_CHECKOUT)");
    let roles: RolePort;
    try {
      roles = currentRoles(checkout, {
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.homedir === undefined ? {} : { homedir: options.homedir }),
      });
    } catch (error) {
      return unavailable(`the checkout's roles cannot be read: ${message(error)}`);
    }
    const derived = await deriveProject(nodeFs, workingFolder, checkout);
    const toolName = "role" in args ? args.role : GENERIC_SPAWN_TOOL;
    // A main session's authority is the composition's callable set; the Backend registers no tools, so it is exactly the tool being asked about.
    const ports: IdentityPorts = {
      read: (id) => reader.read(id),
      roles,
      project: () => {
        if (!derived.ok) throw new Error(derived.problems.join("; "));
        return derived.project;
      },
      callable: [toolName],
    };
    const resolved = identityOf(ports, callerSessionId, workingFolder);
    if (!resolved.ok) return refuse(resolved.code, `identity unavailable (${resolved.reason})`);
    const verdict = authorize({ roles }, resolved, toolName);
    if (!verdict.allowed) return refuse(verdict.code, verdict.reason);
    const facts = await options.launchFacts(callerSessionId);
    if (facts === undefined || facts.routes.length === 0)
      return unavailable("the caller's launch facts (routes and modes) are unknown");
    const { identity } = resolved;
    const parent = {
      sessionId: identity.sessionId,
      rootSessionId: identity.rootSessionId,
      parentChain: [...identity.parentChain],
    };
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
  };
  return Object.freeze(authorizer);
}
