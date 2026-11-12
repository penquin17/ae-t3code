/** The viewport widths of the responsive matrix (D15): wide, the 1024 boundary, narrow desktop, the 768 boundary, tablet, phone. */
export const MATRIX_WIDTHS = [1280, 1023, 980, 768, 767, 640, 390] as const;

export const MATRIX_MODES = ["light", "dark"] as const;

export type MatrixSurface = "conversation" | "hero" | "sidebar";

/** A capture's file name carries the sidebar's state: open on desktop, a sheet on a phone, or collapsed. */
export type SidebarState = "open" | "sheet" | "collapsed";

export const captureName = (
  surface: MatrixSurface,
  width: number,
  mode: "light" | "dark",
  state?: SidebarState,
) => `slice3-${surface}-${width}-${mode}${state ? `-${state}` : ""}.png`;

/** The surfaces added for F1: Settings → Appearance, a live palette preview, both dialogs and the standalone page header. */
export type SurfaceB =
  | "appearance"
  | "preview"
  | "wizard"
  | "update"
  | "standalone"
  | "safearea-hero"
  | "safearea-wizard"
  | "safearea-update";

export const captureNameB = (surface: SurfaceB, width: number, mode: "light" | "dark") =>
  `slice3b-${surface}-${width}-${mode}.png`;

/** Insets of a notched phone, for the safe-area check at 390 px: top status bar and bottom home indicator. */
export const PHONE_SAFE_AREA = { top: 47, bottom: 34, left: 0, right: 0 } as const;

/** Phone touch target from the accepted tokens (`--ae-size-touch-min`). */
export const TOUCH_MIN_PX = 44;
