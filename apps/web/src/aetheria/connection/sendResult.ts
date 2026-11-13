// The one decoding of an Aetheria command's settled result (review finding 2): T3's `sendResultFromCommand`, then the refusal code the Backend's reply carries is reported to the connection (`reportSendResult`),
// so a revoked or expired device ends access wherever the call was made, and a denied target does not. Every Aetheria call site decodes through this and keeps its own reading of the reply after it.
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import type { SendResult } from "../core/outcome";
import { sendResultFromCommand } from "../sessions/commandResult";
import { reportSendResult } from "./callRefusals";

export function aetheriaSendResult<T>(result: AtomCommandResult<T, unknown>): SendResult<T> {
  return reportSendResult(sendResultFromCommand(result));
}
