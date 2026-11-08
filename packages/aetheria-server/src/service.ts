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

export interface AetheriaBackendServiceOptions {
  /** The Aetheria state root the Agent host also uses (`AETHERIA_STATE_ROOT`): a normalised absolute path. */
  readonly stateRoot: string;
  /** T3's current MCP credential id for a thread (the id its bearer proves), or undefined when T3 holds none. */
  readonly credentialOf: (threadId: string) => string | undefined | Promise<string | undefined>;
  readonly projectRootOf?: (workingFolder: string) => string | null;
  readonly now?: () => number;
  /** Test seam: another manifest to prove a mixed composition is refused. */
  readonly manifest?: AetheriaBackendOptions["manifest"];
  /** Additional registrations are not admitted here; sub-phase 4 extends `createAgentAwarenessBackendRegistration`'s operations instead. */
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

  const registration: BackendRegistration = createAgentAwarenessBackendRegistration({
    operations: {
      [IDENTITY_LIFECYCLE_OPERATION]: createIdentityLifecycleOperation({ tracker, index }),
    },
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
        return backend.start();
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
    liveness,
    index,
    tracker,
    backend,
  };
  return { outcome: "prepared", service: Object.freeze(service) };
}
