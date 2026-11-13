// The four Backend calls the jobs panel makes, as one supplied capability (M10 Plan step 18, D14, D20, XC-15/16). The transport interface is this panel's own. The production default is the real T3 RPC
// commands (`aetheria.jobs.list`, `.output`, `.outbox.list`, `.kill`, in `commands.ts`); a host or test supplies another through `JobsTransportContext`, and `UNAVAILABLE_JOBS` is the transport of a
// panel with no connection: it answers `JOBS_UNAVAILABLE` in words that say so, so the panel never shows an empty list for a call that was never made. Each call resolves with the Backend's reply
// (`{ ok, value }` or `{ ok: false, code, detail? }`) and rejects when no reply arrived; nothing here retries, and no call acknowledges anything.
import { createContext, use } from "react";

import { useT3JobsTransport } from "./commands";
import type { Reply } from "./reply";

export interface JobsTarget {
  readonly environmentId: string;
  readonly rootThreadId: string;
}
export interface JobsTransport {
  readonly list: (request: JobsTarget) => Promise<Reply<unknown>>;
  /** Reads each stream from an explicit byte offset: the panel never asks for "the next unread" and never assumes a cursor. */
  readonly output: (
    request: JobsTarget & {
      readonly jobId: string;
      readonly offsets: { readonly stdout: number; readonly stderr: number };
    },
  ) => Promise<Reply<unknown>>;
  /** Lists the notices in the root's outbox. It only reads; nothing in this interface acknowledges, inserts or withdraws a notice. */
  readonly outbox: (request: JobsTarget) => Promise<Reply<unknown>>;
  readonly kill: (request: JobsTarget & { readonly jobId: string }) => Promise<Reply<unknown>>;
}

const JOBS_NOT_CONNECTED = "Jobs are not connected yet (M05 user read).";
const unavailable = (): Promise<Reply<unknown>> =>
  Promise.resolve({ ok: false, code: "JOBS_UNAVAILABLE", detail: JOBS_NOT_CONNECTED });

/** A transport for a panel with no connection: nothing is read, and nothing is claimed about any job. */
export const UNAVAILABLE_JOBS: JobsTransport = {
  list: unavailable,
  output: unavailable,
  outbox: unavailable,
  kill: unavailable,
};

/** Absent in production, where the real commands are used; a host or test provides another here. */
export const JobsTransportContext = createContext<JobsTransport | null>(null);
/** The provided transport, else the real one. Both always run, so the order of hooks never changes. */
export const useJobsTransport = (): JobsTransport => {
  const real = useT3JobsTransport();
  return use(JobsTransportContext) ?? real;
};
