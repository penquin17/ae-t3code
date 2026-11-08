// AETHERIA — maps T3's stored events to the Backend's identity facts: the thread index owns bindings, the lifecycle tracker owns observations, this file only the mapping.
// The binding records the MCP credential id read through `credentialOf(threadId)` when the event arrives, not the runtime provider-session id; no credential, folder or matching provider instance: nothing is bound.
// `acceptedPrompt: false` is never produced, because no T3 event states that no prompt was accepted.

import type { BindInput, ThreadIndex } from "./threadIndex.ts";
import type { LifecycleTracker } from "./lifecycle.ts";

/** A stored domain event, structurally: the sequence, the event type and thread, and its payload. */
export interface StoredEventLike {
  readonly sequence: number;
  readonly event: { readonly type: string; readonly threadId?: string; readonly payload?: unknown };
}

export interface FeedOutcome {
  readonly threadId: string;
  readonly bound: boolean;
  readonly change?: "created" | "replaced" | "unchanged";
  readonly reason?: string;
}

export interface IdentityFeedOptions {
  readonly index: Pick<ThreadIndex, "bind">;
  readonly tracker: Pick<LifecycleTracker, "record">;
  /** T3's current MCP credential id for the thread (the id its bearer proves), or undefined when T3 holds none. */
  readonly credentialOf: (threadId: string) => string | undefined | Promise<string | undefined>;
}

export interface IdentityFeed {
  /** Apply one stored event. Never throws; the outcomes list each thread whose binding was attempted. */
  ingest(stored: StoredEventLike): Promise<readonly FeedOutcome[]>;
}

const PI_DRIVER = "pi";
const MAX_TRACKED = 1024;
const RUNNING = new Set(["starting", "running", "waiting"]);
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" && v.length <= 4096 && !v.includes("\0") ? v : undefined;

interface SessionInfo {
  readonly providerInstanceId: string;
  readonly cwd: string | undefined;
}
interface ThreadUpdate {
  readonly threadId: string;
  readonly providerInstanceId: string;
  readonly sessionFile: string;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED) map.delete(map.keys().next().value as K);
}

export function createIdentityFeed(options: IdentityFeedOptions): IdentityFeed {
  const { index, tracker } = options;
  const sessions = new Map<string, SessionInfo>();
  const waiting = new Map<string, ThreadUpdate>();
  const accepted = new Set<string>();

  const credential = async (threadId: string): Promise<string | undefined> => {
    try {
      return str(await options.credentialOf(threadId));
    } catch {
      return undefined;
    }
  };

  const tryBind = async (update: ThreadUpdate, info: SessionInfo): Promise<FeedOutcome> => {
    const none = (reason: string): FeedOutcome => ({
      threadId: update.threadId,
      bound: false,
      reason,
    });
    if (info.providerInstanceId !== update.providerInstanceId)
      return none("provider-instance-mismatch");
    if (info.cwd === undefined || !info.cwd.startsWith("/")) return none("no-working-folder");
    const providerSessionId = await credential(update.threadId);
    if (providerSessionId === undefined) return none("no-credential");
    const input: BindInput = {
      threadId: update.threadId,
      providerSessionId,
      providerInstanceId: update.providerInstanceId,
      sessionFile: update.sessionFile,
      workingFolder: info.cwd,
    };
    let result: ReturnType<ThreadIndex["bind"]>;
    try {
      result = index.bind(input);
    } catch {
      return none("bind-threw");
    }
    return result.ok
      ? { threadId: update.threadId, bound: true, change: result.change }
      : none(result.code);
  };

  const onSession = async (
    threadId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<FeedOutcome[]> => {
    const id = str(payload.id);
    const providerInstanceId = str(payload.providerInstanceId);
    const status = str(payload.status);
    if (id === undefined || providerInstanceId === undefined) return [];
    const info: SessionInfo = { providerInstanceId, cwd: str(payload.cwd) };
    remember(sessions, id, info);
    if (threadId !== undefined && status !== undefined) {
      if (RUNNING.has(status)) tracker.record({ kind: "running", threadId });
      else if (status === "ready") tracker.record({ kind: "settled", threadId });
      else if (status === "stopped")
        tracker.record({
          kind: "closed",
          threadId,
          acceptedPrompt: accepted.has(threadId) ? true : null,
        });
      else if (status === "error") tracker.record({ kind: "unknown", threadId });
    }
    const pending = waiting.get(id);
    if (pending === undefined) return [];
    waiting.delete(id);
    return [await tryBind(pending, info)];
  };

  const onThread = async (
    eventThreadId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<FeedOutcome[]> => {
    if (payload.driver !== PI_DRIVER) return [];
    const threadId = str(payload.appThreadId) ?? eventThreadId;
    const providerInstanceId = str(payload.providerInstanceId);
    const runtimeSession = str(payload.providerSessionId);
    const sessionFile = str(record(payload.nativeThreadRef)?.nativeId);
    if (
      threadId === undefined ||
      providerInstanceId === undefined ||
      runtimeSession === undefined ||
      sessionFile === undefined
    )
      return [];
    const update: ThreadUpdate = { threadId, providerInstanceId, sessionFile };
    const info = sessions.get(runtimeSession);
    if (info === undefined) {
      remember(waiting, runtimeSession, update);
      return [];
    }
    return [await tryBind(update, info)];
  };

  return Object.freeze({
    async ingest(stored: StoredEventLike): Promise<readonly FeedOutcome[]> {
      try {
        const event =
          record(stored)?.event === undefined ? undefined : record(record(stored)?.event);
        const type = str(event?.type);
        if (event === undefined || type === undefined) return [];
        const threadId = str(event.threadId);
        const payload = record(event.payload);
        switch (type) {
          case "provider-session.updated":
          case "provider-session.attached":
            return payload === undefined ? [] : await onSession(threadId, payload);
          case "provider-thread.updated":
            return payload === undefined ? [] : await onThread(threadId, payload);
          case "run.created":
            if (threadId !== undefined) {
              accepted.add(threadId);
              tracker.record({ kind: "accepted", threadId });
            }
            return [];
          case "thread.deleted":
            if (threadId !== undefined) tracker.record({ kind: "deleted", threadId });
            return [];
          default:
            return [];
        }
      } catch {
        return [];
      }
    },
  });
}
