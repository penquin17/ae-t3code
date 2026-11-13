// Registers T3's own surfaces as declared regions (review 2, F2; D17, XC-19) by reading T3's route, sidebar and panel state; no T3 component is edited. Always registered, `visible` = T3 shows it now; shape only.
// Limit: panels follow the route's server thread, so an unpromoted draft reports its transcript and composer but no panel.
import { useLocation, useMatches } from "@tanstack/react-router";

import { useSidebar } from "../../components/ui/sidebar";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { REGION } from "./declarations";
import { useRegion } from "./useRegion";

/** The route ids T3 renders its one ChatView for: a server thread and a draft. The Aetheria pages carry the same params but are not these routes. */
const SERVER_THREAD_ROUTE = "/_chat/$environmentId/$threadId";
const DRAFT_THREAD_ROUTE = "/_chat/draft/$draftId";

const SETTINGS_ROOT = "/settings";

export function T3SurfaceRegions(): null {
  const { isMobile, open, openMobile } = useSidebar();
  const conversationShown = useMatches({
    select: (matches) =>
      matches.some(
        (match) => match.routeId === SERVER_THREAD_ROUTE || match.routeId === DRAFT_THREAD_ROUTE,
      ),
  });
  const draft = useMatches({
    select: (matches) => matches.some((match) => match.routeId === DRAFT_THREAD_ROUTE),
  });
  const settingsOpen = useLocation({
    select: (location) =>
      location.pathname === SETTINGS_ROOT || location.pathname.startsWith(`${SETTINGS_ROOT}/`),
  });
  const threadRef = useThreadRouteRef();
  const panelThread = conversationShown ? threadRef : null;
  const rightPanel = useRightPanelStore((state) =>
    panelThread === null ? null : selectActiveRightPanel(state.byThreadKey, panelThread),
  );
  const terminalDrawerOpen = useTerminalUiStateStore((state) =>
    panelThread === null
      ? false
      : selectThreadTerminalUiState(state.terminalUiStateByThreadKey, panelThread).terminalOpen,
  );

  useRegion(REGION.shell, () => ({ state: { mobile: isMobile } }));
  useRegion(REGION.shellRail, () => ({}), { visible: !isMobile && open });
  useRegion(REGION.shellDrawer, () => ({}), { visible: isMobile && openMobile });
  useRegion(REGION.conversationTranscript, () => ({ state: { draft } }), {
    visible: conversationShown,
  });
  useRegion(REGION.conversationComposer, () => ({}), { visible: conversationShown });
  useRegion(REGION.panelFiles, () => ({}), {
    visible: rightPanel === "files" || rightPanel === "file",
  });
  useRegion(REGION.panelTerminal, () => ({}), {
    visible: terminalDrawerOpen || rightPanel === "terminal",
  });
  useRegion(REGION.panelDiff, () => ({}), { visible: rightPanel === "diff" });
  // `section` is reported by shape: the query reads only the type of what the reporter returns, so an empty string stands for "a string" and the open settings page's name is never held.
  useRegion(REGION.settings, () => ({ state: { section: "" } }), { visible: settingsOpen });
  return null;
}
