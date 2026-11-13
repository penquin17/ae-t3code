// The stored-report read as a T3 RPC command over the Aetheria group (M10 step 10, C7): `aetheria.children.report` is a method of the group T3 joins (IP-3), checked against it at compile time.
// The production `ReportsTransport` is built from it for the environment the panel shows. The reply is the Backend's own value; T3's refusal (a device without the read scope) is shown as the
// contract's CHILDREN_NOT_AUTHORIZED with T3's words; a reply that never came is a rejection, which the view shows as unreadable, never as missing. Nothing here retries.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { aetheriaSendResult } from "../connection/sendResult";
import type { ReportReply, ReportsTransport } from "./reports";

const aetheriaChildrenReport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "aetheria:children:report",
  tag: "aetheria.children.report",
});

export function useT3ReportsTransport(environmentId: EnvironmentId): ReportsTransport {
  const report = useAtomCommand(aetheriaChildrenReport, { reportFailure: false });
  return {
    read: async ({ rootThreadId, target }): Promise<ReportReply> => {
      const sent = aetheriaSendResult(
        await report({ environmentId, input: { rootThreadId, childThreadId: target } }),
      );
      if (sent.tag === "accepted") return sent.value as ReportReply;
      if (sent.tag === "refused")
        return { ok: false, code: "CHILDREN_NOT_AUTHORIZED", detail: sent.message };
      throw new Error("the report call's reply did not arrive");
    },
  };
}
