// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11) — test-only identity port. It answers one question for the XC-6 carrier: does the bearer's
// thread/provider instance own the Pi session the Agent adapter claimed, and does M03 hold an ACTIVE record for that session?
//
// Two owner-only files under the probe root, both read-only here:
//   identity/<sessionId>.json      M03's envelope (formatVersion 1, state active|retired, record.sessionId) written by the Agent host;
//   b9-index/<digest of threadId>.json { threadId, providerInstanceId, sessionId }: the thread -> Pi-session binding the Backend writes at
//                                  launch/resume (Plan step 13 replaces this stand-in with the real index and the read-only resolver).
// This module reads the M03 file format by itself because the fork may not import outer source (M02 D7); step 12's pinned artifact edge
// replaces this reader with the real resolver. Nothing here ever writes, repairs or promotes a record, and a missing file is
// "unavailable", never main.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { Xc6Caller, Xc6Identity } from "./xc6Core.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** T3 thread ids are not path-safe (e.g. `mcp:<uuid>`), so the index file is named by the id's digest. */
export const indexFileName = (threadId: string) =>
  `${NodeCrypto.createHash("sha256").update(threadId).digest("hex").slice(0, 32)}.json`;
const unavailable = (): Xc6Identity => ({
  ok: false,
  outcome: "unavailable",
  code: "XC6_IDENTITY_UNAVAILABLE",
});
const refused = (code: string): Xc6Identity => ({ ok: false, outcome: "refused", code });

type Read =
  | { readonly kind: "absent" }
  | { readonly kind: "bad" }
  | { readonly kind: "ok"; readonly json: any };

/** Read one owner-only regular file without following a link. Anything else is "bad", an absent file is "absent". */
const readJson = (path: string): Read => {
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(path, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
    const st = NodeFS.fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o077) !== 0) return { kind: "bad" };
    return { kind: "ok", json: JSON.parse(NodeFS.readFileSync(fd, "utf8")) };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "bad" };
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
  }
};

export function makeProbeIdentity(root: string) {
  return (caller: Xc6Caller, claimedSessionId: string | null): Xc6Identity => {
    if (
      claimedSessionId === null ||
      !NAME.test(claimedSessionId) ||
      caller.threadId === "" ||
      caller.threadId.length > 256
    )
      return unavailable();

    const index = readJson(NodePath.join(root, "b9-index", indexFileName(caller.threadId)));
    if (index.kind !== "ok") return unavailable();
    const binding = index.json;
    if (
      binding === null ||
      typeof binding !== "object" ||
      typeof binding.sessionId !== "string" ||
      typeof binding.threadId !== "string" ||
      typeof binding.providerInstanceId !== "string"
    )
      return unavailable();
    if (
      binding.threadId !== caller.threadId ||
      binding.providerInstanceId !== caller.providerInstanceId
    )
      return refused("XC6_IDENTITY_MISMATCH");
    if (binding.sessionId !== claimedSessionId) return refused("XC6_IDENTITY_MISMATCH");

    const stored = readJson(NodePath.join(root, "identity", `${claimedSessionId}.json`));
    if (stored.kind !== "ok") return unavailable();
    const envelope = stored.json;
    const record = envelope?.record;
    if (
      envelope === null ||
      typeof envelope !== "object" ||
      envelope.formatVersion !== 1 ||
      record === null ||
      typeof record !== "object" ||
      typeof record.sessionId !== "string" ||
      typeof record.kind !== "string" ||
      typeof record.rootSessionId !== "string"
    )
      return unavailable();
    if (record.sessionId !== claimedSessionId) return refused("XC6_IDENTITY_MISMATCH");
    if (envelope.state === "retired") return refused("XC6_IDENTITY_RETIRED");
    if (envelope.state !== "active") return unavailable();
    return {
      ok: true,
      sessionId: record.sessionId,
      kind: record.kind,
      rootSessionId: record.rootSessionId,
    };
  };
}
