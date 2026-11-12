import { createFileRoute } from "@tanstack/react-router";

import { requireSignedIn } from "../../aetheria/sessions/routeGuard";
import { AetheriaSessionsPage } from "../../aetheria/sessions/AetheriaSessionsPage";

// An added route: it guards sign-in itself, because the root does not redirect a signed-out visit.
export const Route = createFileRoute("/aetheria/sessions")({
  beforeLoad: ({ context }) => requireSignedIn(context),
  component: AetheriaSessionsPage,
});
