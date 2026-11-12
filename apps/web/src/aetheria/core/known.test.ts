import { describe, expect, it } from "vite-plus/test";

import { describeKnown, isKnown, known, mapKnown, unavailable, unknown } from "./known";

describe("Known<T>", () => {
  it("keeps the three states distinct", () => {
    expect(known(3)).toEqual({ state: "known", value: 3 });
    expect(unknown("no reading yet")).toEqual({ state: "unknown", reason: "no reading yet" });
    expect(unavailable("this server does not send it")).toEqual({
      state: "unavailable",
      reason: "this server does not send it",
    });
    expect(isKnown(known(false))).toBe(true);
    expect(isKnown(unknown("x"))).toBe(false);
    expect(isKnown(unavailable("x"))).toBe(false);
  });

  it("a known falsy value is still known: zero, empty and false are facts", () => {
    for (const value of [0, "", false, null]) expect(isKnown(known(value))).toBe(true);
  });

  it("mapKnown maps only a known value and keeps the other states and their reasons", () => {
    expect(mapKnown(known(2), (n) => n * 2)).toEqual(known(4));
    expect(mapKnown(unknown<number>("r"), (n) => n * 2)).toEqual(unknown("r"));
    expect(mapKnown(unavailable<number>("r"), (n) => n * 2)).toEqual(unavailable("r"));
  });

  it("describeKnown never turns an unknown or unavailable fact into zero, idle or empty text", () => {
    const format = (n: number) => String(n);
    expect(describeKnown(known(0), format)).toBe("0");
    const hidden = describeKnown(unknown<number>("not read"), format);
    const missing = describeKnown(unavailable<number>("not sent"), format);
    for (const text of [hidden, missing]) {
      expect(text).not.toBe("0");
      expect(text).not.toBe("");
      expect(text.toLowerCase()).not.toContain("idle");
    }
    expect(hidden).toContain("not read");
    expect(missing).toContain("not sent");
  });
});
