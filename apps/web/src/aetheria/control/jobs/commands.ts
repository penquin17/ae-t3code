// The jobs panel's four Backend calls as T3 RPC commands over the Aetheria group (M10 Plan step 18, D14, D20, XC-15/16): `aetheria.jobs.list`, `.output`, `.outbox.list` and `.kill` are methods of the
// group T3 joins (IP-3), so T3's typed client, scope check and transport carry them; the tags are checked against the joined group (a misspelt or removed method does not compile). The reply is the
// Backend's own value. T3's own refusal (a device without the read or operate scope) is the contract's JOBS_NOT_AUTHORIZED with T3's words: the handler never ran, so nothing was done. A reply that
// never came is a rejection, which the panel shows as unknown (a read) or as a lost kill that is never sent again. Nothing here retries and nothing acknowledges a notice.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../../connection/runtime";
import { useAtomCommand } from "../../../state/use-atom-command";
import { sendResultFromCommand } from "../../sessions/commandResult";
import type { Reply } from "./reply";
import type { JobsTransport } from "./transport";

const aetheriaJobs = {
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:jobs:list",
    tag: "aetheria.jobs.list",
  }),
  output: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:jobs:output",
    tag: "aetheria.jobs.output",
  }),
  outbox: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:jobs:outbox",
    tag: "aetheria.jobs.outbox.list",
  }),
  kill: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:jobs:kill",
    tag: "aetheria.jobs.kill",
  }),
} as const;

/** The production transport: the environment is named by each request, so one hook serves every root the page shows. */
export function useT3JobsTransport(): JobsTransport {
  const list = useAtomCommand(aetheriaJobs.list, { reportFailure: false });
  const output = useAtomCommand(aetheriaJobs.output, { reportFailure: false });
  const outbox = useAtomCommand(aetheriaJobs.outbox, { reportFailure: false });
  const kill = useAtomCommand(aetheriaJobs.kill, { reportFailure: false });
  const settle = (sent: ReturnType<typeof sendResultFromCommand<unknown>>): Reply<unknown> => {
    if (sent.tag === "accepted") return sent.value as Reply<unknown>;
    if (sent.tag === "refused")
      return { ok: false, code: "JOBS_NOT_AUTHORIZED", detail: sent.message };
    throw new Error("the jobs call's reply did not arrive");
  };
  return {
    list: async ({ environmentId, rootThreadId }) =>
      settle(
        sendResultFromCommand(
          await list({ environmentId: environmentId as EnvironmentId, input: { rootThreadId } }),
        ),
      ),
    output: async ({ environmentId, rootThreadId, jobId, offsets }) =>
      settle(
        sendResultFromCommand(
          await output({
            environmentId: environmentId as EnvironmentId,
            input: {
              rootThreadId,
              jobId,
              offsets: { stdout: offsets.stdout, stderr: offsets.stderr },
            },
          }),
        ),
      ),
    outbox: async ({ environmentId, rootThreadId }) =>
      settle(
        sendResultFromCommand(
          await outbox({ environmentId: environmentId as EnvironmentId, input: { rootThreadId } }),
        ),
      ),
    kill: async ({ environmentId, rootThreadId, jobId }) =>
      settle(
        sendResultFromCommand(
          await kill({
            environmentId: environmentId as EnvironmentId,
            input: { rootThreadId, jobId },
          }),
        ),
      ),
  };
}
