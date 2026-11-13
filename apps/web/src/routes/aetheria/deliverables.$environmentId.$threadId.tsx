import { createFileRoute } from "@tanstack/react-router";

import { DeliverablesPage } from "../../aetheria/deliverables/DeliverablesPage";
import { requireSignedIn } from "../../aetheria/sessions/routeGuard";

// An added route: it guards sign-in itself, because the root does not redirect a signed-out visit.
export const Route = createFileRoute("/aetheria/deliverables/$environmentId/$threadId")({
  beforeLoad: ({ context }) => requireSignedIn(context),
  component: DeliverablesRoute,
});

function DeliverablesRoute() {
  const { environmentId, threadId } = Route.useParams();
  return <DeliverablesPage environmentId={environmentId} threadId={threadId} />;
}
