import { SidebarChromeFooter, SidebarChromeHeader } from "../../components/sidebar/SidebarChrome";
import { SidebarContent } from "../../components/ui/sidebar";
import { isElectron } from "../../env";
import { SessionsPanel } from "./SessionsPanel";

/**
 * The Aetheria sidebar, rendered by the shell in place of T3's thread sidebar (IP-2). T3's chrome
 * header and footer stay, so the brand link, update pills and settings entries are T3's; only the
 * list between them is Aetheria's.
 */
export function AetheriaSidebar() {
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent>
        <SessionsPanel />
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
