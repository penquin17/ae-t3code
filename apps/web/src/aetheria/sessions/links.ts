import type { LinkSource, ListFacts, SessionId, SessionLink } from "./types";

/**
 * Fork links come from the facts of one snapshot (T3's lineage), so they move with T3's data
 * and are never stored here.
 */
export function forkLinkSource(facts: ListFacts): LinkSource {
  return {
    linksFor(ids: readonly SessionId[]): readonly SessionLink[] {
      const wanted = new Set(ids);
      const links: SessionLink[] = [];
      for (const fact of facts.sessions) {
        if (fact.parentId !== undefined && wanted.has(fact.id) && wanted.has(fact.parentId)) {
          links.push({ from: fact.parentId, to: fact.id, kind: "fork" });
        }
      }
      return links;
    },
  };
}

export const noLinks: LinkSource = { linksFor: () => [] };
