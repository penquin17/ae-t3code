import { HammerIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { AetheriaMark } from "./AetheriaWordmark";

/**
 * The name the runner gives the Builder's Pi instance: the preset manifest's `identity.name`, which the settings preparation writes as the
 * instance's `displayName` (`pi-builder`; the ordinary preset is `pi`, "Aetheria"). The icon component is given the display name, not the id.
 */
const BUILDER_DISPLAY_NAME = "aetheria builder";

function isBuilderInstance(displayName: string) {
  return displayName.trim().toLowerCase() === BUILDER_DISPLAY_NAME;
}

/**
 * The Pi provider's icon (IP-68). The ordinary Aetheria instance is the plain mark. The Builder instance is the same mark with a hammer
 * centred in the wreath's open middle, in the app's accent (the mark's own blue, lighter in dark mode). Decorative, as every provider icon is.
 * `className` sizes the whole icon, as it sizes the plain mark.
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
      <HammerIcon
        className="absolute top-[56%] left-1/2 size-[42%] -translate-x-1/2 -translate-y-1/2 text-primary"
        strokeWidth={2.5}
        aria-hidden
      />
    </span>
  );
}
