// The usage contract value as the panel reads it (M10 Plan step 18). Boundary: `usageFromContract` and the panel's own strict `parseUsage` over it; no DOM, no transport.
import { describe, expect, it } from "vite-plus/test";

import { usageFromContract } from "./adapt";
import { parseUsage } from "./model";

const STATE = {
  state: "available",
  reasonClass: "signed-in-window-ok",
  observedAt: "2026-11-14T10:00:00Z",
  basis: [{ signal: "window", result: "ok", at: "2026-11-14T10:00:00Z", windowId: "5h" }],
};
const READING = {
  provider: "anthropic",
  observedAt: "2026-11-14T10:00:00Z",
  fetchedAt: "2026-11-14T10:00:00Z",
  status: "ok",
  stale: false,
  lastGoodAt: "2026-11-14T10:00:00Z",
  windows: [{ id: "5h", usedPercent: 12 }],
};
const MAIN = { threadId: "root", route: { status: "not-supplied" } };
const contract = (over: Record<string, unknown> = {}) => ({
  rootThreadId: "root",
  usage: { status: "read", readings: [READING] },
  main: MAIN,
  children: {
    status: "listed",
    rows: [
      {
        childThreadId: "kid-1",
        route: { status: "known", index: 1, provider: "anthropic", model: "opus" },
        availability: { status: "read", state: STATE },
      },
    ],
  },
  ...over,
});

describe("the usage contract value as the panel's routes and readings", () => {
  it("a read answer becomes the routes (a known route with a read state, named by its child) and the readings, with no note", () => {
    const parsed = parseUsage(usageFromContract(contract()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.routes).toHaveLength(1);
    expect(parsed.value.routes[0]).toMatchObject({
      route: { provider: "anthropic", model: "opus" },
      childLabel: "kid-1",
      state: { state: "available" },
    });
    expect(parsed.value.readings.map((r) => r.provider)).toEqual(["anthropic"]);
    expect(parsed.value.notes).toBeUndefined();
  });

  it("a usage section that could not be read is a note in the Backend's words, never an empty list of readings", () => {
    const parsed = parseUsage(
      usageFromContract(
        contract({ usage: { status: "unavailable", detail: "the usage reader is down" } }),
      ),
    );
    expect(parsed.ok && parsed.value.readings).toEqual([]);
    expect(parsed.ok && parsed.value.notes?.readings).toBe("the usage reader is down");
  });

  it("a children section that could not be read is a note, not a list with no routes", () => {
    const parsed = parseUsage(
      usageFromContract(
        contract({ children: { status: "unavailable", detail: "children are not listed" } }),
      ),
    );
    expect(parsed.ok && parsed.value.routes).toEqual([]);
    expect(parsed.ok && parsed.value.notes?.routes).toBe("children are not listed");
  });

  it("a child with no route, an unknown route or an availability that could not be read is named in a note, and has no route row", () => {
    const parsed = parseUsage(
      usageFromContract(
        contract({
          children: {
            status: "listed",
            rows: [
              { childThreadId: "kid-a", route: { status: "none" } },
              { childThreadId: "kid-b", route: { status: "unknown", detail: "index unreadable" } },
              {
                childThreadId: "kid-c",
                route: { status: "known", index: 1, provider: "openai", model: "gpt" },
                availability: { status: "unavailable", detail: "memory unreadable" },
              },
            ],
          },
        }),
      ),
    );
    expect(parsed.ok && parsed.value.routes).toEqual([]);
    const lines = parsed.ok ? (parsed.value.notes?.children ?? []) : [];
    expect(lines).toHaveLength(3);
    expect(lines.join(" ")).toContain("kid-a");
    expect(lines.join(" ")).toContain("index unreadable");
    expect(lines.join(" ")).toContain("memory unreadable");
  });

  it("a value that is not the contract's shape is left alone, so the strict parse refuses it", () => {
    expect(usageFromContract("nonsense")).toBe("nonsense");
    const odd = contract({ usage: { status: "weird" } });
    expect(usageFromContract(odd)).toBe(odd);
    expect(parseUsage(usageFromContract(odd)).ok).toBe(false);
    const oddChild = contract({
      children: { status: "listed", rows: [{ childThreadId: "k", route: { status: "?" } }] },
    });
    expect(parseUsage(usageFromContract(oddChild)).ok).toBe(false);
  });

  it("the panel's own old shape is not touched", () => {
    const old = { routes: [], readings: [] };
    expect(usageFromContract(old)).toBe(old);
  });
});
