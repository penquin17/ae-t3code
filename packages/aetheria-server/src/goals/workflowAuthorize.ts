// AETHERIA M07 (DV3; Plan steps 14 and 23) — M03's verdict on `workflow` for one session, the Backend's own port. `authorize(…, "workflow")` refuses even a main session when the Backend passes the audit
// shape `callable: []`, so this port names the tool being asked about, exactly as spawn authorization does (spawnAuthorizer.ts: "a main session's authority is the composition's callable set; the
// Backend registers no tools, so it is exactly the tool being asked about"). A child is refused by M03 whatever its allow-list says. Facts only: the verdict is read from M03's record, the
// checkout's current roles and the derived project, never from an argument the model supplies. Nothing calls it yet; the workflow tool (step 23) will.
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

export const WORKFLOW_TOOL = "workflow";

export type WorkflowAuthorization =
  | { readonly ok: true; readonly sessionId: string; readonly rootSessionId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export type WorkflowAuthorizerPort = (input: {
  readonly sessionId: string;
  readonly workingFolder: string;
}) => Promise<WorkflowAuthorization>;

export interface WorkflowAuthorizerOptions {
  readonly reader: IdentityReader;
  /** `AETHERIA_CHECKOUT`: the checkout whose roles are current. Missing or relative refuses every call as identity-unavailable. */
  readonly checkout: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly homedir?: (() => string) | undefined;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const unavailable = (reason: string): WorkflowAuthorization =>
  Object.freeze({ ok: false as const, code: "AUTH_IDENTITY_UNAVAILABLE", reason });

export function createWorkflowAuthorizer(
  options: WorkflowAuthorizerOptions,
): WorkflowAuthorizerPort {
  const { reader, checkout } = options;
  return async ({ sessionId, workingFolder }) => {
    if (typeof sessionId !== "string" || sessionId === "") return unavailable("no session");
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
    try {
      const derived = await deriveProject(nodeFs, workingFolder, checkout);
      const ports: IdentityPorts = {
        read: (id) => reader.read(id),
        roles,
        project: () => {
          if (!derived.ok) throw new Error(derived.problems.join("; "));
          return derived.project;
        },
        callable: [WORKFLOW_TOOL],
      };
      const resolved = identityOf(ports, sessionId, workingFolder);
      if (!resolved.ok)
        return Object.freeze({
          ok: false as const,
          code: resolved.code,
          reason: `identity unavailable (${resolved.reason})`,
        });
      const verdict = authorize({ roles }, resolved, WORKFLOW_TOOL);
      if (!verdict.allowed)
        return Object.freeze({ ok: false as const, code: verdict.code, reason: verdict.reason });
      return Object.freeze({
        ok: true as const,
        sessionId: resolved.identity.sessionId,
        rootSessionId: resolved.identity.rootSessionId,
      });
    } catch (error) {
      return unavailable(`the verdict could not be reached: ${message(error)}`);
    }
  };
}
