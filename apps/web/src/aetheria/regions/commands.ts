// The Backend's region report as a T3 RPC command (M10 step 23, D17): `aetheria.regions.report` is a method of the group T3 joins (IP-3), so T3's typed client, scope check and transport carry it; the tag is
// checked against the joined group. The reply is the Backend's own value; a reply that never came is a rejection (sync.ts repeats the same whole-set report), and T3's own refusal is the contract's
// REGIONS_NOT_AUTHORIZED with T3's words. The report is a state report, not a user action: it is safe to repeat and nothing user-visible depends on it.
import type { RegionsReportPayload } from "@t3tools/aetheria-contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../../connection/runtime";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { aetheriaSendResult } from "../connection/sendResult";
import type { RegionsReply, RegionsTransport } from "./sync";

const aetheriaRegions = {
  report: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:regions:report",
    tag: "aetheria.regions.report",
  }),
} as const;

const NOT_CONNECTED: RegionsReply = {
  ok: false,
  code: "REGIONS_UNAVAILABLE",
  detail: "The region registry is not connected",
};

/** The production transport over the primary environment's connection. A rejection means the reply never came. */
export function useT3RegionsTransport(): RegionsTransport {
  const environmentId = usePrimaryEnvironmentId();
  const report = useAtomCommand(aetheriaRegions.report, { reportFailure: false });
  return {
    report: async (payload: RegionsReportPayload) => {
      if (environmentId === null) return NOT_CONNECTED;
      const sent = aetheriaSendResult(await report({ environmentId, input: payload }));
      if (sent.tag === "accepted") return sent.value as RegionsReply;
      if (sent.tag === "refused")
        return { ok: false, code: "REGIONS_NOT_AUTHORIZED", detail: sent.message };
      throw new Error("the region report's reply did not arrive");
    },
  };
}
