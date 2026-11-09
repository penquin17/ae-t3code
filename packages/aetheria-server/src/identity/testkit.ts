// @effect-diagnostics nodeBuiltinImport:off globalDate:off
// AETHERIA M04 Plan step 13 — shared fixtures for the identity tests (not production code; nothing outside tests imports it).
//
// The fixtures write M03's on-disk format by hand, because the fork can neither import the outer store nor reach its writer: an envelope
// `{formatVersion: 1, state, attemptId, writer, acceptedPrompt, record}` under `<stateRoot>/identity/<sessionId>.json`, owner-only, as the
// Agent host's writer leaves it. The real reader from the pinned archive reads these files; no test double stands in for it.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll } from "vite-plus/test";

const created: string[] = [];
// Each test file removes the temporary folders it made (only those, by the paths mkdtemp returned).
afterAll(() => {
  for (const root of created.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

export const rootOf = (): string => {
  const root = NodeFS.mkdtempSync(
    NodePath.join(NodeFS.realpathSync(NodeOS.tmpdir()), "ae-identity-"),
  );
  NodeFS.chmodSync(root, 0o700);
  created.push(root);
  return root;
};

export interface RecordFields {
  readonly sessionId: string;
  readonly kind: "main" | "child";
  readonly rootSessionId: string;
  readonly parentChain: readonly string[];
  readonly role: string | null;
  readonly roleOrigin: "checkout" | "home" | null;
  readonly roleDigest: string | null;
  readonly authoritySource: "main" | "role" | "spawn-explicit";
}

export const mainRecord = (sessionId: string): RecordFields => ({
  sessionId,
  kind: "main",
  rootSessionId: sessionId,
  parentChain: [],
  role: null,
  roleOrigin: null,
  roleDigest: null,
  authoritySource: "main",
});

export const childRecord = (
  sessionId: string,
  rootSessionId: string,
  parentChain: readonly string[],
  role = "worker",
): RecordFields => ({
  sessionId,
  kind: "child",
  rootSessionId,
  parentChain,
  role,
  roleOrigin: "home",
  roleDigest: null,
  authoritySource: "role",
});

export interface EnvelopeOptions {
  readonly state?: "active" | "retired" | "pending";
  readonly writer?: string;
  readonly acceptedPrompt?: boolean;
  readonly attemptId?: string;
  /** Raw bytes instead of an envelope: a corrupt file. */
  readonly raw?: string;
  /** File name stem when it differs from the record's session id (a misfiled record). */
  readonly fileStem?: string;
}

/** Write one record the way the Agent host's writer leaves it (owner-only dir and file). */
export function writeEnvelope(
  stateRoot: string,
  record: RecordFields,
  options: EnvelopeOptions = {},
): string {
  const dir = NodePath.join(stateRoot, "identity");
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  NodeFS.chmodSync(dir, 0o700);
  const path = NodePath.join(dir, `${options.fileStem ?? record.sessionId}.json`);
  const body =
    options.raw ??
    `${JSON.stringify({
      formatVersion: 1,
      state: options.state ?? "active",
      attemptId: options.attemptId ?? "attempt-1",
      writer: options.writer ?? "agent-authority",
      acceptedPrompt: options.acceptedPrompt ?? false,
      ...(options.state === "retired" ? { retiredReason: "test" } : {}),
      record,
    })}\n`;
  NodeFS.writeFileSync(path, body, { mode: 0o600 });
  NodeFS.chmodSync(path, 0o600);
  return path;
}

/** Every file under a folder with its bytes' digest, mode and mtime, so "unchanged" is a byte, mode and time comparison. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    let names: string[];
    try {
      names = NodeFS.readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = NodePath.join(current, name);
      const st = NodeFS.lstatSync(path);
      const rel = `${prefix}${name}`;
      if (st.isDirectory()) {
        out[`${rel}/`] = `dir:${(st.mode & 0o777).toString(8)}:${st.mtimeMs}`;
        walk(path, `${rel}/`);
      } else {
        out[rel] =
          `${NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex")}:${(st.mode & 0o777).toString(8)}:${st.mtimeMs}`;
      }
    }
  };
  walk(dir, "");
  return out;
}

export const THREAD = "mcp:6f1c2d3e-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
export const THREAD_B = "mcp:77777777-0a4b-4c5d-8e9f-a1b2c3d4e5f6";
export const SESSION = "0197d3c0-1111-7000-8000-000000000001";
export const SESSION_B = "0197d3c0-2222-7000-8000-000000000002";
export const FOLDER = "/work/project";
export const sessionFileOf = (sessionId: string, dir = "/sessions"): string =>
  `${dir}/2026-11-08T08-00-00-000Z_${sessionId}.jsonl`;

/** The owner-lock seam for a test that restarts over a root whose previous Backend "died": the probe proves every holder gone, and no age is waited for. */
export const DEAD_OWNER = {
  probe: { inspect: async () => ({ state: "gone" as const }) },
  staleAfterMs: 0,
};
