// The usage panel's one Backend call as a T3 RPC command over the Aetheria group (M10 Plan step 18, D14, D20, XC-11): `aetheria.usage.read` is a method of the group T3 joins (IP-3). The Backend's value
// keeps what could and could not be read apart; `usageFromContract` turns it into what the panel reads, carrying everything unread as a note. T3's own refusal (a device without the read scope) is the
// contract's USAGE_NOT_AUTHORIZED with T3's words; a reply that never came is a rejection, which the panel shows as unknown. The call only reads and is never retried here.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../../connection/runtime";
import { useAtomCommand } from "../../../state/use-atom-command";
import { sendResultFromCommand } from "../../sessions/commandResult";
import type { Reply } from "../jobs/reply";
import { usageFromContract } from "./adapt";
import type { UsageTransport } from "./transport";

const aetheriaUsageRead = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "aetheria:usage:read",
  tag: "aetheria.usage.read",
});

export function useT3UsageTransport(): UsageTransport {
  const read = useAtomCommand(aetheriaUsageRead, { reportFailure: false });
  return {
    read: async ({ environmentId, rootThreadId }): Promise<Reply<unknown>> => {
      const sent = sendResultFromCommand(
        await read({ environmentId: environmentId as EnvironmentId, input: { rootThreadId } }),
      );
      if (sent.tag === "refused")
        return { ok: false, code: "USAGE_NOT_AUTHORIZED", detail: sent.message };
      if (sent.tag !== "accepted") throw new Error("the usage call's reply did not arrive");
      const reply = sent.value as Reply<unknown>;
      return reply.ok ? { ok: true, value: usageFromContract(reply.value) } : reply;
    },
  };
}
