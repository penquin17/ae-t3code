import { cn } from "~/lib/utils";
import { AetheriaMark } from "./AetheriaWordmark";

/**
 * The display name that marks a Pi instance with the word "builder": the preset manifest's `identity.name`, which the settings preparation writes as the
 * instance's `displayName`. The one preset, `pi`, is "Aetheria" and has the plain mark; no preset carries this name now. The icon component is given the display name, not the id.
 */
const BUILDER_DISPLAY_NAME = "aetheria builder";

function isBuilderInstance(displayName: string) {
  return displayName.trim().toLowerCase() === BUILDER_DISPLAY_NAME;
}

/**
 * Where the word sits, in the mark's own 64-unit viewBox (`public/aetheria/aetheria-mark-*.svg`). The wreath's open middle is clear from
 * about x 19.5 to x 44.5 at the height of the word, so the word is fitted to 24 units wide (`textLength`), centred on the axis at x 32,
 * its middle at y 36 (56% down, where the hammer sat; below the spark). Bold, 8 units tall in type size.
 */
const WORD = { x: 32, baseline: 38.8, width: 24, fontSize: 8 } as const;

/**
 * The Pi provider's icon (IP-68). The Aetheria instance is the plain mark. An instance named "Aetheria Builder" is the same mark with the word
 * "builder" centred in the wreath's open middle, in the app's accent (the mark's own blue, lighter in dark mode). The word is an SVG
 * overlay on the mark's viewBox, fitted with `textLength`, so it fills the same share of the mark at every size. Decorative, as every
 * provider icon is. `className` sizes the whole icon, as it sizes the plain mark.
 */
export function AetheriaProviderMark({
  displayName,
  className,
}: {
  readonly displayName: string;
  readonly className: string;
}) {
  if (!isBuilderInstance(displayName)) {
    return <AetheriaMark className={className} />;
  }
  return (
    <span className={cn("relative inline-flex shrink-0", className)} data-aetheria-builder-mark="">
      <AetheriaMark className="size-full object-contain" />
      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 size-full text-primary"
        aria-hidden
        focusable="false"
      >
        <text
          x={WORD.x}
          y={WORD.baseline}
          textAnchor="middle"
          textLength={WORD.width}
          lengthAdjust="spacingAndGlyphs"
          fontSize={WORD.fontSize}
          fontWeight={700}
          fill="currentColor"
          data-aetheria-builder-word=""
        >
          builder
        </text>
      </svg>
    </span>
  );
}
