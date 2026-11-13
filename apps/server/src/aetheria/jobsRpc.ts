// @effect-diagnostics globalTimers:off globalRandom:off tryCatchInEffectGen:off preferSchemaOverJson:off anyUnknownInErrorContext:off
// AETHERIA M10 Plan step 18 (D14, D20, R3, XC-15, XC-16; IP-54 to IP-56) — the handlers behind `aetheria.jobs.list`, `.output`, `.outbox.list` and `.kill`: a root's jobs, one job's output read at
// explicit offsets, the root's completion-outbox rows and the user's kill, over M05's DIRECT Backend API (`orchestration().direct()`), never XC-6 and never model input.
//
// Authority, in the order the checks run (the shared gate, `rootGate.ts`): T3 authorizes the method's scope before a handler runs (the three reads `orchestration:read`, the kill
// `orchestration:operate`); the actor is built only from the connection; the device session is re-read on EVERY call; the scope is checked again; the named root is a main thread the host's
// access rule lets the connection reach. Only then is M05 called, with the trusted user caller `{user:true}` that no payload can supply.
//
// M05's four user calls (`listJobs`, `readJobOutput`, `killJob`, `listOutbox`) are typed here as `JobsUserCalls`, the shape M05's direct API exposes (`direct/jobs.ts`, `direct/outbox.ts` in the
// orchestration archive); `direct()` is read through that interface and a missing function answers `JOBS_UNAVAILABLE` "not connected yet (M05 user read)", never an empty list and never a stand-in store.
// Three shapes differ from the client's and are reconciled here, not in M05: (1) `readJobOutput` takes ONE `offset` and an optional `stream`, but the client holds a position per stream, so the
// handler reads once per stream, stdout then stderr, each at its own offset; the chunks are merged in that order and the envelope (state, exit, flags) is the later read's, the freshest sighting.
// A failure of either read is the whole read's failure. (2) `listJobs` and `listOutbox` answer `{…, unreadable}`: the count travels to the client, which then says the list is not complete.
// (3) an outbox row carries its `owner`; the client's row does not, and the contract's schema drops it.
//
// A job is read or killed only after M05's user list of the named root shows it: the output read and the kill name a job but a root only through the list, so the membership check is what
// stops a connection from reaching a job of a root it may not (the same rule as the children handlers' membership check). The output read passes the browser's explicit offsets and calls
// nothing else: it never moves the agent's cursor and never waits. The outbox list only lists: viewing acknowledges nothing. The kill is EXACTLY ONE `killJob` call: nothing retries it.
//
// What a reply says. `ok:true` carries M05's value through the contract's own schema, so only its fields travel and a flag such as an unconfirmed termination or an uncertain delivery stays
// visible. A refusal carries a Backend code, or one of M05's the calls can return, passed through with its detail. A read that throws, answers a code the call cannot return or a value that does
// not fit is `JOBS_UNAVAILABLE` (nothing changed); a kill that does is `JOBS_OUTCOME_UNKNOWN`: it may have landed, so the client reads the list and never resends.
import {
  ClientJobsKillResult,
  ClientJobsListResult,
  ClientJobsOutboxListResult,
  ClientJobsOutputResult,
  JOBS_PASSTHROUGH_CODES,
  type ClientJobsKillPayload,
  type ClientJobsListPayload,
  type ClientJobsOutboxListPayload,
  type ClientJobsOutputPayload,
  type ClientJobsOutputValue,
  type JobsControlCode,
} from "@t3tools/aetheria-contracts";
import type { AetheriaBackendService, ClientActor } from "@t3tools/aetheria-server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OPERATE_SCOPE, READ_SCOPE, guardedRoot, type GateCodes } from "./rootGate.ts";

/** The call shape of M05's user functions: the trusted user caller and the named root, never anything a payload supplies. */
type UserCall<Args> = (input: {
  readonly caller: { readonly user: true };
  readonly args: Args;
}) => Promise<unknown>;

/** What M05's direct API is to expose for the user's jobs view (M05 steps 15 to 20); until it lands `direct()` lacks these and the handlers say so. */
export interface JobsUserCalls {
  readonly listJobs: UserCall<{ readonly rootThreadId: string }>;
  /** Reads one stream (or both, when `stream` is absent) from one byte offset. Never moves the agent's cursor and never waits. */
  readonly readJobOutput: UserCall<{
    readonly rootThreadId: string;
    readonly jobId: string;
    readonly offset?: number;
    readonly stream?: "stdout" | "stderr";
  }>;
  readonly killJob: UserCall<{ readonly rootThreadId: string; readonly jobId: string }>;
  readonly listOutbox: UserCall<{ readonly rootThreadId: string }>;
}

type Service = Pick<
  AetheriaBackendService,
  "interactions" | "orchestration" | "index" | "identityKind"
>;
export type Backend = Option.Option<Service>;

/** The reason a missing user call gives, word for word. */
const JOBS_NOT_CONNECTED = "not connected yet (M05 user read)";

const ACTION_CODES: GateCodes<JobsControlCode> = {
  notAuthorized: "JOBS_NOT_AUTHORIZED",
  deviceRevoked: "JOBS_DEVICE_REVOKED",
  notFound: "JOBS_NOT_FOUND",
  unavailable: "JOBS_UNAVAILABLE",
  nothing: "done",
};
const READ_CODES: GateCodes<JobsControlCode> = { ...ACTION_CODES, nothing: "read" };

type Failure = { readonly ok: false; readonly code: string; readonly detail?: string };
type Reply = { readonly ok: true; readonly value: unknown } | Failure;
const refuse = (code: JobsControlCode, detail: string): Failure => ({ ok: false, code, detail });
const unavailableDone = (detail: string) =>
  refuse("JOBS_UNAVAILABLE", `${detail}; nothing was done`);
const unavailableRead = (detail: string) =>
  refuse("JOBS_UNAVAILABLE", `${detail}; nothing was read`);
const unknownOutcome = (detail: string) =>
  refuse("JOBS_OUTCOME_UNKNOWN", `${detail}; the effect may or may not have landed`);

const isPassthrough = (code: unknown): code is (typeof JOBS_PASSTHROUGH_CODES)[number] =>
  typeof code === "string" && (JOBS_PASSTHROUGH_CODES as readonly string[]).includes(code);

/**
 * M05's outcome as a client reply, through the contract's own reply schema so only its fields travel. A refusal with a code these calls can return passes through with its detail; an
 * unknown code, a malformed value or no outcome becomes `bad`: `unavailable` for a read, `unknown outcome` for the kill.
 */
const settle = (schema: Schema.Top, outcome: unknown, bad: (detail: string) => Failure): Reply => {
  if (outcome === null || typeof outcome !== "object")
    return bad("the jobs service gave no outcome");
  const reply = outcome as {
    readonly ok?: unknown;
    readonly value?: unknown;
    readonly code?: unknown;
    readonly detail?: unknown;
  };
  if (reply.ok === false)
    return isPassthrough(reply.code)
      ? {
          ok: false,
          code: reply.code,
          ...(typeof reply.detail === "string" ? { detail: reply.detail } : {}),
        }
      : bad("the jobs service answered with a code this call cannot return");
  if (reply.ok !== true) return bad("the jobs service gave no outcome");
  try {
    return Schema.decodeUnknownSync(schema as never)({ ok: true, value: reply.value }) as Reply;
  } catch {
    return bad("the jobs service's value does not fit its contract");
  }
};

/** M05's direct API through the jobs interface: the named functions, or the failure when no service runs or one is not (yet) exposed. */
const userCalls = (
  service: Service,
  names: ReadonlyArray<keyof JobsUserCalls>,
  unavailable: (detail: string) => Failure,
): { readonly calls: JobsUserCalls } | { readonly failure: Failure } => {
  const direct = service.orchestration()?.direct() as unknown as Partial<JobsUserCalls> | undefined;
  if (direct === undefined) return { failure: unavailable("the children service is not running") };
  for (const name of names)
    if (typeof direct[name] !== "function")
      return { failure: { ok: false, code: "JOBS_UNAVAILABLE", detail: JOBS_NOT_CONNECTED } };
  return { calls: direct as JobsUserCalls };
};

const USER = { user: true } as const;

/** M05's user list of the named root: its job ids, or the failure that leaves the root's membership unproven. */
const listedJobIds = async (
  list: JobsUserCalls["listJobs"],
  rootThreadId: string,
): Promise<{ readonly ids: ReadonlyArray<string> } | { readonly unproven: true }> => {
  let outcome: unknown;
  try {
    outcome = await list({ caller: USER, args: { rootThreadId } });
  } catch {
    return { unproven: true };
  }
  const settled = settle(ClientJobsListResult, outcome, unavailableRead);
  if (!settled.ok) return { unproven: true };
  const jobs = (settled.value as { jobs: ReadonlyArray<{ jobId: string }> }).jobs;
  return { ids: jobs.map((job) => job.jobId) };
};

/** A list or outbox read: the gate, the connected call, one M05 call, the reply through the contract. A failed read changed nothing. */
const readRoot = <A>(
  backend: Backend,
  actor: ClientActor,
  rootThreadId: string,
  name: "listJobs" | "listOutbox",
  schema: Schema.Top,
): Effect.Effect<A> =>
  guardedRoot(
    backend,
    actor,
    READ_SCOPE,
    rootThreadId,
    READ_CODES,
    async (gate): Promise<Reply> => {
      const found = userCalls(gate.service, [name], unavailableRead);
      if ("failure" in found) return found.failure;
      return settle(
        schema,
        await found.calls[name]({ caller: USER, args: { rootThreadId } }),
        unavailableRead,
      );
    },
    () => unavailableRead("the jobs call failed"),
  ) as Effect.Effect<A>;

export const jobsList = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientJobsListPayload,
): Effect.Effect<ClientJobsListResult> =>
  readRoot<ClientJobsListResult>(
    backend,
    actor,
    payload.rootThreadId,
    "listJobs",
    ClientJobsListResult,
  );

/** The root's completion-outbox rows. Viewing acknowledges nothing and moves no delivery. */
export const jobsOutboxList = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientJobsOutboxListPayload,
): Effect.Effect<ClientJobsOutboxListResult> =>
  readRoot<ClientJobsOutboxListResult>(
    backend,
    actor,
    payload.rootThreadId,
    "listOutbox",
    ClientJobsOutboxListResult,
  );

/** One job's output at the explicit offsets, for a job the root's own list shows: one M05 read per stream, merged (see the header). */
export const jobsOutput = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientJobsOutputPayload,
): Effect.Effect<ClientJobsOutputResult> =>
  guardedRoot(
    backend,
    actor,
    READ_SCOPE,
    payload.rootThreadId,
    READ_CODES,
    async (gate): Promise<Reply> => {
      const found = userCalls(gate.service, ["listJobs", "readJobOutput"], unavailableRead);
      if ("failure" in found) return found.failure;
      const listed = await listedJobIds(found.calls.listJobs, payload.rootThreadId);
      if ("unproven" in listed) return unavailableRead("the root's jobs could not be listed");
      if (!listed.ids.includes(payload.jobId))
        return refuse("JOBS_NOT_FOUND", "not available to this connection");
      const chunks: Array<ClientJobsOutputValue["streams"][number]> = [];
      let envelope: ClientJobsOutputValue | undefined;
      for (const stream of ["stdout", "stderr"] as const) {
        const read = settle(
          ClientJobsOutputResult,
          await found.calls.readJobOutput({
            caller: USER,
            args: {
              rootThreadId: payload.rootThreadId,
              jobId: payload.jobId,
              offset: payload.offsets[stream],
              stream,
            },
          }),
          unavailableRead,
        );
        if (!read.ok) return read;
        const value = read.value as ClientJobsOutputValue;
        if (value.streams.length !== 1 || value.streams[0]?.stream !== stream)
          return unavailableRead("the jobs service did not answer the stream that was asked for");
        chunks.push(value.streams[0]!);
        envelope = value;
      }
      return envelope === undefined
        ? unavailableRead("the jobs service gave no outcome")
        : { ok: true, value: { ...envelope, streams: chunks } };
    },
    () => unavailableRead("the jobs call failed"),
  ) as Effect.Effect<ClientJobsOutputResult>;

/** The user's kill of one job the root's own list shows: exactly one `killJob` call, never repeated. */
export const jobsKill = (
  backend: Backend,
  actor: ClientActor,
  payload: ClientJobsKillPayload,
): Effect.Effect<ClientJobsKillResult> =>
  guardedRoot(
    backend,
    actor,
    OPERATE_SCOPE,
    payload.rootThreadId,
    ACTION_CODES,
    async (gate): Promise<Reply> => {
      const found = userCalls(gate.service, ["listJobs", "killJob"], unavailableDone);
      if ("failure" in found) return found.failure;
      const listed = await listedJobIds(found.calls.listJobs, payload.rootThreadId);
      if ("unproven" in listed) return unavailableDone("the root's jobs could not be listed");
      if (!listed.ids.includes(payload.jobId))
        return refuse("JOBS_NOT_FOUND", "not available to this connection");
      let outcome: unknown;
      try {
        outcome = await found.calls.killJob({
          caller: USER,
          args: { rootThreadId: payload.rootThreadId, jobId: payload.jobId },
        });
      } catch {
        return unknownOutcome("the kill call failed");
      }
      return settle(ClientJobsKillResult, outcome, unknownOutcome);
    },
    () => unknownOutcome("the jobs call failed"),
  ) as Effect.Effect<ClientJobsKillResult>;
