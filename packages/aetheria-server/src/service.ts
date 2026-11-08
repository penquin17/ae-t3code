// AETHERIA — the assembled Backend service: it owns the assembly only; adapter.ts owns validation, lifecycle and the XC-7 report, apps/server owns the Effect wiring.
// Parts that must agree (status and digest, XC-6 identity port, operation table, `ingest`, `noteFeed`) are built here once.
// Fail closed: not started, failed or drained answers unavailable, and a piece that cannot be built throws at construction.
import {
  IDENTITY_LIFECYCLE_OPERATION,
  type AetheriaCompositionStatus,
  type Xc6Operation,
} from "@t3tools/aetheria-contracts";

import { prepareAetheriaBackend, type AetheriaBackendOptions } from "./aetheriaBackend.ts";
import type { BackendAdapter, BackendRegistration } from "./adapter.ts";
import { createAgentAwarenessBackendRegistration } from "./agentAwareness.ts";
import { createIdentityFeed, type StoredEventLike } from "./identity/feed.ts";
import { createIdentityReader } from "./identity/backendEntry.ts";
import { createLifecycleTracker, type LifecycleTracker } from "./identity/lifecycle.ts";
import {
  createIdentityResolver,
  XC6_IDENTITY_UNAVAILABLE,
  type IdentityCaller,
  type IdentityResolution,
} from "./identity/resolver.ts";
import { createThreadIndex, type ThreadIndex } from "./identity/threadIndex.ts";
import type { DisposalReport, Fault, StartResult } from "./library.ts";
import {
  createLivenessService,
  type LivenessService,
  type UnknownReason,
} from "./liveness/service.ts";
import { createIdentityLifecycleOperation } from "./operations/identityLifecycle.ts";
import { createGit, type GitPort } from "./board/git.ts";
import { parseAwarenessConfig } from "./library.ts";
import {
  createBoardRuntime,
  type BoardRuntime,
  type BoardRuntimeOptions,
} from "./board/runtime.ts";

export interface AetheriaBackendServiceOptions {
  /** The Aetheria state root the Agent host also uses (`AETHERIA_STATE_ROOT`): a normalised absolute path. */
  readonly stateRoot: string;
  /** T3's current MCP credential id for a thread (the id its bearer proves), or undefined when T3 holds none. */
  readonly credentialOf: (threadId: string) => string | undefined | Promise<string | undefined>;
  readonly projectRootOf?: (workingFolder: string) => string | null;
  readonly now?: () => number;
  /** Test seam: another manifest to prove a mixed composition is refused. */
  readonly manifest?: AetheriaBackendOptions["manifest"];
  /** The awareness evidence parameters (idleMs, summaryMaxBytes of at least 512, failOpen, enabled); omitted fields take DSH's defaults. */
  readonly awareness?: unknown;
  /** The Git port for the workspace and for restart reconciliation. Default: the real `git`. */
  readonly git?: GitPort;
  /** The owned-child status of XC-10. Absent in production (M05): `assign` is unavailable. Only a test supplies it. */
  readonly childStatus?: BoardRuntimeOptions["childStatus"];
}

export interface AetheriaBackendService {
  /** Boot the thread index, then validate-and-start the composition. A second call returns the first result. */
  start(): Promise<StartResult>;
  /** Drain in reverse start order, once. A reason is required. */
  dispose(reason: string): Promise<DisposalReport>;
  status(): AetheriaCompositionStatus;
  /** The published composition digest (digest v1, host `backend`). */
  digest(): AetheriaCompositionStatus["digest"];
  /** The XC-6 identity port: production resolution, unavailable unless the Backend is running. */
  identity(caller: IdentityCaller, claimedSessionId: string | null): IdentityResolution;
  /** The adapter's gated operation table. */
  operations(): Readonly<Record<string, Xc6Operation>>;
  /** Apply one stored T3 event (unfiltered stream order). Never throws. */
  ingest(stored: StoredEventLike): Promise<void>;
  /** The highest event sequence that existed before the feed was subscribed: liveness from older events is unknown for the board. */
  setReplayHorizon(sequence: number): void;
  /** The board of each workspace and what restart reconciliation did to it; `settled` waits for the close-on-stop in flight. */
  readonly board: Pick<BoardRuntime, "reconciled" | "settled">;
  /** The stream ended or failed: every holder becomes unknown until observed again. */
  noteFeed(reason: Extract<UnknownReason, "feed-ended" | "feed-failed">): void;
  readonly liveness: LivenessService;
  readonly index: ThreadIndex;
  readonly tracker: LifecycleTracker;
  readonly backend: BackendAdapter;
}

export type CreateServiceResult =
  | { readonly outcome: "refused"; readonly faults: readonly Fault[] }
  | { readonly outcome: "prepared"; readonly service: AetheriaBackendService };

export function createAetheriaBackendService(
  options: AetheriaBackendServiceOptions,
): CreateServiceResult {
  const index = createThreadIndex({
    stateRoot: options.stateRoot,
    ...(options.projectRootOf === undefined ? {} : { projectRootOf: options.projectRootOf }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const tracker = createLifecycleTracker({ index });
  const liveness = createLivenessService(options.now === undefined ? {} : { now: options.now });
  const resolver = createIdentityResolver({
    reader: createIdentityReader({ stateRoot: options.stateRoot }),
    index,
  });
  const feed = createIdentityFeed({ index, tracker, credentialOf: options.credentialOf });

  const config = parseAwarenessConfig(options.awareness);
  if (!config.ok)
    return {
      outcome: "refused",
      faults: [
        {
          code: "awareness-config-invalid",
          subject: "config",
          field: config.field,
          message: config.message,
        },
      ],
    };
  const board = createBoardRuntime({
    stateRoot: options.stateRoot,
    index,
    liveness,
    config: config.config,
    now: options.now ?? Date.now,
    git: options.git ?? createGit(),
    childStatus: options.childStatus,
  });

  const registration: BackendRegistration = createAgentAwarenessBackendRegistration({
    operations: {
      [IDENTITY_LIFECYCLE_OPERATION]: createIdentityLifecycleOperation({ tracker, index }),
      ...board.operations(),
    },
    drainBoards: () => board.drain(),
  });
  const prepared = prepareAetheriaBackend({
    registrations: [registration],
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
  });
  if (prepared.outcome === "refused") return { outcome: "refused", faults: prepared.faults };
  const { backend } = prepared;

  const running = (): boolean => backend.status().phase === "running";
  let started: Promise<StartResult> | undefined;

  const service: AetheriaBackendService = {
    start() {
      started ??= (async () => {
        index.boot();
        const result = await backend.start();
        // Sessions this Backend cannot show to be live are closed before any operation is answered for them (a failed board is retried at first use).
        if (result.outcome === "started") await board.reconcileAtStart();
        return result;
      })();
      return started;
    },
    dispose: (reason) => backend.dispose(reason),
    status: () => backend.status(),
    digest: () => backend.status().digest,
    identity(caller, claimedSessionId) {
      if (!running())
        return Object.freeze({
          ok: false as const,
          outcome: "unavailable" as const,
          code: XC6_IDENTITY_UNAVAILABLE,
          reason: "backend-not-running",
        });
      return resolver.resolve(caller, claimedSessionId);
    },
    operations: () => backend.operations(),
    async ingest(stored) {
      try {
        const event = stored?.event;
        if (
          event !== undefined &&
          typeof stored.sequence === "number" &&
          typeof event.type === "string" &&
          typeof event.threadId === "string"
        ) {
          liveness.ingest({
            sequence: stored.sequence,
            type: event.type,
            threadId: event.threadId,
            ...(event.payload === undefined ? {} : { payload: event.payload }),
          });
        }
        await feed.ingest(stored);
      } catch {
        /* a bad event is dropped; liveness marks its own gaps */
      }
    },
    noteFeed: (reason) => liveness.noteGap(reason),
    setReplayHorizon: (sequence) => board.setReplayHorizon(sequence),
    board,
    liveness,
    index,
    tracker,
    backend,
  };
  return { outcome: "prepared", service: Object.freeze(service) };
}
