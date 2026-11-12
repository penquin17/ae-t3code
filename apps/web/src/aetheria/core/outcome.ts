// Honest action outcomes (D4). An action ends in exactly one of five outcomes; success is recorded
// only from the backend's reply and a re-read of its projection. Nothing is edited optimistically,
// nothing is re-sent after an uncertain reply, and a request id does not make a send exactly-once.
// Plain TypeScript: the effect is supplied by the caller as an OutcomeStep.

/** What a send reports. `lost` means the reply never arrived: the write may or may not have landed. */
export type SendResult<T> =
  | { readonly tag: "accepted"; readonly value: T }
  | { readonly tag: "refused"; readonly code: string; readonly message: string }
  | { readonly tag: "lost" }
  | { readonly tag: "unavailable"; readonly reason: string };

/** What a re-read of the backend's projection reports after an accepted send. */
export type ConfirmResult =
  | { readonly tag: "shows" }
  | { readonly tag: "absent" }
  | { readonly tag: "failed"; readonly reason: string };

export interface OutcomeStep<T> {
  readonly label: string;
  /** Sends once with the given request id. The runner never calls it twice for one run. */
  readonly send: (requestId: string) => Promise<SendResult<T>>;
  /** Re-reads the backend's projection for the accepted value. Absent when the action has no read-back seat. */
  confirm?(accepted: T): Promise<ConfirmResult>;
}

export type FailedOutcome =
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export type ActionOutcome<T> =
  /** The backend accepted it. `refreshed` is true only when a re-read showed it. */
  | {
      readonly kind: "confirmed";
      readonly value: T;
      readonly refreshed: boolean;
      readonly message?: string;
    }
  | FailedOutcome
  /** Earlier steps applied, a later one did not: what applied and what failed, in order. */
  | {
      readonly kind: "partial";
      readonly applied: readonly string[];
      readonly failed: { readonly step: string; readonly outcome: FailedOutcome };
    };

export interface RunResult<T> {
  readonly requestId: string;
  readonly outcome: ActionOutcome<T>;
  /** False when a newer action on the same key started before this one settled; ignore it. */
  readonly current: boolean;
}

export interface ActionRunner {
  run<T>(key: string, step: OutcomeStep<T>): Promise<RunResult<T>>;
  runSequence(key: string, steps: readonly OutcomeStep<unknown>[]): Promise<RunResult<unknown[]>>;
}

export interface ActionRunnerOptions {
  /** A fresh request id per run, supplied by the host (the core holds no random source). */
  readonly newRequestId: () => string;
}

async function settle<T>(step: OutcomeStep<T>, requestId: string): Promise<ActionOutcome<T>> {
  const sent = await step.send(requestId);
  switch (sent.tag) {
    case "refused":
      return { kind: "refused", code: sent.code, message: sent.message };
    case "lost":
      return {
        kind: "unknown",
        reason: `The reply to "${step.label}" never arrived; it may or may not have been applied.`,
      };
    case "unavailable":
      return { kind: "unavailable", reason: sent.reason };
    case "accepted": {
      if (step.confirm === undefined) {
        return { kind: "confirmed", value: sent.value, refreshed: false };
      }
      const read = await step.confirm(sent.value);
      if (read.tag === "shows") return { kind: "confirmed", value: sent.value, refreshed: true };
      if (read.tag === "failed") {
        return { kind: "confirmed", value: sent.value, refreshed: false, message: read.reason };
      }
      return {
        kind: "unknown",
        reason: `"${step.label}" was accepted but the backend's projection does not show it yet.`,
      };
    }
  }
}

export function createActionRunner(options: ActionRunnerOptions): ActionRunner {
  const { newRequestId } = options;
  const latest = new Map<string, number>();
  let counter = 0;
  const begin = (key: string) => {
    counter += 1;
    latest.set(key, counter);
    return counter;
  };

  async function run<T>(key: string, step: OutcomeStep<T>): Promise<RunResult<T>> {
    const ticket = begin(key);
    const requestId = newRequestId();
    const outcome = await settle(step, requestId);
    return { requestId, outcome, current: latest.get(key) === ticket };
  }

  async function runSequence(
    key: string,
    steps: readonly OutcomeStep<unknown>[],
  ): Promise<RunResult<unknown[]>> {
    const ticket = begin(key);
    const requestId = newRequestId();
    const applied: string[] = [];
    const values: unknown[] = [];
    let refreshed = true;
    let outcome: ActionOutcome<unknown[]> | undefined;
    for (const step of steps) {
      const result = await settle(step, requestId);
      if (result.kind === "confirmed") {
        applied.push(step.label);
        values.push(result.value);
        refreshed = refreshed && result.refreshed;
        continue;
      }
      // A single step settles as confirmed or failed, never partial.
      const failed: FailedOutcome = result.kind === "partial" ? result.failed.outcome : result;
      outcome =
        applied.length === 0
          ? failed
          : { kind: "partial", applied, failed: { step: step.label, outcome: failed } };
      break;
    }
    return {
      requestId,
      outcome: outcome ?? { kind: "confirmed", value: values, refreshed },
      current: latest.get(key) === ticket,
    };
  }

  return { run, runSequence };
}
