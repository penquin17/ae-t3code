// The three Backend calls the children view makes, as supplied capabilities (M10 Plan step 10, R1). The production capability is T3's own typed client over the joined Aetheria group
// (`run/stopCommands.ts`); a test supplies fakes through the context. Each call is one settled `SendResult`: a lost reply is `lost` and is never resent by anything here.
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import type { SendResult } from "../core/outcome";
import { sendResultFromCommand } from "../sessions/commandResult";
import { aetheriaChildren } from "../run/stopCommands";

export interface ChildrenCalls {
  readonly list: (target: {
    readonly environmentId: EnvironmentId;
    readonly rootThreadId: string;
  }) => Promise<SendResult<unknown>>;
  readonly interrupt: (target: {
    readonly environmentId: EnvironmentId;
    readonly rootThreadId: string;
    readonly childThreadId: string;
  }) => Promise<SendResult<unknown>>;
  readonly close: (target: {
    readonly environmentId: EnvironmentId;
    readonly rootThreadId: string;
    readonly childThreadId: string;
  }) => Promise<SendResult<unknown>>;
}

/** Absent in production, where T3's commands are used; a test provides fakes here. */
export const ChildrenCallsContext = createContext<ChildrenCalls | null>(null);

export function useT3ChildrenCalls(): ChildrenCalls {
  const list = useAtomCommand(aetheriaChildren.list, { reportFailure: false });
  const interrupt = useAtomCommand(aetheriaChildren.interrupt, { reportFailure: false });
  const close = useAtomCommand(aetheriaChildren.close, { reportFailure: false });
  return {
    list: async ({ environmentId, rootThreadId }) =>
      sendResultFromCommand(await list({ environmentId, input: { rootThreadId } })),
    interrupt: async ({ environmentId, rootThreadId, childThreadId }) =>
      sendResultFromCommand(
        await interrupt({ environmentId, input: { rootThreadId, childThreadId } }),
      ),
    close: async ({ environmentId, rootThreadId, childThreadId }) =>
      sendResultFromCommand(await close({ environmentId, input: { rootThreadId, childThreadId } })),
  };
}
