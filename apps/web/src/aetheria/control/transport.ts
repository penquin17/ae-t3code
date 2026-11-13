// The XC-18 methods as T3 RPC commands and one change subscription (R1, C7). The tags are literals checked by `createEnvironmentRpcCommand` / the subscription helper against the joined group: a
// misspelt or removed method does not compile. Reads and actions are commands, so a re-read is always an explicit, awaited call. Each command's settled result becomes a `TransportResult`:
// the Backend's reply value, a reply that never came (lost), or T3's own failure message (a scope refusal). Nothing here retries.
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type WS_METHODS } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Stream from "effect/Stream";

import { connectionAtomRuntime } from "../../connection/runtime";
import { sendResultFromCommand } from "../sessions/commandResult";
import type { InteractionsChange, TransportResult } from "./types";

export const aetheriaControl = {
  snapshot: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:interactions:snapshot",
    tag: "aetheria.interactions.snapshot",
  }),
  planModeGet: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:plan-mode:get",
    tag: "aetheria.planMode.get",
  }),
  tasksGet: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:tasks:get",
    tag: "aetheria.tasks.get",
  }),
  answer: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:interactions:answer",
    tag: "aetheria.interactions.answer",
  }),
  cancel: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:interactions:cancel",
    tag: "aetheria.interactions.cancel",
  }),
  hold: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:interactions:hold",
    tag: "aetheria.interactions.hold",
  }),
  close: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:interactions:close",
    tag: "aetheria.interactions.close",
  }),
  planDecide: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:plan:decide",
    tag: "aetheria.plan.decide",
  }),
  planModeSet: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:plan-mode:set",
    tag: "aetheria.planMode.set",
  }),
  authorizationGrant: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:authorization:grant",
    tag: "aetheria.authorization.grant",
  }),
} as const;

/** One element of the change stream as the hook sees it: a push, the stream's end, or its failure. `n` makes two equal pushes distinct values. */
export type ChangeSignal =
  | { readonly tag: "opened" }
  | { readonly tag: "event"; readonly n: number; readonly event: InteractionsChange }
  | { readonly tag: "ended" }
  | { readonly tag: "failed"; readonly message: string };

/**
 * T3 GAP (reported, no T3 edit made): `EnvironmentSubscriptionRpcTag` (packages/client-runtime/src/rpc/client.ts:51) is a hand-kept list that does not name
 * `aetheria.interactions.changes`, so the subscription helper rejects the literal. The tag is typed as a listed stream's, the real tag string is what runs, and the element
 * type is restated below from the contract. The one-line T3 edit that removes this cast is adding the method to that list.
 */
const CHANGES_TAG =
  "aetheria.interactions.changes" as unknown as typeof WS_METHODS.subscribeServerConfig;

/** The root's change stream. Subscribing is the hook's first act; its end and its failure are values, so a closed Backend reads as unavailable and not as quiet. */
const changesFamily = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "aetheria:interactions:changes",
  tag: CHANGES_TAG,
  // `opened` is the stream's first element: the subscribe call has been made when it arrives, so the hook's first snapshot read (which waits for any element) comes after the subscribe.
  transform: (stream) =>
    Stream.concat(
      Stream.make({ tag: "opened" } as ChangeSignal),
      (stream as unknown as Stream.Stream<InteractionsChange>).pipe(
        Stream.zipWithIndex,
        Stream.map(([event, n]): ChangeSignal => ({ tag: "event", n, event })),
        Stream.concat(Stream.make({ tag: "ended" } as ChangeSignal)),
        Stream.catchCause((cause) =>
          Stream.make({ tag: "failed", message: Cause.pretty(cause) } as ChangeSignal),
        ),
      ),
    ),
});

export const interactionChanges = (environmentId: string, rootSessionId: string) =>
  changesFamily({
    environmentId: EnvironmentId.make(environmentId),
    input: { rootSessionId } as never,
  });

type Settled = Parameters<typeof sendResultFromCommand>[0];

/** A settled T3 command as a transport result. */
export function transportResultOf(result: Settled): TransportResult {
  const sent = sendResultFromCommand(result);
  if (sent.tag === "accepted") return { tag: "reply", reply: sent.value };
  if (sent.tag === "lost") return { tag: "lost" };
  return { tag: "failed", message: sent.tag === "refused" ? sent.message : sent.reason };
}

export const environmentIdOf = (id: string) => EnvironmentId.make(id);
