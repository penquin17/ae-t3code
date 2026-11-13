// The connection banner as mounted in the Aetheria shell (M10 step 20): the truthful state when the client is not connected, nothing when it is. Connected is the ordinary state and gets no banner;
// every other state (connecting, reconnecting, disconnected, unauthorized, access ended, version mismatch, unknown) is shown with its offer.
import type { RegionDescriptor } from "../regions/descriptor";
import { useRegion } from "../regions/useRegion";
import { ConnectionBanner } from "./ConnectionBanner";
import type { ConnectionView, Locale } from "./state";
import { useConnectionView } from "./useConnectionView";

/** T3's own pairing page, where a device signs in again. */
const SIGN_IN_PATH = "/pair";

/** Pure: the banner for a view, or nothing when connected. Used by the mounted component and by tests that supply a view. */
export function ConnectionStatusView({
  view,
  locale,
  className,
  onReload = () => window.location.reload(),
  onSignIn = () => window.location.assign(SIGN_IN_PATH),
}: {
  readonly view: ConnectionView;
  readonly locale?: Locale;
  readonly className?: string;
  readonly onReload?: () => void;
  readonly onSignIn?: () => void;
}) {
  if (view.kind === "connected") return null;
  return (
    <ConnectionBanner
      view={view}
      {...(locale === undefined ? {} : { locale })}
      {...(className === undefined ? {} : { className })}
      onReload={onReload}
      onSignIn={onSignIn}
    />
  );
}

/**
 * The mounted status: reads the primary environment's connection and draws it. A host that declares a region for this mount passes it; the region is registered while the status is mounted and is
 * visible only when a banner is shown, and it reports the one status word and nothing the banner says.
 */
export function ConnectionStatus(props: {
  readonly className?: string;
  readonly locale?: Locale;
  readonly region?: RegionDescriptor;
}) {
  const { region, ...shown } = props;
  const { view } = useConnectionView(props.locale);
  useRegion(region ?? null, () => ({ state: { status: view.kind } }), {
    visible: view.kind !== "connected",
  });
  return <ConnectionStatusView view={view} {...shown} />;
}
