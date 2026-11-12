// The user's Stop as T3 RPC commands over the Aetheria group (R1): `aetheria.children.*` are methods of the group T3 joins (IP-3), so T3's own typed client, scope check and
// transport carry them. The tags are literals checked by the type of `createEnvironmentRpcCommand` against the joined group: a misspelt or removed method does not compile.
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../../connection/runtime";

export const aetheriaChildren = {
  /** The root's tree Stop: M05 walks the tree itself; idle residents are left alone. Never T3's cascading `thread.stop`. */
  cancelTree: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:children:cancel-tree",
    tag: "aetheria.children.cancelTree",
  }),
  /** The root's open descendants with their mode and state: how a per-child Stop chooses interrupt or close. */
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:children:list",
    tag: "aetheria.children.list",
  }),
  /** A continuable child's turn ends; the child stays open. */
  interrupt: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:children:interrupt",
    tag: "aetheria.children.interrupt",
  }),
  /** A one-shot child is closed. */
  close: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:children:close",
    tag: "aetheria.children.close",
  }),
} as const;
