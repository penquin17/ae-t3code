// The rules the quality matrix applies to each rendered state (M10 Plan step 26). Each returns the findings it made as readable sentences, so a failure names the control, the text or the element at fault
// and the matrix index can carry them. Browser-only: they read what the page painted. `harness.tsx` holds the app-mounting helpers; it installs a fake environment when imported, so the three small helpers
// this file needs from it (accessible name, reachable controls, reduced-motion emulation) are kept here rather than pulled in with it.
import { cdp, userEvent } from "vite-plus/test/browser";

import { sampleText, summarize } from "../measure";

/** WCAG 2.2 target size (minimum), and the phone minimum the accepted tokens set (`--ae-size-touch-min`). */
const TARGET_MIN_PX = 24;
const PHONE_TOUCH_PX = 44;
const TEXT_CONTRAST_MIN = 4.5;
const PHONE_MAX_WIDTH = 767;

export interface Report {
  readonly findings: string[];
  readonly advisories: string[];
}

const short = (element: Element) => {
  const slot = element.getAttribute("data-slot");
  const label = element.getAttribute("aria-label");
  const text = (element.textContent ?? "").trim().slice(0, 24);
  return `${element.tagName.toLowerCase()}${slot ? `[${slot}]` : ""}${label ? ` "${label}"` : text ? ` "${text}"` : ""}`;
};

/** Emulates the browser's reduced-motion preference (or removes the emulation). */
export async function setReducedMotion(reduce: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
  });
}

/** A control's accessible name: its label, labelled-by text, own text, image alt, a wrapping or pointing `<label>`, or its title. */
function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  const text = (element.textContent ?? "").trim();
  if (text) return text;
  const alt = element.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt")?.trim();
  if (alt) return alt;
  const id = element.getAttribute("id");
  const wrapping = element.closest("label")?.textContent?.trim();
  const pointing = id
    ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim()
    : undefined;
  return wrapping || pointing || element.getAttribute("title")?.trim() || "";
}

const CONTROLS =
  "button, a[href], [role='button'], [role='checkbox'], [role='switch'], [role='tab'], input:not([type='hidden']), select, textarea, summary";

/** The controls a person or a screen reader can reach inside `root`: laid out, not aria-hidden, not `display: none`. */
function controlsIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (element) =>
      element.getBoundingClientRect().width > 0 &&
      element.closest("[aria-hidden='true']") === null &&
      getComputedStyle(element).visibility !== "hidden",
  );
}

/** Content that makes the page scroll sideways: the document wider than the viewport, the root wider than its box, or a visible element that reaches past the viewport's right edge. */
export function overflowFindings(width: number, root: Element): string[] {
  const found: string[] = [];
  const page = document.documentElement;
  if (page.scrollWidth > width)
    found.push(`document is ${page.scrollWidth} px wide in a ${width} px viewport`);
  if (root.scrollWidth > root.clientWidth + 1)
    found.push(`${short(root)} scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`);
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.right <= width + 1) continue;
    const style = getComputedStyle(element);
    if (style.position === "fixed" || style.visibility === "hidden") continue;
    // A box inside a clipping or scrolling ancestor is contained there, not on the page.
    let contained = false;
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow !== "visible") {
        contained = true;
        break;
      }
    }
    if (!contained && found.length < 8)
      found.push(
        `${short(element)} ends at ${Math.round(box.right)} px, past the ${width} px viewport`,
      );
  }
  return found;
}

/**
 * Boxes inside `root` that scroll sideways on their own. A frame the page marks with `data-quality-frame` is a finding (its content must fit); any other, such as a code block that scrolls its
 * own long line, is an advisory.
 */
export function sidewaysScrollers(root: Element): Report {
  const findings: string[] = [];
  const advisories: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const overflow = getComputedStyle(element).overflowX;
    if (
      (overflow !== "auto" && overflow !== "scroll") ||
      element.scrollWidth <= element.clientWidth + 1
    )
      continue;
    const line = `${short(element)} scrolls sideways (${element.scrollWidth} > ${element.clientWidth})`;
    (element.hasAttribute("data-quality-frame") ? findings : advisories).push(line);
  }
  return { findings, advisories };
}

/** A control inside an Aetheria root (`data-aetheria`) is Aetheria's own; any other is T3's. */
const isAetheriaOwned = (control: Element) => control.closest("[data-aetheria]") !== null;

/**
 * Every control named, and at least 24 px each way. At phone widths (767 px and below) an Aetheria-owned control under 44 px (the accepted token `--ae-size-touch-min`) is a finding; a T3-owned one
 * under 44 px stays an advisory, listed separately.
 */
export function controlReport(root: ParentNode, width: number): Report {
  const findings: string[] = [];
  const advisories: string[] = [];
  for (const control of controlsIn(root)) {
    const own = control.getBoundingClientRect();
    // A visually hidden native input (a 1 px clip) is operated through its visible label, which is the target.
    if (own.width <= 1 && own.height <= 1) continue;
    // A radio or checkbox inside (or pointed at by) a visible `<label>` is operated by the whole label: that box is the target.
    const id = control.getAttribute("id");
    const label =
      control.tagName === "INPUT"
        ? (control.closest("label") ?? (id ? document.querySelector(`label[for="${id}"]`) : null))
        : null;
    const box =
      label && label.getBoundingClientRect().width > 0 ? label.getBoundingClientRect() : own;
    if (accessibleName(control) === "")
      findings.push(`no accessible name: ${control.outerHTML.slice(0, 90)}`);
    const inlineLink = control.tagName === "A" && getComputedStyle(control).display === "inline";
    const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
    if (!inlineLink && (box.width < TARGET_MIN_PX || box.height < TARGET_MIN_PX))
      findings.push(`${short(control)} is ${size} px, under ${TARGET_MIN_PX}`);
    else if (
      !inlineLink &&
      width <= PHONE_MAX_WIDTH &&
      (box.width < PHONE_TOUCH_PX || box.height < PHONE_TOUCH_PX)
    ) {
      const line = `${short(control)} is ${size} px, under the ${PHONE_TOUCH_PX} px phone target`;
      (isAetheriaOwned(control) ? findings : advisories).push(line);
    }
  }
  return { findings, advisories };
}

/** Enabled text under `root` at 4.5:1 or more against what is painted behind it. Text over an image or gradient cannot be measured exactly: it is an advisory when it fails. */
export function contrastReport(root: Element): Report {
  const findings: string[] = [];
  const advisories: string[] = [];
  for (const sample of summarize(sampleText(root))) {
    if (sample.ratio >= TEXT_CONTRAST_MIN) continue;
    const line = `"${sample.text}" ${sample.ratio.toFixed(2)}:1 (${sample.foreground} on ${sample.background}, ${sample.where}, ${sample.count} text${sample.count === 1 ? "" : "s"})`;
    // Pages sit on a faint grain image (`surface-grain`); the measure uses the base colour under it, which the grain changes by a hair, so a miss is still a finding.
    findings.push(
      sample.unresolvedBackground
        ? `${line} (measured on the base colour under a background image)`
        : line,
    );
  }
  return { findings, advisories };
}

/** Whether `element` (or a wrapper that has focus within, up to three levels up) paints an outline or a ring while focused. */
function hasIndicator(element: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  for (let level = 0; node && level < 4; level += 1, node = node.parentElement) {
    if (level > 0 && !node.matches(":focus-within")) break;
    const style = getComputedStyle(node);
    if (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) return true;
    if (style.boxShadow !== "none") return true;
  }
  return false;
}

/** Tab through up to `max` controls from the start of the page: each must take focus the keyboard way and show an indicator. */
export async function focusFindings(root: Element, max = 12): Promise<string[]> {
  const found: string[] = [];
  const enabled = controlsIn(root).filter((c) => !(c as HTMLButtonElement).disabled);
  // A roving group keeps all but one member out of the Tab order; a page whose controls are all out of it cannot be used from the keyboard.
  const controls = enabled.filter((c) => c.tabIndex >= 0);
  if (enabled.length === 0) return found;
  if (controls.length === 0)
    return [`Tab reached none of the ${enabled.length} controls (all have tabindex -1)`];
  (document.activeElement as HTMLElement | null)?.blur();
  const reached = new Set<Element>();
  for (let press = 0; press < Math.min(controls.length, max); press += 1) {
    await userEvent.keyboard("{Tab}");
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) break;
    reached.add(active);
    if (!active.matches(":focus-visible"))
      found.push(`${short(active)} took focus without :focus-visible`);
    else if (!hasIndicator(active))
      found.push(`${short(active)}: no visible focus indicator (no outline or ring)`);
  }
  if (reached.size === 0) found.push(`Tab reached none of the ${controls.length} controls`);
  return found;
}

/** Reduced motion honoured: the emulated preference and the motion tokens agree with `reduce`, and under `reduce` nothing inside `root` is still animating. */
export function motionFindings(root: Element, reduce: boolean): string[] {
  const found: string[] = [];
  const matches = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (matches !== reduce)
    found.push(
      `emulation: prefers-reduced-motion is ${matches ? "reduce" : "no-preference"}, wanted ${reduce ? "reduce" : "no-preference"}`,
    );
  const fast = getComputedStyle(document.documentElement)
    .getPropertyValue("--ae-motion-fast")
    .trim();
  const wanted = reduce ? "0ms" : "120ms";
  if (fast !== wanted) found.push(`--ae-motion-fast is "${fast}", wanted "${wanted}"`);
  if (reduce) {
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (
        animation.playState !== "running" ||
        !(target instanceof Element) ||
        !root.contains(target)
      )
        continue;
      const timing = animation.effect?.getComputedTiming();
      if ((timing?.duration ?? 0) === 0) continue;
      found.push(`animation still running under reduced motion on ${short(target)}`);
    }
  }
  return found;
}
