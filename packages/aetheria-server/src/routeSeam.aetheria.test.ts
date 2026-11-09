// AETHERIA M09 Plan step 11 (C3, D6) — the policy half of T3's selection seam, over the real installed `@aetheria/providers` archive.
//
// Boundary: this module's `createPiSelectionSeam` and the slot functions, with the archive's real `effectiveRoute` and default table behind them and
// scripted capability answers. It shows what the seam decides for a model selection (route, effort, source, validation) and refuses before any
// command exists. It does NOT show what T3's Pi adapter sends (the provider-pi and apps/server tests do), or real catalog contents.
import { describe, expect, it } from "vite-plus/test";

import {
  PI_SELECTION_SEAM_SLOT,
  createPiSelectionSeam,
  installPiSelectionSeam,
  type PiSelectionSeam,
} from "./routeSeam.ts";
import type { RouteCapabilities } from "./library.ts";

const FABLE = { provider: "anthropic", model: "claude-fable-5-1" };
const LUNA = { provider: "openai-codex", model: "gpt-6-luna" };

const known = (
  route: { provider: string; model: string },
  supported: readonly string[],
): RouteCapabilities => ({
  route,
  observedAt: "2026-11-09T10:00:00.000Z",
  images: "unknown",
  efforts: { state: "known", supported, default: null },
  source: "catalog",
});
const unknown = (route: { provider: string; model: string }): RouteCapabilities => ({
  route,
  observedAt: "2026-11-09T10:00:00.000Z",
  images: "unknown",
  efforts: { state: "unknown" },
  source: "none",
});

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

describe("the Pi selection seam resolves the route and effort once", () => {
  it("keeps an explicit effort and labels it explicit and supported", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => known(route, LEVELS) });
    expect(seam.resolve({ ...FABLE, effort: "low", child: false })).toEqual({
      outcome: "resolved",
      provider: "anthropic",
      model: "claude-fable-5-1",
      effort: "low",
      source: "explicit",
      effortSource: "explicit",
      validation: "supported",
    });
  });

  it("gives a chat the chat default and a child the child default, from the table", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => known(route, LEVELS) });
    expect(seam.resolve({ ...FABLE, child: false })).toMatchObject({
      outcome: "resolved",
      effort: "high",
      effortSource: "aetheria-default",
      validation: "supported",
    });
    expect(seam.resolve({ ...FABLE, child: true })).toMatchObject({
      outcome: "resolved",
      effort: "medium",
      effortSource: "aetheria-default",
    });
  });

  it("gives a model the table does not manage no effort, and sends nothing for it", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => known(route, LEVELS) });
    expect(seam.resolve({ provider: "xai", model: "grok-4.6", child: false })).toMatchObject({
      outcome: "resolved",
      effort: null,
      validation: "no-effort",
    });
  });

  it("refuses a default effort the model is known not to support, and names the layer", () => {
    const seam = createPiSelectionSeam({
      capabilities: (route) => known(route, ["off", "low", "medium"]),
    });
    expect(seam.resolve({ ...LUNA, child: false })).toMatchObject({
      outcome: "refused",
      code: "effort-unsupported",
    });
    const refused = seam.resolve({ ...LUNA, child: false });
    expect(refused.outcome === "refused" && refused.message).toContain("chat default high");
  });

  it("refuses an explicit effort the model is known not to support rather than clamp it", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => known(route, ["off", "low"]) });
    expect(seam.resolve({ ...FABLE, effort: "max", child: false })).toMatchObject({
      outcome: "refused",
      code: "effort-unsupported",
    });
  });

  it("refuses a default effort whose capability is unknown, before any command", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => unknown(route) });
    const refused = seam.resolve({ ...FABLE, child: false });
    expect(refused).toMatchObject({ outcome: "refused", code: "default-effort-unverifiable" });
    expect(refused.outcome === "refused" && refused.message).toContain("high");
  });

  it("sends an explicit effort whose capability is unknown, labelled unknown-capability", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => unknown(route) });
    expect(seam.resolve({ ...FABLE, effort: "xhigh", child: false })).toMatchObject({
      outcome: "resolved",
      effort: "xhigh",
      effortSource: "explicit",
      validation: "unknown-capability",
    });
  });

  it("treats a capability lookup that throws as unknown, never as supported", () => {
    const seam = createPiSelectionSeam({
      capabilities: () => {
        throw new Error("providers service is not running");
      },
    });
    expect(seam.resolve({ ...FABLE, child: false })).toMatchObject({
      outcome: "refused",
      code: "default-effort-unverifiable",
    });
    expect(seam.resolve({ ...FABLE, effort: "low", child: false })).toMatchObject({
      outcome: "resolved",
      validation: "unknown-capability",
    });
  });

  it("refuses a request it cannot read with a code, and never throws", () => {
    const seam = createPiSelectionSeam({ capabilities: (route) => known(route, LEVELS) });
    expect(seam.resolve({ ...FABLE, effort: "turbo", child: false })).toMatchObject({
      outcome: "refused",
      code: "invalid-request",
    });
  });
});

describe("the process slot the Pi adapter reads", () => {
  const slot = (): unknown => (globalThis as Record<symbol, unknown>)[PI_SELECTION_SEAM_SLOT];
  const seamOf = (): PiSelectionSeam =>
    createPiSelectionSeam({ capabilities: (route) => known(route, LEVELS) });

  it("is empty until a seam is installed and empty again after its release", () => {
    expect(slot()).toBeUndefined();
    const seam = seamOf();
    const release = installPiSelectionSeam(seam);
    expect(slot()).toBe(seam);
    release();
    expect(slot()).toBeUndefined();
  });

  it("refuses a second install instead of overwriting, and the first release still empties the slot", () => {
    const first = seamOf();
    const releaseFirst = installPiSelectionSeam(first);
    expect(() => installPiSelectionSeam(seamOf())).toThrow(/already filled/);
    expect(slot()).toBe(first);
    releaseFirst();
    expect(slot()).toBeUndefined();
    releaseFirst();
    expect(slot()).toBeUndefined();
  });
});
