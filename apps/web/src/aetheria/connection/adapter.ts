// The adapter (K5): the one place T3's connection state, the Backend's upgrade refusal body and the composition status become the model's facts. If a wire changes, this file changes and the model and views do not.
// It holds no credential and sends none: the probe asks for no resource that needs one (the digest gate runs before authentication), so a 401 it receives says nothing about the device.
import {
  decodeAetheriaCompositionStatus,
  type AetheriaCompositionStatus,
} from "@t3tools/aetheria-contracts";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";

import type { SendResult } from "../core/outcome";
import type { Projection } from "../core/resync";
import type { CompositionRead, ExpectedDigest, TransportFacts, UpgradeRefusal } from "./state";

/** The query a client declares its expected Backend digest in; the server's pre-upgrade gate reads this name (apps/server/src/aetheria/backendDigest.ts). */
const EXPECTED_BACKEND_DIGEST_QUERY = "aetheriaExpectedBackendDigest";

const DIGEST_V1 = /^sha256:[0-9a-f]{64}$/;

/** The digest this build embedded, as supplied by the build (an environment value or constant). Absent and malformed are different facts and neither is defaulted. */
export function expectedDigestFrom(raw: string | undefined): ExpectedDigest {
  const text = raw?.trim() ?? "";
  if (text === "") return { tag: "absent" };
  return DIGEST_V1.test(text) ? { tag: "present", value: text } : { tag: "malformed" };
}

/** T3's supervisor state, reduced. Only a blocked failure carries T3's reason and detail; a transient one is left to the phase. */
export function transportFromSupervisor(state: SupervisorConnectionState): TransportFacts {
  const failure = state.lastFailure;
  const blocked =
    state.phase === "blocked" && failure !== null && failure._tag === "ConnectionBlockedError"
      ? { reason: failure.reason, detail: failure.detail }
      : null;
  return {
    network: state.network,
    phase: state.phase,
    stage: state.stage,
    attempt: state.attempt,
    retryAt: state.retryAt,
    blocked,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function digestValue(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  return raw["algorithm"] === "sha256" &&
    typeof raw["value"] === "string" &&
    DIGEST_V1.test(raw["value"])
    ? raw["value"]
    : undefined;
}

/** A refused upgrade's body, read field by field: a field of the wrong shape is dropped, never coerced, so only supplied words are ever shown. */
export function parseUpgradeRefusal(status: number, body: unknown): UpgradeRefusal {
  if (!isRecord(body)) return { status };
  const code = typeof body["code"] === "string" && body["code"] !== "" ? body["code"] : undefined;
  const message =
    typeof body["message"] === "string" && body["message"] !== "" ? body["message"] : undefined;
  const actualDigest = digestValue(body["actualDigest"]);
  const expectedDigest = digestValue(body["expectedDigest"]);
  return {
    status,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(actualDigest === undefined ? {} : { actualDigest }),
    ...(expectedDigest === undefined ? {} : { expectedDigest }),
  };
}

/** The decoded `aetheria.composition.status`, reduced to what the model uses. */
export function compositionFromStatus(status: AetheriaCompositionStatus): CompositionRead {
  return {
    tag: "read",
    digest: status.digest.value,
    phase: status.phase,
    modules: status.modules.map((m) => ({ id: m.id, required: m.required, state: m.state })),
  };
}

export type ProbeResult =
  | { readonly tag: "refused"; readonly refusal: UpgradeRefusal }
  | { readonly tag: "inconclusive"; readonly reason: string };

/**
 * A browser WebSocket cannot read the status or body of a refused upgrade, so after a failed open the adapter asks the same /ws path once over HTTP.
 * The server's digest and protocol gate answers a plain GET before it authenticates anything, so a 409 or 426 is read exactly; any other answer (401 included, because this request has no credential)
 * is inconclusive and never reported as the device being unauthorized.
 */
export async function probeUpgrade(input: {
  readonly fetch: typeof fetch;
  readonly httpBaseUrl: string;
  readonly expectedDigest: string;
}): Promise<ProbeResult> {
  if (!DIGEST_V1.test(input.expectedDigest)) {
    return { tag: "inconclusive", reason: "this build carries no usable expected digest" };
  }
  const url = new URL("/ws", input.httpBaseUrl);
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set(EXPECTED_BACKEND_DIGEST_QUERY, input.expectedDigest);
  let response: Response;
  try {
    response = await input.fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      redirect: "error",
    });
  } catch {
    return { tag: "inconclusive", reason: "the probe request failed" };
  }
  if (response.status !== 409 && response.status !== 426) {
    return {
      tag: "inconclusive",
      reason: `the probe was answered with ${response.status}, which is not a gate refusal`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { tag: "refused", refusal: parseUpgradeRefusal(response.status, body) };
}

/** T3's shell synchronization, reduced to what the model needs. `generation` is T3's own count of authoritative snapshots, so it is the baseline's version. */
export interface ShellFacts {
  readonly status: "empty" | "cached" | "synchronizing" | "live";
  readonly hasSnapshot: boolean;
  readonly generation: number;
}

/** A projection is current only when T3 says the shell is live and holds a snapshot. A cached shell is the last value after a loss: kept, marked out of date, and in need of a new baseline. */
export function projectionFromShell(shell: ShellFacts): Projection<unknown> {
  if (!shell.hasSnapshot) return { phase: "awaiting-baseline" };
  if (shell.status === "live") {
    return {
      phase: "live",
      version: shell.generation,
      value: null,
      stale: false,
      needsBaseline: false,
    };
  }
  if (shell.status === "cached") {
    return {
      phase: "live",
      version: shell.generation,
      value: null,
      stale: true,
      needsBaseline: true,
    };
  }
  return { phase: "awaiting-baseline" };
}

/** One settled `aetheria.composition.status` call as the composition fact. Anything but a status of exactly the safe shape is unavailable, with the words of whoever said it; nothing is inferred. */
export function compositionFromReply(reply: SendResult<unknown>): CompositionRead {
  switch (reply.tag) {
    case "accepted":
      try {
        // The decoder is typed for the status's own shape but checks every field at runtime, so a value of any other shape is thrown out here, never coerced.
        return compositionFromStatus(
          decodeAetheriaCompositionStatus(
            reply.value as Parameters<typeof decodeAetheriaCompositionStatus>[0],
          ),
        );
      } catch {
        return {
          tag: "unavailable",
          reason: "the composition status did not have the expected shape",
        };
      }
    case "refused":
      return { tag: "unavailable", reason: reply.message };
    case "lost":
      return {
        tag: "unavailable",
        reason: "the reply to the composition status read never arrived",
      };
    case "unavailable":
      return { tag: "unavailable", reason: reply.reason };
  }
}
