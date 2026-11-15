// AETHERIA M11 step 8 (D6, D7) — who may inspect: M03's record, the CURRENT role catalog and `authorize`, re-run per call before any provider, under spawn authorization's main-session rule
// (spawnAuthorizer.ts: a main session's callable set is exactly the tool asked about, not the audit's empty set). A Builder main session cannot be told from an Aetheria one here (accepted cost).
// A child without `inspect_list`/`inspect_query` in its role or explicit list is refused AUTH_TOOL_NOT_ALLOWED. The session is the carrier's and the folder the thread index's; no argument is read,
// nothing is cached, and nothing writes the identity store.
import { INSPECT_LIST_OPERATION, INSPECT_QUERY_OPERATION } from "./inspectEntry.ts";
import {
  authorize,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  type IdentityPorts,
  type IdentityReader,
  type RolePort,
} from "../identity/backendEntry.ts";
import type { ThreadIndex } from "../identity/threadIndex.ts";

/** The Agent tool each operation is authorized as: the same names the Agent host registers. */
const INSPECT_TOOL_OF_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  [INSPECT_LIST_OPERATION]: "inspect_list",
  [INSPECT_QUERY_OPERATION]: "inspect_query",
});

export type InspectAccess =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export interface InspectAccessOptions {
  readonly reader: IdentityReader;
  readonly index: Pick<ThreadIndex, "bindingOfSession">;
  /** `AETHERIA_CHECKOUT`: the checkout whose roles are current. Missing or relative refuses every call. */
  readonly checkout: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly homedir?: (() => string) | undefined;
}

export interface InspectAccessPort {
  /** The carrier-verified session's verdict on the tool of `operation`. Never throws; an unknown operation is refused. */
  check(sessionId: string, operation: string): Promise<InspectAccess>;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const refuse = (code: string, reason: string): InspectAccess =>
  Object.freeze({ ok: false as const, code, reason });
const unavailable = (reason: string): InspectAccess => refuse("AUTH_IDENTITY_UNAVAILABLE", reason);
const ALLOWED: InspectAccess = Object.freeze({ ok: true as const });

export function createInspectAccess(options: InspectAccessOptions): InspectAccessPort {
  const { reader, index, checkout } = options;

  const decide = async (sessionId: string, operation: string): Promise<InspectAccess> => {
    const toolName = Object.hasOwn(INSPECT_TOOL_OF_OPERATION, operation)
      ? INSPECT_TOOL_OF_OPERATION[operation]
      : undefined;
    if (toolName === undefined) return refuse("AUTH_TOOL_NOT_ALLOWED", "not an inspect operation");
    if (typeof sessionId !== "string" || sessionId === "") return unavailable("no session");
    if (typeof checkout !== "string" || !checkout.startsWith("/"))
      return unavailable("the Backend has no absolute checkout (AETHERIA_CHECKOUT)");
    const binding = index.bindingOfSession(sessionId);
    if (binding === undefined) return unavailable("the session has no single thread binding");
    const cwd = binding.workingFolder;

    let roles: RolePort;
    try {
      roles = currentRoles(checkout, {
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.homedir === undefined ? {} : { homedir: options.homedir }),
      });
    } catch (error) {
      return unavailable(`the checkout's roles cannot be read: ${message(error)}`);
    }
    let derived: Awaited<ReturnType<typeof deriveProject>>;
    try {
      derived = await deriveProject(nodeFs, cwd, checkout);
    } catch (error) {
      return unavailable(`the project cannot be derived: ${message(error)}`);
    }
    const ports: IdentityPorts = {
      read: (id) => reader.read(id),
      roles,
      project: () => {
        if (!derived.ok) throw new Error(derived.problems.join("; "));
        return derived.project;
      },
      // The spawn rule: a main session's authority is the composition's callable set, and the Backend registers no tools, so it is exactly the tool asked about.
      callable: [toolName],
    };
    const resolved = identityOf(ports, sessionId, cwd);
    if (!resolved.ok) return refuse(resolved.code, `identity unavailable (${resolved.reason})`);
    const verdict = authorize({ roles }, resolved, toolName);
    return verdict.allowed ? ALLOWED : refuse(verdict.code, verdict.reason);
  };

  return Object.freeze({
    async check(sessionId: string, operation: string): Promise<InspectAccess> {
      try {
        return await decide(sessionId, operation);
      } catch (error) {
        // Whatever failed, the answer is "cannot tell", never an allowance.
        return unavailable(`the check failed: ${message(error)}`);
      }
    },
  });
}
