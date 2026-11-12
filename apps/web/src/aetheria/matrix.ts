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

/** Phone touch target from the accepted tokens (`--ae-size-touch-min`). */
export const TOUCH_MIN_PX = 44;
