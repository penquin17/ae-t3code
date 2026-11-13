// One supplied read, owned in one place (M10 Plan step 18, D4, P2): the last answer for a (environment, root), read again when the key changes, when asked, and when a new session of the
// environment starts (the signal T3's directory reads follow, as `control/useControl.ts` does). A reply for an older read lands nowhere, a read for another root never shows under this one, and a
// read that threw is unknown, never an empty answer. Shared by the jobs list, the outbox and the usage panel.
import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { readViewFromReply, type Parsed, type ReadView } from "./reply";

export interface SuppliedRead<T> {
  readonly view: ReadView<T>;
  /** True from the moment a read starts until its answer lands. */
  readonly refreshing: boolean;
  /** Reads again and resolves with what that read said (also kept as `view` unless a newer read began). */
  readonly refresh: () => Promise<ReadView<T>>;
}

interface Held<T> {
  readonly key: string;
  readonly view: ReadView<T>;
  readonly refreshing: boolean;
}

export function useSuppliedRead<T>(input: {
  readonly environmentId: string;
  /** Changes whenever the read is for another thing (another root): the old answer is then not shown. */
  readonly resetKey: string;
  readonly read: () => Promise<unknown>;
  readonly parse: (value: unknown) => Parsed<T>;
}): SuppliedRead<T> {
  const { environmentId, resetKey } = input;
  const ticket = useRef(0);
  const [held, setHeld] = useState<Held<T>>({
    key: resetKey,
    view: { tag: "reading" },
    refreshing: true,
  });

  const run = useStableCallback(async (): Promise<ReadView<T>> => {
    ticket.current += 1;
    const mine = ticket.current;
    const forKey = resetKey;
    setHeld((previous) => ({
      key: forKey,
      view: previous.key === forKey ? previous.view : { tag: "reading" },
      refreshing: true,
    }));
    let view: ReadView<T>;
    try {
      view = readViewFromReply(await input.read(), input.parse);
    } catch (error) {
      const why = error instanceof Error && error.message !== "" ? error.message : String(error);
      view = { tag: "unknown", reason: `the read failed before an answer (${why})` };
    }
    if (ticket.current === mine) setHeld({ key: forKey, view, refreshing: false });
    return view;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads from the Backend when the root or environment changes
  useEffect(() => {
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `run` is a stable callback that reads the latest key; the read starts only when the key changes
    void run();
  }, [resetKey]);

  // A read sent before the session was ready, or whose reply a dropped connection lost, is not retried by anything else: read again once a new session is up. It fires on a change, once per new
  // session, so a read that fails again does not loop. A listener alone does not compute the atom, so it is mounted too.
  const sessionGeneration = environmentCatalog.sessionGenerationAtom(
    EnvironmentId.make(environmentId),
  );
  useAtomMount(sessionGeneration);
  useAtomSubscribe(
    sessionGeneration,
    useStableCallback(() => void run()),
  );

  const visible: Held<T> =
    held.key === resetKey ? held : { key: resetKey, view: { tag: "reading" }, refreshing: true };
  return { view: visible.view, refreshing: visible.refreshing, refresh: run };
}
