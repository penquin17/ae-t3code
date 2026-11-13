import { describe, expect, it } from "vite-plus/test";

import { piSessionIdOf, type ThreadBindingInput } from "./binding";

const provider = (over: Record<string, unknown> = {}) => ({
  id: "pt-1",
  driver: "pi",
  nativeThreadRef: { driver: "pi", nativeId: "pi-session-77", strength: "strong" },
  ...over,
});
const input = (
  providerThreads: readonly object[],
  activeProviderThreadId: string | null = "pt-1",
): ThreadBindingInput =>
  ({ thread: { activeProviderThreadId }, providerThreads }) as unknown as ThreadBindingInput;

describe("a T3 thread's Pi session id is known only from a strong native reference", () => {
  it("is the strong Pi native id of the active provider thread", () => {
    expect(piSessionIdOf(input([provider()]))).toEqual({
      state: "known",
      value: "pi-session-77",
    });
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
