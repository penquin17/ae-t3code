// AETHERIA M05 step 24 — a child's route converts between T3's form (`pi`, `provider/model`) and Pi's (provider, bare model id); non-Pi routes pass through.
// Boundary: the pure functions, the REAL selection seam and a fake M09. Regression of native round 2: a role child's route 1 resolves to exactly the caller's
// provider and model, so the adapter sees no moved route and sends the caller's own `set_model` slug.
// It does NOT show T3 or Pi (the provider-pi adapter test does).
import { describe, expect, it } from "vite-plus/test";

import { createPiSelectionSeam } from "./routeSeam.ts";
import type { RouteCapabilities } from "./library.ts";
import { adaptAvailability, piRouteOfT3, t3RouteOfPi } from "./routeVocabulary.ts";

const known = (route: { provider: string; model: string }): RouteCapabilities => ({
  route,
  observedAt: "2026-11-13T00:00:00.000Z",
  images: "unknown",
  efforts: {
    state: "known",
    supported: ["off", "low", "medium", "high", "xhigh", "max"],
    default: null,
  },
  source: "catalog",
});

describe("a route in T3's form and in Pi's", () => {
  it("t3RouteOfPi names the instance pi and the slug; piRouteOfT3 undoes it, effort kept", () => {
    expect(
      t3RouteOfPi({ provider: "openai-codex", model: "gpt-6-luna", effort: "medium" }),
    ).toEqual({
      provider: "pi",
      model: "openai-codex/gpt-6-luna",
      effort: "medium",
    });
    expect(t3RouteOfPi({ provider: "anthropic", model: "claude-sonnet-5-5" })).toEqual({
      provider: "pi",
      model: "anthropic/claude-sonnet-5-5",
    });
    expect(
      piRouteOfT3({ provider: "pi", model: "openai-codex/gpt-6-luna", effort: "medium" }),
    ).toEqual({
      provider: "openai-codex",
      model: "gpt-6-luna",
      effort: "medium",
    });
  });

  it("a model id that itself holds a slash stays whole after the first one", () => {
    expect(piRouteOfT3({ provider: "pi", model: "openrouter/vendor/model-x" })).toEqual({
      provider: "openrouter",
      model: "vendor/model-x",
    });
  });

  it("anything that is not T3's Pi form passes through unchanged", () => {
    for (const route of [
      { provider: "codex", model: "test-model" },
      { provider: "pi", model: "no-provider-part" },
      { provider: "pi", model: "/leading" },
      { provider: "pi", model: "trailing/" },
      { provider: "openai-codex", model: "gpt-6-luna", effort: "high" },
    ])
      expect(piRouteOfT3(route)).toEqual(route);
  });
});

describe("the availability adapter asks M09 in Pi's vocabulary", () => {
  it("converts every route of the states call and the route of the failure report, and returns M09's answers untouched", async () => {
    const seen: unknown[] = [];
    const answer = [{ state: "available" }, { state: "out" }];
    const adapted = adaptAvailability({
      routeStates: async (routes: unknown, purpose: unknown) => {
        seen.push(["routeStates", routes, purpose]);
        return answer;
      },
      reportFailure: async (route: unknown, failure: unknown) => {
        seen.push(["reportFailure", route, failure]);
        return { class: "limit", remembered: true };
      },
    } as never);
    const states = await adapted.routeStates(
      [
        { provider: "pi", model: "scripted/scripted-1" },
        { provider: "pi", model: "openai-codex/gpt-6-luna" },
      ],
      "switch",
    );
    expect(states).toBe(answer);
    expect(
      await adapted.reportFailure(
        { provider: "pi", model: "openai-codex/gpt-6-luna" },
        { message: "limit" },
      ),
    ).toEqual({
      class: "limit",
      remembered: true,
    });
    expect(seen).toEqual([
      [
        "routeStates",
        [
          { provider: "scripted", model: "scripted-1" },
          { provider: "openai-codex", model: "gpt-6-luna" },
        ],
        "switch",
      ],
      ["reportFailure", { provider: "openai-codex", model: "gpt-6-luna" }, { message: "limit" }],
    ]);
  });

  it("a throwing M09 throws through, so the reader turns it into unknown", async () => {
    const adapted = adaptAvailability({
      routeStates: async () => {
        throw new Error("providers service is not running");
      },
      reportFailure: async () => {
        throw new Error("providers service is not running");
      },
    } as never);
    await expect(
      adapted.routeStates([{ provider: "pi", model: "a/b" }], "launch"),
    ).rejects.toThrow();
    await expect(
      adapted.reportFailure({ provider: "pi", model: "a/b" }, { message: "x" }),
    ).rejects.toThrow();
  });
});

describe("a role child's route 1 is the caller's own slug (native round 2 regression)", () => {
  it("the seam resolves the stored route 1 to exactly the provider and model of the caller's slug, so nothing is moved", () => {
    const seam = createPiSelectionSeam({
      capabilities: known,
      childRoute: () => ({
        kind: "route",
        index: 1,
        route: { provider: "pi", model: "scripted/scripted-1" },
      }),
    });
    // The adapter's request for the child's first turn: the caller's slug split as the adapter splits it.
    const answer = seam.resolve({
      provider: "scripted",
      model: "scripted-1",
      child: true,
      threadId: "thread-child",
    });
    expect(answer).toMatchObject({
      outcome: "resolved",
      provider: "scripted",
      model: "scripted-1",
    });
  });

  it("route 2, stored in T3's form, resolves to the role's own provider and model and effort", () => {
    const seam = createPiSelectionSeam({
      capabilities: known,
      childRoute: () => ({
        kind: "route",
        index: 2,
        route: { provider: "pi", model: "openai-codex/gpt-6-luna", effort: "medium" },
      }),
    });
    expect(
      seam.resolve({
        provider: "scripted",
        model: "scripted-1",
        child: true,
        threadId: "thread-child",
      }),
    ).toMatchObject({
      outcome: "resolved",
      provider: "openai-codex",
      model: "gpt-6-luna",
      effort: "medium",
      effortSource: "explicit",
    });
  });
});
