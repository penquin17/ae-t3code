import type { Known } from "../core/known";
import type { GroupRecord } from "../groups/record";
import { noSuggestions } from "./model";
import { createSuggestionSource } from "./suggest";
import type { GroupName, LinkSource, SessionId, SessionLink, SuggestionSource } from "./types";

/** What the tree reads from the Backend's group record: links, saved names and the suggestion seat. */
export interface GroupSources {
  readonly links: LinkSource;
  readonly suggestions: SuggestionSource;
  readonly names: readonly GroupName[];
}

/**
 * Fork links plus the record's confirmed `grouped` links, a saved-name list, and a suggestion source that
 * skips every dismissed pair. Only a known record contributes: while the record is unknown or unavailable the
 * tree shows fork groups alone and no suggestions, since a dismissed pair could not be told from a new one.
 */
export function groupSources(fork: LinkSource, record: Known<GroupRecord>): GroupSources {
  if (record.state !== "known") return { links: fork, suggestions: noSuggestions, names: [] };
  const { links, dismissed, names } = record.value;
  return {
    links: {
      linksFor(ids: readonly SessionId[]): readonly SessionLink[] {
        const wanted = new Set(ids);
        const confirmed: SessionLink[] = links
          .filter((link) => wanted.has(link.a) && wanted.has(link.b))
          .map((link) => ({ from: link.a, to: link.b, kind: "grouped" }));
        return [...fork.linksFor(ids), ...confirmed];
      },
    },
    suggestions: createSuggestionSource(dismissed),
    names,
  };
}
