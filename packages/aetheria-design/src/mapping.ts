/**
 * How Aetheria's semantic tokens land on T3's own CSS variables. The generator turns each
 * entry into one declaration of the consumed stylesheet and one resolved light/dark pair;
 * the tests read the same entries for contrast.
 */

export interface MappingEntry {
  /** A T3 variable declared in apps/web/src/index.css. */
  readonly variable: string;
  /** Dotted path of a semantic colour token in tokens/aetheria.tokens.json. */
  readonly role: string;
  /** Dotted path of a semantic opacity token: the entry is the role at that opacity. */
  readonly overlay?: string;
  /**
   * The role at this opacity in percent, per appearance: a CSS-only mix inside the layer, so a variable
   * can be drawn stronger than any single accepted role without changing a token value.
   */
  readonly mix?: { readonly light: number; readonly dark: number };
  /** Where T3 reads the variable, so a reviewer can judge the role. */
  readonly consumer: string;
}

export interface MappedPair {
  readonly foreground: string;
  readonly background: string;
  /** The surface a translucent background sits on; defaults to --background. */
  readonly over?: string;
  /** 4.5 for text, 3 for focus rings, fills and state indicators. */
  readonly minimum: 3 | 4.5;
  readonly consumer: string;
}

export interface KeptVariable {
  readonly variable: string;
  readonly reason: string;
}

export const t3Mapping: readonly MappingEntry[] = [
  {
    variable: "--background",
    role: "semantic.color.bg.base",
    consumer: "The page and conversation canvas (bg-background).",
  },
  {
    variable: "--foreground",
    role: "semantic.color.label.primary",
    consumer: "Body text on the canvas (text-foreground).",
  },
  {
    variable: "--card",
    role: "semantic.color.bg.layer",
    consumer: "Cards, the composer and settings groups (bg-card).",
  },
  {
    variable: "--card-foreground",
    role: "semantic.color.label.primary",
    consumer: "Text on cards (text-card-foreground).",
  },
  {
    variable: "--popover",
    role: "semantic.color.bg.overlay",
    consumer: "Menus, popovers, dialogs and tooltips (bg-popover).",
  },
  {
    variable: "--popover-foreground",
    role: "semantic.color.label.primary",
    consumer: "Text in menus, popovers and dialogs.",
  },
  {
    variable: "--primary",
    role: "semantic.color.accent",
    consumer: "Solid actions: primary buttons, switches, the send button.",
  },
  {
    variable: "--primary-foreground",
    role: "semantic.color.accent.fg",
    consumer: "Labels on a primary action.",
  },
  {
    variable: "--secondary",
    role: "semantic.color.bg.layer",
    consumer: "Secondary buttons and badges (bg-secondary).",
  },
  {
    variable: "--secondary-foreground",
    role: "semantic.color.label.primary",
    consumer: "Labels on secondary buttons and badges.",
  },
  {
    variable: "--muted",
    role: "semantic.color.bg.layer",
    consumer: "Muted surfaces, skeletons and code chips (bg-muted).",
  },
  {
    variable: "--muted-foreground",
    role: "semantic.color.label.secondary",
    consumer: "Secondary text, hints and metadata (text-muted-foreground).",
  },
  {
    variable: "--secondary-label",
    role: "semantic.color.label.secondary",
    consumer: "Row metadata in the sidebar, which T3 sets separately in dark mode.",
  },
  {
    variable: "--surface-raised",
    role: "semantic.color.bg.layer",
    consumer:
      "The composer's glass surface and attached banners in dark mode (T3 fixes it near black there; light mode reads --card).",
  },
  {
    variable: "--accent",
    role: "semantic.color.label.primary",
    overlay: "semantic.opacity.hover",
    consumer:
      "T3's quiet hover and selection surface (ghost buttons, menu items); not Aetheria's action accent.",
  },
  {
    variable: "--accent-foreground",
    role: "semantic.color.label.primary",
    consumer: "Text on the hover and selection surface.",
  },
  {
    variable: "--border",
    role: "semantic.color.border",
    consumer: "Dividers and outlines (border-border).",
  },
  {
    variable: "--input",
    role: "semantic.color.label.primary",
    mix: { light: 50, dark: 40 },
    consumer:
      "Input and select outlines (border-input): the text colour at 50% (light) or 40% (dark), 3:1 or more on the canvas and the layers and well below the text's own ratio.",
  },
  {
    variable: "--ring",
    role: "semantic.color.accent",
    consumer: "Focus rings and the picked-tile ring (ring-ring).",
  },
  {
    variable: "--message-surface",
    role: "semantic.color.label.primary",
    overlay: "semantic.opacity.hover",
    consumer: "The user's message bubble, a quiet tint over the canvas.",
  },
  {
    variable: "--message-foreground",
    role: "semantic.color.label.primary",
    consumer: "Text in the user's message bubble.",
  },
  {
    variable: "--error",
    role: "semantic.color.state.error",
    consumer: "Error indicators, fills and destructive actions.",
  },
  {
    variable: "--warning",
    role: "semantic.color.state.warning",
    consumer: "Warning indicators and fills.",
  },
  {
    variable: "--success",
    role: "semantic.color.state.success",
    consumer: "Success indicators and fills.",
  },
  {
    variable: "--sidebar",
    role: "semantic.color.bg.layer",
    consumer: "The sidebar surface, including portaled mobile sheets.",
  },
  {
    variable: "--sidebar-foreground",
    role: "semantic.color.label.primary",
    consumer: "Sidebar row titles.",
  },
  {
    variable: "--sidebar-muted-foreground",
    role: "semantic.color.label.secondary",
    consumer: "Sidebar row metadata and section labels.",
  },
  {
    variable: "--sidebar-control-surface",
    role: "semantic.color.bg.base",
    consumer: "Sidebar search and filter controls.",
  },
  {
    variable: "--sidebar-row-hover",
    role: "semantic.color.bg.base",
    consumer: "A sidebar row under the pointer.",
  },
  {
    variable: "--sidebar-row-active",
    role: "semantic.color.bg.base",
    consumer: "A sidebar row being pressed.",
  },
  {
    variable: "--sidebar-row-selected",
    role: "semantic.color.bg.base",
    consumer: "The open thread's sidebar row.",
  },
  {
    variable: "--sidebar-border",
    role: "semantic.color.border",
    consumer: "Sidebar dividers and its edge.",
  },
];

export const keptT3Variables: readonly KeptVariable[] = [
  { variable: "--info", reason: "Aetheria has no info role; T3's blue stays." },
  { variable: "--info-foreground", reason: "Aetheria has no info role; T3's blue text stays." },
  { variable: "--guest", reason: "Guest-link identity colour has no Aetheria role." },
  { variable: "--guest-foreground", reason: "Guest-link identity text has no Aetheria role." },
  {
    variable: "--error-foreground",
    reason:
      "Error text needs 4.5:1; Aetheria's error role only promises 3:1, so T3's text shade stays.",
  },
  {
    variable: "--warning-foreground",
    reason:
      "Warning text needs 4.5:1; Aetheria's warning role only promises 3:1, so T3's text shade stays.",
  },
  {
    variable: "--success-foreground",
    reason:
      "Success text needs 4.5:1; Aetheria's success role only promises 3:1, so T3's text shade stays.",
  },
  { variable: "--tool-error-icon", reason: "T3's own icon shade for tool errors." },
  { variable: "--update", reason: "Derived from --primary, so it follows the accent." },
  { variable: "--update-foreground", reason: "T3's update-notice text shade." },
  {
    variable: "--destructive",
    reason: "Derived from --error, so it follows the mapped error role.",
  },
  { variable: "--destructive-foreground", reason: "Derived from T3's error text shade." },
  {
    variable: "--code-background",
    reason: "Derived from --card and --background, so it follows them.",
  },
  { variable: "--code-foreground", reason: "Derived from --foreground." },
  { variable: "--terminal-background", reason: "Derived from --background." },
  { variable: "--terminal-foreground", reason: "Derived from --foreground." },
  { variable: "--terminal-cursor", reason: "A terminal colour with no Aetheria role." },
  {
    variable: "--terminal-selection-background",
    reason: "A terminal colour with no Aetheria role.",
  },
  {
    variable: "--diff-modified-icon",
    reason: "Diff colours carry T3's added/deleted/modified meaning.",
  },
  { variable: "--message-action", reason: "Derived from --primary." },
  { variable: "--message-action-foreground", reason: "Derived from --primary-foreground." },
  { variable: "--message-action-hover", reason: "Derived from --primary and --background." },
  { variable: "--placeholder", reason: "Derived from --muted-foreground." },
  { variable: "--icon-muted", reason: "Derived from --muted-foreground." },
  { variable: "--app-chrome-background", reason: "Derived from --background." },
  { variable: "--toolbar-background", reason: "Derived from --app-chrome-background." },
  {
    variable: "--sidebar-stage-fade",
    reason: "Derived from --sidebar or --card, which are mapped.",
  },
  {
    variable: "--radius",
    reason: "T3's 0.5rem already equals Aetheria's medium radius; no geometry is mapped.",
  },
];

export const mappedPairs: readonly MappedPair[] = [
  {
    foreground: "--foreground",
    background: "--background",
    minimum: 4.5,
    consumer: "Body text on the canvas.",
  },
  {
    foreground: "--muted-foreground",
    background: "--background",
    minimum: 4.5,
    consumer: "Secondary text on the canvas.",
  },
  {
    foreground: "--secondary-label",
    background: "--background",
    minimum: 4.5,
    consumer: "Row metadata on the canvas.",
  },
  { foreground: "--foreground", background: "--card", minimum: 4.5, consumer: "Text on a card." },
  {
    foreground: "--foreground",
    background: "--surface-raised",
    minimum: 4.5,
    consumer: "Prompt text in the composer.",
  },
  {
    foreground: "--muted-foreground",
    background: "--surface-raised",
    minimum: 4.5,
    consumer: "The composer placeholder and its secondary controls.",
  },
  {
    foreground: "--card-foreground",
    background: "--card",
    minimum: 4.5,
    consumer: "Card text on a card.",
  },
  {
    foreground: "--muted-foreground",
    background: "--card",
    minimum: 4.5,
    consumer: "Secondary text on a card.",
  },
  {
    foreground: "--popover-foreground",
    background: "--popover",
    minimum: 4.5,
    consumer: "Text in a menu or dialog.",
  },
  {
    foreground: "--muted-foreground",
    background: "--popover",
    minimum: 4.5,
    consumer: "Secondary text in a menu or dialog.",
  },
  {
    foreground: "--primary-foreground",
    background: "--primary",
    minimum: 4.5,
    consumer: "Label on a primary action.",
  },
  {
    foreground: "--secondary-foreground",
    background: "--secondary",
    minimum: 4.5,
    consumer: "Label on a secondary button.",
  },
  {
    foreground: "--muted-foreground",
    background: "--muted",
    minimum: 4.5,
    consumer: "Secondary text on a muted surface.",
  },
  {
    foreground: "--accent-foreground",
    background: "--accent",
    minimum: 4.5,
    consumer: "Text on the hover surface over the canvas.",
  },
  {
    foreground: "--accent-foreground",
    background: "--accent",
    over: "--card",
    minimum: 4.5,
    consumer: "Text on the hover surface over a card.",
  },
  {
    foreground: "--accent-foreground",
    background: "--accent",
    over: "--popover",
    minimum: 4.5,
    consumer: "A menu item under the pointer.",
  },
  {
    foreground: "--message-foreground",
    background: "--message-surface",
    minimum: 4.5,
    consumer: "Text in the user's message bubble over the canvas.",
  },
  {
    foreground: "--sidebar-foreground",
    background: "--sidebar",
    minimum: 4.5,
    consumer: "Sidebar row titles.",
  },
  {
    foreground: "--sidebar-muted-foreground",
    background: "--sidebar",
    minimum: 4.5,
    consumer: "Sidebar row metadata.",
  },
  {
    foreground: "--secondary-label",
    background: "--sidebar",
    minimum: 4.5,
    consumer: "Sidebar row metadata (the dark-mode override).",
  },
  {
    foreground: "--sidebar-foreground",
    background: "--sidebar-row-hover",
    minimum: 4.5,
    consumer: "A sidebar row title under the pointer.",
  },
  {
    foreground: "--sidebar-muted-foreground",
    background: "--sidebar-row-hover",
    minimum: 4.5,
    consumer: "Sidebar row metadata under the pointer.",
  },
  {
    foreground: "--sidebar-foreground",
    background: "--sidebar-row-active",
    minimum: 4.5,
    consumer: "A sidebar row title being pressed.",
  },
  {
    foreground: "--sidebar-foreground",
    background: "--sidebar-row-selected",
    minimum: 4.5,
    consumer: "The open thread's row title.",
  },
  {
    foreground: "--sidebar-muted-foreground",
    background: "--sidebar-row-selected",
    minimum: 4.5,
    consumer: "The open thread's row metadata.",
  },
  {
    foreground: "--sidebar-foreground",
    background: "--sidebar-control-surface",
    minimum: 4.5,
    consumer: "Text in a sidebar search or filter control.",
  },
  {
    foreground: "--sidebar-muted-foreground",
    background: "--sidebar-control-surface",
    minimum: 4.5,
    consumer: "A placeholder in a sidebar search control.",
  },
  {
    foreground: "--ring",
    background: "--background",
    minimum: 3,
    consumer: "Focus ring on the canvas.",
  },
  { foreground: "--ring", background: "--card", minimum: 3, consumer: "Focus ring on a card." },
  {
    foreground: "--ring",
    background: "--sidebar",
    minimum: 3,
    consumer: "Focus ring in the sidebar.",
  },
  {
    foreground: "--primary",
    background: "--background",
    minimum: 3,
    consumer: "A solid action against the canvas.",
  },
  {
    foreground: "--input",
    background: "--background",
    minimum: 3,
    consumer: "A field outline on the canvas.",
  },
  {
    foreground: "--input",
    background: "--card",
    minimum: 3,
    consumer: "A field outline on a card or the composer.",
  },
  {
    foreground: "--input",
    background: "--popover",
    minimum: 3,
    consumer: "A field outline in a menu or dialog.",
  },
  {
    foreground: "--input",
    background: "--sidebar",
    minimum: 3,
    consumer: "A field outline in the sidebar.",
  },
  {
    foreground: "--error",
    background: "--background",
    minimum: 3,
    consumer: "Error indicator on the canvas.",
  },
  {
    foreground: "--error",
    background: "--card",
    minimum: 3,
    consumer: "Error indicator on a card.",
  },
  {
    foreground: "--warning",
    background: "--background",
    minimum: 3,
    consumer: "Warning indicator on the canvas.",
  },
  {
    foreground: "--warning",
    background: "--card",
    minimum: 3,
    consumer: "Warning indicator on a card.",
  },
  {
    foreground: "--success",
    background: "--background",
    minimum: 3,
    consumer: "Success indicator on the canvas.",
  },
  {
    foreground: "--success",
    background: "--card",
    minimum: 3,
    consumer: "Success indicator on a card.",
  },
];

/** Pairs a consumer can show that the accepted tokens do not carry; measured, not claimed. */
export const notClaimedPairs: readonly MappedPair[] = [
  {
    foreground: "--muted-foreground",
    background: "--accent",
    minimum: 4.5,
    consumer:
      "Secondary text on the hover surface in light mode: below 4.5:1 with the accepted tokens.",
  },
];
