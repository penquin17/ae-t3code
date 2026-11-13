import { useState } from "react";

import { useSidebar } from "../../components/ui/sidebar";
import { useGroups } from "../groups/useGroups";
import type { RegionDescriptor } from "../regions/descriptor";
import { useRegion } from "../regions/useRegion";
import { SessionsView } from "./SessionsView";
import { useSessionActions, type SessionActions } from "./useSessionActions";
import { useSessionTree } from "./useSessionTree";

/**
 * The real session list: T3's data, the Backend's saved groups and T3's session actions, drawn by
 * SessionsView. Used by the Aetheria sidebar and the sessions page; it holds only the search text.
 * Each host passes the region it declares for its own mount; the region reports whether the saved groups
 * were read, how many projects are shown, whether a search narrows them, and the search text by shape alone.
 */
export function SessionsPanel({ region }: { readonly region?: RegionDescriptor }) {
  const [query, setQuery] = useState("");
  const groups = useGroups();
  const { model, now } = useSessionTree(query, groups.state.record);
  const base = useSessionActions();
  const { isMobile, setOpenMobile } = useSidebar();
  useRegion(region ?? null, () => ({
    state: {
      groups: groups.state.record.state,
      projects: model.projects.length,
      filtered: query.trim() !== "",
      search: query,
    },
  }));

  const actions: SessionActions = {
    ...base,
    open: (sessionId) => {
      base.open(sessionId);
      if (isMobile) setOpenMobile(false);
    },
  };

  return (
    <SessionsView
      model={model}
      now={now}
      query={query}
      onQuery={setQuery}
      actions={actions}
      groups={groups}
    />
  );
}
