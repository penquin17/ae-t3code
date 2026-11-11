# Aetheria design guideline (T3 web, token layer only)

This package gives T3's web app Aetheria's look through one generated stylesheet. It ports the palette, motion, accessibility and brand rules of Aetheria's accepted guideline and leaves out everything that needs the DSH host: the component library, the host's style mounting and its variable mapping are not part of it. Where this file and `tokens/aetheria.tokens.json` disagree about a value, the token file is right and this file has a bug.

Status: accepted values from the user's review of 2026-11-03 (Y4's blues with the neutral, state, space and radius scales). The token source is a byte-identical copy of the legacy DSH package's file, ported once; its historical font and DSH metadata stay in it unused. Its `$stylesRevisions` hash describes the legacy DSH stylesheet, not this package's output.

## Scope and decisions

- **One layer.** `src/generated/aetheria.css` is imported once by `apps/web/src/main.tsx`, after T3's own `index.css`. It sets the `--ae-*` variables and maps them onto T3's own variables.
- **Aetheria is the default appearance.** The mapping applies only while no palette id is set (the standard light, dark and system choices). A built-in or custom palette from Settings → Appearance, and a live preview, match none of the layer's selectors and keep control. Inside the sidebar subtree, where T3 redeclares its variables, the layer repeats the mapping.
- **T3's fonts.** No font variable is generated and no web font is loaded. T3's own stacks, and the Appearance font settings that override them, stay in charge.
- **No geometry.** T3's `0.5rem` radius already equals `--ae-radius-md`; no layout variable is mapped.

## Colors

Three tiers, one source. Primitives are raw values and appear only in the token file. Semantic roles name a purpose and have a light and a dark value. Component tokens point at a role. The stylesheet exposes semantic and component tokens.

| Role                | Token                                            | Use in T3                                                       |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Page background     | `--ae-color-bg-base`                             | Canvas (`--background`), sidebar rows and controls              |
| Raised surface      | `--ae-color-bg-layer`                            | Cards, composer, secondary and muted surfaces, the sidebar      |
| Floating surface    | `--ae-color-bg-overlay`                          | Menus, popovers, dialogs (`--popover`)                          |
| Divider and outline | `--ae-color-border`                              | `--border`, `--input`, `--sidebar-border`                       |
| Primary text        | `--ae-color-label-primary`                       | Body text and the quiet hover surface (at `--ae-opacity-hover`) |
| Secondary text      | `--ae-color-label-secondary`                     | Hints, metadata, sidebar row details                            |
| Accent              | `--ae-color-accent`                              | `--primary` and `--ring`                                        |
| Text on accent      | `--ae-color-accent-fg`                           | `--primary-foreground`                                          |
| State               | `--ae-color-state-error`, `-warning`, `-success` | `--error`, `--warning`, `--success`                             |

T3's `--accent` is its quiet hover and selection surface, not an action colour: it takes the primary text colour at `--ae-opacity-hover`. The action accent is `--primary`.

The exact table, with the light and dark values and the T3 consumer of each variable, is `src/mapping.ts` and the generated `src/generated/resolved.ts`. T3-only variables that stay unchanged, with the reason, are listed in `keptT3Variables`.

## Motion

`--ae-motion-fast`, `-slow`, `-grain`, `-loop` and `-settle` carry the accepted durations. Under `prefers-reduced-motion: reduce` every one becomes `0ms`. T3's own animations are not changed by this layer.

## Accessibility

- Text pairs in `mappedPairs` meet 4.5:1 in both modes; focus rings, primary fills and state indicators meet 3:1. Translucent surfaces are composited over the surface they sit on before measuring.
- State is never colour alone. State colours only promise 3:1, so T3's own text shades stay for error, warning and success text.
- Pairs the accepted tokens do not carry are listed in `notClaimedPairs` with their consumer: secondary text on the hover surface in light mode, and the input outline on the canvas. A user palette is the user's: only the default appearance is claimed to meet these ratios.
- Do not change an accepted token to make a pairing pass; pick another existing role or return a design decision.

## Brand

The mark is the Y4 star above an open wreath, with no tile, in a light and a dark version (the brand roles, for example `--ae-color-brand-spark`). The icon assets and the headline are carried by later steps of the M10a cycle; this layer only supplies the colours.

## Do and do not

| Do                                                         | Do not                                        |
| ---------------------------------------------------------- | --------------------------------------------- |
| Add a token to the source, then run the package `build`    | Edit a file in `src/generated/` by hand       |
| Name a role (`--ae-color-bg-layer`) in Aetheria-owned CSS  | Paste a hex colour into Aetheria-owned source |
| Keep the layer gated to the default appearance             | Use `!important` or hashed class names to win |
| Check light and dark, 1280 and 390 px, by viewing captures | Call a change done from unit tests alone      |
