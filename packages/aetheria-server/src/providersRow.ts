// AETHERIA M09 Plan step 4 — the Backend `providers` module as data: its ids and its manifest row. No runtime import of a pinned archive, so the
// composition (composition.ts) and the outer digest tests can load it as data; the registration that uses the archive is providers.ts.
import { PROVIDERS_PINNED_ARTIFACT } from "./artifact.ts";

export const PROVIDERS_BACKEND_ID = "providers-backend";
export const PROVIDERS_BACKEND_ENTRY = "aetheria:providers-backend";

/**
 * The manifest row (schema v1, raw) that selects this module on the Backend host. The outer manifest.yml carries the same row; the two copies
 * must give the same digest. `stamp` defaults to the providers archive this build carries, so a row copied from here is never stale.
 */
export function providersBackendModuleRow(
  options: { readonly stamp?: string } = {},
): Record<string, unknown> {
  return {
    id: PROVIDERS_BACKEND_ID,
    host: "backend",
    entry: PROVIDERS_BACKEND_ENTRY,
    required: true,
    mutatesToolInput: false,
    owns: ["backend-providers-state"],
    compat: {
      artifacts: {
        [PROVIDERS_PINNED_ARTIFACT.package]: {
          stamp: options.stamp ?? PROVIDERS_PINNED_ARTIFACT.stamp,
        },
      },
    },
    contract: {
      consumer:
        "The Agent host's fallback and display code (M05, M10), through the XC-6 operations providers.route-states, providers.report-failure, providers.route-capabilities and providers.usage; and the thin web tools, through research.search, research.fetch and research.cancel.",
      success:
        "Each route is answered available, out or unknown with a reason class, an observation time and its basis; the module starts with an empty failure memory, answers only while the Backend runs, and drains once with nothing left live.",
      failure:
        "An argument outside the strict contract, including a caller id, header, credential or account field, throws before the service runs and the carrier reports an error; a module that is not running answers unavailable, never a stale answer.",
      uncertainty:
        "Without an isolated agent directory supplied to the Backend, production answers unknown / service-unavailable for every route and usage as unavailable. With one, availability reads Pi's sign-in store (a refresh takes Pi's own lock) and the subscription quota readers; capabilities come from Pi's bundled model data for the two subscription providers and are unknown for any other route. A directory the archive refuses is reported as a warning and treated as absent. Research runs over one cancellation registry keyed by the verified session and a requestId. Search uses only the ChatGPT/Codex sign-in and answers credential-missing when the Backend has no sign-in store; fetch needs no credential and refuses non-public destinations. No fixture data is ever served in the production composition. A restart empties the failure memory and says since when.",
      stateOwner: "backend-providers-state",
    },
  };
}
