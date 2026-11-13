// The declared M10 regions (D17, XC-19): the one source the manifest is generated from. The ids are the design's initial list; each carries only what step 23 can state without guessing a view's facts
// (id, kind, owner, parent, description). Step 24 adds each region's props, state and tokens where its view is annotated, and may rename a region to follow the real component ownership, recording the
// final list once with the manifest hand-off. A region with no props or state reports nothing but that it is mounted and visible.
import { declareRegion, type RegionDeclaration } from "./descriptor";

const OWNER = "aetheria-ui";
const region = (
  id: string,
  kind: RegionDeclaration["kind"],
  description: string,
  parent: string | null = "shell",
) => declareRegion({ id, kind, owner: OWNER, parent, description });

export const REGION_DECLARATIONS = [
  region("shell", "screen", "The app shell around every page", null),
  region("sidebar.sessions", "panel", "The sessions list on the one root"),
  region("sidebar.rail", "region", "The sidebar rail of shortcuts and status"),
  region("drawer", "panel", "The drawer that slides over the page on a narrow screen"),
  region("conversation.transcript", "region", "The open conversation's transcript"),
  region("conversation.running", "region", "The running state of the open conversation"),
  region("composer", "control-group", "The message composer and its Stop control"),
  region("panel.files", "panel", "The files panel of the open session"),
  region("panel.terminal", "panel", "The terminal panel of the open session"),
  region("panel.diff", "panel", "The changes panel of the open session"),
  region("deliverables", "panel", "The deliverable cards of the open session"),
  region(
    "interactions",
    "panel",
    "The questions, plans, tasks and authorizations waiting for the user",
  ),
  region("settings", "screen", "The settings page"),
] as const;

export const INITIAL_REGION_IDS = REGION_DECLARATIONS.map((descriptor) => descriptor.id);
