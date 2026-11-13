import { useEffect, useId, useState, type CSSProperties } from "react";

import { tickTextContent } from "~/lib/tickTextContent";
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import "./running.css";
import { elapsedText, wordsOf, type Phase, type RunningShape } from "./status";
import { GRAIN_COUNT, SPARK, WREATH } from "./y4";

// The running indicator (D5): the whole brand mark building up grain by grain, the words for what
// the backend says is happening, and the time since the backend's turn start. It draws a shape it is
// given and issues no call. The only live text is the settled words; the ticking time is outside it.

const SETTLE_PROPERTY = "--ae-motion-settle";

/** A CSS time as milliseconds: `<number>ms` or `<number>s`; anything else is 0, which means no hold. */
function parseSettleMs(text: string): number {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/i.exec(text.trim());
  if (match === null) return 0;
  const value = Number(match[1]);
  const milliseconds = match[2]?.toLowerCase() === "s" ? value * 1000 : value;
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function readSettleMs(): number {
  if (typeof document === "undefined") return 0;
  try {
    return parseSettleMs(
      getComputedStyle(document.documentElement).getPropertyValue(SETTLE_PROPERTY),
    );
  } catch {
    return 0;
  }
}

// Geometry of the artwork (64 x 64 view box), not UI sizes: the square that frames the mark without
// its glow, the mirror of the right-hand stalk, the ink gradient's vertical extent, the stalk's width.
const VIEW_BOX = "9 6.5 46 46";
const MIRROR = "translate(64 0) scale(-1 1)";
const INK_Y = { top: 12, bottom: 54 } as const;
const STALK_WIDTH = 1.6;

const role = (name: string): string => `var(--ae-color-brand-${name})`;

/** Each path with its grain index (foot 0 to tip 12) for its moment in the build; -1 for non-grains. */
const PARTS = WREATH.map((path, index) => ({
  ...path,
  grain: path.part === "ink" ? WREATH.slice(0, index).filter((p) => p.part === "ink").length : -1,
}));

function Side({ mirrored, ink }: { readonly mirrored: boolean; readonly ink: string }) {
  return (
    <g transform={mirrored ? MIRROR : undefined} fill={`url(#${ink})`}>
      {PARTS.map(({ part, d, grain }) => {
        if (part === "stalk") {
          return (
            <path
              key={d}
              d={d}
              data-ae-run="body"
              fill="none"
              strokeWidth={STALK_WIDTH}
              strokeLinecap="round"
              style={{ stroke: role("stalk-bottom") }}
            />
          );
        }
        if (part === "blade") {
          return <path key={d} d={d} data-ae-run="body" style={{ fill: role("deep-bottom") }} />;
        }
        return (
          <path
            key={d}
            d={d}
            data-ae-run="grain"
            style={{ "--ae-run-i": grain } as CSSProperties}
          />
        );
      })}
    </g>
  );
}

function Mark() {
  const ink = `ae-running-ink-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      data-ae-run="mark"
      viewBox={VIEW_BOX}
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      style={{ "--ae-run-grains": GRAIN_COUNT } as CSSProperties}
    >
      <defs>
        <linearGradient
          id={ink}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={INK_Y.top}
          x2="0"
          y2={INK_Y.bottom}
        >
          <stop offset="0" style={{ stopColor: role("ink-top") }} />
          <stop offset="1" style={{ stopColor: role("ink-bottom") }} />
        </linearGradient>
      </defs>
      <Side mirrored={false} ink={ink} />
      <Side mirrored ink={ink} />
      <path d={SPARK} data-ae-run="body" style={{ fill: role("spark") }} />
    </svg>
  );
}

export interface RunningIndicatorProps {
  readonly shape: RunningShape;
  /** The backend's turn start (ISO); absent when it has none, in which case no time shows. */
  readonly createdAt: string | null;
  /** The settle hold in milliseconds; read once from the page's `--ae-motion-settle` when absent. */
  readonly holdMs?: number | undefined;
}

/**
 * A later phase replaces the shown one only after it has stayed the computed phase for the whole
 * hold; a different candidate restarts the wait, returning to the shown phase cancels it, and
 * unmounting clears it. The first phase shows at once, and so does every state that is not a phase.
 */
function useSettledPhase(candidate: Phase | null, hold: number): Phase | null {
  const [shown, setShown] = useState<Phase | null>(candidate);
  // Derived resets: no phase to show clears the memory; the first phase after that shows at once.
  if (candidate === null && shown !== null) setShown(null);
  if (candidate !== null && shown === null) setShown(candidate);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the hold is a timer: it commits the candidate only after it has stayed for the whole hold
  useEffect(() => {
    if (candidate === null || hold === 0 || candidate === shown) return;
    const timer = setTimeout(() => setShown(candidate), hold);
    return () => clearTimeout(timer);
  }, [candidate, shown, hold]);
  if (candidate === null) return null;
  return hold === 0 ? candidate : (shown ?? candidate);
}

export function RunningIndicator({ shape, createdAt, holdMs }: RunningIndicatorProps) {
  const [pageHold] = useState(readSettleMs);
  const candidate = shape.kind === "phase" ? shape.phase : null;
  const phase = useSettledPhase(candidate, holdMs ?? pageHold);
  const shown: RunningShape = phase === null ? shape : { kind: "phase", phase };
  const words = wordsOf(shown);
  const hasTime = createdAt !== null && !Number.isNaN(Date.parse(createdAt));
  // What is shown, as words from a closed list: the kind of the shown shape and, for a phase, which one.
  useRegion(REGION.conversationRunning, () => ({
    state: { shape: shown.kind, phase: shown.kind === "phase" ? shown.phase : undefined },
  }));
  return (
    <div data-aetheria="running" className="inline-flex min-w-0 items-center gap-2">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {words}
      </span>
      <Mark />
      <span className="min-w-0 truncate">
        {words}
        {hasTime ? (
          <>
            {" · "}
            <span ref={tickTextContent((now) => elapsedText(createdAt, now) ?? "", true)} />
          </>
        ) : null}
      </span>
    </div>
  );
}
