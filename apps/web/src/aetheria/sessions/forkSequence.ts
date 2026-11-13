import type { ActionRunner, OutcomeStep, RunResult } from "../core/outcome";

/**
 * Fork a session, then rename the fork, as one run of two steps; the rename is never attempted unless the fork
 * applied, and a rename that fails after it ends `partial` naming the fork. The rename counts as applied only
 * when its own read-back shows it: with no read-back, or an absent or failed one, it ends `partial` and unknown.
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
    // A rename with no read-back is never "shown": it ends unknown, not confirmed.
    confirm: async (accepted) =>
      renameStep?.confirm === undefined
        ? { tag: "failed", reason: "the rename has no way to be read back from the projection" }
        : renameStep.confirm(accepted),
  };
  return runner.runSequence(key, [forkStep as OutcomeStep<unknown>, secondStep]);
}
