// Measures what the browser actually paints: computed colours, the surface behind a piece of text, and
// WCAG contrast between them. Browser-only; used by the rendered-contrast and matrix tests.

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Any CSS colour as straight RGBA: it is painted over black and over white and the two results solved for alpha. */
export function resolveColor(css: string): Rgba {
  const sample = (underlay: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = underlay;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data;
  };
  const onBlack = sample("#000000");
  const onWhite = sample("#ffffff");
  const alpha = 1 - (onWhite[0]! - onBlack[0]!) / 255;
  if (alpha <= 0.004) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: onBlack[0]! / alpha, g: onBlack[1]! / alpha, b: onBlack[2]! / alpha, a: alpha };
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast of an opaque foreground on an opaque background. */
export function ratio(foreground: Rgba, background: Rgba): number {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hex = (color: Rgba): string =>
  `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** The painted surface behind an element: its own and its ancestors' backgrounds (and absolutely placed glass layers) composited down to the page. */
export function surfaceBehind(element: Element): {
  readonly color: Rgba;
  readonly unresolved: boolean;
} {
  let composite: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  let unresolved = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const layers: string[] = [];
    for (const pseudo of ["::after", "::before"] as const) {
      const style = getComputedStyle(node, pseudo);
      if (style.content !== "none" && style.position === "absolute")
        layers.push(style.backgroundColor);
    }
    const own = getComputedStyle(node);
    layers.push(own.backgroundColor);
    if (own.backgroundImage !== "none") unresolved = true;
    for (const css of layers) composite = over(composite, resolveColor(css));
    if (composite.a >= 0.999) return { color: composite, unresolved };
  }
  return { color: over(composite, WHITE), unresolved };
}

/** Opacity of an element as painted: its own times every ancestor's. */
function paintedOpacity(element: Element): number {
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    opacity *= Number.parseFloat(getComputedStyle(node).opacity);
  }
  return opacity;
}

export interface TextSample {
  readonly text: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly sizePx: number;
  readonly weight: number;
  readonly unresolvedBackground: boolean;
  readonly disabled: boolean;
  readonly where: string;
}

const describeElement = (element: Element): string => {
  const slot = element.getAttribute("data-slot");
  const classes =
    typeof element.className === "string"
      ? element.className.split(/\s+/).slice(0, 6).join(".")
      : "";
  return `${element.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}${classes ? `.${classes}` : ""}`;
};

/** Every visible piece of text under `root`, with the colours it is painted in and their contrast. */
export function sampleText(root: Element): TextSample[] {
  const samples: TextSample[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? "";
    const element = node.parentElement;
    if (!text || !element || /^(script|style|noscript)$/i.test(element.tagName)) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    // Visually hidden text (a 1px clipped box) is read by assistive technology, not seen.
    if (
      rect.width <= 1 ||
      rect.height <= 1 ||
      style.visibility === "hidden" ||
      style.display === "none"
    )
      continue;
    const opacity = paintedOpacity(element);
    if (opacity < 0.05) continue;
    const surface = surfaceBehind(element);
    const color = resolveColor(style.color);
    const painted = over({ ...color, a: color.a * opacity }, surface.color);
    samples.push({
      text: text.slice(0, 40),
      foreground: hex(painted),
      background: hex(surface.color),
      ratio: ratio(painted, surface.color),
      sizePx: Number.parseFloat(style.fontSize),
      weight: Number.parseInt(style.fontWeight, 10),
      unresolvedBackground: surface.unresolved,
      disabled: element.closest("[disabled], [aria-disabled='true']") !== null,
      where: describeElement(element),
    });
  }
  return samples;
}

/** Unique foreground/background pairs with the lowest ratio, one sample text each, worst first. */
export function summarize(samples: readonly TextSample[]) {
  const pairs = new Map<string, TextSample & { count: number }>();
  for (const sample of samples) {
    const key = `${sample.foreground}/${sample.background}`;
    const known = pairs.get(key);
    if (known) known.count += 1;
    else pairs.set(key, { ...sample, count: 1 });
  }
  return [...pairs.values()].sort((a, b) => a.ratio - b.ratio);
}
