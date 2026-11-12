# Aetheria design guideline (T3 web, token layer only)

This package gives T3's web app Aetheria's look through one generated stylesheet. It ports the palette, motion, accessibility and brand rules of Aetheria's accepted guideline and leaves out everything that needs the DSH host: the component library, the host's style mounting and its variable mapping are not part of it. Where this file and `tokens/aetheria.tokens.json` disagree about a value, the token file is right and this file has a bug.

Status: accepted values from the user's review of 2026-11-03 (Y4's blues with the neutral, state, space and radius scales). The token source is a one-time copy of the legacy DSH package's file with the same content (the package's formatter may change its whitespace, so the contract test pins a hash of the parsed content with sorted keys, not of the bytes); its historical font and DSH metadata stay in it unused. Its `$stylesRevisions` hash describes the legacy DSH stylesheet, not this package's output.

## Scope and decisions

- **One layer.** `src/generated/aetheria.css` is imported once by `apps/web/src/main.tsx`, after T3's own `index.css`. It sets the `--ae-*` variables and maps them onto T3's own variables.
- **Aetheria is the default appearance.** The mapping applies only while no palette id is set (the standard light, dark and system choices). A built-in or custom palette from Settings → Appearance, and a live preview, match none of the layer's selectors and keep control. Inside the sidebar subtree, where T3 redeclares its variables, the layer repeats the mapping.
- **T3's fonts.** No font variable is generated and no web font is loaded. T3's own stacks, and the Appearance font settings that override them, stay in charge.
- **No geometry.** T3's `0.5rem` radius already equals `--ae-radius-md`; no layout variable is mapped.
- **Identity beside the colours.** The package also holds the two brand marks (`assets/`), the generator that draws the icon set from them (`pnpm --filter @t3tools/aetheria-design run build:icons`, written to `apps/web/public/aetheria/`), and the one rule that sizes the new-thread headline. Nothing else in the stylesheet is layout.

## Colors

Three tiers, one source. Primitives are raw values and appear only in the token file. Semantic roles name a purpose and have a light and a dark value. Component tokens point at a role. The stylesheet exposes semantic and component tokens.

| Role             | Token                                            | Use in T3                                                                                                            |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Page background  | `--ae-color-bg-base`                             | Canvas (`--background`), sidebar rows and controls                                                                   |
| Raised surface   | `--ae-color-bg-layer`                            | Cards, secondary and muted surfaces, the sidebar, and the composer (`--surface-raised`, which T3 reads in dark mode) |
| Floating surface | `--ae-color-bg-overlay`                          | Menus, popovers, dialogs (`--popover`)                                                                               |
| Divider          | `--ae-color-border`                              | `--border`, `--sidebar-border`                                                                                       |
| Field outline    | `--ae-color-label-primary` mixed in the layer    | `--input`: the text colour at 50% in light and 40% in dark                                                           |
| Primary text     | `--ae-color-label-primary`                       | Body text and the quiet hover surface (at `--ae-opacity-hover`)                                                      |
| Secondary text   | `--ae-color-label-secondary`                     | Hints, metadata, sidebar row details                                                                                 |
| Accent           | `--ae-color-accent`                              | `--primary` and `--ring`                                                                                             |
| Text on accent   | `--ae-color-accent-fg`                           | `--primary-foreground`                                                                                               |
| State            | `--ae-color-state-error`, `-warning`, `-success` | `--error`, `--warning`, `--success`                                                                                  |

T3's `--accent` is its quiet hover and selection surface, not an action colour: it takes the primary text colour at `--ae-opacity-hover`. The action accent is `--primary`.

The field outline is not a token. A single accepted role cannot give a control boundary 3:1 on the canvas and on every layer, so the generator writes `--input` as a CSS mix of the text colour inside the gated layer (a second, dark-only block carries the 40%). The strengths are constants in `src/mapping.ts`; the border role keeps its accepted values.

The exact table, with the light and dark values and the T3 consumer of each variable, is `src/mapping.ts` and the generated `src/generated/resolved.ts`. T3-only variables that stay unchanged, with the reason, are listed in `keptT3Variables`.

## Motion

`--ae-motion-fast`, `-slow`, `-grain`, `-loop` and `-settle` carry the accepted durations. Under `prefers-reduced-motion: reduce` every one becomes `0ms`. T3's own animations are not changed by this layer.

## Accessibility

- Text pairs in `mappedPairs` meet 4.5:1 in both modes; focus rings, primary fills, state indicators and field outlines meet 3:1. The field outline is claimed on the canvas, a card, a popover and the sidebar, and stays below 6:1 so it reads lighter than text. Translucent surfaces are composited over the surface they sit on before measuring.
- State is never colour alone. State colours only promise 3:1, so T3's own text shades stay for error, warning and success text.
- One pair the accepted tokens do not carry is listed in `notClaimedPairs`: secondary text on the hover surface in light mode (about 4.06:1). No text on the measured pages sits in that pairing, because T3's ghost buttons switch to the foreground colour when hovered. A user palette is the user's: only the default appearance is claimed to meet these ratios.
- Limits recorded from the rendered app, not repaired here: the project avatar's two-letter initials (T3's own hue, 8 px, about 3.2:1 in light mode), T3's running-thread count in the update dialog (T3's warning role as text, about 3.2:1 in light mode and above 4.5:1 in dark), T3's controls that are smaller than a phone touch target, and two places where T3's own chrome reaches into a phone's safe-area bands (its top bar and the alert dialog's Cancel button). The app tests name the avatar, running-count and safe-area cases exactly, so a change to any of them shows; the touch-target sizes are measured and reported only.
- Do not change an accepted token to make a pairing pass; pick another existing role or return a design decision.

## Brand

The mark is the Y4 star above an open wreath, with no tile, in a light and a dark version (the brand roles, for example `--ae-color-brand-spark`). Both SVGs are copied unchanged into `assets/` and pinned by hash in the tests.

The icon set is generated, not drawn by hand: one adaptive SVG favicon that follows the browser's light or dark scheme (not the app's Appearance), an `.ico` of 16, 32 and 48 pixel images, 16 and 32 pixel PNGs and the 180 pixel apple-touch icon, all rasterised from the light mark by Chromium, plus both marks for the in-app wordmark. The page and the manifest point at them under `/aetheria/`; T3's stock icons stay in place, unused.

The new-thread headline, "Knowledge comes together", is one rule in the stylesheet keyed by `[data-aetheria-headline]`: `min(26px, calc(8vw - 4px))`, one line, no wrapping rule, from 1280 px down to 320 px.

## Do and do not

| Do                                                         | Do not                                        |
| ---------------------------------------------------------- | --------------------------------------------- |
| Add a token to the source, then run the package `build`    | Edit a file in `src/generated/` by hand       |
| Name a role (`--ae-color-bg-layer`) in Aetheria-owned CSS  | Paste a hex colour into Aetheria-owned source |
| Keep the layer gated to the default appearance             | Use `!important` or hashed class names to win |
| Check light and dark, 1280 and 390 px, by viewing captures | Call a change done from unit tests alone      |
