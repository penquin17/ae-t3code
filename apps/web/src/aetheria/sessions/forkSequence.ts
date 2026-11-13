import type { ActionRunner, OutcomeStep, RunResult } from "../core/outcome";

/**
 * Fork a session, then rename the fork, as one run of two steps. The rename is built from the fork's new
 * session only after the fork was accepted; if the fork did not apply the rename is never attempted, and a
 * rename that fails after a fork that applied ends as `partial` naming the fork. The value of a full success
 * lists the fork's new session first.
 */
export function forkThenRename<Target>(
  runner: ActionRunner,
  key: string,
  fork: OutcomeStep<Target>,
  rename: (target: Target) => OutcomeStep<unknown>,
): Promise<RunResult<unknown[]>> {
  let target: { readonly value: Target } | undefined;
  let renameStep: OutcomeStep<unknown> | undefined;
  const forkStep: OutcomeStep<Target> = {
    ...fork,
    send: async (requestId) => {
      const sent = await fork.send(requestId);
      if (sent.tag === "accepted") target = { value: sent.value };
      return sent;
    },
  };
  const secondStep: OutcomeStep<unknown> = {
    label: "Rename",
    send: async (requestId) => {
      if (target === undefined) {
        return { tag: "unavailable", reason: "the fork's new session is not known" };
      }
      renameStep = rename(target.value);
      return renameStep.send(requestId);
    },
    confirm: async (accepted) =>
      renameStep?.confirm === undefined ? { tag: "shows" } : renameStep.confirm(accepted),
  };
  return runner.runSequence(key, [forkStep as OutcomeStep<unknown>, secondStep]);
}
