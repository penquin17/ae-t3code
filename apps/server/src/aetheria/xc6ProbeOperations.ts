// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// (B9 probe: plain Node/JSON code at the carrier boundary; the production Backend rewrites this per the host's Effect conventions.)
// AETHERIA B9 probe (M04 Plan step 11) — the test-only operations the carrier probe exercises. They stand in for the real Backend
// operations (board, questions, inspection), which later steps register through the same Xc6Operation contract. None of them
// returns argument text: replies carry lengths, digests and the verified identity only.

import * as NodeCrypto from "node:crypto";

import type { Xc6Operation, Xc6Settled } from "./xc6Core.ts";

const MAX_DELAY_MS = 5_000;
const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const operations: Record<string, Xc6Operation> = {
  /** The identity the Backend verified, plus the argument key names: shows that body fields never become the caller. */
  "probe.whoami": ({ caller, sessionId, kind, rootSessionId, args }) => ({
    status: "done",
    result: {
      sessionId,
      kind,
      rootSessionId,
      threadId: caller.threadId,
      providerInstanceId: caller.providerInstanceId,
      argKeys: Object.keys(args).sort(),
    },
  }),
  /** An explicit unavailable the caller must handle. */
  "probe.unavailable": () => ({ status: "unavailable", code: "XC6_PROBE_UNAVAILABLE" }),
  /** Returns a pending token, then completes after `delayMs`. */
  "probe.slow": ({ args }) => {
    const wanted =
      typeof args.delayMs === "number" && Number.isFinite(args.delayMs) ? args.delayMs : 200;
    const delayMs = Math.min(Math.max(0, wanted), MAX_DELAY_MS);
    return {
      status: "pending",
      settle: new Promise<Xc6Settled>((resolve) => {
        const timer = setTimeout(
          () => resolve({ status: "done", result: { slow: true } }),
          delayMs,
        );
        timer.unref();
      }),
    };
  },
  /** Proves a payload arrived intact without returning or retaining it. */
  "probe.echo-digest": ({ args }) => {
    const text = typeof args.text === "string" ? args.text : "";
    return { status: "done", result: { length: text.length, sha256: sha256(text) } };
  },
};

export const PROBE_OPERATIONS: Readonly<Record<string, Xc6Operation>> = Object.freeze(operations);
