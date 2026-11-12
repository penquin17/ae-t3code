import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";

import type { SendResult } from "../core/outcome";

/**
 * Maps one settled T3 command into the action runner's send result. T3's result does not separate a
 * lost reply from a refusal, so this uses what it can see: an interrupt or a transport-connection
 * error may have reached the backend (lost); any other failure is a refusal that carries T3's own
 * message. A transport message T3 phrases differently would be shown as a refusal.
 */
export function sendResultFromCommand<T>(result: AtomCommandResult<T, unknown>): SendResult<T> {
  if (result._tag === "Success") return { tag: "accepted", value: result.value };
  if (isAtomCommandInterrupted(result)) return { tag: "lost" };
  const error = squashAtomCommandFailure(result);
  const message = error instanceof Error && error.message !== "" ? error.message : undefined;
  if (isTransportConnectionErrorMessage(message ?? String(error))) return { tag: "lost" };
  return { tag: "refused", code: "COMMAND_FAILED", message: message ?? "The action failed." };
}
