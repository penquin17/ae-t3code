import { createFileRoute } from "@tanstack/react-router";

import { ControlPage } from "../../aetheria/control/ControlPage";
import { requireSignedIn } from "../../aetheria/sessions/routeGuard";

// An added route: it guards sign-in itself, because the root does not redirect a signed-out visit.
export const Route = createFileRoute("/aetheria/control/$environmentId/$threadId")({
  beforeLoad: ({ context }) => requireSignedIn(context),
  component: ControlRoute,
});

function ControlRoute() {
  const { environmentId, threadId } = Route.useParams();
  return <ControlPage environmentId={environmentId} threadId={threadId} />;
}
