// The connection's wiring decisions (M10 step 20, Phase B; K5, D6–D8): what T3 reported, which read follows, and which facts the reducer receives. The one owner of when to probe and when to read the status.
// Plain TypeScript with supplied capabilities: no React, no atom and no T3 import beyond types, so the decisions are testable without a socket. `useConnectionView` supplies the real values and reads.
//
// A "generation" is one connection's lifetime as this controller sees it. It advances when T3 reports a new session, and when the transport leaves `connected`, so readiness, the status and any refusal
// are never carried from one connection to the next, even when T3 reports `connected` again before its new session and baseline arrive. A reply that returns after its generation ended is dropped by the reducer.
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";

import {
  projectionFromShell,
  transportFromSupervisor,
  type ProbeResult,
  type ShellFacts,
} from "./adapter";
import {
  applyEvent,
  initialFacts,
  type CompositionRead,
  type ConnectionEvent,
  type ConnectionFacts,
  type ExpectedDigest,
} from "./state";

/** What T3 reports about the primary environment right now. */
export interface ConnectionInputs {
  /** The environment these values describe; a different one is a different connection, even when its counts happen to match. */
  readonly environmentId?: string;
  readonly supervisor: SupervisorConnectionState;
  /** T3's count of sessions it has established (it rises with each new RPC session). */
  readonly sessions: number;
  readonly shell: ShellFacts;
}

export interface ConnectionControllerOptions {
  readonly expected: ExpectedDigest;
  /** One HTTP read of the upgrade path with the build's digest; it never throws. */
  readonly probe: (expectedDigest: string) => Promise<ProbeResult>;
  /** One `aetheria.composition.status` read, settled into a fact; it never throws. */
  readonly readComposition: () => Promise<CompositionRead>;
  readonly onFacts: (facts: ConnectionFacts) => void;
}

export interface ConnectionController {
  observe(inputs: ConnectionInputs): void;
  /** A per-call refusal code from an Aetheria method; only a device-ended code changes the connection. */
  reportCallRefusal(code: string): void;
  /** Stops applying anything, including replies that arrive later. A disposed controller can be resumed (React runs an effect's cleanup and setup again in development). */
  dispose(): void;
  resume(): void;
}

/** Probe only after a connect was refused or backed off: T3 is waiting to retry, it did not block the connection itself, and the build has a usable digest to declare. */
function shouldProbe(
  supervisor: SupervisorConnectionState,
  expected: ExpectedDigest,
  lastProbedAttempt: number,
): boolean {
  return (
    expected.tag === "present" &&
    supervisor.phase === "backoff" &&
    supervisor.attempt > lastProbedAttempt
  );
}

export function createConnectionController(
  options: ConnectionControllerOptions,
): ConnectionController {
  let facts = initialFacts(options.expected);
  let generation = 0;
  let previous: {
    environmentId: string | undefined;
    sessions: number;
    phase: SupervisorConnectionState["phase"];
  } | null = null;
  let lastProbedAttempt = 0;
  let readRequestedIn = 0;
  let endedSession: number | null = null;
  let disposed = false;

  const apply = (event: ConnectionEvent) => {
    if (disposed) return;
    const next = applyEvent(facts, event);
    if (next === facts) return;
    facts = next;
    options.onFacts(facts);
  };

  return {
    observe({ environmentId, supervisor, sessions, shell }) {
      if (disposed) return;
      const newSession =
        previous !== null &&
        (sessions !== previous.sessions || environmentId !== previous.environmentId);
      const lostConnection =
        previous !== null && previous.phase === "connected" && supervisor.phase !== "connected";
      if (previous === null || newSession || lostConnection) {
        generation += 1;
        lastProbedAttempt = 0;
      }
      // When the transport leaves `connected`, the session it had is over. T3 may report `connected` again before it has counted its new session, and until it does the count still names the old one.
      if (newSession) endedSession = null;
      else if (lostConnection && previous !== null) endedSession = previous.sessions;
      previous = { environmentId, sessions, phase: supervisor.phase };
      const current = generation;

      apply({
        type: "transport",
        generation: current,
        transport: transportFromSupervisor(supervisor),
      });
      apply({ type: "projection", generation: current, projection: projectionFromShell(shell) });
      const sessionLive =
        supervisor.phase === "connected" && sessions > 0 && sessions !== endedSession;
      if (sessionLive) apply({ type: "ready", generation: current });

      if (sessionLive && readRequestedIn !== current) {
        readRequestedIn = current;
        void options.readComposition().then((result) => {
          apply({ type: "composition", generation: current, result });
        });
      }

      if (
        options.expected.tag === "present" &&
        shouldProbe(supervisor, options.expected, lastProbedAttempt)
      ) {
        lastProbedAttempt = supervisor.attempt;
        void options.probe(options.expected.value).then((result) => {
          if (result.tag === "refused") {
            apply({ type: "upgrade-refused", generation: current, refusal: result.refusal });
          }
        });
      }
    },
    reportCallRefusal(code) {
      apply({ type: "call-refused", generation, code });
    },
    dispose() {
      disposed = true;
    },
    resume() {
      disposed = false;
    },
  };
}
