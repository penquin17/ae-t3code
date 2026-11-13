import { SidebarChromeFooter, SidebarChromeHeader } from "../../components/sidebar/SidebarChrome";
import { SidebarContent, useSidebar, useSidebarVisibility } from "../../components/ui/sidebar";
import { isElectron } from "../../env";
import { ConnectionStatus } from "../connection/ConnectionStatus";
import { REGION } from "../regions/declarations";
import { useRegion } from "../regions/useRegion";
import { SessionsPanel } from "./SessionsPanel";

/**
 * The Aetheria sidebar, rendered by the shell in place of T3's thread sidebar (IP-2). T3's chrome header
 * and footer stay; only the list between them is Aetheria's. It registers the `sidebar` region, visible
 * while the drawer or the desktop sidebar is open; the shell mounts RegionsSync beside it, not here.
 */
export function AetheriaSidebar() {
  const { isMobile } = useSidebar();
  const open = useSidebarVisibility();
  useRegion(REGION.sidebar, () => ({ state: { mobile: isMobile } }), { visible: open });
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent>
        <ConnectionStatus className="mx-2 mb-2 w-auto" region={REGION.sidebarConnection} />
        <SessionsPanel region={REGION.sidebarSessions} />
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
