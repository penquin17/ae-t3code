// Which Pi session a T3 thread is (UNVERIFIED mapping, M10 phase 2a). The Backend's `rootSessionId` / `sessionId` are Pi session ids; the control route's params are T3 ids. Nothing guesses an
// equivalence: the Pi session id is read from the thread's active provider thread, and only from a STRONG native reference of the Pi driver (orchestrationV2.ts `OrchestrationV2ProviderRef`,
// `OrchestrationV2ProviderThread.nativeThreadRef`). Anything else is `unknown`, and the page says so. That "nativeId equals the Backend's Pi session id" is assumed here and unproved until the
// native run. Plain TypeScript over a structural subset of the projection; no T3 import.
import { unknown, known, type Known } from "../core/known";

/** The part of a T3 thread projection this reads (`thread.activeProviderThreadId`, `providerThreads[]`). */
export interface ThreadBindingInput {
  readonly thread: { readonly activeProviderThreadId: string | null };
  readonly providerThreads: ReadonlyArray<{
    readonly id: string;
    readonly driver: string;
    readonly nativeThreadRef: {
      readonly driver: string;
      readonly nativeId: string | null;
      readonly strength: string;
    } | null;
  }>;
}

export const IDENTITY_UNKNOWN_TEXT =
  "This session's identity is not known to the browser; nothing can be shown.";

export function piSessionIdOf(input: ThreadBindingInput | null): Known<string> {
  if (input === null) return unknown("the thread has not been read yet");
  const activeId = input.thread.activeProviderThreadId;
  if (activeId === null) return unknown("the thread has no active provider thread");
  const active = input.providerThreads.find((thread) => thread.id === activeId);
  if (active === undefined) return unknown("the active provider thread has not been read");
  const ref = active.nativeThreadRef;
  if (ref === null) return unknown("the provider thread has no native reference");
  if (active.driver !== "pi" || ref.driver !== "pi") {
    return unknown("the provider thread is not a Pi session");
  }
  if (ref.strength !== "strong")
    return unknown(`the native reference is ${ref.strength}, not strong`);
  if (ref.nativeId === null || ref.nativeId === "") {
    return unknown("the native reference carries no id");
  }
  return known(ref.nativeId);
}
