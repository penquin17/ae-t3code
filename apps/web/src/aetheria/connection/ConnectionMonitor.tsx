// The always-mounted connection monitor (M10 review 1, follow-up 3; D4, D6). `gateOnConnection` judges the connection from the views mounted monitors publish, and with none mounted it lets a send through. The status
// line is not always on screen — the sidebar's unmounts at phone width with the drawer closed — so the shell's one reporter (`RegionsSync`, mounted outside the sidebar) renders this, and a send is never judged
// by nothing. It renders nothing; the view it publishes is the same one every status line shows, because `useConnectionView` is the one owner of what the connection is.
import { useConnectionView } from "./useConnectionView";

export function ConnectionMonitor() {
  useConnectionView();
  return null;
}
