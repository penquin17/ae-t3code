// The deliverables list as the Backend says it (M10 Plan step 16, D9/D10). Boundary: the pure functions over supplied replies; no T3, no DOM, no Backend. A reply that is not a list is unknown,
// never an empty list; a refusal keeps the Backend's code and words; a stale reply lands nowhere.
import { describe, expect, it } from "vite-plus/test";

import type { SendResult } from "../core/outcome";
import {
  cardFacts,
  compareDigest,
  comparisonText,
  declaredText,
  displayOrder,
  humanSize,
  listViewFromSend,
  semanticsOffered,
} from "./model";
import { finishRead, initialReadState, startRead } from "./readState";

const D1 = `sha256:${"a".repeat(64)}`;
const D2 = `sha256:${"b".repeat(64)}`;
const card = (overrides: Record<string, unknown> = {}) => ({
  id: `dlv_${"1".repeat(32)}`,
  threadId: "root-1",
  turnId: "run-7",
  canonicalPath: "/work/report.md",
  title: "Quarterly report",
  kind: "markdown",
  size: 2048,
  digest: D1,
  declaredAt: Date.UTC(2026, 10, 13, 9, 5),
  snapshot: { state: "attached", digest: D1, size: 2048 },
  supersededBy: null,
  ...overrides,
});
const ok = (cards: unknown[], rootThreadId = "root-1"): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: true, value: { rootThreadId, deliverables: cards } },
});
const fail = (code: string, detail?: string): SendResult<unknown> => ({
  tag: "accepted",
  value: { ok: false, code, ...(detail === undefined ? {} : { detail }) },
});

describe("listViewFromSend", () => {
  it("a list is known, and an empty list is known only when the Backend sent it empty", () => {
    const known = listViewFromSend(ok([card()]), "root-1");
    expect(known.tag).toBe("known");
    expect(known.tag === "known" && known.cards).toHaveLength(1);
    const empty = listViewFromSend(ok([]), "root-1");
    expect(empty).toEqual({ tag: "known", rootThreadId: "root-1", cards: [] });
  });

  it("a lost reply, a thrown answer and a non-list are unknown, never empty", () => {
    expect(listViewFromSend({ tag: "lost" }, "root-1").tag).toBe("unknown");
    expect(listViewFromSend({ tag: "accepted", value: { nothing: true } }, "root-1").tag).toBe(
      "unknown",
    );
    expect(listViewFromSend({ tag: "accepted", value: null }, "root-1").tag).toBe("unknown");
    expect(listViewFromSend(ok([card({ digest: "not-a-digest" })]), "root-1").tag).toBe("unknown");
  });

  it("an answer for another root is unknown for this one", () => {
    expect(listViewFromSend(ok([card()], "root-2"), "root-1").tag).toBe("unknown");
  });

  it("failure codes are unavailable with the Backend's words kept verbatim", () => {
    const view = listViewFromSend(
      fail("DELIVERABLES_STORE_UNUSABLE", "deliverables.json: bad JSON at 12"),
      "root-1",
    );
    expect(view).toMatchObject({
      tag: "unavailable",
      code: "DELIVERABLES_STORE_UNUSABLE",
      detail: "deliverables.json: bad JSON at 12",
    });
    expect(view.tag === "unavailable" && view.reason.length).toBeGreaterThan(0);
    expect(listViewFromSend(fail("DELIVERABLES_FORMAT_NEWER"), "root-1").tag).toBe("unavailable");
    expect(listViewFromSend(fail("DELIVERABLES_UNAVAILABLE"), "root-1").tag).toBe("unavailable");
  });

  it("a refusal or an absence is refused, with its code and detail", () => {
    expect(listViewFromSend(fail("DELIVERABLES_NOT_AUTHORIZED", "read-only"), "root-1")).toEqual({
      tag: "refused",
      code: "DELIVERABLES_NOT_AUTHORIZED",
      detail: "read-only",
    });
    expect(listViewFromSend(fail("DELIVERABLES_DEVICE_REVOKED"), "root-1").tag).toBe("refused");
    expect(listViewFromSend(fail("DELIVERABLES_NOT_FOUND"), "root-1").tag).toBe("refused");
  });

  it("T3's own refusal and an unavailable client keep their words", () => {
    expect(
      listViewFromSend({ tag: "refused", code: "COMMAND_FAILED", message: "no scope" }, "r"),
    ).toEqual({ tag: "refused", code: "COMMAND_FAILED", detail: "no scope" });
    expect(listViewFromSend({ tag: "unavailable", reason: "not connected" }, "r")).toMatchObject({
      tag: "unavailable",
      reason: "not connected",
    });
  });
});

describe("cardFacts", () => {
  it("shows title, kind, size, declared time, turn and the Backend path as a label", () => {
    const facts = cardFacts(card() as never, "root-1");
    expect(facts.title).toBe("Quarterly report");
    expect(facts.kindText).toBe("Markdown");
    expect(facts.sizeText).toBe("2.0 KiB");
    expect(facts.declaredText).toBe("2026-11-13 09:05 UTC");
    expect(facts.turnText).toBe("Turn run-7");
    expect(facts.pathText).toBe("/work/report.md");
    expect(facts.sessionText).toBeNull();
  });

  it("a delivery from a child session names that session", () => {
    expect(cardFacts(card({ threadId: "child-9" }) as never, "root-1").sessionText).toBe(
      "From session child-9",
    );
  });

  it("a superseded card says it was replaced by a later version", () => {
    const facts = cardFacts(card({ supersededBy: `dlv_${"2".repeat(32)}` }) as never, "root-1");
    expect(facts.supersededText).toBe("Replaced by a later version");
    expect(cardFacts(card() as never, "root-1").supersededText).toBeNull();
  });

  it("the snapshot state is kept, none (with its reason) or not settled", () => {
    const kept = cardFacts(card() as never, "root-1").snapshot;
    expect(kept.tag).toBe("kept");
    expect(kept.text).toContain("Copy kept");
    const none = cardFacts(
      card({ snapshot: { state: "unavailable", code: "SNAPSHOT_TOO_LARGE" } }) as never,
      "root-1",
    ).snapshot;
    expect(none.tag).toBe("none");
    expect(none.text).toContain("No copy kept");
    expect(none.text).toContain("SNAPSHOT_TOO_LARGE");
    const pending = cardFacts(card({ snapshot: { state: "pending" } }) as never, "root-1").snapshot;
    expect(pending.tag).toBe("pending");
    expect(pending.text).toBe("Copy not settled yet");
  });
});

describe("semantics, digests and order", () => {
  it("offers the current file always and as-delivered only when a copy is kept", () => {
    expect(semanticsOffered(card() as never)).toEqual(["current", "as-delivered"]);
    expect(semanticsOffered(card({ snapshot: { state: "pending" } }) as never)).toEqual([
      "current",
    ]);
    expect(
      semanticsOffered(card({ snapshot: { state: "unavailable", code: "unavailable" } }) as never),
    ).toEqual(["current"]);
  });

  it("compares the reported digest with the declared one and says what it found", () => {
    expect(compareDigest(D1, D1)).toEqual({ tag: "same" });
    expect(compareDigest(D1, D2)).toEqual({ tag: "differs", declared: D1, reported: D2 });
    expect(compareDigest(D1, null)).toEqual({ tag: "not-reported" });
    expect(comparisonText("current", compareDigest(D1, D2))).toContain("Changed since delivered");
    expect(comparisonText("current", compareDigest(D1, D1))).toContain("matches");
    expect(comparisonText("as-delivered", compareDigest(D1, D2))).toContain("does not match");
    expect(comparisonText("current", compareDigest(D1, null))).toContain("no digest");
    // The browser only compares what the Backend reports: it never says it hashed the bytes.
    expect(comparisonText("current", compareDigest(D1, D1))).toContain("not re-hashed");
  });

  it("orders newest first without changing the list it was given", () => {
    const a = card({ id: `dlv_${"a".repeat(32)}`, declaredAt: 1 });
    const b = card({ id: `dlv_${"b".repeat(32)}`, declaredAt: 2 });
    const input = [a, b] as never[];
    expect(displayOrder(input).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(input[0]).toBe(a);
  });

  it("sizes and times are plain and deterministic", () => {
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(1023)).toBe("1023 B");
    expect(humanSize(1536)).toBe("1.5 KiB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(declaredText(Date.UTC(2026, 0, 2, 3, 4))).toBe("2026-01-02 03:04 UTC");
  });
});

describe("one owner for the last read", () => {
  it("a reply for an older read or another root changes nothing", () => {
    const first = startRead(initialReadState("root-1"), "root-1");
    const second = startRead(first.state, "root-1");
    const stale = finishRead(second.state, first.ticket, "root-1", {
      tag: "unknown",
      reason: "old",
    });
    expect(stale).toBe(second.state);
    const wrongRoot = finishRead(second.state, second.ticket, "root-2", {
      tag: "unknown",
      reason: "other",
    });
    expect(wrongRoot).toBe(second.state);
    const landed = finishRead(second.state, second.ticket, "root-1", {
      tag: "unknown",
      reason: "new",
    });
    expect(landed.view).toEqual({ tag: "unknown", reason: "new" });
    expect(landed.refreshing).toBe(false);
  });

  it("another root starts from reading, the same root keeps its last answer while it refreshes", () => {
    const first = startRead(initialReadState("root-1"), "root-1");
    const landed = finishRead(first.state, first.ticket, "root-1", {
      tag: "unknown",
      reason: "kept",
    });
    const again = startRead(landed, "root-1");
    expect(again.state.view).toEqual({ tag: "unknown", reason: "kept" });
    expect(again.state.refreshing).toBe(true);
    expect(startRead(landed, "root-2").state.view).toEqual({ tag: "reading" });
  });
});
