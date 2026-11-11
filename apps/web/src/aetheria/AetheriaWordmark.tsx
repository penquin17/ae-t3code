import { cn } from "~/lib/utils";
import { AETHERIA_NAME } from "./brand";

const MARK_LIGHT = "/aetheria/aetheria-mark-light.svg";
const MARK_DARK = "/aetheria/aetheria-mark-dark.svg";

/** The tileless Aetheria mark in the version for the app's light or dark appearance. Decorative: the name is the text beside it. */
function AetheriaMark({ className }: { readonly className?: string }) {
  return (
    <>
      <img
        src={MARK_LIGHT}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("dark:hidden", className)}
      />
      <img
        src={MARK_DARK}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}

/** The mark and the name "Aetheria", for the shell places that carried T3's wordmark. Text size comes from the caller. */
export function AetheriaWordmark({
  className,
  markClassName,
}: {
  readonly className?: string;
  /** Sizes the mark; it defaults to the height of a capital letter and a half of the surrounding text. */
  readonly markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <AetheriaMark className={cn("h-[1.5em] w-auto shrink-0", markClassName)} />
      <span className="truncate">{AETHERIA_NAME}</span>
    </span>
  );
}
