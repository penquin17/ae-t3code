// The client's report of what is mounted (D17, XC-19). Each report is the WHOLE set of mounted regions (descriptor and visibility) with a rising sequence, so a reply that never came is repeated safely
// and the Backend can refuse a stale one; it carries no principal, no session, no "viewing" and no value (the Backend binds the first to the connection and observes the viewed session itself).
// One call is in flight at a time. A reply to a call that was abandoned (timed out, or superseded) is ignored and can never replace what a newer call settled. Failures that retrying cannot change stop
// the sync and say so; the others back off, bounded, and start over when the page next changes. Nothing here is a user action: a repeat is only the same state report again.
import type { RegionsReportPayload, RegionsReportResult } from "@t3tools/aetheria-contracts";

import type { RegionRegistry } from "./registry";

export type RegionsReply = RegionsReportResult;
export interface RegionsTransport {
  /** Sends one report. A rejection means the reply never came. */
  report(payload: RegionsReportPayload): Promise<RegionsReply>;
}

export type SyncState = "idle" | "syncing" | "waiting" | "failed" | "refused";
export interface SyncStatus {
  readonly state: SyncState;
  /** The highest sequence the Backend has confirmed. */
  readonly ackedSequence: number;
  /** The Backend's code for the last refusal or failure; absent after a success. */
  readonly lastCode?: string;
}

export interface RegionSyncDeps {
  readonly registry: RegionRegistry;
  readonly transport: RegionsTransport;
  /** Quiet time before a change is sent, so changes made together go together. */
  readonly debounceMs: number;
  /** How long a call may go unanswered before it is abandoned. */
  readonly replyTimeoutMs: number;
  readonly retry: { readonly baseMs: number; readonly maxMs: number; readonly maxAttempts: number };
}

export interface RegionSync {
  start(): void;
  /**
   * Says the connection is new. The Backend drops a client when its connection closes, and a page that did not change sends nothing, so the new connection would never hear of it: this sends the whole set once
   * more, on the same client id and a sequence that still rises (the Backend lets the same device take over a client it has not dropped yet, and takes any sequence for one it has). A call the old connection never
   * answered is given up, a wait for a retry is cut short, and a failure or refusal starts over. Does nothing before `start` and after `stop`.
   */
  resend(): void;
  stop(): void;
  status(): SyncStatus;
}

/** Refusals no repeat can change: the connection may not do this, the id is taken, the schema or size is wrong. */
const FINAL_CODES: ReadonlySet<string> = new Set([
  "REGIONS_CLIENT_CONFLICT",
  "REGIONS_NOT_AUTHORIZED",
  "REGIONS_DEVICE_REVOKED",
  "REGIONS_SCHEMA_UNSUPPORTED",
  "REGIONS_TOO_LARGE",
  "REGIONS_INVALID_REPORT",
]);

export function createRegionSync(deps: RegionSyncDeps): RegionSync {
  let started = false;
  let state: SyncState = "idle";
  let lastCode: string | undefined;
  let sequence = 0;
  let acked = 0;
  let dirty = false;
  let attempts = 0;
  /** The call whose reply is awaited; a reply for any other id is a late one. */
  let inflight: number | undefined;
  let callIds = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let backoff: ReturnType<typeof setTimeout> | undefined;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const clearTimers = () => {
    clearTimeout(debounce);
    clearTimeout(backoff);
    clearTimeout(replyTimer);
    debounce = backoff = replyTimer = undefined;
  };

  const request = () => {
    if (!started || state === "refused" || inflight !== undefined || backoff !== undefined) return;
    if (state === "failed") {
      attempts = 0;
      lastCode = undefined;
    }
    state = "syncing";
    clearTimeout(debounce);
    debounce = setTimeout(flush, deps.debounceMs);
  };

  const settled = () => {
    inflight = undefined;
    clearTimeout(replyTimer);
    replyTimer = undefined;
  };

  const failed = (code: string | undefined) => {
    settled();
    lastCode = code;
    attempts += 1;
    if (attempts >= deps.retry.maxAttempts) {
      state = "failed";
      return;
    }
    state = "waiting";
    const wait = Math.min(deps.retry.maxMs, deps.retry.baseMs * 2 ** (attempts - 1));
    backoff = setTimeout(() => {
      backoff = undefined;
      flush();
    }, wait);
  };

  function flush() {
    debounce = undefined;
    if (!started || inflight !== undefined) return;
    const snapshot = deps.registry.snapshot();
    sequence += 1;
    dirty = false;
    state = "syncing";
    const id = ++callIds;
    inflight = id;
    const mine = sequence;
    replyTimer = setTimeout(() => {
      if (inflight === id) failed(undefined);
    }, deps.replyTimeoutMs);
    let call: Promise<RegionsReply>;
    try {
      call = deps.transport.report({
        clientId: snapshot.clientId,
        sequence: mine,
        regions: snapshot.regions.map((entry) => ({
          descriptor: entry.descriptor,
          visible: entry.visible,
        })),
      });
    } catch {
      failed(undefined);
      return;
    }
    call.then(
      (reply) => {
        if (inflight !== id || !started) return;
        if (reply.ok) {
          settled();
          acked = Math.max(acked, mine);
          attempts = 0;
          lastCode = undefined;
          if (dirty) request();
          else state = "idle";
          return;
        }
        if (FINAL_CODES.has(reply.code)) {
          settled();
          state = "refused";
          lastCode = reply.code;
          return;
        }
        failed(reply.code);
      },
      () => {
        if (inflight !== id || !started) return;
        failed(undefined);
      },
    );
  }

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribe = deps.registry.subscribe(() => {
        dirty = true;
        request();
      });
      dirty = true;
      request();
    },
    resend() {
      if (!started) return;
      settled();
      clearTimeout(backoff);
      backoff = undefined;
      attempts = 0;
      lastCode = undefined;
      if (state === "refused" || state === "failed") state = "idle";
      dirty = true;
      request();
    },
    stop() {
      started = false;
      unsubscribe?.();
      unsubscribe = undefined;
      clearTimers();
      inflight = undefined;
    },
    status() {
      return lastCode === undefined
        ? { state, ackedSequence: acked }
        : { state, ackedSequence: acked, lastCode };
    },
  };
}
