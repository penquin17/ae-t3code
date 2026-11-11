import type { MappedPair } from "./mapping.ts";
import { t3Resolved } from "./generated/resolved.ts";

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Reads #RRGGBB or #RRGGBBAA; alpha is 0 to 1. */
export function parseColor(value: string): Rgba {
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(value);
  if (!match) throw new Error(`not a #RRGGBB or #RRGGBBAA colour: ${value}`);
  const rgb = match[1]!;
  return {
    r: Number.parseInt(rgb.slice(0, 2), 16),
    g: Number.parseInt(rgb.slice(2, 4), 16),
    b: Number.parseInt(rgb.slice(4, 6), 16),
    a: match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255,
  };
}

/** The colour that results from painting `top` over an opaque `bottom`. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio of two opaque colours given as hex strings. */
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(parseColor(foreground)), luminance(parseColor(background))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The ratio of a mapped pair in one mode, with translucent colours resolved over their surface. */
export function pairRatio(pair: MappedPair, mode: "light" | "dark"): number {
  const valueOf = (variable: string) => {
    const resolved = t3Resolved[variable];
    if (resolved === undefined) throw new Error(`${variable} is not mapped`);
    return parseColor(resolved[mode]);
  };
  const surface = valueOf(pair.over ?? "--background");
  const background = compositeOver(
    valueOf(pair.background),
    compositeOver(surface, { r: 255, g: 255, b: 255, a: 1 }),
  );
  const foreground = compositeOver(valueOf(pair.foreground), background);
  return (
    (Math.max(luminance(foreground), luminance(background)) + 0.05) /
    (Math.min(luminance(foreground), luminance(background)) + 0.05)
  );
}
