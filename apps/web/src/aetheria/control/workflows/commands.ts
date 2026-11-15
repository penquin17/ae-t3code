// The workflow runs view's Backend calls as T3 RPC commands over the Aetheria group (M07 Plan step 29): `aetheria.workflow.runs` and `aetheria.workflow.cancel` are methods of the group T3 joins (IP-3), so T3's
// typed client, scope check and transport carry them; the tags are checked against the joined group. Each command's settled result becomes a `TransportResult`: the Backend's reply, a reply that never came
// (lost), or T3's own failure message (a scope refusal). Nothing here retries.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
import { useAtomCommand } from "../../../state/use-atom-command";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { environmentIdOf, transportResultOf } from "../transport";
import type { WorkflowsTransport } from "./types";

const aetheriaWorkflows = {
  runs: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:workflow:runs",
    tag: "aetheria.workflow.runs",
  }),
  cancel: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:workflow:cancel",
    tag: "aetheria.workflow.cancel",
  }),
} as const;

/** The production transport: the environment is named by each call, so one hook serves every root the page shows. */
export function useT3WorkflowsTransport(): WorkflowsTransport {
  const options = { reportFailure: false } as const;
  const commands = {
    runs: useAtomCommand(aetheriaWorkflows.runs, options),
    cancel: useAtomCommand(aetheriaWorkflows.cancel, options),
  };
  const call = useStableCallback(
    async (name: keyof typeof commands, environmentId: string, input: unknown) => {
      const run = commands[name] as unknown as (value: unknown) => Promise<never>;
      return transportResultOf(await run({ environmentId: environmentIdOf(environmentId), input }));
    },
  );
  const [transport] = useState<WorkflowsTransport>(() => ({
    runs: (environmentId, rootSessionId) => call("runs", environmentId, { rootSessionId }),
    cancel: (environmentId, rootSessionId, runId) =>
      call("cancel", environmentId, { rootSessionId, runId }),
  }));
  return transport;
}
