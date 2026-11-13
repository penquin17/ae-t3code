// The connection as the Aetheria client reads it (M10 step 20, Phase B; K5, D6–D8): T3's supervisor state, session count and shell state for the primary environment go in, the model's view comes out.
// The hook owns no rule: `createConnectionController` decides when to probe and read the status, the reducer in `state.ts` decides what the facts mean. This file only supplies the real values and reads —
// the atoms, T3's own RPC command for `aetheria.composition.status`, and `fetch` for the probe (which carries no credential, see adapter.ts).
import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { AVAILABLE_CONNECTION_STATE } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useStableCallback } from "../../hooks/useStableCallback";
import { environmentShell } from "../../state/shell";
import { useEnvironmentHttpBaseUrl, usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { sendResultFromCommand } from "../sessions/commandResult";
import { compositionFromReply, expectedDigestFrom, probeUpgrade } from "./adapter";
import { subscribeCallRefusals } from "./callRefusals";
import { createConnectionController, type ConnectionInputs } from "./controller";
import {
  initialFacts,
  viewOf,
  type ConnectionFacts,
  type ConnectionView,
  type Locale,
} from "./state";

const aetheriaComposition = {
  status: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "aetheria:composition:status",
    tag: "aetheria.composition.status",
  }),
} as const;

const sameInputs = (a: ConnectionInputs, b: ConnectionInputs): boolean =>
  a.environmentId === b.environmentId &&
  a.supervisor === b.supervisor &&
  a.sessions === b.sessions &&
  a.shell.status === b.shell.status &&
  a.shell.hasSnapshot === b.shell.hasSnapshot &&
  a.shell.generation === b.shell.generation;

/** What T3 reports about one environment. The same object comes back while nothing the controller reads has changed, so a shell delta that changes no status wakes nothing. */
const inputsAtom = Atom.family((environmentId: EnvironmentId | null) =>
  Atom.make((get): ConnectionInputs | null => {
    if (environmentId === null) return null;
    const supervisor = AsyncResult.getOrElse(
      get(environmentCatalog.stateAtom(environmentId)),
      () => AVAILABLE_CONNECTION_STATE,
    );
    const shell = get(environmentShell.stateValueAtom(environmentId));
    const next: ConnectionInputs = {
      environmentId,
      supervisor,
      sessions: get(environmentCatalog.sessionGenerationAtom(environmentId)),
      shell: {
        status: shell.status,
        hasSnapshot: Option.isSome(shell.snapshot),
        generation: shell.generation,
      },
    };
    const previous = Option.getOrNull(get.self<ConnectionInputs | null>());
    return previous !== null && sameInputs(previous, next) ? previous : next;
  }).pipe(Atom.withLabel("aetheria-connection-inputs")),
);

/** The digest this build expects: read at build time from the environment, never from the server it connects to. */
const embeddedDigest = () => expectedDigestFrom(import.meta.env.VITE_AETHERIA_BACKEND_DIGEST);

export interface ConnectionHandle {
  readonly view: ConnectionView;
  readonly facts: ConnectionFacts;
}

export function useConnectionView(locale: Locale = "en"): ConnectionHandle {
  const environmentId = usePrimaryEnvironmentId();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const status = useAtomCommand(aetheriaComposition.status, { reportFailure: false });
  const [facts, setFacts] = useState<ConnectionFacts>(() => initialFacts(embeddedDigest()));

  const probe = useStableCallback(async (expectedDigest: string) =>
    httpBaseUrl === null
      ? ({ tag: "inconclusive", reason: "the server's address is not known yet" } as const)
      : probeUpgrade({ fetch: globalThis.fetch.bind(globalThis), httpBaseUrl, expectedDigest }),
  );
  const readComposition = useStableCallback(async () => {
    if (environmentId === null) {
      return { tag: "unavailable", reason: "no environment is selected" } as const;
    }
    try {
      return compositionFromReply(
        sendResultFromCommand(await status({ environmentId, input: {} })),
      );
    } catch {
      return { tag: "unavailable", reason: "the composition status read failed" } as const;
    }
  });

  // One controller for the hook's life; it treats a different environment as a new connection. Making it has no effect: it reads and sends nothing until T3's state is observed.
  const [controller] = useState(() =>
    createConnectionController({
      expected: embeddedDigest(),
      probe,
      readComposition,
      onFacts: setFacts,
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a controller is live only while mounted; React runs this cleanup and setup twice in development
  useEffect(() => {
    controller.resume();
    return () => controller.dispose();
  }, [controller]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Aetheria call sites report device-ended refusals from outside React
  useEffect(
    () => subscribeCallRefusals((code) => controller.reportCallRefusal(code)),
    [controller],
  );

  // A listener alone does not compute the atom, so nothing would follow the connection.
  useAtomMount(inputsAtom(environmentId));
  const inputs = useAtomValue(inputsAtom(environmentId));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands T3's connection state to the controller, which decides the reads that follow
  useEffect(() => {
    if (inputs !== null) controller.observe(inputs);
  }, [controller, inputs]);

  return { view: viewOf(facts, locale), facts };
}
