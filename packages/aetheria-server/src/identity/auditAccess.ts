// AETHERIA M06 step 23 — the Backend's independent check before the audit evidence is read: M03's record, current role catalog and `authorize` re-run per call.
// Only a checkout role whose CURRENT definition lists `audit_evidence` passes; a main session (empty callable set) and everything else get M03's own code.
// Nothing is cached, no role string from a tool is trusted, a refusal carries no project facts, and nothing here writes the identity store or runs Git.
import {
  authorize,
  currentRoles,
  deriveProject,
  identityOf,
  nodeFs,
  type IdentityPorts,
  type IdentityReader,
  type RolePort,
} from "./backendEntry.ts";
import type { ThreadIndex } from "./threadIndex.ts";

/** The audit tool's name: the capability a role's current definition must list (the same name the Agent host registers). */
const AUDIT_EVIDENCE_TOOL = "audit_evidence";

/** The project facts the evidence is read with: exactly what M03 derived for this session, and the facts' own problems. */
export interface AuditProject {
  readonly root: string;
  readonly place: "home" | "foreign";
  readonly settingsPaths: { readonly cycles: string };
  readonly problems: readonly string[];
}

export type AuditAccess =
  | { readonly ok: true; readonly project: AuditProject; readonly role: string | null }
  | { readonly ok: false; readonly code: string; readonly reason: string };

export interface AuditAccessOptions {
  readonly reader: IdentityReader;
  readonly index: Pick<ThreadIndex, "bindingOfSession">;
  /** `AETHERIA_CHECKOUT`: the Aetheria checkout whose roles are current. Missing or relative refuses every call (`AUTH_IDENTITY_UNAVAILABLE`). */
  readonly checkout: string | undefined;
  /** Home-role lookup inputs; absent means the process's own environment and home, exactly as the Agent host reads them. Tests supply scratch ones. */
  readonly env?: Record<string, string | undefined> | undefined;
  readonly homedir?: (() => string) | undefined;
}

export interface AuditAccessPort {
  /** For the carrier-verified session: its derived project and role, or the code that refuses it. Never throws. */
  check(sessionId: string): Promise<AuditAccess>;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const refuse = (code: string, reason: string): AuditAccess =>
  Object.freeze({ ok: false as const, code, reason });
const unavailable = (reason: string): AuditAccess => refuse("AUTH_IDENTITY_UNAVAILABLE", reason);

export function createAuditAccess(options: AuditAccessOptions): AuditAccessPort {
  const { reader, index, checkout } = options;

  const decide = async (sessionId: string): Promise<AuditAccess> => {
    if (typeof sessionId !== "string" || sessionId === "") return unavailable("no session");
    if (typeof checkout !== "string" || !checkout.startsWith("/"))
      return unavailable("the Backend has no absolute checkout (AETHERIA_CHECKOUT)");
    const binding = index.bindingOfSession(sessionId);
    if (binding === undefined) return unavailable("the session has no single thread binding");
    const cwd = binding.workingFolder;

    // The current catalog, read now. A checkout whose roles cannot be read cannot authorize anyone.
    let roles: RolePort;
    try {
      roles = currentRoles(checkout, {
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.homedir === undefined ? {} : { homedir: options.homedir }),
      });
    } catch (error) {
      return unavailable(`the checkout's roles cannot be read: ${message(error)}`);
    }

    // XC-1's one derivation, recomputed for this call. A failure is carried into `identityOf`, which judges it as M03 does.
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
      // The Backend registers no tools: a main session's callable set is empty, so only a role's own allow-list can reach the capability.
      callable: [],
    };
    const resolved = identityOf(ports, sessionId, cwd);
    if (!resolved.ok) return refuse(resolved.code, `identity unavailable (${resolved.reason})`);
    const verdict = authorize({ roles }, resolved, AUDIT_EVIDENCE_TOOL);
    if (!verdict.allowed) return refuse(verdict.code, verdict.reason);
    const { project } = resolved.identity;
    return Object.freeze({
      ok: true as const,
      role: resolved.identity.role,
      project: Object.freeze({
        root: project.root,
        place: project.place,
        settingsPaths: Object.freeze({ cycles: project.settingsPaths.cycles }),
        problems: Object.freeze([...derived.warnings]),
      }),
    });
  };

  return Object.freeze({
    async check(sessionId: string): Promise<AuditAccess> {
      try {
        return await decide(sessionId);
      } catch (error) {
        // Whatever failed, the answer is "cannot tell", never an allowance.
        return unavailable(`the check failed: ${message(error)}`);
      }
    },
  });
}
