import { AETHERIA_SLOGAN } from "./brand";

/** The slogan as the new-thread hero's headline. Its size and one-line layout come from the Aetheria stylesheet through the data hook. */
export function AetheriaHeadline() {
  return (
    <p data-aetheria-headline className="text-foreground">
      {AETHERIA_SLOGAN}
    </p>
  );
}
