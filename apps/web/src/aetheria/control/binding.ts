// Which Pi session a T3 thread is: read only from the active provider thread's STRONG Pi native reference, whose id is Pi's session FILE (provider-pi `sessionFile`).
// The Backend's session id is the UUID in that file's name, by the same rule as the server's thread port (threadPort.ts PI_FILE). Anything else is `unknown`.
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
  const fileName = ref.nativeId.split(/[\\/]/).at(-1) ?? "";
  const match = PI_SESSION_FILE.exec(fileName);
  if (match === null) return unknown("the native reference is not a Pi session file");
  return known(match[1]!);
}

const PI_SESSION_FILE = /^[^_]+_([A-Za-z0-9][A-Za-z0-9-]{0,127})\.jsonl$/;
