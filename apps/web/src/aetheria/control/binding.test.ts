import { describe, expect, it } from "vite-plus/test";

import { piSessionIdOf, type ThreadBindingInput } from "./binding";

// Pi's native id is its session FILE (provider-pi adapter `sessionFile`); the Backend's id is the UUID in its name.
const SESSION_FILE =
  "/home/u/.pi/agent/sessions/--Users-u-work--/2026-11-13T06-33-59-925Z_01a1d39c-ef74-75f6-a485-d6f532d49785.jsonl";
const provider = (over: Record<string, unknown> = {}) => ({
  id: "pt-1",
  driver: "pi",
  nativeThreadRef: { driver: "pi", nativeId: SESSION_FILE, strength: "strong" },
  ...over,
});
const input = (
  providerThreads: readonly object[],
  activeProviderThreadId: string | null = "pt-1",
): ThreadBindingInput =>
  ({ thread: { activeProviderThreadId }, providerThreads }) as unknown as ThreadBindingInput;

describe("a T3 thread's Pi session id is known only from a strong native reference", () => {
  it("is the session id named by the strong Pi session file of the active provider thread", () => {
    expect(piSessionIdOf(input([provider()]))).toEqual({
      state: "known",
      value: "01a1d39c-ef74-75f6-a485-d6f532d49785",
    });
  });

  it("reads a Windows-style session path the same way", () => {
    const windows = "C:\\Users\\u\\.pi\\sessions\\2026-11-13T06-33-59-925Z_abc-123.jsonl";
    expect(
      piSessionIdOf(
        input([
          provider({ nativeThreadRef: { driver: "pi", nativeId: windows, strength: "strong" } }),
        ]),
      ),
    ).toEqual({ state: "known", value: "abc-123" });
  });

  it.each([
    ["no projection yet", null],
    ["no active provider thread", input([provider()], null)],
    ["the active provider thread is not in the projection", input([provider({ id: "other" })])],
    ["a null native reference", input([provider({ nativeThreadRef: null })])],
    [
      "a weak native reference",
      input([provider({ nativeThreadRef: { driver: "pi", nativeId: "x", strength: "weak" } })]),
    ],
    [
      "a reference without an id",
      input([provider({ nativeThreadRef: { driver: "pi", nativeId: null, strength: "strong" } })]),
    ],
    [
      "a strong id that is not a Pi session file",
      input([
        provider({
          nativeThreadRef: { driver: "pi", nativeId: "pi-session-77", strength: "strong" },
        }),
      ]),
    ],
    [
      "another driver's reference",
      input([
        provider({
          driver: "codex",
          nativeThreadRef: { driver: "codex", nativeId: "x", strength: "strong" },
        }),
      ]),
    ],
  ])("is unknown for %s, never guessed from the T3 id", (_name, value) => {
    const result = piSessionIdOf(value);
    expect(result.state).toBe("unknown");
    expect(result.state === "unknown" && result.reason.length > 0).toBe(true);
  });
});
