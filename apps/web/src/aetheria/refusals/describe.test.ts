// How a refusal code becomes words (D14). Boundary: the pure functions `describeRefusal` and `classOf` over the shipped display table; no DOM, no backend.
import { describe, expect, it } from "vite-plus/test";

import { CANONICAL_CODES, NON_CODE_REFUSAL_IDS } from "./canonical";
import { classOf, describeRefusal } from "./describe";

const NOTHING_CHANGED_EN = /nothing was changed/i;

describe("a known code reads as its display line", () => {
  it("gives the English line and keeps the Backend's message verbatim beside it", () => {
    const message = 'The file changed since this session read it; read "a/b.ts" again.';
    const shown = describeRefusal("T1_STALE", message, "en");
    expect(shown.known).toBe(true);
    expect(shown.text).not.toBe(message);
    expect(shown.text.length).toBeGreaterThan(0);
    expect(shown.backendMessage).toBe(message);
  });

  it("gives a Chinese line with Chinese characters for the same code", () => {
    const shown = describeRefusal("T1_STALE", undefined, "zh");
    expect(shown.known).toBe(true);
    expect(shown.text).toMatch(/[\u4e00-\u9fff]/);
    expect(shown.text).not.toBe(describeRefusal("T1_STALE", undefined, "en").text);
  });

  it("defaults to English", () => {
    expect(describeRefusal("T1_STALE").text).toBe(
      describeRefusal("T1_STALE", undefined, "en").text,
    );
  });
});

describe("an unknown code is never hidden", () => {
  it("shows the Backend's text, else the code itself, and says it is not a known code", () => {
    expect(describeRefusal("SOMETHING_NEW", "A new refusal text.")).toEqual({
      text: "A new refusal text.",
      known: false,
      backendMessage: "A new refusal text.",
    });
    const bare = describeRefusal("SOMETHING_NEW");
    expect(bare.text).toBe("SOMETHING_NEW");
    expect(bare.known).toBe(false);
    expect(bare.backendMessage).toBeUndefined();
  });

  it("never returns an empty text, even for an empty code and message", () => {
    expect(describeRefusal("", "").text.length).toBeGreaterThan(0);
    expect(describeRefusal("", undefined).text.length).toBeGreaterThan(0);
  });

  it("does not treat object-prototype names as known codes", () => {
    for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(describeRefusal(code).known).toBe(false);
      expect(classOf(code)).toBeUndefined();
    }
  });
});

describe("'nothing was changed' is said only where the supplied class warrants it", () => {
  // applied-with-warning and every interaction, children and passthrough class: the supplied class does not promise that nothing changed.
  const noPromise = CANONICAL_CODES.filter(
    (c) => c.class !== "refused-unchanged" && c.class !== "failed-unchanged",
  );
  it("has codes whose class makes no promise (so the loop below is not empty)", () => {
    expect(noPromise.length).toBeGreaterThan(20);
  });
  it.each(noPromise.map((c) => [c.code, c.class] as const))(
    "%s (%s) does not claim nothing changed, in English",
    (code) => {
      expect(describeRefusal(code, undefined, "en").text).not.toMatch(NOTHING_CHANGED_EN);
    },
  );

  it("words an applied-with-warning code as done with a warning, never as unchanged", () => {
    for (const code of ["T1_OBSERVATION_DROPPED", "COORDINATION_UNAVAILABLE"]) {
      const text = describeRefusal(code).text;
      expect(classOf(code)).toBe("applied-with-warning");
      expect(text).not.toMatch(NOTHING_CHANGED_EN);
      expect(text).toMatch(/applied|done|succeeded|went through/i);
    }
  });

  it("says nothing was changed for a refused-unchanged code whose Backend text says so", () => {
    expect(describeRefusal("READINESS_CHANGED").text).toMatch(NOTHING_CHANGED_EN);
  });

  it("does not claim 'nothing changed' for a code whose write may have landed", () => {
    for (const code of [
      "INTERACTION_UNAVAILABLE",
      "INTERACTION_DELIVERY_FAILED",
      "CHILDREN_OUTCOME_UNKNOWN",
    ]) {
      expect(describeRefusal(code).text).not.toMatch(NOTHING_CHANGED_EN);
    }
  });

  it("states that it is not known whether the decision applied for an unavailable interaction", () => {
    expect(describeRefusal("INTERACTION_UNAVAILABLE").text).toMatch(/not known|may or may not/i);
    expect(describeRefusal("CHILDREN_OUTCOME_UNKNOWN").text).toMatch(/not known|may or may not/i);
  });
});

describe("the revoked-session wording", () => {
  it("says the device's access ended, not that the account is gone", () => {
    for (const locale of ["en", "zh"] as const) {
      const text = describeRefusal("CHILDREN_DEVICE_REVOKED", undefined, locale).text;
      expect(text).not.toMatch(/delet|account.*(removed|gone)|删除|账号已/i);
    }
    expect(describeRefusal("CHILDREN_DEVICE_REVOKED").text).toMatch(/revoked|expired|ended/i);
  });
});

describe("classOf", () => {
  it("answers each canonical code's class and nothing for a stranger", () => {
    for (const { code, class: outcomeClass } of CANONICAL_CODES) {
      expect(classOf(code)).toBe(outcomeClass);
    }
    expect(classOf("SOMETHING_NEW")).toBeUndefined();
  });

  it("knows the code-less T3 decline by its id", () => {
    for (const id of NON_CODE_REFUSAL_IDS) {
      expect(describeRefusal(id).known).toBe(true);
    }
  });
});
