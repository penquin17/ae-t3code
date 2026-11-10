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
import { BACKEND_COMPOSITION_ID } from "./composition.ts";
import {
  createProvidersBackendRegistration,
  type ProvidersBackendRegistration,
  type ProvidersMode,
  type ProvidersResearchSeams,
} from "./providers.ts";
import {
  createHumanControlBackendRegistration,
  type HumanControlService,
  type HumanControlServiceFactory,
  type ThreadTurnDispatch,
} from "./humanControl.ts";
import { createPiSelectionSeam, type PiSelectionSeam } from "./routeSeam.ts";
import { createSnapshotRetention } from "./snapshotRetention.ts";
import { createIdentityFeed, type StoredEventLike } from "./identity/feed.ts";
import { createResumeSignal } from "./identity/resume.ts";
import { createIdentityReader } from "./identity/backendEntry.ts";
import { createSessionDirectory } from "./identity/sessionDirectory.ts";
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
import { createArchiveInteractionService, readAuditHistory } from "./library.ts";
import { createAuditAccess } from "./identity/auditAccess.ts";
import type { AuditPort } from "./humanControl.ts";
import { acquireOwnerLock, type HeldOwnerLock, type OwnerLockOptions } from "./ownerLock.ts";
import { createIdentityLifecycleOperation } from "./operations/identityLifecycle.ts";
import { createGit, type GitPort } from "./board/git.ts";
import { parseAwarenessConfig } from "./library.ts";
import {
  createBoardRuntime,
  type BoardRuntime,
  type BoardRuntimeOptions,
  type QuestionEvidenceProvider,
} from "./board/runtime.ts";

export interface AetheriaBackendServiceOptions {
  /** The Aetheria state root the Agent host also uses (`AETHERIA_STATE_ROOT`): a normalised absolute path. */
  readonly stateRoot: string;
  /** T3's current MCP credential id for a thread (the id its bearer proves), or undefined when T3 holds none. */
  readonly credentialOf: (threadId: string) => string | undefined | Promise<string | undefined>;
  readonly projectRootOf?: (workingFolder: string) => string | null;
  /**
   * The Aetheria checkout (`AETHERIA_CHECKOUT`, the value the server's Pi child also receives): the source of the CURRENT role catalog and of the home
   * versus foreign rule for the audit evidence. Absent or relative: `audit.history` refuses every caller with AUTH_IDENTITY_UNAVAILABLE and nothing else changes.
   */
  readonly checkout?: string;
  /** Test seam: the home-role lookup inputs for the audit check. Absent in production, which reads the process's own environment and home like the Agent host. */
  readonly auditRoles?: {
    readonly env?: Record<string, string | undefined>;
    readonly homedir?: () => string;
  };
  /** Test seam: another audit check and evidence reader. Absent in production, which uses M03's logic and the evidence archive. */
  readonly auditPort?: AuditPort;
  readonly now?: () => number;
  /** Test seam: another manifest to prove a mixed composition is refused. */
  readonly manifest?: AetheriaBackendOptions["manifest"];
  /** The awareness evidence parameters (idleMs, summaryMaxBytes of at least 512, failOpen, enabled); omitted fields take DSH's defaults. */
  readonly awareness?: unknown;
  /** The Git port for the workspace and for restart reconciliation. Default: the real `git`. */
  readonly git?: GitPort;
  /** Test seam for the state-root owner lock: the process probe, this process's identity, the takeover bound. Absent in production. */
  readonly ownerLock?: Pick<OwnerLockOptions, "probe" | "self" | "staleAfterMs">;
  /** The owned-child status of XC-10. Absent in production (M05): `assign` is unavailable. Only a test supplies it. */
  readonly childStatus?: BoardRuntimeOptions["childStatus"];
  /**
   * The composition to prepare. Default: the production `aetheria-backend`. Another id is a scripted test composition built from the same rows;
   * it is the only place a fixture may run. Ignored when `manifest` is given (the manifest names its own composition then).
   */
  readonly composition?: string;
  /** The providers module's explicit mode (M09 step 4). Default: production, the honest service with no adapters yet. */
  readonly providers?: ProvidersMode;
  /** Test seams for research (M09 step 15): the search transport and a replacement fetch work. Absent in production. */
  readonly research?: ProvidersResearchSeams;
  /**
   * T3's attachments directory, supplied by the host that assembles the Backend (M09 step 21). Snapshots of delivered files live in its `deliverables/`
   * folder, outside the state root. Absent: the two `attachments.*` operations stay registered and fail closed.
   */
  readonly attachmentsDir?: string;
  /**
   * T3's message intake and receipt store by thread, adapted by the host that assembles the Backend (M06 step 6; the apps/server wrapper, with the
   * captured Effect runtime). Absent: a late answer stays pending delivery, never delivered another way.
   */
  readonly turnDispatch?: ThreadTurnDispatch;
  /** Builds the interaction service (M06). Absent: the module runs unconfigured and its operations answer unavailable. */
  readonly interactionFactory?: HumanControlServiceFactory;
}

export interface AetheriaBackendService {
  /**
   * Take the state root's owner lock (a live or unprovable owner refuses with `state-root-owned`; an unreadable lock with `state-root-lock-unusable`),
   * boot the thread index, then validate-and-start the composition. A second call returns the first result.
   */
  start(): Promise<StartResult>;
  /** Drain in reverse start order, once. A reason is required. The owner lock is released only when the drain is clean. */
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
  /** The route policy T3's Pi adapter consults before it sends a model or effort (M09 step 11). Capabilities are unknown until the service runs. */
  readonly piSelectionSeam: PiSelectionSeam;
  /**
   * Opens a delivered-file snapshot for the Pi session that owns it, for M10's authorised download route (in process; no HTTP route yet). Another
   * session or an unknown id is ATTACHMENT_MISSING; unavailable while snapshots are not running. The caller closes the stream.
   */
  readonly openSnapshot: ProvidersBackendRegistration["openSnapshot"];
  /**
   * The ONE interaction service (M06), shared by the XC-6 operations, the client RPC handlers and direct consumers; undefined before start and
   * after drain. A caller that finds it undefined answers unavailable, never an invented state.
   */
  interactions(): HumanControlService | undefined;
  /**
   * Subscribes to the interaction service's change pushes; `onEnd` runs when the Backend drains. Undefined when no service runs. Returns the unsubscribe.
   */
  watchInteractions(
    listener: Parameters<HumanControlService["onChange"]>[0],
    onEnd: () => void,
  ): (() => void) | undefined;
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
  const identityReader = createIdentityReader({ stateRoot: options.stateRoot });
  const resolver = createIdentityResolver({ reader: identityReader, index });

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
  // M06 step 26: `resolve` asks the ONE running interaction service for the durable, verified-human answer (XC-8), in process. The service is built later,
  // inside the human-control module's start, so the provider looks it up at each call: not running (before start, after drain) is unavailable, never "unanswered".
  // `HumanControlService` does not declare `questionEvidence` (humanControl.ts is the module's, not this seam's); the archive's service has it, and a service without it
  // (a scripted test factory) answers unavailable the same way.
  let interactionsNow: () => HumanControlService | undefined = () => undefined;
  const questionEvidence: QuestionEvidenceProvider = async (args) => {
    const service = interactionsNow() as
      | (HumanControlService & { questionEvidence?: QuestionEvidenceProvider })
      | undefined;
    if (service === undefined)
      return {
        ok: false,
        code: "INTERACTION_UNAVAILABLE",
        detail: "the interaction service is not running",
      };
    if (typeof service.questionEvidence !== "function")
      return {
        ok: false,
        code: "INTERACTION_UNAVAILABLE",
        detail: "the interaction service offers no question evidence",
      };
    return service.questionEvidence(args);
  };
  const board = createBoardRuntime({
    stateRoot: options.stateRoot,
    index,
    liveness,
    config: config.config,
    now: options.now ?? Date.now,
    git: options.git ?? createGit(),
    childStatus: options.childStatus,
    questionEvidence,
  });

  const registration: BackendRegistration = createAgentAwarenessBackendRegistration({
    operations: {
      [IDENTITY_LIFECYCLE_OPERATION]: createIdentityLifecycleOperation({ tracker, index }),
      ...board.operations(),
    },
    drainBoards: () => board.drain(),
  });
  const composition = options.composition ?? BACKEND_COMPOSITION_ID;
  // A fixture never reaches the production composition: refused here, before anything is built or started.
  if (options.providers?.mode === "fixture" && composition === BACKEND_COMPOSITION_ID)
    return {
      outcome: "refused",
      faults: [
        {
          code: "providers-fixture-in-production",
          subject: "providers",
          field: "providers",
          message:
            "the availability fixture (FX-AV) cannot run in the production Backend composition",
        },
      ],
    };
  const providersRegistration = createProvidersBackendRegistration({
    composition,
    stateRoot: options.stateRoot,
    ...(options.attachmentsDir === undefined ? {} : { attachmentsDir: options.attachmentsDir }),
    ...(options.research === undefined ? {} : { research: options.research }),
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const interactionFactory = options.interactionFactory ?? createArchiveInteractionService;
  // The audit evidence (M06 step 23): the caller is checked against M03's record, the checkout's current roles and `authorize` before any file or Git is read.
  const auditAccess = createAuditAccess({
    reader: identityReader,
    index,
    checkout: options.checkout,
    env: options.auditRoles?.env,
    homedir: options.auditRoles?.homedir,
  });
  const humanControlRegistration = createHumanControlBackendRegistration({
    audit: options.auditPort ?? {
      access: (who) => auditAccess.check(who.sessionId),
      history: readAuditHistory,
    },
    // Built inside the module's start, which the Backend runs only after it holds the owner lock.
    create:
      interactionFactory === undefined
        ? undefined
        : () =>
            interactionFactory({
              stateRoot: options.stateRoot,
              now: options.now ?? Date.now,
              ...(options.turnDispatch === undefined ? {} : { turnDispatch: options.turnDispatch }),
              threadOfSession: (sessionId) => index.bindingOfSession(sessionId)?.threadId,
              sessions: createSessionDirectory(identityReader),
              canOperate: (_actor, target) =>
                index.bindingOfSession(target.sessionId) !== undefined &&
                index.bindingOfSession(target.rootSessionId) !== undefined,
            }),
  });
  interactionsNow = () => humanControlRegistration.interactions();
  // M06 step 13: T3 attaching a bound thread to a provider session after the replay is a resume; the interaction service ends the waits no segment
  // holds and retries undelivered late answers for that Pi session. The horizon is the one the board uses; the signal never fires before it is known.
  let replayHorizon: number | undefined;
  const resume = createResumeSignal({
    sessionOf: (threadId) => {
      const found = index.lookup(threadId);
      return found.status === "ok" && index.bindingOfSession(found.binding.sessionId) !== undefined
        ? found.binding.sessionId
        : undefined;
    },
    target: () => humanControlRegistration.interactions(),
    horizon: () => replayHorizon,
  });
  const feed = createIdentityFeed({
    index,
    tracker,
    credentialOf: options.credentialOf,
    onThreadAttached: (event) => {
      void resume.attached(event);
    },
  });
  const prepared = prepareAetheriaBackend({
    composition,
    registrations: [registration, providersRegistration, humanControlRegistration],
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
  });
  if (prepared.outcome === "refused") return { outcome: "refused", faults: prepared.faults };
  const { backend } = prepared;

  const retention = createSnapshotRetention({
    index,
    forgetSession: (sessionId) => providersRegistration.forgetSession(sessionId),
  });
  const running = (): boolean => backend.status().phase === "running";
  let started: Promise<StartResult> | undefined;
  let held: HeldOwnerLock | undefined;
  let disposing = false;
  const refusal = (code: string, message: string): StartResult => ({
    outcome: "refused",
    faults: [{ code, subject: "state-root", message }],
  });

  const service: AetheriaBackendService = {
    start() {
      started ??= (async () => {
        // A dispose that came first closed the host: starting it again only reports that, and takes no lock.
        if (disposing) return backend.start();
        const taken = await acquireOwnerLock({
          stateRoot: options.stateRoot,
          digest: backend.status().digest.value,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...options.ownerLock,
        });
        if (!taken.ok)
          return refusal(
            taken.code,
            taken.code === "state-root-owned"
              ? `the Backend state root is owned by another process: ${taken.detail}`
              : `the Backend state root's owner lock cannot be used: ${taken.detail}`,
          );
        held = taken.lock;
        if (disposing) {
          held.release();
          return backend.start();
        }
        index.boot();
        const result = await backend.start();
        // Sessions this Backend cannot show to be live are closed before any operation is answered for them (a failed board is retried at first use).
        if (result.outcome === "started") await board.reconcileAtStart();
        else held.release();
        return result;
      })();
      return started;
    },
    async dispose(reason) {
      const pending = backend.dispose(reason);
      disposing = true;
      const report = await pending;
      await started?.catch(() => undefined);
      // An unclean drain keeps the lock: this process may still hold writes, so a successor waits for the proven-dead takeover.
      if (report.ok) held?.release();
      return report;
    },
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
        // A deleted thread's Pi session loses its snapshots once no other thread holds it (the feed above keeps the binding for this lookup).
        if (event?.type === "thread.deleted" && typeof event.threadId === "string")
          await retention.threadDeleted(event.threadId);
      } catch {
        /* a bad event is dropped; liveness marks its own gaps */
      }
    },
    noteFeed: (reason) => liveness.noteGap(reason),
    setReplayHorizon: (sequence) => {
      replayHorizon = sequence;
      board.setReplayHorizon(sequence);
    },
    board,
    liveness,
    index,
    tracker,
    backend,
    piSelectionSeam: createPiSelectionSeam({
      capabilities: (route) => providersRegistration.routeCapabilities(route),
    }),
    openSnapshot: (sessionId, snapshotId) =>
      providersRegistration.openSnapshot(sessionId, snapshotId),
    interactions: () => humanControlRegistration.interactions(),
    watchInteractions: (listener, onEnd) => humanControlRegistration.watch(listener, onEnd),
  };
  return { outcome: "prepared", service: Object.freeze(service) };
}
