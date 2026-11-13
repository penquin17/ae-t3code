// The group store's client: the last confirmed record as a Known<GroupRecord>, and the five changes. Each is
// sent once through the action runner and counts as done only when the Backend accepted it and a re-read shows
// the effect. Calls run one at a time, so a send and its re-read never interleave. No optimistic edit.
import { gateOnConnection } from "../connection/gate";
import { known, unavailable, unknown, type Known } from "../core/known";
import {
  createActionRunner,
  type ConfirmResult,
  type OutcomeStep,
  type RunResult,
} from "../core/outcome";
import { detachBody, effectShown, pairBody, renameBody, type BuiltBody } from "./operations";
import type { GroupRecord } from "./record";
import { changeSendResult, readResult, type ReadResult } from "./reply";
import type { GroupsTransport } from "./transport";

export interface GroupsProblem {
  readonly code: string;
  readonly message: string;
}
export interface GroupsState {
  /** The last record the Backend confirmed; never a guess, and empty only when the Backend said so. */
  readonly record: Known<GroupRecord>;
  /** Why the latest read failed while an earlier confirmed record is still shown; cleared by the next good read. */
  readonly problem: GroupsProblem | undefined;
}

export interface GroupsStore {
  getState(): GroupsState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  group(a: string, b: string): Promise<RunResult<GroupRecord>>;
  ungroup(a: string, b: string): Promise<RunResult<GroupRecord>>;
  dismiss(a: string, b: string): Promise<RunResult<GroupRecord>>;
  detach(sessionId: string): Promise<RunResult<GroupRecord>>;
  rename(members: readonly string[], name: string): Promise<RunResult<GroupRecord>>;
}

export interface GroupsStoreOptions {
  readonly transport: GroupsTransport;
  readonly newRequestId: () => string;
  /** How long one read may take before it is shown as not read. A late answer is still taken if nothing newer has been read. */
  readonly readTimeoutMs?: number;
}

const DEFAULT_READ_TIMEOUT_MS = 5000;
const NOT_REACHED: ReadResult = {
  tag: "failed",
  code: "GROUPS_READ_FAILED",
  reason: "The read did not reach the Backend.",
};
const TIMED_OUT: ReadResult = {
  tag: "failed",
  code: "GROUPS_READ_TIMEOUT",
  reason: "The Backend did not answer the groups read in time.",
};

const KEY = "groups";

export function createGroupsStore(options: GroupsStoreOptions): GroupsStore {
  const { transport } = options;
  const runner = createActionRunner({ newRequestId: options.newRequestId });
  const listeners = new Set<() => void>();
  let state: GroupsState = {
    record: unknown("The saved groups have not been read yet."),
    problem: undefined,
  };
  const setState = (next: GroupsState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const absorb = (result: ReadResult) => {
    switch (result.tag) {
      case "record":
        setState({ record: known(result.record), problem: undefined });
        return;
      case "unavailable":
        setState(
          state.record.state === "known"
            ? { record: state.record, problem: { code: result.code, message: result.reason } }
            : { record: unavailable(result.reason), problem: undefined },
        );
        return;
      case "unsupported":
        setState({
          record: state.record.state === "known" ? state.record : unavailable(result.reason),
          problem: { code: "unsupported", message: result.reason },
        });
        return;
      case "failed":
        setState({
          record: state.record.state === "known" ? state.record : unknown(result.reason),
          problem: { code: result.code, message: result.reason },
        });
        return;
    }
  };

  // Each read is numbered; a read that outlives its bound is shown as failed, and its late answer is taken only
  // if no newer read has started, so an old answer never replaces a newer one.
  let latestRead = 0;
  const readNow = async (): Promise<ReadResult> => {
    latestRead += 1;
    const mine = latestRead;
    const attempt: Promise<ReadResult> = Promise.resolve()
      .then(() => transport.read())
      .then(readResult, () => NOT_REACHED);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<"timed out">((resolve) => {
      timer = setTimeout(
        () => resolve("timed out"),
        options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
      );
    });
    const first = await Promise.race([attempt, bound]);
    clearTimeout(timer);
    if (first === "timed out") {
      absorb(TIMED_OUT);
      void attempt.then((late) => {
        if (mine === latestRead) absorb(late);
      });
      return TIMED_OUT;
    }
    absorb(first);
    return first;
  };

  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return run;
  };

  const stepFor = (label: string, built: BuiltBody): OutcomeStep<GroupRecord> => {
    // A body refused locally is never sent: the step settles as a refusal with the reason.
    if (!built.ok) {
      return {
        label,
        send: async () => ({ tag: "refused", code: built.code, message: built.reason }),
      };
    }
    const { body } = built;
    // A change is sent only while the connection allows actions, judged when it is sent; a blocked one is never queued (the read that confirms a sent one is not an action).
    return gateOnConnection({
      label,
      send: async () => {
        let reply: unknown;
        try {
          reply = await transport.apply(body);
        } catch {
          return { tag: "lost" };
        }
        return changeSendResult(reply);
      },
      confirm: async (): Promise<ConfirmResult> => {
        const read = await readNow();
        if (read.tag !== "record") return { tag: "failed", reason: read.reason };
        return effectShown(body, read.record) ? { tag: "shows" } : { tag: "absent" };
      },
    });
  };

  const change = (label: string, built: BuiltBody) =>
    enqueue(() => runner.run(KEY, stepFor(label, built)));

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: () => enqueue(async () => void (await readNow())),
    group: (a, b) => change("Group", pairBody("group", a, b)),
    ungroup: (a, b) => change("Ungroup", pairBody("ungroup", a, b)),
    dismiss: (a, b) => change("Dismiss suggestion", pairBody("dismiss", a, b)),
    detach: (sessionId) => change("Detach", detachBody(sessionId)),
    rename: (members, name) => change("Rename group", renameBody(members, name)),
  };
}
