import { useState } from "react";

import { useSidebar } from "../../components/ui/sidebar";
import { useGroups } from "../groups/useGroups";
import { SessionsView } from "./SessionsView";
import { useSessionActions, type SessionActions } from "./useSessionActions";
import { useSessionTree } from "./useSessionTree";

/**
 * The real session list: T3's data, the Backend's saved groups and T3's session actions, drawn by
 * SessionsView. Used by the Aetheria sidebar and the sessions page; it holds only the search text.
 */
export function SessionsPanel() {
  const [query, setQuery] = useState("");
  const groups = useGroups();
  const { model, now } = useSessionTree(query, groups.state.record);
  const base = useSessionActions();
  const { isMobile, setOpenMobile } = useSidebar();

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
