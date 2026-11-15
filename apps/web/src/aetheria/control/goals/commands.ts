// The goal view's Backend calls as T3 RPC commands over the Aetheria group, and the root's change stream (M07 Plan step 18, D24, XC-23): `aetheria.goal.snapshot` and `aetheria.goal.rearm` are methods of the
// group T3 joins (IP-3), so T3's typed client, scope check and transport carry them; the tags are checked against the joined group. The grant is M10's existing `aetheria.authorization.grant`. Each command's
// settled result becomes a `TransportResult`: the Backend's reply, a reply that never came (lost), or T3's own failure message (a scope refusal). Nothing here retries.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type WS_METHODS } from "@t3tools/contracts";
import { useState } from "react";

import { useStableCallback } from "../../../hooks/useStableCallback";
import { useAtomCommand } from "../../../state/use-atom-command";
import { connectionAtomRuntime } from "../../../connection/runtime";
import { aetheriaControl, changeSignals, environmentIdOf, transportResultOf } from "../transport";
import type { GoalsTransport } from "./types";

const aetheriaGoals = {
  snapshot: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:goal:snapshot",
    tag: "aetheria.goal.snapshot",
  }),
  rearm: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:goal:rearm",
    tag: "aetheria.goal.rearm",
  }),
} as const;

/** The production transport: the environment is named by each call, so one hook serves every root the page shows. */
export function useT3GoalsTransport(): GoalsTransport {
  const options = { reportFailure: false } as const;
  const commands = {
    snapshot: useAtomCommand(aetheriaGoals.snapshot, options),
    rearm: useAtomCommand(aetheriaGoals.rearm, options),
    grant: useAtomCommand(aetheriaControl.authorizationGrant, options),
  };
  const call = useStableCallback(
    async (name: keyof typeof commands, environmentId: string, input: unknown) => {
      const run = commands[name] as unknown as (value: unknown) => Promise<never>;
      return transportResultOf(await run({ environmentId: environmentIdOf(environmentId), input }));
    },
  );
  const [transport] = useState<GoalsTransport>(() => ({
    snapshot: (environmentId, rootSessionId) => call("snapshot", environmentId, { rootSessionId }),
    grant: (environmentId, payload) => call("grant", environmentId, payload),
    rearm: (environmentId, payload) => call("rearm", environmentId, payload),
  }));
  return transport;
}

/**
 * T3 GAP (reported, no T3 edit made; the same one `control/transport.ts` keeps for `aetheria.interactions.changes`): `EnvironmentSubscriptionRpcTag` is a hand-kept list that does not name
 * `aetheria.goal.changes`, so the subscription helper rejects the literal. The tag is typed as a listed stream's and the real tag string is what runs; the element is `{rootSessionId, version}` from the contract.
 */
const GOAL_CHANGES_TAG =
  "aetheria.goal.changes" as unknown as typeof WS_METHODS.subscribeServerConfig;

const changesFamily = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "aetheria:goal:changes",
  tag: GOAL_CHANGES_TAG,
  transform: (stream) => changeSignals(stream),
});

/** The root's goal change stream. Subscribing is the hook's first act; its end and its failure are values. */
export const goalChanges = (environmentId: string, rootSessionId: string) =>
  changesFamily({
    environmentId: EnvironmentId.make(environmentId),
    input: { rootSessionId } as never,
  });
