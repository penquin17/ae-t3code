// The quality matrix's plan and its index (M10 Plan step 26). One list of the states that matter, one rule for which combinations get an image, one name for each image, and the index that lists
// every combination with what the checks found. Pure: no DOM, so the index can be validated without a browser.
import { MATRIX_MODES, MATRIX_WIDTHS } from "../matrix";

export const QUALITY_WIDTHS = MATRIX_WIDTHS;
export const QUALITY_THEMES = MATRIX_MODES;
/** `reduce` is the emulated reduced-motion preference; `motion` is no preference. */
export const QUALITY_MOTIONS = ["reduce", "motion"] as const;

export type QualityWidth = (typeof QUALITY_WIDTHS)[number];
export type QualityTheme = (typeof QUALITY_THEMES)[number];
export type QualityMotion = (typeof QUALITY_MOTIONS)[number];
export type QualityView = "sessions" | "control" | "deliverables" | "status";

export interface QualityState {
  readonly view: QualityView;
  readonly state: string;
  /** What the state shows, in words a reviewer can check the image against. */
  readonly covers: string;
}

export const QUALITY_STATES: readonly QualityState[] = [
  {
    view: "sessions",
    state: "groups",
    covers:
      "the sessions sidebar: a named saved group, a dismissable suggestion, a pinned row, a running row, an unread row, a row waiting for a request, and a snoozed row",
  },
  {
    view: "control",
    state: "full",
    covers:
      "the control page with every card live: a question, a plan review and an authorization request, plan mode, tasks, children (running, idle, unknown), jobs and outbox, usage, and the goals statement",
  },
  {
    view: "control",
    state: "degraded",
    covers:
      "the control page when little is known: a reconnecting banner, answered and cancelled requests, stale plan mode and tasks, children unavailable, jobs and usage not connected",
  },
  {
    view: "deliverables",
    state: "cards",
    covers:
      "the deliverables page: cards (kept copy, unavailable copy, superseded, Office), a markdown preview open, and the edited-files list with its per-session label",
  },
  {
    view: "deliverables",
    state: "unavailable",
    covers:
      "the deliverables page when the device was revoked: an access-ended banner, the cards read refused, and the edited files unknown",
  },
  {
    view: "status",
    state: "banners-and-running",
    covers:
      "the connection banners (reconnecting, disconnected, unauthorized, access ended, version mismatch, unknown) and the running indicator in each of its phases and states",
  },
];

/** Motion-on images are kept only at these widths; the checks run at every width in both settings. */
export const MOTION_PNG_WIDTHS: readonly number[] = [1280, 390];

export const DROPPED: readonly { readonly what: string; readonly why: string }[] = [
  {
    what: "motion-on images at 1023, 980, 768, 767 and 640",
    why: "reduced motion changes timing, not layout; the same combinations are still checked in both settings, and the images at the widest and the phone width show both settings",
  },
  {
    what: "the real shell's phone sheet and the brand chrome",
    why: "matrix.browser.test.tsx already captures them at every width, and this matrix renders the sidebar's own list so its groups are visible",
  },
  {
    what: "single control-card states (identity unknown, delivery failed, stale revision, refusals, replay) and the HTML, PDF, image and media previews",
    why: "each has its own browser test and capture at 1280 and 390; the two control states here join them on one page instead of repeating each",
  },
  {
    what: "the Chinese banner text",
    why: "connection/ConnectionBanner.browser.test.tsx captures it; the layout rules checked here do not depend on the language",
  },
  {
    what: "3:1 contrast of meaningful non-text (borders, icons, focus rings) in this matrix",
    why: "a11y.browser.test.tsx measures the focus ring and field outline against the paint behind them; this matrix checks text at 4.5:1 and that a focus indicator is present",
  },
];

/**
 * A defect the matrix found in a product file and reported. M10's step 26 changes no product, so the finding is set aside here, named in the index, and kept in view: the matrix test fails when a
 * listed defect no longer occurs (the fix landed, so delete the entry) and when a finding matches no entry (a new defect).
 */
export interface KnownDefect {
  readonly id: string;
  readonly view: QualityView;
  readonly state: string;
  readonly finding: RegExp;
  readonly file: string;
  readonly fix: string;
}

/** How the matrix treats a control's size at phone widths; the index states it so a reader knows which advisories are left and why. */
const TOUCH_RULE: readonly string[] = [
  "At 767 px and below an Aetheria-owned control (inside an element marked `data-aetheria`) smaller than `--ae-size-touch-min` (44 px) either way is a finding; the matrix fails on it.",
  "At 767 px and below a T3-owned control smaller than 44 px is an advisory, listed in the advisories column; Aetheria does not change T3's components.",
  "At 768 px and above no control is held to 44 px; every control must still be named and at least 24 px each way.",
];

/** Empty now: the step-26 finding (the "Code:" line's contrast in the warning alerts) is fixed. A new entry goes here only for a defect found and not yet fixed. */
export const KNOWN_DEFECTS: readonly KnownDefect[] = [];

/** The findings with the known defects taken out: `known` lists the ids set aside, `findings` what is left. */
export function splitFindings(
  view: QualityView,
  state: string,
  found: readonly string[],
  defects: readonly KnownDefect[] = KNOWN_DEFECTS,
): { readonly findings: string[]; readonly known: string[] } {
  const findings: string[] = [];
  const known = new Set<string>();
  for (const line of found) {
    const defect = defects.find(
      (d) => d.view === view && d.state === state && d.finding.test(line),
    );
    if (defect) known.add(defect.id);
    else findings.push(line);
  }
  return { findings, known: [...known] };
}

export interface Combo {
  readonly view: QualityView;
  readonly state: string;
  readonly width: number;
  readonly theme: QualityTheme;
  readonly motion: QualityMotion;
}

export interface IndexEntry extends Combo {
  /** The image file name, or null when this combination is checked but its image is not kept. */
  readonly file: string | null;
  /** Failures of a rule; empty when every check passed. */
  readonly findings: readonly string[];
  /** Things worth a person's eye that the rule does not fail (for example a T3-owned phone control under 44 px). */
  readonly advisories: readonly string[];
  /** Ids of known defects (KNOWN_DEFECTS) this combination hit; they are not in `findings`. */
  readonly known: readonly string[];
}

export function expectedCombos(): Combo[] {
  return QUALITY_STATES.flatMap((state) =>
    QUALITY_WIDTHS.flatMap((width) =>
      QUALITY_THEMES.flatMap((theme) =>
        QUALITY_MOTIONS.map((motion) => ({
          view: state.view,
          state: state.state,
          width,
          theme,
          motion,
        })),
      ),
    ),
  );
}

export const shouldCapture = (motion: QualityMotion, width: number): boolean =>
  motion === "reduce" || MOTION_PNG_WIDTHS.includes(width);

export const captureFile = (combo: Combo): string =>
  `quality-${combo.view}-${combo.state}-${combo.width}-${combo.theme}-${combo.motion}.png`;

const keyOf = (c: Combo) => `${c.view}/${c.state}/${c.width}/${c.theme}/${c.motion}`;

export interface IndexFault {
  readonly code:
    | "missing-entry"
    | "duplicate-entry"
    | "unknown-entry"
    | "file-missing"
    | "file-not-due"
    | "file-name";
  readonly key: string;
}

/** Faults in a finished index against the plan; an empty list means every combination is listed once and every due image has its planned file. */
export function validateIndex(entries: readonly IndexEntry[]): IndexFault[] {
  const faults: IndexFault[] = [];
  const wanted = new Map(expectedCombos().map((c) => [keyOf(c), c]));
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!wanted.has(key)) {
      faults.push({ code: "unknown-entry", key });
      continue;
    }
    if (seen.has(key)) {
      faults.push({ code: "duplicate-entry", key });
      continue;
    }
    seen.add(key);
    const due = shouldCapture(entry.motion, entry.width);
    if (due && entry.file === null) faults.push({ code: "file-missing", key });
    else if (!due && entry.file !== null) faults.push({ code: "file-not-due", key });
    else if (due && entry.file !== captureFile(entry)) faults.push({ code: "file-name", key });
  }
  for (const key of wanted.keys()) if (!seen.has(key)) faults.push({ code: "missing-entry", key });
  return faults;
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The index as a markdown table, with the counts and the dropped items above it. */
export function indexMarkdown(entries: readonly IndexEntry[]): string {
  const images = entries.filter((e) => e.file !== null).length;
  const failing = entries.filter((e) => e.findings.length > 0).length;
  const knownHits = entries.filter((e) => e.known.length > 0).length;
  const lines = [
    "# Quality matrix index (M10 Plan step 26)",
    "",
    `${entries.length} combinations checked, ${images} images kept, ${failing} combinations with a finding, ${knownHits} combinations that hit a known defect.`,
    "",
    "## What fails, and what is only noted",
    "",
    ...TOUCH_RULE.map((line) => `- ${line}`),
    "",
    "## Known defects (reported; no product file was changed)",
    "",
    ...(KNOWN_DEFECTS.length === 0
      ? ["None: the one found in the first run was fixed."]
      : KNOWN_DEFECTS.map(
          (d) => `- \`${d.id}\` in ${d.view} / ${d.state}: ${d.file}. Smallest fix: ${d.fix}.`,
        )),
    "",
    "## What the states show",
    "",
    ...QUALITY_STATES.map((s) => `- **${s.view} / ${s.state}**: ${s.covers}.`),
    "",
    "## Dropped, and why",
    "",
    ...DROPPED.map((d) => `- ${d.what}: ${d.why}.`),
    "",
    "## Captures",
    "",
    "| view | state | width | theme | motion | file | findings | known defects | advisories |",
    "|---|---|---|---|---|---|---|---|---|",
    ...entries.map(
      (e) =>
        `| ${e.view} | ${e.state} | ${e.width} | ${e.theme} | ${e.motion} | ${e.file ?? "(checked, no image kept)"} | ${cell(e.findings.join("; ") || "none")} | ${cell(e.known.join("; ") || "none")} | ${cell(e.advisories.join("; ") || "none")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
